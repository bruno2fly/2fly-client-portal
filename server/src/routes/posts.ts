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

/**
 * Normalize media URLs that come from known share-link hosts so that Meta
 * actually receives a direct file download. This catches the #1 source of
 * "Invalid parameter" errors: users pasting Dropbox / Google Drive share
 * URLs, which return an HTML viewer page when fetched.
 *
 * - Dropbox: forces `dl=1` so the URL serves the raw file.
 * - Google Drive: rewrites view/open URLs to `uc?export=download&id=`.
 *   NOTE: Google Drive is still unreliable for large files (Meta will hit
 *   the virus-scan confirmation page). `rejectUnsupportedMediaHost` below
 *   refuses Drive outright for that reason — this rewrite only exists so
 *   that legacy saved values get a chance before being rejected.
 */
function normalizeMediaUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
  const url = rawUrl.trim();
  if (!url || url.startsWith('data:')) return url;

  // Dropbox: any share URL → force raw file download
  if (/^https?:\/\/(www\.)?dropbox\.com\//i.test(url)) {
    try {
      const u = new URL(url);
      u.searchParams.delete('dl');
      u.searchParams.set('dl', '1');
      return u.toString();
    } catch { /* fall through */ }
  }

  // Google Drive: /file/d/{id}/view → uc?export=download&id={id}
  const driveFileMatch = url.match(/^https?:\/\/drive\.google\.com\/file\/d\/([^/]+)/i);
  if (driveFileMatch) {
    return `https://drive.google.com/uc?export=download&id=${driveFileMatch[1]}`;
  }
  const driveOpenMatch = url.match(/^https?:\/\/drive\.google\.com\/open\?id=([^&]+)/i);
  if (driveOpenMatch) {
    return `https://drive.google.com/uc?export=download&id=${driveOpenMatch[1]}`;
  }

  return url;
}

/**
 * Refuse media URLs from hosts that are known to return an HTML viewer page
 * (or require auth, or otherwise can't be fetched by Meta). This surfaces
 * a clear, actionable error at schedule time / publish time so users know
 * exactly what to fix instead of seeing Meta's generic "Invalid parameter".
 */
function assertSupportedMediaHost(rawUrl: string, label: string = 'Media'): void {
  if (!rawUrl || typeof rawUrl !== 'string') return;
  const url = rawUrl.trim();
  if (!url || url.startsWith('data:')) return;

  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return; }

  // Google Drive — unreliable (virus-scan warning page for larger files,
  // HTML viewer for /file/d/.../view links, permission-gated files return
  // a login page). Reject outright and tell the user what to do instead.
  if (host === 'drive.google.com' || host === 'docs.google.com') {
    throw new Error(`${label} URL is a Google Drive link, which Meta cannot download. Download the file from Drive and upload it directly to the post.`);
  }

  // Canva share links are not direct image files.
  if (host === 'canva.com' || host.endsWith('.canva.com')) {
    throw new Error(`${label} URL is a Canva share link. In Canva click Share → Download to get a PNG/JPG, then upload that file here.`);
  }

  // Notion share pages are HTML, not images.
  if (host === 'notion.so' || host.endsWith('.notion.so') || host.endsWith('.notion.site')) {
    throw new Error(`${label} URL is a Notion page, not a raw image file. Download the image from Notion and upload it directly.`);
  }

  // Figma, Miro, Adobe Cloud share links — same problem.
  if (host === 'figma.com' || host.endsWith('.figma.com')) {
    throw new Error(`${label} URL is a Figma link. Export the frame as PNG/JPG and upload the file directly.`);
  }
  if (host === 'adobe.com' || host.endsWith('.adobe.com') || host === 'adobecreativecloud.com') {
    throw new Error(`${label} URL is an Adobe share link. Export the asset and upload the file directly.`);
  }
}

/**
 * Pre-flight validation before handing a URL to Meta Graph API.
 * Meta returns the very generic "Invalid parameter" (#100) when it can't
 * fetch the media URL — which is almost impossible to debug from the error
 * alone. This helper fetches the URL ourselves first and throws a clear,
 * actionable message if anything is wrong so the user knows exactly what
 * to fix instead of seeing "Invalid parameter".
 */
async function validateMediaUrlReachable(rawUrl: string, label: string = 'media'): Promise<void> {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error(`Missing ${label} URL. Attach an image or video before publishing.`);
  }
  const url = rawUrl.trim();
  if (!url) {
    throw new Error(`Empty ${label} URL. Attach an image or video before publishing.`);
  }
  if (url.startsWith('data:')) {
    throw new Error(`${label} URL is still a base64 data URI — it must be uploaded to public storage before publishing.`);
  }
  if (!/^https:\/\//i.test(url)) {
    // Meta requires HTTPS for image_url / video_url / url.
    throw new Error(`${label} URL must be HTTPS (Meta rejects http:// and relative URLs). Got: ${url.slice(0, 80)}`);
  }

  // Reject obviously private / unreachable hosts.
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host.startsWith('127.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.endsWith('.local')
    ) {
      throw new Error(`${label} URL points to a private host (${host}) that Meta cannot reach. Re-upload the media.`);
    }
  } catch (urlErr: any) {
    if (urlErr && urlErr.message && urlErr.message.startsWith(`${label}`)) throw urlErr;
    throw new Error(`${label} URL is not a valid URL: ${url.slice(0, 80)}`);
  }

  // Try HEAD first; some hosts don't support HEAD, fall back to a tiny ranged GET.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let status = 0;
  let contentType = '';
  try {
    const headRes = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
    });
    status = headRes.status;
    contentType = (headRes.headers.get('content-type') || '').toLowerCase();
    if (status === 405 || status === 403 || !contentType) {
      // Some CDNs reject HEAD — fall through to a ranged GET
      const getRes = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { Range: 'bytes=0-1023' },
        signal: controller.signal,
      });
      status = getRes.status;
      contentType = (getRes.headers.get('content-type') || '').toLowerCase();
    }
  } catch (fetchErr: any) {
    clearTimeout(timer);
    const msg = fetchErr && fetchErr.name === 'AbortError'
      ? 'timed out after 8s'
      : (fetchErr && fetchErr.message) || 'network error';
    throw new Error(`${label} URL cannot be fetched (${msg}). Re-upload the media or check the link. URL: ${url.slice(0, 100)}`);
  }
  clearTimeout(timer);

  if (status < 200 || status >= 400) {
    throw new Error(`${label} URL returned HTTP ${status}. Meta cannot download it. Re-upload the media. URL: ${url.slice(0, 100)}`);
  }

  // Empty/missing content-type is a warning but not fatal — some hosts omit it.
  if (contentType) {
    const looksLikeImage = contentType.startsWith('image/');
    const looksLikeVideo = contentType.startsWith('video/');
    const looksLikeOctet = contentType.startsWith('application/octet-stream');
    if (!looksLikeImage && !looksLikeVideo && !looksLikeOctet) {
      throw new Error(`${label} URL returned content-type "${contentType}" — expected image/* or video/*. The link is probably pointing to an HTML page, not the raw file.`);
    }
  }
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
    // Normalize known share URLs (Dropbox → dl=1, Drive view → direct) and
    // refuse any host we know Meta cannot download from.
    if (finalMediaUrl) {
      finalMediaUrl = normalizeMediaUrl(finalMediaUrl);
      assertSupportedMediaHost(finalMediaUrl, 'Media');
    }

    // Handle multiple media URLs for carousel posts
    let finalMediaUrls: string[] = [];
    if (Array.isArray(mediaUrls) && mediaUrls.length > 0) {
      for (let idx = 0; idx < mediaUrls.length; idx++) {
        const mUrl = mediaUrls[idx];
        let url = (typeof mUrl === 'string' && mUrl.trim()) ? mUrl.trim() : '';
        if (!url) continue;
        if (url.startsWith('data:image/') || url.startsWith('data:video/')) {
          try {
            url = await ensurePublicMediaUrl(url, agencyId);
          } catch (uploadErr: any) {
            console.error('[schedule] Failed to upload media from mediaUrls:', uploadErr.message);
          }
        }
        url = normalizeMediaUrl(url);
        assertSupportedMediaHost(url, `Carousel image #${idx + 1}`);
        finalMediaUrls.push(url);
      }
      // If mediaUrl wasn't set but we have mediaUrls, use the first one as primary
      if (!finalMediaUrl && finalMediaUrls.length > 0) {
        finalMediaUrl = finalMediaUrls[0];
      }
    }

    // Pre-flight validate reachability so we fail at schedule time with a
    // clear message instead of hours later when cron/publish-now hits it.
    try {
      if (finalMediaUrls.length > 1) {
        for (let i = 0; i < finalMediaUrls.length; i++) {
          await validateMediaUrlReachable(finalMediaUrls[i], `Carousel image #${i + 1}`);
        }
      } else if (finalMediaUrl) {
        await validateMediaUrlReachable(finalMediaUrl, isVideoUrl(finalMediaUrl) ? 'Video' : 'Image');
      }
    } catch (validationErr: any) {
      return res.status(400).json({ error: validationErr.message || 'Media URL validation failed' });
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
    const clientName = client.name || clientId;
    const schedDateStr = new Date(post.scheduledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    // Notify agency staff
    sendPushToRole(agencyId, ['OWNER', 'ADMIN', 'STAFF'], NOTIFY.postScheduled(
      clientName, post.caption ? post.caption.substring(0, 40) : 'Post', schedDateStr
    )).catch(() => {});
    // Notify client their post is scheduled
    sendPushToClient(post.clientId, NOTIFY.clientPostScheduled(
      post.caption ? post.caption.substring(0, 40) : 'Your post', schedDateStr
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
    const clientName = getClient(post.clientId)?.name || 'Client';
    const newDateStr = new Date(scheduledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    sendPushToRole(agencyId, ['OWNER', 'ADMIN', 'STAFF'], NOTIFY.postRescheduled(
      clientName, post.caption ? post.caption.substring(0, 40) : 'Post', newDateStr
    )).catch(() => {});
    sendPushToClient(post.clientId, NOTIFY.clientPostRescheduled(newDateStr)).catch(() => {});
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
    const clientName = getClient(post.clientId)?.name || 'Client';
    const postTitle = post.caption ? post.caption.substring(0, 40) : 'Post';
    deleteScheduledPost(post.id);
    sendPushToRole(agencyId, ['OWNER', 'ADMIN', 'STAFF'], NOTIFY.postCancelled(
      clientName, postTitle
    )).catch(() => {});
    sendPushToClient(post.clientId, NOTIFY.clientPostCancelled(postTitle)).catch(() => {});
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to remove' });
  }
});

/**
 * GET /api/posts/:id/diagnose
 * Inspect a scheduled/failed post and report exactly why its media URL
 * is (or isn't) publishable. Read-only — does NOT touch Meta at all.
 */
router.get('/:id/diagnose', authenticate, requireCanViewDashboard, async (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const post = getScheduledPostById(req.params.id);
    if (!post || post.agencyId !== agencyId) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const urls: string[] = [];
    if (Array.isArray(post.mediaUrls) && post.mediaUrls.length > 0) {
      post.mediaUrls.forEach((u: string) => { if (u && typeof u === 'string') urls.push(u); });
    } else if (post.mediaUrl && typeof post.mediaUrl === 'string') {
      urls.push(post.mediaUrl);
    }

    const report: any[] = [];
    for (let i = 0; i < urls.length; i++) {
      const rawUrl = urls[i];
      const label = urls.length > 1 ? `Image #${i + 1}` : (isVideoUrl(rawUrl) ? 'Video' : 'Image');
      const normalized = normalizeMediaUrl(rawUrl);
      const entry: any = {
        index: i,
        rawUrl,
        normalizedUrl: normalized,
        wasNormalized: normalized !== rawUrl,
      };
      try {
        assertSupportedMediaHost(normalized, label);
        entry.hostSupported = true;
      } catch (hostErr: any) {
        entry.hostSupported = false;
        entry.hostError = hostErr.message;
        report.push(entry);
        continue;
      }
      try {
        await validateMediaUrlReachable(normalized, label);
        entry.reachable = true;
      } catch (reachErr: any) {
        entry.reachable = false;
        entry.reachabilityError = reachErr.message;
      }
      report.push(entry);
    }

    res.json({
      success: true,
      post: {
        id: post.id,
        clientId: post.clientId,
        status: post.status,
        error: post.error,
        caption: post.caption ? post.caption.slice(0, 120) : '',
        platforms: post.platforms,
        placements: post.placements,
        scheduledAt: post.scheduledAt,
      },
      mediaCount: urls.length,
      media: report,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Diagnose failed' });
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
    // Allow both 'scheduled' posts and 'failed' posts (retry path).
    // Reject already-publishing, already-published, or cancelled posts so we
    // never double-post. This endpoint is only ever invoked by an explicit
    // user click — it never fires automatically.
    if (post.status !== 'scheduled' && post.status !== 'failed') {
      return res.status(400).json({ error: `Cannot publish post in status "${post.status}"` });
    }

    const integration = getMetaIntegrationByClient(agencyId, post.clientId);
    if (!integration || integration.tokenExpiresAt < Date.now()) {
      return res.status(400).json({ error: 'Connect Facebook & Instagram for this client in the Scheduled Posts tab first' });
    }

    // ALWAYS refresh tokens before publishing — ensures fresh page token
    let userToken = (integration as any).metaUserAccessToken;
    if (userToken) {
      try {
        // Always try to refresh user token to keep it alive
        try {
          console.log(`[publish-now] Refreshing user token...`);
          const refreshed = await refreshLongLivedToken(userToken);
          userToken = refreshed.access_token;
          (integration as any).metaUserAccessToken = refreshed.access_token;
          integration.tokenExpiresAt = Date.now() + (refreshed.expires_in * 1000);
          console.log(`[publish-now] User token refreshed, new expiry: ${new Date(integration.tokenExpiresAt).toISOString()}`);
        } catch (refreshUserErr: any) {
          console.log(`[publish-now] User token refresh failed (using existing): ${refreshUserErr.message}`);
        }

        // Always get fresh page token from user token
        const freshPages = await getPages(userToken);
        const freshPage = freshPages.find((p: any) => p.id === integration.metaPageId) || freshPages[0];
        if (freshPage) {
          console.log(`[publish-now] Got fresh page token for ${integration.metaPageId}`);
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

      // Normalize share URLs (Dropbox etc.) so legacy saved posts heal on
      // retry, and refuse hosts Meta cannot download from.
      if (publicMediaUrl) {
        publicMediaUrl = normalizeMediaUrl(publicMediaUrl);
        assertSupportedMediaHost(publicMediaUrl, 'Media');
        post.mediaUrl = publicMediaUrl;
      }
      if (isCarousel && publicMediaUrls.length > 0) {
        publicMediaUrls = publicMediaUrls.map((u, i) => {
          const n = normalizeMediaUrl(u);
          assertSupportedMediaHost(n, `Carousel image #${i + 1}`);
          return n;
        });
        post.mediaUrls = publicMediaUrls;
      }

      const hasMedia = publicMediaUrl && publicMediaUrl.startsWith('http');
      const isVideo = hasMedia && isVideoUrl(publicMediaUrl);

      // ── Pre-flight validate the media URL(s) before handing them to Meta.
      // Meta returns "Invalid parameter" (#100) whenever it can't fetch the
      // URL — we want to surface a clear, actionable message instead so the
      // user knows exactly what to re-upload.
      if (isCarousel && publicMediaUrls.length > 0) {
        for (let i = 0; i < publicMediaUrls.length; i++) {
          await validateMediaUrlReachable(publicMediaUrls[i], `Carousel image #${i + 1}`);
        }
      } else if (hasMedia) {
        await validateMediaUrlReachable(publicMediaUrl as string, isVideo ? 'Video' : 'Image');
      }

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
      console.error(`[publish-now] FAILED for post ${post.id}:`, error);
      // If we got partial success (e.g. FB worked but IG failed), mark as published with error
      if (metaPostIds.facebook || metaPostIds.instagram) {
        post.status = 'published';
        post.publishedAt = new Date().toISOString();
        post.metaPostIds = metaPostIds;
        post.error = 'Partial: ' + error;
      } else {
        post.status = 'failed';
        post.error = error;
      }
    }

    post.updatedAt = new Date().toISOString();
    saveScheduledPost(post);

    // Auto-save images to References when published successfully
    if (post.status === 'published') {
      try {
        const { saveReference, referenceExistsForUrl } = await import('../db.js');
        const { generateId: genRefId } = await import('../utils/auth.js');
        const allUrls: string[] = [];
        if (post.mediaUrl && post.mediaUrl.startsWith('http')) allUrls.push(post.mediaUrl);
        if (Array.isArray(post.mediaUrls)) {
          post.mediaUrls.forEach((u: string) => { if (u && u.startsWith('http') && !allUrls.includes(u)) allUrls.push(u); });
        }
        for (const url of allUrls) {
          if (!referenceExistsForUrl(post.clientId, url)) {
            saveReference({
              id: genRefId(),
              agencyId: post.agencyId,
              clientId: post.clientId,
              imageUrl: url,
              source: 'published_post',
              sourceId: post.id,
              caption: post.caption || '',
              platforms: post.platforms || [],
              publishedAt: post.publishedAt || new Date().toISOString(),
              createdAt: new Date().toISOString()
            });
            console.log(`[publish-now] Reference saved for ${url.slice(0, 60)}...`);
          }
        }
      } catch (refErr: any) {
        console.warn('[publish-now] Failed to save references:', refErr.message);
      }
    }

    const clientName = getClient(post.clientId)?.name || 'Client';
    const allPlatforms = (post.platforms || []).join(' & ');

    if (post.status === 'failed') {
      // Notify about failure
      sendPushToRole(agencyId, ['OWNER', 'ADMIN', 'STAFF'], NOTIFY.postFailed(
        clientName, allPlatforms, post.error || 'Unknown error'
      )).catch(() => {});
      sendPushToClient(post.clientId, NOTIFY.clientPostFailed(allPlatforms)).catch(() => {});
      return res.status(422).json({ error: post.error || error, post });
    }

    // Check if partial (published with error)
    if (post.error && post.error.startsWith('Partial:')) {
      const succeeded = [metaPostIds.facebook ? 'Facebook' : '', metaPostIds.instagram ? 'Instagram' : ''].filter(Boolean).join(' & ');
      const failed = [!metaPostIds.facebook && post.platforms.includes('facebook') ? 'Facebook' : '', !metaPostIds.instagram && post.platforms.includes('instagram') ? 'Instagram' : ''].filter(Boolean).join(' & ');
      sendPushToRole(agencyId, ['OWNER', 'ADMIN', 'STAFF'], NOTIFY.postPartial(
        clientName, succeeded, failed
      )).catch(() => {});
      sendPushToClient(post.clientId, NOTIFY.clientPostLive(succeeded)).catch(() => {});
    } else {
      // Full success
      sendPushToRole(agencyId, ['OWNER', 'ADMIN', 'STAFF'], NOTIFY.postPublished(
        clientName, allPlatforms
      )).catch(() => {});
      sendPushToClient(post.clientId, NOTIFY.clientPostLive(
        allPlatforms
      )).catch(() => {});
    }
    res.json({ success: true, post });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to publish' });
  }
});

export default router;
