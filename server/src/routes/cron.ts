/**
 * Cron endpoints for Vercel Cron Jobs
 * GET /api/cron/publish-posts - runs every 5 min, publishes due posts
 */

import { Router, Request, Response } from 'express';
import {
  getScheduledPosts,
  saveScheduledPost,
  getMetaIntegrationByClient,
  saveMetaIntegration,
  getClient,
} from '../db.js';
import {
  publishToFacebook,
  publishPhotoToFacebook,
  createInstagramMediaContainer,
  publishInstagramContainer,
  getPages,
  getInstagramAccount,
  refreshLongLivedToken,
} from '../lib/meta-api.js';
import { sendPushToRole, NOTIFY } from '../lib/pushService.js';

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
 * Publish posts where scheduledAt <= now and status === 'scheduled'.
 * Also retries recent token-related failures (since Hobby plan only allows daily cron).
 * Pass ?retry=1 to include failed post retries.
 */
router.get('/publish-posts', async (req: Request, res: Response) => {
  if (!verifyCronAuth(req, res)) return;

  const includeRetries = req.query.retry === '1';
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  const now = new Date();
  const posts = getScheduledPosts().filter(p => {
    // Normal scheduled posts due now
    if (p.status === 'scheduled') {
      const scheduled = new Date(p.scheduledAt);
      return scheduled <= now;
    }
    // Also retry recent token-related failures
    if (includeRetries && p.status === 'failed') {
      const updatedAt = new Date(p.updatedAt);
      if (now.getTime() - updatedAt.getTime() > TWENTY_FOUR_HOURS) return false;
      const err = (p.error || '').toLowerCase();
      return err.includes('token') || err.includes('expired') || err.includes('authorized') || err.includes('oauth') || err.includes('session');
    }
    return false;
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

    // ── Refresh tokens before publishing (same logic as publish-now) ──
    const userToken = (integration as any).metaUserAccessToken;
    if (userToken) {
      try {
        // Proactively refresh the user token if it expires within 7 days
        const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
        if (integration.tokenExpiresAt - Date.now() < SEVEN_DAYS) {
          console.log(`[cron] Token for ${integration.metaPageId} expires soon, refreshing user token...`);
          const refreshed = await refreshLongLivedToken(userToken);
          (integration as any).metaUserAccessToken = refreshed.access_token;
          integration.tokenExpiresAt = Date.now() + (refreshed.expires_in * 1000);
          console.log(`[cron] User token refreshed, new expiry: ${new Date(integration.tokenExpiresAt).toISOString()}`);
        }

        // Refresh page token from user token
        const freshPages = await getPages(userToken);
        const freshPage = freshPages.find((p: any) => p.id === integration.metaPageId) || freshPages[0];
        if (freshPage && freshPage.access_token !== integration.metaAccessToken) {
          console.log(`[cron] Refreshed page token for ${integration.metaPageId}`);
          integration.metaAccessToken = freshPage.access_token;
          integration.updatedAt = Date.now();
          if (freshPage.id) {
            const igAcct = await getInstagramAccount(freshPage.id, freshPage.access_token);
            if (igAcct) {
              integration.metaInstagramAccountId = igAcct.id;
              integration.metaInstagramUsername = igAcct.username;
            }
          }
        }
        saveMetaIntegration(integration);
      } catch (refreshErr: any) {
        console.log(`[cron] Token refresh failed (will try with existing): ${refreshErr.message}`);
      }
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
      // Fire-and-forget push notification for successful publish
      const clientName = getClient(post.clientId)?.name || 'Client';
      sendPushToRole(post.agencyId, ['OWNER', 'ADMIN', 'STAFF'], NOTIFY.postPublished(
        clientName,
        post.platforms.join(' & ')
      )).catch(() => {});
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

/**
 * GET /api/cron/refresh-tokens
 * Proactively refresh Meta tokens that expire within 14 days.
 * Should run daily via Vercel Cron to prevent tokens from going stale.
 */
router.get('/refresh-tokens', async (req: Request, res: Response) => {
  if (!verifyCronAuth(req, res)) return;

  const { getMetaIntegrations } = await import('../db.js');
  const all = getMetaIntegrations();
  const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const results: { clientId: string; status: string; error?: string; newExpiry?: string }[] = [];

  for (const integration of Object.values(all)) {
    const timeLeft = integration.tokenExpiresAt - now;

    // Skip if already expired (user must reconnect manually)
    if (timeLeft <= 0) {
      results.push({ clientId: integration.clientId, status: 'expired', error: 'Token already expired, reconnect required' });
      continue;
    }

    // Skip if still has plenty of time (more than 14 days)
    if (timeLeft > FOURTEEN_DAYS) {
      results.push({ clientId: integration.clientId, status: 'ok', newExpiry: new Date(integration.tokenExpiresAt).toISOString() });
      continue;
    }

    // Token expires within 14 days — refresh it
    const userToken = (integration as any).metaUserAccessToken;
    if (!userToken) {
      results.push({ clientId: integration.clientId, status: 'skipped', error: 'No user token stored (old connection)' });
      continue;
    }

    try {
      const refreshed = await refreshLongLivedToken(userToken);
      (integration as any).metaUserAccessToken = refreshed.access_token;
      integration.tokenExpiresAt = now + (refreshed.expires_in * 1000);
      integration.updatedAt = now;

      // Also refresh page token
      const freshPages = await getPages(refreshed.access_token);
      const freshPage = freshPages.find((p: any) => p.id === integration.metaPageId) || freshPages[0];
      if (freshPage) {
        integration.metaAccessToken = freshPage.access_token;
        if (freshPage.id) {
          const igAcct = await getInstagramAccount(freshPage.id, freshPage.access_token);
          if (igAcct) {
            integration.metaInstagramAccountId = igAcct.id;
            integration.metaInstagramUsername = igAcct.username;
          }
        }
      }

      saveMetaIntegration(integration);
      console.log(`[refresh-tokens] Refreshed token for client ${integration.clientId}, new expiry: ${new Date(integration.tokenExpiresAt).toISOString()}`);
      results.push({ clientId: integration.clientId, status: 'refreshed', newExpiry: new Date(integration.tokenExpiresAt).toISOString() });
    } catch (err: any) {
      console.error(`[refresh-tokens] Failed for client ${integration.clientId}: ${err.message}`);
      results.push({ clientId: integration.clientId, status: 'failed', error: err.message });
    }
  }

  res.json({ success: true, processed: results.length, results });
});

/**
 * GET /api/cron/retry-failed
 * Retry posts that failed due to token issues (runs every 30 min).
 * Only retries posts that failed within the last 24 hours and have a valid token now.
 */
router.get('/retry-failed', async (req: Request, res: Response) => {
  if (!verifyCronAuth(req, res)) return;

  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  const now = new Date();
  const posts = getScheduledPosts().filter(p => {
    if (p.status !== 'failed') return false;
    // Only retry recent failures (within 24h)
    const updatedAt = new Date(p.updatedAt);
    if (now.getTime() - updatedAt.getTime() > TWENTY_FOUR_HOURS) return false;
    // Only retry token-related failures
    const err = (p.error || '').toLowerCase();
    return err.includes('token') || err.includes('expired') || err.includes('authorized') || err.includes('oauth') || err.includes('session');
  });

  const results: { id: string; status: string; error?: string }[] = [];

  for (const post of posts) {
    const integration = getMetaIntegrationByClient(post.agencyId, post.clientId);
    if (!integration || integration.tokenExpiresAt < Date.now()) {
      results.push({ id: post.id, status: 'skipped', error: 'Still no valid token' });
      continue;
    }

    // Refresh page token before retry
    const userToken = (integration as any).metaUserAccessToken;
    if (userToken) {
      try {
        const freshPages = await getPages(userToken);
        const freshPage = freshPages.find((p: any) => p.id === integration.metaPageId) || freshPages[0];
        if (freshPage) {
          integration.metaAccessToken = freshPage.access_token;
          integration.updatedAt = Date.now();
          saveMetaIntegration(integration);
        }
      } catch { /* use existing token */ }
    }

    post.status = 'publishing';
    post.updatedAt = now.toISOString();
    saveScheduledPost(post);

    const metaPostIds: { instagram?: string; facebook?: string } = {};
    let error: string | undefined;

    try {
      if (post.platforms.includes('facebook')) {
        if (post.mediaUrl && post.mediaUrl.startsWith('http')) {
          const result = await publishPhotoToFacebook(integration.metaPageId, integration.metaAccessToken, {
            url: post.mediaUrl, caption: post.caption,
          });
          metaPostIds.facebook = result.id;
        } else {
          const result = await publishToFacebook(integration.metaPageId, integration.metaAccessToken, {
            message: post.caption,
          });
          metaPostIds.facebook = result.id;
        }
      }

      if (post.platforms.includes('instagram') && integration.metaInstagramAccountId) {
        const container = await createInstagramMediaContainer(
          integration.metaInstagramAccountId, integration.metaAccessToken,
          { image_url: post.mediaUrl, caption: post.caption }
        );
        const publishResult = await publishInstagramContainer(
          integration.metaInstagramAccountId, integration.metaAccessToken, container.id
        );
        metaPostIds.instagram = publishResult.id;
      }

      post.status = 'published';
      post.publishedAt = now.toISOString();
      post.metaPostIds = metaPostIds;
      delete post.error;
      results.push({ id: post.id, status: 'published' });
      // Fire-and-forget push notification for successful publish
      const clientName = getClient(post.clientId)?.name || 'Client';
      sendPushToRole(post.agencyId, ['OWNER', 'ADMIN', 'STAFF'], NOTIFY.postPublished(
        clientName,
        post.platforms.join(' & ')
      )).catch(() => {});
    } catch (err: any) {
      error = err.message || 'Retry publish failed';
      post.status = 'failed';
      post.error = error;
      results.push({ id: post.id, status: 'failed', error });
    }

    post.updatedAt = now.toISOString();
    saveScheduledPost(post);
  }

  res.json({ success: true, retried: results.length, results });
});

export default router;
