# Checkout protocol and live edits: how agents edit beanstalk repos, and how anyone watches

Written 2026-10-03 for beanstalk. Answers two owner questions: what is the best way for agents to edit files in an Artifacts repo (checkout, protocol), and how does anyone see remote edits locally in real time. "Measured" means the hands-on probe in section 4.4; "estimate" means my arithmetic; UNVERIFIED means not confirmed.

## Summary of the recommendation

1. Every harness that edits (Claude Code, Codex, local or in a container) gets a real git checkout on a real disk. Their edit tools are local-file tools; none can code through MCP alone.
2. Checkout is plain `git clone` through beanstalk's proxy `git.beanstalk.dev`. A `beanstalk credential` helper trades the user's login for a Biscuit; the proxy mints the Artifacts token server-side, so agents never see `art_v1_`.
3. Under 100 MB: `--depth 1`. Over 100 MB: add `--filter=blob:none --sparse` with cone paths from the intent's scope hints. Measured: Artifacts advertises `filter` on protocol v2 and blobless clone works; `tree:0` returns HTTP 400.
4. ArtifactFS (Cloudflare's lazy FUSE mount) is deferred: macFUSE on laptops, `git status` about 7 s at 5,800 entries, and blob-by-blob hydration of a large tree could hit the per-repo rate limit.
5. No-clone MCP tools (`repo_read_file`, `repo_grep`, `repo_commit`) serve actors that do not run code: the Worker planner, judges, the canvas, and agents peeking at other sprouts.
6. Live edits travel on two tiers. Tier 1: a watcher (`agentd`) plus harness hooks post each changed file, with content, to the Project Durable Object, which fans out over WebSocket. Target p50 under 1 s.
7. Tier 2: `agentd` commits a checkpoint to `refs/wip/<sprout>/<session>` 3 s after the last edit (15 s cap) and pushes with `--force-with-lease`. Measured checkpoint pushes from Hong Kong: 0.38 to 3.6 s, median 1.4 s. Durable p50 target under 6 s.
8. The proxy sees every receive-pack result, so it tells the Project DO the moment a push lands; the `cf.artifacts.repo.pushed` Queue event becomes the audit backstop.
9. A human runs `beanstalk watch <sprout>`: a read-only mirror worktree where tier 1 writes files (`git diff` shows the agent's uncheckpointed edits) and tier 2 moves the commit (`git log` shows checkpoints). Editors, grep and the human's own Claude Code can all read it.
10. One writer per sprout, enforced by the proxy with a fencing generation. A human who wants to type adopts the sprout (agent stops, lease moves) or forks a new sprout from the latest checkpoint.

## 1. How agents edit today

| Harness | Where tools run, what they expect | Hooks | Remote mode |
|---|---|---|---|
| Claude Code, local | User's disk, absolute paths. Read, Edit (exact-string, must match once), Write, NotebookEdit, Bash; no MultiEdit in the current list; Glob and Grep are off by default on macOS and Linux, so search runs as Bash `find`/`grep` (https://code.claude.com/docs/en/tools-reference). Git needed for diffs, commits, worktrees, not for editing | SessionStart (`startup`, `resume`, `clear`, `compact`, `fork`), PreToolUse, PostToolUse, Stop, SessionEnd, FileChanged (a filesystem watcher, runs "no matter what changed the file"), and more; PostToolUse may carry `tool_response.bashEditDiff.changedFiles` for Bash edits (beta, v2.1.269+). Exit 2 blocks; JSON output on exit 0; command hooks default to a 600 s timeout and can be `async` (https://code.claude.com/docs/en/hooks) | n/a |
| Claude Code via Remote Control | Still the local machine: "Claude keeps running locally the entire time"; phone and browser are "a window into that local session", with a diff pane of uncommitted edits (https://code.claude.com/docs/en/remote-control) | Same hooks on the executing machine (inferred: `$CLAUDE_CODE_BRIDGE_SESSION_ID` is set for hooks while connected) | Needs a Claude subscription; no API keys, no custom `ANTHROPIC_BASE_URL` (same page) |
| Claude Code headless in a container | `claude -p --output-format stream-json` on container disk (https://code.claude.com/docs/en/headless); git to clone and push | Same, from plugins and project settings; async hooks die at `-p` teardown | n/a |
| Claude Code on the web | Anthropic VM that "clones your current directory's GitHub remote"; returns a PR or `--teleport` (https://code.claude.com/docs/en/claude-code-on-the-web) | Project hooks only | GitHub or a 100 MB bundle; not usable with Artifacts |
| Codex CLI, local or `codex exec` | Disk; edits via `apply_patch`, commands via a shell tool; `exec` is read-only unless `--sandbox workspace-write`; `--json` streams `item.*` file-change events (https://learn.chatgpt.com/docs/non-interactive-mode) | Hooks exist: SessionStart, PreToolUse, PostToolUse, Stop, SessionEnd and more; `apply_patch` matches `Edit\|Write` but the input is the patch text in `tool_input.command`, not a `file_path`; hooks must be trusted before they run (https://learn.chatgpt.com/docs/hooks). `notify` still sends `agent-turn-complete` (https://learn.chatgpt.com/docs/config-file/config-advanced) | n/a |
| Codex cloud | Container that "checks out your repo at the selected branch or commit SHA", internet off by default; diff or PR, `codex apply` to bring it local (https://learn.chatgpt.com/docs/environments/cloud-environment) | n/a | GitHub only |
| Cursor cloud agents | Ubuntu VM; "clone your repo ... work on a separate branch, then push changes" (https://cursor.com/docs/cloud-agent) | Repo `.cursor/hooks.json` runs in the cloud, incl. `afterFileEdit` with `file_path` and `edits` (https://cursor.com/docs/hooks) | Hand-off by branch or "move an agent from cloud to local" |
| Devin | Linux VM "with your repositories cloned"; "You can watch Devin make edits in real-time" in its VS Code view (https://docs.devin.ai/work-with-devin/devin-session-tools) | n/a | Take-over means stopping the session |

Conclusion: every product that edits code gives the agent a cloned tree on a disk where it also runs tests and git; "remote" products move that disk into a VM and surface a branch plus a viewer. A checkout must therefore provide a POSIX tree, a `.git` that answers `status`, `diff` and `commit` offline, credentials that renew without the agent seeing them, and a push target the agent owns.

## 2. Checkout models compared

5 MB is the demo app; measured numbers are for a 1 MB repo from Hong Kong. 100 MB and 1 GB assume 30 MB/s pack throughput, UNVERIFIED until B12. Ops are billed at $0.15 per 1,000 (https://developers.cloudflare.com/artifacts/platform/pricing/).

| | Full clone | Shallow `--depth 1` | Blobless + sparse (`--depth 1 --filter=blob:none --sparse`) | ArtifactFS | No-clone MCP |
|---|---|---|---|---|---|
| First byte, 5 MB | ~2 s (measured 1.87 s) | ~1.2 s (measured 1.23 s) | 0.6 to 0.8 s (measured 0.62 s, 0.83 s) | mount est. 1 s; +0.46 s per cold file (measured lazy blob) | 50 to 100 ms per call (`claude-15` §1) |
| 100 MB | est. 2 + 100/30 = 5.3 s | est. 2 + 40/30 = 3.3 s (tip only, est. 40 MB) | est. 1 to 2 s, then one batched fetch per cone (measured 0.91 s for 20 blobs) | est. 1 to 2 s | same |
| 1 GB | est. 35 to 90 s plus checkout of ~80k files | est. 20 to 40 s | est. 2 to 5 s (trees at depth 1: 80k entries × ~50 B = 4 MB) | est. 2 to 5 s | same |
| Bytes moved | all history | tip | trees + blobs in cone | trees + every blob read | results only |
| Artifacts ops | 1 + 1 per fetch | same | 1 + 1 per lazy batch; `git log -p`, `blame` may fetch blob by blob (est.) | 1 + 1 per hydration fetch | 0 for indexed commits |
| Rate-limit exposure (2,000 git requests / 10 s / repo) | none | none | moderate | high: 80k single-blob fetches ≈ 160k requests ≥ 800 s at the cap (estimate; ArtifactFS uses `git cat-file --batch`, 4 workers, https://github.com/cloudflare/artifact-fs) | none |
| Offline | full | all but deepen | edits yes, new paths no | unhydrated files fail | none |
| What breaks | nothing | history past base; rebase onto new trunk needs `--deepen` | ~0.5 s stall on first touch outside the cone | macFUSE kernel extension on Macs; `git status` ~7 s at 5,800 entries (README "Known limitations"); Container FUSE UNVERIFIED | Edit, Write, apply_patch, Bash, tests |
| Effort by Oct 14 | 0 | 0.1 day | 0.5 day + bench | 2 to 3 days | 2 days (in `claude-15`) |

ArtifactFS is a Go FUSE daemon that "starts with a blobless clone", shows the tree at once, hydrates blobs on read with manifests and source first, and keeps writes in a copy-on-write overlay that `git commit` reconciles (https://developers.cloudflare.com/artifacts/guides/artifact-fs/). Its README warns that without server-side filtering "Git downloads the selected revision's blobs eagerly"; the probe shows Artifacts does advertise `filter` on v2, so lazy hydration is now plausible but unmeasured (B11c).

## 3. Packages

| Package | Language | Contents |
|---|---|---|
| `packages/git-proxy` | TypeScript Worker, Hono | Smart-HTTP proxy; Biscuit verify; Artifacts token cache; receive-pack ref policy; push notifications to the Project DO |
| `packages/cli` | Rust, binary `beanstalk` | `login`, `credential`, `start`, `watch`, `adopt`, `fork`, `checkpoint`, `agentd`, `hook <event>` |
| `packages/claude-plugin` | plugin JSON | `.claude-plugin/plugin.json`, `hooks/hooks.json`, `.mcp.json`, one skill |
| `packages/codex-hooks` | TOML/JSON | `.codex/hooks.json` template, `notify` fallback |

Rust for the CLI because hooks run on every edit (a static binary starts in milliseconds, Node in tens, estimate) and the same binary ships in the harness images.

## 4. The protocol, end to end

### 4.1 Credentials

On a `401` git runs the helper. `beanstalk credential get` reads `host` and `path`, loads the cached Biscuit for that repo, and if it expires within 60 s calls `POST https://api.beanstalk.dev/v1/capabilities {repo, ops, session}` with the OAuth token from `beanstalk login` (kept in the OS keychain). It answers `authtype=Bearer`, `credential=<biscuit>`, `password_expiry_utc=<exp>` when git announced `capability[]=authtype` (git 2.46+), else `username=beanstalk`, `password=<biscuit>` (https://git-scm.com/docs/git-credential). Measured: git 2.53 sent `capability[]=authtype`, `capability[]=state`, `protocol`, `host`, `path` and `wwwauth[]=Basic realm="artifacts"`. `store` is a no-op; `erase` drops the cache after a 403. The Biscuit carries `repo`, `ops`, `ref_prefix`, `session`, `writer_generation`, `exp` (60 min write, 15 min read, per `claude-06`).

```ini
# ~/.gitconfig, written once by `beanstalk login`
[credential "https://git.beanstalk.dev"]
    helper =
    helper = beanstalk credential
    useHttpPath = true

# <worktree>/.git/config excerpt, written by `beanstalk start`
[protocol]
    version = 2
[remote "origin"]
    url = https://git.beanstalk.dev/acme/sprout-7f3.git
    fetch = +refs/heads/*:refs/remotes/origin/*
    fetch = +refs/wip/*:refs/remotes/origin/wip/*
    promisor = true                 # blobless checkouts only
    partialclonefilter = blob:none  # blobless checkouts only
[remote "trunk"]
    url = https://git.beanstalk.dev/acme/trunk.git
    pushurl = no-push://trunk-is-read-only
[http]
    lowSpeedLimit = 1000
    lowSpeedTime = 30
[beanstalk]
    project = acme
    sprout = sprout-7f3
    session = s-01J9ZQ
```

The empty `helper =` resets inherited helpers so `osxkeychain` never stores a Biscuit (https://git-scm.com/docs/gitcredentials).

### 4.2 Clone and fetch (protocol v2, upload-pack)

| # | Client | Proxy | Response |
|---|---|---|---|
| 1 | `GET /acme/sprout-7f3.git/info/refs?service=git-upload-pack`, `Git-Protocol: version=2` | no auth | `401`, `WWW-Authenticate: Basic realm="beanstalk"` (Artifacts does the same, measured) |
| 2 | same, with `Authorization` | verify Biscuit (est. < 2 ms CPU); map to `https://<acct>.artifacts.cloudflare.net/git/acme/sprout-7f3.git`; cached read token or `repo.createToken("read", 900)`; forward with `Bearer art_v1_…` and `Git-Protocol` | measured: `version 2`, `agent=gitty/1.0`, `ls-refs=unborn`, `fetch=shallow filter sideband-all` |
| 3 | `POST /git-upload-pack` `command=ls-refs` | stream | refs |
| 4 | `POST /git-upload-pack` `command=fetch`: `want`, `deepen 1`, `filter blob:none`, `done` | stream | packfile |
| 5 | later lazy fetch: `command=fetch` with blob wants | Biscuit re-checked per request | packfile |

Tokens are cached per (repo, scope) in the proxy until 60 s before expiry, because `createToken` is a control-plane call against the namespace's 2,000 per 10 s (https://developers.cloudflare.com/artifacts/platform/limits/). An HTTP Worker has no wall-clock limit while the client stays connected; only CPU counts (30 s default, up to 5 min), and streaming pass-through uses little (https://developers.cloudflare.com/workers/platform/limits/). Large-pack throughput is B14.

### 4.3 Push (protocol v1, receive-pack)

| # | Client | Proxy | Response |
|---|---|---|---|
| 1 | `GET /info/refs?service=git-receive-pack` | Biscuit has `push`; cached `createToken("write", 3600)` | measured: `report-status report-status-v2 delete-refs atomic ofs-delta side-band-64k`, no `push-options` |
| 2 | `POST /git-receive-pack`: commands `<old> <new> <ref>`, then `PACK` | parse commands from the stream head; allow only `refs/heads/main`, `refs/wip/<sprout>/<own session>`, `refs/notes/beanstalk`; Biscuit `writer_generation` must equal the Project DO's; otherwise reply `ng <ref> sprout-adopted` without forwarding | report-status |
| 3 | | tee the response; for each `ok` line, RPC `pushed {ref, old, new}` to the Project DO in `waitUntil` | |

This is where branch protection lives: Artifacts has no server hooks (`claude-04` §4), but every agent push crosses our Worker. A push is 2 HTTP requests, 3 when the pack exceeds `http.postBuffer` (git sends a 4-byte probe POST first; measured). The agent sees an ordinary HTTPS remote, an occasional `! [remote rejected] … (sprout-adopted)`, and nothing secret in `.git/config`. In a container the Biscuit is readable by the agent by design: it grants one sprout for at most an hour.

### 4.4 Hands-on probe (2026-10-03)

Account `2c7358a6…` (the one with Artifacts; `e40385e6…` has no namespaces), laptop in Hong Kong via colo SIN, git 2.53.0. Created repo `probe` in namespace `beanstalk-rnd` (`wrangler artifacts repos create probe --namespace beanstalk-rnd`; the namespace is created implicitly), pushed two commits of 20 random 67 KB files. Commands: `GIT_TRACE_PACKET=1 git -c protocol.version={1,2} ls-remote`; `GIT_CURL_VERBOSE=1 git push`; clones with no flag, `--depth 1`, `--filter=blob:none [--no-checkout]`, `--filter=tree:0`, `--depth 1 --filter=blob:none --sparse`; `git sparse-checkout set --cone app/src`; `git cat-file -p` on a missing blob; six `commit-tree` checkpoints pushed to `refs/wip/sprout-1/sess-a` with `--force-with-lease`; a stale lease; a notes push; `push --delete`; a clone through a credential helper.

| Probe | Result |
|---|---|
| v2 capabilities | `fetch=shallow filter sideband-all`: `filter` is advertised (docs only say v1 lacks it) |
| `--filter=blob:none --no-checkout` | 0.62 s; 2 KB pack; 22 blobs missing as promised |
| `--filter=tree:0` | HTTP 400, `expected 'packfile'` |
| Sparse checkout of 20 files | one batched lazy fetch, 0.91 s |
| Single lazy blob | 0.46 s |
| Full / shallow clone | 1.87 s / 1.23 s |
| `ls-remote` ×5 | 0.33, 0.39, 1.46, 0.39, 0.37 s |
| Checkpoint pushes | 0.38, 1.44, 1.35, 0.52, 1.44, 3.57 s |
| Stale `--force-with-lease` | rejected `(stale info)`, 0.26 s |
| Push from shallow / blobless clone | accepted, 0.60 s / 0.36 s |
| `refs/wip/*`, `refs/notes/*`, ref delete | accepted |
| Fetch `+refs/wip/*` / no-op fetch | 0.95 s / 0.40 s |
| No auth / bad token | `401 Basic realm="artifacts"` / `403 Invalid or expired token` |

The repo remains; its create-time write token expires 2026-10-04 00:04 UTC. Virginia numbers come from B12.

## 5. Per-actor design

| Actor | Checkout | Write path | Learns of others | Its edits become visible |
|---|---|---|---|---|
| Local Claude Code | `beanstalk start <intent>`: claim, fork, `git worktree add` with origin = sprout, then exec `claude` there (a SessionStart hook cannot change cwd) | native tools on disk; agent commits to the sprout's `main` | SessionStart `additionalContext` with overlaps; MCP `status`; `repo_read_file` at other sprouts' refs | tier 1, tier 2, bean at Stop |
| Local Codex | `beanstalk start --harness codex` | `apply_patch`, shell | same | same |
| Claude Code under Remote Control | identical to local: the executor is the machine running `claude` | same | same | same; the phone sees chat and its diff pane, the canvas the rest |
| Remote harness container | `beanstalk start --headless` in the Sandbox: shallow or blobless clone via the proxy; Biscuit from the Worker over `agentd`'s local socket | same tools, container disk | MCP | same; stream-json also forwarded by the Worker |
| Worker planner or judge | none | `repo_commit` for small non-code files (intents, notes) via isomorphic-git | DO RPC subscription | its commits go through the same proxy |
| Human reviewer | canvas, or `beanstalk watch` mirror | none while an agent holds the sprout; `adopt` or `fork` | WebSocket | n/a |

Claude Code plugin hooks (`packages/claude-plugin/hooks/hooks.json`; stdin fields used: `session_id`, `cwd`, `tool_name`, `tool_input.file_path`, `tool_use_id`, `tool_response`):

| Event | Matcher | Command | Does | Budget |
|---|---|---|---|---|
| SessionStart | `startup\|resume` | `beanstalk hook session-start` | check cwd is a sprout worktree; start `agentd`; return intent and overlaps as `additionalContext` | 300 ms |
| PreToolUse | `Edit\|Write\|NotebookEdit\|Bash` | `beanstalk hook pre-tool` | read the lease file `agentd` keeps; if adopted, exit 2 with `sprout adopted by <human>; stop and summarise` | 20 ms, no network |
| PostToolUse | `Edit\|Write\|NotebookEdit` | `beanstalk hook post-edit` (async) | pass path and `tool_use_id` to `agentd` for attribution | 10 ms |
| PostToolUse | `Bash` | same | pass `bashEditDiff.changedFiles` when present | 10 ms |
| Stop | | `beanstalk hook stop` | force a checkpoint and wait for the push | 3 s |
| SessionEnd | | `beanstalk hook session-end` | final checkpoint; `submit_bean` if the intent is done | 5 s |

Matchers of only letters and `|` are exact lists, so `Edit|Write` does not regex-match `NotebookEdit` unintentionally (hooks page).

Codex (`.codex/hooks.json`): SessionStart as above; PreToolUse `^(apply_patch|Bash)$` denies with `permissionDecision: "deny"` when adopted; PostToolUse `^apply_patch$` parses `*** Update File:` and `*** Add File:` lines from `tool_input.command`; Stop checkpoints. Builds without hooks fall back to `notify` (checkpoint per turn). The container image ships these as managed config so the trust prompt does not block.

Why a watcher as well as hooks: hooks see tool calls, not files. Formatters, codegen and `sed` change files without an Edit call; Claude Code calls `bashEditDiff` "best effort" and Codex calls its hooks "a useful guardrail, not a complete enforcement boundary". `agentd` watches the worktree (FSEvents on macOS, inotify in containers, ignoring `.git/` and ignored paths) and is the source of truth for what changed; hooks add attribution.

## 6. The live-edit channel

### 6.1 Two tiers

| | Tier 1: event stream | Tier 2: wip push |
|---|---|---|
| Trigger | any change seen by `agentd`, coalesced per path for 200 ms | 3 s after the last change, 15 s cap, plus Stop and SessionEnd |
| Carries | `{sprout, session, seq, path, op, tool_use_id, sha256, size, content?}`, content gzipped if ≤ 256 KB | a commit on `refs/wip/<sprout>/<session>` |
| Path | `agentd` → `POST api.beanstalk.dev/v1/sprouts/<id>/events` → Project DO → WebSocket | push through the proxy → RPC to Project DO → WebSocket; Queue event confirms |
| Latency | est. 0.2 to 0.8 s (200 ms coalesce + 100 to 300 ms POST + ~50 ms fan-out) | 3 s + 0.4 to 3.6 s push (measured) + ~0.1 s ≈ 3.5 to 6.7 s |
| Trust | a claim, labelled "live" | content-addressed SHA, labelled "durable" |
| Artifacts ops | 0 | 1 push, +1 fetch per following mirror |

The checkpoint never touches the agent's index or HEAD (tested in the probe):

```sh
export GIT_INDEX_FILE=.git/beanstalk/wip-index
git read-tree HEAD && git add -A && TREE=$(git write-tree)
C=$(git commit-tree "$TREE" -p "$LAST_WIP" -p "$(git rev-parse HEAD)" \
      -m "wip: 3 files" -m "Beanstalk-Session: s-01J9ZQ")
git push --force-with-lease="refs/wip/sprout-7f3/s-01J9ZQ:$LAST_WIP" \
    origin "$C:refs/wip/sprout-7f3/s-01J9ZQ"
```

The second parent is added only when the agent committed since the last checkpoint, which keeps the wip ref fast-forwarding.

Prior art:

| Source | What it does | Taken |
|---|---|---|
| Entire (https://github.com/entireio/cli) | Snapshots the worktree on Claude Code `Stop` to a local shadow branch it "never pushes"; at each user commit writes one ref per checkpoint, `refs/entire/checkpoints/<shard>/<id>`, so "there is no shared branch tip for concurrent sessions to contend on" | per-session refs, never on the user's branch; we push, because the observer is elsewhere |
| jj (https://jj-vcs.github.io/jj/latest/working-copy/) | "automatically create commits from the working-copy contents when they have changed"; `fsmonitor.watchman.register-snapshot-trigger` snapshots on file change | working copy as a commit, watcher-triggered |
| Cursor (https://cursor.com/blog/fast-regex-search) | index based "off a commit ... User and agent changes are stored as a layer on top of it" | tier 2 is the commit, tier 1 the layer |
| Mutagen (https://mutagen.io/documentation/synchronization) | `one-way-replica`: "beta becomes an exact replica of alpha" | the mirror is a one-way replica; two-way sync is what the one-writer rule avoids |

### 6.2 Remote agent edits, human sees it locally

```
container claude -p     agentd            Project DO          git-proxy   Artifacts   laptop: beanstalk watch
 Edit src/tax.ts ─────▶ fs event
 PostToolUse ─────────▶ +tool_use_id
                        +200 ms
                        POST event ──────▶ seq=41
                                           WS ───────────────────────────────────────▶ write file in mirror
                                                                                        (~0.5 s: editor reloads,
                                                                                         git diff shows the hunk)
                        +3 s idle: commit
                        git push ───────────────────────────▶ check gen ─▶ receive-pack
                                                              ok ◀─────── ok
                                           ◀── RPC pushed ────┘
                                           seq≤41 durable
                                           WS "wip c9e1" ────────────────────────────▶ git fetch wip ref,
                                                                                        read-tree -u (~5 s: git log
                                                                                        shows it, git diff empty)
                                                             Queue repo.pushed ─▶ DO confirms (idempotent; delay UNVERIFIED)
```

| Moment | Editor | `git diff` in mirror | `git log` in mirror | Human's Claude Code (`--add-dir <mirror>`) |
|---|---|---|---|---|
| after tier 1 (~0.5 s) | new content (editors reload) | the agent's uncheckpointed hunk | unchanged | Read and grep see new content |
| after tier 2 (~5 s) | same | empty | new `wip:` commit, SHA as on canvas | `git show` works |
| after submit | same | empty | bean on `origin/main`; wip ref gone | same |

The mirror is a detached `git worktree` owned by the CLI and kept read-only (`chmod a-w` after each write). A seq gap or missing content marks the path stale until tier 2.

### 6.3 Human edits locally while an agent works remotely

```
human laptop                          Project DO                      container agent
 watching (read-only) ◀──── live ──────────────────────────────────── editing
 (a) beanstalk fork ────────────────▶ fork from latest wip SHA         continues
     new sprout, lease = human        same intent ──▶ alternative worlds
 (b) beanstalk adopt ───────────────▶ gen 7 → pending
                                      WS "adopt" ───────────────────▶ agentd writes lease file
                                                                      next PreToolUse: exit 2
                                                                      Stop: final checkpoint (gen 7)
                                      pushed; gen := 8 (human); revoke agent Biscuit
     mirror → writable at that SHA ◀─ "adopted, gen 8"
     laptop agentd now emits tier 1/2 for the human
 (c) beanstalk suggest <patch> ─────▶ handoff note via MCP ──────────▶ agent applies it itself
```

PreToolUse blocks the next tool call at once, but a running Bash command finishes first. If the agent has not reached Stop within 30 s, the DO bumps the generation anyway; the proxy rejects its late push, and tier 1 events after the cut are kept as "orphaned" for the human to inspect.

### 6.4 What the Project DO stores

| Table | Columns | Retention |
|---|---|---|
| `live_events` | sprout, session, seq, path, op, tool_use_id, sha256, size, ts, durable_sha | last 500 per sprout |
| `live_content` | sprout, path, sha256, gz ≤ 256 KB | latest per path, dropped at submit |
| `wip_heads` | sprout, session, ref, sha, paths, pushed_at, queue_confirmed | until submit |
| `writer_lease` | sprout, holder, generation, state, expires_at | life of sprout |

WebSockets hibernate, tagged per sprout and per project, so idle watchers cost nothing (https://developers.cloudflare.com/durable-objects/best-practices/websockets/). The DO does not tree-diff wip pushes: `agentd` already sent the paths and the push confirms them by SHA. Tree diffs (`claude-15` §3.2) run for bean pushes and when the canvas opens a diff.

### 6.5 Refs, squash and cost

- Refs: `refs/wip/<sprout>/<session>`. Not in the default refspec, so plain clones skip checkpoints; watchers add `+refs/wip/*:refs/remotes/origin/wip/*` (https://git-scm.com/docs/git-fetch).
- Squash: wip commits never enter a bean. The bean is the agent's commits on `main` plus one final commit if dirty. Submit is one `git push --atomic` (advertised) that moves `main` with `--force-with-lease`, deletes the wip ref, and writes `refs/notes/beanstalk` with the last wip SHA for audit.
- Per checkpoint: 1 push op ($0.00015) + 1 fetch op per following mirror ($0.00015). Storage: est. 5 KB of new blobs; whether Artifacts collects unreachable objects is UNVERIFIED, so the sprout reaper (`claude-04` §10) bounds it.
- Demo day: 6 sprouts × 2 h × 240 checkpoints/h (one per 15 s) = 2,880 pushes + 2,880 mirror fetches = 5,760 ops × $0.00015 = $0.86.
- Swarm: 1,000 agents × 8 h × 240/h = 1.92M pushes = $288/day. At one checkpoint per turn (est. 60/h) it is 480k = $72/day, and tier 1 keeps the live view. Default: 15 s cap while someone watches the sprout (the DO knows), per turn otherwise.
- Rate limit: a checkpoint every 3 s plus three mirrors is ~4 requests/s against 200/s per repo.

### 6.6 What the canvas shows

Each sprout card gets a file lane: touched paths with tool and age, dotted while live, solid with a short SHA once durable; click opens the diff. Overlap badges use live paths, so "two sprouts are editing `billing/invoice.ts`" appears within a second instead of after a bean. The card also shows the lease holder with Adopt and Fork.

## 7. Conflicts and policy

| Rule | Mechanism |
|---|---|
| One writer per sprout | `writer_lease` generation in the Project DO, copied into each write Biscuit, compared by the proxy on every receive-pack |
| Sessions never share a ref | the session is in the ref name; the proxy rejects pushes to another session's ref |
| Stale writers cannot clobber | every wip and bean push uses `--force-with-lease=<ref>:<last seen>` (rejected in 0.26 s, measured); the generation check also catches a writer whose lease moved while its SHA is current |
| Adoption | explicit, by a human with rights on the intent; 30 s grace to checkpoint; then generation bump and Biscuit revocation |
| Fork on collision | a second actor gets a new sprout from the latest durable SHA; the two become alternatives under one decision (`claude-10`) |
| Path leases (`claude-10`) | advisory, now fed by tier 1 paths; the writer lease is the only hard lock and covers one sprout |

## 8. Bench plan (by 2026-10-08), extending `claude-15`

| # | Experiment | Pass |
|---|---|---|
| B11 (partly done) | Done: v2 advertises `filter`, `blob:none` works, `tree:0` fails. B11b: depth 1 + blobless + sparse on 100 MB; count lazy fetches during `npm test`, `git log -p -5`, `git blame` | trees-only clone < 3 s; < 20 lazy fetches per test run |
| B11c | ArtifactFS in a Sandbox: mount time; hydration requests during a full `rg` of 100 MB | mount < 5 s and < 1,000 requests per 10 s, else stays deferred |
| B12 (extended) | add clone, fetch and push through `git-proxy` versus direct, from Virginia and the HK laptop | proxy adds < 50 ms p50 per request; 100 MB clone within 10% of direct |
| B14 | proxy CPU and throughput on a 500 MB pack | CPU < 5 s; no 1102 errors |
| B15 | `beanstalk hook post-edit` over 200 edits | p95 < 15 ms |
| B16 | tier 1: container edit to file in laptop mirror | p50 < 1 s, p95 < 2 s |
| B17 | tier 2: edit to `git log` in mirror | p50 < 6 s, p95 < 10 s |
| B18 | Queue `repo.pushed` versus proxy notification | proxy first in 99% |
| B19 | adoption with an agent mid-turn | done < 35 s; no late push accepted |
| B20 | 50 scripted changes via Edit, Write, `sed`, `prettier --write`, codegen | 100% seen by `agentd`; ≥ 90% attributed to a tool call |
| B21 | Codex hooks: paths from `apply_patch`, lease deny | all paths; deny stops the patch |

## 9. Demo cut for Oct 14

Ship: `git-proxy` (Biscuit verify, token cache, ref policy, push notification); `beanstalk login`, `credential`, `start`, `watch`, `adopt`, `fork`; `agentd` with both tiers; the Claude Code plugin hooks above; Project DO tables and WebSocket; the canvas file lane; full or shallow clone only (the demo app is about 5 MB). On stage: a container agent edits, the laptop mirror shows it in VS Code and `git diff` within a second, the checkpoint lands in `git log` seconds later, then the owner clicks Adopt and keeps typing.

Deferred: blobless and sparse as defaults (flag only), ArtifactFS, Codex hooks beyond `notify` if B21 slips, `beanstalk suggest`, Windows, two-way live co-editing.

## 10. What kills it, and open questions

What kills it:

1. Proxy throughput. If B14 fails, containers fall back to direct Artifacts with a token held by `agentd` outside the agent's process, a weaker form of the identity rule, documented as such.
2. Hook drift. Claude Code's surface moves (MultiEdit gone, Glob and Grep moved to Bash). Because `agentd` is the source of truth, drift costs attribution, not correctness.
3. Remote Control needs a subscription login and refuses a custom `ANTHROPIC_BASE_URL`, so those sessions' spend is invisible to AI Gateway and their bean cards cannot show cost.
4. Unthrottled checkpoints at swarm scale ($288/day at 1,000 agents).
5. Tier 1 is a claim. A compromised machine can show edits that never land; the UI must keep live and durable distinct, and the Integrator reads only durable SHAs.

Open questions for the owner:

1. Is a read-only mirror enough for "see it locally", or do you want two-way co-editing in one sprout? This design says no; yes costs a CRDT or a per-file lock.
2. Checkpoint cadence when nobody watches: per turn (cheaper) or 15 s?
3. Should `beanstalk watch` also launch the human's own Claude Code on the mirror so they can question the agent's live work?
4. Accept the weaker fallback in kill item 1 if B14 fails?
5. Keep `beanstalk-rnd/probe` for B11b and B12, or delete it afterwards?
6. Will the demo be recorded from a US machine? Hong Kong to SIN numbers above may not represent it.
