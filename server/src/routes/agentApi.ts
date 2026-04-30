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

// ─── POST /api/agent/cleanup-base64 ─────────────────────────────────────────
// One-time cleanup: strip base64 images from portal state JSONB in the DB.
// This permanently reduces bloated rows (e.g. 33MB St. Petersburg → ~500KB).
// Images are replaced with "[image-removed-cleanup]" text.
router.post('/cleanup-base64', async (req: Request, res: Response) => {
  try {
    const agencyId = await resolveAgencyId();
    const targetClientId = (req.body?.clientId || '').toString().trim() || null;
    const clients = await getClientsByAgency(agencyId);
    const results: any[] = [];

    for (const client of clients) {
      if (targetClientId && client.id !== targetClientId) continue;

      const state = await getPortalState(agencyId, client.id);
      if (!state) {
        results.push({ clientId: client.id, status: 'no-state' });
        continue;
      }

      const beforeSize = JSON.stringify(state).length;
      let changed = false;

      // Strip base64 from approvals
      if (Array.isArray(state.approvals)) {
        for (const item of state.approvals as any[]) {
          if (!item || typeof item !== 'object') continue;
          changed = cleanBase64Fields(item) || changed;
        }
      }

      // Strip base64 from requests
      if (Array.isArray(state.requests)) {
        for (const item of state.requests as any[]) {
          if (!item || typeof item !== 'object') continue;
          changed = cleanBase64Fields(item) || changed;
        }
      }

      // Strip base64 from assets
      if (Array.isArray(state.assets)) {
        for (const item of state.assets as any[]) {
          if (!item || typeof item !== 'object') continue;
          changed = cleanBase64Fields(item) || changed;
        }
      }

      const afterSize = JSON.stringify(state).length;

      if (changed) {
        await savePortalState(agencyId, client.id, state);
        results.push({
          clientId: client.id,
          status: 'cleaned',
          beforeKB: Math.round(beforeSize / 1024),
          afterKB: Math.round(afterSize / 1024),
          savedKB: Math.round((beforeSize - afterSize) / 1024),
        });
      } else {
        results.push({
          clientId: client.id,
          status: 'already-clean',
          sizeKB: Math.round(beforeSize / 1024),
        });
      }
    }

    res.json({ success: true, results });
  } catch (e: any) {
    console.error('[cleanup-base64] Error:', e);
    res.status(500).json({ error: e.message || 'Cleanup failed' });
  }
});

/** Recursively strip base64 strings from an object. Returns true if anything was changed. */
function cleanBase64Fields(obj: any): boolean {
  if (!obj || typeof obj !== 'object') return false;
  let changed = false;
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === 'string') {
      if (val.length > 500 && /^data:[^;]+;base64,/.test(val)) {
        obj[key] = '[image-removed-cleanup]';
        changed = true;
      } else if (typeof val === 'string' && val.length > 500 && /^[A-Za-z0-9+/]{500}/.test(val)) {
        obj[key] = '[image-removed-cleanup]';
        changed = true;
      }
    } else if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        if (typeof val[i] === 'string' && val[i].length > 500 && /^data:[^;]+;base64,/.test(val[i])) {
          val[i] = '[image-removed-cleanup]';
          changed = true;
        } else if (typeof val[i] === 'object' && val[i] !== null) {
          changed = cleanBase64Fields(val[i]) || changed;
        }
      }
    } else if (typeof val === 'object' && val !== null) {
      changed = cleanBase64Fields(val) || changed;
    }
  }
  return changed;
}

export default router;
