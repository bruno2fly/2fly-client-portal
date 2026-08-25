/**
 * Content Schedule — /api/content-schedule
 *
 * Dashboard-facing (JWT cookie) read/write API over the SAME
 * AutomatedContentPost table the Google Sheet sync writes into, so manually
 * created posts flow through the identical, already-proven publish engine.
 *
 * This file adds no publishing logic of its own. It creates rows; the existing
 * content-automation publish timer picks them up.
 *
 * Untouched by design: ScheduledPost, posts.ts, cron.ts, metaConnect.ts.
 */

import { Router } from 'express';
import { prisma } from '../db.js';
import { generateId } from '../utils/auth.js';
import {
  authenticate,
  requireCanViewDashboard,
  getAgencyScope,
  type AuthenticatedRequest,
} from '../middleware/auth.js';
import { parseZonedDateTime, MAX_ATTEMPTS } from './contentAutomation.js';

const router = Router();
router.use(authenticate, requireCanViewDashboard);

const PLATFORMS = ['instagram', 'facebook', 'both'] as const;
type Platform = (typeof PLATFORMS)[number];

/** Posts that have not gone out yet and could still be cancelled. */
const CANCELLABLE = ['pending', 'failed', 'failed_terminal'];

// ─── GET /clients — who can be scheduled for ─────────────────────────────────
// Eligibility = registered in content automation (has a Sheet row). That keeps
// this page scoped to clients already wired into the proven pipeline, and it
// grows automatically as more Sheets are registered.

router.get('/clients', async (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);

    const sheets = await prisma.automatedContentSheet.findMany({
      where: { agencyId },
      select: { clientId: true },
    });
    const clientIds = sheets.map((s) => s.clientId);

    const [clients, integrations] = await Promise.all([
      prisma.client.findMany({
        where: { agencyId, id: { in: clientIds } },
        select: { id: true, name: true, logoUrl: true },
        orderBy: { name: 'asc' },
      }),
      prisma.metaIntegration.findMany({
        where: { agencyId, clientId: { in: clientIds } },
        select: {
          clientId: true,
          metaPageName: true,
          metaInstagramUsername: true,
          metaInstagramAccountId: true,
        },
      }),
    ]);

    const byClient = new Map(integrations.map((i) => [i.clientId, i]));

    res.json({
      success: true,
      clients: clients.map((c) => {
        const i = byClient.get(c.id);
        return {
          id: c.id,
          name: c.name,
          logoUrl: c.logoUrl,
          canPublish: Boolean(i),
          pageName: i?.metaPageName || null,
          instagramUsername: i?.metaInstagramUsername || null,
          hasInstagram: Boolean(i?.metaInstagramAccountId),
        };
      }),
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

// ─── GET /posts — calendar / list feed ───────────────────────────────────────

router.get('/posts', async (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);

    const clientId = typeof req.query.clientId === 'string' ? req.query.clientId : '';
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const from = typeof req.query.from === 'string' ? new Date(req.query.from) : null;
    const to = typeof req.query.to === 'string' ? new Date(req.query.to) : null;
    const limit = Math.min(Number(req.query.limit) || 200, 500);

    const posts = await prisma.automatedContentPost.findMany({
      where: {
        agencyId,
        ...(clientId ? { clientId } : {}),
        ...(status ? { status: status as any } : {}),
        ...(from && !isNaN(from.getTime()) ? { scheduledAt: { gte: from } } : {}),
        ...(to && !isNaN(to.getTime())
          ? { scheduledAt: { ...(from && !isNaN(from.getTime()) ? { gte: from } : {}), lte: to } }
          : {}),
      },
      orderBy: { scheduledAt: 'desc' },
      take: limit,
    });

    const clients = await prisma.client.findMany({
      where: { agencyId },
      select: { id: true, name: true },
    });
    const nameOf = new Map(clients.map((c) => [c.id, c.name]));

    res.json({
      success: true,
      posts: posts.map((p) => ({
        id: p.id,
        clientId: p.clientId,
        clientName: nameOf.get(p.clientId) || p.clientId,
        source: p.source,
        platform: p.platform,
        caption: p.caption,
        pillar: p.pillar,
        mediaUrl: p.mediaUrl || p.assetLink,
        assetLink: p.assetLink,
        scheduledAt: p.scheduledAt,
        timezone: p.timezone,
        status: p.status,
        attemptCount: p.attemptCount,
        maxAttempts: MAX_ATTEMPTS,
        lastError: p.lastError,
        publishedAt: p.publishedAt,
        liveUrl: p.liveUrl,
        igPostId: p.igPostId,
        fbPostId: p.fbPostId,
        cancellable: CANCELLABLE.includes(p.status),
      })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

// ─── POST /posts — create a manual post ──────────────────────────────────────

router.post('/posts', async (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const body = req.body || {};

    const clientId = String(body.clientId || '').trim();
    const platform = String(body.platform || '').trim().toLowerCase() as Platform;
    const caption = String(body.caption || '').trim();
    const mediaUrl = String(body.mediaUrl || '').trim();
    const pillar = body.pillar ? String(body.pillar).trim() : null;
    const postNow = body.postNow === true || body.scheduledAt === 'now';
    const scheduledRaw = String(body.scheduledAt || '').trim();

    if (!clientId) return res.status(400).json({ error: 'Pick a client.' });
    if (!PLATFORMS.includes(platform)) {
      return res.status(400).json({ error: 'Platform must be instagram, facebook, or both.' });
    }
    if (!caption) return res.status(400).json({ error: 'Caption is required.' });
    if (caption.length > 2200) {
      return res.status(400).json({ error: 'Caption is longer than Instagram allows (2200 characters).' });
    }
    if (!mediaUrl) return res.status(400).json({ error: 'An image or video is required.' });
    if (!/^https?:\/\//i.test(mediaUrl)) {
      return res.status(400).json({ error: 'Media must be a public http(s) URL. Upload the file first.' });
    }

    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } });
    if (!client) return res.status(404).json({ error: 'Client not found.' });

    // Fail here, clearly, rather than three attempts later in the publisher.
    const integration = await prisma.metaIntegration.findFirst({ where: { agencyId, clientId } });
    if (!integration) {
      return res.status(400).json({
        error: `${client.name} has no Meta account connected, so nothing can be published for them yet.`,
      });
    }
    if ((platform === 'instagram' || platform === 'both') && !integration.metaInstagramAccountId) {
      return res.status(400).json({
        error: `${client.name} has a Facebook Page connected but no Instagram Business account. Post to Facebook only, or connect Instagram first.`,
      });
    }

    let scheduledAt: Date | null;
    if (postNow) {
      // Backdate a minute so the next publish tick picks it up immediately.
      scheduledAt = new Date(Date.now() - 60_000);
    } else {
      scheduledAt = parseZonedDateTime(scheduledRaw);
      if (!scheduledAt) {
        return res.status(400).json({
          error: `Could not read the date/time "${scheduledRaw}". Use YYYY-MM-DD HH:MM.`,
        });
      }
    }

    const post = await prisma.automatedContentPost.create({
      data: {
        id: generateId('acp'),
        agencyId,
        clientId,
        // Manual posts have no spreadsheet row; these values are placeholders
        // and the publisher skips Sheet writeback when source === 'manual'.
        spreadsheetId: 'manual',
        sheetRowId: `manual_${generateId()}`,
        sheetRowNumber: 0,
        source: 'manual',
        platform,
        caption,
        pillar,
        assetLink: mediaUrl,
        mediaUrl,
        scheduledAt,
        notes: `Created in Content Schedule by ${req.user?.name || req.user?.email || 'dashboard user'}`,
      },
    });

    res.status(201).json({
      success: true,
      post,
      willPublishWithin: postNow ? 'the next publish run (within 5 minutes)' : undefined,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

// ─── DELETE /posts/:id — cancel something that has not gone out ──────────────

router.delete('/posts/:id', async (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const id = String(req.params.id);

    const post = await prisma.automatedContentPost.findFirst({ where: { id, agencyId } });
    if (!post) return res.status(404).json({ error: 'Post not found.' });

    if (post.status === 'published') {
      return res.status(400).json({
        error: 'This post is already live on Meta. Delete it from Instagram or Facebook directly.',
      });
    }
    if (post.status === 'publishing') {
      return res.status(409).json({ error: 'This post is being published right now — try again in a minute.' });
    }

    await prisma.automatedContentPost.delete({ where: { id } });
    res.json({ success: true, deleted: id });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

export default router;
