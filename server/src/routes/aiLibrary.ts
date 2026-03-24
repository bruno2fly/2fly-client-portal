/**
 * AI Library routes
 *
 * Endpoints for:
 * - Brand Kit CRUD
 * - AI Image generation with Gemini Imagen
 * - AI Image approval workflow
 * - Image management (list, filter, delete, regenerate)
 */

import { Router } from 'express';
import { authenticate, requireAgencyOnly } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import {
  getBrandKitByClient, saveBrandKit, deleteBrandKit,
  getAIImages, getAIImagesByClient, getAIImagesByAgency, getAIImageById, saveAIImage, deleteAIImage,
  type BrandKit, type AIImage
} from '../db.js';
import { generateId } from '../utils/auth.js';

const router = Router();

// ── Brand Kit CRUD ──

// GET /api/ai-library/brand-kit?clientId=xxx
router.get('/brand-kit', authenticate, async (req: AuthenticatedRequest, res) => {
  const clientId = req.query.clientId as string;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });

  try {
    const kit = getBrandKitByClient(clientId);
    res.json({ brandKit: kit });
  } catch (err: any) {
    console.error('[AI Library] Get brand kit error:', err);
    res.status(500).json({ error: 'Failed to fetch brand kit', message: err.message });
  }
});

// PUT /api/ai-library/brand-kit
router.put('/brand-kit', authenticate, async (req: AuthenticatedRequest, res) => {
  const { clientId, logoUrls, colors, fonts, styleTags, photoStyle, rulesText, referenceImages } = req.body;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });

  try {
    const agencyId = (req as any).user?.agencyId || '';
    let kit = getBrandKitByClient(clientId);
    const now = Date.now();

    if (kit) {
      kit = {
        ...kit,
        logoUrls: logoUrls ?? kit.logoUrls,
        colors: colors ?? kit.colors,
        fonts: fonts ?? kit.fonts,
        styleTags: styleTags ?? kit.styleTags,
        photoStyle: photoStyle ?? kit.photoStyle,
        rulesText: rulesText ?? kit.rulesText,
        referenceImages: referenceImages ?? kit.referenceImages,
        updatedAt: now
      };
    } else {
      kit = {
        id: generateId(),
        clientId,
        agencyId,
        logoUrls: logoUrls || [],
        colors: colors || [],
        fonts: fonts || { heading: '', body: '', weights: [] },
        styleTags: styleTags || [],
        photoStyle: photoStyle || '',
        rulesText: rulesText || '',
        referenceImages: referenceImages || [],
        createdAt: now,
        updatedAt: now
      };
    }

    saveBrandKit(kit);
    res.json({ brandKit: kit });
  } catch (err: any) {
    console.error('[AI Library] Save brand kit error:', err);
    res.status(500).json({ error: 'Failed to save brand kit', message: err.message });
  }
});

// DELETE /api/ai-library/brand-kit?clientId=xxx
router.delete('/brand-kit', authenticate, async (req: AuthenticatedRequest, res) => {
  const clientId = req.query.clientId as string;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });

  try {
    const kit = getBrandKitByClient(clientId);
    if (!kit) return res.status(404).json({ error: 'Brand kit not found' });

    deleteBrandKit(kit.id);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[AI Library] Delete brand kit error:', err);
    res.status(500).json({ error: 'Failed to delete brand kit', message: err.message });
  }
});

// ── AI Image Generation ──

// POST /api/ai-library/generate
router.post('/generate', authenticate, async (req: AuthenticatedRequest, res) => {
  const { clientId, prompt, format, variationsCount } = req.body;
  if (!clientId || !prompt) return res.status(400).json({ error: 'clientId and prompt required' });

  try {
    const agencyId = (req as any).user?.agencyId || '';
    const userId = (req as any).user?.id || '';
    const kit = getBrandKitByClient(clientId);

    const formatMap: Record<string, { w: number; h: number; label: string }> = {
      feed: { w: 1080, h: 1080, label: '1080x1080' },
      story: { w: 1080, h: 1920, label: '1080x1920' },
      carousel: { w: 1080, h: 1350, label: '1080x1350' },
      ad_banner: { w: 1200, h: 628, label: '1200x628' }
    };
    const fmt = formatMap[format] || formatMap.feed;

    // Build enhanced prompt with brand kit
    let enhancedPrompt = prompt;
    if (kit) {
      const parts: string[] = [prompt];
      if (kit.styleTags.length) parts.push('Visual style: ' + kit.styleTags.join(', '));
      if (kit.photoStyle) parts.push('Photo style: ' + kit.photoStyle);
      if (kit.colors.length) parts.push('Brand colors: ' + kit.colors.map(c => c.hex).join(', '));
      if (kit.rulesText) parts.push('Rules: ' + kit.rulesText);
      enhancedPrompt = parts.join('. ');
    }
    enhancedPrompt += `. Image dimensions: ${fmt.label}. High quality, professional social media content.`;

    const count = Math.min(Math.max(variationsCount || 3, 1), 5);
    const batchId = generateId();
    const generatedImages: AIImage[] = [];

    // Call Gemini Imagen API
    const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || '';
    if (!apiKey) {
      return res.status(500).json({ error: 'Google AI API key not configured. Set GOOGLE_AI_API_KEY in environment.' });
    }

    for (let i = 0; i < count; i++) {
      try {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: `Generate an image: ${enhancedPrompt}` }] }],
              generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
            })
          }
        );

        if (!geminiRes.ok) {
          const errBody = await geminiRes.text();
          console.error('[AI Library] Gemini error:', errBody);
          continue; // Skip failed variation, try next
        }

        const geminiData = await geminiRes.json() as any;

        // Extract image from response
        let imageData: string | null = null;
        const candidates = geminiData.candidates || [];
        for (const c of candidates) {
          for (const part of (c.content?.parts || [])) {
            if (part.inlineData?.mimeType?.startsWith('image/')) {
              imageData = part.inlineData.data; // base64
              break;
            }
          }
          if (imageData) break;
        }

        if (!imageData) {
          console.warn('[AI Library] No image in Gemini response for variation', i);
          continue;
        }

        // Save image to uploads directory
        const { writeFileSync, existsSync, mkdirSync } = await import('fs');
        const { join } = await import('path');
        const uploadsDir = join(process.cwd(), 'uploads', 'ai-library');
        if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });

        const filename = `ai_${batchId}_${i}_${Date.now()}.png`;
        const filepath = join(uploadsDir, filename);
        writeFileSync(filepath, Buffer.from(imageData, 'base64'));

        const imageUrl = `/uploads/ai-library/${filename}`;
        const now = Date.now();

        const aiImg: AIImage = {
          id: generateId(),
          clientId,
          agencyId,
          brandKitId: kit?.id || null,
          prompt,
          enhancedPrompt,
          imageUrl,
          thumbnailUrl: imageUrl,
          format: format || 'feed',
          formatDimensions: fmt.label,
          status: 'pending_approval',
          generatedBy: userId,
          approvedBy: null,
          approvalDate: null,
          feedback: '',
          usedInPostId: null,
          modelUsed: 'gemini-2.0-flash-exp',
          batchId,
          createdAt: now,
          updatedAt: now
        };

        saveAIImage(aiImg);
        generatedImages.push(aiImg);
      } catch (err: any) {
        console.error('[AI Library] Variation generation error:', err);
        // Continue with next variation
      }
    }

    if (generatedImages.length === 0) {
      return res.status(500).json({ error: 'Failed to generate any images. Check API key and quota.' });
    }

    res.json({ images: generatedImages, batchId, count: generatedImages.length });
  } catch (err: any) {
    console.error('[AI Library] Generation error:', err);
    res.status(500).json({ error: 'Image generation failed: ' + (err.message || 'Unknown error') });
  }
});

// ── AI Images CRUD ──

// GET /api/ai-library/images?clientId=xxx (or all for agency)
router.get('/images', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const clientId = req.query.clientId as string;
    const agencyId = (req as any).user?.agencyId || '';

    let images: AIImage[];
    if (clientId) {
      images = getAIImagesByClient(clientId);
    } else {
      images = getAIImagesByAgency(agencyId);
    }

    // Sort by newest first
    images.sort((a, b) => b.createdAt - a.createdAt);

    // Apply filters
    const status = req.query.status as string;
    const imageFormat = req.query.format as string;
    if (status) images = images.filter(i => i.status === status);
    if (imageFormat) images = images.filter(i => i.format === imageFormat);

    res.json({ images });
  } catch (err: any) {
    console.error('[AI Library] List images error:', err);
    res.status(500).json({ error: 'Failed to fetch images', message: err.message });
  }
});

// GET /api/ai-library/images/:id
router.get('/images/:id', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const img = getAIImageById(req.params.id);
    if (!img) return res.status(404).json({ error: 'Image not found' });
    res.json({ image: img });
  } catch (err: any) {
    console.error('[AI Library] Get image error:', err);
    res.status(500).json({ error: 'Failed to fetch image', message: err.message });
  }
});

// PUT /api/ai-library/images/:id/status
router.put('/images/:id/status', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const img = getAIImageById(req.params.id);
    if (!img) return res.status(404).json({ error: 'Image not found' });

    const { status, feedback, postId } = req.body;
    const userId = (req as any).user?.id || '';
    const now = Date.now();

    if (status === 'approved') {
      img.status = 'approved';
      img.approvedBy = userId;
      img.approvalDate = now;
    } else if (status === 'rejected') {
      img.status = 'rejected';
      img.feedback = feedback || '';
    } else if (status === 'used_in_post') {
      img.status = 'used_in_post';
      img.usedInPostId = postId || null;
    } else if (status === 'pending_approval') {
      img.status = 'pending_approval';
    }

    img.updatedAt = now;
    saveAIImage(img);
    res.json({ image: img });
  } catch (err: any) {
    console.error('[AI Library] Update image status error:', err);
    res.status(500).json({ error: 'Failed to update image status', message: err.message });
  }
});

// DELETE /api/ai-library/images/:id
router.delete('/images/:id', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const img = getAIImageById(req.params.id);
    if (!img) return res.status(404).json({ error: 'Image not found' });

    deleteAIImage(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[AI Library] Delete image error:', err);
    res.status(500).json({ error: 'Failed to delete image', message: err.message });
  }
});

// POST /api/ai-library/images/:id/regenerate
router.post('/images/:id/regenerate', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const img = getAIImageById(req.params.id);
    if (!img) return res.status(404).json({ error: 'Image not found' });

    const newPrompt = req.body.prompt || img.prompt;
    const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || '';
    if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

    const kit = getBrandKitByClient(img.clientId);
    let enhancedPrompt = newPrompt;
    if (kit) {
      const parts: string[] = [newPrompt];
      if (kit.styleTags.length) parts.push('Visual style: ' + kit.styleTags.join(', '));
      if (kit.photoStyle) parts.push('Photo style: ' + kit.photoStyle);
      if (kit.colors.length) parts.push('Brand colors: ' + kit.colors.map(c => c.hex).join(', '));
      if (kit.rulesText) parts.push('Rules: ' + kit.rulesText);
      enhancedPrompt = parts.join('. ');
    }

    const formatMap: Record<string, { w: number; h: number; label: string }> = {
      feed: { w: 1080, h: 1080, label: '1080x1080' },
      story: { w: 1080, h: 1920, label: '1080x1920' },
      carousel: { w: 1080, h: 1350, label: '1080x1350' },
      ad_banner: { w: 1200, h: 628, label: '1200x628' }
    };
    const fmt = formatMap[img.format] || formatMap.feed;
    enhancedPrompt += `. Image dimensions: ${fmt.label}. High quality, professional social media content.`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Generate an image: ${enhancedPrompt}` }] }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
        })
      }
    );

    if (!geminiRes.ok) throw new Error('Gemini API returned ' + geminiRes.status);

    const geminiData = await geminiRes.json() as any;
    let imageData: string | null = null;
    for (const c of (geminiData.candidates || [])) {
      for (const part of (c.content?.parts || [])) {
        if (part.inlineData?.mimeType?.startsWith('image/')) { imageData = part.inlineData.data; break; }
      }
      if (imageData) break;
    }

    if (!imageData) throw new Error('No image in response');

    const { writeFileSync, existsSync, mkdirSync } = await import('fs');
    const { join } = await import('path');
    const uploadsDir = join(process.cwd(), 'uploads', 'ai-library');
    if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
    const filename = `ai_regen_${img.id}_${Date.now()}.png`;
    writeFileSync(join(uploadsDir, filename), Buffer.from(imageData, 'base64'));

    const now = Date.now();
    const newImg: AIImage = {
      ...img,
      id: generateId(),
      prompt: newPrompt,
      enhancedPrompt,
      imageUrl: `/uploads/ai-library/${filename}`,
      thumbnailUrl: `/uploads/ai-library/${filename}`,
      status: 'pending_approval',
      approvedBy: null,
      approvalDate: null,
      feedback: '',
      createdAt: now,
      updatedAt: now
    };
    saveAIImage(newImg);
    res.json({ image: newImg });
  } catch (err: any) {
    console.error('[AI Library] Regenerate error:', err);
    res.status(500).json({ error: 'Regeneration failed: ' + (err.message || 'Unknown') });
  }
});

export default router;
