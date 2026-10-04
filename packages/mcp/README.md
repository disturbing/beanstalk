# beanstalk-mcp

Read-only MCP tools for coding agents working on one Beanstalk run
(`docs/claude-opus/06-auth-mcp-live-previews.md` §4). A Worker (`beanstalk-mcp`): Hono inside a
`WorkerEntrypoint`, stateless MCP over Streamable HTTP at `/mcp` through the Agents SDK's
`createMcpHandler` (`agents/mcp/server`, MCP SDK v2), not the deprecated `McpAgent`. Every read
goes to `beanstalk-gateway` over the `GATEWAY` service binding; the Ask pipeline is shared with
the web app through `@beanstalk/shared-ask`. No code mode and no `execute` tool: the owner
deferred code mode as highly experimental.

## Auth

`Authorization: Bearer <view token>`. A view token is run-scoped and minted by the gateway. This
Worker holds no secret: it asks the gateway (`verifyViewToken` RPC). A missing, forged or expired
token gets 401, a slot or seed token 403. Every tool reads only the token's run.

Mint one with the gateway's admin route `POST /v1/runs/:run/view-token` (valid for a week):

```bash
export BEANSTALK_TOKEN=$(pnpm -s -F @beanstalk/mcp mint-token <run> --gateway https://beanstalk-gateway.<sub>.workers.dev)
```

The script reads `ADMIN_TOKEN` from the environment or `packages/gateway/.dev.vars` and never
prints it. Without `--gateway` (or `BEANSTALK_GATEWAY_URL`) it calls a local `wrangler dev` gateway.

## Tools

All annotated `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`. Answers are
compact JSON with a `summary` and handles (`beans/<task>`, `file:<path>@<sha>`, `preview_url`).

| Tool | Answer |
|---|---|
| `ask_repo(question, ref?)` | Ask's view: spec, resolved files, main-pane handle, beans, decisions, the `picks` that ordered it (route, files, sections; by Jev or the rules, as on the web's Plot), `preview_url` |
| `work_overlaps(paths)` | Beans in flight, on the sprout, or green in the last 15 min on those paths: title, intent, slot, status, files, overlap |
| `change_status(bean)` | Status, phase, slot, checks, reworks, card, recent steps, `next` |
| `checks_get(bean)` | Latest check's failures (file, test, `inherited`, `protected`), history, `blamed_by` |
| `run_status()` | Sprout and stalk heads, window (unvalidated / size, waiting), in flight, open cards, red validations, cost |
| `preview_link(bean \| ref)` | Explorer URL on `WEB_URL` (never carries the token) |

## Commands

```bash
pnpm -F @beanstalk/mcp dev        # wrangler dev (needs beanstalk-gateway running for GATEWAY)
pnpm -F @beanstalk/mcp test       # vitest on Miniflare, fake gateway from a recorded run
pnpm -F @beanstalk/mcp types      # regenerate worker-configuration.d.ts
pnpm -F @beanstalk/mcp deploy     # deploy after beanstalk-gateway
pnpm -F @beanstalk/mcp mint-token <run> [--gateway <url>]
```

Tests (`test/mcp.test.ts`) run the Worker app with a fake `GATEWAY` (`test/fake-gateway.ts`)
answering the gateway RPC from the web app's recorded v2 run (`packages/web/fixtures/7z4j84eqvl`),
and talk to it with the MCP SDK's client.

## Claude Code plugin

`packages/claude-plugin` wires this server into Claude Code with the `beanstalk` skill:

```bash
export BEANSTALK_TOKEN=...                     # a view token for the run
export BEANSTALK_MCP_URL=https://...workers.dev/mcp   # optional; defaults to the deployed URL
claude --plugin-dir packages/claude-plugin
```
