# Race tools

Scripts the race and the demo use; production code and its tests import none of them. Run them from the repo root with Node 24.

| Script | What it does |
|---|---|
| `build-fixtures.mjs` | Rebuilds the web app's recorded-run fixtures (`packages/web/fixtures/<run>/`) from the race runs in `research/race/runs/`. The output stays in `packages/web` because the app bundles it; `packages/web/README.md` ("Recorded runs") describes the inputs and the checks. |
| `mint-token.mjs` | Mints a run-scoped view or contributor token for an MCP client through the gateway's admin route (`POST /v1/runs/:run/view-token`, `.../contributor-token`). The admin token comes from `ADMIN_TOKEN` or `packages/gateway/.dev.vars` and is never printed. |

```bash
node research/race/tools/build-fixtures.mjs
node research/race/tools/mint-token.mjs <run> [--gateway <url>] [--bean <bean> --actor <actor> [--ttl-seconds <s>]]
```
