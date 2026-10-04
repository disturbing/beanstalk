# Demo plan: what to build by 2026-10-14 and how to show it in seven minutes

Written 2026-10-03, rewritten the same night after the red team (`claude-14`). Eleven days, one founder, coding agents in parallel. Rubric: 50% originality of the collaboration prototype, 25% concurrency/coordination/context/review/conflicts, 25% UX.

## The rule the red team imposed

**Composition is the whole demo.** Steward already shows forks with scoped tokens, a claims board, rival candidates, a judge, a human decider, a ledger and why-blame, live. The one axis Steward cannot fill is many agents' beans composed into one tested world that lands as a batch, with conflicts handled as objects. Every minute of video that is not about that is a minute spent looking like Steward with more nouns.

## The single sentence the video opens with

"Agents work in forks, beanstalk assembles their changes into tested worlds, and you only ever choose between worlds."

## What must exist (minimum honest system)

| Component | Technology | Notes |
|---|---|---|
| Trunk and sprouts | Artifacts: one namespace per project, `fork` per sprout, repo-scoped tokens with short TTL, `defaultBranchOnly`, shallow | No server-side merge or hooks; push is protocol v1 (`claude-04`) |
| Project DO | Durable Object with SQLite: intents, beans, path leases, decisions, worlds, receipts, budget counters | Alarms for lease expiry and the reaper |
| Integrator | Workflow per project fed by `cf.artifacts.repo.pushed` through Queues; composes worlds in a Container (clone trunk, apply beans, run checks, push `world-<hash>` branch to the connected trunk repo); bisects on red; lands by fast-forwarding `main` | The load-bearing piece; built first; worlds per hour = container concurrency ÷ minutes per world, shown on screen |
| Evidence runner | Containers (standard-2) image with git, node, Mergiraf; receipts to R2 + DO | GitHub Actions import is a roadmap slide, not a demo beat |
| Agents | Real coding harnesses only (decision 2026-10-03): six to ten Claude Code sessions, some in local terminals and some on other machines driven through Remote Control, each with subagents in worktrees; Codex optional. Resolver and planner are Claude Code sessions too (`claude-opus-5-5`); workers on `claude-sonnet-5-5`. Workers AI never writes code | A beanstalk Claude Code plugin maps worktree → sprout (SessionStart claims an intent and forks; Stop submits the bean with the handoff note) |
| MCP server | `createMcpHandler` + workers-oauth-provider; tools: `claim_intent`, `open_sprout`, `submit_bean`, `handoff`, `status`, `worlds`, `decide` (human only) | Under 12 tools for the demo |
| Fixed views + router | Five fixed typed views (swarm/overlap map, world comparison, decision card, evidence wall, why-trace) and a question box where Jev picks the view and extracts parameters; no generated layout | The full card catalog in `claude-12` is the roadmap |
| Previews | Workers Builds on the connected trunk repo: `world-<hash>` branch → preview URL; Browser Rendering screenshot | Requires the demo app to be a Workers app |
| Why-trace | git-notes written at land time (bean, intent, decision, note); one view, no model in the path | Cheap, high impact |
| Budget on screen | Active sprouts, evidence jobs, previews, alternative worlds, Artifacts ops and storage counters | Pre-empts the scale questions |

## Remote harness fleet (decision 2026-10-03)

Local sessions join by pull. For scale and for machines we do not own, beanstalk hosts the harnesses itself: a container per sprout, bootstrapped to run a real coding harness headless, tasked through MCP, with every model call routed through Cloudflare AI Gateway.

| Piece | Design |
|---|---|
| Images | One Container image per harness, fixed at deploy: `claude-code` (Node + the `claude` CLI), `codex` (the Codex CLI), later Gemini CLI or Grok. Images carry no keys. |
| Start | `dispatch_task(intent, harness, model)` (an MCP tool and a Worker RPC) starts a Sandbox from the image, clones the sprout with a 60-minute write token, writes `TASK.md` (intent, acceptance criteria, constraints, numeric limits) and the beanstalk MCP config, then runs the harness headless: `claude -p` with `--output-format stream-json` and the sandbox-safe permission mode, or `codex exec --json` in full-auto. |
| Model traffic | `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` point at AI Gateway. Provider keys live in the gateway (BYOK); the container holds only a short-lived gateway token. The gateway gives per-sprout token logs, caching, rate limits and a spend cap, which is how a bean card shows its cost. Workers AI sits behind the same gateway for captions and summaries only. |
| Auth modes | Two ways a sprout's model calls get paid for. (1) **API keys** held in AI Gateway (BYOK): the default for Claude (`claude-opus-5-5`, `claude-sonnet-5-5`) and OpenAI models. (2) **The sponsoring human's ChatGPT plan** via Sign in with ChatGPT (DevDay 2026-09-29): the user grants beanstalk the `chatgpt.tokens.use.direct` scope once (PKCE flow, dynamically registered client, `offline_access` refresh); beanstalk stores the token encrypted per user and a plan-proxy Worker attaches it to the sprout's Responses API calls, enforcing the rules (`store: false`, `stream: true`, no system-role items, no sampling params, no hosted tools like code interpreter or MCP connectors). A 429 `subscription_sharing_usage_limit_exceeded` pauses that user's sprouts and shows "plan capped" on the budget panel; the user raises the weekly per-app cap in ChatGPT settings. Side effect we want: every bean records which human's plan paid for it. **Eligibility caveat:** at launch plan usage is open to open-source and locally run projects; remotely hosted apps go through a waitlist. beanstalk is open source but the fleet is hosted, so apply to the waitlist now and demo with API keys if it is not granted by 2026-10-12. Anthropic has no equivalent; Claude subscription logins stay out of the fleet. Sources: https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt, https://workos.com/blog/sign-in-with-chatgpt-plan-usage-scope, https://thenewstack.io/sign-in-with-chatgpt/ |
| Task channel | The harness calls beanstalk's MCP tools (`status`, `handoff`, `submit_bean`) as it works; its stream-json events are forwarded to the project DO and become the agent session card and the sprite on the map. |
| Finish | On exit the Worker submits the bean with the handoff note, revokes the token, snapshots and stops the container. Supersession kills the container early. |
| Egress | Containers have Internet off by default under the Durable Object policy; allow only AI Gateway, Artifacts and the package registries the project declares. Prompt injection in repo text cannot reach anything else. |
| Limits | 1,500 vCPU per account, 1 to 3 s cold start, inactivity timeout at most 6 h, a DO alarm keeps long tasks alive, about $0.025 per 10 minutes at standard-3 plus tokens. Admission control caps active sandboxes per project. |

This is the workspace-container pattern an existing internal platform already runs (its sandbox package), so the lifecycle code exists. For the demo, the fleet supplies the six sprouts in beat two while your terminal sessions supply beat eight; the harness images are the same either way.

## Build order (cut from the bottom)

| Day | Build | Rubric |
|---|---|---|
| Oct 3-4 | Repo skeleton, LICENSE (MIT), wrangler config, Artifacts namespace, import the demo app (a small Hono + D1 Workers app we control), `fork` and token issuance, Project DO schema, MCP server with four tools, the Claude Code plugin (SessionStart claim + fork, Stop submit), the `claude-code` harness image behind AI Gateway; **verify `git push` from the Container image to Artifacts, a headless `claude -p` run through the gateway, and time a world composition** | Foundation; retires the three biggest risks |
| Oct 5-6 | Integrator: compose a world from trunk + N beans in a Container, run tests, push the world branch, fast-forward `main`; bisection on red; supersession at enqueue; budget counters | Originality, concurrency, review |
| Oct 7 | Conflict as an object: a bean that no longer applies is stored as a conflicted state with both sides and the intent; a resolver agent produces a new bean revision; the loser is kept as superseded with its evidence | Conflict handling |
| Oct 8 | Fork the agent: split a sprout mid-task with its context repo into two approaches; both become alternative worlds pinned to one decision | Context preservation |
| Oct 9 | Fixed views: swarm/overlap map (path-level overlap from `readTree`), world comparison, decision card with "what else lands with this" (world diff against trunk) and the why-trace from notes; Jev as view router | UX |
| Oct 10 | Workers Builds previews per world, screenshots; Claude Code joining over MCP; counters polished | Deployment decision, ease of use |
| Oct 11 | Seeded red bean and seeded conflict for the video; run the whole demo five times; record the resolver beat as a fallback clip | |
| Oct 12 | Record the seven-minute video; README with run instructions; submit | |
| Oct 13-14 | Buffer; deadline | |

Cut first if behind, in this order: fork-the-agent (keep the context repo as a slide), Browser Rendering screenshots, the Jev router (hard-code question → view), the Remote Control sessions on other machines (keep the local ones), session count (three instead of six). Never cut: composition and landing, the red-bean bisection, the conflict object.

Already cut from the thesis for the demo (roadmap only): independent challengers, tree-sitter symbol overlap, intent DAG planner, canary traffic, GitHub mirror and PR export, 100 live agents, the generated card canvas, GitHub Actions execution.

## The seven-minute script

1. **0:00 One screen.** Trunk of the demo app and six open intents. "GitHub would give you six PRs and a queue; watch what happens here instead."
2. **0:30 Six sprouts.** Six Claude Code sessions, three local terminals and three on other machines through Remote Control, each claim an intent over MCP and fork a sprout in seconds (Artifacts); the overlap map shows where each is working; the budget panel shows 6 active, 2 evidence jobs.
3. **1:15 One world from five beans.** Five beans arrive; the Integrator composes world 7 in a Container; receipts stream in; counters show minutes per world and batch size. Trunk fast-forwards. Five agents' work landed as one batch with one test run. (Criteria 1 and 2 are decided here.)
4. **2:30 The red bean.** A sixth bean breaks a test; bisection finds it in two rounds; the other beans land; the red bean goes back to its author with the receipt attached; the author's agent fixes it and it lands in the next world.
5. **3:30 Conflict as an object.** Two beans collide; click the conflicted world and see both sides and both intents; a resolver agent produces a third bean (pre-staged; recorded fallback ready); it lands; the loser stays visible as superseded with its evidence.
6. **4:30 Fork the agent.** One sprout is split with its context repo into "compatible migration" and "clean break"; both become alternative worlds pinned to a decision card that shows previews, the world diff against trunk, and how many batches have landed since. Click one; it is re-proven on the current trunk and lands; the other folds away, evidence kept.
7. **5:45 Why.** "Why does invoice tax round down?" One view, no model in the path: line → bean → intent → decision → the agent's note.
8. **6:20 Subagents.** One session spawns three subagents in worktrees; the plugin turns each worktree into a sprout; three beans from one session land together in the next world. Then Codex claims an intent over the same MCP server (recorded if live is too risky) to show the forge is harness-agnostic.
9. **6:50 Close.** The budget panel and the repo URL.

## Risks to retire in the first 48 hours

- **World composition time.** Shallow clone of trunk in a Container, apply five bean patches, run tests, push. If this is over 60 s per world the frontier is invisible on stage; measure on day two and shrink the demo app's test suite if needed.
- **Artifacts push from the Container image** (protocol v1 only; the docs' sandbox example contradicts the types, `claude-04` §11). Verify on day one.
- **Workers Builds previews for `world-<hash>` branches** of an Artifacts-connected repo: confirm the flow and the latency; if slow, show screenshots from a Sandbox port instead.
- **Resolver reliability.** An LLM resolving a conflict live is the second most likely failure; pre-stage the conflict, keep the recorded clip.
- **Fleet cost and rate limits.** Six to ten concurrent Claude Code sessions must run on API keys, not subscription logins; budget about a dollar per task on Sonnet 5.5; stagger session starts to avoid 429s. Intents stay small and testable (add an endpoint, a validation, a migration) so each session finishes in minutes.
- **Remote Control sessions stay on subscriptions.** Remote Control needs a Claude subscription and refuses a custom `ANTHROPIC_BASE_URL`, so the three sessions driven from other machines cannot go through AI Gateway and their bean cards cannot show cost (`claude-16`). Show cost on the local and container sessions only, and say so on stage. Checkpoint pushes (`refs/wip`) cost about $0.86 for demo day at a 15 s cadence; the cadence drops to per-turn when nobody is watching a sprout.
- **Eligibility**: US or Canada resident entrant; decide who submits (`claude-00`).
- **Jev terms**: TypeSafe's agreement forbids offering Jev as a standalone service; a routing call inside beanstalk is fine, the key stays in a secret, and the whole router is replaceable by a Workers AI model in an hour.

## What the README must contain for the "instructions to run" requirement

`wrangler` setup with the bindings (Artifacts, DO, Queues, Workflows, Containers, Workers AI, Browser Rendering), the one-command demo seed (`pnpm demo:seed` imports the app and creates intents) and the plugin install line that turns any Claude Code session into a worker, the MCP connection snippet for Claude Code and Codex, the budget defaults, and the known limitations list from `claude-05` and `claude-14`.
