/**
 * Client portal API. Requires client JWT (Bearer token from /api/auth/client-login).
 * GET/PUT portal state so client sees agency-added approvals, requests, needs, etc.
 */

import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getPortalState, savePortalState, getClient, getProductionTasksByAgency, saveProductionTask, getScheduledPostsByAgency } from '../db.js';
import type { PortalStateData } from '../types.js';
import { sendPushToRole, sendPushToUser, NOTIFY } from '../lib/pushService.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production-use-strong-secret';

function defaultPortalState(clientId: string, name: string, whatsapp?: string): PortalStateData {
  return {
    client: { id: clientId, name: name || clientId, whatsapp: whatsapp || '' },
    kpis: { scheduled: 0, waitingApproval: 0, missingAssets: 0, frustration: 0 },
    approvals: [],
    needs: [],
    requests: [],
    assets: [],
    activity: [],
    seen: false
  };
}

function authenticateClient(req: Request, res: Response): { clientId: string; agencyId: string } | null {
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Authorization required' });
    return null;
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { clientId?: string; agencyId?: string; purpose?: string };
    if (decoded.purpose !== 'client-portal' || !decoded.clientId || !decoded.agencyId) {
      res.status(401).json({ error: 'Invalid token' });
      return null;
    }
    return { clientId: decoded.clientId, agencyId: decoded.agencyId };
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return null;
  }
}

/**
 * GET /api/client/portal-state
 * Returns portal state for the authenticated client.
 */
router.get('/portal-state', async (req, res) => {
  const ctx = authenticateClient(req, res);
  if (!ctx) return;
  try {
    let state = await getPortalState(ctx.agencyId, ctx.clientId);
    const client = await getClient(ctx.clientId);
    if (!state) {
      state = defaultPortalState(ctx.clientId, client?.name || ctx.clientId, client?.primaryContactWhatsApp);
      await savePortalState(ctx.agencyId, ctx.clientId, state);
    }
    // Ensure logoUrl from client record is included in the response
    if (client && state.client) {
      (state.client as any).logoUrl = client.logoUrl || null;
      (state.client as any).name = client.name || state.client.name;
    }
    res.json({ success: true, data: state });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to load portal state' });
  }
});

/**
 * PUT /api/client/portal-state
 * Body: { data }. Updates portal state for the authenticated client.
 */
router.put('/portal-state', async (req, res) => {
  const ctx = authenticateClient(req, res);
  if (!ctx) return;
  try {
    const { data } = req.body || {};
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'data required' });
    }
    const state = data as PortalStateData;
    if (!state.client || !state.kpis || !Array.isArray(state.assets)) {
      return res.status(400).json({ error: 'Invalid portal state shape' });
    }
    await savePortalState(ctx.agencyId, ctx.clientId, state);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to save portal state' });
  }
});

/**
 * POST /api/client/request-changes
 * Client requests changes on an approval item.
 * Finds linked production task and sets it to changes_requested with reviewNotes.
 * Body: { approvalId, note, images? }
 */
router.post('/request-changes', async (req, res) => {
  const ctx = authenticateClient(req, res);
  if (!ctx) return;
  try {
    const { approvalId, note } = req.body || {};
    if (!approvalId || !note) {
      return res.status(400).json({ error: 'approvalId and note are required' });
    }
    // Find production task linked to this approval
    const tasks = await getProductionTasksByAgency(ctx.agencyId);
    const linkedTask = tasks.find(
      (t: any) => (t.approvalId === approvalId || t.contentId === approvalId) && t.clientId === ctx.clientId
    );
    if (!linkedTask) {
      // No linked production task — that's OK, just return success (change is stored in portal state)
      return res.json({ success: true, taskUpdated: false });
    }
    // Only update if task is in a state where changes make sense
    const changeable = ['review', 'in_progress', 'approved', 'ready_to_post'];
    if (changeable.includes(linkedTask.status)) {
      linkedTask.status = 'changes_requested' as any;
      linkedTask.reviewNotes = 'Client change request: ' + String(note).slice(0, 2000);
      linkedTask.updatedAt = new Date().toISOString();
      await saveProductionTask(linkedTask);
      // Fire-and-forget push to agency staff about client change request
      const clientName = (await getClient(ctx.clientId))?.name || 'Client';
      sendPushToRole(ctx.agencyId, ['OWNER', 'ADMIN', 'STAFF'], NOTIFY.clientChanges(
        clientName,
        linkedTask.title || 'Task'
      )).catch(() => {});
      // Also notify the designer if there's a linked production task
      if (linkedTask && linkedTask.designerId) {
        sendPushToUser(linkedTask.designerId, NOTIFY.designRevision(
          linkedTask.title || 'Task',
          clientName
        )).catch(() => {});
      }
    }
    res.json({ success: true, taskUpdated: true, taskId: linkedTask.id });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to process change request' });
  }
});

/**
 * GET /api/client/progress
 * Returns real progress metrics for the authenticated client this month.
 * Posts published, reels count, requests resolved — computed from actual data.
 */
router.get('/progress', async (req, res) => {
  const ctx = authenticateClient(req, res);
  if (!ctx) return;
  try {
    // Start of current month (UTC)
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString();

    // --- Posts published this month for this client ---
    const allPosts = (await getScheduledPostsByAgency(ctx.agencyId))
      .filter(p => p.clientId === ctx.clientId && p.status === 'published' && p.publishedAt && p.publishedAt >= monthStart);

    const postsPublished = allPosts.length;

    // Reels = posts with 'reels' in placements
    const reelsCount = allPosts.filter(p => Array.isArray(p.placements) && p.placements.includes('reels')).length;

    // --- Requests resolved this month ---
    const state = await getPortalState(ctx.agencyId, ctx.clientId);
    const requests: any[] = (state && Array.isArray((state as any).requests)) ? (state as any).requests : [];
    const requestsResolved = requests.filter((r: any) => {
      if (r.status !== 'done') return false;
      // Use doneAt timestamp if available, else include it anyway
      if (r.doneAt) return r.doneAt >= monthStart;
      return true; // no timestamp → count it
    }).length;

    // Build period label
    const period = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    res.json({
      success: true,
      period,
      posts: postsPublished,
      reels: reelsCount,
      requestsResolved,
      _sample: false
    });
  } catch (e: any) {
    console.error('Progress endpoint error:', e?.message);
    res.status(500).json({ error: e.message || 'Failed to compute progress' });
  }
});

/**
 * GET /api/client/scheduled-posts
 * Returns scheduled posts for the authenticated client.
 */
router.get('/scheduled-posts', async (req, res) => {
  const ctx = authenticateClient(req, res);
  if (!ctx) return;
  try {
    let posts = await getScheduledPostsByAgency(ctx.agencyId);
    // Filter to only this client's posts
    posts = posts.filter(p => p.clientId === ctx.clientId);
    // Sort by scheduledAt ascending
    posts.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
    res.json({ success: true, posts });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to load scheduled posts' });
  }
});

/**
 * POST /api/client/upload-image
 * Upload a base64 image to Vercel Blob CDN. Returns a public URL.
 * Used by the client portal request form instead of storing base64 in portal state.
 */
router.post('/upload-image', async (req, res) => {
  const ctx = authenticateClient(req, res);
  if (!ctx) return;
  try {
    const { image } = req.body;
    if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Valid base64 image required (data:image/...)' });
    }

    const blobToken = process.env.BLOB_PUBLIC_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
    if (!blobToken) {
      // No blob token — return the base64 as-is (fallback for dev)
      return res.json({ success: true, url: image });
    }

    let put: any;
    try {
      const blobModule = await import('@vercel/blob');
      put = blobModule.put;
    } catch {
      return res.json({ success: true, url: image }); // fallback
    }

    const match = image.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid image format' });
    }

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const buffer = Buffer.from(match[2], 'base64');
    const filename = `requests/${ctx.clientId}/${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;

    const blob = await put(filename, buffer, {
      access: 'public',
      contentType: `image/${match[1]}`,
      token: blobToken,
    });

    res.json({ success: true, url: blob.url });
  } catch (e: any) {
    console.error('[client/upload-image] Error:', e?.message);
    res.status(500).json({ error: e?.message || 'Upload failed' });
  }
});

export default router;
