/**
 * Nanobanana SLIDE enhancer (v4 — cover-only direction).
 *
 * Goal: produce ONE STOP-THE-SCROLL visual per drop — the COVER slide.
 *
 * History: v3 also enhanced the first stat + tip slides, but Farhan flagged
 * (2026-04-23) that AI imagery on data-heavy slides "fights with the words" —
 * the giant numbers and quote text need uncluttered backgrounds to read. From
 * v4 onward only the cover slide gets the AI treatment; stats and tips stay
 * on the clean dark template where text dominates.
 *
 * Visual direction (Farhan, 2026-04-23): "Vogue × Bloomberg Businessweek × Apple
 * campaign" — provocative, BOLD, saturated, premium photography that wows.
 * NOT moody, NOT desaturated, NOT horror, NOT dystopian. Massive color pop.
 *
 * Pipeline (per slide):
 *   1. Ask Nano Banana for a NEW BACKGROUND from a per-(theme,kind) text prompt.
 *      We do NOT pass the base render in as a reference — Gemini's image-edit model
 *      treats any input image as material to edit, not as a style cue, which caused
 *      the original slide text to bleed into the AI output and double up when the
 *      overlay PNG was composited on top (2026-04-23 stat-slide bug).
 *   2. sharp: resize AI output to 1080x1350 (cover-fit, center).
 *   3. sharp: composite a top+bottom dark gradient scrim — preserves text
 *      legibility even when AI returns very bright imagery (2026-04-23 tip bug).
 *   4. sharp: composite slide-N-overlay.png (transparent text/UI from renderer)
 *      on top — gives back headline/badge/number/brand strips.
 *   5. Write final slide-N.png (overwrites base).
 *
 * If Nano Banana returns nothing or sharp fails for any slide, we keep that
 * slide's original render — never break the carousel.
 *
 * CLI usage (from content-engine root):
 *   node src/cover-enhancer.js 2026-04-23
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
// Voice: instructions to a luxury editorial art director — Vogue, Bloomberg
// Businessweek, Apple campaign, Architectural Digest. NOT a stock photographer.
//
// Banned vocabulary (these all push toward boring / horror / dystopian images):
//   "desaturated", "muted", "moody", "horror", "thermal", "dystopian",
//   "brutalist", "blue hour", "noir", "ghostly", "creepy", "unsettling",
//   "Wired magazine cover".

const COMMON_TREATMENT = `
EDITORIAL TREATMENT (CRITICAL — produce a STOP-THE-SCROLL premium photograph):
- BOLD, SATURATED, PREMIUM. Vogue × Bloomberg Businessweek × Apple campaign energy.
- Massive color pop. ONE dominant saturated accent (electric teal, hot magenta, golden amber, citrus orange, vivid coral, royal cobalt) playing against a clean luxe backdrop.
- Hyperreal premium real-estate / architectural / still-life photography. Rich detail. Glossy surfaces. Natural light or dramatic key light.
- Composition: asymmetric, magazine-cover quality. Negative space in upper-left or top-third (where the headline overlay sits).
- Think: a Vogue editorial shoot inside a luxury Singapore property. Or a Bloomberg cover photographed by a fashion photographer. Or an Apple product launch image of a building.
- Sharp focus on hero subject. Background may have soft falloff but NEVER drab.
- Color must SING. Saturation cranked. Contrast crisp. Like an iPhone 15 Pro Max ad.

ABSOLUTELY FORBIDDEN:
- NO horror, ghostly, dystopian, thermal-camera, brutalist, or "Wired magazine" treatment.
- NO desaturated black-and-white-with-one-red-thing — that's been done, it reads as cheap and creepy.
- NO people, no coffee cups, no Marina Bay Sands postcard, no Merlion, no infinity pool clichés.
- NO text, watermarks, logos, captions, numbers, or graphs in the image — pure background visual only.
- NO drone-shot skylines at blue hour. NO real-estate-listing flatness.
- NO soft pastel washes (it's premium and saturated, not Wes Anderson).
`.trim();

// 7 prompts — one per theme, cover slide only (v4).
// Naming: ${theme}-cover. Stat/tip kind variants removed in v4 — those slides
// no longer get AI backgrounds.
const PROMPTS = {
  // ---- DISTRESS (Mon) ----
  'distress-cover': `Hero shot of a luxury Singapore condo unit photographed from outside at golden hour. Floor-to-ceiling glass windows reflect a fiery saturated orange sunset. One window glows warm amber from inside, the rest of the building is sleek black glass. Architectural Digest meets Vogue editorial. Razor-sharp glass detail, glossy polish. Top-third sky empty for headline.`,

  // ---- HDB (Tue) ----
  'hdb-cover': `Hero exterior shot of an iconic Singapore HDB block at sunrise — pastel facade in saturated peach, mint, and butter-yellow tones. Repeating geometric balconies catch the warm light. Crisp blue sky above. Wes-Anderson-symmetry meets Apple campaign cleanliness. Top-third sky empty for headline.`,

  // ---- RENTAL (Wed) ----
  'rental-cover': `Hero shot of a luxury penthouse interior at sunset — floor-to-ceiling windows show a saturated magenta-and-amber Singapore skyline. Inside: one designer chair in vivid teal, polished concrete floor, single sculptural pendant light. Vogue Living × Apple ad. Top-third sky empty for headline.`,

  // ---- LANDED (Thu) ----
  'landed-cover': `Hero shot of a Singapore black-and-white colonial bungalow at golden hour. Crisp white walls, glossy black shutters. A single cluster of vivid magenta bougainvillea spills over the entrance. Lush green tropical garden. Architectural Digest cover energy. Top-third sky empty for headline.`,

  // ---- WRAP / WEEKEND (Fri/Sat/Sun) ----
  'wrap-cover': `Hero aerial shot of Singapore at twilight — saturated coral-and-gold sunset reflecting off the dense skyline. One iconic skyscraper catches a vivid magenta highlight. Crisp clean composition, like an Apple ad. Top-third sky empty for headline.`,

  // ---- MASTERPLAN (Sat) ----
  'masterplan-cover': `Hero shot of an architectural model of a future Singapore district on a clean white plinth, photographed under dramatic studio lighting. The model glows with saturated golden interior lights. Background is a clean luxe gradient in deep cobalt to magenta. Apple-campaign × MoMA-exhibit energy. Top-third negative space.`,

  // ---- GEOPOLITICS (Sun) ----
  'geopolitics-cover': `Hero macro shot of a single Singapore-dollar coin standing upright on a polished marble surface, lit dramatically with one magenta key light from the left and one teal rim light from the right. Coin metal grain hyperreal, edge-of-frame bokeh in saturated colors. Apple-product-shoot energy. Top-third negative space.`,
};

function buildPrompt(theme, kind) {
  const key = `${theme}-${kind}`;
  const themePrompt = PROMPTS[key] || PROMPTS[`wrap-${kind}`] || PROMPTS['wrap-cover'];
  return `${themePrompt}\n\n${COMMON_TREATMENT}`;
}

// ---- AI CALL ------------------------------------------------------------

async function generateBackground(theme, kind) {
  if (!process.env.GEMINI_API_KEY) {
    console.warn(`[enhance:${kind}] GEMINI_API_KEY missing — skipping enhancement`);
    return null;
  }
  const prompt = buildPrompt(theme, kind);
  // Pure text-to-image. We deliberately do NOT pass the slide render as input —
  // Gemini's image model edits whatever you hand it, which caused slide text to
  // be reproduced in the AI output and then doubled when the overlay was layered
  // on top. Our prompts are color/composition specific enough on their own.
  const body = {
    contents: [{
      parts: [
        { text: prompt },
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
    console.warn(`[enhance:${kind}] network error: ${e.message} — skipping`);
    return null;
  }

  if (data.error) {
    console.warn(`[enhance:${kind}] Gemini error: ${data.error.message} — skipping`);
    return null;
  }
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const part = parts.find(p => p.inlineData || p.inline_data);
  if (!part) {
    const finishReason = data?.candidates?.[0]?.finishReason || 'unknown';
    console.warn(`[enhance:${kind}] no image returned (finishReason=${finishReason}) — skipping`);
    return null;
  }
  const inlineData = part.inlineData || part.inline_data;
  return Buffer.from(inlineData.data, 'base64');
}

// ---- PUBLIC API ---------------------------------------------------------

// Top+bottom heavy dark scrim. Sits between the AI bg and the text overlay so
// headlines/footers stay readable even when AI returns a hot, saturated image.
// SVG is generated lazily so we can swap intensity without reprocessing.
function buildScrimSvg() {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${TARGET_W}" height="${TARGET_H}">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#000" stop-opacity="0.62"/>
      <stop offset="22%"  stop-color="#000" stop-opacity="0.32"/>
      <stop offset="50%"  stop-color="#000" stop-opacity="0.08"/>
      <stop offset="78%"  stop-color="#000" stop-opacity="0.32"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.62"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#scrim)"/>
</svg>`);
}

export async function enhanceSlide({ baseImagePath, overlayImagePath, theme, kind, outPath }) {
  // baseImagePath is no longer required to call Gemini (we generate from text
  // alone) but we still need outPath to be writable. We keep the param in the
  // signature so callers don't have to change.
  const aiBuffer = await generateBackground(theme, kind);
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
    console.warn(`[enhance:${kind}] sharp resize failed: ${e.message} — skipping`);
    return null;
  }

  // Layer 1 → Layer 2: composite the dark scrim onto the AI bg.
  let withScrim = aiResized;
  try {
    withScrim = await sharp(aiResized)
      .composite([{ input: buildScrimSvg(), top: 0, left: 0 }])
      .png()
      .toBuffer();
  } catch (e) {
    console.warn(`[enhance:${kind}] scrim composite failed: ${e.message} — using AI-only`);
  }

  // Layer 3: composite the transparent text/badge overlay on top of (bg + scrim).
  // If overlay is missing (older render or partial run), fall back to AI+scrim.
  let composited = withScrim;
  if (overlayImagePath && fs.existsSync(overlayImagePath)) {
    try {
      composited = await sharp(withScrim)
        .composite([{ input: overlayImagePath, top: 0, left: 0 }])
        .png()
        .toBuffer();
      console.log(`[enhance:${kind}] composited overlay: ${overlayImagePath}`);
    } catch (e) {
      console.warn(`[enhance:${kind}] composite failed: ${e.message} — using AI+scrim only`);
    }
  } else {
    console.warn(`[enhance:${kind}] overlay PNG not found at ${overlayImagePath} — using AI+scrim only`);
  }

  fs.writeFileSync(outPath, composited);
  console.log(`[enhance:${kind}] enhanced → ${outPath} (${TARGET_W}x${TARGET_H})`);
  return outPath;
}

// Backwards-compat alias for any callers still using the old name.
export const enhanceCover = enhanceSlide;

// ---- CLI ENTRY ----------------------------------------------------------

async function main() {
  const dropDate = process.argv[2] || new Date().toISOString().slice(0, 10);
  const dropDir  = path.join(process.env.DROPS_DIR || './dist', dropDate);
  const specPath = path.join(dropDir, 'spec.json');

  if (!fs.existsSync(specPath)) {
    console.warn(`[enhance] no spec at ${specPath} — nothing to enhance`);
    return;
  }
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const themeId = (spec.drop_id || '').split('-').slice(3).join('-') || 'wrap';

  // For each kind we want to enhance, find the FIRST slide of that kind.
  // Render output is 1-indexed (slide-1.png, slide-2.png, ...).
  // Cover only (v4 — see file header). Stat + tip stay on clean dark template.
  const KINDS_TO_ENHANCE = ['cover'];

  for (const kind of KINDS_TO_ENHANCE) {
    const slideIdx = spec.slides.findIndex(s => s.kind === kind);
    if (slideIdx === -1) {
      console.log(`[enhance:${kind}] no slide of this kind in spec — skipping`);
      continue;
    }
    const slideNum = slideIdx + 1;
    const basePath    = path.join(dropDir, `slide-${slideNum}.png`);
    const overlayPath = path.join(dropDir, `slide-${slideNum}-overlay.png`);

    await enhanceSlide({
      baseImagePath: basePath,
      overlayImagePath: overlayPath,
      theme: themeId,
      kind,
      outPath: basePath,
    });
  }
}

// Robust ESM CLI guard — pathToFileURL handles paths with spaces.
import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => {
    console.warn(`[enhance] unhandled: ${e.message} — skipping`);
  });
}
