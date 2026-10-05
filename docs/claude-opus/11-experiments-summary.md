# What the seven experiments say about v2 (living summary)

Started 2026-10-03, evening; updated as experiments finish. **All seven experiments, v2.1/v2.2 and the Cloudflare confirmation are complete.** Each experiment has its own write-up in `exp/`. Names: a **bean** is an agent's change, the **sprout** is the staged line, the **stalk** is the stable line. Unless stated, runs used Sonnet with 12 agents, 60 s emulated CI on 2 slots, and every landed acceptance test protected. All numbers are measured unless marked simulated.

## Status

| # | Question | Status | One-line answer |
|---|---|---|---|
| E1 | Tasks without ready-made tests | done (`exp/e1-tests-first.md`) | Without forge-owned tests, v2's stalk goes wrong silently (6 of 39 greens wrong, every signal green). A separate test author plus an **exact-tree check** helps, but cross-task contracts still need their own step |
| E2 | A real repo (markedjs/marked, 24 real fixes) | done (`exp/e2-real-arena.md`) | With no contention, v2 **lost** (19–20 min vs 4.4) because its file-level re-check fired about 50 times per race. Fixed by v2.1 (below) |
| E3 | Flaky tests (5% per run) | done (`exp/e3-flaky-tests.md`) | Cheap at 2–5%: v2 sees about 5x the queue's flakes (more test runs) but they cost cents (3 needless reworks, $0.19). The costly case is a flaky stalk validation reverting a good bean; re-run-once missed a double flake, so **revert only if the same test fails twice**. Re-running every red doesn't pay (break-even about 24% flake rate). v2 plain 12.5 min / v2 mitigated 15.0 min vs queue + retry 28.7 min |
| E4 | Scale 100–1,000 agents (replay of real codex history) | done (`exp/e4-scale-replay.md`, simulated timing, real merges) | The sprout committer is 1–3% busy at 1,000 agents; done → sprout is about 1 min. The limit at scale is **independent work** (dependency chains), not merge mechanics |
| E5 | Longer tasks (about 2-minute beans, about 7x longer) | done (`exp/e5-long-tasks.md`) | v2's lead **shrinks but holds**: queue ÷ v2 time to done 1.32–1.40x (short tasks: 1.46–2.48x), and v2 becomes slightly **cheaper** (0.94–0.95x). The queue leads on early greens. v2 **blocks agents while their change is checked** (72 of 139 busy agent-minutes). Observe-then-place and mid-flight notices don't earn a place at these lengths |
| E6 | Decision cards that re-execute the loser | done (`exp/e6-decision-cards.md`) | **All 40 tasks shipped** in 3 clean runs, against 35, at no extra cost. Default: keep the winner, amend the loser's tests to the decided spec, re-execute the loser |
| E7 | Seed variance; mixed Claude + Codex fleet | done (`exp/e7-variance-and-mixed-fleet.md`) | **v2 finished first in 5 of 5 seed pairs: queue ÷ v2 time to done, geometric mean 1.98x (95% CI 1.68–2.28, p = 0.008).** The queue is the noisy one (16.5–34.7 min vs 11.3–14.4) and reaches the 20th green first in 4 of 5 pairs; v2 costs about 12% more. Mixed fleet (6 Sonnet + 6 Codex): v2 15.2 vs queue 23.6 min (1.55x); cross-vendor collisions not shown worse (RR 1.4, CI 0.6–3.3) |
| CF | The same race on the deployed Cloudflare prototype | done (`08` §5.5) | Replay parity: identical decisions. **Real agents: v2 17.5 min vs queue 40.6 min to done (2.3x), faster at every milestone, +21% cost, both stalks correct** |
| CF v2.2 | All the v2.2 rules together, real agents on Cloudflare (2026-10-04) | done, **failed** (`research/race/runs/cf-v22-sonnet-12-s7`) | **24 green, 16 dropped, 24.9 min, 10 red validations, 4 revert tickets; stalk correct.** Worse than v2.0 (35 green) and the queue (36). Releasing agents during checks produced a burst (19 landings in minute 2; v2.0 never exceeded 5 a minute). The adaptive re-check skipped all re-checks, because the first checks against the base were green, a lagging signal. Validation (2 CI slots) fell 27 commits behind and bisects took about 6 minutes each. Inherited reds never fired, because they wait for a red validation that came minutes late, so 11 innocent beans burned their rework rounds. The replay simulator had predicted 39 of 40; replay agents do not reproduce the burst |
| CF v2.3 | v2.2 plus a sprout window, sampled re-checks, read-set inherited reds and early tickets, real agents on Cloudflare (2026-10-04) | done (`research/race/runs/cf-v23-sonnet-12-s7`) | **34 green, 6 dropped, 17.9 min, $5.14, 4 red validations, 1 revert ticket; stalk correct.** It fixes v2.2's collapse (24 green) and ties v2.0 (35 green, 17.5 min). The 20th green comes sooner (10.4 vs 11.3 min) and the 30th about the same (14.3 vs 13.8). The window held landings to 6 a minute (v2.2: 19). It grew from 4 to 16 in under 6 minutes and halved once, on the one red episode, which stalled landings for 3 minutes. Drops: 4 merge conflicts the agents could not resolve, 1 revert, and 1 decision-card loser. **The card named the wrong counterpart.** It was raised from a check that began before a revert, so a stale failure blamed t005, while t032's real conflict was with a landed task's test (`confirmation-grouping`). The test author rightly found nothing to amend, and the loser was dropped. E6's dynamic culprits are not ported yet |
| CF v2.4 | v2.3 plus reconcile-before-card and stale-failure re-checks, real agents on Cloudflare (2026-10-04) | done (`research/race/runs/cf-v24-sonnet-12-s7`) | **Best run so far: 37 green, 3 dropped, 17.7 min, $4.40, 4 red validations; stalk correct.** Against the queue (36 green, 40.6 min, $4.12): the 30th green at 8.9 min vs 19.9 (2.2x), the 35th at 15.2 vs 35.0 (2.3x), and done 2.3x sooner, for 7% more spend. Against v2.0: the 20th green at 6.7 vs 11.3 min and 2 more greens. The one reconcile attempt ended in a CONTRADICTION, rightly. The test author found that t032's tests also clash with a third landed task's free-shipping threshold ("that rule comes from neither task"), so reconciling only t032 with t005 could not fix it. Part of the gain over v2.3 is probably run-to-run variance (one seed) |
| v2.1 / v2.2 | Finer or adaptive re-check | done | **Calm repo (marked):** line-level 5.4–6.0 min, adaptive 5.2–5.3 min (file-level v2: 19–20; queue: 4.4), all correct. **Contended arena:** line-level is unsafe (4 red validations, 29 greens). **Adaptive with file-level fallback (v2.2): 35 greens, 10.1 min, $5.43, 3 red validations, correct**, matching file-level v2 (35, 11.3 min, $5.29, 1 red). **Rule:** skip re-checks while pre-land reds are rare; fall back to file-level once they appear |

## The design changes so far

1. **The re-check adapts to the red rate** (E2, v2.1). Calm repos skip re-checks after a moved sprout (as fast as a queue); once pre-land reds appear, re-check on any shared file. Line-level re-checks are fast but let same-file semantic breaks through under contention, so they're **not** the fallback.
2. **Check the exact tree that lands, cheaply** (E1). A landing onto a moved sprout runs a targeted check on the exact landing tree: the bean's own tests plus the tests of beans that landed meanwhile. The full suite runs at stalk promotion. E1 found a hole without this; E2 found heavy overhead with a full re-check. A targeted check covers both. To be built (v2.2).
3. **Tests belong to the forge, not the implementer** (E1). Tests-first by a separate test author, with fail-first proof. Shared test helpers are protected like acceptance tests.
4. **Contradictions go to a card, and the loser is re-executed under the decided spec** (E6). It ships everything at no extra cost. Never revert the winner: other beans have already built on it (0 of 3 succeeded).
5. **Revert-first needs flake discipline** (E3). Confirm a red stalk validation by the *same* failing test twice before reverting.
6. **At thousands of agents, invest in planning and dependency-aware starts, not merge throughput** (E4).
7. **Release the agent while its bean is checked** (E5). The agent takes the next task; a red check resumes the author's session on whichever slot is free. This is the biggest remaining throughput gain for long tasks.

## What's next (in priority order)

1. **Port the validated rules into the Cloudflare engine.** Ported 2026-10-04. Together they **failed their first real race** (the CF v2.2 row). **v2.3 recovers it** (the CF v2.3 row: 34 green, a tie with v2.0) by adding:
   - **A sprout window with AIMD backpressure:** at most W unvalidated landings; W grows by 2 per green validation and halves on a red one, which also bounds every bisect.
   - **A re-check that measures what it skips:** it counts re-check outcomes only and keeps sampling while skipping.
   - **Inherited reds by read set:** a failing test whose read set the bean never touched is not the bean's fault, without waiting for a validation.
   - **Early revert tickets:** two inherited reds on the same sprout commit open one at once.

   What the ported engine has (`packages/gateway`, "The v2.2 rules"). These are on by default:
   - adaptive re-check;
   - the agent released during its check;
   - flake-confirmed reverts;
   - cards that re-execute the loser, with a test author amending its tests;
   - **inherited reds**, a new rule from E6: a bean whose pre-land failures match the sprout's own known red waits for the sprout to move instead of spending a rework round.

   Simulated, with 40 tasks, 8 replay agents, seed 7 and 60 s CI on 2 slots:

   | Variant | Green | Time |
   |---|---|---|
   | queue | 38 | 27.2 min |
   | v2.0 | 38 | 15.4 min |
   | v2.2 | 39 | 11.7 min |
   | v2.2 without inherited reds | 35 | 11.8 min |

   On the deployed gateway, the replay race kept v2.0's 25 greens in 4.2 min instead of 6.1. Not ported from E6: start cards, declared couplings, dynamic culprits, rescue re-execution, and the contract oracle.

   **v2.4 (done, the CF v2.4 row):** reconcile before a card, and re-check after stale failures. **Next, v2.5:** reconcile with every landed task behind the failing assertions (the read-set suspects since the bean's base), not just the named counterpart; t032 clashes with two. Earlier note: The counterpart should be the owner of the failing acceptance test that isn't the bean's own. Inherited failures, and failures from a check that began before a revert, must not count. The test author then gets the counterpart's test, so it can amend the loser's tests to the decided spec. This is E6's dynamic-culprit rule, and in the CF v2.3 race it cost the one loser.
   **v2.5 engine items (2026-10-05, simulated only).** Four settings in `packages/gateway` (README, "The v2.2 to v2.5 rules"):
   - `single_suspect_revert` (on): a red sprout with one suspect is reverted at once, without the bisect.
   - `base_culprits` (on): a pre-land red names a culprit already in the bean's base when the failing test's read set points to it, so informed reworks and cards see it (it rescued t007 in the earlier-table race).
   - `window_start` 8 (was 4), `window_growth` 2, `window_max` 16, `window_min` 2. The suggested 8/+4/24 lost greens and was slower in the earlier and flaky races. The floor never mattered.
   - `validation_first`: **off**. Validations jumped ahead of bisect probes but checked a head that still held the culprit, so red episodes got longer (done +0.2 to +0.6 min).

   Simulator means over 16 seeds (40 tasks, 2 CI slots; earlier = 8 agents with seeded agent times; flaky = burst with 5% flaky runs):

   | Scenario | Arm | Green | 20th green | 30th green | Done (min) |
   |---|---|---|---|---|---|
   | burst | v2.4 | 38.0 | 9.6 | 13.3 | 18.5 |
   | burst | v2.5 | 38.5 | 9.6 | 12.8 | 16.9 |
   | calm | v2.4 | 40 | 6.2 | 7.2 | 8.9 |
   | calm | v2.5 | 40 | 5.4 | 6.8 | 8.3 |
   | earlier | v2.4 | 38.4 | 8.6 | 10.8 | 18.6 |
   | earlier | v2.5 | 38.9 | 7.0 | 9.6 | 16.6 |
   | flaky | v2.4 | 37.7 | 10.4 | 13.2 | 17.6 |
   | flaky | v2.5 | 37.8 | 10.0 | 12.3 | 16.7 |

   On the burst's own seed 7, v2.5 lands 39 green against 40, and the 20th green comes at 8.5 min against 6.5. No setting brought back v2.2's collapse. Real races have not been run yet.

2. **Forge-owned tests** (E1): a test-author step with fail-first proof for every task, and a targeted check on the exact landing tree. The engine's test author only amends a loser's tests today.
3. **Planning and dependency-aware starts** (E4), the real limit at thousands of agents.
4. **Stalk promotion as a GitHub Action** that triggers a verifier agent (`10` §5c); the MCP server and Claude Code plugin; the Ask explorer and race canvas (`13`, in `packages/web`).
