// Renders the Weather Underground 10-day graph into a Kindle-friendly PNG
// and serves it over HTTP. Re-renders every REFRESH_MINUTES.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const URL_TO_CAPTURE = process.env.WU_URL || 'https://www.wunderground.com/forecast/de/munich';
const SELECTOR = process.env.SELECTOR || '.ten-day-frame';
const PORT = Number(process.env.PORT || 8080);
const REFRESH_MINUTES = Number(process.env.REFRESH_MINUTES || 30);
// Kindle 11th gen (2024): 1072x1448 portrait, 300 ppi
const SCREEN_W = Number(process.env.SCREEN_W || 1072);
const SCREEN_H = Number(process.env.SCREEN_H || 1448);
// The 10-day graph is wide, so rotate it to use the long edge of the screen.
const ROTATE = Number(process.env.ROTATE ?? 90);
const OUT_DIR = process.env.OUT_DIR || '/data';
const OUT_FILE = path.join(OUT_DIR, 'weather.png');

let lastOk = null;
let lastError = null;
let rendering = false;

// Akamai sometimes serves a "Challenge Validation" page that solves itself
// and reloads after a while, so allow plenty of time for the real page.
const CHALLENGE_TIMEOUT_MS = Number(process.env.CHALLENGE_TIMEOUT_SECONDS || 180) * 1000;
const ATTEMPTS = Number(process.env.ATTEMPTS || 3);
// Persistent profile keeps Akamai and consent cookies between renders
const PROFILE_DIR = path.join(OUT_DIR, 'chromium-profile');

async function waitForGraph(page) {
  const deadline = Date.now() + CHALLENGE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      // Survives the reload the challenge page triggers when it is done
      return await page.waitForSelector(SELECTOR, { state: 'visible', timeout: 15_000 });
    } catch {
      const title = await page.title().catch(() => '');
      console.log(`waiting for ${SELECTOR} (page: "${title}")`);
    }
  }
  throw new Error(`timed out after ${CHALLENGE_TIMEOUT_MS / 1000}s waiting for ${SELECTOR}`);
}

async function acceptConsent(page) {
  const labels = /^(accept( all)?|agree|i agree|alle akzeptieren|akzeptieren)$/i;
  for (const frame of page.frames()) {
    const btn = frame.getByRole('button', { name: labels }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(1_000);
      return;
    }
  }
}

// Remove consent dialogs, dimming backdrops and sticky headers that sit on
// top of the graph and turn its white background gray.
async function removeOverlays(page) {
  await page.evaluate((sel) => {
    const target = document.querySelector(sel);
    for (const el of document.querySelectorAll('body *')) {
      if (el.contains(target) || target.contains(el)) continue;
      const pos = getComputedStyle(el).position;
      if (pos === 'fixed' || pos === 'sticky') el.style.setProperty('display', 'none', 'important');
    }
    for (const el of [document.documentElement, document.body]) {
      el.style.setProperty('overflow', 'visible', 'important');
      el.style.setProperty('filter', 'none', 'important');
    }
    target.style.setProperty('background', '#ffffff', 'important');
  }, SELECTOR);
}

async function capture() {
  // A crashed run can leave Chromium's profile lock behind
  for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    await fs.rm(path.join(PROFILE_DIR, f), { force: true });
  }
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    viewport: { width: 1400, height: 1800 },
    deviceScaleFactor: 2,
    locale: 'en-US',
    colorScheme: 'light',
    timezoneId: process.env.TZ || 'Europe/Berlin',
  });
  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(URL_TO_CAPTURE, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    const el = await waitForGraph(page);
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await acceptConsent(page);
    // Give the chart time to finish drawing
    await page.waitForTimeout(5_000);
    await removeOverlays(page);
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    return await el.screenshot({ type: 'png' });
  } finally {
    await context.close();
  }
}

async function captureWithRetry() {
  for (let i = 1; ; i++) {
    try {
      return await capture();
    } catch (err) {
      if (i >= ATTEMPTS) throw err;
      console.log(`attempt ${i} failed (${err.message}), retrying in 30s`);
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }
}

// If something still dims the page (e.g. a dark backdrop we could not remove),
// the most common tone is the background: stretch levels so it becomes white
// and the darkest ink becomes black.
async function whitenBackground(buf) {
  const { data } = await sharp(buf).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  const hist = new Array(256).fill(0);
  for (const v of data) hist[v]++;
  const bg = hist.indexOf(Math.max(...hist));
  if (bg >= 235) return buf;
  let black = 0;
  for (let acc = 0; black < bg && (acc += hist[black]) < data.length * 0.005; black++);
  const a = 255 / Math.max(bg - black, 1);
  console.log(`background is gray (${bg}), stretching levels ${black}..${bg} to 0..255`);
  return sharp(buf).linear(a, -a * black).toBuffer();
}

async function toKindle(png) {
  const flat = await whitenBackground(
    await sharp(png).flatten({ background: '#ffffff' }).grayscale().toBuffer(),
  );
  // Cut off empty margins so the graph itself spans the screen
  const trimmed = await sharp(flat).trim({ background: '#ffffff', threshold: 20 }).toBuffer();
  const cleaned = await sharp(trimmed).rotate(ROTATE, { background: '#ffffff' }).toBuffer();
  // Fill the full width (or height if the graph is too tall), then pad to the exact screen size
  const fitted = await sharp(cleaned)
    .resize(SCREEN_W, SCREEN_H, { fit: 'inside', kernel: 'lanczos3' })
    .toBuffer({ resolveWithObject: true });
  const padX = SCREEN_W - fitted.info.width;
  const padY = SCREEN_H - fitted.info.height;
  return sharp(fitted.data)
    .extend({
      left: Math.floor(padX / 2),
      right: Math.ceil(padX / 2),
      top: Math.floor(padY / 2),
      bottom: Math.ceil(padY / 2),
      background: '#ffffff',
    })
    // Push near-white to pure white and near-black to pure black for crisp e-ink
    .linear(1.15, -15)
    .sharpen()
    .png({ colours: 16, palette: true }) // e-ink shows 16 gray levels
    .toBuffer();
}

async function render() {
  if (rendering) return;
  rendering = true;
  const started = Date.now();
  try {
    const out = await toKindle(await captureWithRetry());
    await fs.mkdir(OUT_DIR, { recursive: true });
    await fs.writeFile(OUT_FILE + '.tmp', out);
    await fs.rename(OUT_FILE + '.tmp', OUT_FILE);
    lastOk = new Date();
    lastError = null;
    console.log(`[${lastOk.toISOString()}] rendered in ${Date.now() - started} ms`);
  } catch (err) {
    lastError = String(err?.message || err);
    console.error(`[${new Date().toISOString()}] render failed: ${lastError}`);
  } finally {
    rendering = false;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/weather.png') {
    try {
      const img = await fs.readFile(OUT_FILE);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      return res.end(img);
    } catch {
      res.writeHead(503);
      return res.end('not rendered yet');
    }
  }
  if (url.pathname === '/refresh') {
    await render();
    res.writeHead(lastError ? 500 : 200, { 'Content-Type': 'text/plain' });
    return res.end(lastError || 'ok');
  }
  if (url.pathname === '/health') {
    res.writeHead(lastOk ? 200 : 503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ lastOk, lastError, rendering }));
  }
  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => console.log(`listening on :${PORT}`));
render();
setInterval(render, REFRESH_MINUTES * 60_000);
