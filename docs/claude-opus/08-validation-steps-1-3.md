# Validation, steps 1–3: verdict

**Status (2026-10-03):** steps 1–3 of the ladder in `research/README.md` were built and run by the research sessions (scripts, data contracts and outputs in `research/`). This document is the lead's audit of those results, with the numbers that decide the design. Step 4 (real agents) is in progress; see §5.

**Labels:**
- **measured:** taken from real history or real runs.
- **simulated:** produced by `research/contention-sim`.
- **private:** the `platform` corpus is private. Only aggregate numbers appear here; module names are replaced by ranks.

---

## The one-paragraph verdict

Contention between concurrent changes is real and it clusters, so the problem exists. But a change's *modules* can't be predicted well enough from its title to place work usefully. The simulator agrees: placement adds nothing.

What wins, in simulation, is the other half of the thesis: **land without blocking on a fast trunk, validate asynchronously, and promote a verified green.** It beats the best batched merge queue by 1.6–1.8x at 20 agents, 1.8–2.5x at 100 and 3–8x at 1,000. It fails the 1.5x bar at 5 agents.

**Keep the fast trunk and drop module-level placement.** File-level prediction, Jev, and real-agent behavior are the open questions.

## 1. Step 1: do concurrent changes collide? (measured)

Method: windows of W = 20 consecutive merged changes. Each pair is tested by *leave-one-out revert* (revert the earlier change from the later change's parent, then re-apply the later one). Pairs where a change between them built on the earlier one count as **entangled** and are excluded from pairwise rates. Hot-file **merge drivers** (union for changelogs, regenerate for lockfiles and generated files) are applied as a separate column.

| Corpus | Changes | Pairwise conflict | Changes colliding with ≥ 1 concurrent predecessor | Built on another change in the window | Conflicts in top-3 modules | Removed by merge drivers |
|---|---|---|---|---|---|---|
| platform (private, agent-heavy TS monorepo) | 2,590 | 5.9% | **51%** | 49% | **72%** | 2.4% |
| workers-sdk (human-led TS monorepo) | 1,286 | 1.2% | 14% | 13% | 49% | 13% |
| codex (Rust, very high velocity) | 6,777 | 1.6% | 18% | 17% | 47% | 8.5% |
| arena (designed demo repo, 40 tasks) | 40 | 7.4% | (one window) | 0% | 78% | 38% |

**What matters for design:**
- **A shared file is required for a conflict.** Pairs that share a *file* conflict 18–51% of the time; pairs that share only a *module* conflict ≈0% (platform: 1 in 9,421). So any footprint that decides placement must be at file level.
- **The agent-heavy repo is far more contended** than the human-led ones. Half its changes would collide with a concurrent one, and half build on another change in the same window. This is the shape thousands of agents produce.
- **Hot-file drivers help on the public repos (8–13%) and barely on platform (2.4%).** Platform's conflicts sit in source and package manifests, not lockfiles or changelogs.
- **Semantic breaks** (merges cleanly, fails tests) were measured only on the arena: 7 of 722 clean pairs, about 1%. They are unmeasured on real repos; the simulator sweeps them.

## 2. Step 2: can a change's footprint be predicted from its title alone? (measured)

Methods: prior (recent frequency), lexical, kNN over earlier changes, co-change, and a blend. All are tuned on an earlier slice and evaluated on the last 50% by merge order, using only information available before the change.

| Corpus | Best module-level F1 (method) | Recall at the tuned threshold | Pair lift: predicted module overlap | Pair lift: oracle module overlap | Pair lift: oracle *file* overlap |
|---|---|---|---|---|---|
| platform | 0.54 (blend) | 0.49 | 1.2–1.5x | 2.2x | **11.4x** |
| workers-sdk | 0.66 (blend) | 0.58 | 1.0–1.2x | 1.4x | **17.9x** |
| codex | 0.50 (blend) | 0.47 | 1.6–3.0x | 2.9x | **13.4x** |

**Verdict: the module-level kill condition is met** (recall below 0.6 at a useful precision, and conflicting pairs no better flagged than clean ones). Even a *perfect* module predictor separates conflicting pairs only 1.4–2.9x, because most clean pairs share a module too. Only file-level overlap discriminates (11–18x). File-level prediction was **not tested**, and Jev was **never actually run** (3 calls, 3 failures). Those are the two open items for this step.

## 3. Step 3: does Beanstalk beat a good merge queue? (simulated)

`research/contention-sim` is a discrete-event simulator. Every policy gets the same agents, CI slots, backlog and failure model, with common random numbers. It is calibrated per corpus from steps 1–2. Throughput counts only changes that reach a **validated green**.

**Beanstalk against the *best* queue configuration at each N:** serial, batched k = 1/4/16, AIMD, speculative-parallel, partitioned, with placement, "released" authors, suspect-aware.

| Agents (N) | platform (private) | workers-sdk | codex | Kill line |
|---|---|---|---|---|
| 5 | 1.42x | 1.42x | 1.45x | **fails** (< 1.5x) |
| 20 | 1.66x | 1.70x | 1.62x | passes, narrowly |
| 100 | 1.83x | 2.54x | 2.29x | passes |
| 500 | 3.02x | 6.58x | 5.92x | passes |
| 1,000 | 3.38x | 7.84x | 7.42x | passes |

**Where the gain comes from:**
- "Beanstalk without placement" scores the same as Beanstalk, so **placement contributes nothing.**
- The queue's ceiling is set by red changes. About 25–30% of agent changes fail CI (15% on their own, plus conflicts and semantic breaks), and each red resets the speculative pipeline. The best queue plateaus around 17–24 green changes an hour no matter how many agents or CI slots it gets. The fast trunk keeps landing and fixes forward.

**What it costs (platform, N = 5):**
- **Latency to green:** done→green p50 is 34 min, against 13 min for the queue.
- **Staleness:** green is about 3x staler, time-averaged.
- **Red age:** the oldest red reaches 47 min.

Beanstalk trades latency for throughput.

### Audit notes (the lead's checks)

1. **Fairness of the baseline.**
   - The queue is strong: speculative batches stacked across CI slots, with K-ary bisection.
   - Variants where queue agents don't wait for their own change ("released") score no better, so the result isn't an artifact of idle agents.
   - The queue's limit is red resets, not blocking.
2. **Sensitivity to the self-failure rate,** the biggest assumption (default 15%, anchored to CircleCI's 70.8% main-branch success). At 5% Beanstalk still wins 2.2–2.8x; at 30%, about 2.5x (default parameters, N = 20 and 100).
3. **Prior art, stated honestly.** Landing first and validating afterwards with culprit finding is how large monorepos already run post-submit testing (Google's TAP, Chromium's sheriffs). The simulation shows that model beats gatekeeping queues *at agent failure rates*. It doesn't make the fast trunk novel. The novelty has to come from agent-specific repair (causal tickets, fixers, the error budget) and from what humans see.
4. **Untested assumptions:**
   - 10-minute CI;
   - 20-minute median task;
   - 1% semantic-break rate per overlapping pair (swept 0–20%);
   - fixer cost of 0.4x the original work;
   - that fixers succeed.

   Step 4 checks the last two with real agents.

## 4. What this changes in the design

| Thesis element (`02`) | Verdict | Action |
|---|---|---|
| Placement by predicted *module* footprint | **Fails** (steps 2 and 3) | Drop from the demo. Test *file*-level prediction before reviving it |
| Fast trunk, asynchronous validation, prefix-promoted green | **Strong in simulation** (1.6–8x above 20 agents) | Core of the build. Show the latency trade honestly |
| Error-budget controller | Neutral to slightly negative in simulation (no-budget variants score higher) | Keep as a safety valve; tune in step 4 |
| Read-set causal repair tickets | Real-agent data in step 4 (15 closed, 4 escalated in the first run) | Measure fixer cost per red |
| Hot-file merge drivers | Small but free (2–13% of conflicts) | Keep |

## 5. Step 4: real agents (measured)

All runs use the 40 colliding arena tasks, headless Claude Code agents, emulated CI of 60 s with 2 slots, and the same seed unless stated. "Landed" protection means agents can't change any landed acceptance test; the harness restores edits and counts them. The race metric is **time and money to the k-th verified green**, because green per hour over unequal run lengths misleads. Script: `research/race/kth_green.py`.

### 5.1 How the policy evolved

| Run (Sonnet, 12 agents, landed protection) | 20th green | 30th green | Done | Greens | Cost | Red validations | Final green correct |
|---|---|---|---|---|---|---|---|
| Queue (batched, speculative, bisecting), seed 7 | 5.2 min | 10.4 min | 16.5 min | 37 | $4.42 | 7 | yes |
| Beanstalk as specified (fix forward) | not reached | not reached | collapsed (2 greens) | 2 | $6.71 | 8 | yes |
| + pre-land check (author repairs; check free, ~2 s, inside the lock) | 2.2 min | 3.3 min | 4.3 min | 36 | $4.50 | 0 | yes |
| **v2** = pre-land + informed author repair + decision cards + revert-first (check free) | 2.3 min | 3.3 min | 3.3 min | 37 | $4.13 | 0 | yes |

**The original policy collapses with real agents, with Haiku and Sonnet alike.** Coupled tasks land red, fix-forward fixers thrash, and green freezes within minutes. Checking the merged tree before landing, and handing failures back to the *author* with the conflicting landed change's intent and diff, removes the red trunk entirely.

### 5.2 The fair comparison: the pre-land check costs what CI costs

The runs above give the pre-land check the suite's real ~2 s while queue CI pays 60 s, which flatters v2. In the fair version, each check costs **60 s, the same as CI**. Checks run **in parallel on each agent's sandbox**, outside the committer lock; landing re-merges if the trunk moved and re-checks only on file overlap (`PRELAND_MODE=optimistic`).

| Run (Sonnet, 12 agents, landed) | 20th green | 30th green | Done | Greens | Cost | Red validations | p90 task start → green |
|---|---|---|---|---|---|---|---|
| Queue, seed 7 | **5.2 min** | 10.4 min | 16.5 min | 37 | **$4.42** | 7 | — |
| v2 fair, seed 7 | 7.3 min | **9.7 min** | **11.3 min** | 35 | $5.29 | 1 | 6.1 min |
| Queue, seed 11 | **4.2 min** | 20.5 min | 34.7 min | 34 | **$4.10** | 14 | 21.1 min |
| v2 fair, seed 11 | 9.4 min | **10.9 min** | **14.0 min** | 34 | $5.62 | 2 | 6.5 min |

**What it says:**
- **v2 finishes 1.5–2.5x sooner, with a far shorter and steadier tail.** p90 task-to-green is about 6 min against 21 min on the queue's bad seed. The queue's own variance is large (16.5 vs 34.7 min to done on two seeds), as the earlier report warned.
- **The queue is faster to the *first* greens.** A v2 task waits for a 60 s check before landing and a 60 s validation before green; a queue task waits only for its batch's CI. v2's advantage appears as contention and reds accumulate.
- **v2 costs 20–37% more in agent spend.** It does more informed reworks (16–20, against the queue's ejections), where the queue gives up on tasks sooner.
- **v2 uses about twice the test compute:** 84–95 min of agent-side checks plus about 18 min of CI, against 30–53 min of CI for the queue. That's the design trade, verification moved onto every agent's sandbox, and should be stated.
- **Each v2 run raised one decision card,** where informed reworks failed twice on the same pair. Revert-first fired once or twice, and green never froze. Every final green was correct.

### 5.3 Verdict on step 4

| Kill condition | Result |
|---|---|
| Real agents contradict the simulator | **Yes, for the policy as specified** (repair costs 7x a task, fixers rarely succeed, green freezes). **No, for v2**, which keeps the trunk honest and wins on time to done |
| ≥ 1.5x the queue on a comparable throughput measure | **Met on time to done** (1.46x and 2.48x at 12 agents, fair checks). **Not met on time to the first greens**, where the queue is faster. Higher agent cost (+20–37%) and about 2x test compute |

The design that survives contact with real agents is the fast trunk with verification moved to the author before landing, revert-first on the trunk, and humans deciding genuine spec contradictions. It isn't placement, and it isn't fix forward. The 20-agent runs follow in §5.4.

### 5.4 Scaling to 20 agents (fair checks, seed 7)

| Run (Sonnet, 20 agents, landed) | 20th green | 30th green | 35th green | Done | Greens | Cost | Red validations | p90 task start → green | CI minutes |
|---|---|---|---|---|---|---|---|---|---|
| Queue | 7.3 min | 15.4 min | 23.6 min | 25.6 min | 36 | $4.28 | 10 | 18.3 min | 40.2 |
| **v2 fair** | **5.3 min** | **7.4 min** | **9.8 min** | **11.5 min** | 36 | **$4.11** | **0** | **7.0 min** | 16.2 (+ agent-side checks) |

At 20 agents v2 leads at every milestone:
- 1.4x to the 20th green;
- 2.1x to the 30th;
- 2.4x to the 35th;
- 2.2x to done.

It also costs slightly less, with no red validation and no decision card in this run. The queue's tail grows with concurrency (p90 18 min) while v2's stays flat (about 7 min). This is the scaling shape the simulator predicted for the non-blocking part of the thesis, now measured with real agents at the top of the 10–20 range.

**Summary across the fair runs:** v2 is 1.5–2.5x faster to done at 12 and 20 agents, the gap widens with concurrency, and every final green was correct. Its costs are higher agent-side test compute and, at 12 agents, slower first greens.

**Total agent spend for step 4 (this session):** about $60 at list price, billed as Claude extra usage, across 13 Sonnet races of 40 tasks each. The research subagent's earlier Haiku races were about $61.

### 5.5 The same race on the Cloudflare prototype (measured)

Every integration decision is made on Cloudflare: the gateway Worker, the RunDO engine, Artifacts and the runner containers (`packages/gateway`, `packages/gateway/container`). Twelve real Sonnet sessions run on the laptop through the driver (`research/race/harness/remote.py`).

**Parity first.** With free replay agents, the cloud and local forges made the same decisions:

| Replay, 8 agents, seed 7 | Queue: green / landed / dropped | v2: green / landed / dropped |
|---|---|---|
| Local | 25 / 25 / 15 | 25 / 25 / 15 |
| Cloud | 25 / 25 / 15 | 25 / 25 / 15 |

**Final comparison**, every landed test protected on both sides:

| Cloudflare, Sonnet, 12 agents, seed 7 | 20th green | 30th green | 35th green | Done | Greens | Cost | Red validations | Final stalk correct |
|---|---|---|---|---|---|---|---|---|
| Queue | 13.0 min | 19.9 min | 35.0 min | 40.6 min | 36 | $4.12 | 10 | yes |
| **v2** | **11.3 min** | **13.8 min** | **17.7 min** | **17.5 min** | 35 | $5.00 | 3 | yes |

On the deployed prototype, v2 is 2.3x faster to done and faster at every milestone, and costs about 21% more.

**Bugs found and fixed on the way:**
- Late Artifacts forks were unreadable, so beans became branches of the run repo.
- One task's infrastructure failure aborted the race; now it drops only that task.
- Leftover idle runners exhausted the container cap; the cap is now 48 and idle runners sleep after 2 min.
- An Artifacts "stored delta chain contains a cycle" error on a revert push; the runner now pushes whole objects (`exp/artifacts-delta-cycle-bug.md`).

Earlier cloud runs that hit these (`cf-v2-sonnet-12-s7`, `-r2`) are kept but excluded from the comparison.
