> Research memo produced 2026-10-03 by a Claude research subagent (web search + Exa + direct fetches) for the beanstalk brainstorm. Claims carry their source URLs; items marked UNVERIFIED were not confirmed. Edited lightly by the coordinating session.

# 03 — Cursor Origin and the agent-native git field

Competitive-intelligence memo for beanstalk (Cloudflare "Build the next GitHub" entry, deadline 2026-10-14). Researched 2026-10-03. Every factual claim carries a URL; demo-only numbers are labelled as such.

## 0. One-paragraph verdict

Origin is real, SpaceX-owned, and today is a deliberately plain GitHub clone with a very good storage layer. Its own lead says the differentiator is "Today, very little" ([HN](https://news.ycombinator.com/item?id=49334209)). Every agent-native promise (merge-to-green automation, understanding agent code, agent identity, MCP) is still "soon" ([changelog](https://cursor.com/changelog/origin-code-hosting)). The field has split into three layers: storage substrates (Continuity, Cloudflare Artifacts, Pierre Code Storage, Enroute, Entire's mirrors, GitLab next-gen SCM), review/merge workflow (Graphite, GitHub stacked PRs + merge queue, Augment Cosmos, Devin stacks), and a new "thread replaces PR" camp (Zed Delta). Nobody has shipped the coordination layer between concurrent agents, which is exactly what Cloudflare's brief asks for ([blog](https://blog.cloudflare.com/next-git-platform-on-cloudflare/)).

## 1. Cursor Origin

### 1.1 Verified timeline

- 2025-12-19: Cursor signs to acquire Graphite (stacked PRs, `gt` CLI, merge queue, Diamond reviewer); Axios: "way over" its $290M valuation ([Cursor](https://cursor.com/blog/graphite), [learncursor](https://www.learncursor.dev/learn/cursor-origin/graphite-acquisition)).
- 2026-06-16: Compile (Fort Mason, SF). Tomas Reimers announces Origin, "a git forge for the agentic era"; waitlist only, no blog post ([HN June thread](https://news.ycombinator.com/item?id=48558605), [keynote transcript](https://www.linkedin.com/posts/corey-stay-adaptatum-3a5506255_tomasreimers-cursor-graphite-activity-7475685319082905600-ojRs)). Same day SpaceX announces the $60B all-stock purchase of Anysphere ([HN](https://news.ycombinator.com/item?id=48553224)).
- 2026-08-13: Firetiger (production change monitors) joins Cursor ([Cursor](https://cursor.com/blog/firetiger)).
- 2026-08-14: SpaceX deal closes; X67 Inc. merges into Anysphere; Cursor becomes a wholly owned subsidiary inside "SpaceXAI"; 389,289,254 SpaceX Class A shares ([X/cb_doge](https://x.com/cb_doge/status/2088243652124639443), [satnews](https://satnews.com/2026/08/13/spacex-finalizes-regulatory-procedures-to-close-60-billion-acquisition-of-ai-platform-cursor/)). **The SpaceX angle is true, not a rumour.**
- 2026-08-17: early beta on all paid plans. GitHub suffers a 7h47m outage the same day ([VentureBeat](https://venturebeat.com/infrastructure/cursor-launches-origin-code-hosting-platform-as-github-outage-exposes-opening-in-ai-coding-race), [GitHub postmortem](https://github.blog/news-insights/company-news/the-august-17-outage-and-the-work-ahead/)). Matt Palmer (Cursor): "We were going to ship this earlier, but GitHub was down. Importing your GitHub repos as a first onboarding step is non-optimal if GitHub is down" ([New Stack](https://thenewstack.io/cursor-origin-github-alternative/)).
- 2026-08-18: Vicent Martí publishes "Git at any scale" describing Continuity, Origin's storage ([Cursor](https://cursor.com/blog/git-at-any-scale)).
- 2026-09-23: Rollouts (PR-to-production monitor, ex-Firetiger) and Security Review bots, Teams/Enterprise ([changelog](https://cursor.com/changelog/rollouts-and-security-reviewer)).

### 1.2 "What Cursor thinks is broken" (their words)

1. **Scale/volume.** Reimers, Compile: "As these companies adopted AI tooling, the tools that they relied on started to become unreliable... the first word that came to mind was scale... so many more lines of code, commits, pull requests" ([transcript](https://www.linkedin.com/posts/corey-stay-adaptatum-3a5506255_tomasreimers-cursor-graphite-activity-7475685319082905600-ojRs)). Landing page: "Code is moving faster than any infrastructure was built to handle" ([cursor.com/origin](https://cursor.com/origin)).
2. **Review and merge are the bottleneck, not writing.** "As writing code has become faster, reviewing changes, merging them safely, and collaborating effectively have increasingly become the bottlenecks" ([Graphite post](https://cursor.com/blog/graphite)). Rollouts post: "Writing code is no longer the slow part. What hasn't sped up is everything after the PR goes up" ([Cursor](https://cursor.com/blog/rollouts-and-security-reviewer)).
3. **Editor/forge boundary is arbitrary.** "The boundary between where you write code and where you collaborate on it feels increasingly arbitrary" ([Cursor](https://cursor.com/blog/graphite)).
4. **Spokes-style consensus hosting (GitHub's) has the wrong cost curve.** Martí: "Hosting Git repositories at scale is a nightmare"; of 3PC replication, "the floor is always too high, and the ceiling too low"; "You have to treat repositories as pets, not cattle"; "Agents have fundamentally changed the way we work with software, and in many ways they've made this situation worse. More code, more PRs, more CI runs" ([Git at any scale](https://cursor.com/blog/git-at-any-scale)).
5. **Humans as feedback relays and attention routers.** Reimers at Compile London (Sep 16): stop "using a person to copy review comments into an agent conversation"; the review product should surface states "Waiting for a response / Needs a reviewer / Has an unresolved decision / Has an agent-proposed fix / Ready to merge" ([notes](https://emrecavunt.com/blog/code-review-tomas-reimers-compile-london)).
6. **Outages.** The launch-day framing; Cursor's own doc now has a "If GitHub is unreachable" section with forge-local `origin/` branches ([docs](https://cursor.com/docs/origin/mirror-github)).

Not in Cursor's own words but attributed in coverage: auto-resolved merge conflicts, auto-fixed CI failures, "only tags you when it needs to", agent identity as first-class object, policy hooks before a tool runs, ownership rules auto-routing agent changes ([Rattibha thread](https://en.rattibha.com/thread/2067153200852193339), [Backfield](https://backfield.net/river/card/5469), [Logic Decode](https://logicdecode.in/blog/cursor-origin-git-hosting-for-ai-agents)). Explicit "rate limits" language comes from Entire and HN users, not Cursor ([SiliconANGLE](https://siliconangle.com/2026/07/08/ex-github-chiefs-entire-opens-distributed-git-network-agent-era/), [HN arjie](https://news.ycombinator.com/item?id=49334209)).

### 1.3 Shipped (as of 2026-10-03)

Per [changelog](https://cursor.com/changelog/origin-code-hosting), [docs](https://cursor.com/docs/origin), [PR docs](https://cursor.com/docs/origin/pull-requests), [CLI docs](https://cursor.com/docs/origin/cli), [mirror docs](https://cursor.com/docs/origin/mirror-github), [integrations](https://cursor.com/docs/origin/integrations), [forum](https://forum.cursor.com/t/origin-code-hosting/168670):

- Repos at `cursor.com/codebase/{owner}/{repo}`, clone URL `https://origin.cursor.com/{owner}/{repo}.git`, standard git over HTTPS; `origin` CLI (`origin auth login` installs a credential helper, `origin repo create/delete`). Namespace name cannot be changed in beta. Windows only via WSL. No SSH (forum: "moving a 100mb bun binary that breaks on non-standard systems").
- PRs: Activity / Commits / Checks / Files Changed tabs, reviewers, line comments, merge; "Origin surfaces merge conflicts so you can resolve them before merging" (manual, not automatic).
- Code browsing and search; submodule browsing incomplete.
- GitHub mirror: GitHub stays source of truth; two-way PR comment sync "within seconds"; Issues, Actions workflows and secrets do not sync; `origin/` branches + `origin push local` as a write path while GitHub is down; "Detach from GitHub" converts a mirror into a native repo.
- Agents: ask about browsed code, make changes, update PRs, push a branch; cloud agents clone/branch/commit/open PRs; Automations trigger on push/PR events; local agents can create Origin repos.
- Apps: Vercel preview per PR; Depot and Buildkite run existing GitHub Actions workflows; a Public API and private "Origin Apps".
- Permissions: synced private repos are visible only to the syncer until set Internal; Privacy Mode follows namespace owner.

### 1.4 Promised, not shipped

"Agent-native features ship soon" ([changelog](https://cursor.com/changelog/origin-code-hosting)). Reimers on HN: "integrations with agents, understanding agent-written code (without having to read through all of the code), and automatically getting your PRs to a mergable state" ([HN](https://news.ycombinator.com/item?id=49334209)). Stacked PRs and merge queue are not in the docs despite "we actually built this all on Graphite tech" ([HN](https://news.ycombinator.com/item?id=49334209)). MCP server, auto conflict resolution and the throughput figures remain demo claims never published on a Cursor property ([learncursor](https://www.learncursor.dev/learn/cursor-origin/commits-per-second)). GitLab sync: "Nothing in the near term" ([forum](https://forum.cursor.com/t/origin-code-hosting/168670)). GitHub API compatibility, ToS/data terms, pricing: asked, unanswered ([HN](https://news.ycombinator.com/item?id=49334209), [forum](https://forum.cursor.com/t/origin-code-hosting/168670)).

### 1.5 Architecture (first-party)

Continuity: write-ahead log of pushes in S3 (any S3-compatible store); each push a separate object; "We never acknowledge a push until it has been fully persisted"; pushes linearised via a WAL index updated by atomic CAS; local repos are normal git on NVMe as a "warm cache"; no routing table or relational DB, rendezvous hashing picks a preferred primary but "any server can be the primary"; replication by UDP gossip plus ETag conditional GET (<10ms 304); only the primary compacts and replicas download compacted packs; linear read scaling tested to 100 replicas; 120 pushes/s on S3 Standard, >300 pushes/s on S3 Express One Zone, bottlenecked by git compaction; idle replicas garbage-collected and rematerialised from the WAL ([Git at any scale](https://cursor.com/blog/git-at-any-scale)). Author Vicent Martí is an ex-GitHub architect ("after poaching one of GitHub's architects", [bytes.dev](https://bytes.dev/archives/514)). The web app runs on Vercel per Guillermo Rauch ([VentureBeat](https://venturebeat.com/infrastructure/cursor-launches-origin-code-hosting-platform-as-github-outage-exposes-opening-in-ai-coding-race)). Demo-only: 22.6 commits/s, ~296k clones/h, ~81k pushes/h, <400ms global sync, ~10ms failover ([Logic Decode](https://logicdecode.in/blog/cursor-origin-git-hosting-for-ai-agents)).

### 1.6 Pricing

No standalone price; bundled into Pro, Teams ($40/user/mo), Enterprise; no free tier; no public repos ([DigitalOcean](https://www.digitalocean.com/resources/articles/cursor-origin-vs-github), [RuntimeWire](https://runtimewire.com/article/cursor-builds-origin-to-host-code-from-fleets-of-ai-agents-launching-today)).

### 1.7 Community reaction

- **HN beta thread** (597 points, 454 comments): "There seems to be basically nothing new here"; uptime USP contested ("SpaceXAI has shown no track record"); lock-in and GitHub API compatibility; "Where can I read your TOS... Will my code end up in Grok?"; the Grok Build repo-upload incident cited ([thehackernews via HN](https://news.ycombinator.com/item?id=49334209)); naming hazard "push to origin main" now ambiguous for LLMs; a request for agent-scale rate limits and single-tenant performance; Dagger's Solomon Hykes asks to integrate; Tangled (ATProto forge) plugged ([HN](https://news.ycombinator.com/item?id=49334209)). A second thread was flagged over Musk trust ([HN](https://news.ycombinator.com/item?id=49339359)). June thread: "I've never seen a waitlist for such little information" ([HN](https://news.ycombinator.com/item?id=48558605)).
- **Forum**: privacy policy, an "independent check before a PR merges" (answer: Bugbot), a signed/portable review record, SSH, GitLab sync, synced-repo visibility, Windows/WSL, submodules ([forum](https://forum.cursor.com/t/origin-code-hosting/168670)).
- **Press/analysts**: VentureBeat calls the mirror "a classic wedge"; InfoWorld's analysts list missing enterprise controls (rulesets, CODEOWNERS, signed commits, SSO/SCIM, audit export, secret scanning, SBOM, OIDC for CI) ([InfoWorld](https://www.infoworld.com/article/4211505/decoding-origin-cursors-github-rival-that-was-launched-during-the-latters-outage.html)); Coder CEO Rob Whiteley: "No one else is really integrating the 'managing code' stack"; Gergely Orosz: "If GitHub was stable, these alternatives would not be as interesting / popular!" ([New Stack](https://thenewstack.io/cursor-origin-github-alternative/)); Logic Decode: "Someone still has to review 22.6 commits a second" ([Logic Decode](https://logicdecode.in/blog/cursor-origin-git-hosting-for-ai-agents)).
- **Reddit**: reddit.com blocks crawlers and Exa returned zero r/cursor hits; no notable thread surfaced.

### 1.8 What Origin does not attempt

Issues, native CI/Actions, packages, releases, public/OSS repos, free tier, self-hosting, SSH, GitLab/Bitbucket sync, GitHub API compatibility, rulesets/CODEOWNERS/branch protection, signed commits, audit-log export ([DigitalOcean](https://www.digitalocean.com/resources/articles/cursor-origin-vs-github), [CellCog](https://cellcog.ai/blog/what-is-cursor-origin/), [InfoWorld](https://www.infoworld.com/article/4211505/decoding-origin-cursors-github-rival-that-was-launched-during-the-latters-outage.html)).

## 2. Other players

**GitHub.** Agent HQ (Oct 2025) makes Claude, Codex, Jules, Devin, Grok assignable inside GitHub under one Copilot subscription with a "mission control" ([github.blog](https://github.blog/news-insights/company-news/welcome-home-agents/), [Feb 2026](https://github.blog/news-insights/company-news/pick-your-agent-use-claude-and-codex-on-agent-hq/)). Native stacked PRs in public preview July 30 2026 ([changelog](https://github.blog/changelog/2026-07-30-stacked-pull-requests-are-now-in-public-preview/)); async merge API GA Oct 1 (only merge API supporting stacks and merge queue) ([changelog](https://github.blog/changelog/2026-10-01-github-async-merge-api-generally-available/)). Copilot code review can approve PRs (off by default) since Sep 1, auto-resolves addressed comments since Sep 11 ([changelog](https://github.blog/changelog/2026-09-01-copilot-code-review-can-now-approve-pull-requests/), [changelog](https://github.blog/changelog/2026-09-11-auto-resolution-and-analysis-updates-in-copilot-code-review/)). Its own guide admits "More than one in five code reviews on GitHub now involve an agent" and that agent code carries quiet debt ([github.blog](https://github.blog/ai-and-ml/generative-ai/agent-pull-requests-are-everywhere-heres-how-to-review-them/)). CTO Fedorov: must "design for a future that requires 30X today's scale"; monthly commits 1.4B (April) to 2.9B (August); ~130M merged PRs/month; Azure now 58% of load ([April](https://github.blog/news-insights/company-news/an-update-on-github-availability/), [Aug 20](https://github.blog/news-insights/company-news/the-august-17-outage-and-the-work-ahead/), [Developers Digest](https://www.developersdigest.tech/daily/2026-08-21)).

**GitLab.** Duo Agent Platform GA (Jan 2026), Custom Flows GA in 19.2 ([GitLab](https://about.gitlab.com/blog/gitlab-duo-agent-platform-is-generally-available/), [GitLab](https://about.gitlab.com/blog/multi-step-software-delivery-with-agentic-flows/)). More relevant: "Next Generation SCM" (Project Switch, private beta June 2026) lets agents query the server for exactly what a task needs, scoped visibility per agent, claimed 50x faster, 1000x less traffic; GitLab names the three breaks: "the clone tax", "concurrency collapse", "no isolation" ([GitLab](https://about.gitlab.com/blog/gitlab-next-gen-scm/), [IR](https://ir.gitlab.com/news/news-details/2026/GitLab-Announces-New-Capabilities-to-Give-Enterprises-Speed-and-Control-at-Agentic-Scale/default.aspx)).

**Graphite (now Cursor).** Stacked PRs, merge queue with parallel CI and batching, Diamond renamed Graphite Agent; "Cursor Cloud Agents are now in Graphite" ([Graphite](https://staging-graphite-splash.vercel.app/blog/introducing-graphite-agent-and-pricing), [merge queue](https://staging-graphite-splash.vercel.app/blog/merge-queue-batching)). It is Origin's engine.

**Entire (Thomas Dohmke).** $60M seed at $300M (Feb 2026). Checkpoints CLI captures agent prompts/transcripts/tool calls on a hidden `entire/checkpoints/v1` branch with an `Entire-Checkpoint` commit trailer ([docs](https://docs.entire.io/guides/checkpoints/capture-checkpoints), [internals](https://julien.danjou.info/blog/how-entire-works-under-the-hood/)). July 8: preview of a distributed Git network, regional read mirrors of GitHub repos (US/EU/AU), 570k clones/h and 586 pushes/s claimed, native hosting "in the coming months" ([SiliconANGLE](https://siliconangle.com/2026/07/08/ex-github-chiefs-entire-opens-distributed-git-network-agent-era/)).

**Foremerge** (Show HN, 2026-09-21). Local "git-like" intent-coordination layer above git: agents publish intents and scopes (`symbol:PaymentService=replace`) before editing; deterministic `destructive_vs_additive` conflict findings; SQLite in git common dir; Rust CLI + MCP with 18 tools; tested with 98 parallel agents ([HN](https://news.ycombinator.com/item?id=49789356), [repo](https://github.com/naw103/foremerge)).

**Autonoma (getautonoma.com).** Not a git player: agentic E2E testing that spins a preview environment per PR and generates tests; GitHub App, open-source agent ([site](https://getautonoma.com)).

**Jujutsu (jj).** Google-originated git-compatible VCS; working-copy-as-commit, auto-rebase of descendants, first-class conflicts, op log/undo. Agent ecosystem: `agentjj` porcelain, `pi-jj` checkpoints-per-turn, Claude skills ([agentjj](https://crates.io/crates/agentjj/0.1.1), [pi-jj](https://github.com/manojlds/pi-jj), [essay](https://thegrowthproject.com/blog/jujutsu-git-for-ai/)).

**Sapling (Meta).** Stacks instead of branches; ezyang's "Parallel Agents ❤️ Sapling" workflow for coordinating agents on one stack across worktrees ([ezyang](https://blog.ezyang.com/2026/03/parallel-agents-heart-sapling/), [Meta](https://engineering.fb.com/2025/10/16/developer-tools/branching-in-a-sapling-monorepo/)).

**GitButler.** `but` CLI and agent skill; parallel/stacked virtual branches, first-class conflicts, oplog; 0.22 ships native GitHub stacked PRs ([0.20](https://github.com/gitbutlerapp/gitbutler/releases/tag/release/0.20.0), [0.22](https://blog.gitbutler.com/gitbutler-0-22), [agent safety](https://blog.gitbutler.com/agentic-safety)).

**Pijul.** Patch-theory VCS; recent beta churn "inspired by recent bugs surfaced by AI agents using Pijul in parallel"; roadmap private; ecosystem too small for production ([discourse](https://discourse.pijul.org/t/is-there-a-roadmap-for-pijul-after-the-recent-beta-releases/1411), [Andy Smith](https://andysmith.ai/2026/Sep/1/pijul/)).

**Sourcegraph Amp.** Review agent decoupled from UI (`amp review`), repo-defined Checks in `.agents/checks/`; runners create per-thread worktrees ([Amp](https://ampcode.com/news/liberating-code-review), [Amp](https://ampcode.com/news/one-runner-many-worktrees)).

**Devin (Cognition).** Auto-splits large work into stacked PRs and rebases downstream after review; 659 Devin PRs merged in one week internally; schedules itself ([Devin](https://devin.ai/blog/introducing-pr-stacks), [Cognition](https://cognition.com/blog/how-cognition-uses-devin-to-build-devin)).

**OpenAI Codex.** Codex Cloud runs tasks on OpenAI VMs and opens PRs; DevDay (Sep 29) Code Review in the desktop app with a Stack view, GitLab in preview; a `babysit-pr` skill polls CI and review comments ([help](https://help.openai.com/en/articles/20001545-using-codex-cloud), [OpenTools](https://opentools.ai/news/codex-code-review-desktop-github-gitlab-launch), [commit](https://github.com/openai/codex/commit/0fe873ad5f4d0a9e5c5cc78fa34ad1e3ac373b64)). Separately, The Information reported OpenAI building its own GitHub alternative after outages (Mar 2026) ([PYMNTS](https://www.pymnts.com/news/artificial-intelligence/2026/openai-plans-create-github-alternative/)).

**Augment.** Cosmos review system: 1,400 open PRs and 20h median time-to-first-comment forced an agent team that auto-approves low-risk changes; "loop engineering" from PR to merge; guardrails guide for agent approval authority ([Augment](https://www.augmentcode.com/blog/solving-code-review-with-cosmos), [Augment](https://www.augmentcode.com/blog/optimizing-pr-to-merge-loop), [guide](https://www.augmentcode.com/guides/ai-agents-pull-request-approval-guardrails)).

**Factory.ai.** Droid CLI/SDK, plugins marketplace, `droid-action` with concurrent code and security review subagents ([plugins](https://github.com/Factory-AI/factory-plugins), [PR](https://github.com/Factory-AI/droid-action/pull/71)).

**Warp (Oz).** `oz-for-oss` workflows: PRs require a linked `ready-to-implement` issue before agent review; deterministic workflow owns PR creation and reviewer assignment ([PR](https://github.com/warpdotdev/oz-for-oss/pull/441), [issue](https://github.com/warpdotdev/oz-for-oss/issues/392/linked_closing_reference?reference_location=REPO_ISSUES_INDEX)).

**Replit.** Checkpoints snapshot files, DB and conversation; copy-on-write snapshot engine; agent commits appear under the user's identity ([docs](https://docs.replit.com/features/version-control/checkpoints-and-rollbacks), [blog](https://replit.com/blog/inside-replits-snapshot-engine), [forum](https://replit.discourse.group/t/is-there-a-way-to-have-the-git-log-show-the-agent-as-the-committer/10544)).

**Zed Delta** (public beta Sep 16). "Replace PRs": threads are the unit; DeltaDB records edits between commits plus human/agent messages; review subthreads get isolated worktree copies; Zed disabled PRs on Delta's own repo (570 changes by 33 people); CI still external; Git storage in DeltaDB promised ([Zed](http://zed.dev/blog/delta-public-beta), [New Stack](https://thenewstack.io/zed-delta-github-alternative/)).

**Pierre Code Storage.** API-first git storage used by Lovable and Bolt; "Git request rate limits: Unlimited (Seen: 500+/s/repo)"; quorum "spoke-like" architecture; hot/cold pricing; GitHub sync ([code.storage](https://code.storage), [bytes.dev](https://bytes.dev/archives/514)).

**Enroute** (Aug 2026, 82 stars). Rust, stateless git backend on object storage + Postgres, gRPC, auth/visibility/pre-receive/post-receive hooks; "open source alternative to Pierre and Cloudflare Artifacts" ([repo](https://github.com/enroute-sh/enroute)).

**Tangled.** ATProto-based forge with self-hostable "knots"; raised in the HN thread as the interoperable alternative ([HN](https://news.ycombinator.com/item?id=49334209)).

**Cloudflare Artifacts and its forges.** Artifacts: Durable Object per repo, Zig git engine in ~100KB Wasm, R2 snapshots, native git-notes for agent metadata, fork/import/events, Workers Builds deploys, $0.15/1k ops + $0.50/GB-mo, open beta Oct 1 ([blog](https://blog.cloudflare.com/artifacts-git-for-agents-beta/), [changelog](https://developers.cloudflare.com/changelog/post/2026-10-01-artifacts-open-beta/)). Known public builds:
- `mdhruvil/gitflare` (228 stars, Nov 2025): pre-Artifacts forge, git smart HTTP in Workers, one DO per repo, D1 metadata, issues, PRs "soon" ([repo](https://github.com/mdhruvil/gitflare)).
- `zllovesuki/git-on-cloudflare` (76 stars): git smart HTTP v2 on DO + R2, streaming packs, PATs ([repo](https://github.com/zllovesuki/git-on-cloudflare)).
- `Infrawrench/gitflare` (Aug 2026): Gitea-style forge on Artifacts + D1 + CI Workflows + gRPC; documents Artifacts gaps (no ref-listing API, no object-level writes, so it builds packfiles in a Worker) ([repo](https://github.com/Infrawrench/gitflare)).
- `mcc0nnell/gitflare` (Aug 2026): thin policy/status/handoff layer, GitHub stays the social mirror ([repo](https://github.com/mcc0nnell/gitflare)).
- `craigm26/steward` (Oct 2 2026, likely a competition entry): "the pull request as a decision" — claims board, per-agent forks with fork-scoped tokens, rival candidates, mechanical gate via Workers Builds previews, a judge (Workers AI) plus a referee, human steward decides, ledger with `Steward-Decision` trailers, why-blame, earned auto-merge per path ([repo](https://github.com/craigm26/steward)).

## 3. Feature table

| Capability | GitHub (Oct 2026) | Origin beta | Gap beanstalk can own |
|---|---|---|---|
| Storage | Spokes 3PC on NVMe, Azure migration | Continuity WAL on S3, linear read replicas | Artifacts gives this free; spend zero effort here |
| Repos/PR/browse | Full | Yes | Table stakes only |
| Stacked PRs | Public preview + async merge API | Not shipped (Graphite tech inside) | Stacks as native agent output |
| Merge queue | Yes | Not shipped | Agent-aware queue that re-runs agents on conflict |
| Agent review | Copilot can approve (opt-in) | Bugbot on GitHub, not Origin | Review as a signed, portable artifact (forum ask) |
| Agent identity | Bots/apps, no first-class agent | Promised | Agent principal with scope, budget, token per fork (Steward does this) |
| Intent/claims pre-edit | None | None | Foremerge-style claims board inside the forge |
| Multi-candidate PRs | "Best of N" in Agent HQ UI | None | Rival candidates compared on live previews |
| Session/context capture | None | None (Rollouts post-merge) | Entire-style checkpoints via Artifacts git-notes |
| Why-blame | Blame on lines | None | Decision record per merge, line → reason |
| Issues | Yes | No | Tasks as playbooks (done checks, budget, owner) |
| CI | Actions | Depot/Buildkite apps | Workers Builds previews as the gate |
| Public/OSS | Yes | No | Yes, since Artifacts costs cents |
| GitHub sync | n/a | One-way mirror, GitHub SoT | Import/fork via Artifacts `.import()` |
| Rate limits for agents | Per-user limits | Unpublished | Single-tenant DO per repo, no shared limits |

## 4. Positioning map

Axes: human-first ↔ agent-first; hosting substrate ↔ workflow layer.

- **Human-first, hosting**: GitHub, GitLab (classic), Tangled, Codeberg.
- **Human-first, workflow**: Graphite, GitButler, Sapling, jj (clients), Augment Cosmos, Devin stacks, Amp review, Warp Oz.
- **Agent-first, hosting**: Cloudflare Artifacts, Pierre Code Storage, Enroute, Entire mirrors, GitLab next-gen SCM, Origin's Continuity (today Origin sits here, with a human-shaped UI).
- **Agent-first, workflow**: Zed Delta (threads), Foremerge (intent claims), Steward (decisions), Entire Checkpoints (provenance). Sparse, young, and where Cloudflare's brief points.

beanstalk should sit in the empty top-right: agent-first workflow on an agent-first substrate, with GitHub kept as the human social mirror (the mcc0nnell/Origin/Entire consensus).

## 5. Ten things nobody has built yet

1. **A claims board inside the forge.** Foremerge does intent conflicts locally; no host exposes "who holds which files/symbols" as a server-side primitive agents must claim before pushing ([HN](https://news.ycombinator.com/item?id=49789356)).
2. **Agent principals with per-fork tokens and budgets.** Origin promised identity; Artifacts can issue repo-scoped tokens per fork; nobody ships principal + scope + spend cap + revocation as the auth model ([blog](https://blog.cloudflare.com/next-git-platform-on-cloudflare/)).
3. **Multi-candidate changes as one review object.** GitHub's best-of-N is a UI; a change with N rival candidates, each with a live preview and checks, judged then decided, exists only in a 1-day-old repo ([steward](https://github.com/craigm26/steward)).
4. **Merge queue that re-dispatches agents.** Graphite/GitHub queues bisect and eject; none hands the failing candidate back to its author agent with the failure attached and re-queues automatically ([learncursor](https://www.learncursor.dev/learn/cursor-origin/merge-queues)).
5. **Portable, signed review verdicts.** The forum ask Cursor deflected: a review finding as a verifiable artifact independent of the platform ([forum](https://forum.cursor.com/t/origin-code-hosting/168670)).
6. **Why-blame.** Line → decision → prompt/transcript, built on git-notes so it survives export; Entire has the capture, Steward the ledger, nobody has it on a hosted PR page ([docs](https://docs.entire.io/guides/checkpoints/capture-checkpoints)).
7. **Agent-scale rate limits as a product.** HN's clearest unmet wish: "separate tenancy so that I could absolutely slam my own instance"; a DO-per-repo makes this the default, not a tier ([HN](https://news.ycombinator.com/item?id=49334209)).
8. **Server-side partial reads for agents.** GitLab's next-gen SCM pitch (no clone tax, scoped visibility) has no open equivalent; Artifacts' `readFile` binding plus ArtifactFS is most of the way there ([GitLab](https://about.gitlab.com/blog/gitlab-next-gen-scm/)).
9. **A GitHub-down write path by design.** Origin bolted on `origin push local`; a forge whose default is "GitHub is a mirror, we are the agents' remote" with two-way reconciliation is the stated design of mcc0nnell/gitflare and Entire's roadmap, unshipped ([docs](https://cursor.com/docs/origin/mirror-github)).
10. **Attention routing as data.** Reimers' five review states (waiting, needs reviewer, unresolved decision, agent fix, ready) as queryable fields and webhooks so humans are paged only on judgment calls; Cursor described it on stage, no forge exposes it ([notes](https://emrecavunt.com/blog/code-review-tomas-reimers-compile-london)).
