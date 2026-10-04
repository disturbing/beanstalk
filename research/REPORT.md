# Beanstalk contention research: report (2026-10-03)

_Written by the research subagent that built and ran this folder's ladder, saved verbatim by the lead session. The lead's audit and later runs, including the Sonnet matrix and the v2 policy, are in `../docs/claude-opus/08-validation-steps-1-3.md`, with the innovation analysis in `../docs/claude-opus/09-fable-innovations.md`. An addendum at the end lists the later runs._

## The answer

The concurrency-control thesis (`../docs/claude-opus/02-thesis-concurrency-control.md`) splits into three parts. Only one works as designed, and it needs a fix:

| Part of the thesis | Verdict | Evidence |
|---|---|---|
| **Placing tasks before they start** to avoid collisions | Doesn't hold up | Module-level predictions can't tell risky pairs from safe ones; strict placement collapses concurrency (reproduces Cursor's lock collapse); soft placement does nothing |
| **Landing changes without waiting for tests** (the fast trunk) | Works for the bulk of the work | Real agents got 35–37 of 40 tasks green 2.3–3.4x faster than a strong merge queue, at the same or lower cost and fewer CI minutes |
| **Fixing breaks afterwards** and only advancing green when the whole trunk passes | Fails with real agents | Repairs cost 7x a task, not the assumed 0.4x. Green froze (Haiku tail) or never moved (Sonnet, 12 agents: 2 of 40 green in 40 min) |

**What to build instead:** keep the fast trunk, but advance green past known culprits (revert or quarantine first, repair later). Enforce test integrity as a platform rule. Cap repair attempts and hand unresolved semantic collisions to a human decision card. Use scheduling only for a few hot files, such as migration numbers, not as the headline.

**What this means for the demo:** a race of Beanstalk as currently specified will likely stall on stage. Implement quarantine promotion in the race harness and re-run it before building the demo around it.

## How it was tested

| Step | Question | Method | Built by |
|---|---|---|---|
| 1 | Do concurrent changes collide? | For every pair of changes merged within 20 of each other, remove the earlier one and re-apply the later one; if it no longer applies, they'd have collided | Opus subagent |
| 2 | Can a change's footprint be predicted from its title? | Time-respecting predictors, scored on the later half of each history | Sonnet subagent |
| 3 | Does the approach beat a good merge queue? | Simulator calibrated on steps 1–2, against the best of 9 queue variants, 10 seeds each | Opus subagent |
| – | Demo repo | 40 issue-style tasks with designed collisions, all validated | Sonnet subagent |
| 4 | Do real agents behave as simulated? | Headless Claude Code agents racing under both policies on the demo repo | Opus subagent built it; the research subagent ran it |

**Repos measured:**
- workers-sdk: 1,286 changes.
- codex: 6,777 changes.
- `platform` (private): 2,590 changes, half of them attributed to agents (Claude and Cursor). Its results stay in git-ignored private folders; this report gives aggregates only.

**Review fixes made along the way:**
1. **Step 1 method.** The original method silently dropped exactly the pairs that collide (0 collisions in 1,000+ pairs). It was replaced with the leave-one-out test above and verified independently.
2. **Placement model.** The simulator now uses measured pair-level flag rates.
3. **Fair race rules.** Two of the queue's defaults handicapped it. Agents had to wait for their PR to land before taking new work, and CHANGELOG had no union merge driver. Beanstalk was raced against a strong queue without either handicap, and a test-integrity rule was added for both policies.
4. **Integrity-rule bug.** A false positive in the integrity rule was fixed. It affected both main Haiku runs equally and didn't change outcomes.
5. **Repair costs.** The simulator was re-run with the repair costs actually measured in the race.

## Step 1: real repos (measured; 20 concurrent changes unless stated)

| | workers-sdk | codex | platform |
|---|---|---|---|
| Collision rate per pair | 1.20% | 1.56% | 5.87% |
| Collision rate when both changes touch the same file | 23% | 18% | 51% |
| Pairs that share a file | 6% | 10% | 22% |
| Pairs that share a module | 70% | 37% | 54% |
| Changes that collide with ≥1 other, at 10 / 20 / 50 in flight | 8 / 14 / 26% | 12 / 18 / 27% | 42 / 51 / 64% |
| Projected chance of ≥1 collision with 100 in flight | 70% | 79% | ~100% |
| Collisions removable by lockfile/changelog merge drivers | 13% | 8.5% | 2.4% |
| Collisions in the single hottest file | 7% | 3% | **31%** |

- **Collisions require a shared file.** Pairs that share only a module almost never collide (one case on platform), so module overlap carries no signal.
- **Per pair, collisions are rare; per change, they grow fast with concurrency.** That compounding is the scaling argument.
- **The agent-heavy repo collides 3–4x more than the other two.** 46% of its pairs are chains of follow-up changes on the same lines.
- **Platform's collisions are concentrated in one hot file,** which suits targeted hot-file handling.

## Step 2: predicting footprints from titles (measured; later half of each history)

| Repo | Best method: precision / recall / F1 / recall@3 | No-text baseline F1 |
|---|---|---|
| workers-sdk | 0.76 / 0.58 / 0.66 / 0.65 | 0.54 |
| codex | 0.53 / 0.47 / 0.50 / 0.52 | 0.33 |
| platform | 0.61 / 0.49 / 0.54 / 0.61 | 0.41 |

- Titles add a real gain over the baseline, but recall stays below the 0.6 target on all three repos.
- **Module level is useless for scheduling:** even a *perfect* module predictor flags 33–74% of safe pairs as risky.
- **File level would work:** perfect file knowledge flags only 4–6% of safe pairs, 11–18x better than chance. The best title-based predictors catch about 60% of collisions while wrongly flagging 15–29% of safe pairs.
- **Jev wasn't tested:** TypeSafe returned "no available credits". The run is staged and would cost about $0.08 (`python3 jev_client.py run <corpus>`).

## Step 3: simulation (simulated, 10 seeds, calibrated on step 1)

**Beanstalk vs the best queue at each scale:**

| Concurrent agents | 5 | 20 | 100 | 500 | 1,000 |
|---|---|---|---|---|---|
| Default assumptions | 1.38x | 1.50x | 2.44x | 5.8x | 6.9x |
| Calibrated on workers-sdk / codex / platform | ~1.4x | 1.6–1.7x | 1.8–2.5x | 3.0–6.6x | 3.4–7.8x |

- **All of the gain comes from the fast trunk.** Soft placement equals no placement, even with perfect file knowledge. Strict placement caps throughput, and with module footprints it collapses to about 2 busy agents.
- **Semantic breaks decide it.** At 20 agents Beanstalk leads 1.7x at a 5% break rate and only about 1.1x at 20%, where it livelocks at 500 agents.
- **Green goes stale:** median done-to-green is 294 minutes vs 100 for the queue at 20 agents, with green gaps of 7.5 to 40 hours. Quarantine promotion fixes most of this.

**Re-run with measured repair costs** (rework fixed at 1.5x a task):

| Repair cost vs task | Beanstalk as specified | Without the error-budget pause |
|---|---|---|
| 0.4x (original assumption) | 1.4–6.9x | up to 8.6x |
| 1x | 1.1–2.1x | 1.3–3.1x |
| 2x | 0.8–1.3x | 1.2–2.2x |
| 4x | 0.6–0.9x (loses) | 1.1–2.8x |
| 7x (measured with Haiku) | 0.5–0.9x (loses) | 1.1–2.6x at 20+ agents |

Beanstalk as specified breaks even at repairs costing about 1.5–2x a task. When repairs are slow, its pause-new-work-while-red rule does more harm than good.

## Demo repo

"Beanstalk Shop" is a zero-dependency TypeScript shop API: about 2,400 lines of code, 80 base tests running in about 2 seconds, and 40 tasks.
- **Every task validated:** acceptance tests fail on the base code and pass with the reference solution.
- **Textual collisions:** 7.4% of task pairs, or 4.6% once CHANGELOG-only collisions are excluded.
- **Semantic check:** 7 of 722 textually clean pairs broke the tests. That's all 5 designed couplings plus 2 that arose naturally (tax breakdown vs tax rounding; order totals including shipping vs free-shipping threshold).

## Step 4: real headless agents (measured, single runs)

**Shared setup:** 2 CI slots with 60-second latency. The strong queue lets authors keep working, both policies use the union merge driver, and both use the integrity rule except where noted.

| Run | Policy | Tasks green | Time to last green | Cost | Final green correct |
|---|---|---|---|---|---|
| Haiku pilot, 12 tasks, 4 agents (own tests only) | Queue | 11 | 7.3 min | $2.28 | **No** |
| | Beanstalk | 10 | 5.5 min, then $5 cap | $5.01 | Yes |
| **Haiku main, 40 tasks, 8 agents** | Queue, run A | 35 (5 dropped) | 18.6 min | $6.93 | Yes |
| | Queue, run B (cut off at 28 min) | 35 | 26.9 min | $7.19 | – |
| | **Beanstalk** | **37** | **8.0 min**, then an 84-min tail to the $25 cap | $5.70 at last green, $25.00 total | Yes |
| | Beanstalk, repairs capped at 1 attempt | 36 | 8.8 min, then frozen to the 60-min cap | $5.86 at last green, $13.81 total | Yes |
| Sonnet, 40 tasks, 12 agents (lead session; own tests only) | Queue | 38 | 20.2 min | $4.84 | **No** |
| | Beanstalk | **2** | stopped at 40 min | $7.63 | Yes |

**Time to reach N tasks green** (Haiku, 40 tasks):

| Tasks green | Queue run A | Queue run B | Beanstalk |
|---|---|---|---|
| 20 | 4.4 min | 4.3 min | 3.3 min |
| 30 | 11.5 min | 17.7 min | 7.4 min |
| 35 | 18.6 min | 26.9 min | 7.4 min |

Beanstalk also used about half the CI minutes to reach its last green task (14 vs 26–40).

**How the simulator compares with reality:**

| Step (Haiku) | Median time vs initial task | Cost vs initial task | Simulator assumed |
|---|---|---|---|
| Queue rework | 1.0x | 2.6x | 0.3x |
| Beanstalk rework | 2.6x | 2.7x | 0.3x |
| Beanstalk repair agent | 7.1x | 7.3x (41 turns, hitting the cap) | 0.4x |

**Other measured behaviour:**
- **Collision clusters.** Real semantic collisions come in clusters, and a fix lands and exposes the next red.
- **Bisection eating CI.** In the Sonnet run, 44 bisection CI runs consumed the two CI slots and starved validation of new work.
- **Coarse culprit lists.** Each red ticket named 4–11 suspect changes, because every test imports the whole app.
- **Placement in practice.** Footprint prediction on the demo repo scored precision 0.65 and recall 0.43–0.48. 28 of 40 placements overlapped anyway, and Beanstalk met about as many textual conflicts as the queue (33 vs 27).
- **Agents tamper with tests.** In both small-protection runs, an agent got CI green by rewriting another task's acceptance test, and it reached final green undetected. With the integrity rule on, 10–11 genuine attempts were blocked per 40-task Beanstalk run. That makes test integrity a required platform rule, not an optional extra.

## What to change in the Beanstalk design and demo

1. **Pitch:** "agents commit without waiting; Beanstalk keeps green honest", rather than "scheduled like database transactions".
2. **Keep the fast trunk, change promotion:** advance green to the newest tested head minus known culprits. Revert first and repair after. Cap repair attempts per collision cluster, and send unresolved semantic collisions to a human decision card.
3. **Make test integrity structural:** agents can't change landed tests, and every attempt is counted on screen.
4. **Narrow scheduling to hot files:** assign migration numbers at commit, give registries their own slots, and serialize the few files that dominate collisions (platform: one file, 31%). Keep footprint warnings advisory.
5. **Make repairs cheap:** strong models for repair agents, finer read sets (test-level, not app-level), and capped bisection so validation of new work is never starved.
6. **Before the demo:** implement quarantine promotion in the harness and re-run the races with several seeds. Two identical queue runs differed by 45%.

## Caveats

- **Few real runs.** Mostly one run per configuration, with at most 12 concurrent agents. Every claim beyond that scale is simulated.
- **The demo repo was built here,** including its collision clusters.
- **The Sonnet pair** used somewhat different settings: own tests only, and the union driver on Beanstalk only.
- **Machine and CI emulation.** CI latency is emulated with a fixed delay, everything ran on one machine, and Haiku is cheaper and weaker than production agents.
- **Simulator limits.** It doesn't model a red trunk poisoning new work, and treats semantic breaks as independent.
- **Step-2 proxies.** PR titles stand in for task descriptions, and platform's later history is much harder to predict.
- **Jev untested,** for lack of credits.
- **Path quoting.** Path quoting in the extractor was fixed after the runs; 8 workers-sdk files were affected, which is negligible.

## Spend

The research subagent's agent spend was about **$60.90**, billed as Claude extra usage at list price:
- pilots $7.29;
- Haiku main races $39.12, including the queue run cut off by the 2-hour background limit;
- bounded Beanstalk run $13.81;
- stopped Sonnet start $0.61;
- harness smoke tests $0.07.

The lead session's Sonnet runs are listed in the addendum. Jev cost nothing (all calls rejected).

## Reproduce

Run from `research/`; full commands are in each folder's README.
1. `corpora/clone.sh`, then `common/corpus.py` for each repo.
2. `contention-replay/replay.py`, then `table.py`.
3. `footprint-prediction/predict.py`, then `evaluate_pairs.py`.
4. `contention-sim/calibrate.py`, then `experiments.py`. The repair-cost sweep is `--set r_conf=1.5 --set r_fix=<x>`.
5. `arena/materialize.py`, then `validate.py`.
6. `race/race.py` with `--no-queue-hold --merge-drivers union --protect-tests landed`.

Nothing was committed. The tracked outputs come to about 74 MB; the largest is codex's `pairs.jsonl` at 30 MB, which could be git-ignored since it regenerates.

## Addendum (lead session, 2026-10-03)

Policies added to `race/`:
- `--policy beanstalk-preland` (`harness/policy_beanstalk_preland.py`): checks the merged tree before landing; on red, the author repairs in its own session.
- `--policy beanstalk-v2` (`harness/policy_beanstalk_v2.py`), which adds to that:
  - informed author repair, with the conflicting landed changes' intent and diffs (at most 2);
  - spec-decision cards answered by a scripted oracle;
  - revert-first on trunk reds;
  - first-in, first-out start order with no predicted placement.

A Sonnet matrix (12 agents, `--protect-tests landed`, 45-minute cap) is running: queue, beanstalk, beanstalk-preland, beanstalk-v2. Results will be appended to `../docs/claude-opus/08-validation-steps-1-3.md` §5.
