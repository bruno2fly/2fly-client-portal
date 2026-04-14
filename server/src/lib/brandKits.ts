/**
 * Brand kit data layer for the Prompt Generator.
 *
 * Keys match the client id / slug. `getBrandKit()` tolerates a friendly name
 * or a differently-cased slug so the endpoint can be called with whatever the
 * frontend already has on hand.
 */

export type ClientType = 'restaurant' | 'butcher-cafe' | 'medspa' | 'retail';
export type OutputType = 'photography-prompt' | 'design-brief';

export interface BrandKitEntry {
  clientType: ClientType;
  clientName: string;
  venue: string;
  ambientDescription: string;
  forbiddenElements: string[];
  defaultLens: string;
  defaultAngle: string;
  defaultMood: string;
  outputFormat: string;
  photographerTemplate: string;
  defaultOutputType: OutputType;
  colorPalette: string[];
  styleDescription: string;
  style?: string;
}

export const brandKits: Record<string, BrandKitEntry> = {
  'cafe-st-petersburg': {
    clientType: 'restaurant',
    clientName: 'Cafe St. Petersburg',
    venue: 'Upscale Eastern European restaurant, Newton Centre MA',
    ambientDescription:
      'Elegant dining room with dark wood, warm amber lighting from pendant lights, blue accent bar lighting, wine glasses, intimate atmosphere',
    forbiddenElements: ['candles', 'candlelight'],
    defaultLens: '85mm f/1.8',
    defaultAngle: 'low-frontal',
    defaultMood: 'moody-warm',
    outputFormat: '1080x1350',
    photographerTemplate: 'high-end-nightlife',
    defaultOutputType: 'photography-prompt',
    colorPalette: ['#1E3A5F', '#D4A24C', '#0F172A'],
    styleDescription:
      'Elegant, warm, upscale Eastern European dining. Cinematic warmth with moody amber highlights.',
  },
  'sudbury-point-grill': {
    clientType: 'restaurant',
    clientName: 'Sudbury Point Grill',
    venue: 'Classic American sports bar, Sudbury MA',
    ambientDescription:
      'Dark wood bar, multiple beer taps, backlit bottle shelves with warm amber glow, large TVs showing sports games with blue-white glow, Boston sports memorabilia',
    forbiddenElements: [],
    defaultLens: '85mm f/1.8',
    defaultAngle: 'low-frontal',
    defaultMood: 'game-day',
    outputFormat: '1080x1350',
    photographerTemplate: 'commercial-bar',
    defaultOutputType: 'photography-prompt',
    colorPalette: ['#0B2447', '#C8102E', '#F5F5F5'],
    styleDescription:
      'Energetic, social, classic American sports bar. Warm amber bar ambience with blue-white TV glow.',
  },
  'casa-nova': {
    clientType: 'butcher-cafe',
    clientName: 'Casa Nova Butcher Shop & Cafe',
    venue: 'Brazilian butcher shop and cafe, Woburn MA',
    style: 'bold-colorful',
    colorPalette: ['#B22234', '#C49A2A', '#FFFFFF'],
    forbiddenElements: [],
    defaultOutputType: 'design-brief',
    styleDescription:
      'Vibrant, eye-catching, bold typography. Brazilian market energy. Bilingual PT/EN. Customer wants variety — alternates between colorful event posts and clean product shots.',
    ambientDescription:
      'Brazilian butcher counter and cafe with warm wood, produce display, flags and market signage',
    defaultLens: '50mm f/1.4',
    defaultAngle: 'low-frontal',
    defaultMood: 'bright-fresh',
    outputFormat: '1080x1350',
    photographerTemplate: 'butcher-cafe',
  },
  'ardan': {
    clientType: 'medspa',
    clientName: 'Ardan Medspa',
    venue: 'Modern medspa / aesthetic clinic',
    ambientDescription:
      'Clean, minimalist treatment rooms with soft neutral tones, subtle warm accents, calm professional atmosphere',
    forbiddenElements: ['clutter', 'medical-clinical-feel'],
    defaultLens: '85mm f/1.8',
    defaultAngle: 'low-frontal',
    defaultMood: 'editorial',
    outputFormat: '1080x1350',
    photographerTemplate: 'editorial-beauty',
    defaultOutputType: 'photography-prompt',
    colorPalette: ['#E8D7C3', '#6B5847', '#FFFFFF'],
    styleDescription:
      'Editorial beauty. Soft neutrals, refined, calm, skin-first. Premium wellness aesthetic.',
  },
  'retail-default': {
    clientType: 'retail',
    clientName: 'Retail (Generic)',
    venue: 'Retail storefront',
    ambientDescription:
      'Clean retail environment with product display, on-brand signage',
    forbiddenElements: [],
    defaultOutputType: 'design-brief',
    colorPalette: ['#111111', '#F5F5F5', '#D4A24C'],
    styleDescription: 'Clean, modern retail. Product-forward layout with clear CTA.',
    defaultLens: '50mm f/1.4',
    defaultAngle: 'low-frontal',
    defaultMood: 'bright-fresh',
    outputFormat: '1080x1350',
    photographerTemplate: 'commercial-retail',
  },
};

function slugify(s: string): string {
  return String(s)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

export function getBrandKit(id: string | undefined | null): BrandKitEntry | null {
  if (!id) return null;
  if (brandKits[id]) return brandKits[id];
  const slug = slugify(id);
  if (brandKits[slug]) return brandKits[slug];
  const idLower = String(id).toLowerCase();
  for (const key of Object.keys(brandKits)) {
    if (brandKits[key].clientName.toLowerCase() === idLower) return brandKits[key];
  }
  return null;
}
