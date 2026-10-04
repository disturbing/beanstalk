# Ideas: 35 ways to make thousands of agents productive on one codebase

These are additive to `claude-11` (43 ideas) and Codex `02` (18 ideas). I read only their titles before writing this list, and marked any overlap ("extends `claude-11` #N"). Ideas 1–4 are the core of `02-thesis-concurrency-control.md`; the rest stand alone.

Each idea has four parts:
- **What:** the idea.
- **Why:** the evidence (sources in `01-evidence.md` and `research/`).
- **Cloudflare:** how it maps onto the platform.
- **Kill it if:** the result that would prove it wrong.

The first three ideas also say how they show in a demo.

---

## A. Scheduling and concurrency

**1. Footprint-aware dispatch (Cassandra for agents).**
- **What:** Predict which modules each intent will touch, build a conflict graph, and start only tasks that don't collide. Overlapping work is chained (it starts after the other task lands) or co-assigned to one agent.
- **Why:** Different agents' PRs conflict 41.7% of the time. Locks reduced 20 agents to the throughput of 1–3.
- **Cloudflare:** The scheduler is a Durable Object. Code proposes candidate modules, and Jev answers one Noul question per module.
- **Kill it if:** Placement doesn't cut the collision rate against random placement on the same task set.

**2. Isolation levels as policy.**
- **What:** Per path, choose how a change lands:
  - `fast`: merge now, validate later.
  - `snapshot`: no write-write overlap allowed.
  - `serializable`: validate reads and run tests first.
- **Why:** It turns the speed-versus-safety argument into a setting.
- **Demo:** Flip `packages/billing` to `serializable` live and watch its lane slow while everything else keeps flowing.
- **Kill it if:** Teams never move off the default.

**3. Error-budget controller.**
- **What:** The fast trunk may be "a little red", by explicit budget. Over budget, the controller moves agents to fixing, tightens isolation on paths that keep breaking, and slows admission. Under budget, it relaxes.
- **Why:** Cursor found the efficient system "accepts some error rate".
- **Demo:** A gauge, plus a visible change in how agents are allocated when the gauge crosses its line.

**4. Causal repair tickets.**
- **What:** When the validator goes red, the ticket names the commits whose read and write sets meet at the failing symbols, along with both intents and transcript summaries. It goes to the later commit's agent if that agent is still alive.
- **Why:** A raw red check sends an agent searching; a cause sends it straight to the fix.
- **Kill it if:** Repair time with a ticket is no shorter than with a raw failing log.

**5. Reservations with aging for big changes.**
- **What:** A large refactor reserves its predicted footprint for a bounded window. New overlapping work isn't placed there, but running work isn't blocked. Reservations lose priority as they age.
- **Why:** Long transactions starve under optimistic concurrency, a textbook result.
- **Kill it if:** Reserved refactors still miss their windows. The fallback is #6.

**6. Recipes, not diffs.**
- **What:** Mechanical changes are submitted as programs (an ast-grep, Comby or jscodeshift codemod plus a residual patch). When trunk moves, the committer re-runs the recipe on the new head instead of rebasing text.
- **Bonus:** "Apply the same rename to `release/2.3`" becomes one click.
- **Cloudflare:** Recipes run in the committer's Sandbox. The recipe is stored in the change's git note.
- **Kill it if:** Less than about 10% of agent changes are expressible as recipes. Measure it on the demo repo's history.

**7. Commutative merge drivers for hot files.** Extends `claude-11` #11.
- **What:**
  - Lockfiles are regenerated, never merged.
  - Changelog and registry entries merge as set unions.
  - Migration numbers are **assigned at commit**, like database sequences, not chosen by the agent.
- **Why:** Hot files cause most of the *spurious* conflicts.
- **Cloudflare:** Drivers live in `.beanstalk/merge.toml` and run in the committer.

**8. Self-organizing integration clusters.**
- **What:** Run community detection on the live conflict graph. Agents that keep overlapping are grouped into a cluster with its own sub-trunk and fixer, which lands into the fast trunk as a unit. Re-cluster every hour.
- **Why:** This is the Linux kernel's lieutenant model, except the hierarchy redraws itself as work moves.
- **Kill it if:** Clusters churn every hour. That would mean the overlap structure isn't stable enough to exploit.

**9. Pairwise early-warning merges (Crystal for agents).**
- **What:** For each *edge* in the conflict graph (not every pair, so O(edges) rather than O(n²)), merge the two forks in the background and run the affected tests. Warn both agents before either finishes.
- **Cloudflare:** Cheap structured merges in a Worker for small repos, a Sandbox otherwise.
- **Kill it if:** The warnings arrive too late to change anything, which you can measure as time-to-warning against time-to-finish.

**10. Stigmergy markers.**
- **What:** Agents drop typed, decaying markers on symbols ("fragile", "migrating to v2", "investigating #12", "don't touch until 15:00"). The context API returns markers whenever an agent reads the symbol. Markers fade unless refreshed, and the canvas shows them as heat.
- **Why:** Ants coordinate without messaging. Messages between thousands of agents don't scale; notes left on the code do.
- **Kill it if:** Agents measurably ignore them. Compare behavior with and without markers.

**11. A process table for agents.**
- **What:** `bean ps`, `pause`, `resume`, `kill`, `nice`. Budgets work like resource limits. `kill` reaps the fork, the previews and any containers.
- **Why:**
  - One user reports 826 parallel Codex agents and about $78k spent (unverified).
  - A VS Code agent created 1,526 worktrees in 16 hours.
  - The forge should be the operating system the agents run under, not only a disk they write to.

## B. Verification and trust

**12. Fail-first test proof.**
- **What:** A new or changed test must fail on the base commit and pass on the head. Otherwise it is labelled "proves nothing" and the change can't use it as evidence.
- **Why:** 25% of agent-added tests in one sample passed against the old, broken code.
- **Cloudflare:** One extra test run in the validator, deduplicated by tree hash.

**13. Test weakening is a privileged change.**
- **What:** Changes count as weakening when assertion counts drop, a test is newly skipped or marked expected-to-fail, a test is deleted, or a snapshot assertion loosens. Weakening needs a human or an independent verifier. The agent's own green is never enough.
- **Why:** "An agent told me all tests passed. It had deleted the one that failed."

**14. Behavior-delta declarations.**
- **What:** Each change declares one of two things:
  - **"No behavior change"**: checked by differential testing, running old and new builds on the same recorded preview traffic and property tests.
  - **A spec delta**, in plain language: humans review the spec delta, not the code.
- **Why:** Reviewers can't read agent-volume diffs. They can read "checkout now rounds tax per line instead of per order."
- **Kill it if:** Differential runs flake more than about 5%.

**15. Tested-tree attestation.**
- **What:** Each green promotion carries a signed statement that the tree hash promoted equals the tree hash tested.
- **Why:** The 2026-04-23 merge-queue incident (2,092 PRs) is exactly this failure, and it makes a one-line sales pitch.

**16. Governance the agents can't reach.**
- **What:** Branch rules, isolation policy, merge drivers and code owners live in a separate admin repo. No agent is ever given its write token.
- **Why:** An agent used the API to disable branch protection and force-push to main (Claude Code #42849). With Artifacts' per-repo tokens, this becomes a structural guarantee, not a setting.

## C. Economics, intake and open source

**17. Intake bonds for unknown agents.**
- **What:** An unknown external *agent* posts a small refundable bond with each PR, in credits or x402 USDC. The bond is refunded on merge or good-faith close, and forfeited if a maintainer marks the PR spam. Humans and vouched contributors are exempt by default.
- **Why:**
  - Merged PRs went from 25M to 90M+ a month.
  - x402 bounty markets already pay agents $1–2 per patch.
  - The cost to propose should be at least the cost to review.
- **Kill it if:** It deters legitimate contributors. Watch the exemption rate. Payments may also raise compliance questions; see `07`.

**18. Per-agent quotas, budgets and itemized bills.**
- **What:** Every agent principal gets its own rate limits, CI-minute budget, Artifacts-ops budget and spending cap, and its own line on the bill.
- **Why:**
  - Limits are "per-key, not per-agent".
  - One agent's burst got a human's whole account flagged.
  - GitHub's own agentic-workflows repo lost writes to a shared token budget.

**19. Disclosure without punishment.**
- **What:** Provenance is a signed platform record, not a commit trailer anyone can strip. Maintainers set policy ("no unattended agent PRs on this repo") and the platform enforces it.
- **Why:** Co-authored-by trailers are being proposed as ban signals, so people strip them, so provenance erodes.

**20. Accept the idea, not the patch, for outsiders.** Extends `claude-11` #37.
- **What:** External contributors submit an intent with acceptance criteria. If maintainers accept it, *their* swarm implements it under the repo's own policies.
- **Why:** This inverts the slop problem. Outsiders contribute judgment, and the repo contributes the labor.

## D. Context and reads

**21. The context API as the only read path for agents.**
- **What:** Point queries (file at SHA, symbol, references, search, merge base) served from the edge and cached forever by SHA.
- **Why:**
  - Datadog found most agent Git reads are point queries, not clones.
  - It feeds read sets (#1, #4).
  - It removes clone storms.
- **Kill it if:** Agents keep cloning anyway because their harness insists.

**22. Task slices.**
- **What:** A task mounts a lazy, sparse view (ArtifactFS-style) of its predicted footprint. Reading outside the slice works, but expands the footprint and tells the scheduler.
- **Why:** The slice *is* the declared read set, at no extra cost to the agent.

**23. Assumption blame.** Extends `claude-11` #16 (why-blame).
- **What:** For any line, show which symbols its author's change *read* (its assumptions) and which later commits changed those symbols.
- **Why:** It answers "this was right when written; what made it wrong?"

## E. Thousands of agents on one idea

**24. Tournaments with forced diversity.** Extends `claude-11` #39.
- **What:** When N agents attempt one intent, the planner gives each a different approach: "with a cache", "without new dependencies", "by deleting code". Attempts are scored by checks plus a Jev rubric. Losers are archived with their lineage.
- **Why:** Without assigned diversity, N attempts converge on one idea N times. Best-of-N only pays if the attempts are actually different.

**25. Hypothesis branches.**
- **What:** A branch carries an experiment spec (metric, threshold, traffic share). Its preview gets a slice of real or synthetic traffic, the results attach as evidence, and green adopts the winner.
- **Why:** It turns "ideas" into the unit that thousands of agents can explore in parallel.

**26. The plan on the map.**
- **What:** The planner's intent graph is drawn over the code map. Humans edit the *plan*: drag an intent, cut one, merge two. Agents pick up the changes.
- **Why:** At swarm scale, the plan is the thing humans can still steer.

## F. Interface (detail in `04-canvas-second-opinion.md`)

**27. One query layer, two renderers.**
- **What:** Every canvas view is a typed query. Humans get pixels; agents get the same answer as JSON through MCP (`ask_repo`).
- **Why:** Humans can see exactly what the agents saw.

**28. A type-ahead canvas.**
- **What:** Jev answers in about 200–400 ms for a fraction of a cent, so the view re-routes as the user types.
- **Why:** A frontier LLM can't match that latency at that price.

**29. Views as reviewed code.**
- **What:** When no card answers a question, Claude drafts a new card type overnight and opens it as a change. A human approves it on a preview, and the catalog grows from real questions.

**30. Replay the swarm.**
- **What:** A time scrubber over the trunk log showing who read and wrote what, where, and when. It debugs a bad hour, and it opens the demo.

## G. Wild cards

**31. A prediction market on changes.**
- **What:** Agents and humans trade on "will this change be reverted within 7 days?", using the LMSR design already sketched for the thesis-terminal Arena. Prices become a risk signal that decides where human review goes. Compare the price against Jev's risk score.
- **Kill it if:** Markets are too thin to move, which is likely below a few hundred trades a day.

**32. Fork the whole org.**
- **What:** Artifacts makes 10,000 forks cheap. Fork every repo plus the plan to *simulate* a cross-repo migration (a framework upgrade across 40 repos) with agents, measure the blast radius, then replay it for real as recipes (#6).

**33. Negative-latency CI.**
- **What:** Start running the predicted footprint's tests on the fork's latest push *before* the agent says it's done. By commit time, most evidence exists.
- **Kill it if:** Wasted runs cost more than the latency saved.

**34. Crash-proof agents.**
- **What:** A fork, transcript pointer and read log together form a checkpoint. When an agent dies, the scheduler hands the task to a new agent with the same slice and a summary of where the last one stopped.
- **Why:** Cursor's executor "would sleep randomly, stop running agents". At scale, agents die all the time.

## H. A separate track: Actions on isolates

**35. `runs.using: worker` (bonus).** Many workflow jobs only call the platform's API: labelers, stale bots, release notes, triage, `github-script`.
- **What:** Run those in a **Dynamic Worker** with Node-compatible shims for `GITHUB_OUTPUT` and `GITHUB_ENV`. They start in milliseconds instead of a 1–3 s container cold start plus runner boot.
- **Limits:**
  - No child processes or native add-ons.
  - At most 4 Dynamic Workers in flight per request and 10 per Durable Object, so fan out across DOs.
  - Allowlist the actions that qualify.
- See `05-github-actions-on-cloudflare.md`.

---

## Questioning the list

**Probably theatre unless proven:**
- **#10 stigmergy:** agents may ignore markers.
- **#31 prediction market:** too thin.
- **#17 bonds:** payment rails bring ethics and compliance weight.
- **#14 behavior deltas:** differential testing is hard to make deterministic.
- **#25 hypothesis branches:** needs real traffic.

Each has a kill condition above. Run the cheap test before building UI for any of them.

**Boring, valuable and nearly free:**
- #12 fail-first tests
- #13 test-weakening gate
- #15 tested-tree attestation
- #16 governance repo
- #18 per-agent quotas
- #21 context API

These answer the most common complaints in the research and need little invention. Ship them whatever thesis wins.

**What judges reward (50% originality):**
- #1–#4 (scheduling, isolation, budget, causal repair), shown as the A/B race
- #27–#28 (shared query layer, type-ahead canvas)
- #30 (replay)

Nothing else in the research shows a forge *placing* agent work before it starts, or tuning correctness with a live dial.

**A gap even this list leaves open:** neither this list nor the other sets explains how a human with 20 minutes a day stays *meaningfully* in charge of 3,000 agents. Green deltas, decision cards and the editable plan (#26) are the attempt. The usability test in `04` is where that claim lives or dies.
