# Self-critique and the decisions only Coop can make

Written 2026-10-03. An independent red-team pass (a fresh Claude agent told to behave as a hostile merge-queue operator and hackathon judge) attacked `claude-10` against the rules, the Artifacts limits, the merge-queue research, the Codex thesis and Steward. This file records what it found, what we concede, what changed in the other docs as a result, and what remains for Coop to decide. The brief asked us to question ourselves; this is that.

## 1. The ten questions a judge will ask, with the answers we now have

| # | Question | Answer after the fixes |
|---|---|---|
| 1 | How is this not Mergify with batches? | It is a speculative batch queue. The three differences: conflicts are dispatched as work, not ejected; losing alternatives are kept with evidence and offered to a human; trunk never receives an agent push. The thesis no longer says "not a queue". |
| 2 | Artifacts has no merge, diff or refs API. How do you build a world? | In a Container: clone trunk, apply the beans, run checks, push a `world-<hash>` branch to the connected trunk repo (so Workers Builds previews work). Worlds per hour = container concurrency ÷ minutes per world, on screen. Not "a cheap fork". |
| 3 | 1,000 beans, 40% pairwise conflict. Batch size? | About 27 at best, about 13 greedy. So admission control, dedupe by intent at enqueue and path leases run *before* the queue, and the budget panel shows it. We will not claim 1,000 pending beans; we claim hundreds active with a bounded queue. |
| 4 | Who verifies the signed receipt? | Nobody yet. "Signed" is out of the pitch until a public key and a one-file verifier ship. Receipts remain structured records keyed by exact inputs, which is the useful part. |
| 5 | A decision card is on screen. What if trunk moved? | The card shows how many batches landed since it was built; the chosen world is re-materialised on the current trunk and re-proven before landing. Alternative worlds are capped at two per decision so speculation never becomes a tree. |
| 6 | A cheap judge decides what reaches a human. How do you know it is not hiding forks? | It is measured, not trusted: routes are logged against eventual human decisions, one in ten auto-landed beans is sampled for audit, drift suspends auto-land. Same discipline as Steward; ours is a knob until we have the numbers. |
| 7 | Steward ships most of this. What is left? | World composition with batch landing and bisection, conflict as a stored object with resolver sprouts, and forking an agent with its context. The demo is now built around exactly those three. |
| 8 | You promise sprout start-up in seconds via blobless clones. | Unverified on Artifacts (partial clone unsupported on v1). Removed from the claims; benchmark first. |
| 9 | Millions of sprouts, two forks each. Storage? | Each fork duplicates storage against a 1 TB account cap. Sprouts are shallow, `defaultBranchOnly`, with a TTL and a reaper; "Millions" is gone from the scale table. |
| 10 | Beans require a why. Claude Code just ran `git push`. | A plain push still produces a bean; the note comes from MCP, a `.beanstalk/handoff.md`, or a trailer; if missing, a draft is generated from the diff and marked unverified, lowering triage priority rather than blocking. "Tools work unchanged" stays true. |

## 2. What we concede

- **Worlds were two things wearing one name.** A speculative batch and a human-facing alternative have costs that differ by an exponent. The thesis now names both and bounds the second.
- **The Integrator is Cursor's gate at batch granularity.** We do not remove the "100% green" gate; we amortise it across a batch and stop conflicts from stalling it. Said plainly now.
- **Evidence is mostly CI renamed.** The parts that are not: evidence surviving supersession ("roads not taken"), evidence reuse keyed by world hash, and independent challengers (which are cut from the demo as too expensive).
- **Symbol-level overlap on every push is the hot path and is billed per operation.** v1 is path-level from `readTree`; tree-sitter comes later.
- **The eight-object table overlapped Steward on six rows.** The originality claim rests on composition, conflict-as-object and fork-the-agent, and the demo spends its time there.
- **The generated-card canvas was our riskiest UX bet and the thing most likely to fail on stage.** For the demo it is five fixed views and a router; the full design in `claude-12` is a roadmap with a measurement plan.
- **"Any number of agents" and "hundreds active" cannot both be the pitch.** It is the second.

## 3. Steward versus beanstalk, honestly

Steward (live at steward.craigm26.workers.dev, published 2026-10-02) has forks with scoped tokens, a claims board of declared files, rival candidates per decision, a judge and a referee, a human steward, a ledger with why-blame, earned auto-merge with drift suspension and sampling, Workers Builds previews on `cand/` branches, and a 120-task run with numbers. Where beanstalk's design is the same job done better but unbuilt (overlap from diffs rather than declarations; a challenger that writes a failing test rather than an objection), we should say so and not pretend novelty. Where there is no overlap at all: composing N beans into one world, batching, bisection, fast-forward landing; conflict as a stored object with a resolver sprout; an agent's context forked with its code. Three beats, and they are the demo.

We will not copy earned auto-merge for the video; the judges have seen it.

## 4. Codex's thesis versus ours

Codex got right what we lacked: an admitted-concurrency budget on screen, a failure-mode column on every idea, abort propagation as a first-class feature, "candidate is an ordinary git commit plus a manifest" as the honest version of "world", metrics that are not agent count, refusing work as a feature, and an avoid-first list that included an uncapped swarm and an arbitrary-code UI generator. All of that is now in `claude-10`, `claude-11` and `claude-13`.

Ours has what Codex lacked: a mechanism (Integrator, batching, bisection, resolver, landing rule), a ten-minute script, and a willingness to name what is new, which the 50% criterion requires. The red team's judgement, which we accept: Codex's memo scores with an investor and ours on a stage, and the winning document is our mechanism with Codex's budget table and objection column pasted in.

## 5. The canvas, after the critique

The strongest case against a question-generated interface for this product: the human's job is one fast, high-stakes choice with evidence, and a layout that differs per question has no muscle memory, so the human cannot see what was omitted; Steward's fixed decision card is the baseline, and a generation failure on stage is unrecoverable. We accept this for the demo. The minimum version that still reads as "ask the canvas": five fixed typed views plus Jev as a router (which view, which parameters), zero models in the render path. The full catalog, agents-on-the-map and saved views remain the design to grow into, with the A/B against a PR dashboard in `claude-12` as the gate.

## 6. Scope reality

Buildable by 2026-10-14: sprouts with scoped tokens; push events to an Integrator DO; Container composition of worlds and fast-forward landing with bisection; Workers Builds previews per world branch; conflict objects with a resolver agent; a decision card with two previews and a world diff; the why-trace from notes; three to six scripted Workers AI agents plus one live Claude Code session; the budget panel; Jev as a router.

Not buildable in time, now roadmap: tree-sitter symbol overlap, verifiable signed receipts, independent challengers with hidden fixtures, intent DAG planners, canary traffic, GitHub mirror and PR export, 100 live agents, the generated-card canvas, GitHub Actions execution (the compatibility report in `claude-05` stays as a slide).

The feature that loses everything if it fails on stage: world composition and landing. The second most likely failure: the live resolver. Both are pre-staged and recorded as fallbacks in `claude-13`.

## 7. Decisions for Coop

1. **Eligibility.** The rules require the entrant to be a legal resident of the United States or Canada. Who submits?
2. **Name and metaphor.** "beanstalk" with sprouts, beans, worlds, trunk: keep the words in the UI or keep them in the logo and use fork, change, candidate, main on screen? The docs use both; the judge needs one.
3. **The demo app.** A small Hono + D1 Workers app we control (so Workers Builds previews work) versus importing a known open-source repo (more impressive, previews harder). Recommendation: our own app.
4. **Jev in the demo.** Keep it as the view router (cheap, fast, replaceable in an hour by a Workers AI call) or leave it out of the video to avoid the vendor question? Recommendation: keep, mention once.
5. **Real agents.** One live Claude Code session is enough; adding Codex live doubles the stage risk. Recommendation: Claude Code live, Codex recorded or omitted.
6. **GitHub Actions.** Build nothing for the demo; present the compatibility report and the Containers cost figure as the roadmap. Agree?
7. **Open-sourcing the docs.** The repo must be open source with a permissive license; the research memos quote forum posts and cite vendors. Ship the docs folder as is, or keep only the design docs public?
8. **The Codex set.** Keep both sets in the repo with the index, or merge into one? Recommendation: keep both until the demo is built, then merge what survived.
9. **Sign in with ChatGPT for the hosted fleet.** The `chatgpt.tokens.use.direct` scope lets a sprout spend the sponsoring human's Plus/Pro allowance, but remotely hosted apps need waitlist approval. Apply today; build the plan-proxy Worker either way (it is a day of work and the attribution side effect is valuable); fall back to API keys in AI Gateway for the video if approval has not arrived by 2026-10-12.

## 8. What changed in the other documents because of this file

- `claude-10`: one-sentence pitch, World row, Integrator wording, admission-control paragraph, overlap hot path, handoff contradiction, judge auditing, receipt signing, scale table, blobless-clone caveat.
- `claude-13`: rewritten around composition; cut list reordered; resolver pre-staged; budget panel added; GitHub Actions and the generated canvas moved to roadmap.
- `claude-12`: demo version added at the top (fixed views plus router).
- `claude-11`: unchanged, because the ideas list already carried the admission-control, supersession and reaper ideas the thesis lacked; the critique confirmed which ideas go on stage.
