# MCP tools (optional coordination and context)

Contents: setup; the work cycle with MCP; repository tools; read tools; collaboration tools;
errors.

Git is the interface: clone, branch, commit and push are always git. The tools below
coordinate agents (claims, reserved names) and explain verdicts; none of them moves code.

## Setup

The plugin's `.mcp.json` points the `gitstalk` server at the hosted deployment's `/mcp` with
no auth header, so the client uses OAuth: `claude mcp login plugin:gitstalk:gitstalk` (or
`/mcp` in a session) and approve in the browser. Another deployment: `claude mcp add
--transport http gitstalk <its /mcp URL> && claude mcp login gitstalk`. Tick **write** on the
consent page if the agent should open beans and claim tasks. Every tool also follows the person's role on the repository: read tools need the read role, `bean_open`, `task_claim`, `task_release` and a pushing credential need the write role (`repository_access(repository)` says which you have). Without OAuth the
server accepts a personal token as a bearer (`--header "Authorization: Bearer $TOKEN"`).
Deploy tokens (`bsd_`) never open MCP. Never print a token.

## The work cycle with MCP

1. `task_list(repo)`; `task_claim(repo, task)`. Refused: someone holds it; pick another.
   Not doing it after all: `task_release(repo, task)`.
2. `bean_open(repo, bean, intent, task?)`: the branch, `start` and `push` commands.
3. Work with git: `git fetch origin sprout && git switch -c bean/<name> origin/sprout`, commit.
4. `git push origin HEAD:refs/heads/bean/<name>` and start the next task; do not wait.
5. Between steps: `bean_status(repo, bean)` (or the status ref). Red or conflict: rebase on
   `origin/sprout`, fix, push again (the claim holds while the bean is out). `bean_wait` only
   when nothing else is left to do.

## Repository tools (signed-in sessions)

| Tool | Scope | Call it when |
|---|---|---|
| `repo_list()` | read | The repositories you own or collaborate on, your role and access (`write` = may push beans), clone URLs |
| `repo_status(repo)` | read | Stalk and sprout heads, unvalidated window, beans in flight (who), beans sent back, recent reds, open cards |
| `bean_open(repo, bean, intent, task?)` | write | Before starting: reserves `bean/<name>` for you (a day) with its intent; claims `task`. The intent you reserve is the bean's intent at the push (`-o intent` overrides) |
| `bean_status(repo, bean)` | read | After a push: phase, failing tests, the landed beans it collided with (intent, files changed), the lines pushes printed, `next` |
| `bean_wait(repo, bean, until?, timeout_s?)` | read | The MCP twin of `git push -o bean=<bean> origin HEAD:refs/wait/any`: blocks until the check ends (`until: "stalk"`: until validated), default 300 s; the verdict wakes it (no polling). Only when nothing else is left |
| `task_list(repo)` | read | The backlog (`.gitstalk/backlog.md` or `BACKLOG.md` on the sprout): open, claimed (by, until), in_progress (whose bean), done |
| `task_claim(repo, task)` | write | Before working on a task: two hours, renewed by claiming again or `bean_open` with it; a pushed bean for the task holds it until it lands |
| `task_release(repo, task)` | write | You will not do it after all (already done, stopping): drops your claim and the names you reserved for it |
| `git_credentials(repo, ttl_minutes?)` | read (push needs write) | Only when git is not connected: a credential for that one repository, at most an hour, as `git credential approve` input |

Backlog format: `- [ ] <id>: <title>` items (ticked = done), detail indented below. Change
the backlog with a bean like any other file.

`git_credentials` answer: pipe its `credential` field to `git credential approve`. Set
`credential.https://<gateway host>.useHttpPath true` first so each repository keeps its own
credential; with no helper configured, `credential.https://<gateway host>.helper 'cache
--timeout=3600'` keeps it in memory. Never put it in a URL, a file, a commit or the chat.

## Read tools

All take `repo` (owner/name) in a signed-in session; run tokens read their own run.

| Tool | Call it when |
|---|---|
| `ask_repo(question, ref?, repo?)` | Orienting: files, beans and decisions for a plain question. `ref: "stalk"` for the validated line |
| `work_overlaps(paths, repo?)` | Before editing: beans in flight or recently landed on those paths, with intents |
| `change_status(bean, repo?)` | The engine's view of a bean: state, `next`, recent steps |
| `checks_get(bean, repo?)` | A red you cannot explain: failing tests with `inherited` and `protected` flags |
| `run_status(repo?)` | Sprout, stalk, window, beans in flight, open cards |
| `preview_link(bean or ref, repo?)` | A URL a person can open. Links never contain your token |
| `whoami()` | Who the session acts for, its scopes |

## Collaboration tools (contributor tokens on races)

| Tool | Use |
|---|---|
| `bean_context(bean, since?, limit?)` | Another bean's approach, versioned promises, pinned reliance, discussion |
| `bean_update(bean, expected_revision, changes, idempotency_key)` | Revise your own approach or offers. A 409 means re-read context and use its `bean.revision` |
| `bean_thread_post(bean, kind, body, references, idempotency_key, thread?, reply_to?)` | Post a request, reply, counterproposal or exact acceptance |
| `bean_inbox_read(after_cursor?, limit?, state?)` | Pending messages (`state: "unread"`); reading does not acknowledge |
| `bean_inbox_ack(event_ids)` | Acknowledge delivery only; never accepts a request |

## Errors

- `no repository owner/name you can use`: wrong name, or not yours and private.
- `… needs the write scope; reconnect the agent and tick write`: log in again (`/mcp`) and tick it.
- `task T-2 is claimed by @alice until …` / `in progress: @alice's bean …`: pick another task.
- `bean x is reserved by @alice`: pick another name (git refuses the push too).
- `the forge could not answer`: gateway unavailable; retry once after a pause.
