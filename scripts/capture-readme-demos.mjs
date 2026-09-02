import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.join(root, 'docs/media');
const APP = process.env.DEMO_URL ?? 'http://127.0.0.1:8890';

await mkdir(outDir, { recursive: true });

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

const browser = await chromium.launch({
  headless: false,
  args: ['--use-gl=angle', '--use-angle=metal'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  recordVideo: { dir: '/tmp/lg-readme-demo', size: { width: 1440, height: 900 } },
});
await context.addInitScript(() => {
  localStorage.setItem('lg-tour-seen', '1');
  localStorage.setItem('lg-language', 'spanish');
});
const page = await context.newPage();
page.setDefaultTimeout(60_000);

await page.goto(APP, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 45_000 });
await page.waitForFunction(() => !document.querySelector('.boot:not(.boot--done)'), { timeout: 45_000 });
await page.waitForTimeout(2500);

await page.screenshot({ path: path.join(outDir, 'globe.png'), type: 'png' });
console.log('wrote globe.png');

await page.locator('.language-picker select').selectOption('italian');
await page.waitForFunction(() => document.body.innerText.includes('Italian radio'), { timeout: 30_000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(outDir, 'italian.png'), type: 'png' });
console.log('wrote italian.png');

await page.locator('.language-picker select').selectOption('spanish');
await page.waitForFunction(() => document.body.innerText.includes('Spanish radio'), { timeout: 30_000 });
await page.waitForTimeout(1500);

for (let attempt = 0; attempt < 10; attempt++) {
  await page.getByRole('button', { name: /Surprise me/i }).click();
  await page.waitForTimeout(2800);
  const hay = ((await page.locator('.player').textContent()) ?? '').toLowerCase();
  if (/talk|news|noticias/.test(hay) && !/player--empty/.test((await page.locator('.player').getAttribute('class')) ?? '')) {
    console.log('station:', hay.slice(0, 120));
    break;
  }
}

const cc = page.locator('.player__cc');
if (await cc.count()) {
  await cc.click();
  const deadline = Date.now() + 180_000;
  let live = false;
  while (Date.now() < deadline) {
    if (await page.locator('.subtitles__word').count()) {
      live = true;
      break;
    }
    const stage = (await page.locator('.subtitles').textContent().catch(() => '')) ?? '';
    console.log('waiting captions...', stage.trim().slice(0, 80));
    await page.waitForTimeout(4000);
  }
  if (live) {
    await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(outDir, 'karaoke.png'), type: 'png' });
    console.log('wrote karaoke.png');

    const clickable = page.locator('.subtitles__word--clickable').first();
    if (await clickable.count()) {
      await clickable.click();
      await page.waitForTimeout(2500);
      if (await page.locator('.lookup, [class*="lookup"]').count()) {
        await page.screenshot({ path: path.join(outDir, 'word-lookup.png'), type: 'png' });
        console.log('wrote word-lookup.png');
      }
    }
  } else {
    console.log('no captions — keeping previous karaoke stills');
  }
}

await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.getByRole('button', { name: /What is this app/i }).click();
await page.waitForSelector('.tour');
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(outDir, 'tour.png'), type: 'png' });
console.log('wrote tour.png');
await page.getByRole('button', { name: /Skip tour/i }).first().click().catch(() => page.keyboard.press('Escape'));

const video = page.video();
await context.close();
await browser.close();

if (video) {
  const webm = await video.path();
  const gif = path.join(outDir, 'demo-karaoke.gif');
  await run('ffmpeg', [
    '-y',
    '-i',
    webm,
    '-vf',
    'fps=12,scale=1280:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer',
    '-loop',
    '0',
    gif,
  ]);
  console.log('wrote demo-karaoke.gif from', webm);
}

await writeFile(path.join(outDir, '.captured'), `${new Date().toISOString()}\n`, 'utf8');
console.log('done');
