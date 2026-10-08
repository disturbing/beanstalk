# Spike: real GitHub Actions workflows on Cloudflare Containers (act in host mode)

2026-10-08, branch off `prototype` at `6d4ffea`. Question: can Beanstalk run unchanged `.github/workflows/*.yml` today, with option "C bootstrapped with A" from `docs/claude-05-github-actions-on-cloudflare.md` §5 (act in host mode inside a container)? Measured, not productised. Code: `research/actions-spike/` (image, throwaway Worker, driver, workflows, probes, raw logs in `out/`).

**Answer: yes for the common shape.** The race's own fastify CI workflow (checkout, setup-node, `npm ci`, the 2,150-test suite) ran green inside a Cloudflare Container with the code checked out from a Beanstalk repository through the live gateway, in 64–72 s per job against GitHub-hosted's 56 s median; the suite step itself took 37–40 s against GitHub's 37 s. Docker-in-Docker works on the default scheduling policy (better than §3 feared), so `services:`, `container:` and Docker actions also ran, through act's docker mode. What is missing is Worker-side: a GitHub-shaped git URL, a job token, event payloads, durable cache/artifacts, OIDC.

## 1. Setup

| Piece | What |
|---|---|
| Image (`research/actions-spike/image/Dockerfile`) | `ubuntu:24.04` + git, curl, python3, jq, zstd, make/g++, tini; Node 24.21.0 as system node; Node 20.20.2 pre-seeded in a hosted-toolcache layout; act 0.2.89; static Docker 29.8.2 (dockerd, containerd, CLI); `actions/{checkout,setup-node,cache,upload-artifact,download-artifact}@v4` pre-cloned (depth 1) into act's action cache; a 120-line Node server (`server.mjs`: `/run` writes the files into a fresh git repo plus the event JSON and streams `act <event> -P ubuntu-latest=-self-hosted -e event.json …`; `/exec` for probes). Runs as root (dockerd needs it). |
| Image size | 366 MB compressed (registry push), ≈1.1 GB unpacked before the pre-baked actions (≈+50 MB) |
| Worker (`research/actions-spike/worker/`) | `beanstalk-actions-spike`: own container class `ActRunner` (own DO namespace, `standard-4` = 4 vCPU / 12 GiB / 20 GB, `max_instances` 3, `sleepAfter` 15 m, internet on), routes `/run`, `/exec`, `/health`, `/stop` behind a bearer token, and a GitHub-shaped git host (`/<owner>/<repo>[.git]/(info/refs|git-upload-pack)` → live gateway `/git/<owner>/<repo>.git/…`, credentials passed through). Account `2c7358a6…`, placed in HKG. |
| Beanstalk repo | `beanstalk-actions-spike/beanstalk-actions-spike-fastify`, opened through the live gateway's admin API with `import_url: https://github.com/fastify/fastify`; a 2 h repo-scoped git token minted with `POST /v1/repos/:engine/git-token`; closed with `delete_repo: true` afterwards. |
| Driver | `run.py` / `spike.sh` / `cases.sh`: sends workflow + event payload + secrets (from a 0600 file, never argv or logs), streams the output, stamps each log line with seconds since the request. |

## 2. Compatibility matrix (observed)

"Host" = `act -P ubuntu-latest=-self-hosted`; "docker" = `act -P ubuntu-latest=node:20-bookworm` against dockerd running inside the same container. Logs in `research/actions-spike/out/`.

| Feature | Result | How / why |
|---|---|---|
| Workflow parse, `on: push` / `pull_request`, event payload from the Worker (`-e`), `github.event.*` expressions | **Works** | `head_commit.message` and custom `github.event.spike.*` fields resolved. `GITHUB_REPOSITORY` comes from the job repo's `origin` remote (we add one), `GITHUB_ACTOR` is `nektos/act` (needs `--actor`). |
| `actions/checkout@v4` of the workflow's own repo | **Works (act shortcut)** | act skips it (6 ms) and uses the uploaded workspace; the MVP must place the commit's tree there (or pass `--no-skip-checkout`). |
| `actions/checkout@v4` of a public github.com repo, no `GITHUB_TOKEN` | **Fails** | `::error::Input required and not supplied: token` (`github.token` is empty). `out/fastify-cold.txt` |
| … with `GITHUB_TOKEN` set to a non-GitHub token | **Fails** | act's own action clone gets `authentication required: Invalid username or token` (`out/fastify-github-badtoken.txt`); with `--action-offline-mode`, checkout's fetch gets 401 and `could not read Username for 'https://github.com'` after 3 retries, 32 s (`out/fastify-github-dummytoken.txt`). github.com checkouts need a real GitHub token. |
| `actions/checkout@v4` from a **Beanstalk repo** with `repository`, `github-server-url`, `token`, `ref: <sha>` | **Works with a URL shim** | checkout builds its remote as `origin(github-server-url) + /<owner>/<repo>`: any path (`/git`) is dropped and there is no `.git`, so git must be served at the root of a host. The gateway serves `/git/<owner>/<repo>.git/…` only, so the spike Worker rewrote. Shallow fetch by SHA (`--depth=1 origin 810e3d5…`) worked through the gateway: 4.2–6.1 s. `out/beanstalk-fastify-3.txt` |
| Defaults-only checkout (`repository` + `ref`, no token/server inputs) via `act --github-instance <host>` and `GITHUB_TOKEN` = the Beanstalk token | **Works with flags** | act sets `GITHUB_SERVER_URL=https://<host>`, `GITHUB_API_URL=https://<host>/api/v3`, `GITHUB_GRAPHQL_URL=https://<host>/api/graphql`. Without `--replace-ghe-action-with-github-com` act clones `actions/checkout` from the Beanstalk host (`repository not found`, `out/default-instance-online.txt`); the flag is a string array (one flag per action; a comma list is not split). With it, act cloned the actions anonymously from github.com (the Beanstalk token did not leak there) and checkout fetched from Beanstalk. `out/default-instance-replace.txt` |
| Same-account `workers.dev` → `workers.dev` fetch | **Fails without a flag** | Cloudflare's 404 "Page not found" (error 1042) until `global_fetch_strictly_public`; the MVP should use a service binding. |
| `actions/setup-node@v4` | **Works** | Version in the toolcache: 0.7 s ("Found in cache", Node 20 pre-seed). Otherwise downloads from `actions/node-versions` on github.com: 9.4–11.2 s. act forces `RUNNER_TOOL_CACHE=~/.cache/act/tool_cache` in host mode (the image symlinks it to `/opt/hostedtoolcache`). |
| `npm ci`, `npm test`-style steps, `npx --yes wrangler@4.147.0 --version` (deploy shape on `push` to `main`) | **Works** | `out/deploy-shape.txt`; no secrets, no deploy. |
| `actions/cache@v4` | **Works within one act run** | act's built-in cache server starts by default (`ACTIONS_CACHE_URL=http://10.0.0.1:<port>/…`): save in job 1, `cache-hit=true` in job 2. It lives inside the container, so nothing survives the instance: cross-run cache needs our service. |
| `actions/upload-artifact@v4` / `download-artifact@v4` | **Fails without flags; works with `--artifact-server-path`** | Without: `::error::Unable to get the ACTIONS_RUNTIME_TOKEN env variable` (`out/cache-artifacts-default.txt`). With `--artifact-server-path /work/artifacts`: upload (v4 protocol, act's emulation) and download in the next job worked; the printed artifact URL is a fake `github.com/…/actions/runs/1/artifacts/<id>`. Same lifetime caveat. `out/cache-artifacts-server.txt` |
| `services:` in host mode | **Silently ignored (false green)** | No redis, no warning, job passed. The compiler must route such jobs to docker mode or refuse them. `out/docker-hostmode.txt` |
| `container:` | **Works** (host and docker mode, with dockerd running) | Job ran in `node:20-alpine`. |
| `uses: docker://…` in host mode | **Fails** | `joining network namespace of container: No such container: act-…` (act expects a job container). |
| `services:` / `container:` / Docker action in **docker mode** (DinD) | **Works** | redis service answered `+PONG` on `127.0.0.1:6379` (job container on host network, service on act's bridge with the published port: GitHub's semantics for non-container jobs); Docker action printed its output. First pull of `node:20-bookworm` ≈34 s. `out/docker-dockermode.txt` |
| Docker-in-Docker (default scheduling policy) | **Works, fully** | `dockerd` 29.8.2 up in 2 s as root (overlayfs, cgroup v2, kernel `6.18.54-cloudflare-microvm`). With `--iptables=false --ip-forward=false`: bridge containers have no egress (DNS fails) but `-p` publishing and `--network=host` work. With default flags: iptables NAT works, `ip_forward` flips to 1, bridge egress and user-defined-network DNS work. `docker build` works, `unshare --user` works, `postgres:16-alpine` ready in 12 s including pull, `catthehacker/ubuntu:act-24.04` (2.3 GB) pulled in 30 s. This settles the §3 conflict for the default policy on 2026-10-08 (`durable_object` policy not tested). `out/dind-*.txt` |
| Step summary, annotations, masks, outputs, matrix, step `timeout-minutes`, `continue-on-error` | **Works** | Summary written to a file (act echoes `Summary - …`); `::error file=a.js,line=3::` and `::warning::` come through as parseable lines; `::add-mask::` gives `***`; `$GITHUB_OUTPUT` works; matrix legs ran in parallel; a 75 s sleep was killed at 60 s. `out/runner-features.txt` |
| OIDC (`id-token: write`) | **Unavailable** | `ACTIONS_ID_TOKEN_REQUEST_URL` unset. |
| `GITHUB_TOKEN`-driven API calls | **Fails** | Empty token, `GITHUB_API_URL=https://api.github.com` → 401. |
| Pre-baked actions + `--action-offline-mode` | **Works** | act uses the image's clones as they are. Without them act full-clones each action per job: checkout 9.2 s, setup-node 43.3 s before the first step (`out/fastify-cold.txt`). |

## 3. Timings

**Container start** (`/health` through the Worker, client in Hong Kong, container in HKG): 30.0 s for the first start after the image was pushed; 12.6, 13.2 and 16.1 s when a host had to pull the image; 2.1, 2.2, 2.4 and 3.3 s when it had it. Warm round trip 0.17–0.56 s. Capacity: a fourth instance over `max_instances` 3 fails with `Failed to start container: Maximum number of running container instances exceeded` (a Worker exception unless caught).

**fastify CI job** (`pull_request` event, code from the Beanstalk repo at the arena base `810e3d5`, Node 25.8.1, the GitHub arm's install and suite commands; act step times in seconds):

| Run | Checkout | setup-node | `npm ci` | Suite | Job (act wall) |
|---|---|---|---|---|---|
| New instance (cold start 3.3 s), empty toolcache | 5.3 | 9.4 | 14.5 | 40.4 | 71.9 (75.2 at the client) |
| Warm container, empty toolcache | 6.1 | 9.7 | 9.4 | 37.0 | 64.0 |
| Warm, Node cached | 4.8 | 0.8 | 19.2 | 39.4 | 66.0 |
| Warm, Node cached | 4.2 | 0.7 | 18.3 | 39.8 | 64.9 |
| **GitHub-hosted** `ubuntu-latest`, 782 jobs from the 2026-10-07 load-generator races (`research/race/runs/lg-fastify-*-github`) | | | | **37 median** | **56 median** (p10 46, p90 61) |

All four Beanstalk-side runs were green (2,150 tests passed with the dot reporter, 0 failed). The suite runs at GitHub's speed on `standard-4`; the 8–16 s gap is checkout from Beanstalk (≈5 s, through the gateway and Artifacts) and `npm ci` (9–19 s, slower on re-runs on the same instance). Pre-seeding the arena's Node and an npm cache in the image would close most of it; GitHub's number also excludes its queue time, ours excludes nothing but the client's request.

**Logs.** stdout/stderr leave the container as a chunked HTTP response and pass through the Container DO and the Worker untouched: first byte 0.6–1.5 s on a warm instance, and 67 MB of output went through in 2.5 s with no buffering in the DO. Granularity is whatever the step process flushes (node's dot reporter arrives in bursts). For the web, the job DO should tee the stream into chunked SQLite rows or R2 parts and fan out over a hibernating WebSocket; nothing about the transport needs to change.

**Rollout hazard.** A Worker redeploy with an unchanged image still rolled the container application (`rollout_active_grace_period` 0) and killed a job 29 s into its suite; the stream simply ended with no exit trailer. The job DO must treat a stream without a trailer as an infrastructure failure and retry, and deploys need a grace period.

## 4. What the Worker side needs first (ordered)

1. **A GitHub-shaped git host**: smart HTTP at `https://<host>/<owner>/<repo>[.git]/(info/refs|git-upload-pack)` at the root of a host (e.g. a `git.` host on the gateway, or a route on the gateway root), accepting `basic x-access-token:<token>` (checkout's extraheader). Then `act --github-instance <host>` plus a job token as `GITHUB_TOKEN` makes unmodified `actions/checkout` work.
2. **A job-scoped `GITHUB_TOKEN` equivalent**: a short-lived `repo:read` git token per job (the existing `gitToken` mint), injected as a secret; never sent to github.com (act only uses it against `--github-instance`, as observed).
3. **Event payloads**: `push` / `pull_request` / `merge_group` JSON built from bean and landing events, plus `origin` (→ `GITHUB_REPOSITORY`), `--actor`, and the commit's tree written as the workspace.
4. **A job Durable Object**: owns the container, streams and stores logs, parses `::error`/`::warning`, collects the step summary file, enforces job `timeout-minutes`, retries on a trailer-less stream (rollouts), backs off on capacity errors.
5. **Action supply**: pre-bake the popular actions and run `--action-offline-mode`; anything else is cloned anonymously from github.com via `--replace-ghe-action-with-github-com` (one flag per action) or from our own mirror.
6. **Durable cache and artifacts**: act's in-container servers already satisfy the protocol within a run; for cross-run cache point `ACTIONS_CACHE_URL` (act `--cache-server-external-url`) at a Worker service backed by R2, and move artifacts to R2.
7. **Later**: OIDC issuer, a `GITHUB_API_URL` subset, github.com checkouts of other repositories (needs a GitHub token per job).

## 5. Recommended executor path for the MVP

**Option A now: act in a container, per job, behind a job DO**, with the image from this spike (Ubuntu + Node + act + static Docker + pre-baked actions, `standard-4`). Run host mode by default (`-P ubuntu-latest=-self-hosted --action-offline-mode --github-instance <beanstalk git host> --artifact-server-path …`). When the workflow compiler sees `services:`, `container:` or a `docker://`/Dockerfile action, start `dockerd` (default flags) and run that job in docker mode against a pre-pulled slim runner image; never let host mode silently skip `services:`. Build the Worker-side items in §4 in order; they are the same work Option C needs, so moving the in-container executor from act to a native step runner later (for annotations, summaries and permissions under our control) does not throw any of it away. Option B (the official runner protocol) stays off the table for the competition.

## 6. Resources and teardown

Created and removed (all named `beanstalk-actions-spike*`):

| Resource | Removed |
|---|---|
| Worker `beanstalk-actions-spike` (account `2c7358a6…`), its `ActRunner` DO namespace and `SPIKE_TOKEN` secret | `wrangler delete` (the URL now answers 404) |
| Container application `beanstalk-actions-spike-actrunner` (`a036320a-…`) | `wrangler containers delete` |
| Registry images `beanstalk-actions-spike-actrunner:35bd4829`, `:aeffd7ed` | `wrangler containers images delete` |
| Beanstalk engine `r5a958177e466cd4c05a` and Artifacts repo `beanstalk-actions-spike-fastify` (namespace `beanstalk-repos`) | `POST /v1/repos/:engine/close {delete_repo: true}`; a fetch with its token afterwards answers `could not open the repo` |
| Its git token (2 h TTL) | expires 2026-10-08T05:59Z; the repo it opened is gone |
| Local image `beanstalk-actions-spike:local`, container `spike-local`, scratch secret files | deleted |

The live gateway, web and MCP Workers were not deployed or modified; the gateway was only called through its public git endpoint and admin API. No secret appears in the code, the logs or this document.
