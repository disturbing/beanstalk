> Research memo produced 2026-10-03 by a Claude research subagent (web search + Exa + direct fetches) for the beanstalk brainstorm. Claims carry their source URLs; items marked UNVERIFIED were not confirmed. Edited lightly by the coordinating session.

# Merge queues, conflict handling, and the empirical record on agent PRs

Research memo for beanstalk (agent-first forge on Cloudflare). Compiled 2026-10-03. All figures are quoted from the cited source; where a number is the source's own marketing claim rather than a measured result, it is marked as such.

## TL;DR

- Agent PRs already overlap in time in most repos (79% of agent PRs are co-active with another agent PR in the same repo), and textual conflict rates are 2–3x human baselines: 27.7% across 107K agent PRs; 41.7% when two *different* agents are co-active.
- Agent PRs are accepted less often than human PRs (38–65% by agent vs 76.8% human), but roughly a third of rejections are workflow/process failures, not bad code. "Resolved by another PR" is the single largest rejection cause for fix PRs (22%).
- Throughput is piling up in front of main, not landing: CircleCI sees feature-branch runs up 15–50% while main-branch throughput is flat or down 7%, and main success rates at a five-year low (70.8%). Faros sees PR review time up 91% (2025) and 441% (2026).
- Every production merge queue is a variant of one algorithm: serialize into a speculative chain, test cumulative prefixes, eject failures, retest the tail. Uber's SubmitQueue is the most advanced (probabilistic speculation tree + build-target conflict analysis) and still hits exponential blowup: builds double per conflicting change.
- Nothing shipping today detects *intent* conflicts (replace vs extend, contract drift). The credible prototypes (Foremerge, agent-semaphore, leases) all use declared semantic scopes checked before writing, not after.

---

## A. Empirical evidence on AI-agent pull requests

### A1. The AIDev corpus and its headline rates

The AIDev dataset (Li, Zhang, Hassan; arXiv 2507.15003, Zenodo 10.5281/zenodo.16919051) is the substrate for nearly every 2026 paper. It holds 456,535 agentic PRs (Codex 411,621; Devin 24,893; Copilot 16,531; Cursor 1,981; Claude Code 1,509) across 61,453 repositories and 47,303 developers, plus a human baseline of 6,628 PRs from 818 repos. Headline acceptance: humans 76.8%; Codex 65.3%, Claude Code 52.5%, Cursor 51.4%, Devin 48.9%, Copilot 38.2% (AIDev-pop subset). Review turnaround for accepted PRs (median): humans 3.9 h, Codex 0.3 h, Devin 2.2 h, Copilot 17.2 h. Only 9.1% of agent PRs change cyclomatic complexity vs 23.3% for humans; bot reviewers appear on 20.1% of agent PRs vs 10.0% of human PRs. (https://arxiv.org/html/2507.15003)

Note on the "bot ~37% vs human ~73%" figure in the brief: I could not find a paper reporting exactly that pair. The closest documented pair is AIDev's Copilot 38.2% vs human 76.8%. Treat "37/73" as a rounded paraphrase of that, not an independent result.

### A2. Co-activity and merge conflicts (the number that matters for beanstalk)

"AI Agent Pull Requests on GitHub: Frequency, Structure, and Merge Conflict Rates" (arXiv 2607.04697) analyses 33,596 PRs from 2,807 AIDev-pop repos (Codex 21,799; Copilot 4,970; Devin 4,827; Cursor 1,541; Claude Code 459).

- Co-activity: at exact temporal overlap (k=0), 40.2% of repositories contain co-active agent PR pairs and 79.4% of all agent PRs overlap with another agent PR. With a ±7-day window: 53.4% of repos, 95.0% of PRs.
- Composition: 99.5% of co-active pairs are same-agent; cross-agent pairs are 0.5% and occur in only 122 of 2,807 repos. Multi-vendor agent fleets are still rare in the wild.
- Conflict rates (RQ3): intra-agent pairs 19.8% textual conflict (119/601); cross-agent pairs 41.7% (48/115). "Cross-agent conflicts occur at approximately double the rate of intra-agent conflicts."
- Taxonomy: 84.4% of conflicted files are source files; 57.6% of conflict reports are content conflicts, 26.8% modify/delete, 15.1% add/add.
- Method: `git merge-tree` three-way merges on 747 sampled co-active pairs (95.8% evaluable). Caveat, in the authors' words: "limited to the textual level of granularity, they represent conservative lower bounds on costs." (https://arxiv.org/html/2607.04697)

AgenticFlict (Ogenrwot & Businge, arXiv 2604.03551; Zenodo 10.5281/zenodo.19396916) scales this up: 142K+ agentic PRs from 59K+ repos, 107K+ run through deterministic merge simulation, 29K+ conflicting, a 27.67% conflict rate, and 336K+ extracted conflict regions. The agent-semaphore README contrasts this with "10–20% for human ones"; that human baseline is the tool author's framing, not AgenticFlict's measurement. (https://zenodo.org/records/20118379, https://github.com/alwh1te/agent-semaphore)

### A3. Why agent PRs do not land

- Fix-related PRs (Alam, Mondal, Roy; arXiv 2602.00164, MSR'26): 8,106 fix PRs; 65.0% merged, 26.1% closed unmerged, 8.9% still open. Per agent: Codex 81.6%, Cursor 68.4%, Claude Code 57.4%, Devin 42.9%, Copilot 42.4%. From 326 manually coded unmerged PRs (kappa 0.82): Resolved by Another PR 22.1%, Test Case Failures 18.1%, Incorrect/Incomplete Fix 15.3%, Closed for Inactivity 9.2%, Low Priority/Obsolete 8.0%; build failures only 2.1%. Codex failures are dominated by test failures (54.9%); Devin by inactivity closure (54.0%); Copilot by "resolved by other PR" (31.8%). (https://arxiv.org/html/2602.00164)
- Rejection rationale (Peralta et al., arXiv 2605.22534): of 11,048 closed agentic PRs (9,799 human-reviewed, 717 inspected), only 35.7% of rejections reflect clear agent failures; 31.2% were workflow constraints and 33.1% had no observable rationale. Among merged PRs, 15.4% needed explicit reviewer feedback or direct commits. (https://www.alphaxiv.org/abs/2605.22534)
- Abujadallah et al. (arXiv 2606.13468, MSR'26): 46.41% of fixes from Copilot/Devin/Cursor/Claude are rejected; 14 reasons in 4 categories from 306 sampled PRs.
- Task-stratified acceptance (Pinna et al., arXiv 2602.08915): 7,156 PRs; documentation 82.1% vs new features 66.1% (a 16-point gap larger than inter-agent variance); Codex 59.6–88.6% across nine task types; Claude Code leads docs (92.3%) and features (72.6%); Cursor leads fixes (80.4%).
- Collaboration signals (Nachuma & Zibran, MSR'26): larger change size and "coordination-disrupting actions, such as force pushes" lower merge likelihood; reviewer engagement is the strongest positive correlate. (https://dl.acm.org/doi/full/10.1145/3793302.3793561)
- Post-merge quality (Cynthia, Muttakin, Roy; arXiv 2601.20109, MSR'26): 1,210 merged bug-fix PRs in 206 Python repos; 1,059 code smells, 48 bugs (often BLOCKER), 83 security hotspots; no significant density difference across agents after normalising by LOC. Conclusion: "merge success does not reliably reflect post-merge code quality." (https://arxiv.org/html/2601.20109)
- Claude Code specifically (Watanabe et al., TOSEM 2026): 567 PRs across 157 projects; 83.8% accepted; 54.9% of merged PRs integrated without modification.

### A4. Delivery-pipeline telemetry (the congestion evidence)

CircleCI 2026 State of Software Delivery (28M workflows): average daily workflow runs +59% YoY, but the top 5% of teams drove it (+97%, 6.8 to 13.4 runs/day); median team +4%; bottom quartile flat. For the median team, feature-branch throughput +15% while main-branch throughput fell 7%; top-10% teams grew feature-branch activity ~50% with main +1%. Main-branch success rate 70.8% (lowest in 5+ years; benchmark 90%); recovery time 72 min (+13%). Q2 Pulse (20M workflows, March 2026): top 5% run 15.6 main workflows/day vs median 1.7 (9x gap); feature-branch +7.7% YoY, main flat; main success improved to 76.7%; the 20 highest-throughput orgs average ~2,165 main-branch workflows/day (+72% YoY) with cost per shipped change down 31%. (https://circleci.com/blog/five-takeaways-2026-software-delivery-report/, https://circleci.com/blog/five-takeaways-2026-q2-pulse/)

Caveat (Rob Bowley): "throughput" is CI pipeline runs, not deployments; the top-5% cohort shows an implausible 6-second average pipeline duration and one team running ~130,000 workflows/day skews aggregates. The integration-bottleneck finding is credible; the "1 in 20 teams have cracked it" claim is not. (https://blog.robbowley.net/2026/04/02/...)

Faros AI telemetry. 2025 report (10,000+ developers, 1,255 teams): high-AI-adoption teams complete 21% more tasks and merge 98% more PRs, but PR review time rises 91%; PRs are 154% larger; bugs per developer +9%. 2026 "Acceleration Whiplash" (22,000 developers, 4,000+ teams, two years): epics per developer +66%, task throughput +33.7%, PR merge rate per developer +16.2%; but PRs a further 51% larger, bugs per PR +54%, median time in PR review +441%, 31% more PRs merged with no review, code churn +861%, probability of a production incident per merged PR more than tripled; 25% of PRs now reviewed by an AI agent (0% in 2025) yet review time still up ~200%; AI code acceptance rate rose 20% to 60%. (https://www.faros.ai/blog/ai-software-engineering, https://www.faros.ai/blog/ai-acceleration-whiplash-takeaways, https://www.faros.ai/blog/ai-code-quality-senior-engineer-review-burden)

Enterprise "2x mandate" study (He, Vasilescu et al., arXiv 2607.01904): 802 developers, 196,212 PRs, Jan 2024–Apr 2026; per-capita merged PRs reached 2.09x baseline; per-reviewer load roughly doubled; automated review overtook human review; merge and revert rates held steady.

GitHub itself: since mid-December 2025 "agentic development workflows have accelerated sharply"; the 10X capacity plan (Oct 2025) was revised to 30X by Feb 2026. On 23 April 2026 a merge-queue regression produced incorrect squash commits whenever a merge group held more than one PR, reverting prior work on default branches in 658 repositories and 2,092 PRs. (https://github.blog/news-insights/company-news/an-update-on-github-availability/)

---

## B. Merge queue state of the art

All production queues implement the "Not Rocket Science Rule" (bors): main only ever contains a snapshot that passed tests. They differ in how they parallelise the serial validation.

### B1. Per-system notes

GitHub merge queue (GA 2023). FIFO; builds temporary `gh-readonly-queue/<base>` branches; CI must subscribe to the `merge_group` event (a `pull_request`-only workflow never runs, and the queue stalls). Group settings: minimum and maximum PRs per group 1–100, a wait timeout, build concurrency 1–100 in-flight `merge_group` webhooks, merge method merge/rebase/squash. Failure handling: the failing PR is removed and the temp branch is recreated for everything behind it; no bisection, no priorities. "Jump the queue" triggers a full rebuild of all in-progress PRs. Wildcard branch-protection patterns are unsupported. (https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue). Community pain: "10 minute waits between every merge" on mergeability checks; Mergify's critique (no bisect-on-failure, no priorities, "blind to CI"). The April 2026 correctness incident above is the most serious documented failure. A useful back-of-envelope from lhorie (HN 36708767): CI of 10 min gives a budget of 6 serial merges/hour; at 200–300 commits/day with a 20-min CI SLO, an unqueued repo caps at ~72 safe merges/day.

GitLab merge trains. Pipelines run on cumulative prefixes (A, A+B, A+B+C...). Default limit 20 parallel pipelines per train (configurable up to the instance limit); overflow MRs queue without limit. On failure the MR is removed and a new pipeline starts for the remaining set without it. Fast-forward and semi-linear merge methods restrict "merge immediately" and skip-train options. (https://docs.gitlab.com/ci/pipelines/merge_trains/)

Mergify. `batch_size` fixed or `min`/`max`; `batch_max_wait_time` (e.g. wait up to 5 min for 5 PRs); batches are filled by priority, then stacks (kept together), then similarity (shared scopes, changed directories), then queue time. On failure the batch is split (bisected) into `max_parallel_checks` parts, bounded by `batch_max_failure_resolution_attempts`; a PR that fails alone is dequeued. Partitions give per-area queues. (https://docs.mergify.com/merge-queue/batches/)

Aviator. Parallel mode stacks every queued PR into cumulative draft PRs and runs CI optimistically; on failure at the head it "closes all subsequent Draft PRs and restarts the queue after removing the failing PR" (no bisection). Affected-targets mode computes build targets (bazel-diff, `nx affected`, or directory heuristics); PRs with disjoint targets "test and merge independently in any order", overlapping ones are optimistically stacked. Limit: 1,000,000 unique affected targets per account. (https://docs.aviator.co/mergequeue/concepts/parallel-mode, https://docs.aviator.co/mergequeue/concepts/affected-targets)

Graphite. Stack-aware queue (dependency graph of PRs, merged bottom-up). Parallel CI: early adopters report 1.5x faster merges (p95 −33%), up to 2.5x for stack-heavy orgs (p95 −60%). Batching explicitly "relaxes the requirement for correctness on every single commit in the batch" in exchange for fewer CI runs, with bisection on batch failure. Vendor claims: 74% faster merges at Ramp, 7 h/engineer/week at Asana. (https://graphite.dev/blog/the-first-stack-aware-merge-queue, Graphite batching and Parallel CI posts)

bors-ng / homu (Rust). Approved PRs accumulate into a batch on `staging`; "If the build fails, bors will follow a strategy called 'bisecting'. Namely, it splits the batch into two batches." Different priorities are never batched together; `bors single` opts a PR out of batching. Rust's 2018 experience: a 3-hour landing cycle capped the compiler at ~7.5 PRs/day, forcing 20+-PR rollups that made bisecting perf regressions painful. The public bors instance is now phased out in favour of GitHub merge queue. (https://github.com/bors-ng/bors-ng, https://internals.rust-lang.org/t/homu-queue-woes-and-suggestions-on-how-to-fix-them/8954)

Zuul (OpenStack). Dependent pipelines are the canonical speculative gate: jobs for change N run against the state with changes 1..N-1 applied. On failure the failed change is dropped and everything behind it is retested without it. `Depends-On:` serialises cross-project dependencies. The active window starts at 20 changes, grows by one per successful merge and halves per failure (AIMD). (https://zuul-ci.org/docs/zuul/latest/gating.html)

Uber SubmitQueue (EuroSys'19, "Keeping Master Green at Scale"). Measured motivation: with 16 concurrent potentially conflicting changes the probability of a mainline break was 40%; the iOS mainline was green only 52% of the time; a naive serial queue at 1,000 changes/day x 30-min builds gives a 20-day turnaround. Design: a binary speculation tree over pending changes annotated with success probabilities from a logistic-regression model (~100 features, 97% accuracy); a conflict analyser using build-target hashes turns the tree into a speculation graph so independent changes commit in parallel; builds are scheduled by expected value; achieves ~1.2x the theoretical oracle. BLRD (2023): a later change B may land before an earlier A if all speculation paths involving A are verified and all give the same outcome; P95 wait time fell 74% on the Go monorepo. The stated limit: "the number of builds doubles every time a new conflicting change comes to the SubmitQueue" and safety requires hermetic builds and deterministic tests. 2025 enhancements (arXiv 2501.03440): ML build-time prediction plus a speculation threshold cut CI resources 53%, CPU 44%, P95 wait 37% across Go/iOS/Android monorepos serving 4,500+ engineers. Open-sourced January 2026. (https://blog.acolyer.org/2019/04/18/keeping-master-green-at-scale/, https://www.uber.com/ci/en/blog/bypassing-large-diffs-in-submitqueue/, https://arxiv.org/html/2501.03440, https://github.com/uber/submitqueue)

Chromium CQ. No batching; each CL is tested serially against current tip-of-tree, not a predicted future state. Dry run (CQ+1) vs submit (CQ+2); failed shards are retried, then rerun without the patch, and a CL fails only if it fails with-patch and passes without. Rationale: with ~20,000 unique flaky tests "pretty much no CL would ever pass the CQ" without retries. Builder SLO: median cycle under 40 min, p90 about an hour. (https://chromium.googlesource.com/chromium/src/+/main/docs/infra/cq.md)

Meta. Public writeups describe the substrate (Sapling, EdenFS, Mononoke, Buck2, a single-main linear-history monorepo with no branches, ~3 to 10 WWW releases/day with a 4.5-hour average diff-to-release time) but not the landing queue's speculation algorithm; treat any detailed claims about Meta's "land" speculation as unsourced. (https://engineering.fb.com/2022/11/15/open-source/sapling-source-control-scalable/, https://atscaleconference.com/scaling-releases-inside-meta-www-release-operations/)

### B2. Comparison table

| System | Batching | Failure handling | Speculative? | Scale ceiling (documented) | Agent-scale weakness |
|---|---|---|---|---|---|
| GitHub merge queue | Groups of 1–100, wait timeout | Eject failing PR, rebuild all behind; no bisection | Yes (cumulative temp branches) | Build concurrency 1–100; FIFO only | Head-of-line blocking; no priorities; full rebuild on jump; proven correctness bug (Apr 2026) |
| GitLab merge trains | Cumulative pipelines | Remove MR, restart pipelines behind | Yes | 20 parallel pipelines/train default; unbounded queue | Linear chain; one flaky MR restarts the tail |
| Mergify | Dynamic batch size, similarity grouping, partitions | Bisect batch into N parts, bounded attempts | Yes (speculative checks) | Not stated | Textual similarity heuristics; no semantic independence proof |
| Aviator | Cumulative draft PRs; affected-targets independence | Close all later drafts, restart (no bisection) | Yes | 1,000,000 targets/account | Target computation needs Bazel/Nx; failure cost is a full tail restart |
| Graphite | Stack-aware; optional batches | Bisect batches; parallel CI per stack | Yes | Not stated | Batches drop per-commit greenness; PR-stack model assumes human-sized stacks |
| bors-ng / homu | Batches on `staging` | Split in half, retry | No (one batch at a time) | ~7.5 PRs/day at 3 h CI (Rust 2018) | Serial; rollups hide culprits |
| Zuul | Cumulative dependent pipeline | Drop failed, retest tail | Yes | Window 20, AIMD | Chain re-tests cascade; cross-project deps serialise |
| Uber SubmitQueue | Speculation tree pruned by build-target independence | Halt dependent speculations; land only verified paths | Yes, probabilistic | Tens of thousands of changes/month; tree doubles per conflicting change | Exponential blowup under high conflict density; needs hermetic builds |
| Chromium CQ | None (serial per CL) | Retry shards, rerun without patch | No | ~40 min median/CL | Pure serial; main can still break between CQ and land |

### B3. What breaks at agent scale

Three structural facts fall out of the table. (1) Every queue's cost model assumes failures are rare: ejection cost is proportional to tail length, and Uber shows speculation cost doubles per conflicting change. Agent PRs conflict at 2–3x human rates and fail CI more (CircleCI's 70.8%), so the amortisation breaks. (2) Independence is inferred from build targets or changed paths; none of the systems model API/schema/contract overlap, which is exactly where Autonoma and Foremerge report silent breakage. (3) Queue position is a scarce resource with no notion of a PR becoming obsolete; yet "resolved by another PR" is the top cause of agent fix PRs dying (22.1%). A 10,000-agent fleet would fill any FIFO with work that should be cancelled, deduplicated, or re-based before it ever consumes CI.

---

## C. Semantic and structural merge; conflict avoidance

### C1. Structured merge: real but bounded

Mergiraf (Delpeuch, 2024–) is the first production-grade syntax-aware git merge driver: tree-sitter parse, structured three-way merge, line-based fallback, and a deliberate bias to "err on the side of caution and retain conflict markers", with `mergiraf review` to audit its decisions. Its own benchmark tables run over tens of thousands of real conflict cases per language (e.g. 75,457 Java, 39,392 XML, 32,445 C headers). (https://mergiraf.org/, https://codeberg.org/mergiraf/mergiraf/pulls/658)

The academic record is consistent: more structure resolves more conflicts automatically *and* misses more real conflicts. MergirafSemi (arXiv 2608.11345): "increasing structural granularity improves automatic conflict resolution but can also lead to more aggressive merge decisions, increasing the number of missed actual conflicts." Cavalcanti et al. (2024) find the same for separator-based semistructured merge: fewer spurious conflicts, more undetected ones. GumTree's 2024 heuristic makes AST diffing practical at scale (edit scripts 50% smaller, matching 50x–281x faster), and the RefactoringMiner-based AST diff (TOSEM 2025) adds refactoring awareness with an 800-commit benchmark. Semantic conflict detection via generated unit tests (Da Silva et al., JSS 2024) is the only published approach that targets behaviour rather than syntax. Entity-level merge tools for agents (got, Phantom) apply the same idea with import-block set-union and symbol-keyed changesets; none publish precision/recall.

Verdict: structured merge should be the default *first pass* in beanstalk, but it must be paired with a behavioural check (build + targeted tests) because the literature says it trades spurious conflicts for silent ones.

### C2. Patch theory and first-class conflicts

Pijul: changes are associative and invertible; "any two changes that could have been written independently always commute"; conflicts are a *state* of the graph, not a failure of merging, and (unlike Darcs) conflicting changes still commute, avoiding Darcs' exponential merge. Its author is explicit that Pijul "works on the state... the smallest extension of 'files with regular edits' where patches are associative and independent patches can be applied in any order." Limitation: the theory is about text-line graphs, not program semantics. (https://pijul.org/manual/why_pijul.html, https://pijul.org/posts/2020-12-19-partials)

Jujutsu (jj): conflicts are recorded as "a logical representation of the conflict, not conflict markers"; conflicted commits "can be further rebased, merged, or backed out"; descendants auto-rebase when a parent is rewritten, so one resolution propagates; there is no `--continue` state machine; criss-cross and octopus merges "become trivial". The operation log makes every repo mutation undoable. (https://docs.jj-vcs.dev/latest/conflicts/)

Grove (POPL 2025) is the formal endpoint: a structure-editor calculus where "all edits commute, i.e. the repository state forms a commutative replicated data type", with relocation conflicts represented explicitly as holes. Proven, but for a toy language and an editor, not git.

These three give beanstalk a usable principle: a conflict is data that can be stored, shipped, rebased and resolved later by whichever agent has context, rather than a blocking state in one worktree.

### C3. Intent conflicts and write-time coordination

Foremerge (Woodhead, Aug 2026): agents publish an intent with semantic scopes (`symbol`, `api`, `schema`, `config`, `migration`, `contract`) and a declared operation (`replace`, `extend`...), stored in SQLite in the git common dir and queried over CLI/JSON/MCP; deterministic rules flag `destructive_vs_additive` and similar findings before code exists. Motivating failure: two worktrees, zero textual conflict, clean merge, broken design ("Git compares diffs. It cannot compare plans."). HN thread (id 49789356): tested with 98 parallel agents; replaying 76 real intents produced exactly one flagged conflict; objections that agents cannot know scopes in advance (answer: only destructive ops must be declared accurately) and that it "bolts something onto a broken workflow". (https://foremerge.com/blog/parallel-coding-agents-without-the-carnage/, https://news.ycombinator.com/item?id=49789356)

Autonoma's writeups ("The Silent Killer", "The Merge Tax") document the same class: three agents, three clean PRs, three green CI runs, one broken product, because a resolving agent "knows neither side's intent" and features "simply stop existing". Their prescription is serialized queues plus behavioural (E2E) verification; their "73% of engineering leads report delivery delays increased" is an uncited vendor statistic. (https://getautonoma.com/blog/ai-subagent-merge-conflicts)

Leases and ownership. Sourceshift/ContextNest: time-bounded scoped claims granted by a registry; "a message channel is not concurrency control"; cites arXiv 2606.07845 showing LLM agents on dining-philosophers either collide or converge on an "everybody do nothing" truce. Cosmin Pop: six agents, disjoint file allowlists enforced by a pre-write hook, after a `git add -A` swept another agent's half-done rename into a commit. agent-semaphore combines intent claims, write-time enforcement, a `merge-tree` conflict radar and a test-gated landing queue. claude-coord and ruah are file-glob locks. CODEOWNERS-as-locks is the same idea with worse granularity. (https://blog.sourceshift.io/p/coordinating-a-fleet-of-llm-agents-on-one-codebase/, https://cosminpop.uk/2026/08/19/file-ownership-agent-coordination/)

Proven vs hype: disjoint path ownership plus worktrees demonstrably eliminates lost updates; declared semantic scopes catch the destructive/additive class at least in replay; nothing yet shows that CRDT text merging helps code (it merges bytes, not programs). ML "predictive merge engines" (AgentVCS) are unevidenced.

---

## D. Proposals for agent-native version control

- Pedro Piñera, "Rethinking Version Control for an Agentic World" (Jan 2026): git and forges "assume humans writing code in isolation"; points at jj's conflict model as the first new abstraction people reach for. (https://pepicrft.me/blog/rethinking-version-control-for-agents/)
- Chris Cullins, Flock: tree-sitter AST layer in the VCS; conflict detection by structural overlap; risk classification per change. (https://programmingwithchris.dev/posts/version-control-is-broken-for-the-agentic-world/)
- tig (Shet, May 2026): "workspaces, automatic snapshots, recorded runs, and clean review units" instead of branches/PRs; every edit is a snapshot; a test run is attached to the exact snapshot; publication is a policy decision; git is an export format. (https://github.com/KrtinShet/tig)
- Phantom: changesets keyed by symbols instead of branches, FUSE copy-on-write overlays instead of worktrees, AST merge, append-only event log, live warnings when trunk touches symbols an overlay depends on. (https://github.com/Maelwalser/phantom)
- AgentVCS: "semantic commits with intent, risk levels, and reasoning traces", review swarms, a "predictive merge engine". Claims only.
- Capturing the why: Entire.io checkpoints pair every commit with the agent session that produced it (`Entire-Checkpoint` trailer, shadow branches condensed to `entire/checkpoints/v1`, `resume`/`explain`; squash merges carry multiple trailers), and the hosted product claims 570,000 clones/hour and 2.1M pushes/hour; Atlas (session-linked commits, "observed, not intercepted", 2,980 stars); aig; Agent Note; agit (git notes). All treat the prompt and transcript as part of the change record. (https://entire.io, https://github.com/entireio/cli)
- Git4Data (arXiv 2609.02106): database branching/merging for agents exploring candidate states; Freestyle Git: API-first repos for agent filesystems.
- Claude Code's own pattern: `claude --worktree <name>` creates `.claude/worktrees/<name>` on branch `worktree-<name>`; subagents can declare `isolation: worktree`; the directory is `git worktree lock`ed while running. Writeups stress what worktrees do not isolate: hooks, caches, databases, ports, and the shared `.git`. Augment's guide formalises the orchestration: spec-scoped tasks, worktree isolation, coordinator/specialist/verifier roles, sequential merges. (https://tim-schipper.nl/en/blog/git-worktrees-parallel-coding-agents, https://www.augmentcode.com/guides/multi-agent-ai-system-code-development)

The recurring primitives across these: task/intent as the unit of work (not branch), continuous snapshots with attached run evidence, conflicts as storable objects, declared scopes before writing, and the prompt/transcript as a first-class artifact of the change.

---

## What a merge system for 10,000 concurrent agents must do differently

1. Admission control before CI, not after. With 79% temporal co-activity and 22% of fix PRs dying as "resolved by another PR", the queue must dedupe by intent/scope and cancel obsolete work at enqueue time. Every FIFO above spends CI on PRs that should never have been tested.
2. Declared semantic scopes as the independence oracle. Build-target hashing (Uber, Aviator) is the only proven independence test; beanstalk should add declared scopes (symbol/api/schema/contract with operation) so `replace` vs `extend` collisions are rejected at claim time, the way Foremerge and agent-semaphore do.
3. Conflicts as objects, not blockers. Adopt jj's model: a conflicted merge is a stored state that can be shipped to the agent with the right context, rebased, and resolved asynchronously. This removes the "one worktree stuck in `--continue`" serialisation entirely.
4. Structured merge first, behaviour check second. Run a Mergiraf-class tree merge to dissolve spurious textual conflicts, then require build plus affected tests, because the literature shows structured merge converts spurious conflicts into missed real ones.
5. Bounded speculation with adaptive windows. Uber's tree doubles per conflicting change; Zuul's AIMD window (start 20, +1 per success, halve per failure) is the right control loop. Speculate only along paths whose success probability clears a threshold (Uber's 97%-accuracy predictor is the template).
6. Out-of-order landing when provably safe. Implement BLRD's rule: a change may bypass earlier ones if every speculation path has been verified with identical outcome. This alone cut Uber's P95 wait by 74% and is essential when agent PR sizes vary 10x.
7. Bisection, never tail-restart. Mergify/bors/Graphite bisect failed batches; GitHub, GitLab and Aviator restart the tail. At agent failure rates (30% of main merges failing per CircleCI), tail restarts are quadratic. Bisect, and quarantine the culprit with its transcript attached.
8. Hermeticity and flake handling as queue inputs. Both Uber and Chromium note the whole scheme collapses on non-deterministic tests (Chromium: ~20,000 flaky tests). The queue must own retry-without-patch logic and track per-test flake rates rather than trusting a single red.
9. Priority and fairness that are not FIFO. Rust's homu history shows FIFO-by-number starves large PRs and bors' "never batch across priorities" rule matters. Agent fleets need per-task priority, ageing, and a cap per principal so one runaway orchestrator cannot monopolise the lane.
10. Write-time leases for hot files, not post-hoc merge. Config, routes, registries, migrations, schemas are the documented collision hotspots; grant time-bounded scoped leases (ContextNest) or disjoint allowlists (Cosmin Pop) for these, since LLM agents cannot negotiate contention themselves (arXiv 2606.07845).
11. Evidence attached to every candidate. tig's "runs are first-class" and Entire's checkpoints point the same way: the queue should consume the agent's own test run, prompt, and intent as inputs to the success predictor and as the audit trail when a merge later proves wrong. Faros' 31%-unreviewed and 3x incident figures are the cost of merging without it.
12. Review as a sampled, risk-weighted gate. Human review time rose 91% then 441%; it cannot scale linearly with agent output. Route only high-risk scopes (destructive operations, contract changes, security hotspots) to humans; let docs-class changes (82% acceptance) auto-land under the evidence gate.

---

## Source index

- AIDev dataset: https://arxiv.org/html/2507.15003; https://zenodo.org/records/16919051
- Co-activity and conflict rates: https://arxiv.org/html/2607.04697
- AgenticFlict: https://zenodo.org/records/20118379; https://github.com/unlv-evol/agenticflict
- Unmerged fix PRs: https://arxiv.org/html/2602.00164
- Post-merge quality: https://arxiv.org/html/2601.20109
- Task-stratified acceptance: https://arxiv.org/html/2602.08915v2
- Rejection rationale: https://www.alphaxiv.org/abs/2605.22534; https://arxiv.org/abs/2606.13468
- Collaboration signals: https://dl.acm.org/doi/full/10.1145/3793302.3793561
- CircleCI 2026: https://circleci.com/blog/five-takeaways-2026-software-delivery-report/; https://circleci.com/blog/five-takeaways-2026-q2-pulse/; critique https://blog.robbowley.net/2026/04/02/more-code-less-delivery-but-does-the-circleci-2026-report-really-show-1-in-20-teams-are-benefiting/
- Faros: https://www.faros.ai/blog/ai-software-engineering; https://www.faros.ai/blog/ai-acceleration-whiplash-takeaways
- 2x mandate: https://arxiv.org/html/2607.01904
- GitHub availability: https://github.blog/news-insights/company-news/an-update-on-github-availability/
- GitHub MQ docs: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue
- GitLab: https://docs.gitlab.com/ci/pipelines/merge_trains/
- Mergify: https://docs.mergify.com/merge-queue/batches/; https://mergify.com/blog/github-s-merge-queue-isn-t-enough-for-large-teams
- Aviator: https://docs.aviator.co/mergequeue/concepts/parallel-mode; https://docs.aviator.co/mergequeue/concepts/affected-targets
- Graphite: https://graphite.dev/blog/the-first-stack-aware-merge-queue
- bors: https://github.com/bors-ng/bors-ng; https://internals.rust-lang.org/t/homu-queue-woes-and-suggestions-on-how-to-fix-them/8954
- Zuul: https://zuul-ci.org/docs/zuul/latest/gating.html
- Uber: https://blog.acolyer.org/2019/04/18/keeping-master-green-at-scale/; https://www.uber.com/ci/en/blog/bypassing-large-diffs-in-submitqueue/; https://arxiv.org/html/2501.03440; https://github.com/uber/submitqueue
- Chromium CQ: https://chromium.googlesource.com/chromium/src/+/main/docs/infra/cq.md
- Mergiraf: https://mergiraf.org/; https://antonin.delpeuch.eu/posts/mergiraf-a-syntax-aware-merge-driver-for-git/; MergirafSemi https://www.alphaxiv.org/abs/2608.11345
- GumTree 2024: https://dl.acm.org/doi/10.1145/3597503.3639148
- Pijul: https://pijul.org/manual/why_pijul.html; jj: https://docs.jj-vcs.dev/latest/conflicts/; Grove: https://dl.acm.org/doi/10.1145/3704909
- Foremerge: https://foremerge.com/blog/parallel-coding-agents-without-the-carnage/; HN https://news.ycombinator.com/item?id=49789356
- Autonoma: https://getautonoma.com/blog/ai-subagent-merge-conflicts; https://getautonoma.com/blog/ai-agent-merge-tax
- Leases/ownership: https://blog.sourceshift.io/p/coordinating-a-fleet-of-llm-agents-on-one-codebase/; https://cosminpop.uk/2026/08/19/file-ownership-agent-coordination/; https://github.com/alwh1te/agent-semaphore
- Agent-native VCS: https://pepicrft.me/blog/rethinking-version-control-for-agents/; https://github.com/KrtinShet/tig; https://github.com/Maelwalser/phantom; https://entire.io; https://github.com/entireio/cli; https://arxiv.org/abs/2609.02106
- Claude Code worktrees: https://tim-schipper.nl/en/blog/git-worktrees-parallel-coding-agents; https://www.augmentcode.com/guides/multi-agent-ai-system-code-development
