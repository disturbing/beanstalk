# @gitstalk/actions-executor

The Worker `gitstalk-actions-executor` runs GitHub-Actions-compatible jobs, one fresh Cloudflare
Container per job, and serves the CI dependency cache those jobs restore `node_modules` from.
The control plane lives in the gateway (`ActionsRunDO` in `packages/gateway`): it decides which
jobs run and calls this Worker over the gateway's `ACTIONS_EXECUTOR` service binding. Each job
gets its own `ActionsJobContainer` (a Container Durable Object named by the job id), which starts
the Rust job runner in [`container/`](container/README.md), relays its log batches and result
back to the gateway's `ActionsJobs` entrypoint, and destroys the container when the job ends.
It is a separate Worker from the gateway so that untrusted job I/O and the large runner image
never ride the gateway's deploys.

```
gateway (ActionsRunDO) ──RPC startJob / cancelJob / forgetRepository──▶ ActionsExecutorWorker
                                                                            │
                                                         ActionsJobContainer (one per job id)
                                                                            │ POST /v1/job, /v1/cancel
                                                                            ▼
                                                     actions-runner container (act, dockerd)
                                                       │ http://executor.internal   │ http://deps.internal
                                                       ▼                            ▼
              gateway ActionsJobs ◀── secrets, batches, result      DepsCacheIndex DO + R2 (DEPS_CACHE)
```

## Key concepts

- **One container per job.** The job id (a UUID per job and matrix leg) names the Durable
  Object, so a repeated `startJob` answers the same handle and a container never runs a second
  job. `JobLifecycle` (`src/job/lifecycle.ts`) drives launch, a watchdog, the job timeout,
  cancellation, the forced stop and the final report through the object's scheduled tasks.
- **Outbound virtual hosts.** The runner never holds a Cloudflare credential. It posts batches
  and its result to `http://executor.internal`, and the job's cache steps call
  `http://deps.internal`; the container's outbound handlers turn both into RPC on the job's
  own Durable Object. Internet egress stays on (checkout, actions from github.com, package
  installs).
- **Sinks.** With `SINK_MODE=service` secrets come from, and batches and results go to, the
  gateway's `ActionsJobs` entrypoint (authorised by the job's report token). With
  `standalone` (a test stack without the control plane) batches go to the `ACTIONS_LOGS`
  bucket and secrets come from the `STANDALONE_SECRETS` secret.
- **Dependency cache.** `node_modules` snapshots stored as content-addressed chunks in R2,
  indexed per repository by `DepsCacheIndex` (lookups in `actions/cache` restore-keys order,
  a per-repository size cap with least-recently-restored eviction, a daily idle sweep).
  `DepsChunkCache` is a Workers Cache-enabled entrypoint in front of R2. Reads are scoped to
  the job's repository; saves need a saving grant (default-branch pushes only).
- **Forgetting.** When the gateway deletes a repository it calls `forgetRepository`, which
  drops the index and every object under `deps/<repoId>/`. The daily sweep asks the gateway
  (`repositoryExists`) to catch a call that never arrived.

Design and background:

- [25 - Actions and automations](../../docs/claude-opus/25-actions-and-automations.md)
- [26 - Actions job executor](../../docs/claude-opus/26-actions-job-executor.md)
- [27 - CI dependency cache](../../docs/claude-opus/27-ci-dependency-cache.md)
- Public docs: [Actions](../site/public/docs/actions.html) (including the dependency cache
  section)

## Layout

| Path | Contents |
|---|---|
| `src/index.ts` | `WorkerEntrypoint`: the `ActionsExecutor` RPC methods and the Hono app (health, admin routes) |
| `src/contract.ts` | The RPC contract with the gateway: job spec, handles, sink and repository directory types |
| `src/executor.ts` | `startJob` / `cancelJob` over the job objects |
| `src/job/job-container.ts` | `ActionsJobContainer`: the Container DO, its outbound handlers and scheduled tasks |
| `src/job/lifecycle.ts` | The job state machine (launch, watchdog, timeout, cancel, report) |
| `src/job/runner-wire.ts` | The wire contract with the runner (`ACTIONS_RUNNER_API_VERSION`, runner labels) |
| `src/job/translate.ts` | Runner lines and results to the control plane's log lines, steps and conclusion |
| `src/sink/job-sink.ts` | Service and standalone sinks |
| `src/deps/` | Dependency cache: grants (`grant.ts`), the `deps.internal` app (`service.ts`), `DepsCacheIndex` (`index-do.ts`), `DepsChunkCache` (`chunk-cache.ts`), repository purge (`forget.ts`) |
| `src/config.ts`, `src/log.ts` | Vars parsing, admin token, structured JSON logs |
| `test/` | vitest suites on `@cloudflare/vitest-pool-workers` (lifecycle, translation, deps, forget, Worker routes) |
| `container/` | The Rust job runner crate and its Dockerfile ([README](container/README.md)) |

## HTTP surface

| Route | Purpose |
|---|---|
| `GET /healthz` | Liveness |
| `POST /v1/admin/jobs` | Start a job from a job spec (admin) |
| `GET /v1/admin/jobs/:jobId` | A job's record without its spec or tokens (admin) |
| `POST /v1/admin/jobs/:jobId/cancel` | Cancel with `reason` `cancelled` or `timed_out` (admin) |
| `GET /v1/admin/logs?prefix=standalone/...` | Stored batches and result of a standalone job (admin) |

Admin routes need `Authorization: Bearer <ADMIN_TOKEN>`; they answer 503 when the token is
missing or shorter than 32 characters. Production traffic uses the RPC methods, not HTTP.

## Develop

```bash
pnpm -F @gitstalk/actions-executor dev        # wrangler dev (builds the container image with Docker)
pnpm -F @gitstalk/actions-executor test       # vitest
pnpm -F @gitstalk/actions-executor typecheck  # tsc
pnpm -F @gitstalk/actions-executor types      # regenerate worker-configuration.d.ts after a wrangler.jsonc change
cargo test -p actions-runner                  # the container crate
pnpm rust:check                               # fmt, clippy, tests for every crate
```

There is no `.dev.vars.example`. For local admin routes create `.dev.vars` with an
`ADMIN_TOKEN` of at least 32 characters (and `STANDALONE_SECRETS` if you run with
`SINK_MODE=standalone`). Never commit it.

## Configuration

Bindings (`wrangler.jsonc`):

| Binding | Kind | Use |
|---|---|---|
| `ACTIONS_JOBS_DO` | Durable Object (`ActionsJobContainer`, container) | One per job; `standard-4` instances, `max_instances` 16 |
| `DEPS_INDEX` | Durable Object (`DepsCacheIndex`) | One per repository: the snapshot index and sweep |
| `ACTIONS_JOBS` | Service, `gitstalk-gateway` entrypoint `ActionsJobs` | Secrets, log batches, results, `repositoryExists` |
| `ACTIONS_LOGS` | R2 `gitstalk-actions-logs` | Standalone mode only |
| `DEPS_CACHE` | R2 `gitstalk-deps-cache` | Dependency chunks and manifests under `deps/<repoId>/` |

Exports: the default entrypoint, `DepsChunkCache` (Workers Cache enabled), `ActionsJobContainer`,
`DepsCacheIndex`, and `ContainerProxy` (required by `@cloudflare/containers` for outbound
interception).

Vars: `LOG_LEVEL`, `SINK_MODE` (`service` or `standalone`), `ACTIONS_MAX_INSTANCES` (must equal
the container's `max_instances`; the gateway's own cap must not exceed it), `DEPS_CACHE_MODE`
(`on` or `off`), `DEPS_SNAPSHOT_MAX_BYTES`, `DEPS_TMPFS_MAX_BYTES`, `DEPS_REPO_MAX_BYTES`,
`DEPS_IDLE_DAYS`. A repository or organisation variable `GITSTALK_DEPS_SNAPSHOT_MAX` raises or
lowers the snapshot cap per repository, and `GITSTALK_DEPS_CACHE=off` turns the cache off for it
(`BEANSTALK_*` names are accepted as aliases).

Secrets: `ADMIN_TOKEN` (required), `STANDALONE_SECRETS` (standalone mode only).

Deploy through an environment, never with `wrangler deploy` on this template (the package's
`deploy` script deliberately fails):

```bash
pnpm env:provision <env>
pnpm env:secrets <env>
pnpm env:deploy <env> --only actions-executor
```

Deploy it with, or before, a gateway in service mode. See
[30 - Environments](../../docs/claude-opus/30-environments.md).

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md); run `pnpm check` at the root before sending a
change.
