> Independent red-team critique of `claude-10` produced 2026-10-03 by a fresh Claude agent instructed to act as a hostile merge-queue operator and hackathon judge. `claude-14` records which findings were accepted and what changed. Kept verbatim.

# Red-team critique of the beanstalk thesis (`claude-10`)

Reviewed 2026-10-03 against the brief (50% originality / 25% concurrency-coordination-context-review-conflicts / 25% UX), the Artifacts limits in `claude-04` §7, §10, §11, the merge-queue findings in `claude-02`, the Codex memo `02-product-thesis-and-ideas.md`, and Steward (github.com/craigm26/steward, live at steward.craigm26.workers.dev). Stance: I have run a merge queue; I distrust nouns.

## 1. Ten questions a judge will ask on stage

1. **"How is this not Mergify with batches?"** Honest answer: it is a speculative batch queue. Mergify, Aviator, Graphite and Uber SubmitQueue already group compatible changes, test the combination and bisect. The defensible differences are three: conflicts become dispatched work instead of ejections; losing alternatives are kept and offered to a human; trunk never receives agent pushes. "Not a queue" (§2 of the thesis) is a slogan, not a mechanism.
2. **"Artifacts has no merge, diff or refs API. How do you build a world?"** No answer yet. The thesis says "materialises the world as a fork (cheap)". A fork gives you trunk at one SHA. Applying N bean diffs onto it needs real git in a Container (or isomorphic-git under the 128 MB Worker limit), then a push. Every world is a container job, not a fork.
3. **"1,000 pending beans, 40% pairwise conflict. What is your batch size?"** No answer yet. With p=0.4 the largest mutually compatible set among 1,000 beans is about 2·ln(1000)/ln(1/0.6) ≈ 27, and greedy grouping finds roughly half that. So ~75 batches, each an evidence cycle of "minutes" (Scale envelope), and every landing re-conflicts the remainder.
4. **"Who verifies the Ed25519 receipt, and against which key?"** No answer yet. The runner, the signer, the store and the verifier are all beanstalk. A signature beanstalk checks on its own receipts proves nothing a judge can see.
5. **"A decision card is on screen. How long until the chosen world lands, and what if trunk moved?"** No answer yet. Both worlds were built on one trunk SHA; the human takes minutes to hours; the Integrator lands other batches meanwhile; the winner must be re-materialised and re-proven. "Per-bean latency is bounded by evidence time, not by queue depth" is true only for beans no human ever sees.
6. **"A $0.04-per-thousand judge decides which disagreements reach a human. How do you know it is not hiding them?"** No answer yet. Steward measures its judge path-by-path against human decisions and suspends auto-merge on drift. Coop's own earlier Jev tests (different domain) found a decent classifier with flat calibration: fine for routing, not for the claim that "only genuine forks ... reach the decision inbox".
7. **"Steward already ships a claims board, rival candidates, judge, referee, ledger and why-blame, live, with a 120-task run. What is left?"** Partial answer: world composition, resolver sprouts, context forked with code. These must be shown; Steward's overlap is already on a URL.
8. **"You promise sprout start-up in seconds via blobless clones. Artifacts push is v1 only and partial clone is unsupported."** No answer yet; `claude-04` §10 item 6 says exactly this. Benchmark before claiming.
9. **"Millions of sprouts, each two forks. Storage?"** No answer yet. `claude-04` §10 item 10: each fork duplicates storage; the account cap is 1 TB. A 50 MB trunk × 2 forks × 10,000 agents is the cap. The thesis has no reaper and never mentions the limit.
10. **"Beans require a 'why' and handoff notes. Claude Code just ran `git push`. Where does the why come from?"** Partial answer. "What stays boring" says tools "work unchanged"; the Bean row says handoff notes are "a required field". Both cannot be true: either an MCP tool writes git-notes (not unchanged) or plain pushes produce whyless beans.

## 2. Where the thesis is wrong or overclaims

**Worlds are a merge queue with extra steps, plus one genuinely new thing.** The Integrator "groups beans into a candidate world greedily by compatibility ... materialises the world ... fans out evidence jobs ... lands the world as a fast-forward of trunk ... On failure it bisects the batch (bors/Zuul style)". That is bors with Mergify grouping. The new thing is the resolver sprout and the stored conflicted state (`claude-02` point 3). Lead with that; stop saying "not a queue".

**The Integrator is Cursor's gate at world granularity.** "Lands the world ... when the policy's required evidence is green" means 100% green per world. One red bean in a world of twenty holds the other nineteen for a bisection round, and each round is a container job plus a Workers Builds preview. The thesis claims to take Cursor "seriously" while rebuilding the serial gate one level up. Honest framing: the gate is amortised across a batch and conflicts no longer stall it. It is not removed.

**Bisection is not exponential, but it assumes one culprit.** bors-style bisection is log₂(n) rounds for one failure. `claude-02` reports agent changes failing CI at 70.8% (CircleCI) and 30% of main merges failing. With k red beans it is k·log n rounds of minutes each. The exponential case lives elsewhere: "Several coexist" (World row) plus speculative batching is Uber's tree, which "doubles per conflicting change". The thesis uses "world" for two different objects, a speculative batch and a human-facing alternative, and their costs differ by an exponent.

**Composition without a merge API.** Everything in the Integrator section that says "cheap" or "fork" is actually "clone into a container, apply N diffs, run checks, push". That is fine, it is what Steward's Gate 1 does per candidate, but say it and budget it: worlds per hour = container concurrency ÷ minutes per world.

**1,000 beans at 40%.** See Q3. Worse: "Beans that no longer apply cleanly are not blocked: the Integrator forks a resolver sprout" means every landing spawns resolver agents for ~40% of the remainder, whose output is new beans that conflict with each other. No admission control, no dedupe by intent, no cap per principal: `claude-02` points 1, 9 and 10 are absent. Codex's "could the best feature be refusing more work?" is the missing paragraph.

**Human latency.** See Q5. Add: a decision card needs two built worlds with previews, so the card arrives minutes after the fork point and is stale on arrival.

**Evidence is CI renamed.** "Check definition, inputs (exact SHAs), runner image, outcome, artifacts" is a GitHub check run. The signature only matters if an untrusted party could otherwise write results; here the only writer is beanstalk. The parts that are not renamed are Layer 1 challengers (unbuilt, expensive) and evidence surviving supersession ("roads not taken"), which is a real UX idea. Drop "signed" from the pitch unless a judge can verify a receipt with a public key on screen.

**Previews do not come free with forks.** The World row says "Artifacts fork named `world-<hash>`; Workers Builds preview". Workers Builds previews are per branch of a connected repo (`claude-04` §6, §10 item 10); a fresh fork is not a connected repo. Steward solved this by copying candidates to `cand/<task>/<agent>` branches on the app repo. Do the same or commit to the Sandbox path; do not leave it as "or".

**Other overclaims.** "Overlap is computed from actual diffs (tree-sitter symbols) ... every push": pushed events carry no file list and there is no diff API (`claude-04` §10 items 2, 3), so every push means readTree on both sides plus a Wasm parser in a Worker; that is the hot path and it is billed per op. "Context travels with the fork": nothing says what is in the context repo or which agent reads it back. The thesis cites `claude-12`, `claude-13` and `claude-14` for capability notes, build order and self-critique; none exist in `docs/`. The one-sentence pitch says "any number of agents"; the Scale envelope says "hundreds active". Pick one.

## 3. Steward vs beanstalk

| Steward (live; README quotes) | beanstalk (doc) | Overlap |
|---|---|---|
| "Agents race in their own forks"; fork + scoped write token per agent | Sprout = Artifacts fork + repo-scoped token | Identical |
| Claims board: "Claims that share a file are rivals in one decision" (declared files) | Lease + overlap from diffs/symbols, advisory | Same job; beanstalk's is better and unbuilt |
| Rival candidates per decision; the steward decides, overrides need written reasons | Two worlds per decision card, human clicks | Identical demo moment |
| Judge (Clef on Workers AI, ~500 ms, "names the taste rule"), measured path-by-path | Layer 2 Jev judge ranks by risk | Steward's is measured; beanstalk's is a knob |
| Referee: "the strongest objection to each candidate" | Layer 1 challenger writes a failing test | Same idea; beanstalk's is stronger and unbuilt |
| Gate 1: push → Workflow → `cand/` branch → Workers Builds preview → probes | Layer 0 evidence + world preview | Identical mechanism |
| Earned auto-merge, drift suspension, 1-in-10 sampling | "auto-land" policy | Steward strictly better |
| Ledger + "why-blame reads it back for any line" | Decision objects + "why did invoice tax change?" (demo step 6) | Identical demo moment |
| Merge = "single squash commit on main"; one rival wins | World = N beans composed, batched, bisected, fast-forwarded | **No overlap** |
| Conflict handled by picking a rival | Resolver sprout, stored conflicted state | **No overlap** |
| No agent context object | Context repo forked with code | **No overlap** |
| 6 agents, 120 tasks, ~2 min settle, 16 auto-merged, 80 bounced at Gate 1 | 100 agents on screen, no run | Steward has numbers |

**Verdict.** The originality claim as written ("none changes the integration step") survives on exactly one axis: composing many agents' work into one tested world. Every other row in the eight-object table has a shipped Steward equivalent with a live URL. If the demo spends its ten minutes on decision cards, judges and why-traces, beanstalk reads as Steward with more nouns. The three things to demo that Steward cannot: (1) one world built from five beans by five agents landing as one batch, with a sixth red bean bisected out live and returned with its receipt; (2) two beans colliding, the conflicted state shown as an object, a resolver sprout producing a third bean, the loser kept as superseded with its evidence; (3) fork-the-agent: a sprout split mid-task with its context repo into two approaches, both becoming worlds, a human choosing.

## 4. Codex's proposal vs this one

What Codex got right that this thesis lacks: an admitted-concurrency budget ("at most 100 active Linux workspaces, 40 concurrent validation jobs, 12 active previews, and 2 candidate integration lanes") where the thesis has a "Millions" row; a "Main objection / failure mode" column on every idea where the thesis has none; abort propagation as P0 with a cancellation-race test; "Testing every subset is exponential" stated against its own combined-previews idea; "Candidate is an ordinary Git commit plus a Beanstalk manifest. It is not a promise of isolated production infrastructure", which is the honest version of "world"; metrics that are not agent count ("accepted outcomes, human decision time, regressions, and total cost"); refusing work as a feature; and an avoid-first list that includes "an arbitrary-code UI generator" and "an uncapped swarm", both of which this thesis plans to put on stage.

What this thesis has that Codex lacks: a mechanism. Codex's five objects have no Integrator, no batching, no bisection, no resolver, no landing rule; its 1,000-agent section is a numbered procedure, not a design. Codex names Foremerge and Entire and concedes "these primitives are not new", which is honest and fatal for the 50% criterion. Codex has no ten-minute script. Codex puts a Jev-generated canvas as the main interface at P0, its riskiest UX bet, while hedging everything else as "a hypothesis to validate".

Which a judge prefers: this thesis, for criterion 1, because it can name what it invented and show it in six steps. Codex's memo would score well with an investor and poorly on a stage. The winning document is this thesis's mechanism with Codex's budget table, objection column and avoid-list pasted in.

## 5. The canvas hypothesis

The strongest case against a question-generated interface for this product: the human's job here is one fast, high-stakes binary choice with evidence, and Codex's own first row says the failure mode is "Attractive summaries can hide missing or stale evidence". A layout that differs per question has no muscle memory, so the human cannot see what was omitted. Steward's fixed decision card is the baseline; a generated card that is sometimes worse loses the 25% UX line outright, and a generation failure on stage is unrecoverable. The thesis itself says "The web UI ... is one MCP client among many", which concedes the canvas is not the product. And Jev, in Coop's own tests, is a classifier, not a composer.

The minimum version that still impresses: five fixed typed views (swarm/overlap map, world comparison, decision card, evidence wall, why-trace) plus a question box that uses Jev as a router: a Choice over which view and extracted parameters as filters and highlights, never a layout generator. "Why did invoice tax change?" then resolves deterministically from git-notes to bean → intent → decision → agent note, with a model only choosing the view. Zero LLM in the render path, one in the routing path, and it still reads as "ask the canvas".

## 6. Scope reality by 2026-10-14

Eleven days, one founder plus coding agents. Buildable: trunk plus sprout forks with scoped tokens; push event → Worker computes changed paths via readTree → Integrator DO with a bean table; a Container job that clones trunk, applies N beans, runs the project's tests, pushes `world-<hash>` as a branch of the connected repo; Workers Builds preview per world; land = push the world tip to main; a decision page with two previews and a land button; three to six scripted Workers-AI agents plus one real Claude Code session over plain git. That is Steward plus composition, and it is enough to win the row Steward cannot fill.

Not buildable in time: tree-sitter symbol overlap, verifiable signed receipts, Layer 1 challengers with hidden fixtures, intent DAGs, canary traffic splitting, GitHub mirror and PR export, 100 live agents, a generated canvas.

Cut first: (1) Layer 1 independent challengers; (2) tree-sitter symbol overlap, use path overlap; (3) the generated canvas, use fixed views. The context repo is fourth.

The feature that loses everything if it fails on stage: world composition and landing. If the Integrator cannot build a world from several beans and fast-forward trunk with the preview going live, the "worlds not queues" claim collapses and what remains is a slower Steward. The resolver sprout is the second most likely to fail live (an LLM resolving a conflict in real time); pre-stage the conflict and keep a recorded fallback.

## 7. Five improvements, ranked by rubric gain

1. **Make composition the whole demo.** Five beans from five agents into one world, one red bean bisected out live, trunk fast-forwards, counters on screen (beans landed per hour, minutes per world, batch size). Criteria 1 and 2 are won or lost here.
2. **Replace "Millions" with an admitted-concurrency budget on screen.** Active sprouts, evidence jobs, previews, lanes, plus a live Artifacts ops and storage counter. Pre-empts Q3, Q5 and Q9 and makes criterion 2 believable.
3. **Show conflict as an object.** Click a conflicted world, see both sides and the intent, watch the resolver bean arrive, see the superseded alternative with its evidence kept. This is the conflict line of criterion 2 and nobody else on Artifacts has it.
4. **Fork the agent, not just the code.** Split one sprout with its context repo into two approaches; both become worlds; the human chooses. Unique, and it is the context-preservation line.
5. **A fixed decision card that beats Steward's.** Add what Steward cannot show: "what else lands with this" (the world diff against trunk) and a why-trace from git-notes with no model in the path. Keep the question box as a router only.

Do not copy earned auto-merge; the judges have already seen it.
