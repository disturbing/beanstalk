> Research memo produced 2026-10-03 by a Claude research subagent (web search + Exa + direct fetches) for the beanstalk brainstorm. Claims carry their source URLs; items marked UNVERIFIED were not confirmed. Edited lightly by the coordinating session.

# Cloudflare Artifacts and adjacent primitives: technical reference for beanstalk

Compiled 2026-10-03 from the full `developers.cloudflare.com/artifacts/` tree (every page in `llms.txt`), the two launch blog posts, `@cloudflare/workers-types@5.20261002.1` (the generated binding types), `cloudflare/artifact-fs`, `cloudflare/ci` and the docs for each adjacent product. Anything not backed by one of those sources is marked UNVERIFIED.

Competition facts (https://blog.cloudflare.com/next-git-platform-on-cloudflare/): submissions close **2026-10-14**; deliver a 5-10 minute video, source under MIT/Apache/BSD, and run instructions; minimum bar is "multiple agents working on changes concurrently"; built on Workers + Artifacts. First place: $25k credits + VIP dinner; top 3 fly to Cloudflare Connect.

## 1. What Artifacts is

A Git-compatible versioned filesystem where every repo is one Durable Object (DO) with SQLite storage, a Zig git server compiled to a ~100 KB Wasm module, R2 snapshots and KV for token tracking (https://blog.cloudflare.com/artifacts-git-for-agents-beta/). Open beta since 2026-10-01 for **Workers Paid only**; the docs say billing starts **2026-10-14** (https://developers.cloudflare.com/artifacts/platform/pricing/) while the Oct 1 blog says Oct 15 (discrepancy; assume the 14th). Three surfaces hit the same repo: Workers binding (control plane), REST (control plane), smart-HTTP Git (data plane) (https://developers.cloudflare.com/artifacts/concepts/repositories/). Data is replicated synchronously across data centers and asynchronously to object storage (https://developers.cloudflare.com/artifacts/concepts/how-artifacts-works/).

## 2. Workers binding API (exact types)

Config: `"artifacts": [{ "binding": "ARTIFACTS", "namespace": "default" }]`; one binding = one namespace. Requires Wrangler >= 4.145.0 for types and for Blob-returning methods under `remote = true` local dev (https://developers.cloudflare.com/artifacts/api/workers-binding/). Types below are verbatim from `workers-types` 5.20261002.1 (docs say the generated `worker-configuration.d.ts` is the source of truth).

```ts
interface Artifacts {
  create(name: string, opts?: { readOnly?: boolean; description?: string; setDefaultBranch?: string })
    : Promise<ArtifactsCreateRepoResult>;          // INVALID_REPO_NAME | ALREADY_EXISTS
  get(name: string): Promise<ArtifactsRepo>;      // NOT_FOUND | CREATE_IN_PROGRESS | IMPORT_IN_PROGRESS | FORK_IN_PROGRESS
  import(params: { source: { url: string; branch?: string; depth?: number };
                   target: { name: string; opts?: { description?: string; readOnly?: boolean } } })
    : Promise<ArtifactsCreateRepoResult>;          // INVALID_URL | REMOTE_AUTH_REQUIRED | UPSTREAM_UNAVAILABLE | MEMORY_LIMIT ...
  list(opts?: { limit?: number /* 1-200, default 50 */; cursor?: string }): Promise<ArtifactsRepoListResult>;
  delete(name: string): Promise<boolean>;         // true deleted, false not found; also deletes tokens
}

interface ArtifactsRepo extends Disposable {      // use `using repo = await env.ARTIFACTS.get(name)`
  info(): Promise<ArtifactsRepoInfo>;             // fresh lookup every call; metadata is NOT a property
  createToken(scope?: "write" | "read" /* default write */, ttl?: number /* s, default 86400, 60..31536000 */)
    : Promise<ArtifactsCreateTokenResult>;
  listTokens(): Promise<ArtifactsTokenListResult>;
  revokeToken(tokenOrId: string): Promise<boolean>;
  fork(name: string, opts?: { description?: string; readOnly?: boolean; defaultBranchOnly?: boolean /* default true */ })
    : Promise<ArtifactsCreateRepoResult>;          // ALREADY_EXISTS | FORK_IN_PROGRESS
  log(opts?: { ref?: string /* HEAD */; limit?: number /* 50, cap 1000 */; offset?: number })
    : Promise<ArtifactsCommitMetadata[]>;          // first-parent chain, newest first, [] if ref unresolvable
  readCommit(hash: string): Promise<ArtifactsCommitMetadata | null>;
  readTree(hash: string): Promise<ArtifactsTreeEntry[] | null>;   // immediate children only
  readBlob(hash: string): Promise<Blob | null>;                   // untyped Blob; MEMORY_LIMIT possible
  readFile(args: { ref: string; path: string }): Promise<Blob | null>; // MIME-typed; null for dir/missing
}

interface ArtifactsCreateRepoResult { id: string; name: string; description: string | null;
  defaultBranch: string; remote: string; token: string /* art_v1_<40hex>?expires=<unix> */ }
interface ArtifactsRepoInfo { id; name; description: string | null; defaultBranch; createdAt; updatedAt;
  lastPushAt: string | null; source: string | null /* "github:owner/repo" | "artifacts:ns/repo" */; readOnly: boolean; remote: string }
interface ArtifactsRepoListResult { repos: Omit<ArtifactsRepoInfo, "remote">[]; total: number; cursor?: string }
interface ArtifactsCreateTokenResult { id: string; plaintext: string; scope: "read"|"write"; expiresAt: string }
interface ArtifactsTokenInfo { id; scope; state: "active"|"expired"|"revoked"; createdAt; expiresAt }
type ArtifactsTreeEntryType = "tree" | "blob" | "symlink" | "gitlink" | "exec";
interface ArtifactsTreeEntry { name: string; mode: string /* "100644", "40000" */; hash: string; type: ArtifactsTreeEntryType }
interface ArtifactsCommitMetadata { hash; treeHash; message; author: {name; email}; committer: {name; email};
  parents: string[]; authoredAt: number /* unix s */; committedAt: number }
interface ArtifactsError extends Error { name: "ArtifactsError"; code: ArtifactsErrorCode; numericCode: number }
```

Numeric codes (https://developers.cloudflare.com/artifacts/api/errors/): NOT_FOUND 10200, ALREADY_EXISTS 10201, IMPORT_IN_PROGRESS 10302, FORK_IN_PROGRESS 10303, INVALID_INPUT 10100, INVALID_REPO_NAME 10101, INVALID_TTL 10103, INVALID_URL 10104, REMOTE_AUTH_REQUIRED 10106, UPSTREAM_UNAVAILABLE 10401, MEMORY_LIMIT 10402, INTERNAL_ERROR 10400.

What the binding cannot do: list refs/branches/tags, resolve a ref to a hash (only via `log({ref, limit:1})`), diff, write files, create commits, delete branches, create namespaces, or subscribe to events. Writes from a Worker go through `isomorphic-git` + in-memory FS pushing to the remote (https://developers.cloudflare.com/artifacts/examples/isomorphic-git/). Note the Sandbox example page reads `repo.defaultBranch`/`repo.remote` off a `get()` handle (https://developers.cloudflare.com/artifacts/examples/sandbox-sdk-artifacts/); the binding reference and the types contradict this, so treat that example as stale and call `info()`.

## 3. REST API

Base `https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/artifacts`, `Authorization: Bearer <CF API token>` with **Artifacts > Read / Edit** permissions; v4 envelope; cursor pagination (`cursor`, `per_page`, `count`) for repos/namespaces, offset (`page`, `per_page`, `total_pages`, `total_count`) for tokens (https://developers.cloudflare.com/artifacts/api/rest-api/).

| Route | Notes |
| --- | --- |
| `POST /namespaces` `{namespace, jurisdiction?: "eu"\|"us"}` | Only way to set jurisdiction; immutable after create |
| `GET /namespaces?limit&cursor`, `GET /namespaces/:ns` | |
| `POST /namespaces/:ns/repos` `{name, description?, default_branch?, read_only?}` | returns `remote` + `token` |
| `GET /namespaces/:ns/repos?limit(<=200)&cursor&search&sort(created_at\|updated_at\|last_push_at\|name)&direction` | `search` is the only search API (repo names) |
| `GET/DELETE /namespaces/:ns/repos/:name` | DELETE returns 202 (async) |
| `POST .../repos/:name/fork` `{name, description?, read_only?, default_branch_only?}` | result adds `objects: number` |
| `POST .../repos/:name/import` `{url, branch?, depth?, read_only?}` | public HTTPS only; 409 while importing |
| `GET .../log?ref&limit&offset`, `.../commit/:hash`, `.../tree/:hash`, `.../blob/:hash` | blob returns raw bytes |
| `GET .../file?ref&path` (octet-stream), `GET .../raw/:ref/:path` (sniffed Content-Type) | |
| `GET .../repos/:name/tokens?state(active\|expired\|revoked\|all)&per_page(<=100)&page` | |
| `POST /namespaces/:ns/tokens` `{repo, scope?, ttl?}` -> `{id, plaintext, scope, expires_at}` | |
| `DELETE /namespaces/:ns/tokens/:id` | |

Without a git client you can manage repos/tokens and read history, trees, blobs and files; you cannot write. Wrangler mirrors a subset: `wrangler artifacts namespaces list|get`, `repos create|list|get|delete`, `repos issue-token` (https://developers.cloudflare.com/artifacts/api/wrangler/). The dashboard (Storage & databases > Artifacts) can view, create, fork, search repos and mint tokens (https://developers.cloudflare.com/artifacts/platform/changelog/).

## 4. Git protocol

Remote: `https://<ACCOUNT_ID>.artifacts.cloudflare.net/git/<namespace>/<repo>.git` (https://developers.cloudflare.com/artifacts/api/git-protocol/). Auth: `git -c http.extraHeader="Authorization: Bearer $TOKEN"` (full token string) or Basic auth `https://x:<secret>@host/...` where secret = token with `?expires=` stripped and username ignored. Tokens: `art_v1_<40 hex>?expires=<unix_seconds>`, repo-scoped, `read` (clone/fetch/pull) or `write` (+push), TTL 60 s to 1 year, default 24 h.

| Operation | Support |
| --- | --- |
| Clone/fetch (`git-upload-pack`) | v1 and v2; v2 `ls-refs` + `fetch`; shallow/deepen (`deepen`, `deepen-since`, `deepen-relative`); have/want incremental |
| Push (`git-receive-pack`) | **v1 only**; v2 receive-pack not supported |
| v1 `filter` (partial/blobless clone), `include-tag` | **not supported** on v1; v2 unspecified -- UNVERIFIED whether `--filter=blob:none` works against Artifacts (ArtifactFS needs the remote to advertise filtering or it hydrates eagerly, https://github.com/cloudflare/artifact-fs) |
| git-notes | Supported as ordinary refs; docs recommend `refs/notes/*` for prompts/model output (https://developers.cloudflare.com/artifacts/concepts/best-practices/) |
| LFS | Blog says the server was built to be "extensible (notes, LFS)"; no docs -- UNVERIFIED, assume absent |
| Server hooks / pre-receive / push options / branch protection | None documented; only guard is the repo-level `readOnly` flag |
| Max sizes | 32 MB per blob, 1 GB per repo (https://developers.cloudflare.com/artifacts/platform/limits/); MEMORY_LIMIT error for oversized objects |

`readOnly: true` forks are the documented pattern for review copies (https://blog.cloudflare.com/artifacts-git-for-agents-beta/).

## 5. Events

Artifacts publishes through Queues event subscriptions (https://developers.cloudflare.com/artifacts/guides/event-subscriptions/, https://developers.cloudflare.com/queues/event-subscriptions/). Two sources:

- `artifacts` (account-level, any repo): `cf.artifacts.repo.created`, `.deleted`, `.forked`, `.imported`. Payload = repo metadata (`repoId`, `defaultBranch`, `description`, `readOnly`, `createdAt`, `updatedAt`, `lastPushAt`); forked adds target `namespace`/`repoName`; imported adds `sourceUrl`, `branch`.
- `artifacts.repo` (requires `namespace` + `repo_name` on the subscription): `cf.artifacts.repo.pushed`, `.cloned`, `.fetched` (empty payload), `.token.created` (`tokenId`, `scope`, `expiresAt`), `.token.revoked`.

```json
{ "type": "cf.artifacts.repo.pushed",
  "source": { "type": "artifacts.repo", "namespace": "my-namespace", "repoName": "my-repo" },
  "payload": { "ref": "refs/heads/main", "before": "<sha>", "after": "<sha>",
    "commits": [{ "id", "message", "messageTruncated": false, "timestamp",
      "author": {"name","email"}, "committer": {"name","email"}, "parents": ["<sha>"] }],
    "totalCommitsCount": 1, "commitsTruncated": false },
  "metadata": { "accountId", "eventSubscriptionId", "eventSchemaVersion": 1, "eventTimestamp" } }
```

Create with `npx wrangler queues subscription create <queue> --source artifacts.repo --events pushed --namespace ... --repo_name ...` (https://developers.cloudflare.com/queues/event-subscriptions/manage-event-subscriptions/). Whether a queue subscription can cover a whole namespace is UNVERIFIED (the guide shows per-repo). The namespace-wide path that is documented is a **Workflow event trigger** in Wrangler config (https://developers.cloudflare.com/artifacts/guides/build-and-deploy-on-push/):

```jsonc
"triggers": { "events": [{ "type": "cf.artifacts.repo.pushed",
  "filter": { "namespace": "CI", "repoName": "my-repo" },   // omit repoName => every repo in namespace
  "target": { "scriptName": "<worker>", "workflowName": "<wf>" /* , "dispatch_namespace": "<ns>" */ } }] }
```

Each push starts one Workflow instance. `@cloudflare/ci` 0.2.0 (https://github.com/cloudflare/ci) gives `class CI extends CIWorkflow { pipeline(event, step, ci) }` with `ci.runner({ name, command, cache: { inputs: ["package.json","bun.lock"] } })` returning a result whose `.runner()` chains from a sandbox snapshot, plus `cloudflareCredentials`; needs `nodejs_compat`, a container DO (`instance_type` e.g. `standard-4`), an R2 `BACKUP_BUCKET`, the Artifacts binding and a Workflow binding. Default step config: 2 retries, 12 min step timeout, 11 min command timeout, 300 KB inline logs (Workflows 1 MiB step-result cap) (https://github.com/cloudflare/ci/blob/22ac61d0/src/pipeline/ci-workflow.ts). No branch-deleted or ref-deleted event is documented (UNVERIFIED whether a delete push arrives as `after: 0000...`).

## 6. Workers Builds and Previews

Connect a repo under Workers & Pages > Create > Continue with Artifacts; requires Artifacts Read+Edit on the account role; **only `main` can be the production branch** (https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/artifacts-integration/). Production pushes run build + `npx wrangler deploy`; after enabling "Builds for Preview branches", other branches run `npx wrangler preview` and get a Preview URL. Build limits (paid): 6,000 min/month then $0.005/min, 6 concurrent, 20 min timeout, 4 vCPU / 8 GB / 20 GB (https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/).

Previews (https://developers.cloudflare.com/workers/previews/): Wrangler >= 4.135.0; URLs `<preview-name>-<worker-name>.<subdomain>.workers.dev` (latest) and `<deployment-id>-<worker-name>.<subdomain>.workers.dev` (pinned), or `<preview-name>.app.example.com` on a custom domain with `previews_enabled: true`. Previews do not inherit production config; they need a `previews` block; DOs and Containers are auto-isolated per preview; KV/D1/R2/Queues are shared unless bound to different resources; Workflows bindings reuse production Workflows; queue consumers, cron and routes do not target previews; service bindings call production (https://developers.cloudflare.com/workers/previews/resources/). Limits: 500 previews per Worker (paid), 100 deployments per preview, oldest auto-deleted. Access control: public by default; `workers.dev` previews get `X-Robots-Tag: noindex`; protect with Cloudflare Access via `preview_worker` / `all_preview_workers` destinations and read identity with `ctx.access.getIdentity()`; **worker-level Access policies reject WebSocket upgrades with 403**, so WebSocket apps need a hostname-based Access application (https://developers.cloudflare.com/workers/configuration/cloudflare-access/).

## 7. Limits and pricing

| Item | Value | Source |
| --- | --- | --- |
| Operations | 10,000/mo included, then $0.15 per 1,000 (create, push, pull, clone, fork...) | pricing |
| Storage | 1 GB-mo included, then $0.50/GB-mo; replicas free; peak-per-day average | pricing |
| Plan | Workers Paid only (Free "later with fair limits" per blog) | pricing |
| Max repo size | 1 GB | limits |
| Max blob/file | 32 MB | limits |
| Account storage | 1 TB (raisable) | limits |
| Repos / namespaces | unlimited / unlimited | limits |
| Control-plane rate | 2,000 req / 10 s per namespace | limits |
| Git rate | 2,000 req / 10 s per repo | limits |
| Names | 2-63 chars (namespace); start alnum; `. _ -` allowed | limits |
| Token TTL | 60 s - 31,536,000 s, default 86,400 | rest-api |
| `list` page / `log` limit / tokens page | 200 / 1,000 / 100 | binding, rest-api |
| Jurisdiction | `eu` or `us` per namespace at creation, immutable; default unrestricted | data-localization |
| Underlying DO constraints | 2 MB SQLite row (objects chunked), ~128 MB memory per DO, streaming fetch/push | blog |
| Metrics | GraphQL `artifactsEventsAdaptiveGroups`, 31-day window; eventType create/fork/push/pull/delete + storageLimitReached/serverError/clientError/rateLimited | observability/metrics |

## 8. Namespaces and multi-tenancy

Namespaces are the top-level container; a repo's address is `namespace/name`; names are unique per namespace, not per account (https://developers.cloudflare.com/artifacts/concepts/namespaces/). Namespaces are auto-created (unrestricted jurisdiction) on first `create`; explicit creation via REST is required for EU/US pinning. A binding is fixed to one namespace, so per-tenant namespaces from a single Worker mean either N bindings or REST calls with a CF API token stored as a secret. Cloudflare's guidance: one repo per agent/session/task/user; namespaces per environment, tenant or shard; shard when a namespace nears the 2,000/10 s control-plane rate (https://developers.cloudflare.com/artifacts/concepts/best-practices/). Tokens are repo-scoped only; there is no namespace- or org-level token. Repo search = name substring via REST `search`; content/namespace-wide search APIs were announced as "coming" in April and are not shipped.

## 9. Adjacent primitives (key limits)

| Primitive | Key facts and limits | Docs |
| --- | --- | --- |
| Durable Objects | Unlimited objects, 500 classes (paid), 10 GB SQLite per object, 2 MB row, 100 cols, 128 MB memory, 30 s CPU default (5 min via `limits.cpu_ms`), ~1,000 rps soft per object, 6 outbound connections, alarms 15 min wall, RPC stubs, WebSocket Hibernation (clients stay connected while evicted; 20:1 billing ratio on inbound messages). $0.15/M requests, $12.50/M GB-s, rows read $0.001/M after 25 B, rows written $1/M after 50 M, $0.20/GB-mo after 5 GB | https://developers.cloudflare.com/durable-objects/platform/limits/, .../pricing/, .../best-practices/websockets/ |
| Workflows | 30 s CPU/step (5 min), unlimited wall/step, 1 MiB step result and event payload, 1 GB state/instance, 10k steps (25k), 50k concurrent running (waiting instances exempt), 300 creates/s/account, 30-day retention, `step.waitForEvent({type, timeout})` default 24 h up to 365 d with `instance.sendEvent`, event-triggered via `triggers.events`; cannot run inside Workers for Platforms. $0.30/M invocations, $0.02/M CPU-ms, 500k steps then $0.80/100k, $0.20/GB-mo | https://developers.cloudflare.com/workflows/reference/limits/, .../build/events-and-parameters/, .../reference/pricing/ |
| Queues | 10k queues, 128 KB message, batch 100, 5,000 msg/s per queue, 14-day retention, 25 GB backlog, 250 concurrent consumers, 15 min consumer wall; $0.40/M ops after 1 M (3 ops per message) | https://developers.cloudflare.com/queues/platform/limits/, .../pricing/ |
| Containers | Types lite (1/16 vCPU, 256 MiB, 2 GB) ... standard-4 (4 vCPU, 12 GiB, 20 GB); custom up to 4 vCPU/12 GiB/20 GB; account 1,500 vCPU / 6 TiB / 30 TB concurrent, 50 GB image storage; snapshot 20 GB, 30-day TTL; `durable_object` scheduling policy; API `ctx.container.start({image, entrypoint, env, enableInternet, instance, containerSnapshot})`, `exec(cmd[], {stdin, stdout, stderr, cwd, user, env, signal})` -> `ExecProcess` (no built-in timeout), `getTcpPort(n).fetch()`, `setInactivityTimeout(<=6 h)`, `monitor()`, `snapshotContainer()`, `destroy()`, `interceptOutboundHttp(host, fetcher)` (128 entries); Internet off by default; Docker-in-Docker works via `docker:dind-rootless` with `--iptables=false` and `--network=host` (0.x guide). Billing per 10 ms: 25 GiB-h, 375 vCPU-min, 200 GB-h included, then $0.0000025/GiB-s, $0.000020/vCPU-s, $0.00000007/GB-s; egress $0.025/GB after 1 TB. Cold-start time not documented (UNVERIFIED) | https://developers.cloudflare.com/containers/platform/limits/, .../pricing/, https://developers.cloudflare.com/containers/api/durable-object-container/, https://developers.cloudflare.com/sandbox/sdk/guides/docker-in-docker/ |
| Sandbox SDK | `@cloudflare/sandbox` 1.0 = helper classes `Files`, `S3Mount`, `DirectoryBackup` over `ctx.container`, needs `sandbox-shim` in the image and `nodejs_compat`; previews are proxied by your Worker (`/previews/<name>/` or one hostname per sandbox via wildcard DNS); 0.x API (`getSandbox`, `exec`, `startProcess`, sessions, `exposePort`+`proxyToSandbox` needing a custom wildcard domain, `tunnels.get(port)` for `*.trycloudflare.com`, `sleepAfter` default 10 m, `keepAlive`). Lifetime: instance stops when DO inactive beyond `setInactivityTimeout`, on `destroy()`, or when the entrypoint exits; code running inside does not count as activity (use an alarm); snapshots carry files, not processes. Coding-agent runner tutorial keeps API keys in an outbound entrypoint so the sandbox never holds them | https://developers.cloudflare.com/sandbox/reference/, .../concepts/lifetime/, .../previews/, .../sdk/api/, .../get-started/build-a-coding-agent-runner/ |
| Dynamic Workers | Lightweight untrusted-JS sandbox: `env.LOADER.load({mainModule, modules, globalOutbound: null, limits: {cpuMs, subRequests}})`; 1,000 unique DWs/month included then $0.002 per DW per day; requests/CPU at Workers Standard rates | https://developers.cloudflare.com/dynamic-workers/, .../pricing/, .../usage/limits/ |
| Workers for Platforms | $25/mo; unlimited user Workers in a dispatch namespace, 1,000 scripts included then $0.02/script, 20 M requests, 60 M CPU-ms; `env.DISPATCHER.get(name).fetch()`; untrusted mode (no `request.cf`, no shared cache), outbound Worker for egress, custom per-tenant CPU/subrequest limits; no Workflows, no gradual deployments; CF API 1,200 req/5 min | https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/how-workers-for-platforms-works/, .../reference/limits/, .../reference/pricing/ |
| Workers AI | $0.011 per 1,000 neurons, 10k neurons/day free; text-gen 300 rpm, paid-only models 20 rpm (50 with AI Gateway unified billing); coding-grade models and prices per M in/out: `@cf/moonshotai/kimi-k2.7-code` $0.95/$4.00, `@cf/zai-org/glm-5.3-flash` $0.15/$0.50, `@cf/qwen/qwen2.5-coder-32b-instruct` $0.66/$1.00, `@cf/openai/gpt-oss-120b` $0.35/$0.75, `@cf/deepseek-ai/deepseek-v4-flash-0731` $0.44/$1.32 | https://developers.cloudflare.com/workers-ai/platform/pricing/, .../limits/ |
| Vectorize | 1,536 dims float32, 20 M vectors/index, 50k indexes, 10 KiB metadata, 10 metadata indexes, topK 50 (with data) / 100; $0.01/M queried dims after 50 M, $0.05/100 M stored dims after 10 M | https://developers.cloudflare.com/vectorize/platform/limits/, .../pricing/ |
| R2 | 5 TiB objects, 1 M buckets, 1 write/s per key; $0.015/GB-mo, Class A $4.50/M, Class B $0.36/M, free egress; 10 GB / 1 M A / 10 M B free | https://developers.cloudflare.com/r2/platform/limits/, https://developers.cloudflare.com/r2/pricing/ |
| D1 | 10 GB/db (hard), 50k dbs, 2 MB row, 100 KB statement, 30 s query, single-threaded per db, 30-day Time Travel; $0.001/M reads after 25 B, $1/M writes after 50 M, $0.75/GB-mo after 5 GB | https://developers.cloudflare.com/d1/platform/limits/, .../pricing/ |
| Browser Run (was Browser Rendering) | Paid: 10 h/mo then $0.09/h, 10 concurrent then $2/browser-month, 200 concurrent cap, 3 new/s, 60 s idle timeout (`keep_alive` to 10 min) | https://developers.cloudflare.com/browser-run/limits/, .../pricing/ |
| Agents SDK (`agents`) | `Agent<Env, State>` on a DO: `setState()` persists to SQLite and broadcasts to WebSocket clients, `@callable()` RPC, `schedule()`, `runWorkflow()`/`waitForApproval()`, `runFiber()` durable execution, sub-agents; routing `/agents/:agent/:instance` via `routeAgentRequest`; `AIChatAgent` + `useAgentChat` now in `@cloudflare/ai-chat`; MCP server via `createMcpHandler(factory)` from `agents/mcp/server` (stateless, MCP SDK v2; `McpAgent` deprecated); MCP client `this.addMcpServer(name, url, {id, props, callbackHost})`; limits 1 GB state per agent, 30 s CPU refreshed per message | https://developers.cloudflare.com/agents/runtime/agents-api/, .../runtime/lifecycle/state/, .../communication-channels/chat/chat-agents/, .../model-context-protocol/apis/handler-api/, .../apis/client-api/, .../platform/limits/ |
| workers-oauth-provider | `@cloudflare/workers-oauth-provider` 1.x: split `OAuthAuthorizationServer` (issuer, resources, scopesSupported, CIMD) + `OAuthResourceServer` (RFC 9728 metadata, `validateToken` over a service binding, `requiredScopes`, step-up 403), or single-Worker `OAuthProvider`; needs KV `OAUTH_KV`; implements MCP authorization 2026-07-28, OAuth 2.1, PKCE, DCR, token exchange | https://github.com/cloudflare/workers-oauth-provider, https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/ |
| Cloudflare Access | Policies: account members, email domain, plus service tokens/IdPs via Zero Trust; `ctx.access.getIdentity()` in the Worker; `access.dev` block for local simulation; not propagated across service bindings | https://developers.cloudflare.com/workers/configuration/cloudflare-access/ |
| RealtimeKit | Meetings/participants via REST (3,500 req/5 min); collaborative key-value `stores.create(name)` with `set/update/delete/subscribe('*')`, 5 writes/s per participant, `broadcastMessage` 5/s; store data lives only for a session; $0.002/min AV participant, $0.0005 audio-only | https://developers.cloudflare.com/realtime/realtimekit/collaborative-stores/, .../limits/, .../pricing/ |
| Workers runtime | 128 MB memory, 5 min CPU (30 s default), 10k subrequests (10 M), 6 simultaneous connections, 100 MB request body on Free/Pro zones, 500 Workers, 64 MiB bundle, 1 s startup | https://developers.cloudflare.com/workers/platform/limits/ |

## 10. Design implications

**Fifteen things Artifacts makes easy**

1. Fork-per-task: `project.fork("task-<uuid>")` plus `readFile({ref, path: "AGENTS.md"})` is the documented agent bootstrap; forks default to `defaultBranchOnly: true`, so they are cheap.
2. Thousands of concurrent agents: each repo is its own DO, so N agents on N forks never contend on one repo; the only shared limit is 2,000 control-plane req/10 s per namespace.
3. Least-privilege credentials: mint a `read` token for reviewers/indexers and a short-TTL `write` token (e.g. 900 s) per agent session; revoke by id; `token.created`/`token.revoked` events give an audit trail for free.
4. Read-only review copies: `fork(name, { readOnly: true })` freezes a snapshot for human review or benchmark baselines.
5. Push-triggered pipelines with zero polling: `triggers.events` + Workflows for a whole namespace; `@cloudflare/ci` gives cached installs, parallel lint/test/typecheck in sandboxes and deploy to Workers or a WFP namespace.
6. Review gates as durable state: a review Workflow does `step.waitForEvent({type: "approval", timeout: "7 days"})`; a human or agent calls `instance.sendEvent`; waiting instances cost no concurrency.
7. Agent-first metadata: git notes on `refs/notes/*` carry prompts, model, run id and attribution without touching commits (official recommendation).
8. Importing the world: `import({ source: { url, branch, depth } })` from any public HTTPS remote (depth caps cost) seeds baselines; `source` on the repo records provenance.
9. Serving files and history over HTTP without a git client: `readFile`/`raw/:ref/:path` returns typed Blobs, `log`/`readCommit`/`readTree` give a code browser with no clone.
10. Per-branch preview deploys: push to a non-`main` branch and Workers Builds creates `<branch>-<worker>.<sub>.workers.dev`, with its own DO namespace and container app.
11. Gating previews: Access with `preview_worker` destinations and `ctx.access.getIdentity()` gives SSO on previews in minutes.
12. Agents committing from a Worker: isomorphic-git with the in-memory FS pushes a commit to a fresh repo without a container.
13. Fast sandbox start on large repos: ArtifactFS mounts a tree in seconds and hydrates blobs by priority; works with any remote.
14. Data residency: EU/US jurisdiction per namespace, so an "EU org" is just a namespace created via REST with `jurisdiction: "eu"`.
15. Observability out of the box: `artifactsEventsAdaptiveGroups` gives per-repo push/pull/error counts and p99 latency for a dashboard without logging code.

**Ten things it makes hard**

1. No server-side hooks, pre-receive, branch protection or push options: every policy (protected branches, required reviews, signed commits, secret scanning) must run after the fact in the Worker on `cf.artifacts.repo.pushed`, with "reject" meaning force-resetting the ref via a write token or marking the push invalid in your own metadata.
2. No diff, blame, merge or ref APIs: compute diffs client-side from `readTree`/`readBlob` (32 MB blob ceiling, Worker 128 MB memory) or in a sandbox with real git; merges happen in a container or isomorphic-git, never on the server.
3. Pushed events carry a truncated commit list and no file list: the pipeline must fetch to learn what changed.
4. One binding = one namespace: tenant-per-namespace needs REST with an account API token in a secret (1,200 req/5 min CF API limit) or many static bindings; namespace creation is REST-only.
5. 1 GB per repo and 32 MB per blob: monorepos, build artifacts and media need R2 with pointers; LFS is not documented.
6. Partial/blobless clone is explicitly unsupported on v1 (`filter`), so ArtifactFS against Artifacts may hydrate eagerly; benchmark before promising sub-10 s starts.
7. Repo names are flat per namespace and search is name-substring only: org/repo hierarchies, code search and "find repos containing X" live in your own D1/Vectorize index fed by events.
8. Writes from Workers are awkward: no write API, so commits need isomorphic-git (pack in memory) or a container with git; large trees push Workers toward the 128 MB limit.
9. Workers Builds only treats `main` as production, previews cannot receive queue consumers or cron, and Workflows are not available inside WFP namespaces, so a multi-tenant "deploy user repos" story is Workflow + WFP dispatch rather than Builds.
10. Billing visibility: every clone/fetch/push is an operation at $0.15/1k and each agent fork duplicates storage at $0.50/GB-mo, so a fork-per-task design needs a reaper (`delete` + `repo.deleted` event) and dedup via `defaultBranchOnly` and shallow imports.

## 11. Unverified or inconsistent items

- Billing start 2026-10-14 (docs) vs 2026-10-15 (blog).
- Sandbox example reads `.defaultBranch`/`.remote` off a `get()` handle; types say use `info()`.
- Blobless/partial clone over v2, LFS, ref-deletion events, namespace-wide Queue subscriptions, container cold-start latency: not documented.
- Blog (April) promised SDKs (TS/Go/Python) and content search; none in docs as of 2026-10-03.
