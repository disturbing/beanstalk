# The cloud agent swarm: Beanstalk against GitHub's merge queue, on real tasks

Written 2026-10-06 for Coop, from the `prototype` branch. **Design only: nothing here is built, created, logged into or paid for.** *Update 2026-10-07:* the GitHub arm is built in its laptop form (§6's first cut line: local agents, a polling driver instead of the App and webhooks): `research/race/GITHUB.md`, `race.py --forge github`, `pair.py`, with race repos in the `kintohubtest` org. Its measured GitHub behaviour is recorded there. Names as before: a **bean** is one agent's change, the **sprout** is the staged line, the **stalk** is the stable line.

Inputs: `AGENTS.md`, `README.md`, this folder's `11` (how races are measured), `16` (product plan, §3.5 BYOA and D8), `exp/e2-real-arena.md` (the one real-repo race so far), `research/race/REMOTE.md`, `harness/remote.py`, `harness/agents.py` (the Codex adapter), `harness/policy_queue.py`, `kth_green.py`, `packages/gateway/README.md` (driver contract), `packages/mcp/README.md`, `docs/claude-06-identity-mcp-and-previews.md`. Web research on 2026-10-06; every external claim cites its source and date, and "unverified" marks what the sources did not settle.

**The question.** Today's headline (with 12 and 30 agents on 40 colliding tasks, Beanstalk reaches its 35th green 2–2.6x sooner than our batched queue; README and `11` have the per-seed numbers) carries three caveats a judge will raise: a synthetic arena we wrote, a merge queue we wrote, and agents on a laptop. This design removes all three. The same Codex agents, in the same Cloudflare sandboxes, work the same real tasks on two forges at once: a real GitHub repository with GitHub's own merge queue and Actions, and a Beanstalk repository. Only the forge differs.

---

## Contents

0. The recommendation in one screen
1. Fairness first
2. Task source: a real repo
3. Components
4. Codex: subscription or key
5. Measurements and reporting
6. Phases to 2026-10-14
7. Open decisions for Coop
8. Risks
- Appendix A: research notes with sources
- Appendix B: event mapping for the GitHub arm

---

## 0. The recommendation in one screen

```
                        ┌──────────── beanstalk-swarm (Worker, new; research tooling) ─────────────┐
 Coop ── wrangler / ──▶ │ MatchDO (one per paired race): config, seed, task order, clock, quota    │
 race CLI               │   governor, spend caps, halt                                              │
                        │ BrokerDO: OpenAI key(s), GitHub App key, gateway admin token (Secrets    │
                        │   Store); mints per-invocation scoped tokens; never returns them to a     │
                        │   container                                                               │
                        │ GitHubArmDO: the GitHub arm's controller (same driver contract as the     │
                        │   gateway's RunDO), webhooks in, PRs and enqueue out                      │
                        │ AgentSandbox DO + container × N per arm (one image, one Codex version)   │
                        │   outboundByHost: model.internal → AI Gateway → OpenAI (key injected)     │
                        │                   gh.internal    → github.com (installation token)        │
                        │                   bs.internal    → beanstalk-gateway git proxy (slot tok) │
                        │                   control.internal → MatchDO (next / result / progress)  │
                        │                   everything else denied                                  │
                        └──────────┬──────────────────────────────┬────────────────────────────────┘
                     arm G         │                              │        arm B
        ┌──────────────────────────▼─────────┐     ┌──────────────▼───────────────────────────────┐
        │ GitHub org (free), public repo     │     │ beanstalk-gateway (deployed today)           │
        │ ruleset: merge queue, ALLGREEN,    │     │ RunDO engine (demo preset), git proxy,       │
        │ build concurrency K, squash        │     │ runner containers (pre-land + validation)    │
        │ Actions: pull_request + merge_group│     │ CI slots K, same suite command, same size    │
        │ GitHub App: PRs, enqueue, webhooks │     │                                              │
        └────────────────────────────────────┘     └──────────────────────────────────────────────┘
                     │ events.jsonl (harness schema)                │ events.jsonl (harness schema)
                     └───────────────▶ kth_green.py, summary.py, report.py (unchanged) ◀───────────┘
```

- **One agent runtime for both arms.** Each agent is a Cloudflare container running `codex exec --json` under the same in-container driver that `remote.py` is today (prepare, merge, run the agent, restore tests, commit, push, post). The driver asks a controller for work through the gateway's existing driver contract. Arm B's controller is the gateway's RunDO, unchanged. Arm G's controller is a new `GitHubArmDO` that speaks the same contract and turns GitHub's events into invocations. So the driver, the prompts and the agent are byte-identical, and the forge is the only variable.
- **Agents hold no secrets at all.** That's stronger than "short-lived tokens". Containers reach the model, GitHub and the gateway only through virtual hosts that a Worker-side outbound handler serves. The handler adds the credential for that container's current invocation and refuses everything else. Cloudflare documents this pattern for containers ([Sandbox outbound traffic](https://developers.cloudflare.com/sandbox/sdk/guides/outbound-traffic/), accessed 2026-10-06).
- **Codex on an API key, not the ChatGPT subscription,** for the measured races (§4). OpenAI's Codex docs say one ChatGPT login must not be shared across concurrent jobs or machines. Refresh tokens rotate on use, so copies log each other out. The docs also call an API key "the right way to authenticate automation". The subscription's 5-hour allowance couldn't feed 2 × 30 agents anyway. An optional subscription mode for the 4-agent smoke race leases one seat to one container at a time.
- **Real tasks:** the next 40–60 merged PRs of a permissive, fast-testing, high-contention repository at an old commit, built by the E2 tooling (`research/exp/e2-real-arena/real-arena/`). That tooling is generalised and its contention-preserving chain build is turned on (§2).
- **Both arms run at the same time,** each on its own OpenAI project with an equal rate limit. Seeds are paired, and the arm order of setup steps alternates between seeds.
- **Phases:** a free replay race on both arms (10-08), a 4–8-agent Codex smoke race (10-09), then 12 agents × 3 seeds and 30 agents × 1–2 seeds (10-10 to 10-12), and the write-up on 10-13. Build effort is about 6–7 agent-days. Cut lines are in §6.

---

## 1. Fairness first

The claim we want is "on the same agents, tasks and CI capacity, Beanstalk ships N sooner than GitHub". A judge will look for any lever we held on one side only. Each lever below is either held equal or reported.

### 1.1 Identical agent runtime (enforced, recorded in `config.json` of both arms)

| Lever | How it is held equal | Recorded as |
|---|---|---|
| Container image | One image `beanstalk-swarm-agent@sha256:<digest>` for both arms; digest-pinned (required by `durable_object` scheduling anyway, [image management](https://developers.cloudflare.com/containers/platform-details/image-management/), accessed 2026-10-06) | `agent.image_digest` |
| Instance type | Same type for every agent: `standard-3` (2 vCPU, 8 GiB), or the custom-type maximum (4 vCPU, 12 GiB) if the repo's suite needs it ([limits](https://developers.cloudflare.com/containers/platform-details/limits/), accessed 2026-10-06) | `agent.instance_type` |
| Codex CLI | One pinned version baked into the image (latest stable 0.160.1 on 2026-10-05, [releases](https://github.com/openai/codex/releases)); auto-update off | `agent.codex_version` from `codex --version` at start |
| Model and effort | One model id and `model_reasoning_effort` per match. The harness passes both explicitly (`agents.py` `CodexAdapter`), so a server-side default change can't split the arms | `model`, `effort` in every `invocation.start` |
| Flags and tools | Today's Codex argv: `--ignore-user-config --ignore-rules -s workspace-write`, network off for agent commands, plugins/apps/browser/multi-agent/memories disabled. No MCP in the primary comparison (§1.5) | `agent.argv` hash |
| Prompts | The harness's `prompts.py`, word for word: `initial`, `rework_conflict`, `rework_red`. Arm G's controller renders the same templates. Today the target name is `main` for the queue and `trunk` for v2; both arms keep exactly what today's measured races used | prompt text in `work/…/<inv>.prompt.txt` |
| Task order | One `tasks.json` with one order; both arms see all tasks at t = 0 | `arena_digest` |
| Concurrency | N agent containers per arm, started together; slots are stateless (below) | `agents` |
| Limits per invocation | `max_turns`, `timeout_seconds`, `budget_cap_usd`, `max_rework` 3: one `RaceConfig` for both | `config` |
| Resume policy | Both arms start a rework as a fresh `codex exec` with the task restated, as the Codex adapter does today (E7). This keeps slots stateless. Resuming through `codex exec resume` with rollouts saved in R2 is a later option, for both arms or neither | `resume: false` |
| Test protection | The driver restores acceptance and landed tests before every commit (`restore_acceptance`, `protect_landed`) in both arms; tamper is logged | `acceptance.restored`, `tamper` |

**Stateless slots.** After every invocation the driver commits and pushes the bean, so a rework can run on any free container. It starts from a fresh partial clone of the bean branch plus the merge it was handed. Clone and fetch time is forge latency (Artifacts through the gateway vs github.com). It counts against each forge as it happens, and is logged per invocation (`driver.prepare_ms`).

**Same driver code.** The driver runs inside the image as `python3 -m harness.remote --slot-mode` (a new single-slot entry point; the invocation path in `remote.py` is already per-slot). Arm G's controller implements the gateway's `next` / `result` / `progress` routes and invocation JSON (`packages/gateway/README.md`, "Driver contract"). The driver can't tell which forge it serves, except through the workspace URLs it is handed.

### 1.2 Matched CI capacity

What corresponds to what:

| GitHub arm | Beanstalk arm | Matched how |
|---|---|---|
| PR check: the suite on every push, `pull_request` event | Pre-land check: the suite on the bean merged onto the sprout, in the runner | Same suite command, same machine size, unbounded by slots (one per push) |
| Merge-group build: the suite on main + entries ahead, `merge_group` event | Validation of the sprout head (and bisect probes) | **K = merge queue "build concurrency" (`max_entries_to_build`) = gateway `ci_slots`** |
| Concurrent Actions jobs cap (Free plan: 20, [Actions limits](https://docs.github.com/en/actions/reference/limits), accessed 2026-10-06) | Runner container cap | **C = 20 on both**: gateway `max_instances` for the runner set to 20 for the match (48 today) |
| `ubuntu-latest` on a public repo: 4 vCPU, 16 GB ([hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), accessed 2026-10-06) | Runner instance `standard-4` (4 vCPU, 12 GiB) or custom 4 vCPU / 12 GiB | Same vCPU count; memory differs (16 vs 12) and is reported |
| Emulated CI time (`ci_seconds`) | `ci_seconds: 0` | **No emulated padding in either arm**: real suite time only |

**How we verify the match (before and during every race):**

1. **Calibration, before the first race.** Run the base commit's suite 20 times on each side: Actions via `workflow_dispatch`, the runner via the gateway's suite job. Compare the median and p90 wall time. If the medians differ by more than 15%, the slower side is the forge's real cost and we report it. We don't pad the faster side, because padding is the "emulated CI" caveat we are removing. `calibration.json` sits next to the runs.
2. **In-race telemetry.** Arm G logs `ci.start` / `ci.end` from `workflow_job` webhooks (queued, in progress, completed). Arm B logs them from the runner. The report shows, per arm, the maximum concurrent suites (must be ≤ C), suite duration distributions, and runner pickup latency (`queued → in_progress` on GitHub, container start on Cloudflare). Pickup latency is forge overhead and stays in the time metrics.
3. **Option for a tighter match (decision 7):** GitHub self-hosted ephemeral runners on Cloudflare containers of the exact runner instance type. They would register just in time from `workflow_job.queued` via the JIT-config API, giving identical hardware on both sides. That costs about 1 agent-day, and a judge may call it "not real GitHub CI". Recommended only if calibration shows a gap above 25%.

### 1.3 Simultaneous arms and shared quota

- **Run both arms at the same time.** Then both arms see the same model latency, the same OpenAI load and the same time of day. Sequential arms inherit whatever OpenAI's latency did in between, and E7 showed seeds already swing a lot.
- **Isolate quota per arm.** With API keys: one OpenAI project per arm (`swarm-g`, `swarm-b`), each with the same project rate limit and budget, so one arm can't spend the other's tokens per minute. *Unverified:* that project-level rate limits can be set below the org tier for the chosen model, so check in the console before Phase 3. The AI Gateway in front adds per-arm request logs and a hard per-arm spend view.
- **Quota governor in MatchDO.** Each `turn.completed` carries token usage, and the driver posts it in `progress`. Two triggers matter:
  - When either arm sees a provider 429 or "usage limit" error, the governor **freezes new invocations in both arms** and logs `match.freeze`. That is the existing infra-failure path: back off, and stop after 5 minutes of outage.
  - A freeze longer than 60 s **voids the pair**. It is re-run, not reported, because a stall corrupts every time metric. Arm G's CI and queue keep moving during a freeze, which is why we void rather than pause.
- **Sequential fallback** (only if decision 6 picks it): alternate which arm goes first per seed (s7: G then B, s11: B then G, …). Run both inside one quota window, and run a fixed 3-task "latency probe" before each arm to record model latency.

### 1.4 What is deliberately not equal (and said so in the write-up)

- **The forge's own features are the treatment.** Beanstalk's engine (pre-land on the exact tree, sprout window, informed repair, revert-first, cards with the `landed` oracle, structural merge, dependency-aware starts under the `demo` preset) is what we're measuring. GitHub gets GitHub's queue as GitHub ships it.
- **GitHub gets an automatic rework loop it doesn't have.** On a kick-out, Arm G's controller merges main into the PR branch and resumes work exactly as our queue baseline does (`policy_queue.py` `eject` → `rework_flow`). A conflict with a queue-mate but not with main is re-queued with no agent. Real teams do this by hand or with bots. Automating it is generous to GitHub, which is the right direction for a fair claim.
- **Task starts.** The primary comparison runs Beanstalk's `demo` preset with dependency-aware starts, because that is the product. One robustness seed uses `start_order: fifo` so a judge can see how much of the gap is scheduling (decision 9).

### 1.5 MCP and forge tools

The primary comparison gives agents no forge tools. They edit files and run tests, and the driver does all git and forge work. That isolates integration mechanics. A secondary "product vs product" variant gives each arm its own forge's MCP: `beanstalk-mcp` with a one-hour contributor token on arm B, and GitHub's official MCP server, read-only toolsets, on arm G. Both are injected through the same `config.toml` `mcp_servers` mechanism ([Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), accessed 2026-10-06), with the bearer token added by the outbound handler, not by an env var. That variant is post-deadline unless Phase 4 finishes early.

---

## 2. Task source: a real repo

### 2.1 What E2 already taught us (do not repeat it)

E2 built 24 tasks from markedjs/marked with the tooling in `research/exp/e2-real-arena/real-arena/` (`survey.py`, `fetch_prs.py`, `build.py`, `build_chain.py`, `extract_tests.mjs`, `materialize.py`). Two lessons shape this design:

1. **Re-basing a window onto one common base removes the real contention.** 37% of marked's changes built on an earlier change in the window. They were exactly the ones that didn't apply to the base, so they dropped out, and the remaining pairs never conflicted (0 of 276). The queue had nothing to pay for and won 4.3–4.7x. So use the **chain build** (`build_chain.py`): each task's acceptance tests and reference solution are taken against its own upstream parent, validated in history order, and raced from the common base. A dependent task then has to do or meet its prerequisite's part, as real concurrent work does. Report the contention profile (pairs sharing a file, textual conflicts, semantic breaks, dependent share) next to every result, and pick a repo where it is high.
2. **PR descriptions often contain the fix.** Agents finished marked's tasks in about 25 s, so CI and integration dominated. That's fine for a forge benchmark, but the write-up must say how long tasks are (median agent minutes per first attempt).

### 2.2 Selection criteria

| Criterion | Threshold | Why |
|---|---|---|
| Licence | MIT, Apache-2.0 or BSD | We publish a copy of the repo at the base commit as a public GitHub repo (merge queue needs one) |
| Suite | Full suite ≤ 90 s on 4 vCPU; no services, network or browser | Two suites per bean on GitHub (PR + group), plus validations and bisects; CI time dominates the race |
| Qualifying PRs | ≥ 50 squash-merged PRs that change source **and** tests, within ≤ 8 weeks, ≥ 10 authors | Enough tasks after exclusions; a short window keeps the base realistic |
| Contention | Line overlap (changes touching lines an earlier task in the window last wrote) ≥ 10 of 40; reported as the pairs sharing a file, textual conflicts and semantic breaks of the chain-built arena | Otherwise the comparison is E2 again |
| Toolchain | Node (harness and arena tooling are Node-first), or Python/Go with a one-line test command | The driver's suite and test-file extraction are written for Node today |
| Agent difficulty | A solo Codex agent solves ≥ 80% of tasks from the description plus given tests (§2.4 pilot) | Tasks a single agent can't do measure the model, not the forge |

### 2.3 Candidates

Surveyed 2026-10-06 over 37 repositories (treeless clones, windows of 40 qualifying changes; scripts and per-repo output in the session scratchpad, to be moved into `research/arena-from-repo/` in Phase 0).

**The finding that matters most:** re-basing a window onto a common base shows **0 pairwise conflicts on every repo checked**, not just on marked. That held for marked, fastify, h3, starlette and both MCP SDKs. A later change that overlaps an earlier one was written on top of it, so it fails to apply to the old base and is dropped, and the conflict goes with it. E2's "calm repo" was mostly the method. The real contention measure is **line overlap**: the number of changes whose touched lines (±1) were last written by an earlier task in the window, from `git blame`. By that measure most active multi-author repos sit at 25–50%, marked included (11–17 of 40). **The chain build is therefore required, whatever the repo.**

| Repo | Licence | Span of 40 changes | Authors (top author's share of 40) | Line overlap /40 | Don't apply to base /40 | PR number in subject | Suite |
|---|---|---|---|---|---|---|---|
| **fastify/fastify** | MIT | 3–8 months | 18–24 (10–11) | 10–18 | 14–23 | 33–39 | **12 s** locally, about 2,350 tests, no services |
| **unjs/h3** | MIT | **2–6 weeks** | 8–14 (18–26) | **15–20** | 19–22 | 18–33 | **8 s** locally, about 2,990 tests (vitest) |
| modelcontextprotocol/typescript-sdk | MIT → Apache-2.0 (mixed) | about 2 months | 17–24 (15–17) | 12–16 | 13–23 | 40 | large; e2e/conformance packages to exclude; not timed |
| encode/starlette (Python) | BSD-3 | 2–12 months | 13–24 (12–28) | 11–19 | 14–23 | 38–40 | fast pytest (estimated) |
| colinhacks/zod | MIT | 1–2 weeks | 4–14 (22–37) | 13–23 | – | 36–38 | heavy (E2) |
| markedjs/marked (E2, reference) | MIT | 2–9 months | 19–23 (6–13) | 11–17 | 11–18 | most | fast |

Ruled out: hono, svelte, vue, vitest, typescript-eslint, sqlfluff, es-toolkit and valibot had low overlap (3–8 of 40). cobra, commander, zustand and ky took years per window or were dominated by a single author. ruff and the Rust repos have slow builds. click, rich and similar repos had a single author, merge-commit history or too few qualifying changes.

**Ranking.**
1. **fastify/fastify.** Plain Node, a real community (no author above about 11 of 40), squash PRs with numbers and descriptions, and a 12 s suite with no network. Overlap concentrates in `lib/reply.js`, `fastify.js`, `lib/route.js` and `lib/validation.js`. Risks: a window spans 3+ months, and the v6-alpha and "Merge commit from fork" security commits must be filtered.
2. **unjs/h3.** The highest overlap in the shortest window, and the fastest suite. Risks: the maintainer pushes many commits straight to main, so only 18–33 of 40 have a PR description to prompt with; v2 release-candidate churn; Node ^24 only.
3. **modelcontextprotocol/typescript-sdk.** Many authors, 2 months. Risks: the licence is mid-transition, 15 of the recent 40 PRs are by a bot, and the suite is big.
4. **encode/starlette** if a Python arena is acceptable (the harness would need a pytest junit path).
5. **marked** again, rebuilt with the chain build, as a control that connects to E2.

### 2.4 Producing the arena automatically: `arena-from-repo`

One command, generalised from E2's scripts (they hard-code marked's paths and test layout):

```
python3 research/arena-from-repo/build.py --repo <owner/name> --base <sha> --tasks 60 \
  --test-cmd "<suite command>" --out research/arenas/<name>-<base8>
```

1. **Window:** first-parent commits after `--base`. Keep squash-merged PRs that touch source and tests (`survey.py` classifier, per-language regexes), and drop bots, release commits and docs.
2. **PR text:** `fetch_prs.py`, read-only `gh api`. The prompt is the title plus the description, with template comments and checklists stripped; the linked issue is the fallback.
3. **Chain build:** `build_chain.py`. Each change is validated in history order: its tests fail before it and the whole suite passes after it, against its own upstream parent. Acceptance tests become task-owned files (`extract_tests.mjs` splits cases out of shared test files). The reference solution is everything else.
4. **Acceptance tests are held out of the base repo.** The driver writes them into the task's workspace before the first run and restores them before every commit, as today. "Hidden" here means they're absent from the repository both arms start from and from its history; agents see only their own task's tests. A fully hidden mode is decision 8. In it, the agent never sees the tests, and CI overlays them from a store the agent can't reach: Actions fetches them with its OIDC token, and the runner fetches them by RPC.
5. **Solo-solvability pilot** (new): one Codex agent per task, alone on the base, 2 tries. Tasks it fails both times are dropped and listed. This costs about $5–10 and filters tasks that measure the model rather than the forge.
6. **Contention profile:** `contention.py --semantic` over the reference solutions. Record pairwise file sharing, textual conflicts, clean-but-red pairs and dependent share in `profile.json`.
7. **Materialise both arms from one base commit:**
   - **Arm G:** a new public repo in the benchmark org. Push upstream history *up to the base only* (agents can read `git log` and `blame`, and no future commit is present). Add the CI workflow and ruleset (§3.3).
   - **Arm B:** the gateway's seed push, as today.
   - Both bases must have the same tree hash, and `config.json` records it as `base_tree` for both.

A dependency snapshot (`npm ci` at the base) is baked into the agent image and the runner image identically. Actions restores the same lockfile through `actions/setup-node` cache. Install time is recorded separately and kept out of suite time on both sides, because neither forge should be timed on npm.

### 2.5 As built: fastify (2026-10-07)

Built in `research/real-arena/` (not `arena-from-repo/`; same steps, `research/real-arena/README.md`). The race harness reads it directly: `race.py --arena ../real-arena/fastify` (its `arena.json` gives the repo, test globs, dependency snapshot and agent settings through `harness/suite.py`).

- **Window.** Base `810e3d548eec` (2025-11-01), end `0d945819bebc` (2026-10-05): 305 first-parent commits, 61 candidate PRs, **38 tasks** by 26 authors (top author 8). Three months back gives only about 25 candidates and fewer than 20 tasks, and a base before 2025-11-01 predates the pino 10 bump, so the base is 11 months back. Lockfile pinned with `npm install --before=<base date>`; Node 25.8.1.
- **Chain build, extended.** E2's chain build kept 25 of 55 on a first pass: most losses cascaded from a few commits that are not tasks (security fixes pushed without a PR, perf PRs whose tests pass before them, excluded PRs). Those commits are now folded into the dependent task's reference as background (no dependency changes, ≤ 400 source lines; the v6 `next` merge is never folded), and docs/type conflicts keep the chain's version. 23 excluded: 10 red after the change, 6 tests pass before, 6 need an unfoldable commit, 1 unsolved. 13 tasks depend on an earlier task or background; each ships a standalone reference (the change plus its prerequisites' parts) that replay agents fall back to.
- **Suite.** 2,072 tests in about 13 s (`node --no-use-env-proxy --test 'test/**/*.test.js' 'test/**/*.test.mjs'`, 18 cores, machine under load), green offline inside Codex's sandbox. Fastify's tests listen on ports and unix sockets, so Codex agents get a loopback-only permissions profile (local binding, unix sockets in the worktree and temp dir, every domain refused by Codex's proxy) instead of the no-network sandbox, which refuses `listen`.
- **Contention** (`contention.py`, same method on both arenas): 15 of 38 tasks (40%) touch source lines another task wrote (12 pairs; the designed arena: 30 of 40, 39 pairs); 34 of 38 share a source file (101 pairs); 13 dependent tasks; 0 textual conflicts among the 25 tasks that re-base onto the base alone (the designed arena: 58 of 780). Re-based real changes still never conflict (§2.3); the contention is in the dependent tasks and the overlapping lines. Hot files: `lib/request.js` 9, `lib/reply.js` 8, `lib/route.js` 7.
- **Solvability pilot.** One Codex agent per task, `gpt-6.1-sol`, reasoning effort medium, one try, 4 at a time on the ChatGPT subscription: **38 of 39 solved** (97%), median 73 s per task, no rate-limit or usage messages. The one failure (#6373) kept the old expectation in a shared test file the PR had changed and was dropped.
- **Replay check.** `--forge local`, 8 replay agents, 4 CI slots, both policies (`research/race/runs/fastify-replay-queue`, `fastify-replay-v2`): each race completes (16–17 min) with a green, correct final state and 30 of 38 tasks landed. The queue met 4 textual conflicts and 12 red validations, beanstalk-v2 7 conflicts and 4 reds. The 8 drops in each are replay's union resolution failing on real overlapping edits (a real agent would resolve them), so replay is a harness check here, not a measurement.

---

## 3. Components

### 3.1 Race controller: `beanstalk-swarm` Worker

A new Worker under `research/swarm/` (research tooling, like `research/race`; it follows the package rules: Hono in a `WorkerEntrypoint`, generated types, structured logs). It is deployed as `beanstalk-swarm` and talks to the gateway over a service binding.

| Object | Owns |
|---|---|
| `MatchDO` (one per paired race) | The match config (repo arena digest, seed, agents, model, effort, K, C, caps); start barrier (both arms seeded and N containers healthy, then one `t0`); quota governor; spend meter; halt; final checks; export of both arms' `events.jsonl` + `summary.json` |
| `GitHubArmDO` (one per match) | Arm G's engine: task queue (same order), rework jobs, `max_rework`, the driver contract routes, GitHub App calls (open PR, enable auto-merge or `enqueuePullRequest`, close on drop), webhook intake, event log in the harness schema |
| `AgentSandbox` (Container DO, one per agent per arm) | One container from the agent image; `outboundByHost` handlers; current invocation id, so the handlers can scope credentials to it |
| `BrokerDO` (one) | Credentials (§3.5) |

Arm B's controller is the gateway's `RunDO`, deployed today. MatchDO creates the run through the admin routes (`POST /v1/runs`, `seed-token`, `start`) exactly as `remote.py` does. Arm B's agent containers then long-poll the gateway through `bs.internal`.

### 3.2 Agent sandboxes

- **Image:** Debian slim + git + Node 24 + Python 3 + the pinned Codex CLI + the repo's toolchain and dependency snapshot + `research/race/harness` (the driver). It runs as a non-root user. The CA for HTTPS interception isn't needed, because all virtual hosts are plain HTTP to the Worker-side handler and the handler speaks HTTPS onward.
- **Runtime:** Containers with `durable_object` scheduling (the Sandbox SDK 1.0 model: own DO class, `exec` with per-call env and stdio, under-600 ms median start, [migrate](https://developers.cloudflare.com/sandbox/sdk/migrate/), accessed 2026-10-06). We don't use Sandbox SDK 0.x sessions, and we don't need preview URLs, backups or bucket mounts: slots are stateless and push after every invocation. Use `sleepAfter` / inactivity timeout of 10 min, and the MatchDO stops them at the end.
- **Size and cost:**
  - Instance: `standard-3` (2 vCPU, 8 GiB, 16 GB disk), because agents run the suite locally.
  - Pricing ([containers pricing](https://developers.cloudflare.com/containers/pricing/), accessed 2026-10-06): $0.0000025 per GiB-second provisioned memory and $0.00002 per vCPU-second **active**.
  - Per agent-hour: memory 8 × 3,600 × 0.0000025 = $0.072, CPU at about 40% busy ≈ $0.058, so **about $0.13**.
  - 2 arms × 30 agents × 1 h ≈ $8 per 30-agent pair. The account caps (1,500 vCPU, 6 TiB) leave ample room ([limits](https://developers.cloudflare.com/containers/platform-details/limits/)).
- **Egress:** `enableInternet = false`. Only the four virtual hosts are served (`model.internal`, `gh.internal`, `bs.internal`, `control.internal`), and everything else is denied ([outbound traffic](https://developers.cloudflare.com/containers/platform-details/outbound-traffic/), accessed 2026-10-06). Codex's own sandbox also turns network off for agent commands, so an agent can't fetch the upstream fix.
- **Codex config:** a custom model provider whose `base_url` is `http://model.internal/v1`, with `wire_api = "responses"` and `env_key` pointing to a dummy value. The handler swaps in the real key and forwards to AI Gateway. *Unverified:* that Codex accepts a plain-HTTP base URL for a custom provider (it does for local providers such as Ollama), and that AI Gateway passes the Responses API and its streaming through unchanged. Phase 1 checks both before anything else; if either fails, the fallback is a per-invocation restricted key in `CODEX_API_KEY` (Cloudflare's own Codex template does this, [Codex on Sandbox](https://developers.cloudflare.com/sandbox/coding-agents/openai-agents-api/), accessed 2026-10-06), revoked at match end.

### 3.3 The GitHub arm adapter

**One-time setup (Coop, about 20 minutes; §7 decision 2):**
1. Create a free GitHub organisation, for example `beanstalk-bench`. Merge queue needs an org-owned public repo; private needs Enterprise Cloud ([merge queue docs](https://docs.github.com/en/enterprise-cloud@latest/pull-requests/how-tos/merge-and-close-pull-requests/merging-a-pull-request-with-a-merge-queue), accessed 2026-10-06).
2. Create a GitHub App owned by that org, with permissions contents write, pull requests write, checks read, actions read, administration write (rulesets only; *unverified:* whether enqueue needs a separate merge-queue permission). Subscribe it to `pull_request`, `merge_group`, `workflow_job`, `check_suite` and `push` webhooks, pointed at `beanstalk-swarm` with a webhook secret. Install it on the org, selected repos only.
3. Put the App's private key and webhook secret into the Secrets Store (§4.1). The private key is the only long-lived GitHub credential, and it never leaves the BrokerDO.

**Per match (automated by `GitHubArmDO`):**
- **Repo:** `<arena>-<match>` from the base (history up to the base). The CI workflow is committed at the base and is identical to the runner's suite command:
  ```yaml
  on: { pull_request: {}, merge_group: {} }
  concurrency: { group: "${{ github.workflow }}-${{ github.ref }}", cancel-in-progress: true }
  jobs:
    suite:                      # one job, one required check name for both events
      runs-on: ubuntu-latest
      steps: [checkout, setup-node with lockfile cache, "<install>", "<suite command> --reporter=junit", upload junit]
  ```
- **Ruleset** (`POST /repos/{o}/{r}/rulesets` on `main`, [rules API](https://docs.github.com/en/rest/repos/rules), accessed 2026-10-06):
  - `merge_queue` rule:

    | Parameter | Value |
    |---|---|
    | `grouping_strategy` | `ALLGREEN` (every entry's tree must pass, like our queue; `HEADGREEN` lets red entries ride along) |
    | `max_entries_to_build` | K |
    | `max_entries_to_merge` | 4 (today's `--batch 4`) |
    | `min_entries_to_merge` | 1 |
    | `min_entries_to_merge_wait_minutes` | 0 |
    | `merge_method` | `SQUASH` |
    | `check_response_timeout_minutes` | 30 |

  - `required_status_checks` for `suite`.
  - `pull_request` with 0 required approvals: an agent swarm has no human review in either arm.
- **PR flow:** the driver pushes `task/<id>` (via `gh.internal`, so the push is scoped below) and posts the result. The controller then:
  1. opens the PR, if it's the first push. The title is the task title, and the body is `Task: <id>` plus the task text;
  2. enables auto-merge (`enablePullRequestAutoMerge`, or `enqueuePullRequest` with `expectedHeadOid` once the PR check is green, [GraphQL pulls](https://docs.github.com/en/graphql/reference/pulls), accessed 2026-10-06), so the PR enters the queue the moment its check passes.
- **Kick-outs:** `pull_request.dequeued` with a reason other than merged, `merge_group.destroyed` with `invalidated` or `dequeued`, a red PR check, or `mergeable: CONFLICTING`. The controller logs `queue.eject` with GitHub's raw reason string (the values aren't documented, so log them all) and the cause it derived:
  - **Conflict with main:** a `rework_conflict` invocation for the next free agent. The driver merges `origin/main` with `--no-commit`, leaving markers, which is today's `rework_flow`.
  - **Conflict only with queue-mates:** merge main, push, re-queue, no agent.
  - **Red suite:** fetch the junit artifact of the failing run. Then a `rework_red` invocation with the failing tests and trimmed output, after merging main.
  - **After `max_rework` (3):** close the PR and log `task.drop`, as the harness does.
  - **Re-queueing:** auto-merge is re-enabled explicitly after every push. Whether a dequeue disables it is undocumented, so we watch `auto_merge_disabled`.
- **Green:** `merge_group.destroyed` with reason `merged`, plus the push to `main`. Each PR in the group gets `land` (`target: "main"`) and `task.green`, so `kth_green.py` counts it as it counts our queue.
- **Scoped pushes:** the `gh.internal` handler mints, through the BrokerDO, an installation token restricted to the one repo with contents write. It reads the push's command list, as the gateway proxy does, and **accepts only `refs/heads/task/<current task>`, never main, never a delete**. The ruleset protects `main` as a second line.
- **Rate limits** (all from GitHub's docs, accessed 2026-10-06):

  | Limit | Value | Source | What it means here |
  |---|---|---|---|
  | REST requests, App installation | 5,000 per hour, scaling to 12,500 | [REST limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) | Fine: one race makes well under 1,500 calls |
  | Content creation (PRs, comments, mutations) | 80 per minute and 500 per hour (secondary) | [REST limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) | A 60-task race needs about 60 PRs and 150 enqueues: inside the limits, but it rules out back-to-back races in one hour on one installation |
  | Pushes to one repo | 6 per minute, recommended | [repository limits](https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits) | 30 agents will exceed this at peak |
  | Merged PRs | 1 per minute | [repository limits](https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits) | If a merge group counts as one merge, groups of up to 4 keep it out of the way; if every PR counts, a 40-task race cannot finish in under about 40 min, a floor Beanstalk does not have. Measured 2026-10-07 (`research/race/GITHUB.md`): it did not bind; 4 PRs merged in 36 s, and a group's PRs merge in the same second |

  - The controller serialises mutations at least 1 s apart, per GitHub's advice.
  - It logs every `403`/`429` with `retry-after` as `gh.rate_limited`.
  - These throttles are real GitHub behaviour, so they stay in the measurement. We report them, and Phase 3 measures whether the 1-per-minute merge limit binds.

### 3.4 The Beanstalk arm

As deployed today, with three match settings:
- `ci_seconds: 0` (real suite only) and `ci_slots: K`.
- The runner's `max_instances` set to C for the match.
- The suite command and dependency snapshot from the arena.

The driver contract, git proxy, slot tokens, `demo` preset, spend guards, reap and halt are all unchanged. Arm B's containers reach the gateway through `bs.internal`. The handler adds the slot token for the container's slot (from the run's token set, refreshed through `next`), so the slot token no longer passes through the agent container either. Today it sits in the driver's environment on the laptop.

### 3.5 Credential broker

| Credential | Held by | What a container gets | Lifetime |
|---|---|---|---|
| OpenAI API key, one per arm project | Secrets Store, read by BrokerDO; or AI Gateway stored provider key | Nothing. `model.internal` adds it server-side | Revoked or rotated by Coop after the deadline |
| AI Gateway auth token | Secrets Store | Nothing (added by handler) | Per match; revoking it is the hard stop |
| GitHub App private key | Secrets Store, BrokerDO only | Nothing | Long-lived, never leaves BrokerDO |
| GitHub installation token | Minted by BrokerDO per invocation, repo-restricted, contents write | Nothing (`gh.internal` adds it as Basic `x-access-token`) | 1 h maximum ([installation tokens](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app), accessed 2026-10-06); re-minted at 50 min |
| Controller's own GitHub token (PRs, enqueue) | Minted by BrokerDO for GitHubArmDO | Never leaves the Worker | 1 h |
| Beanstalk admin token | Secrets Store, MatchDO calls the gateway over the service binding | Nothing | As today |
| Beanstalk slot tokens | MatchDO from `POST /v1/runs` | Nothing (`bs.internal` adds it) | As today, refreshed via `next` |
| ChatGPT `auth.json` (subscription mode only, §4.2) | DO storage, encrypted with a Secrets Store key; one per seat | Written into `CODEX_HOME` of the one container holding the seat lease, read back after every invocation | Seat lease = one invocation |

The rules, all enforced in code and in review:
- No secret in argv, config files, logs, events or transcripts.
- The driver's `Secrets.scrub` stays on, and the handlers redact `authorization` and `x-access-token` from every log line.
- `wrangler secret`/Secrets Store values are entered by Coop interactively and never echoed.
- The design never needs to read a secret value back.

### 3.6 Telemetry

- **Shared schema.** Both arms write `events.jsonl` in the harness schema with one clock: seconds since the MatchDO `t0`, plus an ISO `ts`. Arm B's comes from the gateway unchanged. Arm G's is written by `GitHubArmDO`, and Appendix B maps each GitHub event to a harness event.
- **Timestamps.** GitHub timestamps come from the payloads (`workflow_job.started_at`/`completed_at`, `merge_group` delivery time, the `push` head commit time), not from webhook arrival, which lags by seconds.
- **Clock skew.** Arm G records the median webhook lag, `gh.webhook_lag_ms`, as a correction check.
- **Summary and outputs.** `summary.json` for Arm G is produced by running `harness/summary.py` over its events (the MatchDO export step does this in a short container job, or the operator runs it locally). So `kth_green.py`, `summary.py` and `report.py` read both arms unchanged. Run directories are `research/race/runs/swarm-<arena>-<arm>-<model>-<agents>-s<seed>/`.
- **Final check.** One final check for both arms, run by the same runner job on each arm's final main/stalk. It covers the full suite plus every task's acceptance tests, and gives `final.correct` as today. GitHub's own last green isn't trusted as the final check, so both arms are judged by identical code.

### 3.7 Spend caps and the halt switch

- **Caps, in four layers:**
  1. Per-arm `max_usd` in MatchDO: agent spend (AI Gateway's per-request cost, or tokens × list price) + Cloudflare infra (the gateway's infra meter, plus the swarm's own container seconds) + Actions minutes (0 on a public repo, but metered).
  2. Per-match cap = the sum of the two.
  3. The OpenAI project budgets as a backstop.
  4. Revoking the AI Gateway token as the last stop.
- **Halt.** `POST /v1/admin/halt` on `beanstalk-swarm`:
  1. stops both arms. It calls the gateway's existing halt for arm B. For arm G it disables auto-merge on every open PR, dequeues and closes them, and leaves the repo for inspection;
  2. stops every agent container;
  3. refuses new matches.
- **Voiding.** A halted match is marked void, and its runs are kept but labelled.
- **Reaping.** Arm B's Artifacts repo is reaped as today. Arm G's repo is archived (kept public as evidence) or deleted (decision 11).

---

## 4. Codex: subscription or key

### 4.1 Recommended: API key (what Coop does once)

1. In the OpenAI platform, create two projects, `beanstalk-swarm-g` and `beanstalk-swarm-b`. Set each project's monthly budget to the per-arm budget (decision 5) and, where offered, an equal rate limit for the chosen model.
2. Create one restricted key per project (model access only).
3. Add each key to Cloudflare once, typed at the prompt and never pasted into a file or chat: `npx wrangler secrets-store secret create <store> --name OPENAI_KEY_G --scopes workers` (and `_B`). Alternatively, store it as an AI Gateway provider key.
4. Create the AI Gateway `beanstalk-swarm` with logging on and caching **off**. Caching would serve one arm's completions to the other.

- **Price:** GPT-6.1 Sol, the Codex default since 0.159 (E7 confirmed it as the model a ChatGPT-login Codex used), lists at $2.00 input, $0.10 cached input and $10.00 output per 1M tokens ([API pricing](https://developers.openai.com/api/docs/pricing), accessed 2026-10-06).
- **Spend estimate:** E7's Codex first attempts were 38–42 s and came to roughly $0.05–0.15 each at the adapter's old assumed prices. Real-repo tasks with full-suite runs are larger, so the budget assumes **$0.30 per invocation and 2 invocations per task**. That gives about $25 per arm for a 40-task race and $35 for a 60-task race.

### 4.2 What the subscription allows, and why it is not the default

The findings, from OpenAI's Codex docs (accessed 2026-10-06):

- **How a ChatGPT plan logs in.**
  - `codex login` opens a browser.
  - On a headless machine, `codex login --device-auth`. Device-code login is in beta and has to be enabled in ChatGPT security settings first.
  - Or copy `auth.json` to the machine.
  - Credentials live in `$CODEX_HOME/auth.json`: access, ID and refresh tokens plus `last_refresh`. "Treat it like a password" ([auth](https://learn.chatgpt.com/docs/auth)).
- **Refresh.**
  - Codex refreshes when `last_refresh` is older than about 8 days, or on a 401, and writes the new tokens back to the file ([CI/CD auth](https://learn.chatgpt.com/docs/auth/ci-cd-auth)).
  - Refresh tokens rotate on use. When any copy refreshes, the old refresh token is invalidated, so every other copy (including Coop's laptop) gets a 401 on its next refresh ([Domino docs](https://docs.domino.ai/6.3/platform-capabilities/features/coding-assistants/reuse-credentials), accessed 2026-10-06).
  - Users report "refresh token was already used / revoked" errors (openai/codex #17265; forum thread 2026-08-24).
- **Concurrency.** The CI/CD page says: **"Do not share the same file across concurrent jobs or multiple machines"** and "use one `auth.json` per runner or per serialized workflow stream". It applies only to "trusted private infrastructure", and adds: **"The right way to authenticate automation is with an API key."**
- **Limits.**
  - Plus and standard Business plans give GPT-6.1 Sol **15–160 local messages per 5 hours**, and "weekly limits may also apply" ([pricing](https://learn.chatgpt.com/docs/pricing)).
  - Pro (at $100, $200 or $500) is described as 5x or 20x Plus. *Unverified:* whether Pro has a fixed 5-hour cap at all.
  - Enterprise and Edu have no fixed limits and scale with credits.
  - The allowance is shared with ChatGPT's other agent features ([help](https://help.openai.com/articles/11369540)).
  - Hitting the limit mid-turn lets the turn finish "subject to fair use". The next call fails, and `codex exec` exits 1 with "You've hit your usage limit. Try again at <time>" ([third-party guide](https://codex.danielvaughan.com/2026/06/12/codex-cli-exit-codes-error-handling-resilient-shell-scripts-ci-pipeline-automation/), 2026-06-12).
- **Terms.**
  - OpenAI's Terms of Use: "You may not share your account credentials or make your account available to anyone else", and you may not "automatically or programmatically extract data or Output" (2024-12-11 text via [mirror](https://open.windriver.com/info/uni-license-list/licenses/openai-tou-20241211.html)). The current page returned 403 to our fetcher.
  - Running Coop's own agents isn't obviously "anyone else". But a 60-container swarm on one personal seat goes well beyond the one-runner pattern the docs allow, and is the kind of use that gets accounts flagged. Doc `16` D8 already marks subscription cloud sessions "local only".
- **Codex Cloud** (chatgpt.com/codex) runs parallel tasks on the plan's allowance, but **only against GitHub repositories** ([Codex cloud](https://learn.chatgpt.com/docs/cloud)). It can't drive the Beanstalk arm, so it would break "same agent runtime". It's rejected for the comparison.

**So the options are:**

| Mode | How | Concurrency | Verdict |
|---|---|---|---|
| **A. API key** (recommended) | §4.1; key injected outside the container | Any; project rate limit is the only cap | ToS-clean, isolates arms, predictable, about $25–35 per arm-race |
| **B. Subscription, one seat per lane** | Coop runs `codex login --device-auth` once per seat inside a throwaway "login" container whose `CODEX_HOME` is a temp dir. BrokerDO captures that container's `auth.json` into encrypted DO storage (the value never shown, never in a file on the laptop). For each invocation, BrokerDO leases one seat to one container, writes `auth.json` into its `CODEX_HOME`, reads the possibly refreshed file back afterwards, and never re-seeds from an old copy | One agent per seat at a time: 4 seats = 4 agents | Matches the documented "one auth.json per serialized stream". Fine for the 4-agent smoke race on Coop's own seats. For 2 × 30 agents it needs 60 seats and 60 × the allowance. Not for measured races |
| C. One login shared across containers | Copy one `auth.json` everywhere | Breaks at the first refresh, and can log out Coop's laptop | **Rejected** |
| D. Codex Cloud | GitHub-only | n/a | **Rejected** (can't run arm B) |

**When a limit hits (any mode).** The driver already treats rate limits and refused credentials as infra failures (`REMOTE.md`): it never posts them as the agent's work, backs off from 15 s to 60 s, and stops after 5 minutes of outage. In the swarm, MatchDO adds the freeze-and-void rule (§1.3).

**Fallback.** If mode B is in use and a seat's limit hits, the pair is voided and re-run on mode A. A mid-race switch would change the conditions.

---

## 5. Measurements and reporting

**The same metrics as today**, from `kth_green.py` and `summary.py` over both arms:
- the time and agent cost to the k-th verified green, with k = 50%, 75% and 90% of tasks (for 40 tasks: 20, 30 and 35);
- greens, drops and parked beans;
- time to done;
- start → green, median and p90;
- red validations;
- final correctness;
- cost by invocation kind;
- reworks and textual conflicts.

**GitHub-specific metrics** (Arm G's summary gains a `github` block, the way the queue has `queue`):

| Metric | From |
|---|---|
| Queue wait: enqueued → merged, and enqueued → dequeued, median and p90 | `pull_request.enqueued` / `dequeued`, `merge_group.destroyed` |
| Kick-outs by GitHub reason and by derived cause (conflict with main, conflict with mate, red, timeout) | `queue.eject` |
| Merge groups built, merged, invalidated; mean group size | `merge_group` events |
| Rebases (merge-main reworks) with and without an agent | `rework.start`, `requeued_without_agent` |
| PR-check runs and merge-group runs; Actions minutes (billable 0 on public, measured anyway) | `workflow_job` timings |
| Runner pickup latency (queued → in progress) | `workflow_job` |
| API calls, secondary-limit hits, `retry-after` seconds | `gh.rate_limited` |
| Webhook lag | `gh.webhook_lag_ms` |

**Beanstalk's counterparts** (already in its summary):
- pre-land checks and re-checks;
- validations, bisect runs and reverts;
- cards and reconciles;
- runner minutes;
- the sprout window.

**Both arms:**
- agent-minutes, busy and idle;
- tokens and dollars per task;
- infra dollars;
- the contention profile of the arena;
- `calibration.json`.

**The report** (`research/race/swarm_report.py`, new):
- one table per arena, with the pairs side by side;
- per-pair ratios (G ÷ B) for the k-th green and done;
- across seeds, the geometric mean with a 95% CI and a sign test, as E7 did;
- a line chart of greens over time for each pair.

Every void pair is listed with its reason. A number goes in the README only when its run directory is committed.

---

## 6. Phases to 2026-10-14

Today is 2026-10-06. The submission work in `16` Phase 0 still has priority, so this plan uses separate Worker names and never touches the deployed demo's routes.

**Ordering principle:** the biggest caveats are the synthetic arena and our own queue. Agents on a laptop is the smallest. So build the real arena and the GitHub arm first, and move agents into containers last. The GitHub arm's controller lives in the Worker in every phase, because webhooks need a public endpoint. The in-container driver is the same code that can also run on the laptop.

| Phase | Dates | What | Done when | Effort |
|---|---|---|---|---|
| **0. Decide and source** | 10-06 → 10-07 | Coop answers decisions 1–6. Run `arena-from-repo` on the chosen repo: window, PR text, chain build, contention profile, solo pilot with 1 Codex agent (about $5–10). Coop creates the org, the App and the OpenAI projects, and enters secrets (about 30 min) | An arena directory with ≥ 40 validated tasks, `profile.json` showing contention above the §2.2 thresholds, and the pilot table | 1 agent-day + Coop 30 min |
| **1. Swarm skeleton** | 10-07 → 10-08 | `beanstalk-swarm`: MatchDO, BrokerDO, AgentSandbox with the outbound handlers; the agent image; `remote.py --slot-mode`; the arm B path end to end with **replay agents** (free). First check: Codex through `model.internal` with one real call | A replay race on arm B driven entirely from containers matches a laptop replay race's decisions (replay parity, as in `11` "CF") | 2 agent-days |
| **2. GitHub arm** | 10-08 → 10-09 | GitHubArmDO: repo materialisation, workflow, ruleset, App webhooks, PR / enqueue / kick-out / rework, event mapping (Appendix B), final check; CI calibration on both sides | A replay race on arm G (free: public repo, no model) runs to done; `kth_green.py` reads it; calibration within 15% or the gap is written down | 2 agent-days |
| **3. Smoke race** | 10-09 → 10-10 | 4–8 Codex agents, 16–20 tasks, both arms simultaneously, one seed, caps $40 per arm | Both arms finish; no secret anywhere in logs (grep check); max concurrent suites ≤ C; no void; GitHub rate-limit and the 1-merge-per-minute behaviour measured | 0.5 agent-day + about $40–80 |
| **4. Measured races** | 10-10 → 10-12 | 12 agents × 3 seeds (7, 11, 13), then 30 agents × 1–2 seeds; one FIFO-start robustness seed | All pairs done or voided and re-run; report generated | 1 agent-day of babysitting + about $250–400 |
| **5. Write-up** | 10-12 → 10-13 | Doc `11` row, README "Measured" section, `12` script numbers, `16` Phase 0 item; caveats rewritten | Every number traceable to a run directory | 0.5 agent-day |

**Total:** about 7 agent-days, with lanes in parallel: 0 + 1 in parallel, 2 after 1's image exists. Plus about $300–500 of model spend and under $30 of Cloudflare.

**Cut lines:**
- If Phase 1 slips past 10-09, run the agents from the laptop through the same driver against both arms. That removes two of the three caveats and keeps the GitHub arm.
- If Phase 2 slips past 10-10, ship Beanstalk-only cloud races on the real arena against our own queue. That removes the synthetic-arena and laptop caveats, and states the self-written-queue caveat plainly.
- If the 30-agent races can't fit, ship 12 agents × 3 seeds.

---

## 7. Open decisions for Coop

| # | Decision | Options | Recommendation | Needed by |
|---|---|---|---|---|
| 1 | **Which repo** | Candidates in §2.3 | **fastify/fastify** at a base about 3 months back (60-change window, chain build), with **h3** as the second arena if time allows. Both are MIT, Node and fast; fastify has the healthier PR descriptions and author mix | 10-07 |
| 2 | **Which GitHub org** | (a) new free org for the benchmark; (b) an existing org | (a) A new free org (name like `beanstalk-bench`) with public repos only. Merge queue needs org + public on Free. Nothing else of yours is exposed, and the App is installed only there | 10-07 |
| 3 | **Codex auth, plan and parallelism** | (A) API key; (B) subscription, one seat per lane; (C) shared login (rejected) | (A) for every measured race. (B) only if you want the 4-agent smoke race on your own seats. No plan upgrade is needed for (A) | 10-07 |
| 4 | **Model and effort** | GPT-6.1 Sol (Codex default) at default effort; Luna (cheap, weaker); Astra (expensive) | GPT-6.1 Sol, effort `medium`, pinned in config: the model E7 used, so results connect | 10-07 |
| 5 | **Budget** | — | Model spend cap $500 total (smoke $80, 12 × 3 pairs $200, 30 × 2 pairs $200, slack); Cloudflare under $30; Actions $0. Per-arm `max_usd` = 1.5 × the estimate | 10-07 |
| 6 | **Simultaneous vs sequential arms** | — | Simultaneous, separate OpenAI projects with equal limits, freeze-and-void on any provider limit | 10-07 |
| 7 | **CI machines** | (a) GitHub-hosted `ubuntu-latest` vs runner `standard-4`, calibrated; (b) self-hosted GitHub runners on Cloudflare containers of the runner's type | (a). Switch to (b) only if calibration shows a gap above 25% | after calibration (10-09) |
| 8 | **Acceptance tests visible or fully hidden** | (a) held out of the repo, given to the task's agent and protected, as every race so far; (b) fully hidden, overlaid by CI | (a) for the measured races, so results connect to E2/E7 and PR descriptions aren't guessing games; (b) as one robustness seed if time allows | 10-07 |
| 9 | **Beanstalk preset** | `demo` (dependency-aware starts), or FIFO | `demo` primary (it is the product), plus one FIFO seed reported alongside | 10-07 |
| 10 | **K and C** | — | K = 2 (as every race so far) for 12 agents, K = 4 for 30 agents; C = 20 (GitHub Free's job cap) for both | 10-08 |
| 11 | **Publishing the GitHub arm** | keep repos public after the race, archive, or delete | Keep them public and archived: judges can click through the real PRs, queue history and Actions runs. That's the strongest evidence we can offer | 10-12 |
| 12 | **Attribution of upstream PRs** | — | The arena README credits the upstream repo, licence and each PR's author by handle and number. Tasks are used as benchmark prompts, never presented as our work | 10-07 |
| 13 | **Driver language in the image** | Python driver from `research/race` (proven, measured), or a Rust rewrite (the `AGENTS.md` container rule) | Python for the benchmark: it is research tooling under `research/`, and a rewrite would change the instrument being compared. Product cloud sessions (`16` Phase 5) stay Rust | 10-07 |

---

## 8. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| **Subscription ToS / shared-login breakage** | Coop's ChatGPT account flagged, or Codex logged out on his laptop mid-race | API key for measured races; subscription mode B leases one seat per container and writes refreshed tokens back; never mode C |
| **Unknown subscription allowance** (weekly caps unpublished, `/status` sometimes wrong, issue #28016) | A race stalls on a limit | Not in mode A; in mode B, freeze-and-void and re-run on A |
| **GitHub per-repo limits** (6 pushes/min recommended, 1 merge/min, 500 content creations/h) | GitHub arm throttled at 30 agents | It is real GitHub behaviour and stays in the result. Measure in Phase 3; report `gh.rate_limited`; one race per repo per hour; fresh repo per match |
| **GitHub Actions free-tier queueing** (20 concurrent jobs, two suites per bean) | Arm G slower for capacity, not design | That is the matched C. If a judge objects, state that Beanstalk was capped at the same 20, and show max-concurrency telemetry |
| **Real tasks too easy or too calm** (E2: queue won 4.3–4.7x) | Beanstalk loses on real data | Choose a high-contention repo and use the chain build. **Publish the result either way**: an honest loss on calm repos, with the contention profile beside it, beats an unexplained win. The v2.1/v2.2 adaptive re-check already fixed E2's overhead |
| **Model contamination** (the model has seen the upstream PRs) | Agents reproduce known fixes | Equal across arms. Network off for agent commands, so no fetching upstream. Note it in the caveats |
| **AI Gateway or custom-provider path doesn't carry Codex** | Phase 1 blocked | The first test of Phase 1; fallback: per-invocation restricted key in env, revoked at match end (Cloudflare's own Codex template) |
| **Fairness objections a judge could raise** | Result dismissed | Each has an answer in §1: same image digest, same model and effort, same prompts, same task order, same C and K, same final-check code, calibration file, simultaneous arms, GitHub given automatic rework, raw events and public GitHub repos to audit. The `demo` vs FIFO seed answers "scheduling, not integration" |
| **Webhook delivery gaps** | Missing events, wrong times | Poll GraphQL `mergeQueue` entries every 10 s as a reconciler; payload timestamps, not arrival |
| **Secrets leak through transcripts** | Key exposure | Containers hold none (outbound injection); `Secrets.scrub` and handler redaction; post-race grep of all artifacts for key prefixes as a gate |
| **Deadline** | Nothing measured by 10-14 | Cut lines in §6; Phase 0 submission work keeps priority |
| **Cost overrun** | Surprise spend | Four layers of caps (§3.7); spend shown live in MatchDO |

---

## Appendix A: research notes with sources (accessed 2026-10-06 unless dated)

**Codex CLI**
- Device-code login, `auth.json`, refresh after about 8 days or on 401, "do not share the same file across concurrent jobs or multiple machines", "API key is the right way to authenticate automation": [auth](https://learn.chatgpt.com/docs/auth), [CI/CD auth](https://learn.chatgpt.com/docs/auth/ci-cd-auth).
- Refresh-token rotation invalidating other copies: [Domino docs](https://docs.domino.ai/6.3/platform-capabilities/features/coding-assistants/reuse-credentials); a fix that re-reads `auth.json` after another process refreshed: openai/codex issue #17265.
- `codex exec --json` events, `CODEX_API_KEY`, `exec resume`, `--output-schema`: [non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode).
- MCP in `config.toml` (`url`, `bearer_token_env_var`, `http_headers`, `required`, `tool_timeout_sec` 60): [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
- TypeScript SDK `@openai/codex-sdk` (`startThread`, `run`, `resumeThread`) and `codex app-server` (JSON-RPC): [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk). They aren't needed here: `codex exec --json` is what the measured harness uses.
- Plan allowances (Plus/Business GPT-6.1 Sol 15–160 local messages per 5 h; weekly limits may apply; Enterprise/Edu credit-based): [pricing](https://learn.chatgpt.com/docs/pricing). Shared allowance: [help 11369540](https://help.openai.com/articles/11369540).
- Exit codes and the "Try again at" message: [third-party guide, 2026-06-12](https://codex.danielvaughan.com/2026/06/12/codex-cli-exit-codes-error-handling-resilient-shell-scripts-ci-pipeline-automation/).
- Codex 0.160.1 stable on 2026-10-05: [releases](https://github.com/openai/codex/releases).
- API prices: [OpenAI pricing](https://developers.openai.com/api/docs/pricing).

**GitHub**
- Merge queue availability (org-owned public, or private on Enterprise Cloud): [docs](https://docs.github.com/en/enterprise-cloud@latest/pull-requests/how-tos/merge-and-close-pull-requests/merging-a-pull-request-with-a-merge-queue); [GA 2023-07-12](https://github.blog/changelog/2023-07-12-pull-request-merge-queue-is-now-generally-available/).
- Ruleset `merge_queue` parameters: [rules API](https://docs.github.com/en/rest/repos/rules).
- `merge_group` requirement, `gh-readonly-queue/*`, removal and regrouping: [managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue).
- `enqueuePullRequest`, `dequeuePullRequest`, `MergeQueueEntry` states: [GraphQL pulls](https://docs.github.com/en/graphql/reference/pulls).
- `merge_group.destroyed` reasons (`dequeued`, `invalidated`, `merged`); `pull_request.dequeued.reason` is a free string: [webhooks](https://docs.github.com/en/webhooks/webhook-events-and-payloads), [octokit schema](https://raw.githubusercontent.com/octokit/webhooks/main/payload-schemas/api.github.com/pull_request/dequeued.schema.json).
- Rate limits: [REST](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api), [GraphQL](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api), [repository limits](https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits).
- Installation tokens (1 h, `repositories` + `permissions` narrowing): [apps API](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app).
- Actions concurrency (Free 20, Team 60, Enterprise 500): [limits](https://docs.github.com/en/actions/reference/limits). Runner sizes (public 4 vCPU / 16 GB): [hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
- 2026 pricing: the self-hosted platform charge was postponed ([changelog 2025-12-16](https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/)); public repos stay free.

**Cloudflare**
- Instance types, custom types (up to 4 vCPU / 12 GiB / 20 GB), account caps (1,500 vCPU, 6 TiB memory, raised 2026-02-25): [limits](https://developers.cloudflare.com/containers/platform-details/limits/), [changelog](https://developers.cloudflare.com/changelog/product/containers/).
- Cold start 1–3 s ([FAQ](https://developers.cloudflare.com/containers/faq/)); under 600 ms median on SDK 1.0 ([migrate](https://developers.cloudflare.com/sandbox/sdk/migrate/)).
- Egress: `enableInternet = false`, `allowedHosts`, `outboundByHost`, HTTPS interception CA: [outbound traffic](https://developers.cloudflare.com/containers/platform-details/outbound-traffic/).
- Credential injection outside the container: [Sandbox outbound](https://developers.cloudflare.com/sandbox/sdk/guides/outbound-traffic/).
- Disk wiped on stop; snapshots and backups: [lifetime](https://developers.cloudflare.com/sandbox/concepts/lifetime/), [backup-restore](https://developers.cloudflare.com/sandbox/sdk/guides/backup-restore/).
- Pricing: [containers pricing](https://developers.cloudflare.com/containers/pricing/).
- Cloudflare's own Codex-in-a-container template (restricted `CODEX_API_KEY` in env): [Codex on Sandbox](https://developers.cloudflare.com/sandbox/coding-agents/openai-agents-api/).

## Appendix B: event mapping for the GitHub arm

| Harness event (what `kth_green.py` / `summary.py` read) | Arm G source |
|---|---|
| `race.setup`, `race.start`, `race.end` | MatchDO (`t0` shared with arm B) |
| `task.start`, `invocation.start` / `.init` / `.end`, `task.commit` | GitHubArmDO on `next` / `result` (identical to the gateway) |
| `queue.enqueue` | `pull_request.enqueued` (payload time) |
| `batch.start` (entries = the group's PRs) | `merge_group.checks_requested` |
| `ci.start` / `ci.end` | `workflow_job` in progress / completed (`started_at`, `completed_at`), tagged `pr` or `group` |
| `batch.red`, `batch.cancel` | group check failed / `merge_group.destroyed` `invalidated` |
| `queue.eject` (`reason`: `conflict` / `red` / `timeout`, plus `gh_reason`) | `pull_request.dequeued` not merged, red PR check, `mergeable: CONFLICTING` |
| `merge.conflict`, `rework.start` | Controller, when it hands out the rework |
| `land` (`target: "main"`) and `task.green` | `merge_group.destroyed` `merged` + `push` to `main` (head commit time) |
| `task.drop` | After `max_rework`, PR closed |
| `final.check` | The shared final-check job on `main` |
| `gh.*` (new, ignored by today's tools) | `gh.rate_limited`, `gh.webhook_lag_ms`, `gh.auto_merge_disabled`, `gh.api_calls` |
