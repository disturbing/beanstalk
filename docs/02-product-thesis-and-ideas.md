# Beanstalk: a place to decide what thousands of agents should ship

Research and design exploration, 3 October 2026. Everything described as a Beanstalk feature below is a proposal, not an implemented capability. See [field research](01-field-research-and-competitors.md) for observations and [validation](07-validation-and-demo-plan.md) for ways to disprove these proposals.

## The product bet

Beanstalk should organize **intent → alternatives → evidence → integration → observed outcome**. Git remains the portable record of source changes. The main human interface is a Jev-generated canvas that answers a concrete question about the project using executable, inspectable evidence.

Proposed positioning: **“Give your agents a shared project. See what they built together. Ship the version you can explain.”**

The customer initially is a team already running several agents on a web application and struggling to integrate their output. Thousands of agents are a design constraint and eventual capacity target; usefulness to five agents is the first product test. Agent count, generated lines, PR count, and a busy visualization are poor measures of customer value. Measure accepted outcomes, human decision time, regressions, and total cost.

The user's canvas instinct is promising because a repository has many useful views: dependency graph, product flows, decisions, runtime behavior, changes, ownership, and risk. A single permanent file-tree screen cannot answer all of them. But an infinite canvas full of files is also a poor default. **Generate a small working surface around a question, with a stable repository browser and decision inbox always available.**

## What the evidence changes

The [research ledger](01-field-research-and-competitors.md) supports treating integration and trust as distinct from code production. It does not establish market size, willingness to migrate, or that every team wants autonomous fleets. The complaints are qualitative and self-selected.

Cursor's research describes lock contention and shared machine bottlenecks when coordinating agents; its experiments are useful architectural evidence, not proof that unattended fleets produce correct production systems. Our inference: coordination needs an explicit protocol, bounded concurrency, and clear responsibility for acceptance. [Cursor: self-driving codebases](https://cursor.com/blog/self-driving-codebases).

Intent coordination is already a category: Foremerge exposes scopes, advisory claims, verification, and provenance above Git. Session context is also established: Entire links agent sessions to code checkpoints. Beanstalk should interoperate with useful formats rather than claim these primitives are new. The proposed differentiation is **hosted coordination across machines, combined runnable candidates, and a question-driven decision interface**. That combination remains a hypothesis to validate. [Foremerge protocol](https://github.com/naw103/foremerge/blob/main/docs/protocol.md), [Entire CLI architecture](https://entire.io/blog/the-entire-cli-how-it-works-and-where-its-headed).

## Five objects people and agents can share

| Object | What it means | Why it matters |
| --- | --- | --- |
| Intent | A desired outcome, constraints, owner, budget, acceptance criteria, and dependencies | Stops a fleet from optimizing an ambiguous sentence |
| Attempt | One bounded effort by an identified agent against a pinned baseline | Makes alternatives and failed approaches inexpensive to keep |
| Change | A stable ID with immutable revisions, actual diff, declared impact, and observed impact | Rebases do not erase the conversation; approvals still bind a specific revision |
| Candidate | An exact, integrated combination of change revisions and dependencies | Lets people run the combined result before choosing it |
| Evidence | A recorded observation tied to inputs, runner, check definition, environment, and time | Distinguishes “the agent says it passes” from a trusted execution result |

“Candidate” is an ordinary Git commit plus a Beanstalk manifest. It is not a promise of isolated production infrastructure or a novel version-control format. Calling it a “world” in exploratory UX is optional; concrete words should win usability tests.

## Ideas worth exploring

The priorities below are judgments, not market scores. P0 is the coherent first product; P1 follows demonstrated demand; Lab ideas need evidence before substantial implementation.

| Idea | User experience and mechanism | Main objection / failure mode | Smallest useful experiment | Priority |
| --- | --- | --- | --- | --- |
| **Ask Jev, get a working view** | “Why is checkout blocked?” produces a dependency map, exact failed check, conflicting changes, and two runnable options | Attractive summaries can hide missing or stale evidence | Compare with a conventional PR dashboard on identical tasks | P0 |
| **Combined previews** | Select changes A+C+F and run the integrated result before merging | Testing every subset is exponential; previews may misrepresent production | Build only two dependency-closed candidates from four changes | P0 |
| **Review by obligation** | Show which requirement each check supports and where no evidence exists | An agent can write trivial tests that confirm its own mistake | Independent checks, mutation probes, and explicit gaps on one feature | P0 |
| **Intent overlap radar** | Agents declare “replace/extend/deprecate” on APIs, schemas, and flows; actual diffs update the claim | Undeclared dependencies and false positives make hard locks dangerous | Advisory warnings only; measure useful warnings and misses | P0 |
| **Decision inbox** | Escalate “keep compatibility or break callers?” with bounded alternatives and costs | Triage agents may suppress a material disagreement | Auditable routing plus random human audit of un-escalated changes | P0 |
| **Abort propagation** | Superseding a change cancels its CI, dependent previews, and expendable agent attempts | Cancellation races leave orphan resources or kill reusable work | Inject supersession during builds and audit remaining cost | P0 |
| **Context subscriptions** | An agent receives changes to contracts it depends on, plus a compact handoff | Excess notifications recreate prompt bloat; summaries omit crucial constraints | Scoped event feed with acknowledgment and full evidence links | P1 |
| **Contract-first collaboration** | Agents agree a versioned API/schema fixture, then work independently against it | Premature contracts can freeze the wrong architecture | Backend/frontend/test agents develop one feature around a contract | P1 |
| **Conflict rehearsal** | Replay pending changes against likely next baselines to expose failures early | Speculation burns more compute than it saves | Compare one bounded speculative lane with ordinary queueing | P1 |
| **Architecture memory** | “Why is this weird?” connects code to rejected alternatives, constraints, and later outcomes | Stored explanations become stale, sensitive, or rationalized after the fact | Timestamped claims with owners, invalidation, and redacted evidence | P1 |
| **Reviewer attention budget** | Schedule work according to available review capacity, reducing low-value arrivals | Teams may see throttling as the tool being slow | Surface predicted backlog and offer budgeted batch sizes | P1 |
| **Independent challenger** | A separate agent tries to falsify a claim using a fresh task and hidden test fixtures | Different models still share blind spots; majority votes are weak evidence | Measure seeded regression detection against equal-compute baseline | P1 |
| **Outcome branches** | Review a user flow, latency budget, or accessibility result alongside its code revisions | User outcomes cannot always be simulated; measurements are noisy | One API latency task and one browser flow with reproducible fixtures | P1 |
| **Branch as a service** | Another agent consumes a signed API contract and temporary endpoint from an unfinished change | Dependencies expire, leak privileges, or drift during testing | Pin endpoint generation and contract digest; exercise expiration | Lab |
| **Search portfolios** | Spend a fixed budget on genuinely different approaches, stop dominated attempts, preserve lessons | Ten similar agents multiply expense without exploration | Three deliberately different designs with an independent rubric | Lab |
| **Architecture pressure map** | Repeated contention identifies modules that should be split or stabilized | Optimizing for parallel edits can make the actual product worse | Compare contention with real incident and ownership boundaries | Lab |
| **Reverse review** | Ask “What evidence would change your mind?” before an agent implements | Rubric gaming and extra ceremony | Require one counterexample for a high-risk change | Lab |
| **Outcome escrow** | A change stays linked to post-release metrics; failures reduce future autonomy for that task class | Attribution is confounded and punitive agent rankings are misleading | Observe rollback and incident signals without automated sanctions | Lab |

## How 1,000 agents could work on one idea

Imagine “add team billing without breaking existing subscriptions.” Decompose it into versioned obligations: authorization, pricing invariants, migration compatibility, frontend flows, email behavior, performance, and operational recovery. Many agents can investigate independently; fewer should edit; still fewer should integrate.

An **illustrative scheduling allocation**, not an observed result: 1,000 registered agents, at most 100 active Linux workspaces, 40 concurrent validation jobs, 12 active previews, and 2 candidate integration lanes. Most agents are waiting on dependencies, using brief read-only tools, reviewing bounded evidence, or finished. This measures admitted concurrency honestly. A claim of 1,000 simultaneous execution environments requires a different load test and capacity budget.

1. The planner proposes a dependency DAG and acceptance criteria. A human owns the important product tradeoffs.
2. Agents claim short tasks with expiring leases and publish affected contracts. An expired lease permits reassignment; its old holder cannot submit under an obsolete fencing generation.
3. Each attempt works in an isolated fork of a pinned baseline. Shared instructions are immutable versions, not a file that every agent edits.
4. Small changes report actual impacts and evidence. Duplicate proposals become alternatives; dependent proposals form a stack.
5. Independent validators test changes and combinations. A “green” result applies only to its exact inputs.
6. Jev surfaces a small set of unresolved choices and runnable candidates. Selecting a candidate asks for integration under the repository's policy.
7. A trusted integration service rechecks policy and the base ref, publishes exactly the tested revision, and records the result. Production rollout is a separate policy-controlled step.

For open-ended discovery, use **bounded search portfolios** rather than invent 1,000 implementation tickets. For tightly coupled migrations, accept serialization. More agents cannot remove a real dependency.

## Questions that should make us uncomfortable

**Why move off GitHub?** A canvas alone is unlikely to justify migration. Start with a GitHub-connected mode to test the decision workflow; offer native Artifacts hosting for teams who value isolated agent workspaces and integrated execution. Maintain one authoritative writable upstream per mode.

**Could Cursor ship all of this?** Yes. Origin already combines hosting, agents, PRs, preview integrations, and CI integrations. Neutral support for different agents and a better decision loop are possible advantages, not a moat by declaration. See the [competitor comparison](01-field-research-and-competitors.md).

**Is every pull request obsolete?** No. A small, reviewable change remains valuable. Retain familiar PRs as an export and everyday view; improve the information and coordination behind them.

**Can an LLM certify semantic compatibility?** No. It can suggest likely interactions. Deterministic checks, independent tests, runtime observations, and human decisions supply evidence; incomplete evidence remains visible.

**Does every agent deserve a vote?** No. Agent consensus can amplify correlated errors. Authority follows accountable owners and policy, not the number of agents agreeing.

**Could the best feature be refusing more work?** Yes. If review or integration is saturated, deferring low-value work may improve accepted throughput and cost more than adding execution capacity.

**What should we avoid first?** An unrestricted agent marketplace, a complete GitHub API clone, a novel Git replacement, automatic resolution of all semantic conflicts, an arbitrary-code UI generator, or an uncapped swarm. None is necessary to test the central proposition.
