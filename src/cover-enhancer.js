/**
 * Nanobanana cover slide enhancer (v2).
 *
 * Goal: produce a STOP-THE-SCROLL cover. Hyperreal photography with weird editorial
 * treatment — heavy desaturation, screaming red highlights, infrared/thermal looks,
 * extreme close-ups, double-exposures with data viz. NOT tasteful coffee-table photos.
 *
 * Pipeline:
 *   1. Read dist/<date>/spec.json + slide-1.png (the v5 cover Playwright rendered).
 *   2. Send slide-1.png as a STYLE REFERENCE for color palette only; ask Nano Banana
 *      to generate a new BACKGROUND (no text) per a per-theme aggressive prompt.
 *   3. sharp: resize AI output to 1080x1350 (cover/center) — Nano Banana usually
 *      returns ~1024x1024 or ~896x1152, never the source 4:5.
 *   4. sharp: composite slide-1-overlay.png (transparent-bg text/UI from renderer)
 *      on top — gives back the headline, badge, ghost number, brand strips.
 *   5. Write final slide-1.png.
 *
 * If Nano Banana returns nothing or sharp fails, we keep the original slide-1.png
 * (the dark v5 cover) — never break the carousel.
 *
 * CLI usage (from content-engine root):
 *   node src/cover-enhancer.js 2026-04-22
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const TARGET_W = 1080;
const TARGET_H = 1350;

// ---- PROMPTS ------------------------------------------------------------
//
// Voice: instructions to a senior editorial art director, NOT a stock photographer.
// Reference points: Bloomberg Businessweek, Wired magazine, MIT Tech Review,
// The Economist illustrations.
//
// Banned vocabulary in prompts (these all push toward boring stock photos):
//   "cinematic", "photographic", "tasteful", "lifestyle", "soft bokeh",
//   "depth of field", "morning shot", "moody", "blue hour", "skyline".

const COMMON_TREATMENT = `
EDITORIAL TREATMENT (CRITICAL — do not produce a tasteful photograph):
- Hyperreal but unsettling. Wired magazine cover energy, NOT National Geographic.
- Desaturate everything 70-80% EXCEPT one element which is in screaming saturated red (#FF2E2E) or electric blue (#4D72FF).
- High contrast. Deep shadows. Surface details exaggerated (concrete grain, glass reflections, metal texture).
- Architectural close-ups beat wide skylines. Crop tight. One dominant subject.
- Optional: thermal-camera color palette (deep blue → white-hot red). Optional: subtle data-viz / line-graph overlay etched faintly into the image.
- Composition asymmetric. Negative space in upper-left and bottom-right (where headline and ghost number sit).

ABSOLUTELY FORBIDDEN:
- No coffee cups. No people. No "lifestyle" framing. No infinity pools.
- No literal Marina Bay Sands postcard shot. No Merlion. No tasteful blue-hour skylines.
- No text, watermarks, logos, captions, or numbers in the image — pure background visual only.
- No soft pastel palettes. No warm "golden hour" wash.
- No stock photo composition cliches.
`.trim();

const PROMPT_BY_THEME = {
  distress: `A single condo block, extreme close-up of one corner unit at night. The unit is a bright screaming red square (overheated thermal) while every other window in the block is pitch dark or muted blue. Concrete texture is brutally detailed.`,

  hdb: `Extreme close-up of HDB facade — one repeated balcony unit, geometric grid pattern. One balcony has a screaming red curtain or red light; all others muted blue-grey. Brutalist symmetry. Slight glitch artifact in the upper third.`,

  rental: `A single condo window glowing screaming red against a desaturated black-and-white facade of identical dark windows. Architectural grid pattern. The red window is the only color in the frame. Hyperreal, brutalist, almost dystopian.`,

  landed: `Extreme close-up of a single black-and-white bungalow door — peeling paint, brass knocker, surveillance camera in the frame. The door is in screaming red, everything around it desaturated. Tropical foliage edges in like a horror film.`,

  wrap: `An aerial close-up of a single rooftop in a sea of identical Singapore rooftops. The chosen rooftop glows screaming red as if scanned by satellite; all others are desaturated cool grey. Subtle thin red grid lines overlay the image like a targeting reticle.`,

  masterplan: `Architectural blueprint of a Singapore district overlaid on a hyperreal photograph of the same district from above. Half blueprint (electric blue line work on near-black), half real photo (desaturated). The seam between the two halves is sharp. Single building circled in screaming red.`,

  geopolitics: `Macro close-up of a Singapore-dollar coin half-submerged in dark water, with a faint red financial line graph etched as if engraved on its surface. Background is pure black. Coin metal grain hyper-detailed. One screaming red highlight where the line graph peaks.`
};

function buildPrompt(theme) {
  const themePrompt = PROMPT_BY_THEME[theme] || PROMPT_BY_THEME.wrap;
  return `${themePrompt}\n\n${COMMON_TREATMENT}`;
}

// ---- AI CALL ------------------------------------------------------------

async function generateBackground(theme, baseImage) {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('[cover] GEMINI_API_KEY missing — skipping enhancement');
    return null;
  }
  const prompt = buildPrompt(theme);
  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: 'image/png', data: baseImage.toString('base64') } }
      ]
    }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
  };

  let res, data;
  try {
    res = await fetch(`${ENDPOINT}?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    data = await res.json();
  } catch (e) {
    console.warn(`[cover] network error: ${e.message} — skipping`);
    return null;
  }

  if (data.error) {
    console.warn(`[cover] Gemini error: ${data.error.message} — skipping`);
    return null;
  }
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const part = parts.find(p => p.inlineData || p.inline_data);
  if (!part) {
    const finishReason = data?.candidates?.[0]?.finishReason || 'unknown';
    console.warn(`[cover] no image returned (finishReason=${finishReason}) — skipping`);
    return null;
  }
  const inlineData = part.inlineData || part.inline_data;
  return Buffer.from(inlineData.data, 'base64');
}

// ---- PUBLIC API ---------------------------------------------------------

export async function enhanceCover({ baseImagePath, overlayImagePath, theme, outPath }) {
  if (!fs.existsSync(baseImagePath)) {
    console.warn(`[cover] base image missing: ${baseImagePath} — skipping`);
    return null;
  }
  const baseImage = fs.readFileSync(baseImagePath);

  const aiBuffer = await generateBackground(theme, baseImage);
  if (!aiBuffer) return null;

  // Resize AI output to 1080x1350. cover-fit (crop, no letterboxing) so the
  // image fills the frame even when AI returns a square.
  let aiResized;
  try {
    aiResized = await sharp(aiBuffer)
      .resize(TARGET_W, TARGET_H, { fit: 'cover', position: 'center' })
      .png()
      .toBuffer();
  } catch (e) {
    console.warn(`[cover] sharp resize failed: ${e.message} — skipping`);
    return null;
  }

  // Composite the transparent overlay (text/badge/ghost-number) on top.
  // If overlay is missing (older render or partial run), fall back to AI alone.
  let composited = aiResized;
  if (overlayImagePath && fs.existsSync(overlayImagePath)) {
    try {
      composited = await sharp(aiResized)
        .composite([{ input: overlayImagePath, top: 0, left: 0 }])
        .png()
        .toBuffer();
      console.log(`[cover] composited overlay: ${overlayImagePath}`);
    } catch (e) {
      console.warn(`[cover] composite failed: ${e.message} — using AI-only`);
    }
  } else {
    console.warn(`[cover] overlay PNG not found at ${overlayImagePath} — using AI-only`);
  }

  fs.writeFileSync(outPath, composited);
  console.log(`[cover] enhanced → ${outPath} (${TARGET_W}x${TARGET_H})`);
  return outPath;
}

// ---- CLI ENTRY ----------------------------------------------------------

async function main() {
  const dropDate = process.argv[2] || new Date().toISOString().slice(0, 10);
  const dropDir  = path.join(process.env.DROPS_DIR || './dist', dropDate);
  const specPath = path.join(dropDir, 'spec.json');
  const coverPath = path.join(dropDir, 'slide-1.png');
  const overlayPath = path.join(dropDir, 'slide-1-overlay.png');

  if (!fs.existsSync(specPath)) {
    console.warn(`[cover] no spec at ${specPath} — nothing to enhance`);
    return;
  }
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const themeId = (spec.drop_id || '').split('-').slice(3).join('-') || 'wrap';

  await enhanceCover({
    baseImagePath: coverPath,
    overlayImagePath: overlayPath,
    theme: themeId,
    outPath: coverPath
  });
}

// Robust ESM CLI guard — pathToFileURL handles paths with spaces.
import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => {
    console.warn(`[cover] unhandled: ${e.message} — skipping`);
  });
}
