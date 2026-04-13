// Brand kits data layer for the Prompt Generator.
// Each key matches a client id / slug. Selector in the UI looks kits up by this key.
// Stack note: the portal is vanilla JS served statically, so this file exposes
// `window.brandKits` instead of using TS/ESM exports.
(function (global) {
  var brandKits = {
    "cafe-st-petersburg": {
      clientName: "Cafe St. Petersburg",
      venue: "Upscale Eastern European restaurant, Newton Centre MA",
      ambientDescription: "Elegant dining room with dark wood, warm amber lighting from pendant lights, blue accent bar lighting, wine glasses, intimate atmosphere",
      forbiddenElements: ["candles", "candlelight"],
      defaultLens: "85mm f/1.8",
      defaultAngle: "low-frontal",
      defaultMood: "moody-warm",
      outputFormat: "1080x1350",
      photographerTemplate: "high-end-nightlife"
    },
    "sudbury-point-grill": {
      clientName: "Sudbury Point Grill",
      venue: "Classic American sports bar, Sudbury MA",
      ambientDescription: "Dark wood bar, multiple beer taps, backlit bottle shelves with warm amber glow, large TVs showing sports games with blue-white glow, Boston sports memorabilia",
      forbiddenElements: [],
      defaultLens: "85mm f/1.8",
      defaultAngle: "low-frontal",
      defaultMood: "game-day",
      outputFormat: "1080x1350",
      photographerTemplate: "commercial-bar"
    }
  };

  // Helper: look up a kit by any reasonable id form (exact key, lowercased slug,
  // or the friendly name). Returns null when nothing matches.
  function getBrandKit(id) {
    if (!id) return null;
    if (brandKits[id]) return brandKits[id];
    var slug = String(id).toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    if (brandKits[slug]) return brandKits[slug];
    // Match by clientName
    for (var k in brandKits) {
      if (brandKits[k].clientName && brandKits[k].clientName.toLowerCase() === String(id).toLowerCase()) {
        return brandKits[k];
      }
    }
    return null;
  }

  global.brandKits = brandKits;
  global.getBrandKit = getBrandKit;
})(typeof window !== 'undefined' ? window : this);
