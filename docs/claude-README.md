# beanstalk docs (Claude set), 2026-10-03

Two models worked this brief in parallel on the same day. Files without a prefix (`01-` to `07-`, `canvas-concept.html`, `github-repository-map/`) are Codex's. Files prefixed `claude-` are this set. They overlap on purpose and disagree in places; the disagreements are listed at the bottom.

Repo standards for agents live outside this folder: `AGENTS.md` (canonical; `CLAUDE.md` imports it) and the skills in `.agents/skills/` (`clean-code-typescript`, `clean-code-rust`, `beanstalk-packages`, plus eight vendored Cloudflare skills). Load the matching skill before writing code.

## Read in this order

| File | What it is | Minutes |
|---|---|---|
| `claude-00-competition-brief.md` | Rules, rubric weights (50/25/25), deadlines, the US/Canada eligibility flag, what Cloudflare shipped | 3 |
| `claude-10-beanstalk-thesis.md` | The design: agents work in forks (sprouts), the Integrator assembles beans into worlds, humans choose between worlds; eight objects; the concurrency model; platform constraints; Steward comparison | 10 |
| `claude-11-ideas-brainstorm.md` | 43 ideas scored against the rubric with "what kills it" lines and prior art; demo shortlist | 12 |
| `claude-12-jev-canvas-design.md` | The question-to-interface canvas grounded in what Jev actually is (TypeSafe System One) and in the generative-UI evidence; 17 cards; pipeline; honest critique | 8 |
| `claude-13-demo-plan.md` | Build order Oct 3 to 14, cut lines, the seven-minute script, risks to retire in 48 hours | 5 |
| `claude-14-self-critique-and-decisions.md` | Independent red team of the thesis, what we concede, and the decisions only Coop can make | 6 |
| `claude-14b-red-team-critique.md` | The red team's full report, verbatim | 8 |
| `claude-15-fast-reads-and-search-on-edge.md` | How no-clone agents get grep-speed reads and search on the edge: blob-keyed index in a per-project DO, git trees as the Merkle tree, brute-force regex tier for the demo, trigram and Vectorize tiers later, five MCP read tools; bench plan due Oct 8 | 12 |
| `claude-16-checkout-protocol-and-live-edits.md` | How agents check out and edit Artifacts repos: real clones through beanstalk's git proxy with a credential helper (partial clone verified to work), no-clone MCP only for non-coding roles, a two-tier live-edit channel (event stream under 1 s, `refs/wip` checkpoints under 6 s), one actor per sprout, measured against a probe repo | 12 |

## Research memos (evidence behind the above)

| File | Topic | Strongest finding |
|---|---|---|
| `claude-01-community-pain-points.md` | 71 sourced quotes from HN, Lobsters, Discourse, GitHub, maintainer blogs; top-15 pains; verbatim wishlist | Review is the bottleneck; OSS intake is collapsing into bans; GitHub reliability is the loudest thread; agents silently overwrite each other |
| `claude-02-merge-queues-and-agent-pr-research.md` | Empirical papers on agent PRs; nine merge-queue systems compared; structured merge, patch theory, jj; 12 requirements for a 10,000-agent merge system | 41.7% textual conflict rate between co-active PRs from different agents; 22.1% of dead fix PRs were "resolved by another PR"; review time +441% |
| `claude-03-the-race-to-replace-github.md` | Cursor Origin and Continuity, Cursor's thousand-agent swarm post-mortem, Zed Delta, Entire, Foremerge, JetBrains Air, Cloudflare's own hint | Cursor's lead: differentiator from GitHub is "today, very little"; locks collapse 20 agents to the throughput of 3; nobody rethought integration |
| `claude-03b-cursor-origin-feature-inventory.md` | The deep-dive memo behind 03: Origin inventory, GitHub's moves, substrate and workflow competitors, ten unbuilt things | Steward (2026-10-02) is the closest rival entry |
| `claude-04-cloudflare-artifacts-and-primitives.md` | Exact Artifacts binding, REST, git protocol, events, Builds previews, limits, pricing; DO, Workflows, Containers, Sandbox, Dynamic Workers, MCP auth | No server-side merge, diff, refs or hooks; push is protocol v1; 1 GB per repo; 2,000 requests per 10 s per repo |
| `claude-05-github-actions-on-cloudflare.md` | 34-row GitHub Actions compatibility matrix (act, Gitea, beanstalk on Containers); three architectures; limitations to publish | Build the Worker-side services (cache, artifacts, OIDC, token) first; Docker-in-Docker is the one unresolved blocker |
| `claude-06-identity-mcp-and-previews.md` | GitHub auth pain; identity models (SPIFFE, WAG, Biscuit); 28-tool MCP list; three preview architectures; prompt-injection design | Agents never hold Artifacts tokens; merge is never an agent capability; 30 tools maximum because of client limits |
| `claude-07-generative-ui-and-canvas-research.md` | Generative UI approaches, canvas evidence, repo-visualisation prior art, swarm dashboards, critique, recommended architecture | No product renders agents on the codebase; generated layouts kill muscle memory; schema-stable cards win |

Raw search results and full-thread fetches sit in the session scratchpad, not in the repo.

## Where the Claude set and the Codex set disagree

1. **Jev.** Codex treats "Jev" as the name of the chat interface. Jev is TypeSafe's typed decision model; it cannot write text, which is why `claude-12` puts it at card selection and routing and keeps Claude for narration.
2. **How bold to be.** Codex's thesis warns against "a novel Git replacement" and keeps PRs as the everyday view. `claude-10` keeps git and PR export but replaces the merge step with worlds, because the rubric pays 50% for originality and Steward already occupies the conservative "PR as decision" ground.
3. **Concurrency claim.** Both agree the honest demo is thousands registered, hundreds active. Codex sizes it (100 workspaces, 40 jobs, 12 previews, 2 lanes); `claude-13` uses 100 sprouts, 40 active, 8 evidence jobs.
4. **GitHub Actions.** Both land on Containers for Linux jobs with a compatibility report. Codex adds Dynamic Workers for policy evaluation; `claude-05` recommends building the Worker-side service shims first and bootstrapping with act in host mode.
5. **The repository's home.** Codex `03` and `claude-12` put a spatial canvas at the centre, and `claude-opus/13` a GitHub-style three-pane explorer. `claude-opus/14` replaces both with the Plot (landings by time × area of code, the swarm at the tip). Coop chose it on 2026-10-04: it is `/runs/:run`, the explorer moved to `/runs/:run/files`, and the race canvas is the developer view at `/runs/:run/race`.
