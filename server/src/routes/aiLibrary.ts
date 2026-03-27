/**
 * AI Library routes
 *
 * Endpoints for:
 * - Brand Kit CRUD
 * - AI prompt enhancement with OpenAI GPT
 * - AI Image generation with DALL-E 3
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

// ── Helpers ──

function getOpenAIKey(): string {
  return process.env.OPENAI_API_KEY || '';
}

/**
 * Use GPT-4o-mini to enhance a user prompt with brand kit context
 * into an optimized DALL-E 3 image generation prompt
 */
async function enhancePromptWithAI(
  userPrompt: string,
  brandKit: BrandKit | null,
  format: { w: number; h: number; label: string }
): Promise<string> {
  const apiKey = getOpenAIKey();
  if (!apiKey) {
    // Fallback: manual enhancement without AI
    return buildFallbackPrompt(userPrompt, brandKit, format);
  }

  let brandContext = '';
  if (brandKit) {
    const parts: string[] = [];
    if (brandKit.colors.length) parts.push('Brand colors: ' + brandKit.colors.map(c => `${c.name || ''} ${c.hex}`).join(', '));
    if (brandKit.styleTags.length) parts.push('Visual style: ' + brandKit.styleTags.join(', '));
    if (brandKit.photoStyle) parts.push('Photo style: ' + brandKit.photoStyle);
    if (brandKit.rulesText) parts.push('Brand rules: ' + brandKit.rulesText);
    if (brandKit.fonts?.heading) parts.push('Font style: ' + brandKit.fonts.heading);
    brandContext = parts.join('\n');
  }

  const systemPrompt = `You are an expert social media visual designer and prompt engineer for DALL-E 3 image generation.

Your job: Take a brief content description and brand guidelines, then create a detailed, optimized DALL-E 3 prompt that will generate a professional, high-quality social media image.

Rules:
- Output ONLY the image generation prompt, nothing else
- Be specific about composition, lighting, colors, mood, and style
- Incorporate the brand colors and style naturally (don't just list them)
- Specify the image should be ${format.label} aspect ratio
- Make it feel like premium, agency-quality social media content
- Do NOT include any text/typography in the image description (DALL-E handles text poorly)
- Focus on visuals, photography style, and mood
- Keep the prompt under 300 words`;

  const userMessage = brandContext
    ? `Content brief: ${userPrompt}\n\nBrand guidelines:\n${brandContext}\n\nFormat: ${format.label} (${format.w}x${format.h})`
    : `Content brief: ${userPrompt}\n\nFormat: ${format.label} (${format.w}x${format.h})`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        max_tokens: 500,
        temperature: 0.8
      })
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error('[AI Library] OpenAI prompt enhancement failed:', errBody);
      return buildFallbackPrompt(userPrompt, brandKit, format);
    }

    const data = await res.json() as any;
    const enhanced = data.choices?.[0]?.message?.content?.trim();
    if (!enhanced) return buildFallbackPrompt(userPrompt, brandKit, format);

    console.log(`[AI Library] Prompt enhanced: "${userPrompt.slice(0, 50)}..." → ${enhanced.length} chars`);
    return enhanced;
  } catch (err: any) {
    console.error('[AI Library] Prompt enhancement error:', err.message);
    return buildFallbackPrompt(userPrompt, brandKit, format);
  }
}

/**
 * Fallback prompt builder when OpenAI is unavailable
 */
function buildFallbackPrompt(
  userPrompt: string,
  brandKit: BrandKit | null,
  format: { w: number; h: number; label: string }
): string {
  const parts: string[] = [userPrompt];
  if (brandKit) {
    if (brandKit.styleTags.length) parts.push('Visual style: ' + brandKit.styleTags.join(', '));
    if (brandKit.photoStyle) parts.push('Photo style: ' + brandKit.photoStyle);
    if (brandKit.colors.length) parts.push('Using brand colors: ' + brandKit.colors.map(c => c.hex).join(', '));
    if (brandKit.rulesText) parts.push(brandKit.rulesText);
  }
  parts.push(`Professional social media image, ${format.label} format, high quality`);
  return parts.join('. ');
}

/**
 * Generate an image using DALL-E 3 and upload to Vercel Blob
 */
async function generateWithDallE3(
  prompt: string,
  size: '1024x1024' | '1024x1792' | '1792x1024'
): Promise<{ url: string; revisedPrompt: string }> {
  const apiKey = getOpenAIKey();
  if (!apiKey) throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY in environment variables.');

  console.log(`[AI Library] Calling DALL-E 3 (size: ${size})...`);
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size,
      quality: 'hd',
      response_format: 'b64_json'
    })
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error('[AI Library] DALL-E 3 error:', errBody);
    let errMsg = 'DALL-E 3 generation failed';
    try {
      const errJson = JSON.parse(errBody);
      errMsg = errJson.error?.message || errMsg;
    } catch {}
    throw new Error(errMsg);
  }

  const data = await res.json() as any;
  const imageB64 = data.data?.[0]?.b64_json;
  const revisedPrompt = data.data?.[0]?.revised_prompt || prompt;

  if (!imageB64) throw new Error('No image data in DALL-E 3 response');

  // Upload to Vercel Blob for persistence
  const imageUrl = await uploadToVercelBlob(imageB64, `ai-library/ai_${generateId()}_${Date.now()}.png`);
  console.log(`[AI Library] Image uploaded to Vercel Blob: ${imageUrl}`);

  return { url: imageUrl, revisedPrompt };
}

/**
 * Upload base64 image data to Vercel Blob
 */
async function uploadToVercelBlob(base64Data: string, pathname: string): Promise<string> {
  const blobToken = process.env.BLOB_PUBLIC_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    // Fallback: save locally
    console.warn('[AI Library] No Vercel Blob token, saving locally');
    return saveLocally(base64Data, pathname);
  }

  try {
    const blob = await import('@vercel/blob');
    const buffer = Buffer.from(base64Data, 'base64');
    const result = await blob.put(pathname, buffer, {
      access: 'public',
      token: blobToken,
      contentType: 'image/png'
    });
    return result.url;
  } catch (err: any) {
    console.error('[AI Library] Vercel Blob upload failed, saving locally:', err.message);
    return saveLocally(base64Data, pathname);
  }
}

/**
 * Fallback: save image locally
 */
async function saveLocally(base64Data: string, pathname: string): Promise<string> {
  const { writeFileSync, existsSync, mkdirSync } = await import('fs');
  const { join, basename } = await import('path');
  const uploadsDir = join(process.cwd(), 'uploads', 'ai-library');
  if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
  const filename = basename(pathname);
  writeFileSync(join(uploadsDir, filename), Buffer.from(base64Data, 'base64'));
  return `/uploads/ai-library/${filename}`;
}


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

// ── AI Image Generation (DALL-E 3) ──

// POST /api/ai-library/generate
router.post('/generate', authenticate, async (req: AuthenticatedRequest, res) => {
  const { clientId, prompt, format, variationsCount } = req.body;
  if (!clientId || !prompt) return res.status(400).json({ error: 'clientId and prompt required' });

  try {
    const agencyId = (req as any).user?.agencyId || '';
    const userId = (req as any).user?.id || '';
    const kit = getBrandKitByClient(clientId);

    const formatMap: Record<string, { w: number; h: number; label: string; dalleSize: '1024x1024' | '1024x1792' | '1792x1024' }> = {
      feed:       { w: 1080, h: 1080, label: '1080x1080 (Feed)',       dalleSize: '1024x1024' },
      story:      { w: 1080, h: 1920, label: '1080x1920 (Story)',      dalleSize: '1024x1792' },
      carousel:   { w: 1080, h: 1350, label: '1080x1350 (Carousel)',   dalleSize: '1024x1024' },
      ad_banner:  { w: 1200, h: 628,  label: '1200x628 (Ad Banner)',   dalleSize: '1792x1024' }
    };
    const fmt = formatMap[format] || formatMap.feed;

    const count = Math.min(Math.max(variationsCount || 3, 1), 5);
    const batchId = generateId();
    const generatedImages: AIImage[] = [];

    // Step 1: Enhance prompt with AI (once for the batch)
    console.log(`[AI Library] Enhancing prompt for ${count} variations...`);
    const enhancedPrompt = await enhancePromptWithAI(prompt, kit, fmt);
    console.log(`[AI Library] Enhanced prompt (${enhancedPrompt.length} chars): "${enhancedPrompt.slice(0, 100)}..."`);

    // Step 2: Generate each variation with DALL-E 3
    for (let i = 0; i < count; i++) {
      try {
        console.log(`[AI Library] Generating variation ${i + 1}/${count}...`);

        // Slight variation in prompt for each generation to get different results
        const variationPrompt = count > 1 && i > 0
          ? `${enhancedPrompt} (Variation ${i + 1}: different composition and angle)`
          : enhancedPrompt;

        const result = await generateWithDallE3(variationPrompt, fmt.dalleSize);
        const now = Date.now();

        const aiImg: AIImage = {
          id: generateId(),
          clientId,
          agencyId,
          brandKitId: kit?.id || null,
          prompt,
          enhancedPrompt: result.revisedPrompt || enhancedPrompt,
          imageUrl: result.url,
          thumbnailUrl: result.url,
          format: format as AIImage['format'] || 'feed',
          formatDimensions: fmt.label,
          status: 'pending_approval',
          generatedBy: userId,
          approvedBy: null,
          approvalDate: null,
          feedback: '',
          usedInPostId: null,
          modelUsed: 'dall-e-3',
          batchId,
          createdAt: now,
          updatedAt: now
        };

        saveAIImage(aiImg);
        generatedImages.push(aiImg);
        console.log(`[AI Library] Variation ${i + 1} saved: ${aiImg.id}`);
      } catch (err: any) {
        console.error(`[AI Library] Variation ${i + 1} failed:`, err.message);
        // Continue with next variation
      }
    }

    if (generatedImages.length === 0) {
      return res.status(500).json({ error: 'Failed to generate any images. Check your OpenAI API key and quota.' });
    }

    res.json({
      images: generatedImages,
      batchId,
      count: generatedImages.length,
      enhancedPrompt
    });
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
    const kit = getBrandKitByClient(img.clientId);

    const formatMap: Record<string, { w: number; h: number; label: string; dalleSize: '1024x1024' | '1024x1792' | '1792x1024' }> = {
      feed:       { w: 1080, h: 1080, label: '1080x1080 (Feed)',       dalleSize: '1024x1024' },
      story:      { w: 1080, h: 1920, label: '1080x1920 (Story)',      dalleSize: '1024x1792' },
      carousel:   { w: 1080, h: 1350, label: '1080x1350 (Carousel)',   dalleSize: '1024x1024' },
      ad_banner:  { w: 1200, h: 628,  label: '1200x628 (Ad Banner)',   dalleSize: '1792x1024' }
    };
    const fmt = formatMap[img.format] || formatMap.feed;

    // Enhance prompt
    const enhancedPrompt = await enhancePromptWithAI(newPrompt, kit, fmt);

    // Generate with DALL-E 3
    const result = await generateWithDallE3(enhancedPrompt, fmt.dalleSize);
    const now = Date.now();

    const newImg: AIImage = {
      ...img,
      id: generateId(),
      prompt: newPrompt,
      enhancedPrompt: result.revisedPrompt || enhancedPrompt,
      imageUrl: result.url,
      thumbnailUrl: result.url,
      status: 'pending_approval',
      approvedBy: null,
      approvalDate: null,
      feedback: '',
      modelUsed: 'dall-e-3',
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
