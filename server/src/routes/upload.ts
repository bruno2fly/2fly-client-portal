/**
 * Image upload for Meta publishing
 * Uses Vercel Blob when BLOB_READ_WRITE_TOKEN is set
 */

import { Router } from 'express';
import { authenticate, getAgencyScope, requireCanViewDashboard } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

/**
 * POST /api/upload/image
 * Upload base64 image and return public URL for Meta API
 * Body: { image: "data:image/jpeg;base64,..." }
 */
router.post('/image', authenticate, requireCanViewDashboard, async (req: AuthenticatedRequest, res) => {
  try {
    const { image } = req.body;
    if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Valid base64 image data required (data:image/...)' });
    }

    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    if (!blobToken) {
      return res.status(503).json({
        error: 'Image upload not configured',
        message: 'BLOB_READ_WRITE_TOKEN is not set. Use publicly accessible image URLs instead.',
      });
    }

    let put: any;
    try {
      // @ts-ignore - @vercel/blob may not be installed in all environments
      const blob = await import('@vercel/blob');
      put = blob.put;
    } catch {
      return res.status(503).json({
        error: 'Image upload not available',
        message: 'Install @vercel/blob package for image uploads. Use publicly accessible URLs instead.',
      });
    }
    const match = image.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid image format' });
    }

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const buffer = Buffer.from(match[2], 'base64');
    const { agencyId } = getAgencyScope(req);
    const filename = `posts/${agencyId}/${Date.now()}.${ext}`;

    const blob = await put(filename, buffer, {
      access: 'public',
      contentType: `image/${ext}`,
    });

    res.json({ success: true, url: blob.url });
  } catch (e: any) {
    console.error('Upload error:', e);
    res.status(500).json({ error: e.message || 'Upload failed' });
  }
});

export default router;
