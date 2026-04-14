/**
 * Agent API — /api/agent
 * Secure internal endpoints for AI agents (Scribe, Boss, etc.)
 * Auth: Bearer token via Authorization header
 */

import { Router, Request, Response, NextFunction } from 'express';
import {
  getClientsByAgency,
  getClient,
  getUsersByAgency,
  getScheduledPostsByAgency,
  getScheduledPostById,
  getPortalState,
  savePortalState,
  getProductionTasksByAgency,
  getProductionTaskById,
  saveProductionTask,
} from '../db.js';
import { generateId } from '../utils/auth.js';
import type { ProductionTask, ProductionTaskStatus, PortalStateData } from '../types.js';

const router = Router();

// ─── Auth middleware ─────────────────────────────────────────────────────────
const AGENT_TOKEN = process.env.AGENT_API_SECRET || '2fly-agent-secret-scribe-2026';
const AGENT_AGENCY_ID = process.env.AGENT_AGENCY_ID || '2fly';

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

// ─── GET /api/agent/dashboard ─────────────────────────────────────────────────
router.get('/dashboard', (req: Request, res: Response) => {
  try {
    const agencyId = AGENT_AGENCY_ID;
    const clients = getClientsByAgency(agencyId);
    const tasks = getProductionTasksByAgency(agencyId);
    const posts = getScheduledPostsByAgency(agencyId);

    // Count pending approvals across all portal states
    let pendingApprovals = 0;
    for (const client of clients) {
      const state = getPortalState(agencyId, client.id);
      if (state) {
        const approvals = (state.approvals || []) as any[];
        pendingApprovals += approvals.filter((a: any) => a.status === 'pending').length;
      }
    }

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
router.get('/clients', (req: Request, res: Response) => {
  try {
    const clients = getClientsByAgency(AGENT_AGENCY_ID);
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
router.get('/users', (req: Request, res: Response) => {
  try {
    const users = getUsersByAgency(AGENT_AGENCY_ID);
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
router.get('/production-tasks', (req: Request, res: Response) => {
  try {
    const tasks = getProductionTasksByAgency(AGENT_AGENCY_ID);
    res.json({ success: true, tasks });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to list production tasks' });
  }
});

// ─── GET /api/agent/production-queue ─────────────────────────────────────────
router.get('/production-queue', (req: Request, res: Response) => {
  try {
    const tasks = getProductionTasksByAgency(AGENT_AGENCY_ID);
    const queue = tasks.filter(
      (t) => t.status === 'assigned' || t.status === 'in_progress' || t.status === 'review' || t.status === 'changes_requested'
    );
    res.json({ success: true, tasks: queue });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to load production queue' });
  }
});

// ─── GET /api/agent/production-tasks/:taskId ─────────────────────────────────
router.get('/production-tasks/:taskId', (req: Request, res: Response) => {
  try {
    const task = getProductionTaskById(req.params.taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ success: true, task });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to get task' });
  }
});

// ─── GET /api/agent/posts/scheduled ──────────────────────────────────────────
router.get('/posts/scheduled', (req: Request, res: Response) => {
  try {
    const posts = getScheduledPostsByAgency(AGENT_AGENCY_ID);
    const scheduled = posts.filter((p) => p.status === 'scheduled');
    res.json({ success: true, posts: scheduled });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to list scheduled posts' });
  }
});

// ─── GET /api/agent/posts/:postId ─────────────────────────────────────────────
router.get('/posts/:postId', (req: Request, res: Response) => {
  try {
    const post = getScheduledPostById(req.params.postId);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.json({ success: true, post });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to get post' });
  }
});

// ─── GET /api/agent/clients/:clientId/requests ───────────────────────────────
router.get('/clients/:clientId/requests', (req: Request, res: Response) => {
  try {
    const { clientId } = req.params;
    const client = getClient(clientId);
    if (!client || client.agencyId !== AGENT_AGENCY_ID) {
      return res.status(404).json({ error: 'Client not found' });
    }
    const state = getPortalState(AGENT_AGENCY_ID, clientId);
    const requests = state?.requests || [];
    res.json({ success: true, clientId, requests });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to get client requests' });
  }
});

// ─── POST /api/agent/production-tasks ────────────────────────────────────────
router.post('/production-tasks', (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const { clientId, title, description, priority, assignedTo, dueDate, contentType, platform } = body;

    if (!clientId || !title) {
      return res.status(400).json({ error: 'clientId and title are required' });
    }

    const client = getClient(clientId);
    if (!client || client.agencyId !== AGENT_AGENCY_ID) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const now = new Date().toISOString();
    const task: ProductionTask = {
      id: generateId(),
      agencyId: AGENT_AGENCY_ID,
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

    saveProductionTask(task);
    res.json({ success: true, task });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to create production task' });
  }
});

// ─── PATCH /api/agent/production-tasks/:id/status ────────────────────────────
router.patch('/production-tasks/:id/status', (req: Request, res: Response) => {
  try {
    const task = getProductionTaskById(req.params.id);
    if (!task || task.agencyId !== AGENT_AGENCY_ID) {
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

    saveProductionTask(updated);
    res.json({ success: true, task: updated });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to update task status' });
  }
});

// ─── POST /api/agent/push-task ────────────────────────────────────────────────
// Alias for creating a production task (same as POST /production-tasks)
router.post('/push-task', (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const { clientId, title, description, priority, assignedTo, dueDate, contentType, platform } = body;

    if (!clientId || !title) {
      return res.status(400).json({ error: 'clientId and title are required' });
    }

    const client = getClient(clientId);
    if (!client || client.agencyId !== AGENT_AGENCY_ID) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const now = new Date().toISOString();
    const task: ProductionTask = {
      id: generateId(),
      agencyId: AGENT_AGENCY_ID,
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

    saveProductionTask(task);
    res.json({ success: true, task });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to push task' });
  }
});

// ─── POST /api/agent/push-content ────────────────────────────────────────────
// Push a content item (approval/request) to a client's portal state
router.post('/push-content', (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const { clientId, type, title, description, imageUrl, platform, scheduledFor } = body;

    if (!clientId || !title) {
      return res.status(400).json({ error: 'clientId and title are required' });
    }

    const client = getClient(clientId);
    if (!client || client.agencyId !== AGENT_AGENCY_ID) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const state: PortalStateData = getPortalState(AGENT_AGENCY_ID, clientId) || {
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
    savePortalState(AGENT_AGENCY_ID, clientId, updated);

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

export default router;
