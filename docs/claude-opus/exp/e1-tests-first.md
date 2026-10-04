# E1: does v2 keep the stalk correct when agents are not given tests?

**Status (2026-10-03):** measured, one race per arm. Every race used Sonnet with 12 agents on the 40 arena tasks, seed 7. Arm (c′) was added after (c) showed where its cost came from. The code is in `research/exp/e1-tests-first/race/`. Every number is **measured** unless marked otherwise.

**Naming:**
- A **bean** is one agent's change in its own workspace.
- The **sprout** is the staged line, made of beans that passed their pre-land check. The harness calls it "trunk".
- The **stalk** is the stable line, made of validated, promoted beans. The harness calls it "green".

## Verdict

1. **No: without given tests, v2 does not keep the stalk correct, and nothing signals it.** With only the agents' own tests, the run looked healthier than ever:
   - 39 of 40 tasks reached the stalk;
   - 0 red validations, 1 red pre-land check and no decision card.

   Yet the hidden acceptance tests fail for **6 of the 39 green tasks**:
   - one real bug: shipping emails lost their tracking number after another task moved it;
   - three contract decisions taken silently that a human or the given tests had settled in (a);
   - two details that other tasks legitimately changed.

   The agents' tests were *not* the vacuous kind the external sample warns about. Only 1 of 38 beans' tests prove nothing (2.6%), and 10% of new cases pass without the change, against 16% for the arena's own tests. The gap is **cross-task**: each bean tests its own behaviour, and nothing pins what other tasks rely on, so v2's gate has nothing to fire on.
2. **Tests-first fixes part of it, not all, and only with a stricter gate.**
   - **What it catches:** the real-bug class (the tracking-number break was caught in both tests-first runs), and it stopped the order-total change from landing unnoticed.
   - **What it misses:** authors writing from one issue see **1 of the arena's 5 designed contract clashes**. Two independent author samples agree. The canonical tests see 5 of 5.
   - **(c), the weak reading.** I first implemented the spec's "the bean's tests pass on the merged tree" as "on the tree that was checked". The broader author tests then turned v2's optimistic landing into a red sprout. 19 of the 31 red pre-land checks failed only on tests already broken on the sprout, 10 tasks were dropped, and spend doubled.
   - **(c′), the strong reading.** Re-running the bean's tests and the tests that landed meanwhile on the exact tree that lands removed that: 0 red validations, 3 drops, 37 greens.
   - **What remained wrong in (c′):** 6 of 37 greens, mostly the designed contradictions and details pinned by the hidden tests.
3. **Is tests-first necessary for a service? Yes, but as the substrate of the guarantee, not the guarantee itself.**
   - Without it, the forge owns no per-task tests, so v2's protection, culprit lookup and decision cards cannot engage, and wrong behaviour reaches the stalk with every signal green.
   - With it, the forge needs three more things: a merged-tree gate, a cross-task contract step, and a way for humans to amend an over-specified test.
   - **Cost (c′ vs b):** +35% agent spend, of which test authoring was about $0.09 a task, and about 40% more wall time in this run.

## 1. Question

In the arena, every task ships with ready-made acceptance tests. Real work never does, and in one external sample about 25% of the tests agents write for themselves already pass on the old, broken code. Two questions follow:

1. Does v2 (`10` §6) keep the stalk correct when agents get only the issue?
2. Does a separate test-author step, tests-first (`09` idea 5), fix it?

## 2. Method

| Arm | Run | The implementer gets | Protected once landed |
|---|---|---|---|
| (a) given | `research/race/runs/opus-v2fair-sonnet-12-s7` (reused) | the issue and the arena's acceptance tests | those tests |
| (b) self-written | `runs/e1-self-sonnet-12-s7` | the issue only, plus: "Cover this change with tests next to the code it touches (node:test, `*.test.ts`, like the existing tests)" | test files the bean *added* (it becomes their owner) |
| (c) tests-first | `runs/e1-first-sonnet-12-s7` | the issue and tests written beforehand by a separate author session | the author's files |
| (c′) tests-first, merged-tree check | `runs/e1-firstmerged-sonnet-12-s7` | as (c) | as (c) |

**Shared settings.** The policy is v2 (`policy_beanstalk_v2.py` on `policy_beanstalk_preland.py`) with `PRELAND_MODE=optimistic PRELAND_SECONDS=60`, `--snapshot head --error-budget 999`, the "landed" decision oracle after 30 s, `--ci-seconds 60 --ci-slots 2`, `--protect-tests landed` and `--max-wall-minutes 45`. (b), (c) and (c′) had `--budget-usd 25`; (a) had a $75 cap, which it never approached.

**Hiding the arena's tests in (b), (c) and (c′).**
- They are removed from the tasks in memory before any agent runs, and stripped, with the reference solutions, from the run's arena snapshot.
- Claude Code runs `--restricted`, so its file tools are confined to the worktree. Bash is limited to `node --test` and read-only git, and the repo is cloned from `main` only.
- **Check:** a scan of every transcript (625–933 tool calls per run) found no call that names the arena's task files, solutions or repository.

**Tests-first, (c) and (c′).**
1. A fresh author session runs on the same agent slot, inside the race clock, in its own worktree at the task's snapshot. It gets the issue text only.
2. The harness keeps only new test files; edits to existing files are reverted.
3. Each file must **fail first** on that snapshot: it loads, at least one test fails, and a load failure must be a missing module or export *that the issue names*. A syntax error, a missing package or a helper the author would have had to add does not count. The proof costs 10 s of emulated latency.
4. A rejected proof would go back to the same session once, and then the task would be dropped. It never happened: 80 of 80 proofs passed in the first session.
5. Accepted files are the task's protected acceptance tests.
6. Pre-land is green only if the suite is green *and* each of the bean's files ran with a passing test.

**(c′)** differs from (c) in one place. When the sprout moved during a bean's check and the files that landed meanwhile do not overlap it, v2 lands without re-checking. (c′) instead re-runs the bean's acceptance tests and every test file that landed since its check on the exact tree that will land: `E1_MERGED_CHECK=targeted`, 10 s of emulated latency, run outside the committer lock.

**Oracle.**
- **Correct at landing:** the arena's canonical tests of each task pass on the bean's landing commit.
- **Correct on the stalk:** all canonical tests are laid over the final stalk, and a task is correct if its own pass there.
- A green task whose hidden tests fail on the stalk is a **wrong green**.

**Test quality.** Each bean's test files (added or changed, minus given or author tests) are run on the landing parent, the code just before the change.
- A **new** case (by full name) that passes there proves nothing about the change.
- A bean's tests **prove nothing** when nothing in them fails there.
- Baseline: 17 of the 106 cases in the arena's own test files that load on the base pass there (16%). They are guards such as "coupons without a limit are unaffected".

**Conditions.**
- **Load:** recorded with `uptime` at the start and end of each new race (§3.4). (a) was run earlier with no record.
- **Load proxy:** the real suite time inside the 60-s pre-land checks, median 0.57 s in (a) against 1.5–2.7 s in the new runs. Even the extra ~2 s adds only about 2–5% to an emulated 60-s check, so the large timing gaps are policy effects.
- **Auth outage:** a Claude authentication outage hit before 15:20 HKT. All 370 invocations of the four runs ended `success` with a reported cost, and none is an `is_error` result mentioning 403, "not allowed" or login. (c′) also started behind a one-turn Haiku auth probe.
- **E2 lock bug:** no run had git lock or index errors. I patched my copy of `ci.py` afterwards.

## 3. Results (measured)

### 3.1 Correctness against the hidden arena tests

| | (a) given | (b) self-written | (c) tests-first | (c′) tests-first + merged-tree check |
|---|---|---|---|---|
| Greens (on the stalk) | 35 | **39** | 30 | 37 |
| **Correct greens** (hidden tests pass on the final stalk) | **35** | 33 | 28 | 31 |
| Wrong greens | 0 | **6** | 2 | 6 |
| Stalk correct by the oracle | yes | no | no | no |
| Landed beans correct at landing | 34 of 35 | 34 of 39 | 30 of 33 | 33 of 37 |
| Dropped | 5 (4 conflict, 1 card) | 1 (conflict) | 10 (6 conflict, 3 reverted, 1 card) | 3 (1 still red, 1 card, 1 conflict) |
| Red pre-land checks / all | 17 / 83 | **1 / 84** | 31 / 102 | 9 / 104 |
| Red validations | 1 | 0 | 5 | 0 |
| Decision cards | 1 | **0** | 1 | 1 |
| Reworks | 37 | 19 | 50 | 24 |

The wrong greens, each checked against the canonical test and the landing order:

| Cause | (b) | (c) | (c′) |
|---|---|---|---|
| **Real bug.** t018: shipping emails lose the tracking number after t011 moved it to the shipment. The bean's own test built an order by hand | t018 | — (caught by a red validation; t018 reverted) | — (t018's author test failed t011's pre-land check; t011 adapted) |
| **Designed contradiction resolved silently.** t031 (formatting) vs t005; t036 (rounding) vs t023 | t031, t036 | t031 | t031, t036 |
| **Contract change taken silently.** t005's confirmation total now includes shipping after t032. In (a) this exact clash was the run's only decision card, and t032 was declined | t005 | — (t032 declined) | — (t032 never cleared pre-land) |
| **Own-spec miss.** t037: the implementer made the filter argument required. The author's tests always passed one, and the hidden test calls `filterProducts(items)` | — | t037 | t037 |
| **A hidden test pins a detail another task legitimately changed.** Exact notification kinds vs t013's new kind; $5 shipping on a $100 order vs t033's free shipping; "last migration in the registry" vs t010's later one | t025, t032 | — | t025, t007 |
| **Shared test helper changed by another bean.** t039 set `createTestApp()` to a 7-day session lifetime to fit its own tests, and t012's hidden test pins the default | — | — | t012 |

### 3.2 Do the tests see the designed contract clashes? (order-independent)

For each of the arena's 5 designed semantic couplings (A changes a contract, B relies on the old one), the two reference solutions are merged. A test set *sees* the clash if it passes on its own task's reference and fails on the merged tree (`e1_couplings.py`):

| Test source | Clashes seen | Which |
|---|---|---|
| Arena canonical tests | **5 of 5** | all, by design |
| Tests-first authors, run (c) | **1 of 5** | t011→t018, the tracking number |
| Tests-first authors, run (c′) | **1 of 5** | t011→t018 |

Why the authors missed the other four, from their files:

| Pair | What both author samples did |
|---|---|
| t005→t031 | computed the expected amounts with the shop's own `formatMoney`, on amounts below $1,000; such a test cannot see a formatting change |
| t023→t036 | refunded three identical $20.00 lines, where per-line and per-rate rounding give the same cents |
| t032→t028 | tested $300 and $20 orders in one sample, and set the order total directly in the other; neither sees a change to what a total includes |
| t002→t022 | expected t002's `x-total-count` header, which was on the author's sprout, so the tests fail on their own reference |

Each test is a faithful reading of its own issue. None of them crosses into the other task's contract.

### 3.3 Test quality

| | (b) self-written | (c) authors | (c′) authors |
|---|---|---|---|
| Beans or tasks with tests | 38 of 39 beans changed tests (t040 none) | 40 of 40 tasks | 40 of 40 |
| …in a per-task file that the forge can protect and attribute | **1 of 39**: only t015 added a file; the rest appended to shared module test files | 40 of 40 | 40 of 40 |
| New cases | 77 | 245 | 244 |
| Cases passing before the change (prove nothing) | **10.4%** (arena's own: 16%) | 20.4% on the snapshot | 18.0% |
| Beans or tasks whose tests prove nothing | **1 of 38** (t029, 2.6%) | 0 (fail-first enforced) | 0 |
| Fail-first proofs accepted in the first session | — | 40 of 40 | 40 of 40 |
| Test sets that pass the arena's reference solution | — | 33 of 40 | 32 of 40 |
| Implementers who also wrote tests | — | 1 of 33 | 1 of 37 |

Of the author test sets that fail on the reference (7 in (c), 8 in (c′)):
- 4 and 5 encode changes already on the author's sprout, which is correct for that sprout: t002's header, later migration numbers, t015's `coupons.ts`, t018's tracking line, t003's tax breakdown, t014's sliding sessions.
- The rest read their issue more broadly than the reference, or pin internals or fixtures. t029's "whatever the reason for the failure" also covers a later line lacking stock, which the arena leaves to t034. t010's set calls `buildInvoice` directly and expects it to apply the tax exemption itself.

### 3.4 Time and money (`kth_green.py`; k-th *correct* green from `e1_analyze.py`)

| | (a) | (b) | (c) | (c′) |
|---|---|---|---|---|
| 20th green, min / $ | 7.3 / 4.79 | 8.1 / 4.96 | 13.7 / 10.29 | 12.0 / 5.58 |
| 30th green | 9.7 / 5.21 | 10.4 / 5.75 | 19.1 / 11.53 | 16.6 / 7.55 |
| 35th green | 11.3 / 5.29 | 12.1 / 5.92 | not reached | 19.6 / 7.98 |
| 30th *correct* green | 9.7 / 5.21 | 11.4 / 5.92 | not reached (25th: 18.2 / 11.53) | 19.6 / 7.98 |
| Wall clock, min | 11.3 | 15.2 | 19.1 | 21.6 |
| Agent spend, $ (test author) | 5.29 | 5.92 | 11.53 (3.42) | 7.98 (3.55) |
| Task start → green, median / p90 min | 3.7 / 6.1 | 3.8 / 6.9 | 6.5 / 9.1 | 5.1 / 10.4 |
| Load average (1 min) at start → end | not recorded | 96 → 34 | 18 → 14 | 14 → 6 |
| Median real suite s per check (load proxy) | 0.57 | 1.88 | 2.66 | 1.49 |

**Where tests-first's time goes:**
- The author phase is about 42 s per task on the critical path (median, start to implementer).
- In (c′), 89 merged-tree checks spent 16 min of agent-sandbox time. Under churn, 42 re-checks and 6 fallbacks to a full check inside the committer lock followed.
- Only 1 of the 89 caught a break: t035 against t029's tests. It went to a card, and t035 was declined. t029's author test builds its failing checkout from a cart holding more units than are in stock, which is exactly what t035 forbids: a fixture that another task's legitimate change invalidated.

### 3.5 Why (c) cost twice (b): the red sprout

- **The breaks.** In (c), three beans landed through v2's optimistic shortcut ("sprout moved, no file overlap, land unchecked") onto trees where author tests failed:
  - t017 corrected the Quebec rate, which t004's author test asserted for the helpers' default Canadian address (`CA_ADDRESS` is in QC);
  - t018 met t011's move of the tracking number;
  - t035 broke t029's test.
- **The windows.** The sprout was red for 6.6 min in two windows until revert-first removed t017, t018 and t035.
- **The cascade.** In those windows, every arriving bean's pre-land check failed on tests that were already broken. 19 of the 31 red checks failed *only* on those, and 29 of the 30 informed reworks started in or right after the windows. v2 blamed the owners of the failing tests, so beans spent their reworks on breaks that were not theirs, and six were dropped as "unresolved".
- **The fix.** (c′)'s merged-tree check closed this path: 0 red validations.

## 4. Design implications for the beanstalk service

1. **Tests-first admission is required.** The forge, not the implementing agent, owns each task's acceptance tests: one file per task, fail-first proven on the task's snapshot, protected.
   - Agents left alone put their tests in shared files (38 of 39 beans), where nothing can protect them, attribute a failure to an owner or raise a card.
2. **The gate must check the tree that actually lands.** Before a bean lands on a sprout that moved, re-run its own tests and the tests that landed since its check (89 targeted runs per 40 tasks here). "Disjoint files, land unchecked" is unsafe once tests cross modules.
3. **Pre-land reds must be judged against the sprout head.**
   - Failures already present on the head are not the arriving bean's: 19 of 31 in (c).
   - The gate should hold the bean and re-check after revert-first, not spend its reworks.
4. **Cross-task contracts need their own step.** Tests written from one issue saw 1 of 5 designed contract clashes.
   - When a bean changes a shared contract (money formatting, rounding, what a total includes, a moved field, a return shape), the forge has to pin it from the *readers'* side.
   - One way: give the test author the landed and in-flight intents that touch the same symbols.
   - Another: run a mutual-acceptance pre-check or a contract lane (`09` ideas 6 and 7). Otherwise the stalk silently takes whichever side lands last.
5. **Decision cards need an "amend the test" answer.**
   - Author tests pin incidental details: the Quebec rate as an example, migration numbering, exact template keys.
   - In (c′), t035 ("carts may not hold more units than are in stock") was declined only because t029's author test built its fixture from such a cart. A human would amend the fixture, not decline t035.
   - A human should be able to amend a protected test as a privileged change, not only pick a winner.
6. **Protect shared test helpers like acceptance tests.** t039 changed `createTestApp()` to fit its own tests and silently changed every other test's environment.
7. **Re-prove fail-first at implementer start.** Authors write against the live sprout, and 4–5 of 40 test sets encode changes that had already landed there. That is right for the sprout but stale for an implementer who starts later.
8. **Budget.** Test authoring cost about $0.09 a task with Sonnet ($3.4–3.6 per 40 tasks, 30–45% of a run) and about 42 s of critical path per task. Authoring at intake would hide the latency but needs the re-proof in item 7.

## 5. Caveats

- **One race per arm.** Which pairs clash depends on landing order: t025 clashes only if t013 lands, and t028 only if t032 lands without t033. So the count of wrong greens per arm is noisy by a few tasks. §3.2 is order-independent and confirms the main mechanism. Seed-11 replicates were queued and then cancelled because the machine-wide slot queue was hours long.
- **The oracle pins details.** Some canonical tests pin incidental details (exact key lists, fixture shipping, registry order). §3.1 separates these from real bugs and contract decisions.
- **The decision oracle always keeps the landed side.** It cannot "amend the test", so author tests that pin incidental details or fixtures cost declines here (t035 in (c′)) that a human might avoid.
- **(c) has a logging bug.** A name clash in my subclass (`oracle`) mislabels the winner of (c)'s one card (it shows t032 against t032). Behaviour was unaffected: the arriving task is always dropped. It is fixed in (c′).
- **(c) vs (c′).** (c) is my first, weak reading of "the bean's tests pass on the merged tree"; (c′) is the strong one. Both are reported.
- **Load.** The new runs ran under higher load than (a). See §3.4.

## 6. Cost

Agent spend for this experiment was **$25.45** at list price: (b) $5.92, (c) $11.53, (c′) $7.98, plus two auth probes at $0.013 each. That is under the $60 cap.

Free checks: replay and fake-Claude races, all through the slot limiter after the coordinator's rule; the analysis (527 node test jobs, at most 4 node processes at a time); and the coupling check.

## 7. Files

All in `research/exp/e1-tests-first/race/`:

| File | Purpose |
|---|---|
| `harness/policy_e1.py` | the three modes and the merged-tree check |
| `harness/e1_tests.py` | fail-first judge, junit parsing |
| `harness/prompts.py`, `harness/policy_beanstalk_v2.py` | self-test line, author prompts, protection wording |
| `harness/ci.py` | targeted runs, E2 lock fix |
| `harness/core.py`, `race.py` | `--tests` |
| `e1_analyze.py` | oracle, test quality, erosion, k-th correct green, leak and auth checks |
| `e1_couplings.py` | §3.2 |
| `run_e1.sh`, `race_with_uptime.sh`, `auth_probe.py`, `e1_fake_gate.sh` | launchers and checks |
| `tests/test_e1.py` | unit tests |
| `results/` | `e1-analysis.json/.md`, `e1-couplings.json`, `e1-kth-green.md` |
| `runs/e1-*-sonnet-12-s7/` | events, summaries, the author files under `testsfirst/`, `.uptime`; `work/` holds transcripts and repos |
