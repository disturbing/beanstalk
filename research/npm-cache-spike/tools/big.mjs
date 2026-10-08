// Large-object latency (native binaries) per layer, and the KV 25 MiB limit.
// usage: node big.mjs <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { call, median } from './lib.mjs';

const lock = JSON.parse(readFileSync(new URL('../image/projects/heavy/package-lock.json', import.meta.url), 'utf8'));
const want = ['@swc/core-linux-x64-gnu', '@biomejs/cli-linux-x64', 'prisma', 'next', '@next/swc-linux-x64-gnu'];
const paths = want.map((n) => new URL(lock.packages[`node_modules/${n}`].resolved).pathname);
const e = `big${Date.now().toString(36)}`;
const result = { fill: [], reads: {} };
for (const p of paths) {
  const r = await call('/bench', { op: 'fill', paths: [p], e });
  result.fill.push({ path: p, bytes: r.rows[0].bytes, note: r.rows[0].note, colo: r.colo });
  console.log(JSON.stringify(result.fill.at(-1)));
}
for (const layer of ['cache', 'r2', 'r2eu', 'kv', 'origin']) {
  result.reads[layer] = [];
  for (const p of paths) {
    const ms = [];
    let note;
    for (let i = 0; i < 5; i++) {
      const r = await call('/bench', { op: 'read', layer, paths: [p], e });
      if (r.rows[0].note) note = r.rows[0].note;
      else ms.push(r.rows[0].ms);
    }
    result.reads[layer].push({ path: p.split('/-/')[1], medianMs: ms.length ? Math.round(median(ms)) : null, minMs: ms.length ? Math.round(Math.min(...ms)) : null, maxMs: ms.length ? Math.round(Math.max(...ms)) : null, note });
  }
  console.log(layer, JSON.stringify(result.reads[layer]));
}
writeFileSync(process.argv[2], JSON.stringify(result, null, 1));
