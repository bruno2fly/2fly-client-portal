/**
 * ONE-TIME MIGRATION: JSON files → PostgreSQL (Prisma)
 *
 * Reads all JSON data files from the Railway Volume (DB_DIR) and inserts
 * them into the Postgres database.  Run ONCE after deploying with Prisma,
 * while the volume is still mounted so the JSON files are accessible.
 *
 * Usage (from server dir):
 *   npx tsx src/scripts/migrate-json-to-postgres.ts
 *
 * Or via the /api/migrate-json-to-postgres endpoint (POST, agency-only).
 *
 * Safe to re-run: uses upsert for every record.
 */

import { PrismaClient } from '@prisma/client';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();
const DB_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || join(process.cwd(), 'data');

function readJSONFile<T>(filename: string, defaultValue: T): T {
  const fp = join(DB_DIR, filename);
  if (!existsSync(fp)) return defaultValue;
  try {
    const raw = readFileSync(fp, 'utf-8');
    if (!raw.trim()) return defaultValue;
    return JSON.parse(raw) as T;
  } catch (e) {
    console.warn(`[migrate] Failed to read ${filename}:`, e);
    return defaultValue;
  }
}

/** Convert epoch-ms number or ISO string to Date, or null */
function toDate(v: any): Date | null {
  if (!v) return null;
  if (typeof v === 'number') return new Date(v);
  if (typeof v === 'string') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function toDateRequired(v: any): Date {
  return toDate(v) || new Date();
}

export async function migrateAll(): Promise<Record<string, { total: number; migrated: number; errors: number }>> {
  const stats: Record<string, { total: number; migrated: number; errors: number }> = {};

  function stat(name: string) {
    if (!stats[name]) stats[name] = { total: 0, migrated: 0, errors: 0 };
    return stats[name];
  }

  console.log(`[migrate] Reading JSON files from ${DB_DIR}`);

  // ── Resolve default agencyId: read agencies.json, pick the first one, or use hardcoded fallback ──
  const agenciesRaw = readJSONFile<Record<string, any>>('agencies.json', {});
  const agencyIds = Object.keys(agenciesRaw);
  const DEFAULT_AGENCY_ID = agencyIds[0] || 'agency_1737676800000_abc123';
  console.log(`[migrate] Default agencyId for orphaned records: ${DEFAULT_AGENCY_ID}`);

  // ────────────── 1. Agencies ──────────────
  {
    const items = Object.values(agenciesRaw);
    const s = stat('agencies');
    // If no agencies exist at all, create the default one
    if (items.length === 0) {
      try {
        await prisma.agency.upsert({
          where: { id: DEFAULT_AGENCY_ID },
          update: {},
          create: { id: DEFAULT_AGENCY_ID, name: '2Fly', createdAt: new Date() },
        });
        s.total = 1; s.migrated = 1;
        console.log(`[migrate] Created default agency: ${DEFAULT_AGENCY_ID}`);
      } catch (e: any) { s.total = 1; s.errors++; console.error(`[migrate] default agency:`, e.message); }
    } else {
      s.total = items.length;
      for (const a of items) {
        try {
          await prisma.agency.upsert({
            where: { id: a.id },
            update: { name: a.name },
            create: { id: a.id, name: a.name, createdAt: toDateRequired(a.createdAt) },
          });
          s.migrated++;
        } catch (e: any) { s.errors++; console.error(`[migrate] agency ${a.id}:`, e.message); }
      }
    }
    console.log(`[migrate] Agencies: ${s.migrated}/${s.total}`);
  }

  // ────────────── 2. Clients (must come before Users, PortalState, etc.) ──────────────
  {
    const data = readJSONFile<Record<string, any>>('clients.json', {});
    const creds = readJSONFile<Record<string, { password: string }>>('client-credentials.json', {});
    const items = Object.values(data);
    const s = stat('clients');
    s.total = items.length;
    for (const c of items) {
      try {
        // Find credential by agencyId:clientId key
        const credKey = `${c.agencyId}:${c.id}`;
        const pw = creds[credKey]?.password || null;

        await prisma.client.upsert({
          where: { id: c.id },
          update: {
            name: c.name,
            status: c.status || 'active',
            portalPassword: pw,
            updatedAt: toDateRequired(c.updatedAt),
          },
          create: {
            id: c.id,
            agencyId: c.agencyId || DEFAULT_AGENCY_ID,
            name: c.name,
            status: c.status || 'active',
            createdAt: toDateRequired(c.createdAt),
            updatedAt: toDateRequired(c.updatedAt),
            category: c.category || null,
            primaryContactName: c.primaryContactName || null,
            primaryContactWhatsApp: c.primaryContactWhatsApp || null,
            primaryContactEmail: c.primaryContactEmail || null,
            preferredChannel: c.preferredChannel || null,
            platformsManaged: Array.isArray(c.platformsManaged) ? c.platformsManaged : [],
            postingFrequency: c.postingFrequency || null,
            postingFrequencyNote: c.postingFrequencyNote || null,
            approvalRequired: c.approvalRequired ?? false,
            language: c.language || null,
            assetsLink: c.assetsLink || null,
            brandGuidelinesLink: c.brandGuidelinesLink || null,
            primaryGoal: c.primaryGoal || null,
            secondaryGoal: c.secondaryGoal || null,
            internalBehaviorType: c.internalBehaviorType || null,
            riskLevel: c.riskLevel || null,
            internalNotes: c.internalNotes || null,
            logoUrl: c.logoUrl || null,
            clientLinks: c.clientLinks || null,
            aiSummaryCache: c.aiSummaryCache || null,
            portalPassword: pw,
          },
        });
        s.migrated++;
      } catch (e: any) { s.errors++; console.error(`[migrate] client ${c.id}:`, e.message); }
    }
    console.log(`[migrate] Clients: ${s.migrated}/${s.total}`);
  }

  // ────────────── 3. Users ──────────────
  {
    const data = readJSONFile<Record<string, any>>('users.json', {});
    const items = Object.values(data);
    const s = stat('users');
    s.total = items.length;
    for (const u of items) {
      try {
        await prisma.user.upsert({
          where: { id: u.id },
          update: { name: u.name, role: u.role, status: u.status || 'ACTIVE', passwordHash: u.passwordHash || null },
          create: {
            id: u.id,
            agencyId: u.agencyId || DEFAULT_AGENCY_ID,
            email: u.email,
            username: u.username || null,
            name: u.name,
            role: u.role,
            status: u.status || 'ACTIVE',
            passwordHash: u.passwordHash || null,
            tempPassword: u.tempPassword || null,
            clientId: u.clientId || null,
            lastLoginAt: toDate(u.lastLoginAt),
            createdAt: toDateRequired(u.createdAt),
            updatedAt: toDateRequired(u.updatedAt),
          },
        });
        s.migrated++;
      } catch (e: any) { s.errors++; console.error(`[migrate] user ${u.id}:`, e.message); }
    }
    console.log(`[migrate] Users: ${s.migrated}/${s.total}`);
  }

  // ────────────── 4. Portal State ──────────────
  {
    const data = readJSONFile<Record<string, any>>('portal-state.json', {});
    const entries = Object.entries(data);
    const s = stat('portalState');
    s.total = entries.length;
    for (const [key, state] of entries) {
      try {
        const [agencyId, clientId] = key.split(':');
        if (!agencyId || !clientId) { s.errors++; continue; }
        await prisma.portalState.upsert({
          where: { agencyId_clientId: { agencyId, clientId } },
          update: { data: state as any },
          create: { agencyId, clientId, data: state as any },
        });
        s.migrated++;
      } catch (e: any) { s.errors++; console.error(`[migrate] portalState ${key}:`, e.message); }
    }
    console.log(`[migrate] PortalState: ${s.migrated}/${s.total}`);
  }

  // ────────────── 5. Assets ──────────────
  {
    const data = readJSONFile<any[]>('assets.json', []);
    const s = stat('assets');
    s.total = data.length;
    for (const a of data) {
      try {
        await prisma.asset.upsert({
          where: { id: a.id },
          update: { status: a.status || 'pending' },
          create: {
            id: a.id,
            workspaceId: a.workspaceId || a.agencyId || '',
            agencyId: a.agencyId || a.workspaceId || '',
            clientId: a.clientId,
            source: a.source || 'upload',
            originalFileId: a.originalFileId || null,
            originalName: a.originalName || '',
            filename: a.filename || '',
            mimeType: a.mimeType || '',
            size: a.size || 0,
            storageUrl: a.storageUrl || '',
            thumbnailUrl: a.thumbnailUrl || null,
            type: a.type || 'photo',
            status: a.status || 'pending',
            tags: Array.isArray(a.tags) ? a.tags : [],
            caption: a.caption || null,
            createdByUserId: a.createdByUserId || '',
            createdAt: toDateRequired(a.createdAt),
            updatedAt: toDateRequired(a.updatedAt),
          },
        });
        s.migrated++;
      } catch (e: any) { s.errors++; console.error(`[migrate] asset ${a.id}:`, e.message); }
    }
    console.log(`[migrate] Assets: ${s.migrated}/${s.total}`);
  }

  // ────────────── 6. Google Integrations ──────────────
  {
    const data = readJSONFile<Record<string, any>>('integrations.json', {});
    const items = Object.values(data);
    const s = stat('googleIntegrations');
    s.total = items.length;
    for (const i of items) {
      try {
        await prisma.googleIntegration.upsert({
          where: { id: i.id },
          update: { status: i.status || 'active' },
          create: {
            id: i.id,
            workspaceId: i.workspaceId || '',
            encryptedRefreshToken: i.encryptedRefreshToken || '',
            status: i.status || 'active',
            connectedAt: toDateRequired(i.connectedAt),
            lastUsedAt: toDateRequired(i.lastUsedAt),
            errorMessage: i.errorMessage || null,
          },
        });
        s.migrated++;
      } catch (e: any) { s.errors++; console.error(`[migrate] googleInt ${i.id}:`, e.message); }
    }
    console.log(`[migrate] GoogleIntegrations: ${s.migrated}/${s.total}`);
  }

  // ────────────── 7. Meta Integrations ──────────────
  {
    const data = readJSONFile<Record<string, any>>('meta-integrations.json', {});
    const items = Object.values(data);
    const s = stat('metaIntegrations');
    s.total = items.length;
    for (const i of items) {
      try {
        await prisma.metaIntegration.upsert({
          where: { id: i.id },
          update: {
            metaAccessToken: i.metaAccessToken || '',
            metaUserAccessToken: i.metaUserAccessToken || null,
            connectionStatus: i.connectionStatus || null,
            connectionError: i.connectionError || null,
          },
          create: {
            id: i.id,
            agencyId: i.agencyId || DEFAULT_AGENCY_ID,
            clientId: i.clientId || '',
            metaAccessToken: i.metaAccessToken || '',
            metaUserAccessToken: i.metaUserAccessToken || null,
            metaPageId: i.metaPageId || '',
            metaPageName: i.metaPageName || null,
            metaInstagramAccountId: i.metaInstagramAccountId || null,
            metaInstagramUsername: i.metaInstagramUsername || null,
            tokenExpiresAt: toDateRequired(i.tokenExpiresAt),
            connectedAt: toDateRequired(i.connectedAt),
            updatedAt: toDateRequired(i.updatedAt),
            connectionStatus: i.connectionStatus || null,
            connectionError: i.connectionError || null,
            connectionFlaggedAt: toDate(i.connectionFlaggedAt),
          },
        });
        s.migrated++;
      } catch (e: any) { s.errors++; console.error(`[migrate] metaInt ${i.id}:`, e.message); }
    }
    console.log(`[migrate] MetaIntegrations: ${s.migrated}/${s.total}`);
  }

  // ────────────── 8. Scheduled Posts ──────────────
  {
    const data = readJSONFile<any[]>('scheduled-posts.json', []);
    const s = stat('scheduledPosts');
    s.total = data.length;
    for (const p of data) {
      try {
        await prisma.scheduledPost.upsert({
          where: { id: p.id },
          update: { status: p.status || 'scheduled', error: p.error || null },
          create: {
            id: p.id,
            agencyId: p.agencyId || DEFAULT_AGENCY_ID,
            clientId: p.clientId || '',
            contentId: p.contentId || '',
            caption: p.caption || '',
            mediaUrl: p.mediaUrl || '',
            mediaUrls: Array.isArray(p.mediaUrls) ? p.mediaUrls : [],
            platforms: Array.isArray(p.platforms) ? p.platforms : [],
            placements: Array.isArray(p.placements) ? p.placements : ['feed'],
            scheduledAt: toDateRequired(p.scheduledAt),
            timezone: p.timezone || 'UTC',
            status: p.status || 'scheduled',
            publishedAt: toDate(p.publishedAt),
            error: p.error || null,
            metaPostIds: p.metaPostIds || null,
            createdAt: toDateRequired(p.createdAt),
            updatedAt: toDateRequired(p.updatedAt),
          },
        });
        s.migrated++;
      } catch (e: any) { s.errors++; console.error(`[migrate] post ${p.id}:`, e.message); }
    }
    console.log(`[migrate] ScheduledPosts: ${s.migrated}/${s.total}`);
  }

  // ────────────── 9. Production Tasks + Comments ──────────────
  {
    const data = readJSONFile<any[]>('production-tasks.json', []);
    const s = stat('productionTasks');
    s.total = data.length;
    for (const t of data) {
      try {
        await prisma.productionTask.upsert({
          where: { id: t.id },
          update: { status: t.status || 'assigned', updatedAt: toDateRequired(t.updatedAt) },
          create: {
            id: t.id,
            agencyId: t.agencyId || DEFAULT_AGENCY_ID,
            clientId: t.clientId || '',
            contentId: t.contentId || '',
            approvalId: t.approvalId || '',
            designerId: t.designerId || '',
            title: t.title || '',
            caption: t.caption || '',
            copyText: t.copyText || '',
            referenceImages: Array.isArray(t.referenceImages) ? t.referenceImages : [],
            briefNotes: t.briefNotes || '',
            finalArt: Array.isArray(t.finalArt) ? t.finalArt : [],
            designerNotes: t.designerNotes || '',
            status: t.status || 'assigned',
            priority: t.priority || 'medium',
            deadline: toDateRequired(t.deadline),
            reviewNotes: t.reviewNotes || '',
            createdAt: toDateRequired(t.createdAt),
            updatedAt: toDateRequired(t.updatedAt),
            startedAt: toDate(t.startedAt),
            submittedAt: toDate(t.submittedAt),
            approvedAt: toDate(t.approvedAt),
          },
        });
        // Migrate comments
        if (Array.isArray(t.comments)) {
          for (const c of t.comments) {
            try {
              await prisma.productionTaskComment.upsert({
                where: { id: c.id },
                update: { message: c.message },
                create: {
                  id: c.id,
                  taskId: t.id,
                  authorId: c.authorId || '',
                  authorName: c.authorName || '',
                  authorRole: c.authorRole || 'staff',
                  message: c.message || '',
                  statusChange: c.statusChange || null,
                  createdAt: toDateRequired(c.createdAt),
                },
              });
            } catch (ce: any) { console.error(`[migrate] comment ${c.id}:`, ce.message); }
          }
        }
        s.migrated++;
      } catch (e: any) { s.errors++; console.error(`[migrate] task ${t.id}:`, e.message); }
    }
    console.log(`[migrate] ProductionTasks: ${s.migrated}/${s.total}`);
  }

  // ────────────── 10. Invite Tokens ──────────────
  {
    const data = readJSONFile<Record<string, any>>('invite-tokens.json', {});
    const items = Object.values(data);
    const s = stat('inviteTokens');
    s.total = items.length;
    for (const t of items) {
      try {
        await prisma.inviteToken.upsert({
          where: { id: t.id },
          update: { usedAt: toDate(t.usedAt) },
          create: {
            id: t.id,
            agencyId: t.agencyId || DEFAULT_AGENCY_ID,
            userId: t.userId || '',
            tokenHash: t.tokenHash || '',
            expiresAt: toDateRequired(t.expiresAt),
            usedAt: toDate(t.usedAt),
            createdAt: toDateRequired(t.createdAt),
          },
        });
        s.migrated++;
      } catch (e: any) { s.errors++; console.error(`[migrate] inviteToken ${t.id}:`, e.message); }
    }
    console.log(`[migrate] InviteTokens: ${s.migrated}/${s.total}`);
  }

  // ────────────── 11. Password Reset Tokens ──────────────
  {
    const data = readJSONFile<Record<string, any>>('password-reset-tokens.json', {});
    const items = Object.values(data);
    const s = stat('passwordResetTokens');
    s.total = items.length;
    for (const t of items) {
      try {
        await prisma.passwordResetToken.upsert({
          where: { id: t.id },
          update: { usedAt: toDate(t.usedAt) },
          create: {
            id: t.id,
            agencyId: t.agencyId || DEFAULT_AGENCY_ID,
            userId: t.userId || '',
            tokenHash: t.tokenHash || '',
            expiresAt: toDateRequired(t.expiresAt),
            usedAt: toDate(t.usedAt),
            createdAt: toDateRequired(t.createdAt),
          },
        });
        s.migrated++;
      } catch (e: any) { s.errors++; console.error(`[migrate] resetToken ${t.id}:`, e.message); }
    }
    console.log(`[migrate] PasswordResetTokens: ${s.migrated}/${s.total}`);
  }

  // ────────────── 12. Audit Logs ──────────────
  {
    const data = readJSONFile<any[]>('audit-logs.json', []);
    const s = stat('auditLogs');
    s.total = data.length;
    for (const l of data) {
      try {
        await prisma.auditLog.upsert({
          where: { id: l.id },
          update: {},
          create: {
            id: l.id,
            agencyId: l.agencyId || DEFAULT_AGENCY_ID,
            actorUserId: l.actorUserId || '',
            action: l.action || '',
            targetUserId: l.targetUserId || null,
            targetClientId: l.targetClientId || null,
            metaJson: l.metaJson || null,
            createdAt: toDateRequired(l.createdAt),
          },
        });
        s.migrated++;
      } catch (e: any) { s.errors++; console.error(`[migrate] auditLog ${l.id}:`, e.message); }
    }
    console.log(`[migrate] AuditLogs: ${s.migrated}/${s.total}`);
  }

  // ────────────── 13. Push Subscriptions ──────────────
  {
    const data = readJSONFile<Record<string, any>>('push-subscriptions.json', {});
    const items = Object.values(data);
    const s = stat('pushSubscriptions');
    s.total = items.length;
    for (const sub of items) {
      try {
        await prisma.pushSubscription.upsert({
          where: { endpoint: sub.endpoint },
          update: {},
          create: {
            id: sub.id || `push_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            userId: sub.userId || '',
            agencyId: sub.agencyId || DEFAULT_AGENCY_ID,
            role: sub.role || '',
            endpoint: sub.endpoint,
            keys: sub.keys || {},
            createdAt: toDateRequired(sub.createdAt),
          },
        });
        s.migrated++;
      } catch (e: any) { s.errors++; console.error(`[migrate] pushSub:`, e.message); }
    }
    console.log(`[migrate] PushSubscriptions: ${s.migrated}/${s.total}`);
  }

  // ────────────── 14. Brand Kits ──────────────
  {
    const data = readJSONFile<Record<string, any>>('brand-kits.json', {});
    const items = Object.values(data);
    const s = stat('brandKits');
    s.total = items.length;
    for (const k of items) {
      try {
        await prisma.brandKit.upsert({
          where: { id: k.id },
          update: { updatedAt: toDateRequired(k.updatedAt) },
          create: {
            id: k.id,
            clientId: k.clientId,
            agencyId: k.agencyId || DEFAULT_AGENCY_ID,
            logoUrls: Array.isArray(k.logoUrls) ? k.logoUrls : [],
            colors: k.colors || [],
            fonts: k.fonts || {},
            styleTags: Array.isArray(k.styleTags) ? k.styleTags : [],
            photoStyle: k.photoStyle || '',
            rulesText: k.rulesText || '',
            referenceImages: Array.isArray(k.referenceImages) ? k.referenceImages : [],
            createdAt: toDateRequired(k.createdAt),
            updatedAt: toDateRequired(k.updatedAt),
          },
        });
        s.migrated++;
      } catch (e: any) { s.errors++; console.error(`[migrate] brandKit ${k.id}:`, e.message); }
    }
    console.log(`[migrate] BrandKits: ${s.migrated}/${s.total}`);
  }

  // ────────────── 15. AI Images ──────────────
  {
    const data = readJSONFile<Record<string, any>>('ai-images.json', {});
    const items = Object.values(data);
    const s = stat('aiImages');
    s.total = items.length;
    for (const i of items) {
      try {
        await prisma.aIImage.upsert({
          where: { id: i.id },
          update: { status: i.status || 'generated' },
          create: {
            id: i.id,
            clientId: i.clientId || '',
            agencyId: i.agencyId || DEFAULT_AGENCY_ID,
            brandKitId: i.brandKitId || null,
            prompt: i.prompt || '',
            enhancedPrompt: i.enhancedPrompt || '',
            imageUrl: i.imageUrl || '',
            thumbnailUrl: i.thumbnailUrl || '',
            format: i.format || 'feed',
            formatDimensions: i.formatDimensions || '',
            status: i.status || 'generated',
            generatedBy: i.generatedBy || '',
            approvedBy: i.approvedBy || null,
            approvalDate: toDate(i.approvalDate),
            feedback: i.feedback || '',
            usedInPostId: i.usedInPostId || null,
            modelUsed: i.modelUsed || '',
            batchId: i.batchId || null,
            createdAt: toDateRequired(i.createdAt),
            updatedAt: toDateRequired(i.updatedAt),
          },
        });
        s.migrated++;
      } catch (e: any) { s.errors++; console.error(`[migrate] aiImage ${i.id}:`, e.message); }
    }
    console.log(`[migrate] AIImages: ${s.migrated}/${s.total}`);
  }

  // ────────────── 16. Reference Images ──────────────
  {
    const data = readJSONFile<Record<string, any>>('references.json', {});
    const items = Object.values(data);
    const s = stat('references');
    s.total = items.length;
    for (const r of items) {
      try {
        await prisma.referenceImage.upsert({
          where: { id: r.id },
          update: {},
          create: {
            id: r.id,
            agencyId: r.agencyId || DEFAULT_AGENCY_ID,
            clientId: r.clientId || '',
            imageUrl: r.imageUrl || '',
            source: r.source || 'published_post',
            sourceId: r.sourceId || null,
            caption: r.caption || '',
            platforms: Array.isArray(r.platforms) ? r.platforms : [],
            publishedAt: toDate(r.publishedAt),
            createdAt: toDateRequired(r.createdAt),
          },
        });
        s.migrated++;
      } catch (e: any) { s.errors++; console.error(`[migrate] ref ${r.id}:`, e.message); }
    }
    console.log(`[migrate] References: ${s.migrated}/${s.total}`);
  }

  // ────────────── 17. Workspaces (legacy) ──────────────
  {
    const data = readJSONFile<Record<string, any>>('workspaces.json', {});
    const items = Object.values(data);
    const s = stat('workspaces');
    s.total = items.length;
    for (const w of items) {
      try {
        await prisma.workspace.upsert({
          where: { id: w.id },
          update: { name: w.name },
          create: {
            id: w.id,
            name: w.name || '',
            createdAt: toDateRequired(w.createdAt),
            updatedAt: toDateRequired(w.updatedAt),
          },
        });
        s.migrated++;
      } catch (e: any) { s.errors++; console.error(`[migrate] workspace ${w.id}:`, e.message); }
    }
    console.log(`[migrate] Workspaces: ${s.migrated}/${s.total}`);
  }

  // ────────────── 18. Staff (legacy) ──────────────
  {
    const data = readJSONFile<Record<string, any>>('staff.json', {});
    const items = Object.values(data);
    const s = stat('staff');
    s.total = items.length;
    for (const m of items) {
      try {
        await prisma.staff.upsert({
          where: { id: m.id },
          update: { fullName: m.fullName },
          create: {
            id: m.id,
            username: m.username || '',
            fullName: m.fullName || '',
            email: m.email || '',
            workspaceId: m.workspaceId || '',
            createdAt: toDateRequired(m.createdAt),
          },
        });
        s.migrated++;
      } catch (e: any) { s.errors++; console.error(`[migrate] staff ${m.id}:`, e.message); }
    }
    console.log(`[migrate] Staff: ${s.migrated}/${s.total}`);
  }

  // ────────────── Summary ──────────────
  console.log('\n[migrate] ═══ MIGRATION COMPLETE ═══');
  let totalRecords = 0, totalMigrated = 0, totalErrors = 0;
  for (const [name, s] of Object.entries(stats)) {
    console.log(`  ${name}: ${s.migrated}/${s.total} (${s.errors} errors)`);
    totalRecords += s.total;
    totalMigrated += s.migrated;
    totalErrors += s.errors;
  }
  console.log(`  TOTAL: ${totalMigrated}/${totalRecords} records migrated, ${totalErrors} errors`);

  return stats;
}

// Run directly
if (process.argv[1]?.includes('migrate-json-to-postgres')) {
  migrateAll()
    .then((stats) => {
      console.log('\nDone.');
      process.exit(0);
    })
    .catch((e) => {
      console.error('Migration failed:', e);
      process.exit(1);
    });
}
