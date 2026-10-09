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

Adopted 2026-10-09 (§10): 1, 4 and 5 as recommended (Workers Cache first); 2 decided by measurement (§10.2); 3 still open (no SquashFS fallback built).

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

## 10. Built (2026-10-09)

Coop adopted the design on 2026-10-09: "yes adopt node modules cache if it showed performance improvements (please report)". Built on `prototype` at `0c57845`, measured on its own test stack (`ci`, §10.6). Deployed to production from `b37fa6b` and smoke-tested there the same day (§10.7); the `ci` stack is torn down.

### 10.1 What runs where

```
job container (standard-4)                          beanstalk-actions-executor (Worker)
 actions-runner: adds two steps to the job  ──┐
 act runs them like any step:                 │     deps.internal outbound handler
   beanstalk-deps restore  ── http://deps.internal ─▶ bearer → the job's own DO (ActionsJobContainer.depsGrant)
   beanstalk-deps save     ──┘                │       → grant: repository id, read scopes, save scope, caps
                                              │     /v1/lookup, /v1/missing, /v1/commit → DepsCacheIndex (DO per repository)
                                              │     /v1/chunks/<sha>  GET → DepsChunkCache (Workers Cache) → Cache API → R2
                                              │     /v1/chunks|uploads/<sha> PUT → R2, re-read and hash-checked
                                              └──── R2 beanstalk-deps-cache: deps/<repo id>/chunks/<sha256>.tar.zst, deps/<repo id>/manifests/<scope>/<key>.json
```

- **Runner** (`packages/actions-runner/src/deps/plan.rs`): when the job asks for a dependency cache, the runner rewrites the one-job workflow it hands act. `actions/setup-node` with `cache: npm|pnpm|yarn` keeps its step without `cache:` and gets the restore step right after it (`cache-dependency-path` names the install directory); `actions/cache` (or `actions/cache/restore`) whose every `path` is `node_modules` or a package-manager store is replaced in place by the restore step, keeping its `id` (`steps.<id>.outputs.cache-hit` is `true` on an exact hit); `uses: beanstalk/deps-cache@v1` (with `working-directory`) is the opt-in. A save step is appended with `if: success()`. Every original step without an `id` gets its index as its id, so act's step ids still match the control plane's step numbers after the insert (the two cache steps' lines show as job-level lines). The repository or org variable `BEANSTALK_DEPS_CACHE=off` turns it off.
- **Tool** (`beanstalk-deps`, a second binary of the crate, at `/opt/beanstalk/bin` with a copy of `zstd`): `restore` finds the lockfile (`package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`), mounts a tmpfs at `<install dir>/node_modules` through the image's `sudo` (size `DEPS_TMPFS_MAX_BYTES`, `nosuid,nodev`, owned by the job user; never on the disk: if the directory already has files on disk it skips), reads Node and package-manager versions while the mount runs, computes the family and snapshot keys (§4.2: install directory, lockfile name, platform, Node major, package manager and major, tree-changing install flags read from the job's first install command, then the lockfile bytes), looks up, and streams every chunk (at most 16 requests in flight) through sha256 and `zstd -d | tar -x`. A wrong hash or size, or any failure, empties the tmpfs before the next step runs and the job installs normally; a cache problem never fails the job. `save` scans the tree into packages and layout (§4.1; `node_modules/.cache` is left out), assigns packages to the family's N buckets by name hash (N from the family, else from the tree size: 4 to 64), packs every chunk with deterministic GNU tar and zstd -3 on four cores, asks the Worker in one request which chunks are missing, uploads only those (one request up to 64 MiB, else R2 multipart in 64 MiB parts, eight at once), and commits the manifest last.
- **Worker** (`packages/actions-executor/src/deps/`): the bearer is a random 32-byte token minted per job when it is accepted, held in the job's record and given to the steps only as the secret `BEANSTALK_DEPS_TOKEN` (masked like any secret); the grant comes from the record, never from the request. `DepsCacheIndex` (one SQLite Durable Object per repository) answers lookups in restore-keys order (exact key in the job's scope then the default branch's; else the family's latest), keeps the family's N, checks the cap and that every chunk is in R2 before it records a snapshot, evicts least recently restored snapshots above the repository total, and runs a daily sweep (alarm): snapshots unused for `DEPS_IDLE_DAYS` go, then chunks no manifest references and older than a day. Uploads are re-read and hashed after they are stored; a mismatch is deleted.
- **Scopes**: the gateway sets `JobSpec.depsCache = { scope: 'stalk', canSave: origin === 'stalk' }`. Only runs of the stalk save; pre-land, dispatch and schedule runs read and never write, so a bean that has not landed cannot change what a stalk run installs. Snapshots are per repository (keyed by the repository id, which is stable across renames); no chunk is shared between repositories even when the bytes match.
- **Settings**: executor vars `DEPS_CACHE_MODE` (`on`), `DEPS_SNAPSHOT_MAX_BYTES` (4 GiB), `DEPS_TMPFS_MAX_BYTES` (6 GiB), `DEPS_REPO_MAX_BYTES` (10 GB), `DEPS_IDLE_DAYS` (7). The snapshot cap per repository or org is the Actions variable `BEANSTALK_DEPS_SNAPSHOT_MAX` (`2GiB`, `500MB`, bytes; repository wins over org, at most the repository total), which reuses the existing secrets-and-variables settings and permissions instead of a new settings surface. The tmpfs cap is a var tied to the instance type: a larger instance type gets a larger `DEPS_TMPFS_MAX_BYTES` in its environment override, no code change. Over the snapshot cap the save uploads nothing, the Worker records the refusal on the family, and restores keep the last snapshot that fit.
- **Cache in front of R2**: Workers Cache first (`DepsChunkCache` entrypoint with `cache.enabled`, `cross_version_cache: true` so executor deploys keep it), the Cache API second (a miss is stored from R2 first and read back, so a 256 MB chunk never sits in the isolate's memory).
- **Peak memory**: the runner samples `MemTotal - MemAvailable` every 250 ms during the job and prints the peak as the job's last runner line.

### 10.2 `npm ci` (open decision 2, decided by measurement)

`npm ci` deletes `node_modules` before it installs, so a restore would be thrown away. Two things were measured on the stack:

- After an exact hit, `diff -r --no-dereference` between the restored tree and a fresh `npm ci` of the same lockfile in the same job found **no difference**. So on an exact hit the restore step puts an `npm` wrapper first on `PATH`: `npm ci` keeps the tree and only runs the root package's own lifecycle scripts (none with `--ignore-scripts`; the dependencies' scripts ran when the snapshot was made). Install step: **6-19 ms** instead of 6-14 s.
- The first choice, `npm install --no-save --prefer-offline` on the restored tree, was wrong: on the stack it re-resolved part of fastify's tree to newer versions than the lockfile's (`added 15 packages, removed 4 packages, and changed 145 packages in 26s`, e.g. `glob@10.5.0` where the lockfile says `10.4.5`), slower than `npm ci` and not what the lockfile says. (Locally, on another npm build, the same command answered "up to date in 1 s"; the restored tree's parallel extraction leaves directories with fresh mtimes, so the tool now also touches `node_modules/.package-lock.json` after a restore, but that did not change the result.) So after a **partial** hit an `npm ci` job runs `npm ci` as itself, and the restore step does not download the partial snapshot at all for an `npm ci` job (it would be deleted); the save still uploads only the changed chunks. `pnpm install --frozen-lockfile`, `yarn install` and `npm install` jobs restore the partial snapshot and reconcile in place; those were not measured on the stack.

### 10.3 Measured on the `ci` stack (SIN, standard-4, 2026-10-09)

Each push to the test repository ran two workflows on separate containers at the same time: `cached` (checkout, `setup-node` 24 with `cache: npm`, `npm ci --ignore-scripts`, one test file) and `plain` (the same without `cache:`). "Deps ready" is the sum of the steps up to dependencies installed: checkout + setup-node + restore + install (the job's set-up before the first step, about 6 s, is the same for both and left out). Bytes are compressed. Peak is the job's peak memory in use. Image `actions-runner-2026-10-09.4` to `.6` (streaming restore) unless marked `.3` (restore buffered each chunk until verified, then extracted). Every number is in the job logs under `research/deps-cache-spike/results/ci-runs.jsonl`.

**fastify** (v5.6.1 with the arena lockfile: 706 packages, 146 MB, 25.8k files; snapshot 28.0 MB in 4 buckets + layout)

| Run | Restore | Install | Deps ready | Job wall | Downloaded | Uploaded | Peak |
|---|---|---|---|---|---|---|---|
| Cold, no snapshot (`.1`) | 0.85 s (miss) | 8.7 s (`npm ci` into tmpfs) | 13.4 s | 39 s | 0 | 28.0 MB (5 chunks; save 5.2 s: pack 0.5, upload 2.5) | 900 MiB |
| Plain, same push | - | 5.9 s | 9.7 s | 24 s | - | - | 728 MiB |
| Exact hit (`.3`, `.4` ×3, `.5`, `.6` ×2) | 1.37 / 1.72 / 2.56 / 1.91 / 1.14 / 1.89 / 1.39 s | 6-17 ms | 5.3 / 7.1 / 7.2 / 6.1 / 5.0 / 7.1 / 6.4 s | 19-23 s | 28.0 MB | 0 | 602-683 MiB |
| Plain, same pushes | - | 10.6 / 13.6 / 8.4 / 8.5 / 10.7 / 7.8 / 10.5 s | 14.2 / 17.9 / 12.3 / 12.5 / 15.4 / 11.5 / 14.9 s | 24-33 s | - | - | 717-759 MiB |
| One dependency changed (`typescript` 5.9.3 → 5.9.2), `npm ci` | 0.58 s (partial, not downloaded) | 8.3 s | 14.0 s | 34 s | 0 | **9.1 MB of 28.0 MB** (2 of 5 chunks; save 3.4 s) | 900 MiB |
| Plain, same push | - | 5.9 s | 10.3 s | 28 s | - | - | 726 MiB |

**Next.js-class app** (the spike's `heavy`: next, @swc/core, esbuild, sharp, typescript, prisma, playwright-core and more; 76 packages, 533 MB, 14.1k files; snapshot 140.3 MB in 4 buckets + layout, the largest over 64 MiB so it went up as multipart)

| Run | Restore | Install | Deps ready | Job wall | Downloaded | Uploaded | Peak |
|---|---|---|---|---|---|---|---|
| Cold, no snapshot | 0.91 s (miss) | 13.0 s | 18.3 s | 45 s | 0 | 140.3 MB (5 chunks; save 10.2 s: pack 2.1, upload 7.0) | 1,310 MiB |
| Plain, same push | - | 6.0 s | 11.3 s | 28 s | - | - | 678 MiB |
| Exact hit, buffered (`.3`, 4 runs) | 4.3 / 4.1 / 5.0 / 2.4 s | 6-14 ms | 8.7 / 8.8 / 9.0 / 6.8 s | 22-25 s | 140.3 MB | 0 | 1,030-1,078 MiB |
| Exact hit, streaming (`.4` ×2, `.6`) | 3.2 / 2.0 / 2.3 s | 9-19 ms | 7.6 / 5.8 / 6.5 s | 21-23 s | 140.3 MB | 0 | 914-966 MiB |
| Plain, same pushes (7 runs) | - | 6.1-12.9 s | 9.6-17.2 s | 22-33 s | - | - | 697-752 MiB |
| One dependency changed (`typescript` 5.9.3 → 5.9.2), `npm ci` | 0.63 s (partial, not downloaded) | 13.1 s | 17.3 s | 39 s | 0 | **39.6 MB of 140.3 MB** (2 of 5 chunks; save 7.6 s: pack 2.3, upload 4.7) | 1,256 MiB |
| Plain, same push | - | 8.9 s | 12.4 s | 24 s | - | - | 770 MiB |

What this says, plainly:

- **The restore is faster than a plain install on every exact hit**: deps ready 5.0-7.2 s against 11.5-17.9 s for fastify, 5.8-9.0 s against 9.6-17.2 s for the Next.js-class app; the job wall time dropped by 3-12 s. `npm ci` from the registry varied 5.9-13.6 s on the same tree on the same stack (two containers installing at once share the egress), the restore 1.1-2.6 s and 2.0-5.0 s.
- **Slower than the spike predicted.** The spike measured 0.7-0.8 s (fastify) and 1.0-1.5 s (heavy) warm into tmpfs; the product measures 1.1-2.6 s and 2.0-3.2 s. The difference is the steps around the download: the tmpfs mount through `sudo`, `node --version` and `npm --version` (about 0.4 s, now overlapped with the mount), the lookup (job Durable Object for the grant, then the repository's Durable Object, then the manifest from R2), and on a chunk's first read in the colo an R2 read instead of a cache hit. Buffering each chunk until verified before extracting cost another 1-2 s on the 533 MB tree (`.3` against `.4`), so the restore now streams and empties the tmpfs on a mismatch instead (§10.1). Broken down on `.6` (fastify / heavy): tmpfs mount and version probes 0.10-0.15 s, lookup 0.59-0.71 s (outbound handler, the job's Durable Object for the grant, the repository's Durable Object, the manifest from R2), chunks fetched and extracted 0.6 s / 1.6 s. The lookup is the next thing to cut: the manifest is immutable and could be cached like a chunk, and the grant could ride on the job's container start.
- **The first run and a lockfile change are slower than plain**, because the save runs inside the job: +5.2 s (fastify) and +10.2 s (heavy) to pack and upload the whole snapshot, +3.4 s to pack the tree and upload the two changed chunks. `npm ci` into tmpfs on those runs also took longer than plain on the same push (8.7 against 5.9 s, 13.0 against 6.0 s); two installs ran at once and shared the network, and the repeated plain runs spread 5.9-13.6 s, so this is not shown to be tmpfs. The save could move after the job's result is reported (it does not change the conclusion); not built.
- **Delta upload works as designed**: a one-package change uploaded only the bucket holding the package and the layout chunk; the other three bucket keys were unchanged. That was 9.1 MB of 28.0 MB for fastify, but **39.6 MB of 140.3 MB for the Next.js-class app, against 5.05 MB in the spike** (§3.5) for the same change: with this name hash `typescript` shares its bucket with a large package, so the bucket is about 35 MB. With N=4 a change re-uploads about a quarter of the snapshot in the worst case; more, smaller buckets (a lower target than 64 MB for small trees) would shrink that at the cost of more requests per restore.
- **Memory**: an exact hit peaked at 0.6-1.0 GiB of 12 GiB, below or near plain because nothing was downloaded through npm; saves peak higher (0.9-1.3 GiB: the compressed chunks are held in memory while they upload).

### 10.4 Docker mode (`services:`, `container:`)

First built: the job container got `--container-options "--tmpfs <workspace>/<dir>/node_modules:..."`, so `node_modules` would be a tmpfs inside the act job container itself (not the runner host, not the Docker volume on the container disk) and the restore step would find it already mounted. Superseded by measurement: with a `--tmpfs` at `node_modules` from the start, `actions/checkout` failed (`EBUSY: resource busy or locked, rmdir '/home/runner/work/workspace/node_modules'`: it empties a workspace that is not yet a repository, and cannot remove a mount). So the job container gets `--container-options "--cap-add SYS_ADMIN -v /opt/beanstalk/bin:/opt/beanstalk/bin:ro"` and the restore step, which runs as root in the job container, mounts the tmpfs there after checkout, as on the host. Verified on the stack with a `services: redis` job (image `catthehacker/ubuntu:act-24.04`): the job container's own `/proc/self/mountinfo` showed `/home/runner/work/workspace/node_modules ... - tmpfs tmpfs rw,size=6291456k`, `df` 214 MB used for the 146 MB tree, exact hit restored in 1.46 s, install 0.11 s, job green (wall 72 s, most of it the two image pulls, doc 26 §3). The capability stays inside the job's own microVM, where the job already has root.

### 10.5 What is automatic and what is opt-in

| Workflow says | Here |
|---|---|
| `actions/setup-node` with `cache: npm`, `pnpm` or `yarn` | automatic: restore after that step, save at the end |
| `actions/cache` whose every `path` is `node_modules` (any depth, `**/node_modules` means the root) or a store (`~/.npm`, `~/.pnpm-store`, `~/.local/share/pnpm/store`, `~/.cache/yarn`, `.yarn/cache`) | automatic: replaced by the restore, same `id`, `cache-hit` output; its own key and restore-keys are ignored (the snapshot key is computed) |
| `actions/cache` with any other path | unchanged: still one job only (doc 26 §4) |
| `uses: beanstalk/deps-cache@v1`, `with: working-directory` | opt-in for jobs without either |
| variable `BEANSTALK_DEPS_CACHE=off` | off for the repository or org |
| variable `BEANSTALK_DEPS_SNAPSHOT_MAX` | the snapshot cap |

Not supported: Yarn Plug'n'Play (no `node_modules`), several install directories in one job (the first trigger's directory only), a committed `node_modules` (left alone), `npm ci` jobs gaining from a partial hit (§10.2).

### 10.6 Verification and resources

- `pnpm check` exits 0: Rust unit tests for the plan (setup-node, actions/cache, native step, paths), keys (property test), tree scan (packages, scopes, nested trees, pnpm store, links, `.cache`), chunk plans (property test: every package in exactly one chunk; adding one package changes at most one bucket), deterministic pack and extract; Worker tests on Miniflare for the service (miss, save, exact and partial lookup, chunk read, wrong hash refused and deleted, uncommitted chunks refused, cap refusal, read-only grants, no cross-repository reads, multipart upload) and the grant (only stalk runs save, variable cap and switch, size parsing).
- Stack `ci` (account `2c7358a6…`, every resource named `*-ci`; torn down 2026-10-09 after the production smoke test, §10.7, list in `exp/live-deps-cache/transcript.txt`): Workers `beanstalk-actions-executor-ci`, `beanstalk-gateway-ci`, `beanstalk-web-ci`, `beanstalk-mcp-ci`; D1 `beanstalk-forge-ci`, `beanstalk-identity-ci`; KV `beanstalk-oauth-ci`; R2 `beanstalk-actions-logs-ci`, `beanstalk-media-ci`, `beanstalk-deps-cache-ci`; queue `beanstalk-repo-events-ci`; Artifacts `beanstalk-race-ci`, `beanstalk-repos-ci`; user `depsci1` with repositories `fastify` and `heavy`. `environments/ci/env.jsonc` is the file.
- Executor deploys roll the job containers: three runs measured here ended as "runner lost" when a deploy landed mid-job (doc 26 §3), and for some minutes after a deploy jobs still started on the previous image; the image version in each job's second line tells them apart, and only runs on the intended image are in the tables.

### 10.7 Live on production (2026-10-09)

Production was deployed from `b37fa6b` (executor `61a2c9ec`, gateway `8bd8461c`, mcp `1e559c43`, web `0d1c2bdb`, swarm `d5300dee`, site `54801028`) with the new R2 bucket `beanstalk-deps-cache`. Smoke test on the hosted service: a throwaway passkey account (headless Chrome), a private repository with fastify v5.6.1 (the §10.3 lockfile: 706 packages, 146 MB) and two workflows on the same push, `cached` (checkout, `setup-node` 24 with `cache: npm`, `npm ci`, `npm test` running one test file, 81 tests) and `plain` (the same without `cache:`), pushed as beans with `git push -o wait`. Image `actions-runner-2026-10-09.6`. Transcript and log excerpts: `exp/live-deps-cache/`.

| Run | Restore | Install | Deps ready | Job | Bytes | Peak |
|---|---|---|---|---|---|---|
| 1, first bean: `cached` | 0.55 s (miss) | 84.3 s | 93.4 s | 2 min 8 s | 28.0 MB uploaded in 5 chunks (save 9.1 s: pack 0.5, upload 4.3) | 1,404 MiB |
| 1, `plain` | - | 138.3 s | 146.7 s | 2 min 50 s | - | 1,175 MiB |
| 2, README-only bean: `cached` | **3.29 s (exact)** | **0.83 s** | **8.8 s** | **21 s** | 28.0 MB downloaded, nothing uploaded | 661 MiB |
| 2, `plain` | - | 139.9 s | 145.8 s | 2 min 42 s | - | 1,046 MiB |
| 3, Run workflow of `cached` | **1.04 s (exact)** | **0.79 s** | **7.6 s** | **23 s** | 28.0 MB downloaded (read-only run) | 722 MiB |

- **Pass.** The first run missed and saved; the second (a stalk run with the same lockfile) and a dispatch hit exactly, `npm ci` kept the restored tree, and all 81 tests passed in every run. Objects in R2: 5 chunks and 1 manifest, 28,073,622 bytes, all under `deps/<repository id>/` (manifest scope `main`, the stalk's internal ref name).
- **Plain `npm ci` from the registry was far slower than on the `ci` stack**: 84-140 s here (default npm, with audit and fund) against 6-14 s there (`npm ci --ignore-scripts --no-audit --no-fund`), so on this run the cache saved about 2 min 20 s per job, not the few seconds of §10.3. Investigated in §12: it is npm's audit, which `npm ci` runs by default and which costs about 90 s of CPU on this lockfile; `--no-audit` was the difference. Jobs now run npm with the audit off unless a repository asks for it. The cached path itself matches §10.3: deps ready 7.6-8.8 s against 5.0-7.2 s, lookup 626-850 ms against 593-710 ms. The install step behind the `npm` wrapper took 0.8 s here against 6-19 ms on the stack, which ran `npm ci --ignore-scripts`; this workflow ran plain `npm ci`.
- **Bug: deleting a repository leaves its dependency snapshots in R2.** After the repository was deleted (Settings, then 404), the 6 objects were still in `beanstalk-deps-cache`; the repository's `DepsCacheIndex` would drop them only on its daily sweep after `DEPS_IDLE_DAYS` (7) without a restore, plus a day for unreferenced chunks. Deleted by hand. Fixed in §10.8.

### 10.8 Deleting a repository removes its cache (2026-10-09)

The §10.7 bug, fixed, and the same check for everything else a repository leaves behind.

- **Path.** The gateway's `deleteRepository` and `closeAccount` (which deletes each of the person's repositories) remove the registry rows, close the engine, delete the Artifacts repo, then run `repositoryCleanup` (`packages/gateway/src/repos/repository-cleanup.ts`). Its parts run side by side; a part that fails is logged (`repository cleanup failed; left for expiry or the sweep`, with the part's name) and never fails the delete.
- **Dependency cache.** The executor's new RPC `forgetRepository(repoId)` (on `ActionsExecutor`, over the existing `ACTIONS_EXECUTOR` service binding) asks the repository's `DepsCacheIndex` to `forget`: it empties the snapshot, chunk and family tables, marks the index forgotten, deletes every object under `deps/<repo id>/` (R2 listing pages of 1,000, each page deleted in one call) and answers `{ purged, objectsDeleted }`. Idempotent; an id with `/` or `..` is refused. A forgotten index answers no snapshot to a lookup and refuses a commit, so a job of the deleted repository that is still running cannot write a snapshot; its late chunk uploads (they go straight to R2) are deleted by the forgotten index's alarm a day later, which repeats until a pass finds nothing.
- **When the call never arrives** (executor down, an older executor, R2 failing): the daily sweep finds it. Every repository that uses the cache now has the sweep (a lookup schedules it, not only a commit, so chunks of a save that never committed are swept too); the sweep keeps running while unreferenced young chunks remain (it used to stop with the last snapshot); and before sweeping it asks the gateway's `ActionsJobs.repositoryExists(repoId)` (any registry state). A definite "no" forgets the repository as above; no answer (a standalone stack, an error) deletes nothing.
- **Actions logs** (`beanstalk-actions-logs`, `<owner id>/<repo id>/<run>/<job>/…`): deleted under the current owner's prefix. Logs of runs from before a transfer sit under the earlier owner's id; the bucket's 30-day expiry removes them.
- **Actions and automation schedules.** The repository's `ActionsRepoDO` gets `forget`: its schedules (workflow `schedule:` and automation timers share the table), queued stalk moves and events, run numbers, running-automation rows and its alarm go (doc 25 §7.11: the alarm used to wake every few minutes forever). Usage counters stay (an id is never reused).
- **Rows.** The registry's `remove` batch now also deletes `actions_workflows` (the workflow and automation index), `actions_runs`, `actions_secrets` (encrypted, but no reason to keep), `actions_variables`, `actions_job_tokens` and the repository's rows in `actions_org_entry_repos` (org secrets and variables limited to selected repositories). Org secrets and variables belong to the org and stay.
- **Media** (`repos/<id>/` in `beanstalk-media`): both web paths already prune it (repository Settings, and account deletion for each deleted repository). The gateway has no media binding, so a delete through the gateway RPC from another caller would leave it; there is no such caller today (doc 29 §6).
- **Not covered:** the repository's `ActionsRunDO`s (one per run; no alarms once a run has ended; a run still going at the delete runs to its end, its containers destroyed as usual, but no new runs start) and the engine's objects (closed by `engine.close`, as before).
- **Tests** (Miniflare, real R2 and Durable Objects): executor `test/forget.test.ts` (10: objects and index gone, another repository untouched, idempotent, bad id refused, lookup and commit after forget, late uploads swept then the alarm stops, the sweep forgets a repository the gateway no longer knows, a lookup alone schedules the sweep, a young chunk keeps it going, 1,205 objects across listing pages stop at the prefix); gateway `test/repository-cleanup.test.ts` (6: each part, a throwing or non-purging executor never fails the delete and the rest still runs, the stub executor skipped, 1,003 log objects across pages, a delete through the gateway removes secret and variable rows, logs, an automation schedule row and its alarm, `repositoryExists` before and after).
- **Staging, 2026-10-09** (executor `6fa17456`, gateway `94b56a03`): a throwaway account's repository ran a `cache: npm` job that saved a snapshot (6 objects, 28,073,622 bytes under `deps/<repo id>/`) and had 70 log objects. After Settings → Delete (404), both prefixes held **0 objects** and its `actions_workflows`, `actions_runs` and `actions_job_tokens` rows were gone (`exp/npm-ci-slow/run-cached-and-delete.txt`). The account was then deleted.

## 11. Next

### 11.1 Warm reuse across jobs of one repository (designed, not built)

Coop, 2026-10-09: "reusing the cache across jobs of the same repo vs a fresh container if there was something queued up", and the rule: "check the hash of the lockfile to make sure we are matching it with a container with the same hash that is 'idle' before it shuts down, and we can keep the containers warm for 2 minutes before they shutdown by the sleep timer ... we dont want to assign a new job to a container that needs to rebuild the modules". Billing: "we dont need to bill them we can bake it into our margins".

**Dispatch rule.** When a job ends, its container may go idle for **2 minutes**, tagged with its repository, its trust class and the exact snapshot key its restore step used (lockfile hash plus platform, Node, package-manager version and install flags). A job is placed on an idle container only when the repository, the trust class and the **whole key** match; any difference, or no idle container, means a fresh container that restores from R2. A container whose key differs is never reused (it would rebuild the modules). Idle containers past 2 minutes shut down by the sleep timer as today.

**Isolation.**

- Never across repositories or tenants (the pool is per repository id).
- Trust class: only stalk, dispatch and schedule runs (which already see the repository's secrets) hand a container to each other. A pre-land run's container is always destroyed, never offered to anyone, so nothing a bean that has not landed did (the job has `sudo` in its microVM: a background process, a changed `/etc`, a poisoned `~/.npmrc`) can reach a trusted run.
- Between jobs the runner kills every process left (act's process group and anything else outside the runner's own), unmounts and deletes the workspace and act's per-job directories, deletes the secret and env files and the home directory's dotfiles a job may write (`~/.npmrc`, `~/.gitconfig`, `~/.cache` except act's baked actions), and keeps only the `node_modules` tmpfs, moved to a stable path (`/run/beanstalk-deps/<key>`) and bind-mounted into the next job's workspace by its restore step after checkout. A job that fails is not reused (its state is unknown).
- Billing: the 2 idle minutes are not counted against the repository's 100 minutes; only the time a job runs is billed (Coop's decision above). The public Actions page says so in its limits.

**What has to change** (why it is not in this lane): a container belongs to the Durable Object that started it, and today that object is named by the job id and holds one job. Reuse means the job lands on the idle container's object: an index per repository (the warm pool) from key to object, the job object holding a sequence of job records with `cancelJob` routed through the index, and the runner taking a second job after a reset endpoint (today a second `POST /v1/job` is refused by design). The dispatcher must know the new job's key before it starts: the gateway would read the lockfile at the run's sha when it creates the run and put its hash in the `JobSpec`; Node and package-manager versions come from the same job definition (the pool also keys on workflow path and job name), and the restore step still compares the full key and falls back to a normal restore if it differs. Estimate: two to three days with tests and a stack run.

**Measured estimate of the gain.** A warm hit skips the container start (1.5-2.3 s from `startJob` to a listening runner, doc 26 §1), the restore (1.4-2.6 s fastify, 2.0-3.2 s heavy, §10.3) and the first fetch of actions act does not have baked; checkout and setup-node still run. So time to dependencies ready would be about checkout + setup-node, 3.5-5 s, against 5.3-7.6 s with a fresh container and a restore, and 9.6-17.9 s for a plain `npm ci`: about 2-5 s more per job when jobs of one repository queue behind each other. The cost is up to 2 idle minutes of a standard-4 per warm container, which Coop decided to absorb. Not measured on the stack: nothing of it is built.

### 11.2 Large monorepos

`node_modules` up to 10 GB (the platform monorepo's whole tree, 440k files) extracted costs about 1.06-1.5x in tmpfs (§4.7), so 10.6-15 GB of memory plus the build's own: more than `standard-4`'s 12 GiB. A whole-tree job needs an instance with **at least 24 GiB** (tree up to 15 GB in tmpfs plus 6-8 GB for the build), with `DEPS_TMPFS_MAX_BYTES` set to about 16 GiB for that instance type; Cloudflare's predefined types stop at 12 GiB today, so until a larger type exists such jobs use filtered installs (§4.8). The snapshot cap would need `BEANSTALK_DEPS_SNAPSHOT_MAX` of about 3 GB compressed at the measured 3.7:1. Coop: "we can request more memory in the future if needed to make sure it keeps up with up to 10gb of deps like platform one day".

### 11.3 Not Beanstalk's

Parallel installs (pnpm) and parallel test runners are the application's choice, not Beanstalk's; nothing here changes them.

### 11.4 Left

Save after the result is reported (so first runs and lockfile changes are not slower than plain); partial hits for `npm ci` jobs (needs an `npm install` that keeps the lockfile's versions); several install directories per job; the SquashFS fallback for trees over the tmpfs cap (§4.7, still open decision 3); the general `actions/cache` service for other paths on the same storage; a settings page row for the snapshot cap and the family's refusal (today a variable and the save step's log); plain installs (no cache) with `node_modules` on tmpfs too (§12.4).

## 12. Why plain `npm ci` took 84-140 s on production (2026-10-09)

§10.7's plain `npm ci` of fastify took 84-140 s on production against 6-14 s on the `ci` stack. Measured on `staging` (same account, SIN, `standard-4`): one job ran each variant in turn on the same container, each from an empty `node_modules` and an empty npm cache unless marked warm, the page cache dropped before each; timings from `npm ci --timing --loglevel=http` (npm's phase timers and every fetch) and bash's `time` for CPU. Script, summariser and the job lines: `exp/npm-ci-slow/` (`run-before.txt`: npm's defaults; `run-after.txt`: after the change in §12.4).

### 12.1 Answer

**npm's audit.** `npm ci` runs an audit inside the install unless `--no-audit` (or `audit=false`) is set. The `ci` stack's workflow passed `--no-audit --no-fund`; production's did not (its `.npmrc` already had `ignore-scripts=true`, so install scripts were never the difference). For this lockfile the audit fetches 68 packuments (the `@typescript-eslint/*` ones are about 16 MB each) and checks every advisory against every version. It took **91-97 s of a 95-102 s install, with 89.5 s of user CPU**, on the install's one thread, which also stalls tarball extraction (one tarball "took" 94 s: the time the event loop was busy). Without it the same install takes **8.6-10.3 s**. Not the network, not DNS, not the instance, and the disk only a few seconds.

### 12.2 Numbers (fastify v5.6.1 lockfile, 706 packages)

| Variant | Wall | Audit (`auditReport:init`) | Unpack phase | Notes |
|---|---|---|---|---|
| `npm ci`, npm defaults, disk | 96.9 s; 102.5 s repeated | 93.5 s; 97.1 s | 95.1 s | 706 tarballs, 68 packuments, 1 audit POST (1.3 s) |
| `npm ci`, npm defaults, tmpfs | 97.4 s | 94.1 s | 95.9 s | |
| `npm ci` with `NPM_CONFIG_AUDIT=true`, disk (after run) | 94.8 s | 90.9 s | 92.5 s | CPU user 89.5 s, sys 35.0 s |
| `--no-audit --no-fund`, disk | 10.3 s | - | 9.1 s | tarball fetch p50 3.7 s, max 8.7 s (15 sockets) |
| `--ignore-scripts --no-audit --no-fund` (the `ci` stack's flags), disk | 9.7 s | - | 8.5 s | |
| `--no-audit --no-fund`, tmpfs | 8.6 s | - | 7.5 s | |
| `--prefer-offline`, cold cache, disk | 100.9 s | 96.4 s | 99.4 s | the same fetches as the defaults |
| `--prefer-offline`, warm cache, disk | 48.4 s; 15.2 s (audit on, run 4) | 38.8 s; 7.4 s | 46.8 s; 13.3 s | no fetches |
| `--prefer-offline --no-audit`, warm cache, disk | 15.2 s | - | 13.8 s | a warm cache on this disk reads slower than the network |
| **After §12.4: plain `npm ci`**, disk | **9.6 s**; 13.7 s and 14.4 s inside the harness (cache drop) | - | 12.5 s | CPU user 8.1 s, sys 32.4 s |
| **After §12.4: plain `npm ci`**, tmpfs | **9.0 s** | - | 8.0 s | CPU user 9.1 s, sys 4.9 s |
| After §12.4: the §10.7 `cache: npm` workflow's install on a miss | **9.8 s** (production: 84.3 s) | - | | |

Network from the job container in the same run: DNS for `registry.npmjs.org` 5-9 ms (`getent`, Node's `dns.lookup`; the resolvers are Cloudflare's and Quad9's, over IPv6); registry colo SIN, HTTP/2; the 1.8 MB fastify packument in 47 ms over IPv4 and 44 ms over IPv6, a 4.4 MB tarball in 51-61 ms, the 15.8 MB `typescript` packument in 0.12 s; every one of the lockfile's 729 tarball URLs with `curl`, 16 at a time, in **6.7 s** (p50 0.11 s each).

### 12.3 What each candidate cause came to

- **Flags:** the audit, yes. `--no-fund` only drops a message. `--ignore-scripts` changed nothing here (the repository's `.npmrc` already set it).
- **Registry egress** (DNS, IPv6, region, proxy, rate limiting): no. Lookups take milliseconds, IPv4 and IPv6 are alike, there is no proxy in the path (`enableInternet`, no `HTTP(S)_PROXY`), no 429s, and without the audit npm fetches the whole tree about as fast as `curl` does.
- **CPU or instance type:** only through the audit, which is single-threaded CPU work (the same audit took about 42 s on a laptop). It is cheaper when the packuments are already in npm's cache (7.4-38.8 s), but a job starts with an empty cache, and a warm npm cache on this disk reads slower than the network (15.2 s against 10.3 s).
- **Disk:** a small part. Without the audit, `node_modules` on tmpfs saves 1.7-5.4 s (8.6-9.0 s against 10.3-14.4 s) and most of the system CPU (4.9 s against 32-35 s): about a third of what is left, not the minutes.

### 12.4 What changed (platform side) and the effect

- **Every Actions job gets `NPM_CONFIG_AUDIT=false` and `NPM_CONFIG_FUND=false`** in its environment (`npmDefaults` in `packages/gateway/src/actions/job-spec.ts`) unless the repository or org variable `BEANSTALK_NPM_AUDIT` is `on`. A workflow's own `env:` wins (measured: a step with `NPM_CONFIG_AUDIT: 'true'` ran the audit, 94.8 s), and an explicit `npm audit` step still audits. The environment overrides a project `.npmrc` with `audit=true`; such a repository sets the variable. The install-time audit never changes what is installed and never fails `npm ci`, so the only loss is its "found N vulnerabilities" line. **Effect on staging: plain `npm ci` 96.9-102.5 s → 9.6 s**; the §10.7 `cache: npm` job's install on a miss 84.3 s (production) → 9.8 s. Deployed to staging only (gateway `94b56a03`); production unchanged.
- **Not built:** `node_modules` on tmpfs for plain installs (another 1.7-5.4 s, a third of what is left). The dependency cache already mounts one when a job asks for a cache; doing it for every job needs the runner to mount after checkout (§10.4: a tmpfs present before checkout breaks `actions/checkout`). A registry mirror or a Worker proxy with the Cache API would not help: the registry is already fast from the container, and the cost was CPU.
- **Decision for Coop:** audit off by default (built) or npm's default with the variable to turn it off. GitHub-hosted runners keep npm's default; the audit costs the same CPU there, on a faster core.
