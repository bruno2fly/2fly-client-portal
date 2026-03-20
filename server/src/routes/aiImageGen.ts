/**
 * AI Image Generation via Google Gemini Imagen
 * POST /api/ai/generate-image — generate image from prompt + brand context
 * GET /api/ai/brand-profile?clientId=xxx — get brand profile
 * PUT /api/ai/brand-profile — save brand profile
 */

import { Router } from 'express';
import { authenticate, getAgencyScope, requireProductionAccess, requireCanViewDashboard } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { getBrandProfileByClient, saveBrandProfile, getClient, getProductionTaskById } from '../db.js';

const router = Router();

/**
 * POST /api/ai/generate-image
 * Generate an image using Gemini's image generation
 * Body: { prompt, taskId?, clientId, enhanceWithBrand?: boolean }
 */
router.post('/generate-image', authenticate, requireProductionAccess, async (req: AuthenticatedRequest, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'Gemini not configured. Set GEMINI_API_KEY in environment.' });
    }

    const { agencyId } = getAgencyScope(req);
    const { prompt, taskId, clientId, enhanceWithBrand } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'prompt is required' });
    }

    // Build enhanced prompt with brand context
    let fullPrompt = prompt;

    if (enhanceWithBrand !== false && clientId) {
      const profile = getBrandProfileByClient(agencyId, clientId);
      if (profile) {
        const brandContext = [];
        if (profile.brandName) brandContext.push(`Brand: ${profile.brandName}`);
        if (profile.industry) brandContext.push(`Industry: ${profile.industry}`);
        if (profile.visualStyle) brandContext.push(`Visual style: ${profile.visualStyle}`);
        if (profile.primaryColors.length > 0) brandContext.push(`Brand colors: ${profile.primaryColors.join(', ')}`);
        if (profile.fontStyle) brandContext.push(`Typography: ${profile.fontStyle}`);
        if (profile.targetAudience) brandContext.push(`Target audience: ${profile.targetAudience}`);
        if (profile.dontList.length > 0) brandContext.push(`Avoid: ${profile.dontList.join(', ')}`);
        if (profile.additionalNotes) brandContext.push(`Notes: ${profile.additionalNotes}`);

        if (brandContext.length > 0) {
          fullPrompt = `${prompt}\n\nBrand context for visual consistency:\n${brandContext.join('\n')}`;
        }
      }
    }

    // Add task context if provided
    if (taskId) {
      const task = getProductionTaskById(taskId);
      if (task) {
        const taskContext = [];
        if (task.caption) taskContext.push(`Post caption: ${task.caption}`);
        if (task.briefNotes) taskContext.push(`Brief: ${task.briefNotes}`);
        if (taskContext.length > 0) {
          fullPrompt += `\n\nPost context:\n${taskContext.join('\n')}`;
        }
      }
    }

    console.log(`[ai-image] Generating image. Prompt length: ${fullPrompt.length}`);

    // Call Gemini API for image generation using Imagen 3
    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: fullPrompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: '1:1',
          safetyFilterLevel: 'block_few',
        },
      }),
    });

    const geminiData: any = await geminiRes.json();

    if (geminiData.error) {
      console.error('[ai-image] Gemini error:', geminiData.error);
      return res.status(422).json({ error: geminiData.error.message || 'Image generation failed' });
    }

    // Extract base64 image from response
    const predictions = geminiData.predictions;
    if (!predictions || predictions.length === 0) {
      return res.status(422).json({ error: 'No image generated. Try a different prompt.' });
    }

    const imageBase64 = predictions[0].bytesBase64Encoded;
    const mimeType = predictions[0].mimeType || 'image/png';

    // Upload to Vercel Blob for a persistent URL
    const blobToken = process.env.BLOB_PUBLIC_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
    if (!blobToken) {
      // Return base64 directly if no blob storage
      return res.json({
        success: true,
        imageUrl: `data:${mimeType};base64,${imageBase64}`,
        isBase64: true,
        prompt: fullPrompt,
      });
    }

    let put: any;
    try {
      const blob = await import('@vercel/blob');
      put = blob.put;
    } catch {
      return res.json({
        success: true,
        imageUrl: `data:${mimeType};base64,${imageBase64}`,
        isBase64: true,
        prompt: fullPrompt,
      });
    }

    const buffer = Buffer.from(imageBase64, 'base64');
    const ext = mimeType.includes('png') ? 'png' : 'jpg';
    const filename = `ai-generated/${agencyId}/${Date.now()}.${ext}`;

    const blobResult = await put(filename, buffer, {
      access: 'public',
      contentType: mimeType,
      token: blobToken,
    });

    res.json({
      success: true,
      imageUrl: blobResult.url,
      isBase64: false,
      prompt: fullPrompt,
    });
  } catch (err: any) {
    console.error('[ai-image] Error:', err.message);
    res.status(500).json({ error: 'Image generation failed: ' + (err.message || 'Unknown error') });
  }
});

/**
 * GET /api/ai/brand-profile?clientId=xxx
 */
router.get('/brand-profile', authenticate, requireCanViewDashboard, (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const clientId = req.query.clientId as string;
    if (!clientId) return res.status(400).json({ error: 'clientId required' });

    const profile = getBrandProfileByClient(agencyId, clientId);
    res.json({ success: true, profile: profile || null });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * PUT /api/ai/brand-profile
 * Body: { clientId, ...profile fields }
 */
router.put('/brand-profile', authenticate, requireCanViewDashboard, (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const { clientId, ...fields } = req.body;
    if (!clientId) return res.status(400).json({ error: 'clientId required' });

    const client = getClient(clientId);
    if (!client || client.agencyId !== agencyId) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const existing = getBrandProfileByClient(agencyId, clientId);
    const now = Date.now();

    const profile = {
      id: existing?.id || `bp_${agencyId}_${clientId}`,
      agencyId,
      clientId,
      brandName: fields.brandName || existing?.brandName || client.name || '',
      industry: fields.industry || existing?.industry || '',
      brandDescription: fields.brandDescription || existing?.brandDescription || '',
      primaryColors: fields.primaryColors || existing?.primaryColors || [],
      secondaryColors: fields.secondaryColors || existing?.secondaryColors || [],
      fontStyle: fields.fontStyle || existing?.fontStyle || '',
      logoDescription: fields.logoDescription || existing?.logoDescription || '',
      brandVoice: fields.brandVoice || existing?.brandVoice || '',
      visualStyle: fields.visualStyle || existing?.visualStyle || '',
      targetAudience: fields.targetAudience || existing?.targetAudience || '',
      doList: fields.doList || existing?.doList || [],
      dontList: fields.dontList || existing?.dontList || [],
      samplePostDescriptions: fields.samplePostDescriptions || existing?.samplePostDescriptions || [],
      referenceImageUrls: fields.referenceImageUrls || existing?.referenceImageUrls || [],
      additionalNotes: fields.additionalNotes || existing?.additionalNotes || '',
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    saveBrandProfile(profile);
    res.json({ success: true, profile });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/ai/status — check if Gemini is configured
 */
router.get('/status', authenticate, (req, res) => {
  res.json({
    geminiEnabled: !!process.env.GEMINI_API_KEY,
    openaiEnabled: !!process.env.OPENAI_API_KEY,
  });
});

export default router;
