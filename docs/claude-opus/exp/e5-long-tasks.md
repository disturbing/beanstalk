# E5: does v2's lead over the queue survive longer tasks?

*E5 session, 2026-10-03. Input: `08` §5, `09` §1.3 point 8 and ideas 9-10, `10` §6, `research/arena/README.md`, `policy_beanstalk_preland.py`. Code and data: `research/exp/e5-long-tasks/`.*

**Naming (Coop's).** A **bean** is one agent's change in its workspace. The **sprout** is the staged line (the harness's `trunk`). The **stalk** is the stable line (the harness's `green`; for the queue, `main`). **v2** is `policy_beanstalk_v2.py` on `policy_beanstalk_preland.py` in optimistic mode (`10` §6). The **queue** is the batched, speculative, bisecting merge queue.

**Labels.** *measured*: taken from a real race or a real Claude session. *modelled*: produced by the emulated-drift knob, or by an assumption stated next to the number. Times are minutes since the race started. Every race here is one sample: v2's lead on the short-task baselines is 1.46x on one seed and 2.48x on the other (§3.2), which is the yardstick for what counts as a difference.

## 0. Verdict

**v2's lead over the queue shrinks when beans get about 7x longer, but v2 stays ahead at done and stops costing more.**

| Bean in the race | Queue / v2 time to done | v2 / queue cost | Greens (queue vs v2) |
|---|---|---|---|
| 17 s, native arena (S, two samples) | 1.46x and 2.48x | 1.20x and 1.37x | 37 vs 35 and 34 vs 34 of 40 |
| 30 s, 16 compound beans (A) | 2.15x | 1.14x | 13 vs 12 of 16 |
| **130 s, native arena (B, emulated drift x7)** | **1.32x** | **0.94x** | 36 vs 35 of 40 |
| **120 s, 16 compound beans (C, emulated drift x4)** | **1.40x** | **0.95x** | 13 vs 13 of 16 |

- **It shrinks in both structures, and the size is uncertain.** At 2-minute beans v2 reaches done at 22.6 against the queue's 29.7 min (native tasks, B) and 12.4 against 17.4 min (compounds, C), against 1.46x and 2.48x on the same 40 tasks at 17-s beans and 2.15x on the compounds at 30 s (2.5x if A's v2 is paired with the repeat queue run, A2). With one sample per cell I cannot separate the shrinkage from the queue's own seed spread (its done time on S moved from 16.5 to 34.7 min). What the data support: v2 was ahead at done in all five matched pairs (1.32-2.48x), and both structures lose lead with length.
- **The cost premium goes away on native beans.** v2 cost 20% and 37% more than the queue on S and 6% less on B ($4.33 against $4.61), because spreading the arrivals removes most of both policies' rework (v2 37 and 36 reworks on S, 19 on B; queue 30 and 30, then 21). On compounds the two queue samples (A $3.55, A2 $4.40) straddle v2's $4.04, so parity there is within noise at any length (C: v2 5% cheaper). v2 still spends **2.2-2.6x the test minutes** in B and C (2.2-4.0x across all cells).
- **Its early-green profile changes.** At 130 s beans v2 is behind the queue until about three quarters of the greens (queue / v2 = 0.59x at the 50% mark, 0.74x at 75%) and ahead at the tail (1.17x at 87%, 1.32x at done). v2 binds an agent to its task until the task lands (72 blocked against 139 busy agent-minutes in B; its 20th task starts at 4.7 min against the queue's 2.7), the likely cause; the race that would test it (v2r, §3.4) was cut off by the usage limit. On compounds (16 beans for 12 agents) v2 leads throughout (1.34x at 50%, 1.29x at 75%).
- **The mechanism the question presupposes is only half there.** A bean absorbs more landings while it is written (median 0-1 in the short races, 4-5.5 in B), but conflicts per race did not rise (queue 22-26 then 16; v2 16-21 then 14) and informed reworks fell (v2 16 and 20 on S, 5 on B; 8 on A, 2 on C). In S the queue's 40 beans were all started within 0.9 min, before the first landing at 1.2 min, so every one began on the pristine base and the queue was flooded (depth 37 of 40); longer beans spread the arrivals.

**Design implications (§5).** Observe-then-place discriminates where contention is sparse (lift 7-10x with 2-5% of clean pairs flagged, native beans at 130 s) and hardly at all where it is dense (lift 1.4-2.7x with 16-23% flagged, compounds); on short beans there is nothing to observe. Mid-flight invalidation notices can address only collisions whose partner lands while the affected bean is still being written: 0-18% of collision pairs on short beans, 11-12% on 120-s compounds, 33-34% on 130-s native beans, i.e. 5-18% of a race's spend at 2-minute beans (0-9% on short beans), and a notice would move a rework into a live session, not remove it. Two thirds to all of the collisions are decided after the author has finished, where v2's pre-land check already acts. The weaknesses worth fixing first are in that gate: agent binding during checks, rechecks that came back green 55 times in 64 (red 3 of 7 on dense compounds, 0 of 20 at 2-minute beans), and a rework budget that dense beans exhaust (4 of 16 dropped in A, 3 of 16 in C, no decision card fired) before a card can.

**Cost.** $35.14 of agent spend, under the $40 cap (§6).

## 1. The question and why the arena cannot answer it as built

The 40 arena tasks are short for Sonnet. **Measured over the four short Sonnet races** (`opus-queue-sonnet-12-landed`, `opus-v2fair-sonnet-12-s7`, and the seed-11 pair): one initial invocation has a median wall of **15.5-20.4 s** (p90 26-31 s, max 44 s), 9-10 turns and $0.05-0.07; a rework is the same (14-19 s). A task takes 3.4-4.8 min from start to green only because of the 60 s checks and CI around it, and the queue's backlog. The brief's "1-3 minutes" is that start-to-green time, not the time an agent spends writing.

Three consequences, all measured on the short runs (`overlap.py`, `runstats.py`):
- **Beans are in flight for seconds and the sprout barely moves under them.** Landings absorbed during a bean's first authoring: median 1 in v2 (p90 4), 0 in the queue. At most 12 beans are being written at once (mean 3-4), and **the five designed semantic pairs were never held on a common file at the same moment** (at most 1.1 s over all 20 pair-runs; in v2 they were never even being written together, in the queue 3-4 of 5 pairs overlapped for 2-12 s of two separate sessions). Anything that acts while two beans are still being written (idea 9, observe-then-place; idea 10, mid-flight invalidation notices) has nothing to act on.
- **The queue is a saturated server, not a slow one.** All 40 tasks arrive within a few minutes (12 PRs in the first 30 s) against a batch capacity of about 3.4 PRs/min (23 batches of 2.4 PRs in 16.5 min). Queue depth peaks at **37 of 40**; a PR waits a median **3.6-3.7 min** from enqueue to landing (p90 7-12 min) after a 15-18 s write. Much of v2's lead in the short races is the queue's backlog.
- **Rework is a large part of the bill and happens after the author has long finished.** In v2 31 of 35 conflict partners (and 18 of 31 informed-rework culprits) landed *after* the affected bean's first authoring had ended, while it sat in its pre-land check.

Real tasks last 10-30+ minutes against a 10-minute CI. The harness runs CI at 60 s, so the like-for-like session is **about 2 minutes** (two to three times the CI), which is **5-10x the measured 18 s**. That is the target. The expectation from the mechanism, written before any long race finished: spreading the arrivals should remove the queue's backlog (so v2's lead should shrink), while longer beans should raise drift, conflicts, rechecks and in-flight overlap for both policies. The first half held; the second half did not (§3.3).

## 2. Method

### 2.1 What I tried first, and what it showed

I probed one real Sonnet session at a time with the race harness's own Claude adapter (same flags, tools and prompt as a race's initial invocation; `probe_agent.py`; one session at a time, not a race; $0.87 in all). The machine was heavily loaded (1-minute load average 180-460 during the last three probes), which inflates wall times.

| Probe | Tickets in the bean | Wall | Turns | Output tokens | Cost | Files changed |
|---|---|---|---|---|---|---|
| t016 (single task) | 1 | 64 s | 12 | 1.7k | $0.070 | 2 |
| t026 (single task) | 1 | 20 s | 9 | 1.5k | $0.053 | 2 |
| P02 = t001 + t016 (pilot) | 2 | 37 s | 12 | 3.3k | $0.116 | 3 |
| P03 = t004 + t026 + t038 (pilot) | 3 | 25 s | 10 | 3.3k | $0.083 | 5 |
| P04 = t012 + t014 + t020 + t021 (pilot) | 4 | 25 s | 12 | 3.2k | $0.102 | 8 |
| **L02** = t002 + t007 + t019 (final) | 3 | 63 s | 27 | 7.7k | $0.182 | 14 |
| **L11** = t017 + t036 (final) | 2 | 50 s | 25 | 5.9k | $0.141 | 7 |
| **L08** = t011 + t021 + t037 (final) | 3 | 44 s | 19 | 5.4k | $0.124 | 12 |

All eight sessions passed their acceptance tests and the full suite. **Bundling lengthens a Sonnet session on this 46-file app by well under the number of tickets:** the final compounds took 44-63 s in the loaded probes and **27.5-30.7 s median in the quiet-machine races (§3.3)**, against 15-20 s for a single task, at twice the cost ($0.12-0.18 against $0.05-0.07). The floor is fixed overhead (start-up, reading, one or two test runs) plus about 5 s per 1,000 output tokens; the small pilot bundles (25-37 s) were barely longer than one task. Adding "write 8 edge-case tests and a docs page" (option b) would add about 3-5k output tokens, i.e. 15-30 s: also not 5-10x. **No arena-level construction of real work reaches 2 minutes per bean at 12 agents; the 5-10x has to come from the emulated drift (c).** Real work (a or b) decides what *else* changes besides time.

### 2.2 Choice: (a) compound tasks, with (c) emulated drift as the supplement

**Why (a) and not (b).**
- Ground truth is exact. A compound's acceptance tests are the *union of unchanged, already validated files*; its reference solution is the members' reference patches applied in order. Nothing the agent writes becomes part of the truth. In (b) the agent's own edge tests and docs would join the tree, the harness's landed-test protection (`--protect-tests landed`) restores only task-defined acceptance tests, so a later repair could weaken another bean's edge tests, and every agent-written test that touches shared behaviour (money format, totals, tax) would add uncontrolled semantic couplings to the five designed ones.
- It is cost-neutral: the same 40 tasks' worth of work, in fewer, bigger beans.
- It makes beans bigger the way real long tasks are bigger: more files, more modules, more hot-file edits.
- It validates mechanically (§2.4), and the replay agent can run it for free.

**What (a) does and does not give (measured, §2.4):** twice the files per bean (2.65 to 5.3), 2.5x the patch lines, 3.4 modules per bean, 69% of beans touching a hot file (was 42%), a pairwise conflict rate of 23% (was 7.4%) and 65% of pairs sharing a file (was 24%). **It does not give 5-10x time** (§2.1). The density rise is a side effect of bundling inside a 46-file app and is the main confound of (a).

**(c) separates the two effects.** The races form a 2 x 2 (§3.2): bean size (the 40 native tasks, or the 16 compounds) by bean length (as measured, or held to about 2 minutes by `--drift-factor`). B holds the native tasks to 7x (a 18 s session becomes about 130 s) and C holds the compounds to 4x (30 s becomes 120 s), so both have the same in-race bean length and differ only in structure.

### 2.3 Building the compounds (`plan_groups.py`, `build_long.py`)

16 compounds, 8 triples and 8 pairs of the 40 tasks (`arena-long/`, `groups/long16.json`). `plan_groups.py` is a seeded random-restart hill climb that maximises relatedness (shared source module, +1 each; shared non-hot file, +2 each) under hard constraints:
- members never conflict textually, except in `CHANGELOG.md` or `README.md` (union-resolvable);
- members are never a designed coupling, so all 10 designed couplings stay *between* beans;
- every designed **semantic** coupling must still "merge cleanly, then break tests" between the two compounds that hold its ends. A first plan failed this for 3 of 5 couplings because the bigger beans conflicted in text elsewhere and masked the semantic break; the constraint was added and the plan redone.

12 of 16 compounds have members that all share a source module; three (L04, L06, L12) are loosely related because the constraints leave no better partition. `build_long.py` applies the members' reference patches in order with `git apply --3way` (one `CHANGELOG.md` clash, L06, resolved by union), takes the union of acceptance tests, writes the numbered-ticket prompt, recomputes the oracle fields from the real diff and re-targets each member's coupling at the compound that holds its partner. Prompt: "Three related tickets in <theme> are being delivered together as one change", then each member ticket verbatim.

### 2.4 Ground truth, proved (`validate_long.py`; at most 4 node processes at once)

From the materialized repository (`materialize_long.py`, a copy of the arena's `materialize.py` that takes `--arena` and `tasks/*.json`); base `main` is the arena's, commit `26eecce0d7` (my rebuild of the 40-task repository has the same `main` and `ref/t001` commits as `research/corpora/arena.git`):

| Property | Result |
|---|---|
| Base suite | 80/80 pass |
| Each member's acceptance files fail on base | all 16 compounds, every member |
| Patch applies to a pristine base with `git apply`, touches no test file | all 16 |
| Branch `ref/Lxx` is one commit on `main`, diff = `oracle_paths`, acceptance files equal the JSON | all 16 |
| Base + patch + union of acceptance tests passes the full suite | all 16 (84-93 tests) |
| 5 designed **semantic** couplings: compounds merge cleanly (CHANGELOG/README by union) and the merged tree fails | all 5: L01+L02, L04+L12, L05+L11, L07+L14, L08+L12 |
| 5 designed **textual** couplings: compounds conflict in a source file | all 5: L01+L10, L03+L11, L04+L09, L06+L16, L07+L15 |
| The harness's own `--dry-run` (acceptance fails on base, solution passes, couplings) | `ok: true`, no problems |
| Free replay race (`--agent replay`, 8 agents, 1/10 time scale, through the machine slot) | queue and v2 (with `--drift-factor 3`, 26 drift events) both ended on a correct final green, no error event; only 5-6 of 16 compounds go green because replay agents cannot resolve a collision except by re-applying the reference patch, so it is a smoke test of the harness and the tasks, not a result |
| Real Sonnet sessions on 6 compounds (probes) | all pass their acceptance tests and the suite |
| `test_e5.py` (14 unit tests: overlap arithmetic, drift rule, verdict checker, the v2r agent rules, the compound arena's invariants) | pass |

Contention profile (all pairs, measured with `git merge-tree` and the suite; `data/long-profile.json`, `data/pairs.json`):

| | 40 single tasks | 16 compounds |
|---|---|---|
| Source files per bean (mean / median) | 2.65 / 2 | 5.31 / 5.5 |
| Modules per bean | 2.1 | 3.4 |
| Patch lines changed per bean (mean) | 19 | 47 |
| Beans touching a hot file | 42% | 69% |
| Prompt words (mean) | 74 | 233 |
| Pairs that conflict textually (plain / CHANGELOG+README by union) | 7.4% (58 of 780) / 4.6% | **23% (28 of 120) / 22%** |
| Pairs that share a file | 24% (189 of 780) | **65% (78 of 120)** |
| Pairs that merge cleanly but fail the suite | 5 designed + 2 natural | 5 designed + 1 natural (L04+L07, i.e. t005 x t032, the pair behind the only decision card of the short v2 race) |

### 2.5 Emulated drift (c) (`--drift-factor F`, in `race/harness/core.py`; 55 added lines, `harness-changes.diff`)

After an agent invocation (initial, rework or fixer) returns, the harness holds the result for `(F-1) x real wall` seconds with the agent slot busy, then continues. The sprout moves meanwhile exactly as if the same change had taken F times longer to write; nothing about the work, its cost or its content changes. Reworks are stretched too (a real long task takes a long time to repair). Events `invocation.drift` and `drift_seconds` on `invocation.end` record it; costs are the real ones.

**What it does not represent.** The agent never sees a moved tree while writing (a real agent does not either: it works in its own workspace until it submits), but its file touches all happen early in the stretched window. For the overlap log I therefore report both the touches as they happened and touches linearly stretched across the window ("modelled"); window-level overlap, landing times and submit times do not depend on that choice.

### 2.6 Races, instruments, rules

- **Settings (every real race):** Sonnet (`claude-sonnet-5-5`), 12 agents, seed 7, `--protect-tests landed --ci-seconds 60 --ci-slots 2 --max-wall-minutes 60 --budget-usd 20`; v2 adds `PRELAND_MODE=optimistic PRELAND_SECONDS=60 --snapshot head --error-budget 999` (decision cards: oracle `landed`, 30 s, the harness defaults); the queue adds `--batch 4 --no-queue-hold`. Turn cap (40) and per-invocation timeout (900 s) are the harness defaults, as in the baselines. `scripts/_race_inner.sh` holds the exact commands.
- **Slots.** Every race runs through `research/tools/race-slot.sh` (FIFO). Conditions A and A2 held one slot for a v2 and a queue race back to back so that both see the same machine (under 90 minutes). B and C were queued as two separate holds and, when the line moved, ran at the same time in both machine-wide slots for about 30 minutes; the coordinator asked for at most one slot at a time, so no hold started a further race after that (a stop flag in `scripts/spend.py`), the A2 hold, which had just started its queue race when the message arrived, ended after it, and the one later race (R, §3.4) went through the line alone. The order inside a pair alternated (A: v2 first; B: queue first; C: v2 first).
- **Void runs.** The 2026-10-03 Claude authentication outage (`API Error: 403 Request not allowed`, until about 15:20 HKT) arrives as an `is_error` result, not as a crash, and the harness counts it as a finished empty invocation (then reworks or drops the task). `scripts/check_run.py` gives every run a verdict: it flags `invocation.end` events with `is_error` or a non-null `infra_error` (a null value does not count), `invocation.retry` events, tasks dropped with "agent failed to run", and stream-json transcripts with `api_error_status`, `terminal_reason: api_error`, `is_api_error_message` or "Failed to authenticate" (an agent's own text mentioning 403 does not count). A run with any of these is kept as `<name>-void-<k>` and re-run; a rate-limit abort waits for the reset and re-runs. `scripts/preflight.py` makes a one-turn Sonnet call before each race (about $0.009) and waits up to 10 minutes for an outage to clear. **One run was void:** the v2r extra, cut off by the usage limit (§3.4). Every race in the tables has verdict CLEAN, and the short baselines (09:29-12:31 HKT) pass the same check. None of my paid races ran during the authentication outage.
- **Harness changes.** My copy of the harness differs from `research/race` as copied at 12:43 by three things (`harness-changes.diff`): the emulated-drift option (`--drift-factor`, plus load logging), E2's fix to `ci.py`, and the v2r policy (§3.4, a separate file). E2 found that v2's pre-land CI and the validation CI both name their worktrees `slot-N`, git de-duplicates the admin directories (`slot-01`, `slot-10`, `slot-111`, ...), and `CI.run` guessed the `index.lock` path from N, so one CI could delete the other's lock mid-run; the fix stores each slot's real git directory. I copied it at 17:10, after the first v2 race (`e5-long-v2`, condition A) and before any later one. That race shows no sign of the bug (no `error` event, all 39 pre-land checks and 11 CI runs have suite timings, no crashed suite, no red check with an empty failure list). The short baselines ran on the unfixed `ci.py` too.
- **Comparators:** `research/race/runs/opus-queue-sonnet-12-landed` and `opus-v2fair-sonnet-12-s7` (same seed and settings, 40 single tasks; budget 75 and wall cap 45 min instead of 20 and 60), plus the seed-11 pair as a measure of run-to-run variance.
- **Machine load:** the machine is shared with other experiments (1-minute load average 30-500 earlier in the day; 4-11 on average during my races, with peaks to 41). `uptime` is printed at the start and end of every race (`race/runs/e5-uptime.log`) and logged in `events.jsonl` (`race.start`, `race.end`, `load.sample` every 30 s); the table in the appendix reports it, and suite times show how much the load stretched the checks (median 0.5-1.2 s, p90 under 1.7 s in all my races). The short baselines did not log it; their suite times (0.6-0.9 s median) are in the same range.
- **Instruments:** `runstats.py`, `ratios.py` and `make_tables.py` (every table below is generated from the run directories), `race/kth_green.py` (time and money to the k-th green, unchanged), `overlap.py` (in-flight overlap from the stream-json transcripts: Read, Edit and Write paths with timestamps, related to conflicts, ejections and informed reworks), `timeline.py` (a text Gantt chart per race), `scripts/spend.py` (ledger and guard under the $40 cap).

## 3. Results

| Id | Tasks | Bean in the race (initial invocation, median) | What it isolates |
|---|---|---|---|
| **S** | 40 single arena tasks | 15.5-20.4 s, measured | the baseline, run earlier today: seed 7 and seed 11, both policies |
| **A** | 16 compounds | 29-31 s, measured | bigger beans (2x files, 23% of pairs conflicting) at short length |
| **A2** | the same, again | 27.5 s, measured | run-to-run noise at A (queue only: see §2.6) |
| **B** | 40 single tasks, every invocation held to 7x | 130-134 s (18.5-19.1 s real), modelled | longer beans at the arena's native contention |
| **C** | 16 compounds, every invocation held to 4x | 119 s (30 s real), modelled | bigger **and** longer beans |
| **R** | B again, with v2r | 130 s, modelled | v2 without agent binding: cut off by the usage limit, void (§3.4) |

### 3.1 The races

<!-- BEGIN:results -->
| run | policy | tasks | drift x | initial bean min (real / in race) | 50% green min / $ | 75% green min / $ | 87% green min / $ | done min | greens | rechecks / optimistic | conflicts | informed reworks | cards | red validations | cost $ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S: 40 singles, seed 7 / queue | queue | 40 | 1 | 0.3 / 0.3 | 5.2 / $3.03 | 10.4 / $3.98 | 15.5 / $4.42 | 16.5 | 37/40 | n/a (queue) | 26 | 30 reworks (ejections 26c/7r) | n/a | 7 | 4.42 |
| S: 40 singles, seed 7 / v2 | v2 | 40 | 1 | 0.3 / 0.3 | 7.3 / $4.79 | 9.7 / $5.21 | 11.3 / $5.29 | 11.3 | 35/40 | 12 / 31 | 21 | 16 | 1 | 1 | 5.29 |
| S: 40 singles, seed 11 / queue | queue | 40 | 1 | 0.3 / 0.3 | 4.2 / $2.65 | 20.5 / $3.77 | not reached | 34.7 | 34/40 | n/a (queue) | 22 | 30 reworks (ejections 22c/14r) | n/a | 14 | 4.10 |
| S: 40 singles, seed 11 / v2 | v2 | 40 | 1 | 0.3 / 0.3 | 9.4 / $5.32 | 10.9 / $5.54 | not reached | 14.0 | 34/40 | 25 / 29 | 16 | 20 | 1 | 2 | 5.62 |
| A: 16 compounds / queue | queue | 16 | 1 | 0.5 / 0.5 | 6.4 / $3.04 | 12.5 / $3.47 | not reached | 16.6 | 13/16 | n/a (queue) | 19 | 23 reworks (ejections 19c/7r) | n/a | 7 | 3.55 |
| A: 16 compounds / v2 | v2 | 16 | 1 | 0.5 / 0.5 | 6.8 / $4.04 | 7.7 / $4.04 | not reached | 7.7 | 12/16 | 7 / 10 | 14 | 8 | 0 | 3 | 4.04 |
| A2: 16 compounds, repeat / queue | queue | 16 | 1 | 0.5 / 0.5 | 9.4 / $3.24 | 19.6 / $4.40 | not reached | 19.6 | 12/16 | n/a (queue) | 16 | 20 reworks (ejections 16c/8r) | n/a | 8 | 4.40 |
| B: 40 singles, drift x7 / queue | queue | 40 | 7 | 0.3 / 2.2 | 6.7 / $1.49 | 12.5 / $3.06 | 23.8 / $4.30 | 29.7 | 36/40 | n/a (queue) | 16 | 21 reworks (ejections 16c/9r) | n/a | 9 | 4.61 |
| B: 40 singles, drift x7 / v2 | v2 | 40 | 7 | 0.3 / 2.2 | 11.5 / $1.78 | 16.9 / $3.78 | 20.3 / $4.21 | 22.6 | 35/40 | 14 / 30 | 14 | 5 | 1 | 2 | 4.33 |
| C: 16 compounds, drift x4 / queue | queue | 16 | 4 | 0.5 / 2.0 | 10.3 / $3.16 | 13.4 / $4.08 | not reached | 17.4 | 13/16 | n/a (queue) | 20 | 22 reworks (ejections 20c/5r) | n/a | 5 | 4.52 |
| C: 16 compounds, drift x4 / v2 | v2 | 16 | 4 | 0.5 / 2.0 | 7.7 / $3.65 | 10.4 / $4.29 | not reached | 12.4 | 13/16 | 6 / 8 | 18 | 2 | 0 | 0 | 4.29 |
<!-- END:results -->

<!-- BEGIN:outcome -->
| run | green / dropped | dropped because | reworks by cause | cost per green $ | test minutes (agent-side checks + CI) | agent minutes busy / blocked / idle |
|---|---|---|---|---|---|---|
| S: 40 singles, seed 7 / queue | 37 / 3 | ejected (conflict): 2; ejected (red): 1 | conflict 24, red 6 | 0.12 | 25.4 | 21.1 / 0.41 / 176.16 |
| S: 40 singles, seed 7 / v2 | 35 / 5 | declined by decision D001: 1; unresolved conflict: 4 | conflict 21, preland-red 16 | 0.15 | 102.1 | 24.08 / 84.81 / 26.76 |
| S: 40 singles, seed 11 / queue | 34 / 6 | ejected (conflict): 3; ejected (red): 3 | conflict 19, red 11 | 0.12 | 52.7 | 20.62 / 0.29 / 396.03 |
| S: 40 singles, seed 11 / v2 | 34 / 6 | declined by decision D001: 1; pre-land check still red: 2; reverted: 1; unresolved conflict: 2 | conflict 16, preland-red 20 | 0.17 | 114.6 | 26.07 / 102.7 / 39.64 |
| A: 16 compounds / queue | 13 / 3 | ejected (conflict): 1; ejected (red): 2 | conflict 18, red 5 | 0.27 | 18.3 | 15.11 / 0.25 / 184.08 |
| A: 16 compounds / v2 | 12 / 4 | pre-land check still red: 3; unresolved conflict: 1 | conflict 14, preland-red 8 | 0.34 | 50.5 | 15.27 / 39.66 / 37.81 |
| A2: 16 compounds, repeat / queue | 12 / 4 | ejected (conflict): 2; ejected (red): 2 | conflict 14, red 6 | 0.37 | 22.3 | 14.67 / 0.15 / 219.88 |
| B: 40 singles, drift x7 / queue | 36 / 4 | ejected (conflict): 2; ejected (red): 2 | conflict 14, red 7 | 0.13 | 43.4 | 151.26 / 0.47 / 204.89 |
| B: 40 singles, drift x7 / v2 | 35 / 5 | declined by decision D001: 1; pre-land check still red: 2; reverted: 1; unresolved conflict: 1 | conflict 14, preland-red 5 | 0.12 | 95.1 | 138.68 / 72.46 / 60.1 |
| C: 16 compounds, drift x4 / queue | 13 / 3 | ejected (conflict): 1; ejected (red): 2 | conflict 19, red 3 | 0.35 | 18.2 | 61.59 / 0.17 / 147.57 |
| C: 16 compounds, drift x4 / v2 | 13 / 3 | pre-land check still red: 2; unresolved conflict: 1 | conflict 18, preland-red 2 | 0.33 | 46.4 | 57.98 / 34.3 / 56.85 |
<!-- END:outcome -->

Time and money to the k-th green with `race/kth_green.py`, unchanged:

<!-- BEGIN:kth -->
**S: 40 singles, seed 7** (k = 20, 30, 35 of 40):

| run | policy | model | agents | 20th green min / $ | 30th green min / $ | 35th green min / $ | greens | total $ | wall min | red validations | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|
| opus-queue-sonnet-12-landed | queue | sonnet | 12 | 5.2 / 3.03 | 10.4 / 3.98 | 15.5 / 4.42 | 37 | 4.42 | 16.5 | 7 | True |
| opus-v2fair-sonnet-12-s7 | beanstalk (v2) | sonnet | 12 | 7.3 / 4.79 | 9.7 / 5.21 | 11.3 / 5.29 | 35 | 5.29 | 11.3 | 1 | True |

**S: 40 singles, seed 11** (k = 20, 30, 35 of 40):

| run | policy | model | agents | 20th green min / $ | 30th green min / $ | 35th green min / $ | greens | total $ | wall min | red validations | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|
| opus-queue-sonnet-12-s11 | queue | sonnet | 12 | 4.2 / 2.65 | 20.5 / 3.77 | not reached | 34 | 4.10 | 34.7 | 14 | True |
| opus-v2fair-sonnet-12-s11 | beanstalk (v2) | sonnet | 12 | 9.4 / 5.32 | 10.9 / 5.54 | not reached | 34 | 5.62 | 14.0 | 2 | True |

**A: 16 compounds** (k = 8, 12, 14, 16 of 16):

| run | policy | model | agents | 8th green min / $ | 12th green min / $ | 14th green min / $ | 16th green min / $ | greens | total $ | wall min | red validations | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| e5-long-queue | queue | sonnet | 12 | 6.4 / 3.04 | 12.5 / 3.47 | not reached | not reached | 13 | 3.55 | 16.6 | 7 | True |
| e5-long-v2 | beanstalk (v2) | sonnet | 12 | 6.8 / 4.04 | 7.7 / 4.04 | not reached | not reached | 12 | 4.04 | 7.7 | 3 | True |

**B: 40 singles, drift x7** (k = 20, 30, 35 of 40):

| run | policy | model | agents | 20th green min / $ | 30th green min / $ | 35th green min / $ | greens | total $ | wall min | red validations | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|
| e5-short-d7-queue | queue | sonnet | 12 | 6.7 / 1.49 | 12.5 / 3.06 | 23.8 / 4.30 | 36 | 4.61 | 29.7 | 9 | True |
| e5-short-d7-v2 | beanstalk (v2) | sonnet | 12 | 11.5 / 1.78 | 16.9 / 3.78 | 20.3 / 4.21 | 35 | 4.33 | 22.6 | 2 | True |

**C: 16 compounds, drift x4** (k = 8, 12, 14, 16 of 16):

| run | policy | model | agents | 8th green min / $ | 12th green min / $ | 14th green min / $ | 16th green min / $ | greens | total $ | wall min | red validations | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| e5-long-d4-queue | queue | sonnet | 12 | 10.3 / 3.16 | 13.4 / 4.08 | not reached | not reached | 13 | 4.52 | 17.4 | 5 | True |
| e5-long-d4-v2 | beanstalk (v2) | sonnet | 12 | 7.7 / 3.65 | 10.4 / 4.29 | not reached | not reached | 13 | 4.29 | 12.4 | 0 | True |
<!-- END:kth -->

### 3.2 The 2 x 2: v2's lead by bean size and bean length

<!-- BEGIN:twobytwo -->
Queue / v2 time ratios (above 1: v2 faster); cost is v2 / queue (above 1: v2 dearer). Several samples are listed in the order of the conditions.

| cell | samples | done: queue / v2 | 50% green | 75% green | cost: v2 / queue | greens: queue vs v2 |
|---|---|---|---|---|---|---|
| native singles, ~0.3 min beans (S) | 2 | 1.46 / 2.48 | 0.71 / 0.45 | 1.07 / 1.88 | 1.20 / 1.37 | 37 vs 35; 34 vs 34 (of 40) |
| compounds, ~0.5 min beans (A) | 1 | 2.15 | 0.94 | 1.62 | 1.14 | 13 vs 12 (of 16) |
| native singles, ~2 min beans (B) | 1 | 1.32 | 0.59 | 0.74 | 0.94 | 36 vs 35 (of 40) |
| compounds, ~2 min beans (C) | 1 | 1.40 | 1.34 | 1.29 | 0.95 | 13 vs 13 (of 16) |
<!-- END:twobytwo -->

<!-- BEGIN:lead -->
| condition | 50% green | 75% green | 87% green | done | total $ |
|---|---|---|---|---|---|
| S: 40 singles, seed 7 | 0.71 (5.25 / 7.35 min) | 1.07 (10.37 / 9.66 min) | 1.37 (15.46 / 11.31 min) | 1.46 (16.47 / 11.3 min) | 0.84 ($4.42 / $5.29) |
| S: 40 singles, seed 11 | 0.45 (4.21 / 9.4 min) | 1.88 (20.5 / 10.93 min) | n/r (n/r / n/r min) | 2.48 (34.74 / 14.03 min) | 0.73 ($4.1 / $5.62) |
| A: 16 compounds | 0.94 (6.42 / 6.83 min) | 1.62 (12.54 / 7.74 min) | n/r (n/r / n/r min) | 2.15 (16.62 / 7.73 min) | 0.88 ($3.55 / $4.04) |
| B: 40 singles, drift x7 | 0.59 (6.72 / 11.48 min) | 0.74 (12.52 / 16.88 min) | 1.17 (23.78 / 20.26 min) | 1.32 (29.72 / 22.6 min) | 1.06 ($4.61 / $4.33) |
| C: 16 compounds, drift x4 | 1.34 (10.33 / 7.7 min) | 1.29 (13.38 / 10.41 min) | n/r (n/r / n/r min) | 1.40 (17.44 / 12.43 min) | 1.05 ($4.52 / $4.29) |
<!-- END:lead -->

**Reading.**
- **Size alone does not hurt v2:** compounds at short length keep a 2.15x lead (A), and the queue's own run-to-run spread on those 16 compounds is 16.6 to 19.6 min (A and A2), i.e. 2.15x to 2.5x against A's v2.
- **Length shrinks the lead in both structures:** native 1.46x and 2.48x down to 1.32x; compounds 2.15x down to 1.40x. Both policies take longer in absolute terms because the writing is 7x longer: v2's done time for the same 40 tasks goes from 11.3 and 14.0 to 22.6 min, the queue's from 16.5 and 34.7 to 29.7 (inside its own seed spread).
- **The early greens tell a different story from done:** native beans at 130 s put the queue ahead until about three quarters of the greens (B: 0.59x, 0.74x); compounds at 120 s put v2 ahead throughout (C: 1.34x, 1.29x). The short races showed the same early-queue pattern (S: 0.71x and 0.45x at 50%) that v2's tail then overturned.
- **Noise.** One sample per cell except S. The queue's done time in S moved 16.5 to 34.7 min between seeds (14 red batches in the bad one); v2's moved 11.3 to 14.0. A ratio difference under about 0.5 is inside that spread.

### 3.3 What changes when beans get longer

<!-- BEGIN:flow -->
Bases: how many landed changes were already on a bean's base when it started (0 = the pristine base; a flood of beans written before anything lands). Staleness: landings between a bean's base and its own landing. Starts: minutes at which the 20th (or last, for 16 beans) and the final task started; greens: minute of the 20th (or all) green; agents: agent minutes busy / blocked (bound to a task that is waiting) / idle.

| run | beans | started on the pristine base | landings on the base at start (median / p90) | landings from base to own landing (median / p90) | task starts: 20th / last (min) | green: 20th (min) | agent min busy / blocked / idle |
|---|---|---|---|---|---|---|---|
| S: 40 singles, seed 7 / queue | 40 | 40 (100%) | 0 / 0 | 18 / 32 | 0.4 / 0.9 | 5.2 | 21.1 / 0.41 / 176.16 |
| S: 40 singles, seed 7 / v2 | 40 | 12 (30%) | 8.5 / 22 | 5 / 14 | 2.4 / 7.7 | 7.3 | 24.08 / 84.81 / 26.76 |
| S: 40 singles, seed 11 / queue | 40 | 40 (100%) | 0 / 0 | 16.5 / 29 | 0.4 / 0.8 | 4.2 | 20.62 / 0.29 / 396.03 |
| S: 40 singles, seed 11 / v2 | 40 | 12 (30%) | 8.5 / 22 | 6 / 11 | 2.5 / 9.1 | 9.4 | 26.07 / 102.7 / 39.64 |
| A: 16 compounds / queue | 16 | 16 (100%) | 0 / 0 | 6 / 10 | 0.4 / 0.4 | n/r | 15.11 / 0.25 / 184.08 |
| A: 16 compounds / v2 | 16 | 12 (75%) | 0 / 2 | 4.0 / 7 | 2.4 / 2.4 | n/r | 15.27 / 39.66 / 37.81 |
| A2: 16 compounds, repeat / queue | 16 | 16 (100%) | 0 / 0 | 5.5 / 9 | 0.4 / 0.4 | n/r | 14.67 / 0.15 / 219.88 |
| B: 40 singles, drift x7 / queue | 40 | 19 (47%) | 2 / 20 | 11.0 / 21 | 2.7 / 7.9 | 6.7 | 151.26 / 0.47 / 204.89 |
| B: 40 singles, drift x7 / v2 | 40 | 12 (30%) | 8.5 / 24 | 7.0 / 13 | 4.7 / 14.1 | 11.5 | 138.68 / 72.46 / 60.1 |
| C: 16 compounds, drift x4 / queue | 16 | 16 (100%) | 0 / 0 | 6 / 10 | 1.6 / 1.6 | n/r | 61.59 / 0.17 / 147.57 |
| C: 16 compounds, drift x4 / v2 | 16 | 12 (75%) | 0 / 2 | 4 / 8 | 3.3 / 3.3 | n/r | 57.98 / 34.3 / 56.85 |
<!-- END:flow -->

<!-- BEGIN:bean -->
| run | initial bean s (real med / in race med / in race p90) | rework in race s (med) | landings absorbed during first authoring (med / p90) | landings from start to own landing (med / p90) | submit to land s (med / p90) | submit to green s (med / p90) | queue max depth | agent min busy / blocked / idle | suite s (med / p90) | load avg 1 min at start / end |
|---|---|---|---|---|---|---|---|---|---|---|
| S: 40 singles, seed 7 / queue | 17.6 / 17.6 / 26.4 | 16.1 | 0 / 0 | 18 / 32.4 | 272.5 / 738.9 | 272.5 / 738.9 | 37 | 21.1 / 0.41 / 176.16 | 0.85 / 1.21 | not logged / not logged |
| S: 40 singles, seed 7 / v2 | 17.2 / 17.2 / 30.5 | 18.6 | 1 / 4 | 5 / 14.6 | 61.1 / 233.6 | 199.4 / 345.7 | - | 24.08 / 84.81 / 26.76 | 0.58 / 0.92 | not logged / not logged |
| S: 40 singles, seed 11 / queue | 15.5 / 15.5 / 25.9 | 14.1 | 0 / 0 | 16.5 / 29.7 | 214.7 / 1250.2 | 214.7 / 1250.2 | 37 | 20.62 / 0.29 / 396.03 | 0.87 / 1.38 | not logged / not logged |
| S: 40 singles, seed 11 / v2 | 20.4 / 20.4 / 30.7 | 18.5 | 0.5 / 4 | 6 / 11 | 93.6 / 278.8 | 180.5 / 364.7 | - | 26.07 / 102.7 / 39.64 | 0.72 / 1.35 | not logged / not logged |
| A: 16 compounds / queue | 29.1 / 29.1 / 39.4 | 19.2 | 0 / 0 | 6 / 10.8 | 351.2 / 723 | 351.2 / 723 | 14 | 15.11 / 0.25 / 184.08 | 0.86 / 1.66 | 6.22 / 12.54 |
| A: 16 compounds / v2 | 30.7 / 30.7 / 40.3 | 19.9 | 0 / 1.5 | 4 / 8.8 | 121.4 / 247.3 | 296.2 / 384.9 | - | 15.27 / 39.66 / 37.81 | 0.54 / 0.98 | 3.31 / 6.67 |
| A2: 16 compounds, repeat / queue | 27.5 / 27.5 / 42.3 | 21.3 | 0 / 0 | 5.5 / 9.9 | 222.5 / 815.3 | 222.5 / 815.3 | 14 | 14.67 / 0.15 / 219.88 | 0.67 / 1.01 | 7.17 / 6.41 |
| B: 40 singles, drift x7 / queue | 19.1 / 134.0 / 215.3 | 128.9 | 5.5 / 13 | 11 / 21.5 | 94.9 / 625.3 | 94.9 / 625.3 | 10 | 151.26 / 0.47 / 204.89 | 1.2 / 1.64 | 5.88 / 2.96 |
| B: 40 singles, drift x7 / v2 | 18.5 / 129.8 / 211.0 | 160.7 | 4 / 7 | 7 / 15 | 61.1 / 320.7 | 152.4 / 392.3 | - | 138.68 / 72.46 / 60.1 | 0.61 / 1 | 2.96 / 1.83 |
| C: 16 compounds, drift x4 / queue | 29.8 / 119.2 / 166.2 | 76.4 | 0.5 / 2 | 6 / 10.8 | 482.3 / 690.4 | 482.3 / 690.4 | 10 | 61.59 / 0.17 / 147.57 | 0.63 / 1.28 | 5.81 / 6.64 |
| C: 16 compounds, drift x4 / v2 | 29.9 / 119.4 / 161.7 | 72.3 | 1.5 / 3 | 4 / 10.4 | 121 / 404.6 | 181.7 / 465.4 | - | 57.98 / 34.3 / 56.85 | 0.54 / 0.78 | 6.83 / 2.58 |
<!-- END:bean -->

- **The queue was flooded in S, not in B.** In the short races 100% of the queue's 40 beans started on the pristine base (all within 0.9 min, the first landing came at 1.2 min) and each absorbed a median 16-18 landings before its own; at 130 s only 47% did and the median is 11. This is the likely reason *conflicts fell* with length (queue 22-26 to 16; v2 16-21 to 14) and why reworks fell (queue 30 to 21; v2 37 to 19). More drift per bean (landings absorbed during its first authoring: 0-1 in S, 4-5.5 in B) was outweighed by fewer beans written against the same stale base.
- **v2 binds agents.** In v2 an agent holds its task until the task has landed: through the 60 s pre-land check, every recheck, every wait for the committer. At 17-s beans that cost is invisible (the check is longer than the writing either way). At 130 s it is 72 blocked against 139 busy agent-minutes, the 20th task starts at 4.7 min against 2.7 and the last at 14.1 against 7.9, and the 20th green arrives at 11.5 min against 6.7. The queue (`--no-queue-hold`) releases its agent at enqueue. That this explains v2's slow early greens is an inference from the agent accounting, not a measured effect (§3.4).
- **The queue's tail is red batches and ejections, v2's is repeated rechecks and reworks of a few stubborn beans.** The queue's long races end with a few beans cycling through eject, rework, re-enqueue and a batch CI each time (queue's median submit-to-land wait: 95 s in B, 351 s in A, 482 s in C, with p90 625-723 s). v2's median submit-to-land is 61-121 s.
- **v2's checks mostly confirm.** Of 64 rechecks across the five v2 races, 55 came back green (86%); in B 14 of 14 and in C 6 of 6. A recheck costs 60 s of a runner and, as harnessed, 60 s of the agent.
- **Reworks cost more than the beans they repair.** A rework costs $0.06-0.14 against $0.05-0.12 for an initial invocation: 1.3-2.0x at 2-minute beans (B $0.11 against $0.056; C $0.134 against $0.10), and 42-65% of every race's spend is rework. The simulator's 0.3-0.4x is not close, as `09` §1 found for the first Haiku races.
- **Informed repair becomes rare.** Red pre-land checks answered by an informed rework fall from 16 and 20 (S) to 5 (B) and from 8 (A) to 2 (C): with arrivals spread out, fewer coupled beans are in flight together, so the semantic breaks the v2 mechanism was built for are met less often, while conflict reworks stay at 14-18 per race.
- **v2's test bill does not scale down with length:** 95 test minutes in B against the queue's 43, 46 against 18 in C, 50 against 18 in A, 102-115 against 25-53 in S.

<details><summary>Timelines of the four compound races (one row per bean)</summary>

```
e5-long-queue: 16 beans, 11 s per column, minutes since race start on the axis
     0    1    2     3    4    5     6    7     8    9    10    11   12    13   14   15    16   
 L01 aac.........wwc...................G                                                        
 L02 aaac...................wwwc..................wc....................wc....................G 
 L03 aaac...................wwwwc......wc...............................G                       
 L04 ac.....G                                                                                   
 L05 aac.........G                                                                              
 L06 ac.....G                                                                                   
 L07 aaac........wwc..............wwc........................wwwc.......X                       
 L08 aaac...................G                                                                   
 L09 ac..........G                                                                              
 L10 aac....wwc.............wwc........wwc....................................X                 
 L11 aaac...................wwc........wwc..............................wc...............X      
 L12 aac....wwc...................wwc..wc...............................G                       
 L13  aac........wwc...................G                                                        
 L14  aaac..................wwc...................G                                             
 L15  aac...................wwc........G                                                        
 L16   aac..................wwc........wc...............................G                       
      a authoring  w rework  c pre-land check / in queue  . waiting  L landed  G green  X dropped

e5-long-v2: 16 beans, 5 s per column, minutes since race start on the axis
     0          1           2          3           4          5           6           7         
 L01 aaaaaaacccccccccccccwwwccccccccccccwwwwwwwwwcccccccccccL.......................G           
 L02 aaaaaaaaccccccccccccccccccccccccwwwwwcccccccccccccwwwcccccccccccccwwwccccccccccccX         
 L03 aaaaaaaaccccccccccccccccccccccccwwwcccccccccccccwwwcccccccccccccwccccccccccccL...........G 
 L04 aaacccccccccccL...........G                                                                
 L05 aaaaaacccccccccccccccccccccccccwwwwcccccccccccccwwwwwwX                                    
 L06 aaaccccccccccccL..........G                                                                
 L07 aaaaaaccccccccccccccccccccccccwwwwwcccccccccccccwwwwccccccccccccX                          
 L08 aaaaaaacccccccccccccccccccccccL................................................G           
 L09 aaaacccccccccccccccccccccccL...........G                                                   
 L10 aaaaaaccccccccccccwwwwwwwcccccccccccccwwccccccccccccX                                      
 L11 aaaaaaccccccccccccL...................G                                                    
 L12 aaaacccccccccccccwwwwwccccccccccccL............................................G           
 L13               aaaaccccccccccccL................................................G           
 L14                aaaacccccccccccccwccccccccccccL.................................G           
 L15                   aaaaaaccccccccccccccccccccccccwwwwwwcccccccccccL.............G           
 L16                            aaaaacccccccccccL...................................G           
      a authoring  w rework  c pre-land check / in queue  . waiting  L landed  G green  X dropped

e5-long-d4-queue: 16 beans, 12 s per column, minutes since race start on the axis
     0    1    2    3    4    5    6     7    8    9    10   11   12   13    14   15   16   17  
 L01 aaaaaaaaaaac....wwwwwwwc.............................G                                     
 L02 aaaaaaaaaaaaaaaac...............wwwwwwwwwc.....................wwwwwcwwwc................G 
 L03 aaaaaaaaaaaaaaaac...............wwwwwwwwwwwwwwwc.....wwwc...........G                      
 L04 aaaaaac....G                                                                               
 L05 aaaaaaaaaac.....G                                                                          
 L06 aaaaaac....G                                                                               
 L07 aaaaaaaaaaaac...wwwwwwwwwwc.....................wwwwwwwwwwc.........wwwwwwwwwwwwwwwwwc...X 
 L08 aaaaaaaaaaac....................G                                                          
 L09 aaaaaac.........G                                                                          
 L10 aaaaaaaaaaacwwwwwwc.............wwwwwwwwc............wwwwwwc..............X                
 L11 aaaaaaaaaaac...............wwwwwwwc..................wwwwwwwc.......wwwwc...........X      
 L12 aaaaaaaac..wwwwwc.........................wwwwwwwwwwcwwwwc..........G                      
 L13       aaaaac....wwwwwc...............................G                                     
 L14       aaaaaaaaaac...............wwwwwwwwc......................G                           
 L15       aaaaaaaaaac..............................G                                           
 L16         aaaaaaacwwwwc...........................wwwc................G                      
      a authoring  w rework  c pre-land check / in queue  . waiting  L landed  G green  X dropped

e5-long-d4-v2: 16 beans, 8 s per column, minutes since race start on the axis
     0      1      2      3      4       5      6      7      8      9       10     11     12   
 L01 aaaaaaaaaaaaaaaaacccccccL.............G                                                    
 L02 aaaaaaaaaaaaaaaaaaaacccccccccwwwwwwwwwwwwwwwwwwwwwwwwwccccccccc....wwwwwwwwcccccccL......G 
 L03 aaaaaaaaaaaaaaaaaaaaaaaaawwwwwwwwcccccccL.......G                                          
 L04 aaaaaaaaacccccccL......G                                                                   
 L05 aaaaaaaaaaaaaacccccccccccccccwwwwwccccccccwwwwwwwwwwcccccccccwwwwwwwccccccccX              
 L06 aaaaaaaaacccccccL......G                                                                   
 L07 aaaaaaaaaaaaaaaaaaccccccccwwwwwwwwwwwwwwwwwwwwwwwwwwwwwccccccccX                           
 L08 aaaaaaaaaaaaaaacccccccL........G                                                           
 L09 aaaaaaaaacccccccccccccccL......G                                                           
 L10 aaaaaaaaaaaaaaccccccccwwwwwwwwwwwwwwwwwwwwccccccccwwwwwwwwX                                
 L11 aaaaaaaaaaaaaaaaacccccccccccccccwwwwwwcccccccccccccccccccccccccccccL.......G               
 L12 aaaaaaaaaaaccccccccwwwwwwwwwwwwwwwwwwwwwwwwwwcccccccL.......G                              
 L13                 aaaaaaaaccccccccwwwwccccccccwwwccccccccL......G                            
 L14                 aaaaaaaaaaaaaaaaaawwwwwwwwwwwwwwwwwwcccccccL.......G                       
 L15                       aaaaaaaaaaaaacccccccL............G                                   
 L16                         aaaaaaaaaaccccccccL......G                                         
      a authoring  w rework  c pre-land check / in queue  . waiting  L landed  G green  X dropped
```

</details>

<!-- BEGIN:v2int -->
| run | pre-land checks (red) | rechecks (green / red outcome) | optimistic landings of landings | locked fallbacks | checks per landing | pre-land check minutes | revert-first |
|---|---|---|---|---|---|---|---|
| S: 40 singles, seed 7 / v2 | 83 (17) | 12 (10 / 2) | 31 of 35 | 1 | 2.37 | 83.9 | 1 |
| S: 40 singles, seed 11 / v2 | 94 (23) | 25 (21 / 4) | 29 of 35 | 2 | 2.69 | 95.4 | 1 |
| A: 16 compounds / v2 | 39 (11) | 7 (4 / 3) | 10 of 12 | 0 | 3.25 | 39.4 | 1 |
| B: 40 singles, drift x7 / v2 | 64 (8) | 14 (14 / 0) | 30 of 36 | 2 | 1.78 | 64.7 | 1 |
| C: 16 compounds, drift x4 / v2 | 33 (4) | 6 (6 / 0) | 8 of 13 | 1 | 2.54 | 33.3 | 0 |
<!-- END:v2int -->

<!-- BEGIN:qint -->
| run | batches green / red / cancelled | ejections conflict / red | bisect CI runs | PRs held behind in-flight conflicts | reworks | CI minutes |
|---|---|---|---|---|---|---|
| S: 40 singles, seed 7 / queue | 13/7/3 | 26 / 7 | 5 | 10 | 30 | 25.39 |
| S: 40 singles, seed 11 / queue | 8/14/6 | 22 / 14 | 24 | 15 | 30 | 52.73 |
| A: 16 compounds / queue | 5/7/0 | 19 / 7 | 6 | 9 | 23 | 18.29 |
| A2: 16 compounds, repeat / queue | 7/8/0 | 16 / 8 | 7 | 12 | 20 | 22.26 |
| B: 40 singles, drift x7 / queue | 16/9/4 | 16 / 9 | 14 | 9 | 21 | 43.37 |
| C: 16 compounds, drift x4 / queue | 8/5/0 | 20 / 5 | 5 | 11 | 22 | 18.22 |
<!-- END:qint -->

### 3.4 v2r: v2 without agent binding (an extra race, cut off)

v2 as harnessed binds an agent to its task until the task lands (§3.3). I wrote `policy_beanstalk_v2r.py`, which releases the agent when the initial invocation finishes and takes one again only for a rework invocation (a rework waits for a free agent; no new task starts while one waits), and ran it once on B's setting (condition R). It passed a free replay smoke test (25 of 40 green, 18 agent re-acquisitions) and then **hit the usage limit at 11.7 minutes** ("You've hit your session limit", reset 20:40 HKT) with 17 of 40 beans green; the check flagged the run and it is **void** (`race/runs/e5-short-d7-v2r-void-1`, $4.52). It was not re-run: the hold's spend guard refused ($35.14 spent, $5.50 expected for another race, against a $39 line) and, after the limit reset, the coordinator asked me to skip optional extras. It is not a result. What the first 11.7 minutes do show, as facts about those minutes only: the 20th task started at 2.3 min (v2 in B: 4.7; queue: 2.7), agents were almost never blocked (0.13 blocked against 139.8 busy agent-minutes; v2 in B: 72.5 against 138.7), and 24 reworks waited 1,009 s in all for an agent (longest 239 s), so releasing the agent moves the wait from the bean to the rework. Whether that is a net gain is the first thing to run next (§7).

## 4. In-flight overlap

How many beans were working on the same files at the same time, from the agents' tool-call transcripts (stream-json `Read`, `Edit`, `Write` paths with timestamps; Grep and Glob hits and Bash reads are not attributed, so these are lower bounds). A bean *holds* a file from its first touch of it to the end of that agent invocation; two beans overlap when they hold the same source file (tests and `CHANGELOG.md` excluded) at the same moment. The drifted runs are shown twice: touches as they happened (early in the held window) and modelled (stretched across it).

<!-- BEGIN:overlap -->
| run | beans | authoring window s (median) | beans authoring at once (peak / mean) | pairs whose authoring windows overlap | pairs that touched a common source file | both | same file held at the same moment | same file edited at the same moment | peers per bean (median / max) | designed semantic pairs overlapping in flight |
|---|---|---|---|---|---|---|---|---|---|---|
| S: 40 singles, seed 7 / queue | 40 | 17.6 | 12 / 4.13 | 378 of 780 | 133 | 72 | 38 | 31 | 1.0 / 7 | 4 of 5 |
| S: 40 singles, seed 7 / v2 | 40 | 17.2 | 12 / 3.19 | 179 of 780 | 195 | 80 | 38 | 28 | 1.0 / 8 | 0 of 5 |
| S: 40 singles, seed 11 / queue | 40 | 15.5 | 12 / 2.93 | 373 of 780 | 130 | 72 | 37 | 24 | 1.0 / 7 | 3 of 5 |
| S: 40 singles, seed 11 / v2 | 40 | 20.4 | 12 / 3.43 | 178 of 780 | 204 | 82 | 50 | 45 | 1.0 / 10 | 0 of 5 |
| A: 16 compounds / queue | 16 | 29.1 | 12 / 3.75 | 111 of 120 | 53 | 51 | 38 | 34 | 4.5 / 9 | 5 of 5 |
| A: 16 compounds / v2 | 16 | 30.7 | 12 / 3.6 | 90 of 120 | 66 | 57 | 33 | 30 | 5.0 / 8 | 5 of 5 |
| A2: 16 compounds, repeat / queue | 16 | 27.5 | 12 / 3.45 | 111 of 120 | 51 | 50 | 37 | 29 | 4.5 / 10 | 5 of 5 |
| B: 40 singles, drift x7 / queue [modelled: touches stretched with the session] | 40 | 134.0 | 12 / 5.64 | 394 of 780 | 132 | 83 | 49 | 34 | 1.0 / 9 | 2 of 5 |
| B: 40 singles, drift x7 / queue [touches as they happened] | 40 | 134.0 | 12 / 5.64 | 394 of 780 | 132 | 83 | 71 | 65 | 3.0 / 13 | 2 of 5 |
| B: 40 singles, drift x7 / v2 [modelled: touches stretched with the session] | 40 | 129.8 | 12 / 6.43 | 280 of 780 | 129 | 66 | 33 | 25 | 1.0 / 8 | 2 of 5 |
| B: 40 singles, drift x7 / v2 [touches as they happened] | 40 | 129.8 | 12 / 6.43 | 280 of 780 | 129 | 66 | 50 | 46 | 1.5 / 12 | 2 of 5 |
| C: 16 compounds, drift x4 / queue [modelled: touches stretched with the session] | 16 | 119.2 | 12 / 3.97 | 111 of 120 | 55 | 53 | 38 | 34 | 5.0 / 9 | 5 of 5 |
| C: 16 compounds, drift x4 / queue [touches as they happened] | 16 | 119.2 | 12 / 3.97 | 111 of 120 | 55 | 53 | 50 | 48 | 7.0 / 11 | 5 of 5 |
| C: 16 compounds, drift x4 / v2 [modelled: touches stretched with the session] | 16 | 119.4 | 12 / 5.71 | 102 of 120 | 47 | 44 | 29 | 28 | 3.5 / 8 | 5 of 5 |
| C: 16 compounds, drift x4 / v2 [touches as they happened] | 16 | 119.4 | 12 / 5.71 | 102 of 120 | 47 | 44 | 39 | 38 | 5.0 / 9 | 5 of 5 |
<!-- END:overlap -->

- **At native contention, longer beans overlap about as before; compounds overlap a lot at any length.** Pairs holding the same source file at the same moment: 37-50 of 780 in S, 33-49 in B (modelled; 50-71 as it happened); 33-38 of 120 in A and A2, 29-38 in C (modelled; 39-50 as it happened). Peers per bean (median): 1 for native singles (1-3 in B), 3.5-7 for compounds. The reason is the arena, not the clock: 24% of native pairs share a file and 65% of compound pairs do.
- **The designed semantic pairs are in flight together whenever beans are bigger:** 5 of 5 pairs have overlapping authoring windows in A and C (12-51 s real in A, 69-239 s held in C), against 0 of 5 in v2 and 3-4 of 5 in the queue in S, and 2 of 5 in B. In A under v2, L01 and L02 were being written together for 51 s and held common files for 56 s (summed over files) before landing in that order.

### 4.1 Who collided with whom, and when the other bean landed

Every textual conflict, queue ejection and informed rework is paired with the landed change(s) it collided with. The phase says when that change landed relative to the affected bean: *before start* (already in its base: no drift involved), *during its first authoring* (a live session existed: a mid-flight notice could have reached it), or *after* (it was waiting in a queue, a pre-land check or a rework: only the gate acts).

<!-- BEGIN:notice -->
Pooled over textual conflicts, queue ejections and informed reworks (event-partner pairs). Rework $ is what the rework invocations that answered those collisions cost; the share is of the run's total spend. The drifted runs use the modelled lead (touches stretched with the session); landing and submit times are measured.

| run | collision pairs | partner landed before the bean started | partner landed during its first authoring | partner submitted (diff visible) during its first authoring | rework $ answering those collisions: during / after / before start | share of spend answering a collision whose partner landed during authoring |
|---|---|---|---|---|---|---|
| S: 40 singles, seed 7 / queue | 70 | 0 | 0 (0%) | 27 (39%) | 0.00 / 2.02 / 0.00 | 0% |
| S: 40 singles, seed 7 / v2 | 66 | 5 | 12 (18%) | 13 (20%) | 0.50 / 2.00 / 0.25 | 9% |
| S: 40 singles, seed 11 / queue | 46 | 0 | 0 (0%) | 18 (39%) | 0.00 / 1.13 / 0.00 | 0% |
| S: 40 singles, seed 11 / v2 | 59 | 11 | 8 (14%) | 14 (24%) | 0.45 / 1.72 / 0.47 | 8% |
| A: 16 compounds / queue | 30 | 0 | 0 (0%) | 22 (73%) | 0.00 / 1.33 / 0.00 | 0% |
| A: 16 compounds / v2 | 39 | 0 | 1 (3%) | 27 (69%) | 0.02 / 2.08 / 0.00 | 0% |
| A2: 16 compounds, repeat / queue | 25 | 0 | 0 (0%) | 14 (56%) | 0.00 / 2.01 / 0.00 | 0% |
| B: 40 singles, drift x7 / queue | 39 | 0 | 13 (33%) | 22 (56%) | 0.47 / 1.21 / 0.00 | 10% |
| B: 40 singles, drift x7 / v2 | 35 | 2 | 12 (34%) | 12 (34%) | 0.79 / 1.23 / 0.06 | 18% |
| C: 16 compounds, drift x4 / queue | 35 | 0 | 4 (11%) | 24 (69%) | 0.25 / 2.31 / 0.00 | 5% |
| C: 16 compounds, drift x4 / v2 | 32 | 0 | 4 (12%) | 14 (44%) | 0.42 / 2.26 / 0.00 | 10% |
<!-- END:notice -->

<details><summary>Full attribution by kind of collision</summary>

<!-- BEGIN:collide -->
Each textual conflict, queue ejection and informed rework is paired with the landed change(s) it collided with. Phase = when that change landed relative to the affected bean: **before start** (already in its base: no drift), **during authoring** (a live session existed: a mid-flight notice could have reached it), **after authoring** (the bean was waiting in a queue, a pre-land check or a rework: only the gate acts). Counts are event-partner pairs; cost is the rework invocation each event triggered, split across its partners.

| run | kind | events | pairs | before start | during authoring | after authoring | partner submitted during authoring | rework $ (during / after) | pairs observable before the bean's first end | median lead s |
|---|---|---|---|---|---|---|---|---|---|---|
| S: 40 singles, seed 7 / queue | conflict | 26 | 70 | 0 | 0 | 70 | 27/70 | 0 / 2.016 | 65/70 | 7.7 |
| S: 40 singles, seed 7 / v2 | conflict | 21 | 35 | 0 | 4 | 31 | 9/35 | 0.104 / 1.325 | 19/35 | 9.0 |
| S: 40 singles, seed 7 / v2 | informed-red | 16 | 31 | 5 | 8 | 18 | 4/31 | 0.393 / 0.674 | 5/31 | 9.0 |
| S: 40 singles, seed 11 / queue | conflict | 22 | 46 | 0 | 0 | 46 | 18/46 | 0 / 1.126 | 43/46 | 8.1 |
| S: 40 singles, seed 11 / v2 | conflict | 16 | 20 | 0 | 2 | 18 | 10/20 | 0.194 / 0.973 | 16/20 | 9.1 |
| S: 40 singles, seed 11 / v2 | informed-red | 20 | 39 | 11 | 6 | 22 | 4/39 | 0.255 / 0.746 | 12/39 | 9.1 |
| A: 16 compounds / queue | conflict | 19 | 30 | 0 | 0 | 30 | 22/30 | 0 / 1.335 | 30/30 | 14.4 |
| A: 16 compounds / v2 | conflict | 14 | 23 | 0 | 1 | 22 | 14/23 | 0.02 / 1.167 | 16/23 | 12.7 |
| A: 16 compounds / v2 | informed-red | 8 | 16 | 0 | 0 | 16 | 13/16 | 0 / 0.91 | 6/16 | 12.7 |
| A2: 16 compounds, repeat / queue | conflict | 16 | 25 | 0 | 0 | 25 | 14/25 | 0 / 2.009 | 22/25 | 12.9 |
| B: 40 singles, drift x7 / queue [modelled: touches stretched with the session] | conflict | 16 | 39 | 0 | 13 | 26 | 22/39 | 0.471 / 1.209 | 35/39 | 78.4 |
| B: 40 singles, drift x7 / queue [touches as they happened] | conflict | 16 | 39 | 0 | 13 | 26 | 22/39 | 0.471 / 1.209 | 35/39 | 181.3 |
| B: 40 singles, drift x7 / v2 [modelled: touches stretched with the session] | conflict | 14 | 25 | 0 | 10 | 15 | 9/25 | 0.659 / 0.969 | 18/25 | 68.2 |
| B: 40 singles, drift x7 / v2 [modelled: touches stretched with the session] | informed-red | 5 | 10 | 2 | 2 | 6 | 3/10 | 0.132 / 0.264 | 3/10 | 68.2 |
| B: 40 singles, drift x7 / v2 [touches as they happened] | conflict | 14 | 25 | 0 | 10 | 15 | 9/25 | 0.659 / 0.969 | 19/25 | 178.8 |
| B: 40 singles, drift x7 / v2 [touches as they happened] | informed-red | 5 | 10 | 2 | 2 | 6 | 3/10 | 0.132 / 0.264 | 3/10 | 178.8 |
| C: 16 compounds, drift x4 / queue [modelled: touches stretched with the session] | conflict | 20 | 35 | 0 | 4 | 31 | 24/35 | 0.247 / 2.308 | 34/35 | 50.5 |
| C: 16 compounds, drift x4 / queue [touches as they happened] | conflict | 20 | 35 | 0 | 4 | 31 | 24/35 | 0.247 / 2.308 | 35/35 | 112.5 |
| C: 16 compounds, drift x4 / v2 [modelled: touches stretched with the session] | conflict | 18 | 28 | 0 | 3 | 25 | 11/28 | 0.35 / 1.968 | 22/28 | 47.7 |
| C: 16 compounds, drift x4 / v2 [modelled: touches stretched with the session] | informed-red | 2 | 4 | 0 | 1 | 3 | 3/4 | 0.072 / 0.288 | 2/4 | 47.7 |
| C: 16 compounds, drift x4 / v2 [touches as they happened] | conflict | 18 | 28 | 0 | 3 | 25 | 11/28 | 0.35 / 1.968 | 26/28 | 108.8 |
| C: 16 compounds, drift x4 / v2 [touches as they happened] | informed-red | 2 | 4 | 0 | 1 | 3 | 3/4 | 0.072 / 0.288 | 2/4 | 108.8 |
<!-- END:collide -->

</details>

- **Most collisions do not involve a change that landed during the affected bean's first authoring** (82-100% in S, A and C; 66-67% in B; the rest landed after the author had finished, or were already in the bean's base). At 130 s beans a third of the pairs (13 of 39 in the queue, 12 of 35 in v2) are with a change that landed while the session was still running.
- **What those cost:** the rework invocations that answered a during-authoring collision cost $0.47 (queue) and $0.79 (v2) in B, 10% and 18% of the races' spend; 0-10% in S, A and C. That is the ceiling for what a mid-flight notice could save, and a notice would not remove the rework, only move it into a live session.
- **A bean's diff is visible earlier than its landing:** the partner had *submitted* during the affected bean's first authoring in 34-73% of collision pairs in A, B and C, but the lead is short for real work (median 13-14 s in A) and long only in the modelled runs (48-78 s in B and C).

### 4.2 Would watching reads and edits have predicted the collisions? (observe-then-place)

Rules: *hold overlap* = both held the same source file at the same moment; *edit overlap* = both edited it at the same moment; *window and file* = their authoring windows overlapped and they touched a common source file.

<!-- BEGIN:flag -->
Pair rule over all pairs of beans; a pair "collided" if a textual conflict, an ejection or an informed rework involved both.

| run | collided pairs of all | rule | pairs flagged | precision | recall | lift | clean pairs flagged |
|---|---|---|---|---|---|---|---|
| S: 40 singles, seed 7 / queue | 54 of 780 | hold_overlap | 38 | 0.395 | 0.278 | 5.7 | 0.032 |
| S: 40 singles, seed 7 / queue | 54 of 780 | edit_overlap | 31 | 0.387 | 0.222 | 5.59 | 0.026 |
| S: 40 singles, seed 7 / queue | 54 of 780 | window_and_file | 72 | 0.389 | 0.519 | 5.62 | 0.061 |
| S: 40 singles, seed 7 / v2 | 52 of 780 | hold_overlap | 38 | 0.237 | 0.173 | 3.55 | 0.04 |
| S: 40 singles, seed 7 / v2 | 52 of 780 | edit_overlap | 28 | 0.25 | 0.135 | 3.75 | 0.029 |
| S: 40 singles, seed 7 / v2 | 52 of 780 | window_and_file | 80 | 0.225 | 0.346 | 3.38 | 0.085 |
| S: 40 singles, seed 11 / queue | 37 of 780 | hold_overlap | 37 | 0.297 | 0.297 | 6.27 | 0.035 |
| S: 40 singles, seed 11 / queue | 37 of 780 | edit_overlap | 24 | 0.333 | 0.216 | 7.03 | 0.022 |
| S: 40 singles, seed 11 / queue | 37 of 780 | window_and_file | 72 | 0.292 | 0.568 | 6.15 | 0.069 |
| S: 40 singles, seed 11 / v2 | 41 of 780 | hold_overlap | 50 | 0.18 | 0.22 | 3.42 | 0.055 |
| S: 40 singles, seed 11 / v2 | 41 of 780 | edit_overlap | 45 | 0.178 | 0.195 | 3.38 | 0.05 |
| S: 40 singles, seed 11 / v2 | 41 of 780 | window_and_file | 82 | 0.195 | 0.39 | 3.71 | 0.089 |
| A: 16 compounds / queue | 23 of 120 | hold_overlap | 38 | 0.447 | 0.739 | 2.33 | 0.216 |
| A: 16 compounds / queue | 23 of 120 | edit_overlap | 34 | 0.471 | 0.696 | 2.46 | 0.186 |
| A: 16 compounds / queue | 23 of 120 | window_and_file | 51 | 0.412 | 0.913 | 2.15 | 0.309 |
| A: 16 compounds / v2 | 33 of 120 | hold_overlap | 33 | 0.394 | 0.394 | 1.43 | 0.23 |
| A: 16 compounds / v2 | 33 of 120 | edit_overlap | 30 | 0.433 | 0.394 | 1.58 | 0.195 |
| A: 16 compounds / v2 | 33 of 120 | window_and_file | 57 | 0.439 | 0.758 | 1.59 | 0.368 |
| A2: 16 compounds, repeat / queue | 20 of 120 | hold_overlap | 37 | 0.378 | 0.7 | 2.27 | 0.23 |
| A2: 16 compounds, repeat / queue | 20 of 120 | edit_overlap | 29 | 0.414 | 0.6 | 2.48 | 0.17 |
| A2: 16 compounds, repeat / queue | 20 of 120 | window_and_file | 50 | 0.38 | 0.95 | 2.28 | 0.31 |
| B: 40 singles, drift x7 / queue [modelled: touches stretched with the session] | 31 of 780 | hold_overlap | 49 | 0.388 | 0.613 | 9.76 | 0.04 |
| B: 40 singles, drift x7 / queue [modelled: touches stretched with the session] | 31 of 780 | edit_overlap | 34 | 0.382 | 0.419 | 9.62 | 0.028 |
| B: 40 singles, drift x7 / queue [modelled: touches stretched with the session] | 31 of 780 | window_and_file | 83 | 0.325 | 0.871 | 8.18 | 0.075 |
| B: 40 singles, drift x7 / queue [touches as they happened] | 31 of 780 | hold_overlap | 71 | 0.366 | 0.839 | 9.21 | 0.06 |
| B: 40 singles, drift x7 / queue [touches as they happened] | 31 of 780 | edit_overlap | 65 | 0.4 | 0.839 | 10.06 | 0.052 |
| B: 40 singles, drift x7 / queue [touches as they happened] | 31 of 780 | window_and_file | 83 | 0.325 | 0.871 | 8.18 | 0.075 |
| B: 40 singles, drift x7 / v2 [modelled: touches stretched with the session] | 30 of 780 | hold_overlap | 33 | 0.273 | 0.3 | 7.09 | 0.032 |
| B: 40 singles, drift x7 / v2 [modelled: touches stretched with the session] | 30 of 780 | edit_overlap | 25 | 0.36 | 0.3 | 9.36 | 0.021 |
| B: 40 singles, drift x7 / v2 [modelled: touches stretched with the session] | 30 of 780 | window_and_file | 66 | 0.273 | 0.6 | 7.09 | 0.064 |
| B: 40 singles, drift x7 / v2 [touches as they happened] | 30 of 780 | hold_overlap | 50 | 0.26 | 0.433 | 6.76 | 0.049 |
| B: 40 singles, drift x7 / v2 [touches as they happened] | 30 of 780 | edit_overlap | 46 | 0.283 | 0.433 | 7.35 | 0.044 |
| B: 40 singles, drift x7 / v2 [touches as they happened] | 30 of 780 | window_and_file | 66 | 0.273 | 0.6 | 7.09 | 0.064 |
| C: 16 compounds, drift x4 / queue [modelled: touches stretched with the session] | 25 of 120 | hold_overlap | 38 | 0.526 | 0.8 | 2.53 | 0.189 |
| C: 16 compounds, drift x4 / queue [modelled: touches stretched with the session] | 25 of 120 | edit_overlap | 34 | 0.559 | 0.76 | 2.68 | 0.158 |
| C: 16 compounds, drift x4 / queue [modelled: touches stretched with the session] | 25 of 120 | window_and_file | 53 | 0.453 | 0.96 | 2.17 | 0.305 |
| C: 16 compounds, drift x4 / queue [touches as they happened] | 25 of 120 | hold_overlap | 50 | 0.48 | 0.96 | 2.3 | 0.274 |
| C: 16 compounds, drift x4 / queue [touches as they happened] | 25 of 120 | edit_overlap | 48 | 0.5 | 0.96 | 2.4 | 0.253 |
| C: 16 compounds, drift x4 / queue [touches as they happened] | 25 of 120 | window_and_file | 53 | 0.453 | 0.96 | 2.17 | 0.305 |
| C: 16 compounds, drift x4 / v2 [modelled: touches stretched with the session] | 22 of 120 | hold_overlap | 29 | 0.414 | 0.545 | 2.26 | 0.173 |
| C: 16 compounds, drift x4 / v2 [modelled: touches stretched with the session] | 22 of 120 | edit_overlap | 28 | 0.429 | 0.545 | 2.34 | 0.163 |
| C: 16 compounds, drift x4 / v2 [modelled: touches stretched with the session] | 22 of 120 | window_and_file | 44 | 0.432 | 0.864 | 2.36 | 0.255 |
| C: 16 compounds, drift x4 / v2 [touches as they happened] | 22 of 120 | hold_overlap | 39 | 0.436 | 0.773 | 2.38 | 0.224 |
| C: 16 compounds, drift x4 / v2 [touches as they happened] | 22 of 120 | edit_overlap | 38 | 0.447 | 0.773 | 2.44 | 0.214 |
| C: 16 compounds, drift x4 / v2 [touches as they happened] | 22 of 120 | window_and_file | 44 | 0.432 | 0.864 | 2.36 | 0.255 |
<!-- END:flag -->

- **On the native arena the signal is strong once beans are long:** hold overlap flags 33-49 of 780 pairs in B (modelled touches) with precision 0.27-0.39, recall 0.30-0.61 (up to 0.84 with touches as they happened), **lift 7-10x** and 3-5% of clean pairs flagged. In S the lift is 3.4-6.3x but the lead is 8-9 s (median) before the author finishes.
- **On compounds it is nearly useless:** lift 1.4-2.7x, and 16-23% (hold overlap) to 26-37% (window and file) of clean pairs flagged, because collisions are 17-28% of all pairs and 65% of pairs share a file. A parking rule on that signal would serialize about 30% of all pairs for a precision of 0.4-0.5.

### 4.3 The designed semantic couplings

<!-- BEGIN:semantic -->
| run | pair | both being written at once (s) | holding the same file at once (s) | common source files touched at any time | landed order |
|---|---|---|---|---|---|
| S: 40 singles, seed 7 / queue | t002+t022 | 2.0 | 0.0 | - | t002 then t022 |
| S: 40 singles, seed 7 / queue | t005+t031 | 0.0 | 0.0 | src/lib/money.ts | t005 then t031 |
| S: 40 singles, seed 7 / queue | t011+t018 | 7.3 | 0.0 | src/shipping/service.ts | t011 then t018 |
| S: 40 singles, seed 7 / queue | t023+t036 | 6.4 | 0.0 | src/billing/invoice.ts | t023 then t036 |
| S: 40 singles, seed 7 / queue | t028+t032 | 8.7 | 0.3 | src/types.ts | t028 then t032 |
| S: 40 singles, seed 7 / v2 | t002+t022 | 0.0 | 0.0 | - | t002 then t022 |
| S: 40 singles, seed 7 / v2 | t005+t031 | 0.0 | 0.0 | src/lib/money.ts | t005 then t031 |
| S: 40 singles, seed 7 / v2 | t011+t018 | 0.0 | 0.0 | - | t011 then t018 |
| S: 40 singles, seed 7 / v2 | t023+t036 | 0.0 | 0.0 | src/billing/invoice.ts | t023 then t036 |
| S: 40 singles, seed 7 / v2 | t028+t032 | 0.0 | 0.0 | src/shipping/service.ts, src/types.ts | t028 then t032 |
| S: 40 singles, seed 11 / queue | t002+t022 | 0.0 | 0.0 | - | t002 then t022 |
| S: 40 singles, seed 11 / queue | t005+t031 | 0.0 | 0.0 | - | t005 then t031 |
| S: 40 singles, seed 11 / queue | t011+t018 | 11.0 | 0.0 | src/notifications/templates.ts | t018 then t011 |
| S: 40 singles, seed 11 / queue | t023+t036 | 2.6 | 0.0 | src/billing/invoice.ts | t036 then t023 |
| S: 40 singles, seed 11 / queue | t028+t032 | 12.3 | 1.1 | src/types.ts | t028 then t032 |
| S: 40 singles, seed 11 / v2 | t002+t022 | 0.0 | 0.0 | - | t002 then t022 |
| S: 40 singles, seed 11 / v2 | t005+t031 | 0.0 | 0.0 | - | t005 then t031 |
| S: 40 singles, seed 11 / v2 | t011+t018 | 0.0 | 0.0 | - | t018 then t011 |
| S: 40 singles, seed 11 / v2 | t023+t036 | 0.0 | 0.0 | - | t023 then t036 |
| S: 40 singles, seed 11 / v2 | t028+t032 | 0.0 | 0.0 | src/notifications/templates.ts, src/shipping/service.ts, src/types.ts | t028 then t032 |
| A: 16 compounds / queue | L01+L02 | 30.8 | 0.0 | src/billing/handlers.ts, src/routes.ts | L01 then L02 |
| A: 16 compounds / queue | L04+L12 | 19.1 | 0.0 | - | L04 then L12 |
| A: 16 compounds / queue | L05+L11 | 27.6 | 41.1 | src/billing/invoice.ts, src/billing/tax.ts | L05 then L11 |
| A: 16 compounds / queue | L07+L14 | 18.2 | 9.7 | src/config.ts, src/types.ts | L14 then L07 |
| A: 16 compounds / queue | L08+L12 | 25.1 | 0.0 | src/shipping/service.ts | L08 then L12 |
| A: 16 compounds / v2 | L01+L02 | 51.3 | 56.1 | src/billing/handlers.ts, src/lib/pagination.ts, src/notifications/queue.ts, src/notifications/templates.ts, src/orders/checkout.ts | L01 then L02 |
| A: 16 compounds / v2 | L04+L12 | 16.2 | 0.0 | - | L04 then L12 |
| A: 16 compounds / v2 | L05+L11 | 34.0 | 0.0 | src/billing/service.ts | L11 then L05 |
| A: 16 compounds / v2 | L07+L14 | 11.7 | 0.0 | src/config.ts, src/types.ts | L14 then L07 |
| A: 16 compounds / v2 | L08+L12 | 22.5 | 0.0 | - | L08 then L12 |
| A2: 16 compounds, repeat / queue | L01+L02 | 61.6 | 62.8 | src/billing/handlers.ts, src/lib/pagination.ts, src/orders/checkout.ts, src/orders/handlers.ts, src/orders/service.ts | L01 then L02 |
| A2: 16 compounds, repeat / queue | L04+L12 | 15.0 | 0.0 | - | L04 then L12 |
| A2: 16 compounds, repeat / queue | L05+L11 | 33.4 | 0.0 | - | L11 then L05 |
| A2: 16 compounds, repeat / queue | L07+L14 | 15.5 | 0.0 | src/config.ts, src/types.ts | L14 then L07 |
| A2: 16 compounds, repeat / queue | L08+L12 | 21.0 | 0.0 | - | L08 then L12 |
| B: 40 singles, drift x7 / queue [modelled: touches stretched with the session] | t002+t022 | 0.0 | 0.0 | - | t002 then t022 |
| B: 40 singles, drift x7 / queue [modelled: touches stretched with the session] | t005+t031 | 0.0 | 0.0 | - | t005 then t031 |
| B: 40 singles, drift x7 / queue [modelled: touches stretched with the session] | t011+t018 | 84.6 | 0.0 | src/notifications/templates.ts | t018 then t011 |
| B: 40 singles, drift x7 / queue [modelled: touches stretched with the session] | t023+t036 | 0.0 | 0.0 | src/billing/invoice.ts | t023 then t036 |
| B: 40 singles, drift x7 / queue [modelled: touches stretched with the session] | t028+t032 | 118.9 | 55.7 | src/types.ts | t028 then t032 |
| B: 40 singles, drift x7 / queue [touches as they happened] | t002+t022 | 0.0 | 0.0 | - | t002 then t022 |
| B: 40 singles, drift x7 / queue [touches as they happened] | t005+t031 | 0.0 | 0.0 | - | t005 then t031 |
| B: 40 singles, drift x7 / queue [touches as they happened] | t011+t018 | 84.6 | 0.0 | src/notifications/templates.ts | t018 then t011 |
| B: 40 singles, drift x7 / queue [touches as they happened] | t023+t036 | 0.0 | 0.0 | src/billing/invoice.ts | t023 then t036 |
| B: 40 singles, drift x7 / queue [touches as they happened] | t028+t032 | 118.9 | 109.9 | src/types.ts | t028 then t032 |
| B: 40 singles, drift x7 / v2 [modelled: touches stretched with the session] | t002+t022 | 0.0 | 0.0 | - | t002 then t022 |
| B: 40 singles, drift x7 / v2 [modelled: touches stretched with the session] | t005+t031 | 0.0 | 0.0 | src/lib/money.ts | t005 then t031 |
| B: 40 singles, drift x7 / v2 [modelled: touches stretched with the session] | t011+t018 | 0.0 | 0.0 | - | t011 then t018 |
| B: 40 singles, drift x7 / v2 [modelled: touches stretched with the session] | t023+t036 | 200.1 | 0.0 | - | t023 then t036 |
| B: 40 singles, drift x7 / v2 [modelled: touches stretched with the session] | t028+t032 | 255.8 | 37.7 | src/types.ts | t028 then t032 |
| B: 40 singles, drift x7 / v2 [touches as they happened] | t002+t022 | 0.0 | 0.0 | - | t002 then t022 |
| B: 40 singles, drift x7 / v2 [touches as they happened] | t005+t031 | 0.0 | 0.0 | src/lib/money.ts | t005 then t031 |
| B: 40 singles, drift x7 / v2 [touches as they happened] | t011+t018 | 0.0 | 0.0 | - | t011 then t018 |
| B: 40 singles, drift x7 / v2 [touches as they happened] | t023+t036 | 200.1 | 0.0 | - | t023 then t036 |
| B: 40 singles, drift x7 / v2 [touches as they happened] | t028+t032 | 255.8 | 86.0 | src/types.ts | t028 then t032 |
| C: 16 compounds, drift x4 / queue [modelled: touches stretched with the session] | L01+L02 | 133.9 | 0.0 | src/billing/handlers.ts, src/routes.ts | L01 then L02 |
| C: 16 compounds, drift x4 / queue [modelled: touches stretched with the session] | L04+L12 | 76.6 | 0.0 | - | L04 then L12 |
| C: 16 compounds, drift x4 / queue [modelled: touches stretched with the session] | L05+L11 | 125.3 | 54.3 | src/billing/tax.ts | L05 then L11 |
| C: 16 compounds, drift x4 / queue [modelled: touches stretched with the session] | L07+L14 | 68.7 | 3.6 | src/config.ts, src/types.ts | L14 then L07 |
| C: 16 compounds, drift x4 / queue [modelled: touches stretched with the session] | L08+L12 | 94.9 | 0.0 | src/shipping/service.ts | L08 then L12 |
| C: 16 compounds, drift x4 / queue [touches as they happened] | L01+L02 | 133.9 | 96.4 | src/billing/handlers.ts, src/routes.ts | L01 then L02 |
| C: 16 compounds, drift x4 / queue [touches as they happened] | L04+L12 | 76.6 | 0.0 | - | L04 then L12 |
| C: 16 compounds, drift x4 / queue [touches as they happened] | L05+L11 | 125.3 | 107.6 | src/billing/tax.ts | L05 then L11 |
| C: 16 compounds, drift x4 / queue [touches as they happened] | L07+L14 | 68.7 | 102.1 | src/config.ts, src/types.ts | L14 then L07 |
| C: 16 compounds, drift x4 / queue [touches as they happened] | L08+L12 | 94.9 | 0.0 | src/shipping/service.ts | L08 then L12 |
| C: 16 compounds, drift x4 / v2 [modelled: touches stretched with the session] | L01+L02 | 143.8 | 0.0 | src/billing/handlers.ts, src/routes.ts | L01 then L02 |
| C: 16 compounds, drift x4 / v2 [modelled: touches stretched with the session] | L04+L12 | 75.8 | 0.0 | - | L04 then L12 |
| C: 16 compounds, drift x4 / v2 [modelled: touches stretched with the session] | L05+L11 | 139.6 | 42.0 | src/billing/tax.ts | L11 then L05 |
| C: 16 compounds, drift x4 / v2 [modelled: touches stretched with the session] | L07+L14 | 238.6 | 34.3 | src/config.ts, src/db/migrations/index.ts, src/types.ts | L14 then L07 |
| C: 16 compounds, drift x4 / v2 [modelled: touches stretched with the session] | L08+L12 | 94.7 | 0.0 | - | L08 then L12 |
| C: 16 compounds, drift x4 / v2 [touches as they happened] | L01+L02 | 143.8 | 106.0 | src/billing/handlers.ts, src/routes.ts | L01 then L02 |
| C: 16 compounds, drift x4 / v2 [touches as they happened] | L04+L12 | 75.8 | 0.0 | - | L04 then L12 |
| C: 16 compounds, drift x4 / v2 [touches as they happened] | L05+L11 | 139.6 | 99.7 | src/billing/tax.ts | L11 then L05 |
| C: 16 compounds, drift x4 / v2 [touches as they happened] | L07+L14 | 238.6 | 119.5 | src/config.ts, src/db/migrations/index.ts, src/types.ts | L14 then L07 |
| C: 16 compounds, drift x4 / v2 [touches as they happened] | L08+L12 | 94.7 | 0.0 | - | L08 then L12 |
<!-- END:semantic -->

## 5. Design implications

**Evidence per idea.**

- **Idea 9, observe-then-place: not needed at these lengths.** Where contention is sparse (native beans at 130 s) the observed hold-overlap signal works (lift 7-10x, 3-5% of clean pairs flagged, precision 0.27-0.39) and the lead is about a minute; where contention is dense (compounds) it flags 16-23% of clean pairs at lift 1.4-2.7x and would serialize about 30% of all pairs for a precision of 0.4-0.5. On short beans there is no overlap to observe (§1). Parking also only helps if the agent takes other work meanwhile, and what it can save is bounded by the same 5-18% of spend as notices (below). If it is built, build it as a hint that orders the backlog away from files that running beans hold, not as a gate.
- **Idea 10, mid-flight invalidation notices: not needed at these lengths, revisit at 10 minutes and up.** The addressable collisions are those whose partner lands while the affected bean is still being written: 0-18% of collision pairs on short beans, 11-12% on 120-s compounds, 33-34% on 130-s native beans (§4.1). Their rework cost is $0-0.79 per race, 5-18% of spend at 2-minute beans, and a notice delivered to a `claude -p` session means stopping and resuming it, i.e. a rework, so the saving is the *second* rework and the recheck, not the first. The share grows with bean length (0-18% at 17 s, 33-34% at 130 s), so real 10-30 minute tasks may cross the threshold where it pays; this experiment cannot say where.
- **The spec-contradiction cards (idea 8) are rarely reached by dense beans.** The card fires after three red pre-land checks against the *same* landed change; compounds are broken by different changes in turn and exhaust `--max-rework 3` first (A: 4 of 16 dropped, C: 3 of 16, no card in either; B: one card). Fire a card when two different landed changes have broken the same bean, or when half the rework budget is spent.

**What the data point at instead, all on the gate side and in this order.**

1. **Release the agent while its change is checked.** v2 as harnessed holds 72 blocked against 139 busy agent-minutes at 130-s beans; v2r (§3.4) removes the blocked time but makes reworks wait for an agent (24 waits, 1,009 s in 11.7 minutes). Run the pair (§7) before committing to either.
2. **Make the recheck conditional.** 55 of 64 rechecks came back green (0 of 20 at 2-minute beans; 3 of 7 red on dense compounds), and each costs 60 s of a runner and, as harnessed, 60 s of the agent. File overlap alone is the wrong trigger at 2-minute beans and about right on compounds.
3. **Price rework like work.** A rework costs 1.3-2.0x an initial invocation at 2-minute beans and is 42-65% of every race's spend. A planner that bundles beans (compounds) raises the stakes: on C 62-65% of spend is rework.

**For the stage.** Say "v2 finishes 1.3-2.5x sooner than a good merge queue, at 0.94-1.4x its spend (parity from 2-minute beans), from 17-second to 2-minute beans". Do not show time to the first greens at 2-minute native beans: the queue is ahead until about three quarters of the work is green (0.59x at 50%, 0.74x at 75%). Show done time and cost to done.

## 6. Cost

| What | Agent spend |
|---|---|
| probes (single-session timing) | $0.87 |
| pre-flight auth checks | $0.02 |
| e5-long-d4-queue | $4.52 |
| e5-long-d4-v2 | $4.29 |
| e5-long-queue | $3.55 |
| e5-long-r2-queue | $4.40 |
| e5-long-v2 | $4.04 |
| e5-short-d7-queue | $4.61 |
| e5-short-d7-v2 | $4.33 |
| e5-short-d7-v2r-void-1 | $4.52 |
| **Total** (cap $40) | **$35.14** |

- **The required pair** (condition A, compounds, seed 7, queue and v2) cost $7.59. The supplements B and C cost $17.75. Two optional extras cost $8.92: the queue-only repeat A2 ($4.40) and the v2r race ($4.52, void). Probes and pre-flights cost $0.89.
- **Every run is under its $20 budget** (dearest $4.61); no run aborted on budget. The v2r race stopped on the account's usage limit, not on budget. Costs are the CLI's `total_cost_usd` at list price; the account is billed as extra usage.
- **Replay controls cost nothing** (`e5-replay-*`).
- **Wall-clock** is dominated by the slot line (the first paid race started 2 hours 11 minutes after I first queued it, part of that the authentication outage), not by the races (8-30 minutes each).

## 7. Threats to validity, and what I would run next

- **One sample per cell.** The only measure of noise is the pair of short seeds (queue done 16.5 and 34.7 min; v2 11.3 and 14.0) and the repeat queue run on the compounds (16.6 and 19.6 min). The sign of v2's lead is stable (5 of 5 pairs); its size is not. Real agents are not seeded: `--seed 7` fixes only the harness's shuffles, so races "at seed 7" are samples, not replays.
- **Emulated drift changes timing, not behaviour.** B and C hold finished work back; the agent never writes against a moved tree, never re-reads, never changes its mind with more time. A real 20-minute task would also touch more files and read more. B and C are therefore a lower bound on what longer real work changes (the brief called (c) weaker for this reason), and their file-touch times in §4 are modelled.
- **Compounds are one arbitrary partition** (seeded hill climb) with 2x the files per bean and 3x the pairwise collision rate of the arena, so a compound race mixes bean size with contention density; the 2 x 2 (S and A against B and C) is what separates size from length.
- **The baselines S ran earlier on a machine with unknown load and on the `ci.py` that E2 later fixed**, with a $75 budget and 45-minute cap; my races ran at a 1-minute load of 4-11 on average (peaks to 41) on the fixed code. Suite times are alike (0.5-1.2 s median), no S or A v2 race shows the lock bug, but the comparison S-to-B is not an A/B test of a single variable.
- **12 agents, 2 CI slots, one model (Sonnet), one app of 46 files.** At 16 beans for 12 agents (A, C) the race is nearly one wave; at 40 beans it is three. Larger agent counts and longer tasks were not tried.
- **Overlap is a lower bound:** only Read, Edit and Write paths are attributed to files, not Grep and Glob hits or Bash reads.
- **The v2r run was cut off by the usage limit**, so the central suspected cause of v2's early-green lag is untested.

**Next, in order of value per dollar:**
1. v2 and v2r at B's setting, one pair (about $9): does releasing the agent recover the early greens, and what do reworks waiting for an agent cost?
2. Two more samples each of B and C (about $18): size the noise and settle whether the lead really is 1.3-1.4x at 2-minute beans.
3. A real-length arm: 8-12 genuinely 10-minute tasks (written beans, not held ones) on a larger repository, three agents; the first run where notices could matter.

## Appendix

### Machine load

<!-- BEGIN:load -->
`uptime` printed at the start and end of each race (also logged in `events.jsonl`), and the 1-minute load average sampled every 30 s during it (18 cores). The short baselines (S) were run before load logging existed.

| run | uptime at start | uptime at end | 1-min load during the race: mean / max (samples) |
|---|---|---|---|
| S: 40 singles, seed 7 / queue | not logged | not logged | not logged |
| S: 40 singles, seed 7 / v2 | not logged | not logged | not logged |
| S: 40 singles, seed 11 / queue | not logged | not logged | not logged |
| S: 40 singles, seed 11 / v2 | not logged | not logged | not logged |
| A: 16 compounds / queue | load 6.22 7.18 16.48 | load 12.54 10.55 12.68 | 10.8 / 33.3 (33) |
| A: 16 compounds / v2 | load 3.31 7.31 23.31 | load 6.67 7.28 16.57 | 6.9 / 10.6 (15) |
| A2: 16 compounds, repeat / queue | load 7.17 6.26 7.63 | load 6.41 4.67 4.91 | 3.9 / 12.9 (39) |
| B: 40 singles, drift x7 / queue | load 5.88 29.18 36.19 | load 2.96 4.15 10.62 | 11.2 / 40.8 (59) |
| B: 40 singles, drift x7 / v2 | load 2.96 4.14 10.57 | load 1.83 4.28 6.19 | 5.6 / 12.1 (45) |
| C: 16 compounds, drift x4 / queue | load 5.81 5.30 12.65 | load 6.64 6.12 7.60 | 5.0 / 11.6 (34) |
| C: 16 compounds, drift x4 / v2 | load 6.83 14.12 23.90 | load 2.58 4.66 12.47 | 4.9 / 13.0 (24) |
<!-- END:load -->

### Files (all under `research/exp/e5-long-tasks/`)

- **Tasks and ground truth:** `plan_groups.py`, `groups/long16.json`, `build_long.py`, `arena-long/` (16 compound tasks and patches), `materialize_long.py`, `corpora/arena-long.git`, `validate_long.py`, `data/long-profile.json`, `pairs.py` and `data/pairs.json`; `arena/` and `corpora/arena.git` are my rebuild of the 40-task arena (identical commits).
- **Harness:** `race/` (copy of `research/race`; `harness-changes.diff` lists every difference: `--drift-factor`, load logging, E2's `ci.py` fix; `race/harness/policy_beanstalk_v2r.py` is the extra policy).
- **Runs:** `race/runs/e5-*` (events, summaries, stream-json transcripts); `e5-uptime.log` (start and end `uptime` of every race), `e5-state*.json` (verdicts), `e5-short-d7-v2r-void-1` (void).
- **Measurement:** `probe_agent.py`, `data/probe/`, `e5lib.py`, `runstats.py`, `ratios.py`, `overlap.py`, `timeline.py`, `make_tables.py`, `test_e5.py`; every table in this page is in `data/tables/` and regenerates with `python3 make_tables.py --out data/results.md --inject docs/claude-opus/exp/e5-long-tasks.md`.
- **Orchestration:** `scripts/_race_inner.sh` (the exact race commands), `scripts/hold.py` and `orchestrate*.sh` (slot holds, void-run handling, spend guard), `scripts/check_run.py`, `scripts/preflight.py`, `scripts/spend.py`, `scripts/check_replay.py`, `scripts/replay_check.sh`, `scripts/replay_v2r.sh`, `scripts/status.py`.
