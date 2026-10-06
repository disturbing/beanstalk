# Beanstalk

An agent-first git forge on Cloudflare Workers and Artifacts, built for Cloudflare's "Build the next GitHub" competition.

When a dozen coding agents work on one codebase, a merge queue makes them wait in line. Beanstalk lets them land without waiting. It checks every change on the exact tree it would land on, sends a failure back to the agent that wrote the change with the change that broke it, and asks a human only when two specs genuinely disagree.

- A **bean** is one agent's change: a branch of the run's repository.
- The **sprout** is the staged line. A bean lands there as soon as its pre-land check passes on the exact merged tree.
- The **stalk** is the stable line. It moves only to sprout commits that passed validation, so the stalk stays honest.

## Measured, not projected

12 real Claude Code agents (Sonnet) worked the same 40 colliding tasks, every landed acceptance test protected, on three seeds (7, 11, 13). Every integration decision ran on the deployed Cloudflare prototype. The engine is v2.5 with dependency-aware starts, which is what `--preset demo` pins.

**Beanstalk shipped more (38–39 of 40 tasks green, against the queue's 35–37), and its 35th task was green 1.7–2.1x sooner on every seed. It finished about 1.3x sooner.**

| Seed | Run | Tasks green | 35th green | All done | Agent spend | Red validations | Final stalk correct |
|---|---|---|---|---|---|---|---|
| 7 | Batched merge queue | 36 of 40 | 35.0 min | 40.6 min | $4.12 | 10 | yes |
| 7 | Beanstalk v2.5 + dependency starts | **39 of 40** | **17.1 min** | **31.6 min** | $6.08 | 4 | yes |
| 11 | Batched merge queue | 35 of 40 | 29.2 min | 30.2 min | $4.51 | 8 | yes |
| 11 | Beanstalk v2.5 + dependency starts | **39 of 40** | **14.9 min** | **24.0 min** | $4.18 | 0 | yes |
| 13 | Batched merge queue | 37 of 40 | 36.8 min | 39.5 min | $4.54 | 10 | yes |
| 13 | Beanstalk v2.5 + dependency starts | **38 of 40** | **22.0 min** | **29.8 min** | $5.32 | 4 | yes |

The previous engine, v2.4 (`--preset v24`), was done sooner on the same seeds (17.7, 17.3 and 25.4 min) but shipped less: 37, 32 and 33 green, so it reached the 35th green only on seed 7 (15.2 min).

Read it with care:
- **Three seeds**, one run each. Seeds swing a lot: v2.5 + dependency starts reached its 35th green at 14.9 to 22.0 minutes.
- **A synthetic arena with short tasks.** The 40 tasks collide on purpose in a small TypeScript shop, and agents finish a task in tens of seconds. With 7x-longer tasks, a local experiment saw the lead shrink to 1.3–1.4x.
- **Cost is measured, and Beanstalk costs more:** $15.58 of agent spend over the three seeds against the queue's $13.16 (+18%; seed 11 was cheaper). The Cloudflare infrastructure of each v2.5 race, metered, was $0.35–0.42 on top.
- The agents ran on a laptop; only the decisions ran on Cloudflare.

The runs are in `research/race/runs/`: `cf-queue-sonnet-12-s7-landed`, `cf-queue-sonnet-12-s11`, `cf-queue-sonnet-12-s13`, `cf-v25dep2-sonnet-12-s7`, `-s11`, `-s13` and `cf-v24-sonnet-12-s7`, `-s11`, `-s13`; `python3 research/race/kth_green.py <runs> --k 35` reproduces the table. The partial v2.5 phases did worse than the full set, and the simulator over-predicted v2.5. That history, and every experiment behind these rules, is in [`docs/claude-opus/11-experiments-summary.md`](docs/claude-opus/11-experiments-summary.md).

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

Deploy everything (the gateway with its runner container, the web app, the MCP server and the site) to one account. Docker must be running: it builds the runner image.

```bash
npx wrangler login
npx wrangler whoami                          # lists your accounts and their ids
export CLOUDFLARE_ACCOUNT_ID=<account id>    # required: the script never guesses the account
node scripts/deploy-all.mjs                  # --dry-run checks without uploading; --only gateway,web
```

The account needs Workers Paid (Containers and Durable Objects), and Artifacts and Workers AI enabled. The script creates `packages/gateway/.dev.vars` (`ADMIN_TOKEN`, `RUN_TOKEN_SECRET`) and `packages/web/.dev.vars` (`DEMO_PASSWORD`, which unlocks decision cards) with random values when they are missing, uploads them as secrets with each deploy, points the MCP server's `WEB_URL` at the web app it just deployed, and prints the URLs. Keep the `.dev.vars` files: the race driver reads `ADMIN_TOKEN` from the gateway's.

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
