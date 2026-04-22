# povguy-content-engine

Daily content generator for POV Guy social drops. Reads market data snapshots from `povguy-data-engine`, routes by day-of-week to a content theme, generates carousel + caption via the `/research` skill, then renders 9 PNG slides via Playwright headless Chrome.

## Day-of-week routing

| Day | Theme | Source data | Cover slide hook |
|---|---|---|---|
| Monday | Distress + condo trends | distress-radar + launches | "This week's biggest discounts" |
| Tuesday | HDB | hdb-market | "BTO odds + resale movers" |
| Wednesday | Rental | rental-yield | "Where yields beat 5%" |
| Thursday | Landed | landed (URA direct) | "Landed: who's still selling" |
| Friday | Weekly wrap | aggregated | "What you should have noticed" |
| Saturday | URA masterplan + policy | data.gov.sg + URA | "Government just moved here" |
| Sunday | Geopolitics | macro feeds + WebSearch | "Why this week matters for SG" |

## Pipeline

```
06:00 SGT  GitHub Actions cron
   ↓
1. Fetch latest data snapshot from povguy-data-engine (latest on main)
2. Run src/router.js — selects theme + source files based on day-of-week
3. Run src/generator.js — invokes Claude Code headless with /research skill,
   passes data + theme, gets back JSON: { hook, slides: [...], caption, hashtags }
4. (Optional) Run src/cover-enhancer.js — uses Nanobanana (Gemini 2.5 Flash Image)
   to regenerate cover slide for thumb-stopping power
5. Run src/renderer.js — Playwright screenshots templates/carousel-base.html
   with each slide's data injected, outputs slide-1.png ... slide-9.png
6. Write dist/YYYY-MM-DD/ with all assets + manifest.json
7. Upload as GitHub Actions artifact named `drop-YYYY-MM-DD`
8. Trigger povguy-publisher via repository_dispatch event
```

## Local dev

```bash
npm install
npx playwright install chromium
node src/router.js                    # see today's theme
node src/generator.js --date today    # generate (requires ANTHROPIC_API_KEY)
node src/renderer.js --date today     # render slides
```

## Required secrets

See `.env.example`. Critical: `ANTHROPIC_API_KEY` (for /research skill via Claude Code SDK), `GEMINI_API_KEY` (for Nanobanana cover slides).
