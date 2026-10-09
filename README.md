# Beanstalk

An agent-first git forge on Cloudflare Workers and Artifacts, built for Cloudflare's "Build the next GitHub" competition.

When a dozen coding agents work on one codebase, a merge queue makes them wait in line. Beanstalk lets them land without waiting. It checks every change on the exact tree it would land on, sends a failure back to the agent that wrote the change with the change that broke it, and asks a human only when two specs genuinely disagree.

- A **bean** is one agent's change: a branch of the run's repository.
- The **sprout** is the staged line. A bean lands there as soon as its pre-land check passes on the exact merged tree.
- The **stalk** is the stable line. It moves only to sprout commits that passed validation, so the stalk stays honest.

## Measured, not projected

**Against GitHub's own merge queue, on a real repository.** The same 38 changes from fastify's history (merged upstream PRs, each with its own tests) were pushed in parallel to a public GitHub repository with GitHub's merge queue and Actions, and to a Beanstalk repository, with CI capacity matched (Beanstalk pre-land concurrency 20 = the org's Actions job limit; 2 validation slots = the queue's build concurrency). Changes and timing were replayed without models (`research/race/loadgen/`), and separately worked by real Claude Code agents organising the work themselves (`research/race/ORCHESTRATED.md`).

| Parallel workers | Ready → merged, median (GitHub / Beanstalk) | Faster | All 38 landed (GitHub / Beanstalk) | Sooner |
|---|---|---|---|---|
| 4 (seed 13) | 2.9 / 0.7 min | 4.1× | 46.3 / 24.0 min | 1.9× |
| 8 (seed 13) | 3.7 / 0.8 min | 4.6× | 29.6 / 13.8 min | 2.1× |
| 16 (seeds 7 / 11 / 13) | 7.1 / 6.6 / 7.1 vs 1.1 / 1.0 / 0.8 min | **6.5–8.9×** | 30.4 / 27.8 / 32.5 vs 10.9 / 12.4 / 9.8 min | **2.2–3.3×** |

GitHub's queue slows as more work arrives (its merge queue builds two groups at a time); Beanstalk keeps landing each change in about a minute. Every run landed all 38 changes correctly on both forges. With real agents (Claude Code lead + Sonnet workers, 38 tasks), the forges tie at 4 workers, where the agents are the bottleneck; at 8 workers Beanstalk's last green came at 22.4 min against GitHub's 41.4 (1.8×). Caveats: the 4- and 8-worker replay rows are one seed each; CI minutes are not like for like (GitHub's include runner setup and `npm ci`); the race repos are public in the `kintohubtest` GitHub organization. Runs: `research/race/runs/lg-fastify-*` and `orch-fastify-*`; tables: `research/race/loadgen/README.md`.

### The synthetic arena

**30 agents.** 30 real Claude Code agents (Sonnet) worked the same 40 colliding tasks, every landed acceptance test protected, on three seeds (7, 11, 13). Every integration decision ran on the deployed Cloudflare prototype.

**Beanstalk shipped more (39–40 of 40 green, against the queue's 34–35), reached its 30th green task 1.7–2.3x sooner on every seed, and finished 1.3–1.6x sooner, with no red stalk check and the same agent spend.**

| Seed | Run | Tasks green | 30th green | 35th green | All done | Agent spend | Red validations | Final stalk correct |
|---|---|---|---|---|---|---|---|---|
| 7 | Batched merge queue | 35 of 40 | 22.0 min | 35.3 min | 38.7 min | $4.32 | 11 | yes |
| 7 | Beanstalk | **39 of 40** | **10.2 min** | **13.5 min** | **30.3 min** | $4.54 | 0 | yes |
| 11 | Batched merge queue | 35 of 40 | 23.7 min | 34.2 min | 34.2 min | $4.47 | 9 | yes |
| 11 | Beanstalk | **40 of 40** | **11.9 min** | **15.0 min** | **23.2 min** | $4.03 | 0 | yes |
| 13 | Batched merge queue | 34 of 40 | 21.7 min | not reached | 44.7 min | $4.41 | 13 | yes |
| 13 | Beanstalk | **39 of 40** | **12.9 min** | **20.0 min** | **27.3 min** | $4.74 | 0 | yes |

The engine behind these runs is v2.5 with dependency-aware starts, the red-window reset, the scheduler starvation fix and re-checked structural merges (gateway of 2026-10-06). An earlier 30-agent run without those fixes was no faster than the queue (35th green 34.5 against 35.5 min); `docs/claude-opus/11-experiments-summary.md` has that post-mortem. `--preset demo` now also turns on check reuse and per-reset repair chains, which are measured only in the simulator so far.

**12 agents.** On the same arena with 12 agents (v2.5 with dependency starts, the engine before the 30-agent fixes):

| Seed | Run | Tasks green | 35th green | All done | Agent spend | Red validations | Final stalk correct |
|---|---|---|---|---|---|---|---|
| 7 | Batched merge queue | 36 of 40 | 35.0 min | 40.6 min | $4.12 | 10 | yes |
| 7 | Beanstalk | **39 of 40** | **17.1 min** | **31.6 min** | $6.08 | 4 | yes |
| 11 | Batched merge queue | 35 of 40 | 29.2 min | 30.2 min | $4.51 | 8 | yes |
| 11 | Beanstalk | **39 of 40** | **14.9 min** | **24.0 min** | $4.18 | 0 | yes |
| 13 | Batched merge queue | 37 of 40 | 36.8 min | 39.5 min | $4.54 | 10 | yes |
| 13 | Beanstalk | **38 of 40** | **22.0 min** | **29.8 min** | $5.32 | 4 | yes |

Read it with care:
- **Three seeds**, one run each, at each size. Seeds swing a lot: at 30 agents Beanstalk's 35th green came at 13.5 to 20.0 minutes.
- **A synthetic arena with short tasks.** The 40 tasks collide on purpose in a small TypeScript shop, and agents finish a task in tens of seconds. With 7x-longer tasks, a local experiment saw the lead shrink to 1.3–1.4x. The fastify races above use real changes against GitHub's own merge queue.
- **The queue in this arena is ours**: a batched merge queue built to behave like GitHub's. The fastify races above use GitHub's real one.
- **Cost is measured.** At 30 agents agent spend was even: $13.31 for Beanstalk over the three seeds against the queue's $13.20; at 12 agents Beanstalk cost 18% more. Cloudflare infrastructure, metered, was $0.38–0.43 per Beanstalk race and $0.21–0.24 per queue race.
- The agents ran on a laptop; only the decisions ran on Cloudflare. Times count from the race's start (`kth_green.py`; `--raw-clock` gives the older numbers from the run's creation, 0.1–0.2 minutes later).

The runs are in `research/race/runs/`: `cf-queue-sonnet-30-s{7,11,13}` and `cf-demo2-sonnet-30-s{7,11,13}` at 30 agents; `cf-queue-sonnet-12-s7-landed`, `cf-queue-sonnet-12-s11`, `-s13`, `cf-v25dep2-sonnet-12-s{7,11,13}` at 12. `python3 research/race/kth_green.py <runs> --k 30` reproduces the tables. The history, and every experiment behind these rules, is in [`docs/claude-opus/11-experiments-summary.md`](docs/claude-opus/11-experiments-summary.md).

## How it works

- **Pre-land check on the exact tree.** A bean's check runs in its own sandbox on the sprout plus the bean, and the agent takes its next task meanwhile.
- **Informed repair.** A red check resumes the author's own session, together with the landed change that broke it.
- **The sprout window.** At most W landings may run ahead of validation. W grows while validations pass and halves on a red one, so a burst of landings can't outrun the checks.
- **Revert-first.** A red validation is bisected by read set and the culprit is reverted, never the innocent beans.
- **Reconcile, then decide.** When two beans' tests clash, a test author first updates any value that one task pins and the other legitimately changes. Only a genuine contradiction becomes a decision card for a human.
- **Ask.** The web app's repository explorer reshapes itself around a question ("what changed recently on coupons?"): the matching files, their diffs, and the beans and decisions behind them.

## What's here

| Path | Contents |
|---|---|
| `packages/runner` | Rust container: squash, check on an exact merged tree, compose, update refs on Artifacts, revert |
| `packages/gateway` | The Worker that makes every integration decision: the run engine in a SQLite Durable Object, the git proxy, and read-only repository RPC |
| `packages/shared-race` | Shared types: run config, events, driver contract, RPC |
| `packages/web` | vinext app: the Ask explorer, the race canvas, and the side-by-side race |
| `research/race` | The race harness and driver (real Claude Code and Codex agents, or replay agents), and every recorded run |
| `research/arena` | The 40-task colliding arena |
| `docs/claude-opus` | Thesis, prototype plan, experiment write-ups (E1–E7), demo script, Ask design |
| `promo/beanstalk-30s.html` | A 30-second promo; open it in a browser |

## Run it

You need Node 24+, pnpm 11, stable Rust, Docker, and a Cloudflare account with Workers, Containers and Artifacts.

```bash
pnpm install
pnpm check                                   # format, lint, typecheck, tests (TypeScript and Rust)
pnpm -F @beanstalk/web dev                   # the explorer and race canvas, on the recorded runs (works offline)
```

Deploy everything to one account. An environment is one directory, `environments/<name>/` (the public repo ships only `example/`): the account, a name suffix (`-staging` gives `beanstalk-gateway-staging`; empty keeps the base names) and the packages to run. Docker must be running: it builds the container images.

```bash
npx wrangler login
npx wrangler whoami                          # lists your accounts and their ids
cp -r environments/example environments/staging   # then set account_id and workers_dev_subdomain
pnpm env:provision staging                   # D1, KV, R2, queues; ids into resources.json; secrets; migrations
pnpm env:deploy staging                      # checks secrets, then executor, gateway, mcp, web, ssh, site
pnpm env:deploy staging --dry-run            # builds and checks without uploading
```

The account needs Workers Paid (Containers and Durable Objects), and Artifacts and Workers AI enabled. Provision generates the Workers' secrets into `environments/staging/secrets/` (git-ignored, never printed; `DEMO_PASSWORD` in `web.vars` unlocks decision cards) and deploy uploads them; the race driver reads `ADMIN_TOKEN` from `environments/staging/secrets/gateway.vars`. How the templates become configs, and how to keep your environments in a private fork, is in [`docs/claude-opus/30-environments.md`](docs/claude-opus/30-environments.md).

Then run a race against your gateway. `--preset demo` pins the engine behind the published numbers (v2.5 with dependency-aware starts; `--preset v24` pins v2.4); `--max-usd` caps agent plus infrastructure spend; the run deletes its Artifacts repo when it ends and prints its infrastructure cost. Replay agents are free; real agents need the `claude` CLI, logged in:

```bash
cd research/race
GW=https://beanstalk-gateway.<your-subdomain>.workers.dev
python3 race.py --forge cloudflare --gateway $GW --policy beanstalk-v2 --preset demo --agent replay --agents 8 \
  --ci-seconds 4.5 --ci-slots 2 --seed 7 --preland-mode optimistic --preland-seconds 4.5 \
  --decision-seconds 1 --max-usd 5 --out runs/my-replay
python3 race.py --forge cloudflare --gateway $GW --policy beanstalk-v2 --preset demo --agent claude --model sonnet \
  --agents 12 --ci-seconds 60 --ci-slots 2 --seed 7 --budget-usd 75 --max-usd 80 --max-wall-minutes 60 \
  --protect-tests landed --preland-mode optimistic --preland-seconds 60 --decision-seconds 30 \
  --out runs/my-race
python3 kth_green.py runs/my-race
```

To stop everything at once: `curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" $GW/v1/admin/halt` (refuses new runs, stops runs in flight; `DELETE` the same route to resume).

Use `--policy queue --batch 4 --no-queue-hold` for the merge-queue baseline. Run options, the engine's settings and the driver contract are in [`research/race/REMOTE.md`](research/race/REMOTE.md) and [`packages/gateway/README.md`](packages/gateway/README.md).

## Licence

[FSL-1.1-ALv2](LICENSE.md) (Functional Source License, Apache-2.0 future licence), copyright 2026 Coop. You may read, use, modify and redistribute the code for any purpose **except a competing commercial product or service**, such as hosting Beanstalk as a service. Each version becomes Apache-2.0 two years after it is released.
