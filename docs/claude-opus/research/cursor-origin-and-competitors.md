# Beanstalk competitor research: Cursor Origin and the agent-era forge race

Compiled 2026-10-03. Citations are bracketed numbers `[n]` that point to the source list at the end, which gives a URL and date for each. Figures a vendor reports about itself are marked **(self-reported)**. Where sources disagree, both versions are given.

---

## 0. TL;DR for Beanstalk

- **Origin, as shipped, is a credible git host with little that is new on top.** Its storage engine, Continuity, is a real engineering step [3]. The product is still a GitHub-shaped forge: repos, PRs, browsing and two-way GitHub sync, with only private repos and no native CI or issues [1][2][8]. Cursor's own engineer said on launch day that what sets it apart from GitHub is "Today, very little" [5]. As of 2026-10-03, no changelog entry adds agent-native features to Origin itself. Everything agent-flavored shipped around it instead: cloud agents that drive their PRs to green, Projects, the Rollouts and Security Review bots, and auto-created Origin repos [14][15][16][17].
- **Everyone is solving the write path. Few are solving the review and coordination path.** Storage and throughput work is crowded: Cursor Continuity [3], Entire [60], Pierre Code Storage [57], ERSC [76], GitLab next-gen SCM [104], Cloudflare Artifacts [109], and GitHub's Azure migration [43]. The thesis that review, alignment and coordination are the real bottleneck is stated by Graphite/Cursor [31][37], Zed [86], Entire [64], GitButler [72] and Cloudflare [114]. Only Zed has shipped a radical answer: it replaced PRs with threads [86].
- **Trust and custody is now a competitive axis, not a footnote.** The top HN comments on Origin were about SpaceX/Musk ownership and training on customer code, not features [5]. Origin shipped without published data terms [26][27]. OpenAI is building its own GitHub alternative [58]. Codeberg banned AI-majority projects [95]. A neutral, vendor-agnostic host with clear no-training terms and residency choices is an open position.
- **Cloudflare is actively recruiting Beanstalk-shaped projects.** Artifacts (git-compatible versioned storage built on Durable Objects and R2) reached open beta on 2026-10-01, and billing starts mid-October [110][112]. On the same day Cloudflare launched a "Build the next GitHub" competition: deadline **Oct 14, 2026**, finalists announced Oct 16, first prize $25k in credits, and the brief is "hundreds of thousands of agents working concurrently" [114][115]. Cloudflare's Workers Builds already supports Cursor Origin as a source [18].

---

## 1. Cursor Origin in depth

### 1.1 Timeline

| Date | Event | Src |
|---|---|---|
| 2025-12-19 | Cursor signs a definitive agreement to acquire Graphite, the stacked-PR and code-review company. The price was reportedly "way over" Graphite's last valuation of $290M. | [31][33] |
| 2026-01 | Deal closes. Tomas Reimers later said he "joined Cursor through our own acquisition this past January". | [10] |
| 2026-04-21 | SpaceX(AI) and Cursor announce a partnership that includes access to the Colossus compute cluster; 9to5Mac reports a $10B payment. | [36] |
| 2026-06-16 | At Compile in San Francisco, Tomas Reimers announces Origin, "our agent native Git platform", with a waitlist and a fall rollout. The same day, SpaceX announces a ~$60B all-stock deal for Cursor. | [10][6][36] |
| 2026-08-14 | SpaceX acquisition closes (TNW, citing a regulatory filing). TechCrunch gives Aug 15. | [35][4] |
| 2026-08-17 | Origin early beta begins rolling out to paid plans. GitHub has a 7h47m outage about 3.5 hours later. | [1][43][7] |
| 2026-08-18 | Engineering post "Git at any scale" by Vicent Martí, explaining the Continuity storage engine. | [3] |
| 2026-08-27 | Cloud agents can "Start from scratch" without any source-control connection; work is saved to an auto-created Origin repo. | [14] |
| 2026-09-10 | Cursor Projects launches: a coordinator agent that delegates to "thousands of subagents" and can follow PRs. | [16] |
| 2026-09-16 | Reimers talks on "Code Review in the Agent Era" at Compile London. | [37] |
| 2026-09-22 | Cloudflare Workers Builds adds Cursor Origin as a source. | [18] |
| 2026-09-23 | Rollouts and Security Review bots ship; both "connect to Origin or GitHub". | [15] |
| 2026-09-30 | InfoQ write-up of Continuity, noting the figures are not independently verified. | [29] |

### 1.2 What shipped on 2026-08-17

- **Scope.** "Designed for agent scale: repos, pull requests, code browsing, and GitHub sync. Agent-native features ship soon." [1]
- **Origin-hosted repos.** "Origin is the source of truth. Pushes land on Origin, and GitHub is not in the path." Each team claims a codebase namespace that becomes part of the URL (cursor.com/codebase/&lt;name&gt;). The namespace cannot be changed during the beta. [1][2][24]
- **Git access.** Standard git over HTTPS (`https://origin.cursor.com/{owner}/{repo}.git`) or the `origin` CLI. Repo settings cover General, Permissions, Rules and Protections, and Apps. [8][22]
- **GitHub-synced repos.**
  - GitHub stays the source of truth; Origin mirrors in real time.
  - PR comments, reviews and merges sync both ways "within seconds".
  - Permissions mirror GitHub read/write access.
  - Issues, Actions and Actions secrets are not synced.
  - A synced repo can be "detached", which makes Origin the source of truth. [1][7][23]
- **PRs.** Timeline, commits, checks, files changed, and merging. Agents in the UI can answer questions about code, make changes, update PRs, or push branches. [1][6]
- **Apps.**
  - Vercel: preview deploy per PR, ship on merge.
  - Depot and Buildkite: CI that runs existing GitHub Actions workflows unchanged.
  - Private "Origin Apps" can be built on the Public API; automations and cloud agents can be attached to repos. [1][2]
  - Cloudflare Workers Builds was added on 9-22 and posts check runs to Origin PRs. [18]
- **Gaps at launch.**
  - No public repos. Repos are private to members of a Cursor team; Reimers: "Over time we plan to expand access." [5][24]
  - No free tier. [2]
  - No native CI or issues; a small app ecosystem. [8][23]
  - No published SLA, rate or storage limits, or certifications. [40]

### 1.3 What Cursor says it is tackling, and why

1. **Agent-scale load on git hosting.**
   - At Compile, Reimers said the first word that came to mind was "scale": "so many more lines of code, commits, pull requests... we went back to basics and architected a novel Git architecture... In early load tests, we simulated thousands of agents... push and pull at the same time to a single repo." [10]
   - Vicent Martí: "Agents have fundamentally changed the way we work with software... More code, more PRs, more CI runs. Version control is at the core of all of this, and it is possibly the hardest thing to change overnight." [28] He adds that agents create "vast numbers of small repositories, many of them throwaway, and most of them barely touched." [28]
2. **Extensibility, framed as owning your own data.** "Through our APIs, our MCP, and third-party app platform... With generous rate limits and a comprehensive API, you are in full control of your own data." [10]
3. **Keeping code moving, which is the Graphite thesis.**
   - At Compile, Origin "can resolve merge conflicts, fix CI failures, and address comments. It automatically figures out next steps for each PR and only tags you in when it needs to." The transcript also says this cuts time-to-review by more than half, but that line is garbled. [10]
   - The Graphite deal post: "reviewing changes, merging them safely, and collaborating effectively have increasingly become the bottlenecks... The boundary between where you write code and where you collaborate on it feels increasingly arbitrary." [31]
   - Merrill Lutsky (Graphite CEO) describes a future "where PRs become self-driving, where the inner and outer loops collapse into one iterative process." [32]
4. **GitHub unreliability.** Cursor did not frame it this way, but it became the launch story.
   - Matt Palmer (Cursor): "We were going to ship this earlier, but GitHub was down. Importing your GitHub repos as a first onboarding step is non-optimal if GitHub is down." [6][7]
   - Guillermo Rauch (Vercel): Origin "is itself hosted on Vercel... And unlike GitHub, it's online." [7]
   - Gergely Orosz: "If GitHub was stable, these alternatives would not be as interesting / popular!" [6]
5. **Primitives promised on stage but not shipped** (as reported by one outlet): agent identity as a first-class object, traceable task history per call, policy hooks that fire before a tool runs, and code-ownership rules that route generated changes to human approval. [38]
6. **Reimers' current framing of review** (Compile London, 9-16). Review does three jobs: validation, change management, and alignment. He argues for removing manual feedback relays so agents get actionable issues directly, directing reviewer attention with status states (waiting, needs reviewer, unresolved decisions, agent-proposed fixes, ready to merge), and reviewing the actual output. [37]

### 1.4 Architecture hints (Continuity)

All from Martí's post unless marked otherwise. [3]

**Problem with the incumbent design**
- GitHub's Spokes keeps 3 NVMe replicas per repo and commits with three-phase commit (3PC). Tail latency gets worse as replicas are added.
- Every repo needs at least 3 mostly idle replicas, which is a "high floor, low ceiling" for millions of tiny agent repos.
- Repos must be treated as "pets": a routing database, constant checksumming, and repair work.

**Continuity's design**
- An S3-compatible write-ahead log is the source of truth, and local NVMe holds a normal git repo as a warm cache.
- Each push is a separate S3 object, and a push is acknowledged only after it is persisted. Visibility comes from a pointer in a WAL index object, which makes pushes linearizable.
- Writes are batched to avoid one S3 PUT per push.
- No consensus and no external database. Rendezvous hashing maps a repo ID to nodes, an atomic compare-and-swap on S3 lets any node act as primary, and a repo missing from disk is rebuilt from the WAL.
- Replicas learn of changes through UDP gossip and stay correct by checking the WAL index ETag with a conditional GET (average under 10 ms). A 304 means serve immediately; a 200 means catch up first.
- Only the primary compacts; replicas download the compacted packs.
- Tiny agent repos get one replica, monorepos get hundreds for CI load, and idle repos are evicted from disk.
- Production runs on S3 and the design is portable to any cloud. Azure DevOps (packfiles in blobs, refs in SQL Server) is contrasted as the alternative.

**Numbers (self-reported)**
- Pushes per second, measured on Cursor's monorepo: up to 120/s on S3 Standard and over 300/s on S3 Express One Zone, where git compaction becomes the bottleneck. [3][29]
- Reads scale linearly, tested to 100 replicas. [3][29]
- Compile demo figures (22.6 commits/s to one repo, ~296k clones/h, ~81k pushes/h, under 400 ms global sync, ~10 ms failover) come from third-party coverage of the demo. They are not on any Cursor property. [11][12]

**Other details**
- Reimers on HN: "we actually built this all on Graphite tech." [5]
- Graphite's review surface now appears in Cursor docs as "Cursor Review" (closed beta): PR inbox, PR page, a stack-aware merge queue with batching, bisect and fast-track, and the `gt` CLI. [34]

### 1.5 Pricing, availability and terms

- Included in paid plans (Start, Pro, Pro+, Ultra, Teams, Enterprise). There is no separate price, no free plan, and no GA date. [2][13]
- Rollout is opt-out: "all paid plan users... except enterprise orgs whose admins opt out", and admins can disable it at any time. [1][2][27]
- No Origin-specific data terms covering retention, training use, subprocessors, or export were published at launch. [25][26][27] After users asked in the forum, the docs gained: "Origin follows the Privacy Mode of the namespace owner." [2][19]
- Storage is US-only and there is no EU residency, according to a third-party analysis (the sota.io post listed under [27]). Cursor has not confirmed this.

### 1.6 "Agent-native" features since launch (Aug 17 to Oct 3): promised versus shipped

**Promised**
- Reimers on HN, 8-17: "Over the next few weeks you can expect a lot more from us on integrations with agents, understanding agent-written code (without having to read through all of the code), and automatically getting your PRs to a mergable state." [5]
- From the June demo: intent-aware conflict resolution, an agent-aware merge queue, and native stacked diffs. [13][22]

**Shipped near Origin, though none of it is an Origin-specific changelog entry**
- **8-19:** Cloud agents "automatically subscribe to PRs they create and drive them to completion, fixing CI and addressing bot comments." [17]
- **8-27:** Starting a cloud agent from scratch auto-creates a "fully scaffolded Origin repo" with private or internal visibility. [14]
- **9-10:** Projects can follow every PR, fix CI, and run thousands of subagents on isolated VMs. [16]
- **9-23:** Rollouts writes a monitoring plan for each PR, checks logs, metrics and traces per environment, and can open revert PRs (it does not merge or roll back). Security Review posts one exploitability comment per PR. Both work with Origin or GitHub. [15]

**Observed by users**
- Stacked PRs work through the undocumented flag `origin pr create --stack-on`. Restacking is a manual button that fails on conflicts. A one-click "Squash and merge" of a stack does not actually squash. Mirrors have a timing gap during state transitions. [21]
- Grok Bot (SpaceXAI) gets a read-only `origin` CLI. A Cursor staffer: "Merging is a deliberate human step for now." `origin pr merge --auto` exists. [20]

**Verdict as of 10-03:** The latest Cursor changelog entry is 9-23 [17]. No Origin-specific agent-native release has shipped: no auto conflict resolution in Origin, no agent-aware queue in Origin, no "understand agent code" feature. The agent-native layer is arriving as Cursor-wide bots and agents that treat Origin and GitHub the same way.

### 1.7 What executives have said

- **Tomas Reimers** (Graphite co-founder, Origin): the Compile keynote [10], an HN AMA where he was the OP [5], and Compile London [37].
  - On differentiation: "We're intentionally releasing this as a Github alternative where we meet them toe-to-toe on functionality." [5][6]
  - On jj: "We are very interested in this. If anyone can put us in touch with the JJ maintainers we would love to chat!" [5]
  - On CI: invited Solomon Hykes to talk about Dagger CI. [5]
- **Vicent Martí** (principal systems engineer, previously on GitHub's git infrastructure team): the Continuity post. [3][28] HN noted his reputation from GitHub's internal systems. [30]
- **Michael Truell** (CEO) gave the Compile keynote, framing Cursor as a "platform... fundamentally built for working with agents, to be agent first." [10]
- **Cursor staff in the forum** confirmed Privacy Mode handling, no near-term GitLab sync, and limited submodule support. [19]

### 1.8 Reactions and criticisms

**Hacker News, Origin launch thread** (597 points, 414 comments [5])
- Trust and ownership dominated:
  - "throw our code into a Musk owned enterprise... How about neither?"
  - "My assumption is x.ai will be training on any code hosted here"
  - Requests for the ToS and whether "my code will end up in Grok". [5]
- Decentralization advocates: "invest all effort into a decentralized solution, like Radicle or federated Forgejo" (73 replies), plus Tangled on ATProto. [5]
- Disappointment with scope: "I expected more than a GitHub clone... There's a lot of space to innovate around collaboration and version control in the age of agentic workflows." [5]
- Naming: "push to origin main" now has two meanings, so an LLM might push to the new provider by accident. [5]
- Other friction: SMS phone verification, a site that uses 100% CPU, a required Cursor account, and private-only repos. [5]
- Requests:
  - GitHub API compatibility, so existing tooling keeps working.
  - Higher RPS and dedicated tenancy, because "SaaS... rate-limited on things a single 5950x can handle".
  - Native jj.
  - Fediverse/Forgejo interop. [5]

**Hacker News, "Git at any scale"** (371 points [30])
- Praise for the author.
- Critique: "pushing many of the hard problems into S3 and assuming S3 'just works'."
- Others argued git performance isn't the problem: "it's GitHub Actions, PRs, etc." [30]
- Mitchell Hashimoto independently made the same point: "the issue isn't Git, it's the infrastructure... around it: issues, PRs, Actions." [56]

**Reddit** (could not fetch reddit.com directly; summarized from InfoQ)
- r/github framed Origin as a land grab for the developer stack after the SpaceX deal. [8]
- r/cursor noted Origin is tightly bound to Cursor accounts. [8]

**Analysts and press**
- InfoWorld: GitHub remains the safer system of record. Origin is missing branch rulesets, CODEOWNERS, required reviewers, signed commits, SSO/SCIM, SIEM-shippable audit logs, secret scanning, SBOM, package registries, ISO 27001, FedRAMP, and residency. Vendor lock-in becomes a risk when one AI vendor owns the whole loop. [9]
- VentureBeat: GitHub's Agent HQ "concedes the agent layer and keeps the substrate underneath. Origin attacks precisely that substrate"; and "the company that spent Monday selling trust has yet to publish its terms." [7]
- Digital Applied: a "framing problem", since the changelog keeps GitHub as the source of truth. [41]
- Layer3: run both and trial Origin on a low-risk repo. [40]

**Cursor forum**
- Agent panel doesn't work on synced repos.
- Windows/WSL CLI PATH problems.
- Submodules are not supported in PR review.
- Request for GitLab sync. [19]

### 1.9 Takeaways for Beanstalk

1. Origin's moat is distribution: the editor, agents, the Graphite team, and SpaceX compute. It is not novel forge primitives. Its weak spots:
   - trust and custody [26][27]
   - no OSS or public repos [24]
   - outsourced CI [1]
   - enterprise controls [9]
   - "agent-native" that is still mostly promise [1][5]
2. Continuity shows the storage design is converging: object storage as source of truth plus a local git cache. That matches what Cloudflare offers (DO + R2) and what GitLab next-gen SCM and Entire use [3][104][109][60].
3. Origin's app model (Vercel, Depot, Buildkite, Cloudflare Workers Builds) shows that check runs, webhooks and preview deploys are table stakes for adoption [1][18].

---

## 2. Why now: the GitHub context

- **Reliability.**
  - CTO Vlad Fedorov: "We started executing our plan to increase GitHub's capacity by 10X in October 2025... By February 2026, it was clear that we needed to design for a future that requires 30X today's scale." [44] Since late December 2025, "agentic development workflows have accelerated sharply." [45]
  - April 23: a merge queue regression produced bad squash merges in 658 repos and 2,092 PRs, and some default branches could not be auto-repaired. [44]
  - August 17: 7h47m outage, attributed to a capacity failure at a new traffic peak plus a Copilot retry storm. Monthly commits went from 1.4B to 2.9B since April, and Azure now carries 58% of platform load. [43]
  - LeadDev counted 257 incidents in a year, 48 of them major. [7][45]
- **Defections.**
  - Zig moved to Codeberg (Nov 2025), citing GitHub Actions failures and misaligned incentives. [97][98]
  - Ghostty is leaving GitHub (2026-04-28): "This is no longer a place for serious work if it just blocks you out for hours per day, every day." [56]
  - OpenAI is building an internal GitHub alternative and may offer it to customers (2026-03-03). [58]
- **Leadership.** Dohmke resigned in Aug 2025 and was never replaced; GitHub sits inside Microsoft CoreAI under Jay Parikh. The Information reported Parikh warning that Cursor and Anthropic tools could make GitHub obsolete. [7]
- **Hashimoto's prescription for GitHub** (via Pragmatic Engineer):
  - "Establish a North Star plan around being critical infrastructure for agentic code lifecycles"
  - "Buy Pierre and launch agentic repo hosting"
  - "Code review should be agentic but the labs should be building that into GH... real first class platform primitives"
  - "agent mailboxes are obviously good. GH should be a platform and not an agent itself." [57]

---

## 3. Survey of challengers and adjacent tools

### GitHub's own response
- **Agent HQ and mission control** (Universe, 2025-10-28): orchestrate third-party agents (Anthropic, OpenAI, Google, Cognition, xAI) inside GitHub. [46][7]
- **Copilot cloud agent:**
  - Plans, deep research, and branches before a PR (4-01). [53]
  - Scheduled and event-triggered automations (6-02). [53]
  - CodeQL, advisory and secret checks on third-party agents' code, on by default (6-09). [51]
  - Enterprise-managed allow/approve/block rules for agent shell, file and network operations (9-09). [52]
- **Agentic Workflows** (agents in Actions): technical preview 2-13, public preview 6-11. [50]
- **Stacked PRs:** private preview 4-13, public preview 7-30 with the `gh-stack` CLI and an agent skill; merge queue support rolling out after that. [47][48] GitHub's blog teaches agents to split one giant AI PR into a stack. [54]
- **Async merge API** (GA 10-01): queue-friendly and "the only merge API that supports stacked pull requests", built so automations handle busy repos. [49]
- **Thesis:** keep the substrate (repos, PRs, Actions) and become the control plane for every agent. Fix scale with capacity, the Azure migration, isolation, moving code from Ruby to Go, and "read capacity linearly with the number of readers." [43][44][55]

### GitLab
- **Duo Agent Platform** (GA 2026-01-15): foundational, custom and external agents (Claude Code, Codex), MCP, and monthly credits of $12/$24 per user. [103]
- **Transcend** (2026-06-10):
  - Next-gen SCM in private beta: agents "query the repository server-side for exactly what each task requires" with least-visibility access, claiming up to 50x faster tasks, 2x fewer tokens, and 1000x less network traffic. Anthropic is a design partner. [104][105][87]
  - Orbit, a lifecycle context graph, in public beta (11x faster, 4.5x fewer tokens). [107]
  - Governance for Agents in private beta. [104]
- **Thesis (8-26):** the core problem is the "clone tax", concurrency collapse, and agents sharing accounts with no isolation. Standalone agent git hosts miss **provenance** ("which agent did what, under which policy, and can we prove it?") and what happens **after success** (graduating an experiment into governed CI, policy and audit). [106] The demo claims ~42x faster clones and ~17x faster 100-task fan-out. [108]

### Entire (Thomas Dohmke)
- **Funding and first product:** $60M seed at $300M (Feb 10, led by Felicis; M12 and Madrona participating). The first product, Checkpoints, stores agent transcripts, prompts and tool calls in git. [63][64]
- **Distributed Git Network preview** (7-08):
  - Mirror a GitHub repo to US/EU/AU regions; agents clone and pull locally.
  - Region-local branches; India region added later.
  - Claims (self-reported) 570k clones/h, 586 pushes/s, ~470 mixed ops/s. [60][61][66]
  - Plans: open-source the backend and benchmarks, native repos, self-hosted nodes, tamper-evident history, policy-as-code branch protection verifiable by any client, a new CI/CD stack, and "intent-based review". [62][65]
  - Other features: Entire Blame (traces a line to the agent session), Entire Review (parallel intent-aware review), and semantic search over the reasoning behind code. [60]
- **Thesis:** "centralized Git hosting has become a fundamental constraint... rate limits, high latency, or even outages." "Session logs are now the second most important" artifact. Version control "preserves change, but... not meaning." [60][61][64]

### Pierre Computer Company: Code Storage (Jacob Thornton)
- White-label, API-first "git for machines":
  - JWT-scoped remotes with TTLs
  - ephemeral branches, in-memory writes, cold storage, grep, git notes
  - SDKs in TS, Python and Go [69][71]
- Claims **(self-reported)**: a sustained peak above 15,000 repos/min for 3 hours and more than 9M repos in 30 days, against GitHub's ~230/min. [57]
- Signups opened 2026-08-18. Customers named: Lovable, Bolt, Amp, Poke. [68]
- Funding: $23M led by CRV and O1A (from a weak secondary source). [70]
- **Thesis:** AI app builders need millions of repos per day with no rate limits or auth friction. It is infrastructure, not a forge for humans. [71]

### Cloudflare Artifacts (and the competition)
- **What it is:** "a versioned file system that speaks Git", built on Durable Objects plus a ~100KB Zig git server compiled to Wasm, with R2 snapshots, KV auth and SQLite in the DO. [109]
- **Features:** git-notes for agent metadata, LFS, import from GitHub, mass forks (e.g. "10,000 forks from known-good starting point"), and ArtifactFS (lazy hydration: a 2.4GB repo is usable in 10-15s instead of ~2 minutes). [109]
- **Pricing:** $0.15 per 1k operations and $0.50/GB-month (10k operations and 1GB included). Workers Paid only. Billing starts 10-14 per the changelog and docs, 10-15 per the blog. [110][112][114]
- **Limits:** 1GB per repo, 32MB per blob, 1TB per account, 2,000 git requests per 10s per repo. [111]
- **Open beta (10-01):** Workers Builds integration, event subscriptions (push, create, fork, delete, clone, fetch), US/EU jurisdictions, and metrics. [110][114]
- **CI SDK** (8-04): TypeScript Workflows plus Sandbox steps with R2-cached dependencies and self-healing agents, aimed at "platforms... using millions of repos on Artifacts." [113]
- **Thesis, from the 10-01 competition post:** "How do agents know what other agents are working on? What happens when they make conflicting changes? How do you review everything they produce?" The ask is to "reimagine... repositories, branches, pull requests, worktrees, code review, and merge conflict resolution" for "hundreds of thousands of agents." [114][115]
- **HN critique:** operations cost "30x higher PUT/POST" than S3, so batching is vital; "who is the target market?" [116]

### Zed: DeltaDB and Delta
- **DeltaDB** (announced 6-11): operation-level version control. Every delta has a stable ID, conversations are anchored to code, worktrees are CRDT-replicated, and it is git-compatible (commits remain checkpoints). [84]
- **Delta:** private beta 8-12; public beta 9-16, free during the beta. Zed turned off PRs on Delta's own repo, and "33 of us have landed 570 changes to main since." Review happens in subthreads with the original agent's context. The integration with Claude Code comes first. [85][86]
- **Thesis:** "Most contenders promise better uptime on top of the same old primitives: branches, commits, and diffs. We believe that threads will be the new fundamental unit of software development." Next steps are "Git storage in DeltaDB" and eventually content-based builds. [86]
- **HN pushback:** "do I now need to... consume my teammates' conversations with agents? Why is this better than a good PR description?" [88]

### GitButler (Scott Chacon)
- $17M Series A led by a16z (4-08). [72][73]
- The `but` CLI (2-05) offers parallel and stacked branches in one working directory, unlimited undo, first-class conflicts, JSON output, and `but agent setup`. [74]
- **Thesis:** "we're all teaching swarms of agents to use a tool built for sending patches over mailing lists... The hard problem is not generating change, it's organizing, reviewing, and integrating change." The vision includes conflicts flagged early across teammates and "your agent being fully aware of... what everyone on your team is working on, right now." [72]
- a16z's framing: "The Git index breaks under this kind of parallel editing." [73]
- Chacon also wants Git "locally run, globally mirrored." [75]

### East River Source Control (ERSC): jj-first forge
- **Product direction:**
  - A custom storage engine that speaks git and jj and "can land thousands of commits per second", with instant checkouts and "aggressively O(changes), not O(repo)." [76][80]
  - Stacked diffs are "table stakes"; fine-grained ACLs; GraphQL API.
  - Deployable as SaaS, in the customer's cloud, or on-prem (K8s plus S3-compatible storage).
  - Tested deterministically with Antithesis. [76][78][80]
- **Team and status:** Martin von Zweigbergk (creator of jj) became CTO on 9-01. Storage was due to enter private beta in late September. [77]
- **Thesis:**
  - "Rather than building a better git server, we've opted to build the substrate that comes next."
  - Building blocks rather than a monolithic forge.
  - Martin: "the remote server is still Git, which has a ceiling that comes fast." [76][77][78]
- A native jj protocol is future work. [78]

### Mesa
- Started as review-agent fleets (seed, Nov 2025). [83]
- Then pivoted to "a versioned filesystem for agents" built on jj and aimed at "GitHub for all knowledge work". Its model:
  - sessions, turns and steps instead of branches and commits
  - realtime events
  - built-in embeddings and semantic search
  - conflicts preserved as first-class history [81][82]
- **Thesis:** "faster Git isn't the missing piece." Git is async, built for slow human edits, and handles large or non-text files poorly. [81]

### Tangled (ATProto forge)
- €3.8M ($4.5M) seed (3-02) led by byFounders; Dohmke and Avery Pennarun invested. About 7k users and 5k repos at that point. Shipped stacked PRs. [89]
- **2026 roadmap:** microVM CI (spindle v2), repo migration across self-hosted knots, a mission-control dashboard, and a GitHub migration tool. [89]
- **Thesis:** a federated forge where "agents can create repositories, submit pull requests, review code — seamlessly" without proprietary API limits; "one dev and a hundred agents building a micro-SaaS." [89][90]

### Radicle
- Peer-to-peer forge. Releases 1.7 and 1.8 (March) focused on signed-refs security. [91]
- A 9-23 disclosure showed 1.x nodes send **private repos in cleartext** after the handshake. The fix requires 2.0 on iroh/QUIC/TLS. [92]
- **Thesis:** sovereignty and no central server. There is no agent-specific story; it is popular with HN commenters as an anti-centralization answer. [5]

### Block "Buzz" (Jack Dorsey)
- Launched 7-21 as an open-source, Nostr-based workspace where humans and agents each hold a cryptographic keypair, with a signed hash-chain event log. [93]
- Buzz Projects (8-18) is an experimental self-hosted forge: NIP-34 plus Smart HTTP git. A merge coordinator and portable reputation are designed but not built. Each workspace runs on a single relay. [94]
- **Thesis:** identity is the "most fundamental problem" in multi-agent work; it means "reduce our dependency on slack and github." [93]

### Codeberg, Forgejo and Gitea
- Codeberg's member vote (358 for, 144 against, 14 abstaining; 7-23) bans projects mostly written by generative AI and bans training on user data. It cites cost externalization and a jump in SSD costs from €700 to €3,700. [95][96]
- Load comes mainly from AI scrapers. [99]
- Forgejo federation is still experimental; a federation activity-spoofing bug was filed 9-07. [100] Forgejo is also clarifying an AI/copyright agreement. [102]
- Agent support is through MCP servers: the official `gitea-mcp` and community Forgejo MCP servers. [101]
- **Thesis:** human-centered FLOSS; agents are a cost, not a customer.

### Other "git for agents" and branchable-filesystem players

| Player | One-line thesis | Src |
|---|---|---|
| **Freestyle Git** | API-first git for agent platforms: scoped tokens, inspect files without checkout, branch compare, webhooks, LFS, bidirectional GitHub sync, "one repo per project, one branch per agent task". | [117] |
| **Relace Repos** | Git-compatible, high-throughput storage with built-in two-stage semantic retrieval for agents. | [118] |
| **Lix** | Embeddable version control for any file format, aimed at agents (v0.17 added partial replicas, 9-16). | [119] |
| **Turso AgentFS** | SQLite-backed agent filesystem with snapshots, audit and sync; isomorphic-git runs on top of it. | [120] |
| **Factory vfs** | SQLite copy-on-write filesystem (FUSE/NFS); can fork live sessions and move a session to another machine with uncommitted work intact. | [121] |
| **BranchFS / "Fork, Explore, Commit"** (paper) | OS-level branch contexts: O(1) copy-on-write branches, first commit wins, proposed `branch()` syscall. | [122] |
| **Sapling (Meta)** | Stacks without branch names plus automatic restack, used to run parallel agents on worktrees. | [123] |
| **Agent Trace** (Cursor spec, Cognition support) and **git-ai** | Open, vendor-neutral schema for line-level AI attribution; git-ai records it in git notes. | [124][125] |

---

## 4. Competitor thesis table

| Player | Core problem as they frame it | Bet | Layer | Status (as of 2026-10-03) | Src |
|---|---|---|---|---|---|
| **Cursor Origin** | Agents produce more commits, PRs and throwaway repos than Spokes-era hosting can absorb; review and merge are the bottleneck; editor and forge should not be separate. | S3-WAL storage (Continuity) + a forge inside Cursor + Graphite review + agents that drive PRs to green. | Full forge (private) | Early beta 8-17; agent-native features still "soon". | [1][3][10][31] |
| **GitHub** | Capacity and reliability at 30x; keep being the place every agent works. | Agent HQ control plane, Copilot cloud agent, stacked PRs, async merge API, agent guardrails; Azure scale-out. | Incumbent forge | Shipping steadily; reliability still hurting. | [43][44][46][49][52] |
| **GitLab** | Clone tax, concurrency collapse, no agent isolation; provenance and governance after success. | Next-gen SCM (query, don't clone), Orbit context graph, Governance for Agents, Duo. | Incumbent platform | Next-gen SCM private beta; Orbit public beta. | [104][106][107] |
| **Entire** | Central hosting is the constraint; reasoning and session context is lost; PRs don't scale. | Distributed regional git network, self-hostable nodes, sessions stored with code, intent-based review. | Network + context | Preview (mirrors); native repos "soon". | [60][62][64] |
| **Pierre Code Storage** | AI builders need millions of repos per day with no rate limits. | White-label, API-first git infrastructure. | Infrastructure | Signups open 8-18. | [57][68] |
| **Cloudflare Artifacts** | Source control built for humans; agents need per-session repos, mass forks, time travel. | Git-speaking versioned filesystem on DO + R2, CI SDK, events; recruiting "the next GitHub". | Infrastructure | Open beta 10-01; billing mid-Oct. | [109][110][113][114] |
| **Zed Delta** | PRs are the wrong unit; reasoning lives in the agent conversation. | Threads plus operation-level DeltaDB, CRDT worktrees, review in subthreads. | Collaboration layer (git-compatible) | Public beta 9-16. | [84][86] |
| **GitButler** | The git index and porcelain break under parallel agents; integrating change is the hard part. | Parallel and stacked branches in one working directory, agent CLI, social coding. | Client / workflow | `but` CLI technical preview; Series A. | [72][73][74] |
| **ERSC** | The git server ceiling; monorepo scale; machines writing faster. | New storage engine that speaks git and jj; building blocks; stacked diffs. | Storage + forge | Storage private beta (late Sept). | [76][77][78] |
| **Mesa** | Git is async and text-centric; agents need sessions and realtime. | jj-based versioned filesystem, semantic search, first-class conflicts. | Infrastructure | Early. | [81][82] |
| **Tangled** | Silos and proprietary API limits; agents should be first-class participants. | ATProto federated forge, stacked PRs, microVM CI. | Federated forge | Seed; roadmap in progress. | [89][90] |
| **Radicle** | Centralization and sovereignty. | Peer-to-peer gossip forge. | Peer-to-peer forge | 1.x transport vulnerability; 2.0 pending. | [91][92] |
| **Block Buzz** | Identity for humans and agents; dependency on Slack and GitHub. | Nostr keypairs, signed event log, NIP-34 forge. | Workspace + forge | Experimental. | [93][94] |
| **Codeberg / Forgejo** | AI externalizes costs onto commons. | Human-only FLOSS; anti-scraper defenses; federation. | Non-profit forge | Policy in force since 7-23. | [95][99][100] |
| **OpenAI (internal)** | GitHub outages disrupting engineers. | Its own code host, possibly sold to customers. | Forge | Reported in development (3-03). | [58] |
| **Freestyle / Relace / Lix / AgentFS / vfs** | Agent platforms need programmable, branchable state. | APIs, CoW filesystems, snapshots, retrieval. | Infrastructure / filesystem | Shipping in niches. | [117]-[122] |

---

## 5. Gaps nobody is tackling yet (or only on slides)

1. **Coordinating many agents on one repo.** Cloudflare's competition brief poses it as an open question ("How do agents know what other agents are working on?" [114]). GitButler only gestures at it [72], and no forge ships claims or leases on files, symbols or intents, live presence, or conflict prediction before code is written. Everyone resolves conflicts after the fact (Cursor's demo [10], jj and Mesa's first-class conflicts [81]). *Natural fit for a Durable Object per repo acting as coordinator.*
2. **Merges gated by evidence, not by eyeballs.**
   - Merge decisions are still human: "Merging is a deliberate human step for now" [20]; Rollouts "does not merge or roll back" [15].
   - Nobody offers merge policy as code that requires proofs (tests, evals, spec checks, provenance) and is tiered by risk and by author (agent vs human). Mesa's investor called this out [83], and Entire's "policy-as-code... verifiable by any client" is roadmap only [62].
   - The critique that auto-resolution needs verification is unanswered ("who checks that the [resolution] was correct?" [11]).
3. **Agents as first-class billable principals.** GitLab notes that agents share accounts today [104]; GitLab's attribution is in private beta [106]; GitHub's guardrails are client-side [52]; Buzz's keypairs are experimental [93]. Nobody sells per-agent identity with quotas, budgets, reputation, revocation, and per-task capability tokens that are portable across agent vendors. Pricing is still per seat (GitHub, GitLab) or bundled (Origin [2]).
4. **Best-of-N and variant lifecycle.** Mass forking exists: Artifacts' 10k forks [109], Factory vfs session branching [121], BranchFS first-commit-wins [122]. No forge has "variant sets" with eval scoring, automatic promotion, garbage collection of losers, and kept lineage. The token cost of best-of-N fleets is flagged as an unexamined problem [127].
5. **Serving context instead of clones, from the edge.** GitLab is the only incumbent building query-not-clone, and it is in private beta [105]. Orbit is a separate graph [107]. Relace and Entire do retrieval and session search [118][60]. Nobody has an edge-cached "context CDN" that serves task-scoped slices (files, blame, history, plus decision transcripts) with per-operation pricing. *Strong Cloudflare fit.*
6. **Open source in the agent era.** Origin has no public repos [24]. Codeberg bans AI-majority projects [95]. Zig bans AI contributions [97]. GitHub has nothing aimed at the agent-PR flood. Nobody offers a public forge that welcomes agents but defends maintainers: contributor or agent reputation, rate limits, AI-provenance labels, triage agents, and license and copyleft provenance [95].
7. **Neutral custody.** Origin is SpaceX-owned with unpublished terms [26][27]. GitHub belongs to Microsoft while OpenAI builds its own [58]. Model vendors are integrating vertically. Only Entire pitches residency and self-hosting [62][66], and Artifacts offers US/EU jurisdiction [110]. Nobody combines contractual no-training terms, customer-managed keys, residency, and vendor-agnostic agent hosting with verifiable audit.
8. **CI designed for agents.** Origin outsources CI [1]. Zed's content-based builds are "longer term" [86]. Cloudflare's CI SDK is early [113]. Entire's CI/CD is roadmap [62]. Nobody ships content-addressed, incremental, stack-aware speculative CI exposed as a verification API agents can call, rather than YAML pipelines.
9. **A standard forge API.** Users explicitly ask for GitHub API compatibility so tooling keeps working [5]. Every new entrant invents its own API: Origin's Public API [2], Pierre's SDK [69], Artifacts bindings [109]. A GitHub-compatible REST/GraphQL facade (so gh, Octokit, Actions runners and Vercel work), plus open provenance (Agent Trace [124]) and events, is unclaimed.
10. **Understanding agent-written code without reading all of it.** Promised by Origin [5] and framed as "alignment" by Reimers [37]. Zed's thread-based review is the only shipped attempt [86], and HN users question it [88]. Nobody has a verifiable "decision diff": the decisions and assumptions made, separate from the line diff.
11. **Native jj and conflict-tolerant hosting.** A jj-native wire protocol does not exist (ERSC lists it as future work [78]), and Cursor publicly asked to meet the jj maintainers [5]. Git-compatible hosting that stores first-class conflicts is open.
12. **Real-time local/cloud workspace sync.** Requested on HN [5]. Zed has CRDT worktrees only inside Delta [84]. ArtifactFS solves hydration, not sync [109].
13. **Large and binary assets for agents.** Mesa calls out git's weakness here [81]. Artifacts caps blobs at 32MB and repos at 1GB [111].

---

## 6. Notes specific to Cloudflare for Beanstalk

- Artifacts' limits (1GB per repo, 32MB per blob, 2,000 git requests per 10s per repo [111]) make it fine for agent session repos but tight for a monorepo-class primary forge. Expect to need sharding, a custom git layer, or a Continuity-style design on R2 for large repos (Cursor proves the object-storage-as-truth pattern [3]).
- Pricing per operation ($0.15 per 1k [112]) punishes chatty agents. Batching and caching become product features [116].
- **Competition:** "Build the next GitHub". Deadline 10-14, finalists 10-16, presented at Cloudflare Connect SF; open-source license required; Workers Paid only. [114][115]
- Origin is already a source for Workers Builds [18]. Cloudflare is courting forge builders with Artifacts events, jurisdictions, the CI SDK and Workers Builds [110][113].

---

## 7. Sources

Dates are publication dates; "acc." means accessed 2026-10-03.

1. Cursor changelog, "Origin Code Hosting": https://cursor.com/changelog/origin-code-hosting (2026-08-17)
2. Cursor docs, Origin: https://cursor.com/docs/origin (acc.)
3. Vicent Martí, "Git at any scale", Cursor blog: https://cursor.com/blog/git-at-any-scale (2026-08-18)
4. TechCrunch, L. Ropek, "Cursor capitalizes on GitHub frustration...": https://techcrunch.com/2026/08/18/cursor-capitalizes-on-github-frustration-launches-rival-hosting-platform/ (2026-08-18)
5. Hacker News, "Cursor launches Origin, GitHub alternative" (597 points / 414 comments; OP tomasreimers): https://news.ycombinator.com/item?id=49334209 (2026-08-17)
6. The New Stack, P. Sawers, "If GitHub was stable...": https://thenewstack.io/cursor-origin-github-alternative/ (2026-08-18)
7. VentureBeat, "Cursor launches Origin... as GitHub outage exposes opening": https://venturebeat.com/infrastructure/cursor-launches-origin-code-hosting-platform-as-github-outage-exposes-opening-in-ai-coding-race (2026-08-17)
8. InfoQ, "Cursor Releases Origin as an Agent-Native Alternative to GitHub": https://www.infoq.com/news/2026/08/cursor-origin-alternative-github/ (2026-08-25)
9. InfoWorld, A. Ghoshal, "Decoding Origin": https://www.infoworld.com/article/4211505/decoding-origin-cursors-github-rival-that-was-launched-during-the-latters-outage.html (2026-08-19)
10. Compile 26 opening keynote (Truell, Reimers), YouTube: https://www.youtube.com/watch?v=fWa7uxyhVDE (2026-06-16)
11. Logic Decode, Compile demo numbers and critique: https://logicdecode.in/blog/cursor-origin-git-hosting-for-ai-agents (2026-06-17)
12. Learn Cursor, "22.6 Commits per Second... Unpacked": https://www.learncursor.dev/learn/cursor-origin/commits-per-second (2026-07-16, updated after 08-18)
13. Learn Cursor, Origin guide: https://www.learncursor.dev/guides/cursor-origin (acc.)
14. Cursor changelog, "Start from scratch, without a repo": https://cursor.com/changelog/start-from-scratch (2026-08-27)
15. Cursor changelog, "Rollouts and Security Review": https://cursor.com/changelog/rollouts-and-security-reviewer (2026-09-23)
16. Cursor blog, "Introducing Projects": https://cursor.com/blog/projects (2026-09-10)
17. Cursor changelog index, including the 08-19 cloud agents entry: https://cursor.com/changelog (acc.)
18. Cloudflare changelog, "Workers Builds now supports Cursor Origin": https://developers.cloudflare.com/changelog/post/2026-09-22-cursor-origin-workers-builds/ (2026-09-22)
19. Cursor forum, "Origin Code Hosting" release thread: https://forum.cursor.com/t/origin-code-hosting/168670 (2026-08-17)
20. Cursor forum, "Merging PRs in Origin with Grok Bot": https://forum.cursor.com/t/merging-prs-in-origin-with-grok-bot/172592 (2026-09-22)
21. E. Yi, hands-on Origin notes (LinkedIn): https://www.linkedin.com/posts/aiedwardyi_cursor-launched-its-own-git-forge-origin-activity-7500526115946418176-F9GL (2026-09-01)
22. Agentic Bot Sitter, Origin explainer (git URL, settings): https://agenticbotsitter.com/guides/abs-cursor-origin-what-is-explained/ (2026-08-24)
23. Flavio Copes, "A deep dive into Cursor Origin": https://flaviocopes.com/cursor-origin/ (2026-08-25)
24. Appwrite blog, "Cursor Origin vs GitHub": https://staging.appwrite.io/blog/post/cursor-origin-vs-github-what-actually-changes-for-developers (2026-08-18)
25. Open Source For You, "SpaceX-Owned Cursor Launches GitHub Alternative": https://www.opensourceforu.com/2026/08/spacex-owned-cursor-launches-github-alternative/ (2026-08-19)
26. TechTimes, "Cursor Origin Ships With No Data Terms": https://www.techtimes.com/articles/324838/20260818/cursor-origin-ships-no-data-terms-spacex-now-holds-paid-developers-code.htm (2026-08-18)
27. TheNextWeb, "Cursor Origin is on by default... data terms unpublished": https://thenextweb.com/news/cursor-origin-opt-out-data-terms-spacex-github-outage (2026-08-18). Also on residency: sota.io, https://www.sota.io/blog/cursor-origin-spacex-github-alternative-us-data-residency-cloud-act-2026 (2026-08-22)
28. The Register, J. Jackson, "How Cursor beat Git's scalability shortcomings": https://www.theregister.com/devops/2026/08/23/how-cursor-beat-gits-scalability-shortcomings/5291421 (2026-08-23)
29. InfoQ, "Cursor Uses S3 WAL to Scale Git Storage to More than 300 Pushes per Second": https://www.infoq.com/news/2026/09/cursor-continuity-git-storage/ (2026-09-30)
30. Hacker News, "Git at any scale" (371 points): https://news.ycombinator.com/item?id=49348141 (2026-08-18)
31. Cursor blog, "Graphite is joining Cursor": https://cursor.com/blog/graphite (2025-12-19)
32. Graphite blog, M. Lutsky, "Building the future of software development with Cursor": https://graphite.com/blog/graphite-joins-cursor (2025-12-19)
33. TechCrunch, "Cursor continues acquisition spree with Graphite deal": https://techcrunch.com/2025/12/19/cursor-continues-acquisition-spree-with-graphite-deal/ (2025-12-19)
34. Mirror of Cursor docs, "Cursor Review" overview and Merge Queue: https://blog.yeyupiaoling.cn/article/1787708404257?lang=en and https://blog.yeyupiaoling.cn/article/1787708403016?lang=en (2026-08-26)
35. TheNextWeb, "SpaceX has closed its $60bn Cursor deal": https://thenextweb.com/news/spacex-cursor-acquisition-completed-gpu-fleet (2026-08-25)
36. 9to5Mac, SpaceXAI completes Cursor acquisition (with the April and June timeline): https://9to5mac.com/2026/08/14/spacex-lands-deal-to-likely-purchase-claude-code-and-openai-codex-competitor/ (2026-08-14)
37. E. Cavunt, notes on Tomas Reimers, "Code Review in the Agent Era" (Compile London 09-16): https://emrecavunt.com/blog/code-review-tomas-reimers-compile-london (2026-09-20)
38. Backfield River, "Cursor's bet at Compile: GitHub is the wrong shape for an agent": https://backfield.net/river/card/5469 (2026-06-17)
39. Value Add Pulse, Origin launch (secondhand stat: 35% of PRs opened by agents): https://valueaddvc.com/pulse/cursor-origin-code-hosting-github-outage-2026 (2026-08-17)
40. Layer3 Labs, "Cursor Origin vs GitHub": https://www.layer3labs.io/comparisons/cursor-origin-vs-github (2026-08-21)
41. Digital Applied, "Cursor Origin Opens: GitHub Is Still the Source": https://www.digitalapplied.com/blog/cursor-origin-early-beta-code-hosting-github-sync (2026-08-17)
42. Forbes, S. Carter, "Microsoft's GitHub Under Siege...": https://www.forbes.com/sites/sandycarter/2026/08/20/microsofts-github-under-siege-as-spacexs-cursor-takes-the-ai-stack/ (2026-08-20)
43. GitHub blog, V. Fedorov, "The August 17 outage, and the work ahead": https://github.blog/news-insights/company-news/the-august-17-outage-and-the-work-ahead/ (2026-08-20)
44. GitHub blog, V. Fedorov, "An update on GitHub availability": https://github.blog/news-insights/company-news/an-update-on-github-availability/ (2026-04-28)
45. LeadDev, "What's gone wrong at GitHub?": https://leaddev.com/software-quality/whats-gone-wrong-at-github (2026-05-07)
46. GitHub blog, "Introducing Agent HQ": https://github.blog/news-insights/company-news/welcome-home-agents/ (2025-10-28)
47. GitHub changelog, stacked PRs public preview: https://github.blog/changelog/2026-07-30-stacked-pull-requests-are-now-in-public-preview/ (2026-07-30)
48. InfoQ, "GitHub Targets Large Merge Problem with Stacked PRs": https://www.infoq.com/news/2026/04/github-stacked-prs/ (2026-04-29)
49. GitHub changelog, async merge API GA: https://github.blog/changelog/2026-10-01-github-async-merge-api-generally-available/ (2026-10-01)
50. GitHub changelog, Agentic Workflows technical preview: https://github.blog/changelog/2026-02-13-github-agentic-workflows-are-now-in-technical-preview/ (2026-02-13); public preview: https://github.blog/changelog/2026-06-11-github-agentic-workflows-is-now-in-public-preview/ (2026-06-11)
51. GitHub changelog, security validation for third-party coding agents: https://github.blog/changelog/2026-06-09-security-validation-for-third-party-coding-agents/ (2026-06-09)
52. GitHub changelog, enterprise-managed permissions for Copilot agent operations: https://github.blog/changelog/2026-09-09-enterprise-managed-permissions-for-github-copilot-agent-operations/ (2026-09-09)
53. GitHub changelog, Copilot cloud agent research/plan: https://github.blog/changelog/2026-04-01-research-plan-and-code-with-copilot-cloud-agent/ (2026-04-01); automations: https://github.blog/changelog/2026-06-02-schedule-and-automate-tasks-with-copilot-cloud-agent/ (2026-06-02)
54. GitHub blog, "Turn one giant AI-generated pull request to a reviewable stack": https://github.blog/engineering/turn-one-giant-ai-generated-pull-request-to-a-reviewable-stack/ (2026-08-04)
55. Latent Space, "GitHub's plan for Agents" (Kyle Daigle): https://www.latent.space/p/github (2026-06-02)
56. M. Hashimoto, "Ghostty Is Leaving GitHub": https://mitchellh.com/writing/ghostty-leaving-github (2026-04-28)
57. Pragmatic Engineer, "The Pulse: is GitHub still best for AI-native development?": https://blog.pragmaticengineer.com/the-pulse-is-github-still-best-for-ai-native-development/ (2026-04-03)
58. Reuters (citing The Information), "OpenAI is developing alternative to Microsoft's GitHub": https://www.reuters.com/business/openai-is-developing-alternative-microsofts-github-information-reports-2026-03-03/ (2026-03-03)
59. Strange VC, T. Tan, "Coding agents are breaking code infrastructure": https://thereview.strangevc.com/p/coding-agents-are-breaking-code-infrastructure (2026-08-20)
60. SiliconANGLE, "Ex-GitHub chief's Entire opens distributed Git network": https://siliconangle.com/2026/07/08/ex-github-chiefs-entire-opens-distributed-git-network-agent-era/ (2026-07-08)
61. GeekWire, Entire network preview: https://www.geekwire.com/2026/former-github-ceos-startup-entire-unveils-its-answer-to-the-crush-of-ai-coding-agents/ (2026-07-08)
62. T. Dohmke, LinkedIn launch post (roadmap): https://www.linkedin.com/posts/ashtom_42-is-the-answer-to-everything-this-is-entires-activity-7480629121845383168-n2sq (2026-07-08)
63. Pure AI, Entire $60M seed and Checkpoints: https://pureai.com/articles/2026/02/10/dohmke-launches-startup.aspx (2026-02-10)
64. Madrona, "Why We Invested in Entire": https://www.madrona.com/the-ai-eras-developer-platform-why-we-invested-in-entire/ (2026-02-10)
65. Entire on DEV, "Why Is Everyone Trying to Rebuild Git Hosting?": https://dev.to/entire/why-is-everyone-trying-to-rebuild-github-356o (2026-07-15)
66. Open Source For You, Entire open-sourcing its backend and India region: https://www.opensourceforu.com/2026/07/entire-to-open-source-git-backend-expands-ai-native-platform-into-india/ (2026-07-24)
67. (reserved)
68. Digg (J. Thornton's X post), Code.storage signups open: https://digg.com/tech/nec8o4dc (2026-08-18)
69. npm `@pierre/storage` SDK README: https://registry.npmjs.org/@pierre/storage (2025-08 onward)
70. Secondary report of Pierre's $23M round (low confidence): https://botscouncil.com/live/pierre-computer-company-secures-23m-to-build-git-for-machine--49a05bb4 (2026-02-14)
71. Copy of the code.storage landing page: https://vuink.com/post/code-d-dstorage (2026-02-10)
72. GitButler, "We've raised $17M to build what comes after Git": https://blog.gitbutler.com/series-a (2026-04-08)
73. a16z, "Investing in GitButler": https://a16z.com/announcement/investing-in-gitbutler/ (2026-04-08)
74. GitButler, "Introducing the GitButler CLI": https://blog.gitbutler.com/but-cli (2026-02-05)
75. The Register, "Git is unprepared for the AI coding tsunami" (Chacon): https://www.theregister.com/devops/2026/05/15/git-is-unprepared-for-the-ai-coding-tsunami/5241480 (2026-05-15)
76. ERSC, "An update on ERSC availability": https://ersc.io/blog/ersc-availability (2026-05-04)
77. ERSC, Martin von Zweigbergk named CTO: https://ersc.io/blog/martin-joins-ersc (2026-09-01)
78. ERSC, "What comes after git": https://ersc.io/blog/what-comes-after-git (2026-09-10)
79. RuntimeWire, "East River details a post-Git storage engine": https://runtimewire.com/article/east-river-post-git-storage-engine (2026-09-11)
80. ERSC preview post (LinkedIn): https://www.linkedin.com/feed/update/urn:li:activity:7454902773017640960 (2026-04-28)
81. Mesa, "What is Mesa?": https://www.mesa.dev/blog/what-is-mesa (2026-05-26)
82. Mesa, "Introducing Mesa: a versioned filesystem for agents": https://www.mesa.dev/blog/introducing-mesa-filesystem-for-agents (2026-04-28)
83. D. Treybig, "Rethinking the outer development loop" (Mesa seed): https://davistreybig.substack.com/p/rethinking-the-outer-development (2025-11-04)
84. Zed, "Software Is Made Between Commits" (DeltaDB): https://zed.dev/blog/introducing-deltadb (2026-06-11)
85. Zed, "Introducing Delta": https://zed.dev/blog/introducing-delta (2026-08-12)
86. Zed, "Replace PRs with Delta – Now in Public Beta": https://zed.dev/blog/delta-public-beta (2026-09-16)
87. The New Stack, "Everyone's in a race to replace GitHub" (Zed, plus GitLab Project Switch): https://thenewstack.io/zed-delta-github-alternative/ (2026-09-16)
88. Hacker News, "Replacing Pull Requests with Delta": https://news.ycombinator.com/item?id=49727245 (2026-09-16)
89. Tangled, "Announcing our €3,8M seed round": https://blog.tangled.org/seed/ (2026-03-02)
90. Tech.eu, Tangled $4.5M round: https://tech.eu/2026/03/02/building-europes-native-code-infrastructure-tangled-closes-45m-round/ (2026-03-02)
91. Radicle 1.8.0 release: https://radicle.dev/2026/03/30/radicle-1.8.0 (2026-03-30)
92. K. Maninakis, "Radicle nodes send private repositories in cleartext": https://maninak.com/blog/radicle-cleartext-transport-vulnerability/ (2026-09-23)
93. Decrypt, "Block Launches Buzz": https://decrypt.co/374026/jack-dorseys-block-launches-buzz-a-nostr-based-slack-and-github-rival-for-ai-agents (2026-07-22)
94. RuntimeWire, "Block adds an experimental self-hosted Git forge to Buzz": https://runtimewire.com/article/block-buzz-projects-self-hosted-git-forge (2026-08-18)
95. The Register, "Codeberg gives vibe-coded projects the toss": https://www.theregister.com/ai-and-ml/2026/07/23/codeberg-gives-vibe-coded-projects-the-toss-promotes-human-floss/5277717 (2026-07-23)
96. heise, "Codeberg prohibits AI training and AI mass projects": https://www.heise.de/en/news/Codeberg-prohibits-AI-training-and-AI-mass-projects-11376418.html (2026-07-23)
97. InfoQ, Andrew Kelley interview (Zig: AI ban, move off GitHub): https://www.infoq.com/news/2026/09/andrew-kelley-zig-no-ai/ (2026-09-23)
98. GIGAZINE, Zig's move to Codeberg: https://gigazine.net/gsc_news/en/20251129-migrating-from-github-to-codeberg/ (2025-11-29)
99. pat-s, "Codeberg is (most likely) not under attack": https://pat-s.me/codeberg-is-not-under-attack/ (2026-08-07)
100. Forgejo issue #14271, federation activity spoofing: https://codeberg.org/forgejo/forgejo/issues/14271 (2026-09-07)
101. gitea-mcp (official): https://copilothub.directory/mcps/gitea-gitea-mcp (2025-12-06); forgejo-mcp v2.30.0: https://newreleases.io/project/codeberg/goern/forgejo-mcp/release/v2.30.0 (2026-06-17)
102. Forgejo governance PR #381 (AI agreement): https://codeberg.org/forgejo/governance/pulls/381 (2026-03-07)
103. GitLab, Duo Agent Platform GA: https://about.gitlab.com/blog/gitlab-duo-agent-platform-is-generally-available/ (2026-01-15)
104. GitLab, "Built for the agentic engineering era" (Transcend): https://about.gitlab.com/blog/gitlab-transcend-announcements/ (2026-06-10)
105. GitLab IR press release, next-gen SCM metrics: https://ir.gitlab.com/news/news-details/2026/GitLab-Announces-New-Capabilities-to-Give-Enterprises-Speed-and-Control-at-Agentic-Scale/default.aspx (2026-06-10)
106. GitLab, "Git was built for humans — agents need an upgrade": https://about.gitlab.com/blog/gitlab-next-gen-scm/ (2026-08-26)
107. GitLab, "Introducing GitLab Orbit": https://about.gitlab.com/blog/introducing-gitlab-orbit/ (2026-06-10)
108. GitLab Transcend next-gen SCM demo with Anthropic: https://www.youtube.com/watch?v=BolGWVjKzaE (2026-07-07)
109. Cloudflare blog, "Artifacts: versioned storage that speaks Git": https://blog.cloudflare.com/artifacts-git-for-agents-beta/ (2026-04-16)
110. Cloudflare changelog, "Artifacts is now in open beta": https://developers.cloudflare.com/changelog/post/2026-10-01-artifacts-open-beta/ (2026-10-01)
111. Cloudflare docs, Artifacts limits: https://developers.cloudflare.com/artifacts/platform/limits/ (acc.)
112. Cloudflare docs, Artifacts pricing: https://developers.cloudflare.com/artifacts/platform/pricing/ (acc.)
113. Cloudflare blog, "Run CI/CD for millions of repos": https://blog.cloudflare.com/ci-workflows/ (2026-08-04)
114. Cloudflare blog, "We want you to build the next Git platform on Cloudflare": https://blog.cloudflare.com/next-git-platform-on-cloudflare/ (2026-10-01)
115. Cloudflare, "Build the next GitHub" competition: https://www.cloudflare.com/git-competition/ (acc.)
116. Hacker News, "Artifacts: Versioned storage that speaks Git": https://news.ycombinator.com/item?id=47792374 (2026-04-16)
117. Freestyle, "Version Control for AI Agents": https://www.freestyle.sh/blog/engineering/version-control-for-ai-agents (2026-05-08)
118. Relace Repos review: https://www.funblocks.net/aitools/reviews/relace-repos (2025-10-25)
119. Lix, "Introducing Lix": https://lix.dev/blog/introducing-lix (2026-01-20); v0.17: https://lix.dev/blog/lix-v0-17-release (2026-09-16)
120. Turso, "AgentFS in the Browser": https://turso.tech/blog/agentfs_browser (2025-12-22)
121. Factory-AI vfs (mirror of the repo README): https://github.laiyagushi.com/Factory-AI/vfs (2026-05-09)
122. "Fork, Explore, Commit: OS Primitives for Agentic Exploration" (BranchFS): https://www.alphaxiv.org/abs/2602.08199 (2026-02/03)
123. ezyang, "Parallel Agents ❤️ Sapling": https://blog.ezyang.com/2026/03/parallel-agents-heart-sapling/ (2026-03-13)
124. Cursor, Agent Trace spec: https://github.com/cursor/agent-trace (2026-01-27); InfoQ: https://www.infoq.com/news/2026/02/agent-trace-cursor/ (2026-02-04); Cognition: https://cognition.com/blog/agent-trace (2026-01-29)
125. git-ai project: https://github.com/git-ai-project/git-ai (2026)
126. (see [5] for the jj comment from Reimers)
127. B.O.R.I.S podcast #15, "Can Origin and Entire Replace GitHub?": https://www.getboris.ai/insights/015-can-origin-and-entire-replace-github/ (2026-07-18)
128. CNBC, "GitHub unites OpenAI, Google and Anthropic AI agents": https://www.cnbc.com/2025/10/28/github-openai-google-anthropic-agents-ai.html (2025-10-28)
129. OpenAI Help, "Using Codex Cloud" (still GitHub-connected): https://help.openai.com/en/articles/20001545-using-codex-cloud (2026-09-30)

**Method and limits.**
- Searched with Exa, WebSearch and WebFetch, plus the HN Algolia API for full comment trees.
- reddit.com was blocked for both fetch and search, so Reddit sentiment comes through InfoQ [8].
- The Information's articles are paywalled, so they are cited through Reuters, VentureBeat and Tom's Hardware.
- Several Origin demo figures (22.6 commits/s, 296k clones/h, the 35% agent-PR share) come only from secondary coverage and are not on Cursor properties.
