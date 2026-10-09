# Dependency-restore spike (throwaway)

Code and raw data behind `docs/claude-opus/27-ci-dependency-cache.md`. Everything ran on Cloudflare
under the name `beanstalk-deps-spike*` (account `2c7358a6...`) and is torn down.

| Path | What |
|---|---|
| `worker/` | Worker `beanstalk-deps-spike`: container class `DepsBox` (`standard-4`), the `deps.internal` outbound handler, `DepsStore` (R2, R2 multipart, Cache API in front of R2), `WcStore` (Workers Cache in front of R2), bearer-guarded control routes |
| `image/` | Container image: Node 24 on Debian trixie, squashfs-tools, squashfuse, erofs-utils, erofsfuse, fio, fastify v5.6.1 with the arena lockfile, the heavy-app lockfile, a job server (`server.mjs`) |
| `image/tools/` | In-container tools: `probe.sh` (privileges, filesystems), `bigfile.sh`, `smallfiles.py`, `readtree.sh` (disk vs tmpfs), `pack.py` (single / buckets / per-package packing and upload), `restore.py` and `restore-pkg.mjs` (restores with memory sampling), `matrix.sh`, `mount.sh` (SquashFS / EROFS / FUSE probes), `suite.sh` (fastify suite and type checks by placement), `delta.sh`, `delta-synth.sh`, `gensynth.py` |
| `tools/drive.mjs` | Local driver: push tools, run a command in a container and wait, append the result to `results/runs.jsonl` |
| `results/runs.jsonl` | Every recorded run: command, colo, exit code, stdout (the JSON lines quoted in doc 27) |

Driver: `SPIKE_TOKEN_FILE=<file with the bearer token> node tools/drive.mjs run <instance> '<cmd>'`.
The token was a throwaway secret, never committed.
