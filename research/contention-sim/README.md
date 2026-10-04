# Step 3: contention simulator

Does "placement + a non-blocking fast trunk + asynchronous validation + causal repair" beat a good
batched merge queue? This folder answers with a discrete-event simulation. Every policy faces the
same agents, CI capacity, backlog and failure model. Throughput counts only changes that reach a
**validated green** branch.

Kill condition (from `../README.md`): Beanstalk delivers < 1.5x the batched queue's
changes-reaching-green per hour.

**Everything this folder produces is simulated.** Measured inputs come from steps 1-2 through
`calibrate.py`; every other input is an assumption, listed below.

## Run it

```bash
cd research/contention-sim
python3 -m unittest discover -s tests             # invariants (~15 s)
python3 sim.py --agents 100 --policy all          # one seed of every policy, printed as a table
python3 experiments.py                            # full sweep on params/default.json (316 CPU-min; ~20 min on 16 workers)
python3 experiments.py --grid quick               # N in {20, 100}, 3 seeds (~20 s)
python3 experiments.py --resume                   # finish an interrupted sweep from runs.csv

# once steps 1-2 have written their outputs
python3 calibrate.py --corpus workers-sdk          # -> params/workers-sdk.json
python3 calibrate.py --corpus codex                # -> params/codex.json
python3 calibrate.py --corpus platform             # -> params/private/platform.json (git-ignored)
python3 experiments.py --params params/workers-sdk.json --grid corpus
python3 experiments.py --params params/codex.json --grid corpus
python3 experiments.py --params params/private/platform.json --grid corpus   # -> out/private/platform/
```

`sim.py --set key=value` and `experiments.py --set key=value` override any parameter (JSON values;
`footprint.zipf_s=1.2` reaches into the footprint block). Every script has `--help`.

**Grid trims**, to stay near 15 minutes:
- k = 16 and the partitioned queue with k = 4 run only at N <= 100;
- the q_sem, placement and recall sweeps stop at N = 500 (placement keeps N = 1000 for two
  operating points);
- queue fairness variants with k = 4 run only at N <= 100;
- fixed-R runs three policies at N = 1000;
- `--grid corpus` (for calibrated params) drops the recall, regime and fixed-R groups and the
  q_sem sweep above N = 100.

**Run caps (deterministic).**
- A run stops with `complete = false` when green has not advanced for `stall_hours` = 500
  simulated hours (a livelock), or past `max_events` (4M) or `max_hours`.
- Its green/h is then the throughput over the simulated horizon.
- In the default sweep only Beanstalk (prefix promotion) at q_sem = 0.2, N = 500 hits a cap: the
  stall detector, in all 10 seeds.

| File | What it is |
|---|---|
| `sim.py` | The simulator: `heapq` event loop, footprint model, interaction model, agents, scheduler, CI pool, every policy. Also `footprint_stats()`, the pair statistics a parameter set implies |
| `calibrate.py` | Step 1 + step 2 outputs -> `params/<corpus>.json` |
| `experiments.py` | The sweep -> `out/<params>/runs.csv` (one row per run), `results.csv` (mean and 95% CI per configuration), `results.md` (tables) |
| `params/default.json` | Literature- and assumption-based defaults, with a `sources` field citing every value |
| `params/private/` | Calibrated params for private corpora (git-ignored; module names replaced by ranks) |
| `out/default/` | The default-params sweep (`--grid full`) |
| `out/codex/`, `out/workers-sdk/` | Calibrated sweeps (`--grid corpus`); platform's is under `out/private/` (git-ignored) |
| `tests/` | `unittest` invariants and a calibrate test built on hand-made step 1/2 files |

## The model

### Entities

- **Backlog:** M = 10 N tasks in priority order. Task i's footprint, work time and dependency are
  drawn once per seed, so every policy sees the same backlog (common random numbers).
- **Agents:** N identical agents.
  - Task work time is lognormal (median D = 20 min, sigma 0.7).
  - Rework after a textual conflict costs r_conf = 0.3x the original work time.
  - A fix after a red costs r_fix = 0.4x.
- **CI:** R runner slots (R = max(2, N/10)). A run takes T = 10 min x lognormal jitter (sigma 0.1). A
  run holds its slot until it ends or is cancelled; cancelled runs count the minutes they used.
- **The trunk:** a linear branch. For the queues it is `main`, which is always green. For Beanstalk it
  is the fast trunk, and green is a promoted position on it.
- **A mechanical merge step:** 10 s per round plus 1 s per change. It is charged identically to the
  queue's candidate build and to Beanstalk's committer.

### Footprints

A task's footprint is a set of modules, a file count per module, and the files themselves.

- **Empirical model** (calibrated params):
  - Module sets and per-module file counts are block-bootstrapped from the corpus's change list.
    Blocks of `block_len` consecutive real changes (step 1's window, default 20) keep co-activity
    correlation. In the public corpora, pairs within 20 changes share a file ~45% more often than
    random pairs.
  - Files inside a module are drawn from a Zipf popularity distribution over the module's
    touched files. The exponent s is fitted by `calibrate.py` so the simulated share of
    file-sharing pairs among module-sharing pairs matches step 1.
  - Ranks of dissolvable files (lockfiles, changelogs, snapshots, generated files) come from the
    corpus. The lockfile is rank 0 of codex's `codex-rs` module.
  - A module whose file touches are >= 90% dissolvable is **commutative** (e.g. workers-sdk's
    `.changeset`, touched by 77% of changes). Placement and the semantic model ignore
    commutative modules, and their conflicts are dissolvable.
- **Parametric fallback** (`params/default.json`):
  - 120 modules with Zipf(1.2) popularity; popular modules are bigger (lognormal size, median 30
    files).
  - Each change touches 1 + Geometric modules (mean 2.5), with 1 + Geometric files per module
    (mean 4.5). Each file is dissolvable with probability 0.1.
  - It was tuned to the public corpora. Its implied pair statistics and their targets are in
    `default.json`'s `sanity_targets`, and are re-checked at the bottom of every `results.md`.
- **Overlap class** of a pair, as step 1 defines it:
  - `file` if the two changes share a file;
  - `module` if they share a module but no file;
  - `disjoint` otherwise.

### Interaction model

When change Y integrates after change X has landed and X is not in Y's base, the outcome is a
*latent* property of the pair. It is a hash of (seed, task ids), so it is identical across policies
and stable across re-checks.

- **Textual conflict**, per-file model (default; the orchestrator's request): each shared
  non-dissolvable file conflicts with probability `p_per_file`, so
  P(conflict) = 1 − (1 − p_per_file)^shared_files. Collisions therefore compound with
  concurrency.
  - Shared dissolvable files conflict with `p_per_file_diss`; merge drivers (on for every policy)
    dissolve those conflicts.
  - Module-only pairs conflict with `p_module`, and disjoint pairs with `p_disjoint`.
  - `conflict_model: class` uses step 1's per-class rates `p_file`, `p_module` and `p_disjoint`
    directly, with a `dissolvable_share`.
- **Semantic break:** a clean (or dissolved) merge of two changes that share a non-commutative
  module fails tests with probability `q_sem`. The later change is the culprit.
- **Self-failure:** each change *version* fails CI on its own with probability `p_self`
  (default 0.15). A conflict rebase keeps the version; a fix creates a new version, which draws
  again.
- **Flakes:** each CI run reports red with probability f (default 0.02) although its tree is fine.
- **Dependencies:** with probability `dependency_rate` a task needs an earlier task (within 20,
  preferring one sharing a module) in its base. It cannot start until that task is visible to new
  tasks: landed on main for the queues, landed on the fast trunk (or green, with
  `snapshot=green`) for Beanstalk.

### Agents and placement

- **Queues:**
  - The author agent stays bound to its PR until it lands and does every rework on ejection
    (spec).
  - `queue_agents=released` frees authors at enqueue; ejections then become tickets for any free
    agent.
- **Beanstalk:**
  - The agent is bound only until its change reaches the fast trunk (one committer round).
  - On a textual conflict at commit, it re-executes on the new head (r_conf; snapshot isolation).
  - Fix tickets go to any free agent, ahead of new tasks. A separate pool is available with
    `fixer_pool`.
- **Placement** (`beanstalk`, `batched+place`). A *held* task is one that can still collide with
  a new one: running, finished but not yet visible to new tasks' bases, or being fixed. A free agent
  considers the first `place_window` = 128 pending tasks in priority order.
  - **Pair-level placement** (default, `placement_model=pair`). Step 2 found module footprints too
    coarse to place on: even a perfect module oracle flags 33-74% of clean pairs, and textual
    conflicts only happen between pairs that share a *file*. So placement is modelled at the pair
    level with a measured operating point.
    - When a candidate t is checked against a held task r, the pair is flagged with probability
      `flag_recall` if it would textually conflict under the interaction model (after merge
      drivers), otherwise with probability `flag_clean`. This is one latent draw per pair, so a
      pair's flag never changes.
    - **Hard** placement (`placement_fallback=wait`) never starts a task that any held task flags.
      **Soft** placement (`least-overlap`, the default) takes the candidate with the fewest flags,
      and starts a flagged one only when no unflagged candidate exists, so no agent idles.
    - False flags compound with concurrency like conflicts do: at a clean-flag rate of 0.25, a
      candidate among 19 held tasks is unflagged with probability 0.75^19 ≈ 0.4%. Hard placement
      therefore caps concurrency, and soft placement degrades towards no placement.
    - Default operating point: `predicted-typical` (0.60, 0.25). `flag_points` names the swept
      points, all taken from the orchestrator's step-2 summary:
      - `predicted-best` (0.60, 0.15): codex, title + body;
      - `predicted-typical` (0.60, 0.25): workers-sdk directory-level kNN 0.21, platform 0.29;
      - `module-level` (0.90, 0.60): the module predictor at its tuned threshold;
      - `file-oracle` (1.00, 0.05): a perfect file-level footprint;
      - `hot-file-rule` (0.30, 0.02): an *assumed* rule that serialises only the few files that
        dominate conflicts (in platform one file holds 31% of conflicting pairs).
    - `calibrate.py` sets each corpus's own measured points (below).
    - Semantic-break pairs do not raise the flag probability; they are flagged at the clean rate.
  - **Module-level placement** (`placement_model=module`; the spec's original model, kept as a
    variant).
    - A task holds its *predicted* module footprint while running, and its actual write set after.
    - Prediction is either `perturb` or `empirical`:
      - `perturb` keeps each true module with probability ρ and draws false positives from module
        popularity, so expected precision is π;
      - `empirical` uses step 2's real predicted sets.
    - `place_cap` = c lets up to c tasks share a module (1 = the spec's no-overlap rule).
    - Results are reported as "module placement" rows.

### Policies

- **serial:** a merge queue with batch size 1 and one test at a time.
  - The PR at the head is rebase-checked against everything landed since its base. A textual
    conflict ejects it for rework (r_conf), after which it re-enters the queue *at its old
    position* (`requeue=front`, a good queue's behaviour).
  - Then it is tested for T. Green lands; red ejects for a fix (r_fix). A red caused only by a
    flake ejects an innocent PR, which costs r_fix of investigation.
- **batched** (bors/Mergify):
  - Up to k ready PRs form a unit, taken from the queue front.
  - A PR that conflicts with main is ejected; one that conflicts with a PR still in flight is
    *deferred* rather than ejected (it would only conflict again).
  - **Speculation (implemented):** units form a train across the R runners, at most
    `spec_depth = min(20, R)` deep (GitLab's default train length). Each unit is tested on main
    plus every unit ahead of it.
  - A unit lands when it is green and everything it depends on has landed.
  - A red unit cancels every unit that assumed it would land (their runs are aborted and charged).
    Then it is bisected: its halves become two units at the front (each round is a CI run of T).
    A red singleton is ejected.
  - `batched-aimd` adapts k: +1 per green batch, halve per red, range 1-32. This follows Zuul's
    window rule applied to k.
- **batched-par** (a fairness extension): Uber SubmitQueue / Aviator affected-targets style.
  - A unit depends only on in-flight units that share a module with it, transitively. Disjoint
    units test and land in parallel.
  - Speculation is bounded at `spec_depth` per dependency chain.
  - In this model module-disjoint changes provably cannot interact, so the partitioning is sound.
    Real target analysis is less exact, which makes this baseline *optimistic*.
- **Queue suspects** (`queue_suspects`, fairness extension): a red batch whose culprits all appear
  in the failing-test suspects (probability `a_suspect` each) ejects them and retests the rest,
  instead of bisecting.
- **beanstalk** (the spec):
  1. **Placement** as above.
  2. **Commit:** a committer round lands every submitted change after a textual merge (group
     commit). A conflict sends the agent to re-execute on the new head. No tests run before
     landing.
  3. **Validation:** whenever unvalidated commits exist and a CI slot is free, the suite runs on
     the fast-trunk head, batching every new commit. A run whose tree has no unfixed bad commit
     (and does not flake) promotes green to that head.
  4. **Repair:** on red, each newly detected culprit gets a causal repair ticket.
     - With probability `a_suspect` = 0.7 the read/write-set suspects contain the culprit, so no
       CI is spent finding it.
     - Otherwise bisection runs: ceil(log2(span)) sequential CI runs, where span runs from the
       newest validation head below the culprit to the failing head. A flaky step mis-blames an
       innocent change.
     - Known culprits are masked when later runs are read: failing tests are attributed to known
       tickets.
     - A fixer repairs the culprit (r_fix), and the fix lands through the committer as a new
       version.
  5. **Error budget:** while open reds (detected, unfixed) exceed B = 3, or the oldest is older
     than A = 30 min, no new task starts; idle agents take fix tickets.
  6. **Snapshot:** tasks fork from the fast-trunk head (`snapshot=head`, the thesis's design).
     `snapshot=green` forks from the green commit, the thesis's answer to red-trunk poisoning.
- **beanstalk quarantine** (`green_mode=quarantine`, an extension, not the spec).
  - The prefix rule above cannot promote while any red is open anywhere below the head. At agent
    failure rates (~25% of changes are bad) that is almost always.
  - Quarantine promotes "head minus known culprits and every commit built on one (culprit in its
    base, sharing a module)". A confirmation run on the same head checks the culprits' removal.
  - This is the fast-trunk analogue of a queue's ejection.
- **beanstalk-noplace:** the fast trunk without placement. `batched+place`: placement on top of
  `batched`.

### Metrics (per run; `experiments.py` reports mean ± 95% CI over seeds)

| Metric | Definition |
|---|---|
| `green_per_h` (PRIMARY) | M / wall-clock to all-green |
| `steady_green_per_h` | Tasks turning green between the 10th and 90th percentile green times, per hour |
| `makespan_h` | Wall-clock until every task is green |
| `lat_p50_min`, `lat_p95_min` | Time from the agent finishing a task to that task being green |
| `busy/rework/blocked/idle_pct` and `*_agent_h` | Agent time: initial work; rework, fixes and investigation; bound but waiting (in a queue, or for a commit round); idle (`idle_placement_agent_h` and `idle_paused_agent_h` split out the placement and budget reasons) |
| `ci_min`, `ci_util_pct`, `ci_runs`, `ci_aborted` | Runner minutes, including cancelled runs |
| `conflicts`, `dissolved` | Textual conflicts met (each costs a rework); conflicts merge drivers removed |
| `reds`, `culprits`, `false_blames` | Red CI runs; bad change versions caught; innocent changes blamed by flakes |
| `max_red_age_min`, `mean_red_age_min` | Time a bad commit sat on the fast trunk before its fix landed (0 for queues: main is never red) |
| `green_staleness_min`, `green_gap_max_min` | Time-average of "minutes since green last advanced"; the longest such gap |

## What is calibrated and what is assumed

| Parameter | Default | Calibrated by `calibrate.py` from | Status in `default.json` |
|---|---|---|---|
| Module sets, files per module, module sizes, commutative modules, dissolvable ranks | parametric | corpus.jsonl | Assumed, tuned to public corpora |
| Zipf exponent s | 1.0 | step 1 overlap-class pair counts | Assumed |
| p_per_file / p_per_file_diss | 0.06 / 0.3 | step 1 pairs.jsonl (file-class pairs, per shared file) | Preliminary step-1 numbers (9-13% given a shared file) |
| p_file, p_module, p_disjoint, dissolvable_share | 0.11, 0.002, 0, 0.15 | step 1 summary.json | Literature: Xu et al. 84.4% of conflicted files are source |
| dependency_rate | 0.05 | step 1 summary.json | Assumed |
| q_sem | 0.01 | step 1 `semantic` (only if a check command ran) | Assumed; anchored on Uber (0.4-3.3%/pair) and Brun et al. (3-28% of merges); swept |
| Placement operating point (flag_recall, flag_clean) and `flag_points` | (0.60, 0.25) | step 2 pair_flagging.json: the lowest clean-flag rate within ±0.05 of conflict recall 0.60 over every title-only method, threshold, view and directory granularity; module-level = the best method at its tuned threshold; file and module oracles | Orchestrator's measured step-2 table |
| recall, precision; empirical predicted sets (module placement only) | 0.8, 0.6 | step 2 metrics.json, predictions.jsonl | Assumed |
| T, R, flake rate, p_self, work time, r_conf, r_fix, merge round | 10 min, N/10, 2%, 15%, 20 min, 0.3, 0.4, 10 s | not calibrated | Spec defaults / literature (see `sources`) |
| a_suspect, budget B and A, spec_depth, AIMD | 0.7, 3 and 30 min, 20, +1/halve | not calibrated | Thesis example, GitLab and Zuul defaults, assumption |

The literature's 41.7% cross-agent co-active pair conflict rate (Xu et al.), 19.8% intra-agent rate
and AgenticFlict's 27.67% per-PR rate are *upper scenarios*. They are rates for small repos where
co-active PRs nearly always share files. They are kept in `default.json` as `scenarios`, and
`experiments.py` runs `aidev-upper` as a regime.

## Fairness

- **Same world:** latent outcomes are hashes of (seed, task ids). All policies share tasks,
  footprints, work times, dependencies, conflict and semantic draws, and self-failures per version
  (asserted by a test). Seeds are therefore paired; ratios are reported per seed.
- **Same resources:** the same N agents, the same R slots and the same T. Beanstalk's validation,
  bisection and confirmation runs use the same slots as the queue's tests.
- **Same merge step:** the same mechanical merge cost per round and per change; merge drivers on
  for both.
- **A good queue, not a strawman:**
  - The queue speculates across its runners and bisects with speculative halves.
  - Ejected PRs keep their queue position, and in-flight conflicts are deferred instead of
    double-ejected.
  - Fairness rows add the partitioned queue, suspects-based ejection, released authors and AIMD.
    The kill-condition table compares Beanstalk with the best of all of them at each N.
- **Only green counts:** fast-trunk landings, conflicts and the budget gauge are reported but
  never scored.
- **Review is excluded from both policies.** Modelling it only for the queue would give
  Beanstalk an advantage the queue could also take by skipping review.
- **Beanstalk is not flattered:**
  - The spec-literal prefix promotion is the headline row; quarantine is labelled an extension.
  - The error budget is on in the headline.
  - Bisection costs real CI runs.
  - Flaky bisection blames innocents.
  - Fixes can fail again (p_self per version) and can conflict at commit.

## Findings on the default parameters (simulated)

All numbers below are simulated: 10 seeds per configuration, mean ± 95% CI. Every table is in
`out/default/results.md`. The default sweep is 2,550 runs and 316 CPU-minutes, about 20 min on 16
workers on a machine shared with other jobs.

**Primary metric** (green changes per hour):

| Policy | N=5 | N=20 | N=100 | N=500 | N=1000 |
|---|---|---|---|---|---|
| serial | 4.7 | 4.7 | 4.5 | 4.6 | 4.6 |
| batched k=4 (spec default) | 6.2 | 7.9 | 5.8 | 4.9 | 4.9 |
| batched k=1 (best linear queue) | 6.3 | 8.2 | 16.1 | 15.9 | 16.2 |
| batched-aimd | 6.2 | 8.3 | 10.1 | 9.4 | 9.3 |
| batched-par k=1 (best queue at N >= 100) | 6.4 | 8.7 | 23.0 | 20.5 | 20.8 |
| batched k=4 + suspects (best queue at N=20) | - | 13.5 | 13.5 | - | - |
| batched+place | 6.2 | 7.8 | 5.5 | 4.8 | 4.9 |
| **beanstalk** (spec) | **8.9** | **20.5** | **56.1** | **118.0** | **143.8** |
| beanstalk-noplace | 8.9 | 21.1 | 56.3 | 115.2 | 143.8 |
| beanstalk quarantine (extension) | - | 19.6 | 50.1 | - | 123.5 |
| **beanstalk / best queue** (paired) | **1.38x ± 0.12** | **1.50x ± 0.15** | **2.44x ± 0.12** | **5.76x ± 0.17** | **6.92x ± 0.13** |

1. **Kill condition (< 1.5x).**
   - Beanstalk falls short of 1.5x at N=5 (1.38x) and only just reaches it at N=20 (1.50x,
     CI 1.35-1.65).
   - From N=100 upwards it clears the bar (2.4x to 6.9x), on default parameters.
2. **The gain comes from not blocking, not from placement.**
   - `beanstalk-noplace` matches `beanstalk` within the CI at every N.
   - Every queue's landing rate is bounded by its head-of-line test: about 1/T times the length
     of a run of green units. So every queue plateaus at 5-23/h from N=100 upwards, while its
     agents sit 80-94% blocked.
   - Beanstalk agents never wait, and one validation run covers every new commit, using 3-17x
     fewer CI minutes.
3. **Placement helps throughput nowhere, even with the file oracle.**
   - Soft placement equals no placement at every N and every operating point.
   - Hard placement cuts textual conflicts 5-35x, but caps concurrency independently of N:

     | Signal (operating point) | Agents busy | Green/h |
     |---|---|---|
     | predicted-typical (0.60, 0.25) | ~11 | 24-27 from N=100 |
     | file-oracle (1.00, 0.05) | 18-20 | 41-47 |
     | hot-file rule (0.30, 0.02) | 21-25 | 49-58 |
     | module-level (0.90, 0.60) | ~5 | 12 |
     | module sets (the spec's model) | 1.9 at N=20 and N=100 | - |

     Module sets reproduce Cursor's "20 agents slow to the throughput of 1-3".
   - Recall 0.4-1.0 changes nothing: the clean-flag rate sets the cap, because a candidate among
     H held tasks is unflagged with probability (1 − clean)^H.
   - The rework that placement saves never pays for the concurrency it costs. The one positive:
     hard placement works as admission control for a batched queue (8.8 vs 5.5/h at N=100), but
     stays below k=1.
4. **Where Beanstalk loses or ties.**
   - **Small fleets:** 1.38x at N=5.
   - **Green freshness under the spec's prefix promotion.**
     - Green only advances to a fully clean fast-trunk prefix, and with ~25% of changes breaking
       that is rare.
     - At N=20, p50 done→green is 294 min against the queue's 100 min. Green is 198 min stale
       on average against 9 min, and the longest green gap is 7.5 h (40 h at N=1000; queues stay
       under 1.2 h).
     - Quarantine promotion (an extension) gives p50 of 115 / 147 / 461 min at N = 20 / 100 /
       1000 and 22-39 min staleness, for 4-14% less throughput. That is queue-level latency at
       N=20 and better from N=100.
   - **High semantic-break rates.**
     - At q_sem = 0.1 the lead shrinks to 1.5-1.8x.
     - At q_sem = 0.2 Beanstalk only ties the best queue at N=20 and N=100 (1.1x: 6.4 vs 5.7,
       8.9 vs 7.9/h).
     - At N=500 the spec's prefix promotion **livelocks**: 0.1/h, against the partitioned queue's
       7.4/h. All 10 runs stopped after green had not advanced for 500 simulated hours, because
       every fix broke against something that landed meanwhile. Quarantine survives at 7.3/h, a
       tie.
   - **CI capacity.**
     - With R fixed at 10 the lead at N=1000 falls to 1.43x (35.4 vs 24.7/h, CI 97% busy).
     - With plentiful CI at N=20 (R=10 instead of 2) the queue rises to 18.9/h and the lead is
       1.32x.
   - **The error budget only costs throughput in this model.**
     - Without it, throughput is 8% higher at N=100 and 24% higher at N=1000; the budget pauses
       agents for 846-3,953 min.
     - What it buys is bounded red age (466 vs 2,043 min at N=1000). That matters only if
       red-trunk poisoning is real, and poisoning is not modelled.
     - `snapshot=green` costs 4-11%.
5. **Queues.**
   - Batching hurts at agent failure rates, because P(batch green) falls as the batch grows.
     k=4 and k=16 collapse below k=1 from N=100 (5.8 and 3.4 vs 16.1/h), and AIMD settles at
     9-10/h.
   - Releasing authors adds nothing (16/h); it only lengthens latency (p50 1,655 min at N=100).
   - Failing-test suspects rescue k=4 when CI is scarce (13.5 vs 7.9/h at N=20).
   - Module partitioning (Uber/Aviator style) is the best queue from N=100 (+43% over linear
     k=1). It still plateaus near 21/h, because the hottest module (in 50% of changes) forms one
     dependency chain.
6. **Regimes at N=100 (Beanstalk / best queue):**
   - p_self 0.05: 2.2x;
   - p_self 0.30: 2.5x;
   - aidev-upper conflict rates: 1.7x;
   - 30-minute CI: 2.6x.

### Calibrated corpora (simulated, `--grid corpus`, 10 seeds)

`calibrate.py` was run on the finished step 1 and step 2 outputs. Simulated pair statistics against
step 1's measurements:

| Statistic | workers-sdk (sim / step 1) | codex (sim / step 1) | platform (sim / step 1) |
|---|---|---|---|
| Pairwise conflict rate | 0.96% / 1.20% | 1.16% / 1.56% | 5.19% / 5.87% |
| Per-change collision rate (W = 20) | 13.4% / 14.0% | 16.1% / 18.1% | 43.7% / 51.3% |

Calibrated values per corpus:

| | workers-sdk | codex | platform |
|---|---|---|---|
| P(conflict \| shared file) | 23% | 18% | 51% |
| Dependency rate | 13% | 17% | 49% |
| Measured title-only placement point (conflict recall, clean-flag rate) | (0.58, 0.17) | (0.56, 0.23) | (0.58, 0.22) |

Platform's results stay under `out/private/` and only aggregates appear here.

| Beanstalk / best queue (paired) | N=5 | N=20 | N=100 | N=500 | N=1000 |
|---|---|---|---|---|---|
| workers-sdk | 1.42x ± 0.07 | 1.70x ± 0.11 | 2.54x ± 0.26 | 6.58x ± 0.19 | 7.84x ± 0.20 |
| codex | 1.45x ± 0.08 | 1.62x ± 0.19 | 2.29x ± 0.25 | 5.92x ± 0.22 | 7.42x ± 0.22 |
| platform | 1.42x ± 0.08 | 1.66x ± 0.13 | 1.83x ± 0.13 | 3.02x ± 0.07 | 3.38x ± 0.13 |

The same pattern holds on real footprints and rates:
- **N=5:** below 1.5x everywhere.
- **N=20:** above the bar but within ~0.1-0.2 of it (codex's CI reaches down to 1.43x).
- **N ≥ 100:** a clear win.
  - Platform's higher conflict rate (51% given a shared file) and 49% dependency rate halve
    Beanstalk's large-N advantage.
  - Platform absolute throughput is 72/h at N=1000, against 135-151/h on the public corpora.
- **Placement at each corpus's measured operating point:**
  - soft placement equals no placement;
  - hard placement roughly halves throughput at N=100 (workers-sdk 30.6 vs 52.9/h, codex 25.2 vs
    51.1/h, platform 19.6 vs 40.5/h);
  - module-set placement collapses to 2.8-3.5/h.
- **At q_sem = 0.2 and N=100,** Beanstalk ties the partitioned queue:
  - workers-sdk 7.5 vs 7.5;
  - codex 9.0 vs 8.5;
  - platform 10.0 vs 7.8.

## Limitations

- **No red-trunk poisoning.**
  - A task that forks from a red head is not penalised beyond the latent pair draws against the
    culprit's later fix. `snapshot=green` is the conservative alternative and appears in the
    fairness rows.
  - The error budget's real benefit (limiting the damage of a red trunk) is therefore invisible
    here, and only its cost shows.
- **Semantic breaks are pairwise and independent.** At very high concurrency the number of
  co-active pairs per change grows, so q_sem compounds. That is plausible but untested;
  higher-order and transitive breaks are not modelled.
- **Placement is a pair-level coin.**
  - Flags are independent per pair, and the signal does not improve as a task's work becomes
    visible.
  - Semantic breaks are not flagged above the clean rate.
  - calibrate.py takes the best measured operating point across many methods, thresholds and
    granularities on step 2's evaluation slice, which is mildly optimistic.
  - In module-level placement the hottest module sits in ~50% of changes (codex-rs/core 46%,
    packages/wrangler 50%, the default model 50%).
- **The suspect model is a coin** (`a_suspect`).
  - Real read/write-set analysis may be better for self-failures and worse for semantic breaks.
  - The suspect set has no false positives here.
- **Bisection cost is approximated.** Beanstalk's bisection is sequential steps over a span. The
  queue's bisection is explicit units. Neither models smarter multi-culprit search.
- **The queue baselines are idealised in two ways.**
  - Target independence is exact at module level, which favours `batched-par`.
  - There is no merge-queue overhead beyond the merge round: no webhooks and no `merge_group`
    polling. Real queues are slower.
- **Not modelled:**
  - human review and approval latency (identical for both policies);
  - CI caching and test impact analysis: every run is the full suite of T minutes;
  - per-path isolation levels;
  - reservations and recipes;
  - reverts;
  - priorities beyond backlog order.
- **Work times are independent of the policy.** Agents do not get faster or slower with context.
  A Beanstalk fixer costs the same r_fix as the original author.
- **Agents are synthetic.** Step 4 (the race with real headless agents) tests whether they behave
  as assumed here.
