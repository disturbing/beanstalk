# E2: a real arena. Does v2 still beat a strong batched merge queue on a real repository?

**Status (2026-10-03):** complete: 4 real races (2 seeds × 2 policies) and 1 diagnostic race, all measured. Code, arena and run directories: `research/exp/e2-real-arena/` (a copy of the harness in `race/`; `research/race` and `research/arena` are untouched).

**Naming (Coop's):** a **bean** is one agent's change in its workspace, the **sprout** is the staged line (the harness's `trunk`), the **stalk** is the stable line (the harness's `green`). Event names and code keep the harness words (`land`, `green.promote`, `trunk_idx`).

**Labels:** **measured** = taken from real history or a real race (Sonnet agents, the real arena); **replay** = a free race with replay agents (reference patches), used only to check the plumbing.

---

## 1. The question

Every real-agent result so far (`08` §5) comes from the designed arena: 40 tasks we wrote ourselves, with designed couplings. This experiment rebuilds the arena from a real repository's history (real tasks, real tests, real contention) and races the batched queue against v2 (`10` §6) with the same harness settings as `08` §5.2.

## 2. The repository: marked

**Choice: [markedjs/marked](https://github.com/markedjs/marked)**, the Markdown parser (TypeScript, zero runtime dependencies, tests on `node:test`).

| Criterion | marked |
|---|---|
| Suite | 1,699 `node:test` cases: about 1,500 spec examples (CommonMark, GFM, marked's own specs) plus unit tests. 2.2 s at load 44, 17 s at load 70–160 (about 4.5 s of CPU); esbuild build 0.1 s of CPU |
| Services, network, browsers | none |
| Activity | 84 first-parent commits from 2026-06-30 to 2026-10-02; 41 of them change source **and** tests, from 22 authors; many PR descriptions are long, structured analyses (expectation, result, cause, fix) |
| Contention | the parser lives in a few files: of the 41, most touch `src/rules.ts` (the block and inline regexes), `src/Tokenizer.ts` or `src/Lexer.ts` |
| Tests per change | almost always new spec files (`test/specs/new/<name>.md` + `.html`), so tasks rarely share a test file |

**Candidates surveyed** (treeless clones, last 800 first-parent commits; *src pair* = share of pairs in a 40-change window sharing a source file, *test pair* = sharing a test file):

| Repo | Runner | Qualifying changes (src + test) | Window span | src pair | test pair | Why not |
|---|---|---|---|---|---|---|
| **marked** | node:test | 127 | 3 months | 0.36–0.44 | 0.02–0.04 | chosen |
| zod | vitest | 286 | 1–2 weeks | 0.22–0.28 | 0.08–0.13 | one author's sequential commits (high dependency), custom package manager, heavy suite |
| commander.js | jest | 180 | 3.5 years | 0.59–0.68 | 0.23–0.54 | slow history; tests in shared files |
| ufo | vitest | 93 | 2–3 years | 0.39–0.46 | 0.22–0.28 | slow history |
| fast-xml-parser | jasmine | 182 | 2.5 years | 0.24–0.42 | 0.12–0.16 | mostly one maintainer |
| luxon, yaml, immer | jest/vitest | 120–274 | 2–5 years | 0.09–0.27 | 0.07–0.23 | low contention or slow |
| valibot, remeda | vitest | 117–238 | about 1 year | 0.03–0.18 | 0.01–0.13 | low contention (one file per function) |
| cheerio, citty | vitest | 11–16 | | | | too few qualifying changes |

## 3. Building the tasks (measured)

**Window.** Base `d2af54e` (2026-06-29, marked 18.0.5, the commit before the window) to `c18a64f` (2026-10-02). The 41 changes that touch `src/` or `bin/` and `test/` are the window; 25 dependabot bumps, 9 release commits and the docs and chore commits are not tasks.

**Per change** (`real-arena/build.py`):

1. **Re-base onto the common base** with a 3-way merge (`git merge-tree`, merge base = the change's parent). **13 of 41 conflict:** they build on an earlier change in the window (`real-arena/dependencies.json`: for example #4004 needs #4003, #4044 and #4040 need #4017, #4067 needs #4012, #4070 needs #4051; six need several). All 13 conflict in the hot files (`rules.ts`, `Lexer.ts`, `Tokenizer.ts`, `helpers.ts`). **Excluded.**
2. **Prompt:** the PR's title (the harness prints it first) and description, with the template's HTML comments and Contributor/Committer checklists removed. All 24 final tasks have a substantive description; none needed the linked-issue fallback or a rewrite.
3. **Acceptance tests:** the change's own test-file changes, made task-owned so that two tasks never write the same test file (the harness stores acceptance tests as whole files):
   - **added test files** as they are (spec `.md`/`.html` pairs, unit fixtures): 19 of 24 tasks have only these;
   - **cases added or modified in a shared unit-test file** (`Lexer.test.js`, `marked.test.js`, `bin.test.js`) are extracted into `test/unit/<file>.pr<N>.test.js` with the file's imports, helpers and hooks (`real-arena/extract_tests.mjs`, TypeScript's parser): 4 tasks;
   - **CommonMark examples whose `shouldFail` flag the change cleared** in the shared spec JSON are copied into `test/specs/<dir>/pr<N>.json` with the section renamed `"<section> [pr<N> <dir>]"`, so their results map to that file: 2 tasks.
4. **Reference solution:** a `git apply` patch against the base with every non-test change, plus the residual edits of shared test files (the cleared `shouldFail` flags, and in #4053 four Lexer expectations that gain `autolink: true`). An agent has to make those edits too; the shared files are not protected.
5. **Validation**, as the arena does it (`race.py --dry-run` on the 28 candidates, against a main-only copy of the same base; `race/runs/_dry-candidates/dry_run.json`: acceptance tests fail on the base, base + solution passes the whole suite). **4 more excluded:** #4013 and #4017 are ReDoS-only fixes whose tests fail only on timing (see §4, the time guard is off), and #4064 and #4090 depend semantically on an earlier change (#4064's example 520 needs #4051's link-in-link rejection, as its own description says; #4090's bundle fails to load on the base).

**Result: 24 tasks** `t001`–`t024`, in merge order (`real-arena/tasks/`, `real-arena/solutions/`, `real-arena/window.json`). All 24 are bug fixes from 14 authors; source lines changed: median 6, range 2–53 (difficulty 1/2/3: 13/8/3 by size). Task order is merge order; tasks start in id order, as in `08`.

**Repository** (`real-arena/materialize.py` → `real-arena.git`): `main` is the upstream base commit with marked's real history (agents can read `git log` and `git blame`); `ref/tNNN` = base + acceptance tests + solution, for profiling only. The race clones `main` alone over the pack protocol, so no reference solution reaches an agent.

## 4. Harness changes (`race/harness/suite.py`, `real-arena/arena.json`)

The designed arena's behaviour is the default; `arena.json` in an arena directory switches it.

| Concern | Designed arena | Real arena (marked) |
|---|---|---|
| CI command | `node --test` | `node esbuild.config.js`, then `node --test --test-concurrency=4` on `test/run-spec-tests.js`, `test/unit/*.test.js` and the CJS/UMD bundle checks: the repo's own UnitTests CI job. Lint and type checks are not run |
| Dependencies | none | `npm ci` once at the base into `deps/node_modules`, exposed as `<run>/work/node_modules` (Node resolution walks up from every worktree; git never sees it) |
| junit | `file` attribute | spec examples are data files run by one runner, so their testcases are reported at the testutils call site; they are mapped back to the spec file by section name (`.md` stands for its `.md`/`.html` pair; a CommonMark section defined in two directories maps by occurrence order) |
| Read sets | static import closure | unit tests import `lib/marked.esm.js`, aliased to `src/marked.ts`; a spec file's read set is the spec runner's closure, that is all of `src/`. A parser test reads the whole parser, so read sets cannot narrow a culprit |
| Agents' test command | `node --test` | `run-tests` (a wrapper on `PATH`: build, then the same files, dot reporter, failures only); allowed in Claude Code as `Bash(run-tests …)` and `Bash(node esbuild.config.js)` alongside `node --test` |
| Spec time guard | — | `@markedjs/testutils` fails any spec that takes ≥ 1 s. At load 460 during setup, five base ReDoS specs failed on time alone, so the guard is off in the dependency snapshot (an env var re-enables it). Consequence: the two ReDoS-only fixes have no failing test and are excluded (§3) |

The harness's unit tests (`race/tests`, the subset covering helpers, a queue race, a beanstalk race, the dry run and the agent argv) pass unchanged. A real Claude Code agent started with the harness's argv runs `run-tests` (checked with one Haiku call, $0.009). **Replay check (free):** both policies, 8 replay agents at 1/12 time scale (`runs/e2-replay-*-s7`), finished 24 of 24 green with a correct final green. With reference solutions nothing collides, so the queue finished in 0.7 min and v2 in 2.2 min. That is the plumbing working, not a result.

## 5. Contention: real against designed (measured)

Pairwise over the reference solutions (`ref/*` branches), as `arena/contention.py` does it; the semantic column runs the whole suite on every pair that merges cleanly (`real-arena/contention.py --semantic`, `real-arena/profile.json`).

| | Designed arena (40 tasks) | Real arena (24 tasks) |
|---|---|---|
| Files per change (source files) | 3.83 | 4.96 (1.21) |
| Hottest file | `CHANGELOG.md` 30% of tasks, then `types.ts` 22.5% | `src/rules.ts` **58%**, `src/Tokenizer.ts` 38% |
| Pairs sharing a file | 24.2% | **46.0%** (all of them share a source file) |
| Pairs that conflict textually | 7.4% (30.7% of file-sharing pairs) | **0%** (0 of 276) |
| Clean pairs that fail the suite (semantic) | about 1% (7 of 722) + 5 designed semantic couplings | **0%** (0 of 276) |
| Changes built on an earlier change in the window | 0% (designed) | **37%** (15 of 41: 13 textual, 2 semantic), all excluded |

**The common-base construction removes the contention it was meant to capture.** Real contention in marked is high: 37% of the window's changes build on an earlier one, all of them in the parser's hot files. That is comparable in spirit to `08` §1's "built on another change in the window": 13–17% for the human-led repos and 49% for the agent-heavy one, measured differently (W = 20, leave-one-out revert). But those are exactly the changes that do not apply to a common base, so they leave the arena. What survives is a set of fixes that their authors never had to reconcile: pairwise they merge cleanly and pass together, every one of the 276 pairs. This is the same bias `research/README.md` notes for step 1 ("re-applying changes onto a fixed window base is biased toward zero").

So in this arena every conflict and every red comes from **the agents' own solutions**, which differ from the authors'. That is a real and interesting measurement (do independent agents, editing the same regex file, step on each other?), but it is a different and milder one than the designed arena's.

**Can the dependent changes be put back? Mostly not (E2b, `real-arena/build_chain.py`).** I rebuilt the window in history order: each change is merged onto the state after all earlier tasks and validated there (its tests fail before it and the suite passes after it), and its acceptance tests and reference solution are taken against its own upstream parent. The common base stays the race's base, so a task whose prerequisite has not landed has to do that part too or collide with it. That recovers only **4** dependent tasks (#4004 on #4003, #4095 on #4015, #4101 on #4030, and #4064 on #4051), for 28 tasks in all (`real-arena/chain/`). The other 11 still drop out. Most of them belong to a chain in `src/Lexer.ts` (#4044, #4059, #4077, then #4076 and #4091) that builds on ReDoS-only refactors (#4017, #4040). Those refactors have no functional test, so they cannot be tasks while the time guard is off. In a race, only #4004 (and perhaps #4064) would likely run concurrently with its prerequisite: tasks start in id order, and the other two start after theirs have landed. I did not race E2b. The race slots are shared by six experiments, with FIFO waits of 30–70 minutes per race, so its four races (two replay gates and one real pair) were not worth one or two probable collisions.

## 6. Results (measured)

Settings as in `08` §5.2 for both policies: Sonnet, 12 agents, 60 s emulated CI on 2 slots, `--protect-tests landed`, 45-minute wall limit, $25 budget per race. Queue: `--batch 4 --no-queue-hold`. v2: `PRELAND_MODE=optimistic PRELAND_SECONDS=60 --snapshot head --error-budget 999`. Every race went through the machine-wide race slot (`research/tools/race-slot.sh`). Milestones are the k-th verified green (`kth_green.py`); with 24 tasks they are k = 10, 15 and 20. Load is the 1-minute load average from `uptime` when the race started and when it ended.

**Real arena, 24 tasks** (`research/exp/e2-real-arena/race/runs/e2-*`):

| Run | 10th green min / $ | 15th green | 20th green | Done min | Greens | Cost | Red validations | Final green correct | p90 start → green min | Reworks | Textual conflicts | CI min (+ pre-land) | Load start / end |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Queue, seed 7 | **2.3** / 1.43 | **3.4** / 1.43 | **4.3** / 1.43 | **4.4** | 24 / 24 | $1.43 | 0 | yes | **4.1** | 0 | 0 | 8.2 | 16.3 / 7.7 |
| v2, seed 7 | 6.6 / 1.41 | 10.9 / 1.66 | 15.1 / 1.66 | 19.1 | 24 / 24 | $1.66 | 0 | yes | 11.5 | 1 | 1 | 25.1 (+77.6) | 7.7 / 4.9 |
| Queue, seed 11 | **2.3** / 1.56 | **3.4** / 1.56 | **4.4** / 1.56 | **4.4** | 24 / 24 | $1.56 | 0 | yes | **4.1** | 0 | 0 | 8.4 | 13.9 / 9.7 |
| v2, seed 11 | 7.0 / 1.55 | 11.2 / 1.75 | 16.4 / 1.75 | 20.5 | 24 / 24 | $1.75 | 0 | yes | 12.5 | 1 | 1 | 25.3 (+80.1) | 9.7 / 3.5 |
| *Diagnostic: v2 without the file-overlap re-check, seed 11 (§6.3)* | *3.4 / 1.47* | *4.4 / 1.47* | *4.4 / 1.47* | *5.4* | *24 / 24* | *$1.47* | *0* | *yes* | *3.4* | *0* | *0* | *7.2 (+25.0)* | *16.9 / 15.1* |

`kth_green.py` output for the four main runs: `race/runs/e2-kth-green.md`.

**The queue is 2.9–3.0x faster to the 10th green, 3.5–3.7x to the 20th and 4.3–4.7x to done, at 11–14% lower cost.** Both seeds agree to within a minute. A first v2 seed-11 race was aborted at 8.7 min by a harness bug (§6.2) and re-run; its $1.36 is counted in §9.

**Designed arena, same settings** (`08` §5.2, `research/race/runs/opus-*`, recomputed at the same milestones):

| Run | 10th green min / $ | 15th green | 20th green | Done min | Greens | Cost | Red validations | Final green correct | p90 start → green min | Reworks | Textual conflicts |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Queue, seed 7 | 3.2 / 2.22 | 4.2 / 2.41 | 5.2 / 3.03 | 16.5 | 37 / 40 | $4.42 | 7 | yes | 12.7 | 30 | 26 |
| v2, seed 7 | 6.2 / 4.07 | 6.2 / 4.07 | 7.3 / 4.79 | 11.3 | 35 / 40 | $5.29 | 1 | yes | 6.1 | 37 | 21 |
| Queue, seed 11 | 2.2 / 2.37 | 4.2 / 2.65 | 4.2 / 2.65 | 34.7 | 34 / 40 | $4.10 | 14 | yes | 21.1 | 30 | 22 |
| v2, seed 11 | 4.2 / 1.59 | 6.3 / 3.37 | 9.4 / 5.32 | 14.0 | 34 / 40 | $5.62 | 2 | yes | 6.5 | 36 | 16 |

On the designed arena v2 was already slower to the first greens and won only the tail, because the queue went red 7–14 times. On the real arena the queue never went red, so there was no tail to win.

### 6.1 What happened

**The agents found the tasks easy.** A first attempt took about 25 s and 9 turns and cost $0.06. In all four races every first attempt passed CI or its pre-land check: no red batch, no red pre-land check, no red validation, no dropped task. The PR descriptions explain the bug and often the fix, and each agent runs the whole suite (`run-tests`) before it stops.

**The agents' solutions barely collided.** Each v2 race met one textual conflict (`t007`, then `t021`, both in `src/Tokenizer.ts`), resolved by one rework; the queue races met none, and no race had a semantic break. No agent edited a protected acceptance test. That matches the reference solutions' profile (§5).

**So the queue had nothing to pay for.** With `--no-queue-hold` an author is released when its PR is queued, so all 24 first attempts were done by 1.4–1.6 min. Eight speculative batches (mean size 3, all green) landed everything by 4.4 min. From an agent finishing to its change being green took a median of 2.7 min (worst 3.4–3.7).

**v2 paid for checks that found nothing.** The figures replicate across seeds (seed 7 / seed 11):

| v2 pre-land mechanics | Real arena | Designed arena (`08` §5.2) |
|---|---|---|
| Pre-land checks (red) | 74 (**0**) / 76 (**0**) | 83 (17) / 94 (23) |
| Re-checks after the sprout moved under a bean (file overlap) | **49 / 51** | 12 / 25 |
| Landings without a re-check (optimistic, no shared file) | 9 / 8 | 31 / 29 |
| Attempts that fell back to checking inside the committer lock | **13 / 15** | 1 / 2 |
| Agent-minutes blocked (queue on the real arena: 0.2 / 0.25) | 143 / 156 | 85 / 103 |
| Agent finished → green, median (queue: 2.7 / 2.7) | 6.9 / 7.8 min | |

Two v2 mechanisms cost it the race (§6.3 separates them: the second is most of it, and it also keeps authors waiting):
1. **The pre-land check holds the author.** The check runs in the author's sandbox, so its agent stays bound until the bean lands. The second wave of tasks started late: the last first attempt finished at 7.8–8.1 min, against 1.4–1.6 for the queue.
2. **Optimistic landing re-checks on file overlap,** and in a parser almost everything overlaps. The rule is: when the sprout moved under a green check, land without re-checking only if the commits that landed meanwhile share no *file* with the bean. In marked 58% of the tasks edit `src/rules.ts` and 38% edit `src/Tokenizer.ts`, so almost every landing invalidated every in-flight check on those files. After three re-checks an attempt checks inside the committer lock, which serializes landing at 60 s per bean. On the designed arena, with hot files spread over `CHANGELOG.md`, `types.ts` and `routes.ts`, most landings took the optimistic path, and the checks paid for themselves by catching 17–23 reds before they landed. Here they caught none.

The pre-land checks used 78–80 minutes of test compute per race on top of 25 CI minutes; the queue used 8.

### 6.2 Harness issues found on the way (all fixed in `exp/e2-real-arena/race`; `research/race` is untouched)

1. **A CI slot could delete another CI's live git lock.** v2 runs two CI pools (sprout validation and the per-agent pre-land checks) whose worktrees are both called `slot-N`. Git de-duplicates their admin directories (`slot-0` and `slot-01`), but `CI.run` cleared `.git/worktrees/slot-N/index.lock` by name. A pre-land check starting in its slot 0 could therefore delete the validator's lock in the middle of a checkout. The first v2 seed-11 race died on it at 8.7 min ("unable to write new index file"). The fix records each slot's real git dir at setup. The bug is also in `research/race`, where the designed arena's tiny checkouts made the window too small to hit; **port the fix before the next designed-arena v2 race**, and give the Cloudflare runner's check slots unique names.
2. **The final check could not judge a task whose acceptance files include a fixture** (`t024`'s `bin-config-await.mjs` never appears in junit). It now judges only the files the suite reports on, and a fixture through the test that loads it. Fixed before any race; with all 24 reference solutions applied together, the check accepts 24 of 24.
3. **Authentication outage (before 15:20 HKT).** Every real race was scanned for invocations that failed with 403 / "not allowed" / login errors (`race/e2_authcheck.py RUN`): none did, in any of the six (the main races ran 14:01–16:09 HKT, the diagnostic 16:56–17:02; all 144 invocations ended `success`). Races queued after the outage notice ran a 1-turn Haiku auth check inside the slot first (`race/e2_drive.py`).

### 6.3 Diagnostic: v2 without the file-overlap re-check (one run, seed 11)

To separate the two mechanisms, one extra race ran v2 with `PRELAND_RECHECK=never` (an opt-in switch in `harness/policy_beanstalk_preland.py`; v2 as specified is the default). A green pre-land check lands on any textually clean re-squash, and a semantic break across files is left to sprout validation and revert-first. It went through its own replay gate first, and its budget was capped at $6.

| | Queue (seed 11) | v2 as specified (seed 11) | **v2, no re-check** |
|---|---|---|---|
| 10th / 15th / 20th green, min | 2.3 / 3.4 / 4.4 | 7.0 / 11.2 / 16.4 | **3.4 / 4.4 / 4.4** |
| Done, min | 4.4 | 20.5 | **5.4** |
| Pre-land checks (red) / re-checks / locked fallbacks | n/a | 76 (0) / 51 / 15 | **24 (0) / 0 / 0** |
| Validations (red) | n/a | 24 (0) | 7 (0) |
| Agent-minutes blocked | 0.25 | 156 | 25 |
| Agent finished → green, median | 2.7 min | 7.8 min | 2.8 min |
| Cost / final green correct | $1.56 / yes | $1.75 / yes | $1.47 / yes |

**The re-check rule accounts for nearly all of v2's loss.** Without it v2 ties the queue at the 20th green, finishes 1 minute behind it (5.4 against 4.4) and costs less. Every bean needed exactly one pre-land check; prefix promotion validated the 24 landings in 7 runs; nothing went red. The remaining gap at the first greens is v2's fixed latency: a 60 s check in the author's sandbox, then a 60 s validation, against one 60 s batch for the queue.

This is one run. It is also the favourable case for dropping the re-check, because nothing here interacts semantically. On the designed arena, whose couplings are semantic across files, "never re-check" would send those breaks to validation and revert-first instead of back to the author. The diagnostic sets the upper bound for a finer rule; it does not argue for "never".

## 7. Verdict

**No. On a real repository with real tasks and real tests, v2 did not beat the batched merge queue: the queue reached every milestone 3–4.7x sooner, at 11–14% lower agent cost and with the same correctness, on both seeds** (measured, marked, 24 tasks, Sonnet, 12 agents).

| Kill condition (`08` §5.3) | Real arena |
|---|---|
| ≥ 1.5x the queue on a comparable throughput measure | **Not met.** The queue is ahead at every milestone: 10th green 2.3 against 6.6–7.0 min, 20th 4.3–4.4 against 15.1–16.4, done 4.4 against 19.1–20.5 |
| Final green correct | Met by both (24 of 24 accepted, every race) |

**Why.** v2 beats a queue only where the queue pays for reds: every red batch resets its speculative pipeline (`08` §3, §5.2). This window gave it none. The fixes that survive a common base never collided as written (0 of 276 pairs, §5). The agents' own fixes collided once per v2 race and never in a queue race, and every first attempt was green. With nothing to recover from, v2's fixed overheads decide the race: the author is held through a 60 s check, the sprout validation adds a second 60 s before green, and the file-level re-check rule serializes landing on a hot file (49–51 re-checks, 13–15 locked fallbacks, all of them green).

**The diagnostic says the re-check rule is the decisive overhead.** With the file-overlap re-check switched off, v2 finished 5.4 min against the queue's 4.4 and tied it at the 20th green, at lower cost (one run, §6.3). So most of the gap is a fixable rule, not the fast-trunk idea. What remains, about one CI latency at the first greens, is the price of checking before landing *and* validating after.

**What this changes in `10` §6** (proposals, for the lead):
1. **v2's advantage is conditional on reds, not general.** The step-3 simulator assumes 25–30% of agent changes fail CI. With a real repo's own tests in every agent's sandbox and well-specified tasks, this window measured 0%. The designed arena (17–23% red pre-land checks) and this one bracket the question. The live demo should show both regimes, not only the designed one.
2. **Make the re-check finer than file overlap** (the diagnostic shows it is worth up to about 4x here): re-check only when the landed-meanwhile hunks are near the bean's own hunks, or check each bean on top of the beans ahead of it, as the queue's speculative batches do. A parser, a router table or a schema file makes "same file" the common case.
3. **Release the author while its check runs** (as `--no-queue-hold` does for the queue) and re-attach its session only on a red check.
4. **Adapt to the red rate.** While checks and validations stay green, behave like a batched queue (land in batches, validate once); switch to per-bean pre-land checks when reds appear. This is the job the error-budget controller was meant to do.
5. **The survivorship caveat stands** (§5, §8.1): the 15 changes this method had to drop are the contended ones v2 is built for. How v2 does on them is still untested on real history.

## 8. Threats to validity

1. **Survivorship (the big one).** Replaying history onto a common base keeps only the changes that never had to be reconciled with each other (§5). The 15 changes that built on earlier ones, where the contention lives, are out. This arena therefore under-states contention relative to the real window; the designed arena over-states it by design. Neither is the live repository.
2. **Prompts carry the fix.** Many marked PR descriptions are detailed analyses that name the regex, the line and the fix (#4072 quotes `src/rules.ts` line 98). Agents get them verbatim, as the brief asks. Tasks are easier than issue-only tasks would be, for both policies alike.
3. **Acceptance tests are the PR's tests, made task-owned.** Five tasks had cases or examples extracted from shared files (§3). The extraction is mechanical and validated (each extracted file fails on the base and passes with the solution), but an agent sees a file the original author never wrote.
4. **The spec time guard is off** and the two ReDoS-only fixes are excluded. Performance regressions are invisible in this race.
5. **Fewer tasks** (24 against 40) and **two waves** of work for 12 agents: milestones are k = 10, 15, 20 instead of 20, 30, 35, and tail effects have less room to compound.
6. **Shared, loaded machine.** Other experiments ran beside these races (one or two races at a time machine-wide, plus their validation runs). The suite takes 2–3 s quiet and 17 s or more under load; that lands on every CI run and pre-land check. Load averages at the start and end of each race are in the table.
7. **Seeds.** As in `08`, the seed changes nothing for Claude agents (tasks start in id order); runs differ only by agent nondeterminism and machine conditions.
8. **CI scope.** The race CI runs marked's functional tests (its UnitTests job). Lint and type checks are out, so a change that a real reviewer would reject on types can land here.

## 9. Cost

Agent spend at list price, as reported by the Claude CLI (billed to the Claude plan):

| Item | USD |
|---|---|
| Queue, seed 7 / seed 11 | 1.43 / 1.56 |
| v2, seed 7 / seed 11 | 1.66 / 1.75 |
| v2, seed 11, first attempt (aborted by the harness bug, §6.2) | 1.36 |
| Diagnostic: v2 without the re-check, seed 11 (§6.3) | 1.47 |
| Haiku smoke test (agent can run `run-tests`) and two auth checks | 0.02 |
| **Total** | **9.24** (cap $60) |

About $0.06 per task, the same as the designed arena's $0.06–0.07 per invocation. Replay races, validation and the contention profile cost nothing. Test compute is the other cost: v2 ran 78–80 minutes of pre-land checks per race on top of 25 CI minutes, against 8 CI minutes for the queue.
