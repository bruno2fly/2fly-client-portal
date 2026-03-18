/**
 * Cron endpoints for Vercel Cron Jobs
 * GET /api/cron/publish-posts - runs every 5 min, publishes due posts
 */

import { Router, Request, Response } from 'express';
import {
  getScheduledPosts,
  saveScheduledPost,
  getMetaIntegrationByClient,
} from '../db.js';
import {
  publishToFacebook,
  publishPhotoToFacebook,
  createInstagramMediaContainer,
  publishInstagramContainer,
} from '../lib/meta-api.js';

const router = Router();
const CRON_SECRET = process.env.CRON_SECRET;

function verifyCronAuth(req: Request, res: Response): boolean {
  const auth = req.headers.authorization;
  const secret = req.query.secret as string;
  if (CRON_SECRET && CRON_SECRET.length > 0) {
    const provided = auth === `Bearer ${CRON_SECRET}` || secret === CRON_SECRET;
    if (!provided) {
      res.status(401).json({ error: 'Unauthorized' });
      return false;
    }
  }
  return true;
}

/**
 * GET /api/cron/publish-posts
 * Publish posts where scheduledAt <= now and status === 'scheduled'
 */
router.get('/publish-posts', async (req: Request, res: Response) => {
  if (!verifyCronAuth(req, res)) return;

  const now = new Date();
  const posts = getScheduledPosts().filter(p => {
    if (p.status !== 'scheduled') return false;
    const scheduled = new Date(p.scheduledAt);
    return scheduled <= now;
  });

  const results: { id: string; status: string; error?: string }[] = [];

  for (const post of posts) {
    const integration = getMetaIntegrationByClient(post.agencyId, post.clientId);
    if (!integration || integration.tokenExpiresAt < Date.now()) {
      post.status = 'failed';
      post.error = 'Token expired or not connected';
      post.updatedAt = new Date().toISOString();
      saveScheduledPost(post);
      results.push({ id: post.id, status: 'failed', error: post.error });
      continue;
    }

    post.status = 'publishing';
    post.updatedAt = new Date().toISOString();
    saveScheduledPost(post);

    const metaPostIds: { instagram?: string; facebook?: string } = {};
    let error: string | undefined;

    try {
      if (post.platforms.includes('facebook')) {
        if (post.mediaUrl && post.mediaUrl.startsWith('http')) {
          // Photo post
          const result = await publishPhotoToFacebook(integration.metaPageId, integration.metaAccessToken, {
            url: post.mediaUrl,
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
      results.push({ id: post.id, status: 'published' });
    } catch (err: any) {
      error = err.message || 'Publish failed';
      post.status = 'failed';
      post.error = error;
      results.push({ id: post.id, status: 'failed', error });
    }

    post.updatedAt = new Date().toISOString();
    saveScheduledPost(post);
  }

  res.json({ success: true, processed: results.length, results });
});

export default router;
