// Per-tarball read latency from inside the Worker, per storage layer.
// usage: node bench.mjs <out.json> [chunk=100]
// Fills origin -> R2 (apac), R2 (weur), KV, Cache API for every fastify tarball, then reads each layer
// sequentially (full body consumed) and reports p50/p95/p99 overall and per size class.
import { readFileSync, writeFileSync } from 'node:fs';
import { call, pct } from './lib.mjs';

const out = process.argv[2];
const CHUNK = Number(process.argv[3] ?? 100);
const e = `b${Date.now().toString(36)}`;
const lock = JSON.parse(readFileSync(new URL('../image/projects/fastify/package-lock.json', import.meta.url), 'utf8'));
const all = [
  ...new Set(
    Object.values(lock.packages)
      .filter((p) => p.resolved && !(p.os && !p.os.includes('linux')))
      .map((p) => new URL(p.resolved).pathname),
  ),
];
const paths = all.filter((_, i) => i % Number(process.env.STEP ?? 2) === 0);
const chunks = (xs, n) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pass(op, layer, list) {
  const rows = [];
  const colos = {};
  for (const c of chunks(list, CHUNK)) {
    const r = await call('/bench', { op, layer, paths: c, e });
    process.stdout.write('.');
    colos[r.colo] = (colos[r.colo] ?? 0) + c.length;
    rows.push(...r.rows);
  }
  return { rows, colos };
}

function summarize(rows, colos) {
  const cls = {
    all: () => true,
    'lt10KiB': (r) => r.bytes < 10240,
    '10-100KiB': (r) => r.bytes >= 10240 && r.bytes < 102400,
    'gt100KiB': (r) => r.bytes >= 102400,
  };
  const s = { colos, misses: rows.filter((r) => r.note === 'miss').length };
  for (const [name, f] of Object.entries(cls)) {
    const ms = rows.filter((r) => r.note !== 'miss' && f(r)).map((r) => r.ms);
    s[name] = ms.length ? { n: ms.length, p50: +pct(ms, 0.5).toFixed(1), p95: +pct(ms, 0.95).toFixed(1), p99: +pct(ms, 0.99).toFixed(1) } : null;
  }
  return s;
}

const result = { epoch: e, objects: paths.length, layers: {} };
const fill = await pass('fill', undefined, paths);
const sizes = fill.rows.map((r) => r.bytes).sort((a, b) => a - b);
result.sizes = { count: sizes.length, medianKiB: +(pct(sizes, 0.5) / 1024).toFixed(1), p95KiB: +(pct(sizes, 0.95) / 1024).toFixed(1), maxMiB: +(sizes.at(-1) / 1048576).toFixed(2), totalMiB: +(sizes.reduce((a, b) => a + b, 0) / 1048576).toFixed(1) };
result.cacheHitAfterPut = fill.rows.filter((r) => r.note?.includes('cache-hit-after-put')).length;
result.fillOrigin = summarize(fill.rows.map((r) => ({ ...r })), fill.colos);

// Sizes are needed for classes in the read passes; reads return bytes themselves.
for (const [name, layer] of [['cache', 'cache'], ['r2-apac', 'r2'], ['r2-weur', 'r2eu'], ['kv-justWritten', 'kv'], ['kv-hot', 'kv'], ['kv-hot-defaultTtl', 'kvdef'], ['origin-npmjs', 'origin']]) {
  const r = await pass('read', layer, paths);
  result.layers[name] = summarize(r.rows, r.colos);
  console.log(name, JSON.stringify(result.layers[name].all), 'misses', result.layers[name].misses);
}
console.log('waiting 90 s for KV cacheTtl (60 s) to lapse');
await sleep(90_000);
const cold = await pass('read', 'kv', paths);
result.layers['kv-afterTtlLapse'] = summarize(cold.rows, cold.colos);
console.log('kv-afterTtlLapse', JSON.stringify(result.layers['kv-afterTtlLapse'].all));
const again = await pass('read', 'kv', paths);
result.layers['kv-hotAgain'] = summarize(again.rows, again.colos);
writeFileSync(out, JSON.stringify(result, null, 1));
console.log('done', out);
