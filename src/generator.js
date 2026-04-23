/**
 * Carousel + caption generator (v6 — 10-slide "Punchy Type" format).
 *
 * Output (JSON spec.json):
 *   {
 *     drop_id: "2026-04-23-landed",
 *     theme: "Landed market",
 *     hook: "Sentosa Cove just printed its first sub-S$2k psf sale",
 *     slides: [ {kind, ...}, ... ],   // exactly 10 slides
 *     caption: "...",
 *     sources: [...]
 *   }
 *
 * NOTE: We deliberately do NOT generate hashtags. Per Farhan (2026-04-23),
 * hashtags are a 2024 pattern and don't drive reach for our long-form
 * Singapore property captions. Captions end with the signoff line, not "#tag".
 *
 * SLIDE KIND PAYLOADS (must match content-engine/templates/carousel-base.html)
 *   cover    { title_parts:[{text,style}], badge, sub, eyebrow? }
 *   context  { lead, headline_parts:[{text,style}], chips:[{text,hot?}], source? }
 *   stat     { eyebrow?, pre, pre_accent?, value, change?, value_color?, post?, source? }
 *   list     { eyebrow?, title, title_accent?, items:[{body}|string], source? }
 *   ranking  { eyebrow?, title, title_accent?, items:[{label, sub?, value}], source? }
 *   pov_take { eyebrow?, label?, headline_parts:[{text,style}], punch?, punch_bold?, by? }
 *   tip      { eyebrow?, quote_parts:[{text,style}], by? }
 *   cta      { eyebrow?, pre?, title, title_accent?, sub?, url, button_sub? }
 *   save     { eyebrow?, title, title_accent?, sub? }
 *
 * `parts` is an array of inline runs, each `{ text, style }` where style is
 *   'plain' | 'yellow' | 'strike' | 'em' | 'break'
 *
 * SLOT MAP (default 10-slide flow — model can reorder middle 2-8 if it wants):
 *   01 cover       — punchy hook, max 3 short lines
 *   02 context     — one-sentence frame: what just happened
 *   03 stat        — the headline number
 *   04 list        — 3 bullet breakdown / "why it matters"
 *   05 ranking     — 3-4 row comparison (optional second stat OK)
 *   06 pov_take    — Farhan's POV, signature voice
 *   07 stat / list — second data beat (different metric than slot 3)
 *   08 tip         — quotable one-liner that screenshots well
 *   09 cta         — book the call
 *   10 save        — engagement close: ONE-line "forward this" prompt
 *                    (kind name is historical; copy is forward-framed,
 *                    never "save this". Save is a low-effort ask; forwarding
 *                    is what spreads the data and gets new opt-ins.)
 *
 * Caption rules: see CAPTION RULES inside the system prompt below.
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { themeForDate } from './router.js';

const SYSTEM_PROMPT = `
You are the /research skill operating for POV Guy Realtor (Farhan Adenan, CEA R068636D).

Brand voice: senior Singapore property strategist with 20+ years advising UHNWI.
Data-driven, cites URA / HDB / MAS / SRX / EdgeProp, treats insights as if only the
top 0.1% see them. Plain English, zero jargon-padding, no fluff. Confident but never
arrogant — the value is in the data, not in your hot takes.

Your job: given a theme + source data, output a JSON carousel spec that another
program will render to PNG slides. You write COPY only — never describe visuals.
Return EXACTLY this JSON shape (no prose, no markdown fences, no commentary).

PLACEHOLDER RULE (CRITICAL):
Every <angle-bracket string> in the schema below is a PLACEHOLDER describing what
to write — NEVER copy the placeholder text or its example into your output.
If you see "<e.g. 'Headline Number'>", DO NOT write "Headline Number" — invent a
fresh, topical 2-3 word eyebrow tied to the actual data (e.g. "Coral Island PSF",
"Median Print", "Volume Shift"). Same for every other example value.

JSON shape:

{
  "drop_id": "YYYY-MM-DD-<theme-id>",
  "theme": "<theme label e.g. Landed market>",
  "hook": "<10-12 word headline that earns the swipe>",
  "slides": [
    /* SLOT 01 — cover */
    {
      "kind":"cover",
      "eyebrow":"<≤32 char brand line e.g. 'POV GUY · LANDED · APR 26'>",
      "title_parts":[
        {"text":"Sentosa Cove just printed","style":"plain"},
        {"style":"break"},
        {"text":"its first","style":"plain"},
        {"text":"sub-S$2k","style":"yellow"},
        {"text":"psf sale","style":"plain"}
      ],
      "badge":"<≤32 char tag e.g. 'Landed · Q2 2026'>",
      "sub":"<≤120 char one-liner subhead>"
    },

    /* SLOT 02 — context */
    {
      "kind":"context",
      "eyebrow":"<e.g. 'What just happened'>",
      "lead":"<≤80 char setup — the one-sentence frame>",
      "headline_parts":[
        {"text":"A","style":"plain"},
        {"text":"$1,950 psf","style":"yellow"},
        {"text":"deal closed Tuesday — that's","style":"plain"},
        {"text":"$2,400","style":"strike"},
        {"text":"two years ago.","style":"plain"}
      ],
      "chips":[
        {"text":"District 4","hot":false},
        {"text":"Bungalow","hot":false},
        {"text":"-19% in 24mo","hot":true}
      ],
      "source":"<≤60 char e.g. 'URA caveats · POV Guy analysis'>"
    },

    /* SLOT 03 — stat */
    {
      "kind":"stat",
      "eyebrow":"<2-3 word topical eyebrow tied to THIS stat — e.g. 'Coral Island PSF', 'Median Print', 'Volume Shift'. NOT 'Headline Number'>",
      "pre":"<≤60 char setup line — e.g. 'Sentosa Cove median PSF'>",
      "pre_accent":"<optional substring of pre to render in yellow>",
      "value":"<huge number, ≤8 chars e.g. 'S$1,950'>",
      "change":"<+X% / -X% / blank>",
      "value_color":"<yellow|''>",
      "post":"<≤120 char tail line e.g. 'lowest print since 2017'>",
      "source":"<≤60 char attribution>"
    },

    /* SLOT 04 — list */
    {
      "kind":"list",
      "eyebrow":"<e.g. 'Why this matters'>",
      "title":"<≤60 char title>",
      "title_accent":"<optional substring of title for yellow accent>",
      "items":[
        {"body":"<≤120 char point 1 — lead with the number>"},
        {"body":"<≤120 char point 2 — the contrast>"},
        {"body":"<≤120 char point 3 — the implication>"}
      ],
      "source":"<≤60 char attribution>"
    },

    /* SLOT 05 — ranking */
    {
      "kind":"ranking",
      "eyebrow":"<e.g. 'Ranked · This Week'>",
      "title":"<≤60 char title — what is being ranked>",
      "title_accent":"<optional substring for yellow>",
      "items":[
        {"label":"<≤24 char>","sub":"<≤60 char qualifier>","value":"<≤10 char>"},
        {"label":"<≤24 char>","sub":"<≤60 char qualifier>","value":"<≤10 char>"},
        {"label":"<≤24 char>","sub":"<≤60 char qualifier>","value":"<≤10 char>"},
        {"label":"<≤24 char>","sub":"<≤60 char qualifier>","value":"<≤10 char>"}
      ],
      "source":"<≤60 char attribution>"
    },

    /* SLOT 06 — pov_take */
    {
      "kind":"pov_take",
      "eyebrow":"<e.g. 'POV Guy · Take'>",
      "label":"<≤32 char e.g. 'Why it matters'>",
      "headline_parts":[
        {"text":"This isn't a","style":"plain"},
        {"text":"crash","style":"strike"},
        {"text":"— it's","style":"plain"},
        {"text":"price discovery.","style":"yellow"}
      ],
      "punch":"<≤180 char setup — sets up the punchline>",
      "punch_bold":"<≤80 char punchline rendered in bold weight>",
      "by":"Farhan Adenan · CEA R068636D"
    },

    /* SLOT 07 — second data beat (use stat OR list, not ranking) */
    {
      "kind":"stat",
      "eyebrow":"<different angle than slot 3 — e.g. 'Volume Side'>",
      "pre":"<setup>",
      "value":"<number>",
      "change":"<delta>",
      "post":"<tail>",
      "source":"<attribution>"
    },

    /* SLOT 08 — tip (quotable one-liner that screenshots well) */
    {
      "kind":"tip",
      "eyebrow":"<e.g. 'POV Guy · Tip'>",
      "quote_parts":[
        {"text":"In a","style":"plain"},
        {"text":"discovery market,","style":"yellow"},
        {"style":"break"},
        {"text":"the","style":"plain"},
        {"text":"first","style":"strike"},
        {"text":"third bid usually wins.","style":"plain"}
      ],
      "by":"Farhan Adenan · POV Guy Realtor"
    },

    /* SLOT 09 — cta (URL CTA — NOT a clickable button)
       NOTE: There is NO "button_text" with action-words. IG/social images can't link
       out, so the prominent yellow pill MUST display the URL itself (the user has to
       type it). The renderer constructs the button as "<url> →" automatically.
       Optionally provide "button_sub" for a tiny line beneath (e.g. "type into your browser ↑"). */
    {
      "kind":"cta",
      "eyebrow":"<e.g. 'Your Move'>",
      "pre":"<≤44 char setup e.g. 'Looking at landed in D4 / D9 / D10?'>",
      "title":"<≤44 char e.g. 'Let's map your'>",
      "title_accent":"<≤32 char e.g. 'next move.'>",
      "sub":"<≤140 char e.g. '30-min strategy call. No pitch — just the data and the angles.'>",
      "url":"povguy.sg/strategy-call",
      "button_sub":"<optional ≤40 char hint e.g. 'type into your browser ↑' — leave empty if redundant>"
    },

    /* SLOT 10 — save (engagement close: FORWARD framing, never "save")
       The kind is named "save" for legacy template routing, but the COPY must be
       a forward-this prompt. One short sentence, one ask. Never "save this for
       later" — that's a 2023 IG pattern. Forwarding is what grows the audience. */
    {
      "kind":"save",
      "eyebrow":"<e.g. 'One last thing'>",
      "title":"<≤32 char e.g. 'Forward this to'>",
      "title_accent":"<≤24 char e.g. 'someone deciding.'>",
      "sub":"<≤90 char ONE sentence — e.g. 'If you know anyone weighing landed in D4 this week, send them this.'>"
    }
  ],
  "caption": "<see CAPTION RULES below>",
  "sources": ["URA","SRX","data.gov.sg",...]
}

HARD RULES
- Output EXACTLY 10 slides in the exact order above. Do NOT skip slots, do NOT
  reorder, do NOT add extras. Slot 01 is always cover, slot 10 is always save.
- For slot 07, choose either kind=stat or kind=list (NOT ranking — slot 5 has that).
  The angle MUST be different from slot 3 — different metric, different cut, different
  geography. If you can't find a second data beat that's genuinely different, use
  kind=list with 3 bullets that don't repeat earlier slides.
- Numbers must be EXACT, drawn from the source data. If you don't have an exact
  number for a slot, use the nearest defensible figure and qualify in 'post' or 'sub'
  (e.g. "approx. range, 30-day rolling"). Never invent precision you don't have.

PARTS ARRAY RULES (title_parts / headline_parts / quote_parts / etc.)
- Each part: { "text": "<word or short phrase>", "style": "plain"|"yellow"|"strike"|"em" }
- Use { "style": "break" } (no text) to force a line break.
- One yellow accent per heading max, two if absolutely earned. Yellow is for the
  word that carries the punchline — usually a number, a contrast, or the surprise.
- "strike" is for the OLD value being replaced by the NEW value (yellow). Used to
  make a before/after pop without a chart. Use sparingly — 0-2 times per carousel.
- Every text run is rendered with a single space between it and the next run.
  Punctuation goes inside the text run (e.g. "discovery." not "discovery" + ".").
- Keep total visible length per heading ≤ 90 chars (sum of all text runs).

VOICE & CONTENT RULES
- Never mention "AI", "automated", "machine learning", or "language model".
- Do NOT include WhatsApp / phone / email inside slide copy — chrome handles it.
- Cover title is 3 short lines max (use \\n{break} parts), each ≤ 30 chars.
- pov_take headline should land like a tweet — opinionated, sharp, defensible.
- tip quote should be screenshot-worthy — short, surprising, repeatable.

CAPTION RULES (this is what shows on Telegram, FB, IG, Threads)
- Total length ≤ 600 chars.
- DO NOT include any hashtags. Captions end with the signoff line — that's the
  last thing readers see. Hashtags are a 2024 pattern and dilute the brand.
- Structure (with literal newlines):

  <HOOK — ≤90 chars, punchy, leads with the surprise. Telegram only previews
  ~200 chars before "show more", so the hook MUST grab attention.>

  • <Bullet 1, ≤90 chars, the core data point>
  • <Bullet 2, ≤90 chars, the contrast or "but">
  • <Bullet 3, ≤90 chars, the implication>

  <Single-line takeaway — what it means for the buyer/seller. ≤120 chars.>

  📅 Book a 30-min strategy call → povguy.sg/strategy-call

  — Farhan · POVGUY.SG · +65 9236 1561

- Use real bullet character "•" not "-" or "*".
- Blank line BETWEEN each block (hook / bullets / takeaway / CTA / signoff).
- No markdown formatting (no **bold**, no _italic_, no headers).
- No hashtags anywhere — not at the end, not inline, not in the bullets.
- Hook should NOT start with the literal word "Hook:" — just the line itself.
- If the data justifies an emoji like 📈 📉 🏠 💰 use ONE at most in the hook line.
- Never use "trade secrets" / "0.1%" framing in published copy — internal positioning only.
`.trim();

async function loadSnapshot(theme, dropDate) {
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

/* ----- Defensive normalization ------------------------------------------- *
 * Ensures the spec has the slot structure our pipeline depends on, even if
 * the model drifts. We never replace creative content — only patch missing
 * structural fields and pad/trim to exactly 10 slides.
 * ------------------------------------------------------------------------- */
function normalizeSpec(spec, theme) {
  spec.slides = Array.isArray(spec.slides) ? spec.slides : [];

  // 1. Force slot 1 = cover. If model returned non-cover first slide, prepend a stub.
  if (!spec.slides[0] || spec.slides[0].kind !== 'cover') {
    spec.slides.unshift({
      kind: 'cover',
      eyebrow: `POV GUY · ${theme.label.toUpperCase()}`,
      title_parts: [
        { text: spec.hook || theme.label, style: 'plain' },
      ],
      badge: theme.label,
      sub: '',
    });
  }

  // 2. Force slot 10 = save (forward-framed close — historical kind name).
  const last = spec.slides[spec.slides.length - 1];
  if (!last || last.kind !== 'save') {
    spec.slides.push({
      kind: 'save',
      eyebrow: 'One last thing',
      title: 'Forward this to',
      title_accent: 'someone deciding.',
      sub: 'If you know anyone weighing a move this week, send it their way.',
    });
  }

  // 3. Force slot 9 = cta (immediately before save). If second-to-last isn't cta, insert one.
  const idx9 = spec.slides.length - 2;
  if (idx9 < 1 || spec.slides[idx9]?.kind !== 'cta') {
    spec.slides.splice(spec.slides.length - 1, 0, {
      kind: 'cta',
      eyebrow: 'Your Move',
      pre: 'Want the angle the dashboards miss?',
      title: 'Let\'s map your',
      title_accent: 'next move.',
      sub: '30-min strategy call. No pitch — just the data and the angles.',
      url: 'povguy.sg/strategy-call',
      button_sub: 'type into your browser ↑',
    });
  }

  // 4. Pad / trim to exactly 10 slides. If short, fill middle with a generic tip.
  while (spec.slides.length < 10) {
    // insert before the cta (which is at length-2)
    spec.slides.splice(spec.slides.length - 2, 0, {
      kind: 'tip',
      eyebrow: 'POV Guy · Tip',
      quote_parts: [
        { text: 'Data without context is noise.', style: 'plain' },
        { style: 'break' },
        { text: 'Context without action is trivia.', style: 'yellow' },
      ],
      by: 'Farhan Adenan · POV Guy Realtor',
    });
  }
  if (spec.slides.length > 10) {
    // Trim from the middle (preserve cover at 0 and cta+save at end).
    const overflow = spec.slides.length - 10;
    spec.slides.splice(1, overflow);
  }

  return spec;
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

Produce the 10-slide carousel JSON now. Remember: exactly 10 slides, slot 1 = cover,
slot 10 = save, slot 9 = cta. Use parts arrays for title_parts / headline_parts /
quote_parts. Every number must be exact.
`.trim();

  let response, text, spec, lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 12000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }]
      });
      text = response?.content?.[0]?.text || '';
      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
        throw new Error(`no JSON braces in model output (len=${text.length}, stop_reason=${response?.stop_reason}, first_200_chars=${JSON.stringify(text.slice(0, 200))})`);
      }
      spec = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
      if (!spec?.slides || !Array.isArray(spec.slides) || spec.slides.length === 0) {
        throw new Error(`spec missing slides[] (got keys: ${Object.keys(spec || {}).join(',')}, stop_reason=${response?.stop_reason})`);
      }
      break;
    } catch (e) {
      lastErr = e;
      console.error(`[generator] attempt ${attempt}/3 failed: ${e.message}`);
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
  }
  if (!spec) {
    throw new Error(`generator failed after 3 attempts: ${lastErr?.message}`);
  }

  // Defensive normalization — guarantees exactly 10 slides with correct slot anchors.
  spec = normalizeSpec(spec, theme);

  console.error(`[generator] spec normalized: ${spec.slides.length} slides, kinds=${spec.slides.map(s => s.kind).join(',')}`);
  return spec;
}

// Robust ESM CLI guard — pathToFileURL handles paths with spaces.
// (Bare `file://${process.argv[1]}` no-ops silently when cwd has spaces.)
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await generate();
  console.log(JSON.stringify(result, null, 2));
}
