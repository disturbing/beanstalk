# beanstalk-mcp

MCP tools for independently operated contributors working on one Beanstalk run
(`docs/claude-opus/06-auth-mcp-live-previews.md` §4). A Worker (`beanstalk-mcp`): Hono inside a
`WorkerEntrypoint`, stateless MCP over Streamable HTTP at `/mcp` through the Agents SDK's
`createMcpHandler` (`agents/mcp/server`, MCP SDK v2), not the deprecated `McpAgent`. Every read
goes to `beanstalk-gateway` over the `GATEWAY` service binding; the Ask pipeline is shared with
the web app through `@beanstalk/shared-ask`. No code mode and no `execute` tool: the owner
deferred code mode as highly experimental.

## Auth

Two paths (`docs/claude-opus/19-accounts-and-auth.md`):

- **People's agent sessions: OAuth 2.1** per the MCP authorization spec, with Cloudflare's
  `@cloudflare/workers-oauth-provider` (`src/oauth/`). Discovery at
  `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server`;
  `/oauth/register` (DCR), Client ID Metadata Documents, `/authorize` (sends the browser to the web
  app's `/connect` consent screen), `/oauth/token` (PKCE S256, refresh, revocation). Scopes
  `read` (required), `collaborate`, `write`. Grants and tokens live hashed in `OAUTH_KV`. A session
  works on any repository its person may use (the git rule, `mayUseEngine`): the read tools take
  `repo: "owner/name"` (without it they read `DEMO_RUN`, or the newest run), plus `whoami` and the
  repository tools below. A `bsu_` personal access token also works as the bearer; deploy tokens
  (`bsd_`) and repository-bound `bss_` git credentials do not. `claude mcp add --transport http
  beanstalk <url>/mcp`, then `claude mcp login beanstalk`.
- **Run tokens** (`bst1.…`, below) are routed before the OAuth provider and behave exactly as before.

RPC for the web app (`AgentSessionsRpc`): `consentRequest`, `approveConsent`, `denyConsent`,
`agentSessions`, `revokeAgentSession`. Bindings: `OAUTH_KV`, `IDENTITY_DB` (D1, schema in
`packages/shared-identity/migrations`), `PUBLIC_URL` (the issuer and resource origin).

### Run tokens

`Authorization: Bearer <view or contributor token>`. Both are minted by the gateway; this
Worker holds no token secret. It calls the gateway's `verifyMcpToken`. Update the gateway
before updating MCP: method detection on a Cloudflare RPC proxy does not establish
compatibility with an older deployment. The legacy view fallback supports injected clients.
Missing, forged or expired tokens get 401; slot and seed capabilities get 403. Every operation
stays within the token's run.

View tokens retain read-only access. Contributor tokens identify one owning bean and actor.
A contributor token also reads wherever a view token does (the gateway's reader routes accept both). The gateway verifies the contributor token again on every write and inbox call. Contributors
can update their own bean, post attributed messages on other beans and recover their own
bean's durable inbox. These capabilities do not grant Git or trunk access.

Mint one with the gateway's admin route `POST /v1/runs/:run/view-token` (valid for a week):

```bash
export BEANSTALK_TOKEN=$(pnpm -s -F @beanstalk/mcp mint-token <run> --gateway https://beanstalk-gateway.<sub>.workers.dev)
```

For contribution, an operator can mint a one-hour token for a specific bean and actor:

```bash
export BEANSTALK_TOKEN=$(pnpm -s -F @beanstalk/mcp mint-token <run> --bean <bean> --actor <actor> --gateway https://beanstalk-gateway.<sub>.workers.dev)
```

`--ttl-seconds` accepts 60 through 86400. The contributor grant route is
`POST /v1/runs/:run/contributor-token`; it requires the gateway admin token.

The script reads `ADMIN_TOKEN` from the environment or `packages/gateway/.dev.vars` and never
prints it. Without `--gateway` (or `BEANSTALK_GATEWAY_URL`) it calls a local `wrangler dev` gateway.

## Tools

Read tools have `readOnlyHint: true`; contributor mutations have `readOnlyHint: false`.
All have `destructiveHint: false` and `idempotentHint: true`; writes require an idempotency key
except inbox acknowledgements, which are inherently idempotent. Answers are compact JSON
with source revisions, cursors and handles (`beans/<task>`, `file:<path>@<sha>`, `preview_url`).

| Tool | Answer |
|---|---|
| `ask_repo(question, ref?)` | Ask's view: spec, resolved files, main-pane handle, beans, decisions, the `picks` that ordered it (route, files, sections; by Jev or the rules, as on the web's Plot), `preview_url` |
| `work_overlaps(paths)` | Beans in flight, on the sprout, or green in the last 15 min on those paths: title, intent, slot, status, files, overlap |
| `change_status(bean)` | Status, phase, slot, checks, reworks, card, recent steps, `next` |
| `checks_get(bean)` | Latest check's failures (file, test, `inherited`, `protected`), history, `blamed_by` |
| `run_status()` | Sprout and stalk heads, window (unvalidated / size, waiting), in flight, open cards, red validations, cost |
| `preview_link(bean \| ref)` | Explorer URL on `WEB_URL` (never carries the token) |
| `bean_context(bean, since?, limit?)` | Canonical intent, approach, exact promises, pinned reliance, paged history and bounded related context |
| `bean_update(bean, expected_revision, changes, idempotency_key)` | Update the owning bean with optimistic revision protection |
| `bean_thread_post(bean, kind, body, references, idempotency_key, thread?, reply_to?)` | Attributed discussion; responses point to the exact prior event and acceptance pins an exact promise revision |
| `bean_inbox_read(after_cursor?, limit?, state?)` | Durable event page, unread count and freshness; use `state: "unread"` for pending events |
| `bean_inbox_ack(event_ids)` | Delivery acknowledgement; never implicit acceptance |

**Repository tools** (agent sessions only; `src/repos/`, gateway RPC `AgentReposRpc`;
`docs/claude-opus/22-mcp-repository-tools.md`):

| Tool | Scope | Answer |
|---|---|---|
| `repo_list()` | read | Repositories you own or collaborate on: role, access (`write`/`read`), visibility, clone URL |
| `repo_status(repo)` | read | Stalk and sprout heads, window, beans in flight and sent back (who, phase), recent reds, open cards |
| `bean_open(repo, bean, intent, task?)` | write | Reserves `bean/<name>` for a day with its intent (claims `task`); branch, `start` and `push` commands, sprout head |
| `bean_status(repo, bean)` | read | Phase, the pushed bean (actor, intent, verdict), rework (failing tests, collided beans with intent and files), journey, `next` |
| `bean_wait(repo, bean, until?, timeout_s?)` | read | Holds until the check ends (or the stalk), at most 1,800 s; as `bean_status` plus `waited_s`, `timed_out` |
| `task_list(repo)` | read | The backlog file on the sprout with each task's state |
| `task_claim(repo, task)` | write | Claims for two hours; refused with who holds it |
| `task_release(repo, task)` | write | Drops your claim and the names you reserved for the task; refused for someone else's claim |
| `git_credentials(repo, ttl_minutes?)` | read (+write to push) | A `bss_` token bound to that repository, at most an hour, as `git credential approve` input |

`bean_context`, `bean_update` and `bean_thread_post` accept `t032` or `beans/t032`; `change_status`,
`checks_get` and `preview_link` accept both as well. Your own bean id is the `inbox.bean` field of any
contributor read. Acceptance raises your bean's revision without a `bean.updated` event, so re-read
`bean_context` before your next `bean_update` (a stale `expected_revision` gets 409).
Idempotency is keyed by (bean, key): a replacement harness resending a key replays the first result.

The last four tools require contributor access. `bean_context` is available to view callers
on the current gateway. Partial injected clients can retain the original six tools.
Contributor context, Ask, overlap and status responses include a bounded inbox reminder;
reading it does not acknowledge events. Recover with explicit inbox reads, continue using
`next_cursor` and acknowledge events after handling them.

Related context uses canonical approach/promise discovery plus observed Git paths and exact
references. It reads at most 16 peers in one excerpt-only `beanPeerSummaries` gateway call (no history, so
text beyond 500 characters does not influence ranking) and shows at most eight related summaries; a whole
`bean_context` makes about three collaboration reads of the run (context, discovery, summaries). Required
references outrank lexical matches. Source failures, path/query limits, skipped beans and
missing references are disclosed with expansion handles; fetch those beans individually.

Contributors choose their work and responses. An offered promise or accepted request records
agreement, with exact revisions; it remains separate from implementation and check evidence.

## Commands

```bash
pnpm -F @beanstalk/mcp dev        # wrangler dev (needs beanstalk-gateway running for GATEWAY)
pnpm -F @beanstalk/mcp test       # Miniflare: recorded fixtures and real gateway integration
pnpm -F @beanstalk/mcp types      # regenerate worker-configuration.d.ts
pnpm -F @beanstalk/mcp deploy     # deploy after beanstalk-gateway
pnpm -F @beanstalk/mcp mint-token <run> [--gateway <url>] [--bean <bean> --actor <actor>]
```

Tests (`test/mcp.test.ts`) run the Worker app with a fake `GATEWAY` (`test/fake-gateway.ts`)
answering the gateway RPC from the web app's recorded v2.5 run (`packages/web/fixtures/j6boaclinn`),
and talk to it with the MCP SDK's client.

`test/gateway-integration.test.ts` also exercises the actual gateway over a service binding
with SQLite RunDO storage: contributor updates, requests, discovery, inbox recovery and
acknowledgement, and capability boundaries. Artifacts and the Docker runner use the gateway's
existing external-service fixtures. Remote AI is removed only from the local test config.

## Claude Code plugin

`packages/claude-plugin` wires this server into Claude Code with the `beanstalk` skill:

```bash
export BEANSTALK_TOKEN=...                     # a view or contributor token for the run
export BEANSTALK_MCP_URL=https://...workers.dev/mcp   # optional; defaults to the deployed URL
claude --plugin-dir packages/claude-plugin
```
