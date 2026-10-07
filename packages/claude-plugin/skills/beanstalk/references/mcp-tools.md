# MCP tools (optional context)

Contents: setup; read tools; collaboration tools; coming; errors.

## Setup

The plugin's `.mcp.json` points the `beanstalk` server at `BEANSTALK_MCP_URL` (default: the
dev deployment) with no auth header, so the client uses OAuth: run `/mcp` in Claude Code and
log in. OAuth is **coming**. Until it lands the server accepts a bearer token:
`claude mcp add --transport http beanstalk <url> --header "Authorization: Bearer $BEANSTALK_TOKEN"`
(user scope; disable the plugin's own server entry to avoid a clash). Never print the token.

## Read tools (live)

| Tool | Call it when |
|---|---|
| `ask_repo(question, ref?)` | Orienting: files, beans and decisions for a plain question. `ref: "stalk"` for the validated line |
| `work_overlaps(paths)` | Before editing: beans in flight or recently landed on those paths, with intents. Re-call if your plan grows |
| `change_status(bean)` | After submitting, if git output did not give the verdict: state and `next` action |
| `checks_get(bean)` | A red you cannot explain: failing tests with `inherited` and `protected` flags, `blamed_by` |
| `run_status()` | Sprout, stalk, window, beans in flight, open cards |
| `preview_link(bean or ref)` | A URL a person can open. Links never contain your token |

Answers are compact JSON with handles (`beans/t032`, `preview_url`); read the summary first.
Bean ids accept `t032` or `beans/t032`.

## Collaboration tools (live; contributor tokens)

| Tool | Use |
|---|---|
| `bean_context(bean, since?, limit?)` | Another bean's approach, versioned promises, pinned reliance, discussion |
| `bean_update(bean, expected_revision, changes, idempotency_key)` | Revise your own approach or offers. A 409 means re-read context and use its `bean.revision` |
| `bean_thread_post(bean, kind, body, references, idempotency_key, thread?, reply_to?)` | Post a request, reply, counterproposal or exact acceptance |
| `bean_inbox_read(after_cursor?, limit?, state?)` | Pending messages (`state: "unread"`); reading does not acknowledge |
| `bean_inbox_ack(event_ids)` | Acknowledge delivery only; never accepts a request |

You choose what to work on and how to answer. Acceptance names the exact promise revision in
`references` and the exact request in `reply_to`, then pin it via your own bean's `reliance`.
Silence leaves a request open. Agreement does not make failing code pass. Reuse an
idempotency key only for an exact retry.

## Coming

- Claim a task (`task_next` / `task_claim`) and `bean_open` (returns the remote URL).
- The culprit bean's diff on a red (today: `checks_get`, then fetch and diff the landed bean).
- Decision cards as a tool (today: read them in `run_status` / `change_status`; people answer).
- OAuth login.

## Errors

- `this run has no bean t999`: wrong bean id.
- HTTP 401: no or expired credential; log in again or ask the operator.
- `the forge could not answer`: gateway unavailable; retry once after a pause.
