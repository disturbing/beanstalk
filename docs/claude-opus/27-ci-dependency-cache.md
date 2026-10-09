# 27 · CI dependency cache: node_modules restored into memory

Written 2026-10-09, spike then design, branch `deps-cache-spike` off `prototype` at `b3f6bdf`. Follows `exp/npm-cache-spike/README.md` (a registry cache does not speed `npm ci`; a prebuilt `node_modules` archive does) and serves the Actions executor in `26` (one `standard-4` container per job, `actions/cache` a no-op today). Code and raw data: `research/deps-cache-spike/` (`results/runs.jsonl` holds every run quoted here). All measurements were taken on real Cloudflare containers in SIN on 2026-10-08/09; every resource is torn down (§9).

Coop's constraints, as given: CI instances 4 vCPU / 12 GB; `node_modules` lives in memory (tmpfs) and is never mounted or extracted onto the container disk; the R2 snapshot is capped at 4 GB by a setting and is patched, not re-uploaded, when the lockfile changes; the Cache API (or Workers Cache) sits in front of R2, and its 512 MB object limit must be designed around.

## 0. Answer

1. **Memory is the right place, and the gap is in small files, not big ones.** On the `standard-4` disk one large file is fine (230-761 MiB/s sequential write, 0.6-3.9 GB/s direct reads, 15k random 4 KiB IOPS at queue depth 1), but a tree of small files is not: reading every file of a 3.2 GB, 244k-file `node_modules` after a page-cache drop took **34.6-83.5 s on disk against 2.5-2.9 s on tmpfs**, and walking it (stat only, what module resolution does) took 6.9-10.0 s against 0.44-0.59 s. 100k 4 KiB files: cold read 8.4-10.7 s on disk, 1.0 s on tmpfs.
2. **Recommended layout: content-addressed chunks, packages assigned to chunks by a hash of their name, target 64 MB per chunk, 256 MB hard maximum**, plus a small layout object and a manifest per snapshot. Every object fits the 512 MB Cache API / Workers Cache limit, a one-package change re-uploads one chunk, and restore is a few parallel streams, each `zstd -d | tar -x` into tmpfs. Measured restore into tmpfs, warm cache: fastify (146 MB, 28.7k files) **0.7-0.8 s**, a Next.js-class app (533 MB) **1.0-1.5 s**, a synthetic 3.2 GB / 269k-file tree **5.9-6.0 s** (8.3 s straight from R2). `npm ci` of the first two took 11.4 s and 13.8 s.
3. **Rejected: one big tarball** (the 866 MB synthetic archive cannot be cached at all, every lockfile change re-uploads all of it, and extraction is one thread: 14-18 s for the synthetic tree) **and per-package objects as the restore unit** (restores are request-bound through the container's outbound handler: 4,735 objects took 28-161 s against 6 s for 17 chunks; above about 16 concurrent connections the handler path reset connections). Per-package objects stay the best *delta* unit (§3.5), so the manifest records packages, but storage and transfer are per chunk.
4. **Mounting a compressed image works, but only as the over-budget fallback.** As root (the job image's passwordless `sudo`) a container has every capability, `/dev/fuse` and loop devices: a kernel SquashFS mount of an image kept on tmpfs works, and so do `squashfuse`, `erofsfuse` and an overlayfs with a tmpfs upper layer over it. Kernel EROFS does not (not in the kernel). The image is 3.4x smaller than the tree (947 MB for the 3.2 GB tree), but a cold full read takes 15-45 s against 2.4 s from tmpfs, and the page cache it fills is about the size of the tree anyway. Use it only when the extracted tree would not fit the memory budget.
5. **On the job itself the effect is small for small trees:** fastify's suite (`borp`) took 42-46 s and its TypeScript checks 15-16 s whether `node_modules` was on tmpfs, on disk (after a cache drop) or on SquashFS. The page cache hides a 146 MB tree. The win is the restore (about 1 s instead of an 11 s `npm ci`) and, for large trees, the 12-34x cold-read gap in point 1.
6. **Budget:** extracted trees cost 1.06-1.5x their size in tmpfs (4 KiB pages per file; 1.22x for the synthetic tree). On 12 GiB the default budget for an extracted tree is 6 GiB. The multi-year monorepo's 10 GB, 440k-file tree does not fit; it needs filtered installs per job (§4.8), or the SquashFS fallback (about 2.9 GB of RAM at the measured ratio).

## 1. Verified facts (current docs, fetched 2026-10-08/09)

| Question | Answer | Source |
|---|---|---|
| Instance types | `standard-4` is **4 vCPU, 12 GiB memory, 20 GB disk** (the largest predefined type). Custom types: 1-4 vCPU, at most 12 GiB and 20 GB, at least 3 GiB per vCPU. Account concurrency: 6 TiB memory, 1,500 vCPU, 30 TB disk. | https://developers.cloudflare.com/containers/platform-details/limits/ |
| Measured | `MemTotal` 12,508,404 kB, `MemAvailable` 12.25 GB at boot, 4 vCPU (AMD EPYC), no swap; root is an 18.6 GB ext4 on a virtio disk (`/dev/vdc`); kernel `6.18.54-cloudflare-microvm`; `/dev/shm` is only 64 MiB. | `probe.sh`, `results/runs.jsonl` (`probe`) |
| Isolation and FUSE | "Each container instance runs in a Firecracker microVM with its own kernel and network"; disk is ephemeral; FUSE is supported ("use FUSE to persist disk to R2 ... you should not expect native SSD-like performance"). | https://developers.cloudflare.com/containers/platform-details/architecture/ ; https://developers.cloudflare.com/containers/examples/r2-fuse-mount/ |
| Measured privileges | As root: `CapEff 000001ffffffffff` (all capabilities, including `CAP_SYS_ADMIN`), no seccomp, `NoNewPrivs 0`, `/dev/fuse`, `/dev/loop-control` and `loop0-7`; `mount -t tmpfs` works; `drop_caches` works. Kernel filesystems: ext4, tmpfs, squashfs, overlay, fuse, xfs, btrfs, 9p, virtiofs; **no erofs**, no module loading (`/lib/modules` absent). | `probe.sh` |
| Cache API object size | 512 MB; 1,000 calls per request on paid. Per data centre, not tiered, not durable (previous spike). | https://developers.cloudflare.com/workers/platform/limits/ ; `exp/npm-cache-spike/README.md` §1 |
| Workers Cache object size | "All Workers Caching responses are subject to the Free plan size limit regardless of your account's plan", and the Free plan limit is 512 MB; tiered by default; only GET/HEAD cached. | https://developers.cloudflare.com/workers/cache/limitations/ ; https://developers.cloudflare.com/cache/concepts/default-cache-behavior/ |
| Worker request body | 100 MB (Free/Pro), 200 MB (Business), up to 5 GB (Enterprise). The spike uploads anything over 90 MiB as R2 multipart in 64 MiB parts. | Workers limits page above |
| R2 | 5 GiB single PUT, 10,000 parts, 1 write per second to the same key; $0.015/GB-month, Class A $4.50/M, Class B $0.36/M, no egress fee. | https://developers.cloudflare.com/r2/platform/limits/ ; https://developers.cloudflare.com/r2/pricing/ |

## 2. What was built

Worker `beanstalk-deps-spike` (workers.dev) with one container class `DepsBox` on `standard-4` (internet on, so the container could `npm ci` the trees it then packed), R2 bucket `beanstalk-deps-spike` (APAC). The container reaches storage only through an outbound handler for `http://deps.internal`, which hands each request to a `DepsStore` entrypoint: `/r2/<key>` (GET with Range, PUT, multipart), `/api/<epoch>/<key>` (Cache API in front of R2; the epoch makes a run cold) and `/wc/<epoch>/<key>` (the `WcStore` entrypoint with Workers Cache on). The image is Node 24 on Debian trixie with squashfs-tools, squashfuse, erofs-utils, erofsfuse, fio, fastify v5.6.1 and two lockfiles; a small job server runs shell commands and the tools in `image/tools/`.

Trees: **fastify** (the arena lockfile, `npm ci --ignore-scripts`: 706 packages, 146 MB, 28.7k entries), **heavy** (the previous spike's Next.js-class app: next, @swc/core, esbuild, sharp, typescript, prisma, playwright-core ...: 76 packages, 533 MB, 15.4k entries), **synthetic** (`gensynth.py`: 4,735 packages, 3.22 GB, 268.8k entries, every file a real file from the other two trees with a unique first line, so sizes and compressibility follow real JavaScript, maps, declarations and native binaries). The **shop arena** (`research/arena/app`) has no third-party dependencies at all (`node --test`, no `dependencies` in `package.json`), so there is nothing to restore; its restore is the no-op path (no manifest, skip).

Packing (`pack.py`, deterministic tars: sorted, mtime 0, uid 0, zstd level 3) produces three schemes from one tree: **single** (`snap/<name>/single.tar.zst`), **buckets** (packages assigned to N chunks by `sha1(package name) % N`, each chunk `chunk/<sha256>.tar.zst`, plus a layout chunk with `.bin` links, lock files, scope and nested `node_modules` directories; fastify and heavy N=4, synthetic N=16) and **per-package** (`pkg/<sha256>.tar.zst` of each package's own files, a layout object and a manifest of path to key). A package directory's object excludes its own nested `node_modules`, so the same package contents always give the same key. Restores were checked byte for byte (`diff -r --no-dereference` against the source tree: identical) for buckets and per-package.

## 3. Measurements

### 3.1 Disk against memory on `standard-4`

One large file (`bigfile.sh`; incompressible data held on tmpfs; MiB/s):

| | 2 GiB, run 1 | 2 GiB, run 2 | 4 GiB |
|---|---|---|---|
| Disk write (buffered + fdatasync) | 230 | 761 | 405 |
| Disk read, first O_DIRECT pass after write | - | 582 | 915 |
| Disk read, buffered, after `drop_caches` | 142 | 7,288 | 3,810 |
| Disk read, fio O_DIRECT 1 MiB QD16 | 3,175 | 3,122 | 3,901 |
| Disk 4 KiB random read, O_DIRECT, IOPS QD1 / QD32 | 14,548 / 134,603 | 14,570 / 143,085 | 15,189 / 62,188 |
| tmpfs write / read | 1,142 / 8,605 | - | 1,955 / 10,088 |

The virtio disk is backed by a host-side cache: reads right after a write run at GB/s even after the guest drops its cache, and the very first run read cold at 142 MiB/s. **One large file on the disk is fine** for sequential I/O (hundreds of MiB/s at worst). It is the per-file cost that hurts.

Small files (`smallfiles.py`: 100,000 files of 4 KiB in 1,000 directories; ms; disk twice):

| | create | sync | stat all, cold | read all, cold | read all, warm | delete |
|---|---|---|---|---|---|---|
| Disk (ext4) | 3,232 / 3,936 | 1,253 / 1,180 | 965 / 861 | **10,692 / 8,353** | 1,020 / 1,009 | 1,961 / 1,970 |
| tmpfs | 1,770 | 1 | 261 | **1,033** | 1,026 | 855 |

A real tree (`readtree.sh`, the synthetic 3.22 GB tree, 244,125 files; disk tree extracted from the snapshot; ms; 4 parallel readers):

| | stat walk, cold | read every file, cold | read every file, warm |
|---|---|---|---|
| Disk, run 1 / run 2 | 10,012 / 6,857 | **83,513 / 34,646** | 2,664 / 2,492 |
| tmpfs, run 1 / run 2 | 442 / 588 | **2,925 / 2,476** | 2,503 / 2,321 |

Warm reads are equal: once files are in the page cache the disk costs nothing. Note what that means for memory: a tree "on disk" that a build reads is held in the page cache anyway, so the disk does not save memory during the build; it only adds the cold-read cost.

### 3.2 Mounting a compressed image held in RAM

`mount.sh`: build the image on tmpfs, mount it, read every file after a page-cache drop (4 readers), compare with `diff -r`. All mounts that worked gave identical trees.

| Tree (extracted) | Image | Image size | Ratio | Mount | Cold full read | Same tree on tmpfs |
|---|---|---|---|---|---|---|
| fastify (146 MB) | SquashFS zstd-3, kernel (loop) | 29.7 MB | 4.9x | 22 ms | 6,277 ms | 400 ms |
| | SquashFS lz4, kernel | 44.1 MB | 3.3x | 14 ms | 4,733 ms | |
| | SquashFS zstd, `squashfuse` | 29.7 MB | | 23 ms | 4,301 ms | |
| | EROFS lz4hc, kernel | 73.8 MB | | **refused: `unknown filesystem type 'erofs'`** | | |
| | EROFS lz4hc, `erofsfuse` | 73.8 MB | 2.0x | 12 ms | 1,848 ms | |
| heavy (533 MB) | SquashFS zstd, kernel | 163 MB | 3.3x | 14 ms | 4,340 ms | 243 ms |
| | SquashFS lz4, kernel | 236 MB | 2.3x | 8 ms | 2,306 ms | |
| | `squashfuse` | 163 MB | | 13 ms | 2,886 ms | |
| | `erofsfuse` | 256 MB | 2.1x | 9 ms | 1,290 ms | |
| synthetic (3.22 GB) | SquashFS zstd, kernel | 947 MB | 3.4x | 45 ms | 45,475 ms | 2,373 ms |
| | SquashFS lz4, kernel | 1,377 MB | 2.3x | 18 ms | 28,795 ms | |
| | `squashfuse` | 947 MB | | 25 ms | 42,479 ms | |
| | `erofsfuse` | 1,579 MB | 2.0x | 12 ms | 14,836 ms | |

What is allowed, precisely: **as root (or `sudo`), with no extra Cloudflare configuration**, a container can `mount -t tmpfs`, attach a loop device and `mount -t squashfs`, run FUSE filesystems (`squashfuse`, `erofsfuse`), and `mount -t overlay` with a tmpfs upper layer over a read-only SquashFS (writable view, tested). It cannot mount EROFS in the kernel. A non-root process without `sudo` can do none of this (no user namespaces were tried).

Memory: the image costs its own size in tmpfs (Shmem), and reading through the mount fills the page cache with decompressed pages: after the synthetic full read, `Cached` grew by about 5.3 GB beyond Shmem. Those pages are reclaimable, so an image degrades to slower reads under pressure instead of failing, but a build that reads the whole tree uses about the extracted size again. Compression ratio and read speed pull opposite ways (zstd smallest and slowest; EROFS via FUSE fastest and largest).

### 3.3 Restore into tmpfs

`matrix.sh`, `restore.py`, `restore-pkg.mjs`. Each cell is wall time from the first request to the last file written, ms; "cold" is the first read in a new cache epoch (the cache fills on the way), "warm" the second. Destination is a fresh directory on a tmpfs mounted in the container; the page cache is dropped before each run. Chunk and single restores are `curl | zstd -dc | tar -x` pipelines, one per object, all objects at once. Per-package restores are one Node process (fetch, in-memory zstd, tar parse, write) with 16 requests in flight. `npm ci --ignore-scripts` from npmjs in the same container: fastify 11.4 s, heavy 13.8 s.

| Tree | Scheme (objects, compressed) | R2 only | Cache API cold / warm | Workers Cache cold / warm | Single tarball to **disk** |
|---|---|---|---|---|---|
| fastify, 146 MB raw | single (1, 28.0 MB) | 1,630 / 1,127 | 1,156 / 970; 1,018 / 976 | 1,910 / 940; 1,444 / 880 | 2,397 / 3,611 |
| | **chunks** (4 + layout, 3.7-15.7 MB) | 945, 876, 945 (two first reads after upload: 13,355 and 11,771) | 1,037 / 682; 1,203 / 776 | 1,668 / 720; 1,536 / 789 | |
| | per-package (706, 6.5 KB median) | 10,651 | 11,178 / 3,614 | 15,391 / 3,823 | |
| heavy, 533 MB raw | single (1, 140 MB) | 3,735 | 3,366 / 2,487 | 3,124 / 1,828 | 4,095 |
| | **chunks** (4 + layout, 5-80 MB) | 3,488 | 2,566 / 1,514 | 1,792 / 1,045 | |
| | per-package (76) | 9,894 | 6,230 / 5,118 | 6,162 / 3,678 | |
| synthetic, 3.22 GB raw | single (1, 866 MB) | 16,561 | **not cacheable (over 512 MB)**: 18,053 / 14,299 | 26,366 / 99,507 (not cached; one run stalled) | 27,478 |
| | **chunks** (16 + layout, 35-106 MB) | **8,277** | 6,415 / **6,013** | 6,051 / **5,853** | |
| | per-package (4,735, 66 KB median) | 160,931 | 80,072 / 73,906 (13 connection resets) | 92,959 / 28,235 | |

Download alone (single object, R2, to `/dev/null`): fastify 0.67-1.58 s, heavy 5.7 s (23 MiB/s), synthetic 17.9 s (46 MiB/s). One stream through the outbound handler carries 23-58 MiB/s; 17 parallel chunk streams carried 100-141 MiB/s, so chunks parallelise the download as well as the extraction (4 cores, one `zstd | tar` each).

Two unexplained outliers: the first R2 read of freshly uploaded fastify chunks took 13.4 s and 11.8 s twice, then 0.88-0.95 s in three repeats; and one warm Workers Cache read of the 866 MB single object took 99.5 s. Neither recurred in what the design keeps (chunks of at most a few hundred MB, cache-warm).

Memory during restore (sampled every 50 ms): tmpfs grew by 1.5x the tree for fastify (0.22 GB for 146 MB: 4 KiB pages for 28.7k small files), 1.06x for heavy, 1.22x for the synthetic tree (3.94 GB for 3.22 GB). Transient memory above that was at most about 0.4 GB for chunks and 0.5 GB for per-package restores.

Time to first test (fastify): chunk restore warm 0.7-0.8 s plus the first test file (`node --test test/404s.test.js`) 1.0-1.2 s, about **2 s, against 12.5 s** for `npm ci` plus the same test.

Per-request cost through the outbound handler, serial: Cache API hit 15-19 ms, Workers Cache hit 10-32 ms, R2 181-272 ms (time to first byte; the bucket is APAC). Concurrency: at 16 requests in flight, 706 cached objects came back in 2.1-2.5 s with no errors; at 32, 64 and 256 the client saw `ECONNRESET` and 10 s connect timeouts and the same fetch took 17-18 s. The container-to-handler path behaves like a connection pool of about 16; a restorer must cap concurrency there, and per-object restores top out at roughly 300-350 objects per second.

### 3.4 Effect on the job (fastify, `suite.sh`)

Checkout and `node_modules` placed on tmpfs, on the ext4 disk (page cache dropped after placing), or on tmpfs with `node_modules` as a kernel SquashFS mount of an image on tmpfs; two runs each, ms:

| Placement | Place the tree | First test file | Unit suite (`borp`) | TypeScript (`tsc` + `tsd`) |
|---|---|---|---|---|
| tmpfs | 1,281 / 1,497 | 1,237 / 1,126 | 43,527 / 44,313 | 15,632 / 15,247 |
| disk | 3,037 / 4,769 | 1,072 / 1,007 | 42,434 / 46,148 | 14,678 / 15,737 |
| SquashFS on tmpfs | 1,017 / 38 | 1,131 / 1,017 | 45,499 / 43,762 | 16,130 / 16,452 |

All runs passed. No placement changes the suite beyond run-to-run noise: it is CPU-bound and the 146 MB tree is cheap to fault in. The differences show where the tree is large or read cold (§3.1) and in getting the tree there (extracting the single archive to disk took 1.5-3.2x as long as to tmpfs for fastify, 1.1x for heavy, 1.7x for the synthetic tree).

### 3.5 Delta: bytes to upload when dependencies change

`delta.sh`, `delta-synth.sh`. Objects already in R2 are skipped after a HEAD, so "upload" is only what is new.

| Change | Single tarball | Single, `zstd --patch-from` old tar | Chunks (by name hash) | Per-package |
|---|---|---|---|---|
| Fresh `npm ci` of the same lockfile in another container | 28.0 MB | - | **0.08 MB** (layout only; all 4 chunk keys identical) | **0** (all 672 keys identical) |
| heavy: `typescript` 5.9.3 to 5.9.2 (one 23 MB package) | 139.8 MB | 0.11 MB | **5.05 MB** (1 of 4 chunks + layout) | 4.23 MB (1 object) |
| fastify: `npm install semver@7.7.1` (npm rewrote the tree: 706 to 719 packages, 146 objects changed) | 29.1 MB | 2.78 MB | 29.1 MB (all 4 chunks changed) | 10.5 MB (146 objects) + 0.1 MB manifest |
| synthetic: one file in one package | 865.8 MB | **impossible**: `zstd: Can't handle files larger than 2 GB` | **46.0 MB** (1 of 16 chunks; layout unchanged) | 0.63 MB (1 object), but the 4,735 HEAD checks through the handler took 80 s with 59 retries |

Determinism holds: an independent `npm ci` of the same lockfile produced the same package and chunk keys, so a re-save of an unchanged tree costs a manifest. Chunk deltas are as small as `1/N` of the snapshot per touched chunk; they lose to per-package objects when a change touches many packages across all chunks (the fastify case with N=4), and N grows with the tree (§4.1). Patch-from deltas are tiny but need the old archive at both ends, a chain on restore, and stop working at 2 GB.

## 4. Recommended design

### 4.1 Layout in R2

```
deps/<tenant>/<repo>/chunks/<sha256>.tar.zst          immutable, content-addressed, 1 MB-256 MB
deps/<tenant>/<repo>/manifests/<snapshot-key>.json   one per snapshot
deps/<tenant>/<repo>/families/<family-key>.json      N (chunk count) and the latest snapshots per scope
```

- **Chunk** = a deterministic tar (sorted, mtime 0, uid/gid 0, modes kept) of the packages whose name hashes to that chunk index, zstd level 3. Package directories are stored at their path relative to the install root, without their own nested `node_modules` (those are separate packages). One extra **layout chunk** holds everything outside packages (`.bin` links, `.package-lock.json` / `.modules.yaml`, scope directories, nested `node_modules` directories, pnpm's `node_modules/.pnpm` symlink farm).
- **N** per family (repository + install filter + platform): the smallest power of two that keeps the mean chunk at or under 64 MB compressed, at least 4, at most 64 (64 x 64 MB = the 4 GB cap). N is stored in the family record and kept stable across lockfile changes so chunk assignment does not shuffle; it is recomputed (a full re-upload) only when the mean chunk leaves 32-128 MB. Name hashing is uneven (synthetic: 35-106 MB around a 54 MB mean), so a chunk that would exceed **256 MB** is split by a second hash and the split recorded in the manifest. Every object therefore stays under the 512 MB Cache API / Workers Cache limit with room to spare.
- **Manifest**: format version, snapshot key, N, platform, Node and package-manager versions, install command and filter, created-at and source ref, extracted bytes and file count (for the memory check before restoring), and per chunk: key, compressed bytes, sha256, extracted bytes, and the packages in it (path, name, version, integrity from the lockfile). The package list is what makes per-package deltas and future dedupe possible without changing storage.

Why chunks and not the alternatives the brief listed: a single archive is uncacheable above 512 MB, re-uploads in full on every change and extracts on one core (§3.3, §3.5); per-package objects are the best delta unit but restore 5-19x slower because every object is a request through the handler (§3.3). Fixed-size byte ranges of one archive (R2 range reads) cache fine but give no delta: any change shifts every later range.

### 4.2 Keys and lookup

- **Snapshot key** = sha256 of: lockfile bytes (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`), the install filter (sorted workspace list, §4.8), platform (`linux-x64-glibc`), Node major, package-manager name and major, and install flags that change the tree (`--ignore-scripts`, `--omit=dev`). Postinstall output is part of the tree, so it is part of the key through these inputs.
- **Lookup order** (the `actions/cache` restore-keys shape): exact snapshot key in the job's scope; else the family's latest snapshot in the job's scope; else the family's latest on the default branch. A miss restores nothing and the job installs normally.
- **Scopes** (as GitHub isolates caches by ref): a job reads its own ref's scope and the default branch's; it writes only its own ref's scope; only jobs on the default branch (push, not pull request) write the default scope. A pull request from a fork never writes anything another ref reads.

### 4.3 Restore (job start)

1. The runner (as root through the image's `sudo`) mounts a tmpfs at `<workspace>/node_modules`, `mode=0755,nosuid,nodev`, `size=` the memory budget (§4.7). Not on disk, not `noexec` (`.bin` must run). For workspaces with more than one `node_modules`, a single tmpfs at `/run/deps` with bind mounts to each path (bind mounts were not measured; overlay mounts were).
2. It asks the executor Worker for the manifest over the existing outbound virtual host (`executor.internal` in `26`): the Worker, not the container, derives tenant, repository and scope from the job's record, so a job cannot name another tenant's keys.
3. If the manifest's extracted size does not fit the budget, it switches to the SquashFS fallback (§4.7) or skips.
4. It fetches every chunk at once (at most 16 in flight, §3.3) and streams each through sha256 verification, `zstd -d` and tar extraction into the tmpfs; a hash mismatch fails the restore (the job then installs normally) and is reported, never extracted.
5. Then the job's own install step runs against the restored tree. With an exact hit it finds nothing to do. With a nearest-snapshot hit it reconciles: `npm install` / `pnpm install --frozen-lockfile` / `yarn install --immutable` modify the tree in place. A workflow that runs `npm ci` deletes `node_modules` first and so gains nothing from a partial hit; the setup step should say so in the log and recommend `npm install` with a committed lockfile.

### 4.4 Save and patching on lockfile change (job end)

Only when the exact snapshot key missed, the job succeeded, and the scope allows writing:

1. Pack the tree into N chunks plus layout (deterministic, so unchanged chunks hash to their old keys; measured 0.6-11 s for 146 MB-3.2 GB on 4 cores).
2. Send the list of chunk keys to the Worker in **one** request; the Worker HEADs them in R2 (subrequests inside the Worker, not per-object round trips through the handler, which took 80 s for 4,735 keys) and answers which are missing.
3. Upload only the missing chunks, multipart in 64 MiB parts (single requests are capped at 100 MB by the Worker body limit), then write the manifest last; the manifest is the commit point, so a crashed save leaves only unreferenced chunks for garbage collection.
4. A one-package change uploads one chunk (46 MB of an 866 MB snapshot in the synthetic case, 5 MB of 140 MB for `typescript`). If a later version wants smaller uploads, a changed chunk can be shipped as a `zstd --patch-from` delta against the previous version of the same chunk index and rebuilt server-side by a container before it is stored (chunks are at most 256 MB, well under zstd's 2 GB limit); not worth building until upload bandwidth shows up as a cost.

### 4.5 The 4 GB cap

`deps_snapshot_max_bytes` (compressed, default 4 GiB, a per-repository setting). Before uploading, the saver sums the chunk sizes; over the cap it uploads nothing, logs `dependency snapshot 5.1 GB is over the 4 GB limit; restore uses the previous snapshot; consider filtered installs` once per family, and records the refusal in the family record so the UI can show it. Restores keep using the last snapshot that fit. A second setting bounds the extracted size that is restored into tmpfs (§4.7), because the 4 GB compressed cap corresponds to about 15 GB extracted at the measured 3.7:1, more than the instance has.

### 4.6 Cache in front of R2

All chunks are immutable and at most 256 MB, so every one can be cached. Primary: a **Workers Cache** entrypoint (`cache.enabled` on an inner entrypoint, keyed by the full chunk path including tenant and sha256, `cache-control: public, max-age=31536000, immutable`; it is tiered, collapses concurrent misses, and a hit runs no Worker code; set `cross_version_cache` so executor deploys do not empty it). Fallback: the Cache API with the same keys (per colo, not tiered). Warm, both were the same within noise (§3.3: 0.7-0.8 s / 1.0-1.5 s / 5.9-6.0 s by tree); cold, each costs one R2 read per chunk. Manifests are not cached (small, mutable family records; the manifest itself is immutable and could be). Fill happens on the read path (tee to the cache while streaming to the container), so the first job in a colo pays R2 speed and later ones the cache's.

### 4.7 Memory budget on `standard-4` (12 GiB)

| Item | Budget |
|---|---|
| Kernel, runner, act, sidecars | about 0.5 GB (`MemAvailable` 12.25 GB at boot) |
| `node_modules` tmpfs (extracted size x 1.06-1.5 for page rounding) | **default cap 6 GiB of tmpfs** (`deps_tmpfs_max_bytes`) |
| Restore transient (pipes, zstd windows, one Node buffer per in-flight object) | under 0.5 GB measured |
| Build and test processes, the checkout's page cache | the remaining 5-6 GB |

Before restoring, the runner compares the manifest's extracted size (times 1.25 for small-file overhead) with the cap:

- **Fits:** extract into tmpfs (the default path).
- **Does not fit, but the compressed image would:** the SquashFS fallback. The runner builds nothing; the saver also stores a SquashFS image of the tree (lz4 or EROFS for FUSE, chunked the same way, concatenated on restore into a tmpfs file), and the job mounts it read-only with an overlay upper layer on tmpfs. Measured: 3.4x smaller (zstd) or 2.0-2.3x (lz4/EROFS), cold full reads 6-19x slower than tmpfs, page cache reclaimable under pressure. This roughly doubles storage for large trees, so it is opt-in per repository until a large customer needs it.
- **Neither:** skip the restore and say why; the job installs into tmpfs if that fits, else on disk with a warning that dependency reads will be slow (§3.1).

### 4.8 Monorepos: filtered installs

The multi-year monorepo's tree (about 6.4 GB at the root, 10 GB in total, 440k files) does not fit the 6 GiB budget with room for a build, and at 3.7:1 it is about 2.7 GB compressed. One snapshot of the whole tree per job is the wrong unit. Instead:

- **Per-job filter.** A job declares (or the setup step infers from its `working-directory`) the workspace packages it builds; it installs only their dependency closure: `pnpm install --frozen-lockfile --filter <pkg>...`, `npm ci --workspace <pkg> --include-workspace-root`, `yarn workspaces focus <pkg>`. The filter is part of the snapshot key (§4.2) and of the family, so each package's CI keeps its own N, chunks and history.
- **Typical size.** A package's closure in a large monorepo is usually a small fraction of the root tree; a 6 GiB budget covers any closure up to about 4.5 GB extracted. Jobs whose closure is the whole tree (lint everything, the root build) are the SquashFS-fallback case.
- **Dedupe across filters is weak with name-hash chunks** (a chunk's content depends on which packages the filter pulled in), so filtered snapshots of one repository store overlapping packages more than once. Storage is cheap (§4.10); if it matters, the manifests' package lists allow a later Worker-side assembler that builds chunks from per-package objects without changing the restore path.
- **pnpm specifics.** pnpm's tree is a content store plus symlinks (`node_modules/.pnpm/<name>@<version>/node_modules/<name>`), which packs well: each `.pnpm/<id>` directory is a package for chunking, and the symlink farm goes into the layout chunk.

### 4.9 Security

- **Per-tenant, per-repository keys only.** Chunks contain install-script output, private packages and whatever a job left in `node_modules`, so no chunk is shared across repositories, even when the content hash matches; the hash would otherwise tell one tenant that another has a given private package, and a malicious job could seed a hash another tenant later trusts. Cross-tenant sharing stays where it is safe: public registry tarballs verified by lockfile integrity, through the npm proxy from the previous spike.
- **The Worker owns the namespace.** The container presents only a chunk or manifest name; the Worker resolves tenant, repository and scope from the job's Durable Object record (the outbound handler's `containerId`), so a job cannot read or write outside its repository or write outside its scope.
- **Poisoning.** Scoped writes (§4.2) keep pull-request jobs, and especially forks, out of the default branch's snapshots. Integrity is checked on every restore (manifest sha256 per chunk, verified while streaming). Manifests are written by the Worker, never uploaded as-is from the container. Caches are keyed by the full tenant path and content hash, so a poisoned cache entry cannot sit under a key it does not hash to.
- **Mount options.** tmpfs with `nosuid,nodev`, owned by the job user; the mount is created by the runner, and the job runs as `runner`. (The job has passwordless `sudo` on its own microVM by design, `26` §2; the container is destroyed after the job.)
- **Secrets.** Registry credentials live outside `node_modules` (`.npmrc` in the home or checkout) and are never packed; the saver logs (names only, no contents) any `.npmrc` or `.env` it finds under `node_modules`, since a snapshot is readable by every later job in its scope.

### 4.10 Eviction and cost

- **Retention**: a manifest not restored for 7 days is deleted; per repository, snapshots are capped at 10 GB in total (setting), evicting least recently restored first (GitHub's policy for `actions/cache`). `last_restored_at` is updated on each restore in the family record (a Durable Object per repository, or a D1 row).
- **Garbage collection**: daily mark and sweep per repository; a chunk is deleted when no manifest references it and it is older than 1 day (so a save in progress is not swept).
- **Cost, illustrative**: storage $0.015/GB-month, so a 4 GB snapshot is $0.06 a month and the 866 MB synthetic one $0.013. A cold restore is 1 manifest + N chunk reads (at most 66 Class B operations, $0.00002); a warm one reads no R2 at all; Workers Cache and Cache API storage is not billed, hits are billed as Worker requests. A save of one changed chunk is a handful of Class A operations. Container time saved: about 10-12 s of `npm ci` per job on fastify-sized trees, about $0.0011 per job on `standard-4`, more than the storage costs after a few runs a month.

## 5. Open decisions for Coop

1. **Chunk target 64 MB, maximum 256 MB, N a power of two between 4 and 64** (§4.1). Smaller chunks mean smaller deltas and more requests; 64 MB balanced the measured per-request cost against a one-package upload.
2. **Restore behaviour on `npm ci`.** Run the job's own install after a restore (works for `npm install`, `pnpm`, `yarn`; `npm ci` wipes a partial hit), or have the setup step skip the job's install on an exact hit.
3. **SquashFS fallback for over-budget trees** (doubles storage for those repositories): build now, or start with "skip and install on disk with a warning" and add it when the multi-year monorepo or a customer needs whole-tree jobs.
4. **Defaults**: 6 GiB tmpfs budget, 4 GiB compressed snapshot cap, 10 GB per repository, 7-day idle eviction.
5. **Workers Cache first, Cache API fallback**, or the reverse; the measurements do not separate them warm.

## 6. Verification

- Restored trees were compared byte for byte with the source (`diff -r --no-dereference`): identical for chunk and per-package restores; all mounts produced identical trees.
- fastify's suite and TypeScript checks passed in every placement (§3.4).
- Every number in this document is a line in `research/deps-cache-spike/results/runs.jsonl` (label, command, colo, exit code, output).
- The repository's `pnpm check` was not run (the spike adds no package to the workspace; its Worker is typechecked on its own with `tsc --noEmit`).

## 7. Method notes

- All runs in SIN (container and control Worker), R2 bucket in APAC. Two container instances (`a1`, `a2`) of the same image; `a2` ran the mount probes, the suite placements and the delta for fastify and heavy in parallel with `a1`'s restore matrix (separate microVMs).
- "Cold" cache means a new cache epoch in the key; R2 itself has no cache to warm. Each restore went to a fresh directory after a page-cache drop; the source trees stayed on the same tmpfs, so `Shmem` baselines differ between runs (growth is reported, not totals).
- The synthetic tree is built from real files but is not a real dependency graph: no bins, few nested trees, no install scripts. Its role is size, file count and compressibility.
- Per-package restores with one `tar` process per object (`restore.py`) were 2-5x slower than the single-process Node restorer; only the Node numbers are in the table.

## 8. Relation to other docs

`26` §4 lists `actions/cache` as a no-op and §6 leaves "cross-run cache ... on R2" for later; this document is the dependency-specific half of that. The general `actions/cache` service (arbitrary paths, keys and restore-keys from workflows) can reuse the same chunked, content-addressed storage and scopes; its archives go where the workflow says, which for `node_modules` should still be the tmpfs.

## 9. Resources and teardown

All named `beanstalk-deps-spike*`, account `2c7358a6...`; nothing else was read or modified.

| Resource | Removed with |
|---|---|
| Worker `beanstalk-deps-spike` (DO class `DepsBox`, secret `SPIKE_TOKEN`) | `wrangler delete` |
| Container application `beanstalk-deps-spike-depsbox` (`a03e497b-...`) and its instances `a1`, `a2` | destroyed, `wrangler containers delete` |
| Registry images `beanstalk-deps-spike-depsbox:*` | `wrangler containers images delete` |
| R2 bucket `beanstalk-deps-spike` (single, chunk, per-package and manifest objects, about 3.3 GB) | emptied, then `wrangler r2 bucket delete` |

Cache API and Workers Cache entries expire on their own. No secret is in the code, the data or this document; the bearer token lived in a scratch file, now deleted.
