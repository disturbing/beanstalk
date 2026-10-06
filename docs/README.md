# Beanstalk research and design notebook

**3 October 2026.** Online research and proposed directions for a GitHub competitor built around AI-agent collaboration on Cloudflare Artifacts. This folder contains research, design proposals, and a local UI concept; it does not contain an implemented forge or measured compatibility/scale results.

**Recommended direction:** make the central object a proposed outcome with alternative changes, exact validation evidence, and a runnable integrated candidate. Jev generates a focused canvas to answer questions about those objects. Keep Git compatibility, familiar diffs, and a simple change list.

| Read | Contents |
| --- | --- |
| [Field research and competitors](01-field-research-and-competitors.md) | Reddit/forum/GitHub evidence, counterevidence, Cursor Origin, Graphite, Foremerge and Entire |
| [Product thesis and ideas](02-product-thesis-and-ideas.md) | 18 ideas with objections, experiments, priorities, and a thousand-agent scenario |
| [Jev canvas experience](03-jev-canvas-experience.md) | Rendered screens/components, before-and-after inspection, Jev view selection, evidence/version rules |
| [Interactive canvas concept](canvas-concept.html) | Actual authored UI elements, visual change inspection and simulated preview readiness |
| [Cloudflare architecture and concurrency](04-cloudflare-architecture-and-concurrency.md) | Artifacts forks, coordination, candidate integration, recovery, limits and cost model |
| [GitHub Actions portability](05-github-actions-portability.md) | Linux compatibility matrix, Docker networking, service/API adapters, economics and conformance |
| [Identity, MCP and live previews](06-identity-mcp-and-live-previews.md) | Delegation, repo isolation, tool contracts, immutable previews, browser authentication and cleanup |
| [Validation and demo plan](07-validation-and-demo-plan.md) | Falsifiable experiments, technical gates, suggested demo and competition constraints |
| [Research method and search log](08-research-method.md) | Retrieval limitations, Exa queries/costs and how to interpret the evidence |
| [Preview speed and UI surfaces](09-preview-speed-and-ui-surfaces.md) | Saved visuals, warm development sessions, exact-version builds, caching, latency targets and tradeoffs |
| [Algorithm optimization review, Oct 6](09b-algorithm-optimization-review.md) | Review of Claude's measured v2.5 results and current code; reproduced parking/scheduling issue; proposals for shared diagnosis, reusable checks and contract-aware scheduling |
| [Making 1,000 agents useful together, Oct 6](09c-thousand-agent-collaboration.md) | Seven concrete extensions to the collaboration model, prior-art comparison, failure criteria and reproducible capacity arithmetic |
| [Bean intents and agent communication, Oct 6](09d-bean-intents-and-agent-communication.md) | Owner-directed agent-agnostic model: evolving approaches, requests, promises, plugin inboxes, Jev/Clef context retrieval and Cloudflare Agent Memory |
| [Bean collaboration implementation, Oct 6](09e-bean-collaboration-implementation.md) | Contributor access, persistent conversations, exact promises, plugin/HTTP tools and current limits |
| [Three-agent collaboration trial, Oct 6](09f-three-agent-collaboration-trial.md) | Three real contributors built a new app; ten protected tests and promise/inbox recovery after Worker restart passed |

The most consequential findings are:

- Cursor Origin already covers native hosting, agent access, GitHub synchronization, preview integrations, and CI integrations. A chat-enabled forge is insufficient differentiation; see the source-linked competitor analysis.
- Intent coordination and session provenance have prior art. The proposed bet is their connection to hosted, combined previews and an effective human decision interface.
- Cloudflare Artifacts has small-repository limits and repo-scoped credentials. Isolated attempt forks and trusted integration fit those boundaries better than giving every agent access to canonical history.
- General Linux Actions jobs need a Linux runtime plus an Actions-compatible control plane. Dynamic Workers alone cannot provide that. Advertise only tested workflow profiles.
- Thousands of logical agents, thousands of simultaneously executing jobs, and thousands of useful accepted changes are different claims. The validation plan measures them separately.

Source links sit beside factual claims in each document. Examples, allocation numbers, product ideas, thresholds, and cost scenarios are labeled as proposals or derived arithmetic. Read the constraints and counterarguments alongside the appealing ideas.
