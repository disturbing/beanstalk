# Ideas brainstorm: 43 ways an agent-first forge can be different

Written 2026-10-03. Each idea is scored against the competition rubric (O = originality of agent-oriented collaboration, C = concurrency/coordination/context/review/conflicts, U = ease of use; each 1 to 5), with demo cost by 2026-10-14 (S = a day, M = two to three days, L = more than the time we have) and a "what kills it" line, because the brief said to question ourselves. Prior art is named so we never claim an invention that exists. The shortlist that goes into the demo is at the end. The Codex memo `02-product-thesis-and-ideas.md` has a parallel list with a P0/P1/Lab lens; where we overlap I say so rather than restate.

Evidence shorthand: [pain-N] = row N of the top-15 table in `claude-01`; [req-N] = requirement N in `claude-02`; [easy-N]/[hard-N] = Artifacts implications in `claude-04`.

## A. Integration: replace the merge queue with worlds

**1. Worlds: integrated combinations as the thing humans choose between.** A world = trunk SHA + an ordered set of bean revisions, materialised as a real fork, built, tested, previewable. Several coexist; choosing one fast-forwards trunk. Prior art: GitHub's "best of N" is a UI over separate PRs; Steward races rival candidates *per decision*; nobody offers "here are two integrated futures of the whole project, pick one". O5 C4 U4, cost M. Kills it: if composing a world needs a full clone and build each time, 50 worlds/hour is too slow; mitigation is incremental composition in a warm Sandbox and evidence keyed by world hash so identical combinations are never re-tested.

**2. The speculative frontier with an adaptive window.** The Integrator keeps a batch window (Zuul's AIMD: start 20, +1 per success, halve per failure) and composes the next world from compatible beans; on red it bisects (bors/Mergify, never GitHub's tail restart [req-7]) and lands the green prefix. Out-of-order landing when every speculation path agrees (Uber BLRD cut P95 wait 74% [req-6]). O3 C5 U3, cost M. Kills it: non-hermetic tests; the queue must own flake retries and per-test flake rates [req-8]. Uber's warning that builds double per conflicting change is the hard ceiling, which is why idea 5 (supersession) and idea 9 (leases) run *before* the queue.

**3. Resolver sprouts: conflicts become tasks, not blockers.** When a bean no longer applies to the frontier, the Integrator forks a sprout containing both sides plus both intents and dispatches a resolver agent; the result is a new bean revision with evidence. Conflicted states are storable, like jj [req-3]. Wishlist item 5 in `claude-01` asks for exactly this ("dispatch to an agent for reconciliation"). Prior art: an internal platform's merge workflow already hands rebase conflicts to an AI with the raw git output hidden from the user. O4 C5 U4, cost S if resolver = Workers AI model with a fixed prompt. Kills it: the resolver silently picks a wrong side; so a resolver bean always goes through the challenger layer (idea 20) and the two original authors are notified.

**4. Structured merge first, behaviour check second.** Run a Mergiraf-class syntax-aware merge to dissolve spurious textual conflicts (which are 2 to 3x more common between agents, 41.7% cross-agent [claude-02 A]) and then require build plus affected tests, because structured merge converts spurious conflicts into missed real ones [req-4]. O2 C4 U3, cost M (Mergiraf is a binary we can ship in the Sandbox image). Kills it: languages Mergiraf does not parse; fall back to git.

**5. Supersession and abort propagation.** Beans targeting the same intent are alternatives; when one lands the rest are superseded, their evidence jobs cancelled, their dependents rebased; their evidence stays as "roads not taken". 22.1% of dead agent fix PRs died because another PR already fixed it [claude-02 A]; that is pure CI waste today. Codex lists this as P0 too. O3 C4 U4, cost S. Kills it: false supersession (two beans that look alike but differ); require intent match plus diff similarity above a threshold and keep the loser resumable.

**6. Rewind: trunk as a sequence of worlds.** Because trunk only ever fast-forwards to a tested world, "undo to one minute ago" (wishlist 2) is "choose the previous world"; the rejected world keeps its evidence. O3 C3 U5, cost S. Kills it: nothing technical; the UX must make rewind obviously safe (it is a new world that equals an old one, not history rewriting).

**7. Trunk as a log, not a branch.** Internally the Integrator's state is an append-only log of accepted worlds with the beans and evidence they carried, which is what Continuity does for pushes at the storage level and what we do at the semantic level. Everything in the canvas timeline reads from this log. O3 C3 U3, cost S (it falls out of the DO design).

## B. Coordination: intents, leases, contracts, admission

**8. Intent DAG with recursive planners.** Humans or a planner agent decompose a brief into intents with acceptance criteria, constraints, budget and scope hints; sub-planners own slices (Cursor's final swarm shape). Intents are issues with teeth. O3 C4 U4, cost S for the data model, M for the planner. Kills it: vague intents make agents "go deep into obscure, rarely used features" (Cursor); the demo must use numeric constraints ("20 to 40 intents, no TODOs").

**9. Symbol-level leases computed from actual diffs.** An agent's declared scope is a hint; every push to a sprout is parsed (tree-sitter) into touched symbols, routes, schema names, and overlap with other live sprouts is recomputed. Leases are advisory, expiring, with fencing generations so a stale holder cannot submit [req-10]. Cursor proved agents cannot hold locks; Foremerge and agent-semaphore are prior art for claims; our twist is that truth comes from diffs, not declarations. O4 C5 U4, cost M. Kills it: tree-sitter parse cost on every push for big trees; limit to changed files.

**10. Contract beans.** When two sprouts overlap on an interface, the Integrator proposes a contract bean (interface, schema, fixture) that both rebase on, turning a future conflict into a dependency. Contract-first is Codex's P1 "contract-first collaboration". O4 C4 U3, cost M. Kills it: premature contracts freeze the wrong design; make the contract bean a normal bean that can be superseded.

**11. Hot-file slot allocation.** Migrations, route tables, registries, config and changelogs are the documented collision hotspots [req-10]. The Integrator issues slots (next migration number, a reserved route prefix, a changelog fragment file per bean) so agents append instead of editing the same lines. O4 C4 U4, cost S. Kills it: projects whose hot files are not conventional; ship the three common cases (migrations, changelog, routes) and let projects declare others.

**12. Admission control before CI.** Projects set budgets: active sprouts, concurrent evidence jobs, previews; beans are admitted by intent priority and age with a cap per principal so one runaway orchestrator cannot monopolise the lane [req-1, req-9]. Waiting agents get a reason ("queue is testing world 41; you are 3rd; estimated 6 min"). O3 C5 U4, cost S. Kills it: nothing; this is the honest scale story (thousands registered, hundreds active).

**13. Structured handoff as a required field.** A bean cannot be submitted without "what was done, concerns, deviations, findings, open questions" (Cursor's worker handoff), written by the agent, stored in its context repo, and shown on the bean card. O3 C3 U5, cost S. Kills it: boilerplate handoffs; the citation check in idea 18 flags handoffs that do not match the diff.

## C. Context and provenance

**14. Context repos forked with code.** Each sprout has a sibling Artifacts repo holding prompts, notes, decisions and handoffs; forking a sprout forks both, so "try two approaches from here" preserves memory. Cloudflare does this internally for its own sessions (Artifacts beta post). O4 C4 U3, cost S (one more `fork`). Kills it: cost at $0.50/GB-month; context repos are tiny text; add the reaper from idea 34.

**15. Provenance in git-notes as an open convention.** A `refs/notes/beanstalk` note per commit: agent principal, model, session id, prompt hash, intent id, evidence ids, bean id. Survives export to GitHub; interoperates with Entire's checkpoint trailers. Artifacts supports git-notes natively [easy-7]. O3 C3 U3, cost S. Kills it: notes are easy to forge; sign them with the forge's key when the push is accepted.

**16. Why-blame.** Any line → commit → bean → intent → decision → handoff note, as one card. Steward and Entire have pieces; nobody has it on a hosted change page, and it is the first thing a maintainer asks ("why was it done this way" is the top category in LaToza & Myers; `claude-07`). O4 C3 U5, cost S once 15 exists.

**17. Decision records as objects.** Every human choice in the decision inbox becomes a citeable, supersedable record with the alternatives and their evidence; agents can query "what has been decided about X" before starting. O3 C4 U4, cost S. Kills it: stale decisions treated as law; records carry a scope and an expiry and show up on the canvas when a bean touches their scope.

**18. Choices, not sessions.** The bean's rationale is distilled by the agent, then a typed judge checks it against the transcript (TypeSafe's citation-check pattern) and against the diff ("does the summary mention the schema change?"). The transcript stays one click away for audit and for agents to query, never the review surface, which is what the Delta and Entire threads demanded. O4 C3 U5, cost M. Kills it: judges that rubber-stamp; sample and audit.

## D. Review and trust

**19. Three-layer review with humans only at the top.** Deterministic receipts, independent challengers, typed triage; humans see genuine forks only. [req-12] says human review cannot scale linearly (review time +91% then +441%). O4 C5 U5, cost M. Codex's "review by obligation" is the same instinct.

**20. Challenger agents with hidden fixtures.** A different model is told to falsify the bean's claims and to write a failing test; its output is evidence. Mutation probes catch tests that only confirm the agent's own mistake. O4 C3 U3, cost S with Workers AI. Kills it: correlated blind spots across models; keep the deterministic layer primary and report challenger disagreement, not consensus.

**21. Typed triage with Jev.** One fan-out call per bean (risk Score, scope class Choice, "claims substantiated" Noul, route Choice: auto-land / challenge / human), 180 to 440 ms, about $0.04 per thousand beans, deterministic across repeats. Honest limits from our own tests (`claude-12`): Jev is a strong classifier and injection detector but its confidence is flat and it cannot judge numbers, so it *ranks and routes*; thresholds and all arithmetic live in code; nothing lands on Jev's say-so alone. O3 C4 U4, cost S (we have the client code in jevroute).

**22. Earned autonomy per path and per principal.** Paths and agents whose beans keep matching human decisions and never regress post-land earn auto-land; a regression suspends it. Steward's "earned auto-merge" is prior art; our addition is that the reputation is computed from post-land outcomes (rollbacks, incidents), not only from judge agreement. O3 C4 U4, cost M. Kills it: attribution is confounded; show the evidence behind every autonomy change and let a human reset it.

**23. Signed, portable evidence receipts.** Every receipt is a JSON object signed by the runner (Ed25519), carried in notes and exported with PRs, so a review verdict is verifiable off-platform (the Cursor forum ask Cursor deflected). O3 C3 U3, cost S (we have the signing code in hyperjev's ledger).

**24. Reviewer attention budget.** Humans declare capacity ("I can make 10 decisions a day"); the system schedules escalations, auto-lands or holds the rest, and shows the predicted backlog so throttling is visible rather than mysterious. Codex has this as P1. O4 C4 U4, cost S.

**25. Prompt-injection firewall at the forge.** Issue text, PR comments, README content and logs are typed as data; a Noul injection screen (Jev scored our injection probes 0.99) runs before any agent reads untrusted text; outward actions (publish, deploy, comment on GitHub) need an approval. The CVSS 9.4 class of attacks in [pain-12] is structural to "agent reads text"; a forge is the right place to filter. O3 C3 U4, cost S.

## E. Previews and deploy decisions

**26. Preview per world with screenshot evidence.** Push a world to a branch and Workers Builds gives a preview URL [easy-10]; for non-Workers stacks a Sandbox exposes a port. Browser Rendering captures screenshots and a screenshot-diff card is evidence. O3 C3 U5, cost S for Workers apps, M otherwise. Kills it: previews for stateful apps need data; idea 28.

**27. World canary and rollback as world choice.** A Worker routes a slice of traffic to world B's preview; rollback is choosing the previous world. O3 C3 U4, cost M.

**28. Branchable data for previews.** D1 copy-per-world for small databases, DO namespace isolation per preview (Workers Builds already isolates DOs per preview), seeded fixtures declared in the intent. O3 C3 U4, cost M to L. Kills it: large data; out of demo scope.

## F. Interfaces

**29. The canvas: a stable map with generated cards** (full design in `claude-12`). Ask a question, get typed cards on a semantic-zoom map of the repo; agents are sprites anchored to the files they hold; conflict edges are live. O5 C4 U5, cost M. Kills it: Design Theater and layout churn; cards have stable schemas and asked-twice views freeze into pages.

**30. Agents on the map.** No shipping product places agents *on the codebase* (`claude-07` D); every swarm UI is a state-grouped list. Sprites at the centroid of held files, trails of recent touches, edges where files are shared. O5 C4 U5, cost S once the map exists.

**31. MCP-first forge.** The MCP server is the product (about 25 tools; `claude-06`); the web UI is one client; cards are also MCP Apps so the same decision card renders inside Claude, Cursor or ChatGPT. O3 C3 U5, cost S with `createMcpHandler` and workers-oauth-provider.

**32. GitHub bridge with a GitHub-down write path.** Mirror a GitHub repo; beans export as PRs; if GitHub is down, agents keep pushing to sprouts and the Integrator keeps landing; sync resumes later. [pain-3] is the highest-scoring pain in the corpus and "the lock-in is Actions" is why `claude-05` exists. O3 C3 U5, cost M.

**33. Ask-the-repo index.** A DeepWiki-style wiki plus symbol graph built at import by Workflows, in D1 and Vectorize, is what cards query; Jev routes the question class. O2 C2 U5, cost M.

## G. Economics and limits as features

**34. Fork reaper and cost per bean.** Every sprout, world and context repo has a TTL; the reaper deletes idle ones (Artifacts bills per op and per GB [hard-10]); each bean card shows its cost (ops, storage, evidence minutes, model tokens). O2 C3 U4, cost S.

**35. Tenancy-level rate limits as a product.** One DO per repo means a tenant can "absolutely slam my own instance" (HN wish in `claude-03b`); the only shared limits are 2,000 requests per 10 s per repo and per namespace, so the design keeps agents on separate repos. O2 C4 U3, cost 0.

**36. Evidence dedup and cheaper minutes.** Receipts keyed by (world hash, check definition hash) are reused across worlds; superseded jobs are cancelled; a 10-minute standard-3 Container job is about $0.025 against GitHub's $0.06 (`claude-05`). O2 C3 U4, cost S.

## H. Wild cards

**37. Proposal beans: accept ideas, not patches.** For open-source intake, outsiders submit an intent plus conformance tests (a proposal bean); the maintainer's own agents implement it in a sprout; the outsider's agent never gets write. This is pornel's HN proposal and tldraw's "better technical controls over who can contribute, when, and where" [pain-2]. O5 C3 U4, cost M. Kills it: attribution and licence of ideas; record the proposer in provenance and let maintainers accept the original patch too.

**38. Reputation-gated intake.** External principals earn write scope by challenger success and post-land outcomes; new principals start at proposal-only. O3 C3 U4, cost S on top of 22.

**39. Tournament mode.** N agents race one intent; the challenger layer and typed triage rank them; the human picks; losers' evidence is kept. Steward does this per PR; ours is one mode of the Integrator. O2 C3 U4, cost S.

**40. Time travel: ask the agent that wrote it.** Fork trunk at any world and the author's context repo at that time, then start a session with that context ("why did you choose a Mutex?", Zed's Delta pitch, but at the forge and for any past point). O4 C3 U4, cost M.

**41. The beanstalk protocol.** An open spec: git-notes namespace, `.beanstalk/` manifests, event types, MCP tool names, so other forges and tools (Foremerge, Entire, Claude Code plugins) interoperate and the metadata survives a move to GitHub. O3 C3 U3, cost S to write, L to get adopted.

**42. Trunk sharding for monorepos.** Per-directory Integrators compose shard worlds; a cross-shard world is a world of worlds. O3 C4 U2, cost L; design note only.

**43. The forge runs its own small agents.** Resolver, challenger, planner and summariser roles run on Workers AI inside the platform, so the swarm demo does not depend on external API keys; bring your own Claude Code or Codex over MCP for real work. O3 C4 U4, cost S. **Decision 2026-10-03 (Coop): reversed for coding roles.** Workers AI is not trusted to write code; worker, resolver and planner run on real coding harnesses, Claude Code first, locally and through Remote Control on other machines. Workers AI is kept only for non-coding roles (captions, summaries, routing fallback).

## Self-questioning: the ideas that could be theatre

- *Is a world just a merge queue batch with a nicer name?* Partly. The differences that matter: several worlds coexist and are compared (a queue has one head); a world is addressable and previewable; the human choice is between integrated states, not a merge button per PR. If the demo only ever shows one world at a time, the judge is right to call it a queue.
- *Can the Integrator compose worlds at all?* Not server-side: Artifacts has no merge, diff or ref API [hard-2]. Composition runs in a warm Sandbox with real git (and Mergiraf) over a shallow clone, then pushes the world branch. That is the single piece of infrastructure the whole thesis stands on and it is the first thing to build.
- *Does the Integrator reintroduce the gate Cursor removed?* It is a gate for trunk, not for agents: agents never wait to push, they wait to *land*, and they are told why. Cursor's swarm had no trunk at all; a forge needs one.
- *Does Jev earn its place or is it a brand we like?* It earns the triage and routing roles on latency, cost and determinism, and the canvas card selection on the json-render evidence. It does not earn any verdict. If it adds nothing in the demo, drop it; the architecture is the same with any classifier.
- *Will anyone look at a canvas twice?* Only if the second look is faster than the first. Hence stable cards, frozen views, and a page twin. The canvas is a supervisor's instrument, not the daily loop.

## The demo shortlist (what goes on stage)

| # | Idea | Rubric line it carries |
|---|---|---|
| 1, 2, 5 | Worlds, the frontier, supersession | Originality, concurrency, review |
| 3 | Resolver sprouts | Conflict handling, on screen |
| 9, 11 | Diff-derived leases and hot-file slots | Coordination, visible on the map |
| 14, 15, 16 | Context repos, notes, why-blame | Context preservation |
| 19, 21 | Three-layer review with typed triage | Review |
| 29, 30 | Canvas with agents on the map | UX |
| 26 | Preview per world | Deployment decision |
| 31 | MCP-first with Claude Code and Codex joining live | Ease of use for agents |

Everything else is a roadmap slide. `claude-13` sequences the build.
