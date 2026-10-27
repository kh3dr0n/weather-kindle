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

async function capture() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1400, height: 1800 },
      deviceScaleFactor: 2,
      locale: 'en-US',
      timezoneId: process.env.TZ || 'Europe/Berlin',
    });
    await page.goto(URL_TO_CAPTURE, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    const el = await page.waitForSelector(SELECTOR, { state: 'visible', timeout: 90_000 });
    // Give the chart time to finish drawing
    await page.waitForTimeout(5_000);
    // Hide cookie banners / ads that may overlap the graph
    await page.addStyleTag({
      content: '#onetrust-consent-sdk, .ad-wrapper, [id^="google_ads"], .pane-ad { display:none !important; }',
    });
    await el.scrollIntoViewIfNeeded();
    return await el.screenshot({ type: 'png' });
  } finally {
    await browser.close();
  }
}

async function toKindle(png) {
  const rotated = await sharp(png).rotate(ROTATE, { background: '#ffffff' }).toBuffer();
  return sharp(rotated)
    .resize(SCREEN_W, SCREEN_H, { fit: 'contain', background: '#ffffff' })
    .flatten({ background: '#ffffff' })
    .grayscale()
    .normalise()
    .sharpen()
    .png({ colours: 16, palette: true }) // e-ink shows 16 gray levels
    .toBuffer();
}

async function render() {
  if (rendering) return;
  rendering = true;
  const started = Date.now();
  try {
    const out = await toKindle(await capture());
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
