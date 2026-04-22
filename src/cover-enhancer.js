/**
 * Nanobanana cover slide enhancer.
 * Uses Gemini 2.5 Flash Image (model: gemini-2.5-flash-image-preview).
 *
 * Takes the rendered slide-1.png (cover), and asks Gemini to reimagine it with
 * dynamic Singapore skyline / context relevant to the theme, while preserving
 * the headline text and POV Guy brand colors.
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const MODEL = 'gemini-2.5-flash-image-preview';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const PROMPT_BY_THEME = {
  distress: 'A moody dusk shot of Singapore CBD skyline with one condo highlighted in warm light, others muted. Cinematic, photographic, 4:5 aspect.',
  hdb: 'A vibrant golden-hour shot of HDB blocks in a mature estate, washing lines, real lived-in feel. Photographic, 4:5.',
  rental: 'Bright morning shot through a luxury condo balcony overlooking Marina Bay, depth of field. Photographic, 4:5.',
  landed: 'Quiet morning street view of a Bukit Timah black-and-white bungalow, lush canopy, soft mist. Photographic, 4:5.',
  wrap: 'Singapore skyline at blue hour with subtle motion blur on traffic light trails. Photographic, 4:5.',
  masterplan: 'Top-down architectural view of Singapore master plan rendering, isometric, blueprint-style. 4:5.',
  geopolitics: 'World map composite with Singapore highlighted, financial chart overlay, dramatic lighting. 4:5.'
};

export async function enhanceCover({ baseImagePath, theme, headline, outPath }) {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('[cover] GEMINI_API_KEY missing — skipping enhancement');
    return null;
  }
  const baseImage = fs.readFileSync(baseImagePath);
  const prompt = `
${PROMPT_BY_THEME[theme] || PROMPT_BY_THEME.wrap}

CRITICAL: Preserve this headline overlay text exactly: "${headline}"
CRITICAL: Use POV Guy brand color #0a2540 (deep navy) for any text or panel backgrounds.
CRITICAL: Output is a 1080x1350 portrait social slide.
`.trim();

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

  const res = await fetch(`${ENDPOINT}?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data.error) throw new Error(`[cover] Gemini error: ${data.error.message}`);

  const part = data.candidates[0].content.parts.find(p => p.inline_data);
  if (!part) throw new Error('[cover] no image returned');
  fs.writeFileSync(outPath, Buffer.from(part.inline_data.data, 'base64'));
  return outPath;
}
