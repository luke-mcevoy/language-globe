// Watch the cinematic subtitles and quantify how much they move.
// Samples bounding boxes of the subtitle layer + every word span at 5 Hz
// while recording video, then reports layout-shift statistics.
import { chromium } from 'playwright';

const APP = 'http://localhost:5200';

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: '/tmp/subtitle-watch', size: { width: 1440, height: 900 } },
});
const page = await context.newPage();
await page.goto(APP, { waitUntil: 'networkidle' });
await page.waitForSelector('canvas', { timeout: 30000 });

// Pick a talk/news station via Surprise me, rerolling away from music.
for (let attempt = 0; attempt < 12; attempt++) {
  await page.click('text=Surprise me');
  await page.waitForTimeout(2500);
  const tag = await page
    .locator('.player .tag, .player__tag, [class*="tag"]')
    .first()
    .textContent()
    .catch(() => '');
  const body = await page.locator('.player, [class*="player"]').first().textContent().catch(() => '');
  const hay = `${tag} ${body}`.toLowerCase();
  if (/talk|news|noticias/.test(hay)) {
    console.log('station picked:', body?.slice(0, 90));
    break;
  }
}

// Enable captions.
await page.click('text=CC');
console.log('CC enabled, waiting for sync + first subtitle...');
const deadline = Date.now() + 240000;
let live = false;
while (Date.now() < deadline) {
  if (await page.locator('.subtitles__line').count()) {
    live = true;
    break;
  }
  const stage = await page.locator('.subtitles__stage').textContent().catch(() => '(no stage)');
  const panel = await page.locator('.captions').textContent().catch(() => '');
  console.log(`  waiting... stage="${stage?.trim().slice(0, 60)}" panel="${panel?.trim().slice(0, 80)}"`);
  await page.waitForTimeout(10000);
}
if (!live) {
  console.log('never got a subtitle line — giving up');
  await context.close();
  await browser.close();
  process.exit(2);
}
console.log('subtitles live — sampling for 45s');

const samples = [];
const t0 = Date.now();
while (Date.now() - t0 < 45000) {
  const snap = await page.evaluate(() => {
    const layer = document.querySelector('.subtitles__layer--in');
    const line = layer?.querySelector('.subtitles__line');
    if (!line) return null;
    const lineBox = line.getBoundingClientRect();
    const words = [...line.querySelectorAll('.subtitles__word')].map((w) => {
      const b = w.getBoundingClientRect();
      return { t: w.textContent, x: Math.round(b.x), y: Math.round(b.y), cur: w.className.includes('current') };
    });
    const stage = document.querySelector('.subtitles__stage').getBoundingClientRect();
    return {
      time: Date.now(),
      lineTop: Math.round(lineBox.top),
      lineH: Math.round(lineBox.height),
      stageTop: Math.round(stage.top),
      stageH: Math.round(stage.height),
      words,
    };
  });
  if (snap) samples.push(snap);
  await page.waitForTimeout(200);
}

// Analyze: word-position churn between consecutive samples of the SAME text.
let reflowEvents = 0;
let maxShift = 0;
const shiftLog = [];
for (let i = 1; i < samples.length; i++) {
  const a = samples[i - 1];
  const b = samples[i];
  const aText = a.words.map((w) => w.t).join(' ');
  const bText = b.words.map((w) => w.t).join(' ');
  if (aText !== bText || a.words.length !== b.words.length) continue; // chunk swap, skip
  let worst = 0;
  let worstWord = '';
  for (let j = 0; j < a.words.length; j++) {
    const dx = Math.abs(a.words[j].x - b.words[j].x);
    const dy = Math.abs(a.words[j].y - b.words[j].y);
    const d = Math.max(dx, dy);
    if (d > worst) {
      worst = d;
      worstWord = a.words[j].t;
    }
  }
  if (worst > 1) {
    reflowEvents++;
    maxShift = Math.max(maxShift, worst);
    if (shiftLog.length < 15)
      shiftLog.push(
        `+${((b.time - t0 - (samples[0].time - t0)) / 1000).toFixed(1)}s worst word "${worstWord}" moved ${worst}px`,
      );
  }
}
const lineTops = samples.map((s) => s.lineTop);
const lineHs = samples.map((s) => s.lineH);
console.log('\n=== movement report ===');
console.log('samples:', samples.length);
console.log('line top range:', Math.min(...lineTops), '→', Math.max(...lineTops), `(span ${Math.max(...lineTops) - Math.min(...lineTops)}px)`);
console.log('line height range:', Math.min(...lineHs), '→', Math.max(...lineHs));
console.log('same-text reflow events (words moved >1px without chunk change):', reflowEvents, '/', samples.length - 1);
console.log('worst single-word shift:', maxShift, 'px');
shiftLog.forEach((l) => console.log('  ', l));

await context.close();
await browser.close();
const fs = await import('node:fs');
const vids = fs.readdirSync('/tmp/subtitle-watch').filter((f) => f.endsWith('.webm'));
console.log('video:', '/tmp/subtitle-watch/' + vids[vids.length - 1]);
