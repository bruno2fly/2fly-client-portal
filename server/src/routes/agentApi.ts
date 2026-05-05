/**
 * Agent API — /api/agent
 * Secure internal endpoints for AI agents (Scribe, Boss, etc.)
 * Auth: Bearer token via Authorization header
 */

import { Router, Request, Response, NextFunction } from 'express';
import {
  getClientsByAgency,
  getClient,
  getAgencies,
  getUsersByAgency,
  getScheduledPostsByAgency,
  getScheduledPostById,
  getPortalState,
  savePortalState,
  getProductionTasksByAgency,
  getProductionTaskById,
  saveProductionTask,
  countPendingApprovals,
  stripBase64FromPortalState,
  prisma,
} from '../db.js';
import { generateId } from '../utils/auth.js';
import type { ProductionTask, ProductionTaskStatus, PortalStateData } from '../types.js';

const router = Router();

// ─── Auth middleware ─────────────────────────────────────────────────────────
const AGENT_TOKEN = process.env.AGENT_API_SECRET || '2fly-agent-secret-scribe-2026';

/** Resolve the agency ID: env override → first agency in DB → fallback '2fly' */
async function resolveAgencyId(): Promise<string> {
  if (process.env.AGENT_AGENCY_ID) return process.env.AGENT_AGENCY_ID;
  const agencies = await getAgencies();
  const ids = Object.keys(agencies);
  return ids.length > 0 ? ids[0]! : '2fly';
}

function agentAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token || token !== AGENT_TOKEN) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

router.use(agentAuth);

// ─── GET /api/agent/debug — shows resolved agencyId and agencies list
router.get('/debug', async (req: Request, res: Response) => {
  const agencies = await getAgencies();
  res.json({
    resolvedAgencyId: await resolveAgencyId(),
    availableAgencyIds: Object.keys(agencies),
    agentApiSecret: process.env.AGENT_API_SECRET ? '[set]' : '[using default]',
    agentAgencyIdEnv: process.env.AGENT_AGENCY_ID || '[not set — using first agency]',
  });
});

// ─── GET /api/agent/dashboard ─────────────────────────────────────────────────
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const agencyId = await resolveAgencyId();
    const clients = await getClientsByAgency(agencyId);
    const tasks = await getProductionTasksByAgency(agencyId);
    const posts = await getScheduledPostsByAgency(agencyId);

    // Count pending approvals using optimized SQL (avoids loading 33MB+ JSONB blobs)
    const pendingApprovals = await countPendingApprovals(agencyId);

    const pendingTasks = tasks.filter((t) => t.status !== 'ready_to_post' && t.status !== 'approved');

    res.json({
      success: true,
      summary: {
        clientsCount: clients.length,
        pendingApprovals,
        pendingTasks: pendingTasks.length,
        scheduledPosts: posts.filter((p) => p.status === 'scheduled').length,
        totalTasks: tasks.length,
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to load dashboard' });
  }
});

// ─── GET /api/agent/clients ───────────────────────────────────────────────────
router.get('/clients', async (req: Request, res: Response) => {
  try {
    const clients = await getClientsByAgency(await resolveAgencyId());
    res.json({
      success: true,
      clients: clients.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        flowClientId: c.id, // same as id in this system
        category: c.category,
        primaryContactName: c.primaryContactName,
        platformsManaged: c.platformsManaged,
      })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to list clients' });
  }
});

// ─── GET /api/agent/users ─────────────────────────────────────────────────────
router.get('/users', async (req: Request, res: Response) => {
  try {
    const users = await getUsersByAgency(await resolveAgencyId());
    res.json({
      success: true,
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        status: u.status,
      })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to list users' });
  }
});

// ─── GET /api/agent/production-tasks ─────────────────────────────────────────
router.get('/production-tasks', async (req: Request, res: Response) => {
  try {
    const tasks = await getProductionTasksByAgency(await resolveAgencyId());
    res.json({ success: true, tasks });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to list production tasks' });
  }
});

// ─── GET /api/agent/production-queue ─────────────────────────────────────────
router.get('/production-queue', async (req: Request, res: Response) => {
  try {
    const tasks = await getProductionTasksByAgency(await resolveAgencyId());
    const queue = tasks.filter(
      (t) => t.status === 'assigned' || t.status === 'in_progress' || t.status === 'review' || t.status === 'changes_requested'
    );
    res.json({ success: true, tasks: queue });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to load production queue' });
  }
});

// ─── GET /api/agent/production-tasks/:taskId ─────────────────────────────────
router.get('/production-tasks/:taskId', async (req: Request, res: Response) => {
  try {
    const task = await getProductionTaskById(req.params.taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ success: true, task });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to get task' });
  }
});

// ─── GET /api/agent/posts/scheduled ──────────────────────────────────────────
router.get('/posts/scheduled', async (req: Request, res: Response) => {
  try {
    const posts = await getScheduledPostsByAgency(await resolveAgencyId());
    const scheduled = posts.filter((p) => p.status === 'scheduled');
    res.json({ success: true, posts: scheduled });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to list scheduled posts' });
  }
});

// ─── GET /api/agent/posts/:postId ─────────────────────────────────────────────
router.get('/posts/:postId', async (req: Request, res: Response) => {
  try {
    const post = await getScheduledPostById(req.params.postId);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.json({ success: true, post });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to get post' });
  }
});

// ─── GET /api/agent/clients/:clientId/requests ───────────────────────────────
router.get('/clients/:clientId/requests', async (req: Request, res: Response) => {
  try {
    const { clientId } = req.params;
    const client = await getClient(clientId);
    if (!client || client.agencyId !== await resolveAgencyId()) {
      return res.status(404).json({ error: 'Client not found' });
    }
    const state = await getPortalState(await resolveAgencyId(), clientId);
    const stripped = state ? stripBase64FromPortalState(state) : null;
    const requests = stripped?.requests || [];
    res.json({ success: true, clientId, requests });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to get client requests' });
  }
});

// ─── POST /api/agent/production-tasks ────────────────────────────────────────
router.post('/production-tasks', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const { clientId, title, description, priority, assignedTo, dueDate, contentType, platform } = body;

    if (!clientId || !title) {
      return res.status(400).json({ error: 'clientId and title are required' });
    }

    const client = await getClient(clientId);
    if (!client || client.agencyId !== await resolveAgencyId()) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const now = new Date().toISOString();
    const task: ProductionTask = {
      id: generateId(),
      agencyId: await resolveAgencyId(),
      clientId,
      contentId: '',
      approvalId: '',
      designerId: assignedTo || '',
      title,
      caption: description || '',
      copyText: '',
      referenceImages: [],
      briefNotes: description || '',
      finalArt: [],
      designerNotes: '',
      status: 'assigned' as ProductionTaskStatus,
      priority: priority || 'medium',
      deadline: dueDate || '',
      reviewNotes: '',
      comments: [],
      createdAt: now,
      updatedAt: now,
      startedAt: '',
      submittedAt: '',
      approvedAt: '',
    };

    await saveProductionTask(task);
    res.json({ success: true, task });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to create production task' });
  }
});

// ─── PATCH /api/agent/production-tasks/:id/status ────────────────────────────
router.patch('/production-tasks/:id/status', async (req: Request, res: Response) => {
  try {
    const task = await getProductionTaskById(req.params.id);
    if (!task || task.agencyId !== await resolveAgencyId()) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const { status, note } = req.body || {};
    if (!status) return res.status(400).json({ error: 'status is required' });

    const updated: ProductionTask = {
      ...task,
      status: status as ProductionTaskStatus,
      updatedAt: new Date().toISOString(),
      ...(note && {
        comments: [
          ...(task.comments || []),
          {
            id: generateId(),
            authorId: 'agent',
            authorName: 'Agent',
            authorRole: 'admin' as const,
            message: note,
            statusChange: null,
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    };

    await saveProductionTask(updated);
    res.json({ success: true, task: updated });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to update task status' });
  }
});

// ─── POST /api/agent/push-task ────────────────────────────────────────────────
// Alias for creating a production task (same as POST /production-tasks)
router.post('/push-task', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const { clientId, title, description, priority, assignedTo, dueDate, contentType, platform } = body;

    if (!clientId || !title) {
      return res.status(400).json({ error: 'clientId and title are required' });
    }

    const client = await getClient(clientId);
    if (!client || client.agencyId !== await resolveAgencyId()) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const now = new Date().toISOString();
    const task: ProductionTask = {
      id: generateId(),
      agencyId: await resolveAgencyId(),
      clientId,
      contentId: '',
      approvalId: '',
      designerId: assignedTo || '',
      title,
      caption: description || '',
      copyText: '',
      referenceImages: [],
      briefNotes: description || '',
      finalArt: [],
      designerNotes: '',
      status: 'assigned' as ProductionTaskStatus,
      priority: priority || 'medium',
      deadline: dueDate || '',
      reviewNotes: '',
      comments: [],
      createdAt: now,
      updatedAt: now,
      startedAt: '',
      submittedAt: '',
      approvedAt: '',
    };

    await saveProductionTask(task);
    res.json({ success: true, task });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to push task' });
  }
});

// ─── POST /api/agent/push-content ────────────────────────────────────────────
// Push a content item (approval/request) to a client's portal state
router.post('/push-content', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const { clientId, type, title, description, imageUrl, platform, scheduledFor } = body;

    if (!clientId || !title) {
      return res.status(400).json({ error: 'clientId and title are required' });
    }

    const client = await getClient(clientId);
    if (!client || client.agencyId !== await resolveAgencyId()) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const state: PortalStateData = await getPortalState(await resolveAgencyId(), clientId) || {
      client: { id: clientId, name: client.name },
      kpis: { scheduled: 0, waitingApproval: 0, missingAssets: 0, frustration: 0 },
      approvals: [],
      needs: [],
      requests: [],
      assets: [],
      activity: [],
      seen: false,
    };

    const contentItem = {
      id: generateId(),
      type: type || 'approval',
      title,
      description: description || '',
      imageUrl: imageUrl || null,
      platform: platform || null,
      scheduledFor: scheduledFor || null,
      status: 'pending',
      createdAt: Date.now(),
    };

    const approvals = [...((state.approvals || []) as any[]), contentItem];
    const updated = { ...state, approvals };
    await savePortalState(await resolveAgencyId(), clientId, updated);

    res.json({ success: true, content: contentItem });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to push content' });
  }
});

// ─── POST /api/agent/posts/schedule ──────────────────────────────────────────
router.post('/posts/schedule', (req: Request, res: Response) => {
  // Delegate to internal logic — just return instructions since scheduling
  // requires Meta integration credentials per client
  res.status(501).json({
    error: 'Use POST /api/posts/schedule with full auth for scheduling. Agent scheduling not yet supported.',
  });
});

// ─── GET /api/agent/ping ─────────────────────────────────────────────────────
router.get('/ping', (_req: Request, res: Response) => {
  res.json({ pong: true, version: 'v4-static-import', ts: Date.now() });
});

// ─── POST /api/agent/test-post ──────────────────────────────────────────────
// Diagnostic: inspect JSONB structure to find where base64 data lives.
router.post('/test-post', async (req: Request, res: Response) => {
  try {
    const agencyId = await resolveAgencyId();
    const targetClientId = (req.body?.clientId || 'stpetersburg').toString().trim();

    // Find which approvals are large and what fields in them are big
    const approvalSizes = await prisma.$queryRaw<any[]>`
      SELECT
        idx::int,
        length(elem::text)::int as elem_size,
        (SELECT json_agg(json_build_object('key', kv.key, 'len', length(kv.value::text)::int, 'type', jsonb_typeof(kv.value)))
         FROM jsonb_each(elem) kv
         WHERE length(kv.value::text) > 500
        ) as big_fields
      FROM "PortalState",
        jsonb_array_elements(data->'approvals') WITH ORDINALITY AS arr(elem, idx)
      WHERE "agencyId" = ${agencyId} AND "clientId" = ${targetClientId}
        AND length(elem::text) > 10000
      ORDER BY length(elem::text) DESC
      LIMIT 10
    `;

    res.json({ success: true, clientId: targetClientId, bloatedApprovals: approvalSizes });
  } catch (e: any) {
    res.status(500).json({ error: e.message, stack: e.stack?.substring(0, 500) });
  }
});

// ─── POST /api/agent/cleanup-sql ────────────────────────────────────────────
// Memory-safe cleanup: uses jsonb_set to clear images arrays one approval at a
// time. Never materializes the full 34MB text blob — each UPDATE modifies only
// one small JSONB path. Safe even on Render's 2GB Node.js and free Postgres.
router.post('/cleanup-sql', async (req: Request, res: Response) => {
  console.log('[cleanup-sql] Handler entered, body:', JSON.stringify(req.body));
  try {
    // prisma is statically imported at top of file
    console.log('[cleanup-sql] prisma imported');
    const agencyId = await resolveAgencyId();
    console.log('[cleanup-sql] agencyId:', agencyId);
    const targetClientId = (req.body?.clientId || '').toString().trim();
    if (!targetClientId) {
      return res.status(400).json({ error: 'clientId is required' });
    }

    // Get size before
    const beforeRows = await prisma.$queryRaw<any[]>`
      SELECT length(data::text) as size_bytes
      FROM "PortalState"
      WHERE "agencyId" = ${agencyId} AND "clientId" = ${targetClientId}
    `;
    const beforeBytes = Number(beforeRows[0]?.size_bytes || 0);

    // Count approvals
    const approvalCountRows = await prisma.$queryRaw<any[]>`
      SELECT COALESCE(jsonb_array_length(data->'approvals'), 0) as cnt
      FROM "PortalState"
      WHERE "agencyId" = ${agencyId} AND "clientId" = ${targetClientId}
    `;
    const approvalCount = Number(approvalCountRows[0]?.cnt || 0);

    // Clear uploadedImages (the actual field with base64 data) for each approval
    let cleared = 0;
    const fieldsToClean = ['uploadedImages', 'images', 'finalArt'];
    for (let i = 0; i < approvalCount; i++) {
      for (const field of fieldsToClean) {
        const path = `{approvals,${i},${field}}`;
        await prisma.$executeRawUnsafe(
          `UPDATE "PortalState"
           SET data = jsonb_set(data, $1::text[], '[]'::jsonb),
               "updatedAt" = NOW()
           WHERE "agencyId" = $2 AND "clientId" = $3
             AND data #> $1::text[] IS NOT NULL
             AND length((data #> $1::text[])::text) > 500`,
          path, agencyId, targetClientId
        );
      }
      // Also clear base64 imageUrl/previewImageUrl string fields
      for (const field of ['imageUrl', 'previewImageUrl']) {
        const path = `{approvals,${i},${field}}`;
        await prisma.$executeRawUnsafe(
          `UPDATE "PortalState"
           SET data = jsonb_set(data, $1::text[], '""'::jsonb),
               "updatedAt" = NOW()
           WHERE "agencyId" = $2 AND "clientId" = $3
             AND length(data #>> $1::text[]) > 500`,
          path, agencyId, targetClientId
        );
      }
      cleared++;
    }

    // Count and clear requests uploadedImages/images
    const reqCountRows = await prisma.$queryRaw<any[]>`
      SELECT COALESCE(jsonb_array_length(data->'requests'), 0) as cnt
      FROM "PortalState"
      WHERE "agencyId" = ${agencyId} AND "clientId" = ${targetClientId}
    `;
    const reqCount = Number(reqCountRows[0]?.cnt || 0);

    for (let i = 0; i < reqCount; i++) {
      for (const field of ['uploadedImages', 'images']) {
        const path = `{requests,${i},${field}}`;
        await prisma.$executeRawUnsafe(
          `UPDATE "PortalState"
           SET data = jsonb_set(data, $1::text[], '[]'::jsonb),
               "updatedAt" = NOW()
           WHERE "agencyId" = $2 AND "clientId" = $3
             AND data #> $1::text[] IS NOT NULL
             AND length((data #> $1::text[])::text) > 500`,
          path, agencyId, targetClientId
        );
      }
    }

    // Get size after
    const afterRows = await prisma.$queryRaw<any[]>`
      SELECT length(data::text) as size_bytes
      FROM "PortalState"
      WHERE "agencyId" = ${agencyId} AND "clientId" = ${targetClientId}
    `;
    const afterBytes = Number(afterRows[0]?.size_bytes || 0);

    console.log(`[cleanup-sql] ${targetClientId}: ${Math.round(beforeBytes/1024)}KB → ${Math.round(afterBytes/1024)}KB (cleared ${cleared} approvals, ${reqCount} requests)`);

    res.json({
      success: true,
      clientId: targetClientId,
      beforeKB: Math.round(beforeBytes / 1024),
      afterKB: Math.round(afterBytes / 1024),
      savedKB: Math.round((beforeBytes - afterBytes) / 1024),
      approvalsCleared: approvalCount,
      requestsCleared: reqCount,
    });
  } catch (e: any) {
    console.error('[cleanup-sql] Error:', e);
    res.status(500).json({ error: e.message || 'SQL cleanup failed' });
  }
});

export default router;
