/**
 * Brand kit data layer for the Prompt Generator.
 *
 * Keys match the client id / slug. `getBrandKit()` tolerates a friendly name
 * or a differently-cased slug so the endpoint can be called with whatever the
 * frontend already has on hand.
 */

export interface BrandKitEntry {
  clientName: string;
  venue: string;
  ambientDescription: string;
  forbiddenElements: string[];
  defaultLens: string;
  defaultAngle: string;
  defaultMood: string;
  outputFormat: string;
  photographerTemplate: string;
}

export const brandKits: Record<string, BrandKitEntry> = {
  'cafe-st-petersburg': {
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
  },
  'sudbury-point-grill': {
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
