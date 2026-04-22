/**
 * Playwright HTML→PNG carousel renderer.
 * Reads dist/<date>/spec.json, renders each slide using templates/carousel-base.html
 * by injecting slide data via URL hash, screenshots to slide-N.png at 1080x1350 (4:5).
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const SLIDE_W = 1080;
const SLIDE_H = 1350; // IG portrait 4:5

async function renderDrop(dropDir) {
  const spec = JSON.parse(fs.readFileSync(path.join(dropDir, 'spec.json'), 'utf8'));
  const templatePath = path.resolve(process.cwd(), 'templates/carousel-base.html');
  const templateUrl = `file://${templatePath}`;

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: SLIDE_W, height: SLIDE_H } });
  const page = await context.newPage();

  for (let i = 0; i < spec.slides.length; i++) {
    const slide = spec.slides[i];
    const basePayload = { ...slide, _index: i + 1, _total: spec.slides.length, _drop: spec };
    const payload = encodeURIComponent(JSON.stringify(basePayload));
    await page.goto(`${templateUrl}#${payload}`, { waitUntil: 'networkidle' });
    // Give CSS animations time to settle
    await page.waitForTimeout(200);
    const out = path.join(dropDir, `slide-${i + 1}.png`);
    await page.screenshot({ path: out, type: 'png', omitBackground: false });
    console.log(`[renderer] ${out}`);

    // For slides we plan to AI-enhance (cover, stat, tip): also emit a
    // transparent-bg overlay PNG (text/UI only) so cover-enhancer can composite
    // the overlay on top of the AI-generated background.
    if (slide.kind === 'cover' || slide.kind === 'stat' || slide.kind === 'tip') {
      const overlayPayload = encodeURIComponent(JSON.stringify({ ...basePayload, _overlay: true }));
      await page.goto(`${templateUrl}#${overlayPayload}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(200);
      const overlayOut = path.join(dropDir, `slide-${i + 1}-overlay.png`);
      await page.screenshot({ path: overlayOut, type: 'png', omitBackground: true });
      console.log(`[renderer] ${overlayOut} (transparent overlay)`);
    }
  }
  await browser.close();

  // Write caption.txt and manifest.json
  fs.writeFileSync(path.join(dropDir, 'caption.txt'), spec.caption);

  // Construct jsDelivr CDN URLs for each slide.
  // These URLs become live AFTER the workflow commits dist/<date>/ to output/<date>/ in this repo.
  // Pinning to @main keeps them auto-updating; for stronger immutability swap @main for @<commit-sha>.
  const cdnOwner   = process.env.IMAGE_CDN_OWNER   || 'farhanadenan';
  const cdnRepo    = process.env.IMAGE_CDN_REPO    || 'povguy-content-engine';
  const cdnBranch  = process.env.IMAGE_CDN_BRANCH  || 'main';
  const cdnPrefix  = process.env.IMAGE_CDN_PREFIX  || 'output';
  const dateSegment = path.basename(dropDir);
  const imageUrls = Array.from({ length: spec.slides.length }, (_, i) =>
    `https://cdn.jsdelivr.net/gh/${cdnOwner}/${cdnRepo}@${cdnBranch}/${cdnPrefix}/${dateSegment}/slide-${i + 1}.png`
  );

  fs.writeFileSync(path.join(dropDir, 'manifest.json'), JSON.stringify({
    drop_id: spec.drop_id,
    theme: spec.theme,
    hook: spec.hook,
    slide_count: spec.slides.length,
    hashtags: spec.hashtags,
    sources: spec.sources,
    rendered_at: new Date().toISOString(),
    image_urls: imageUrls,
    image_cdn: { owner: cdnOwner, repo: cdnRepo, branch: cdnBranch, prefix: cdnPrefix }
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const date = process.argv[2] || new Date().toISOString().slice(0, 10);
  const dir = path.join(process.env.DROPS_DIR || './dist', date);
  await renderDrop(dir);
}
