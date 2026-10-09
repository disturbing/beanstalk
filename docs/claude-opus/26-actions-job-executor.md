# 26 · The Actions job executor: one Cloudflare Container per job

Written 2026-10-08 (lane 2 of the Actions MVP, `25` §6.1 M2). Built on `prototype` at `a50b9e8` (lane 1's control plane merged) and the act spike (`exp/actions-spike/README.md`). Decision D6 as Coop changed it: one container per job from day one, its own id, nothing carried over, destroyed at the end, on failure or timeout after the logs are flushed, never reused across repositories or tenants.

## 1. What runs where

```
gateway ActionsRunDO ──startJob(JobSpec)──▶ beanstalk-actions-executor (WorkerEntrypoint, ActionsExecutor)
        ▲                                        │ getByName(jobId)
        │ ActionsJobs sink (report token):       ▼
        │  actionsJobSecrets / Logs / Finished  ActionsJobContainer  (Container DO, one per job id)
        └────────────────────────────────────────│   JobLifecycle: secrets → fresh container → POST /v1/job
                                                  │   → relay batches → result → destroy → verify gone → report
                                                  ▼
                                   packages/actions-runner (Rust, axum) in a standard-4 container
                                   fetch the workflow at the sha → cut it to the one job → act -j <job>
                                   host mode, or Docker mode (inner dockerd) for services:/container:/docker://
                                   batches (≤1/s or 64 KiB, masked) and the result → http://executor.internal
```

- **Why a separate Worker** (`packages/actions-executor`, Worker `beanstalk-actions-executor`), not a class in the gateway: untrusted job I/O and its outbound handler see only this Worker's bindings (no engine, no Artifacts, no D1); the ~400 MB image builds and rolls out on its own cadence (a deploy rolls running containers, see §4), not on every gateway deploy; and `25` §3.1 already put job execution outside the engine's Worker. The two Workers bind each other: the gateway's `ACTIONS_EXECUTOR` (mode `service`, now the default in `wrangler.jsonc`), the executor's `ACTIONS_JOBS` (the gateway's `ActionsJobs` entrypoint).
- **Capacity.** The control plane leases a slot per job from `RunnerCapacity` (`actions:<repo>` owners) before it calls `startJob`. Those leases now count against the Actions class's own `max_instances` (`ACTIONS_MAX_INSTANCES`, 16, equal to the executor's `containers[].max_instances`), with the repository's concurrent-jobs cap and a fair share while another repository waits; they no longer eat the runner pool that races and pre-land checks use (`sandbox-pool.ts` `decideActionsLease`). If Cloudflare still refuses an instance, the job object retries every 10 s for 5 minutes, then reports `infrastructure_failure`.
- **Warm pool: not built.** A job object is named by its job id, so a pre-started container would need an index from job id to object. Measured cold start is 1.5–2.3 s from `startJob` to a listening runner once the image is on the host (§3), which is small next to checkout and setup; a pool would buy little. The design for it, if a pull-bound start shows up in production: `newUniqueId()` objects started blank, an index Durable Object handing each out once and never back.

## 2. The job runner (packages/actions-runner)

One process per container, one job per process (a second `POST /v1/job` is refused, `409 already_used`).

1. **Workflow.** act parses the workflow before any step and the workspace is empty until `actions/checkout`, so the runner shallow-fetches the job's commit (`git fetch --depth=1 <server>/<owner>/<repo> <sha>`, token as an HTTP header through git's environment) and reads the file with `git show`.
2. **One job only.** `act -j` also runs every job the target `needs`. The runner hands act a copy with only the target job, without `needs:`, and with `needs.<job>.outputs.<name>` / `needs.<job>.result` inside expressions (and whole `if:` values) replaced by the finished jobs' values from the spec.
3. **act.** `act <event> -W <job workflow> -j <job> -P <label>=-self-hosted` for `ubuntu-latest`, `ubuntu-24.04`, `ubuntu-22.04` and the spec's image, `--json`, `--no-skip-checkout`, `--action-offline-mode`, `--no-cache-server`, `--env-file` (the `github` context: `GITHUB_REPOSITORY`, `GITHUB_REF`, `SHA_REF`, `GITHUB_SERVER_URL`, `GITHUB_API_URL`, run ids, the spec's `env`, including OIDC variables when the control plane sets them), `--secret-file` (the secrets and `GITHUB_TOKEN`, 0600, deleted when act exits), `--var-file`, `--input-file`, `-e` (the event payload), `--actor`, `--matrix k:v` per leg, `--artifact-server-path` on loopback, and one `--replace-ghe-action-with-github-com` per action the job uses plus the baked ones (act does not split a comma list). act runs with a cleared environment: in host mode steps inherit act's own environment, so a secret there would reach every step.
4. **Docker mode.** A job with `services:`, `container:` or a `docker://` step runs with `-P <label>=catthehacker/ubuntu:act-24.04` against a Docker daemon the runner starts inside the container (`sudo dockerd --group runner`, static Docker 29.8.2). Host mode would skip `services:` silently and pass (spike §2), so such a job never runs on the host.
5. **Log.** act's JSON lines become typed lines (step start and end with result and duration, output, `::group::`, annotations with file and line, `::debug::`, step summaries, act's own messages), each masked before it leaves: every secret and the job token, each line of a multi-line secret (act misses those), their base64 and URL-encoded forms, and `::add-mask::` values from then on. They go out in batches of at most one a second or 64 KiB, an empty one every 15 s as the heartbeat, each retried until the executor acknowledges it. The container keeps nothing it has sent.
6. **Result.** act's verdict, or the stop that cut it short (timeout: `timed_out`; cancel: `cancelled`); step records; job outputs resolved from the `outputs:` templates and the step outputs act printed (an output that would reveal a secret is withheld, as on GitHub); annotations (50 at most) and summaries. The runner enforces the job's timeout itself (SIGTERM to act's process group, SIGKILL after 10 s); the executor's own timer, a minute later, is the backstop.

The image (`packages/actions-runner/Dockerfile`): Ubuntu 24.04 by digest, Node 24 as the system node, Node 20.20.2 and 24.21.0 in the hosted-toolcache layout (`setup-node` finds them: 0.6–1.0 s), git, git-lfs, curl, wget, jq, python3 with pip and venv, build-essential, sudo (the `runner` user, uid 1001, as on GitHub), act 0.2.89, static Docker 29.8.2 with iptables, and `actions/checkout@v4/v5`, `setup-node@v4/v5`, `cache@v4`, `upload-artifact@v4`, `download-artifact@v4`, `setup-python@v5`, `github-script@v7`, `cloudflare/wrangler-action@v3` baked into act's action cache. Every download is pinned by version and SHA-256.

## 3. Staging run (`-staging-act2`, account `2c7358a6…`)

Stack: `beanstalk-gateway-staging-act2` (lane 1's control plane at `a50b9e8`, own D1 `beanstalk-forge-staging-act2` and `beanstalk-identity-staging-act2`, queue, Artifacts namespaces `beanstalk-{race,repos}-staging-act2`, R2 `beanstalk-actions-logs-staging-act2`, `ACTIONS_EXECUTOR_MODE=service`) and `beanstalk-actions-executor-staging-act2` (4 × `standard-4`). Repository `coop-act2/node-ci`: a Node project (`npm ci` installs `is-number`; `npm test` runs `node --test` and a dependency check) with `.github/workflows/ci.yml` (`test`: checkout, setup-node 20, `npm ci`, `npm test`, a `$GITHUB_OUTPUT` output, a step summary; `deploy`: `needs: test`, `if: github.ref == 'refs/heads/main'`, checkout, `npx --yes wrangler@4 --version`, an echo of `needs.test.outputs.node` and a secret) and `.github/workflows/services.yml` (a redis service pinged from the job). Each run started from a real push: `git push -o wait origin HEAD:refs/heads/bean/<name>` → pre-land check green → LANDED → validated, the stalk moved → lane 1's index started the runs → my executor ran each job in its own container.

| Run (stalk sha) | Job | Conclusion | Runner time | Billed | Container up after `startJob` | Container after the job |
|---|---|---|---|---|---|---|
| CI #3 (`3b11615`) | test, deploy | success (run: 50 s from push to completed) | — | 2 min | — | destroyed |
| CI #4 (`90d9ced`) | test | success | 11.8 s | 1 min | 1.7 s | gone (checked) |
| CI #4 | deploy (needs test) | success | 19.4 s | 1 min | 2.3 s | gone (checked) |
| Services #1 (`90d9ced`) | redis (Docker mode) | success, `redis answered: +PONG` | 44.6 s | 1 min | 1.9 s | gone (checked) |

Step times in CI #4 `test`: checkout from the gateway's GitHub-shaped git 1.2 s (3.8 s on a cold run), setup-node 0.6 s (toolcache), `npm ci` 0.7 s, `npm test` 0.2 s; set-up from `startJob` to the first step about 6 s (workflow fetch 1.6 s, act start 1.2 s). `deploy`: `npx --yes wrangler@4 --version` 13.1 s (it downloads wrangler; `wrangler 4.148.0`). Services: dockerd up 2.6 s after the job started; pulling `catthehacker/ubuntu:act-24.04` and `redis:7-alpine` took about 32 s of the 44.6 s.

Logs: every line reached the gateway's sink as numbered batches and is stored as gzip NDJSON chunks under `coop-act2/r_act2_nodeci/<run>/<job>/0000000001.log.gz …` (7 chunks, 122 lines for `test`), read back with `wrangler r2 object get`. Nothing is stored in the job's Durable Object (its record holds the spec, phase, step views and counters) or left in the container (it is destroyed). `deploy` printed `would deploy with v20.20.2`: `needs.test.outputs.node` came through the control plane from the `test` job's container. No repository secret was set on this stack (the control plane sets secrets only through its RPC), so the staging run shows an empty secret; masking was exercised by the local run of the real image (`using ***`) and the tests in §5.

**Containers destroyed.** For every job the object records `containerGone: true` after `destroy()` and a running check, the admin view shows `containerRunning: false`, and the container's `onStop` logged `exit`.

**Against GitHub-hosted.** I did not run this workflow on GitHub (that needs a GitHub repository, an outward step I left to Coop). The comparable measured numbers are the spike's: fastify CI on GitHub-hosted `ubuntu-latest` has a 56 s job median (p10 46, p90 61) with a 37 s suite; on a Cloudflare container the same job took 64–72 s, the suite 37–40 s. Here the whole two-job CI run took 41–50 s from the stalk moving to `completed`, and the per-job overhead before the first step (about 6 s) is in the range of GitHub's own "Set up job" plus runner assignment. The one large cost is Docker mode's image pull (about 30 s per job, every job, because containers are never reused); a smaller job image or a registry mirror would cut it.

**Failures seen and reported, never silent.** (1) A redeploy of the executor rolled its container application while a job ran: the container was replaced mid-job and the watchdog reported `infrastructure_failure: the container stopped before the job reported a result` within 60 s. (2) During the same rollout a job landed on a container still running the previous image (`actions-runner-2026-10-08.2`) and failed at its first action; the image version is now printed in each job's second log line so such skew is visible. Deploys of the executor should wait for idle, or the control plane should retry jobs that end as `infrastructure_failure` before any step with secrets ran (`25` §6.3).

## 4. Compatibility (this executor, observed or by construction)

| Feature | Status | Notes |
|---|---|---|
| `run:` steps (bash, sh, python), `env`, `defaults`, `working-directory`, `if:` | Works | act host mode |
| `actions/checkout` of the job's repository | Works | from `GITHUB_SERVER_URL/<owner>/<repo>` (the gateway's GitHub-shaped git) with the job token; fetch by sha |
| `actions/setup-node` (20, 24) | Works, fast | toolcache baked; other versions download from GitHub (about 10 s) |
| JavaScript and composite actions from github.com | Works | the job's own `uses:` and the baked ones are fetched anonymously from github.com; an action that a composite action uses internally, not named in the workflow and not baked, is fetched from Beanstalk and fails (`repository not found`) |
| `$GITHUB_OUTPUT`, job `outputs:`, `needs.*.outputs`, `needs.*.result` | Works | outputs resolved from `steps.<id>.outputs.<name>` templates; other expressions in `outputs:` are reported unresolved |
| `$GITHUB_STEP_SUMMARY` | Captured | as `##[summary]` lines in the log (the contract has no summary field yet) |
| `::error::`/`::warning::`/`::notice::` annotations, `::group::`, `::add-mask::` | Works | annotations as `##[error]file:line: message` lines; masks applied before lines leave the container |
| Secrets (`secrets.*`), `GITHUB_TOKEN` | Works | fetched once per job from the sink, written to a 0600 file, masked including multi-line and encoded forms |
| `vars.*` | Works | `JobSpec.vars` (org then repository variables, `25` §3.11) to act's `--var-file`; absent from an older gateway, read as none |
| `workflow_dispatch` `inputs.*` | Works | `--input-file` |
| `strategy.matrix` | Works per leg | one container per leg; `--matrix k:v` for scalar values |
| `timeout-minutes` (job), cancel | Works | runner stop (SIGTERM, SIGKILL after 10 s), executor backstop, `timed_out` / `cancelled` |
| `services:`, `container:`, `uses: docker://` | Works in Docker mode | inner dockerd; service ports published to the job's host network; about 30 s of image pull per job |
| `actions/cache` | No-op | the cache server is off (`--no-cache-server`); `actions/cache` warns and continues. Cross-run cache needs our service (`25` A3) |
| `upload-artifact` / `download-artifact` | Within the job only | act's artifact server on loopback; artifacts vanish with the container |
| OIDC (`id-token: write`) | Passed through | when the control plane sets `ACTIONS_ID_TOKEN_REQUEST_URL`/`_TOKEN` in `env`, steps see them; not exercised on staging |
| GitHub REST API via `GITHUB_TOKEN` | No | `GITHUB_API_URL` points at Beanstalk, which serves no REST API yet |
| `ubuntu-22.04` | Runs differently | on the 24.04 image |
| Other `runs-on` labels (macOS, Windows, self-hosted) | No | the control plane refuses them |

## 5. Verification

- `pnpm check` and `pnpm rust:check` exit 0 (outputs saved with the commit's work).
- Rust: 56 unit tests (act's JSON lines from a real run, masking with property tests, the job cut and `needs` substitution with a property test for quoting, outputs, the command line, batching, conclusions) and 7 end-to-end tests over HTTP with a real git repository, a fake act and a fake executor (masked lines, one job only and no secret on act's command line, the secret file removed, a second job refused, Docker mode for `services:`, a missing job, cancel of an act that ignores SIGTERM, timeout).
- TypeScript: 31 tests of the job lifecycle (start with secrets that are never stored, batches relayed once and in order, heartbeats, result with billing, destroy and the gone check, two destroys when the first does not take, timeout, cancel by RPC and by the sink, cancel before start, a container that dies, a lost result recovered from the runner's status, capacity waits and their limit, report retries), the translation to the contract's lines and steps, the contract boundary and the standalone sink; 4 new `RunnerCapacity` tests for Actions leases.
- Local: the real image under Docker on the Mac ran the CI workflow green (29 s under amd64 emulation) and the deploy job (17 s).
- Staging: §3.

## 6. Left for later

A warm pool (§1); Docker mode image pulls (a slimmer job image or a pull-through cache); `vars` and step summaries in the contract; actions used inside composite actions (resolve them in the Worker, `25` §3.6); cross-run cache and artifacts on R2 (the dependency half, `node_modules` restored into tmpfs from chunked R2 snapshots, is designed and measured in `27-ci-dependency-cache.md`); executor deploys that drain running jobs.
