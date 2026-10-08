// One `npm ci` in a fresh container. usage: node run.mjs <direct|proxy> <project> [cfg]
// cfg = <cache>-<store>-<cacheEpoch>-<storeEpoch>-<run>, e.g. api-r2-c1-s1-r7
import { call } from './lib.mjs';

const [box, project, cfg] = process.argv.slice(2);
const instance = `${box}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const out = await call('/run', { box, instance, project, cfg, mode: process.env.MODE, root: process.env.ROOT, args: process.env.NPM_ARGS ? process.env.NPM_ARGS.split(' ') : undefined });
const layers = out.stats
  ? Object.fromEntries(Object.entries(out.stats).map(([k, v]) => [k, { n: v.n, mib: +(v.bytes / 1048576).toFixed(1) }]))
  : null;
console.log(JSON.stringify({ box, project, cfg, ms: out.ms, cpuBusyPct: out.cpuBusyPct, offline: out.offline, tarExtractMs: out.tarExtractMs, tarMiB: out.tarMiB, cpus: out.cpus, code: out.code, fetches: out.httpFetches, modules: out.topLevelModules, startMs: out.startMs, colo: out.colo, layers, tail: out.code === 0 ? undefined : out.tail }));
