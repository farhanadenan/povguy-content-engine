/**
 * Nanobanana cover slide enhancer.
 * Uses Gemini 2.5 Flash Image (model: gemini-2.5-flash-image-preview).
 *
 * Reads dist/<date>/spec.json + slide-1.png, asks Gemini to reimagine the
 * cover as a cinematic Singapore visual that preserves the headline text
 * AND keeps the POV Guy "Glassmorphism vibe" dark palette
 * (#03071A bg, blue accents #4D72FF, optional warm glow).
 *
 * CLI usage (from content-engine root):
 *   node src/cover-enhancer.js 2026-04-22
 *
 * The workflow calls this directly — no inline `node -e` heredocs (those
 * broke under "type":"module" because `require` is undefined in ESM).
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const MODEL = 'gemini-2.5-flash-image-preview';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// Per-theme cinematic prompts. Themes match router.js theme.id values.
const PROMPT_BY_THEME = {
  distress: 'A moody dusk shot of Singapore CBD skyline with one condo highlighted in warm light, others muted. Cinematic, photographic.',
  hdb:      'A vibrant golden-hour shot of HDB blocks in a mature estate, washing lines, real lived-in feel. Photographic.',
  rental:   'Bright morning shot through a luxury condo balcony overlooking Marina Bay, depth of field, soft bokeh on a coffee cup in foreground. Photographic.',
  landed:   'Quiet morning street view of a Bukit Timah black-and-white bungalow, lush canopy, soft mist. Photographic.',
  wrap:     'Singapore skyline at blue hour with subtle motion blur on traffic light trails crossing the frame. Photographic.',
  masterplan: 'Top-down architectural view of Singapore master plan rendering, isometric, blueprint-style with subtle grid overlay.',
  geopolitics: 'Stylised composite of Singapore skyline with overlaid faint financial chart traces and currency tickers, dramatic lighting.'
};

function buildPrompt(theme, headline) {
  const themePrompt = PROMPT_BY_THEME[theme] || PROMPT_BY_THEME.wrap;
  return `
${themePrompt}

CRITICAL CONSTRAINTS:
- Output is a 1080x1350 portrait social slide (4:5).
- Preserve the headline text overlay EXACTLY: "${headline}"
- Maintain a dark, premium "glassmorphism" feel: deep navy/blue background (~#03071A to #0A1232) with cool blue glow accents (~#4D72FF). Warm tones only as subtle highlights.
- Do NOT add any text other than the headline. No logos, captions, or stamps.
- Do NOT crop, blur, or distort the headline.
- Preserve the slide-num "01 / NN" in the top-right corner if present.
- Style: cinematic, editorial, Bloomberg-meets-Apple, no stock-photo cliches.
`.trim();
}

export async function enhanceCover({ baseImagePath, theme, headline, outPath }) {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('[cover] GEMINI_API_KEY missing — skipping enhancement');
    return null;
  }
  if (!fs.existsSync(baseImagePath)) {
    console.warn(`[cover] base image missing: ${baseImagePath} — skipping`);
    return null;
  }
  const baseImage = fs.readFileSync(baseImagePath);
  const prompt = buildPrompt(theme, headline);

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        {
          inline_data: {
            mime_type: 'image/png',
            data: baseImage.toString('base64')
          }
        }
      ]
    }],
    generationConfig: { responseModalities: ['IMAGE'] }
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

  const part = data?.candidates?.[0]?.content?.parts?.find(p => p.inline_data);
  if (!part) {
    console.warn('[cover] no image returned — skipping');
    return null;
  }
  fs.writeFileSync(outPath, Buffer.from(part.inline_data.data, 'base64'));
  console.log(`[cover] enhanced → ${outPath}`);
  return outPath;
}

// ---- CLI entry ----------------------------------------------------------
//
// Pulls the theme from spec.json (the drop_id ends in "-<theme-id>") so the
// enhancer doesn't need a separate env var. Falls back gracefully.
async function main() {
  const dropDate = process.argv[2] || new Date().toISOString().slice(0, 10);
  const dropDir  = path.join(process.env.DROPS_DIR || './dist', dropDate);
  const specPath = path.join(dropDir, 'spec.json');
  const coverPath = path.join(dropDir, 'slide-1.png');

  if (!fs.existsSync(specPath)) {
    console.warn(`[cover] no spec at ${specPath} — nothing to enhance`);
    return;
  }
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  // drop_id format: YYYY-MM-DD-<theme-id>
  const themeId = (spec.drop_id || '').split('-').slice(3).join('-') || 'wrap';
  const headline = spec.slides?.[0]?.title || spec.hook || 'POV Guy Realty Intel';

  await enhanceCover({
    baseImagePath: coverPath,
    theme: themeId,
    headline,
    outPath: coverPath
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => {
    console.warn(`[cover] unhandled: ${e.message} — skipping`);
  });
}
