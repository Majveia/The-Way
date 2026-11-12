#!/usr/bin/env node
// Screenshot harness for THE WAY. Starts a private Vite dev server, opens headless Chromium,
// loads the app in deterministic shot mode, waits for window.__THE_WAY_READY, captures PNGs.
//
//   node tools/shoot.mjs --query "scene=cosmos" --out shots/cosmos.png
//   node tools/shoot.mjs --batch tools/shots.json --outdir shots/        (one server, many shots)
//   options: --w 1280 --h 720 --dpr 1 --timeout 300 --frames 1 --interval 500 --warm 24
//
// Batch file: [{ "name": "cosmos", "query": "scene=cosmos&t=40" }, ...]
// Prints page console errors so you can debug shaders without a browser.
import { createServer } from 'vite';
import { createRequire } from 'module';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
function loadPlaywright() {
  const candidates = ['playwright', '/opt/node-tools/node_modules/playwright'];
  try { candidates.push(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } catch (_) {}
  for (const c of candidates) { try { return require(c); } catch (_) {} }
  throw new Error('playwright not found');
}

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const W = +opt('w', 1280), H = +opt('h', 720), DPR = +opt('dpr', 1);
const TIMEOUT = +opt('timeout', 300) * 1000;
const FRAMES = +opt('frames', 1), INTERVAL = +opt('interval', 500);
const WARM = opt('warm', null);

let shots = [];
if (opt('batch')) {
  shots = JSON.parse(fs.readFileSync(opt('batch'), 'utf8'));
  const outdir = opt('outdir', 'shots');
  fs.mkdirSync(outdir, { recursive: true });
  shots = shots.map((s) => ({ ...s, out: path.join(outdir, (s.name || 'shot') + '.png') }));
} else {
  const q = opt('query', 'scene=cosmos');
  shots = [{ name: 'shot', query: q, out: opt('out', 'shots/shot.png') }];
  fs.mkdirSync(path.dirname(shots[0].out), { recursive: true });
}

const server = await createServer({ root, configFile: path.join(root, 'vite.config.js'), logLevel: 'error', server: { port: 0, host: '127.0.0.1', strictPort: false, hmr: false } });
await server.listen();
const port = server.httpServer.address().port;
const { chromium } = loadPlaywright();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
let failures = 0;
try {
  for (const s of shots) {
    const ctxb = await browser.newContext({ viewport: { width: s.w || W, height: s.h || H }, deviceScaleFactor: s.dpr || DPR });
    const page = await ctxb.newPage();
    const logs = [];
    page.on('console', (m) => { const t = m.type(); if (t === 'error' || t === 'warning') logs.push(`[${t}] ${m.text()}`); });
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
    let q = s.query;
    if (!/(^|&)shot=/.test(q)) q += '&shot=1';
    if (WARM && !/(^|&)warm=/.test(q)) q += '&warm=' + WARM;
    q += `&w=${s.w || W}&h=${s.h || H}`;
    const url = `http://127.0.0.1:${port}/?${q}`;
    const t0 = Date.now();
    process.stdout.write(`→ ${s.name}: ${url}\n`);
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 120000 });
      await page.waitForFunction(() => window.__THE_WAY_READY === true, null, { timeout: TIMEOUT, polling: 250 });
      for (let f = 0; f < FRAMES; f++) {
        const out = FRAMES > 1 ? s.out.replace(/\.png$/, `_${f}.png`) : s.out;
        await page.screenshot({ path: out });
        process.stdout.write(`  saved ${out} (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
        if (f < FRAMES - 1) await page.waitForTimeout(INTERVAL);
      }
    } catch (e) {
      failures++;
      process.stdout.write(`  FAILED: ${e.message.split('\n')[0]}\n`);
      try { await page.screenshot({ path: s.out.replace(/\.png$/, '_FAILED.png') }); } catch (_) {}
    }
    const uniq = [...new Set(logs)];
    if (uniq.length) process.stdout.write(uniq.slice(0, 25).map((l) => '  ' + l.slice(0, 1500)).join('\n') + '\n');
    await ctxb.close();
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failures ? 1 : 0);
