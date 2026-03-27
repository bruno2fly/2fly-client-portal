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
import { getMetaIntegrationByClient, saveMetaIntegration } from '../db.js';
import {
  publishToFacebook,
  publishPhotoToFacebook,
  publishVideoToFacebook,
  publishMultiPhotoToFacebook,
  createInstagramMediaContainer,
  publishInstagramContainer,
  publishInstagramCarousel,
  waitForInstagramContainer,
  publishInstagramStory,
  publishInstagramReel,
  publishFacebookPhotoStory,
  publishFacebookVideoStory,
  publishFacebookReel,
  getPages,
  getInstagramAccount,
  refreshLongLivedToken,
} from '../lib/meta-api.js';
import { sendPushToRole, sendPushToClient, NOTIFY } from '../lib/pushService.js';

const router = Router();

/**
 * Helper: if mediaUrl is base64 data URI (image or video), upload to Vercel Blob and return public URL.
 * If already a public URL, return as-is.
 */
async function ensurePublicMediaUrl(mediaUrl: string, agencyId: string): Promise<string> {
  if (!mediaUrl) return mediaUrl;
  const isBase64Image = mediaUrl.startsWith('data:image/');
  const isBase64Video = mediaUrl.startsWith('data:video/');
  if (!isBase64Image && !isBase64Video) {
    return mediaUrl; // already a URL
  }

  const blobToken = process.env.BLOB_PUBLIC_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    throw new Error('Media upload not configured. Set BLOB_PUBLIC_READ_WRITE_TOKEN or BLOB_READ_WRITE_TOKEN.');
  }

  let put: any;
  try {
    // @ts-ignore
    const blob = await import('@vercel/blob');
    put = blob.put;
  } catch {
    throw new Error('Media upload not available. Install @vercel/blob package.');
  }

  const match = mediaUrl.match(/^data:(image|video)\/(\w+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid base64 media format');
  }

  const mediaType = match[1]; // 'image' or 'video'
  let ext = match[2];
  if (ext === 'jpeg') ext = 'jpg';
  if (ext === 'quicktime') ext = 'mov';
  const buffer = Buffer.from(match[3], 'base64');
  const filename = `posts/${agencyId}/${Date.now()}.${ext}`;

  const result = await put(filename, buffer, {
    access: 'public',
    contentType: `${mediaType}/${match[2]}`,
    token: blobToken,
  });

  return result.url;
}

/** Check if a URL points to a video file */
function isVideoUrl(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return /\.(mp4|mov|webm|avi|wmv|flv|mkv|m4v)(\?|$)/.test(lower) || lower.includes('video');
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
    const { clientId, contentId, caption, mediaUrl, mediaUrls, platforms, placements, scheduledAt, timezone } = req.body;

    if (!clientId || !contentId || !caption || !platforms || !Array.isArray(platforms) || platforms.length === 0) {
      return res.status(400).json({ error: 'clientId, contentId, caption, and platforms required' });
    }
    const platformsList = platforms.filter((p: string) => p === 'instagram' || p === 'facebook');
    if (platformsList.includes('instagram') && (!mediaUrl || typeof mediaUrl !== 'string' || !mediaUrl.trim())) {
      return res.status(400).json({ error: 'Instagram requires media (image or video). Provide mediaUrl or post to Facebook only.' });
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

    // Convert base64 media (image or video) to public URLs at schedule time
    let finalMediaUrl = (typeof mediaUrl === 'string' && mediaUrl.trim()) ? mediaUrl.trim() : '';
    if (finalMediaUrl.startsWith('data:image/') || finalMediaUrl.startsWith('data:video/')) {
      try {
        finalMediaUrl = await ensurePublicMediaUrl(finalMediaUrl, agencyId);
      } catch (uploadErr: any) {
        console.error('[schedule] Failed to upload base64 media:', uploadErr.message);
      }
    }

    // Handle multiple media URLs for carousel posts
    let finalMediaUrls: string[] = [];
    if (Array.isArray(mediaUrls) && mediaUrls.length > 0) {
      for (const mUrl of mediaUrls) {
        let url = (typeof mUrl === 'string' && mUrl.trim()) ? mUrl.trim() : '';
        if (!url) continue;
        if (url.startsWith('data:image/') || url.startsWith('data:video/')) {
          try {
            url = await ensurePublicMediaUrl(url, agencyId);
          } catch (uploadErr: any) {
            console.error('[schedule] Failed to upload media from mediaUrls:', uploadErr.message);
          }
        }
        finalMediaUrls.push(url);
      }
      // If mediaUrl wasn't set but we have mediaUrls, use the first one as primary
      if (!finalMediaUrl && finalMediaUrls.length > 0) {
        finalMediaUrl = finalMediaUrls[0];
      }
    }

    const post = {
      id: generateId(),
      agencyId,
      clientId,
      contentId,
      caption: String(caption).slice(0, 2200),
      mediaUrl: finalMediaUrl,
      ...(finalMediaUrls.length > 1 ? { mediaUrls: finalMediaUrls } : {}),
      platforms: platformsList,
      placements: Array.isArray(placements) && placements.length > 0 ? placements.filter((p: string) => ['feed', 'stories', 'reels'].includes(p)) : ['feed'],
      scheduledAt: scheduledAtStr,
      timezone: tz,
      status: 'scheduled' as const,
      createdAt: now,
      updatedAt: now,
    };

    saveScheduledPost(post);
    // Notify client their post is scheduled
    sendPushToClient(post.clientId, NOTIFY.clientPostScheduled(
      post.caption ? post.caption.substring(0, 40) : 'Your post',
      new Date(post.scheduledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    )).catch(() => {});
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

    // Refresh tokens before publishing
    let userToken = (integration as any).metaUserAccessToken;
    if (userToken) {
      try {
        // Proactively refresh user token if it expires within 7 days
        const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
        if (integration.tokenExpiresAt - Date.now() < SEVEN_DAYS) {
          console.log(`[publish-now] Token expires soon, refreshing user token...`);
          const refreshed = await refreshLongLivedToken(userToken);
          userToken = refreshed.access_token;
          (integration as any).metaUserAccessToken = refreshed.access_token;
          integration.tokenExpiresAt = Date.now() + (refreshed.expires_in * 1000);
          console.log(`[publish-now] User token refreshed, new expiry: ${new Date(integration.tokenExpiresAt).toISOString()}`);
        }

        // Refresh page token from user token
        const freshPages = await getPages(userToken);
        const freshPage = freshPages.find((p: any) => p.id === integration.metaPageId) || freshPages[0];
        if (freshPage && freshPage.access_token !== integration.metaAccessToken) {
          console.log(`[publish-now] Refreshed page token for ${integration.metaPageId}`);
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
        console.log(`[publish-now] Token refresh failed (will try with existing): ${refreshErr.message}`);
      }
    }

    post.status = 'publishing';
    post.updatedAt = new Date().toISOString();
    saveScheduledPost(post);

    const metaPostIds: { instagram?: string; facebook?: string } = {};
    let error: string | undefined;

    const isCarousel = Array.isArray(post.mediaUrls) && post.mediaUrls.length > 1;
    const placements: string[] = Array.isArray(post.placements) && post.placements.length > 0 ? post.placements : ['feed'];
    console.log(`[publish-now] Post ${post.id}: platforms=${post.platforms.join(',')}, placements=${placements.join(',')}, pageId=${integration.metaPageId}, igId=${integration.metaInstagramAccountId || 'none'}, hasMedia=${!!post.mediaUrl}, isCarousel=${isCarousel}, mediaCount=${isCarousel ? post.mediaUrls!.length : (post.mediaUrl ? 1 : 0)}`);

    try {
      // Convert base64 to public URL if needed (Instagram requires public HTTPS URLs)
      let publicMediaUrl = post.mediaUrl;
      if (publicMediaUrl && (publicMediaUrl.startsWith('data:image/') || publicMediaUrl.startsWith('data:video/'))) {
        console.log('[publish-now] Converting base64 media to public URL via Vercel Blob...');
        publicMediaUrl = await ensurePublicMediaUrl(publicMediaUrl, post.agencyId);
        post.mediaUrl = publicMediaUrl;
        console.log('[publish-now] Public URL obtained:', publicMediaUrl);
      }

      // Ensure all carousel URLs are public
      let publicMediaUrls: string[] = [];
      if (isCarousel) {
        for (const mUrl of post.mediaUrls!) {
          if (mUrl.startsWith('data:image/') || mUrl.startsWith('data:video/')) {
            publicMediaUrls.push(await ensurePublicMediaUrl(mUrl, post.agencyId));
          } else {
            publicMediaUrls.push(mUrl);
          }
        }
        publicMediaUrls = publicMediaUrls.filter(u => u && u.startsWith('http'));
        post.mediaUrls = publicMediaUrls;
        console.log(`[publish-now] Carousel has ${publicMediaUrls.length} public URLs`);
      }

      const hasMedia = publicMediaUrl && publicMediaUrl.startsWith('http');
      const isVideo = hasMedia && isVideoUrl(publicMediaUrl);

      // Publish to each placement for each platform
      for (const placement of placements) {
        // ========== FACEBOOK ==========
        if (post.platforms.includes('facebook')) {
          if (placement === 'feed') {
            if (isCarousel && publicMediaUrls.length >= 2) {
              console.log('[publish-now] Publishing CAROUSEL to Facebook Feed...');
              const result = await publishMultiPhotoToFacebook(integration.metaPageId, integration.metaAccessToken, {
                urls: publicMediaUrls,
                caption: post.caption,
              });
              metaPostIds.facebook = result.id;
            } else if (hasMedia && isVideo) {
              console.log('[publish-now] Publishing VIDEO to Facebook Feed...');
              const result = await publishVideoToFacebook(integration.metaPageId, integration.metaAccessToken, {
                file_url: publicMediaUrl,
                description: post.caption,
              });
              metaPostIds.facebook = result.id;
            } else if (hasMedia) {
              const result = await publishPhotoToFacebook(integration.metaPageId, integration.metaAccessToken, {
                url: publicMediaUrl,
                caption: post.caption,
              });
              metaPostIds.facebook = result.id;
            } else {
              const result = await publishToFacebook(integration.metaPageId, integration.metaAccessToken, {
                message: post.caption,
              });
              metaPostIds.facebook = result.id;
            }
          } else if (placement === 'stories' && hasMedia) {
            if (isVideo) {
              console.log('[publish-now] Publishing VIDEO STORY to Facebook...');
              const result = await publishFacebookVideoStory(integration.metaPageId, integration.metaAccessToken, { url: publicMediaUrl });
              metaPostIds.facebook = metaPostIds.facebook || result.id;
            } else {
              console.log('[publish-now] Publishing PHOTO STORY to Facebook...');
              const result = await publishFacebookPhotoStory(integration.metaPageId, integration.metaAccessToken, { url: publicMediaUrl });
              metaPostIds.facebook = metaPostIds.facebook || result.id;
            }
          } else if (placement === 'reels' && hasMedia && isVideo) {
            console.log('[publish-now] Publishing REEL to Facebook...');
            const result = await publishFacebookReel(integration.metaPageId, integration.metaAccessToken, {
              url: publicMediaUrl,
              description: post.caption,
            });
            metaPostIds.facebook = metaPostIds.facebook || result.id;
          }
        }

        // ========== INSTAGRAM ==========
        if (post.platforms.includes('instagram') && integration.metaInstagramAccountId) {
          if (!hasMedia && !isCarousel) {
            throw new Error('Instagram requires media (image or video). Please attach media to this post.');
          }

          if (placement === 'feed') {
            if (isCarousel && publicMediaUrls.length >= 2) {
              console.log(`[publish-now] Publishing CAROUSEL (${publicMediaUrls.length} images) to Instagram Feed...`);
              const publishResult = await publishInstagramCarousel(
                integration.metaInstagramAccountId,
                integration.metaAccessToken,
                publicMediaUrls,
                post.caption
              );
              metaPostIds.instagram = publishResult.id;
            } else if (isVideo) {
              console.log('[publish-now] Publishing VIDEO to Instagram Feed as Reel...');
              const container = await createInstagramMediaContainer(
                integration.metaInstagramAccountId,
                integration.metaAccessToken,
                { video_url: publicMediaUrl, caption: post.caption, media_type: 'REELS' }
              );
              await waitForInstagramContainer(container.id, integration.metaAccessToken);
              const publishResult = await publishInstagramContainer(
                integration.metaInstagramAccountId,
                integration.metaAccessToken,
                container.id
              );
              metaPostIds.instagram = publishResult.id;
            } else {
              console.log('[publish-now] Publishing IMAGE to Instagram Feed...');
              const container = await createInstagramMediaContainer(
                integration.metaInstagramAccountId,
                integration.metaAccessToken,
                { image_url: publicMediaUrl, caption: post.caption }
              );
              await waitForInstagramContainer(container.id, integration.metaAccessToken, 30000);
              const publishResult = await publishInstagramContainer(
                integration.metaInstagramAccountId,
                integration.metaAccessToken,
                container.id
              );
              metaPostIds.instagram = publishResult.id;
            }
          } else if (placement === 'stories' && hasMedia) {
            console.log(`[publish-now] Publishing STORY to Instagram (${isVideo ? 'video' : 'image'})...`);
            const publishResult = await publishInstagramStory(
              integration.metaInstagramAccountId,
              integration.metaAccessToken,
              isVideo ? { video_url: publicMediaUrl } : { image_url: publicMediaUrl }
            );
            metaPostIds.instagram = metaPostIds.instagram || publishResult.id;
          } else if (placement === 'reels' && hasMedia && isVideo) {
            console.log('[publish-now] Publishing REEL to Instagram...');
            const publishResult = await publishInstagramReel(
              integration.metaInstagramAccountId,
              integration.metaAccessToken,
              { video_url: publicMediaUrl, caption: post.caption }
            );
            metaPostIds.instagram = metaPostIds.instagram || publishResult.id;
          }
        }
      } // end placements loop

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
    // Fire-and-forget push notifications for successful publish
    const clientName = getClient(post.clientId)?.name || 'Client';
    sendPushToRole(agencyId, ['OWNER', 'ADMIN', 'STAFF'], NOTIFY.postPublished(
      clientName,
      post.platforms.join(' & ')
    )).catch(() => {});
    // Notify the CLIENT that their post went live
    sendPushToClient(post.clientId, NOTIFY.clientPostLive(
      post.platforms.join(' & ')
    )).catch(() => {});
    res.json({ success: true, post });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to publish' });
  }
});

export default router;
