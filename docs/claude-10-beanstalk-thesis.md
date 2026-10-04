# beanstalk thesis: a forge where agents work in forks, humans choose between worlds

Written 2026-10-03. This is the design I would build for the competition and the argument for it. It is deliberately opinionated; `claude-14-self-critique-and-decisions.md` attacks it. Vocabulary is chosen so a judge understands it in ten minutes; the beanstalk metaphor stays in the logo.

## One sentence

GitHub makes humans wait in a queue to merge one branch at a time; beanstalk lets as many agents as you can afford work in their own forks, continuously assembles their changes into runnable **worlds**, proves each world with evidence, and asks a human only to choose between worlds.

## Why this and not "GitHub with agents"

The judging rubric is 50% originality of the collaboration model, 25% concurrency/coordination/context/review/conflicts, 25% UX. The evidence from the field (Codex memo 01, `claude-01` to `claude-07`) says the pain is not writing code; it is:

- review queues that grow faster than review capacity (review time up 91%, PR size up 154% on AI-heavy teams; main-branch throughput falling while feature-branch throughput rose 59%);
- agents stepping on each other (textual conflict rates of ~20% same-agent and ~42% cross-agent pairs when PRs overlap in time; Cursor's swarm collapsing to the throughput of 1-3 agents when 20 shared locks);
- lost context ("why did the agent do this?") and reviewers who refuse to read transcripts;
- CI minutes burned on stale candidates and merge queues that re-test the same combination;
- identity and trust: whose token, whose approval, what did the agent actually verify.

Every incumbent fixes one of these by changing one primitive (storage, review unit, provenance, coordination; see `claude-03`). None changes the *integration* step, which is where all five pains meet. So that is the primitive beanstalk changes.

## The eight objects

| Object | What it is | Backed by |
|---|---|---|
| **Trunk** | The canonical line of a project. Advances only by accepting worlds. One single-writer Integrator per trunk. | One Artifacts repo + one Durable Object (the Integrator) |
| **Intent** | A desired outcome: title, acceptance criteria, constraints, budget, owner, scope hints (paths, symbols, contracts). Intents form a DAG. | DO SQLite rows in the project DO; mirrored as `.beanstalk/intents/*.md` in trunk so it is git-portable |
| **Sprout** | One agent's isolated workspace: an Artifacts fork of trunk at a pinned base, plus a sibling *context repo* holding that agent's prompts, notes, and decisions. An agent only ever pushes to its own sprout. | `env.ARTIFACTS.get(trunk).fork("sprout-<id>")` twice (code + context); repo-scoped token for that agent only |
| **Bean** | The unit of acceptance. Stable ID across revisions (like a Gerrit change or jj change-id). Carries: diff, base, declared impact, a one-paragraph *why*, provenance (agent, model, session, prompt hash in git-notes), handoff notes, and attached evidence. Beans can depend on beans (stacks). | git-notes on the sprout tip + DO row; export as a PR for GitHub mirrors |
| **World** | An exact combination: trunk SHA + ordered set of bean revisions, materialised by a Container job (clone trunk, apply the beans, run the checks) and pushed as a branch `world-<hash>` of the project's connected repo so Workers Builds gives it a preview. Two kinds, deliberately bounded: the *frontier world* the Integrator is proving right now (one per trunk) and *alternative worlds* pinned to an open decision (at most two per decision). Worlds are what humans compare and choose. | Branch on the connected trunk repo, built by a Container job; Workers Builds preview or Sandbox port |
| **Evidence** | A signed receipt from a trusted runner: check definition, inputs (exact SHAs), runner image, outcome, artifacts (logs, screenshots, traces). "The agent says tests pass" is a claim; a receipt is evidence. | Containers/Sandbox runner → R2 object + DO row. Signing only matters once a public key and a one-file verifier are published; until then it is not advertised as signed |
| **Lease** | An advisory, expiring claim on a scope (paths, symbols, routes, schemas) with a fencing token. Overlap is computed from actual diffs (tree-sitter symbols), not just declarations. Warns; never blocks. | DO rows with alarms |
| **Decision** | A recorded human or policy choice between alternatives, with rationale, citeable by ID, supersedable. The *decision inbox* is where human attention goes. | DO rows; mirrored to `.beanstalk/decisions/` |

Everything above has a URL and an MCP tool. The web UI (`claude-12`) is one MCP client among many.

## How thousands of agents work concurrently without touching each other

**1. Agents never share a repo.** Each sprout is its own Durable Object, so pushes from 10,000 agents hit 10,000 single-writer objects and scale linearly (Cloudflare: "millions of repos every day"). This is exactly the copy-on-write-plus-dedup answer Cursor asked for in their swarm post. Artifacts forks are the primitive; ArtifactFS blobless clones keep sprout start-up in seconds even on large trunks.

**2. The Integrator is a speculative batch queue with three differences.** It groups compatible beans, proves the batch and bisects on red, as bors, Mergify and Uber's SubmitQueue do; the differences are that conflicts are dispatched as work instead of ejected, losing alternatives are kept with their evidence and offered to a human, and trunk never receives an agent push. Concretely:

- It groups beans into a candidate world greedily by compatibility (no file/symbol overlap first, then overlapping beans that apply cleanly).
- It materialises the world in a Container (clone trunk, apply the beans, run the project's checks; worlds per hour = container concurrency divided by minutes per world) and pushes it as a `world-<hash>` branch, then lands it as a fast-forward of trunk when the policy's required evidence is green. The gate is not removed, it is amortised over a batch, and conflicts no longer stall it.
- On failure it bisects the batch (bors/Zuul style) and lands the green prefix; the failing bean is sent back with the receipt.
- Beans that no longer apply cleanly are **not** blocked: the Integrator forks a *resolver sprout* containing both sides and the bean's intent and dispatches a resolver agent. Conflict resolution is just another bean with evidence. Conflicted states are storable, like jj.
- Throughput: trunk advances in batches. For beans no human needs to see, latency is evidence time plus bisection rounds (k red beans cost about k·log₂ n rounds). A bean that reaches a decision card waits for the human, is then re-materialised on the current trunk and re-proven before landing; the card says how many batches landed since it was built. Trunk never sees agent push traffic at all.

This takes Cursor's finding seriously (a single gate that every change must pass one-at-a-time is "red tape"; requiring 100% correctness per commit serialises everything) while keeping what they gave up (a trunk that is always green and explainable). Turbulence lives in worlds, not in trunk.

**2b. Admission control runs before the queue.** Projects set budgets: active sprouts, concurrent evidence jobs, previews, alternative worlds. Beans are admitted by intent priority and age with a cap per principal. A bean whose intent is already satisfied is superseded at enqueue, never tested. A resolver sprout is dispatched only while the bean's intent is still open, at most once per bean, and resolvers are batched after a landing rather than spawned per conflict, because at the measured 40% cross-agent conflict rate (`claude-02`) a naive rule turns every landing into hundreds of new conflicting beans and the largest compatible batch among 1,000 beans is only about 27. Refusing or deferring work is a feature, and the budget is on screen.

**3. Intents, not branches, are the coordination surface.** An agent claims an intent (lease with expiry and fencing generation), gets a sprout, publishes scope hints. Other agents see live overlap: "two sprouts are editing `billing/invoice.ts::computeTax`", computed from diffs on every push: path level in v1 from `readTree` on both sides (pushed events carry no file list, so this is the hot path and it is billed per operation), symbol level with tree-sitter later. Response is advisory: warn, suggest a contract, suggest sequencing, or spin up a *contract bean* (a shared interface both depend on). No locks, because Cursor showed agents cannot hold locks.

**4. Context travels with the fork.** The context repo is forked with the code repo, so forking a sprout mid-task (to try two approaches) forks the agent's memory too. Handoff notes ("what was done, concerns, deviations, findings", what Cursor's workers were made to produce) arrive through an MCP call, a `.beanstalk/handoff.md` in the sprout, or commit trailers. A plain `git push` without one still produces a bean, with a draft note generated from the diff and marked unverified, which lowers its triage priority instead of blocking it; that keeps "tools work unchanged" true. The review surface shows the bean's *why* and evidence; the transcript is one click away for audit and queryable by agents, never the default view (what HN told Zed and Entire).

**5. Alternatives are kept, not deleted.** When two beans target one intent and one lands, the other is marked *superseded* with its evidence preserved ("roads not taken"). Supersession propagates: its runs are cancelled, its dependents re-based. This both saves CI money (the stale-candidate waste in memo 02) and gives the canvas an honest history of what was tried.

**6. Review is three layers, and humans only see the top.**
- Layer 0, deterministic: build, tests, lint, type check, contract diff (OpenAPI/GraphQL/schema), bundle size, dependency diff. Receipts.
- Layer 1, independent challengers: a different model, with hidden fixtures, tasked to falsify the bean's claims and to write a failing test if it can. Their output is evidence too.
- Layer 2, triage and escalation: a cheap typed judge (TypeSafe Jev: Choice/Score/Noul, ~300 ms, $0.04 per thousand items; `claude-12` has the honest capability notes) ranks beans by risk and routes them: auto-land, challenge, or human. Only genuine forks ("keep compatibility or break callers?") should reach the decision inbox, framed as a choice between two worlds with previews. The router is measured, not trusted: every route is logged against the human's eventual decision, one in ten auto-landed beans is sampled for human audit, and a path whose agreement drifts loses auto-land, the discipline Steward already demonstrates.

**7. Deploy is choosing a world.** Each world has a preview (Workers Builds preview on branch push, or a Sandbox port for arbitrary stacks). Trunk deploys via Workers Builds. Canary = route a slice of traffic to world B. Rollback = choose the previous world. "How you decide what gets deployed" (the brief) becomes a visible comparison, not a merge button.

## What stays boring on purpose

- **Git protocol.** Sprouts are real git remotes with repo-scoped tokens. Claude Code, Codex, Cursor and plain `git push` work unchanged. Beanstalk metadata rides in git-notes and a `.beanstalk/` directory, so a trunk can be mirrored to GitHub and beans exported as PRs.
- **Linux CI.** Existing `.github/workflows/*.yml` run on Containers with a compatibility report (`claude-05`).
- **Issues.** An intent is an issue with acceptance criteria. Nothing new to learn.

## Scale envelope (what we can claim honestly on stage)

| Dimension | Design limit | Why |
|---|---|---|
| Sprouts | Bounded by storage and budget, never by contention | One DO each; every fork duplicates storage against the 1 TB account cap, so sprouts are shallow, `defaultBranchOnly`, and reaped on a TTL |
| Pushes per sprout | Hundreds/s | Single DO; irrelevant, one agent per sprout |
| Lands per trunk | Batches every evidence cycle (minutes), tens of beans per batch | Integrator is single-writer by design; batching, not per-bean serialisation |
| Alternative worlds per decision | 2 | Keeps speculation on one frontier and avoids the tree that doubles per conflicting change (Uber) |
| Evidence jobs in flight | Bounded by Containers instance limits (`claude-04`) and budget | Policy sets max concurrent jobs per project; superseded jobs are cancelled |
| Canvas viewers | Thousands per project | DO WebSocket fan-out with hibernation |

Thousands of *registered* agents with hundreds *active* is the honest demo shape, as the Codex memo 02 also argues. Sprout start-up "in seconds" via blobless clone is unverified on Artifacts (`claude-04` §10, item 6); benchmark before claiming it. The point is that nothing in the design serialises on agent count; only evidence capacity and human decisions do, and both are visible.

## What a judge sees in ten minutes (first draft; the red-teamed script in `claude-13` replaces it)

1. Trunk of a small web app. Twenty intents created from a product brief by a planner agent.
2. Claude Code sessions, in local terminals and on other machines through Remote Control, with their subagents in worktrees, claim intents over MCP and fork sprouts. The canvas shows the swarm: who holds what intent, live overlap warnings.
3. The Integrator composes worlds; the evidence wall fills with receipts; two beans collide; a resolver sprout fixes it on screen.
4. A decision card appears: "Two worlds for team billing: compatible migration vs clean break. Previews attached." The human clicks one.
5. Trunk fast-forwards, the preview becomes production, superseded beans fold away with their evidence kept.
6. Ask the canvas "why did invoice tax change?" and get the bean, its intent, its decision, and the agent's note, from git-notes, in one view.

Every step maps to a rubric line. Build order and cut lines are in `claude-13-demo-plan.md`.

## Platform constraints that shape the build (from `claude-04`, `claude-05`, `claude-06`)

- **Artifacts has no server-side merge, diff, refs, hooks or branch protection.** The binding reads (`info`, `log`, `readCommit`, `readTree`, `readBlob`, `readFile`), forks, imports, and mints tokens; writes go through git. So the Integrator composes worlds in a warm Sandbox with real git and Mergiraf over a shallow clone, then pushes the world branch and, on landing, trunk. Policy ("only the Integrator pushes trunk") is enforced by never issuing a trunk write token to anyone else, not by a pre-receive hook.
- **Push is git protocol v1 only; 1 GB per repo, 32 MB per blob; 2,000 requests per 10 s per repo and per namespace.** Fine for sprouts (one agent each). Build artifacts and media go to R2 with pointers.
- **Events arrive via Queues** (`cf.artifacts.repo.pushed` with ref, before, after and a truncated commit list; no file list), so the lease engine fetches the diff itself. Workflows subscribe namespace-wide.
- **Forks are cheap but billed**: $0.15 per 1,000 operations and $0.50 per GB-month, so sprouts, worlds and context repos carry a TTL and a reaper.
- **Tokens**: Artifacts tokens are repo-scoped, read or write, TTL 60 s to a year. The identity design in `claude-06` keeps Artifacts tokens short-lived (15 min read, 60 min write), minted server-side per sprout, with the agent holding an OAuth 2.1 session (workers-oauth-provider) plus a per-task capability; merge is never an agent capability. Audit trailers go on every commit.
- **Previews**: Workers Builds treats only `main` as production and gives any other branch a preview URL (500 per Worker, DO and Containers isolated per preview); for non-Workers stacks, Sandbox 1.0 serves a port on our hostname with our auth. Browser Rendering screenshots become evidence.
- **Evidence runners**: Containers up to 4 vCPU / 12 GiB / 20 GB, 1,500 vCPU per account, 1 to 3 s cold start, images fixed at deploy time; Docker-in-Docker is documented but contradicted by a field report, so anything needing arbitrary images is "unsupported in v1" (`claude-05`).
- **Dynamic Workers** (JS isolates, milliseconds to start, egress controllable, 4 concurrent per request context and 10 per DO) run generated query code for the canvas and policy plugins, not CI steps.

## How this differs from Steward, the closest rival entry

Steward (https://github.com/craigm26/steward, published 2026-10-02) turns a pull request into a decision: agents claim files, race in their own forks with fork-scoped tokens, a judge proposes one candidate, a referee objects, a human steward decides, a ledger records why, and paths earn auto-merge. It is well built and overlaps with beans, evidence, decisions and why-blame. The differences a judge can see:

1. **Unit of choice.** Steward picks one candidate per PR. beanstalk composes many beans into worlds and the human picks between integrated futures of the whole project. That is what "hundreds of thousands of agents working concurrently" needs: nobody can make one decision per PR at that rate.
2. **The merge system itself.** Steward lands one winner; it has no speculative frontier, no bisection, no supersession, no resolver sprouts. beanstalk's Integrator is the thing that replaces the merge queue.
3. **Coordination from diffs, not claims.** Steward's claims board is declared files. beanstalk recomputes overlap from parsed diffs on every push, so undeclared collisions are caught and declared ones that never materialise do not block.
4. **The swarm is visible on the code.** Steward has a claims board; beanstalk has agents on the map and worlds you can walk through.
5. **Bring your own forge workflow.** GitHub Actions import, previews per world, MCP-first with Claude Code and Codex live.

If we cannot demo 1, 2 and 4, the originality claim does not survive the comparison; `claude-13` orders the build accordingly.
