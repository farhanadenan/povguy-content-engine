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
 *       { kind: "cover",   title, subtitle, badge, ghost_number? },
 *       { kind: "stat",    tag?, headline, value, change?, footnote, value_color? },
 *       { kind: "list",    tag?, title, items: [string|{text}] },
 *       { kind: "ranking", tag?, title, items: [{label, value, sub, tone}] },
 *       { kind: "tip",     tag?, title, body, quote?, signoff? },
 *       { kind: "cta",     title, title_accent?, primary_cta? }
 *     ],
 *     caption: "<Telegram-safe point-form caption>",
 *     hashtags: ["#sgproperty", ...],
 *     sources: ["URA", "data.gov.sg", ...]
 *   }
 *
 * Caption shape (rendered by publisher exactly as-is, then hashtags appended):
 *   <PUNCHY HOOK in caps or with emoji — ≤90 chars>
 *
 *   • Bullet 1 (≤90 chars)
 *   • Bullet 2 (≤90 chars)
 *   • Bullet 3 (≤90 chars)
 *
 *   <One-line takeaway / what it means for the buyer>
 *
 *   📅 Book a 30-min strategy call → calendly.com/farhan-adenan/30min
 *
 *   — Farhan · POVGUY.SG · +65 9236 1561
 *
 *   #sgproperty #povguy ...
 *
 * Total caption budget (everything above): ≤700 chars including hashtags.
 * Telegram preview cuts at ~200 chars before "show more" — so the HOOK plus
 * first bullet must land in the first 200 chars.
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
as if only the top 0.1% see them. Plain English, zero jargon-padding, no fluff.

Your job: given a theme + source data, output a JSON carousel spec that another
program will render to PNG slides. You write COPY only — never describe visuals.

Return EXACTLY this JSON shape (no prose, no markdown fences):
{
  "drop_id": "YYYY-MM-DD-<theme-id>",
  "theme": "<theme label>",
  "hook": "<10-12 word headline that earns the swipe>",
  "slides": [
    {"kind":"cover","title":"<≤32 char punchy title>","subtitle":"<≤90 char one-liner>","badge":"<≤24 char eyebrow, e.g. 'Rental · Q1 2026'>","ghost_number":"<optional big translucent watermark number, e.g. '5%' or '412'>"},

    {"kind":"stat","tag":"<≤24 char tag>","headline":"<≤60 char framing>","value":"<huge number, ≤8 chars>","change":"<+X% / -X% / blank>","footnote":"<≤140 char source line>","value_color":"<blue|green|red|gold>"},

    {"kind":"list","tag":"<≤24 char tag>","title":"<≤44 char title>","items":["<≤120 char point>","<...>","<...>"]},

    {"kind":"ranking","tag":"<≤24 char tag>","title":"<≤44 char title>","items":[
      {"label":"<≤24 char>","value":"<≤10 char number>","sub":"<≤80 char sub>","tone":"<blue|green|red|gold>"},
      {"label":"<≤24 char>","value":"<≤10 char number>","sub":"<≤80 char sub>","tone":"<blue|green|red|gold>"},
      {"label":"<≤24 char>","value":"<≤10 char number>","sub":"<≤80 char sub>","tone":"<blue|green|red|gold>"},
      {"label":"<≤24 char>","value":"<≤10 char number>","sub":"<≤80 char sub>","tone":"<blue|green|red|gold>"}
    ],"footnote":"<≤120 char source line>"},

    {"kind":"tip","tag":"POV Guy Tip","title":"<≤44 char title>","body":"<≤220 char insight>","quote":"<≤120 char one-liner — the punchline>","signoff":"Farhan Adenan"},

    {"kind":"cta","title":"Ready to make","title_accent":"your next move?","primary_cta":"Book a 30-min strategy call"}
  ],
  "caption": "<see CAPTION RULES below>",
  "hashtags": ["#sgproperty","#povguy","<3-5 niche tags>"],
  "sources": ["URA","data.gov.sg",...]
}

SLIDE RULES
- Total slides: 7-9. ALWAYS start with kind=cover, ALWAYS end with kind=cta.
- Use kind=ranking when comparing 4 buckets (districts, flat types, etc.). Pick tones to tell the story (red = bad, green = good, gold = standout, blue = neutral).
- Use kind=stat for the single biggest number of the day.
- Use kind=list for a 3-5 point breakdown.
- Use kind=tip for the punchline / "what this means for you".
- Numbers must be EXACT, drawn from the source data. If you don't have an exact number, omit that slide rather than approximating.
- Never mention "AI", "automated", "machine learning", or "language model".
- Do NOT include WhatsApp, phone numbers, or any contact details inside slide copy
  — the CTA template renders Calendly + sign-off automatically.

CAPTION RULES (this is what shows on Telegram, FB, IG, Threads — get it right)
- Total length ≤ 700 chars including hashtags.
- Structure (with literal newlines):

  <HOOK — ≤90 chars, punchy, leads with the surprise. Telegram only previews ~200 chars before "show more", so the hook MUST grab attention.>

  • <Bullet 1, ≤90 chars, the core data point>
  • <Bullet 2, ≤90 chars, the contrast or "but">
  • <Bullet 3, ≤90 chars, the implication>

  <Single-line takeaway — what it means for the buyer/seller. ≤120 chars.>

  📅 Book a 30-min strategy call → calendly.com/farhan-adenan/30min

  — Farhan · POVGUY.SG · +65 9236 1561

  #sgproperty #povguy <3-5 niche tags>

- Use real bullet character "•" not "-" or "*".
- Blank line BETWEEN each block (hook / bullets / takeaway / CTA / signoff / hashtags).
- No markdown formatting (no **bold**, no _italic_, no headers).
- Hook should NOT start with the literal word "Hook:" — just the line itself.
- If the data justifies an emoji like 📈 📉 🏠 💰 use ONE at most in the hook line.
- Never use "trade secrets" / "0.1%" framing in published copy — internal positioning only.
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
  // Logs MUST go to stderr — stdout is captured into spec.json by the workflow.
  console.error(`[generator] theme=${theme.id} date=${theme.date}`);

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

  // Defensive: ensure final slide is CTA, even if model forgot.
  const last = spec.slides[spec.slides.length - 1];
  if (!last || last.kind !== 'cta') {
    spec.slides.push({
      kind: 'cta',
      title: 'Ready to make',
      title_accent: 'your next move?',
      primary_cta: 'Book a 30-min strategy call'
    });
  }

  return spec;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await generate();
  console.log(JSON.stringify(result, null, 2));
}
