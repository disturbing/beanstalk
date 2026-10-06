// Watches the staging web app while a real streaming race runs on Cloudflare.
//   node observe-cf.mjs <web origin> <race out dir> <shots dir>   (needs playwright-core; see race.sh)
// - sse.jsonl: every `stream` SSE event as it arrives at this machine (raw fetch of /api/runs/:run/live)
// - ui.jsonl: DOM changes of data-stream-seq (journey, night page) and data-summary-seq (home)
// - screenshots of the journey of a bean that is streaming now, night (dark) and day (light)
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { chromium } from 'playwright-core';

const [origin, out, shots] = process.argv.slice(2);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LIMIT_MS = 75 * 60 * 1000;
const MAX_SHOTS = 24;
mkdirSync(shots, { recursive: true });
const uiLog = join(shots, 'ui.jsonl');
const sseLog = join(shots, 'sse.jsonl');

const run = await waitForRun();
appendFileSync(join(shots, 'observer.log'), `run ${run} at ${new Date().toISOString()}\n`);
const sseDone = watchSse(run);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const host = new URL(origin).hostname;
const night = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const day = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await night.addCookies([{ name: 'bs_theme', value: 'dark', domain: host, path: '/' }]);
await day.addCookies([{ name: 'bs_theme', value: 'light', domain: host, path: '/' }]);
const home = await open(night, `${origin}/runs/${run}`, 'home');
let journey = null;
let dayJourney = null;
let bean = null;
let shot = 0;
let lastShot = 0;
const started = Date.now();
while (Date.now() - started < LIMIT_MS && !existsSync(join(out, 'summary.json'))) {
  await sleep(2000);
  try {
    const live = await home.$$eval('[data-summary-seq]', (nodes) =>
      nodes
        .map((n) => n.closest('a')?.getAttribute('href')?.match(/bean=(t\d+)/)?.[1])
        .filter(Boolean),
    );
    const streamingHere = journey !== null && (await journey.$('[data-stream-seq]')) !== null;
    if (!streamingHere && live.length > 0 && live[0] !== bean) {
      bean = live[0];
      if (journey !== null) await journey.close();
      if (dayJourney !== null) await dayJourney.close();
      journey = await open(night, `${origin}/runs/${run}?bean=${bean}`, `journey:${bean}`);
      dayJourney = await day.newPage();
      await dayJourney.goto(`${origin}/runs/${run}?bean=${bean}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      appendFileSync(join(shots, 'observer.log'), `follow ${bean} at ${new Date().toISOString()}\n`);
    }
    if (streamingHere && shot < MAX_SHOTS && Date.now() - lastShot > 45_000) {
      await sleep(800);
      shot += 1;
      lastShot = Date.now();
      const n = String(shot).padStart(2, '0');
      await journey.screenshot({ path: join(shots, `journey-night-${n}-${bean}.png`) });
      await dayJourney.screenshot({ path: join(shots, `journey-day-${n}-${bean}.png`) });
      await home.screenshot({ path: join(shots, `home-night-${n}.png`) });
    }
  } catch (error) {
    appendFileSync(join(shots, 'observer.log'), `error ${String(error)}\n`);
  }
}
if (journey !== null) await journey.screenshot({ path: join(shots, 'journey-night-final.png') });
await home.screenshot({ path: join(shots, 'home-night-final.png') });
await browser.close();
sseDone.abort();
process.exit(0);

async function open(context, url, name) {
  const page = await context.newPage();
  await page.exposeFunction('reportStream', (entry) =>
    appendFileSync(uiLog, `${JSON.stringify({ ...entry, page: name })}\n`),
  );
  await page.addInitScript(() => {
    const seen = new Map();
    const scan = () => {
      const now = Date.now();
      const current = new Map();
      for (const node of document.querySelectorAll('[data-stream-seq]'))
        current.set('journey', node.getAttribute('data-stream-seq'));
      for (const node of document.querySelectorAll('[data-summary-seq]')) {
        const task = node.closest('a')?.getAttribute('href')?.match(/bean=(t\d+)/)?.[1] ?? '?';
        current.set(`stalk:${task}`, node.getAttribute('data-summary-seq'));
      }
      for (const [key, seq] of current)
        if (seen.get(key) !== seq) window.reportStream({ at: now, kind: key, seq: Number(seq) });
      for (const key of seen.keys())
        if (!current.has(key)) window.reportStream({ at: now, kind: key, seq: null });
      seen.clear();
      for (const [key, seq] of current) seen.set(key, seq);
    };
    new MutationObserver(scan).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-stream-seq', 'data-summary-seq'],
    });
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  return page;
}

/** Reads the SSE feed raw and logs each `stream` event's arrival; reconnects with Last-Event-ID. */
function watchSse(id) {
  const controller = new AbortController();
  (async () => {
    let lastId = 0;
    while (!controller.signal.aborted && !existsSync(join(out, 'summary.json'))) {
      try {
        const res = await fetch(`${origin}/api/runs/${id}/live?after=${lastId}`, {
          signal: controller.signal,
          headers: { accept: 'text/event-stream' },
        });
        appendFileSync(sseLog, `${JSON.stringify({ at: Date.now(), connect: res.status, headers: Object.fromEntries(res.headers) })}\n`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const at = Date.now();
          buffer += decoder.decode(value, { stream: true });
          let cut;
          while ((cut = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 2);
            let event = 'message';
            let data = '';
            for (const line of block.split('\n')) {
              if (line.startsWith('event:')) event = line.slice(6).trim();
              else if (line.startsWith('data:')) data += line.slice(5).trim();
              else if (line.startsWith('id:')) lastId = Number(line.slice(3).trim()) || lastId;
            }
            if (event === 'stream') {
              const s = JSON.parse(data);
              appendFileSync(sseLog, `${JSON.stringify({ at, type: s.type, task: s.task, inv: s.inv, seq: s.seq ?? null, t: s.t, chunk: value.length })}\n`);
            } else if (data) {
              appendFileSync(sseLog, `${JSON.stringify({ at, event, bytes: data.length, chunk: value.length })}\n`);
            }
          }
        }
        appendFileSync(sseLog, `${JSON.stringify({ at: Date.now(), closed: true })}\n`);
      } catch (error) {
        if (controller.signal.aborted) return;
        appendFileSync(sseLog, `${JSON.stringify({ at: Date.now(), error: String(error) })}\n`);
        await sleep(1000);
      }
    }
  })();
  return controller;
}

async function waitForRun() {
  const config = join(out, 'config.json');
  for (;;) {
    if (existsSync(config)) {
      const id = JSON.parse(readFileSync(config, 'utf8')).run;
      if (id) return id;
    }
    await sleep(500);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
