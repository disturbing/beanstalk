# 09 — Innovation pass: the bottleneck is repair, not merging

*Fable, 2026-10-03. Input: `02-thesis-concurrency-control.md`, `03-ideas.md`, `04-canvas-second-opinion.md`, `07-red-team-and-decisions.md`, `research/README.md`, the step 1–4 outputs, and the two finished 40-task Haiku races (`main-bs-haiku-40`, `main-q-haiku-40`; the queue run finished at 00:37 UTC while this was being written). Every number is labelled **measured** (real history or real agents), **simulated** (the discrete-event simulator, or my patched scratch copy of it) or **estimated** (back of envelope). The private corpus is referred to only as "the private agent-heavy corpus"; its files are F1, F2, …*

---

## 0. Summary

1. **The merge mechanics of the thesis work.** On the same 40 tasks and 8 Haiku agents, the fast trunk reached its 35th verified green in **7.4 min for $5.63**; the batched merge queue needed **18.6 min and $6.93** (measured). Not blocking agents is real and worth about 2.5x on the easy majority of tasks.
2. **The repair mechanics of the thesis fail.** After minute 8 the fast trunk's head was red for the remaining **84 minutes (94% of wall clock)**, **1 of 23 fixer landings** produced a green head, and **$19.37 (77% of the budget)** bought two more greens before the budget ran out (measured). The queue spent $3.62 to *drop* the same hard tasks and finished correct.
3. **The simulator's 1.4–3.4x advantage is an artefact of cheap repair.** It prices a fix at 0.4x of the original work and a conflict rework at 0.3x, uncalibrated. The race measured **7.3x and 2.7x** (cost), **6.9x and 2.6x** (wall), **5.2x and 2.1x** (output tokens). With repair priced as measured, the simulated advantage is **0.88–1.04x**; with fixes failing half the time, lower (simulated, patched copy, §2).
4. **The reds have one cause.** Five of 40 tasks change a shared contract (the meaning of `Order.total`, tax rounding, money formatting, a pagination return shape, a moved field). Their partners' acceptance tests legitimately encode the old contract. These 10 tasks account for **62% of all failing-test slots** in the Beanstalk race (100% in the pilot, 57% in the queue run); add the one natural coupling through order totals and it is 71% (measured). Two contradictory acceptance suites cannot both pass: this is a *specification* conflict, and no fixer, however well-ticketed, can resolve it. The harness opened 20 repair tickets for what were essentially three contradictions. **The human was never asked.**
5. **Placement is dead at module level and alive at file level, but only with observation.** Predicted-module overlap has lift 1.0–1.5x on every corpus (measured). Title-only *file*-level kNN has lift 2.9–3.3x. The asymmetric signal the scheduler can actually use, *a running task's observed files ∩ a candidate's predicted files*, has **lift 7–8.5x at 0.55–0.6 recall and 6–9% clean-flag rate** (measured, public corpora, §1.4). And agents reveal their footprint almost immediately: in the race, **every file an agent went on to change had been read by a median 7 s into a 35 s session; 74% in the first quarter, 97% by half** (measured).
6. **Change the plan**: stop optimising merge mechanics; build the repair economy and the contract handling. Concretely: quarantine promotion with revert-first (not fix-forward), a cost-ranked repair ladder whose first rung is re-execution, tests-first admission, a mutual-acceptance pre-check for the 6–9% of flagged pairs, and spec-contradiction cards as *the* human role. Drop the error-budget controller, module-level predicted placement and the mega-ticket fixer.

---

## 1. Critique: what the thesis gets wrong, given the numbers

### 1.1 Assumptions against measurements

| Thesis or simulator assumption | What was measured | Verdict |
|---|---|---|
| Agents' own changes fail CI 15–30% of the time (`p_self` 0.15, README: "~25% of changes are bad", listed as *not calibrated*) | Own acceptance test failing at the first validation covering a landing: **1–3 of 40** landings (3–8%) in the Beanstalk race. All **6** red ejections in the queue race broke *existing* base tests, none a task's own acceptance test (measured) | Wrong for agents given tests first. Self-failure is not the problem; interaction is |
| A fix costs 0.4x the original work; a conflict rework 0.3x (`r_fix`, `r_conf`, uncalibrated) | Initial invocation **$0.078, 38 s, 4.9k output tokens** (median wall). Rework **$0.21, 99 s, 10.4k**. Fixer **$0.57, 262 s, 25.4k** (measured, means over 40/33/25 invocations) | Repair is 3–7x *more* expensive than the work it repairs, not 0.3–0.4x. The sim's whole advantage lives here (§2) |
| A fix fixes (bad again only with `p_self`) | **1 of 23** fixer landings produced a green next head; 11 reduced the failing set, 4 left it unchanged, 8 enlarged it; one fix (R019) broke **33 test files** (measured) | Fix-forward on a shared red trunk is a random walk |
| Causal tickets name "the two (or more) commits" (`a_suspect` 0.7) | Suspects listed per dispatch grew monotonically **27 → 51** as the trunk stayed red; `corr(suspects listed, fixer cost) = 0.53`; tickets with ≤10 suspects cost $0.25 (19 turns), with ≥30 suspects $0.64 (32 turns) (measured) | The ticket degenerated into "here are 40 diffs, make the suite pass". Bisect first, dispatch second |
| Semantic breaks are rare, independent events (`q_sem` 0.01 per pair) | 10 coupled tasks produced **62%** of failing-test slots; `total-with-shipping` failed 17 times, `line-refunds` 13, `confirmation-grouping` 12; three contradictions produced 20 tickets and 84 minutes of red (measured) | Breaks are *correlated* and *persistent*: a contradiction cannot be fixed, only decided |
| The error budget keeps the trunk "a little red" | Budget paused new starts once, for 6 min; the trunk was red 94% of the time anyway (measured). In every simulated scenario `budget=false` beats the budget, by 15–60% once repair is priced realistically (simulated, §2) | Pausing agents converts repair latency into idle time. Drop it |
| Green = newest fully clean prefix | Green advanced 8 times, all in the first 8 minutes, then **never again for 84 minutes** (measured). Simulated time-averaged staleness 198 min at N=20; quarantine mode 25 min (simulated) | Prefix promotion lets one contradiction freeze the whole branch |
| Placement reduces collisions | `beanstalk-noplace` equals `beanstalk` at every N (simulated). Oracle module overlap lift 2.2x, predicted 1.2–1.5x (measured). 28 of 40 race placements overlapped (measured) | Module-level placement has nothing to place on (§1.4) |
| Conflicts need a shared file; drivers dissolve the hot ones | Correct, and sharper: **55–86%** of conflicting pairs conflict in **exactly one file**; one root-level manifest-like file (F1) is **16% of all conflicted file-slots** in the private agent-heavy corpus with **P(conflict \| shared) = 93%** over 519 pairs; the migration registry caused 8 of 33 (Beanstalk) and 11 of 27 (queue) race conflicts (measured) | The target is a handful of registry files, and merge drivers are the wrong tool for them (2.4% dissolved) |

### 1.2 The race, re-read: a fast head and a catastrophic tail

Per-hour throughput over runs of different length (92 vs 20 minutes) is meaningless. Time and money to the k-th verified green are comparable:

| | Beanstalk (measured) | Batched queue (measured) |
|---|---|---|
| 20th green | 3.3 min, $2.36 | 4.4 min, $2.72 |
| 30th green | 7.4 min, $5.63 | 11.5 min, $4.86 |
| 35th green | **7.4 min, $5.63** | **18.6 min, $6.93** |
| End state | 37 green, 2 dropped (reverted), 1 landed-not-green; 91.8 min; **$25.00, aborted at budget** | 35 green, 5 dropped after 3 reworks each; 19.7 min; **$6.93**, finished |
| Spend after its own 35th green | **$19.37 over 84 min for +2 greens** | — (dropped the 5 hard tasks for $3.62 total) |
| Fixer invocations | 25 (+1 cut off by the budget), $14.06 | 0 |
| Red validations | 33 of 41 (22 with a *fixer* commit at the head) | 6 batch reds of 19 batches |
| Trunk head red | 94% of wall clock | main always green by construction |
| $ per green, whole run | $0.68 | $0.20 |
| $ per green, first 35 | $0.16 | $0.20 |
| Final green correct | yes | yes |

Reading: the fast trunk wins the 88% of tasks that are independent by about 2.5x in time and 20% in cost. It then loses everything on the 12% that change a contract, because it keeps paying fixers to reconcile the irreconcilable while the queue simply gives up on them. Neither behaviour is right: the correct move is to *detect* the contradiction and *ask*.

### 1.3 Where the simulator and the real race disagree

1. **Repair cost** (0.4x/0.3x vs 7.3x/2.7x) — the decisive parameter; see §2.
2. **Self-failure** (15% vs 3–8%) — tests-first makes agents' own work almost always correct; the queue baseline benefits as much as Beanstalk (both gain ~35% at `p_self` 0.03, simulated).
3. **Fix reliability** (≈85% vs 4% at the trunk level) — fixes "closed their ticket" 15 of 20 times by making *their* failing tests pass while the head stayed red.
4. **Correlated, persistent reds** — the sim draws independent `BadRec`s; the race had a livelock between contradictory tests. The sim has no concept of an undecidable red.
5. **Ticket size** — the sim's suspect is a set of 1–2; the race listed 27–51 and the fixer prompt carried every diff.
6. **The "give up" rule** — the queue's "drop after 3 reworks" bounded its loss at $3.62; the Beanstalk policy's "2 attempts per ticket, then revert the newest suspect" never converged because new tickets kept opening for the same root cause.
7. **Green staleness** — the sim's 198 min at N=20 already looked bad; the race froze green entirely.
8. **Overlap in flight** — the race cannot test anything that happens *while* two coupled tasks are running: sessions lasted 35 s, only 3 of 10 coupled pairs ever overlapped in time, and 4.2 other sessions were alive at a typical landing (measured). Any mechanism that acts mid-flight (ideas 9, 10) needs longer tasks (Sonnet, or the sim's 20-minute default) to be tested.

### 1.4 What placement can and cannot do

Module-level prediction cannot flag conflicting pairs, because 43–74% of *clean* pairs share a module too. File-level signals can, because conflicts live in a few files. New measurement (title-only kNN over earlier changes, evaluation on the later half of each public corpus, pairs from step 1; scratch script `filepred.py`):

| Pair-flagging signal | workers-sdk: lift / conflict recall / clean-flag rate | codex: lift / recall / clean-flag |
|---|---|---|
| Oracle: share a file | 17.9x / 1.00 / 0.044 | 13.4x / 1.00 / 0.060 |
| Oracle: share a module | 1.4x / 1.00 / 0.737 | 2.9x / 1.00 / 0.330 |
| Predicted modules intersect (top-1) | 1.2x / 0.75 / 0.631 | 1.5x / 0.65 / 0.426 |
| Predicted files intersect (top-5) | 3.3x / 0.57 / 0.170 | 2.9x / 0.56 / 0.184 |
| **Running task's actual files ∩ candidate's predicted files (top-5)** | **7.4x / 0.60 / 0.075** | **6.2x / 0.62 / 0.091** |
| Same, top-3 | 8.5x / 0.56 / 0.059 | 7.3x / 0.54 / 0.066 |

(All measured. File-level footprint quality on its own is poor, P 0.17 / R 0.08 at top-5; the pair signal is good only because conflicts concentrate.) Two consequences. First, the scheduler should compare a candidate against what running tasks have *actually* touched, which the forge observes from fork pushes and context-API reads, not against their predictions. Second, since every finally-changed file is read within seconds of a session starting (measured, §0.5), the best "prediction" is to start the task and look.

But the simulator also says placement is a **cost** lever, not a **throughput** lever: under realistic repair costs, soft placement with any signal is 1.0x, hard placement with the observed signal cuts textual conflicts 3–5x at a 0–25% throughput cost from idling (simulated, §2.4). Conflicts cost money ($0.21 each, 28% of the race's spend), which the sim's green/h does not price.

### 1.5 A correction to one reported number

"Agents edited other tasks' acceptance tests 51 times" is mostly a harness artefact. 40 of the 51 are the two acceptance files of t002, "restored" into worktrees that were forked from the original base *before* t002 reached green; the transcripts of those sessions contain no Edit, Write or `rm` of either file (measured, 6 sessions checked, 0 hits). `protect_landed` gained its lineage check at 08:19, after the run. The genuine count is about **11**, almost all by rework or fixer sessions working on a red tree (`templates` 4, `order-note-migration` 3, `free-shipping` 2, `confirmation-grouping` 1, `signature` 1). Still worth a rule (idea 5), but the phenomenon is "agents on a red tree edit the red tests", not "agents sabotage colleagues".

---

## 2. Simulations run for this memo (all simulated)

I copied `sim.py` to my scratch directory and added one parameter, `p_fix_bad`: the probability that a *re-landed* change (fixno > 0) is bad, defaulting to `p_self` so that the unpatched behaviour is reproduced exactly (S0 below matches `out/default/results.md`). Nothing under `research/` was modified or written. Default parameters otherwise; N=20 uses 10 seeds, N=100 uses 4–5. "Best queue" is the better of `batched-par k=1` and `batched k=4 suspects` (the two best baselines in the published sweep).

### 2.1 Repair economics grid

| Scenario | N=20: Beanstalk / best queue | N=20: quarantine / best queue | N=100: Beanstalk / best queue | N=100: quarantine / best queue | Green staleness N=100, Beanstalk → quarantine (min) |
|---|---|---|---|---|---|
| S0 as published (`r_fix` 0.4, `r_conf` 0.3) | 1.51x | 1.44x | 2.48x | 2.16x | 251 → 22 |
| S1 repair priced as measured (`r_fix` 2.0, `r_conf` 1.0) | **0.89x** | 0.88x | **0.88x** | 0.89x | 583 → 20 |
| S2 S1 + fixes bad half the time (`p_fix_bad` 0.5) | 0.93x | 0.85x | 0.83x | 0.96x | 1549 → 17 |
| S3 S2 + `q_sem` 0.05 | 0.72x | 0.71x | 0.36x | 0.73x | 8785 → 25 |
| S4 S2 + useless suspects (`a_suspect` 0.2) | 0.79x | 0.78x | 0.73x | 0.90x | 1961 → 25 |
| S5 extreme (`r_fix` 5, `r_conf` 2.5, `p_fix_bad` 0.5) | 0.69x | 0.69x | 0.46x | 0.49x | 3681 → 54 |

### 2.2 Break-even on repair cost (`r_conf` = `r_fix`/2, other defaults)

| `r_fix` | N=20: Beanstalk / best queue | N=20: no-budget / best queue | N=100: Beanstalk / best queue | N=100: no-budget / best queue | N=100: quarantine+no-budget / best queue |
|---|---|---|---|---|---|
| 0.4 | 1.60x | 1.69x | 2.48x | 2.44x | 2.92x |
| 0.7 | 1.44x | 1.51x | 1.86x | 2.41x | 2.54x |
| 1.0 | 1.18x | 1.57x | 1.46x | 2.13x | 1.91x |
| 1.5 | 0.93x | 1.31x | 1.19x | 2.14x | 1.72x |
| 2.0 | 0.89x | 1.18x | 0.89x | 1.83x | 1.04x |
| 3.0 | 0.82x | 1.21x | 0.75x | 1.24x | 0.92x |

The spec'd policy breaks even at `r_fix` ≈ 1.2–1.8; the race measured 5–7. The error budget is the first thing to go: at N=100 and `r_fix` 2.0 it costs half the throughput (0.89x → 1.83x without it), because every pause idles agents whose work is cheap while the repair it waits for is expensive.

### 2.3 Race-like parameters

| Scenario (N=100) | best queue /h | Beanstalk /h | quarantine /h | quarantine + no-budget /h | Beanstalk / best queue | quar.+no-budget / best queue |
|---|---|---|---|---|---|---|
| A published defaults | 23.0 | 56.5 | 50.3 | 55.6 | 2.46x | 2.42x |
| B `p_self` 0.03 (race-like self-failure) | 31.4 | 72.0 | 74.0 | 93.7 | 2.30x | 2.99x |
| C B + measured repair (`r_fix` 2, `r_conf` 1) | 25.8 | 25.5 | 22.6 | 33.9 | **0.99x** | 1.31x |
| D C + contract changes never interleave (`q_sem` 0) | 44.6 | 51.8 | 52.0 | 57.6 | 1.16x | 1.29x |
| E C + arena-like exposure (`q_sem` 0.03) | 16.4 | 12.1 | 15.2 | 15.2 | 0.74x | 0.93x |
| F E + fixes bad half the time | 9.1 | 5.3 | 8.3 | 8.9 | 0.58x | 0.97x |

Three readings. Tests-first (B) lifts *every* policy by about a third. Priced honestly (C), the fast trunk is a wash. Removing contract-change interleaving (D) roughly **doubles absolute throughput for every policy** (25.8 → 44.6 for the queue, 25.5 → 51.8 for Beanstalk) and is worth more than any merge mechanism.

### 2.4 Placement signal and a "v2" preset under scenario C

| Policy (N=100, scenario C) | green/h | vs best queue | textual conflicts | idle % | green staleness (min) |
|---|---|---|---|---|---|
| queue-par k=1 | 25.8 | 1.00x | 814 | 15 | 7 |
| beanstalk-noplace | 26.1 | 1.01x | 661 | 76 | 246 |
| beanstalk, soft, predicted (0.6, 0.25) | 25.5 | 0.99x | 614 | 77 | 310 |
| beanstalk, soft, observed (0.6, 0.07) | 25.3 | 0.98x | 584 | 77 | 375 |
| beanstalk, hard, observed | 19.2 | 0.75x | 133 | 88 | 229 |
| **v2: quarantine + no budget + hard observed** | 28.4 | 1.10x | **166** | 81 | **14** |
| **v2 soft: quarantine + no budget + soft observed** | **34.6** | **1.34x** | 832 | 59 | 18 |

At N=20 both v2 variants are 1.29–1.31x; under scenario E (q_sem 0.03) they are 0.97–1.14x. So the best Beanstalk one can assemble from existing knobs is 10–35% better than the best queue on throughput, with 10–20x less green staleness, and that is *without* any of the mechanisms below. That is the honest baseline the new ideas must beat.

---

## 3. Twelve mechanisms

Each idea: mechanism, why it should work (with evidence), predicted effect on the five metrics (green/h, $ per green, red-validation rate, done→green latency, human minutes), a cheap test runnable in a day, and a Cloudflare sketch. "Extends" names overlap with `03-ideas.md` (#) or `claude-11-ideas-brainstorm.md` (C11 #).

### Idea 1 — Quarantine promotion with revert-first

**Mechanism.** Green is the *tested head minus culprits*, not the newest fully clean prefix. When a validation goes red, the validator bisects to the culprit commit (1–5 CI runs; the suite is 1 s plus the emulated latency), then **reverts the culprit on the fast trunk** and re-validates. Green advances past everything else immediately. The culprit's task is not "fixed"; it re-enters the repair ladder (idea 2) with its own fork rebased on the new head. The trunk is never fixed forward.

**Why.** The race froze green for 84 minutes behind three contradictions while 35 tasks were sitting validated-but-unpromoted (measured). In the sim, quarantine cuts time-averaged staleness 10x (198 → 25 min at N=20, 251 → 22 at N=100) and is the component that makes the v2 preset competitive (simulated, §2.4). Fix-forward produced a green head once in 23 attempts (measured); a revert produces one deterministically.

**Predicted effect.** green/h: +0–30% vs spec'd Beanstalk under realistic repair (simulated), neutral vs the queue; $/green: removes the fix-forward spend ($14.06 of $25 in the race; estimated −50% of total); red-validation rate: falls from 80% to the culprit-detection rate (one red per bad landing, estimated 10–20%); done→green: p50 from "never" to one validation cycle (measured: 60–80 s in the race, 10–15 min in the sim); human minutes: unchanged.

**Cheap test.** Already run in the sim (`--set green_mode=quarantine`; §2). Race: add a `--repair revert-first` flag to `policy_beanstalk.py` (the revert path already exists for escalation) and re-run `main-bs-haiku-40` with the same seed; kill condition: green frozen >10 min at any point, or $ per green > the queue's $0.20.

**Cloudflare.** The validator Workflow's red branch becomes bisect → revert → re-validate; the revert commit is pushed by the committer Sandbox (single trunk writer); the culprit's task record moves to the ladder queue (Queues). Green remains a separate Artifacts repo whose token only the promoter holds; attestation unchanged.

### Idea 2 — The repair ladder: cheapest rung first, never fix forward on a shared red trunk

**Mechanism.** Every red is routed up a ladder ordered by measured cost and success, and stops at the first green:
1. **Re-execute** the culprit task from its intent and acceptance tests on the new head (idea 3): $0.08, 38 s (measured initial cost).
2. **Resume the author's own session** with the failing output on its own fork (what the race calls rework): $0.21, 99 s (measured).
3. **Bisect, then dispatch a fixer with at most two diffs**: $0.25 for ≤10 suspects vs $0.64 for ≥30 (measured); never dispatch before the culprit is isolated.
4. **Revert and park** the task (idea 1); re-execution is retried once the overlapping change is green.
5. **Human card** (idea 8), raised when the same pair of tasks has failed two rungs, or when their acceptance tests contradict each other on the merged tree.

Fixers never work on the shared trunk head; they work on the culprit's fork rebased on green. The ticket contains the culprit's diff and at most one other diff (the one its reads intersect), not the unvalidated range.

**Why.** The race's cost ladder is $0.08 < $0.21 < $0.57 with trunk-level success 100% (initial landings), ~75% (reworks landed and most went green), 4% (fixers). Ticket size drives cost (`corr` 0.53). 87% of the race's spend was repair (measured). Starting from the cheap rung cuts expected cost per red from ≈$0.57 + follow-ups to ≈$0.10–0.25 (estimated).

**Predicted effect.** $/green: −40 to −60% (estimated from the measured rung costs applied to the 33 reds); green/h: +10–20% via freed agent time (estimated); red rate: unchanged at first detection, but no second-order reds from bad fixes (8 of 23 fixer landings enlarged the red; measured); done→green: shorter for the 88% cold tasks (no waiting behind fixers); human minutes: a handful of cards per hundred tasks (estimated 2–5).

**Cheap test.** Re-analysis, done: apply rung costs to the 20 tickets. Sim: the break-even sweep (§2.2) already says the ladder matters exactly as much as it lowers `r_fix`: at `r_fix` 0.7 Beanstalk is 1.44–1.86x, at 2.0 it is 0.89x. Race: add `--repair ladder` (rungs 1–2 exist as `initial` and `rework` invocations; rung 3 = existing fixer with `--max-suspects 2` after a forced bisect) and compare $ per green with `main-bs-haiku-40`.

**Cloudflare.** A Workflow per red walks the rungs with `step.do` and a per-rung budget; the Scheduler DO holds the ladder state and refuses to dispatch rung 3 without a bisect result; rung 1–2 run on the author's harness through MCP (resume by session id), rung 3 on an Agents SDK fixer in a Sandbox; costs are read from the harness's JSON result and written to D1 for the cost card.

### Idea 3 — Disposable patches: re-execution as the merge primitive

**Mechanism.** A change is *intent + acceptance tests + proof*. The diff is a cache. When a change no longer applies to the head (textual conflict) or is quarantined (semantic break), the forge does not ask anyone to resolve conflict markers; it **re-runs the task from its intent on the new head**, in a fresh fork, and the old diff is discarded. Rework (rung 2) is used only when the author's session is still alive and cheap to resume.

**Why.** Agents are the first contributors for whom redoing is cheaper than merging: initial $0.078 vs conflict rework $0.21 (2.7x) in the race; 55–86% of real conflicting pairs conflict in exactly one file, i.e. the agent would re-derive a near-identical patch (measured). Re-execution also never sees other tasks' red tests, so it cannot "fix" them (§1.5), and it is deterministic to schedule: it starts when the overlapping change is green, which is the `chain it` placement the thesis wanted but could not predict.

**Predicted effect.** $/green: rework spend −60% ($7.06 → ≈$2.6 in the race if re-executions succeed at the initial rate; estimated); green/h: neutral to +10% (fewer conflict-resolution turns, simulated as `r_conf` 1.0 vs 2.6); red rate: slightly lower (no half-resolved merges); done→green: +1 execution time for the 14–51% of changes that collide (measured per-change collision rates); human minutes: 0.

**Cheap test.** Race replay in the harness's `replay` agent is free: re-apply the reference patch on the new head vs 3-way merge, count clean applies. Real: add `--rework reexecute` and compare rework cost and success on the 33 conflicts. Sim: `--set r_conf=1.0` is exactly this policy's cost (scenario C already uses it).

**Cloudflare.** Fork-per-attempt in Artifacts (forks are the unit of re-execution; the reaper deletes losers); the intent and tests live in the task record (DO SQLite), not in the fork; the committer prefers "re-execute" over "merge" by policy for changes under a size threshold.

### Idea 4 — Repair by racing strategies

**Mechanism.** When a red needs more than rung 1, spawn **three cheap, mechanically different repairs in parallel** on three forks: (a) revert A and re-execute A on top of B; (b) revert B and re-execute B on top of A; (c) one fixer with both diffs. Validate all three; the first green lands; the others are archived with lineage. If (a) and (b) both go green but disagree on behaviour, that *is* the contradiction signal for idea 8.

**Why.** Forks are cheap, re-execution is $0.08, and the fixer rung is a coin flip that costs $0.57 and 4.4 min (measured). Three strategies at ≈$0.08–0.21 each cost less than one fixer and finish in one validation cycle instead of the 8–21 minutes tickets stayed open (measured ticket open times 2–21 min). This exploits what humans cannot do: clone the worker and try both orders at once.

**Predicted effect.** done→green for reds: −50–70% (one cycle instead of serial attempts; estimated); $/red: ≈$0.3–0.5 vs the measured $0.57 × 1.25 attempts × 0.04 success; red rate: unchanged; green/h: +5–10% (estimated, from shorter red episodes); human minutes: fewer, because contradictions surface as "both orders green, behaviours differ" instead of after two failed fixes.

**Cheap test.** Harness: implement as rung 3 of the ladder with `asyncio.gather` over three worktrees; measure $ and minutes per closed ticket against the 20 tickets of `main-bs-haiku-40`. Sim: a patched `b_take_ticket` that charges 3 × `r_conf` work and succeeds with 1 − (1 − p)^3; compare green/h at `r_fix` 2.0.

**Cloudflare.** A Workflow fans out three Sandbox jobs (Containers), each on its own Artifacts fork; the first green result wins via `Promise.race` semantics in the Workflow; the losing forks go to the reaper; the Scheduler DO records which strategy won per pair of tasks (a prior for next time).

### Idea 5 — Tests-first admission, with a separate test author

**Mechanism.** No task starts without acceptance tests that **fail on the base** (fail-first proof; extends #12). Tests are authored by a *different* agent session than the implementer, from the intent alone, and are **owned by the forge**: the implementer's fork cannot modify a test file it did not create (the committer rejects the diff hunks, which is what `protect_tests landed` approximates). Humans review tests, not diffs; a test change is a privileged change (#13).

**Why.** Given tests up front, agents failed their own tests on 1–3 of 40 landings (measured) against the simulator's 15% and the literature's 25–30%; the simulator says `p_self` 0.03 lifts every policy by about a third (simulated, §2.3 row B). The 11 genuine test edits in the race were all on a red tree (§1.5). Splitting author and implementer is the cheapest adversarial check there is: the implementer never sees how the test is written, so it cannot tune to it, and the test author never sees the implementation, so it cannot rationalise it.

**Predicted effect.** green/h: +30–35% for any integration policy (simulated); red rate: self-failures → ~0, remaining reds are interactions; $/green: −10–15% (fewer reworks) plus the cost of the test author (≈$0.05 per task at Haiku prices, estimated); done→green: unchanged; human minutes: shift from reading diffs to reading tests, roughly 1–2 minutes per intent (estimated).

**Cheap test.** Already measured for the "tests given" half. For the "agent-authored tests" half: run the 40 arena prompts through a Haiku test-author session without the acceptance tests, check fail-on-base and compare against the reference acceptance tests by running them on the reference solutions (one day, no harness changes beyond a prompt).

**Cloudflare.** Test authoring is a Workflow step before placement; fail-first proof runs in a Container against the base tree and is stored as evidence keyed by (tree hash, test hash); the committer enforces test ownership from the task record in the DO; a human "approve tests" card is the review surface.

### Idea 6 — Mutual-acceptance pre-check and the two-speed trunk

**Mechanism.** Before a change lands, the committer runs **the acceptance tests of every task that read what this change wrote** (running tasks' read sets are observed; landed tasks' tests are already in the suite) on the merged tree. If they pass, the change lands fast, untested otherwise, as today. If they fail, it is a contract conflict: the change goes to the contract lane (idea 7) or a card (idea 8) *before* it ever touches the trunk. Only flagged pairs pay this cost; everything else keeps the fast path. This replaces per-path isolation levels configured by humans with an isolation level chosen per change from evidence.

**Why.** Read-write overlap with a *running* task's observed footprint flags 6–9% of pairs at 0.55–0.6 recall (measured, §1.4); the arena's 5 designed semantic couplings are caught by construction (`validate.py` proves each merged tree fails). Preventing contract-change interleaving doubles throughput for every policy (simulated, §2.3 row D). The pre-check costs one targeted test run (seconds) for a few percent of landings, versus 84 minutes of red.

**Predicted effect.** red-validation rate: −60–70% (the measured share of reds from couplings); green/h: +50–100% (simulated upper bound from q_sem 0 → row D), realistically +30% (estimated, allowing for pre-check misses); $/green: −40% (the tail spend disappears); done→green: +1 targeted test run (~1 min) for flagged changes only; human minutes: cards only for true contradictions.

**Cheap test.** Re-analysis: in `main-bs-haiku-40`, for each of the 20 tickets check whether the culprit's write set intersected the import closure of a *landed* task's acceptance test (the harness already computes `read_sets` per failing test); count how many reds the pre-check would have caught before landing. Sim: `--set q_sem=0.0` bounds the gain (done, §2.3); a patched `b_round_end` that charges one `test_minutes` for flagged pairs and converts their `sem` to a hold gives the realistic number.

**Cloudflare.** The committer (Sandbox) asks the Scheduler DO for the readers of the change's write set, then runs only their acceptance files in a Container (test impact by import closure, which `ci.py` already computes); results are evidence keyed by tree hash; the fast path is unchanged for unflagged changes.

### Idea 7 — Contract-change transactions

**Mechanism.** A change that alters the behaviour or shape of a symbol other modules depend on is a **contract change** and runs as a different kind of transaction: (1) it is declared by the planner or detected (it fails the existing suite or a mutual-acceptance check without editing tests, or its diff edits the body of an exported symbol with cross-module importers); (2) it lands in a **contract lane**, serialized with other contract changes, and the forge **fans out adaptation tasks** to every fork that read the symbol ("`Order.total` now includes shipping; update your assumption"), each a cheap re-execution with the new contract in its prompt; (3) where possible the agent is told to land it in two phases, expand (new behaviour behind a new name or flag) then contract (remove the old one once readers have moved), which turns a conflict into two commutative changes.

**Why.** Five of 40 tasks caused 62–71% of the race's red slots; five of the queue's six red ejections were coupled tasks breaking *existing* base tests, and the queue dropped four of the ten coupled tasks (measured). Contract changes are the one class where "schedule it so it doesn't run concurrently" is both feasible (they are ~12% of tasks) and decisive (q_sem 0 doubles throughput, simulated). Static detection alone is only a prior: a crude "changed exported symbol × cross-module importers" ranker put 3 of the 5 contract tasks in the top 7 of 40 but also ranked additive type changes high (measured, inline script; see appendix); dynamic detection by tests (idea 6) is what makes it reliable. Extends C11 #10 (contract beans) by making the contract a *transaction type with fan-out*, not a document.

**Predicted effect.** red rate: −50% on its own, −70% with idea 6 (measured attribution); green/h: +30–100% (simulated bound); $/green: −30–50% (the tail); done→green: longer for the ~12% contract changes (serialized), unchanged for the rest; human minutes: one card per contract change ("approve this contract change and its adaptation plan"), 2–3 minutes each (estimated).

**Cheap test.** Re-analysis, half done: the 5 A-side tasks are the ones whose landing broke other tasks' tests; check how many of their *readers* had a live session (3 of 10 pairs in the race, measured) vs would have been re-executed (the rest). Sim: add a `contract_share` parameter that marks 12% of tasks as contract changes, forces them through a serial lane with `dependency` edges to their module-sharing neighbours, and sets `q_sem` to 0 for pairs involving them; compare with scenario C (half a day of patching).

**Cloudflare.** A contract lane is a second committer queue in the Scheduler DO with a serializable policy; fan-out adaptations are Queue messages to the affected tasks' Workflows; the "expand/contract" phases are two task records linked in D1; the canvas shows the contract as an edge from the symbol to every reader.

### Idea 8 — Spec-contradiction cards: the human role, made concrete

**Mechanism.** When two acceptance suites cannot both pass on any merged tree (both orders fail in idea 4, or the mutual-acceptance pre-check fails in both directions), the forge raises **one card with two one-line specs**: "t005: amounts show thousands separators (`$1,000.00`)" vs "t031: the plain-text invoice shows `$1000.00`". The human picks a winner, or writes a third line. The loser's task is **re-executed under the winner's semantics** with the decision in its prompt; the decision becomes a record that future tasks reading those symbols see (extends C11 #17). No fixer is ever dispatched for a contradiction.

**Why.** Every one of the race's three root contradictions was a product decision in disguise (rounding policy, what a total includes, how money is formatted) and the harness spent $14.06 and 84 minutes failing to make agents decide it (measured). A human can decide each in under a minute (estimated). This is the only place in the design where the human is *necessary* rather than decorative, which is what the originality rubric should reward: humans stay in charge of *meaning*, agents of *mechanics*.

**Predicted effect.** $/green: removes the fix-forward tail entirely (−$19 of $25 in the race; measured spend, estimated attribution); done→green for contradicted pairs: from "never" to human latency + one re-execution; red rate: −20% (the repeated reds of the same contradiction); green/h: +15–25% (estimated, agents freed from fixer duty); human minutes: ≈1 per contradiction; in the race that would have been 3 cards in 92 minutes.

**Cheap test.** Re-analysis, done: 20 tickets collapse to 3 root contradictions (`t023/t036`, `t032/t028` + `t033`, `t002/t022`-class). Harness: implement the card as a `decision` event answered by a scripted oracle (the arena's author knows the intended winner) and measure $ and time to 40 greens against `main-bs-haiku-40`; a real human answers in the demo.

**Cloudflare.** The card is a decision record in the repo DO, rendered by the canvas and delivered through MCP (`ask_repo` returns open decisions); the re-execution is a Workflow step that waits on the decision with `step.waitForEvent`; the decision record is attached to the symbols in D1 and returned by the context API on every later read of them.

### Idea 9 — Observe-then-place: late-binding placement on the observed read set

**Mechanism.** Start every task immediately. After its first ~10 seconds or first N reads through the context API, compute its **observed read set at file level** and compare it with running tasks' **observed write sets** (from fork pushes and edit tool calls). On overlap, **park the newer task** (checkpoint the fork and the session; agents are pausable and resumable) and resume it when the other lands, chained onto the new head, or hand it to the same agent. No prediction from text is needed; prediction only orders the backlog.

**Why.** Every file an agent went on to change had been read by a median 7 s into a 35 s session (35 of 40 sessions); 74% in the first quarter, 97% by half; the first edit came at 57% of the session (measured). The observed-vs-predicted pair signal has lift 7–8.5x, the observed-vs-observed oracle 13–18x (measured, §1.4). Hard placement with an observed signal cuts textual conflicts 3–5x in the sim at a 0–25% throughput cost from idling, which parking (not idling: the agent takes another task) avoids (simulated, §2.4). Extends #22 (task slices) and C11 #9 (symbol leases from diffs) by making the *scheduler*, not the agent, act on the observation, and before the first write.

**Predicted effect.** textual conflicts: −60–80% (simulated with hard observed placement); $/green: −15–20% (rework was 28% of race spend; measured); green/h: 0 to +10% (conflicts cost rework, not throughput, in the sim); done→green: +wait for parked tasks (bounded by the other task's remaining time, 10 min at the sim's median); human minutes: 0.

**Cheap test.** Re-analysis, done for the first half (read timing). Second half: for the 33 race conflicts, check whether the two tasks' first-10-second read sets intersected (transcripts have Read tool calls with timestamps), i.e. whether parking would have fired in time. Sim: `--set flag_recall=0.6 flag_clean=0.07 placement_fallback=wait` is the hard version (run, §2.4); a `park` fallback that lets the agent take another task needs a 20-line patch to `Scheduler.pick`.

**Cloudflare.** Reads already flow through the context API Worker and are logged to the task's read set in the repo DO; the DO compares file sets on each read batch (sub-millisecond at these sizes); parking is a message to the harness over MCP (`bean pause <task>`), with the fork and session id as the checkpoint; resume is a Workflow step triggered by the overlapping task's landing event.

### Idea 10 — Mid-flight invalidation notices, and joint reconciliation sessions

**Mechanism.** The write-time inverse of the thesis's validator: when task A pushes a change to symbol S, every *running* task that has read S receives a notice in its next tool result ("`applyRateToTotal` changed on task 23's fork two minutes ago; diff attached; it lands in ~5 min"). The reader adapts while its context is hot, at rework cost, not fixer cost. If both tasks have read and written the same symbols, the forge opens one **joint session** with both transcripts and both acceptance suites to reconcile before either lands. Extends #9 (pairwise early-warning merges) and C11 #3 (resolver sprouts) by acting *before landing* and *inside the authors' live sessions*.

**Why.** Adaptation in a live author session costs $0.21 (rework) against $0.57 for a cold fixer that has to reconstruct both intents from 27–51 diffs (measured). The thesis's own point stands: agents don't talk, but the forge can make them, because it sees every read and write. The honest caveat: the race cannot test this. Sessions lasted 35 s, only 3 of 10 coupled pairs overlapped in time (measured), so notices would have reached a live session a third of the time; at the sim's 20-minute tasks, or with Sonnet, overlap is the norm (estimated).

**Predicted effect.** red rate: −30–50% for workloads with long tasks (estimated); $/red: −60% (rework vs fixer, measured ratio); done→green: shorter for adapted tasks, since they land clean; green/h: +10–20% (estimated); human minutes: 0 except when the joint session reports a contradiction (→ idea 8).

**Cheap test.** Sim: add a parameter `notice_share` (share of semantic pairs caught in flight, 0.3 for the race, ~0.8 for 20-minute tasks) that converts a `sem` outcome into a `r_conf` rework before landing; compare with scenario C/E. Race: re-run 12 coupled tasks with Sonnet (longer sessions) and a harness hook that injects the notice as a follow-up turn; measure how many coupled pairs land green without a ticket.

**Cloudflare.** The repo DO keeps a symbol → readers index from the context API log; a fork push (Artifacts event → Queue) triggers a notice fan-out to the readers' MCP sessions (a `notices` tool the harness polls, or a WebSocket to the harness bridge); the joint session is an Agents SDK session seeded with both transcripts' summaries and both acceptance suites.

### Idea 11 — Registry explosion and the contention-refactoring agent

**Mechanism.** The codebase reshapes itself to reduce future collisions. At import, and nightly, an agent ranks files by **P(conflict | shared)** from the trunk log and proposes refactors that make them append-only or generated: a migration registry becomes a directory with auto-discovery, a route table becomes per-module files aggregated at build time, a changelog becomes fragments, a hand-maintained endpoint table in the README becomes generated, a monolithic types file is split by module. Each proposal is a normal change with a predicted conflict reduction attached (computed with the replay tool), and a human approves it. Extends C11 #11 (hot-file slot allocation) from *allocating slots in* hot files to *removing* them.

**Why.** One root-level manifest-like file is 16% of all conflicted file-slots in the private agent-heavy corpus with P(conflict | shared) = 93%; manifests are 18% of its conflicted files; top-20 files are 15–28% of conflicted slots across corpora; in the arena the migration registry conflicts 100% of the time it is shared, `routes.ts` 90%, `CHANGELOG.md` 41%; the migration registry alone caused 8 of 33 and 11 of 27 race conflicts and the queue dropped two tasks on it (measured). Merge drivers dissolve only 2.4% of the private corpus's conflicts because registries are *source*, not generated (measured). In the arena, changelog + README table + migration registry are 54% of conflicted file-slots (measured).

**Predicted effect.** textual conflicts: −30–50% in registry-heavy repos (measured shares above; estimated realisation); $/green: −10–15% (rework share); green/h: +5% (simulated: conflicts barely move green/h); red rate: −5–10% (the duplicate-migration-number class); human minutes: one approval per refactor, maybe five per repo.

**Cheap test.** Re-analysis, half done: the shares above. Finish: for workers-sdk and codex, classify the top-50 conflicted files as registry-like vs not and compute the share of conflicting pairs whose *only* conflicted file is registry-like (that is the dissolvable fraction). Arena: apply the three refactors to `app/` and re-run `contention.py` (`git merge-tree` over 780 pairs) to measure the drop from 58 conflicting pairs.

**Cloudflare.** A nightly Workflow reads the trunk log in D1, runs the replay tool in a Container to score candidates, and opens the refactor as an ordinary intent for the swarm; the committer learns the new append-only conventions as merge rules in `.beanstalk/merge.toml`.

### Idea 12 — The self-calibrating forecast: the simulator as the throttle

**Mechanism.** The forge continuously calibrates the discrete-event model from its own trunk log (repair cost per rung, self-failure, conflict rates per file, contract-change share) and shows humans a **forecast dial**: at N active agents on this repo, expected greens per hour, $ per green, and open contradictions per day, with the knee where repair spend overtakes work spend. Admission (how many tasks to start, which lane) follows the dial instead of a fixed error budget.

**Why.** The uncalibrated simulator predicted 1.4x and the race delivered a fast head and a catastrophic tail; four parameters explain the gap (§1.3), and all four are observable from the trunk log. A controller that acts on open reds (the error budget) idles agents; one that acts on forecast $/green does not (simulated: no-budget beats budget in every scenario, §2.2). This is also the honest scale story for the stage: "here is the knee for *your* repo", not "thousands".

**Predicted effect.** green/h: +15–60% vs the error budget (simulated, §2.2 no-budget rows); $/green: bounded by policy instead of discovered at $25; red rate: unchanged; done→green: unchanged; human minutes: one glance.

**Cheap test.** Calibrate `params/arena.json` from `main-bs-haiku-40` (`r_fix` 7, `r_conf` 2.7, `p_self` 0.05, `p_fix_bad` 0.5, `q_sem` from the 5 couplings) and check that the sim reproduces the race's head/tail shape and $ ordering of the two policies; then forecast the v2 preset and compare with the re-run (idea 1's test). If the calibrated sim cannot reproduce the race, this idea is dead and the sim should be retired from the pitch.

**Cloudflare.** The sim is 80 KB of standard-library Python; it runs in a Container on a Workflow schedule against D1 aggregates; the dial is a canvas card; admission reads the forecast from the Scheduler DO.

### Predicted effects at a glance

| Idea | green/h | $ per green | red-validation rate | done→green | human minutes | Evidence grade |
|---|---|---|---|---|---|---|
| 1 Quarantine + revert-first | +0–30% | −50% | 80% → 10–20% | never → 1 cycle | 0 | simulated + measured need |
| 2 Repair ladder | +10–20% | −40–60% | no 2nd-order reds | shorter | 2–5 cards/100 tasks | measured rung costs |
| 3 Disposable patches | 0–+10% | rework −60% | slightly lower | +1 execution on collision | 0 | measured cost ratio |
| 4 Repair by racing | +5–10% | ≈$0.3–0.5/red | unchanged | −50–70% for reds | fewer | estimated |
| 5 Tests-first admission | +30–35% | −10–15% | self → ~0 | unchanged | 1–2/intent (tests) | measured + simulated |
| 6 Mutual-acceptance pre-check | +30% (bound +100%) | −40% | −60–70% | +1 min for flagged | contradictions only | measured attribution + simulated bound |
| 7 Contract transactions | +30–100% | −30–50% | −50–70% | longer for 12% | 1 card each | measured + simulated |
| 8 Spec-contradiction cards | +15–25% | removes the tail | −20% | never → human + 1 run | ≈1 per contradiction | measured |
| 9 Observe-then-place | 0–+10% | −15–20% | − | +wait if parked | 0 | measured signal + simulated |
| 10 Mid-flight notices | +10–20% (long tasks) | −60% per red | −30–50% | shorter | 0 | estimated; untestable in this race |
| 11 Registry explosion | +5% | −10–15% | −5–10% | − | ~5 approvals/repo | measured shares |
| 12 Self-calibrating forecast | +15–60% vs budget | bounded | − | − | one glance | simulated |

---

## 4. Rankings, and what to drop

### 4.1 For the competition demo (originality a judge can *see* in ten minutes)

1. **Spec-contradiction cards on quarantine lanes (ideas 8 + 1).** One screen shows the fast trunk landing, a red culprit being quarantined while green keeps advancing past it, and then a card: two one-line specs, a human clicks, the loser re-executes and goes green. It demonstrates concurrency, conflict handling, review and the human role in one motion, and nothing in the research corpus shows a forge turning a test contradiction into a product decision.
2. **Repair by racing (idea 4).** Three forks fan out, three sprites work, the first green wins and the others are archived with lineage. It is the visual proof that agents are cheap to clone and that the forge exploits it; it is also cheap to build on the existing harness.
3. **Observe-then-place (idea 9).** An agent starts, the files it reads light up on the map within seconds, a colliding task is parked (its sprite dims) and resumes when the first lands. It shows the forge *seeing* agents, which no PR list can.

The race remains the proof, but scored on time and $ to the k-th green and $ per green, not on greens per hour over unequal horizons.

### 4.2 For real-world value

1. **Quarantine + the repair ladder (ideas 1 + 2 + 3).** This is what turns the measured 2.5x head start into a win instead of a $25 loss: revert first, re-execute, resume, and only then a small-ticket fixer.
2. **Mutual-acceptance pre-check and contract transactions (ideas 6 + 7).** The 12% of changes that cause 62–71% of the reds get a lane of their own; everything else keeps the fast path. Simulated bound: throughput doubles for every policy.
3. **Tests-first admission with a separate test author (idea 5).** A third more throughput for any integration policy, near-zero self-failures, and the review surface humans can actually read.

### 4.3 Drop, demote, keep

**Drop**
- **The error-budget controller as specified.** It idles agents to wait for expensive repairs; `budget=false` wins every simulated scenario (§2.2), and the race paused once for 6 minutes while the trunk was red for 84.
- **Module-level predicted placement and the Jev footprint classifier.** Lift 1.0–1.5x on every corpus; `beanstalk-noplace` equals `beanstalk`; Jev never ran. File-level, observed signals replace it (idea 9). Prediction keeps one job: ordering the backlog.
- **Fix-forward fixers with range-wide tickets.** 1 of 23 green heads, $0.57 a try, prompt size drives cost. The fixer survives only as rung 3 of the ladder, after a bisect, with ≤2 diffs, on the culprit's fork.
- **Prefix-green promotion and "snapshot = green".** Replaced by quarantine promotion; tasks fork from the quarantined head.
- **Per-path isolation levels in a TOML file.** Humans will not know which paths deserve `serializable`; evidence does (idea 6). Keep the three names as the *lanes* the forge assigns.

**Demote**
- **Causal repair tickets.** Keep the data (read/write sets) for idea 6 and the cards; stop claiming the ticket makes fixing cheap.
- **Reservations and recipes (#5, #6).** Fine, unmeasured; not on the critical path.

**Keep**
- The fast trunk for cold tasks (measured 2.5x on the head), the single committer, read/write-set logging, tested-tree attestation, green as a separate token-guarded repo, the race as proof (re-scored), the canvas, test weakening as a privileged change (#13), fail-first proof (#12), the context API (#21).

---

## 5. The single most important change to the plan

**Stop treating merge mechanics as the product; treat repair economics and contract handling as the product.** The thesis's bet was "place work so it doesn't collide, land without waiting, repair the rare bad interleaving with a targeted fixer". Measured: placement does not place, landing without waiting works, and the repair is neither rare (62% of reds share one cause), nor targeted (27–51 suspects), nor cheap (7x), nor successful (1 of 23). The 50% originality score should come from the repair economy (revert-first quarantine, the ladder, racing repairs, disposable patches) and from making the human the arbiter of contradictions, because that is where the measured problem is and where nothing in the field has an answer.

### Next 48 hours of experiments, in order

| # | Experiment | Pass if | Cost |
|---|---|---|---|
| 1 | **Calibrate the sim from the race** (`r_fix` 7, `r_conf` 2.7, `p_self` 0.05, `p_fix_bad` 0.5, arena `q_sem`) and re-run the published grid | The calibrated sim reproduces the head/tail shape and the $ ordering of the two races | 1 hour; uses `--set` only |
| 2 | **Race v2**: `main-bs-haiku-40` seed 7 with revert-first quarantine, the ladder (re-execute → resume → bisected ≤2-diff fixer → park), mutual-acceptance pre-check for flagged pairs, scripted spec-decision oracle | ≥ 37 green, finished under $8, green never frozen > 10 min, ≤ 5 cards | half a day of harness work + $10 |
| 3 | **Queue + tests-first** vs **race v2**, 3 seeds each | v2 beats the queue on time to the 35th green by ≥ 1.5x *and* on $ to finish 40 tasks | $40 |
| 4 | **Observed-footprint timing** on the 33 race conflicts (do first-10-second read sets intersect?) and the Sonnet 12-task overlap run for idea 10 | ≥ 60% of conflicting pairs detectable before the first edit | 2 hours + $10 |
| 5 | **Registry explosion on the arena** (`contention.py` before/after) | ≥ 40% fewer conflicting pairs of 780 | 2 hours |

If experiment 3 fails, the honest story for the stage is still strong: a fast trunk for independent work, a contract lane for the rest, and a human who decides contradictions in one click, all measured on real agents against a real merge queue.

---

## Appendix: what was run, and where

All scratch work is under `/private/tmp/claude-501/-Users-coop-Workspace/469e6f7b-45e3-4919-bc23-03d7694a485c/scratchpad/fable/` (nothing under `research/` or `packages/` was modified; no agent sessions were launched; the running queue race was only read):

- `race_analysis.py`, `fixer_effect.py` — red classification, trunk red time, fixer effectiveness, spend by phase, ticket sizes, transcript check for test edits.
- `conflict_files.py` — file-level concentration of real conflicts per corpus (private corpus anonymised).
- `filepred.py` — title-only kNN file-level footprint prediction and pair flagging on workers-sdk and codex (8 s).
- `sim_patched.py` — copy of `research/contention-sim/sim.py` with one added parameter, `p_fix_bad` (default `p_self`; S0 reproduces the published numbers). `grid.py`, `sweep.py`, `sweep2.py`, `sweep3.py` — the tables in §2 (about 7 CPU-minutes in total).
- Contract-change detectability and in-flight overlap were run inline (see §3, ideas 7 and 10).

Reproduce any §2 row with the published simulator plus `--set`, for example:
`python3 sim.py --params params/default.json --agents 100 --seeds 4 --policy beanstalk --set green_mode=quarantine --set budget=false --set flag_recall=0.6 --set flag_clean=0.07 --set p_self=0.03 --set r_fix=2.0 --set r_conf=1.0 --json`
(`p_fix_bad` needs the patched copy.)
