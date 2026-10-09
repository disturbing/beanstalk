/**
 * `http://deps.internal`: the dependency cache as the job's steps see it (doc 27 §4.3-§4.6).
 * The container's outbound handler resolves the bearer to the job's grant through the job's
 * own Durable Object, then this app serves it:
 *
 *   POST /v1/lookup                  exact key, else the family's latest (restore-keys order)
 *   GET  /v1/chunks/<sha256>         Workers Cache, then the Cache API, in front of R2
 *   POST /v1/missing                 which of these chunks R2 lacks, in one request
 *   PUT  /v1/chunks/<sha256>         one chunk (≤ 90 MiB), hash checked while it streams
 *   POST /v1/uploads/<sha256>        R2 multipart for bigger chunks: start,
 *   PUT  /v1/uploads/<sha256>/<n>    a part (≤ 90 MiB),
 *   POST /v1/uploads/<sha256>/complete  finish, then the stored object's hash is checked
 *   POST /v1/commit                  the manifest, last: the snapshot exists from here on
 *
 * Reads are scoped to the grant's repository; writes also need a saving grant (default-branch
 * pushes only).
 */
import { exports } from 'cloudflare:workers';
import { Hono } from 'hono';
import type { Context } from 'hono';

import type { DepsGrant } from './grant';
import { chunkKey, manifestKey } from './index-do';
import type { DepsCacheIndex } from './index-do';
import {
  CompleteUploadSchema,
  LookupRequestSchema,
  ManifestSchema,
  MissingRequestSchema,
  Sha256,
} from './wire';
import type { LookupResponse, Manifest } from './wire';

/** The virtual host the job's steps reach the cache at. */
export const DEPS_HOST = 'deps.internal';
/** The Worker's request body limit is 100 MB; the tool sends parts of 64 MiB. */
const MAX_BODY_BYTES = 90 * 1024 * 1024;
const IMMUTABLE = 'public, max-age=31536000, immutable';
/** The Cache API fallback's key space (never fetched over the network). */
const CACHE_API_ORIGIN = 'https://deps-cache.beanstalk.internal';
/** The Workers Cache entrypoint's key space. */
const WORKERS_CACHE_ORIGIN = 'https://deps-chunks.beanstalk.internal';

type DepsApp = { Bindings: { readonly env: Env; readonly grant: DepsGrant } };
type DepsContext = Context<DepsApp>;

/** Serves one request of a job whose grant is already resolved. */
export function serveDeps(request: Request, env: Env, grant: DepsGrant): Promise<Response> {
  return Promise.resolve(app.fetch(request, { env, grant }));
}

const app = new Hono<DepsApp>()
  .post('/v1/lookup', async (c) => lookup(c))
  .get('/v1/chunks/:sha', async (c) => readChunk(c))
  .post('/v1/missing', async (c) => missing(c))
  .put('/v1/chunks/:sha', async (c) => putChunk(c))
  .post('/v1/uploads/:sha', async (c) => startUpload(c))
  .put('/v1/uploads/:sha/:part', async (c) => putPart(c))
  .post('/v1/uploads/:sha/complete', async (c) => completeUpload(c))
  .post('/v1/commit', async (c) => commit(c))
  .notFound((c) => c.json({ error: 'not a deps path' }, 404));

async function lookup(c: DepsContext): Promise<Response> {
  const parsed = LookupRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad lookup' }, 400);
  const { env, grant } = c.env;
  const found = await index(env, grant).lookup({
    repoId: grant.repoId,
    scopes: grant.readScopes,
    familyKey: parsed.data.familyKey,
    snapshotKey: parsed.data.snapshotKey,
  });
  const manifest =
    found.hit === null
      ? null
      : await readManifest(env, manifestKey(grant.repoId, found.hit.scope, found.hit.snapshotKey));
  const answer: LookupResponse = {
    match: manifest === null || found.hit === null ? 'none' : found.hit.match,
    manifest,
    chunkCount: found.chunkCount,
    canSave: grant.saveScope !== null,
    snapshotMaxBytes: grant.snapshotMaxBytes,
    tmpfsMaxBytes: grant.tmpfsMaxBytes,
  };
  return c.json(answer);
}

async function readChunk(c: DepsContext): Promise<Response> {
  const sha = Sha256.safeParse(c.req.param('sha'));
  if (!sha.success) return c.json({ error: 'bad chunk name' }, 400);
  const { env, grant } = c.env;
  const fromWorkersCache = await exports.DepsChunkCache.fetch(
    new Request(`${WORKERS_CACHE_ORIGIN}/${grant.repoId}/${sha.data}`),
  ).catch(() => null);
  if (fromWorkersCache?.ok === true) return withLayer(fromWorkersCache, 'workers-cache');
  return fromCacheApi(env, chunkKey(grant.repoId, sha.data));
}

async function missing(c: DepsContext): Promise<Response> {
  const parsed = MissingRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad chunk list' }, 400);
  const { env, grant } = c.env;
  const unique = [...new Set(parsed.data.chunks)];
  const heads = await Promise.all(
    unique.map(async (sha) =>
      (await env.DEPS_CACHE.head(chunkKey(grant.repoId, sha))) === null ? sha : null,
    ),
  );
  return c.json({ missing: heads.filter((sha): sha is string => sha !== null) });
}

async function putChunk(c: DepsContext): Promise<Response> {
  const target = writable(c);
  if (target instanceof Response) return target;
  const length = Number(c.req.header('content-length'));
  const body = c.req.raw.body;
  if (!Number.isInteger(length) || length < 1 || length > MAX_BODY_BYTES || body === null)
    return c.json(
      { error: 'a chunk upload needs a body of 1 B to 90 MiB with content-length' },
      400,
    );
  const { env } = c.env;
  if ((await env.DEPS_CACHE.head(target.key)) !== null) return c.json({ stored: 'already' });
  await env.DEPS_CACHE.put(target.key, body, { httpMetadata: { contentType: 'application/zstd' } });
  return verifyStored(c, target);
}

async function startUpload(c: DepsContext): Promise<Response> {
  const target = writable(c);
  if (target instanceof Response) return target;
  const upload = await c.env.env.DEPS_CACHE.createMultipartUpload(target.key, {
    httpMetadata: { contentType: 'application/zstd' },
  });
  return c.json({ uploadId: upload.uploadId });
}

async function putPart(c: DepsContext): Promise<Response> {
  const target = writable(c);
  if (target instanceof Response) return target;
  const part = Number(c.req.param('part'));
  const uploadId = c.req.query('uploadId') ?? '';
  const length = Number(c.req.header('content-length'));
  const body = c.req.raw.body;
  if (!Number.isInteger(part) || part < 1 || part > 10_000 || uploadId === '' || body === null)
    return c.json({ error: 'bad part' }, 400);
  if (!Number.isInteger(length) || length < 1 || length > MAX_BODY_BYTES)
    return c.json({ error: 'a part is 1 B to 90 MiB with content-length' }, 400);
  const upload = c.env.env.DEPS_CACHE.resumeMultipartUpload(target.key, uploadId);
  const uploaded = await upload.uploadPart(part, body);
  return c.json({ partNumber: uploaded.partNumber, etag: uploaded.etag });
}

async function completeUpload(c: DepsContext): Promise<Response> {
  const target = writable(c);
  if (target instanceof Response) return target;
  const parsed = CompleteUploadSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad completion' }, 400);
  const { env } = c.env;
  const upload = env.DEPS_CACHE.resumeMultipartUpload(target.key, parsed.data.uploadId);
  await upload.complete(parsed.data.parts);
  return verifyStored(c, target);
}

/**
 * Reads a stored chunk back and checks it hashes to its name (content addressing is what lets
 * a save skip unchanged chunks, so a wrong object under a name must never stay); a mismatch is
 * deleted.
 */
async function verifyStored(
  c: DepsContext,
  target: { readonly sha: string; readonly key: string },
): Promise<Response> {
  const { env } = c.env;
  const stored = await env.DEPS_CACHE.get(target.key);
  if (stored === null) return c.json({ error: 'the chunk is not there' }, 500);
  const digest = new crypto.DigestStream('SHA-256');
  await stored.body.pipeTo(digest);
  if (hex(await digest.digest) !== target.sha) {
    await env.DEPS_CACHE.delete(target.key);
    return c.json({ error: 'the body does not hash to its name' }, 400);
  }
  return c.json({ stored: 'new' });
}

async function commit(c: DepsContext): Promise<Response> {
  const { env, grant } = c.env;
  if (grant.saveScope === null) return c.json({ error: 'this run may not save' }, 403);
  const parsed = ManifestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad manifest' }, 400);
  const outcome = await index(env, grant).commit({
    repoId: grant.repoId,
    scope: grant.saveScope,
    sourceRef: grant.sourceRef,
    manifest: parsed.data,
    snapshotMaxBytes: grant.snapshotMaxBytes,
  });
  return c.json(outcome);
}

/** The chunk a write names, if this run may save. */
function writable(c: DepsContext): { readonly sha: string; readonly key: string } | Response {
  if (c.env.grant.saveScope === null) return c.json({ error: 'this run may not save' }, 403);
  const sha = Sha256.safeParse(c.req.param('sha'));
  if (!sha.success) return c.json({ error: 'bad chunk name' }, 400);
  return { sha: sha.data, key: chunkKey(c.env.grant.repoId, sha.data) };
}

function index(env: Env, grant: DepsGrant): DurableObjectStub<DepsCacheIndex> {
  return env.DEPS_INDEX.getByName(grant.repoId);
}

async function readManifest(env: Env, key: string): Promise<Manifest | null> {
  const stored = await env.DEPS_CACHE.get(key);
  if (stored === null) return null;
  const parsed = ManifestSchema.safeParse(await stored.json());
  return parsed.success ? parsed.data : null;
}

/**
 * The Cache API in front of R2 (this colo only): a miss is stored from R2 first and then read
 * back, so a chunk of up to 256 MB is never held in the isolate's memory.
 */
async function fromCacheApi(env: Env, key: string): Promise<Response> {
  const cacheKey = new Request(`${CACHE_API_ORIGIN}/${key}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit !== undefined) return withLayer(hit, 'cache-api');
  const stored = await env.DEPS_CACHE.get(key);
  if (stored === null) return new Response('no such chunk\n', { status: 404 });
  await cache.put(cacheKey, chunkResponse(stored));
  const filled = await cache.match(cacheKey);
  if (filled !== undefined) return withLayer(filled, 'r2');
  const again = await env.DEPS_CACHE.get(key);
  return again === null
    ? new Response('no such chunk\n', { status: 404 })
    : withLayer(chunkResponse(again), 'r2');
}

/** A chunk as an immutable, cacheable response. */
export function chunkResponse(object: R2ObjectBody): Response {
  return new Response(object.body, {
    headers: {
      'content-type': 'application/zstd',
      'content-length': String(object.size),
      'cache-control': IMMUTABLE,
      etag: object.httpEtag,
    },
  });
}

function withLayer(response: Response, layer: string): Response {
  const out = new Response(response.body, response);
  out.headers.set('x-deps-layer', layer);
  return out;
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
