/**
 * Scheduled posts API
 */

import { Router } from 'express';
import { authenticate, getAgencyScope, requireCanViewDashboard } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import {
  getScheduledPostsByAgency,
  getScheduledPostById,
  saveScheduledPost,
  deleteScheduledPost,
  getClient,
} from '../db.js';
import { getMetaIntegrationByClient } from '../db.js';
import {
  publishToFacebook,
  createInstagramMediaContainer,
  publishInstagramContainer,
} from '../lib/meta-api.js';

const router = Router();

function generateId(): string {
  return `post_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * POST /api/posts/schedule
 * Schedule a new post
 */
router.post('/schedule', authenticate, requireCanViewDashboard, (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const { clientId, contentId, caption, mediaUrl, platforms, scheduledAt, timezone } = req.body;

    if (!clientId || !contentId || !caption || !mediaUrl || !platforms || !Array.isArray(platforms) || platforms.length === 0) {
      return res.status(400).json({ error: 'clientId, contentId, caption, mediaUrl, and platforms required' });
    }

    const client = getClient(clientId);
    if (!client || client.agencyId !== agencyId) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const integration = getMetaIntegrationByClient(agencyId, clientId);
    if (!integration || integration.tokenExpiresAt < Date.now()) {
      return res.status(400).json({ error: 'Connect Facebook & Instagram for this client in the Scheduled Posts tab first' });
    }

    const scheduledAtStr = scheduledAt || new Date().toISOString();
    const tz = timezone || 'America/New_York';
    const now = new Date().toISOString();

    const post = {
      id: generateId(),
      agencyId,
      clientId,
      contentId,
      caption: String(caption).slice(0, 2200),
      mediaUrl,
      platforms: platforms.filter((p: string) => p === 'instagram' || p === 'facebook'),
      scheduledAt: scheduledAtStr,
      timezone: tz,
      status: 'scheduled' as const,
      createdAt: now,
      updatedAt: now,
    };

    saveScheduledPost(post);
    res.status(201).json({ success: true, post });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to schedule post' });
  }
});

/**
 * GET /api/posts/scheduled
 * List scheduled posts with filters
 */
router.get('/scheduled', authenticate, requireCanViewDashboard, (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const { clientId, platform, status } = req.query;

    let posts = getScheduledPostsByAgency(agencyId);
    if (clientId && typeof clientId === 'string') {
      posts = posts.filter(p => p.clientId === clientId);
    }
    if (platform && typeof platform === 'string') {
      if (platform === 'instagram') posts = posts.filter(p => p.platforms.includes('instagram'));
      else if (platform === 'facebook') posts = posts.filter(p => p.platforms.includes('facebook'));
    }
    if (status && typeof status === 'string') {
      posts = posts.filter(p => p.status === status);
    }

    posts.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
    res.json({ success: true, posts });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to list posts' });
  }
});

/**
 * PUT /api/posts/:id/reschedule
 * Change scheduled time
 */
router.put('/:id/reschedule', authenticate, requireCanViewDashboard, (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const post = getScheduledPostById(req.params.id);
    if (!post || post.agencyId !== agencyId) {
      return res.status(404).json({ error: 'Post not found' });
    }
    if (post.status !== 'scheduled') {
      return res.status(400).json({ error: 'Can only reschedule posts that are not yet published' });
    }

    const { scheduledAt } = req.body;
    if (!scheduledAt) return res.status(400).json({ error: 'scheduledAt required' });

    post.scheduledAt = scheduledAt;
    post.updatedAt = new Date().toISOString();
    saveScheduledPost(post);
    res.json({ success: true, post });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to reschedule' });
  }
});

/**
 * DELETE /api/posts/:id/cancel
 * Cancel a scheduled post
 */
router.delete('/:id/cancel', authenticate, requireCanViewDashboard, (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const post = getScheduledPostById(req.params.id);
    if (!post || post.agencyId !== agencyId) {
      return res.status(404).json({ error: 'Post not found' });
    }
    if (post.status !== 'scheduled') {
      return res.status(400).json({ error: 'Can only cancel scheduled posts' });
    }

    deleteScheduledPost(post.id);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to cancel' });
  }
});

/**
 * POST /api/posts/:id/publish-now
 * Publish immediately
 */
router.post('/:id/publish-now', authenticate, requireCanViewDashboard, async (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const post = getScheduledPostById(req.params.id);
    if (!post || post.agencyId !== agencyId) {
      return res.status(404).json({ error: 'Post not found' });
    }
    if (post.status !== 'scheduled') {
      return res.status(400).json({ error: 'Post is not in scheduled status' });
    }

    const integration = getMetaIntegrationByClient(agencyId, post.clientId);
    if (!integration || integration.tokenExpiresAt < Date.now()) {
      return res.status(400).json({ error: 'Connect Facebook & Instagram for this client in the Scheduled Posts tab first' });
    }

    post.status = 'publishing';
    post.updatedAt = new Date().toISOString();
    saveScheduledPost(post);

    const metaPostIds: { instagram?: string; facebook?: string } = {};
    let error: string | undefined;

    try {
      if (post.platforms.includes('facebook')) {
        const result = await publishToFacebook(integration.metaPageId, integration.metaAccessToken, {
          message: post.caption,
          url: post.mediaUrl,
        });
        metaPostIds.facebook = result.id;
      }

      if (post.platforms.includes('instagram') && integration.metaInstagramAccountId) {
        const container = await createInstagramMediaContainer(
          integration.metaInstagramAccountId,
          integration.metaAccessToken,
          { image_url: post.mediaUrl, caption: post.caption }
        );
        const publishResult = await publishInstagramContainer(
          integration.metaInstagramAccountId,
          integration.metaAccessToken,
          container.id
        );
        metaPostIds.instagram = publishResult.id;
      }

      post.status = 'published';
      post.publishedAt = new Date().toISOString();
      post.metaPostIds = metaPostIds;
      delete post.error;
    } catch (err: any) {
      error = err.message || 'Publish failed';
      post.status = 'failed';
      post.error = error;
    }

    post.updatedAt = new Date().toISOString();
    saveScheduledPost(post);

    if (error) {
      return res.status(500).json({ error, post });
    }
    res.json({ success: true, post });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to publish' });
  }
});

export default router;
