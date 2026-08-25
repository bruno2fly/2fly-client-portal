/**
 * Content Automation v2 — /api/content-automation
 *
 * Google Sheet (one per client) → sync cron → AutomatedContentPost → publish cron
 * → Meta Graph API → live URL written back to the Sheet.
 *
 * Runs entirely parallel to the legacy pipeline. It reads MetaIntegration for
 * credentials and touches nothing else that posts.ts / cron.ts own.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { createHash, randomBytes } from 'crypto';
import { prisma } from '../db.js';
import { generateId } from '../utils/auth.js';
import {
  readReadyRows,
  writeBackRow,
  checkSheetAccess,
  getServiceAccountEmail,
  isServiceAccountConfigured,
  SHEET_STATUS,
} from '../lib/googleSheets.js';
import { resolveMediaUrl } from '../lib/driveMedia.js';
import { publishToInstagram, publishToFacebook, classifyMetaError } from '../lib/autoPublishMeta.js';

const router = Router();

export const MAX_ATTEMPTS = 3;
const PUBLISH_BATCH = 10;

// ─── Auth ────────────────────────────────────────────────────────────────────
// Fails closed, and deliberately does NOT trust the source address. Render
// terminates TLS at its edge and forwards to the container, so a request from
// the public internet can arrive looking like loopback — an "allow localhost"
// rule would expose these endpoints to everyone. That is the same class of
// mistake that currently leaves /api/cron/* open.
//
// Instead: every caller needs the secret, including the in-process timers. If
// CONTENT_AUTOMATION_SECRET is not set we generate a random one at boot, which
// the timers know and nobody else can guess — so the endpoints are unreachable
// from outside until someone deliberately sets the env var.

export const INTERNAL_AUTOMATION_SECRET =
  process.env.CONTENT_AUTOMATION_SECRET?.trim() || randomBytes(32).toString('hex');

export const AUTOMATION_SECRET_IS_EXPLICIT = Boolean(process.env.CONTENT_AUTOMATION_SECRET);

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function automationAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  const bearer = typeof header === 'string' ? header.match(/^Bearer\s+(.+)$/i)?.[1] : undefined;
  const querySecret = typeof req.query.secret === 'string' ? req.query.secret : '';
  const apiKeyHeader = req.headers['x-api-key'];
  const apiKey = typeof apiKeyHeader === 'string' ? apiKeyHeader : '';
  const provided = (bearer || querySecret || apiKey).trim();

  if (!provided || !timingSafeEqual(provided, INTERNAL_AUTOMATION_SECRET)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

router.use(automationAuth);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Offset of a timezone at a given UTC instant, in ms. */
function tzOffsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(m.year),
    Number(m.month) - 1,
    Number(m.day),
    Number(m.hour) % 24,
    Number(m.minute),
    Number(m.second),
  );
  return asUtc - utcMs;
}

/**
 * Parse a wall-clock string written in `timeZone` into a real UTC Date.
 * Accepts "2026-08-25 14:30", "2026-08-25T14:30", "8/25/2026 2:30 PM".
 * DST-correct: resolves the offset at the resulting instant, not at "now".
 */
export function parseZonedDateTime(raw: string, timeZone = 'America/New_York'): Date | null {
  const s = (raw || '').trim();
  if (!s) return null;

  let y: number, mo: number, d: number, h = 0, mi = 0;

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?\s*(AM|PM|am|pm)?/);

  if (iso) {
    y = Number(iso[1]); mo = Number(iso[2]); d = Number(iso[3]);
    h = Number(iso[4] ?? 0); mi = Number(iso[5] ?? 0);
  } else if (us) {
    mo = Number(us[1]); d = Number(us[2]); y = Number(us[3]);
    h = Number(us[4] ?? 0); mi = Number(us[5] ?? 0);
    const ampm = (us[6] || '').toUpperCase();
    if (ampm === 'PM' && h < 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
  } else {
    return null;
  }

  if (!y || !mo || !d || mo > 12 || d > 31 || h > 23 || mi > 59) return null;

  const naive = Date.UTC(y, mo - 1, d, h, mi);
  let utc = naive;
  // Two passes converge even across a DST boundary.
  for (let i = 0; i < 2; i++) utc = naive - tzOffsetMs(utc, timeZone);
  const out = new Date(utc);
  return isNaN(out.getTime()) ? null : out;
}

function normalizePlatform(raw: string): 'instagram' | 'facebook' | 'both' | null {
  const p = (raw || '').trim().toLowerCase();
  if (['instagram', 'ig'].includes(p)) return 'instagram';
  if (['facebook', 'fb'].includes(p)) return 'facebook';
  if (['both', 'instagram+facebook', 'ig+fb', 'all'].includes(p)) return 'both';
  return null;
}

function rowKey(spreadsheetId: string, rowNumber: number, scheduledRaw: string, platform: string): string {
  return createHash('sha1')
    .update(`${spreadsheetId}:${rowNumber}:${scheduledRaw}:${platform}`)
    .digest('hex')
    .slice(0, 24);
}

async function resolveAgencyId(): Promise<string> {
  const a = await prisma.agency.findFirst({ select: { id: true } });
  if (!a) throw new Error('No agency exists in the database.');
  return a.id;
}

// ─── GET /status ─────────────────────────────────────────────────────────────

router.get('/status', async (_req: Request, res: Response) => {
  try {
    const configured = isServiceAccountConfigured();
    const sheets = await prisma.automatedContentSheet.findMany();

    const counts = await prisma.automatedContentPost.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    const sheetStatus = configured
      ? await Promise.all(
          sheets.map(async (s) => ({
            clientId: s.clientId,
            spreadsheetId: s.spreadsheetId,
            tabName: s.tabName,
            enabled: s.enabled,
            lastSyncedAt: s.lastSyncedAt,
            lastSyncError: s.lastSyncError,
            access: await checkSheetAccess(s.spreadsheetId, s.tabName),
          })),
        )
      : sheets.map((s) => ({
          clientId: s.clientId,
          spreadsheetId: s.spreadsheetId,
          tabName: s.tabName,
          enabled: s.enabled,
          lastSyncedAt: s.lastSyncedAt,
          lastSyncError: s.lastSyncError,
          access: { ok: false, error: 'Service account not configured' },
        }));

    res.json({
      success: true,
      serviceAccountConfigured: configured,
      serviceAccountEmail: configured ? getServiceAccountEmail() : null,
      remoteAccessEnabled: AUTOMATION_SECRET_IS_EXPLICIT,
      postCounts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      sheets: sheetStatus,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

// ─── POST /sheets — register or update a client's Sheet ──────────────────────

router.post('/sheets', async (req: Request, res: Response) => {
  try {
    const clientId = String(req.body?.clientId || '').trim();
    const spreadsheetId = String(req.body?.spreadsheetId || '').trim();
    const tabName = String(req.body?.tabName || 'Schedule').trim();
    const enabled = req.body?.enabled === undefined ? true : Boolean(req.body.enabled);

    if (!clientId || !spreadsheetId) {
      return res.status(400).json({ error: 'clientId and spreadsheetId are required.' });
    }

    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) return res.status(404).json({ error: `Client "${clientId}" not found.` });

    const existing = await prisma.automatedContentSheet.findUnique({ where: { clientId } });

    const saved = existing
      ? await prisma.automatedContentSheet.update({
          where: { clientId },
          data: { spreadsheetId, tabName, enabled },
        })
      : await prisma.automatedContentSheet.create({
          data: {
            id: generateId('acs'),
            agencyId: client.agencyId,
            clientId,
            spreadsheetId,
            tabName,
            enabled,
          },
        });

    const access = isServiceAccountConfigured()
      ? await checkSheetAccess(spreadsheetId, tabName)
      : { ok: false, error: 'Service account not configured' };

    res.json({ success: true, sheet: saved, access });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

// ─── GET /sync — pull Ready rows into the database ───────────────────────────

interface SyncReport {
  clientId: string;
  imported: number;
  skipped: number;
  rejected: number;
  error?: string;
}

async function syncOneSheet(sheet: {
  clientId: string;
  agencyId: string;
  spreadsheetId: string;
  tabName: string;
}): Promise<SyncReport> {
  const report: SyncReport = { clientId: sheet.clientId, imported: 0, skipped: 0, rejected: 0 };

  const rows = await readReadyRows(sheet.spreadsheetId, sheet.tabName);

  for (const row of rows) {
    const platform = normalizePlatform(row.platform);
    const scheduledAt = parseZonedDateTime(row.scheduledRaw);

    // Reject bad rows loudly, in the Sheet, where a human will see it.
    if (!platform || !scheduledAt || !row.caption || !row.assetLink) {
      const problems: string[] = [];
      if (!platform) problems.push(`Platform "${row.platform}" not understood (use Instagram, Facebook, or Both)`);
      if (!scheduledAt) problems.push(`Date/time "${row.scheduledRaw}" not understood`);
      if (!row.caption) problems.push('Caption is empty');
      if (!row.assetLink) problems.push('Asset Link is empty');

      await writeBackRow(sheet.spreadsheetId, sheet.tabName, row.rowNumber, {
        status: SHEET_STATUS.failed,
        notes: problems.join('; '),
      });
      report.rejected++;
      continue;
    }

    const sheetRowId = rowKey(sheet.spreadsheetId, row.rowNumber, row.scheduledRaw, platform);

    const existing = await prisma.automatedContentPost.findUnique({
      where: { clientId_sheetRowId: { clientId: sheet.clientId, sheetRowId } },
    });

    if (existing) {
      // Already imported — just make sure the Sheet reflects that.
      await writeBackRow(sheet.spreadsheetId, sheet.tabName, row.rowNumber, {
        status: SHEET_STATUS.synced,
      });
      report.skipped++;
      continue;
    }

    await prisma.automatedContentPost.create({
      data: {
        id: generateId('acp'),
        agencyId: sheet.agencyId,
        clientId: sheet.clientId,
        spreadsheetId: sheet.spreadsheetId,
        sheetRowId,
        sheetRowNumber: row.rowNumber,
        platform,
        caption: row.caption,
        pillar: row.pillar || null,
        assetLink: row.assetLink,
        scheduledAt,
        notes: row.notes || null,
      },
    });

    await writeBackRow(sheet.spreadsheetId, sheet.tabName, row.rowNumber, {
      status: SHEET_STATUS.synced,
      notes: '',
    });
    report.imported++;
  }

  return report;
}

router.get('/sync', async (req: Request, res: Response) => {
  if (!isServiceAccountConfigured()) {
    // Not an error state before setup — the timer runs every 15 min and should
    // not spam the logs. GET /status is where configuration health is reported.
    return res.json({
      success: true,
      skipped: true,
      reason: 'GOOGLE_SERVICE_ACCOUNT_JSON is not configured yet.',
      imported: 0,
    });
  }

  const onlyClient = (req.query.clientId as string) || '';
  const where = onlyClient ? { clientId: onlyClient } : { enabled: true };
  const sheets = await prisma.automatedContentSheet.findMany({ where });

  const reports: SyncReport[] = [];

  for (const sheet of sheets) {
    try {
      const r = await syncOneSheet(sheet);
      reports.push(r);
      await prisma.automatedContentSheet.update({
        where: { clientId: sheet.clientId },
        data: { lastSyncedAt: new Date(), lastSyncError: null },
      });
    } catch (e: any) {
      const msg = e?.message || String(e);
      reports.push({ clientId: sheet.clientId, imported: 0, skipped: 0, rejected: 0, error: msg });
      await prisma.automatedContentSheet.update({
        where: { clientId: sheet.clientId },
        data: { lastSyncedAt: new Date(), lastSyncError: msg.slice(0, 500) },
      });
    }
  }

  const imported = reports.reduce((n, r) => n + r.imported, 0);
  res.json({ success: true, sheets: reports.length, imported, reports });
});

// ─── GET /publish — publish everything due ───────────────────────────────────

async function publishOne(post: any): Promise<{ status: string; detail: string }> {
  const integration = await prisma.metaIntegration.findFirst({
    where: { agencyId: post.agencyId, clientId: post.clientId },
  });

  if (!integration) {
    throw Object.assign(new Error(`No Meta integration connected for client "${post.clientId}".`), {
      fatalOverride: true,
    });
  }

  const media = await resolveMediaUrl(post.assetLink, post.clientId);
  const isVideo = /^video\//i.test(media.contentType);

  let igPostId: string | null = post.igPostId;
  let fbPostId: string | null = post.fbPostId;
  let liveUrl: string | null = post.liveUrl;

  const wantsIg = post.platform === 'instagram' || post.platform === 'both';
  const wantsFb = post.platform === 'facebook' || post.platform === 'both';

  // Skip whichever half already succeeded — a retry must never double-post.
  if (wantsIg && !igPostId) {
    if (!integration.metaInstagramAccountId) {
      throw Object.assign(
        new Error(`Client "${post.clientId}" has no Instagram Business account linked in its Meta integration.`),
        { fatalOverride: true },
      );
    }
    const r = await publishToInstagram(integration.metaInstagramAccountId, integration.metaAccessToken, {
      mediaUrl: media.url,
      caption: post.caption,
      isVideo,
    });
    igPostId = r.postId;
    liveUrl = r.permalink || liveUrl;
  }

  if (wantsFb && !fbPostId) {
    const r = await publishToFacebook(integration.metaPageId, integration.metaAccessToken, {
      mediaUrl: media.url,
      caption: post.caption,
    });
    fbPostId = r.postId;
    if (!liveUrl) liveUrl = r.permalink;
  }

  await prisma.automatedContentPost.update({
    where: { id: post.id },
    data: {
      status: 'published',
      publishedAt: new Date(),
      igPostId,
      fbPostId,
      liveUrl,
      mediaUrl: media.url,
      lastError: null,
    },
  });

  // Write the result back to the Sheet. A writeback failure must not turn a
  // successful post into a "failed" one — record it and move on.
  let writtenBack = false;
  try {
    await writeBackRow(post.spreadsheetId, await tabNameFor(post.clientId), post.sheetRowNumber, {
      status: SHEET_STATUS.posted,
      liveUrl: liveUrl || '',
      postId: [igPostId, fbPostId].filter(Boolean).join(' / '),
      notes: '',
    });
    writtenBack = true;
  } catch (e: any) {
    console.error(`[content-automation] writeback failed for ${post.id}:`, e?.message);
  }

  if (writtenBack) {
    await prisma.automatedContentPost.update({ where: { id: post.id }, data: { writtenBack: true } });
  }

  return { status: 'published', detail: liveUrl || [igPostId, fbPostId].filter(Boolean).join(' / ') };
}

async function tabNameFor(clientId: string): Promise<string> {
  const s = await prisma.automatedContentSheet.findUnique({ where: { clientId } });
  return s?.tabName || 'Schedule';
}

async function handleFailure(post: any, err: any): Promise<{ status: string; detail: string }> {
  const meta = classifyMetaError(err);
  const fatal = Boolean(err?.fatalOverride) || meta.fatal;
  const attempts = post.attemptCount + 1;
  const terminal = fatal || attempts >= MAX_ATTEMPTS;

  const message = meta.message;
  const note = terminal
    ? `FAILED (${attempts}/${MAX_ATTEMPTS}, no further retries): ${message}`
    : `Attempt ${attempts}/${MAX_ATTEMPTS} failed, will retry: ${message}`;

  await prisma.automatedContentPost.update({
    where: { id: post.id },
    data: {
      status: terminal ? 'failed_terminal' : 'failed',
      attemptCount: attempts,
      lastError: message.slice(0, 1000),
    },
  });

  try {
    await writeBackRow(post.spreadsheetId, await tabNameFor(post.clientId), post.sheetRowNumber, {
      status: terminal ? SHEET_STATUS.failed : SHEET_STATUS.synced,
      notes: note,
    });
  } catch (e: any) {
    console.error(`[content-automation] failure writeback failed for ${post.id}:`, e?.message);
  }

  return { status: terminal ? 'failed_terminal' : 'failed', detail: message };
}

router.get('/publish', async (req: Request, res: Response) => {
  const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';

  const due = await prisma.automatedContentPost.findMany({
    where: {
      status: { in: ['pending', 'failed'] },
      scheduledAt: { lte: new Date() },
      attemptCount: { lt: MAX_ATTEMPTS },
      ...(req.query.clientId ? { clientId: String(req.query.clientId) } : {}),
    },
    orderBy: { scheduledAt: 'asc' },
    take: PUBLISH_BATCH,
  });

  if (dryRun) {
    return res.json({
      success: true,
      dryRun: true,
      due: due.map((p) => ({
        id: p.id,
        clientId: p.clientId,
        platform: p.platform,
        scheduledAt: p.scheduledAt,
        attemptCount: p.attemptCount,
        caption: p.caption.slice(0, 60),
      })),
    });
  }

  const results: any[] = [];

  for (const post of due) {
    // Claim it. If another timer tick got here first, the count is 0 and we skip.
    const claimed = await prisma.automatedContentPost.updateMany({
      where: { id: post.id, status: post.status },
      data: { status: 'publishing' },
    });
    if (claimed.count === 0) continue;

    try {
      const r = await publishOne(post);
      results.push({ id: post.id, clientId: post.clientId, ...r });
    } catch (e: any) {
      const r = await handleFailure(post, e);
      results.push({ id: post.id, clientId: post.clientId, ...r });
    }
  }

  const published = results.filter((r) => r.status === 'published').length;
  if (results.length > 0) {
    console.log(`[content-automation] processed ${results.length}, published ${published}`);
  }

  res.json({ success: true, processed: results.length, published, results });
});

// ─── POST /seed-estoqui — one-time onboarding for the Estoqui pilot ──────────
//
// Creates the Estoqui client record and its MetaIntegration using credentials
// that already work in the standalone admin.estoqui.com system. The access token
// is read from ESTOQUI_META_ACCESS_TOKEN in the environment on purpose — it goes
// Vercel → Render directly and never passes through chat, a file, or the repo.
//
// Idempotent: safe to call twice. Never overwrites an existing token with an
// empty one.

const ESTOQUI = {
  clientId: 'estoqui',
  name: 'Estoqui',
  pageId: '1253283734533784',
  igBusinessId: '17841441951370619',
  igUsername: 'estoquiapp',
} as const;

router.post('/seed-estoqui', async (_req: Request, res: Response) => {
  try {
    const token = process.env.ESTOQUI_META_ACCESS_TOKEN;
    if (!token || !token.trim()) {
      return res.status(400).json({
        error:
          'ESTOQUI_META_ACCESS_TOKEN is not set on this service. Add it in Render (copy the value from estoqui-admin) and call this again.',
      });
    }

    const agencyId = await resolveAgencyId();

    // 1. Client record
    let client = await prisma.client.findUnique({ where: { id: ESTOQUI.clientId } });
    if (!client) {
      client = await prisma.client.create({
        data: {
          id: ESTOQUI.clientId,
          agencyId,
          name: ESTOQUI.name,
          status: 'active',
          platformsManaged: ['instagram', 'facebook'],
          language: 'en',
          internalNotes:
            'Created for the Content Automation v2 pilot. Runs side-by-side with the standalone admin.estoqui.com system for comparison.',
        },
      });
    }

    // 2. Meta integration — verify the credentials before storing them
    const { verifyPageToken } = await import('../lib/autoPublishMeta.js');
    const check = await verifyPageToken(ESTOQUI.pageId, token.trim());
    if (!check.ok) {
      return res.status(400).json({
        error: `The provided Estoqui token could not read page ${ESTOQUI.pageId}: ${check.error}`,
        hint: 'Confirm the token copied from estoqui-admin is the current long-lived Page token.',
      });
    }

    const existing = await prisma.metaIntegration.findFirst({
      where: { agencyId, clientId: ESTOQUI.clientId },
    });

    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000); // long-lived ≈ 60 days

    const integration = existing
      ? await prisma.metaIntegration.update({
          where: { id: existing.id },
          data: {
            metaAccessToken: token.trim(),
            metaPageId: ESTOQUI.pageId,
            metaPageName: check.name || ESTOQUI.name,
            metaInstagramAccountId: ESTOQUI.igBusinessId,
            metaInstagramUsername: ESTOQUI.igUsername,
            tokenExpiresAt: expiresAt,
            connectionStatus: 'ok',
            connectionError: null,
          },
        })
      : await prisma.metaIntegration.create({
          data: {
            id: generateId('meta'),
            agencyId,
            clientId: ESTOQUI.clientId,
            metaAccessToken: token.trim(),
            metaPageId: ESTOQUI.pageId,
            metaPageName: check.name || ESTOQUI.name,
            metaInstagramAccountId: ESTOQUI.igBusinessId,
            metaInstagramUsername: ESTOQUI.igUsername,
            tokenExpiresAt: expiresAt,
            connectedAt: new Date(),
            connectionStatus: 'ok',
          },
        });

    res.json({
      success: true,
      client: { id: client.id, name: client.name, created: !existing },
      integration: {
        id: integration.id,
        pageId: integration.metaPageId,
        pageName: integration.metaPageName,
        igBusinessId: integration.metaInstagramAccountId,
      },
      verifiedPageName: check.name,
      note: 'Register the Estoqui Sheet with POST /sheets before the sync cron will pick it up.',
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

export default router;
