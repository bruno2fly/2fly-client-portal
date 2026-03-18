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
  publishPhotoToFacebook,
  createInstagramMediaContainer,
  publishInstagramContainer,
} from '../lib/meta-api.js';

const router = Router();

/**
 * Helper: if mediaUrl is base64 data URI, upload to Vercel Blob and return public URL.
 * If already a public URL, return as-is.
 */
async function ensurePublicMediaUrl(mediaUrl: string, agencyId: string): Promise<string> {
  if (!mediaUrl || !mediaUrl.startsWith('data:image/')) {
    return mediaUrl; // already a URL (or empty)
  }

  const blobToken = process.env.BLOB_PUBLIC_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    throw new Error('Image upload not configured. Set BLOB_PUBLIC_READ_WRITE_TOKEN or BLOB_READ_WRITE_TOKEN.');
  }

  let put: any;
  try {
    // @ts-ignore
    const blob = await import('@vercel/blob');
    put = blob.put;
  } catch {
    throw new Error('Image upload not available. Install @vercel/blob package.');
  }

  const match = mediaUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid base64 image format');
  }

  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  const filename = `posts/${agencyId}/${Date.now()}.${ext}`;

  const result = await put(filename, buffer, {
    access: 'public',
    contentType: `image/${match[1]}`,
    token: blobToken,
  });

  return result.url;
}

function generateId(): string {
  return `post_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * POST /api/posts/schedule
 * Schedule a new post
 */
router.post('/schedule', authenticate, requireCanViewDashboard, async (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const { clientId, contentId, caption, mediaUrl, platforms, scheduledAt, timezone } = req.body;

    if (!clientId || !contentId || !caption || !platforms || !Array.isArray(platforms) || platforms.length === 0) {
      return res.status(400).json({ error: 'clientId, contentId, caption, and platforms required' });
    }
    const platformsList = platforms.filter((p: string) => p === 'instagram' || p === 'facebook');
    if (platformsList.includes('instagram') && (!mediaUrl || typeof mediaUrl !== 'string' || !mediaUrl.trim())) {
      return res.status(400).json({ error: 'Instagram requires an image. Provide mediaUrl or post to Facebook only.' });
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

    // Convert base64 images to public URLs at schedule time
    let finalMediaUrl = (typeof mediaUrl === 'string' && mediaUrl.trim()) ? mediaUrl.trim() : '';
    if (finalMediaUrl.startsWith('data:image/')) {
      try {
        finalMediaUrl = await ensurePublicMediaUrl(finalMediaUrl, agencyId);
      } catch (uploadErr: any) {
        console.error('[schedule] Failed to upload base64 image:', uploadErr.message);
        // Keep original URL, publish-now will retry upload
      }
    }

    const post = {
      id: generateId(),
      agencyId,
      clientId,
      contentId,
      caption: String(caption).slice(0, 2200),
      mediaUrl: finalMediaUrl,
      platforms: platformsList,
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
 * Remove a post from the calendar (scheduled → cancelled; failed/published → deleted from list).
 */
router.delete('/:id/cancel', authenticate, requireCanViewDashboard, (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const post = getScheduledPostById(req.params.id);
    if (!post || post.agencyId !== agencyId) {
      return res.status(404).json({ error: 'Post not found' });
    }
    deleteScheduledPost(post.id);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to remove' });
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

    console.log(`[publish-now] Post ${post.id}: platforms=${post.platforms.join(',')}, pageId=${integration.metaPageId}, igId=${integration.metaInstagramAccountId || 'none'}, hasMedia=${!!post.mediaUrl}`);

    try {
      // Convert base64 to public URL if needed (Instagram requires public HTTPS URLs)
      let publicMediaUrl = post.mediaUrl;
      if (publicMediaUrl && publicMediaUrl.startsWith('data:image/')) {
        console.log('[publish-now] Converting base64 image to public URL via Vercel Blob...');
        publicMediaUrl = await ensurePublicMediaUrl(publicMediaUrl, post.agencyId);
        // Update the stored post with the public URL so we don't re-upload next time
        post.mediaUrl = publicMediaUrl;
        console.log('[publish-now] Public URL obtained:', publicMediaUrl);
      }

      if (post.platforms.includes('facebook')) {
        if (publicMediaUrl && publicMediaUrl.startsWith('http')) {
          // Post with photo
          const result = await publishPhotoToFacebook(integration.metaPageId, integration.metaAccessToken, {
            url: publicMediaUrl,
            caption: post.caption,
          });
          metaPostIds.facebook = result.id;
        } else {
          // Text-only post
          const result = await publishToFacebook(integration.metaPageId, integration.metaAccessToken, {
            message: post.caption,
          });
          metaPostIds.facebook = result.id;
        }
      }

      if (post.platforms.includes('instagram') && integration.metaInstagramAccountId) {
        if (!publicMediaUrl || !publicMediaUrl.startsWith('http')) {
          throw new Error('Instagram requires an image. Please attach an image to this post.');
        }
        const container = await createInstagramMediaContainer(
          integration.metaInstagramAccountId,
          integration.metaAccessToken,
          { image_url: publicMediaUrl, caption: post.caption }
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
      // Return 422 (not 500) so frontend knows it's a Meta API error, not a server crash
      return res.status(422).json({ error, post });
    }
    res.json({ success: true, post });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to publish' });
  }
});

export default router;
