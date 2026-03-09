/**
 * Meta (Facebook/Instagram) Graph API wrapper
 * Graph API v19.0+
 */

const META_GRAPH_BASE = 'https://graph.facebook.com/v19.0';

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
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to exchange token');
  return { access_token: data.access_token, expires_in: data.expires_in || 5184000 };
}

/**
 * Get user's Facebook Pages with manage_posts permission
 */
export async function getPages(accessToken: string): Promise<MetaPage[]> {
  const url = `${META_GRAPH_BASE}/me/accounts?fields=id,name,access_token&access_token=${accessToken}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to get pages');
  return (data.data || []).map((p: any) => ({ id: p.id, name: p.name, access_token: p.access_token }));
}

/**
 * Get Instagram Business Account connected to a Facebook Page
 */
export async function getInstagramAccount(pageId: string, pageAccessToken: string): Promise<MetaInstagramAccount | null> {
  const url = `${META_GRAPH_BASE}/${pageId}?fields=instagram_business_account{id,username}&access_token=${pageAccessToken}`;
  const res = await fetch(url);
  const data = await res.json();
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
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to publish to Facebook');
  return { id: data.id };
}

/**
 * Create Instagram media container (Step 1 of 2-step publish)
 */
export async function createInstagramMediaContainer(
  igAccountId: string,
  accessToken: string,
  options: { image_url: string; caption?: string }
): Promise<{ id: string }> {
  const body = {
    image_url: options.image_url,
    caption: options.caption || '',
    access_token: accessToken,
  };
  const res = await fetch(`${META_GRAPH_BASE}/${igAccountId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to create Instagram container');
  return { id: data.id };
}

/**
 * Publish Instagram container (Step 2)
 */
export async function publishInstagramContainer(
  igAccountId: string,
  accessToken: string,
  creationId: string
): Promise<{ id: string }> {
  const body = { creation_id: creationId, access_token: accessToken };
  const res = await fetch(`${META_GRAPH_BASE}/${igAccountId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to publish to Instagram');
  return { id: data.id };
}
