# The Jev canvas: a second opinion

**Coop's gut call:** the best way to show a repository is a canvas where you ask Jev a question and it dynamically generates an interface to answer it.

**Verdict:** right about the canvas, half right about "dynamically generated", and Jev's job in it is narrower than the call suggests. This doc builds on `claude-12-jev-canvas-design.md` (full card catalog and pipeline) and Codex `03-jev-canvas-experience.md`. It agrees with both on fundamentals and adds what they don't cover.

## 1. What Jev can and cannot do

Jev, from TypeSafe AI, is a typed *decision* model. It does not produce text. It takes a state (text or JSON, up to about 32k tokens) and typed questions, and returns typed answers:
- **Choice:** one of up to 255 options, with probabilities.
- **Score:** a level on an ordered rubric.
- **Noul:** a yes/no probability.

From Coop's own tests (2026-09-16 to 09-19):
- **Latency:** 180–440 ms per call whatever the question count (4 to 60 questions). It rose to a 2.2 s median under 12 concurrent 2.3k-token requests.
- **Price:** $0.042 per million input tokens; output is free.
- **Stability:** repeat answers were stable.
- **Text reading:** strong on reading code and prose.
- **Numbers:** useless as a numeric judge. TypeSafe's own docs say "not a calculator."

In UI, the precedent is Vercel's json-render. Its Jev mode picks components from a developer-defined catalog and never sees data values (still marked experimental and unreleased as of v0.21.0).

So **Jev cannot generate an interface.** It can *choose* one, quickly and cheaply, from options someone already built. The rule from earlier work holds: **code computes, Jev picks, Claude narrates.**

## 2. Where the gut call is right

**Lists don't scale to supervising thousands of agents.**
- **GitHub's inbox is already "unusable"** for human-plus-bot volume.
- **The questions are spatial and relational:** where are the agents, where are they colliding, what's red, what's waiting on me.
- **Space can carry that.** A stable map of the codebase with agents shown on it can answer those questions at a glance in a way a PR list cannot.

`claude-07` found no shipping product that puts agents *on the codebase*. That gap is real.

## 3. Where it needs correcting

1. **"Generated" should mean selection at runtime and generation at design time.**
   - **Runtime:** Jev routes the question to a view template and its arguments in a few hundred milliseconds.
   - **Design time:** when no template answers a question well, Claude drafts a new card offline. It ships as a reviewed change; see §5.4.

   This gives the "dynamic" experience without broken generated layouts, which earlier research says destroy muscle memory.

2. **The map must stay fixed.** The codebase layout (packages, then modules, then files, then symbols, with semantic zoom) is computed deterministically and stays put across commits. Cards dock *to* regions of the map. The layout is never generated.

3. **A canvas is only as good as the data behind it.** Without the concurrency engine in `02`, a generated canvas is a pretty file browser. The questions worth a canvas need data GitHub doesn't have:
   - read and write sets
   - conflict edges
   - repair tickets
   - error budget
   - green deltas

   **The thesis is what makes the canvas interesting.**

## 4. Cards only this design can render

These extend the 17-card catalog in `claude-12`.

| Card | Shows | Data source |
|---|---|---|
| **Conflict graph** | Active tasks as nodes and predicted or actual overlaps as edges, with clusters (idea #8) circled | Scheduler DO |
| **Lanes** | What runs in parallel right now, what is chained behind what, and why | Scheduler placements |
| **Error budget** | Gauge, open reds, oldest red, and what the controller is doing about it | Controller |
| **Suspects and repairs** | Read-write overlaps, the fixer assigned, and status | Validator, repair tickets |
| **Footprint heat** | Predicted footprint against actual write set per task (also how prediction is graded) | Trunk log |
| **Green delta** | What changed in green since you last looked, grouped by intent, with attestation | Promoter |
| **Agent table** | The `ps` view: budget, state, slice, last read, kill or pause buttons | Process table (idea #11) |
| **Assumption blame** | For a line: what it relied on, and which later commit changed it | Read sets (idea #23) |
| **Branch versus green, live** | Side-by-side preview, behavior diff and proof bundle | Preview tools (`06`) |
| **Markers** | Decaying notes on symbols, shown as heat (idea #10) | Context API |

## 5. Four additions to the existing designs

### 5.1 Type-ahead routing

Jev is fast and costs almost nothing per call. At 2k tokens of state, a call is about $0.000084. So the canvas can **re-route while you type**, debounced to about 250 ms, with stale requests cancelled:
- Type "what's colliding in bil…" and the conflict-graph card slides in, filtered to `packages/billing`.
- Type "…and who's fixing it" and the Suspects card joins it.

A frontier LLM can't do this at that latency and price; it is the clearest case for Jev over a general model. **Watch concurrency:** latency rose to about 2 s under load in our tests. Keep state small (the question plus card descriptions, never repo content), keep one request in flight per user, and cancel aggressively.

### 5.2 One query layer, two renderers

A view is data:

```json
{ "class": "collisions", "args": { "path": "packages/billing" },
  "query": "conflicts.active(path)", "cards": ["conflict-graph", "suspects"] }
```

- **Humans** see the canvas render it.
- **Agents** call the same thing through MCP (`ask_repo`) and get JSON.

Both see the same facts, from the same queries, at the same SHA. That matters for trust: when an agent cites "no collisions in billing", the human can open the exact view the agent saw.

### 5.3 Shared with agents

- **Decision requests are cards.** An agent asks a human by pinning a decision card to the region of the map it concerns. The human answers in place, and the answer becomes a decision record the agent receives.
- **Agents appear as sprites** on the regions they are reading and writing, using live read and write sets. Supervision becomes visual: a crowd of sprites on one file is a problem you can *see*.

### 5.4 The catalog grows through review

1. When Jev's best route falls below a threshold, or a Noul check ("can the catalog answer this?") falls below 0.5, the question is logged as **unanswered**.
2. Every night, Claude clusters unanswered questions and drafts a new card for the biggest cluster: a json-render component, a query and a description.
3. The draft opens as a change, rendered on a preview against real data.
4. A human approves it, and it joins the catalog for everyone.

This is the honest version of "the interface generates itself": it grows from what people actually ask, through the same review loop as code.

## 6. The pipeline and its latency budget

| Step | Who | Budget |
|---|---|---|
| Injection screen (Noul) + route (Choice over question classes) + entity kind (Choice) | Jev, one call | ≤ 400 ms |
| Entity resolution: fuzzy match over symbols, tasks and agents, then Choice among the top 50 if ambiguous | Code (+ Jev) | ≤ 150 ms |
| Query | D1, DO SQLite, or the scheduler DO | ≤ 200 ms |
| Render cards, dock to map regions | Browser (json-render-style catalog) | ≤ 100 ms |
| Caption, optional and streamed | Claude | 1–2 s, never blocks |

**Fallback:** if Jev is unavailable or slow, a small LLM router does the same job with the same catalog. Build the router interface so the swap is a config flag; Jev is an API-only product from a startup a few weeks old.

## 7. The 12 questions the canvas should answer on day one

1. What's colliding right now?
2. Why is the fast trunk red, and who's fixing it?
3. What changed in green since yesterday?
4. What's waiting for me?
5. What did agents change in `<area>` today, and why?
6. What would break if I change `<symbol>`? (Uses the read-set graph.)
7. Who touched this line, what did they assume, and is that assumption still true?
8. Where are agents spending budget?
9. Show `<branch or task>` against green, live.
10. What's the status of `<intent>`?
11. Which evidence proves `<change>`, and has it been attested?
12. Is this repo healthy? (Shows the budget, lanes and stale reservations.)

## 8. How to test the gut call before betting the demo on it

**Setup:** seed a swarm run on the demo repo with planted problems:
- a colliding pair
- a semantic break that textual merge misses
- a test that proves nothing
- a starving refactor
- an agent burning budget

**Three interfaces:**
1. Lists and pages: a PR inbox plus dashboards.
2. The canvas with a small LLM router.
3. The canvas with the Jev router.

**Measure:** time to a correct answer for each of the 12 questions, wrong-card rate, p95 latency, cost per question, and how often people say "where am I?"

**Kill criteria:**
- **Keep Jev only if:** it beats the LLM router on latency at equal or better accuracy. Otherwise swap the router; nothing else changes.
- **Keep the canvas as the home screen only if:** it beats lists by at least 30% on time-to-answer for supervision questions (1, 2, 4, 8, 12). Otherwise it becomes one tab and the home screen is the green delta.
- **Revisit the map layout if:** people spend more time arranging than answering. Reduce spatial freedom.

Coop's own Jev history says this test is worth running. Jev did well as a classifier and failed as a numeric judge. Routing is classification, so the expected result is good, but it should be measured, not assumed.

## 9. Risks

- **Prompt injection through repo text.** Jev sees only the question and card descriptions, never repo content. Captions are written from computed results. A Noul check screens the question.
- **"I don't know what to ask."** Generate a home board at import (map, hotspots, in-flight work, green delta) with suggested question chips. Every object gets an "ask about this" action, so questions start from a selection, not a blank box.
- **Demo-ware.** A canvas looks great on stage and can be a chore on a Tuesday. The day-to-day loop needs plain pages: a change, a file, a diff. Keep them one click away.
- **Vendor risk.** Jev is closed weights and API-only; keep the router swappable (§6).
