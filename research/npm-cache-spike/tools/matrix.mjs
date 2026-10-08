// The end-to-end `npm ci` matrix, strictly sequential (one fresh container per run).
// usage: node matrix.mjs <out.jsonl> [only-arm-prefix]
import { appendFileSync } from 'node:fs';
import { call } from './lib.mjs';

const out = process.argv[2];
const only = process.argv[3];
const tag = Date.now().toString(36).slice(-4);
let n = 0;

async function once(arm, project, box, cfg) {
  const instance = `${box}-${tag}-${++n}`;
  const t0 = Date.now();
  let row;
  try {
    const r = await call('/run', { box, instance, project, cfg });
    row = {
      arm, project, cfg, ms: r.ms, code: r.code, fetches: r.httpFetches, startMs: r.startMs, colo: r.colo,
      layers: r.stats ? Object.fromEntries(Object.entries(r.stats).map(([k, v]) => [k, { n: v.n, bytes: v.bytes, p50: [...v.ms].sort((a, b) => a - b)[Math.floor(v.ms.length / 2)] }])) : null,
      tail: r.code === 0 ? undefined : r.tail,
    };
  } catch (err) {
    row = { arm, project, cfg, error: String(err).slice(0, 300) };
  }
  row.wall = Date.now() - t0;
  appendFileSync(out, `${JSON.stringify(row)}\n`);
  console.log(JSON.stringify({ arm, ms: row.ms, code: row.code, colo: row.colo, layers: row.layers && Object.fromEntries(Object.entries(row.layers).map(([k, v]) => [k, v.n])), error: row.error }));
}

const run = (id) => `r${tag}${id}${++n}`; // fresh stats id per run
const cfg = (cache, store, ce, se) => `${cache}-${store}-${ce}-${se}-${run('x')}`;

async function arm(name, project, reps, make, box = 'proxy') {
  if (only && !name.startsWith(only)) return;
  for (let i = 1; i <= reps; i++) await once(name, project, box, make(i));
}

const P = 'fastify';
await arm('direct', P, 3, () => undefined, 'direct');
await arm('proxy-passthrough', P, 3, () => cfg('none', 'none', 'x', 'x'));
// R2 only: cold = a fresh store epoch per rep; warm = rep-1's epoch.
await arm('r2-cold', P, 3, (i) => cfg('none', 'r2', 'x', `r2c${tag}${i}`));
await arm('r2-warm', P, 3, () => cfg('none', 'r2', 'x', `r2c${tag}1`));
// R2 + Cache API: first run fills the cache from warm R2 (cache cleared), the next three hit the cache.
await arm('api-r2-cacheCleared', P, 1, () => cfg('api', 'r2', `a${tag}`, `r2c${tag}1`));
await arm('api-r2-warm', P, 3, () => cfg('api', 'r2', `a${tag}`, `r2c${tag}1`));
// KV only.
await arm('kv-cold', P, 3, (i) => cfg('none', 'kv', 'x', `kvc${tag}${i}`));
await arm('kv-warm', P, 3, () => cfg('none', 'kv', 'x', `kvc${tag}1`));
await arm('api-kv-cacheCleared', P, 1, () => cfg('api', 'kv', `b${tag}`, `kvc${tag}1`));
await arm('api-kv-warm', P, 3, () => cfg('api', 'kv', `b${tag}`, `kvc${tag}1`));
// Workers Cache (tiered) in front of R2.
await arm('wc-r2-cacheCleared', P, 1, () => cfg('wc', 'r2', `w${tag}`, `r2c${tag}1`));
await arm('wc-r2-warm', P, 3, () => cfg('wc', 'r2', `w${tag}`, `r2c${tag}1`));
// A heavier tree (native binaries): KV with R2 above its limit.
const H = 'heavy';
await arm('heavy-direct', H, 3, () => undefined, 'direct');
await arm('heavy-kvr2-cold', H, 1, () => cfg('none', 'kvr2', 'x', `hv${tag}`));
await arm('heavy-kvr2-warm', H, 3, () => cfg('none', 'kvr2', 'x', `hv${tag}`));
await arm('heavy-r2-cold', H, 1, () => cfg('none', 'r2', 'x', `hr${tag}`));
await arm('heavy-r2-warm', H, 3, () => cfg('none', 'r2', 'x', `hr${tag}`));
await arm('heavy-api-r2-warm', H, 4, () => cfg('api', 'r2', `h${tag}`, `hr${tag}`));
