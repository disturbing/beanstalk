# actions-runner: the Actions job runner container

The Rust crate `actions-runner` builds the process that runs inside every Actions job container
of [`@gitstalk/actions-executor`](../README.md), plus the `gitstalk-deps` tool the dependency
cache steps call. One container runs exactly one job: the executor's `ActionsJobContainer`
Durable Object starts a fresh container, posts the job, and destroys the container when the job
ends. The runner fetches the workflow file at the job's commit, cuts it down to the one job, runs
[act](https://github.com/nektos/act) in host mode, masks secrets, and streams every log line and
the result back out through the container's outbound handler.

```
ActionsJobContainer DO ──POST /v1/job, /v1/cancel, GET /v1/status──▶ actions-runner :8080
                                                                          │ act (host mode)
                                                                          │ dockerd (only when needed)
          ◀── http://executor.internal  POST /v1/batches, /v1/result ─────┘
          ◀── http://deps.internal      gitstalk-deps restore | save (from job steps)
```

Background: [26 - Actions job executor](../../../docs/claude-opus/26-actions-job-executor.md),
[27 - CI dependency cache](../../../docs/claude-opus/27-ci-dependency-cache.md), and the spike
measurements in [exp/actions-spike](../../../docs/claude-opus/exp/actions-spike/README.md).

## How the executor drives it

- **Ports.** The runner listens on `PORT` (8080). The Container DO waits for that port, then
  calls it through `containerFetch`.
- **Endpoints** (`src/app.rs`): `GET /healthz`, `GET /version` (act and image versions),
  `GET /v1/status` (the fallback when the result could not be posted), `POST /v1/job` (the one
  job: spec, secrets, token, dependency cache grant), `POST /v1/cancel` (`cancelled` or
  `timed_out`; SIGTERM to act's process group, SIGKILL after `CANCEL_GRACE_SECONDS`). Every
  response carries the API version header; the wire types are in `src/wire.rs` and must match
  `src/job/runner-wire.ts` in the Worker (bump `API_VERSION` and
  `ACTIONS_RUNNER_API_VERSION` together).
- **Uplink and streaming** (`src/uplink.rs`, `src/stream.rs`): lines leave in batches of at most
  one second or 64 KiB, with an empty heartbeat batch after 15 quiet seconds, posted to
  `EXECUTOR_URL` (`http://executor.internal`). The container's outbound handler turns each post
  into RPC on the job's Durable Object, so nothing leaves Cloudflare's network. Batches and the
  result are retried until acknowledged; a line is kept only until its batch is.
- **Dependency cache.** The runner adds a restore step after checkout and a save step at the
  end when the job uses `actions/setup-node` with `cache:`, an `actions/cache` step on
  `node_modules`, or `uses: gitstalk/deps-cache@v1` (`src/deps/plan.rs`). Those steps run
  `gitstalk-deps restore|save`, which talks to `http://deps.internal` with the job's bearer.
  A cache problem never fails a job.
- **Docker.** Jobs with `services:`, `container:` or Docker actions start an inner `dockerd`
  (via `sudo`) and act runs in Docker mode with the `DOCKER_JOB_IMAGE` job image.

## Image

`Dockerfile` (multi-stage, linux/amd64, `RUST_VERSION` build argument, default 1.96.0):

- Build stages: `rust:<RUST_VERSION>-slim-trixie` with `cargo-chef`, cross-linking to
  `x86_64-unknown-linux-gnu` on non-amd64 build hosts; builds `-p actions-runner` (both
  binaries).
- Runtime: Ubuntu 24.04 pinned by digest, like GitHub's `ubuntu-24.04` runner; a `runner` user
  (uid 1001, passwordless sudo); Node 24 as the system node and Node 20 and 24 in a hosted
  toolcache; git, git-lfs, curl, python3, build tools, jq, zstd; act (pinned version and
  checksum); static Docker; popular actions (`actions/checkout`, `setup-node`, `cache`,
  `upload-artifact`, `download-artifact`, `setup-python`, `github-script`,
  `cloudflare/wrangler-action`) pre-cloned into act's cache.
- `/usr/local/bin/actions-runner` is the entrypoint under `tini`;
  `/opt/gitstalk/bin/gitstalk-deps` and a `zstd` sit in a directory Docker-mode job containers
  mount read-only.
- `IMAGE_VERSION` is a build argument to bump with every change to the Dockerfile or the runner;
  `/version` and each result report it.

The build context is the repository root (the Cargo workspace). Wrangler builds it from the
Worker's `wrangler.jsonc` (`image_build_context: "../.."`); by hand:

```bash
docker buildx build --platform linux/amd64 -f packages/actions-executor/container/Dockerfile .
```

## Configuration

Read once at startup (`src/config.rs`): `PORT`, `WORK_ROOT`, `ACT_BIN`, `EXECUTOR_URL`,
`CANCEL_GRACE_SECONDS`, `ACT_VERSION`, `IMAGE_VERSION`, `DOCKERD`, `DOCKER_BIN`,
`DOCKER_SOCKET`, `DOCKER_JOB_IMAGE`, `RUST_LOG`. The Container DO sets `PORT`, `EXECUTOR_URL`
and `RUST_LOG`; the image sets the rest. Secrets arrive only in the `POST /v1/job` body and are
passed to act through a secret file, never through the environment.

## Layout

| Path | Contents |
|---|---|
| `src/main.rs`, `src/app.rs` | Startup and the axum router |
| `src/job.rs` | One job from start to result |
| `src/workflow.rs` | Cutting the workflow down to one job and inlining `needs` values |
| `src/git.rs` | Shallow fetch of the workflow file at the job's commit |
| `src/act/` | The act command line, files and event parsing |
| `src/outcome.rs`, `src/mask.rs` | Log lines, steps, annotations, summaries; secret masking |
| `src/stream.rs`, `src/uplink.rs`, `src/wire.rs` | Batching, posting, the wire contract |
| `src/docker.rs` | The inner Docker daemon |
| `src/deps/`, `src/bin/gitstalk-deps.rs` | The dependency cache plan, archive, chunking, restore and save |
| `tests/job.rs` | End-to-end tests over HTTP: a real git repository, a fake `act`, a fake executor |

## Develop

```bash
cargo test -p actions-runner   # unit, property and integration tests
pnpm rust:check                # fmt, clippy -D warnings and tests for every crate
```

## Contributing

See [CONTRIBUTING.md](../../../CONTRIBUTING.md); run `pnpm check` at the root before sending a
change.
