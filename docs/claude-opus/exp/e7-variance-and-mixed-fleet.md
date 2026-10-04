# E7: variance of "v2 beats the queue", and a mixed Claude + Codex fleet

**Status (2026-10-03, 21:30 HKT): both parts are measured.** Part A has five clean seed pairs (3, 5, 7, 11, 13); the first seed-3 pair ran under a load average near 390, is flagged, and was re-run. Part B has one queue and one v2 race with the mixed fleet. Code, drivers, raw runs and analysis: `research/exp/e7-variance-mixed/` (`race/` is the harness copy, `analysis/` the statistics and a unified diff of the harness changes).

Naming (Coop's): a **bean** is one agent's change in its workspace; the **sprout** is the staged line (the harness's "trunk"); the **stalk** is the stable line (the harness's "green"). A "green" in the tables is a bean verified on the stalk, so "20th green" is when the 20th bean reaches the stalk.

## 1. Verdicts

**A. "v2 beats the queue" is reliable for time to done, and only for that.** (Numbers below are for the clean pairs listed in 2.2.)
- v2 reached done first in **5 of 5** pairs. The paired queue/v2 ratio of time to done has a geometric mean of **1.98x** (bootstrap 95% CI 1.68 to 2.28; t-interval on the logs 1.55 to 2.54) and ranges from 1.46x to 2.48x over seeds. Unpaired, with runs resampled independently, the ratio of means is 2.03x (1.60 to 2.44), exact permutation p = 0.008 (the smallest a 5-against-5 comparison can give).
- The queue is the noisy one: its time to done ranged from 16.5 to 34.7 min (sd 6.6), v2's from 11.3 to 14.4 min (sd 1.3). The queue's time rises with its red batches (7 reds: 16.5 min; 10 to 12 reds: 27 to 28 min; 14 reds: 34.7 min), each of which cancels the speculative batches behind it.
- v2 is **not** faster early. The queue reached the 20th green first in 4 of 5 pairs (queue/v2 = 0.75, CI 0.56 to 0.95). The mean stalk-size curves cross at about minute 9, v2 wins the 30th green in 5 of 5 pairs (1.32x, CI 1.12 to 1.58, but by under 10% in two of them), and the lead grows toward the tail (35th green 1.86x over the 3 pairs where both reached it, done 1.98x).
- v2 costs more: +12% on average (geometric mean 1.12, CI 0.99 to 1.26; from -8% to +37% per pair), cheaper in 1 of 5 pairs.
- With real agents the seed does almost nothing (2.1), so seeds 7 and 11 were repeats of one configuration and the new seeds use `--shuffle`.

**B. Mixed fleet (6 Claude Sonnet + 6 Codex, seed 7, id order): v2 beat the queue here too, and cross-vendor collisions were not shown to be worse.**
- Codex works non-interactively (logged in with ChatGPT; default model `gpt-6.1-sol`, default reasoning effort, confirmed from Codex's own session logs for all 55 invocations). No Codex invocation failed.
- v2 finished in 15.2 min against 23.6 min for the queue (1.55x), with 36 greens each and a correct final stalk. The Claude-only ratios at the same seed and order were 1.46x (seed 7) and 2.48x (seed 11).
- Per vendor, first attempts were equally good (queue run 40 of 40 pass their own acceptance tests; v2 run 39 of 40). The vendors differ in speed and cost: Codex invocations take about twice as long (median first attempt 38 to 42 s against 17 to 22 s), make smaller changes (1.6 against 2.2 to 2.5 files, 0.3 against 0.7 to 0.85 hot files) and cost 24% to 32% less per first attempt at the adapter's assumed price.
- Cross-vendor pairs conflicted 3.0% of the time against 2.1% for same-vendor pairs over the two runs (relative risk 1.4, 95% CI 0.6 to 3.3, p = 0.51). The queue run leaned the measured-history way (3.4% against 1.6%; among pairs that touch a common file, 39% against 14%), the v2 run leaned the other way (2.2% against 3.7%; 12% against 25%). The history figures (41.7% against 19.8%) are neither reproduced nor ruled out: this arena has too few file-sharing pairs.

## 2. Part A: variance of v2 against the queue

### 2.1 Setup, and what the seed does

Same configuration as the earlier fair runs: 12 Sonnet agents, the 40 colliding arena tasks, `--protect-tests landed`, emulated CI 60 s on 2 slots, `--max-wall-minutes 45`. Queue: `--batch 4 --no-queue-hold`. v2: `PRELAND_MODE=optimistic PRELAND_SECONDS=60 --snapshot head --error-budget 999` (pre-land checks cost what CI costs, run in parallel on each agent's own sandbox). `--budget-usd 15` per run (never near binding).

**With real agents the seed does almost nothing.** `--seed` is read in two places only, the replay adapter's delays and `--shuffle`'s permutation of task priority. Nothing seeds the model, and which agent takes which task follows from who is free first. Seeds 7 and 11 (id order, no `--shuffle`) were therefore two repeats of one configuration, and "paired by seed" only pairs two runs of the same task order.

**Decision: the new seeds (3, 5, 13) use `--shuffle`, for both policies.** The seed then fixes one task order that queue and v2 share (a real pair), and the orders carry different contention. Of the 66 task pairs in the first wave of 12 simultaneous tasks, those whose reference solutions touch a common file number 21 in id order (seeds 7 and 11), 15 for seed 3, 19 for seed 5 and 7 for seed 13 (arena average 16). The cost is that the pairs mix two conditions (id order for seeds 7 and 11, shuffled for the rest); they are shown per seed and pooled.

**Environment.** Seeds 7 and 11 were run one at a time from one script on an effectively idle machine (median suite run 0.6 to 1.0 s, Claude CLI start-up 230 to 330 ms). The new runs shared the machine with other experiments' races under the coordinator's slot rules (FIFO slots, one slot per race, my races strictly one at a time). Start and end `uptime` and 30-second load samples are recorded per run (load table below). Seeds 5 and 13 saw median suite times of 1.8 to 3.1 s and CLI start-up of 470 to 740 ms. **The first seed-3 pair ran concurrently with each other and with other experiments' races at a 5-minute load average of 389 (suite 17 to 19 s, CLI start-up 14 to 16 s); it is flagged and listed separately, and the seed-3 pair used here is its re-run (20:39 to 21:20 HKT: the queue at a mean load average of 5.8, max 12; v2 at a mean of 21, max 48, so the load was, if anything, heavier for v2).**

**Outage check.** On 2026-10-03 at about 15:21 HKT Claude Code and Codex both failed with 403s (section 4). None of the runs used here overlapped it: in every one of them each invocation reports `is_error: false` with a non-zero cost, and no transcript contains "Failed to authenticate" or "Request not allowed". None of the v2 runs has a CI error, an abort or a crashed-suite ticket, so none was hit by the CI index-lock bug E2 found (the fix is in the copy used for later runs).

### 2.2 Per-seed results, aggregates, paired ratios, mechanism, load

Times are minutes from race start; "n/a" means the run ended with fewer greens than that (34 greens cannot reach a 35th). "Red validations" is the harness's count of failed validation or batch runs on CI; it does not include v2's red pre-land checks, which are repaired before landing (they are in the mechanism table). Seeds 7 and 11 are the earlier runs (`research/race/runs/opus-queue-sonnet-12-landed`, `-s11`, `opus-v2fair-sonnet-12-s7`, `-s11`); the others are in `research/exp/e7-variance-mixed/race/runs/`. The bootstrap resamples the seeds with replacement (all n^n resamples, so it is exact for the sample) and cannot reach beyond the observed ratios; the t-interval on the log ratios is shown beside it for that reason.

<!-- A-TABLES:BEGIN -->

#### Primary view: clean runs only (seeds 3, 5, 7, 11, 13)

##### Per-seed runs

| Seed (order) | Policy | 20th green | 30th green | 35th green | Done | Greens | Cost | Red validations | Dropped | Correct | Note |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 3 (shuffled) | queue | 8.3 | 13.4 | 27.6 | 27.6 | 36 | $4.35 | 11 | 4 | True |  |
| 3 (shuffled) | v2 | 7.6 | 9.7 | n/a | 12.4 | 34 | $3.99 | 3 | 6 | True |  |
| 5 (shuffled) | queue | 6.6 | 12.0 | 24.9 | 28.0 | 36 | $4.87 | 10 | 4 | True |  |
| 5 (shuffled) | v2 | 7.6 | 10.9 | 13.2 | 14.4 | 37 | $5.60 | 2 | 3 | True |  |
| 7 (id) | queue | 5.2 | 10.4 | 15.5 | 16.5 | 37 | $4.42 | 7 | 3 | True |  |
| 7 (id) | v2 | 7.3 | 9.7 | 11.3 | 11.3 | 35 | $5.29 | 1 | 5 | True |  |
| 11 (id) | queue | 4.2 | 20.5 | n/a | 34.7 | 34 | $4.10 | 14 | 6 | True |  |
| 11 (id) | v2 | 9.4 | 10.9 | n/a | 14.0 | 34 | $5.62 | 2 | 6 | True |  |
| 13 (shuffled) | queue | 4.3 | 11.6 | 27.0 | 27.0 | 35 | $4.39 | 12 | 5 | True |  |
| 13 (shuffled) | v2 | 5.4 | 9.0 | 10.8 | 13.8 | 37 | $4.48 | 0 | 3 | True |  |

##### Aggregates over seeds (mean [min, max], sd, n reached)

| Metric | queue | v2 |
|---|---|---|
| 20th green (min) | 5.7 [4.2, 8.3], sd 1.7 | 7.5 [5.4, 9.4], sd 1.4 |
| 30th green (min) | 13.6 [10.4, 20.5], sd 4.0 | 10.0 [9.0, 10.9], sd 0.9 |
| 35th green (min) | 23.7 [15.5, 27.6], sd 5.7 (n=4 of 5) | 11.8 [10.8, 13.2], sd 1.3 (n=3 of 5) |
| time to done (min) | 26.8 [16.5, 34.7], sd 6.6 | 13.2 [11.3, 14.4], sd 1.3 |
| cost ($) | 4.43 [4.10, 4.87], sd 0.28 | 5.00 [3.99, 5.62], sd 0.73 |
| red validations | 10.8 [7.0, 14.0], sd 2.6 | 1.6 [0.0, 3.0], sd 1.1 |
| red pre-land checks (v2) / red batches (queue) | 10.8 [7.0, 14.0], sd 2.6 | 16.2 [12.0, 23.0], sd 4.3 |
| CI minutes | 40.0 [25.4, 52.7], sd 9.7 | 19.6 [18.2, 23.4], sd 2.2 |
| agent-side check minutes (v2) | n/a | 86.5 [82.3, 95.4], sd 5.2 |
| greens | 35.6 [34.0, 37.0], sd 1.1 | 35.4 [34.0, 37.0], sd 1.5 |
| dropped | 4.4 [3.0, 6.0], sd 1.1 | 4.6 [3.0, 6.0], sd 1.5 |
| textual conflicts | 22.6 [20.0, 26.0], sd 2.2 | 14.6 [10.0, 21.0], sd 4.4 |
| rework invocations | 29.0 [27.0, 30.0], sd 1.4 | 28.6 [19.0, 37.0], sd 8.1 |

##### Paired by seed: queue / v2 (>1 means v2 is faster); cost is v2 / queue

| Metric | seed 3 | seed 5 | seed 7 | seed 11 | seed 13 | geometric mean [bootstrap 95% CI] | t interval on logs | v2 faster in |
|---|---|---|---|---|---|---|---|---|
| 20th green | 1.09 | 0.87 | 0.71 | 0.45 | 0.80 | 0.75 [0.56, 0.95] | [0.50, 1.13] | 1 of 5 |
| 30th green | 1.38 | 1.09 | 1.07 | 1.88 | 1.29 | 1.32 [1.12, 1.58] | [0.99, 1.74] | 5 of 5 |
| 35th green | n/a | 1.89 | 1.37 | n/a | 2.51 | 1.86 [1.47, 2.36] | [0.88, 3.96] | 3 of 3 |
| done | 2.23 | 1.95 | 1.46 | 2.48 | 1.96 | 1.98 [1.68, 2.28] | [1.55, 2.54] | 5 of 5 |
| p90 task start to green | 2.74 | 2.85 | 2.08 | 3.27 | 1.68 | 2.45 [1.95, 2.98] | [1.76, 3.42] | 5 of 5 |
| cost (v2 / queue) | 0.92 | 1.15 | 1.20 | 1.37 | 1.02 | 1.12 [0.99, 1.26] | [0.93, 1.36] | v2 cheaper in 1 of 5 |
| red validations (queue, v2) | 11, 3 | 10, 2 | 7, 1 | 14, 2 | 12, 0 | mean difference 9.2 [7.2, 11.2] | | |

##### Unpaired view (runs resampled independently within a policy)

| Metric | ratio of means | 95% CI | exact permutation p (two-sided) |
|---|---|---|---|
| 20th green, queue / v2 | 0.77 | [0.58, 1.01] | 0.103 |
| 30th green, queue / v2 | 1.35 | [1.09, 1.72] | 0.024 |
| 35th green, queue / v2 | 2.02 | [1.54, 2.44] | 0.057 |
| done, queue / v2 | 2.03 | [1.60, 2.44] | 0.008 |
| cost, v2 / queue | 1.13 | [0.99, 1.27] | 0.135 |

##### Flagged first runs of re-run seeds

- seed 3 queue (first run, concurrent and under very high load): 20th 12.5, 30th 15.7, 35th 24.8, done 25.8 min, 36 greens, $4.38, 7 red validations
- seed 3 v2 (first run, concurrent and under very high load): 20th 13.5, 30th 19.9, 35th n/a, done 22.0 min, 34 greens, $4.19, 0 red validations

##### Greens on the stalk after m minutes (clean runs)

| Run | 5 min | 10 min | 15 min | 20 min | 25 min | 30 min | 35 min |
|---|---|---|---|---|---|---|---|
| seed 3 queue | 11 | 27 | 30 | 33 | 34 | 36 | 36 |
| seed 3 v2 | 14 | 32 | 34 | 34 | 34 | 34 | 34 |
| seed 5 queue | 14 | 25 | 31 | 33 | 35 | 36 | 36 |
| seed 5 v2 | 14 | 22 | 37 | 37 | 37 | 37 | 37 |
| seed 7 queue | 16 | 28 | 34 | 37 | 37 | 37 | 37 |
| seed 7 v2 | 8 | 31 | 35 | 35 | 35 | 35 | 35 |
| seed 11 queue | 21 | 21 | 26 | 28 | 31 | 34 | 34 |
| seed 11 v2 | 11 | 24 | 34 | 34 | 34 | 34 | 34 |
| seed 13 queue | 22 | 27 | 32 | 33 | 34 | 35 | 35 |
| seed 13 v2 | 19 | 33 | 37 | 37 | 37 | 37 | 37 |
| **mean, queue** | **16.8** | **25.6** | **30.6** | **32.8** | **34.2** | **35.6** | **35.6** |
| **mean, v2** | **13.2** | **28.4** | **35.4** | **35.4** | **35.4** | **35.4** | **35.4** |

##### What happened inside each run

| Run | Policy | Done (min) | Red batches | Cancelled speculative batches | Bisection CI runs | Ejections (conflict / red) | Held behind in-flight | Drops |
|---|---|---|---|---|---|---|---|---|
| seed 3 shuffled | queue | 27.6 | 11 | 3 | 20 | 20 / 11 | 12 | 4 |
| seed 5 shuffled | queue | 28.0 | 10 | 4 | 15 | 22 / 10 | 12 | 4 |
| seed 7 id | queue | 16.5 | 7 | 3 | 5 | 26 / 7 | 10 | 3 |
| seed 11 id | queue | 34.7 | 14 | 6 | 24 | 22 / 14 | 15 | 6 |
| seed 13 shuffled | queue | 27.0 | 12 | 4 | 15 | 23 / 12 | 10 | 5 |

| Run | Policy | Done (min) | Pre-land checks (red) | Re-checks after the sprout moved | Optimistic landings | Informed reworks | Decision cards | Revert-first | Drops | Agent-side check minutes |
|---|---|---|---|---|---|---|---|---|---|---|
| seed 3 shuffled | v2 | 12.4 | 82 (13) | 23 | 32 | 9 | 1 | 1 | 6 | 84.0 |
| seed 5 shuffled | v2 | 14.4 | 83 (16) | 19 | 30 | 14 | 0 | 1 | 3 | 87.1 |
| seed 7 id | v2 | 11.3 | 83 (17) | 12 | 31 | 16 | 1 | 1 | 5 | 83.9 |
| seed 11 id | v2 | 14.0 | 94 (23) | 25 | 29 | 20 | 1 | 1 | 6 | 95.4 |
| seed 13 shuffled | v2 | 13.8 | 78 (12) | 19 | 31 | 11 | 1 | 0 | 3 | 82.3 |

Queue, clean runs: Spearman rank correlation between red batches and time to done = 0.60 (n = 5).

##### Machine load per run

| Run | `uptime` at start (HH:MM, 1/5/15-min load) | `uptime` at end | 1-min load, mean / max of 30 s samples | suite s (median, p90) | Claude CLI startup ms (median) | Flag |
|---|---|---|---|---|---|---|
| e7-queue-claude-12-s3-shuf | 20:39, load 1.02 1.39 1.52 | 21:07, load 7.11 6.22 5.32 | 5.8 / 12.4 | 0.9, 1.6 | 260 |  |
| e7-queue-claude-12-s5-shuf | 13:26, load 163.31 154.78 238.33 | 13:54, load 10.22 27.40 69.12 | 56.8 / 195.1 | 3.1, 9.3 | 740 |  |
| opus-queue-sonnet-12-landed | not recorded | not recorded | not recorded / n/a | 0.8, 1.4 | 332 |  |
| opus-queue-sonnet-12-s11 | not recorded | not recorded | not recorded / n/a | 1.0, 1.4 | 294 |  |
| e7-queue-claude-12-s13-shuf | 15:48, load 9.69 31.40 63.60 | 16:15, load 5.97 7.05 17.34 | 12.8 / 45.1 | 1.8, 3.5 | 474 |  |
| flagged-highload-e7-queue-claude-12-s3-shuf | not recorded | not recorded | not recorded / n/a | 17.6, 27.8 | 15688 | concurrent + very high load |
| e7-v2-claude-12-s3-shuf | 21:07, load 7.11 6.22 5.32 | 21:20, load 2.50 12.95 13.26 | 21.0 / 48.4 | 0.8, 3.5 | 344 |  |
| e7-v2-claude-12-s5-shuf | 14:26, load 7.61 8.23 18.19 | 14:41, load 44.25 60.11 50.53 | 65.1 / 159.0 | 2.9, 6.3 | 589 |  |
| opus-v2fair-sonnet-12-s7 | not recorded | not recorded | not recorded / n/a | 0.6, 1.2 | 228 |  |
| opus-v2fair-sonnet-12-s11 | not recorded | not recorded | not recorded / n/a | 0.7, 1.5 | 266 |  |
| e7-v2-claude-12-s13-shuf | 17:01, load 14.03 16.97 20.04 | 17:15, load 5.93 34.92 38.63 | 54.2 / 173.0 | 2.4, 7.9 | 510 |  |
| flagged-highload-e7-v2-claude-12-s3-shuf | not recorded | not recorded | not recorded / n/a | 19.4, 26.2 | 13586 | concurrent + very high load |

<!-- A-TABLES:END -->

### 2.3 Reading the tables

- **Where the gap comes from.** The queue pays per red: each red batch cancels the speculative batches behind it and triggers bisection probes, so its tail grows with the number of reds (rank correlation of red batches with time to done is 0.60 over the five clean queue runs; descriptive only). v2 turns the same collisions into agent-side repair before landing (the pre-land checks in the mechanism table, most of them repaired in one informed rework), at the price of about 87 minutes of agent-side test time against about 40 CI minutes for the queue.
- **A floor shared by both policies.** Three tasks (t032, t010, t036) are dropped in most runs under both policies (over the 10 clean runs: 9, 8 and 7). They are the arena's designed spec contradictions, which no policy resolves without a human, and they cap the greens at about 37.
- **Load.** The new runs were slower per test run than seeds 7 and 11, so absolute minutes are not strictly comparable across the two groups; ratios within a pair (which ran under similar load) are the safer comparison.

## 3. Part B: mixed fleet

### 3.1 What was built and checked

`--agent mixed` (in `race/`): even agent slots (a0, a2, ...) run Claude Code with `--model` (Sonnet), odd slots run `codex exec --json` with its default model, so 12 agents are 6 and 6. The vendor of every invocation is in `invocation.start`, the slot map in `race.start`; a Claude session is resumed only on a Claude slot, so a Codex rework (or a rework that lands on a different vendor's slot under `--no-queue-hold`) starts a fresh session with the full-context prompt. Tested free first: 17 unit tests with fake Claude and Codex CLIs (routing, resume rules, outage and usage-limit stops), two replay races, and a real 4-agent smoke race.

**Codex CLI check (before any spend).** `codex login status`: "Logged in using ChatGPT"; codex-cli 0.159.3. A free-standing `codex exec --json` test (create a file, reply "done") exited 0 in 19 s; the harness's own flags (`--ignore-user-config --ignore-rules -s workspace-write`, network off, plugins and apps disabled) worked on a real arena task (t008: 36 s, `node --test` passes, 82 tests). With user config ignored the default model is `gpt-6.1-sol` at the model's default reasoning effort; Codex's session logs confirm this for every invocation of both races.

Races: queue and v2 settings as in 2.1, `--agent mixed --seed 7`, no `--shuffle` (id order, so the Claude-only seed-7 pair is the direct comparison), one at a time, pre-flight check passed before each.

### 3.2 Queue against v2 under the mixed fleet

| Run | 20th green | 30th green | 35th green | Done (min) | Greens | Dropped | Red validations | Textual conflicts | Rework invocations | Cost: Claude + Codex (estimated) | Final stalk correct | Load average (1 min) at start / end |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| queue, mixed | 8.3 | 17.5 | 21.5 | 23.6 | 36 | 4 | 8 | 23 | 27 | $3.11 + $0.89 = $4.00 | yes | 8.1 / 8.5 |
| v2, mixed | 8.6 | 11.6 | 13.6 | 15.2 | 36 | 4 | 3 | 21 | 33 | $3.04 + $1.51 = $4.55 | yes | 29.1 / 3.3 |
| queue, Claude only, seed 7 | 5.2 | 10.4 | 15.5 | 16.5 | 37 | 3 | 7 | 26 | 30 | $4.42 | yes | idle |
| v2, Claude only, seed 7 | 7.3 | 9.7 | 11.3 | 11.3 | 35 | 5 | 1 | 21 | 37 | $5.29 | yes | idle |

Queue / v2 under the mixed fleet: 0.97x to the 20th green, 1.51x to the 30th, 1.58x to the 35th, **1.55x to done** (Claude-only seed 7: 0.71x, 1.07x, 1.37x, 1.46x; five clean seeds: queue/v2 1.98x, see 2.2). One pair is one observation: the mixed ratio sits inside the Claude-only range of ratios, so v2's lead survives the mixed fleet, but this is not a measurement of the ratio's size. The mixed fleet did not make the queue slower than its Claude-only runs (23.6 min against 16.5 to 34.7), and made v2 slightly slower than its clean Claude-only runs (15.2 against 11.3 to 14.4), the expected effect of agents that take twice as long per invocation. The v2 mixed race started at a load average of 29 (mean 9.6 over the run); the queue mixed race ran at 4.3 on average.

### 3.3 Per vendor (by the vendor that authored the task)

Tasks go to whichever agent is free, so the faster vendor takes more of them: in the queue run Claude authored 27 tasks and Codex 13 (v2: 20 and 20). Costs: Claude is the CLI's reported list-price total; Codex is an estimate from tokens at the adapter's assumed price (1.25 / 0.125 / 10 USD per million fresh-input / cached-input / output tokens), billed to the ChatGPT plan, not in dollars.

| | queue: Claude | queue: Codex | v2: Claude | v2: Codex |
|---|---|---|---|---|
| tasks authored | 27 | 13 | 20 | 20 |
| first attempt passes its own acceptance tests | 27 of 27 | 13 of 13 | 20 of 20 | 19 of 20 |
| first attempt passes the whole suite of its snapshot | 27 of 27 | 13 of 13 | 18 of 20 | 17 of 20 |
| reached the stalk (all accepted) | 23 (85%) | 13 (100%) | 18 (90%) | 18 (90%) |
| dropped | 4 | 0 | 2 | 2 |
| landed with no conflict, red or rework | 16 | 10 | 13 | 13 |
| textual conflicts met (tasks affected) | 18 (10) | 5 (3) | 11 (7) | 10 (7) |
| red checks or batches on its tasks | 7 | 1 | 8 | 5 |
| rework rounds (tasks needing one) | 21 (11 = 41%) | 6 (3 = 23%) | 18 (7 = 35%) | 15 (7 = 35%) |
| cost, USD | 3.11 | 0.89 | 3.04 | 1.51 |
| per first attempt / per rework, USD | 0.054 / 0.083 | 0.041 / 0.052 | 0.062 / 0.100 | 0.042 / 0.045 |
| median first attempt: wall s / turns or items | 17 / 9 | 38 / 7 | 22 / 11.5 | 42 / 7 |
| median rework wall time, s | 15 | 45 | 17 | 48 |
| files per change / hot files per change | 2.19 / 0.70 | 1.62 / 0.31 | 2.45 / 0.85 | 1.65 / 0.35 |
| tokens, thousands: fresh input / cache / output | 1 / 3,770 / 97 | 450 / 1,524 / 14 | 0 / 4,013 / 78 | 728 / 2,693 / 26 |
| failed or non-success invocations | 0 | 0 | 0 | 0 |

Matched against the Claude-only baselines on the same tasks (`analysis/results/compare-*.md`): Codex's first attempts passed their own acceptance tests 100% (queue run) and 95% (v2 run) against 100% and 95% for Claude on the same tasks; Codex tasks met 0.38 and 0.50 conflicts per task against 0.65 and 0.35 when Claude did them. The hard-core tasks fell where chance put them (queue run: t032 and t036 to Claude, both dropped; t010 to Codex, green; v2 run: t010 and t025 to Codex, t007 and t032 to Claude, all dropped), so per-vendor drop counts say little.

### 3.4 Are cross-vendor collisions worse?

Pairs are measured as the history study did: for two landed beans i (earlier) and j (later) where j started before i landed, revert i from j's parent and re-apply j with `git merge-tree`; a conflict means j cannot exist without i. Pairs where reverting i alone conflicts (a bean between them built on i) are excluded as entangled.

| Run | cross-vendor pairs: conflicting / probed | same-vendor pairs: conflicting / probed | relative risk [95% CI], Fisher p | among pairs whose beans touch a common file: cross | same |
|---|---|---|---|---|---|
| queue, mixed | 9 / 265 (3.4%) | 5 / 312 (1.6%) | 2.12 [0.72, 6.25], p = 0.18 | 9 of 23 (39%) | 5 of 36 (14%), p = 0.033 |
| v2, mixed | 3 / 135 (2.2%) | 4 / 107 (3.7%) | 0.59 [0.14, 2.59], p = 0.70 | 2 of 16 (12%) | 3 of 12 (25%) |
| both (not independent: same 40 tasks) | 12 / 400 (3.0%) | 9 / 419 (2.1%) | 1.40 [0.59, 3.28], p = 0.51 | 11 of 39 (28%) | 8 of 48 (17%), p = 0.30 |

Other lenses:
- **Conflict events.** Of the textual conflicts the harness met, the share whose colliding landed bean came from the other vendor was 39% (queue) and 42% (v2), against 47% and 56% of concurrent pairs being cross-vendor: cross-vendor pairs are not over-represented among conflicts.
- **Same files?** The first attempts of Codex and Claude on the same task touch nearly the same files (mean Jaccard 0.94 Codex against Claude, 0.96 Claude against Claude in the queue run; in the v2 run the figures are muddied by migration numbering, which depends on what had landed when a task started). With the vendor split of each mixed run applied as labels to six Claude-only runs, the number of cross-vendor task pairs that share a file is 37 in the mixed queue run against 41.3 (range 39 to 43) in the Claude-only runs, and 56 against 57.7 in the v2 run.
- **Against the history figure.** The measured-history rates (41.7% cross, 19.8% same) are over pairs inside 20-change windows of real repositories. In this arena only 14.7% of all task pairs touch a common file, so the all-pair rates here are an order of magnitude lower; the conditional rates (39% against 14% in the queue run) land near the history figures, and the v2 run does not.

**Verdict: not shown.** The queue run leans the way the history does, the v2 run leans the other way, and the pooled relative risk (1.4) has an interval that contains both 1 and the history's 2.1. Distinguishing a 2x effect from none would take several times more pairs than a 40-task arena gives per race.

### 3.5 Caveats specific to the mixed fleet

- One run per policy at one seed (id order). Pair probes from the two runs share the same 40 tasks and are not independent.
- Codex dollars are estimates at an assumed price; the real list price of `gpt-6.1-sol` is not known to the harness.
- Reworks are not symmetric: Claude resumes its session, Codex starts fresh with the whole task restated. Under the queue's `--no-queue-hold` 7 of 27 reworks ran on the other vendor's task.
- Claude runs under a command allowlist, Codex under an OS sandbox. A probe from a race working directory showed Claude seeing no repository instructions (answer "NONE"); Codex agents see their installed skills list.
- The v2 mixed race began at a high load average (29, falling to 3), so its absolute minutes are less reliable than the ratio.

## 4. Harness changes and findings

Changes are in `research/exp/e7-variance-mixed/race/` only (never in `research/race`); `analysis/harness-changes.diff` is the unified diff against the original files.
- `harness/agents.py`: `MixedAdapter`; Codex usage-limit and outage detection stops the race instead of dropping tasks; a Codex "Reconnecting..." notice no longer turns a completed turn into an error; **an auth outage result from Claude Code now stops the race**.
- `harness/core.py`, `race.py`: `--agent mixed`, `--codex-model`, the vendor of each invocation in `invocation.start`, the fleet map in `race.start`, vendor-aware session resume.
- `harness/ci.py`: E2's index-lock fix, copied (byte-identical to `research/race/harness/ci.py`), with a regression test that fails against the old file.
- `e7_driver.py`, `e7_preflight.py`, `e7_race.sh`: one race per slot; a one-turn pre-flight call per vendor inside the slot (about $0.005); uptime and load samples per race; a scan of every finished run for outage results; a spend ledger.

**An auth outage is silent.** At 15:21 HKT Claude Code returned `is_error: true` results with subtype `success` and exit code 1 ("Failed to authenticate. API Error: 403 Request not allowed", cost 0), and Codex returned "workspace routing discovery failed" behind HTML 403 pages. The harness booked the Claude results as finished, empty agent work and went on with no-op reworks. The first mixed queue race was discarded for it (68 invocations, 8 failed, $3.19). The adapter change plus the pre-flight make the next outage stop a race at its first failure; during the later session-limit window (19:08 to 20:40) the pre-flight failed 16 times and no race was started, so nothing was spent or contaminated.

**Codex's JSON stream marks reconnect notices as `error` events** even when the turn then completes; the original adapter would have labelled such invocations errors.

## 5. Cost

Claude is the CLI's own `total_cost_usd` (list price; the plan window was exhausted, so these ran as extra usage). Codex is estimated from tokens at 1.25 / 0.125 / 10 USD per million fresh-input / cached-input / output tokens and billed to the ChatGPT plan. Every run counts, used or discarded.

<!-- LEDGER:BEGIN -->

| Run | Status | Invocations | Claude (reported) | Codex (estimated) | Pre-flight probes |
|---|---|---|---|---|---|
| aborted-e7-queue-mixed-12-s7-a1-auth-outage | discarded (auth outage) | 68 | $2.25 | $0.94 | $0.000 |
| e7-queue-claude-12-s13-shuf | used | 70 | $4.39 |  | $0.002 |
| e7-queue-claude-12-s3-shuf | used | 67 | $4.35 |  | $0.006 |
| e7-queue-claude-12-s5-shuf | used | 68 | $4.87 |  | $0.000 |
| e7-queue-mixed-12-s7 | used | 67 | $3.11 | $0.89 | $0.006 |
| e7-smoke-mixed-queue | pre-check smoke race | 5 | $0.09 | $0.07 | $0.000 |
| e7-v2-claude-12-s13-shuf | used | 62 | $4.48 |  | $0.006 |
| e7-v2-claude-12-s3-shuf | used | 59 | $3.99 |  | $0.002 |
| e7-v2-claude-12-s5-shuf | used | 69 | $5.60 |  | $0.000 |
| e7-v2-mixed-12-s7 | used | 73 | $3.04 | $1.51 | $0.002 |
| flagged-highload-e7-queue-claude-12-s3-shuf | flagged first run of a re-run seed | 66 | $4.38 |  | $0.000 |
| flagged-highload-e7-v2-claude-12-s3-shuf | flagged first run of a re-run seed | 65 | $4.19 |  | $0.000 |
| **Total** | | | **$44.74** | **$3.41** | **$0.026** |

Other probes outside runs: $0.0053 (Claude AGENTS.md visibility probe).
Grand total counted against the $70 cap (Claude + Codex estimate + probes): **$48.18**; of that, Claude (real extra-usage dollars) **$44.77**.

<!-- LEDGER:END -->

Of the $48.18 counted, $11.92 went to runs not used in the results: the discarded outage run ($3.19), the smoke race ($0.16) and the flagged first seed-3 pair ($8.57, kept as flagged data). Two free-standing Codex checks outside the harness (a tiny test and one arena task) used about 110k input tokens, roughly $0.05 at the assumed price, and are not in the ledger. The driver's spend guard (no race starts if spend plus the $15 per-run cap would pass $70) never fired on real spend; it fired once from a $100 kill-switch entry I planted to stop an earlier chain. The largest run cost $5.60.
