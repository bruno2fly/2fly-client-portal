/**
 * Drive link → a URL the Meta Graph API can actually fetch.
 *
 * This is the step that quietly kills naive Sheet→Instagram pipelines: Meta must
 * download the image itself from a public URL. A normal Google Drive share link
 * ("/file/d/<id>/view") serves an HTML viewer page, not bytes, so Meta rejects it.
 *
 * Strategy, cheapest first:
 *   1. Already a plain public http(s) image/video URL → use as-is.
 *   2. Drive file that is public ("anyone with the link") → use the direct
 *      download form and verify it really returns image/video bytes.
 *   3. Otherwise → download through the service account and re-host on Vercel
 *      Blob (BLOB_READ_WRITE_TOKEN is already configured for this service).
 *
 * Standalone — shares nothing with the legacy upload/meta code paths.
 */

import { google } from 'googleapis';
import { getServiceAccountKey } from './googleSheets.js';

const MEDIA_TYPE_RE = /^(image|video)\//i;

export interface ResolvedMedia {
  url: string;
  contentType: string;
  via: 'direct' | 'drive-public' | 'blob-rehost';
}

/** Pull a Drive file id out of the common link shapes. */
export function extractDriveFileId(link: string): string | null {
  if (!link) return null;
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]{20,})/, //  /file/d/<id>/view
    /[?&]id=([a-zA-Z0-9_-]{20,})/, //      ?id=<id>
    /\/document\/d\/([a-zA-Z0-9_-]{20,})/,
    /\/open\?id=([a-zA-Z0-9_-]{20,})/,
  ];
  for (const re of patterns) {
    const m = link.match(re);
    if (m?.[1]) return m[1];
  }
  // A bare id pasted straight into the cell
  if (/^[a-zA-Z0-9_-]{25,}$/.test(link.trim())) return link.trim();
  return null;
}

function isDriveLink(link: string): boolean {
  return /drive\.google\.com|docs\.google\.com/i.test(link);
}

/** Fetch just enough to learn the content type without pulling the whole file. */
async function probe(url: string): Promise<{ ok: boolean; contentType: string; status: number }> {
  try {
    const res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-1023' }, redirect: 'follow' });
    const contentType = (res.headers.get('content-type') || '').split(';')[0]!.trim();
    return { ok: res.ok && MEDIA_TYPE_RE.test(contentType), contentType, status: res.status };
  } catch {
    return { ok: false, contentType: '', status: 0 };
  }
}

function getDriveClient() {
  const key = getServiceAccountKey();
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  return google.drive({ version: 'v3', auth });
}

async function rehostToBlob(
  fileId: string,
  clientId: string,
): Promise<ResolvedMedia> {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    throw new Error(
      'Drive file is not publicly readable and BLOB_READ_WRITE_TOKEN is not set, so it cannot be re-hosted for Meta.',
    );
  }

  const drive = getDriveClient();

  const meta = await drive.files.get({ fileId, fields: 'name,mimeType,size' });
  const mimeType = meta.data.mimeType || '';
  if (!MEDIA_TYPE_RE.test(mimeType)) {
    throw new Error(`Drive file is "${mimeType || 'unknown type'}", not an image or video.`);
  }

  const dl = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' },
  );
  const buffer = Buffer.from(dl.data as ArrayBuffer);
  if (buffer.length === 0) throw new Error('Drive returned an empty file.');

  const { put } = (await import('@vercel/blob')) as typeof import('@vercel/blob');
  const ext = (mimeType.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '');
  const filename = `content-automation/${clientId}/${fileId}.${ext}`;

  const blob = await put(filename, buffer, {
    access: 'public',
    contentType: mimeType,
    token: blobToken,
    addRandomSuffix: false,
  });

  return { url: blob.url, contentType: mimeType, via: 'blob-rehost' };
}

/**
 * Turn whatever is in the Asset Link column into something Meta can fetch.
 * Throws with a human-readable reason that goes straight into the Sheet's Notes column.
 */
export async function resolveMediaUrl(assetLink: string, clientId: string): Promise<ResolvedMedia> {
  const link = (assetLink || '').trim();
  if (!link) throw new Error('Asset Link is empty.');

  if (!isDriveLink(link)) {
    if (!/^https?:\/\//i.test(link)) {
      throw new Error(`Asset Link is not a URL: "${link.slice(0, 80)}"`);
    }
    const p = await probe(link);
    if (!p.ok) {
      throw new Error(
        `Asset Link is not publicly fetchable as media (HTTP ${p.status}, content-type "${p.contentType || 'unknown'}").`,
      );
    }
    return { url: link, contentType: p.contentType, via: 'direct' };
  }

  const fileId = extractDriveFileId(link);
  if (!fileId) throw new Error(`Could not read a Drive file id out of: "${link.slice(0, 80)}"`);

  // Public Drive files serve real bytes from this form.
  const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  const p = await probe(directUrl);
  if (p.ok) {
    return { url: directUrl, contentType: p.contentType, via: 'drive-public' };
  }

  // Not public (or too large for the direct form) — pull it through the service
  // account and re-host. Requires the file to be shared with the service account.
  return rehostToBlob(fileId, clientId);
}
