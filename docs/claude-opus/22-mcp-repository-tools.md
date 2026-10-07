# 22 · MCP repository tools: agents work on a repository through MCP as well as git

Built 2026-10-07 (lane B of persistent repositories, from `prototype` at `f9a2295`). Git stays the interface: an agent clones, commits and pushes `bean/<name>` with git (`18-git-native-flow.md`). The MCP tools added here coordinate agents and explain verdicts; none of them moves code. Plain, task-shaped tools only (no code mode, no `execute`).

## 1. What a session can do

An OAuth session (or a personal `bsu_` token as a bearer) addresses any repository its person may use, named `owner/name`. Access is the git rule: the session becomes a person's git credential and `mayUseEngine` decides (owner, public read; collaborators join there). A repository the person may not use answers "no repository … you can use", like git's 404. Deploy tokens (`bsd_`) and repository-bound git credentials never open `/mcp` (401).

| Tool | Scope | What it does |
|---|---|---|
| `repo_list()` | read | The person's repositories: access (`write` when the person may push and the session holds `write`), visibility, clone URL |
| `repo_status(repo)` | read | Stalk and sprout heads, unvalidated window, beans in flight and sent back (who, phase, task), recent red validations, open cards |
| `bean_open(repo, bean, intent, task?)` | write | Reserves `bean/<name>` for a day with its intent; claims `task`; returns the branch, `start` and `push` commands and the sprout head |
| `bean_status(repo, bean)` | read | Phase (`open` while reserved), the pushed bean (actor, intent, verdict lines), rework (failing tests, conflicts, the collided-with beans with title, intent, landed sha and files changed), the journey (every line the pushes printed), `next` |
| `bean_wait(repo, bean, until?, timeout_s?)` | read | The twin of `git push -o wait`: holds until the check ends (`until: "stalk"`: until validated), default 300 s, at most 1,800; `waited_s`, `timed_out` |
| `task_list(repo)` | read | The backlog with each task's state: open, claimed (by, until), in_progress (whose bean), done |
| `task_claim(repo, task)` | collaborate or write | Two-hour claim, renewed by claiming again or `bean_open` with it; refused with who holds it |
| `task_release(repo, task)` | collaborate or write | Gives a task back: the person's claim and the names they reserved for it (added after the first real session, where the agent found its task already done and had no way to free it) |
| `git_credentials(repo, ttl_minutes?)` | read (push needs write) | A `bss_` token bound to that one repository, at most an hour, as `git credential approve` input with the commands to store it |

Acting (bean_open, claims) also needs the person to be able to push to the repository: a reader of a public repository cannot take its tasks. The existing read tools (`ask_repo`, `work_overlaps`, `change_status`, `checks_get`, `run_status`, `preview_link`) take an optional `repo` in a session; without it they read `DEMO_RUN` or the newest run, as before. Sessions no longer get a 404 when no run exists. The old `git_credential` (an unbound session token) is replaced by `git_credentials`.

## 2. How it works

```
MCP (packages/mcp)                         gateway (packages/gateway)
 src/repos/repo-tools.ts  ── RPC ──▶  AgentReposRpc (src/agent/agent-repos-rpc.ts)
   repo-answers.ts                      agent-access.ts: registry.byName → mayUseEngine → engine
   git-credentials.ts                   engine RunDO: push_beans + agent-store.ts
     └─ mintSessionToken(repository)      bean_reservations, task_claims (SQLite, one at a time)
        (identity D1)                   backlog.ts: .beanstalk/backlog.md or BACKLOG.md on the sprout
```

- **Shared contract:** `@beanstalk/shared-race/agent-repos` (`AgentPrincipal`, `AgentReposRpc`, inputs as Zod). The gateway trusts the MCP binding for who the person is and which scopes the session holds (as it trusts the web app) and checks access and scopes itself; the MCP Worker passes the gateway's messages to the model as tool errors.
- **Reservations and claims live in the repository's engine Durable Object** beside its pushed beans: one object, one request at a time, so two agents claiming the same task get one yes and one no. A task is `done` when ticked in the file or when a bean linked to it (`Task:` trailer, `-o task=`, or the reservation's task) landed; `in_progress` while such a bean is out or reserved.
- **Push integration:** a push of a name someone else reserved is refused in the git protocol (`ng refs/heads/bean/x bean x is reserved by @alice (bean_open)`). The holder's first push consumes the reservation; the reserved intent becomes the bean's intent (unless `-o intent`), the reserved task its task (unless the commit names one).
- **The backlog is a file in the repository** (decision taken here, instead of a separate store with an import step): `- [ ] <id>: <title>` items, detail indented below, ticked = done; ids from the text before `: `, else a slug of the title. Changing the backlog is a bean like any other. Read from the sprout (ref heads are memoised 5 s in the engine).
- **`bean_wait`** polls the engine once a second inside the gateway (as `-o wait` does), so the MCP Worker makes one RPC per wait.
- **`git_credentials`** mints a session token with a new nullable `repository` column (identity migration `0003_repository_tokens.sql`). `verifyGitCredential` maps it to `engine: <that engine>`, so the git proxy opens only that repository; `resolveExternalToken` refuses it on `/mcp`. It is revoked with the session's grant (Settings → Disconnect), audited as `session_token.mint` with the repository. Like its predecessor it is visible to the model (the `16` §3.3 trade-off); the answer tells the agent to pipe it to `git credential approve`, set `credential.<host>.useHttpPath true` (one credential per repository) and, with no helper configured, use the in-memory `cache` helper.

## 3. Verified

- **Tests** (`pnpm check` exits 0): gateway `test/agent-repos.test.ts` (11: listing and access, someone else's private repository is missing, public is read-only, scopes, reservation then push takes the reserved intent and task, reserved name refused in the protocol and at `bean_open`, pushed name not reopened, a red with failing tests and the collided bean's intent and files, waits (green, reserved, bad input), backlog absent / claim contention / ticked / unknown / release, in-progress task, repository-bound session tokens push to their repository and 404 elsewhere), `src/agent/backlog.test.ts` (4); MCP `test/repo-tools.test.ts` (9, through the MCP Worker over Streamable HTTP with the real gateway bundle on Miniflare: tool list (no `execute`), every tool's answer and errors, scopes, a credential that pushes and is refused elsewhere and as a bearer, read-only credential refused on push, deploy token refused on `/mcp`), `test/oauth.test.ts` updated for `git_credentials`; identity `user-tokens.test.ts` (bound tokens).
- **Staging** (own stack: `beanstalk-{gateway,mcp,web}-staging-b`, D1 `beanstalk-identity-staging-b` and `beanstalk-forge-staging-b` (migrations applied), KV `beanstalk-oauth-staging-b`, Artifacts `beanstalk-race-staging-b` / `beanstalk-repos-staging-b`, its own runner container app): `claude mcp add --transport http beanstalk-b …/mcp`, then `claude mcp login beanstalk-b --no-browser` in a pseudo-terminal while headless Chrome with a CDP virtual authenticator signed up `lane-b-c97275`, ticked collaborate and write on the consent page (`exp/mcp-repo-tools/consent-write-collaborate.png`) and created `shop-3952` from the TypeScript starter; "✔ Connected". A two-task backlog was landed as the owner with git.
- **Real Claude Code session** (2.1.292, Sonnet, `--max-budget-usd 2`, git isolated from the person's keychain): `task_list` → `task_claim slugify` → `bean_open` → `git_credentials` → `git credential approve` as told → clone; found `slugify` already on the sprout, switched to `word-count` (claim, `bean_open`), implemented with a test, `node --test` green, plain `git push` (remote printed "for task word-count"), `bean_wait` → green after 4 s, `bean_status` → green with its journey. 14 turns, 67 s, **$0.24**. Second session: `task_release slugify` → open, `repo_status`, `task_list` (word-count done by its bean). 5 turns, **$0.12**. Redacted transcripts: `exp/mcp-repo-tools/session-1-claim-open-push-wait.txt`, `session-2-release.txt`.

## 4. Gaps and next

- **Not deployed live.** Before it is: apply identity migration `0003` to `beanstalk-identity`, set `GIT_ORIGIN` in the MCP's vars (added to `wrangler.jsonc`), deploy gateway then MCP.
- The consent page's text for `collaborate` ("post on beans, answer requests, read its inbox") does not yet mention claiming tasks (web, another lane).
- Contention between two people is tested at the engine (two actors); end to end it needs collaborators (the other lane's `mayUseEngine` change brings it with no change here).
- `preview_url` in repository answers still links `/runs/<engine>`; repository pages are `/<owner>/<repo>`.
- A repository-bound credential keeps working for its hour if the person loses access to the repository (it is bound to the engine, like deploy tokens); revoking the agent's session revokes it.
- `bean_wait` polls once a second (as `-o wait`); a hibernatable wait in the engine object would be cheaper.
- Claims expire after two hours with no heartbeat beyond re-claiming; a long task needs the agent to claim again or push.
