/**
 * AI Co-Pilot for designers.
 * Context-aware chat powered by OpenAI GPT-4.
 * Auto-injects: selected client, current task, brand style, content type.
 */

import { Router } from 'express';
import { authenticate, requireProductionAccess } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import {
  getProductionTasksByDesigner,
  getProductionTaskById,
  getClient,
  getPortalState,
} from '../db.js';
import OpenAI from 'openai';

const router = Router();

// Initialize OpenAI (key from env)
function getOpenAI(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

// System prompt for the designer co-pilot
const SYSTEM_PROMPT = `You are 2Fly Co-Pilot, an AI assistant embedded inside a design production tool for social media agencies.
You help designers move faster with less thinking. You do NOT replace them.

RULES:
- Responses must be SHORT and actionable (max 2-3 paragraphs)
- No long explanations — prioritize outputs designers can use immediately
- Use bullet points for lists, keep them concise
- When generating prompts for AI image generation (Gemini/Midjourney/DALL-E), make them detailed and production-ready
- When improving copy, keep the brand voice and tone
- When suggesting ideas, give 2-3 distinct visual directions
- Always consider the brand context and client style when provided
- Speak like a creative director giving quick feedback to a junior designer
- Use simple language, no jargon unless design-specific

CAPABILITIES:
1. Generate Prompt — Create structured AI image generation prompts
2. Give Ideas — 2-3 visual directions with layout and mood
3. Improve Copy — Enhance captions, translate, shorten
4. References — Suggest visual styles and composition ideas
5. Variations — Multiple versions of an idea or prompt`;

// Quick action system prompts
const ACTION_PROMPTS: Record<string, string> = {
  generate_prompt: `The designer wants you to generate a detailed AI image generation prompt (for Gemini/Midjourney).
Based on the task context provided, create a structured prompt that includes:
- Subject/scene description
- Style/aesthetic direction
- Color palette suggestion
- Composition/layout guidance
- Mood/atmosphere
Format the prompt ready to copy-paste into an AI image generator.`,

  give_ideas: `The designer wants creative visual ideas for this task.
Provide exactly 2-3 distinct visual directions. For each:
- Visual concept (1 sentence)
- Layout suggestion
- Color/mood direction
- Why it works for this brand/content
Keep each direction to 3-4 lines max.`,

  improve_copy: `The designer wants to improve the caption/copy for this content.
Provide:
- Improved version (same language as original)
- Shorter version (for stories/reels)
- English translation (if original is not English)
Keep the brand voice. Be concise.`,

  references: `The designer wants visual reference suggestions for this task.
Suggest:
- 2-3 visual styles that would work (name the aesthetic)
- Composition ideas (rule of thirds, centered, asymmetric, etc.)
- Typography direction
- Similar brands/accounts to reference for inspiration
Keep suggestions actionable — things they can search for or replicate.`,

  variations: `The designer wants variations of the current concept.
Generate 3 different takes:
1. Safe/on-brand version
2. Bold/experimental version
3. Trending/viral-style version
For each, briefly describe the visual approach and any copy adjustments.`,
};

// POST /api/ai-copilot/chat
router.post('/chat', authenticate, requireProductionAccess, async (req: AuthenticatedRequest, res) => {
  try {
    const openai = getOpenAI();
    if (!openai) {
      return res.status(503).json({ error: 'AI Co-Pilot not configured. Set OPENAI_API_KEY in environment.' });
    }

    const { message, action, taskId, clientId, conversationHistory } = req.body;

    if (!message && !action) {
      return res.status(400).json({ error: 'Message or action required.' });
    }

    // Build context from task and client data
    let contextParts: string[] = [];

    // Get task context if provided
    if (taskId) {
      const task = getProductionTaskById(taskId);
      if (task) {
        contextParts.push(`CURRENT TASK:`);
        contextParts.push(`- Title/Caption: ${task.caption || task.title || 'Untitled'}`);
        contextParts.push(`- Status: ${task.status}`);
        contextParts.push(`- Priority: ${task.priority || 'medium'}`);
        contextParts.push(`- Deadline: ${task.deadline || 'none'}`);
        if (task.briefNotes) contextParts.push(`- Brief Notes: ${task.briefNotes}`);
        if (task.reviewNotes) contextParts.push(`- Review Notes (from manager): ${task.reviewNotes}`);
        if (task.referenceImages && task.referenceImages.length > 0) {
          contextParts.push(`- Reference Images: ${task.referenceImages.length} provided`);
        }

        // Get client info from task
        const effectiveClientId = clientId || task.clientId;
        if (effectiveClientId) {
          const client = getClient(effectiveClientId);
          if (client) {
            contextParts.push(`\nCLIENT:`);
            contextParts.push(`- Name: ${client.name}`);
            if ((client as any).industry) contextParts.push(`- Industry: ${(client as any).industry}`);
            if ((client as any).brandVoice) contextParts.push(`- Brand Voice: ${(client as any).brandVoice}`);
            if ((client as any).targetAudience) contextParts.push(`- Target Audience: ${(client as any).targetAudience}`);
          }
        }
      }
    } else if (clientId) {
      const client = getClient(clientId);
      if (client) {
        contextParts.push(`CLIENT:`);
        contextParts.push(`- Name: ${client.name}`);
        if ((client as any).industry) contextParts.push(`- Industry: ${(client as any).industry}`);
        if ((client as any).brandVoice) contextParts.push(`- Brand Voice: ${(client as any).brandVoice}`);
        if ((client as any).targetAudience) contextParts.push(`- Target Audience: ${(client as any).targetAudience}`);
      }
    }

    // Build messages array
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
    ];

    // Add context if available
    if (contextParts.length > 0) {
      messages.push({
        role: 'system',
        content: `CONTEXT (auto-injected from the designer's current workspace):\n${contextParts.join('\n')}`,
      });
    }

    // Add action-specific instruction if quick action
    if (action && ACTION_PROMPTS[action]) {
      messages.push({
        role: 'system',
        content: ACTION_PROMPTS[action],
      });
    }

    // Add conversation history (last 10 messages max)
    if (conversationHistory && Array.isArray(conversationHistory)) {
      const recent = conversationHistory.slice(-10);
      recent.forEach((msg: { role: string; content: string }) => {
        if (msg.role === 'user' || msg.role === 'assistant') {
          messages.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
        }
      });
    }

    // Add current message
    const userMessage = action
      ? `[Quick Action: ${action.replace(/_/g, ' ').toUpperCase()}] ${message || 'Help me with this task.'}`
      : message;

    messages.push({ role: 'user', content: userMessage });

    // Call OpenAI
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      max_tokens: 800,
      temperature: 0.7,
    });

    const reply = completion.choices[0]?.message?.content || 'No response generated.';

    res.json({
      reply,
      usage: {
        promptTokens: completion.usage?.prompt_tokens,
        completionTokens: completion.usage?.completion_tokens,
      },
    });
  } catch (err: any) {
    console.error('[AI Co-Pilot] Error:', err.message);
    if (err.status === 401 || err.code === 'invalid_api_key') {
      return res.status(503).json({ error: 'Invalid OpenAI API key.' });
    }
    if (err.status === 429) {
      return res.status(429).json({ error: 'Rate limit exceeded. Try again in a moment.' });
    }
    res.status(500).json({ error: 'AI Co-Pilot error: ' + (err.message || 'Unknown error') });
  }
});

// GET /api/ai-copilot/status — check if AI is configured
router.get('/status', authenticate, (req, res) => {
  const hasKey = !!process.env.OPENAI_API_KEY;
  res.json({ enabled: hasKey });
});

export default router;
