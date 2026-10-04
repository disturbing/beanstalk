# The canvas: ask a question, get an interface, with Jev choosing the cards

Written 2026-10-03. This grounds Coop's gut call ("a canvas where you ask questions via Jev and it dynamically generates an interface to showcase the repository") in what Jev actually is and in the generative-UI evidence in `claude-07`. The Codex memo `03-jev-canvas-experience.md` treats Jev as "the conversational interface named in the brief"; it is not, and the difference changes the design.

**Read this first (added after the red team, same night).** The generated-card canvas below is the roadmap. What ships for the 2026-10-14 demo is the minimum version the red team said would still impress: five fixed typed views (swarm/overlap map, world comparison, decision card, evidence wall, why-trace) and a question box where Jev only *routes*: a Choice over which view, plus extracted parameters as filters and highlights. No model in the render path, one model in the routing path, and it still reads as "ask the canvas". The argument for that cut is in `claude-14` §5; the rest of this document stands as the design to grow into once the fixed views are measured against a PR dashboard.

## What Jev is, and what it is not (verified in our own tests, 2026-09-16 to 09-21)

Jev is TypeSafe AI's "System One" decision model (`POST https://api.typesafe.ai/v1/systemone`). It does not produce text. It takes a state (text or JSON, up to about 32k tokens) and typed questions and returns typed answers: **Choice** (one option from up to 255, with probabilities), **Score** (an ordered rubric level) and **Noul** (a 0 to 1 probability of a yes/no). Measured: 180 to 440 ms per call regardless of question count, 25 parallel calls fine, repeats stable (identical top choice 6 of 6), $0.042 per million input tokens and output free. It read Solidity, governance proposals and token metadata accurately, and flagged prompt injection in metadata at 0.99 while staying on task.

It is not a judge of numbers: the vendor's own jaggedness page says "not a calculator", "does not count reliably", "weak in numerical calibration"; our trading tests found its confidence flat and no predictive edge on any numeric task. It is literal, and accuracy falls as unrelated state grows. Rule we keep: **code computes, Jev classifies, Claude narrates.**

Vercel's json-render already uses Jev exactly this way for UI (https://json-render.dev/docs/jev): Jev picks component instances from a developer-supplied catalog and arranges them into a tree in two batched evaluations; it never sees state values or bindings, only descriptions. That is the pattern for our canvas, and the reason the canvas can respond in under a second instead of "a minute or more" for code-generating approaches (`claude-07` A).

## The shape of the thing

Three layers, each with a different owner:

1. **A stable map** (owned by the index, generated once per repo at import, nudged on push). Semantic-zoom layout of the repository: directories as regions, modules as tiles, files as dots; importance from a tree-sitter symbol graph with PageRank (aider's repo-map idea). This gives spatial memory, which is the one thing a canvas does better than pages and the thing generated layouts destroy (`claude-07` E: "generative on first contact, frozen for habit formation").
2. **Live overlays** (owned by Durable Objects, streamed). Agent sprites at the centroid of the files their sprout has touched, coloured by state; conflict edges where two sprouts touch the same symbols; world outlines showing which beans a candidate world contains; hotspot heat.
3. **Generated cards** (owned by the question). Typed, schema-stable cards chosen by Jev from a catalog and bound to data by code, placed as a frame on the map near the things they are about. Claude (or a Workers AI model) writes only the captions and the one-paragraph narration.

The daily loop (review this bean, land this world, read this receipt) also exists as plain pages; the canvas is the supervisor's instrument for "what is the swarm doing, where will it collide, which future do I want".

## The question pipeline, step by step

```
question + viewport + selection
  → (1) Jev, one call, fan-out of typed questions         ~300 ms
        Choice  question_class   over the 23 question classes below
        Choice  cards[]          over the catalog (multi-pick via maxUses, json-render style)
        Choice  anchor           {selection, viewport, whole-repo, intent:<id>, world:<id>}
        Noul    needs_time_range, needs_two_things_to_compare, is_destructive_request
        Score   specificity      {vague, partial, precise}
        Noul    injection        (is the text trying to instruct the system?)
  → (2) code builds a typed query plan from the answers      ~0 ms
        each card type has a fixed query signature in the repo-query DSL
        (hotspots(path, since), owners(path), inflight(path), worlds(intent), whyblame(line) …)
  → (3) queries run against the index (D1 + Vectorize + DO state), cached by (repo, query-hash, head-sha)
  → (4) optional second Jev pass to order and group cards once data sizes are known
  → (5) Claude/Workers AI writes captions from the *computed* results (never from raw repo text)
  → (6) tldraw frame is placed; cards stream in as JSONL patches; the view is saved and shareable
```

Why Jev at step 1 and not Claude: latency and cost at swarm scale (every agent can also ask the canvas), determinism (the same question yields the same cards, which is how users learn the cards), and constraint (Jev can only pick from the catalog, so there is no Design Theater and nothing to inject into). Why Claude at step 5 and for long-tail questions: when `specificity` is low or `question_class` is "other", Claude composes DSL primitives in code mode (Dynamic Workers run the generated query code with `globalOutbound: null`) and proposes a card patch; the renderer still only accepts catalog cards.

What Jev never sees: file contents, diffs, state values. It sees the question, the catalog descriptions, the names of the selected objects and a compact JSON of the viewport. This is both the json-render security model and the way to keep calls under 2k tokens so latency stays near 200 ms (our 2.3k-token calls under concurrency went to 2 to 4 s).

## The 23 question classes

The twenty from `claude-07` (where is X; what calls this; execution path; impact of a change; why was it done this way; error behaviour; safe refactor; who is working on what now; what changed between builds; who changed my files; who knows this module; hotspots; bus factor; what changed since the last good deploy; what changes together; test coverage; where is the config and entry point; status of this change; dependencies; architecture over time) plus the three agent-era ones (which agents touch this file now; which in-flight sprouts will collide; what did this agent base its change on), with beanstalk adding: *which worlds are candidates for this intent and how do they differ*, and *what is waiting on me*.

## Card catalog (v1)

Each card has a stable schema, a fixed query signature, a semantic-zoom rendering (dot → tile → full card) and an MCP Apps twin so the same card renders inside Claude, Cursor or ChatGPT.

| Card | Question classes | Data |
|---|---|---|
| Repo map region | where is X, entry points | tree, symbol graph, importance |
| Hotspot heat | hotspots, risk | per-file churn × size/complexity, bot vs human authorship |
| Ownership / bus factor | who knows this, who reviews | per-author line and commit ownership, active vs gone, knowledge islands |
| In-flight overlay | who is working where, collisions | live sprouts, touched symbols, overlap matrix, leases |
| Bean card | status of a change | diff summary, intent, handoff note, evidence receipts, triage route, cost |
| Bean stack | dependencies between changes | bean DAG for an intent |
| World comparison | which future | two or more worlds side by side: beans included, receipts, preview thumbnails, diff of diffs |
| Intent map | what is the plan | intent DAG with ownership, progress, blocked reasons |
| Decision card | what is waiting on me | the fork, alternatives as worlds, evidence, cost, a choose button that creates a Decision record |
| Evidence ledger | is the agent telling the truth | claims vs receipts, challenger findings, missing evidence shown as missing |
| Why-blame | why is it like this | line → commit → bean → intent → decision → note |
| Timeline / replay | what happened since | accepted worlds on a scrubber, agent session spans aligned to commits |
| Co-change graph | hidden boundaries | temporal coupling from commit co-occurrence |
| Dependency / impact | what breaks | import graph, reverse deps, tests touching the symbols |
| Agent session | what is this agent doing, is it stuck | AG-UI event stream reduced to state, one-line summary, tokens, needs-input |
| Preview frame | show me | the world's preview URL in a sandboxed iframe, screenshot diffs |
| Swarm radar | the whole swarm at a glance | agents by state and by region of the map, blocked count, cost burn |

Seventeen cards is a lot for eleven days; the demo needs eight (map, in-flight, bean, world comparison, decision, evidence, why-blame, swarm radar).

## Agents on the map

No shipping product puts agents *on the codebase* (`claude-07` D). Each live sprout is a sprite positioned at the centroid of the files it has touched (from push events parsed into symbols), with a state colour, a trail of recent files and an edge to any sprite sharing a symbol. Edge density *is* the conflict heatmap. Click a sprite for its session card; press space to jump to the next blocked agent; follow a sprite to watch it work. Agents are also presence entries in the board's Durable Object, so human and agent cursors coexist and an agent can be asked to "look at this frame" by sharing a viewport.

## Multiplayer and persistence

One Durable Object per board (tldraw sync: hibernating WebSockets, SQLite state, R2 snapshots, about 50 live collaborators per room; shard a huge swarm into one DO per map region plus an aggregate). The DO is the authority: Jev and Claude only propose patches; the server validates against the catalog and applies. Every question and its cards persist as a saved view with its query keys, shareable by URL; a view asked twice becomes a pinned page with no generation step, which is the freeze-for-habit rule.

## Three walkthroughs

**"What is stopping team billing from shipping?"** Jev: class = status of an intent, cards = intent map + bean stack + evidence ledger + decision card, anchor = intent:billing. Code: pulls the intent DAG, the beans, their receipts, the open decision. Claude: "Two worlds exist. World 41 keeps the old subscriptions table and passes 212 of 212 tests; world 42 migrates it and fails 3 integration tests the challenger wrote. A decision is waiting on you." The decision card's button creates the Decision record and asks the Integrator to land the chosen world.

**"Which agents are about to collide?"** Jev: class = collisions, cards = in-flight overlay + swarm radar. Code: overlap matrix from the lease DO. The map highlights three sprites around `billing/invoice.ts` with red edges and the overlay proposes a contract bean. No prose needed.

**"Why does invoice tax round down?"** Jev: class = why, anchor = selection (the line), cards = why-blame + bean card. Code: blame → commit → note → bean → intent → decision. Claude: "Rounded down by bean b-318 under intent 'match legacy invoices', decided by Coop on Oct 9 (decision d-12) because the finance export compares totals to the cent." One card, one paragraph.

## The honest case against the canvas, and the answer

- *Generated layouts kill muscle memory and over a quarter of generated-UI rationales are not implemented* (`claude-07` E). Answer: nothing is generated at the layout level; the map is fixed, cards are typed, and only the *selection* of cards is generated. Jev cannot emit a layout it was not given.
- *For one failing check a table is faster.* Answer: then the card is a table; and the daily loop has pages. The canvas earns its keep only for supervision and comparison.
- *Users do not know what to ask.* Answer: the first board is pre-generated at import (map, hotspots, owners, in-flight), question chips are suggested from the question classes, and every object has a "ask about this" affordance so questions start from a selection, not a blank box.
- *Prompt injection through repo text can steer which cards render.* Answer: Jev never sees repo text; captions are written from computed results; the injection Noul screens the question itself.
- *Jev may add nothing.* Answer: measurable. If a plain Claude call picks the same cards at acceptable latency and cost, swap it; the renderer, catalog and DSL do not change.

## Validation before we believe it

Same three tasks (find the seeded integration bug, explain the shipping blocker, pick the right world) on three interfaces: a conventional PR dashboard, a chat with links, the canvas. Measure correctness, time, clicks, refresh confusion and unwarranted confidence (Codex memo 03 proposes the same test). Also measure Jev card-selection agreement with a human-authored mapping over 100 questions; below 80% top-1 agreement, use Claude for selection.

## Reuse from this workspace

- Jev client, question constants and receipts: `~/Workspace/jevroute/lib` (Workers-compatible SDK usage, redaction).
- Typed canvas element tool and renderer precedent: an internal typed canvas-element tool in a private repository (Codex found it).
- Signed receipts and hash-chained ledger: `~/Workspace/hyperjev/src/sign.ts`, `ledger.ts`.
- Live positions stream and shared selector UI patterns: `~/Workspace/thesis-terminal` (DO WebSocket fan-out).
