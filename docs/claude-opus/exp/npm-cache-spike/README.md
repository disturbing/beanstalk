# Spike: an npm registry caching proxy for job containers

2026-10-08, branch off `prototype` at `e7b7154`. Question: can a Worker-side npm cache make `npm ci` in a Beanstalk job container fast (the actions spike measured 9-19 s)? Code, raw data and drivers: `research/npm-cache-spike/` (image, Worker, `tools/`, `results/`). Everything was throwaway and is torn down (section 9).

## 0. Answer

1. **A tarball cache does not make `npm ci` faster.** fastify's tree (706 requests, 29.4 MiB), fresh container each time, 3 runs per arm: npmjs direct 10.4 s median; every warm cache arm (R2, Cache API, KV, KV + Cache API, Workers Cache) 10.0-14.1 s, i.e. inside the direct spread (9.6-11.8 s). The registry is not the bottleneck: npmjs answers a tarball from a Worker in a median 23 ms, and `npm ci` keeps the container at about 40% of 4 vCPUs. A heavier app (150 MiB of native binaries) behaves the same: 12.7 s direct, 9-11 s warm.
2. **We still need a registry path**, because job containers have no internet. A pass-through proxy served through the outbound handler costs nothing measurable (9.7 s vs 10.4 s direct, 706 requests).
3. **If we add storage behind that path, use R2 with the Workers Cache (or Cache API) in front. KV does not win**: end to end KV warm was 14.1 s against R2 warm 10.6 s (noise, not a win), KV hot reads are 5-7 ms against R2's 129 ms per object but that gap is invisible to `npm ci`, KV costs 33x more to store, and it cannot hold the objects that matter most (values over 25 MiB are rejected with a 413).
4. The real lever is not downloading at all: restoring a prebuilt `node_modules` tarball took 1.3 s on tmpfs against 10 s for `npm ci` (section 5.3; the same restore took 30 s on the container's ext4 disk, unexplained). That is a lockfile-keyed cache of `node_modules`, not a registry cache.

## 1. Verified facts (current docs, fetched 2026-10-08)

| Question | Answer | Source |
|---|---|---|
| Is `caches.default` per data centre or global? | **Per data centre.** "The Cache API is available globally but the contents of the cache do not replicate outside of the originating data center." `cache.delete` purges only the local data centre. | https://developers.cloudflare.com/workers/runtime-apis/cache/ |
| Measured | `put` then `match` in colo SIN: hit; the same key from HKG: miss, then hit after being put there. Across 344 tarballs filled in one colo and read later, 120 reads (35%) missed because the request landed elsewhere. In the container matrix a whole run was either all Cache API hits or all R2 hits depending on the colo it landed in. | `results/bench.json`, `results/matrix.jsonl` |
| Does Tiered Cache apply to the Cache API? | **No.** "The `cache.put` method is not compatible with tiered caching." Tiered Cache is a zone setting. | same page; https://developers.cloudflare.com/workers/reference/how-the-cache-works/ ; https://developers.cloudflare.com/cache/how-to/tiered-cache/ |
| Durability / eviction | Not durable. "Cloudflare does not guarantee cache persistence. Content may be evicted based on factors like data center capacity and demand." Treat it as an ephemeral per-colo accelerator. R2 is the durable layer: eleven 9s durability, 99.9% availability SLA. | https://developers.cloudflare.com/cache/concepts/default-cache-behavior/ ; https://developers.cloudflare.com/r2/reference/durability/ |
| Max object size | Cache API object 512 MB on every plan (CDN cache: 512 MB Free/Pro/Business, 5 GB Enterprise). `cache.put` answers 413 for too-large responses. Measured: a 47.4 MB tarball was accepted and read back. | https://developers.cloudflare.com/workers/platform/limits/ |
| Works on `*.workers.dev`? | **Yes, measured.** The docs say "Workers deployed to custom domains have access to functional cache operations" and that editor and Playground previews are no-ops; on a deployed `workers.dev` Worker `put`/`match` worked and persisted across requests (per colo). No custom domain is needed for the Cache API. | same cache page; `/cachetest` in `worker/src/index.ts` |
| Cache API pricing | No per-operation charge is listed; each `match`/`put` counts against the subrequest quota (50 free / 10,000 paid per invocation, 1,000 Cache API calls on paid). You pay for the Worker request ($0.30/M beyond 10M/month) and CPU ($0.02/M ms). | https://developers.cloudflare.com/workers/platform/pricing/ ; limits page |
| `fetch()` with `cf: { cacheEverything, cacheTtl }` | Goes through the **zone** cache of the URL's zone ("fetch checks to see if the URL matches a different zone... otherwise, it reads through its own zone's cache, even if the URL is for a non-Cloudflare site"); tiered when the zone has Tiered Cache on. A `workers.dev` Worker has no zone of its own, and `registry.npmjs.org` is not ours, so this is not a lever we control. **Not tested here.** It also cannot store a response we rewrote (metadata) and cannot be read back by key. | https://developers.cloudflare.com/workers/reference/how-the-cache-works/ ; https://developers.cloudflare.com/workers/examples/cache-using-fetch/ |
| **Workers Cache** (new, "your Worker's cache") | Separate from both of the above. Enabled with `cache.enabled` in wrangler (per entrypoint through `exports`), keyed by path, entrypoint, `ctx.props` and, by default, the Worker version. **Tiered by default** (lower tier near the caller, upper tier shared), request collapsing, works on `workers.dev` and through service bindings and `ctx.exports`. A hit runs no Worker code. Size limit is the Free-plan limit whatever the plan. Billed at the normal request rate, CPU only on misses. Purge through `ctx.cache.purge()`. | https://developers.cloudflare.com/workers/cache/ ; https://developers.cloudflare.com/workers/cache/limitations/ ; https://developers.cloudflare.com/workers/cache/cache-keys/ |
| Measured | `workers.dev` hits work (`cf-cache-status: HIT`); a warm run was 706/706 hits in two of three runs, but one run in another colo got 34 hits and 672 misses, so the upper tier does not make a fill visible everywhere at once. | `results/matrix.jsonl` (`wc-r2-warm`) |
| What is "stored on the CDN"? | Cache API, Workers Cache and zone-cached `fetch` all keep bodies in Cloudflare's edge cache: evictable, not guaranteed, Cache API per colo, Workers Cache and zone cache tiered. None of them is durable storage. R2 and KV are durable; **KV values are cached at the edge on read** (below), R2 reads are not. | |
| R2 | $0.015/GB-month, Class A $4.50/M, Class B $0.36/M, egress free, 10 GB / 1M A / 10M B free per month. | https://developers.cloudflare.com/r2/pricing/ |
| KV limits | Value 25 MiB (measured: a 30.3 MB put fails `413 ... exceeds limit of 26214400`), key 512 B, writes to one key 1/s, unlimited reads/keys on paid, 1,000 operations per invocation. | https://developers.cloudflare.com/kv/platform/limits/ |
| KV pricing (paid) | Reads 10M/month then $0.50/M, writes 1M then $5/M, storage 1 GB then $0.50/GB-month, no egress charge; every read is billed even when edge-cached or null. | https://developers.cloudflare.com/kv/platform/pricing/ |
| KV consistency and latency | "Hot" = cached in the data centre or regional tier; a cold read goes regional tier, central tier, then central store. Default `cacheTtl` 60 s (min 30). Eventually consistent: changes can take 60 s or more elsewhere, and **missing keys are cached too**, so a "miss, fill, read back" in another colo can see the miss for a minute. Fine for immutable tarballs if the filler returns the body it just fetched. | https://developers.cloudflare.com/kv/concepts/how-kv-works/ |
| Containers egress | $0.025/GB North America and Europe (1 TB/month included), $0.05/GB Oceania, Korea, Taiwan (500 GB), $0.04/GB everywhere else (500 GB). The page says nothing about traffic to a Worker, an outbound handler or a service binding, and nothing about ingress. | https://developers.cloudflare.com/containers/pricing/ |
| Outbound handlers | Programmable egress proxies "that run on the same machine as the container"; `outbound` / `outboundByHost` intercept HTTP on port 80 and HTTPS on 443 (HTTPS needs `interceptHttps = true` and an ephemeral CA); with `enableInternet = false` nothing else leaves. | https://developers.cloudflare.com/containers/platform-details/outbound-traffic/ |

## 2. What was built

`beanstalk-npm-spike` (the legacy account, workers.dev), all resources named `beanstalk-npm-spike*`:

- **Containers**: `ProxyBox` (`enableInternet = false`; a catch-all `outbound` handler) and `DirectBox` (internet on, no handler), both `standard-4`, one image (`image/`: `node:24-bookworm-slim`, fastify's lockfile from `research/real-arena/fastify/deps`, a heavy app lockfile, a 90-line server that runs `npm ci --ignore-scripts` in a fresh directory with an empty npm cache and returns wall time). Each measurement used a **new container instance**.
- **Routing**: the container's `npm ci --registry http://<cfg>.npm.internal/`. npm rewrites the lockfile's `registry.npmjs.org` tarball URLs to the configured registry host (`replace-registry-host`), so metadata is hardly needed by `npm ci`; the handler forwards every request to `NpmProxy` (a `WorkerEntrypoint`) through `ctx.exports`. I used a configured registry host rather than intercepting `registry.npmjs.org` because it needs no CA and no HTTPS interception and matches how the swarm serves `bs.internal`. Intercepting the real hostname with `interceptHttps` would make the proxy invisible to lockfiles and `npx`; untested.
- **Layers** (selected by the host label `<cache>-<store>-<cacheEpoch>-<storeEpoch>-<run>`, epochs make a layer cold or "cleared" without deleting anything): cache = none | Cache API | Workers Cache (`WcTarballs` entrypoint, `cache.enabled` only there); store = none | R2 | KV (values over 25 MiB are passed through, not stored) | KV with R2 above the KV limit. Tarballs are immutable (`public, max-age=31536000, immutable`), keyed by registry path; metadata is Cache API only with `max-age=60`, keyed by `corgi` vs `full` (`Accept: application/vnd.npm.install-v1+json`), with `https://registry.npmjs.org/` rewritten to the proxy origin. Per-run counters (layer, bytes, in-Worker ms) live in a `Stats` Durable Object.
- **Benchmark routes**: `/bench` (fill and read one layer sequentially from inside the Worker), `/cachetest`, `/purge`; all behind a bearer secret.

Known simplifications: bodies are buffered (`arrayBuffer`) up to the isolate's 128 MB; fills are written inline (`await`), so a cold run pays the writes; integrity is not checked by the proxy.

## 3. End-to-end `npm ci` (fastify, 706 requests, 29.4 MiB, `--ignore-scripts`, Hong Kong, fresh container per run)

Seconds, 3 runs unless noted. Raw: `results/matrix.jsonl`, summary table by `tools/summarize.mjs`.

| Arm | Median | Min-max | Where the bytes came from (first run) |
|---|---|---|---|
| npmjs direct (baseline) | **10.4** | 9.6-11.8 | container to registry.npmjs.org |
| Proxy pass-through, nothing stored | 9.7 | 8.7-11.5 | npmjs 706 |
| R2 cold (fill in the request path) | 19.8 | 16.2-51.3 | npmjs 681, R2 25 |
| **R2 only, warm** | **10.6** | 10.3-11.7 | R2 706 |
| R2 + Cache API, cache cleared (1 run) | 10.3 | - | R2 681, cache 25 |
| **R2 + Cache API, warm** | **10.5** | 9.8-12.0 | cache 706 in 2 of 3 runs; run 1 only 29 (other colo) |
| KV only, cold | 33.8 | 33.6-36.3 | npmjs 680, KV 26 |
| **KV only, warm** | **14.1** | 11.3-14.2 | KV 706 |
| KV + Cache API, cache cleared (1 run) | 9.3 | - | KV 675, cache 31 |
| **KV + Cache API, warm** | **10.0** | 8.1-11.1 | cache 706 in 2 of 3 runs |
| Workers Cache + R2, cache cleared (1 run) | 11.5 | - | R2 672, wc 34 |
| Workers Cache + R2, warm | 11.0 | 9.3-11.9 | wc 706 in 2 of 3 runs; one run 34 + R2 672 (other colo) |

Heavy app (78 tarballs, 149.6 MiB, two over 25 MiB):

| Arm | Median | Min-max | Layers |
|---|---|---|---|
| npmjs direct | 12.7 | 9.5-13.9 | |
| R2 only, warm | 9.2 | 8.9-11.4 | R2 76 |
| **KV + R2 above 25 MiB, warm** | 10.4 | 9.2-11.7 | KV 74 (75 MiB), R2 2 (74 MiB) |
| R2 + Cache API, warm (4 runs) | 11.0 | 8.6-11.9 | cache 76 in 2 runs, R2 76 in the other 2 (alternating colo) |

Margin of KV over R2 + Cache API end to end: **none** (KV + Cache API 10.0 vs R2 + Cache API 10.5 on fastify; KV alone 14.1 vs R2 alone 10.6). The effects are smaller than the run-to-run spread of the baseline (9.6-11.8 s; two more direct runs later in the day took 12.3 and 16.4 s).

Cold-start cost: 1.7-3.7 s to start a container (not in the table). Cold arms are slow because the fill is awaited inside the request; KV writes are the slowest (34 s against 16-20 s for R2). In a real build fills go through `ctx.waitUntil` or a queue.

## 4. Per-tarball latency from inside the Worker

344 fastify tarballs (every second one of 711; median 6.3 KiB, p95 158 KiB, max 0.99 MiB), read sequentially, full body consumed, ms. `results/bench.json`. My client moved between colos (SIN, HKG, NRT, KIX) during the 90-minute run, so each row mixes colos; the Worker was always in Asia. `tools/bench.mjs`.

| Layer | p50 | p95 | p99 | Notes |
|---|---|---|---|---|
| Cache API hit | 9 | 15 | 31 | 224 hits, **120 of 344 misses** (read from a different colo than the fill) |
| Workers Cache hit (inside a container run) | 4-5 | - | - | `wc` layer p50 in the matrix stats |
| KV hot (`cacheTtl` 3600, second read) | 6 | 250 | 422 | the p95 is reads that landed in a colo where the key was not hot yet |
| KV hot (default `cacheTtl`, third read) | 7 | 16 | 28 | |
| KV hot again, same colo | 5 | 10 | 14 | |
| KV first read after write | 225 | 344 | 805 | a different request, often a different colo |
| KV after the 60 s TTL lapsed | 170 | 192 | 353 | regional/central tier |
| R2, bucket in APAC | 129 | 396 | 695 | no edge cache in front of R2 reads |
| R2, bucket in WEUR (cross-region) | 433 | 698 | 1,049 | |
| npmjs direct | 23 | 76 | 127 | registry.npmjs.org is itself fronted by Cloudflare |

By size class the picture is the same (under 10 KiB, 10-100 KiB, over 100 KiB are in `bench.json`; over 100 KiB: Cache API 15, R2 272, KV hot 9, npmjs direct 34 ms p50).

Large native binaries, median of 5 reads, ms (`results/big.json`):

| Object | Cache API | R2 APAC | R2 WEUR | KV | npmjs |
|---|---|---|---|---|---|
| @swc/core-linux-x64-gnu 14.3 MB | 64 | 256 | 392 | 35 | 70 |
| @biomejs/cli-linux-x64 15.4 MB | 54 | 282 | 367 | 60 | 75 |
| prisma 17.6 MB | 58 | 282 | 358 | 50 | 65 |
| next 30.3 MB | 124 | 468 | 548 | **413 on put** | 109 |
| @next/swc-linux-x64-gnu 47.4 MB | 167 | 1,337 | 738 | **413 on put** | 364 |

(KV had occasional 1-2 s outliers on the 14-17 MB values; hot medians are 35-60 ms.)

## 5. What the numbers say

### 5.1 Size distributions: what falls over KV's 25 MiB

| Tree | Tarballs for linux/x64 | Total | Median | p95 | Max | Over 1 MiB | Over 25 MiB |
|---|---|---|---|---|---|---|---|
| fastify (`research/real-arena/fastify/deps`) | 711 | 30.8 MiB | 6.2 KiB | 130.8 KiB | 6.42 MiB (@tsd/typescript) | 3 | **0** |
| heavy app (next 15.5, esbuild, @swc/core, sharp, typescript, biome, lightningcss, tailwind oxide, playwright-core, prisma; `tools/sizes.mjs`) | 78 | 149.6 MiB | 24.5 KiB | 14.7 MiB | 45.2 MiB (@next/swc-linux-x64-gnu) | 13 | **2** (next 28.9 MiB, @next/swc 45.2 MiB) |

Two of 78 objects, 49% of the bytes, exceed KV. Any Next.js app hits this, so KV needs an R2 fallback and cannot be the only store.

### 5.2 Why caching does not help `npm ci`

- Warm hits from the Worker cost 4-9 ms (cache) or 6 ms (hot KV), cold-ish 130-225 ms (R2, KV), yet the container's `npm ci` is the same 10 s. Across 706 requests with npm's 15 sockets even 130 ms per request is only about 6 s of connection time, and npm overlaps it with extraction.
- `--maxsockets=64` changed nothing (direct 10.5-13.6 s, cached 10.0-12.6 s).
- CPU: the container sat at 39-44% busy on 4 vCPUs (`/proc/stat`) for direct and cache-warm runs; a second `npm ci --offline` with the npm cache already warm still took 6.5 s on tmpfs and 16.5 s on the ext4 disk. npm's own extract-and-link work is the floor, not the network.
- Memory/disk placement matters more than the registry: online `npm ci` was 11.1 s on tmpfs and 10.9 s on disk, but the offline re-install was 6.5 vs 16.3 s.

### 5.3 What would actually speed up CI

A single prebuilt `node_modules.tar.gz` keyed by the lockfile hash (the shape of `actions/cache`, which is the cross-run cache the actions spike already needs from a Worker backed by R2): 30.5 MiB, extract **1.3 s on tmpfs** against 10 s for `npm ci`. On the container's ext4 disk the same extract took **30 s** (measured twice, after a recursive delete in the same container), which I could not explain in the time available: 3,000 small files were created in 126 ms, so it is not plain file-creation cost. Needs its own spike before anyone relies on it; the download would be one 30 MiB R2/Cache API object (about 0.1-0.5 s from the Worker) instead of 706 requests.

## 6. Egress and cost

**Egress.** Container egress is billed per GB leaving the container (table in section 1). `npm ci` downloads: the 29.4 MiB (fastify) or 149 MiB (heavy) is **inbound** to the container; what leaves is request headers, about 0.5 KB x 706 = roughly 0.35 MB per run, the same direct or through the proxy. At the Hong Kong rate ($0.04/GB, 500 GB/month included) that is $0.014 per 1,000 runs, below the allowance. The docs do not say whether traffic from a container to its own outbound handler counts as egress, or whether ingress is free; I could not measure billing. Worst case, if all downloaded bytes were billed at $0.04/GB: fastify $0.0011 per run, heavy $0.0058 per run ($1.1 and $5.8 per 1,000 runs); that bounds the risk and is of the same size as the container's own time ($0.0011 per 10 s on standard-4: 4 vCPU x $0.000020 + 12 GiB x $0.0000025 per second). Cloudflare's billing page was not checked after the runs; treat egress via the handler as unverified.

**Per 1,000 `npm ci` runs of the fastify tree** (706 requests each = 706,000 per 1,000 runs; Workers paid plan, beyond the included usage; each handler request is billed as one Worker request, which assumes the `ctx.exports` hop is not billed again; if it is, double the Worker line):

| Option | Storage ops | Worker requests ($0.30/M) | CPU (about 3 ms per hit, $0.02/M ms) | Total | Per GB-month stored |
|---|---|---|---|---|---|
| npmjs direct | - | - | - | $0 | - |
| Pass-through only | - | $0.21 | $0.04 | **$0.25** | - |
| R2 only | 706k Class B x $0.36/M = $0.25 | $0.21 | $0.04 | **$0.50** | **$0.015** |
| R2 + Cache API (warm) | $0 on hit (R2 only on a miss) | $0.21 | $0.04 | **$0.25** to $0.50 by hit rate (35% of reads missed in my run) | $0.015 |
| R2 + Workers Cache (warm) | $0 on hit | $0.21 (hits are billed as requests) | CPU on miss only | **$0.21** to $0.50 | $0.015 |
| KV only | 706k reads x $0.50/M = $0.35 | $0.21 | $0.04 | **$0.60** | **$0.50** (33x R2) |
| KV + Cache API (warm) | $0 on hit | $0.21 | $0.04 | $0.25 to $0.60 | $0.50 |
| Fills (one-off per unique tarball, per 100,000) | R2 Class A $0.45; KV write $0.50 | | | | |

The per-run differences are cents per thousand runs; none of the options is expensive. Storage is where they diverge: the fastify tarballs are 31 MiB, and a shared public-package corpus of 50 GB costs $0.75/month in R2 against $25/month in KV. Cache API and Workers Cache storage are not billed. For comparison, 1,000 CI jobs of 10 s on `standard-4` cost about $1.1 in container time.

## 7. Security notes

- **Integrity**: npm verifies each tarball against the lockfile's `integrity` (sha512) itself, so a corrupted or swapped object fails the install with `EINTEGRITY`; the proxy does not need to be trusted for content. The proxy should still verify what it stores (compute sha512 on fill and compare to the packument's `dist.integrity`, keep it in R2 `customMetadata`) so one bad fill cannot fail every job until it is purged. The spike does not do this.
- **Tokens**: the handler strips `authorization` before forwarding, and the proxy only ever fetches `https://registry.npmjs.org` with `accept` set by itself; no credential is cached or forwarded. Authenticated requests also bypass Workers Cache automatically.
- **Private packages are out of scope**: only public paths matching a strict tarball or package-name pattern are served (`/(@scope/)name/-/name-x.tgz` and `/name`); everything else is 404/405. A private-registry path would need per-tenant keys (`ctx.props` for Workers Cache, a tenant prefix for R2) and must never share keys with the public namespace.
- **Cache poisoning**: only the proxy writes the caches, from npmjs responses on a fixed upstream host; GET/HEAD only; keys are fixed by path (not by a client header), so a client cannot choose a key for someone else's content. Use the integrity-keyed or verified-on-fill scheme above to make a bad upstream response non-sticky; do not honour `Vary` on tarballs.
- **Multi-tenant sharing** of public tarballs is safe because they are content-addressed (name + version, verified by integrity); metadata is short-TTL and shared, so a yanked or republished version is visible within a minute. The container has no internet in the proxy arm, so a job can only reach the registry through this path (the only host name that resolved was `<cfg>.npm.internal`).
- **Poisoned metadata** is the more realistic risk (a rewritten packument pointing at a malicious tarball URL): rewrite only `https://registry.npmjs.org/` prefixes, and keep lockfile installs (`npm ci`) the supported path, since they pin integrity.

## 8. Recommendation

1. **Do not build a tarball cache for speed.** Measured gain is zero within noise, because the container, not the registry, is the limit.
2. **Do build the registry path** the no-internet job containers need: an outbound handler for a virtual registry host forwarding to a small Worker entrypoint that serves packuments (60 s TTL, `corgi` aware, URLs rewritten) and tarballs from `registry.npmjs.org`. It costs about 0.25 per 1,000 runs and added no measurable time. Consider `interceptHttps` on `registry.npmjs.org` so lockfiles and `npx` need no configuration (untested).
3. If a store is added later for resilience (npm outages, rate limits when hundreds of jobs start together) or to keep egress off the public internet: **R2 as the durable store (keyed by registry path, content hash in metadata) with the Workers Cache entrypoint (tiered, collapsing, hit runs no code) in front; the Cache API is the fallback** if the Workers Cache's version-keyed partitioning is awkward (set `cache.cross_version_cache`). Fill off the request path, stream instead of buffering, verify integrity on fill. **KV: no.** It wins on a single hot read (6 ms against R2's 129 ms) but not end to end (no measured margin), costs 33x per GB, cannot hold the 25-47 MiB binaries Next.js trees pull (it would need R2 anyway), and adds an eventual-consistency edge case (cached misses).
4. Measure a lockfile-keyed `node_modules` archive restore (section 5.3) before any further registry work: it is the only change that moved the 10 s.

## 9. Resources and teardown

All named `beanstalk-npm-spike*`, the legacy account. Nothing else was touched (the account holds other Workers and container applications; none were read beyond listing names, none modified).

| Resource | Removed with |
|---|---|
| Worker `beanstalk-npm-spike` with DO classes `ProxyBox`, `DirectBox`, `Stats` and secret `SPIKE_TOKEN` | `wrangler delete --force` |
| Container applications `beanstalk-npm-spike-proxybox` (`a0333da6-...`), `beanstalk-npm-spike-directbox` (`a032958b-...`) | `wrangler containers delete` |
| 12 registry images (`...-proxybox` and `...-directbox`, 6 tags each) | `wrangler containers images delete`; list afterwards shows 0 |
| R2 buckets `beanstalk-npm-spike` (APAC) and `beanstalk-npm-spike-weur`, about 2,500 objects | emptied through the Worker's `/purge`, then `wrangler r2 bucket delete` |
| KV namespace `beanstalk-npm-spike-kv` (`5942f323...`) | `wrangler kv namespace delete` (Cache API and Workers Cache entries expire on their own) |
| Local docker images, scratch token and secrets file | deleted |

No live Worker was deployed or modified; no secret is in the code, the data or this document. The measurement drivers read the token from a file named by `SPIKE_TOKEN_FILE`.

## 10. Notes on method

- The first deploy left the Workers Cache enabled for every entrypoint, including `NpmProxy`, which cached responses before the proxy logic ran; the config was changed to cache only `WcTarballs` before any number in this document was taken.
- Redeploys roll the container image in about 1-2 minutes after `wrangler deploy` returns (new instances kept starting the old image until then); the matrix ran on one image, the later probes (floor, tmpfs, CPU) on rebuilt images with the same npm.
- Cache API and Workers Cache arms are colo-dependent. The matrix landed mostly in HKG for the control Worker, but the proxy's colo varied; hit counts per run are in `matrix.jsonl` and the first warm run per cache arm is often partly cold. I report medians over all three, and call out the all-hit runs where they differ.
- `/bench` timings are measured inside the Worker (`performance.now()` around the I/O, body fully read), not from the client.
