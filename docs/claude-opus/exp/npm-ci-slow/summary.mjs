// node summary.mjs <label> <wall ms> <cache dir>: one JSON line for an npm ci run, from npm's
// timing.json (phases) and debug log (every HTTP fetch with its time).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const [label, wallMs, cache] = process.argv.slice(2);
const logs = path.join(cache, '_logs');
const files = readdirSync(logs).sort();
const timingFile = files.filter((f) => f.endsWith('-timing.json')).at(-1);
const debugFile = files.filter((f) => f.endsWith('-debug-0.log')).at(-1);
const timers = timingFile ? JSON.parse(readFileSync(path.join(logs, timingFile), 'utf8')).timers : {};
const pick = [
  'idealTree', 'npm-ci:rm', 'reify:createSparse', 'reify:unpack', 'reify:build',
  'auditReport:getReport', 'auditReport:init', 'reify:audit', 'reify', 'command:ci', 'npm',
];
const phases = Object.fromEntries(pick.filter((k) => k in timers).map((k) => [k, timers[k]]));

const fetches = { tarball: [], packument: [], post: [], other: [] };
for (const line of debugFile ? readFileSync(path.join(logs, debugFile), 'utf8').split('\n') : []) {
  const m = line.match(/http fetch (GET|POST) (\d+) (\S+) (\d+)ms/);
  if (!m) continue;
  const [, method, , url, ms] = m;
  const kind = method === 'POST' ? 'post' : url.endsWith('.tgz') ? 'tarball' : url.includes('registry.npmjs.org/') ? 'packument' : 'other';
  fetches[kind].push(Number(ms));
}
const stats = (xs) => {
  if (xs.length === 0) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, sum: s.reduce((a, b) => a + b, 0), p50: q(0.5), p90: q(0.9), max: s.at(-1) };
};
console.log(
  'DIAG ' +
    JSON.stringify({
      label,
      wallMs: Number(wallMs),
      phases,
      tarball: stats(fetches.tarball),
      packument: stats(fetches.packument),
      post: stats(fetches.post),
    }),
);
