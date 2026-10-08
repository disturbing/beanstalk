/**
 * beanstalk-npm-spike (throwaway): an npm registry caching proxy for job containers.
 *
 * A container's npm points at `http://<cfg>.npm.internal/`, a virtual host served by the catch-all
 * outbound handler of ProxyBox (no internet in that box). The handler forwards to NpmProxy, which
 * serves metadata (short TTL, tarball URLs rewritten) and immutable tarballs through the layers
 * named in <cfg> = `<cache>-<store>-<cacheEpoch>-<storeEpoch>-<run>`:
 *
 *   cache: none | api (Cache API) | wc (Workers Cache, via the WcTarballs entrypoint)
 *   store: none | r2 | kv (values over 25 MiB are not stored) | kvr2 (KV, R2 above the KV limit)
 *   epochs partition the cache and store key spaces so a "cold" or "cleared" layer is a new epoch.
 *
 * Control routes (bearer SPIKE_TOKEN): /run, /bench, /stats, /whoami.
 */
import { Container, ContainerProxy, getContainer } from '@cloudflare/containers';

export { ContainerProxy };
import type { OutboundHandlerContext } from '@cloudflare/containers';
import { DurableObject, WorkerEntrypoint, exports } from 'cloudflare:workers';

const REGISTRY = 'https://registry.npmjs.org';
const KV_LIMIT = 25 * 1024 * 1024;
const TARBALL = /^\/(?:@[\w.~-]+\/)?[\w.~-]+\/-\/[\w.~-]+\.tgz$/;
const PACKUMENT = /^\/(?:@[\w.~-]+(?:\/|%2f))?[\w.~-]+$/i;
const IMMUTABLE = 'public, max-age=31536000, immutable';

type Cfg = { cache: 'none' | 'api' | 'wc'; store: 'none' | 'r2' | 'kv' | 'kvr2'; ce: string; se: string; run: string };
type Layer = 'cache' | 'wc' | 'kv' | 'r2' | 'origin';

function parseCfg(label: string): Cfg | null {
  const [cache, store, ce, se, run] = label.split('-');
  if (!['none', 'api', 'wc'].includes(cache ?? '') || !['none', 'r2', 'kv', 'kvr2'].includes(store ?? '')) return null;
  if (!ce || !se || !run) return null;
  return { cache, store, ce, se, run } as Cfg;
}

function log(msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ msg, ...extra }));
}

// ---- containers ----------------------------------------------------------------------------------

export class ProxyBox extends Container<Env> {
  override defaultPort = 8080;
  override sleepAfter = '3m';
  override enableInternet = false;
}
export class DirectBox extends Container<Env> {
  override defaultPort = 8080;
  override sleepAfter = '3m';
  override enableInternet = true;
}

// Every request from a ProxyBox container lands here (the box has no other way out).
ProxyBox.outbound = async (request: Request, _env: Env, _ctx: OutboundHandlerContext): Promise<Response> => {
  const url = new URL(request.url);
  const label = url.hostname.split('.')[0] ?? '';
  if (!url.hostname.endsWith('.npm.internal') || parseCfg(label) === null)
    return new Response('only the npm proxy hosts exist here\n', { status: 502 });
  const headers = new Headers(request.headers);
  headers.delete('authorization');
  headers.set('x-client-origin', `${url.protocol}//${url.host}`);
  const target = new URL(`https://spike.internal/p/${label}${url.pathname}${url.search}`);
  return exports.NpmProxy.fetch(new Request(target, { method: request.method, headers }));
};

// ---- per-run stats -------------------------------------------------------------------------------

export class Stats extends DurableObject<Env> {
  add(layer: string, bytes: number, ms: number): void {
    const key = `l:${layer}`;
    const cur = this.ctx.storage.kv.get<{ n: number; bytes: number; ms: number[] }>(key) ?? { n: 0, bytes: 0, ms: [] };
    cur.n += 1;
    cur.bytes += bytes;
    if (cur.ms.length < 2000) cur.ms.push(Math.round(ms * 10) / 10);
    this.ctx.storage.kv.put(key, cur);
  }
  read(): Record<string, { n: number; bytes: number; ms: number[] }> {
    const out: Record<string, { n: number; bytes: number; ms: number[] }> = {};
    for (const [k, v] of this.ctx.storage.kv.list<{ n: number; bytes: number; ms: number[] }>({ prefix: 'l:' }))
      out[k.slice(2)] = v;
    return out;
  }
}

// ---- tarball layers ------------------------------------------------------------------------------

type Found = { body: ReadableStream | ArrayBuffer; size: number; layer: Layer };

async function readStore(env: Env, cfg: Cfg, path: string): Promise<Found | null> {
  const key = `${cfg.se}${path}`;
  if (cfg.store === 'kv' || cfg.store === 'kvr2') {
    const buf = await env.KV.get(key, { type: 'arrayBuffer', cacheTtl: 3600 });
    if (buf !== null) return { body: buf, size: buf.byteLength, layer: 'kv' };
  }
  if (cfg.store === 'r2' || cfg.store === 'kvr2') {
    const obj = await env.R2.get(key);
    if (obj !== null) return { body: obj.body, size: obj.size, layer: 'r2' };
  }
  return null;
}

async function writeStore(env: Env, cfg: Cfg, path: string, buf: ArrayBuffer): Promise<void> {
  const key = `${cfg.se}${path}`;
  const fitsKv = buf.byteLength <= KV_LIMIT;
  if ((cfg.store === 'kv' || cfg.store === 'kvr2') && fitsKv) await env.KV.put(key, buf);
  else if (cfg.store === 'r2' || cfg.store === 'kvr2') await env.R2.put(key, buf);
}

function tarballResponse(body: BodyInit, size: number, layer: Layer): Response {
  return new Response(body, {
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(size),
      'cache-control': IMMUTABLE,
      'x-npm-layer': layer,
    },
  });
}

/** One tarball through the store and origin layers (the cache layer is applied by the callers). */
async function fromStoreOrOrigin(env: Env, cfg: Cfg, path: string): Promise<{ res: Response; buf?: ArrayBuffer; layer: Layer }> {
  const found = await readStore(env, cfg, path);
  if (found !== null) {
    if (found.body instanceof ArrayBuffer) return { res: tarballResponse(found.body, found.size, found.layer), buf: found.body, layer: found.layer };
    return { res: tarballResponse(found.body, found.size, found.layer), layer: found.layer };
  }
  const upstream = await fetch(`${REGISTRY}${path}`, { headers: { accept: '*/*' } });
  if (!upstream.ok) return { res: new Response(upstream.body, { status: upstream.status }), layer: 'origin' };
  const buf = await upstream.arrayBuffer();
  await writeStore(env, cfg, path, buf);
  return { res: tarballResponse(buf, buf.byteLength, 'origin'), buf, layer: 'origin' };
}

const cacheKeyFor = (cfg: Cfg, path: string) => new Request(`https://npm-cache.spike/${cfg.ce}${path}`);

async function tarball(env: Env, ctx: ExecutionContext, cfg: Cfg, path: string): Promise<Response> {
  const t0 = performance.now();
  const stats = env.STATS.get(env.STATS.idFromName(cfg.run));
  const done = (res: Response, layer: Layer, size: number): Response => {
    ctx.waitUntil(Promise.resolve(stats.add(layer, size, performance.now() - t0)));
    return res;
  };
  if (cfg.cache === 'wc') {
    const wcUrl = new URL(`https://spike.internal/wc/${cfg.ce}/${cfg.store}/${cfg.se}${path}`);
    const res = await exports.WcTarballs.fetch(new Request(wcUrl));
    const layer = res.headers.get('cf-cache-status') === 'HIT' ? 'wc' : ((res.headers.get('x-npm-layer') as Layer | null) ?? 'origin');
    return done(res, layer, Number(res.headers.get('content-length') ?? 0));
  }
  if (cfg.cache === 'api') {
    const hit = await caches.default.match(cacheKeyFor(cfg, path));
    if (hit !== undefined) return done(new Response(hit.body, { headers: { 'x-npm-layer': 'cache', 'content-length': hit.headers.get('content-length') ?? '' } }), 'cache', Number(hit.headers.get('content-length') ?? 0));
  }
  const { res, buf, layer } = await fromStoreOrOrigin(env, cfg, path);
  if (!res.ok) return res;
  if (cfg.cache === 'api') {
    const data = buf ?? (await res.arrayBuffer());
    await caches.default.put(cacheKeyFor(cfg, path), tarballResponse(data, data.byteLength, layer));
    return done(tarballResponse(data, data.byteLength, layer), layer, data.byteLength);
  }
  return done(res, layer, Number(res.headers.get('content-length') ?? 0));
}

/** Workers Cache arm: the inner entrypoint whose responses Cloudflare caches (tiered, no Worker run on a hit). */
export class WcTarballs extends WorkerEntrypoint<Env> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const [, , ce, store, se, ...rest] = url.pathname.split('/');
    const cfg: Cfg = { cache: 'none', store: store as Cfg['store'], ce: ce ?? '', se: se ?? '', run: 'wc' };
    const { res } = await fromStoreOrOrigin(this.env, cfg, `/${rest.join('/')}`);
    return res;
  }
}

// ---- metadata ------------------------------------------------------------------------------------

async function packument(env: Env, ctx: ExecutionContext, cfg: Cfg, request: Request, path: string): Promise<Response> {
  const accept = request.headers.get('accept') ?? '';
  const corgi = accept.includes('application/vnd.npm.install-v1+json');
  const clientOrigin = request.headers.get('x-client-origin') ?? '';
  const key = new Request(`https://npm-cache.spike/${cfg.ce}/meta/${corgi ? 'corgi' : 'full'}${path}`);
  if (cfg.cache === 'api') {
    const hit = await caches.default.match(key);
    if (hit !== undefined) return hit;
  }
  const upstream = await fetch(`${REGISTRY}${path}`, {
    headers: { accept: corgi ? 'application/vnd.npm.install-v1+json' : 'application/json' },
  });
  if (!upstream.ok) return new Response(upstream.body, { status: upstream.status });
  const text = (await upstream.text()).replaceAll(`${REGISTRY}/`, `${clientOrigin}/`);
  const res = new Response(text, {
    headers: { 'content-type': corgi ? 'application/vnd.npm.install-v1+json' : 'application/json', 'cache-control': 'public, max-age=60' },
  });
  if (cfg.cache === 'api') ctx.waitUntil(caches.default.put(key, res.clone()));
  return res;
}

// ---- the proxy entrypoint ------------------------------------------------------------------------

export class NpmProxy extends WorkerEntrypoint<Env> {
  override async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('read-only registry\n', { status: 405 });
    const url = new URL(request.url);
    const match = /^\/p\/([^/]+)(\/.*)$/.exec(url.pathname);
    const cfg = match === null ? null : parseCfg(match[1] ?? '');
    if (match === null || cfg === null) return new Response('bad proxy path\n', { status: 400 });
    const path = match[2] ?? '/';
    if (TARBALL.test(path)) return tarball(this.env, this.ctx, cfg, path);
    if (PACKUMENT.test(path)) return packument(this.env, this.ctx, cfg, request, path);
    return new Response('not an npm package path\n', { status: 404 });
  }
}

// ---- control + benchmark -------------------------------------------------------------------------

type BenchBody = { op: string; layer?: string; paths: string[]; e: string };

async function bench(env: Env, body: BenchBody, colo: string | undefined): Promise<Response> {
  const { op, layer, paths, e } = body;
  const key = (p: string) => `bench/${e}${p}`;
  const ck = (p: string) => new Request(`https://npm-cache.spike/${key(p)}`);
  const rows: { path: string; ms: number; bytes: number; note?: string }[] = [];
  if (op === 'fill') {
    const one = async (p: string) => {
      const t0 = performance.now();
      const up = await fetch(`${REGISTRY}${p}`);
      const buf = await up.arrayBuffer();
      const tOrigin = performance.now() - t0;
      const errs: string[] = [];
      const kvPut = env.KV.put(key(p), buf).then(
        () => (buf.byteLength > KV_LIMIT ? errs.push('kv-accepted-over-limit') : 0),
        (err) => errs.push(`kv-rejected:${String(err).slice(0, 100)}`),
      );
      await Promise.all([
        env.R2.put(key(p), buf),
        env.R2_WEUR.put(key(p), buf),
        kvPut,
        caches.default.put(ck(p), tarballResponse(buf, buf.byteLength, 'origin')),
      ]);
      const back = await caches.default.match(ck(p));
      errs.push(back === undefined ? 'cache-miss-after-put' : 'cache-hit-after-put');
      rows.push({ path: p, ms: tOrigin, bytes: buf.byteLength, note: errs.join(',') });
    };
    const queue = [...paths];
    await Promise.all(Array.from({ length: 6 }, async () => { for (let p = queue.shift(); p !== undefined; p = queue.shift()) await one(p); }));
    return Response.json({ op, layer, colo, rows });
  }
  for (const p of paths) {
    const t0 = performance.now();
    let bytes = 0;
    let note: string | undefined;
    if (layer === 'origin') bytes = (await (await fetch(`${REGISTRY}${p}`)).arrayBuffer()).byteLength;
    else if (layer === 'cache') {
      const hit = await caches.default.match(ck(p));
      bytes = hit === undefined ? 0 : (await hit.arrayBuffer()).byteLength;
      if (hit === undefined) note = 'miss';
    } else if (layer === 'kv') {
      const v = await env.KV.get(key(p), { type: 'arrayBuffer', cacheTtl: 3600 });
      bytes = v?.byteLength ?? 0;
      if (v === null) note = 'miss';
    } else if (layer === 'kvdef') {
      const v = await env.KV.get(key(p), { type: 'arrayBuffer' });
      bytes = v?.byteLength ?? 0;
      if (v === null) note = 'miss';
    } else if (layer === 'r2' || layer === 'r2eu') {
      const o = await (layer === 'r2' ? env.R2 : env.R2_WEUR).get(key(p));
      bytes = o === null ? 0 : (await o.arrayBuffer()).byteLength;
      if (o === null) note = 'miss';
    }
    rows.push({ path: p, ms: performance.now() - t0, bytes, note });
  }
  return Response.json({ op, layer, colo, rows });
}

function authorized(request: Request, env: Env): boolean {
  const given = new TextEncoder().encode(request.headers.get('authorization') ?? '');
  const want = new TextEncoder().encode(`Bearer ${env.SPIKE_TOKEN}`);
  return given.byteLength === want.byteLength && crypto.subtle.timingSafeEqual(given, want);
}

async function runJob(request: Request, env: Env, ctx: ExecutionContext, colo: string | undefined): Promise<Response> {
  const { box, instance, project, cfg, mode, root, args } = (await request.json()) as { box: "proxy" | "direct"; instance: string; project: string; cfg?: string; mode?: string; root?: string; args?: string[] };
  const ns = box === 'proxy' ? env.PROXY_BOX : env.DIRECT_BOX;
  const stub = getContainer(ns, instance);
  const t0 = Date.now();
  await stub.fetch(new Request('http://container/health'));
  const startMs = Date.now() - t0;
  const registry = box === 'proxy' ? `http://${cfg}.npm.internal/` : undefined;
  const res = await stub.fetch(new Request('http://container/run', { method: 'POST', body: JSON.stringify({ project, registry, mode, root, args }) }));
  const raw = await res.text();
  if (!res.ok) throw new Error(`container ${res.status}: ${raw.slice(0, 400)}`);
  const result = JSON.parse(raw) as Record<string, unknown>;
  const runId = cfg?.split('-')[4];
  const stats = box === 'proxy' && runId ? await env.STATS.get(env.STATS.idFromName(runId)).read() : null;
  ctx.waitUntil(stub.destroy());
  log('run', { box, instance, project, cfg, ms: result.ms, colo });
  return Response.json({ ...result, startMs, colo, stats });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (!authorized(request, env)) return new Response('unauthorized\n', { status: 401 });
    const url = new URL(request.url);
    const cf = request.cf as { colo?: string } | undefined;
    if (url.pathname === '/purge' && request.method === 'POST') {
      // Teardown helper: empty both buckets (bounded per call; the caller repeats until `left` is 0).
      let deleted = 0;
      for (const bucket of [env.R2, env.R2_WEUR]) {
        const page = await bucket.list({ limit: 500 });
        if (page.objects.length > 0) await bucket.delete(page.objects.map((o) => o.key));
        deleted += page.objects.length;
      }
      return Response.json({ deleted, left: deleted > 0 });
    }
    if (url.pathname === '/whoami') return Response.json({ colo: cf?.colo });
    if (url.pathname === '/cachetest') {
      // Does the Cache API work on this hostname? put, then match, in this and a later request.
      const k = new Request(`https://npm-cache.spike/cachetest/${url.searchParams.get('k') ?? 'x'}`);
      const before = (await caches.default.match(k)) !== undefined;
      let putError: string | null = null;
      try {
        await caches.default.put(k, new Response('hello', { headers: { 'cache-control': IMMUTABLE } }));
      } catch (err) {
        putError = String(err);
      }
      const after = (await caches.default.match(k)) !== undefined;
      const hostKey = new Request(`${url.origin}/cachetest-host/${url.searchParams.get('k') ?? 'x'}`);
      await caches.default.put(hostKey, new Response('hello', { headers: { 'cache-control': IMMUTABLE } }));
      const afterHost = (await caches.default.match(hostKey)) !== undefined;
      return Response.json({ colo: cf?.colo, before, putError, after, afterHost });
    }
    if (url.pathname === '/bench' && request.method === 'POST') return bench(env, await request.json(), cf?.colo);
    if (url.pathname === '/stats') return Response.json(await env.STATS.get(env.STATS.idFromName(url.searchParams.get('run') ?? '')).read());
    if (url.pathname.startsWith('/p/')) {
      // Direct access to the proxy over HTTPS (for curl probes on workers.dev).
      const headers = new Headers(request.headers);
      headers.set('x-client-origin', url.origin);
      return exports.NpmProxy.fetch(new Request(request.url, { method: request.method, headers }));
    }
    if (url.pathname === '/run') {
      try {
        return await runJob(request, env, ctx, cf?.colo);
      } catch (err) {
        return Response.json({ error: String(err), stack: (err as Error).stack?.slice(0, 600) }, { status: 500 });
      }
    }
    return new Response('not found\n', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
