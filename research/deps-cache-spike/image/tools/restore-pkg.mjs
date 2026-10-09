// Per-package restore done in one process (no tar/zstd spawn per package), the way a production
// restorer would: fetch N objects at a time, zstd-decompress in memory, parse the tar, write.
// usage: node restore-pkg.mjs <name> <layer r2|api|wc> <epoch> <dest> [par=64]
import { mkdir, writeFile, symlink, link, chmod } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

const [name, layer, epoch, dest, parArg] = process.argv.slice(2);
const par = Number(parArg ?? 64);
const BASE = 'http://deps.internal';
const url = (key) => (layer === 'r2' ? `${BASE}/r2/${key}` : `${BASE}/${layer}/${epoch}/${key}`);

const mem = () => Object.fromEntries(readFileSync('/proc/meminfo', 'utf8').trim().split('\n').map((l) => { const [k, v] = l.split(':'); return [k, Number.parseInt(v) * 1024]; }));
const m0 = mem();
let minAvail = m0.MemAvailable;
let maxShmem = m0.Shmem;
const timer = setInterval(() => { const m = mem(); minAvail = Math.min(minAvail, m.MemAvailable); maxShmem = Math.max(maxShmem, m.Shmem); }, 50);

const lat = [];
const errors = [];
async function get(key) {
  for (let attempt = 0; ; attempt++) {
    const t = performance.now();
    try {
      const res = await fetch(url(key), { signal: AbortSignal.timeout(Number(process.env.REQ_TIMEOUT_MS ?? 60000)) });
      if (!res.ok) throw new Error(`${key} ${res.status}`);
      const out = { buf: Buffer.from(await res.arrayBuffer()), layer: res.headers.get('x-layer') ?? '?' };
      lat.push(performance.now() - t);
      return out;
    } catch (err) {
      errors.push(`${Math.round(performance.now() - t)}ms ${String(err.cause?.code ?? err.name ?? err).slice(0, 40)}`);
      if (attempt >= 5) throw err;
      await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
    }
  }
}

const made = new Set();
async function mkdirp(d) {
  if (made.has(d)) return;
  await mkdir(d, { recursive: true });
  made.add(d);
}

/** Minimal tar reader: regular files, directories, symlinks, hard links, GNU long names, pax path. */
async function untar(buf, root) {
  let off = 0;
  let longName = null;
  let longLink = null;
  let files = 0;
  const str = (b) => b.toString('utf8').replace(/\0.*$/s, '');
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((x) => x === 0)) break;
    const size = Number.parseInt(str(h.subarray(124, 136)).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    const mode = Number.parseInt(str(h.subarray(100, 108)).trim() || '644', 8);
    const prefix = str(h.subarray(345, 500));
    let name = longName ?? (prefix ? `${prefix}/${str(h.subarray(0, 100))}` : str(h.subarray(0, 100)));
    const linkName = longLink ?? str(h.subarray(157, 257));
    const body = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = str(body); continue; }
    if (type === 'K') { longLink = str(body); continue; }
    if (type === 'x') {
      for (const rec of body.toString('utf8').split('\n')) {
        const m = /^\d+ path=(.*)$/.exec(rec);
        if (m) longName = m[1];
        const l = /^\d+ linkpath=(.*)$/.exec(rec);
        if (l) longLink = l[1];
      }
      continue;
    }
    if (type === 'g') continue;
    longName = null;
    longLink = null;
    name = name.replace(/^\.\//, '');
    if (name === '' || name === '.') continue;
    const p = join(root, name);
    if (type === '5') { await mkdirp(p); continue; }
    await mkdirp(dirname(p));
    if (type === '2') await symlink(linkName, p);
    else if (type === '1') await link(join(root, linkName), p);
    else { await writeFile(p, body, { mode: mode & 0o777 }); files++; }
  }
  return files;
}

const t0 = performance.now();
const manifest = JSON.parse((await get(`snap/${name}/manifest.json`)).buf);
const layers = {};
let fetched = 0;
let files = 0;
const lay = await get(`snap/${name}/layout.tar.zst`);
await mkdirp(dest);
const nl = await untar(zstdDecompressSync(lay.buf), dest);
files += nl;
const queue = [...manifest];
await Promise.all(Array.from({ length: par }, async () => {
  for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
    const { buf, layer: got } = await get(item.key);
    fetched += buf.length;
    layers[got] = (layers[got] ?? 0) + 1;
    if (process.env.DL_ONLY) continue;
    const root = join(dest, item.path);
    await mkdirp(root);
    const n = await untar(zstdDecompressSync(buf), root);
    files += n;
  }
}));
// Recreate .bin links etc. that live in the layout but point into packages (already extracted).
const ms = Math.round(performance.now() - t0);
clearInterval(timer);
const du = Number(execSync(`du -sb ${dest}`).toString().split('\t')[0]);
console.log(JSON.stringify({ name, scheme: process.env.DL_ONLY ? 'pkg-dl-only' : 'pkg-node', layer, epoch, dest, par, ms, fetched_bytes: fetched, mib_s: +(fetched / 1048576 / (ms / 1000)).toFixed(1), layers, files_written: files, objects: manifest.length, du_bytes: du, mem_avail_drop_bytes: m0.MemAvailable - minAvail, lat_ms: (() => { const x = [...lat].sort((a, b) => a - b); const q = (p) => Math.round(x[Math.min(x.length - 1, Math.floor(x.length * p))]); return { p50: q(0.5), p99: q(0.99), max: q(1) }; })(), errors: errors.length, error_samples: errors.slice(0, 5), shmem_growth_bytes: maxShmem - m0.Shmem }));
