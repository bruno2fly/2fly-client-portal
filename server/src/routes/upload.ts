/**
 * Image upload for Meta publishing
 * Uses Vercel Blob when BLOB_READ_WRITE_TOKEN is set
 */

import { Router } from 'express';
import { authenticate, getAgencyScope } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

/**
 * POST /api/upload/image
 * Upload base64 image and return public URL for Meta API
 * Body: { image: "data:image/jpeg;base64,..." }
 */
router.post('/image', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { image } = req.body;

    if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Valid base64 image data required (data:image/...)' });
    }

    const blobToken = process.env.BLOB_PUBLIC_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;

    if (!blobToken) {
      return res.status(503).json({
        error: 'Image upload not configured',
        message: 'BLOB_PUBLIC_READ_WRITE_TOKEN or BLOB_READ_WRITE_TOKEN is not set.',
      });
    }

    let put: any;
    try {
      // @ts-ignore - @vercel/blob may not be installed in all environments
      const blobModule = await import('@vercel/blob');
      put = blobModule.put;
    } catch (importErr: any) {
      return res.status(503).json({
        error: 'Image upload not available',
        message: 'Install @vercel/blob package for image uploads.',
      });
    }

    const match = image.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid image format' });
    }

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const buffer = Buffer.from(match[2], 'base64');

    let agencyId: string;
    try {
      const scope = getAgencyScope(req);
      agencyId = scope.agencyId;
    } catch (scopeErr: any) {
      return res.status(400).json({ error: 'Cannot determine agency: ' + scopeErr?.message });
    }

    const filename = `posts/${agencyId}/${Date.now()}.${ext}`;
    const contentType = `image/${match[1]}`;

    const blob = await put(filename, buffer, {
      access: 'public',
      contentType,
      token: blobToken,
    });
    return res.json({ success: true, url: blob.url });
  } catch (e: any) {
    console.error('Upload error:', e?.message);
    res.status(500).json({ error: e?.message || 'Upload failed' });
  }
});

/**
 * POST /api/upload/request-upload-url
 * Generate a client-upload token for direct browser-to-Vercel-Blob uploads.
 * Used for large files like videos. The browser uploads directly using this token.
 * Body: { filename: "video.mp4", contentType: "video/mp4" }
 */
router.post('/request-upload-url', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { filename, contentType } = req.body;
    if (!filename || !contentType) {
      return res.status(400).json({ error: 'filename and contentType required' });
    }

    // Validate content type (images + videos)
    const allowedPrefixes = ['image/', 'video/'];
    if (!allowedPrefixes.some(p => contentType.startsWith(p))) {
      return res.status(400).json({ error: 'Only image and video files are allowed' });
    }

    const blobToken = process.env.BLOB_PUBLIC_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
    if (!blobToken) {
      return res.status(503).json({ error: 'Upload not configured. BLOB token not set.' });
    }

    let handleUpload: any;
    try {
      // @ts-ignore
      const blobModule = await import('@vercel/blob');
      handleUpload = blobModule.put;
    } catch (importErr: any) {
      return res.status(503).json({ error: 'Upload not available. Install @vercel/blob.' });
    }

    let agencyId: string;
    try {
      const scope = getAgencyScope(req);
      agencyId = scope.agencyId;
    } catch (scopeErr: any) {
      return res.status(400).json({ error: 'Cannot determine agency: ' + scopeErr?.message });
    }

    // Sanitize filename
    const ext = filename.split('.').pop() || 'bin';
    const safeName = `posts/${agencyId}/${Date.now()}.${ext}`;

    // For large files, we return a client upload token
    const blobModule = await import('@vercel/blob') as { generateClientTokenFromReadWriteToken?: (opts: { token: string; pathname: string; allowedContentTypes: string[] }) => Promise<string> };
    if (blobModule.generateClientTokenFromReadWriteToken) {
      // Vercel Blob v0.22+ supports client token generation
      const clientToken = await blobModule.generateClientTokenFromReadWriteToken({
        token: blobToken,
        pathname: safeName,
        allowedContentTypes: [contentType],
      });
      return res.json({ success: true, clientToken, pathname: safeName });
    }

    // Fallback: return upload config for manual upload
    return res.json({
      success: true,
      uploadUrl: safeName,
      token: blobToken,
      pathname: safeName,
    });
  } catch (e: any) {
    console.error('Upload URL error:', e?.message);
    res.status(500).json({ error: e?.message || 'Failed to generate upload URL' });
  }
});

/**
 * POST /api/upload/media
 * Upload any media file (image or video) via base64.
 * For images: same as /image but also accepts video
 * For videos: accepts up to ~50MB (will need body limit increase for this route)
 * Body: { media: "data:video/mp4;base64,...", filename: "reel.mp4" }
 */
router.post('/media', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { media, filename } = req.body;

    if (!media || typeof media !== 'string') {
      return res.status(400).json({ error: 'Valid base64 media data required' });
    }

    // Support both image and video
    const isImage = media.startsWith('data:image/');
    const isVideo = media.startsWith('data:video/');
    if (!isImage && !isVideo) {
      return res.status(400).json({ error: 'Only image or video files accepted (data:image/... or data:video/...)' });
    }

    const blobToken = process.env.BLOB_PUBLIC_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
    if (!blobToken) {
      return res.status(503).json({ error: 'Upload not configured. BLOB token not set.' });
    }

    let put: any;
    try {
      // @ts-ignore
      const blobModule = await import('@vercel/blob');
      put = blobModule.put;
    } catch (importErr: any) {
      return res.status(503).json({ error: 'Upload not available. Install @vercel/blob.' });
    }

    const match = media.match(/^data:(image|video)\/(\w+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid media format' });
    }

    const mediaType = match[1]; // 'image' or 'video'
    let ext = match[2];
    if (ext === 'jpeg') ext = 'jpg';
    if (ext === 'quicktime') ext = 'mov';
    const buffer = Buffer.from(match[3], 'base64');

    let agencyId: string;
    try {
      const scope = getAgencyScope(req);
      agencyId = scope.agencyId;
    } catch (scopeErr: any) {
      return res.status(400).json({ error: 'Cannot determine agency: ' + scopeErr?.message });
    }

    const blobFilename = `posts/${agencyId}/${Date.now()}.${ext}`;
    const contentType = `${mediaType}/${match[2]}`;

    const blob = await put(blobFilename, buffer, {
      access: 'public',
      contentType,
      token: blobToken,
    });
    return res.json({ success: true, url: blob.url, mediaType });
  } catch (e: any) {
    console.error('Media upload error:', e?.message);
    res.status(500).json({ error: e?.message || 'Upload failed' });
  }
});

export default router;
