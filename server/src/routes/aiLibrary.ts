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
  getReferencesByAgency, getReferencesByClient, saveReference, deleteReference, referenceExistsForUrl,
  type BrandKit, type AIImage, type ReferenceImage
} from '../db.js';
import { generateId } from '../utils/auth.js';
import { getBrandKit, type BrandKitEntry } from '../lib/brandKits.js';

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

// ── Prompt Generator (assembles a photographer-template prompt) ──

// Maps the brand-kit slug values onto human-readable labels used inside the prompt.
const ANGLE_LABELS: Record<string, string> = {
  'low-frontal': 'Low frontal angle (10°) — camera positioned slightly below eye level, looking up at the subject',
  '45-overhead': '45° overhead angle — camera tilted down onto the subject',
  'top-down': 'Top-down / flat lay — camera directly above the subject',
  'side': 'Side profile — camera positioned level with and to the side of the subject',
};
const MOOD_LIGHTING: Record<string, string> = {
  'moody-warm': 'Moody amber fill with deep shadows, cinematic warmth, highlights kept controlled',
  'dark-luxe': 'Low-key dark luxe lighting, single hard key, glossy highlights, rich blacks',
  'bright-fresh': 'Bright, airy daylight feel with soft diffused fill and minimal shadow',
  'game-day': 'Energetic warm bar ambience with blue-white TV glow in the background, backlit bottle shelves glowing amber',
  'editorial': 'Clean editorial softbox lighting, balanced highlights and shadows, magazine-quality',
};
const MOOD_DESCRIPTIONS: Record<string, string> = {
  'moody-warm': 'Cinematic, seductive, premium. Warm and inviting.',
  'dark-luxe': 'High-end, luxurious, mysterious. Expensive nightlife energy.',
  'bright-fresh': 'Clean, approachable, modern. Daytime-friendly.',
  'game-day': 'Energetic, social, fun. Classic American sports bar vibe.',
  'editorial': 'Polished, refined, editorial quality.',
};
const FORMAT_PIXEL_LABEL: Record<string, string> = {
  feed: '1080x1080',
  portrait: '1080x1350',
  story: '1080x1920',
};

interface AdvancedOptions {
  shotType?: string;
  angle?: string;
  lens?: string;
  mood?: string;
  format?: string;
}
interface ImageDescriptions {
  ambient: string;
  subject: string;
  reference?: string;
}

function resolveMood(moodSlug: string): { lighting: string; description: string; label: string } {
  const key = String(moodSlug).toLowerCase();
  const lighting = MOOD_LIGHTING[key] || 'Warm key light from the right with soft rim lighting';
  const description = MOOD_DESCRIPTIONS[key] || 'Cinematic, premium, commercial-quality.';
  const label = key.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return { lighting, description, label };
}
function resolveAngle(angleSlug: string): string {
  return ANGLE_LABELS[String(angleSlug).toLowerCase()] || angleSlug;
}
function resolveFormatLabel(format: string, kit: BrandKitEntry | null): string {
  if (!format && kit) return kit.outputFormat;
  // Accept either the keyword or the pixel string
  if (/^\d+x\d+$/.test(format)) return format;
  return FORMAT_PIXEL_LABEL[format] || (kit?.outputFormat || '1080x1350');
}

function buildPromptFromKit(
  kit: BrandKitEntry,
  opts: {
    shotType: string;
    lens: string;
    angleSlug: string;
    moodSlug: string;
    format: string;
    imageDescriptions: ImageDescriptions;
  }
): string {
  const { shotType, lens, angleSlug, moodSlug, format, imageDescriptions } = opts;
  const mood = resolveMood(moodSlug);
  const angleText = resolveAngle(angleSlug);
  const formatLabel = resolveFormatLabel(format, kit);
  const refCount = imageDescriptions.reference ? 3 : 2;

  const refList: string[] = [];
  refList.push(`(1) ${imageDescriptions.subject}`);
  refList.push(`(2) the ${kit.venue} — ${imageDescriptions.ambient || kit.ambientDescription}`);
  if (imageDescriptions.reference) refList.push(`(3) ${imageDescriptions.reference}`);

  const lines: string[] = [];
  lines.push(`I am providing ${refCount} reference images: ${refList.join(', and ')}.`);
  lines.push('');
  lines.push(`TASK: Create a high-end ${shotType} photography shot combining both references.`);
  lines.push('');
  lines.push('CAMERA & LENS SETUP:');
  lines.push(`- Shot with a ${lens} prime lens`);
  lines.push(`- Aperture: f/2.0 — subject tack-sharp, background beautifully blurred`);
  lines.push(`- ${angleText}`);
  lines.push(`- Camera placed 30-40cm from the subject`);
  lines.push('');
  lines.push('COMPOSITION:');
  lines.push('- Subject is the hero, positioned center-left of frame');
  lines.push('- Rule of thirds composition');
  lines.push(`- ${kit.ambientDescription} visible in background, out of focus`);
  lines.push('');
  lines.push('LIGHTING:');
  lines.push('- Warm key light from the right');
  lines.push(`- ${mood.lighting}`);
  if (kit.forbiddenElements && kit.forbiddenElements.length > 0) {
    lines.push(`- IMPORTANT: Do NOT include ${kit.forbiddenElements.join(', ')} in the image`);
  }
  lines.push('');
  lines.push(`MOOD: ${mood.label}. ${mood.description}`);
  lines.push('');
  lines.push(`OUTPUT: ${formatLabel} pixels. Photorealistic. Commercial photography quality. No text, no watermarks.`);
  return lines.join('\n');
}

// ── Design Brief helpers ──

const STYLE_LABELS: Record<string, string> = {
  'bold-colorful': 'Bold & Colorful',
  'clean-minimal': 'Clean & Minimal',
  'festive': 'Festive',
  'professional': 'Professional',
};

interface BriefOptions {
  style?: string;
  format?: string;
  copy?: string;
  hasProduct?: boolean;
  hasReference?: boolean;
  productDescription?: string;
  referenceDescription?: string;
}

function buildDesignBrief(
  kit: BrandKitEntry,
  briefOpts: BriefOptions,
): string {
  // styleLabel is kept in metadata/use if needed, but the new Gemini-prompt
  // template embeds the style via the kit's styleDescription rather than a label.
  const styleKey = String(briefOpts.style || kit.style || 'bold-colorful').toLowerCase();
  // Surface the style label internally (unused in output, but validates the key).
  void (STYLE_LABELS[styleKey] || styleKey);

  const formatLabel = resolveFormatLabel(briefOpts.format || '', kit);
  const copy = (briefOpts.copy || '').trim();
  const hasProduct = briefOpts.hasProduct !== false; // default true if caller didn't specify
  const hasReference = !!briefOpts.hasReference;
  const productDesc = (briefOpts.productDescription && briefOpts.productDescription.trim())
    || 'user-uploaded product photo (use as the hero of the composition)';
  const colors = (kit.colorPalette && kit.colorPalette.length)
    ? kit.colorPalette.join(', ')
    : '[brand colors on file]';
  const styleDesc = kit.styleDescription || 'clean, on-brand';
  const forbiddenLine = (kit.forbiddenElements && kit.forbiddenElements.length)
    ? 'AVOID: ' + kit.forbiddenElements.join(', ') + '.'
    : '';

  // Intro sentence adapts to which assets were provided.
  const assets: string[] = [];
  assets.push(hasProduct ? 'a product photo' : '[no product photo provided]');
  if (hasReference) assets.push('a reference flyer style');
  const intro = `I am providing ${assets.join(' and ')}. ` +
    `Create a promotional Instagram post at ${formatLabel}.`;

  const lines: string[] = [intro, ''];
  lines.push(`PRODUCT: ${hasProduct ? productDesc : '[describe the product here]'}`);
  if (copy) lines.push(`COPY TO INCLUDE: "${copy}"`);
  if (hasReference) lines.push('MATCH THE STYLE of the reference flyer provided.');
  lines.push('');
  lines.push(`DESIGN STYLE: Bold, vibrant, eye-catching. ${styleDesc}.`);
  lines.push(`BRAND COLORS: ${colors}`);
  lines.push(`LOGO: Place the ${kit.clientName} logo at the top center.`);
  if (forbiddenLine) lines.push(forbiddenLine);
  lines.push('');
  lines.push(`OUTPUT: ${formatLabel} pixels. High quality. Ready for Instagram.`);
  return lines.join('\n');
}

// POST /api/ai-library/generate-prompt
router.post('/generate-prompt', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { clientId, mode, outputType, advancedOptions, imageDescriptions, briefOptions } = req.body as {
      clientId?: string;
      mode?: 'quick' | 'advanced';
      outputType?: 'photography-prompt' | 'design-brief';
      advancedOptions?: AdvancedOptions;
      imageDescriptions?: ImageDescriptions;
      briefOptions?: BriefOptions;
    };

    if (!clientId) return res.status(400).json({ error: 'clientId required' });

    const kit = getBrandKit(clientId);
    if (!kit) return res.status(404).json({ error: `No brand kit found for client "${clientId}"` });

    const runMode: 'quick' | 'advanced' = mode === 'advanced' ? 'advanced' : 'quick';
    const runOutputType: 'photography-prompt' | 'design-brief' =
      outputType === 'design-brief' || outputType === 'photography-prompt'
        ? outputType
        : (kit.defaultOutputType || 'photography-prompt');

    // ── Design Brief branch ──
    if (runOutputType === 'design-brief') {
      const brief = buildDesignBrief(kit, briefOptions || {});
      return res.json({
        prompt: brief,
        metadata: {
          client: kit.clientName,
          template: 'design-brief',
          clientType: kit.clientType,
          timestamp: new Date().toISOString(),
        },
      });
    }

    // ── Photography Prompt branch (original behavior) ──
    if (!imageDescriptions || !imageDescriptions.ambient || !imageDescriptions.subject) {
      return res.status(400).json({ error: 'imageDescriptions.ambient and imageDescriptions.subject are required' });
    }

    const shotType = (runMode === 'advanced' && advancedOptions?.shotType) || inferShotTypeFromTemplate(kit.photographerTemplate);
    const lens = (runMode === 'advanced' && advancedOptions?.lens) || kit.defaultLens;
    const angleSlug = (runMode === 'advanced' && advancedOptions?.angle) || kit.defaultAngle;
    const moodSlug = (runMode === 'advanced' && advancedOptions?.mood) || kit.defaultMood;
    const format = (runMode === 'advanced' && advancedOptions?.format) || kit.outputFormat;

    const prompt = buildPromptFromKit(kit, {
      shotType,
      lens,
      angleSlug,
      moodSlug,
      format,
      imageDescriptions,
    });

    return res.json({
      prompt,
      metadata: {
        client: kit.clientName,
        template: kit.photographerTemplate,
        clientType: kit.clientType,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    console.error('[ai-library/generate-prompt] error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to generate prompt' });
  }
});

function inferShotTypeFromTemplate(template: string): string {
  const t = String(template || '').toLowerCase();
  if (t.includes('bar') || t.includes('nightlife')) return 'Bar Shot';
  if (t.includes('food') || t.includes('dish')) return 'Table Shot';
  if (t.includes('overhead')) return 'Overhead';
  return 'Bar Shot';
}

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

      // Auto-save to References
      try {
        const { saveReference, referenceExistsForUrl } = await import('../db.js');
        if (img.imageUrl && !referenceExistsForUrl(img.clientId, img.imageUrl)) {
          saveReference({
            id: generateId(),
            agencyId: img.agencyId,
            clientId: img.clientId,
            imageUrl: img.imageUrl,
            source: 'ai_approved',
            sourceId: img.id,
            caption: img.prompt || '',
            platforms: [],
            publishedAt: null,
            createdAt: new Date().toISOString()
          });
          console.log(`[AI Library] Reference auto-saved for approved image ${img.id}`);
        }
      } catch (refErr: any) {
        console.warn('[AI Library] Failed to auto-save reference:', refErr.message);
      }
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

// ── References (auto-saved images) ──

// GET /api/ai-library/references?clientId=xxx (optional)
router.get('/references', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const clientId = req.query.clientId as string;
    const agencyId = (req as any).user?.agencyId || '';

    let refs: ReferenceImage[];
    if (clientId) {
      refs = getReferencesByClient(clientId);
    } else {
      refs = getReferencesByAgency(agencyId);
    }

    // Sort newest first
    refs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Apply source filter
    const source = req.query.source as string;
    if (source) refs = refs.filter(r => r.source === source);

    res.json({ references: refs, count: refs.length });
  } catch (err: any) {
    console.error('[References] List error:', err);
    res.status(500).json({ error: 'Failed to fetch references', message: err.message });
  }
});

// DELETE /api/ai-library/references/:id
router.delete('/references/:id', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    deleteReference(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[References] Delete error:', err);
    res.status(500).json({ error: 'Failed to delete reference', message: err.message });
  }
});

// POST /api/ai-library/references — manually add a reference
router.post('/references', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { clientId, imageUrl, caption, source } = req.body;
    if (!clientId || !imageUrl) return res.status(400).json({ error: 'clientId and imageUrl required' });

    const agencyId = (req as any).user?.agencyId || '';
    if (referenceExistsForUrl(clientId, imageUrl)) {
      return res.status(409).json({ error: 'Reference already exists for this image' });
    }

    const ref: ReferenceImage = {
      id: generateId(),
      agencyId,
      clientId,
      imageUrl,
      source: source || 'client_approved',
      sourceId: null,
      caption: caption || '',
      platforms: [],
      publishedAt: null,
      createdAt: new Date().toISOString()
    };

    saveReference(ref);
    res.status(201).json({ reference: ref });
  } catch (err: any) {
    console.error('[References] Create error:', err);
    res.status(500).json({ error: 'Failed to save reference', message: err.message });
  }
});

// ── Reels Factory ──

const TONE_DESCRIPTIONS: Record<string, string> = {
  energetic: 'High-energy, fast-paced, punchy cuts, bold transitions, upbeat music sync. Think TikTok-viral energy.',
  premium: 'Sleek, cinematic, slow reveals, smooth transitions, luxury feel. Minimal text overlays, let visuals breathe.',
  warm: 'Authentic, community-driven, natural pacing, warm color grading. Feels local, personal, inviting.'
};

// POST /api/ai-library/generate-reels-brief
router.post('/generate-reels-brief', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { clientId, outputType, fileList, tone } = req.body as {
      clientId?: string;
      outputType?: string;
      fileList?: string;
      tone?: string;
    };

    if (!clientId) return res.status(400).json({ error: 'clientId required' });
    if (!fileList || !fileList.trim()) return res.status(400).json({ error: 'fileList required' });

    const kit = getBrandKit(clientId);
    const clientName = kit?.clientName || clientId;
    const toneKey = tone || 'energetic';
    const toneDesc = TONE_DESCRIPTIONS[toneKey] || TONE_DESCRIPTIONS.energetic;
    const isAd = outputType === 'ad-brief';
    const briefType = isAd ? 'Ad Brief' : 'Reels Brief';

    // Parse file list — accept comma-separated or newline-separated
    const files = fileList
      .split(/[\n,]+/)
      .map((f: string) => f.trim())
      .filter((f: string) => f.length > 0);

    // Build brand context if available
    let brandContext = '';
    if (kit) {
      const parts: string[] = [];
      if (kit.clientName) parts.push('Client: ' + kit.clientName);
      if (kit.colorPalette && kit.colorPalette.length) parts.push('Brand colors: ' + kit.colorPalette.join(', '));
      if (kit.styleDescription) parts.push('Visual style: ' + kit.styleDescription);
      if (kit.forbiddenElements && kit.forbiddenElements.length) parts.push('Avoid: ' + kit.forbiddenElements.join(', '));
      brandContext = parts.join('\n');
    }

    const apiKey = getOpenAIKey();

    if (!apiKey) {
      // Fallback: build a manual brief without AI
      const brief = buildFallbackReelsBrief(clientName, files, briefType, toneKey, toneDesc, brandContext);
      return res.json({ brief, metadata: { client: clientName, type: briefType, tone: toneKey, aiGenerated: false } });
    }

    const systemPrompt = `You are a senior video editor and social media strategist at a top creative agency.

Your job: Given a list of raw video file names from a client shoot and a desired tone, produce a structured ${briefType} that a junior editor can immediately use to start cutting.

Rules:
- Output ONLY the brief, no preamble
- Organize the files into logical scenes / sequences based on file name clues
- For each scene, specify: which files to use, suggested order, estimated clip duration, transition type
- Include an overall structure: hook (first 1-3s), body, CTA
- Suggest music/audio direction matching the tone
- Include pacing notes matching the tone
- If it's an Ad Brief, include a clear CTA callout section and ad copy suggestion
- Be specific and actionable — the editor should be able to start immediately
- Keep the brief under 600 words
- Format cleanly with sections and bullet points`;

    const userMessage = `Client: ${clientName}
Brief Type: ${briefType}
Tone: ${toneKey} — ${toneDesc}
${brandContext ? '\nBrand Guidelines:\n' + brandContext + '\n' : ''}
Raw video files from client Drive:
${files.map((f: string, i: number) => `${i + 1}. ${f}`).join('\n')}

Generate the ${briefType} now.`;

    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
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
        max_tokens: 1200,
        temperature: 0.7
      })
    });

    if (!aiRes.ok) {
      const errBody = await aiRes.text();
      console.error('[Reels Factory] OpenAI error:', errBody);
      // Fallback
      const brief = buildFallbackReelsBrief(clientName, files, briefType, toneKey, toneDesc, brandContext);
      return res.json({ brief, metadata: { client: clientName, type: briefType, tone: toneKey, aiGenerated: false } });
    }

    const data = await aiRes.json() as any;
    const brief = data.choices?.[0]?.message?.content?.trim();
    if (!brief) {
      const fb = buildFallbackReelsBrief(clientName, files, briefType, toneKey, toneDesc, brandContext);
      return res.json({ brief: fb, metadata: { client: clientName, type: briefType, tone: toneKey, aiGenerated: false } });
    }

    console.log(`[Reels Factory] Brief generated for ${clientName}: ${brief.length} chars`);
    return res.json({ brief, metadata: { client: clientName, type: briefType, tone: toneKey, aiGenerated: true } });

  } catch (err: any) {
    console.error('[Reels Factory] Error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to generate brief' });
  }
});

function buildFallbackReelsBrief(
  clientName: string,
  files: string[],
  briefType: string,
  tone: string,
  toneDesc: string,
  brandContext: string
): string {
  const lines: string[] = [];
  lines.push(`${briefType.toUpperCase()} — ${clientName}`);
  lines.push(`Tone: ${tone.charAt(0).toUpperCase() + tone.slice(1)} — ${toneDesc}`);
  lines.push('');
  lines.push('── FOOTAGE INVENTORY ──');
  files.forEach((f, i) => lines.push(`  ${i + 1}. ${f}`));
  lines.push('');
  lines.push('── SUGGESTED STRUCTURE ──');
  lines.push('HOOK (0-3s): Open with the most visually striking clip. Fast cut or zoom-in.');
  lines.push('BODY (3-12s): Cycle through key footage. Match cuts to beat drops.');
  lines.push('CTA (12-15s): End card or final shot with clear call-to-action.');
  lines.push('');
  lines.push('── PACING NOTES ──');
  lines.push(`Follow ${tone} pacing: ${toneDesc}`);
  if (brandContext) {
    lines.push('');
    lines.push('── BRAND NOTES ──');
    lines.push(brandContext);
  }
  lines.push('');
  lines.push('── MUSIC DIRECTION ──');
  lines.push(`Select a track that matches the ${tone} tone. Ensure beats align with major cuts.`);
  return lines.join('\n');
}

export default router;
