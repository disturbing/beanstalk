# Beanstalk algorithm: optimization review

Codex, 2026-10-06. Reviewed the Claude design sets, especially Opus `09`, `11`, `15`, the experiment notes, the gateway's current v2 implementation, the Rust check runner, six 12-agent Cloudflare runs and the newer 30-agent pair. Source reviewed through `0880dae`, including the post-mortem, isolation study and scheduler fix that landed during this review. This review changes no engine policy. Proposed benefits are unmeasured.

**Subsequent update:** `d4e6bc4` re-pinned the changed burst30 outcome to 36 green / 4 parked and its earlier 35th-green milestone. The assertion mismatch recorded below is historical. [The deeper collaboration review](09c-thousand-agent-collaboration.md) continues through `3def4a1` and examines how to make 1,000 agents useful beyond the merge algorithm.

**Recommendation:** keep v2.5 with dependency starts as the measured baseline. Prioritize bounded recovery from an unrevertable red sprout, followed by shared diagnosis and reusable validation evidence. The longer-term opportunity is a graph connecting changes, failed assertions, decisions and test receipts, so evidence from one bean improves the treatment of the next. More concurrent agents and a larger speculative window are weak first bets.

**What Claude has already established.** [The living experiment summary](claude-opus/11-experiments-summary.md) supersedes the early fast-trunk thesis. Dependency starts, bounded speculation, informed repairs, structural merges, decision cards and tail limits already exist. Parking was added after the three 12-agent runs and is present in the newer 30-agent race. Tests first, targeted landing checks and live sync remain experiments, rather than measured improvements to this baseline. Claude's new isolation study also already proposes restoring the stalk and requeuing the red window. Recommending these as new inventions would repeat Claude's work.

The three-seed, 12-agent baseline is:

| Seed | Queue: green / 40 | v2.5 + dependency: green / 40 | Queue / v2: 35th green, min | Queue / v2: done, min |
| --- | --- | --- | --- | --- |
| 7 | 36 | 39 | 35.0 / 17.1 | 40.6 / 31.6 |
| 11 | 35 | 39 | 29.2 / 14.9 | 30.2 / 24.0 |
| 13 | 37 | 38 | 36.8 / 22.0 | 39.5 / 29.8 |

Sources: `research/race/runs/cf-queue-sonnet-12-s{7-landed,11,13}` and `cf-v25dep2-sonnet-12-s{7,11,13}`, each containing `summary.json` and `events.jsonl`. Seed 7 uses the queue's `-landed` run to match acceptance-test protection. All six final correctness audits pass. As in the existing `kth_green.py`, milestone times use the event clock; summary wall time excludes initial setup and the final audit. The analysis script also prints milestones normalized to `race.start`.

Across the three runs, v2 shipped **116 beans versus 108**, for **$15.5759 versus $13.1624** in agent cost. That is about **18% more total agent spend and 10% more agent spend per green**. These are short synthetic tasks, real agents, two validation slots and a configured 60-second CI delay. They establish a useful baseline, not a general production speedup.

**The 30-agent race changes the immediate priority.** `cf-demo-sonnet-30-s7` finished in **42.9 minutes with 36 green**, versus **38.7 minutes with 35 green** for `cf-queue-sonnet-30-s7`. The new Claude prose says the queue shipped 36; its saved `summary.json`, `summary.md` and green events all say 35. Both final audits pass. This is one seed with different union-merge settings between arms, so it is diagnostic evidence rather than a clean measurement of scaling alone.

Claude traces the stall to duplicate migration numbers that broke almost the whole suite. The system repeatedly isolated a culprit whose revert conflicted, then blamed new tests' innocent owners. A change that made the whole tree pass was ready at minute 14.95 but waited **11.8 minutes** for the speculative window. Extra CI slots would not repair that control-flow problem. The new `burst30` fixture reproduces the mechanism, although its stall is much shorter than the real one.

**New measurements from the existing logs.** These are a fresh aggregation, not additional races:

| Metric | Seed 7 | Seed 11 | Seed 13 | Total |
| --- | --- | --- | --- | --- |
| Pre-land checks | 89 | 70 | 90 | 249 |
| Re-check events | 24 | 16 | 25 | 65 |
| Dynamic culprit searches | 7 | 7 | 11 | 25 |
| Individual culprit probes | 40 | 40 | 52 | 132 |
| Searches confirming any culprit | 1 | 1 | 6 | 8 |
| Repeated check SHAs beyond first occurrence | 11 | 6 | 12 | 29 |

Seventeen searches returned no culprit. That does not prove they were unnecessary: some are genuine negative evidence, and some may have missed the right candidates. In seed 13, however, **five different beans rediscovered t007** between event-clock seconds 409 and 468. The current implementation does not turn these discoveries into a shared diagnostic result for the other beans.

Repair, reconciliation and test-author work account for approximately **57.5% of v2's agent spend**. After the last useful green, another **8.7 / 5.1 / 3.3 minutes** elapsed until `race.end`, excluding the final audit. Parking addresses part of that tail; it must not count a parked bean as shipped.

The 249 pre-land checks account for 319.8 aggregate check-minutes across concurrent sandboxes; 249 minutes are the configured artificial delay, and 58.2 minutes are reported suite execution. These are not wall-clock minutes. Any test-runtime optimization must be measured both with and without artificial delay.

**Scheduler finding, now fixed by the concurrent Claude work.** At `3ffe94f`, [the scheduler](../packages/gateway/src/engine/v2/v2-start-order.ts) defined in-flight work by excluding `landed`, `green` and `dropped`, but omitted `parked`. The shared terminal predicate in [tasks.ts](../packages/gateway/src/engine/tasks.ts) already included parking.

A direct call to the real `chooseStart` function with three parked coupled neighbours and one pending task returned `null`: wait for a landing. There was no running work to supply that landing. Changing only those neighbours to `dropped` selected the pending task. The Claude post-mortem independently identified the same problem and an ineffective aging bound: 60 starts at 30 agents, exceeding the entire 40-task backlog. Commit `8625191`, merged as `0880dae` during this review, excludes parked tasks, caps the aging bound by backlog size, and adds a timed stall escape. Re-running the reproducer now selects the pending task in both cases. Credit for the implementation belongs to that concurrent change.

**Validation finding at `0880dae`:** `pnpm check` fails `v2-burst30.test.ts:23`: the same simulation now yields **36 green / 4 parked**, versus its expected **37 / 3**; the final simulated stalk remains correct. The full check passed before this scheduler merge. Investigate which additional bean parks and why before updating the expectation: a scheduler improvement that reduces delivered work needs an explicit tradeoff assessment. This review leaves that engine test unchanged.

Two other code-level issues matter before sharing evidence more broadly:

- [Dynamic-search caching](../packages/gateway/src/engine/v2/v2-culprits.ts) keys results by bean ID and named counterpart IDs. It omits the checked tree, failing assertions and acceptance-test revisions. A later failure on changed inputs can reuse an old empty answer. Keep the bounded-search policy, but distinguish an unchanged proven result from a search budget that has been exhausted; changed inputs invalidate proof, even when the budget prevents another search.
- [Flake confirmation](../packages/gateway/src/engine/v2/v2-validator.ts) can classify a validation as green when two red runs fail different files. That is the current documented policy, not an observed failure in these three runs. It is weaker than obtaining a fully passing suite. A receipt system must preserve this distinction: two different failures are not a passing receipt. Require an actual green execution, or an explicit test-level flake policy, before describing a snapshot as fully verified.

**1. Recover adaptively, and preserve a path for a proven repair.** Highest-priority experiment after the 30-agent evidence.

Claude's restore-and-requeue proposal is a sound fallback direction: an ancestor's tree can be reconstructed even when an individual reverse patch conflicts. The extension I recommend is to choose recovery by the damage and available evidence:

- Keep a cheap clean revert for an isolated culprit.
- Give a full-suite-green repair of the **current exact sprout** a reserved recovery turn even when the ordinary window is full. Re-compose and re-check if that head moves. This formalizes the escape route already noted in Claude's side experiment; being a self-described fixer is insufficient.
- On a confirmed broad break with a failed revert, restore the trusted checkpoint once and replay affected beans. Initially replay the whole bounded window. Later, use dependency witnesses and exact receipts to preserve independent work and re-execute only the affected portion.

Make recovery an explicit generation with a manifest of bean revisions, carried test amendments, decision versions and the previous speculative head. Preserve the old candidate; reject stale check, ticket and publication results from the old generation. Reconcile task statuses and acceptance-test ownership when replaying. Resetting a ref alone leaves those other states wrong. The stable stalk must continue to represent accepted, verified work.

The isolation study's 0.1-minute recovery restores an already verified checkpoint. It is **not** the time to deliver the displaced features again. Its author explicitly excludes replay ordering, replay conflicts and culprit rework. Measure those in the real engine before adopting the broader recommendation to remove all bisection. Add cases with no lucky forward fixer, simultaneous ticket results, in-flight publications and decisions changing during replay.

A cheap prevention experiment belongs alongside recovery: when migrations or their registry change, run a project-defined migration-uniqueness/load check on the exact composed tree, even if ordinary file-overlap sampling skips a full re-check. Disjoint migration files can violate one shared invariant. This is a narrow use of the existing targeted-check idea, selected by semantic risk rather than shared filenames.

**2. Diagnose individual failures, share discoveries, and probe small groups.** The next algorithm experiment.

Today a probe removes one bean, runs the full suite, and confirms that bean only if *all* of the arriving bean's originally failing test files stop failing. If A breaks one assertion and B breaks another, removing either leaves the check red and the algorithm can name neither. This differs from a simple A-and-B interaction where removing either does cure the failure. The t032 notes describe the former problem, compounded by both relevant old changes falling outside the recent candidate shortlist.

Change the diagnostic unit from “bean's entire failing set” to an identified assertion and error signature. Record which failures disappear under each intervention. For suite startup failures, group reports by the shared load error before blaming the individual test owners. Keep the comparison's assertions fixed: a test absent from an earlier prefix is unobserved, not passing. Run an appropriate protected test overlay where it is executable; otherwise return unresolved. This directly addresses the innocent-owner error in the 30-agent study. Rank suspects by stack locations, confirmed earlier witnesses and changed executed code, with test ownership interpreted in that context and recency as a tie-breaker. Coverage ranking was already tested in E6; the extension is to preserve and share the resulting evidence.

When single removals do not clear the target failures, try a small budget of grouped removals among the strongest candidates. Establish a valid passing comparison before minimizing a removal set. Retain a third outcome, `unresolved`, for invalid builds, missing tests and timeouts. Require the named tests to have actually executed. A reduced removal set is a contextual repair witness, not proof that the product specifications are contradictory. Delta debugging supplies the subset/complement reduction technique and the distinction between a 1-minimal result and a globally smallest cause. [Primary explanation by Andreas Zeller](https://www.debuggingbook.org/html/DeltaDebugger.html).

Publish the witness to other affected beans: on identical inputs reuse it; on related trees prioritize the suspect and run a cheap confirmation. Five discoveries of t007 should become one investigation with several consumers. Apply a resource budget across searches sharing a runner; the current probe cap is per landing flow, so concurrent searches can still compete for the same underlying capacity.

Measure targeted test executions, probe wall time, suspect recall, reworks and greens at fixed time. Include a single culprit, two simultaneous blockers, a three-party contract clash, an invalid revert and a flaky assertion. Do not infer the time saved by multiplying all 132 probes by an average duration: they overlap, and the logs do not expose every probe's elapsed time.

**3. Reuse check receipts across integration stages.** First reuse exact inputs; expand to affected tests only after measuring dependency completeness.

The current runner creates a checkout and runs the suite for each request. A full trusted pre-land check and a later validation can cover the same tree. The logs contain 29 repeated SHA occurrences, but SHAs alone do not establish identical check inputs; some repeats are intentional flake confirmations.

Use a receipt key covering repository/trust scope, effective tree, accessible commit metadata, extra test-file contents, selected tests and command, runner image/toolchain, dependency lock state, environment/fixture versions and the applicable decision/test epoch. A deterministic, trusted full-suite receipt may satisfy an equivalent later check. Flake-confirmation attempts must execute afresh. Do not treat a targeted receipt or an agent's own report as a full validation.

Then try dependency-scoped receipts: retain evidence for unaffected hermetic checks and rerun affected checks on the newly composed tree. This extends the existing targeted-landing option by reusing results across pre-land, diagnosis and validation. Bazel's action cache is the relevant model: actions describe their inputs, command and environment. [Bazel's documentation](https://bazel.build/remote/caching).

The runner's current “read set” is a regex-based closure of relative imports. It is useful for ranking; it is not a complete account of dynamic file reads, aliases, generated inputs, environment, network or database state. Unknown inputs therefore force a fresh check. Observed coverage alone is also insufficient to prove that a changed execution cannot take a new path. Retain full combined-tree validation while learning these boundaries.

Measure complete-key cache opportunities in shadow mode first, separately reporting intentional reruns. A fair algorithm comparison gives the queue the same runner cache and measures actual compute saved as well as latency.

**4. Resolve connected contract decisions once, with versions.** The most distinctive product/algorithm extension.

The engine can provide three parties to reconciliation, but its card still chooses a pair. A result may depend on formatting, tax and shipping policy simultaneously. Independent pair decisions can leave the third assumption unchanged, invalidate previous test amendments, and send a bean through another repair cycle.

Represent a discovered conflict as a small set of involved intents, assertions and contract keys, with a versioned decision record. For t032 that would assemble the relevant email-total and shipping rules before the author starts another repair. Ask for one coherent contract decision, amend the affected tests together under that decision, then re-execute and check the exact combined result. Existing protected tests and explicit authority over spec changes remain essential; a model failing to reconcile is not a proof of impossibility.

Include that decision version in prompts, search-cache keys and receipts. When it changes, wake only the parked beans whose recorded blocking assumptions changed. This extends Claude's contract transactions and decision memory with a concrete invalidation rule and a multi-party unit of resolution.

Measure decisions and re-executions per resolved contract, repeated failure signatures and wrongly amended tests. A successful experiment ships the same intended behavior with fewer repeated cards; making tests weaker is a failure.

**5. Schedule by expected verified progress, using separate dependency and conflict signals.** Build on dependency starts instead of replacing them wholesale.

The current scheduler uses predicted-module overlap, a fixed limit of two in-flight clashes and the number of tasks in the longest chain. It discards modules predicted by more than one-third of tasks. It does not weight task duration or confidence. The measured predictor's module recall is about 44–46%, so hard serialization on these signals would be expensive and still incomplete. E5 already found that broad observed-read overlap could serialize too much work.

Separate true prerequisites from possible interference. Preserve hard prerequisite ordering and the aging guarantee. Rank ready work by expected greens unlocked per unit of constrained agent/runner time, including repair cost, downstream critical-path time and reusable evidence. Treat generic module overlap as a weak signal; elevate confirmed failure witnesses and explicit contract dependencies. Update those weights as beans land and probes resolve. Keep fallback behavior when evidence is sparse.

This combines established ideas rather than inventing scheduling from scratch: Cassandra distinguishes precedence constraints from potential conflicts, while Uber's SubmitQueue prioritizes speculative builds using likelihood of need and completion-time estimates. Beanstalk's extension is to include *agent repair and contract-resolution cost* in the objective. [Cassandra paper](https://epiclab.github.io/publications/icse13-kasi.pdf), [Uber's explanation](https://www.uber.com/us/en/blog/slashing-ci-costs-at-uber/).

For scale, cache the overlap graph and chain ranks between changes that actually invalidate them. `chainHeights` currently scans task pairs for each selection: a dispatch sweep can approach cubic work as the backlog grows. This is a code-complexity observation, not a measured bottleneck at 40 tasks. Benchmark the scheduler alone at 1,000 and 10,000 tasks before changing its data structures.

**6. Allocate validation effort to expected progress and information.** A later controller experiment.

Keep the global unvalidated-work safety cap. Add local re-check statistics so green checks in a quiet area do not cause aggressive skipping in a different hot area. A probe that can unblock five beans may deserve capacity before another validation of a head still containing the same known cause. Conversely, stop redundant diagnosis once an equivalent investigation is running.

Budget speculative work by estimated validation/repair seconds and oldest unverified age, alongside the commit-count cap. Eight trivial changes and eight broad contract changes are different risks. Grow the budget only when actual validation service rate supports it. Local budgets do not make separate module greens composable automatically: the exact combined stalk still needs its required evidence.

Claude already tested unconditional “validation first” and it lost. The proposed rule is conditional on the expected number of beans unblocked and the information a job adds. Compare against the current AIMD controller on bursty, calm and mixed-duration workloads. Reject a controller that makes headline throughput better by increasing parked/dropped work or delaying old beans indefinitely.

**Recommended experiment order.** Investigate the changed `burst30` outcome after the scheduler fix. Test recovery and its reserved turn against that fixture, including replay conflicts and a case with no lucky fixer. Make the engine simulator charge for probes and finite runner capacity before using it to rank policies; the original tail notes explicitly say its probe time is zero, while the newer isolated-episode study does charge probe time but omits replay work. Then test shared, targeted diagnosis with proper evidence invalidation, followed by exact-input receipt reuse. Multi-party decision versions and weighted scheduling follow once those measurements provide reliable inputs.

For every arm, report verified beans at fixed horizons, time to the same k-th green, total and per-green agent/infra spend, queued-to-green p90, and parked/dropped beans separately. Count waiting before dispatch so the scheduler cannot improve latency merely by delaying starts. Preserve independent correctness audits. Use held-out task orders and workloads beyond the existing arena; three old seeds already used to tune the policy are useful regressions, not an unbiased final evaluation. Rerun the strongest finalists with real agents, since Claude's v2.2 collapse and v2.5 phase matrix show that replay rankings can be wrong.

**Reproduce this review's local evidence:**

```bash
python3 research/algorithm-review/analyze.py
node research/algorithm-review/parked-start.mjs
```

Both commands are read-only and use existing local files. The second imports the real scheduler: it reported `null` for parked neighbours versus `next` for dropped neighbours before the fix, and `next` for both after `0880dae`. No model calls, cloud jobs or new paid races were started for this review.
