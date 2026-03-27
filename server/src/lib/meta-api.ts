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

/**
 * Publish an Instagram CAROUSEL post (multiple images).
 * Flow: 1) create a container per image (is_carousel_item=true)
 *       2) create a carousel container referencing all children
 *       3) wait for carousel container, then publish
 */
export async function publishInstagramCarousel(
  igAccountId: string,
  accessToken: string,
  imageUrls: string[],
  caption: string
): Promise<{ id: string }> {
  if (imageUrls.length < 2) throw new Error('Carousel requires at least 2 images');
  if (imageUrls.length > 10) throw new Error('Instagram carousel supports max 10 images');

  // Step 1: Create individual child containers
  const childIds: string[] = [];
  for (const url of imageUrls) {
    const body: Record<string, any> = {
      image_url: url,
      is_carousel_item: true,
      access_token: accessToken,
    };
    const res = await fetch(`${META_GRAPH_BASE}/${igAccountId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data: any = await res.json();
    if (data.error) throw new Error(data.error.message || 'Failed to create carousel item container');
    childIds.push(data.id);
    console.log(`[IG carousel] Created child container ${data.id} for ${url}`);
  }

  // Wait for all children to be ready
  for (const childId of childIds) {
    await waitForInstagramContainer(childId, accessToken, 30000);
  }

  // Step 2: Create the carousel container
  const carouselBody: Record<string, any> = {
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    caption: caption || '',
    access_token: accessToken,
  };
  const carouselRes = await fetch(`${META_GRAPH_BASE}/${igAccountId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(carouselBody),
  });
  const carouselData: any = await carouselRes.json();
  if (carouselData.error) throw new Error(carouselData.error.message || 'Failed to create carousel container');
  console.log(`[IG carousel] Created carousel container ${carouselData.id}`);

  // Wait for carousel to be ready
  await waitForInstagramContainer(carouselData.id, accessToken, 60000);

  // Step 3: Publish
  return publishInstagramContainer(igAccountId, accessToken, carouselData.id);
}

/**
 * Publish multiple photos to a Facebook Page as a single multi-photo post.
 * Uses unpublished photos attached to a feed post via attached_media.
 */
export async function publishMultiPhotoToFacebook(
  pageId: string,
  pageAccessToken: string,
  options: { urls: string[]; caption?: string }
): Promise<{ id: string }> {
  if (options.urls.length < 2) throw new Error('Multi-photo requires at least 2 images');

  // Step 1: Upload each photo as unpublished
  const photoIds: string[] = [];
  for (const url of options.urls) {
    const body: Record<string, any> = {
      url,
      published: false,
      access_token: pageAccessToken,
    };
    const res = await fetch(`${META_GRAPH_BASE}/${pageId}/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data: any = await res.json();
    if (data.error) throw new Error(data.error.message || 'Failed to upload unpublished photo');
    photoIds.push(data.id);
    console.log(`[FB multi-photo] Uploaded unpublished photo ${data.id}`);
  }

  // Step 2: Create feed post with attached_media
  const feedBody: Record<string, any> = {
    message: options.caption || '',
    access_token: pageAccessToken,
  };
  photoIds.forEach((pid, i) => {
    feedBody[`attached_media[${i}]`] = `{"media_fbid":"${pid}"}`;
  });

  const res = await fetch(`${META_GRAPH_BASE}/${pageId}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(feedBody),
  });
  const data: any = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to publish multi-photo post');
  return { id: data.id };
}

// ==================== STORIES ====================

/**
 * Publish an image story to Instagram
 * Creates a container with media_type: STORIES, waits, then publishes
 */
export async function publishInstagramStory(
  igAccountId: string,
  accessToken: string,
  options: { image_url?: string; video_url?: string }
): Promise<{ id: string }> {
  const body: Record<string, any> = {
    media_type: 'STORIES',
    access_token: accessToken,
  };
  if (options.video_url) {
    body.video_url = options.video_url;
  } else if (options.image_url) {
    body.image_url = options.image_url;
  } else {
    throw new Error('Stories require either image_url or video_url');
  }

  console.log(`[IG Story] Creating story container for ${igAccountId}...`);
  const res = await fetch(`${META_GRAPH_BASE}/${igAccountId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data: any = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to create story container');
  const containerId = data.id;
  console.log(`[IG Story] Container created: ${containerId}, waiting for readiness...`);

  // Wait for container to be ready
  await waitForInstagramContainer(containerId, accessToken, options.video_url ? 120000 : 30000);

  // Publish
  const publishResult = await publishInstagramContainer(igAccountId, accessToken, containerId);
  console.log(`[IG Story] Story published: ${publishResult.id}`);
  return publishResult;
}

/**
 * Publish a photo story to Facebook Page
 */
export async function publishFacebookPhotoStory(
  pageId: string,
  pageAccessToken: string,
  options: { url: string }
): Promise<{ id: string }> {
  console.log(`[FB Story] Publishing photo story to page ${pageId}...`);
  const res = await fetch(`${META_GRAPH_BASE}/${pageId}/photo_stories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      photo_id: await uploadUnpublishedFacebookPhoto(pageId, pageAccessToken, options.url),
      access_token: pageAccessToken,
    }),
  });
  const data: any = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to publish Facebook photo story');
  console.log(`[FB Story] Photo story published: ${data.id}`);
  return { id: data.id };
}

/**
 * Publish a video story to Facebook Page
 */
export async function publishFacebookVideoStory(
  pageId: string,
  pageAccessToken: string,
  options: { url: string }
): Promise<{ id: string }> {
  console.log(`[FB Story] Publishing video story to page ${pageId}...`);
  const res = await fetch(`${META_GRAPH_BASE}/${pageId}/video_stories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      upload_phase: 'start',
      file_url: options.url,
      access_token: pageAccessToken,
    }),
  });
  const data: any = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to publish Facebook video story');
  console.log(`[FB Story] Video story published: ${data.id}`);
  return { id: data.id };
}

/**
 * Helper: upload unpublished photo to Facebook and return photo_id
 */
async function uploadUnpublishedFacebookPhoto(
  pageId: string,
  pageAccessToken: string,
  url: string
): Promise<string> {
  const res = await fetch(`${META_GRAPH_BASE}/${pageId}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      published: false,
      access_token: pageAccessToken,
    }),
  });
  const data: any = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to upload unpublished photo');
  return data.id;
}

// ==================== REELS ====================

/**
 * Publish a Reel to Instagram (video only)
 * Uses media_type: REELS
 */
export async function publishInstagramReel(
  igAccountId: string,
  accessToken: string,
  options: { video_url: string; caption?: string }
): Promise<{ id: string }> {
  console.log(`[IG Reel] Creating reel container for ${igAccountId}...`);
  const body: Record<string, any> = {
    media_type: 'REELS',
    video_url: options.video_url,
    caption: options.caption || '',
    access_token: accessToken,
  };

  const res = await fetch(`${META_GRAPH_BASE}/${igAccountId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data: any = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to create reel container');
  const containerId = data.id;
  console.log(`[IG Reel] Container created: ${containerId}, waiting for video processing...`);

  // Wait for video to process (reels can take longer)
  await waitForInstagramContainer(containerId, accessToken, 180000);

  // Publish
  const publishResult = await publishInstagramContainer(igAccountId, accessToken, containerId);
  console.log(`[IG Reel] Reel published: ${publishResult.id}`);
  return publishResult;
}

/**
 * Publish a Reel to Facebook Page (video only)
 */
export async function publishFacebookReel(
  pageId: string,
  pageAccessToken: string,
  options: { url: string; description?: string }
): Promise<{ id: string }> {
  console.log(`[FB Reel] Publishing reel to page ${pageId}...`);
  const res = await fetch(`${META_GRAPH_BASE}/${pageId}/video_reels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      upload_phase: 'finish',
      video_state: 'PUBLISHED',
      file_url: options.url,
      description: options.description || '',
      access_token: pageAccessToken,
    }),
  });
  const data: any = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to publish Facebook reel');
  console.log(`[FB Reel] Reel published: ${data.id}`);
  return { id: data.id };
}
