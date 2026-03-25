/**
 * Meta (Facebook/Instagram) Graph API wrapper
 * Graph API v19.0+
 */

const META_GRAPH_BASE = 'https://graph.facebook.com/v21.0';

export interface MetaPage {
  id: string;
  name: string;
  access_token: string;
}

export interface MetaInstagramAccount {
  id: string;
  username: string;
}

/**
 * Exchange short-lived token for long-lived token (60 days)
 */
export async function exchangeForLongLivedToken(shortLivedToken: string): Promise<{ access_token: string; expires_in: number }> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) throw new Error('META_APP_ID and META_APP_SECRET must be configured');

  const url = `${META_GRAPH_BASE}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortLivedToken}`;
  const res = await fetch(url);
  const data: any = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to exchange token');
  return { access_token: data.access_token, expires_in: data.expires_in || 5184000 };
}

/**
 * Get user's Facebook Pages with manage_posts permission
 */
export async function getPages(accessToken: string): Promise<MetaPage[]> {
  const url = `${META_GRAPH_BASE}/me/accounts?fields=id,name,access_token&access_token=${accessToken}`;
  const res = await fetch(url);
  const data: any = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to get pages');
  return (data.data || []).map((p: any) => ({ id: p.id, name: p.name, access_token: p.access_token }));
}

/**
 * Get Instagram Business Account connected to a Facebook Page
 */
export async function getInstagramAccount(pageId: string, pageAccessToken: string): Promise<MetaInstagramAccount | null> {
  const url = `${META_GRAPH_BASE}/${pageId}?fields=instagram_business_account{id,username}&access_token=${pageAccessToken}`;
  const res = await fetch(url);
  const data: any = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to get Instagram account');
  const ig = data.instagram_business_account;
  if (!ig) return null;
  return { id: ig.id, username: ig.username || '' };
}

/**
 * Publish to Facebook Page feed
 */
export async function publishToFacebook(
  pageId: string,
  pageAccessToken: string,
  options: { message: string; url?: string; published?: boolean; scheduled_publish_time?: number }
): Promise<{ id: string }> {
  const body: Record<string, any> = {
    message: options.message,
    access_token: pageAccessToken,
  };
  if (options.url) body.url = options.url;
  if (options.published === false) body.published = false;
  if (options.scheduled_publish_time) body.scheduled_publish_time = options.scheduled_publish_time;

  const res = await fetch(`${META_GRAPH_BASE}/${pageId}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data: any = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to publish to Facebook');
  return { id: data.id };
}

/**
 * Publish a photo to Facebook Page (uses /photos endpoint, not /feed)
 * This is the correct way to post images to Facebook.
 */
export async function publishPhotoToFacebook(
  pageId: string,
  pageAccessToken: string,
  options: { url: string; caption?: string; published?: boolean }
): Promise<{ id: string }> {
  const body: Record<string, any> = {
    url: options.url,
    caption: options.caption || '',
    access_token: pageAccessToken,
  };
  if (options.published === false) body.published = false;

  const res = await fetch(`${META_GRAPH_BASE}/${pageId}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data: any = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to publish photo to Facebook');
  return { id: data.id };
}

/**
 * Publish a video to Facebook Page (uses /videos endpoint).
 * Facebook requires file_url for hosted videos.
 */
export async function publishVideoToFacebook(
  pageId: string,
  pageAccessToken: string,
  options: { file_url: string; description?: string; title?: string; published?: boolean }
): Promise<{ id: string }> {
  const body: Record<string, any> = {
    file_url: options.file_url,
    access_token: pageAccessToken,
  };
  if (options.description) body.description = options.description;
  if (options.title) body.title = options.title;
  if (options.published === false) body.published = false;

  const res = await fetch(`${META_GRAPH_BASE}/${pageId}/videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data: any = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to publish video to Facebook');
  return { id: data.id };
}

/**
 * Create Instagram media container (Step 1 of 2-step publish)
 * Supports both images (image_url) and videos/reels (video_url).
 */
export async function createInstagramMediaContainer(
  igAccountId: string,
  accessToken: string,
  options: { image_url?: string; video_url?: string; caption?: string; media_type?: string }
): Promise<{ id: string }> {
  const body: Record<string, any> = {
    caption: options.caption || '',
    access_token: accessToken,
  };

  if (options.video_url) {
    // Video / Reel
    body.video_url = options.video_url;
    body.media_type = options.media_type || 'REELS';
  } else if (options.image_url) {
    body.image_url = options.image_url;
  }

  const res = await fetch(`${META_GRAPH_BASE}/${igAccountId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data: any = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to create Instagram container');
  return { id: data.id };
}

/**
 * Wait for Instagram media container to finish processing.
 * Both images AND videos need processing time — images are usually fast (1-5s)
 * but can fail with "Media ID is not available" if published before ready.
 * Videos take longer (up to 2 minutes).
 */
export async function waitForInstagramContainer(
  containerId: string,
  accessToken: string,
  maxWaitMs: number = 120000
): Promise<void> {
  const startTime = Date.now();
  let lastStatus = '';
  while (Date.now() - startTime < maxWaitMs) {
    const url = `${META_GRAPH_BASE}/${containerId}?fields=status_code,status&access_token=${accessToken}`;
    const res = await fetch(url);
    const data: any = await res.json();
    if (data.error) throw new Error(data.error.message || 'Failed to check container status');
    lastStatus = data.status_code || data.status || '';
    console.log(`[IG container ${containerId}] status: ${lastStatus}`);
    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR') {
      throw new Error(`Instagram media processing failed (status: ${data.status || 'ERROR'})`);
    }
    // Wait 2 seconds before polling again (shorter for images)
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`Instagram media processing timed out (last status: ${lastStatus})`);
}

/**
 * Refresh a long-lived user token (extends by another 60 days).
 * Only works if the current token is at least 24h old and not yet expired.
 * Returns a new long-lived token + expiry, or throws.
 */
export async function refreshLongLivedToken(currentToken: string): Promise<{ access_token: string; expires_in: number }> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) throw new Error('META_APP_ID and META_APP_SECRET must be configured');

  const url = `${META_GRAPH_BASE}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${currentToken}`;
  const res = await fetch(url);
  const data: any = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to refresh token');
  return { access_token: data.access_token, expires_in: data.expires_in || 5184000 };
}

/**
 * Publish Instagram container (Step 2).
 * Retries up to 3 times on "Media ID is not available" — a transient error
 * that happens when the container hasn't fully propagated yet.
 */
export async function publishInstagramContainer(
  igAccountId: string,
  accessToken: string,
  creationId: string
): Promise<{ id: string }> {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 3000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const body = { creation_id: creationId, access_token: accessToken };
    const res = await fetch(`${META_GRAPH_BASE}/${igAccountId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data: any = await res.json();

    if (data.error) {
      const msg = data.error.message || 'Failed to publish to Instagram';
      // "Media ID is not available" is transient — retry after a short wait
      if (msg.includes('Media ID is not available') && attempt < MAX_RETRIES) {
        console.log(`[IG publish] Attempt ${attempt}/${MAX_RETRIES} got "${msg}", retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      throw new Error(msg);
    }
    return { id: data.id };
  }
  throw new Error('Failed to publish to Instagram after retries');
}
