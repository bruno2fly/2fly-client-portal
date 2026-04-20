/**
 * Cron endpoints for Vercel Cron Jobs
 * GET /api/cron/publish-posts - runs every 5 min, publishes due posts
 */

import { Router, Request, Response } from 'express';
import {
  getScheduledPosts,
  saveScheduledPost,
  getMetaIntegrationByClient,
  getMetaIntegrations,
  saveMetaIntegration,
  getClient,
} from '../db.js';
import {
  publishToFacebook,
  publishPhotoToFacebook,
  publishMultiPhotoToFacebook,
  createInstagramMediaContainer,
  publishInstagramContainer,
  publishInstagramCarousel,
  waitForInstagramContainer,
  getPages,
  getInstagramAccount,
  refreshLongLivedToken,
} from '../lib/meta-api.js';
import { sendPushToRole, sendPushToClient, NOTIFY } from '../lib/pushService.js';

const router = Router();
const CRON_SECRET = process.env.CRON_SECRET;

/* ── Smart Meta Error Detection ──
 * Parses Facebook/Instagram Graph API errors and classifies them.
 * Returns { fatal, type, message } where fatal=true means "stop retrying, flag connection".
 */
interface MetaErrorInfo {
  fatal: boolean;
  type: 'permission' | 'token_expired' | 'rate_limit' | 'media' | 'unknown';
  message: string;
  code?: number;
  subcode?: number;
}

function parseMetaError(err: any): MetaErrorInfo {
  const msg = (err.message || err.toString() || '').toLowerCase();
  // Try to extract FB error code from message like "(#200)" or "code: 200"
  const codeMatch = msg.match(/\(#(\d+)\)/) || msg.match(/code[:\s]+(\d+)/);
  const code = codeMatch ? parseInt(codeMatch[1], 10) : 0;
  // Try to extract subcode
  const subcodeMatch = msg.match(/subcode[:\s]+(\d+)/);
  const subcode = subcodeMatch ? parseInt(subcodeMatch[1], 10) : 0;

  // ── Facebook error codes ──
  // #200 = Permissions error (app doesn't have required permissions)
  // #10  = Permissions error (alternate)
  // #190 = Invalid/expired access token
  // #4   = API rate limit
  // #368 = Temporarily blocked for policy violations
  // #506 = Duplicate post

  // Permission errors — FATAL, connection is broken
  if (code === 200 || code === 10) {
    return { fatal: true, type: 'permission', message: 'Meta App missing required permissions (#' + code + '). Submit for App Review or reconnect.', code, subcode };
  }
  if (msg.includes('(#200)') || msg.includes('permissions error') || msg.includes('does not have permission') || msg.includes('subject does not exist')) {
    return { fatal: true, type: 'permission', message: 'Permission denied by Meta. App permissions need review.', code: 200, subcode };
  }

  // Token expired — FATAL, needs reconnect
  if (code === 190) {
    return { fatal: true, type: 'token_expired', message: 'Access token expired or revoked (#190). Reconnect required.', code, subcode };
  }
  if (msg.includes('oauthexception') || msg.includes('invalid oauth') || msg.includes('session has expired') || msg.includes('token has expired') || msg.includes('error validating access token')) {
    return { fatal: true, type: 'token_expired', message: 'Access token expired or invalidated. Reconnect required.', code: 190, subcode };
  }

  // Blocked — FATAL, page or app restricted
  if (code === 368 || msg.includes('temporarily blocked') || msg.includes('policy violation')) {
    return { fatal: true, type: 'permission', message: 'Account temporarily blocked by Meta for policy violations (#368).', code: 368, subcode };
  }

  // Rate limit — NOT fatal, just slow down
  if (code === 4 || code === 32 || msg.includes('rate limit') || msg.includes('too many calls')) {
    return { fatal: false, type: 'rate_limit', message: 'Rate limited by Meta. Will retry later.', code, subcode };
  }

  // Media errors — NOT fatal, issue with specific post content
  if (msg.includes('media') || msg.includes('image') || msg.includes('url is not') || msg.includes('could not download')) {
    return { fatal: false, type: 'media', message: 'Media error: ' + (err.message || '').substring(0, 100), code, subcode };
  }

  // Default — unknown, NOT fatal (let it retry)
  return { fatal: false, type: 'unknown', message: err.message || 'Unknown error', code, subcode };
}

/**
 * Flag a client's Meta connection as broken and send urgent notification.
 * All future publish attempts for this client will be skipped until reconnected.
 */
function flagConnectionBroken(
  integration: any,
  errorType: 'permission_error' | 'token_expired' | 'blocked',
  errorMessage: string,
  agencyId: string,
  clientId: string
) {
  // Only flag once — don't spam notifications
  if (integration.connectionStatus === errorType) return;

  integration.connectionStatus = errorType;
  integration.connectionError = errorMessage;
  integration.connectionFlaggedAt = Date.now();
  integration.updatedAt = Date.now();
  saveMetaIntegration(integration);

  const clientName = getClient(clientId)?.name || 'Client';
  console.error(`[cron] ⛔ FLAGGED connection for ${clientName} (${clientId}): ${errorType} — ${errorMessage}`);

  // Send urgent notification to agency owners/admins
  sendPushToRole(agencyId, ['OWNER', 'ADMIN'], NOTIFY.connectionBroken(
    clientName, errorType, errorMessage
  )).catch(() => {});
}

/**
 * Check if a client's connection is flagged as broken.
 * Returns true if publishing should be SKIPPED.
 */
function isConnectionFlagged(integration: any): boolean {
  return integration.connectionStatus && integration.connectionStatus !== 'ok';
}

/**
 * Clear a connection's error flags (called when reconnect happens).
 */
function clearConnectionFlags(integration: any) {
  integration.connectionStatus = 'ok';
  integration.connectionError = undefined;
  integration.connectionFlaggedAt = undefined;
  integration.updatedAt = Date.now();
  saveMetaIntegration(integration);
}

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
  try {
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

    // ── Skip if connection is flagged as broken ──
    if (isConnectionFlagged(integration)) {
      post.status = 'failed';
      post.error = `Connection blocked: ${integration.connectionError || integration.connectionStatus}. Reconnect Meta to resume.`;
      post.updatedAt = new Date().toISOString();
      saveScheduledPost(post);
      results.push({ id: post.id, status: 'failed', error: post.error });
      console.warn(`[cron] SKIPPED post ${post.id} — connection flagged: ${integration.connectionStatus}`);
      continue;
    }

    // ── ALWAYS refresh tokens before publishing ──
    let userToken = (integration as any).metaUserAccessToken;
    if (userToken) {
      try {
        // Always try to refresh user token to keep it alive
        try {
          console.log(`[cron] Refreshing user token for ${integration.metaPageId}...`);
          const refreshed = await refreshLongLivedToken(userToken);
          userToken = refreshed.access_token;
          (integration as any).metaUserAccessToken = refreshed.access_token;
          integration.tokenExpiresAt = Date.now() + (refreshed.expires_in * 1000);
          console.log(`[cron] User token refreshed, new expiry: ${new Date(integration.tokenExpiresAt).toISOString()}`);
        } catch (refreshUserErr: any) {
          console.log(`[cron] User token refresh failed (using existing): ${refreshUserErr.message}`);
        }

        // Always get fresh page token from user token
        const freshPages = await getPages(userToken);
        const freshPage = freshPages.find((p: any) => p.id === integration.metaPageId) || freshPages[0];
        if (freshPage) {
          console.log(`[cron] Got fresh page token for ${integration.metaPageId}`);
          integration.metaAccessToken = freshPage.access_token;
          integration.updatedAt = Date.now();
          const igAcct = await getInstagramAccount(freshPage.id, freshPage.access_token);
          if (igAcct) {
            integration.metaInstagramAccountId = igAcct.id;
            integration.metaInstagramUsername = igAcct.username;
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
    const platformErrors: string[] = [];

    const isCarousel = Array.isArray(post.mediaUrls) && post.mediaUrls.length > 1;
    const carouselUrls = isCarousel ? post.mediaUrls!.filter((u: string) => u && u.startsWith('http')) : [];

    console.log(`[cron] Publishing post ${post.id} | platforms: ${post.platforms.join(',')} | carousel: ${isCarousel} (${carouselUrls.length} urls) | mediaUrl: ${(post.mediaUrl || '').slice(0, 80)}`);

    // ── Facebook ──
    if (post.platforms.includes('facebook')) {
      try {
        if (isCarousel && carouselUrls.length >= 2) {
          console.log(`[cron] Publishing CAROUSEL (${carouselUrls.length} images) to Facebook...`);
          const result = await publishMultiPhotoToFacebook(integration.metaPageId, integration.metaAccessToken, {
            urls: carouselUrls, caption: post.caption,
          });
          metaPostIds.facebook = result.id;
          console.log(`[cron] Facebook carousel published: ${result.id}`);
        } else if (post.mediaUrl && post.mediaUrl.startsWith('http')) {
          const result = await publishPhotoToFacebook(integration.metaPageId, integration.metaAccessToken, {
            url: post.mediaUrl,
            caption: post.caption,
          });
          metaPostIds.facebook = result.id;
          console.log(`[cron] Facebook photo published: ${result.id}`);
        } else {
          const result = await publishToFacebook(integration.metaPageId, integration.metaAccessToken, {
            message: post.caption,
          });
          metaPostIds.facebook = result.id;
          console.log(`[cron] Facebook text post published: ${result.id}`);
        }
      } catch (fbErr: any) {
        const parsed = parseMetaError(fbErr);
        const fbError = `Facebook: ${parsed.message}`;
        console.error(`[cron] Facebook publish FAILED for post ${post.id}: [code=${parsed.code}] [fatal=${parsed.fatal}] ${parsed.message}`);
        platformErrors.push(fbError);

        // Flag connection if error is fatal (permissions or token)
        if (parsed.fatal) {
          const flagType = parsed.type === 'token_expired' ? 'token_expired' : 'permission_error';
          flagConnectionBroken(integration, flagType, parsed.message, post.agencyId, post.clientId);
        }
      }
    }

    // ── Instagram ──
    if (post.platforms.includes('instagram')) {
      if (!integration.metaInstagramAccountId) {
        const igError = 'Instagram: No Instagram Business Account linked to this Facebook page';
        console.error(`[cron] ${igError} for post ${post.id}`);
        platformErrors.push(igError);
      } else {
        try {
          if (isCarousel && carouselUrls.length >= 2) {
            console.log(`[cron] Publishing CAROUSEL (${carouselUrls.length} images) to Instagram...`);
            const publishResult = await publishInstagramCarousel(
              integration.metaInstagramAccountId, integration.metaAccessToken,
              carouselUrls, post.caption
            );
            metaPostIds.instagram = publishResult.id;
            console.log(`[cron] Instagram carousel published: ${publishResult.id}`);
          } else if (post.mediaUrl && post.mediaUrl.startsWith('http')) {
            const container = await createInstagramMediaContainer(
              integration.metaInstagramAccountId,
              integration.metaAccessToken,
              { image_url: post.mediaUrl, caption: post.caption }
            );
            console.log(`[cron] Instagram container created: ${container.id}, waiting for processing...`);
            await waitForInstagramContainer(container.id, integration.metaAccessToken, 60000);
            const publishResult = await publishInstagramContainer(
              integration.metaInstagramAccountId,
              integration.metaAccessToken,
              container.id
            );
            metaPostIds.instagram = publishResult.id;
            console.log(`[cron] Instagram photo published: ${publishResult.id}`);
          } else {
            const igError = 'Instagram: No valid media URL (Instagram requires an image or video)';
            console.error(`[cron] ${igError} for post ${post.id}`);
            platformErrors.push(igError);
          }
        } catch (igErr: any) {
          const parsed = parseMetaError(igErr);
          const igError = `Instagram: ${parsed.message}`;
          console.error(`[cron] Instagram publish FAILED for post ${post.id}: [code=${parsed.code}] [fatal=${parsed.fatal}] ${parsed.message}`);
          platformErrors.push(igError);

          // Flag connection if error is fatal (permissions or token)
          if (parsed.fatal) {
            const flagType = parsed.type === 'token_expired' ? 'token_expired' : 'permission_error';
            flagConnectionBroken(integration, flagType, parsed.message, post.agencyId, post.clientId);
          }
        }
      }
    }

    // ── Determine final status ──
    const hasAnySuccess = !!(metaPostIds.facebook || metaPostIds.instagram);
    const hasAnyFailure = platformErrors.length > 0;

    if (hasAnySuccess && !hasAnyFailure) {
      post.status = 'published';
      post.publishedAt = new Date().toISOString();
      post.metaPostIds = metaPostIds;
      delete post.error;
      results.push({ id: post.id, status: 'published' });
    } else if (hasAnySuccess && hasAnyFailure) {
      // Partial success
      post.status = 'published';
      post.publishedAt = new Date().toISOString();
      post.metaPostIds = metaPostIds;
      post.error = 'Partial: ' + platformErrors.join(' | ');
      results.push({ id: post.id, status: 'partial', error: post.error });
      console.warn(`[cron] PARTIAL publish for post ${post.id}: ${post.error}`);
    } else {
      post.status = 'failed';
      post.error = platformErrors.join(' | ') || 'All platforms failed';
      results.push({ id: post.id, status: 'failed', error: post.error });
      console.error(`[cron] FULL FAILURE for post ${post.id}: ${post.error}`);
    }

    // ── Push notifications based on result ──
    const clientName = getClient(post.clientId)?.name || 'Client';
    const allPlatforms = (post.platforms || []).join(' & ');

    if (hasAnySuccess && !hasAnyFailure) {
      // Full success
      const publishedPlatforms = [metaPostIds.facebook ? 'Facebook' : '', metaPostIds.instagram ? 'Instagram' : ''].filter(Boolean).join(' & ');
      sendPushToRole(post.agencyId, ['OWNER', 'ADMIN', 'STAFF'], NOTIFY.postPublished(
        clientName, publishedPlatforms
      )).catch(() => {});
      sendPushToClient(post.clientId, NOTIFY.clientPostLive(
        publishedPlatforms
      )).catch(() => {});
    } else if (hasAnySuccess && hasAnyFailure) {
      // Partial success
      const succeeded = [metaPostIds.facebook ? 'Facebook' : '', metaPostIds.instagram ? 'Instagram' : ''].filter(Boolean).join(' & ');
      const failed = [!metaPostIds.facebook && post.platforms.includes('facebook') ? 'Facebook' : '', !metaPostIds.instagram && post.platforms.includes('instagram') ? 'Instagram' : ''].filter(Boolean).join(' & ');
      sendPushToRole(post.agencyId, ['OWNER', 'ADMIN', 'STAFF'], NOTIFY.postPartial(
        clientName, succeeded, failed
      )).catch(() => {});
      sendPushToClient(post.clientId, NOTIFY.clientPostLive(succeeded)).catch(() => {});
    } else {
      // Full failure
      sendPushToRole(post.agencyId, ['OWNER', 'ADMIN', 'STAFF'], NOTIFY.postFailed(
        clientName, allPlatforms, platformErrors[0] || 'Unknown error'
      )).catch(() => {});
      sendPushToClient(post.clientId, NOTIFY.clientPostFailed(allPlatforms)).catch(() => {});
    }

    post.updatedAt = new Date().toISOString();
    saveScheduledPost(post);
  }

  res.json({ success: true, processed: results.length, results });
  } catch (err: any) {
    console.error('[cron/publish-posts] Unhandled error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error', message: err?.message });
  }
});

/**
 * GET /api/cron/refresh-tokens
 * Proactively refresh Meta tokens that expire within 14 days.
 * Should run daily via Vercel Cron to prevent tokens from going stale.
 */
router.get('/refresh-tokens', async (req: Request, res: Response) => {
  try {
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
  } catch (err: any) {
    console.error('[cron/refresh-tokens] Unhandled error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error', message: err?.message });
  }
});

/**
 * GET /api/cron/retry-failed
 * Retry posts that failed due to token issues (runs every 30 min).
 * Only retries posts that failed within the last 24 hours and have a valid token now.
 */
router.get('/retry-failed', async (req: Request, res: Response) => {
  try {
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

    // Skip if connection is flagged — no point retrying
    if (isConnectionFlagged(integration)) {
      results.push({ id: post.id, status: 'skipped', error: `Connection flagged: ${integration.connectionStatus}` });
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

    const isCarousel = Array.isArray(post.mediaUrls) && post.mediaUrls.length > 1;
    const carouselUrls = isCarousel ? post.mediaUrls!.filter((u: string) => u && u.startsWith('http')) : [];

    try {
      if (post.platforms.includes('facebook')) {
        if (isCarousel && carouselUrls.length >= 2) {
          const result = await publishMultiPhotoToFacebook(integration.metaPageId, integration.metaAccessToken, {
            urls: carouselUrls, caption: post.caption,
          });
          metaPostIds.facebook = result.id;
        } else if (post.mediaUrl && post.mediaUrl.startsWith('http')) {
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
        if (isCarousel && carouselUrls.length >= 2) {
          const publishResult = await publishInstagramCarousel(
            integration.metaInstagramAccountId, integration.metaAccessToken,
            carouselUrls, post.caption
          );
          metaPostIds.instagram = publishResult.id;
        } else {
          const container = await createInstagramMediaContainer(
            integration.metaInstagramAccountId, integration.metaAccessToken,
            { image_url: post.mediaUrl, caption: post.caption }
          );
          await waitForInstagramContainer(container.id, integration.metaAccessToken, 30000);
          const publishResult = await publishInstagramContainer(
            integration.metaInstagramAccountId, integration.metaAccessToken, container.id
          );
          metaPostIds.instagram = publishResult.id;
        }
      }

      post.status = 'published';
      post.publishedAt = now.toISOString();
      post.metaPostIds = metaPostIds;
      delete post.error;
      results.push({ id: post.id, status: 'published' });
      // Fire-and-forget push notifications
      const clientName = getClient(post.clientId)?.name || 'Client';
      sendPushToRole(post.agencyId, ['OWNER', 'ADMIN', 'STAFF'], NOTIFY.postPublished(
        clientName,
        post.platforms.join(' & ')
      )).catch(() => {});
      sendPushToClient(post.clientId, NOTIFY.clientPostLive(
        post.platforms.join(' & ')
      )).catch(() => {});
    } catch (err: any) {
      const parsed = parseMetaError(err);
      error = parsed.message || 'Retry publish failed';
      post.status = 'failed';
      post.error = error;
      results.push({ id: post.id, status: 'failed', error });

      // Flag if fatal error detected on retry
      if (parsed.fatal) {
        const flagType = parsed.type === 'token_expired' ? 'token_expired' : 'permission_error';
        flagConnectionBroken(integration, flagType, parsed.message, post.agencyId, post.clientId);
      }
    }

    post.updatedAt = now.toISOString();
    saveScheduledPost(post);
  }

  res.json({ success: true, retried: results.length, results });
  } catch (err: any) {
    console.error('[cron/retry-failed] Unhandled error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error', message: err?.message });
  }
});

// NOTE: Duplicate /refresh-tokens handler was removed — the handler above (line ~416) covers all cases.

export default router;
