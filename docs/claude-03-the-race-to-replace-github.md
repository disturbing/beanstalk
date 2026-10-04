# The race to replace GitHub: who is tackling what, and why

Written 2026-10-03 from primary sources (linked). Companion to the Codex memo `01-field-research-and-competitors.md`, which has the Origin feature inventory and evidence ledger. This file concentrates on *what each player believes is broken* and *which primitive they changed*, because that is where beanstalk has to be different to score on "originality" (50% of the rubric).

## The number that explains the race

GitHub's commit volume went from about 1 billion commits in all of 2025 to 1.4 billion **per month** by April 2026 and 2.9 billion per month by August 2026, per GitHub's own figures as reported in coverage of Zed's Delta launch (https://theclarity.today/story/replacing-pull-requests-with-delta-b5cd480d, 2026-09-17; original source is GitHub, not independently verified). Whatever the exact figure, the write side of version control has grown by more than an order of magnitude in a year, and every tool below is a response to that.

## Cursor: Origin (the forge) and Continuity (the storage)

**What they say is broken.** Three things, in their own posts:

1. *Storage.* "Git at any scale" (Vicent Martí, 2026-08-18, https://cursor.com/blog/git-at-any-scale): GitHub-style Spokes replication (three-phase commit across replicas) has a floor that is too high for millions of throwaway agent repos and a ceiling too low for monorepos under CI clone pressure, because "the latency of every step is bound by the slowest of all the servers in the cluster." Repos become "pets not cattle" that need routing tables and corruption repair.
2. *The downstream bottleneck.* The Graphite acquisition post (2025-12-19) argues review and safe merging now constrain delivery more than writing code. Origin's PR layer is Graphite's stacked-PR and merge-queue lineage.
3. *Coordination at swarm scale.* "Towards self-driving codebases" (2026-02-05, https://cursor.com/blog/self-driving-codebases): thousands of agents built a Rust browser for a week, peaking at about 1,000 commits/hour over 10M tool calls.

**What they changed.** Continuity puts an S3 write-ahead log as the single source of truth; a push is visible only after one conditional compare-and-swap on the WAL index; replicas are disposable NVMe caches validated by conditional GETs (<10 ms); result: >300 pushes/second per repo on S3 Express, linear read scaling to 100 replicas, and "an idle repository doesn't even need [a replica]". The InfoQ summary (2026-09-30) confirms the numbers. Tobi Lütke's walgit re-implemented the design in days (HN 2026-08-24, 142 points) and the Narwal load tests (https://gitwal.io/blog/what-the-load-tests-found) found the predictable failure modes: per-repo locking serialises clones at 3.2/s, two nodes racing on one index collapse to 0.58 pushes/s, cold WAL replay hangs 120 s, index rewrites grow quadratically with ref count. The lesson for us: **a single-writer-per-repo design is fine as long as agents do not share a repo**. Artifacts already gives us one Durable Object per repo; the whole design question is how to keep thousands of agents off the same one.

**What Origin does not change.** The forge model itself. Origin ships repositories, pull requests, code browsing, GitHub sync, Vercel previews, Depot/Buildkite for existing GitHub Actions workflows, Origin Apps, automations (Codex memo 01, E18; https://cursor.com/docs/origin). The HN launch thread (597 points, 454 comments, https://news.ycombinator.com/item?id=49334209) repeatedly asks what changes beyond "agents integrated", and the Origin lead (ex-Graphite) answers with scale and extensibility. GitHub's six-hour outage on launch day did their marketing for them (https://techcrunch.com/2026/08/18/cursor-capitalizes-on-github-frustration-launches-rival-hosting-platform/).

**The most useful thing Cursor published** is the failure log from the swarm experiment, because it is the only large-scale empirical account of agents coordinating on one codebase:

- Shared state files with locks: "20 agents would slow to the throughput of 1-3 with most time spent waiting on locks"; agents "held locks for too long, forgot to release them, tried to lock or unlock when it was illegal to." Lockless optimistic concurrency "reduced overhead but didn't eliminate confusion."
- A single executor is "bottlenecked by the slowest worker"; an executor that also plans "would sleep randomly, stop running agents, do work itself... claim premature completion."
- Final shape: recursive planners that own a slice, workers that "work on their own copy of the repo", never talk to each other, and hand back "not just what was done, but important notes, concerns, deviations, findings, thoughts, and feedback."
- They *removed* the integration gate: "hundreds of workers and one gate (i.e. 'red tape') that all work must pass through" bottlenecked throughput; they "accept some moments of turbulence and let the system naturally converge." Requiring 100% correctness before every commit "caused major serialization and slowdowns."
- The physical bottleneck was disk: hundreds of agents compiling on one VM produced "many GB/s reads and writes of build artifacts."
- Their open question, verbatim: could "database-style concurrent systems mechanisms" and "simple copy-on-write and deduplication features" give easy wins, since "all agents have their own copy of the repo, but most files and artifacts are identical"?

That last question is the one Artifacts answers (cheap forks, blobless clones, ArtifactFS lazy hydration), and beanstalk should answer it on stage.

## Zed: Delta and DeltaDB (replace the PR with the thread)

Zed's bet is that "the conversation that generates the code is becoming the true source of our software" (Nathan Sobo, "Software is made between commits", 2026-06-11, https://zed.dev/blog/introducing-deltadb). DeltaDB records every edit as a delta with a stable identity, pairs each message with the edit it produced, anchors references to deltas rather than line numbers so they "survive as the code moves underneath", and uses CRDTs so "many people and agents edit the same files at once across different machines." Delta went to public beta 2026-09-16 and Zed turned pull requests off on Delta's own repo (570 changes shipped since, per theclarity.today). Git and CI remain "for running checks and connecting you to the rest of the world."

The HN reaction (https://news.ycombinator.com/item?id=49727245) is the clearest statement of what reviewers want, and it cuts against raw transcripts: "I'm not going to read another person's 100 turn slop factory, because they couldn't express their change in one paragraph" (refactor_master); "I want artifacts... not the messy in-betweens" (rtpg); "It's like attaching your slack convo as a PR" (Robdel12); "We never accepted 3k lines of code... from a human, why do we from LLMs?" (SoftTalker). Supporters value being able to "ask the same agent why you chose a Mutex instead of an RwLock." Takeaway: keep the full session for audit and for agents to query, but the review surface must be a distilled artifact with rationale and evidence.

## Entire: checkpoints and "version control for the agent boom"

Entire stores agent session logs as repository metadata linked to commits via trailers, with "brain checkpoints" (summaries of reasoning) and "Trails" (confidence, risk, drift signals) to gate merges, and proposes graduated stability levels instead of merged/unmerged. HN (https://news.ycombinator.com/item?id=48844709) pushed back the same way: "Store CHOICES with commits, not whole sessions" (wateralien); "Nobody wants 20,000-word session logs. Commit specs instead" (overgard); "Agents excel at conformance testing... update specs, regenerate code deterministically" (seanmcdirmid); and pornel's proposal that maintainers should have their own agents re-implement accepted *ideas* rather than merge external patches.

## Foremerge: intent coordination above git

Show HN 2026-09-21 (https://news.ycombinator.com/item?id=49789356). A local-first protocol with intents, advisory leased claims on scopes, dependencies, changesets, verification gates and provenance, exposed over CLI, JSON and MCP. It is prior art for "intent leases" and we should interoperate rather than claim the primitive. Its README admits no benchmark exists; the HN thread's objection is that agents do not know their scope before implementing. Our answer: declared scope is a hint, the *actual diff* (parsed to symbols) is the truth, and overlap is recomputed continuously.

## JetBrains Air (2026-09-22) and GitHub itself

JetBrains Air (https://blog.jetbrains.com/blog/2026/09/22/introducing-jetbrains-air/) is governance: "Code becomes cheaper to generate but more expensive to verify. Agent activity becomes easier to start but harder to coordinate, audit, and explain." It standardises on the Agent Client Protocol and sells visibility, cost, and auditability. No new VCS primitive. GitHub's own response is agent review guidance and Copilot coding agents on top of unchanged PRs; the Codex memo 01 has the links.

## Cloudflare's own hint

In the Artifacts launch thread (https://news.ycombinator.com/item?id=47792374, 217 points), Cloudflare staff said they could "create millions of repos every day, one for each agent/chat/user/session" and are "exploring more a (dare I say) 'agent first' VCS" beyond the git interface. Internally they already keep per-session repos with prompt history for time-travel debugging and mid-session forking (Artifacts beta post). The competition brief lists "how agents keep context" and "how you decide what gets deployed" as things to rethink. Those two are under-served by every player above: Cursor rethought storage, Zed rethought the review unit, Entire rethought provenance, Foremerge rethought coordination, nobody rethought **integration and deployment decisions for many concurrent candidates**. That is the gap `claude-10-beanstalk-thesis.md` goes after.

## Positioning in one table

| Player | Primitive they changed | What they kept | Weakness we can exploit |
|---|---|---|---|
| Cursor Origin / Continuity | Storage (S3 WAL, cheap idle repos) | PRs, branches, review queue, GitHub-shaped forge | Still one-PR-at-a-time review; tied to Cursor's agents; no multi-candidate integration |
| Zed Delta / DeltaDB | The review unit (thread + worktree, CRDT deltas) | Git for checks; desktop-first | Transcript-centric review that HN rejects; single worktree, not thousands of candidates; not a host |
| Entire | Provenance (session → checkpoint → trailer) | Git and PRs | Metadata only; no execution, no integration |
| Foremerge | Coordination (intent leases, scopes) | Local-first, single machine | No hosted enforcement, no evidence runner, no UI |
| JetBrains Air | Governance and audit | Everything | No VCS or forge at all |
| GitHub | Nothing yet (guidance + merge queue) | Everything | Outages, rate limits, human-paced PRs |
| **beanstalk** | **Integration: worlds (candidate combinations) as the unit humans choose between; forks as the unit agents work in; evidence as the unit of trust** | Git protocol, Linux CI, PR export for the outside world | Must prove it in 11 days |

## Additions from the deep-dive memo (`claude-03b`)

- Cursor is now a SpaceX subsidiary (all-stock deal signed 2026-06-16, closed 2026-08-14 per the memo's sources; HN's reaction mixed distrust of training on hosted code with "nothing new"). Origin's own lead, asked on HN what differs from GitHub today, answered "Today, very little." The agent-native features (auto-mergeable PRs, stacked PRs and merge queue from Graphite, MCP, agent identity, automatic conflict resolution) are all still "soon". Origin does not attempt issues, CI, packages, public repos, SSH, self-hosting or GitHub API compatibility, and the only published throughput figures are Continuity's 120 to 300 pushes per second.
- GitHub is moving on the workflow layer: native stacked PRs (2026-07-30), an asynchronous merge API (GA 2026-10-01), Copilot allowed to approve PRs (2026-09-01), multi-vendor Agent HQ, and a CTO statement that capacity planning moved from 10x to 30x because of agent workloads; commits 1.4 billion to 2.9 billion per month between April and August.
- Other substrates: Pierre Code Storage (used by Lovable and Bolt, "unlimited" rate limits), Enroute (open source, Rust on object storage), Entire's regional mirrors, GitLab's next-generation SCM pitch ("clone tax, concurrency collapse, no isolation").
- The memo's "ten things nobody has built" list (claims board inside the forge, agent principals with per-fork tokens and budgets, multi-candidate review objects, a merge queue that re-dispatches agents, signed portable verdicts, why-blame on a hosted page, tenancy-level rate limits, server-side partial reads, a GitHub-down write path, attention routing as data) maps almost one-to-one onto `claude-11`; Steward (2026-10-02) already covers three of the ten, which is why `claude-10` ends with a Steward comparison.
