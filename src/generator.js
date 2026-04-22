/**
 * Carousel + caption generator.
 * Calls Claude with the /research skill prompt embedded inline (skill content baked in).
 *
 * Output (JSON):
 *   {
 *     drop_id: "2026-04-22-rental",
 *     theme: "Rental market",
 *     hook: "Where yields beat 5% net this week",
 *     slides: [
 *       { kind: "cover", title, subtitle, badge },
 *       { kind: "stat", headline, value, change, footnote },
 *       { kind: "list", title, items: [...] },
 *       { kind: "chart", chart_type, data, caption },
 *       { kind: "tip", title, body, signoff },
 *       { kind: "cta", title, primary_cta, whatsapp_link }
 *     ],
 *     caption: "<full IG/FB caption with hashtags>",
 *     hashtags: ["#sgproperty", ...],
 *     sources: ["URA", "data.gov.sg", ...]
 *   }
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { themeForDate } from './router.js';

const SYSTEM_PROMPT = `
You are the /research skill operating for POV Guy Realtor (Farhan Adenan, CEA R068636D).

Brand voice: senior Singapore property strategist with 20+ years advising UHNWI.
Data-driven, cites URA / HDB / MAS / SRX / EdgeProp, never hedges, treats insights
as trade secrets only the top 0.1% see.

Your job: given a theme + source data, output a JSON carousel spec that another
program will render to PNG slides. You write the COPY only — never describe visuals.

Schema (return exactly this JSON shape, no prose):
{
  "drop_id": "YYYY-MM-DD-<theme-id>",
  "theme": "<theme label>",
  "hook": "<10-12 word headline that earns the swipe>",
  "slides": [
    {"kind":"cover","title":"...","subtitle":"...","badge":"..."},
    {"kind":"stat","headline":"...","value":"...","change":"...","footnote":"..."},
    ... 7-9 slides total ...
    {"kind":"cta","title":"...","primary_cta":"...","whatsapp_link":"https://wa.me/message/D7DL37LI5GJ3H1"}
  ],
  "caption": "<400-1000 char caption ending with hashtags. Open with the hook, deliver one specific insight, close with CTA.>",
  "hashtags": ["#sgproperty","#povguy","..."],
  "sources": ["URA","..."]
}

Rules:
- Always include a cover slide (kind=cover) and a CTA slide (kind=cta) at end
- 7-9 slides total
- Numbers must be EXACT, not approximate. If you don't have an exact number, say so.
- Caption must include #sgproperty #povguy and 3-5 niche tags.
- Never mention "AI" or "automated".
- Never use the phrase "trade secrets" in published copy — that's our internal positioning.
`.trim();

async function loadSnapshot(theme, dropDate) {
  // For now, look for snapshot at ../snapshots/<date>/<source>.json
  // In production, content-engine pulls these from data-engine's release artifacts.
  const dir = path.join(process.cwd(), 'snapshots', dropDate);
  const data = {};
  if (!fs.existsSync(dir)) {
    console.warn(`[generator] snapshot dir missing: ${dir} — using stub data`);
    return { _stub: true, theme: theme.id };
  }
  for (const src of theme.sources) {
    const file = path.join(dir, `${src.replace(/\//g, '-')}.json`);
    if (fs.existsSync(file)) {
      data[src] = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  }
  return data;
}

export async function generate(date = new Date()) {
  const theme = themeForDate(date);
  console.log(`[generator] theme=${theme.id} date=${theme.date}`);

  const snapshot = await loadSnapshot(theme, theme.date);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const userPrompt = `
Theme: ${theme.label} (${theme.id})
Date: ${theme.date}
Research focus: ${theme.research_query}

Source data (truncate as needed for prompt budget):
\`\`\`json
${JSON.stringify(snapshot, null, 2).slice(0, 30_000)}
\`\`\`

Produce the carousel JSON now.
`.trim();

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }]
  });

  const text = response.content[0].text;
  // Extract first { ... } JSON block
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  const spec = JSON.parse(text.slice(jsonStart, jsonEnd + 1));

  return spec;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await generate();
  console.log(JSON.stringify(result, null, 2));
}
