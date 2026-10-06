// Watches the web app while a streaming race runs (stream_e2e): opens the repository home and
// a bean's journey, records when each streamed snapshot shows up in the DOM (the journey's
// data-stream-seq, the stalk's data-summary-seq), and takes screenshots mid-stream.
//
//   node observe.mjs <web origin> <race out dir> <bean> <shots dir>   (needs playwright-core)
//
// Writes <shots dir>/ui.jsonl: one line per DOM change, {at, page, kind, task, seq}.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { chromium } from 'playwright-core';

const [origin, out, bean, shots] = process.argv.slice(2);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LIMIT_MS = 15 * 60 * 1000;
mkdirSync(shots, { recursive: true });
const log = join(shots, 'ui.jsonl');

const run = await waitForRun();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const pages = {
  journey: await open(`${origin}/runs/${run}?bean=${bean}`, 'journey'),
  home: await open(`${origin}/runs/${run}`, 'home'),
};
let shot = 0;
const started = Date.now();
while (Date.now() - started < LIMIT_MS && !existsSync(join(out, 'summary.json'))) {
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const streaming = await pages.journey.$('[data-stream-seq]');
  if (streaming !== null && shot < 40) {
    shot += 1;
    await pages.journey.screenshot({ path: join(shots, `journey-${String(shot).padStart(2, '0')}.png`) });
    await pages.home.screenshot({ path: join(shots, `home-${String(shot).padStart(2, '0')}.png`) });
  }
}
await pages.journey.screenshot({ path: join(shots, 'journey-final.png') });
await browser.close();

async function open(url, name) {
  const page = await context.newPage();
  await page.exposeFunction('reportStream', (entry) =>
    appendFileSync(log, `${JSON.stringify({ ...entry, page: name })}\n`),
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

async function waitForRun() {
  const config = join(out, 'config.json');
  for (;;) {
    if (existsSync(config)) {
      const id = JSON.parse(readFileSync(config, 'utf8')).run;
      if (id) return id;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
