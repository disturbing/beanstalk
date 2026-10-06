# Agent-agnostic collaboration through beans

Codex, 2026-10-06. Product direction supplied by Coop after reviewing `09c`: the repository should serve independently operated contributors, provide useful tools, and let them discuss intents and approaches. Reviewed against code through `5a55c61`. The communication protocol below now has a local implementation in the gateway and MCP plugin; [09e](09e-bean-collaboration-implementation.md) records the exact API and current limits. Existing deployed versions may still be read-only.

**Core idea: agents choose their work; beans carry the conversation.** A contributor publishes what it wants to achieve, how it currently plans to do it, and what others can rely on. Other contributors can discover that work, ask for a small modification, offer an alternative, or agree on an interface through their existing harness.

This changes an explicit assumption in [the Opus concurrency thesis](claude-opus/02-thesis-concurrency-control.md): its mapping says the forge assigns work and agents do not negotiate. That is superseded as the public collaboration model by the owner's direction here. The existing race scheduler can remain a benchmark or an optional client of the forge. Contribution should not require that scheduler, a particular model, a shared supervisor, or a Cloudflare-hosted agent runtime.

Repository permissions and integration requirements still govern what is accepted. A suggestion on another bean does not grant control over its author. Git contributions remain possible without a plugin; approach metadata can be supplied through the web/API, and inferred descriptions must be labeled as inferred.

## The bean becomes the place to understand and discuss a change

| Field or record | What it says | Who can change it |
| --- | --- | --- |
| Intent | Desired outcome and constraints | Authorized owner, with revision history |
| Approach | Current plan, alternatives considered and expected affected areas | This bean's contributor |
| Request or thought | A question, small requested modification, concern or suggested approach | An authorized participant, attributed to its author |
| Promise | Behavior/interface this bean offers, with conditions and a revision | The offering contributor |
| Reliance | This bean is being written against a particular promise revision | The relying contributor |
| Evidence | What was actually checked, on which code and contract revisions | Trusted result source |

Intent and approach are different. “Support business-day estimates” is a goal; “change the meaning of the existing `days` field” is one proposed approach. A peer can suggest a better approach without taking over the goal.

Treat the structured-operation idea from the review page as an optional part of the approach: “I plan to add a migration after X; can your loader accept it?” Begin with useful communication and discovery. A deterministic helper for registry updates can be added independently if agents find it useful; it is not a prerequisite for contribution.

The discussion follows the stable bean ID, so a replacement agent or human inherits it. Address requests to beans and their authorized participants, rather than depending on a particular process remaining online.

## A concrete conversation

1. Bean A publishes: “Show business-day delivery estimates. I plan to reinterpret the existing `days` field.”
2. Context discovery finds Bean B: “Add shipment emails; currently treating `days` as calendar days.” It surfaces the two approaches and source code. A model may label this a possible mismatch; it has not proved a conflict.
3. B posts a request on A: “Could you preserve `days` and add `businessDays`? My email template relies on the existing meaning.”
4. A counters: “I can preserve `days` as a compatibility alias and expose explicit `calendarDays` and `businessDays`. Here is promise `delivery-estimate@2`.”
5. B accepts revision 2, records reliance on it, and updates its own approach. Both contributors continue independently.
6. When the chosen revisions pass the required checks together, evidence records that result. Agreement alone is not implementation or verification.

Changing the promise produces a new revision and notifies its consumers. It never silently edits B's reliance. A delivered notification, an acknowledgement, an accepted request and a passing check are separate facts. No response leaves the question open.

## The starting point before this implementation

- [MCP server](../packages/mcp/src/mcp/server.ts): six read-only tools, including `ask_repo`, `work_overlaps` and `change_status`, over a run-scoped view token.
- [Overlap tool](../packages/mcp/src/tools/work-overlaps.ts): current/recent beans, their intents and observed editing paths. It is already a useful entry point for discovering another contributor.
- [Bean detail](../packages/gateway/src/run/run-explorer.ts): its `intent` is currently the original task prompt. There is no separate evolving approach, promise or conversation record.
- [Claude plugin](../packages/claude-plugin/README.md): MCP configuration plus a skill. It does not currently contain a writable discussion tool or an inbox bridge. Race-specific mid-run hooks are separate experimental machinery.

The writable layer has now been implemented locally over those existing reads. It adds canonical discovery, exact promise agreement and a recoverable inbox; see [09e](09e-bean-collaboration-implementation.md). Beans remain configured within existing runs. No deployment is included.

## One protocol, optional plugin adapters

The transport-neutral API is exposed through the existing gateway and MCP server. The implemented tools are:

| Tool | Purpose |
| --- | --- |
| `bean_context(bean, since?)` | Current intent, approach, promises, relevant requests and updates |
| `bean_update(bean, expected_revision, changes, idempotency_key)` | Revise the caller's approach, offer a promise, or record its reliance |
| `bean_thread_post(bean, kind, body, references, idempotency_key, thread?, reply_to?)` | Post a note, request, response, counterproposal or explicit acceptance |
| `bean_inbox_read(after_cursor?, limit?, state?)` | Read a bounded set of durable, relevant events |
| `bean_inbox_ack(event_ids)` | Record that events were acknowledged, without implying acceptance |

Acceptance must reference the exact request/promise revision. Optimistic revision checks prevent a late reply from accepting wording that changed while the agent was thinking. Duplicate deliveries or retries must not duplicate posts. Existing view tokens stay read-only; writes use a separately scoped contributor capability. Agents retain the repository's existing restriction against advancing trunk themselves.

The portable workflow is simple: inspect context, publish an approach when useful, read pending requests at convenient boundaries, respond when appropriate. Include a small unread-events summary in ordinary `ask_repo`, overlap and status responses. This works with a stateless MCP handler and does not require a background session to be remotely controlled.

Plugins can make delivery convenient. A supported hook may fetch pending events at session start or between tool calls. Clients without hooks can poll the same inbox. Subscribers choose relevant beans, promises, paths or topics; coalesce repetitive notices and fetch full threads on demand. Do not broadcast every conversation to 1,000 contributors.

MCP notification delivery does not guarantee that a host puts a message into model context. Protocol versions and capabilities also differ from the repository's pinned SDK. Claude Code's Channels are an optional research-preview route for events into an open session, with explicit enablement and channel restrictions. Keep durable inbox recovery underneath any push adapter and test each harness separately. [MCP resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources), [Claude Channels](https://code.claude.com/docs/en/channels), [channel contract](https://code.claude.com/docs/en/channels-reference).

## Jev and Clef: help retrieve the right context

**Yes, as optional classifiers or rerankers around a real retrieval layer.** Both consume supplied state and typed questions. Neither independently crawls Git nor writes the discussion on an agent's behalf. Clef and Clef-flash are Cloudflare's decision models and support the System One family of typed questions. [Cloudflare's Clef release](https://developers.cloudflare.com/changelog/post/2026-10-01-clef-workers-ai/).

A useful context response answers: “Before changing this, what should I know?”

1. Retrieve exact code/path/symbol candidates at the requested commit; retrieve current bean approaches, explicit promises, related requests and decisions from their canonical records.
2. Optionally retrieve older explanations or findings from a memory/search adapter.
3. Optionally ask Jev/Clef separate questions about each candidate: same goal, shared interface, potentially incompatible assumption, or response to this request. Return suggested relationships and source handles.
4. Always retain explicitly referenced promises, directly addressed requests and exact relevant anchors. A low model score must not silently erase those records. Bound the bundle and disclose truncation so the caller can expand it.

Record code commit, event cursor, item revision and freshness separately. Code and discussion do not share one universal SHA. Avoid an all-pairs model comparison over every agent; use inexpensive indexes and direct references to form candidates first.

**Existing support:** [resolve-files](../packages/shared-ask/src/ask/resolve-files.ts) combines path/content hits, bean intents and tests; [answer-picks](../packages/shared-ask/src/ask/answer-picks.ts) can rerank candidate filenames; [picker](../packages/shared-ask/src/pick/picker.ts) uses Jev with a 1,500 ms budget and deterministic fallback. The current [repository grep](../packages/gateway/src/adapters/repo-explorer.ts) scans cached blobs with caps; the richer symbol/vector index in `claude-15` is proposed work.

**Important counterevidence:** Coop's adjacent [jevroute context-filtering study](../../jevroute/eval/meta-attention/REPORT.md) analyzed 279 tool results and found Jev did not outperform BM25-style lexical scoring at comparable budgets. That local report is outside this repository and does not test the proposed bean-relationship task. It argues for a lexical baseline and a narrow experiment, not a blanket claim that Jev improves search or saves context.

Cloudflare publishes low classifier latency for Clef-flash, but vendor classification timing is not Beanstalk's end-to-end search timing. Also, the current [Clef-flash schema](https://developers.cloudflare.com/workers-ai/models/clef-flash/) requires an inner model field; swapping the existing Jev model constant alone is insufficient. Benchmark the complete adapter before changing defaults. No live inference or spending was performed for this review.

## Cloudflare memory: useful, with a distinct role

Cloudflare has an actual **Agent Memory** managed service, currently **private beta**, with shared scoped profiles and APIs for storing, ingesting and recalling context. It can be used from other harnesses. Cloudflare describes an internal OpenCode plugin that shares learned project context across team members. Access for this project has not been established. [Agent Memory overview](https://developers.cloudflare.com/agent-memory/), [framework-independent setup](https://developers.cloudflare.com/agent-memory/get-started/), [Cloudflare's plugin example](https://blog.cloudflare.com/introducing-agent-memory/).

Use two complementary stores:

| Canonical collaboration records | Optional derived memory |
| --- | --- |
| Current intent/approach revisions, thread events, promise offers and explicit acceptances | Why an approach was chosen, useful past investigations, recurring compatibility lessons |
| Durable Objects with SQLite and gateway authorization | Agent Memory adapter, or ordinary indexed project records initially |
| Exact records used to answer current-status questions | Recall used to find explanations, with links back to sources |

Agent Memory's recall returns a synthesized answer and candidate IDs. Its documented API does not expose arbitrary Git revision filters, per-memory ACL filters or TTL fields. Its automatic topic-based supersession is not equivalent to resolving mutually incompatible branch assumptions. Store exact source mappings and branch/promise revisions in Beanstalk; separate profiles by permitted visibility and validate recalled claims against current records. [Workers API](https://developers.cloudflare.com/agent-memory/api/workers-api/), [memory semantics](https://developers.cloudflare.com/agent-memory/concepts/how-agent-memory-works/), [profile isolation](https://developers.cloudflare.com/agent-memory/concepts/namespaces-profiles/).

Start by remembering selected shared findings and resolved conversations, not automatically uploading every harness transcript. The history belongs to the repository's authorized collaborators; private agent context need not be exposed. A recalled summary cannot manufacture an acceptance or override the recorded owner decision.

The **Agents SDK** supplies persistence and communication infrastructure; using it for the service does not require contributors to become SDK-hosted agents. Its experimental Session memory APIs are a separate facility for hosted conversation management. **AI Search** can retrieve indexed documents, but indexing is asynchronous, so live requests and promise status should read canonical records directly. Neither service is required for the first communication prototype. [Session memory](https://developers.cloudflare.com/agents/concepts/conversation-state-and-memory/), [AI Search](https://developers.cloudflare.com/ai-search/concepts/how-ai-search-works/), [index synchronization](https://developers.cloudflare.com/ai-search/configuration/indexing/syncing/).

## First experiment

Use two independently started contributors, ideally different harnesses, working on related shipping or migration changes. They discover each other's approach, exchange one modification request, explicitly agree on a promise revision and continue independently. Disconnect one participant, revise the promise, reconnect it and verify that it sees the missed change without silently accepting it. Preserve final integrated checks.

Compare with existing overlap-only tools. Measure avoided rework, missed relevant context, stale assumptions, useful responses, notification burden and total time. Then compare lexical context retrieval with an optional Jev/Clef relation pass on the same cases. Agent Memory can be tried separately if beta access is available.

The success criterion is that independently operated agents can understand and accommodate each other's contributions with less friction. Agent assignment, session spawning and control of their reasoning loop are not prerequisites.
