/**
 * beanstalk-deps-spike (throwaway): restore node_modules into a job container's memory.
 *
 * The container reaches `http://deps.internal/...` through an outbound handler (same machine as
 * the container), which hands the request to the DepsStore entrypoint:
 *
 *   GET|HEAD /r2/<key>              R2 (Range supported)
 *   PUT      /r2/<key>              R2 single put (body length from content-length)
 *   POST     /mpu/create/<key>      R2 multipart: {uploadId}
 *   PUT      /mpu/part/<key>?u=&n=  one part: {partNumber, etag}
 *   POST     /mpu/complete/<key>?u= body [{partNumber, etag}]
 *   GET      /api/<epoch>/<key>     Cache API (this colo) in front of R2; epoch makes it cold
 *   GET      /wc/<epoch>/<key>      Workers Cache (WcStore entrypoint, tiered) in front of R2
 *
 * Control (bearer SPIKE_TOKEN): /c/<instance>/job, /c/<instance>/job/<id>, /c/<instance>/write,
 * /destroy/<instance>, /list?prefix=, /purge.
 */
import { Container, ContainerProxy, getContainer } from '@cloudflare/containers';
import { WorkerEntrypoint, exports } from 'cloudflare:workers';

export { ContainerProxy };

const IMMUTABLE = 'public, max-age=31536000, immutable';
const CACHE_MAX = 512 * 1000 * 1000;

export class DepsBox extends Container<Env> {
  override defaultPort = 8080;
  override sleepAfter = '30m';
  override enableInternet = true;
  static {
    this.outboundByHost = {
      'deps.internal': async (request: Request) => {
        const url = new URL(request.url);
        const init: RequestInit = { method: request.method, headers: request.headers };
        if (request.method === 'PUT' || request.method === 'POST') init.body = request.body;
        return exports.DepsStore.fetch(new Request(`https://deps.internal${url.pathname}${url.search}`, init));
      },
    };
  }
}

function objectResponse(obj: R2ObjectBody | R2Object, body: ReadableStream | null, layer: string, status = 200): Response {
  const headers = new Headers({
    'content-type': 'application/octet-stream',
    'cache-control': IMMUTABLE,
    'x-layer': layer,
    etag: obj.httpEtag,
  });
  if (body === null || status === 200) headers.set('content-length', String(obj.size));
  return new Response(body, { status, headers });
}

/** A fixed-length copy of a stream, so the Cache API and the client both see a content-length. */
function fixed(stream: ReadableStream, size: number): ReadableStream {
  const out = new FixedLengthStream(size);
  void stream.pipeTo(out.writable);
  return out.readable;
}

async function r2Get(env: Env, key: string, request: Request, layer: string): Promise<Response> {
  if (request.method === 'HEAD') {
    const head = await env.R2.head(key);
    return head === null ? new Response(null, { status: 404 }) : objectResponse(head, null, layer);
  }
  const range = request.headers.get('range');
  const obj = await env.R2.get(key, range === null ? {} : { range: request.headers });
  if (obj === null) return new Response('missing\n', { status: 404 });
  if (range !== null && obj.range !== undefined && 'offset' in obj.range) {
    const r = obj.range as { offset: number; length: number };
    const res = objectResponse(obj, obj.body, layer, 206);
    res.headers.set('content-range', `bytes ${r.offset}-${r.offset + r.length - 1}/${obj.size}`);
    res.headers.set('content-length', String(r.length));
    return res;
  }
  return objectResponse(obj, obj.body, layer);
}

export class DepsStore extends WorkerEntrypoint<Env> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname);
    const env = this.env;
    let m = /^\/r2\/(.+)$/.exec(path);
    if (m !== null) {
      const key = m[1]!;
      if (request.method === 'PUT') {
        const obj = await env.R2.put(key, request.body, { httpMetadata: { contentType: 'application/octet-stream' } });
        return Response.json({ key, size: obj?.size ?? null });
      }
      if (request.method === 'DELETE') {
        await env.R2.delete(key);
        return Response.json({ deleted: key });
      }
      return r2Get(env, key, request, 'r2');
    }
    m = /^\/mpu\/(create|part|complete)\/(.+)$/.exec(path);
    if (m !== null) {
      const [, op, key] = m as unknown as [string, string, string];
      if (op === 'create') {
        const up = await env.R2.createMultipartUpload(key);
        return Response.json({ uploadId: up.uploadId });
      }
      const up = env.R2.resumeMultipartUpload(key, url.searchParams.get('u') ?? '');
      if (op === 'part') {
        const part = await up.uploadPart(Number(url.searchParams.get('n')), request.body!);
        return Response.json(part);
      }
      const parts = (await request.json()) as R2UploadedPart[];
      const obj = await up.complete(parts);
      return Response.json({ key, size: obj.size });
    }
    m = /^\/api\/([^/]+)\/(.+)$/.exec(path);
    if (m !== null) {
      const [, epoch, key] = m as unknown as [string, string, string];
      const cacheKey = new Request(`https://deps-cache.spike/${epoch}/${key}`);
      const hit = await caches.default.match(cacheKey);
      if (hit !== undefined) {
        const res = new Response(hit.body, hit);
        res.headers.set('x-layer', 'cache');
        return res;
      }
      const obj = await env.R2.get(key);
      if (obj === null) return new Response('missing\n', { status: 404 });
      if (obj.size > CACHE_MAX) return objectResponse(obj, obj.body, 'r2-too-big-for-cache');
      const [a, b] = obj.body.tee();
      this.ctx.waitUntil(caches.default.put(cacheKey, objectResponse(obj, fixed(b, obj.size), 'cache')));
      return objectResponse(obj, fixed(a, obj.size), 'r2');
    }
    m = /^\/wc\/([^/]+)\/(.+)$/.exec(path);
    if (m !== null) {
      const res = await exports.WcStore.fetch(new Request(`https://wc.internal/${m[1]}/${m[2]}`));
      const out = new Response(res.body, res);
      out.headers.set('x-layer', res.headers.get('cf-cache-status') === 'HIT' ? 'wc' : 'r2');
      return out;
    }
    return new Response('not a deps path\n', { status: 404 });
  }
}

/** Workers Cache arm: a hit is served by the cache without running this code (tiered). */
export class WcStore extends WorkerEntrypoint<Env> {
  override async fetch(request: Request): Promise<Response> {
    const [, , ...rest] = new URL(request.url).pathname.split('/');
    const key = decodeURIComponent(rest.join('/'));
    const obj = await this.env.R2.get(key);
    if (obj === null) return new Response('missing\n', { status: 404 });
    return objectResponse(obj, obj.body, 'r2');
  }
}

function authorized(request: Request, env: Env): boolean {
  const given = new TextEncoder().encode(request.headers.get('authorization') ?? '');
  const want = new TextEncoder().encode(`Bearer ${env.SPIKE_TOKEN}`);
  return given.byteLength === want.byteLength && crypto.subtle.timingSafeEqual(given, want);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!authorized(request, env)) return new Response('unauthorized\n', { status: 401 });
    const url = new URL(request.url);
    const colo = (request.cf as { colo?: string } | undefined)?.colo;
    let m = /^\/c\/([\w-]+)(\/.*)$/.exec(url.pathname);
    if (m !== null) {
      const stub = getContainer(env.BOX, m[1]!);
      const res = await stub.fetch(new Request(`http://container${m[2]}`, { method: request.method, body: request.body, headers: { 'content-type': 'application/json' } }));
      const out = new Response(res.body, res);
      if (colo !== undefined) out.headers.set('x-colo', colo);
      return out;
    }
    m = /^\/destroy\/([\w-]+)$/.exec(url.pathname);
    if (m !== null) {
      await getContainer(env.BOX, m[1]!).destroy();
      return Response.json({ destroyed: m[1] });
    }
    if (url.pathname === '/list') {
      const page = await env.R2.list({ prefix: url.searchParams.get('prefix') ?? '', limit: 1000 });
      return Response.json({ n: page.objects.length, truncated: page.truncated, bytes: page.objects.reduce((s, o) => s + o.size, 0), keys: page.objects.slice(0, 50).map((o) => [o.key, o.size]) });
    }
    if (url.pathname === '/purge' && request.method === 'POST') {
      const page = await env.R2.list({ limit: 1000 });
      if (page.objects.length > 0) await env.R2.delete(page.objects.map((o) => o.key));
      const uploads = await env.R2.list({ limit: 1 });
      return Response.json({ deleted: page.objects.length, left: uploads.objects.length > 0 });
    }
    if (url.pathname === '/whoami') return Response.json({ colo });
    return new Response('not found\n', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
