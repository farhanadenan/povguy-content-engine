/**
 * Nanobanana SLIDE enhancer (v3 — color-pop direction).
 *
 * Goal: produce STOP-THE-SCROLL visuals across THREE slides per drop:
 *   1. cover  (slide-1)
 *   2. stat   (first slide where kind === 'stat')
 *   3. tip    (first slide where kind === 'tip')
 *
 * Visual direction (Farhan, 2026-04-23): "Vogue × Bloomberg Businessweek × Apple
 * campaign" — provocative, BOLD, saturated, premium photography that wows.
 * NOT moody, NOT desaturated, NOT horror, NOT dystopian. Massive color pop.
 *
 * Pipeline (per slide):
 *   1. Read slide-N.png (the v5 base render Playwright produced).
 *   2. Send slide-N.png as STYLE REFERENCE for color palette only; ask Nano Banana
 *      to generate a new BACKGROUND (no text) per a per-(theme,kind) prompt.
 *   3. sharp: resize AI output to 1080x1350 (cover-fit, center).
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

// 21 prompts: 7 themes × 3 slide kinds (cover, stat, tip)
// Naming: ${theme}-${kind}
const PROMPTS = {
  // ---- DISTRESS (Mon) ----
  'distress-cover': `Hero shot of a luxury Singapore condo unit photographed from outside at golden hour. Floor-to-ceiling glass windows reflect a fiery saturated orange sunset. One window glows warm amber from inside, the rest of the building is sleek black glass. Architectural Digest meets Vogue editorial. Razor-sharp glass detail, glossy polish. Top-third sky empty for headline.`,
  'distress-stat':  `An ultra-premium close-up of a single luxury condo balcony — designer chair in vivid coral, glass railing, polished marble floor — against a backdrop of saturated sunset sky in magenta and burnt orange. Vogue Living shoot. Top-third sky negative space.`,
  'distress-tip':   `A flatlay overhead of a Cartier watch, a brass key on a velvet tray, and a glossy Singapore architecture book on a slab of green-veined marble. Lit by a single dramatic shaft of golden light. Saturated, glossy, Bloomberg Businessweek still-life. Top half mostly empty marble for headline overlay.`,

  // ---- HDB (Tue) ----
  'hdb-cover': `Hero exterior shot of an iconic Singapore HDB block at sunrise — pastel facade in saturated peach, mint, and butter-yellow tones. Repeating geometric balconies catch the warm light. Crisp blue sky above. Wes-Anderson-symmetry meets Apple campaign cleanliness. Top-third sky empty for headline.`,
  'hdb-stat':  `An extreme close-up of a single HDB balcony rendered in vivid saturated pastels — turquoise laundry, terracotta planter, golden afternoon sun on the ledge. Geometric, graphic, magazine-cover composition. Top-third negative space for the giant number overlay.`,
  'hdb-tip':   `A flatlay of two BTO keys on a coral lanyard, an HDB resale flyer, and an iced kopi on a marble countertop. Saturated bright daylight, glossy condensation on the glass. Editorial food-photography energy. Top half empty marble for headline overlay.`,

  // ---- RENTAL (Wed) ----
  'rental-cover': `Hero shot of a luxury penthouse interior at sunset — floor-to-ceiling windows show a saturated magenta-and-amber Singapore skyline. Inside: one designer chair in vivid teal, polished concrete floor, single sculptural pendant light. Vogue Living × Apple ad. Top-third sky empty for headline.`,
  'rental-stat':  `A single condo window glowing electric teal-cyan against a vivid magenta-orange sunset sky. The building facade is glossy black. The teal window pops as the only cool color in a warm-saturated frame. Bold editorial architectural close-up. Top-third negative space.`,
  'rental-tip':   `An overhead flatlay: a set of luxury keys, a leather card-holder, a glossy black coffee-table book on Singapore design, and a sprig of orchid in saturated magenta. Polished marble surface, dramatic golden side-light. Vogue still-life. Top half empty marble.`,

  // ---- LANDED (Thu) ----
  'landed-cover': `Hero shot of a Singapore black-and-white colonial bungalow at golden hour. Crisp white walls, glossy black shutters. A single cluster of vivid magenta bougainvillea spills over the entrance. Lush green tropical garden. Architectural Digest cover energy. Top-third sky empty for headline.`,
  'landed-stat':  `An extreme close-up of one section of a black-and-white bungalow facade — pristine white louvers, glossy black trim, and one bright coral hibiscus flower in sharp focus in the foreground. Magazine-cover crisp. Top-third negative space.`,
  'landed-tip':   `A flatlay overhead of a brass door knocker, an ornate antique key, and a cream-colored architecture monograph on a slab of polished teak wood. One vivid orange marigold off to the side. Warm dramatic light. Vogue × Architectural Digest still-life. Top half empty wood.`,

  // ---- WRAP / WEEKEND (Fri/Sat/Sun) ----
  'wrap-cover': `Hero aerial shot of Singapore at twilight — saturated coral-and-gold sunset reflecting off the dense skyline. One iconic skyscraper catches a vivid magenta highlight. Crisp clean composition, like an Apple ad. Top-third sky empty for headline.`,
  'wrap-stat':  `An overhead photograph of a saturated cocktail in vivid orange and magenta on a polished marble bar, with a Singapore skyline blurred warmly in the background. Bloomberg Pursuits editorial. Top-third sky-blur negative space.`,
  'wrap-tip':   `A flatlay overhead of a glossy weekend-edition newspaper, a fountain pen, an espresso in a saturated cobalt cup, and a slice of citrus on a marble surface. Premium, saturated, Vogue still-life. Top half mostly empty marble.`,

  // ---- MASTERPLAN (Sat) ----
  'masterplan-cover': `Hero shot of an architectural model of a future Singapore district on a clean white plinth, photographed under dramatic studio lighting. The model glows with saturated golden interior lights. Background is a clean luxe gradient in deep cobalt to magenta. Apple-campaign × MoMA-exhibit energy. Top-third negative space.`,
  'masterplan-stat':  `An extreme close-up of an architectural blueprint with one tower outlined in vivid hot-pink ink against crisp white drafting paper. Sharp, graphic, editorial. Polished brass drafting tools partly in frame. Top-third white-space negative space.`,
  'masterplan-tip':   `A flatlay overhead of an architect's leather-bound notebook open to a hand-drawn Singapore district sketch, a vivid amber pencil, brass dividers, and a coral coffee cup. Polished walnut desk. Premium editorial still-life. Top half empty desk.`,

  // ---- GEOPOLITICS (Sun) ----
  'geopolitics-cover': `Hero macro shot of a single Singapore-dollar coin standing upright on a polished marble surface, lit dramatically with one magenta key light from the left and one teal rim light from the right. Coin metal grain hyperreal, edge-of-frame bokeh in saturated colors. Apple-product-shoot energy. Top-third negative space.`,
  'geopolitics-stat':  `Macro close-up of a stack of crisp Singapore-dollar notes fanned out on a glossy black marble surface, with one note glowing under a dramatic shaft of golden light. Bloomberg Markets cover energy. Top-third dark-marble negative space.`,
  'geopolitics-tip':   `A flatlay overhead of a luxury fountain pen, a folded Financial Times, a glossy globe paperweight, and a glass of amber whisky on a polished walnut desk. Warm dramatic side-light, saturated jewel tones. Bloomberg Pursuits still-life. Top half empty walnut.`,
};

function buildPrompt(theme, kind) {
  const key = `${theme}-${kind}`;
  const themePrompt = PROMPTS[key] || PROMPTS[`wrap-${kind}`] || PROMPTS['wrap-cover'];
  return `${themePrompt}\n\n${COMMON_TREATMENT}`;
}

// ---- AI CALL ------------------------------------------------------------

async function generateBackground(theme, kind, baseImage) {
  if (!process.env.GEMINI_API_KEY) {
    console.warn(`[enhance:${kind}] GEMINI_API_KEY missing — skipping enhancement`);
    return null;
  }
  const prompt = buildPrompt(theme, kind);
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

export async function enhanceSlide({ baseImagePath, overlayImagePath, theme, kind, outPath }) {
  if (!fs.existsSync(baseImagePath)) {
    console.warn(`[enhance:${kind}] base image missing: ${baseImagePath} — skipping`);
    return null;
  }
  const baseImage = fs.readFileSync(baseImagePath);

  const aiBuffer = await generateBackground(theme, kind, baseImage);
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

  // Composite the transparent overlay (text/badge/ghost-number) on top.
  // If overlay is missing (older render or partial run), fall back to AI alone.
  let composited = aiResized;
  if (overlayImagePath && fs.existsSync(overlayImagePath)) {
    try {
      composited = await sharp(aiResized)
        .composite([{ input: overlayImagePath, top: 0, left: 0 }])
        .png()
        .toBuffer();
      console.log(`[enhance:${kind}] composited overlay: ${overlayImagePath}`);
    } catch (e) {
      console.warn(`[enhance:${kind}] composite failed: ${e.message} — using AI-only`);
    }
  } else {
    console.warn(`[enhance:${kind}] overlay PNG not found at ${overlayImagePath} — using AI-only`);
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
  const KINDS_TO_ENHANCE = ['cover', 'stat', 'tip'];

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
