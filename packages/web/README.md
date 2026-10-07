# @beanstalk/web

beanstalk's human-facing app: the **repository home** (Nightshift: the stalk and a generated explorer with Ask, `docs/claude-opus/14` §10–11), the **Files** explorer, the **Engine** (the race canvas, for developers), and the **side-by-side race**. It is a vinext app (Next.js App Router on Vite) deployed as the Worker `beanstalk-web`. Every number it shows comes from the gateway over RPC, or from the recorded runs bundled with it.

Names, as everywhere in beanstalk: a **bean** is one agent's change; the **sprout** is the staged line (beans that passed their pre-land check; events call it `trunk`); the **stalk** is the stable line (validated; events call it `green`).

## Views

| Route | What it shows |
|---|---|
| `/` | Runs: the recorded race (merge queue against v2.5) as a chart, recorded and live runs |
| `/runs/:run` | **The repository home**: the compressed stalk (beans at the tip, sprout and stalk leaves, the culprit red, fallen beans faint) beside a generated explorer: Ask (completions on focus or ⌘K), then Growing now, What happened and Files, or the components a question needs (bean journey + diff, decision and red-validation cards, overlaps and session activity). A status line, day/night and three day modes. Recorded runs replay; live runs follow the gateway |
| `/runs/:run/files` | The Files explorer: file tree, main pane (diff, file with blame by bean, bean), context rail and its own Ask bar |
| `/runs/:run/race` | The engine (developer view): counters, the sprout and the stalk as a vine, agent lanes, the code map, decision cards, the event feed. Recorded runs replay (1x, 10x, 60x, scrubbing); live runs follow the gateway |
| `/race` | Watch the race: the recorded merge queue and v2.5 runs replayed in sync, with counters (the 35th green, done in) and greens over time |
| `/signup`, `/login` | Accounts: a handle and a passkey (email links once a sender domain is set), and below sign-in the demo gate for decisions (`DEMO_PASSWORD`). `docs/claude-opus/19-accounts-and-auth.md` |
| `/connect` | OAuth consent for an agent (from `beanstalk-mcp`'s `/authorize`) |
| `/settings`, `/settings/tokens` | Profile, passkeys, connected agents (disconnect), sign out everywhere; personal access tokens (create once-shown, list, revoke) |
| `/api/runs/:run/live` | A live run's events as Server-Sent Events (bridged from the gateway's WebSocket) |
| `/api/runs/:run/beans/:bean/diff` | A bean's own diff, for decision cards |

URL state, so every view can be shared:

- the home: `q`, `x` (as below), `bean`, `step` (a journey step) and `t` (the race second of the playhead);
- Files explorer: `q` (the question), `x` (removed chips, repeated: `feature`, `range`, `agent`, `bean`, `path:<p>`, `file:<p>`), `ref` (`sprout` or `stalk`), `file`, `bean`, `view=diff`, and for a recorded run `at` (the race second to look at);
- race canvas and `/race`: `t` (race second) and `speed` (`1`, `10`, `60`).

Keyboard: `/` focuses Ask from anywhere. In a replay, Space plays or pauses, the arrow keys step ten seconds (Shift: a minute), `1`/`2`/`3` pick the speed. The greens chart takes focus and moves its crosshair with the arrows; every chart has a table twin.

## How it works

```
                     ┌──────────────── ForgeSource (src/forge/forge-source.ts) ────────────────┐
 pages (app/) ──────▶│ gatewaySource: RPC over the GATEWAY binding  │ recordedSource: fixtures/   │
                     └──────────────────────────────────────────────┴─────────────────────────────┘
 events ─▶ reduceRace (src/race) ─▶ counters, lanes, line, cards ─▶ canvas (client) and explorer
 question ─▶ Classifier (keywords | Workers AI) ─▶ ViewSpec ─▶ resolveFiles ─▶ planAnswer ─▶ explorer
```

- **One adapter interface, two implementations.** `ForgeSource` has the gateway's RPC names (`listRuns`, `runEvents`, `repoTree`, `repoFile`, `repoDiff`, `repoLog`, `repoGrep`, `beansByPath`, `beanDetail`, `decisions`, `testsFor`, `decide`). `gatewaySource` calls the `GATEWAY` service binding (types in `@beanstalk/shared-race/rpc`) and validates every answer with Zod. `recordedSource` answers from the bundled runs and can be pinned to a race second (`asOf`), which is how the explorer travels through a recorded race.
- **The reducer** (`src/race/reduce-race.ts`) is a pure function from events to the canvas state: beans and their phases, agent lanes with the harness's busy, blocked and idle clocks (and their segments for the swimlanes), the sprout and stalk commits, CI runs, decision cards, queue batches and repair tickets. Replays reduce the events up to the playhead; live runs reduce as events arrive.
- **Ask** (`src/ask/`, `docs/claude-opus/13`) turns a question into a view spec, never a layout: a class from a fixed catalog (`view-spec.ts`), entities (a feature, paths, a bean, an agent, a time range, a line) shown as removable chips, files resolved by name, content grep, bean intents and covering tests (`resolve-files.ts`), then a fixed arrangement per class (`plan-answer.ts`). The classifier is an adapter: the deterministic keyword router is the default; a Workers AI model can replace it (below), and anything it answers that does not fit the catalog falls back to the router. The spec is shown under "View spec", as agents would get it over MCP.
- **Live updates.** vinext cannot hold a WebSocket upgrade on its own routes, so `/api/runs/:run/live` asks the gateway for a view token (`viewToken`), opens the gateway's WebSocket feed through the binding's `fetch`, catches up with `runEvents`, and streams Server-Sent Events. The browser's `EventSource` reconnects by itself and resumes after the last event id.
- **Decisions** are the one write. The gateway does not authenticate RPC (the binding is the trust boundary), so the web app requires a session: the login form checks `DEMO_PASSWORD` (constant-time) and sets an HttpOnly cookie signed with an HMAC keyed by the password. Reading is open. Recorded runs show the decision the race made.
- **Times** are the run clock: seconds since the run was created, as `research/race/kth_green.py` measures the k-th green. "Done in" is `summary.json`'s `wall_seconds` (race start to race end), so a finished race reads 17.5 min while its last bead sits at 17:43 on the clock.

## Recorded runs (fixtures)

`fixtures/<run>/` holds the Cloudflare race the demo narrates (`docs/claude-opus/12`, 12 Sonnet agents, seed 7): `j6boaclinn` (Beanstalk v2.5 with dependency-aware starts, `cf-v25dep2-sonnet-12-s7`: 39 green, 35th green 17.1 min, done 31.6 min) and `u0ntf65lbe` (the queue, `cf-queue-sonnet-12-s7-landed`: 36 green, 35th green 35.0 min, done 40.6 min). They are built from git, never by hand:

```bash
pnpm -F @beanstalk/web fixtures      # node scripts/build-fixtures.mjs
```

The script reads `research/race/runs/<run>/` (events, summary, the agents' worktrees under `work/`, which git ignores: in a fresh worktree, symlink them and `research/corpora/arena.git` from the checkout that ran the race) and `research/arena/tasks`, then writes `events.jsonl` (slimmed to the fields the app reads, no local paths), `summary.json` (without account details), `tasks.json` (titles, intents, tests) and `repo.json` (the base, every line commit and bean head, their trees and file contents). The one landing per run that no worktree fetched is rebuilt the way the runner squashes (`git merge-tree --merge-base`, a commit by `beanstalk-runner`) and must hash to the recorded sha, or the build fails; both runs reproduce their final commit exactly. Every file is scanned before it is written, for secrets, local paths (`/Users/…`, `/home/…`, temp directories), Cloudflare account ids and `workers.dev` addresses; a match fails the build.

The v2.5 events the app shows beyond v2's: start cards (`decision.request` with `trigger: start`, raised before the arriving bean begins), `decision.reconcile` (the test author compares specs before a card), `rescue.start`, `culprit.dynamic` (leave-one-out culprit search), `window.wait` and `window.resize` (the sprout window), structural landings (`land.resolved`), and, from newer engines, `tests.first` and `sync.*`. Each becomes a step of its bean's journey and, where a reader would care, a feed line. The test author and the reconciler borrow an agent slot for one call without holding the bean, and the v2.5 run frees agents at the pre-land check (`release_on_check`), so the recorded run carries that option for the lane clocks.

## Run it locally

```bash
pnpm install
cp packages/web/.dev.vars.example packages/web/.dev.vars    # set DEMO_PASSWORD to try the decision gate
pnpm -F @beanstalk/web dev                                  # http://localhost:5173
```

The recorded runs, the explorer, the canvas replays and `/race` work offline. Live runs need the gateway: run `pnpm -F @beanstalk/gateway dev` in another terminal and the `GATEWAY` binding finds it through Wrangler's dev registry (without it, the runs page says the gateway did not answer). `pnpm -F @beanstalk/web types` regenerates `worker-configuration.d.ts` after a `wrangler.jsonc` change.

```bash
pnpm -F @beanstalk/web test          # vitest: the reducer, Ask, the adapters, the code map, the feed, the gate
pnpm -F @beanstalk/web build         # vite build into dist/ (the Worker and its assets)
pnpm -F @beanstalk/web preview       # build, then run the built Worker with wrangler dev
```

The tests check the reducer against both runs' `summary.json` (landed, green, dropped and why, cost, red validations, decision cards, conflicts, invocations, CI runs, every bean's start, landing and green times, task-to-green percentiles, lane clocks within a second) and the k-th green times of `research/race/kth_green.py` (Beanstalk 7.7, 15.7 and 17.1 min to the 20th, 30th and 35th green; the queue 13.0, 19.9 and 35.0); the keyword router on the catalog; the entity resolver and the planner on the recorded v2.5 run; and the gateway adapter against a fake binding.

## Deploy

Wrangler deploys it (not the `cf` CLI), after the gateway it binds to:

```bash
pnpm -F @beanstalk/gateway deploy                     # beanstalk-gateway, with its RPC entrypoint
cd packages/web && npx wrangler secret put DEMO_PASSWORD
pnpm -F @beanstalk/web deploy                         # vite build && wrangler deploy --config dist/server/wrangler.json
```

`wrangler.jsonc` binds `GATEWAY` to the `beanstalk-gateway` service (its default entrypoint, whose methods are `GatewayRpc` in `@beanstalk/shared-race/rpc`) and requires the `DEMO_PASSWORD` secret. Observability and traces are on.

**Picks (Jev).** What the home shows is ordered by a picker (`@beanstalk/shared-ask/pick`): the headline, the suggested questions, an answer's route, files and sections. `PICKER` is `"jev"` (TypeSafe's Jev, the Workers AI model `typesafe/jev`, called through the `AI` binding with the AI Gateway named in `JEV_GATEWAY`, `default` unless set; billed to the account, no API key) or `"rules"`. Each decision has a deterministic rule that answers when Jev is off, slow (over 1.5 s) or answers outside the candidates, and every pick leaves a receipt the page shows. The `AI` binding is `remote`, so `pnpm -F @beanstalk/web dev` calls Workers AI too (it needs `wrangler login`; with several accounts set `CLOUDFLARE_ACCOUNT_ID`).

To route Ask through Workers AI instead of the keyword router, set `ASK_CLASSIFIER` to `"workers-ai"` (the model is `ASK_AI_MODEL`), and run `pnpm -F @beanstalk/web types`. It stays off by default: the router needs no network.

## Layout

```
app/                     routes (thin): pages, the live SSE route, the bean diff route
components/shell/        header, theme toggle, login styles
components/home/         the repository home: header, stalk, Ask, explorer components, bean journey, receipts
components/explorer/     Files explorer: Ask bar, answer chips, file tree, diff, file and bean views, rail
components/canvas/       race canvas: counters, vine, lanes, code map, decisions, feed, replay bar
components/race/         greens-over-time chart and the side-by-side race
src/race/                events (Zod), the reducer, counters, feed, code map, moments, formats
src/ask/                 view spec catalog, classifiers, question words, resolver, planner
src/forge/               the ForgeSource interface, the gateway and recorded sources
src/recorded/            the bundled runs and their repo snapshots
src/repo/                diffs, imports, paths
src/live/                the WebSocket-to-SSE bridge
src/auth/, src/server/   the demo gate, server actions, request helpers
scripts/                 build-fixtures.mjs
fixtures/                generated recorded runs
```
