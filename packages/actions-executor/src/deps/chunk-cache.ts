/**
 * DepsChunkCache: the Workers Cache arm in front of R2 (doc 27 §4.6). Cache is enabled for
 * this entrypoint only (wrangler.jsonc `exports`), so a hit is served by the tiered cache
 * without running this code; a miss reads R2 and the response, immutable and at most 256 MB,
 * is cached on the way out. Reached only from the `deps.internal` handler, which builds the URL
 * (`/<repository id>/<sha256>`) from the job's grant.
 */
import { WorkerEntrypoint } from 'cloudflare:workers';

import { chunkKey } from './index-do';
import { chunkResponse } from './service';

const NO_STORE = { 'cache-control': 'no-store' };

export class DepsChunkCache extends WorkerEntrypoint<Env> {
  override async fetch(request: Request): Promise<Response> {
    const [repoId, sha] = new URL(request.url).pathname.split('/').slice(1);
    if (repoId === undefined || sha === undefined || !/^[0-9a-f]{64}$/.test(sha))
      return new Response('bad chunk path\n', { status: 400, headers: NO_STORE });
    const stored = await this.env.DEPS_CACHE.get(chunkKey(decodeURIComponent(repoId), sha));
    if (stored === null) return new Response('no such chunk\n', { status: 404, headers: NO_STORE });
    return chunkResponse(stored);
  }
}
