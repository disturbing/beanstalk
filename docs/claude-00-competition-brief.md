# Competition brief: "Build the next GitHub" on Cloudflare

Source: https://www.cloudflare.com/git-competition/ and https://blog.cloudflare.com/next-git-platform-on-cloudflare/ (announced 2026-10-01). Official rules PDF: https://www.cloudflare.com/documents/build-next-gen-git-platform-competition-terms.pdf (read 2026-10-03).

## The ask, in Cloudflare's words

> Build a new way for hundreds of thousands of agents to work on changes concurrently.

> We aren't looking for GitHub as it exists today with agents added on top.

They explicitly invite rethinking: repositories, branches, pull requests, worktrees, code review, merge conflicts, how agents keep context, how you compare concurrent changes, and how you decide what gets deployed. Their framing questions: *How do agents know what other agents are working on? What happens when they make conflicting changes? How do you review everything they produce?*

## Hard requirements (from the rules)

| Item | Requirement |
|---|---|
| Deadline | 2026-10-14 (submission). Finalists announced 2026-10-16. |
| Final | Finalists present live for 10 minutes at Cloudflare Connect, Moscone West, San Francisco, 2026-10-21. Winner must be physically present. |
| Must use | Cloudflare Workers **and** Artifacts. Project must "enable multiple agents working on changes concurrently". |
| Deliverables | 5 to 10 minute demo video, open source code, instructions to run it. |
| License | MIT, Apache-2.0, BSD-2 or BSD-3, with a LICENSE file in the repo. |
| Entries | One submission per entrant. Original work, no third-party copyrighted material without permission. |
| Content | No attacks on competitor products, no political/sexual/weapons content. |
| **Eligibility** | **Legal resident of the United States or Canada, 18+.** Not Cloudflare employees or their households, not government employees. |
| IP | Entrants keep all IP. Cloudflare gets a license to the demo video / presentation for promotion, and source access only to judge. Submissions are not confidential. |

**Flag for Coop:** the residency rule is strict (US/Canada). If the entrant of record is not a US/Canadian resident, decide who submits before building a video around a name.

## Judging rubric (verbatim weights)

1. **Originality and quality of the prototype for agent-oriented software collaboration: 50%**
2. **Effectiveness of multi-agent concurrency, coordination, context preservation, review, and conflict handling: 25%**
3. **Ease of use and product/user experience: 25%**

Each scored 1 to 5. Ties broken on criterion 1. Three finalists.

Reading the rubric: half the score is "did you invent something that is obviously *for agents*", a quarter is "does it actually hold up when many agents collide", a quarter is "can a human use it". A beautiful GitHub clone scores low. A novel concurrency model with a rough UI scores better than a polished clone. A novel model **plus** a UI that makes the swarm legible to a human wins all three.

## Prizes

- Top three teams: travel and tickets for up to two people to Cloudflare Connect SF.
- First place: $25,000 Cloudflare credits (12 months) and the VIP speaker dinner.

## What Cloudflare shipped for this (open beta, Workers Paid plan)

- **Artifacts**: a versioned filesystem that speaks Git, one Durable Object per repo, a Zig git server compiled to ~100 KB of Wasm, SQLite storage with 2 MB rows (chunked), R2 snapshots. Smart HTTP v1/v2, shallow and blobless clones, git-notes. Pricing from 2026-10-15: $0.15 per 1k operations (first 10k/month free), $0.50 per GB-month (first GB free).
- **Workers bindings**: `env.ARTIFACTS.get(name)`, `.create()`, `.fork()`, `.import()`, `.info()`, repo-scoped git tokens, read-only forks, `using` disposal.
- **Event subscriptions**: `cf.artifacts.repo.pushed` / created / imported / forked / deleted / cloned / fetched, delivered to Queues, from which you kick off Workflows (their example: push → review workflow).
- **Workers Builds integration**: push to the production branch deploys; push to any other branch gets a sharable Workers Preview URL.
- **Jurisdiction** (US/EU) per namespace, and per-repo metrics in the dashboard.
- **ArtifactFS**: open-source blobless lazy-hydrating filesystem for mounting huge repos quickly, works with any git remote.

Cloudflare staff on HN (Artifacts launch thread, 2026-04-16, 217 points): "with Artifacts you could create millions of repos every day, one for each agent/chat/user/session" and they are "exploring more a (dare I say) 'agent first' VCS" beyond the git interface. That is the direction the judges will reward.

See `01-` through `07-` for the research memos and `10-` onward for the beanstalk design and brainstorm.
