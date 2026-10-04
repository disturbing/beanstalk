# The Cloudflare prototype: plan and contracts

**Goal (Coop, 2026-10-03):** finish the whole prototype and confirm it works with 10–20 real agent sessions on colliding tasks.

**Sequence (Coop's decision):**
1. Real-session races on the local harness (`research/race`).
2. The same race against beanstalk running on Cloudflare.

**Done means:**
- `bean race --forge cloudflare --policy <p> --agents 12` runs 12 or more real Claude Code sessions (Sonnet) on the 40 arena tasks.
- Every integration decision is made on Cloudflare: Workers, a Durable Object, Artifacts and a Container.
- The results are comparable, metric for metric, with the local harness runs in `research/race/runs/`.
- A live page shows lanes, the trunk, green, repair tickets and cost while it runs.

This file is the contract that builders work to. Section 6 records the integration policy, chosen from the race results in `08`.

## 1. The split: decisions in the cloud, agents on machines

```
 laptop / remote harness containers                       Cloudflare (account 2c7358a6, names beanstalk-*)
 ┌──────────────────────────────┐   HTTPS (run token)   ┌───────────────────────────────────────────────┐
 │ driver: N agent slots         │ ───── poll ─────────▶ │ beanstalk-gateway  (Worker, Hono)             │
 │  claude -p (Sonnet) per slot  │ ◀── instruction ───── │   ├─ RunDO (SQLite): run state machine,       │
 │  git clone/push via gateway   │ ───── result ───────▶ │   │   policy engine, events, budget            │
 │  (never sees Artifacts token) │                       │   ├─ git proxy /git/... → Artifacts (token     │
 └──────────────────────────────┘                       │   │   swap, push policy: fork-only)            │
                                                          │   ├─ Runner (Container DO) ── HTTP ──┐        │
 browser ─── WebSocket ──────────────────────────────────▶│   └─ live page                        │        │
                                                          └───────────────────────────────────────┼────────┘
                                                            Artifacts namespace beanstalk-race     │
                                                            trunk repo + one fork per task  ◀──────┘ runner:
                                                                                                 git, node, mergiraf
```

- **Agents keep running where they run today:** Claude Code headless, on this laptop for the race, later in remote harness containers (`claude-13` § Remote harness fleet). They receive *instructions* from the RunDO (start task, rework, fix) and report results. They never hold Artifacts tokens: they clone and push through the gateway's git proxy with a short-lived run token.
- **Every decision is made by the RunDO:** placement, landing, conflicts, checks, validation, promotion, tickets and the error budget. The local harness made all of these in Python; this moves them to a Durable Object.
- **Git and the test suite run in one Container image (`runner`).** Artifacts has no server-side merge, so squash-merges, test runs, batch composition and ref updates happen there. The runner gets a per-job Artifacts token from the Worker and holds nothing else.

## 2. Packages (repo standards in `AGENTS.md` and the `beanstalk-packages` skill)

| Package | Kind | Contents |
|---|---|---|
| `packages/runner` | Rust crate (axum, tokio) + Dockerfile (linux/amd64, git, Node 25, Mergiraf binary) | Stateless HTTP API over a bare-repo cache in `/work`: squash, check, compose, update-ref, revert (§3) |
| `packages/gateway` | TypeScript Worker (Hono in a `WorkerEntrypoint`) | REST API, git proxy, `RunDO`, `Runner` Container class, live page |
| `packages/shared-race` | TypeScript library | Event schema, policy types, the task format (`research/arena/tasks/*.json`) |
| `research/race/harness/remote.py` | Python (existing harness) | `RemoteRace`: drives agent slots from RunDO instructions and reuses `agents.py` (Claude adapter, resume, cost) and `prompts.py`, so agent behavior is identical to the local races |

**Why the driver stays in Python:** comparability. The local harness's agent adapter (stream-json parsing, cost accounting, session resume, timeouts) is the measuring instrument. Reusing it means a difference between the local and cloud runs is a forge difference, not a driver difference.

## 3. Runner API (container, port 8080, JSON)

Every request carries `repo` (an Artifacts HTTPS remote) and `token` (an Artifacts token minted by the Worker for this job, TTL ≤ 10 min, never logged). The runner keeps `/work/<repo-hash>.git` as a bare cache and fetches only what the request names.

| Endpoint | Request | Response |
|---|---|---|
| `POST /v1/squash` | `onto` (sha), `change` {repo, token, ref, base}, `message`, `union_paths` | `{result: "clean", sha, files}` or `{result: "conflict", files}`. A clean result is pushed to `refs/beanstalk/candidates/<sha>` on the trunk repo so later steps can address it |
| `POST /v1/check` | `sha`, `cmd` (default `["node","--test"]`), `extra_files`, `latency_seconds` | `{green, tests, failures, failing_tests[{file,name}], failing_files, read_sets{file:[paths]}, stack_files, output_excerpt, suite_seconds}` (same fields as `harness/ci.py`) |
| `POST /v1/compose` | `base`, `items` [{repo, token, ref, base, task}], `union_paths` | Stacked squash commits; `{head, per_item: [{task, result, sha?, files}]}` |
| `POST /v1/update-ref` | `ref`, `new`, `old` | Push with lease; `{ok}` or `{ok: false, actual}` |
| `POST /v1/revert` | `onto`, `commit`, `message` | `{result, sha?, files}` |
| `GET /healthz` | | `{ok, git, node}` |

The image needs Node 25, because the arena runs `.ts` files natively. Tests use `cargo test` with property tests for squash and compose against real git, per `clean-code-rust`.

## 4. Gateway API

**Built and deployed 2026-10-03.** The source of truth is `packages/gateway/README.md` (routes, the end-to-end run, the driver contract); this section only summarizes it.
- **URL:** `https://beanstalk-gateway.devaccounts-1password.workers.dev` (account `2c7358a6`, Artifacts namespace `beanstalk-race`).
- **Repos:** each run has one repo, `race-<run>`, with `refs/heads/sprout` and `refs/heads/stalk`. Each bean is a fork, `race-<run>-<task>`, with branch `task/<id>`.
- **Seeding:** the admin seeds the base with `POST /v1/runs/:run/seed-token`, then pushes to both refs.
- **Driver routes:** `next` (long poll) and `result` / `progress`. The invocation's workspace carries `bean_url`, `repo_url`, `branch`, `head_sha`, an optional `merge {sha, ref}`, `acceptance`, `protect` and `commit_message`.
- **Decision cards:** `POST /v1/runs/:run/decisions/:card {winner}`.
- **Read routes:** the event log (`events.jsonl`, byte-identical to the harness format), `summary.json`, a WebSocket live feed, and a live page at `/runs/:run?key=<view token>`.
- **Git proxy:** `/git/<ns>/<repo>.git/*`. A slot reads the run repo, reads and pushes only its own bean branch, and never sees an Artifacts token.

## 5. RunDO

- **SQLite tables:** `runs`, `tasks`, `slots`, `invocations`, `trunk_commits`, `checks`, `ci_jobs`, `tickets`, `events`.
- **State machine:** one async loop, driven by requests (polls, results) and alarms (CI emulation latency, runner job completion, timeouts).
- **Runner calls** go through the `Runner` Container DO class with `getRandom` over a small pool for checks and validations. The committer uses one named instance, so a single writer holds the bare cache.
- **Policy engines** are TypeScript ports of `research/race/harness/policy_queue.py`, `policy_beanstalk.py` and `policy_beanstalk_preland.py`, behind one interface, so the same race can be run under each.
- **Budget:** the run aborts cleanly at its USD cap, using the drivers' reported cost, as the local harness does.

## 5b. Names and tiers (Coop, 2026-10-03)

| Name | What it is | Harness/internal name | Git ref |
|---|---|---|---|
| **bean** | One agent's change: its workspace (a fork of the stalk or sprout) and the diff it produces | task, fork, worktree | the task's fork branch |
| **sprout** | The staged line. A bean lands here only after its pre-land check passed on the exact merged tree; every landing is an immutable snapshot | trunk / fast trunk | `refs/heads/sprout` |
| **stalk** | The stable line. A sprout snapshot is promoted here only after a verifier passes it; a signed attestation says tested tree = promoted tree | green | `refs/heads/stalk` |

Event types and fields keep the harness names (`land`, `green.promote`, `trunk_idx`) so the analysis tools work on cloud runs. Public routes, refs and UI use bean, sprout and stalk.

## 5c. Promotion to the stalk is a GitHub Action that triggers a verifier agent

Promotion is an ordinary workflow, running in a Container on Beanstalk's Actions-compatible runner (`05-github-actions-on-cloudflare.md`):

```yaml
# .github/workflows/stalk.yml
on:
  push:
    branches: [sprout]          # a new sprout snapshot landed
concurrency: { group: stalk, cancel-in-progress: false }
jobs:
  verify:
    runs-on: beanstalk-linux
    permissions: { contents: read }
    outputs: { verdict: ${{ steps.agent.outputs.verdict }} }
    steps:
      - uses: actions/checkout@v4            # the sprout snapshot, read-only token
      - run: npm ci && npm test              # the full suite (pre-land checks may run affected tests only)
      - id: agent
        uses: beanstalk/verify-agent@v1      # headless Claude Code: preview walk-through, intent vs diff, test-weakening scan
        with: { snapshot: ${{ github.sha }}, since: stalk }
  promote:
    needs: verify
    if: needs.verify.outputs.verdict == 'pass'
    runs-on: beanstalk-linux
    permissions: { stalk: write }           # only this job can move the stalk; the agent never holds this token
    steps:
      - uses: beanstalk/promote@v1          # fast-forward stalk to the verified sprout snapshot + attestation
  reject:
    needs: verify
    if: needs.verify.outputs.verdict == 'fail'
    runs-on: beanstalk-linux
    permissions: { sprout: revert }
    steps:
      - uses: beanstalk/revert-culprit@v1   # revert-first: bisect the snapshot range, revert the culprit bean, re-trigger
```

**Rules:**
- **The verifier only returns a verdict.** It never edits code and never holds a promotion token.
- **One run covers every bean** landed since the last stalk (batch verification). The pre-land checks keep sprout reds rare, so batches seldom need bisecting.
- **The stalk only moves forward.** A rejection reverts the culprit out of the sprout and re-triggers the workflow.
- **Teams own the gate.** They edit this file to change what "stable" means: more tests, a canary, a human approval environment.

## 6. Integration policy for the demo (decided 2026-10-03 from `08` §5)

The prototype ships two policies behind one interface:

**`v2`, the product.** This is `research/race/harness/policy_beanstalk_v2.py` on top of `policy_beanstalk_preland.py` in optimistic mode.
1. **Start order:** tasks start first-in, first-out from the trunk head (no predicted placement). Each task works in its own fork.
2. **Pre-land check in the agent's sandbox.** When a task finishes, the runner squash-merges it onto the trunk head it saw and runs the suite on that tree (`/v1/squash` then `/v1/check`, with a read-only token). The task's runner instance does this, in parallel with every other agent; the committer is not involved.
3. **Optimistic landing,** under the RunDO's single-writer turn. If the trunk hasn't moved, land (`/v1/update-ref` by the committer instance). If it moved, re-squash; land without re-checking when the commits that landed meanwhile share no file with the change; otherwise check again. After 3 re-checks, check inside the turn.
4. **Red pre-land check:** an informed rework by the same agent session. The prompt carries the failing tests plus the intent and diff of at most 2 landed changes that caused them: owners of the failing acceptance tests first, then landed commits since the task's snapshot whose writes intersect the failing tests' read set.
5. **Decision card** after 2 informed reworks fail against the same landed change. Both one-line specs go to a human; the race uses an oracle that answers after 30 s. The loser is declined; no fixer is ever sent.
6. **Asynchronous validation** on the trunk head (2 CI slots, emulated latency), prefix promotion to green. **A red validation reverts the culprit** (revert-first) and drops it. Never fix forward.
7. **Test integrity:** landed acceptance tests are protected. Edits are restored and counted.

**`queue`, the baseline.** A batched, speculative, bisecting merge queue (`policy_queue.py`), so the live demo can race the two policies on the same engine.

**Not built:** module-level placement, the error-budget controller, fix-forward fixers, per-path isolation files (§4.3 of `09`).

## 7. Build order

1. Runner crate with `squash`, `check` and `update-ref`, tested against a local bare repo, then image build (amd64).
2. Gateway skeleton: run creation, trunk import into Artifacts, git proxy, token minting; an e2e test with Miniflare for the routes and a live smoke test against Artifacts.
3. RunDO with the queue policy end to end, driven by the Python `RemoteRace` with **replay agents** (free), so results can be checked against the local harness before spending.
4. Beanstalk and pre-land policies.
5. Live page.
6. Real Sonnet race, 12–16 agents, against the deployed system.

## 8. Cautions

- **Account `2c7358a6` is shared** with other workloads: an Artifacts namespace `workspace` with about 13.8k repos, and other containers. Beanstalk uses its own namespace (`beanstalk-race`) and only `beanstalk-*` names, and never lists, modifies or deletes anything else.
- **Artifacts billing starts around 2026-10-14.** Each race creates about 1 trunk plus 40 forks and a few hundred git operations. Reap forks after each run.
- **Fetch by SHA from Artifacts is unverified.** The runner fetches named refs (fork task branches, `refs/beanstalk/candidates/*`), never bare SHAs.
