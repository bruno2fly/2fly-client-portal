/**
 * Minimal Meta Graph publisher for Content Automation v2.
 *
 * Deliberately standalone rather than importing lib/meta-api.ts: the legacy
 * scheduling pipeline owns that file, and a change there must never be able to
 * break this one. The duplication is a few dozen lines and it is on purpose.
 */

const GRAPH = 'https://graph.facebook.com/v21.0';

export interface PublishResult {
  postId: string;
  permalink: string;
}

export interface MetaFailure {
  fatal: boolean; // true → stop retrying, the credentials or content are the problem
  message: string;
  code?: number;
  subcode?: number;
}

/** Errors that will never succeed on retry. */
export function classifyMetaError(err: any): MetaFailure {
  const code = Number(err?.code ?? err?.error?.code ?? 0);
  const subcode = Number(err?.error_subcode ?? err?.error?.error_subcode ?? 0);
  const message = String(err?.message ?? err?.error?.message ?? err ?? 'Unknown Meta error');

  // 190 invalid/expired token · 200/10/3 permissions · 368 policy block · 506 duplicate
  const fatalCodes = [190, 200, 10, 3, 368, 506];
  const fatal = fatalCodes.includes(code) || /permission|expired|duplicate|not authorized/i.test(message);

  return { fatal, message, code: code || undefined, subcode: subcode || undefined };
}

async function graph(
  path: string,
  params: Record<string, string>,
  method: 'GET' | 'POST' = 'POST',
): Promise<any> {
  const url = new URL(`${GRAPH}${path}`);
  let body: URLSearchParams | undefined;

  if (method === 'GET') {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  } else {
    body = new URLSearchParams(params);
  }

  const res = await fetch(url.toString(), {
    method,
    body,
    headers: method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
  });

  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) {
    const e = json?.error || { message: `HTTP ${res.status}` };
    const err: any = new Error(e.message || 'Meta Graph request failed');
    err.code = e.code;
    err.error_subcode = e.error_subcode;
    err.graphPath = path;
    throw err;
  }
  return json;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Instagram: create a media container, wait for Meta to finish ingesting it,
 * then publish. Returns the media id and its permalink.
 */
export async function publishToInstagram(
  igBusinessId: string,
  accessToken: string,
  opts: { mediaUrl: string; caption: string; isVideo?: boolean },
): Promise<PublishResult> {
  const createParams: Record<string, string> = {
    access_token: accessToken,
    caption: opts.caption || '',
  };
  if (opts.isVideo) {
    createParams.video_url = opts.mediaUrl;
    createParams.media_type = 'REELS';
  } else {
    createParams.image_url = opts.mediaUrl;
  }

  const container = await graph(`/${igBusinessId}/media`, createParams);
  const creationId = container?.id;
  if (!creationId) throw new Error('Instagram did not return a container id.');

  // Poll until FINISHED. Images settle in seconds; video can take a while.
  const maxWaitMs = opts.isVideo ? 5 * 60_000 : 90_000;
  const startedAt = Date.now();
  let lastStatus = 'UNKNOWN';

  while (Date.now() - startedAt < maxWaitMs) {
    const st = await graph(
      `/${creationId}`,
      { access_token: accessToken, fields: 'status_code,status' },
      'GET',
    );
    lastStatus = st?.status_code || 'UNKNOWN';
    if (lastStatus === 'FINISHED') break;
    if (lastStatus === 'ERROR') {
      throw new Error(`Instagram rejected the media: ${st?.status || 'no detail'}`);
    }
    await sleep(3000);
  }

  if (lastStatus !== 'FINISHED') {
    throw new Error(`Instagram media container never finished processing (last status: ${lastStatus}).`);
  }

  const published = await graph(`/${igBusinessId}/media_publish`, {
    access_token: accessToken,
    creation_id: creationId,
  });

  const mediaId = published?.id;
  if (!mediaId) throw new Error('Instagram did not return a media id after publish.');

  let permalink = '';
  try {
    const info = await graph(`/${mediaId}`, { access_token: accessToken, fields: 'permalink' }, 'GET');
    permalink = info?.permalink || '';
  } catch {
    // Permalink is a nicety — never fail a successful post over it.
  }

  return { postId: mediaId, permalink };
}

/** Facebook Page photo post. */
export async function publishToFacebook(
  pageId: string,
  pageAccessToken: string,
  opts: { mediaUrl: string; caption: string },
): Promise<PublishResult> {
  const result = await graph(`/${pageId}/photos`, {
    access_token: pageAccessToken,
    url: opts.mediaUrl,
    caption: opts.caption || '',
    published: 'true',
  });

  const postId = result?.post_id || result?.id;
  if (!postId) throw new Error('Facebook did not return a post id.');

  return {
    postId,
    permalink: `https://www.facebook.com/${postId}`,
  };
}

/** Cheap credential check — confirms the page token still reads the page. */
export async function verifyPageToken(
  pageId: string,
  accessToken: string,
): Promise<{ ok: boolean; name?: string; error?: string }> {
  try {
    const r = await graph(`/${pageId}`, { access_token: accessToken, fields: 'id,name' }, 'GET');
    return { ok: true, name: r?.name };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
