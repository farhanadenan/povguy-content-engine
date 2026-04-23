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
SHOT BRIEF (treat this like a creative director hiring a real photographer):

LIGHTING (mandatory): a single dramatic key light + a secondary colored rim/fill.
NOT flat overhead light. NOT studio softbox. Think: low-angle golden-hour sunlight
slicing across a surface, OR theatrical hard light from one side leaving the other
in shadow, OR neon-spill from off-frame. Hard shadows are encouraged. Contrast HIGH.

COLOR RULES:
- ONE bold saturated accent dominates ~25-40% of the frame (vivid magenta, electric
  teal, hot amber, citrus orange, fire red, royal cobalt, deep violet). Not
  multiple — ONE.
- Rest of frame is rich and tonal: deep blacks, warm browns, polished metal, glass,
  marble, or a deep matte color — NOT grey, NOT beige, NOT muted.
- Color must look like it was lit, not edited. No flat color washes.

LENS / COMPOSITION:
- Shoot like a 35mm or 50mm prime — shallow depth of field, hero subject sharp,
  immediate background falloff to soft creamy bokeh.
- Frame asymmetrically. Hero off-center. Negative space deliberately placed in the
  TOP THIRD (where the headline overlay sits) — that area should be one continuous
  tone or a clean darkening, not busy.
- Macro details welcome: a single drop of condensation on glass, the grain of a
  marble countertop, the patina on a brass handle.

INSPIRATION (be literal — channel these photographers/directors, NOT "stock"):
- Annie Leibovitz's Vanity Fair architectural portraits.
- Iwan Baan's commissioned architecture photography (luxury residential).
- The Apple iPhone 15 Pro launch shots — that black + amber + product-as-sculpture
  energy.
- A still from Wong Kar-wai (In the Mood for Love) — rich color, deep shadow,
  intimate detail.
- A Bloomberg Businessweek cover shot for a "future of cities" feature.

ABSOLUTELY FORBIDDEN (these were the boring-stock-ish failures):
- NO flat overall lighting / overcast daylight / "real-estate listing" look.
- NO bright washes / over-exposed / blown-out highlights / "too bright to read".
- NO grey skies, grey walls, drab beige interiors, dull pastel.
- NO horror, ghostly, dystopian, thermal, brutalist, "Wired magazine" treatment.
- NO desaturated B&W-with-one-red-thing. NO HDR over-processing. NO instagram
  filter look.
- NO people, no faces, no hands, no coffee cups, no Marina Bay Sands postcard,
  no Merlion, no infinity pool clichés.
- NO text, watermarks, logos, captions, numbers, brand marks, or graphs in the
  image — PURE background visual only.
- NO drone skyline at blue hour. NO wide cityscape. NO crowded compositions.
- NO soft pastel washes (this is premium and saturated, not Wes Anderson).
`.trim();

// 7 prompts — one per theme, cover slide only (v4).
// Naming: ${theme}-cover. Stat/tip kind variants removed in v4 — those slides
// no longer get AI backgrounds.
const PROMPTS = {
  // ---- DISTRESS (Mon) ----
  'distress-cover': `Macro detail shot of a single brass key resting on a slab of dark veined Calacatta marble. Hard amber key light rakes across from camera left at 30°, throwing one long sharp shadow across the marble grain. Background falls into deep black void. The key catches one molten orange highlight on its bow. Shot on a 50mm prime, f/2.8, hero key sharp, marble grain visible. Top third of frame: pure deep black for headline overlay. Annie Leibovitz × Apple product shoot energy. Single dominant accent: hot amber.`,

  // ---- HDB (Tue) ----
  'hdb-cover': `Tight architectural shot looking UP at the underside of an iconic Singapore HDB block at golden hour. The repeating geometric balconies catch a low sun from one side — the lit faces glow saturated tangerine, the shadowed faces fall into deep blue-black. Sky in upper third is a clean unbroken twilight gradient (deep indigo to ember orange). Hard light, hard shadows, NO clouds. Shot on 35mm prime, sharp focus, no motion. Iwan Baan × Architectural Digest. Single dominant accent: vivid tangerine.`,

  // ---- RENTAL (Wed) ----
  'rental-cover': `Interior detail of an empty luxury penthouse at dusk. ONE single Wong Kar-wai style pool of warm amber spotlight falls on a polished concrete floor; the rest of the room sinks into rich teal-black shadow. Floor-to-ceiling window in the background shows a single magenta neon sign across the void of city night, deeply out of focus. NO furniture, NO people. Hard directional light, intimate, cinematic, sumptuous. 50mm, f/2, deep shadow, one warm pool. Top third is deep teal-black for overlay. Single dominant accent: amber pool against teal void.`,

  // ---- LANDED (Thu) ----
  'landed-cover': `Macro hero shot of a single cluster of vivid hot-magenta bougainvillea flowers spilling over the edge of a glossy black-painted timber wall (a black-and-white bungalow detail). Hard golden-hour key light from camera right makes each petal glow translucent. Background: the wall surface fades into deep black shadow. Razor-sharp on the petals, immediate creamy bokeh. Shot on 100mm macro, f/2.8. The flowers are the ONLY saturated thing in frame. Top half: deep black wall for headline. Single dominant accent: electric hot magenta.`,

  // ---- WRAP / WEEKEND (Fri/Sat/Sun) ----
  'wrap-cover': `Tight long-lens (200mm) shot of ONE single skyscraper in Singapore at the exact moment after sunset — sky behind is a clean unbroken gradient from deep cobalt at top to ember coral at horizon. The building's glass facade catches one molten amber highlight down its spine; the rest of the building is silhouette black. NO other buildings visible. NO crowded skyline. Asymmetric composition: building in the right third, left two-thirds is pure cobalt-to-coral sky for the headline. Apple iPhone Pro launch shot energy. Single dominant accent: molten amber against cobalt.`,

  // ---- MASTERPLAN (Sat) ----
  'masterplan-cover': `Studio shot of a single architect's model building (white card / balsa) sitting on a slab of polished black marble. ONE hard cobalt-blue spotlight rakes from camera-left throwing the model's shadow long across the marble. Inside the model, tiny windows glow warm amber as if lit from within. Background falls to deep black. NOT a wide cityscape — just ONE model object, hero. 50mm prime, f/2.8. Top third: deep black for overlay. MoMA exhibit × Apple product photography. Single dominant accent: cobalt spotlight + amber interior glow.`,

  // ---- GEOPOLITICS (Sun) ----
  'geopolitics-cover': `Extreme macro of a single Singapore one-dollar coin standing upright on its edge on a slab of dark wet slate. One hard violet key light from camera left, one teal rim light from camera right. Coin metal hyper-detailed: every micro-scratch and milled edge visible. Background: deep black with the slate's wet sheen catching faint highlights. Razor-sharp on the coin, edge-of-frame bokeh in violet+teal. Shot on 100mm macro, f/4. Top half: deep black slate void for overlay. Apple-product-shoot × Bloomberg cover energy. Single dominant accent: violet+teal cross-light.`,
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
  // Heavier top + bottom than v4. Cover headline sits in top-third + bottom 30%
  // (badge → h1 → sub → footer). Middle (~30-65%) stays lighter so the AI
  // photograph still reads. Numbers tuned 2026-04-23 after Farhan reported
  // "too bright to read text" on a tip-slice render.
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${TARGET_W}" height="${TARGET_H}">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#000" stop-opacity="0.78"/>
      <stop offset="18%"  stop-color="#000" stop-opacity="0.45"/>
      <stop offset="38%"  stop-color="#000" stop-opacity="0.18"/>
      <stop offset="62%"  stop-color="#000" stop-opacity="0.30"/>
      <stop offset="82%"  stop-color="#000" stop-opacity="0.62"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.88"/>
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

  // Match renderer.js zero-pad scheme so we read slide-01.png, slide-02.png, etc.
  // (See renderer.js for why padding matters — downstream sort correctness.)
  const pad = (n) => String(n).padStart(2, '0');

  for (const kind of KINDS_TO_ENHANCE) {
    const slideIdx = spec.slides.findIndex(s => s.kind === kind);
    if (slideIdx === -1) {
      console.log(`[enhance:${kind}] no slide of this kind in spec — skipping`);
      continue;
    }
    const slideNum = pad(slideIdx + 1);
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
