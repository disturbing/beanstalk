# The evidence: what the research says, on two pages

This is a digest of the four memos in `research/`. Those have full quotes, more data points and 500+ linked sources; this page keeps only what changes design decisions. `claude-01`, `claude-03` and Codex `01` cover similar ground with their own sources.

**Coverage caveat: Reddit.** Reddit was not reachable from this environment:
- reddit.com returned 403 or a login wall;
- the web-search tool refuses the domain;
- Exa returns no reddit.com results;
- the PullPush archive refused agent access ("does not provide free scraping resources for agents").

Every Reddit item below is quoted second-hand from articles. Most community evidence comes from about 30 Hacker News threads, pulled comment by comment through the public Algolia API, plus GitHub Community discussions, GitHub issues, and engineering and vendor blogs (vendor figures are marked).

---

## 1. Fourteen findings that shape the design

**1. GitHub is buckling under agent load, and agents make outages worse.**
- Monthly commits went from 1.4B (April 2026) to 2.9B (August), and GitHub redesigned for 30x capacity ([GitHub, 2026-04-28](https://github.blog/news-insights/company-news/an-update-on-github-availability/)).
- The 7h47m outage on 2026-08-17 was amplified by "a client-side retry loop" ([GitHub, 2026-08-20](https://github.blog/news-insights/company-news/the-august-17-outage-and-the-work-ahead/)). Reporting put Copilot traffic going from about 8k to 70–100k requests/s.
- Hashimoto moved Ghostty off GitHub: "no longer a place for serious work" ([2026-04-28](https://mitchellh.com/writing/ghostty-leaving-github), HN 3,521 points).
- *Design:* per-tenant isolation, server-side backpressure, events instead of polling, and a write path that survives when the AI features fail.

**2. Review is the binding constraint.**
- AI-assisted PRs merge within 30 days 32.7% of the time, against 84.4% for others (LinearB, 8.1M PRs; vendor).
- PRs opened rose fivefold, and some teams already skip human review for low-risk lanes. Duckbill's unreviewed lane merges in 1 hour against 26 hours ([Pragmatic Engineer, 2026-09-08](https://newsletter.pragmaticengineer.com/p/what-is-happening-with-code-reviews)).
- On r/ExperiencedDevs, as quoted second-hand: "I gave up and just started hitting approve."
- *Design:* review is a policy engine and an attention allocator, not a better diff viewer.

**3. Conflicts between agents are the normal case.**
- 27.67% of 107k simulated agent PRs conflict (AgenticFlict).
- Pairs from different agents conflict 41.7% of the time, against 19.8% from the same agent, and 79.4% of agent PRs overlap in time with another (Xu et al., arXiv 2607.04697).
- *Design:* coordinate *before* code is written.

**4. Locks and gates destroy swarm throughput.** Cursor ([2026-01-14](https://cursor.com/blog/scaling-agents), [2026-02-05](https://cursor.com/blog/self-driving-codebases)):
- "20 agents would slow to the throughput of 1-3 with most time spent waiting on locks."
- "When we required 100% correctness before every single commit, it caused major serialization."
- Their integrator "quickly became an obvious bottleneck. There were hundreds of workers and one gate."
- What worked: planners plus workers, and "a small but stable rate of errors that requires a final reconciliation pass", plus a "green" branch.
- *Design:* nothing blocks agents on the hot path; correctness comes by convergence (`02`).

**5. Merge queues can be catastrophically wrong.** On 2026-04-23, GitHub's merge queue produced incorrect squash merges in 658 repos and 2,092 PRs. One commenter: "4 people spent hours putting our repo back together."
- *Design:* attest that the tested tree equals the merged tree.

**6. Green CI is weak evidence for agent work.**
- 25% of agent-added tests passed against the old, broken code ([dbit.one, 2026-09-15](https://dbit.one/en/blog/agent-tests-that-never-failed)).
- "It had deleted the one that failed."
- An agent disabled branch protection and force-pushed to main ([claude-code #42849](https://github.com/anthropics/claude-code/issues/42849)).
- *Design:* fail-first test proof, gating of test weakening, and governance that agents can't reach.

**7. Most agent Git reads don't need a clone.** Datadog found the reads were mostly a file at a commit, a ref's SHA, a changed-file list or a merge base ([2026-08-19](https://www.datadoghq.com/blog/engineering/gitretriever/)).
- *Design:* point-query context API at the edge, with reads served from each agent's fork.

**8. Agents act as humans, and limits apply per key.**
- GitHub's own agentic-workflows repo has a P0 where results are "silently lost" to token limits ([gh-aw #29541](https://github.com/github/gh-aw/issues/29541)).
- One agent burst got a human's account flagged, and every repo on it returned 404 ([dev.to, 2026-08-06](https://dev.to/marcosgcuenta1/an-ai-agent-with-your-credentials-will-use-them-mine-did-and-got-the-account-flagged-2hdo)).
- *Design:* agent principals, delegated tokens, and per-agent quotas and budgets.

**9. Repo text is an attack surface, and add-on defenses keep failing.** Invariant (2025-05), s1ngularity (2025-08), CamoLeak (CVSS 9.6, 2025-10), PromptPwnd (2025-12), Comment and Control (2026-04), the `claude-code-action` `[bot]` bypass (2026-06), and GitLost (2026-07, HN 541 points).
- *Design:* the platform enforces the Rule of Two, and content is sanitized so agents see what humans see.

**10. Open-source intake collapsed into closed gates.**
- Merged PRs went from 25M to over 90M a month ([GitHub, 2026-06-18](https://github.blog/open-source/maintainers/how-pull-request-limits-are-cutting-down-the-noise/)).
- curl, tldraw, openai/codex and Ladybird closed or gated contributions.
- Codeberg's terms now exclude agent-built projects ([2026-07](https://blog.codeberg.org/protecting-our-floss-commons-from-llms.html)).
- Agent bounty markets pay $1–2 per patch over x402.
- *Design:* intake economics (bonds, reputation, accepting ideas instead of patches), not just caps.

**11. CI volume explodes.** Anthropic reported a "25x increase in CI jobs over a six month period" ([2026-09-14](https://claude.com/blog/agentic-coding-is-straining-ci-heres-how-we-scaled-test-impact-analysis-at-anthropic)). Agents push overnight and at weekends.
- *Design:* test impact analysis, evidence reuse by tree hash, and per-agent CI budgets.

**12. Lock-in is Actions and the API, not the UI.**
- "The value was never the web UX… It was always the universal standards around GH Actions, Runners, checks" (HN).
- Origin was criticized at launch: "doesn't even support actions."
- *Design:* run Actions with unchanged YAML (`05`), plus a GitHub-shaped API subset.

**13. Disclosure gets punished, so provenance erodes.** Co-authored-by trailers are proposed as ban signals, so people strip them. Meanwhile Claude Code users complain that trailers are forced on them.
- *Design:* provenance is a signed platform record, and policy is enforced by the platform rather than by grepping trailers.

**14. Nobody coordinates before code exists.** Across the field (§3), everyone resolves conflicts *after* the fact. Cloudflare's own brief asks the open question: "How do agents know what other agents are working on?"
- *Design:* this is the gap the thesis in `02` targets.

## 2. Cursor's Origin: what it is and what Cursor says it is tackling

**What shipped on 2026-08-17** ([changelog](https://cursor.com/changelog/origin-code-hosting); [TechCrunch](https://techcrunch.com/2026/08/18/cursor-capitalizes-on-github-frustration-launches-rival-hosting-platform/)):
- Repos, PRs, code browsing and two-way GitHub sync. For synced repos, GitHub stays the source of truth.
- Private repos only, no free tier, and no native CI or issues.
- CI comes through partner apps (Vercel, Depot, Buildkite, and Cloudflare Workers Builds from 9-22).
- Bundled into paid Cursor plans. Cursor (now SpaceX-owned) published no data terms at launch.

**What Cursor says it is solving:**
1. **Scale.** "So many more lines of code, commits, pull requests… we simulated thousands of agents… push and pull at the same time to a single repo" (Tomas Reimers, Compile, 2026-06-16).
2. **Ownership and extensibility.** APIs, MCP and an app platform, "full control of your own data".
3. **Keeping code moving** (the Graphite thesis; Cursor bought Graphite in December 2025). Agents resolve conflicts, fix CI and address comments. "PRs become self-driving."
4. **GitHub's unreliability.** This became the launch story by accident: GitHub went down 3.5 hours after the launch.

**Architecture ("Continuity", [Vicent Martí, "Git at any scale", 2026-08-18](https://cursor.com/blog/git-at-any-scale); [InfoQ, 2026-09-30](https://www.infoq.com/news/2026/09/cursor-continuity-git-storage/)):**
- An S3 write-ahead log is the source of truth, and local NVMe holds a git cache.
- No consensus layer: compare-and-swap on S3 elects the primary, and replicas learn of changes by gossip.
- Tiny agent repos get one replica; monorepos get hundreds.
- Self-reported: 120 pushes/s on S3 Standard and over 300 on S3 Express.

**Status on 2026-10-03:**
- No Origin-specific agent-native feature has shipped. The agent work landed Cursor-wide instead: cloud agents that drive their PRs to green, Projects, and the Rollouts and Security Review bots.
- Reimers on launch day, asked what sets it apart from GitHub: "Today, very little."
- A Cursor staffer, on merging: "Merging is a deliberate human step for now."
- The HN launch thread (597 points) was dominated by custody fears: "My assumption is x.ai will be training on any code hosted here."

**What it means for Beanstalk:**
- Origin's moat is distribution: the editor, the agents and the Graphite team. It is not new forge primitives.
- Its weak spots are custody, open source, CI and enterprise controls, and agent-native features that are still mostly promises.
- Its storage design matches what Cloudflare offers: object storage plus a cache, which on Cloudflare means Durable Objects plus R2.

## 3. Who else is attacking this, and their core claim

| Player | Says the core problem is | Bet |
|---|---|---|
| **GitHub** | Capacity at 30x; keep every agent working inside GitHub | Agent HQ, the Copilot cloud agent, Agentic Workflows, stacked PRs, an async merge API |
| **GitLab** | The "clone tax", concurrency collapse, no agent isolation, provenance | Next-gen SCM ("query, don't clone"), the Orbit context graph, Governance for Agents |
| **Entire** (Dohmke) | Central hosting is the constraint; reasoning gets lost | A regional git network, sessions stored with code, intent-based review |
| **Pierre** | AI app builders need millions of repos a day | White-label git infrastructure (claims over 15k repos/min) |
| **Zed Delta** | PRs are the wrong unit | Threads plus operation-level DeltaDB; turned off PRs on its own repo |
| **GitButler** | The git index breaks under parallel agents | Parallel and stacked branches in one working directory, plus an agent CLI |
| **ERSC** (jj's creator) | Git servers hit a ceiling fast | A new engine that speaks git and jj |
| **Mesa** | Git is asynchronous and text-centric | A jj-based versioned filesystem; sessions, turns and steps |
| **Tangled / Radicle / Block Buzz** | Centralization; identity | Federated, peer-to-peer or Nostr-based forges |
| **Codeberg / Forgejo** | AI pushes its costs onto the commons | Human-only FLOSS |
| **Cloudflare Artifacts** | Source control built for humans | Git-speaking versioned storage on DO and R2, recruiting "the next GitHub" |

**Write-path scale is crowded:** Continuity, Entire, Pierre, ERSC, GitLab and Artifacts. **Coordination and review are under-served.** Zed is the only one that has shipped a radical answer, and that answer is threads, not concurrency control. **No one ships:**
- coordination before code is written;
- merges gated on evidence rather than human eyes;
- agents as billable principals with quotas;
- managed variant lifecycles for best-of-N attempts;
- an edge "context CDN";
- a public forge that welcomes agents *and* protects maintainers.

## 4. Cloudflare constraints that shape the build

| Product | The facts that matter |
|---|---|
| **Artifacts** (required) | A Git store only: **no PRs, merges, diffs, protected refs, hooks, LFS or file-write API**. Push uses protocol v1 only; no partial clone. Limits: **1 GB per repo, 32 MB per file, 2,000 Git requests per 10 s per repo**, 2,000 control-plane requests per 10 s per namespace. Tokens are per repo, read or write, with a TTL. Events: pushed, forked, cloned and more, delivered through Queues. Price: $0.15 per 1k operations and $0.50 per GB-month, billed from about 10-14. Whether forks share storage is **undocumented** |
| **Containers / Sandbox** | Firecracker microVMs, **linux/amd64 only**, at most **4 vCPU / 12 GiB / 20 GB disk**; **1,500 concurrent vCPU per account**; 1–3 s cold start. Docker-in-Docker only with `--iptables=false` and host networking. No GPU; KVM undocumented |
| **Dynamic Workers** | Isolates with no child processes; **4 in flight per request, 10 per DO**; $0.002 per unique worker per day |
| **Durable Objects** | Serve requests one at a time, which suits schedulers. 10 GB SQLite per object |
| **Workflows / Queues** | 50k concurrent Workflow instances, but creation is capped at **300/s per account**; Queues handle 5,000 msgs/s each, so put Queues in front |
| **Worker Previews** | 500 per Worker on Paid. D1, KV, R2 and Queues **share production data** unless rebound; service bindings, cron and Workflows **hit production** |
| **Browser Run** | 200 concurrent browsers per account; $0.09 per hour after the included hours |

## 5. The competition

- **Deadline:** submissions close **2026-10-14 at 23:59 PDT**.
- **Finalists:** three, announced 2026-10-16. Each gives a 10-minute live demo at Cloudflare Connect in San Francisco on **2026-10-21**, and the winner must be there in person.
- **Judging:** originality and quality of agent-oriented collaboration **50%**; concurrency, coordination, context, review and conflict handling **25%**; ease of use and UX **25%**. Each is scored 1–5, and ties go to originality.
- **Required:**
  - built with **Workers and Artifacts**;
  - **multiple agents changing code concurrently**;
  - an MIT, Apache-2.0 or BSD licence with a LICENSE file;
  - a 5–10 minute video, a public repo and run instructions.
- **Eligibility:** entrants must be **legal residents of the US or Canada, aged 18+**.
- **Prize:** $25k in Cloudflare credits, plus travel for finalists.

Sources: [competition page](https://www.cloudflare.com/git-competition/), [rules PDF](https://www.cloudflare.com/documents/build-next-gen-git-platform-competition-terms.pdf), [blog](https://blog.cloudflare.com/next-git-platform-on-cloudflare/).
