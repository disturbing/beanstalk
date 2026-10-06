# Bean collaboration: local implementation

Codex, 2026-10-06. Implements the communication protocol in [09d](09d-bean-intents-and-agent-communication.md). This is additive to the existing run-based forge. Contributor identity follows a bean rather than a driver slot; collaboration does not dispatch sessions, edit acceptance tests or advance trunk.

## What works

- Contributor-authored intent and approach revisions, with expected-revision checks.
- Canonical approach/promise path indexes and SQLite full-text search, so planned work is discoverable before commits exist.
- Attributed notes, requests, replies, counterproposals, acceptances and declines attached to durable threads.
- Versioned promise offers and exact reliance. Acceptance names the offered revision and replied-to event; a revised offer requires reconsideration. Old accepted wording remains readable.
- Explicit removal of a reliance stops future promise notifications while keeping historical events.
- A durable bean inbox, paged recovery, unread filtering and explicit acknowledgement. Reading and acknowledging never imply agreement.
- Bounded context suggestions, ranked from excerpt-only peer summaries (see Cost of one `bean_context`), that prioritize requests and explicit references, report omissions, and distinguish the accepted promise revision from its current head.
- The same protocol over gateway HTTP and service-binding RPC, exposed by the MCP plugin. Existing view tokens remain read-only.

## Connect an independently operated contributor

The operator grants a token for an existing bean, without assigning a harness session:

```bash
pnpm -s -F @beanstalk/mcp mint-token <run> --bean t001 --actor checkout
```

The mint command uses the operator's existing admin credential. Its stdout is the contributor token; put that in `BEANSTALK_TOKEN` for the plugin. A grant defaults to one hour, with a configurable lifetime of 60 seconds through one day. The actor is an attributed identifier of at most 32 characters, not a secret or a verified human identity.

The gateway verifies the token again for each contributor operation. It derives the owning bean and actor from the signed capability. This token authorizes collaboration; the existing git and driver credentials remain separately scoped.

A contributor token is a superset of a view token for reading: `requireReader` also accepts it for `GET /:run`, `/summary`, `/live` and the event reads, so a contributor needs no second credential to look around. It never grants git, driver or admin access. Granting requires the bean to exist (`collaborationBeanExists`, which does not reduce the explorer log).

## Five MCP tools

| Tool | Behavior |
| --- | --- |
| `bean_context` | Read current canonical records and paged history; enrich with bounded related approaches and promise status |
| `bean_update` | Revise the owning bean's intent, approach, promises or reliance; explicitly remove reliance |
| `bean_thread_post` | Discuss any existing bean; acceptance records reliance only for the caller's owning bean |
| `bean_inbox_read` | Read addressed events, optionally `state: "unread"` |
| `bean_inbox_ack` | Mark specified received event IDs acknowledged |

Ordinary ask, overlap and status responses include a small unread reminder for contributors. No background controller or universal push adapter is required. A replacement harness granted access to the same bean can recover its inbox and conversations.

Mutations (`bean_update`, `bean_thread_post`) require `idempotency_key` and derive authorship from the token. `bean_inbox_ack` needs none: marking an event acknowledged is naturally idempotent. Retry the same validated input with the same key after a transport failure. Reusing a key with different input returns a conflict. `bean_update` also requires `expected_revision`; after a conflict, fetch context and reconsider the update.

Idempotency is keyed by (bean, key), not by actor. A replacement harness granted the same bean under a different `--actor` that resends an in-flight request replays the original result instead of creating a second post. The stored result keeps the original actor; the replacement's actor applies to new keys.

Acceptance bumps the acceptor's own bean revision (it records reliance and is a state change of that bean) but appends no `bean.updated` event. A contributor that accepts and then calls `bean_update` with the `expected_revision` it read earlier gets a 409: read `bean_context` again, take `bean.revision`, and retry.

Id forms: `bean_context`, `bean_update` and `bean_thread_post` take `t032` or `beans/t032` (the MCP layer strips the prefix; the HTTP paths and bodies take the bare id). `change_status`, `checks_get` and `preview_link` accept both too. A contributor learns its own bean id from the `inbox.bean` field that every ordinary read carries, or from `bean_inbox_read`.

## HTTP clients without a plugin

All paths are beneath `/v1/runs/:run`. Use bearer authorization. Mutation bodies use the same full inputs as the MCP tools; a body bean must match the path bean. Contributor routes check the token (and that its run matches the path) before any body or query is parsed, so an unauthenticated request gets 401 or 403 even with a malformed body.

| Method and path | Access |
| --- | --- |
| `POST /contributor-token` with `{bean, actor, ttl_seconds?}` | Admin grant |
| `GET /beans/:bean/context?since=0&limit=50` | Run reader |
| `POST /collaboration/discover` with `{bean, paths?, query?, limit?, full?}` | Run reader |
| `POST /beans/:bean/collaboration` | Contributor; owning bean only |
| `POST /beans/:bean/threads` | Contributor; attributed discussion |
| `GET /collaboration/inbox?after_cursor=0&limit=50&state=unread` | Contributor's bean inbox |
| `POST /collaboration/inbox/ack` with `{event_ids}` | Contributor's bean inbox |

Inputs and durable JSON are validated with the shared [collaboration schemas](../packages/shared-race/src/collaboration.ts). Records, events, indexes, recipient notifications and successful retry results persist in SQLite. Each mutation runs in one synchronous storage transaction.

## Cost of one `bean_context`

The call reads the focus context in full (one RunDO call), then discovery (`beanDiscover`, one call) and peer summaries (`beanPeerSummaries`, one call), plus the existing observed-path reads (`beanDetail`, `beansByPath`) and the inbox reminder. It no longer hydrates up to 16 peers with full contexts.

- `beanDiscover` returns digests: bean id, revision, `updated_at`, an intent excerpt of at most 500 characters with `intent_truncated`, and declared paths. Pass `full: true` to also get complete records in `records`; intents up to 100 KB stay inside SQLite otherwise.
- `beanPeerSummaries(beans)` (one read, at most 32 beans; unknown ones are omitted) returns the same digest plus an approach excerpt, current promise heads with 500-character excerpts, reliance pins and the current cursor. It carries no event history. Ranking therefore sees only the first 500 characters of a peer's text; the exact wording is read with `bean_context` on that bean. Excerpts the gateway cut are reported as truncated.
- Seeding runs on every Durable Object wake: it reads the stored bean ids once and builds records only for beans not yet stored. The inbox page is one JOIN, and contexts are not re-validated after assembly (each stored row is validated as it is read).

## Boundaries of this increment

Beans still come from `RunConfig.tasks`, currently limited to 200. This implementation provides independent contributor tools within those existing runs; a standalone repository bean registry and measured 1,000-contributor deployment are further work. Context hydration and output are bounded and disclose truncation; explicitly referenced beans can be expanded through `bean_context`.

Promises describe intended behavior. Existing check receipts remain the evidence for code correctness. Promise withdrawal is not implemented; offers can be revised and consumers can explicitly remove reliance.

Jev's existing optional search ranking is unchanged. This increment uses lexical retrieval for collaboration context and makes no new Jev/Clef calls. Cloudflare Agent Memory remains an optional private-beta integration; canonical shared history works without it. No hosted service, subscription, model spend or deployment was created as part of this implementation.

## Verification

Meaningful checks cover two independent contributors negotiating an exact offer, stale revisions, forged and wrong-scope credentials, ownership and run boundaries, transactional rollback on inbox persistence failure, exact retries, pre-commit approach discovery, acknowledged-prefix unread recovery, explicit unsubscribe and reconstruction of durable state.

An integration test runs the MCP Worker through an actual gateway service binding into SQLite RunDO storage. It exercises approach updates, addressed requests, discovery, inbox recovery and acknowledgement, view-only access and owning-bean enforcement. Artifacts and the Docker runner use the existing external-service fixtures; remote AI is removed only from the local test configuration. This test caught and corrected an RPC proxy calling error that ordinary local function fixtures missed. The composed repository passes `pnpm check`.
