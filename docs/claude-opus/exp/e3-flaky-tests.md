# E3: flaky tests. How much do they hurt v2 compared with the queue, and do simple re-runs fix it?

**Status (2026-10-03):** the three required 5% races are done. The optional extras (unmitigated queue at 5%, 2% repeats) were not run (§2.6); the `FLAKE_CONFIRM_SAME` replay self-test and the harness's own policy tests on the final code passed (§6.8). Code, tests and run directories: `research/exp/e3-flaky/race/` (a copy of the harness; `research/race` is untouched).

**Naming (Coop's):** a **bean** is one agent's change in its workspace, the **sprout** is the staged line (the harness's `trunk`), the **stalk** is the stable line (the harness's `green`). Event names and code keep the harness words (`land`, `green.promote`, `trunk_idx`).

**Labels:** **measured** = a real race (Sonnet agents, the real 40-task arena, injected flakes); **expected** = arithmetic on measured counts; **replay** = free replay agents (reference patches, synthetic timing); **unit** = a deterministic test on the fixture arena.

---

## Answer in brief

1. **Exposure.** v2 runs 107-121 suite runs per 40 beans (87-99 pre-land checks, 17-22 sprout validations), the queue 34-41 (measured). A flake can only turn a really green run red, and about half of the queue's runs are really red: roughly 90 of v2's runs and 14-17 of the queue's are exposed, so at the same per-run rate v2 meets about five times as many flaky reds.
2. **A flaky pre-land red is cheap for v2.** It sends a good bean back for one needless informed rework: $0.03-0.10 and about two minutes on that bean. In all four cases measured (a probe and three in the 5% race) the real Sonnet agent re-ran the failing test five or six times, could not reproduce it, edited nothing and said so.
3. **A flaky sprout validation is the expensive failure.** Revert-first reverts and drops a good bean: a lost green and its agent work. About half of flaky validation reds end that way (the others are exonerated when a newer head validates green first), which is 0.4-0.5 beans per 40 at 5% (expected). A flaky red batch costs the queue a bisect, an ejection and a restart of the speculative batches behind it, about 4.5 minutes of delay per PR in the batch (expected, from the baseline traces), and never a bean.
4. **Re-running every red does not pay at these rates.** A blanket re-run costs a check on every red, and real reds are common in this arena: 11 of the 16 pre-land re-runs of the mitigated race were on real reds (11 bean-minutes of waiting) to absorb 5 flakes (saving about 4 bean-minutes and $0.30). The break-even flake rate is about 24% for the v2 pre-land check and 21-42% for the queue's batch retry (expected). Re-running a red **validation** before revert-first is the exception: it costs no bean time and removes the one failure that loses a bean.
5. **"Red twice" is not enough.** In the mitigated race one validation flaked twice in a row on two different tests (chance r² = 0.25% per validation, about 5% per race; it happened) and a good bean was reverted anyway. Requiring the **same test** to fail twice would have caught it; built as `FLAKE_CONFIRM_SAME` (replay-tested, §6.8), not raced.
6. **The ranking does not change.** At 5% v2 reached its 35th green in 11.4 and 11.5 minutes, the queue in 25.6 (queue + retry). One race per arm cannot rank the mitigations by minutes or dollars: the no-flake races of `08` §5.2 alone span 11.3-14.0 minutes (v2) and 16.5-34.7 (queue).

---

## 1. Method

### 1.1 The question

The arena has no flaky tests; real suites do, and about 2% of runs is common. v2 runs the suite on every bean before it lands and again on the sprout, so it meets flakes more often than the queue. Both of its answers to a red are expensive when the red is false: a flaky pre-land red sends a good bean back to its author, and a flaky red in sprout validation reverts a good bean (revert-first) and drops it. The queue's answer to a flaky red batch is to bisect it and eject a good bean.

### 1.2 Flake injection (`harness/flake.py`, hooked into `harness/ci.py`)

**Model: per run.** A run whose real result is green reports red with probability `FLAKE_RATE`. The draw is `sha256(seed | sha | purpose | attempt)` read as a number in [0, 1), so it is deterministic per `(seed, sha, purpose, attempt)`: `attempt` counts the runs of one `(sha, purpose)` (the first is 0, a re-run is 1), so a re-run is an independent draw. `verify_draws.py` re-derives every flake of a finished race from these four inputs; for the races below it finds no mismatch (the two v2 races at 5%: 107 and 121 runs, 3 and 9 flakes, 4 and 10 draws that fired, one each on a really red tree, where nothing is flipped).

I chose per run, not per test file, for two reasons. The headline parameter is the share of CI runs that fail spuriously. And the arena suite grows from 20 to about 60 test files during a race, so a per-file rate would silently raise the per-run rate as beans land, differently for each policy. (A per-file rate `q` is a per-run rate of `1 - (1 - q)^n`: 2% per run on 60 files is 0.03% per file.)

**Where it applies.** Every CI run of every policy: pre-land checks, sprout validations, culprit-search probes, queue batches and queue bisection probes. Never the `final` correctness check or the dry run: they are the instrument, not the system under test.

**What fails.** A real flake is a test, so the injected one is too. The victim comes (deterministically) from a fixed pool of `FLAKE_POOL` = 6 base-suite test cases, so the same few tests flake again and again; for seed 7 on the real arena: the `checkout`, `pagination`, `discounts`, `notifications`, `shipping` and `catalog` tests (four of them import the whole app). It fails the way a timing flake does in `node:test` (`'test timed out after 5000ms'`), in the spec-reporter format the agents already see, with the failing file's read set computed as for any red. Agents are never told it is injected. Only a green run is flipped: a real red stays exactly as it was.

**Environment variables** (nothing changes unless `FLAKE_RATE` > 0 or a mitigation is on):

| Variable | Meaning |
|---|---|
| `FLAKE_RATE` | P(red \| tree is green) per CI run (default 0) |
| `FLAKE_SEED` | seed of the draws (default: the race `--seed`) |
| `FLAKE_POOL` | number of distinct flaky base-suite tests (default 6; 0 = any test) |
| `FLAKE_PURPOSES`, `FLAKE_LIMIT` | restrict injection to some purposes / stop after n flakes (tests, probes, ablations) |
| `FLAKE_RERUN_PRELAND` | v2 mitigation (i) |
| `FLAKE_RERUN_VALIDATE` | v2 mitigation (ii) |
| `FLAKE_RETRY_BATCH` | queue retry |
| `FLAKE_MITIGATE=1` | the three above, unless set explicitly |
| `FLAKE_RERUN_SECONDS` | emulated latency of a re-run (default: as long as the first run; a few seconds stands for re-running only the failing tests on a warm runner) |
| `FLAKE_CONFIRM_SAME=1` | extension (iii), below; not part of `FLAKE_MITIGATE` |
| `FLAKE_QUARANTINE=n` | quarantine a test after n flips (default 0 = off; not used in the races) |

### 1.3 Ground truth and the counts

Every CI result carries `true_green` (the real outcome), `flaked` and `flake_test`; the policies never read them. The events and `summary.json` use them:

- **flaked run:** a run that reported red although the tree was green.
- **needless rework:** a pre-land rework (v2), or a queue ejection and its rework, whose triggering red was a flaked run.
- **wrongful revert:** a revert-first whose triggering red validation was a flaked run (the bean is good and is dropped).
- **absorbed:** a re-run that came back green after a red; **confirmed:** red again.

### 1.4 Mitigations

| | Where | Rule |
|---|---|---|
| (i) | v2 pre-land check | A red check is re-run once on the same tree (same emulated 60 s) before the bean is sent back. Green: the bean goes on to land. Red twice: the author gets the re-run's verdict. |
| (ii) | v2 sprout validation | A red validation is re-run on the same commit (a CI slot, 60 s) before revert-first starts. Green: the sprout is promoted as usual. Red twice: revert-first. The culprit-search probes are not re-run. |
| queue | queue batch | A red batch is re-run once on the same head before it is bisected. The batches stacked behind it stay in flight while it runs; only a second red cancels them. |
| (iii) | all three, opt-in | **Extension, built after race 2:** a second red confirms the first only if a test fails in both runs; two different failures in a row are two flakes, so the tree runs a third time and that verdict stands (`FLAKE_CONFIRM_SAME`). |

**Flake history.** The `FlakeBook` records, per git tree, which tests passed and which failed. A test that both passed and failed on the same tree is marked flaky (a "flip"). A re-run of a red check on the same tree is exactly what produces that evidence, so the history needs no extra runs, and it is recorded in every arm. (`FLAKE_QUARANTINE` can make it act; the races did not enable it.)

### 1.5 Harness changes and what they mean for the data

1. **v2 revert-first now covers bisected tickets.** As it stood, revert-first applied only to a ticket with a read-set suspect; a red whose failing test reads none of the unvalidated commits' files was bisected and then handed to a fresh-session **fixer**, which is the fix-forward v2 abolishes. A flake on an unrelated test reaches that path; no earlier race did. Fixed here (`ticket_opened`), and a bisected ticket reuses its localisation. *Not exercised in the races (all their tickets were read-set tickets); unit-tested.*
2. **`ci.py` lock path (from E2).** v2's pre-land CI and the validation CI both name worktrees `slot-N`; git de-duplicates the admin dirs and the old code guessed the `index.lock` path from N, so one CI could delete the other's lock. Patched at 17:13 with a regression test. The probe and `r05-v2-plain` ran before the patch and are clean (no error events, no CI run without a junit result, no lock text in their logs); the later races ran with it. The queue has no pre-land CI.
3. **Auth guard.** An authentication outage ("403 Request not allowed") arrives as an `is_error` *result*, which the harness books as an agent run that changed nothing. The driver now makes a 1-turn Haiku call ($0.004) inside each slot before a race, waits and re-queues on a 403, and scans a finished race's events for auth-failed invocations (a race with any is set aside and re-run). No race here overlapped the outage; the `e3-pre-*` replay runs never call the CLI (their "infra_error" is a null field in every event).
4. **Machine load.** The harness logs the load average every minute (`machine.load` events) and `race_with_uptime.sh` records `uptime` at the start and end of each race (`runs/<name>.uptime.txt`). While this was built the machine ran at load 120-460 on 18 cores (other experiments), so validation runs were capped at 4 node processes (`RACE_NODE_SUITES=1 RACE_NODE_CONCURRENCY=3`). The real races ran at low load (below).

### 1.6 Races

Claude Code (Sonnet), 12 agents, the 40 arena tasks, seed 7, `--protect-tests landed --ci-seconds 60 --ci-slots 2 --max-wall-minutes 45`, `--budget-usd 20`. v2 adds `PRELAND_MODE=optimistic PRELAND_SECONDS=60 --snapshot head --error-budget 999`; the queue adds `--batch 4 --no-queue-hold`. Every race held one slot of `research/tools/race-slot.sh` (FIFO, first come first served), driven by `drive.py`.

## 2. Results

### 2.1 Probe (measured; 1 task, 1 forced flaky pre-land red, real Sonnet)

The agent got the flaky failure as an ordinary red ("these tests failed: `checkout.test.ts > turns the cart into a confirmed, invoiced order...`, `'test timed out after 5000ms'`"), ran the whole suite and then the failing file six times, could not reproduce it, edited nothing and said so. 7 turns, 11 s, $0.027; the bean landed 32 s after the false red and the flip was recorded (the re-check ran on the same tree).

### 2.2 The three 5% races (measured)

#### A. Headline

| race | flake rate | mitigations | 20th green min / $ | 30th green min / $ | 35th green min / $ | greens | dropped | total $ | wall min | final correct | load1 mean / max (start / end of uptime) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| r05-queue-retry | 0.05 | retry batch | 5.3 / 3.11 | 17.5 / 3.92 | 25.6 / 5.00 | 36 | 4 | 5.00 | 28.7 | True | 5.3 / 17.8 (6.05 / 7.07) |
| r05-v2-plain | 0.05 | none | 8.3 / 4.88 | 10.4 / 5.15 | 11.4 / 5.20 | 37 | 3 | 5.20 | 12.5 | True | 10.3 / 22.9 (5.25 / 2.84) |
| r05-v2-mitigated | 0.05 | re-run preland, re-run validate | 7.3 / 3.02 | 10.9 / 4.33 | 11.5 / 4.38 | 36 | 4 | 4.44 | 15.0 | True | 16.1 / 41.9 (5.93 / 6.83) |
| opus-queue-sonnet-12-landed (no-flake reference) | 0 | none | 5.2 / 3.03 | 10.4 / 3.98 | 15.5 / 4.42 | 37 | 3 | 4.42 | 16.5 | True | - |
| opus-queue-sonnet-12-s11 (no-flake reference) | 0 | none | 4.2 / 2.65 | 20.5 / 3.77 | not reached | 34 | 6 | 4.10 | 34.7 | True | - |
| opus-v2fair-sonnet-12-s7 (no-flake reference) | 0 | none | 7.3 / 4.79 | 9.7 / 5.21 | 11.3 / 5.29 | 35 | 5 | 5.29 | 11.3 | True | - |
| opus-v2fair-sonnet-12-s11 (no-flake reference) | 0 | none | 9.4 / 5.32 | 10.9 / 5.54 | not reached | 34 | 6 | 5.62 | 14.0 | True | - |

#### B. What the flakes did

| race | suite runs (preland / validate / batch / bisect) | flaked runs | real red checks | re-runs: on a flake / on a real red | absorbed | needless reworks / ejections ($) | agent edited files in | wrongful reverts / reverts | flaked validations: tickets / exonerated / reverted | decision cards fed by flakes | flaky tests found (flips) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| r05-queue-retry | 0 / 0 / 31 / 10 | 0 | 24 | 0 / 7 | 0 of 7 | 0 / 0 ($0.00) | 0 of 0 | 0 / 0 | 0: 0 / 0 / 0 | 0 of 0 | none |
| r05-v2-plain | 87 / 17 / 0 / 3 | 3 | 17 | 0 / 0 | 0 of 0 | 3 / 0 ($0.19) | 0 of 3 | 0 / 0 | 0: 0 / 0 / 0 | 0 of 1 | none |
| r05-v2-mitigated | 99 / 22 / 0 / 0 | 9 | 22 | 8 / 11 | 7 of 19 | 0 / 0 ($0.00) | 0 of 0 | 1 / 1 | 3: 1 / 0 / 1 | 0 of 1 | shipping x1, checkout x3, shipping x3, notifications x2 |

#### C. Cost

| race | agent $ total | initial | rework | fixer | needless rework $ | $ thrown away by wrongful reverts | pre-land + CI check minutes | of which re-runs | CI slot utilization | task start to green p50 / p90 (min) |
|---|---|---|---|---|---|---|---|---|---|---|
| r05-queue-retry | 5.00 | 2.04 | 2.96 | 0.00 | 0.00 | 0.00 | 44.6 | 9.97 | 0.78 | 4.1 / 17.4 |
| r05-v2-plain | 5.20 | 2.52 | 2.68 | 0.00 | 0.19 | 0.00 | 108.7 | 0.0 | 0.81 | 4.3 / 6.5 |
| r05-v2-mitigated | 4.44 | 2.16 | 2.28 | 0.00 | 0.00 | 0.28 | 123.9 | 19.36 | 0.75 | 3.8 / 6.3 |

`load1` is the 1-minute load average on 18 cores: mean / maximum of the harness's per-minute samples, then `uptime` at the start / end of the race. The no-flake rows are the races of `08` §5.2 (another day, load not recorded) and are there to show the spread of identical races, not as a paired control.

### 2.3 What happened, event by event (measured)

**v2, no mitigation: three flaked pre-land checks, three needless reworks.** Each time the agent investigated and returned without editing. Beans t012 (10 turns, $0.035, 15 s), t007 (8 turns, $0.053, 15 s) and t006 (12 turns, $0.099, 23 s) landed 76, 181 (it also had a merge-conflict rework in between) and 84 s after the false red. In two of the three the informed prompt listed two unrelated landed changes as the likely cause (it picks landed beans whose files the flaky test's import closure reaches, which for a test that imports the whole app is everything); the agents ignored them. 17 validations, none flaked: no wrongful revert (expected 0.4).

**v2, mitigated: nine flakes.** Five at pre-land, all absorbed by the re-run (no needless rework). Four at validation: sprout #11 and #27 absorbed by the re-run; **sprout #36 flaked twice, on two different tests** (`notifications`, then `shipping`), the re-run confirmed it, revert-first fired at once (one unvalidated commit, so no culprit search, and nothing newer to exonerate it) and bean t031 ($0.28 of agent work) was reverted and dropped. The mitigation's cost side: of 16 pre-land re-runs, 11 were on real reds (672 s of re-run check time, 11 beans waiting a minute longer to be told they were red) and 5 on flakes. Of the 12 confirmed re-runs, 11 failed the same tests again and 1 failed different tests: the only double flake.

**Queue + retry: no flake injected** in 41 runs. Three draws fired (the expected 2), but each fell on a batch that was really red, which a flake cannot change (about half of the queue's batches are); the chance of no injected flake among its 17 really green runs was 42%. What the race does show is the cost of the mitigation with nothing to absorb: 7 red batches were re-run and all 7 confirmed red, adding 7 batch runs (10 CI minutes) and 61-70 s before each red batch could be bisected. The race took 28.7 minutes; the no-flake queue races of `08` §5.2 took 16.5 and 34.7, so the retry's share of that is not separable from the queue's own variance.



### 2.4 Expected damage at other rates (expected; arithmetic on the measured counts)

A run flakes with probability r, independently. From the three races: v2 has 85 pre-land checks and 18 validations per race (means of the two v2 races), of which 72 and 17 are really green; the queue 24 batches and 10 probes, of which 17 are really green (only those can flake); 55% of flaky validation reds end in a revert and the rest are exonerated by a newer green (`exoneration.py` on the 5% and the no-flake traces: 0.47-0.75 by race). A needless rework costs $0.094 (the mean of all reworks in the two v2 races; the three measured needless ones cost $0.063). Standard deviations are binomial.

| flake rate r | policy | flaked runs per race | needless reworks / ejections (mean +- sd) | wrongful reverts (mean +- sd; P at least one) | extra agent $ | extra suite runs from the mitigation |
|---|---|---|---|---|---|---|
| 2% | v2, no mitigation | 1.8 | 1.44 +- 1.2 | 0.19 +- 0.4 (18%) | 0.14 | 0 |
| 2% | v2, re-run pre-land and validation | 1.8 | 0.03 +- 0.2 | 0.00 +- 0.1 (0.4%) | 0.003 | 14 pre-land + 1 validation |
| 2% | queue, no retry | 0.3 | 0.34 +- 0.6 | n/a | 0.04 | 0 |
| 2% | queue + retry | 0.3 | 0.01 +- 0.1 | n/a | 0.001 | 11 batch |
| 5% | v2, no mitigation | 4.5 | 3.60 +- 1.8 | 0.48 +- 0.7 (39%) | 0.34 | 0 |
| 5% | v2, re-run pre-land and validation | 4.5 | 0.18 +- 0.4 | 0.02 +- 0.2 (2.4%) | 0.017 | 17 pre-land + 1 validation |
| 5% | queue, no retry | 0.9 | 0.85 +- 0.9 | n/a | 0.09 | 0 |
| 5% | queue + retry | 0.9 | 0.04 +- 0.2 | n/a | 0.005 | 12 batch |
| 10% | v2, no mitigation | 9.0 | 7.20 +- 2.5 | 0.97 +- 1.0 (63%) | 0.68 | 0 |
| 10% | v2, re-run pre-land and validation | 9.0 | 0.72 +- 0.8 | 0.10 +- 0.3 (9.3%) | 0.068 | 20 pre-land + 2 validation |
| 10% | queue, no retry | 1.7 | 1.70 +- 1.2 | n/a | 0.19 | 0 |
| 10% | queue + retry | 1.7 | 0.17 +- 0.4 | n/a | 0.019 | 13 batch |

**Break-even of a "re-run every red" mitigation** (`breakeven.py`). It costs one more check on every red, real or flaky, and saves, per flake, the detour the red causes. A needless v2 rework detours a bean by 114 s (measured, 3 cases) and a re-run replaces 61 s of that, so it saves 53 s per flake against 61 s on each of the 15 real red checks a race has, with 72 really green checks exposed: it pays above r* = 24% per run (at 5%: saves 3.2 bean-minutes, costs 15.2). For the queue a PR in a red batch waits 271 s longer to land (53 PRs in the baseline and E3 traces) and a retry costs 61 s on every red batch before anything behind it can resolve, with 11 of 22 batches really green: r* = 21%, or about 42% when the PRs of the speculative batches behind the red one are counted as held up too. r* scales with the real-red rate: a repository with a quarter of this arena's reds has a quarter of these break-evens. A 5 s targeted re-run instead of the 60 s one brings the v2 figure to 1.0%.

### 2.5 The mechanism at 20% (replay, 10 tasks, 6 agents, real arena)

The pre-flight races (`runs/e3-pre-*`; replay agents, so no agent cost and synthetic timing) show every mechanism fire. Unmitigated v2: 5 of 29 runs flaked, 4 needless reworks and **1 wrongful revert (t001)** after a flaky validation. Mitigated v2: 3 of 28 flaked, one pre-land double flake (a needless rework nevertheless), one validation flake absorbed, 0 reverts. Queue + retry: 5 batch runs, no flake.

### 2.6 2% repeats and the unmitigated queue (not run)

*Skipped.* The optional extras were not run: the unmitigated queue at 5% (the arm that would show what a flaky batch does to the queue, since the required queue race injected no flake) was started at 19:08 and stopped by the pre-race authentication check on a usage-limit message (`You've hit your session limit`), at $0; the 2% repeats (v2 plain, v2 mitigated, queue + retry) were dropped on the coordinator's instruction because usage limits are tight. §2.4 gives the expected numbers at 2% (and 1% and 10% in the `expected.py` output): at 2% a race has about 2 flaked runs (v2) and 0.3 (queue), so one race per arm would show almost nothing.

## 3. Verdict

**How much do flakes hurt v2 compared with the queue?** At 2-5% per run, little in absolute terms, differently in kind. Per 40 beans at 5% (expected, from the measured counts): v2 meets about 4.5 flaked runs and pays them as 3.6 needless reworks ($0.3 and about 7 bean-minutes: each reworked bean waits about two minutes longer, nobody else) and 0.5 wrongful reverts (a bean and about $0.3 of work each: 2.5% of the throughput each). The queue meets about 0.9 and pays each as a bisect, an ejection and a restart of the batches behind it (about 4.5 minutes of delay per PR in the batch): roughly 10 PR-minutes per race plus the stall it puts on the speculation, but it loses no bean. So flakes hurt the queue in time and v2 in beans; neither comes near the time advantage v2 holds in the races (35th green at 11.4 and 11.5 minutes against 25.6; load 5-16).

**Do simple mitigations fix it?** Partly, and one of them is worth having.
- **(ii) re-run a red validation before reverting:** yes. It costs a slot for a minute and no bean time, and it cut the expected wrongful reverts from 0.5 to 0.02 per race. In the race it absorbed 2 of 3 flaked validations; the third was a double flake.
- **(i) re-run a red pre-land check:** not blanket. It left 0 needless reworks (3 measured without it, 3.6 expected) and avoided about $0.30, at the price of a minute on each of 11 real reds. The unmitigated damage was already small because the agent is itself an adequate flake filter.
- **queue retry:** not at 2-5% in this arena: half of its batches are really red, so it pays a retry on every one (7 here) to absorb a flaky batch about once per race at 5%.
- **"Red twice" has a residue** of r² per validation and the single reverted bean came from it. Same-test confirmation (iii) shrinks it to r²/6 here, and to nothing for a test the flip history knows.

**What it means for the service:** put the confirmation at the irreversible action, not at every red; keep the flip history from day one; return reverted beans to their author. §4.

## 4. Design rules for the service

**R1. Never take an irreversible or expensive action on a single red.** The actions are reverting and dropping a bean (v2) and ejecting a bean while cancelling the batches behind it (queue). Confirm on the same tree first: mitigation (ii), and the queue retry limited to batches that are about to be bisected. Measured: it absorbed 2 of 3 flaked validations.

**R2. Confirm with the same test, not just a second red.** A real red fails the same tests again; a flake rarely fails the same test twice (r² for two flakes of any kind, r²/P for the same test among P flaky ones). Confirm only if a failing test repeats; otherwise run a third time. In the mitigated race 11 of 12 confirmed re-runs repeated their failing tests and the 12th, the only double flake, did not (`flake_report.py`). Built as `FLAKE_CONFIRM_SAME` (§6.8). The residue for a persistently flaky test (fails 30% of the time: twice in a row 9%) is the flip history's job (R6).

**R3. Re-run the failing tests, not the pipeline.** A re-run of only the failing tests on a warm runner costs seconds, not the pipeline's minute. With r* = (real-red rate x re-run time) / (detour saved per flake), the v2 pre-land re-run drops from 24% to about 1% at 5 s and then pays at 2-5% (expected; the `FLAKE_RERUN_SECONDS=5` arms were not raced). For reversible reactions that cost one agent turn and a few cents, such as a pre-land rework, do not re-run at all: the agent already diagnoses a timeout in about 15 s for $0.05.

**R4. A red that does not reproduce is not a culprit.** The harness's culprit search assumes the red head is bad and probes only the commits below it; when every probe is green it returns the red head and reverts it (and a gap of one commit is reverted without a probe at all: 9 of 17 validations in the 5% trace). Re-test the failing test on the red commit first; if it passes there or at no commit in the range, there is no culprit: do not revert, mark the test flaky, let the next validation stand.

**R5. Let newer greens exonerate, and wait for them.** A red on sprout head k followed by a green on a newer head closes the ticket. About half of flaky validation reds are exonerated that way and half are not, because nothing newer is being validated yet. A bounded wait (one validation time) before a revert would move that fraction.

**R6. Record flips per tree; quarantine on evidence.** Store which tests passed and failed per tree. A test that does both on one tree is flaky: mark it at the first flip. Quarantine (it still runs and is reported, but does not gate and never triggers a revert) at the second flip, or at the first if it also fails on the stalk head, and release it after a run of clean results. In the mitigated race 4 of 9 flake reds came from a test already marked flaky by an earlier flip, and 2 of 9 would have been absorbed by quarantining at the second flip: the history pays within a single 15-minute race (with this model's pool of 6 tests; not measured as an enforced rule). Never quarantine a test that failed where it should have failed.

**R7. A revert must not lose the bean.** In the harness a reverted bean is dropped: a wrongful revert is then a lost task and its agent work ($0.28 here). The service returns a reverted bean to its author, so a false red costs a re-check instead of a bean.

**R8. Flake exposure is a design cost of the pre-land check.** v2 runs 2.7-3.0 suites per bean (about 2.2 of them really green, so exposed) against 0.85-1.0 for the queue (about 0.4 green): a bean in v2 is exposed to flakes about five times as often. Keep a flake budget per bean and pay down the flaky tests the history names.

### What to build first

1. Confirm-before-revert with same-test matching (R1, R2): a few lines in the validator.
2. The per-tree flip record and a flake ticket for the owner (R6).
3. Reproduce-before-revert in the culprit search (R4) and return-to-author on revert (R7).
4. Targeted re-runs (R3), if the flip history shows reds worth re-running.
5. Quarantine only after the flip record has run for a few weeks on real suites.

## 5. Cost

**Agent spend (measured):** $14.70 of the $40 cap for the whole experiment, from `runs/e3-ledger.json` (the ledger lists every real race the driver started; `auth / infra / is_error` are the invocations that failed on authentication, produced no result, or came back as an error result):

| race | attempt | agent $ | auth / infra / is_error | ended |
|---|---|---|---|---|
| e3-probe | 1 | 0.00 | 0 / 0 / 0 | 2026-10-03 15:24:57 |
| e3-probe | 1 | 0.06 | 0 / 0 / 0 | 2026-10-03 16:17:25 |
| e3-r05-v2-plain | 1 | 5.20 | 0 / 0 / 0 | 2026-10-03 16:30:01 |
| e3-r05-v2-mitigated | 1 | 4.44 | 0 / 0 / 0 | 2026-10-03 17:30:52 |
| e3-r05-queue-retry | 1 | 5.00 | 0 / 0 / 0 | 2026-10-03 18:49:25 |
| e3-r05-queue-plain | 1 | 0.00 | 0 / 0 / 0 | 2026-10-03 19:08:02 |

(The first `e3-probe` row is a waiter that was killed while queueing, $0; the probe ran on the second attempt. The `e3-r05-queue-plain` row is the optional unmitigated-queue race, stopped at start by the pre-race authentication check on a usage-limit message: $0, no agent ran.) Add $0.004 per slot for the pre-race authentication check and a few of those from manual checks (under $0.05 in all). Everything else was free: the unit tests, the replay pre-flight (`runs/e3-pre-*`) and the fixture races run replay agents or fake CLIs.

**Test compute and agent cost per race** are in table C above. The 5% v2 races spent 109 and 124 check minutes (agent-side checks plus CI) against 102 for the no-flake race of `08` §5.2; the mitigations' re-runs were 19.4 of those minutes (11.2 on real reds). The queue race spent 45 (10 of them re-runs). Per flake the unmitigated cost is $0.03-0.10 and about two minutes of one bean (v2 pre-land), $0.28 and a bean (a wrongful revert), or a bisect and about 4.5 minutes per PR in the batch (queue, expected). **Waiting:** every race queued for the shared slot for 45-60 minutes; the races themselves took 13-29.

## 6. Caveats

1. **One race per arm.** Each race is one realisation. At 5% the flaked runs per race are Poisson-like (v2 4.5 +- 1.8, queue 0.9 +- 0.9): the queue race injected none (42%) and the mitigated race drew 9 against 5-6 expected and a 2.4% event (a wrongful revert through a double flake). Agent behaviour varies too: the mitigated race made 20 reworks against 36-37 in the plain race and the two no-flake v2 seeds (11 merge conflicts against 16-21), which is why its agent cost is lower and says nothing about the mitigation. Read the counts and mechanisms, not the differences in minutes and dollars.
2. **Machine load.** The 5% races ran at 1-minute load averages of 5.3-16.1 (means) with maxima of 18-42 on 18 cores; the no-flake references ran on another day at unknown load. The emulated 60 s dominates the critical path but agent startup and the suite runs are not immune.
3. **The flake model is an assumption.** Per run, independent between attempts (which favours re-runs: a real flaky test that fails 30% of the time survives a re-run 30% of the time, not 5%), a pool of 6 tests, timeout-shaped failures, only green runs flipped. A timeout of a 100 ms test is easy for an agent to dismiss; a flake that looks like an assertion failure may be chased, edit code and cost more. The 4-of-4 "no edit" result belongs to this failure shape.
4. **The arena's real reds never involve a base test.** In every earlier race (94 red checks in five races) the failing files were acceptance tests of tasks, and the flakes sit in base tests, so any rule keyed on which test failed ("known flaky", quarantine) looks perfect here. In a real repository a flaky test and a regression can be the same test; R2 and R6 ask for evidence beyond the name.
5. **Static reachability is useless in the arena.** Four of the six pool tests import the whole app (47 files), so "the bean cannot reach the failing test" separates nothing (the `touches_bean` flag in the events: 5 of 5 flake reds and 22 of 22 real reds reach).
6. **A wrongful revert drops the bean** in this harness, as in `08`; a service would hand it back (R7). The loss counted is exact for this harness.
7. **Re-run cost.** (i), (ii) and the queue retry re-run the whole check at the full emulated 60 s; a real re-run of only the failing tests is cheaper (R3, expected only).
8. **Extension (iii) was not raced.** Its tests pass on the final code: the pure-logic tests (the agreement rule, the config flag, the metrics) and the replay races on the fixture arena, in two slot holds (19:07: 16 tests, `ConfirmSame` 5 + `RacesV2` 8 + `RacesQueue` 3, 58 s; 20:42: the harness's own queue and beanstalk policy tests, the event-schema check and `ConfirmSame` again, 15 tests, 59 s, all passed; and the rest of the harness's own classes (budget and safety, the fake Claude and Codex CLIs, the dry run, helpers): 20 tests, 20 s, all passed). They show, for validation, pre-land and queue: two flakes on different tests are absorbed by a third run and nothing is reverted, sent back, ejected or bisected; the same test twice is still confirmed; and the old rule still reverts in the same situation (race 2 in miniature). The double flake it is built for is a 2.4% event per race at 5%.
9. **The v2 policy was changed in one place** (§1.5, 1): the unmitigated arm is v2 as specified, revert-first for every red validation.
10. **No unmitigated queue race.** The required queue arm is queue + retry and it injected no flake, so what a flaky batch costs the queue (a bisect, an ejection, a restart of the batches behind it, about 4.5 minutes per PR) is expected from the red batches of the baseline traces, not measured, and the retry's own cost is not separated from the queue's variance. The optional unmitigated-queue race was started at 19:08 and stopped by the pre-race authentication check (the usage-limit message), $0, before any agent ran.

## 7. Reproduce

All commands run in `research/exp/e3-flaky/race/`; every race goes through the race slot.

```bash
# free: unit tests (flake draws, history, mitigations, same-test confirmation, driver) at 4 node processes
../../../tools/race-slot.sh ./validate.sh                  # fixture races, then a replay pre-flight on the real arena

# real agents (Sonnet, 12 agents, seed 7); arms are r<rate>-<kind>, see drive.py
python3 drive.py probe+r05-v2-plain r05-v2-mitigated r05-queue-retry
python3 drive.py selftest+r05-queue-plain r02-v2-plain r02-v2-mitigated r02-queue-retry

# the tables
python3 tables.py runs/e3-r05-queue-retry runs/e3-r05-v2-plain runs/e3-r05-v2-mitigated --ref <no-flake runs>
python3 kth_green.py runs/e3-r05-* --k 20 30 35
python3 flake_report.py runs/e3-r05-* --timeline            # one line per flaked run and what followed
python3 expected.py --v2 runs/e3-r05-v2-plain runs/e3-r05-v2-mitigated --queue runs/e3-r05-queue-retry
python3 breakeven.py --v2 runs/e3-r05-v2-plain --queue runs/e3-r05-queue-retry
python3 needless_transcripts.py runs/e3-r05-v2-plain        # what the agent did when a flake sent its bean back
python3 verify_draws.py runs/e3-r05-*                       # every flake re-derived from (seed, sha, purpose, attempt)
```

Files: `harness/flake.py` (injection, history, metrics, same-test rule), `harness/ci.py` (hook), `harness/policy_*.py` and `harness/core.py` (mitigations, ground-truth tags, confirm step), `tests/test_flake.py`, `drive.py`, `authcheck.py`, `race_with_uptime.sh`, `validate.sh`, and the analysis scripts above.
