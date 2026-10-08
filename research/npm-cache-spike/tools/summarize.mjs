// Markdown table of the matrix: median / min-max per arm, plus bytes per layer.
import { readFileSync } from 'node:fs';
import { median } from './lib.mjs';

const rows = readFileSync(process.argv[2], 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const arms = new Map();
for (const r of rows) (arms.get(r.arm) ?? arms.set(r.arm, []).get(r.arm)).push(r);
console.log('| arm | runs | median s | min-max s | layers (requests, MiB, first run) |\n|---|---|---|---|---|');
for (const [arm, rs] of arms) {
  const ok = rs.filter((r) => r.code === 0);
  const ms = ok.map((r) => r.ms / 1000);
  const l = ok[0]?.layers;
  const layers = l ? Object.entries(l).map(([k, v]) => `${k} ${v.n} / ${(v.bytes / 1048576).toFixed(1)}`).join(', ') : 'n/a (direct)';
  console.log(`| ${arm} | ${ok.length}/${rs.length} | ${ms.length ? median(ms).toFixed(1) : '-'} | ${ms.length ? `${Math.min(...ms).toFixed(1)}-${Math.max(...ms).toFixed(1)}` : '-'} | ${layers} |`);
}
