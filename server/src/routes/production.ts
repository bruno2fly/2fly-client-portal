/**
 * Production tasks (designer workflow).
 * Agency staff: full CRUD, review, assign. Designers: own tasks only, start/submit/upload.
 */

import { Router } from 'express';
import { authenticate, getAgencyScope, requireProductionAccess, requireAgencyOnly } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import {
  getProductionTasksByAgency,
  getProductionTaskById,
  getProductionTasksByDesigner,
  saveProductionTask,
  deleteProductionTask,
  getClient,
  getUser,
  getPortalState,
  savePortalState,
} from '../db.js';
import { generateId } from '../utils/auth.js';
import type { ProductionTask, ProductionTaskStatus, ProductionTaskPriority, ProductionTaskComment, ProductionTaskCommentAuthorRole } from '../types.js';
import { sendPushToUser, sendPushToRole, NOTIFY } from '../lib/pushService.js';

const router = Router();

const STATUS_ORDER: ProductionTaskStatus[] = [
  'assigned',
  'in_progress',
  'review',
  'changes_requested',
  'approved',
  'ready_to_post',
];

function canTransition(from: ProductionTaskStatus, to: ProductionTaskStatus, isDesigner: boolean): boolean {
  if (from === to) return true;
  const allowed: Record<ProductionTaskStatus, ProductionTaskStatus[]> = {
    assigned: ['in_progress'],
    in_progress: ['review'],
    review: ['approved', 'changes_requested'],
    changes_requested: ['review'],
    approved: ['ready_to_post'],
    ready_to_post: [],
  };
  const list = allowed[from] || [];
  if (!list.includes(to)) return false;
  if (to === 'in_progress' || to === 'review') return isDesigner;
  if (to === 'approved' || to === 'changes_requested' || to === 'ready_to_post') return !isDesigner;
  return true;
}

/** Update the original content/approval item with final art URLs when manager approves in production. */
function updateOriginalApprovalWithFinalArt(task: ProductionTask): void {
  const hasArt = task.finalArt && task.finalArt.length > 0;
  if (!hasArt) {
    console.warn('[production] Approve skipped: task has no finalArt');
    return;
  }
  const state = getPortalState(task.agencyId, task.clientId);
  if (!state || !Array.isArray(state.approvals)) {
    console.warn('[production] No portal state or approvals for client:', task.clientId);
    return;
  }
  const originalItem = state.approvals.find(
    (a: any) => a.id === task.approvalId || a.id === task.contentId
  ) as any;
  if (!originalItem) {
    console.warn('[production] Original approval not found for approvalId/contentId:', task.approvalId || task.contentId);
    return;
  }
  originalItem.finalArtUrls = task.finalArt || [];
  originalItem.imageUrls = task.finalArt || [];
  originalItem.imageUrl = (task.finalArt && task.finalArt[0]) || originalItem.imageUrl || '';
  originalItem.productionStatus = 'art_approved';
  originalItem.productionTaskId = task.id;
  originalItem.updatedAt = new Date().toISOString();
  savePortalState(task.agencyId, task.clientId, state);
  console.log('[production] Updated original item with final art:', originalItem.id);
}

/** When designer resubmits after changes, push the approval back to content_pending for the client. */
function returnApprovalToPending(task: ProductionTask): void {
  const state = getPortalState(task.agencyId, task.clientId);
  if (!state || !Array.isArray(state.approvals)) return;
  const item = state.approvals.find(
    (a: any) => a.id === task.approvalId || a.id === task.contentId
  ) as any;
  if (!item) return;
  // Only return to pending if it was in a changes state
  if (item.status === 'changes' || item.status === 'copy_changes') {
    // Restore to pending (content pending or copy pending based on previous state)
    item.status = item.status === 'copy_changes' ? 'copy_pending' : 'pending';
    item.returnedFromChanges = true;
    item.returnedAt = new Date().toISOString();
    // Update images with new final art if available
    if (task.finalArt && task.finalArt.length > 0) {
      item.finalArtUrls = task.finalArt;
      item.imageUrls = task.finalArt;
      item.imageUrl = task.finalArt[0] || item.imageUrl || '';
    }
    item.updatedAt = new Date().toISOString();
    savePortalState(task.agencyId, task.clientId, state);
    console.log('[production] Returned approval to pending:', item.id, item.status);
  }
}

/** GET /api/production/tasks — List tasks. Agency: all; Designer: own only. */
router.get('/tasks', authenticate, requireProductionAccess, (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const user = (req as any).user;
    const isDesigner = user.role === 'DESIGNER';
    const { designerId, clientId, status, approvalId } = req.query;

    let tasks = isDesigner
      ? getProductionTasksByDesigner(user.id)
      : getProductionTasksByAgency(agencyId);

    if (designerId && typeof designerId === 'string') {
      tasks = tasks.filter((t: ProductionTask) => t.designerId === designerId);
    }
    if (clientId && typeof clientId === 'string') {
      tasks = tasks.filter((t: ProductionTask) => t.clientId === clientId);
    }
    if (status && typeof status === 'string') {
      tasks = tasks.filter((t: ProductionTask) => t.status === status);
    }
    if (approvalId && typeof approvalId === 'string') {
      tasks = tasks.filter((t: ProductionTask) => t.approvalId === approvalId);
    }

    const result: any = { success: true, tasks };
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to list tasks' });
  }
});

/** GET /api/production/tasks/:id — Get single task. */
router.get('/tasks/:id', authenticate, requireProductionAccess, (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const user = (req as any).user;
    const task = getProductionTaskById(req.params.id);
    if (!task || task.agencyId !== agencyId) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (user.role === 'DESIGNER' && task.designerId !== user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const result: any = { success: true, task };
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to get task' });
  }
});

/** POST /api/production/tasks — Create task (agency only). */
router.post('/tasks', authenticate, requireAgencyOnly, (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const body = req.body || {};
    const {
      clientId,
      contentId,
      approvalId,
      designerId,
      title,
      caption,
      copyText,
      referenceImages,
      briefNotes,
      priority,
      deadline,
      initialStatus,
      reviewNotes: bodyReviewNotes,
    } = body;

    if (!clientId || !designerId) {
      return res.status(400).json({ error: 'clientId and designerId are required' });
    }
    const client = getClient(clientId);
    if (!client || client.agencyId !== agencyId) {
      return res.status(404).json({ error: 'Client not found' });
    }
    const designer = getUser(designerId);
    if (!designer || designer.agencyId !== agencyId || designer.role !== 'DESIGNER') {
      return res.status(400).json({ error: 'Invalid designer' });
    }

    const now = new Date().toISOString();
    const task: ProductionTask = {
      id: generateId('task'),
      agencyId,
      clientId,
      contentId: contentId || '',
      approvalId: approvalId || '',
      designerId,
      title: String(title || '').slice(0, 500),
      caption: String(caption || '').slice(0, 5000),
      copyText: String(copyText || '').slice(0, 5000),
      referenceImages: Array.isArray(referenceImages) ? referenceImages : [],
      briefNotes: String(briefNotes || '').slice(0, 2000),
      finalArt: [],
      designerNotes: '',
      status: (initialStatus === 'changes_requested' ? 'changes_requested' : 'assigned') as ProductionTaskStatus,
      priority: (priority && ['low', 'medium', 'high', 'urgent'].includes(priority)) ? priority : 'medium',
      deadline: deadline || now,
      reviewNotes: initialStatus === 'changes_requested' ? String(bodyReviewNotes || '').slice(0, 2000) : '',
      comments: [],
      createdAt: now,
      updatedAt: now,
      startedAt: '',
      submittedAt: '',
      approvedAt: '',
    };
    saveProductionTask(task);
    // Fire-and-forget push notification for task assignment
    sendPushToUser(task.designerId, NOTIFY.taskAssigned(
      client?.name || 'Client',
      task.title || task.caption || 'New task',
      task.deadline || 'TBD'
    )).catch(() => {});
    const result: any = { success: true, task };
    res.status(201).json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to create task' });
  }
});

/** PUT /api/production/tasks/:id/status — Update status (with transition rules). */
router.put('/tasks/:id/status', authenticate, requireProductionAccess, (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const user = (req as any).user;
    const task = getProductionTaskById(req.params.id);
    if (!task || task.agencyId !== agencyId) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (user.role === 'DESIGNER' && task.designerId !== user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const { status } = req.body || {};
    if (!status || !STATUS_ORDER.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const isDesigner = user.role === 'DESIGNER';
    if (!canTransition(task.status, status, isDesigner)) {
      return res.status(400).json({ error: 'Status transition not allowed' });
    }
    const now = new Date().toISOString();
    const previousStatus = task.status;
    task.status = status;
    task.updatedAt = now;
    if (status === 'in_progress' && !task.startedAt) task.startedAt = now;
    if (status === 'review') task.submittedAt = now;
    if (status === 'approved') task.approvedAt = now;
    saveProductionTask(task);
    // When designer submits for review, sync images to approval item preview
    if (status === 'review' && task.finalArt && task.finalArt.length > 0) {
      try {
        const state = getPortalState(task.agencyId, task.clientId);
        if (state && Array.isArray(state.approvals)) {
          const item = state.approvals.find(
            (a: any) => a.id === task.approvalId || a.id === task.contentId
          ) as any;
          if (item) {
            item.finalArtUrls = task.finalArt;
            item.imageUrls = task.finalArt;
            item.imageUrl = task.finalArt[0] || item.imageUrl || '';
            item.updatedAt = new Date().toISOString();
            savePortalState(task.agencyId, task.clientId, state);
          }
        }
      } catch (e: any) {
        console.error('[production] Failed to sync images on review submit:', e?.message);
      }
    }
    // When designer resubmits after changes, push approval back to content pending for client
    if (previousStatus === 'changes_requested' && status === 'review') {
      try { returnApprovalToPending(task); } catch (e: any) {
        console.error('[production] Failed to return approval to pending:', e?.message);
      }
    }
    const result: any = { success: true, task };
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to update status' });
  }
});

/** PUT /api/production/tasks/:id — Update task details (agency only). */
router.put('/tasks/:id', authenticate, requireAgencyOnly, (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const task = getProductionTaskById(req.params.id);
    if (!task || task.agencyId !== agencyId) {
      return res.status(404).json({ error: 'Task not found' });
    }
    const body = req.body || {};
    if (body.priority != null && ['low', 'medium', 'high', 'urgent'].includes(body.priority)) {
      task.priority = body.priority;
    }
    if (body.deadline != null) task.deadline = body.deadline;
    if (body.briefNotes != null) task.briefNotes = String(body.briefNotes).slice(0, 2000);
    if (body.designerId != null) {
      const designer = getUser(body.designerId);
      if (designer && designer.agencyId === agencyId && designer.role === 'DESIGNER') {
        task.designerId = body.designerId;
      }
    }
    task.updatedAt = new Date().toISOString();
    saveProductionTask(task);
    const result: any = { success: true, task };
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to update task' });
  }
});

/** POST /api/production/tasks/:id/upload-art — Designer uploads final art (URLs from client). */
router.post('/tasks/:id/upload-art', authenticate, requireProductionAccess, (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const user = (req as any).user;
    const task = getProductionTaskById(req.params.id);
    if (!task || task.agencyId !== agencyId) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (task.designerId !== user.id) {
      return res.status(403).json({ error: 'Only the assigned designer can upload art' });
    }
    const { urls, designerNotes } = req.body || {};
    const newUrls = Array.isArray(urls) ? urls.filter((u: any) => typeof u === 'string' && u.startsWith('http')) : [];
    task.finalArt = newUrls;
    if (designerNotes != null) task.designerNotes = String(designerNotes).slice(0, 2000);
    task.updatedAt = new Date().toISOString();
    saveProductionTask(task);
    const result: any = { success: true, task };
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to upload art' });
  }
});

/** POST /api/production/tasks/:id/comment — Add comment and optionally update status. */
router.post('/tasks/:id/comment', authenticate, requireProductionAccess, (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const user = (req as any).user;
    const task = getProductionTaskById(req.params.id);
    if (!task || task.agencyId !== agencyId) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (user.role === 'DESIGNER' && task.designerId !== user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const { message, statusChange } = req.body || {};
    const msg = typeof message === 'string' ? message.trim() : '';
    if (!msg && !statusChange) {
      return res.status(400).json({ error: 'message or statusChange required' });
    }
    const now = new Date().toISOString();
    if (!task.comments) task.comments = [];
    const authorRole: ProductionTaskCommentAuthorRole =
      user.role === 'DESIGNER' ? 'designer' : (user.role === 'OWNER' || user.role === 'ADMIN' ? 'admin' : 'staff');
    const comment: ProductionTaskComment = {
      id: 'comment_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9),
      authorId: user.id,
      authorName: user.name || user.email || 'User',
      authorRole,
      message: msg || (statusChange ? 'Status updated' : ''),
      statusChange: statusChange && typeof statusChange === 'string' ? statusChange : null,
      createdAt: now,
    };
    if (statusChange && STATUS_ORDER.includes(statusChange as ProductionTaskStatus)) {
      const isDesigner = user.role === 'DESIGNER';
      if (!canTransition(task.status, statusChange as ProductionTaskStatus, isDesigner)) {
        return res.status(400).json({ error: 'Status transition not allowed' });
      }
      task.status = statusChange as ProductionTaskStatus;
      if (statusChange === 'in_progress' && !task.startedAt) task.startedAt = now;
      if (statusChange === 'review') {
        task.submittedAt = now;
        // Fire-and-forget push notification to agency staff when designer submits
        sendPushToRole(task.agencyId, ['OWNER', 'ADMIN', 'STAFF'], NOTIFY.designerSubmitted(
          user.name || user.email || 'Designer',
          task.title || task.caption || 'Task',
          getClient(task.clientId)?.name || 'Client'
        )).catch(() => {});
      }
      if (statusChange === 'approved') {
        task.approvedAt = now;
        task.reviewNotes = '';
        if (user.role !== 'DESIGNER') {
          try {
            updateOriginalApprovalWithFinalArt(task);
          } catch (autoErr: any) {
            console.error('[production] Failed to update original item with art:', autoErr?.message);
          }
        }
      }
      if (statusChange === 'changes_requested') task.reviewNotes = msg ? String(msg).slice(0, 2000) : task.reviewNotes;
    }
    task.comments.push(comment);
    task.updatedAt = now;
    saveProductionTask(task);
    const result: any = { success: true, task };
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to add comment' });
  }
});

/** POST /api/production/tasks/:id/review — Manager approve or request changes. */
router.post('/tasks/:id/review', authenticate, requireAgencyOnly, (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const task = getProductionTaskById(req.params.id);
    if (!task || task.agencyId !== agencyId) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (task.status !== 'review') {
      return res.status(400).json({ error: 'Task must be in review status' });
    }
    const { action, reviewNotes } = req.body || {};
    const now = new Date().toISOString();
    if (action === 'approve') {
      task.status = 'approved';
      task.approvedAt = now;
      task.reviewNotes = '';
      try {
        updateOriginalApprovalWithFinalArt(task);
      } catch (autoErr: any) {
        console.error('[production] Failed to update original item with art:', autoErr?.message);
      }
      // Fire-and-forget push notification for approval
      sendPushToUser(task.designerId, NOTIFY.designApproved(
        task.title || 'Task',
        getClient(task.clientId)?.name || 'Client'
      )).catch(() => {});
    } else if (action === 'request_changes') {
      task.status = 'changes_requested';
      task.reviewNotes = String(reviewNotes || '').slice(0, 2000);
      // Fire-and-forget push notification for revision request
      sendPushToUser(task.designerId, NOTIFY.designRevision(
        task.title || 'Task',
        getClient(task.clientId)?.name || 'Client'
      )).catch(() => {});
    } else {
      return res.status(400).json({ error: 'action must be approve or request_changes' });
    }
    task.updatedAt = now;
    saveProductionTask(task);
    const result: any = { success: true, task };
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to review' });
  }
});

/** DELETE /api/production/tasks/:id — Delete task (agency only). */
router.delete('/tasks/:id', authenticate, requireAgencyOnly, (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const task = getProductionTaskById(req.params.id);
    if (!task || task.agencyId !== agencyId) {
      return res.status(404).json({ error: 'Task not found' });
    }
    deleteProductionTask(req.params.id);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to delete task' });
  }
});

export default router;
