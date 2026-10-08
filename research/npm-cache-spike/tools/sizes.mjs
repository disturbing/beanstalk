// Tarball size distribution for the packages `npm ci` would fetch on linux/x64/glibc.
// usage: node sizes.mjs <package-lock.json>
import { readFileSync } from 'node:fs';

const lock = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const urls = [];
for (const [path, p] of Object.entries(lock.packages)) {
  if (path === '' || !p.resolved) continue;
  if (p.os && !p.os.includes('linux')) continue;
  if (p.cpu && !p.cpu.includes('x64')) continue;
  if (p.libc && !p.libc.includes('glibc')) continue;
  urls.push({ path, url: p.resolved });
}
const sizes = [];
let i = 0;
async function worker() {
  while (i < urls.length) {
    const u = urls[i++];
    const res = await fetch(u.url);
    const len = (await res.arrayBuffer()).byteLength;
    sizes.push({ ...u, bytes: len });
  }
}
await Promise.all(Array.from({ length: 24 }, worker));
sizes.sort((a, b) => a.bytes - b.bytes);
const q = (f) => sizes[Math.min(sizes.length - 1, Math.floor(sizes.length * f))].bytes;
const total = sizes.reduce((s, x) => s + x.bytes, 0);
const MiB = 1024 * 1024;
console.log(
  JSON.stringify({
    count: sizes.length,
    totalMiB: +(total / MiB).toFixed(1),
    medianKiB: +(q(0.5) / 1024).toFixed(1),
    p95KiB: +(q(0.95) / 1024).toFixed(1),
    maxMiB: +(q(1) / MiB).toFixed(2),
    over25MiB: sizes.filter((s) => s.bytes > 25 * MiB).length,
    over1MiB: sizes.filter((s) => s.bytes > MiB).length,
    top: sizes.slice(-6).map((s) => `${s.path.replace(/^node_modules\//, '')} ${(s.bytes / MiB).toFixed(1)}MiB`),
  }),
);
