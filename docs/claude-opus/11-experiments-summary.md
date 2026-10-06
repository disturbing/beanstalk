# What the seven experiments say about v2 (living summary)

Started 2026-10-03, evening; updated as experiments finish. **All seven experiments, v2.1/v2.2 and the Cloudflare confirmation are complete.** Each experiment has its own write-up in `exp/`. Names: a **bean** is an agent's change, the **sprout** is the staged line, the **stalk** is the stable line. Unless stated, runs used Sonnet with 12 agents, 60 s emulated CI on 2 slots, and every landed acceptance test protected. All numbers are measured unless marked simulated.

## Status

| # | Question | Status | One-line answer |
|---|---|---|---|
| E1 | Tasks without ready-made tests | done (`exp/e1-tests-first.md`) | Without forge-owned tests, v2's stalk goes wrong silently (6 of 39 greens wrong, every signal green). A separate test author plus an **exact-tree check** helps, but cross-task contracts still need their own step |
| E2 | A real repo (markedjs/marked, 24 real fixes) | done (`exp/e2-real-arena.md`) | With no contention, v2 **lost** (19–20 min vs 4.4) because its file-level re-check fired about 50 times per race. Fixed by v2.1 (below) |
| E3 | Flaky tests (5% per run) | done (`exp/e3-flaky-tests.md`) | Cheap at 2–5%: v2 sees about 5x the queue's flakes (more test runs) but they cost cents (3 needless reworks, $0.19). The costly case is a flaky stalk validation reverting a good bean; re-run-once missed a double flake, so **revert only if the same test fails twice**. Re-running every red doesn't pay (break-even about 24% flake rate). v2 plain 12.5 min / v2 mitigated 15.0 min vs queue + retry 28.7 min |
| E4 | Scale 100–1,000 agents (replay of real codex history) | done (`exp/e4-scale-replay.md`, simulated timing, real merges) | The sprout committer is 1–3% busy at 1,000 agents; done → sprout is about 1 min. The limit at scale is **independent work** (dependency chains), not merge mechanics |
| E4 follow-up | Dependency-aware starts (`start_order: dependency`), engine simulator, replay agents (2026-10-05) | done, **simulated** (`packages/gateway` `v2-start-order.ts`; tests `v2-burst.test.ts`, `v2-start-order.test.ts`) | A free agent takes a bean whose predicted modules and declared couplings clash with no bean in flight and no earlier unlanded task, longest dependent chain first; otherwise the fewest clashes, but never alongside more than 2 clashing beans in flight (else it waits for a landing); a task 2×agents starts behind its FIFO turn goes next. **40-task burst, 12 agents:** 40 green both, done 16.0 vs 19.2 min, 30th green 6.5 vs 12.8, 35th 8.5 vs 13.9, re-checks 18 vs 38; under the v2.2 rules 36 green vs 27, 2 red validations vs 11. Calm arena: identical. **200 tasks with dependency chains (20 chains of 2–20, 70 singletons), 64 agents:** 200 green vs 173 (0 vs 27 dropped), conflicts 108 vs 187, 170th green 28.2 vs 26.3 min; done 60.5 vs 28.4 min (FIFO finishes early by dropping chain members). 50 agents: 200 vs 176 green, 170th green 31.8 vs 30.7. Waiting for every predecessor to land (no pipelining) loses all 200 to a 137-min critical path; pipelining 3 deep drops 3. **Default stays `fifo`** until a real-agent race confirms it: replay agents can't adapt, footprints here are exact or declared, and a bean started on top of its landed coupled partner can't name it as a culprit (culprits are only the commits since its base), so it reworks to a drop instead of reaching a card (closed in the merged v2.5 engine: start cards, base culprits and dynamic culprits each name the partner; see "v2.5, the merged engine") |
| E5 | Longer tasks (about 2-minute beans, about 7x longer) | done (`exp/e5-long-tasks.md`) | v2's lead **shrinks but holds**: queue ÷ v2 time to done 1.32–1.40x (short tasks: 1.46–2.48x), and v2 becomes slightly **cheaper** (0.94–0.95x). The queue leads on early greens. v2 **blocks agents while their change is checked** (72 of 139 busy agent-minutes). Observe-then-place and mid-flight notices don't earn a place at these lengths |
| E6 | Decision cards that re-execute the loser | done (`exp/e6-decision-cards.md`) | **All 40 tasks shipped** in 3 clean runs, against 35, at no extra cost. Default: keep the winner, amend the loser's tests to the decided spec, re-execute the loser |
| E7 | Seed variance; mixed Claude + Codex fleet | done (`exp/e7-variance-and-mixed-fleet.md`) | **v2 finished first in 5 of 5 seed pairs: queue ÷ v2 time to done, geometric mean 1.98x (95% CI 1.68–2.28, p = 0.008).** The queue is the noisy one (16.5–34.7 min vs 11.3–14.4) and reaches the 20th green first in 4 of 5 pairs; v2 costs about 12% more. Mixed fleet (6 Sonnet + 6 Codex): v2 15.2 vs queue 23.6 min (1.55x); cross-vendor collisions not shown worse (RR 1.4, CI 0.6–3.3) |
| CF | The same race on the deployed Cloudflare prototype | done (`08` §5.5) | Replay parity: identical decisions. **Real agents: v2 17.5 min vs queue 40.6 min to done (2.3x), faster at every milestone, +21% cost, both stalks correct** |
| CF v2.2 | All the v2.2 rules together, real agents on Cloudflare (2026-10-04) | done, **failed** (`research/race/runs/cf-v22-sonnet-12-s7`) | **24 green, 16 dropped, 24.9 min, 10 red validations, 4 revert tickets; stalk correct.** Worse than v2.0 (35 green) and the queue (36). Releasing agents during checks produced a burst (19 landings in minute 2; v2.0 never exceeded 5 a minute). The adaptive re-check skipped all re-checks, because the first checks against the base were green, a lagging signal. Validation (2 CI slots) fell 27 commits behind and bisects took about 6 minutes each. Inherited reds never fired, because they wait for a red validation that came minutes late, so 11 innocent beans burned their rework rounds. The replay simulator had predicted 39 of 40; replay agents do not reproduce the burst |
| CF v2.3 | v2.2 plus a sprout window, sampled re-checks, read-set inherited reds and early tickets, real agents on Cloudflare (2026-10-04) | done (`research/race/runs/cf-v23-sonnet-12-s7`) | **34 green, 6 dropped, 17.9 min, $5.14, 4 red validations, 1 revert ticket; stalk correct.** It fixes v2.2's collapse (24 green) and ties v2.0 (35 green, 17.5 min). The 20th green comes sooner (10.4 vs 11.3 min) and the 30th about the same (14.3 vs 13.8). The window held landings to 6 a minute (v2.2: 19). It grew from 4 to 16 in under 6 minutes and halved once, on the one red episode, which stalled landings for 3 minutes. Drops: 4 merge conflicts the agents could not resolve, 1 revert, and 1 decision-card loser. **The card named the wrong counterpart.** It was raised from a check that began before a revert, so a stale failure blamed t005, while t032's real conflict was with a landed task's test (`confirmation-grouping`). The test author rightly found nothing to amend, and the loser was dropped. E6's dynamic culprits are not ported yet |
| CF v2.4 | v2.3 plus reconcile-before-card and stale-failure re-checks, real agents on Cloudflare (2026-10-04) | done (`research/race/runs/cf-v24-sonnet-12-s7`) | **Best run so far: 37 green, 3 dropped, 17.7 min, $4.40, 4 red validations; stalk correct.** Against the queue (36 green, 40.6 min, $4.12): the 30th green at 8.9 min vs 19.9 (2.2x), the 35th at 15.2 vs 35.0 (2.3x), and done 2.3x sooner, for 7% more spend. Against v2.0: the 20th green at 6.7 vs 11.3 min and 2 more greens. The one reconcile attempt ended in a CONTRADICTION, rightly. The test author found that t032's tests also clash with a third landed task's free-shipping threshold ("that rule comes from neither task"), so reconciling only t032 with t005 could not fix it. Part of the gain over v2.3 is probably run-to-run variance (one seed) |
| CF v2.5 phase matrix | Every v2.5 phase against the queue and v2.4, three seeds each (7, 11, 13), 12 Sonnet agents on Cloudflare (2026-10-05 and 06) | done (`research/race/runs/cf-{queue,v24,v25a,v25b,v25c,v25d,v25dep,v25dep2}-sonnet-12-s*`; seed 7 queue is `cf-queue-sonnet-12-s7-landed`) | **Only the full v2.5 set plus dependency-aware starts (and the tail fix) wins: 39/39/38 green against the queue's 36/35/37, the 35th green 1.7–2.1x sooner, done about 1.3x sooner, stalk correct in every run.** Green per seed (7/11/13), 35th green (min), done (min), agent $ for the three, red validations, from `kth_green.py --k 35` and the summaries: queue 36/35/37, 35.0/29.2/36.8, 40.6/30.2/39.5, $13.16, 10/8/10 · v2.4 37/32/33, 15.2/–/–, 17.7/17.3/25.4, $15.98, 4/5/13 · v2.5a (B: lone suspects, base culprits, window 8) 34/33/37, –/–/14.0, 22.5/18.8/15.6, $15.66, 8/10/4 · v2.5b (+A: escalation, parties) 31/33/29, –/–/–, 14.9/14.9/29.6, $18.06, 5/4/15 · v2.5c (+C: structural merges) 30/35/34, –/20.5/–, 20.9/22.7/19.7, $18.67, 9/8/7 · v2.5d (+E: start cards, rescue, dynamic culprits = full v2.5, FIFO starts) 37/39/37, 21.8/15.2/28.0, 22.8/24.6/40.5, $18.79, 6/0/8 · v2.5 + dependency starts, before the tail fix (`cf-v25dep-*`) 39/39/39, 13.0/16.3/14.1, **60.0/60.0/54.7** (s7 and s11 aborted at the 60-minute wall cap on t032; see "v2.5 tail fix" below), $15.26, 0/4/0 · **v2.5 + dependency starts with the tail fix, the rerun (`cf-v25dep2-*`)** 39/39/38, 17.1/14.9/22.0, 31.6/24.0/29.8, $15.58 (6.08/4.18/5.32), 4/0/4; metered Cloudflare infrastructure $0.38/$0.35/$0.42. What it shows: **the partial phases were worse.** v2.5a to v2.5c shipped 31–34.7 green on average, no better than v2.4 (34.0) and below the queue (36.0), and v2.5b to v2.5d cost the most ($18.06–18.79 for three races); the rules only pay together. Full v2.5 with FIFO starts ships more (37.7) but is slow (29.3 min mean done, 40.5 on s13). Dependency starts are what turn it into a win; before the tail fix the gain was hidden behind one looping bean. **The simulator over-predicted v2.5:** it gave v2.5 38.5 green and 16.0 min done on the burst (v2.5 + dependency starts on the declared burst: 40.0 green, 12.1 min) and rated v2.5a–c at or above v2.4; the real races gave 37.7 green, 29.3 min for v2.5d and 38.7, 28.5 min for the rerun, and the partial phases below v2.4. v2.4 and the partial phases finish sooner (19.0–21.1 min mean done) because they drop more beans. Notes: **network outage:** a network outage hit the race machine during the batch (operator's report); the recorded runs show no infra stop, no failed invocation and no event gap other than the dynamic-culprit searches, so none is excluded for it. **Queue seed 7:** `cf-queue-sonnet-12-s7` ran with `--protect-tests own` and its final stalk was wrong (37 green, 5 failing files); `-landed` is the like-for-like run with every landed test protected, as in all others. Caveats: three seeds, one run each; synthetic arena; short tasks; agent cost measured, infrastructure metered only for the rerun |
| 30-agent post-mortem | Why v2.5 (`demo` preset) lost its lead at 30 agents (`cf-demo-sonnet-30-s7` against `cf-queue-sonnet-30-s7`, 2026-10-06), a simulator fixture of the stall, and a culprit-isolation study | diagnosis and study done, **simulated** (fixture `packages/gateway/src/engine/testing/burst30.ts`, study `testing/culprit-study.ts`; section "30-agent post-mortem" below) | **The stall was one whole-suite break that could not be reverted, not a lack of CI capacity.** Two migrations numbered 0007 (t010 on top of t011) landed without a re-check and failed 45–52 test files from minute 8.3. The culprit's revert conflicted three times (t007 had edited the migration index). Two nested tickets reverted innocent beans (t022, t009) whose new tests failed with the suite. The bean that fixed it forward (t026, green at 14.95) waited 11.8 minutes for the window. Recommendation: **revert-then-requeue the red window** (reset the sprout to the stalk and send the window's beans back through their pre-land checks), keeping the lone-suspect revert as the fast path |
| v2.1 / v2.2 | Finer or adaptive re-check | done | **Calm repo (marked):** line-level 5.4–6.0 min, adaptive 5.2–5.3 min (file-level v2: 19–20; queue: 4.4), all correct. **Contended arena:** line-level is unsafe (4 red validations, 29 greens). **Adaptive with file-level fallback (v2.2): 35 greens, 10.1 min, $5.43, 3 red validations, correct**, matching file-level v2 (35, 11.3 min, $5.29, 1 red). **Rule:** skip re-checks while pre-land reds are rare; fall back to file-level once they appear |

## The design changes so far

1. **The re-check adapts to the red rate** (E2, v2.1). Calm repos skip re-checks after a moved sprout (as fast as a queue); once pre-land reds appear, re-check on any shared file. Line-level re-checks are fast but let same-file semantic breaks through under contention, so they're **not** the fallback.
2. **Check the exact tree that lands, cheaply** (E1). A landing onto a moved sprout runs a targeted check on the exact landing tree: the bean's own tests plus the tests of beans that landed meanwhile. The full suite runs at stalk promotion. E1 found a hole without this; E2 found heavy overhead with a full re-check. A targeted check covers both. Built in the engine (v2.5, off by default; see below).
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

   On the deployed gateway, the replay race kept v2.0's 25 greens in 4.2 min instead of 6.1. **The rest of E6 is ported (2026-10-05), on by default:** start cards from declared couplings (`start_cards`; also a card at the first red against a declared partner in flight, and a re-check when one lands meanwhile), one rescue re-execution after the rework rounds run out (`rescue`), and dynamic culprits by leave-one-out probes, before the bean's snapshot too (`dynamic_culprits`; candidates by read set, since the runner reports no coverage). Simulated: no change on the burst or the calm repo (40 green, 19.2 and 8.5 min); with the burst's pairs declared as couplings, 16.0 min instead of 19.2; the rescue alone turns v2.2's burst from 27 green into 36. A bean whose own test pins what a landed partner changed (t031 under t005, t036 under t023) was dropped by v2.4 and now ships through a start card. Still not ported: the contract oracle and `CARD_AFTER=1` for undeclared pairs. Details: `packages/gateway/README.md`, "Start cards, rescue and dynamic culprits". Not yet run with real agents.

   **v2.4 (done, the CF v2.4 row):** reconcile before a card, and re-check after stale failures. **v2.5, escalation and parties (A; built, simulated only; `packages/gateway/README.md`, "The v2.2 to v2.5 rules"):** the reconcile takes in every landed task behind the failing tests (failing-test owners and read-set suspects since the bean's base, at most 3), and a bean escalates (reconcile, then a card) after one failed informed repair whose failing test file fails again, instead of two; a bean still red against a counterpart already reconciled and decided is dropped rather than spending its last rounds (t032 spent about 8 minutes that way). In the simulator's replay of t032's three-way clash, v2.4 drops t032 at 16.2 min after 7 reworks and 2 cards; v2.5 lands it at 6.5 min after 1 rework and one reconcile. The 12-agent burst stays at 40 green and finishes in 17.4 min instead of 19.2; the calm race is unchanged. Not yet run on Cloudflare with real agents. Earlier note: The counterpart should be the owner of the failing acceptance test that isn't the bean's own. Inherited failures, and failures from a check that began before a revert, must not count. The test author then gets the counterpart's test, so it can amend the loser's tests to the decided spec. This is E6's dynamic-culprit rule, and in the CF v2.3 race it cost the one loser.

   **v2.5, shorter red episodes (B; 2026-10-05, simulated only).** Four settings in `packages/gateway` (README, "The v2.2 to v2.5 rules"):
   - `single_suspect_revert` (on): a red sprout with one suspect is reverted at once, without the bisect.
   - `base_culprits` (on): a pre-land red names a culprit already in the bean's base when the failing test's read set points to it, so informed reworks and cards see it (it rescued t007 in the earlier-table race).
   - `window_start` 8 (was 4), `window_growth` 2, `window_max` 16, `window_min` 2. The suggested 8/+4/24 lost greens and was slower in the earlier and flaky races. The floor never mattered.
   - `validation_first`: **off**. Validations jumped ahead of bisect probes but checked a head that still held the culprit, so red episodes got longer (done +0.2 to +0.6 min).

   **v2.5, the merged engine (branch `engine-v2.5`, 2026-10-05, simulated only).** Six branches merged into one engine: A (escalation after one repeated red, every landed party reconciled), B (lone-suspect reverts, base culprits, window start 8; validations-first stays off), C (the runner's structural merge tier, conflict hunks and the richer conflict prompt), D (tests first and the targeted landing check, off), E (start cards, rescue, dynamic culprits) and F (`start_order: dependency`, off). Every rule is a setting; `V25_RULES_OFF` / `V24_SETTINGS` in `@beanstalk/shared-race/run-config` turns all of them off, and the parity settings stay byte-identical.
   - **Labels.** A run with any v2.5 rule reports `variant: "v2.5"`. Tests first, the targeted check and dependency starts are opt-in tracks: they never change the variant and are listed in `variant_additions` (and after a `+` in the Variant row), so "v2.5 + tests track" is `"v2.5"` with two additions. The gateway README's "Version labels" has the presets and the environment of each phase race.
   - **Queue fairness.** The runner turns its structural tier on by default and the gateway sent no flag, so the queue would have merged structurally too. Every squash now carries `structural_merge`, true only for v2; the queue always sends `false` and `RunConfig` refuses `true` for it.
   - **The "red stalk" at flaky seed 9 was a flaky final check.** B's table showed v2.4's final stalk wrong (`correct: false`) on the flaky burst, seed 9, "confirmed red on re-check". The stalk commit had passed its validation, and twelve re-runs pass; the final check's single suite run hit the injected 5% flake, and the lab's confirming re-check ran on the same flaky world and flaked too. v2 now re-runs a red final suite once on a commit it validated green (with `flake_confirm`); a commit red twice stays red. The queue and v2.0 keep the harness's single run. Regression test: `v2-stalk.test.ts`. In the table below, no arm promoted a commit that is red without flakes (`redStalkCommits`).
   - **F's culprit gap is closed.** A bean started on top of its landed coupled partner, clashing in a test neither owns, named no culprit under v2.4; `base_culprits` names the partner by the failing test's read set, `start_cards` raises the declared pair's card before the bean starts, and `dynamic_culprits` probes it when the bean's own tests fail (`v2-start-order.test.ts`).
   - **Merge decisions.** A bean stuck against a decided culprit (A's drop) is first rescued once (E). Dynamic culprits travel with the red check and replace the read-set guess, base culprits and reconcile parties included. A declared partner is stuck at its first red (E), any other pair by A's repeat rule. A start-carded bean skips the tests-first author.

   Simulator means over 16 seeds (40 tasks, 12 replay agents, 2 CI slots, 60 s CI; burst = the v2.2 burst with seeded agent times; calm = overlaps only; earlier = 8 agents; flaky = burst with 5% flaky CI runs; `testing/burst.ts`). Dropped includes reverted beans. Final check correct counts seeds; red stalk commits counts seeds where any promoted commit fails a non-flaky test on re-check:

   | Scenario | Arm | Green | Dropped | 20th green | 30th green | Done (min) | Red validations | Final check correct | Red stalk |
   |---|---|---|---|---|---|---|---|---|---|
   | burst | v2.4 | 38.0 | 2.0 | 9.6 | 13.3 | 18.5 | 2.9 | 16/16 | 0 |
   | burst | v2.5a (B) | 38.5 | 1.5 | 9.6 | 12.8 | 16.9 | 2.8 | 16/16 | 0 |
   | burst | v2.5b (+A) | 38.5 | 1.5 | 9.6 | 12.8 | 16.0 | 2.8 | 16/16 | 0 |
   | burst | **v2.5** (+C, +E: defaults) | 38.5 | 1.5 | 9.6 | 12.8 | 16.0 | 2.8 | 16/16 | 0 |
   | burst | v2.5 + dependency starts | 38.5 | 1.5 | 9.6 | 12.8 | 16.0 | 2.8 | 16/16 | 0 |
   | burst | v2.5 + tests track | 40.0 | 0.0 | 7.9 | 9.8 | 13.3 | 0.0 | 16/16 | 0 |
   | calm | v2.4 | 40.0 | 0.0 | 6.2 | 7.2 | 8.9 | 0.0 | 16/16 | 0 |
   | calm | **v2.5** | 40.0 | 0.0 | 5.4 | 6.8 | 8.3 | 0.0 | 16/16 | 0 |
   | calm | v2.5 + dependency starts | 40.0 | 0.0 | 5.4 | 6.8 | 8.3 | 0.0 | 16/16 | 0 |
   | calm | v2.5 + tests track | 40.0 | 0.0 | 5.2 | 8.1 | 11.0 | 0.0 | 16/16 | 0 |
   | earlier | v2.4 | 38.4 | 1.6 | 8.6 | 10.8 | 18.6 | 3.4 | 16/16 | 0 |
   | earlier | v2.5a (B) | 38.9 | 1.1 | 7.0 | 9.6 | 16.6 | 2.8 | 16/16 | 0 |
   | earlier | **v2.5** (b, c, d alike) | 38.9 | 1.1 | 7.0 | 9.6 | 15.6 | 2.8 | 16/16 | 0 |
   | earlier | v2.5 + dependency starts | 38.9 | 1.1 | 7.0 | 9.6 | 15.6 | 2.8 | 16/16 | 0 |
   | earlier | v2.5 + tests track | 40.0 | 0.0 | 7.9 | 9.8 | 13.7 | 0.0 | 16/16 | 0 |
   | flaky | v2.4 | 37.7 | 2.3 | 10.4 | 13.2 | 17.6 | 3.6 | 16/16 | 0 |
   | flaky | v2.5a (B) | 37.8 | 2.3 | 10.0 | 12.3 | 16.7 | 4.1 | 16/16 | 0 |
   | flaky | v2.5b (+A), v2.5c (+C) | 38.4 | 1.6 | 9.9 | 12.2 | 16.4 | 4.4 | 16/16 | 0 |
   | flaky | **v2.5** | 38.4 | 1.6 | 9.9 | 12.2 | 16.5 | 4.5 | 16/16 | 0 |
   | flaky | v2.5 + dependency starts | 38.4 | 1.6 | 9.9 | 12.2 | 16.5 | 4.5 | 16/16 | 0 |
   | flaky | v2.5 + tests track | 39.9 | 0.1 | 8.7 | 10.4 | 14.7 | 1.1 | 16/16 | 0 |

   v2.5c equals v2.5b everywhere and v2.5d (E) equals v2.5c except one flaky row: the simulator scripts no structural merges and these races declare no couplings. For the same reason dependency starts match FIFO here: without predicted footprints or couplings every bean is clear. With the burst's pairs declared as couplings and modules predicted (the `declaredBurst` shape, same 16 seeds):

   | Arm | Green | Dropped | 20th green | 30th green | Done (min) | Red validations |
   |---|---|---|---|---|---|---|
   | v2.4 | 38.0 | 2.0 | 9.6 | 13.3 | 18.5 | 2.9 |
   | v2.4 + dependency starts | 37.4 | 2.6 | 10.1 | 11.7 | 16.3 | 3.1 |
   | **v2.5** | 40.0 | 0.0 | 6.1 | 11.0 | 13.7 | 0.0 |
   | v2.5 + dependency starts | 40.0 | 0.0 | 5.7 | **7.5** | 12.1 | 0.0 |
   | v2.5 + tests track | 40.0 | 0.0 | 8.4 | 10.5 | 13.3 | 0.0 |

   Read with care: replay agents cannot adapt, and the tests track's gain on the bursts comes mostly from its author step staggering the starts (D's note), not from better tests; the replay agents write no tests, so tests first falls back to the given ones. v2.5 is the default; dependency starts and the tests track stay opt-in. Real races (2026-10-06, the CF v2.5 phase matrix row) measured dependency starts: v2.5 plus dependency starts is now the `demo` preset; the tests track is still unmeasured.

   **v2.5 tail fix (2026-10-06, simulated; from the real races `cf-v25dep-sonnet-12-s7` and `-s11`).** v2.5 with dependency starts, 12 Sonnet agents: every other bean was done by minute 14 (s7) or 23 (s11), but t032 looped until the 60-minute wall cap (`Aborted: wall-clock limit of 60 minutes`, no drops). Its shipping clashes with t005's pinned email total and with t033's free-shipping threshold, both landed in its base. The s7 events from minute 14 repeat one cycle: a dynamic-culprit search of 24 candidates (6 to 12 minutes each, four full suites at a time in one sandbox) confirming none, an informed rework, red; a reconcile with t005 alone (the search confirmed nothing, so only the failing test's owner was a party), CONTRADICTION, a keep-landed card, test author `none`, the re-execution at attempt 1, red; another search, another rework at attempt 1, the rescue at attempt 1, another search. Root causes, and the fix (`packages/gateway/README.md`, "The t032 tail"):
   - **Every reset restarted the count.** `max_rework` counts rounds since the last reset, and both the card's re-execution and the rescue reset it. The card also reset A's repeat count, so the drop after the decision needed one more red after the card and another after the rescue. Now a card keeps the repeat count (the loser red again on its card's failing file is stuck against the decided counterpart at once, rescued once, then dropped), a rescue keeps it against decided culprits, and `max_bean_invocations` (default 10) drops a bean whose check fails after that many agent invocations of any kind.
   - **A full search on every red that could never confirm.** Leave-one-out confirms a bean only when the bean's own failing tests pass without it; with two landed beans breaking the test together, neither passes alone, and the real culprits (landed early) were not among the 24 newest candidates anyway. Now at most 6 candidates (ranked as before), at most `ci_slots` probes at once (they run in the bean's sandbox, never on CI slots, so validations never wait for them), one search per bean and set of counterparts its red names (a repeat reuses the answer), and none once a named counterpart was decided by a card.
   - **No run-level guard.** `tail_guard_minutes` (default 10): once nothing is left to start and every unlanded bean has failed a check, a bean with no progress for that long (no failing set it had not seen, no landing) is dropped at its next failed attempt.

   In the simulator's replay of the loop (`v2-tail.test.ts`: t032's own test broken by two landed beans together, eight decoy readers, a stubborn loser), t032 was dropped at 12.5 min after 6 red checks, 6 searches of 9 candidates and 8 invocations; now at 9.3 min after 4 red checks, one search of 6 and 6 invocations (the probes cost no simulated time, so the real gap is far larger: each skipped search was 6 to 12 minutes in s7). Applied to the s7 trace, t032 would be dropped at its fourth red (around minute 25, estimated from s7's step times with one search of 6) instead of reaching the cap. Over the same 16 seeds, every scenario's v2.5 row is identical to three decimals (burst 38.5 green, 16.0 min; calm 40.0, 8.3; earlier 38.9, 15.6; flaky 38.4, 16.5; declared 40.0, 13.7; dependency starts alike; final check correct 16/16 and no red stalk commit in every row): no bean in them fails its own test against a landed bean, and none reaches a bound. A ceiling of 8 would have dropped one innocent bean in the earlier race (seed 1, nine invocations, landed by its rescue), hence 10. `V25_RULES_OFF` (so the demo preset and every older preset) turns both bounds off, and the parity settings stay byte-identical. **Run with real agents (2026-10-06, `cf-v25dep2-sonnet-12-s*`):** no run reached the wall cap; done at 31.6/24.0/29.8 min, with one tail-guard drop in s7 (the CF v2.5 phase matrix row).

   **Parking (2026-10-06, simulated; owner's decision).** In the `cf-v25dep2-*` races the last useful green came at 23.0 / 19.1 / 26.7 min and the runs ended at 33.1 / 25.4 / 31.3 min, the engine retrying and waiting on one or two hopeless beans (t032's genuine contradiction). Now (`park: true`, default for v2 and in the `demo` preset; older presets and the parity settings off) such a bean is **parked**: a terminal state that does not ship, with a `parked_reason` (`needs a person: two specs disagree (t005)`, `... still failing after 10 attempts`, `... no progress for 3 minutes`, `... decision card D001 (t002 vs t001)`) and a `task.parked` event. A card's loser still red after its re-execution is parked at once (no rescue); the invocation ceiling and the tail guard park instead of dropping, and the tail guard's window is 3 minutes (was 10); a card only a person answers parks its bean when it opens (a person's answer during the race takes it up again). The race finishes when every bean is green, dropped or parked; `summary.json` lists `parked` with reasons and `summary.md` adds the row "Parked, needs a person". Simulated (`v2-park.test.ts`): t032's loop ends at 8.0 min instead of 9.3 (last green 3.3), the two-way contradiction at 7.9 instead of 9.7 (last green 2.2); what is left after the last green is the stuck bean's own first attempts and its card. Burst, calm, earlier and flaky: identical over 16 seeds; parity and the queue unchanged. `kth_green.py` now reports the median and p90 task start to green and the last green (the `cf-v25dep2` races: 4.8 / 13.1, 3.9 / 8.2, 4.8 / 14.3 min; last green 23.0, 19.1, 26.7) and counts parked beans apart from the greens. Not yet run with real agents.

2. **Forge-owned tests** (E1): a test-author step with fail-first proof for every task, and a targeted check on the exact landing tree. **Built 2026-10-05, off by default** (`tests_first`, `targeted_landing_check`; reported as an added setting on top of the variant label, see `packages/gateway/README.md`, "Version labels"). See `packages/gateway/README.md`, "Forge-owned tests":
   - **Tests first:** a `test-first` invocation writes the task's tests from its intent before the implementer starts; files that fail on the base replace the given tests as its protected acceptance tests, else the given tests stay (`tests.first`). The driver commits only the new test files.
   - **Targeted check:** a bean about to land on a moved sprout without a full re-check runs its own tests, the meanwhile-landed beans' tests and the tests whose read set meets its files, on the exact landing tree, but only those whose read set meets both sides (the runner now reports passing tests' read sets on request). Once outside the turn, then inside it.
   - **Simulated** (replay agents): a weak given test lets a bug onto the stalk with every signal green, and the fail-first author catches it before landing (one rework). A clash between files that do not overlap lands unchecked without the targeted check (2 red validations, a revert, the bean dropped); with it, it is red before landing and both beans ship. Burst and calm races: the same 40 greens, 0 red validations; the targeted check alone decides exactly as v2.4 there (no test reads both sides); tests first adds the author step (calm 8.5 → 10.9 min).
   - **Why off:** E1 measured them only together on one race, authors see 1 of 5 designed contract clashes (the arena's given tests 5 of 5), and an early version that ran every candidate test on every moved-sprout landing doubled the calm race's time and, by delaying landings, let burst clashes through (5 red validations). Next: a real race on the arena with the given tests hidden, (b) against (c′) on the engine.
2b. **Live sprout sync** (owner's idea, 2026-10-05; **built, simulated only, off by default**: `live_sync: off | overlap | all`, env `LIVE_SYNC`; `packages/gateway/README.md`, "The v2.2 to v2.5 rules"). When a bean lands, beans whose agents are working get it at their next safe point. `claude -p` cannot be interrupted, so the safe point is the end of the agent's current invocation: the bean's first squash afterwards merges what landed meanwhile. Clean: the agent (kept, session resumed) gets a short `sync` invocation with the new sprout merged (re-run the tests, fix what broke, else change nothing) before its pre-land check, no round spent (`sync.applied`). Conflict: nothing is merged and the conflict rework's prompt opens with a note naming the landed beans and files (`sync.noted`). `overlap` = the bean's files (CHANGELOG-style union files aside) or a declared coupling, either side; `all` = every bean that landed meanwhile. The driver runs `sync` as a rework and aborts it (no agent, `sync-conflict`) if its own merge conflicts.

   Simulator means over the same 16 seeds (v2.5 defaults; `long` = the seeded burst with initial runs 5x longer, 75–175 s, so partners land while beans are written, `longBurst` in `testing/burst.ts`; `declared` = the `declaredBurst` shape; `+ adapt` = an optimistic bound in which a sync turn that merged a clash naming the bean rewrites it as its re-execution would; the replay agents otherwise ignore what they are synced). Final check correct 16/16 in every row:

   | Scenario | Arm | Green | 20th green | 30th green | Done (min) | Conflicts | Red pre-land | Re-checks | Red validations | Syncs applied |
   |---|---|---|---|---|---|---|---|---|---|---|
   | burst | v2.5 | 38.5 | 9.6 | 12.8 | 16.0 | 0 | 30.9 | 29.3 | 2.8 | 0 |
   | burst | overlap (+ adapt alike) | 38.5 | 9.6 | 12.8 | 16.0 | 0 | 30.9 | 29.3 | 2.8 | 0 |
   | burst | all | 38.1 | 10.4 | 13.7 | 16.7 | 0 | 38.8 | 30.4 | 3.6 | 18.3 |
   | burst | all + adapt | 38.1 | 10.4 | 13.8 | 16.0 | 0 | 38.1 | 30.4 | 3.9 | 18.1 |
   | calm | v2.5, overlap | 40.0 | 5.4 | 6.8 | 8.3 | 0 | 0 | 10.4 | 0 | 0 |
   | calm | all (+ adapt alike) | 40.0 | 5.4 | 6.8 | 9.2 | 0 | 0 | 9.7 | 0 | 16.0 |
   | earlier | v2.5 | 38.9 | 7.0 | 9.6 | 15.6 | 0 | 12.3 | 28.2 | 2.8 | 0 |
   | earlier | overlap (+ adapt alike) | 38.9 | 7.0 | 9.8 | 15.6 | 0 | 12.7 | 28.2 | 2.8 | 0 |
   | earlier | all | 38.9 | 9.5 | 11.1 | 15.8 | 0 | 23.1 | 26.3 | 2.9 | 27.4 |
   | earlier | all + adapt | 38.8 | 9.7 | 11.2 | 14.4 | 0 | 20.2 | 25.8 | 3.1 | 26.4 |
   | flaky | v2.5 | 38.4 | 9.9 | 12.2 | 16.5 | 0 | 29.5 | 29.6 | 4.5 | 0 |
   | flaky | overlap (+ adapt alike) | 38.5 | 10.1 | 12.2 | 16.6 | 0 | 29.6 | 30.1 | 4.3 | 0 |
   | flaky | all | 38.3 | 10.1 | 12.4 | 17.4 | 0 | 31.9 | 29.8 | 4.1 | 22.5 |
   | flaky | all + adapt | 38.2 | 10.2 | 12.6 | 16.6 | 0 | 30.6 | 30.2 | 4.3 | 21.6 |
   | declared | v2.5, overlap | 40.0 | 6.1 | 11.0 | 13.7 | 0 | 4.0 | 34.3 | 0 | 0 |
   | declared | all (+ adapt alike) | 40.0 | 6.3 | 11.1 | 13.7 | 0 | 4.0 | 33.8 | 0 | 17.6 |
   | long | v2.5 | 38.6 | 13.2 | 20.6 | 32.4 | 0 | 10.9 | 18.7 | 3.0 | 0 |
   | long | overlap (+ adapt alike) | 38.6 | 13.1 | 20.6 | 32.4 | 0 | 10.7 | 18.4 | 2.8 | 0 |
   | long | all | 38.8 | 13.1 | 21.3 | 34.4 | 0 | 12.3 | 17.8 | 3.1 | 35.6 |
   | long | all + adapt | 38.8 | 12.7 | 20.6 | 33.6 | 0 | 10.3 | 18.5 | 2.9 | 33.5 |
   | long + declared | v2.5 | 40.0 | 10.1 | 19.5 | 33.1 | 0 | 4.0 | 23.8 | 0 | 0 |
   | long + declared | overlap | 40.0 | 10.1 | 19.3 | 33.0 | 0 | 4.0 | 23.6 | 0 | 0.8 |
   | long + declared | overlap + adapt | 40.0 | 9.7 | 19.1 | 33.1 | 0 | 3.3 | 24.1 | 0 | 0.8 |
   | long + declared | all | 40.0 | 10.5 | 20.5 | 34.5 | 0 | 4.0 | 24.4 | 0 | 33.8 |
   | long + declared | all + adapt | 40.0 | 10.1 | 20.4 | 34.5 | 0 | 3.1 | 24.0 | 0 | 33.8 |

   What the simulator can and cannot show:
   - **It cannot show the main gain.** Replay agents never read the code they are synced. The toy merge works on whole files (two beans changing one file always conflict, never merge cleanly), so the case `overlap` exists for, a clean same-file overlap, never happens: `overlap` fires 0 to 0.8 times per race and stays within noise of v2.5 everywhere. Every clean merge a sync makes, the pre-land squash would have made identically, so a sync at the invocation boundary cannot reduce textual conflicts (these scenarios have none; in the unit test, the appends conflict either way and get the note).
   - **It does show the cost of `all`.** 16 to 36 extra agent turns per 40-bean race; done up to 2.0 min later (calm +0.9, burst +0.7, long +2.0); more red pre-land checks in the bursts (+2 to +11: the extra turn delays the check onto redder sprouts); the 20th green 2.5 min later in `earlier`.
   - **The optimistic bound is small.** Agents that always fix a merged clash save at most 0.9 red pre-land checks per race against v2.5 (`long + declared`), and done is the same or later except `earlier` (-1.2 min). A partner rarely lands while a bean is being written, even with 5x longer runs. A real informed rework would often fix the same clash after one red check, so the real gain is about one check latency per synced clash.
   - **Recommended default: `off`.** Try `overlap` in one real race with long tasks and a repo where beans share files at hunk level; do not use `all`. A mid-run path would matter more; it is now built, below.

   **Mid-run sync** (2026-10-05; **built, smoke-tested with real Claude Code, not yet raced; off by default**: `live_sync_midrun: true`, env `LIVE_SYNC_MIDRUN=1`; independent of `live_sync`). While an `initial` or `rework` invocation runs, each `progress` report (the driver adds `files`: what the agent changed since the bean's base) can come back with `sync`: the beans that landed since the invocation's line and meet the bean by the rule above (`all` when `live_sync: all`, else `overlap`, over the reported files), each offered once, with the sprout head (`sync.midrun.offered`). The driver fetches that sprout into the worktree and writes the offer to `work/midrun/<inv>/pending.json`. The agent's CLI runs `harness/midrun.py` after every tool call: Claude Code through a `PostToolUse` hook in a per-invocation `--settings` file (which needs `--safe-mode` dropped: safe mode disables `--settings` hooks too, verified; `--restricted` and `--setting-sources ""` still keep every other settings file out), Codex through `-c hooks.PostToolUse=…` with `--enable hooks --dangerously-bypass-hook-trust` (user config still ignored; probe verified the hook fires and its context reaches the model). At a safe point (the tool call was not an Edit/Write of a landed file, no merge or unmerged paths in the worktree) the hook snapshots the uncommitted work in a private index, merges it with the sprout in memory (`git merge-tree`), and only when that is clean checks the result out, making HEAD the merge of HEAD and the sprout with the work still uncommitted on top; it then adds context: "t001 "title" (files) landed and was merged into your workspace; re-read those files before editing them". Anything else (a conflict, a merge in progress, mid-edit, git trouble, Codex) changes nothing and adds the note only. Once per offer; about 90 ms. The result reports what it did (`midrun_syncs`), the engine logs `sync.midrun.applied` or `sync.midrun.noted` and moves the bean's merged line to an applied sprout (so the squash's base is right). The pre-land check runs as before. Real smoke (Haiku, the race's own argv, one Read): the hook merged the sprout (HEAD parents base and sprout, the agent's new file untouched), and the agent quoted the note back; $0.008. The simulator's replay agents report no progress, so the flag changes nothing there (unit test: identical event stream on `longBurst`). Try it in one real race with long tasks that share files: `LIVE_SYNC_MIDRUN=1` (optionally with `LIVE_SYNC=overlap`).

3. **Planning and dependency-aware starts** (E4), the real limit at thousands of agents.
4. **Stalk promotion as a GitHub Action** that triggers a verifier agent (`10` §5c); the MCP server and Claude Code plugin; the Ask explorer and race canvas (`13`, in `packages/web`).

## 30-agent post-mortem (2026-10-06, `cf-demo-sonnet-30-s7`)

**The race.** 30 Sonnet agents, seed 7, 40 tasks, 2 CI slots, `demo` preset, against the queue (`cf-queue-sonnet-30-s7`): 36 green vs 36, 25th green 9.5 vs 20.4 min, then the 30th at 28.0 vs 22.2, 35th 34.5 vs 35.5, done 42.9 vs 38.7. The lead was lost in one red episode of about 20 minutes.

**Timeline of the stall** (minutes from the start, from `events.jsonl`):

| Minute | What happened |
|---|---|
| 6.97 | t011 lands with migration `0007_shipment_tracking` |
| 8.34 | t010 lands its own `0006`/`0007` migrations optimistically: its check ran on a sprout without t011, 12 beans landed meanwhile, no re-check. From here every validation fails 45–52 test files (the app cannot load its migrations) |
| 8.41–9.67 | t016, t017, t022, t009 and t007 land on the red sprout (all checked before the break); t007 also edits `src/db/migrations/index.ts` |
| 9.90 / 10.73 | validations of #27 and #29 are red; each waits 1.2 min for its flake re-run |
| 11.15 | R001 (red #27) bisects, sharing the slots with R002; at 13.18 it names t010, and **the revert conflicts** (`migrations/index.ts`) |
| 11.93 | R002 (red #29, the 2 test files new since #27: t022's and t009's own tests) bisects for them; at 15.54 it blames **t022 (innocent), reverted and dropped** |
| 14.95 | **t026's check is green on the red head #30** (its agent renumbered the migrations): the fix. It waits for the window (size 4, then 2, with 6 unvalidated commits) |
| 15.80 / 16.95 | R003 and R004 on the next reds: R003 names t010 again (20.45, the revert conflicts again); R004 blames **t009 (innocent), reverted at 21.71** |
| 23.11 | R005 bisects the same range again: t010 at 26.48, the revert conflicts again |
| 26.71 | nothing is repairing any more, so the window lets one bean through: t026 lands. The validation is green at **28.0** and promotes t010, t016, t017, t007 and t026 |

**Where the time went (8.3 to 28.0, 19.7 min).** The 2 CI slots were 88% busy, but not with useful work: 16 bisect runs (19.2 slot-minutes) and 13 validations (15.2, of which 4 flake re-runs took 5.0). There were 5 tickets: 3 rediscovered a culprit that cannot be reverted, and 2 blamed innocent beans. The fix forward was ready at 14.95 and the window held it for 11.8 minutes. Beans checked on the broken sprout were blamed too: their own new tests failed, so their reds were not inherited and named landed beans (t012, t014) as culprits. That raised cards D003, D004, D005 and D007 and parked t023. **The capacity hypothesis is refuted as the cause.** More or parallel validation would not have helped: everything from #25 up was red, and the green prefix (#24) was promoted at 9.51. The slots were saturated by repeated, misdirected repair work around an unrevertable culprit.

**t039.** Billing had 8 tasks. t023 (billing) was parked at 19.9 but still counted as in flight. The start age bound is `max(4, 2 × agents)`, 60 starts at 30 agents: more than the 40 tasks, so it never fires for a task late in the order. t031, t032, t036 and t039 started at 26.7, 30.5, 30.8 and 32.9. (The fix is being done separately.)

**The fixture** (`packages/gateway/src/engine/testing/burst30.ts`, `burst30Scenario(seed, agents, config)`, test `v2-burst30.test.ts`) has:

- the arena's 40 tasks with their real predicted modules;
- the four real card pairs, as declared couplings;
- t023's genuine contradiction with t012;
- four migration beans (t007, t010, t011, t028): any two that do not see each other fail the whole suite, new tests included, and none reverts cleanly;
- t026, which renumbers them forward and commits after the break.

CI takes 75 s, as measured. With seed 7, 30 agents and `demo`, the break lands at 7.1 min, both tickets find an unrevertable culprit and the sprout is green again at 16.6. The 30th green is at 16.6, the 35th at 28.0 and the race is done at 31.6, with 37 green and 3 parked (real: 28.0, 34.5, 42.9, 36 and 2). The baseline over 16 seeds follows; "Out" counts parked and dropped beans, times are in minutes, and the final check is correct 16/16 in every row:

| burst30 | Green | Out | 20th | 25th | 30th | 35th | Median start→green | p90 | Last green | Done | Red validations |
|---|---|---|---|---|---|---|---|---|---|---|---|
| v2.5 `demo`, 30 agents | 37.0 | 3.0 | 6.0 | 6.5 | 17.0 | 27.5 | 4.2 | 11.2 | 31.0 | 31.0 | 3.0 |
| queue, 30 agents | 35.0 | 4.1 | 8.7 | 13.3 | 17.5 | 35.4 | 8.3 | 14.4 | 35.4 | 59.7 (cap) | 0.0 |
| v2.5 `demo`, 12 agents | 37.0 | 3.0 | 5.8 | 6.6 | 14.3 | 30.0 | 4.1 | 10.0 | 33.6 | 33.6 | 3.0 |
| queue, 12 agents | 35.0 | 3.4 | 12.4 | 27.4 | 34.9 | 46.0 | 3.0 | 17.9 | 46.0 | 59.8 (cap) | 0.0 |

The seeds vary only the agents' times, so the break happens in every seed. The simulated stall is shorter than the real one (7–8 min against 19.7) for two reasons: the replay agents make fewer misattributed reworks, and the lone-suspect path names the culprit in one probe.

**Culprit isolation: a simulation study** (`testing/culprit-study.ts`, test `v2-culprit-study.test.ts`; the engine is unchanged). Two of the strategies are engine settings already, and on burst30 they make no difference. Over 16 seeds at 30 and 12 agents, `single_suspect_revert` on or off and `validation_first` give identical numbers, because the red window holds two commits and the culprit cannot be reverted either way.

So the study models one red episode at a time with the engine's timings: a 75 s CI run, a 77 s sandbox check, 2 slots, the flake re-run before a ticket, a validation after each revert, and a nested ticket (like R002) for new failing tests. It plays every strategy on six episodes:

1. a lone read-set suspect;
2. one culprit among three suspects;
3. a whole-suite break that can be reverted;
4. the real stall: a whole-suite break that cannot be reverted, fixed forward 15.5 min after the red;
5. two culprits that break a test only together (t010 + t011);
6. two culprits that each break it alone (t005 + t033 under t032's test).

Each cell reads: minutes to the first culprit named / minutes to a green sprout / CI slot-minutes / innocent beans reverted.

| Strategy | Lone suspect | 3 suspects | Whole suite | **Real stall** | AND pair | OR pair |
|---|---|---|---|---|---|---|
| Today's bisect (2 probes a round) | 3.8 / 5.1 / 6.3 / 0 | 3.8 / 5.1 / 7.5 / 0 | 3.8 / 7.7 / 10.0 / 1 | 3.8 / 20.3 / 27.5 / 3 | 3.8 / 5.1 / 7.5 / 0 | 3.8 / 8.9 / 13.8 / 0 |
| Lone-suspect revert, else bisect (v2.5) | 1.3 / 2.6 / 2.5 / 0 | 3.8 / 5.1 / 7.5 / 0 | 3.8 / 7.7 / 10.0 / 1 | 3.8 / 20.3 / 27.5 / 3 | 3.8 / 5.1 / 7.5 / 0 | 3.8 / 6.4 / 8.8 / 0 |
| Read-set ranked leave-one-out on CI | 2.5 / 3.8 / 3.8 / 0 | 2.5 / 3.8 / 5.0 / 0 | 5.0 / 7.7 / 12.5 / 1 | 7.5 / 40.3 / 63.8 / 3 | 2.5 / 3.8 / 5.0 / 0 | 5.0 / 8.9 / 12.5 / 0 |
| Leave-one-out, newest first, on CI | 3.8 / 5.1 / 7.5 / 0 | 5.0 / 6.3 / 10.0 / 0 | 5.0 / 7.7 / 12.5 / 1 | never / 16.8 / 16.3 / 0 | 2.5 / 3.8 / 5.0 / 0 | never / never / 11.3 / 0 |
| Bisect, 8 probes a round in the same 2 slots | 2.5 / 3.8 / 11.3 / 0 | 2.5 / 3.8 / 11.3 / 0 | 2.5 / 5.2 / 13.8 / 1 | 2.5 / 16.8 / 37.5 / 3 | 2.5 / 3.8 / 11.3 / 0 | 2.5 / 6.4 / 20.0 / 0 |
| Leave-one-out in agent sandboxes, all at once (10–15 sandbox-minutes, beyond the queue's 2 slots) | 2.5 / 3.9 / 2.5 / 0 | 2.5 / 3.9 / 2.5 / 0 | 2.5 / 5.2 / 2.5 / 1 | never / 16.8 / 1.3 / 0 | 2.5 / 3.9 / 2.5 / 0 | never / never / 1.3 / 0 |
| Today's bisect + prefix promotion | same as today's bisect | same | same | same | same | same |
| **Revert-then-requeue the red window** | 1.4 / 0.1 / 0 / 0 | 1.4 / 0.1 / 0 / 0 | 1.4 / 0.1 / 0 / 0 | **1.4 / 0.1 / 0 / 0** | 1.4 / 0.1 / 0 / 0 | 1.4 / 0.1 / 0 / 0 |

Prefix promotion does not change these four numbers. It only makes the innocent beans below the culprit green after the first round: 25.3 held bean-minutes against 35.6 in the lone-suspect episode, and no gain in the real stall, where the culprit is at the bottom of the window.

Revert-then-requeue resets the sprout to the stalk. A reset to an ancestor's tree never conflicts, so the sprout is green at once. The window's beans then go back through their pre-land checks in their own sandboxes (7.7–10.3 sandbox-minutes, no CI) and land again. The culprit is named by its own red re-check, where reconcile and cards already work. Its innocent beans are green again about 2.6 minutes after the red: 13–18 held bean-minutes, against 31–84 for the ticket strategies. The cost is that every bean of the window lands twice (up to W re-checks).

The model reproduces the real stall under today's bisect:

| Real stall | Model | Real race |
|---|---|---|
| Green again after the red (min) | 20.3 | 16.9 |
| Innocent beans reverted | 3 | 2 |
| CI slot-minutes of repair work | 27.5 | 19.2 |

What the study shows:

- **Every revert-based strategy fails on the real stall.** Bisection names the culprit in 2.5–3.8 min, but the culprit cannot be reverted, and leave-one-out cannot even build the probe. The episode then lasts until something fixes it forward.
- **Nested tickets blame innocent beans.** A test that exists only from its author's commit on fails with the suite, so bisection and read-set probes for it name the author (t022, t009). Leave-one-out is immune: removing one author leaves the other new tests failing.
- **More probes in the same 2 slots** cut isolation by one round (3.8 → 2.5 min) at 1.5–2x the CI slot-minutes.
- **Sandbox probes** are as fast and use almost no CI, but they use agent sandboxes the queue does not get.
- **Both forms of leave-one-out miss OR pairs** (t005 + t033) entirely.
- **Prefix promotion** only helps beans below the culprit. With a whole-suite break at the bottom of the window it helps nothing.
- **The lone-suspect revert** stays the best answer when the read set names one revertable commit: the same green time as a requeue, and it displaces one bean instead of the whole window.

**Recommendation: revert-then-requeue the red window, with the lone-suspect revert as the fast path** (when the read set names exactly one commit and its revert is clean). No CI bisection on the sprout at all.

The effect on the 30th and 35th green, to first order (moving the episode's end by the time saved):

- burst30, seed 7: the 30th green moves from 16.6 to about 12.5 min;
- the real race: the 30th green moves from 28.0 to about 14 min (the red settled at 11.15, and innocent beans are green again about 2.6 minutes later). The 35th moves by up to the same amount, bounded by the start starvation above.

The model leaves out two things: the order and conflicts of the requeued beans as they land again (they re-squash onto the reset sprout as any landing does), and the rework the culprit's red re-check costs. A requeue should be tried against this fixture (`burst30Scenario`) before a real race.

**Side finding** (prototyped, not committed): an earlier version of the fixture had no lucky fixer. There, letting the culprit's author repair an unrevertable culprit forward, with its green check landing past the window, cut done from the 60-minute cap to 19–25 min and raised green from 31 to 38–39, at both 12 and 30 agents. Requeue makes this unnecessary for the stall, but the window should never hold a bean whose check is green on a red sprout.
