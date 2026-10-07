# @beanstalk/gateway

The race gateway (plan `docs/claude-opus/10-cf-prototype-plan.md`, items 2–3 of §7). It is a Worker that runs agent races in the cloud. It does four things:

- holds one Durable Object per run (`RunDO`), which runs a deterministic race engine;
- hands work to Python driver slots over long polls;
- proxies git for the agents, which never hold Artifacts tokens;
- drives the runner container for squashes, reverts, suites and ref updates.

It also serves the web app over RPC (see [RPC for the web app](#rpc-for-the-web-app)), and runs **repository engines**: a continuous engine per persistent repository, where `git push` submits a bean (see [Repository engines: the git-native flow](#repository-engines-the-git-native-flow)).

The engine ports two harness policies, `queue` (the baseline) and `beanstalk-v2` (the product). v2 runs the v2.5 rules by default (see [The v2.2 to v2.5 rules](#the-v22-to-v25-rules)). Every run logs `events.jsonl` in the harness schema and writes a `summary.json`, so `research/race` tools (`summary.py`, `report.py`, `kth_green.py`) read cloud runs unchanged.

## Names

| Public name (API, refs, live page) | What it is | Harness name (events, summary) |
|---|---|---|
| **bean** | One agent's change: the branch `refs/heads/beans/<task>` of the run repo `race-<run>`, pushed by the driver | task worktree, `task/<id>` |
| **sprout** | The staged line `refs/heads/sprout` of the run repo `race-<run>`. Beans land here after their pre-land check passes | `trunk` (`trunk_idx`, `land.target: "trunk"`) |
| **stalk** | The stable line `refs/heads/stalk`. It only moves to validated commits and is the run repo's default branch | `green` (`green.promote`, `green_idx`) |

Event types and field names stay identical to the harness. The queue has no staged line: it lands verified batches straight on the stalk, and its `land` events keep `target: "main"`. Prompts are the harness's, word for word, so they still say "trunk" and "main"; v2's conflict rework is the one exception (below).

### Why a bean is a branch, not a fork

The first deployed build forked one Artifacts repo per bean, lazily. Forks made after the first landing were unreadable: upload-pack answered 500, and pushes failed with `delta base is missing`. A new fork could also stay invisible for a moment (`NOT_FOUND`), which aborted races. Forking every bean eagerly at the seed would avoid the observed bug, but it would still depend on forks behaving.

A bean is now a branch of the run repo:

- Every object lives in one store. A fetch from `bean_url` finds the sprout, the stalk and every bean, and a push's delta bases are always there.
- Nothing is created per task, so nothing per task can fail before the work starts, and a finished run leaves one repo to reap.
- The proxy keeps the isolation that matters. It reads each push's command list and accepts only the slot's own `refs/heads/beans/<task>`, never a deletion.
- Reads are open within the run, as in the local harness, where every worktree shares one repository.

A runner job that keeps failing for one bean drops only that bean, with reason `infrastructure failure: …`. Failures on the shared lines (the sprout, the stalk, tickets) still abort, because the state of those lines is then unknown.

## Routes

| Route | Auth | Purpose |
|---|---|---|
| `GET /healthz` | none | Liveness |
| `POST /v1/runs` | admin | Create a run from a `RunConfig` (`@beanstalk/shared-race/run-config`). Creates the run repo and returns slot tokens and a view link. `201` |
| `POST /v1/runs/:run/seed-token` | admin | A 15-minute token that pushes the arena base to the sprout **and** the stalk, before the start only |
| `POST /v1/runs/:run/start` | admin | Starts the race from the seeded base. `409 repo_not_seeded` until both refs exist and agree |
| `POST /v1/runs/:run/stop` | admin | `{reason?}`. Aborts the race, which then runs the final check |
| `POST /v1/runs/:run/tokens` | admin | Re-issues the slot tokens |
| `POST /v1/runs/:run/decisions/:card` | admin | v2: `{winner, text?}` answers a decision card (logged as `human:admin`) |
| `POST /v1/runs/:run/reap` | admin | `{dry_run}` (default `true`). A dry run lists the run's Artifacts repos: `race-<run>`, plus any `race-<run>-*` left by earlier gateways. `{"dry_run": false}` deletes them. `409` while the race runs. A run deletes its own repos after its final check unless it set `keep_repo` (see [Spend guards](#spend-guards)) |
| `GET`, `POST`, `DELETE /v1/admin/halt` | admin | The kill switch: `POST {reason?}` refuses new runs and starts (`503 halted`) and stops every run not yet done; `DELETE` turns it off |
| `POST /v1/admin/sweep` | admin | `{older_than_hours}` (default 24). Runs the hourly repo sweep now |
| `GET /v1/runs/:run` | admin, view or slot token | The run view (state, slots, CI, cost, `policy_state`) |
| `GET /v1/runs/:run/summary` | reader | `summary.json` |
| `GET /v1/runs/:run/events?after=&limit=&format=json\|jsonl` | reader | The event log. `jsonl` is byte-for-byte `events.jsonl` |
| `GET /v1/runs/:run/live` | reader (`?key=`) | WebSocket feed: the view, then each step's events |
| `GET /runs/:run?key=<view token>` | view token in the page URL | Live page: lanes, sprout and stalk, beans, decision cards, CI, cost |
| `GET /runs/:run/streams?key=<view token>` | reader (`?key=`) | `stream_diffs`: WebSocket of the run's `RunStreamDO`: every bean's summary, and snapshots and patches of the beans the socket subscribes to (see [Streaming diffs](#streaming-diffs)) |
| `POST /v1/runs/:run/agents/:slot/next` | slot token | Long poll, up to 25 s, for the slot's next invocation |
| `POST /v1/runs/:run/invocations/:inv/result` | slot token | The invocation's result, posted after the driver commits and pushes |
| `POST /v1/runs/:run/invocations/:inv/progress` | slot token | `{cost_usd, files?}`, the running estimate. The answer can tell the driver to abort, or carry a mid-run sync offer (`live_sync_midrun`) |
| `POST /v1/runs/:run/invocations/:inv/stream` | slot token | `stream_diffs` only: the bean's working change while its agent writes (see [Streaming diffs](#streaming-diffs)). `409 stream_off` when the run does not stream, `409 closed_invocation` once the invocation ended, `404 unknown_invocation` before the invocation is open for streaming |
| `/git/<owner>/<repo>.git/*` | `git` or `view` token of that repository's engine, as Basic password or Bearer | The git-native flow (`docs/claude-opus/18-git-native-flow.md`): clone and fetch; a push to `refs/heads/bean/<name>` submits a bean and answers with `remote:` lines (`-o wait` holds it for the verdict); pushes to `sprout`, `stalk`, `main`, other branches and deletions are refused in the protocol |
| `POST /v1/repos` | admin | Opens a repository engine (`openRepoEngine`'s input; `create_artifacts_repo: true` also creates a missing Artifacts repo). `201` new, `200` existing |
| `POST /v1/repos/:engine/git-token` | admin | `{user: {id, handle}, ttl_seconds?}`: a `git` token for the engine |
| `GET /v1/repos/:engine/beans` | admin | The pushed beans: phase, reason, task, actor, verdict lines |
| `POST /v1/repos/:engine/close` | admin | `{delete_repo}`: stops the engine; with `delete_repo` deletes its Artifacts repo |
| `/git/<namespace>/<repo>.git/*` | slot or seed token, as Bearer or Basic password | Git smart-HTTP proxy. A slot reads the run repo and pushes only its own bean branch `refs/heads/beans/<task>`; the proxy refuses other refs and deletions. The seed token pushes the sprout and the stalk before the start. Bodies stream through; a redirect from the Artifacts remote is never passed on (`502 upstream_failed`); the gateway mints a short-lived Artifacts token server-side |

Errors are `{"error": {"code", "message", "issues?"}}`. Run tokens are `bst1.<claims>.<HMAC>` with scope `slot`, `seed`, `view`, `contributor` or `git`. Every git request's credential is checked by `verifyGitCredential` (`src/auth/git-credential.ts`), the one function user tokens will extend.

## A run, end to end

```bash
GW=http://localhost:8787; A="Authorization: Bearer $ADMIN_TOKEN"
RUN=$(curl -s -H "$A" -H 'content-type: application/json' -d @run.json $GW/v1/runs | jq -r .run)
SEED=$(curl -s -H "$A" -X POST $GW/v1/runs/$RUN/seed-token | jq -r .token)
git -C arena -c http.extraHeader="Authorization: Bearer $SEED" \
  push $GW/git/beanstalk-race/race-$RUN.git $BASE:refs/heads/sprout $BASE:refs/heads/stalk
curl -s -H "$A" -X POST $GW/v1/runs/$RUN/start          # {"run":…,"phase":"running","base_sha":…}
# start one driver per slot with its slot token; then:
curl -s -H "$A" "$GW/v1/runs/$RUN/events?format=jsonl" > events.jsonl
curl -s -H "$A" $GW/v1/runs/$RUN/summary > summary.json   # infra cost under "infra"; repos reaped
```

`run.json` is the harness's `RaceConfig` with the same names and defaults, plus `tasks`, in the arena JSON format. v2 adds these fields:

- `preland_mode`: `optimistic` (the default) or `locked`;
- `preland_seconds`: `null` (the default) means `ci_seconds`;
- `decision_seconds`: 30 by default;
- `decision_oracle`: `landed` (the default), `arriving` or `none` (wait for the admin);
- `start_order`: `fifo` (the default) or `dependency` (see [Dependency-aware starts](#dependency-aware-starts));
- the v2.2 to v2.5 rules, all on by default except `validation_first`: `window`, `recheck`, `recheck_fallback`, `release_on_check`, `flake_confirm`, `inherited_reds`, `early_tickets`, `reconcile`, `decision_outcome`, `decision_mode`, `human_timeout_seconds`, and v2.5's `escalate_after`, `reconcile_parties`, `single_suspect_revert`, `base_culprits`, `validation_first` and the `window_*` sizes (see [The v2.2 to v2.5 rules](#the-v22-to-v25-rules));
- E6's remaining rules, also on by default: `start_cards`, `rescue` and `dynamic_culprits` (see [Start cards, rescue and dynamic culprits](#start-cards-rescue-and-dynamic-culprits-e6));
- the v2.5 forge-owned tests, both off by default: `tests_first` and `targeted_landing_check` (same section);
- `live_sync`: `off` (the default), `overlap` or `all` (live sprout sync, same section);
- `live_sync_midrun`: `false` (the default) or `true` (mid-run sync, same section);
- `suite` (`@beanstalk/shared-race/suite`): the test suite of a real-task arena. `argv` (the whole suite: `node`, its options, `--test`, the globs), `files_argv` (chosen files are appended: confirm runs, targeted checks, leave-one-out probes), `env`, `deps` (the runner image's dependency snapshot, `/opt/arena-deps/<name>`), `timeout_seconds` and `test_hint` (the sentence every prompt's acceptance line and `live_sync` prompt give; test-author and reconcile prompts name `files_argv`). Every check the run makes sends it: pre-land, validation, re-checks, confirm runs, targeted checks and the final check. The driver (`remote.py`) sends the arena's `arena.json` suite (`harness/suite.py`, `gateway_suite`) and nothing for the designed arena, whose bare `node --test` is the default. Argv and environment are validated here (node only, `--test` required, no shell, no runner-owned variables) and again by the runner. A fastify task's prompts are byte for byte the harness's, so the GitHub arm's (`prompts.test.ts` against `test/fixtures/fastify-prompts.json`, which `research/race/gateway_fixture.py` writes and the Python tests keep current).

## Spend guards

Artifacts bills from 2026-10-14 ($0.15 per 1,000 operations, $0.50 per GB-month), and a forgotten repo bills until deleted.

- **Reap after the final check.** When a run reaches `done` its RunDO deletes its repos (`reapRepos`) and records the outcome; `summary.json`'s `repos` says `live`, `reaping`, `reaped`, `reap_failed` or `kept`. `keep_repo: true` keeps them for browsing. The reap runs in the background, so `/summary` waits up to 5 s for one in flight: a capture right at `done` sees `reaped` or `reap_failed`. Once every repo is gone the read index's cached git objects are deleted too.
- **Hourly sweep.** `RunIndex` keeps an alarm while run repos remain. Each hour it lists the namespace's `race-*` repos once and asks each run's RunDO, passing it its own repo names, to delete them when the run began more than 24 hours ago, or is unknown (orphans). A run still racing is skipped and retried next hour. The RunDO of an orphan (a run this gateway never held) deletes its own storage afterwards, so a sweep leaves no empty tables behind.
- **Spend cap.** `max_usd` (off by default, as before) aborts a run when agent spend plus its measured infrastructure cost reaches it; the abort reason starts `budget (max_usd)`, so the driver exits 2 as for `budget_usd`. `budget_usd` still caps agent spend alone.
- **Kill switch.** `POST /v1/admin/halt` (see Routes).
- **Runner capacity waits.** A runner instance that cannot start is waited for inside the runner client for up to about 4 minutes (see the runner client notes under the engine's runner instances), so a capacity squeeze delays work rather than dropping beans; each wait is a `warn` log line.
- **Infrastructure cost.** Each RunDO meters what it uses (`src/run/infra-meter.ts`): Worker and DO requests (every RPC, the collaboration calls included), DO active time, Artifacts operations (binding calls, proxied git requests, one fetch per runner call) and runner container busy and up time (`sleepAfter` tails counted once per instance; the committer and CI instances are pre-warmed at `start`, and that up time counts too). The meter lives in memory and is stored with every stored step, by `/summary`, and otherwise at most every 5 s. `summary.json`'s `infra` has the counts and their cost at list prices; the RunDO also logs it as `run cost` when the run is done. The figures are estimates: see `docs/claude-opus/15-explainer-for-coop.md` §2, "Cost".

### What a RunDO stores per step

The engine state is one KV value (0.4 to 1.5 MB in a real race; a Durable Object value holds at most 2 MB), written with the step's events. Most steps are long-poll bookkeeping (88% of the 3,567 steps of a 30-agent replay are `poll` or `poll-expired`), so `src/run/step-writes.ts` decides what a step needs: a `poll`, `poll-expired` or `progress` step that emitted no event, started no job, answered polls only with `wait` and left the rest of the state as it was (a fingerprint of the counters, phase, slots without their `pollId`, timer, job and invocation ids, policy and CI state) stays in memory. A restart clears poll ids and recomputes the clock anyway. A `progress` estimate is folded into the next stored step, or stored on its own after 30 s; the spend checks read the in-memory state, so they see it at once. Quiet steps also skip the run index update and the live feed.

Open invocations store landed acceptance tests by reference (`{task, path}`) and the fresh-session prompt only when it differs from the prompt; `toInstruction` reads the contents at delivery, so the driver's instruction is as before. States stored before this hold full files, which are delivered as they are. The contents are the tests' effective contents at delivery rather than at creation; they differ only if a decision amended a landed task's tests in between, and then the driver gets the amended version.

Every 50 stored steps the RunDO logs the state's size (`run state size`, `stateBytes`) and warns when it first reaches 1 MB and 1.5 MB. A step that cannot be stored (too large, or storage failed) is logged with its size, every held poll is answered `wait`, and the run stays at its previous step.

## Driver contract (for the Python driver)

`POST /v1/runs/:run/agents/a0/next` returns one of these:

```json
{"invocation": {
  "inv": "inv0007-rework", "kind": "rework", "task": "t002", "slot": "a0", "attempt": 1,
  "prompt": "Your change was not landed. Merged onto the latest trunk, these tests failed:\n…",
  "resume": "2d054156-…", "adapter": "claude", "model": "sonnet", "max_turns": 40,
  "timeout_seconds": 900, "budget_cap_usd": 3,
  "replay": {"reset_to": "9e52f41…", "check": "acceptance", "fixes": []},
  "workspace": {
    "bean": "beans/t002",
    "bean_url": "https://gw/git/beanstalk-race/race-k3x9q2m7ab.git",
    "repo_url": "https://gw/git/beanstalk-race/race-k3x9q2m7ab.git",
    "branch": "beans/t002",
    "base_sha": "26eecce…", "head_sha": "2fdd264…",
    "merge": {"sha": "9e52f41…", "ref": "refs/heads/sprout", "conflicts": []},
    "acceptance": {"tests/t002.test.ts": "…"},
    "protect": [{"path": "tests/t001.test.ts", "content": "…"}],
    "union_paths": ["CHANGELOG.md", "CHANGELOG*.md", "**/CHANGELOG.md"],
    "commit_message": "Task t002\n\nTask: t002\nKind: rework\nInvocation: inv0007-rework\n"}},
 "token": {"token": "bst1.…", "expires_at": "…"}}
{"wait": true}
{"done": true, "aborted": null}
```

`token` appears only when the slot token is past half its life. Replace the old token with it.

**A lost reply is re-delivered.** When a slot polls again while its invocation runs, before the driver posted any progress for it and within 120 s of its delivery, the reply that carried it was most likely lost (a dropped long poll). `next` then answers the same invocation again, same `inv`, as at its first delivery, with no new `invocation.start`. The `token` refresh is decided by the route from the polling request's own token, so a re-delivered reply carries a refreshed `token` exactly when a first delivery would have; a refresh lost with the first reply is issued again. The driver treats a delivery of the invocation it is already running as a no-op (and re-posts the result of one it already finished). After the first progress report, or after 120 s, the poll waits as before and a lost invocation ends at the watchdog.

`kind` is one of these:

- `initial`;
- `rework`;
- `fixer` (the queue only);
- `test-author` (v2.2 cards);
- `reconcile` (v2.4: a test author amends both clashing tasks' acceptance tests on the arriving bean's branch; like `test-author`, only changes to the `acceptance` files are committed);
- `test-first` (v2.5 `tests_first`: a fresh session writes the task's acceptance tests from its intent before the implementer starts; `acceptance` is empty and `head_sha` null; the driver commits only the new test files it created, the paths `node --test` picks up by default, and discards every other change);
- `sync` (`live_sync`: beans landed while the bean's agent worked; the driver runs it as a rework: `merge` is the sprout head, which the gateway's squash found clean, the session resumes, and the commit is a merge commit. If the merge conflicts in the driver anyway, it aborts the merge, runs no agent and posts `ok` with subtype `sync-conflict` and no `head_sha`; the bean then lands as it was).

With `release_on_check`, a rework can come to any slot. Its `resume` names the author's session. So the driver runs every invocation in the bean's own directory (`work/agents/<task>`), whichever slot it came to, and the session resumes there. Sessions live on the machine that ran them, so `remote.py` drives every slot of a run from one process. A resume that fails is retried once as a fresh session.

For each invocation:

1. Check out the bean at `head_sha`, or `base_sha` before the first push.
2. If `merge` is set, fetch `merge.ref` from `repo_url` and merge `merge.sha` with `--no-commit --no-ff`. Skip this when `merge.sha` is already an ancestor.
3. Run the agent.
4. Restore `acceptance`, and restore each `protect` file whose content is in the lineage.
5. Commit with `commit_message`, unless conflict markers are left. A `test-author` invocation is the exception: its `acceptance` files are the tests to amend, written at the start and never restored, and the driver commits changes to those files only, discarding any other change. A `test-first` invocation commits only the new test files it created.
6. Push `branch` to `bean_url`.
7. Post the result:

```json
POST /v1/runs/:run/invocations/inv0007-rework/result
{"ok": true, "subtype": "success", "cost_usd": 0.0907, "cost_source": "reported-delta",
 "num_turns": 9, "wall_ms": 21830, "session_id": "2d054156-…",
 "pushed_ref": "refs/heads/beans/t002", "head_sha": "66a517d…", "new_commit": true,
 "files": ["src/notifications/templates.ts"], "tamper": [], "markers_left": [],
 "merge_conflicts": null, "infra_error": null}
→ 200 {"accepted": true}
```

The result body is `InvocationResult.to_event()` plus the git fields. Unknown keys are dropped. `merge_conflicts`, when not null, is recorded in the `invocation.end` event. `turns` and `wall_seconds` are accepted as fallbacks for `num_turns` and `wall_ms`.

Progress uses the same shape: `POST …/progress {"cost_usd": 0.02}` answers `{"abort": false}`, or `{"abort": true, "reason": "budget: …"}`. With `live_sync_midrun`, the driver adds `files` (the paths the agent changed since `base_sha`) and an answer may carry `sync`: `{"sprout": "<sha>", "landed": [{"task", "title", "files"}]}`, the beans that landed while the invocation runs and meet its bean (each offered once). The result then reports what the agent's hook did with each offer in `midrun_syncs`: `[{"sprout", "landed", "outcome": "applied" | "noted", "reason", "files"}]`.

### Streaming diffs

With `stream_diffs: true` in the run config (default `false`; `race.py --stream-diffs`), the driver posts each implementer invocation's (`initial`, `rework`, `sync`, `fixer`) working change while the agent writes. This is the second design (`docs/claude-17-streaming-diffs.md`, 2026-10-06): a `RunStreamDO` per run (`src/stream/`, binding `RUN_STREAMS`) takes the posts and serves the viewers; the engine's RunDO only tells it which invocations opened and closed.

```json
POST /v1/runs/:run/invocations/inv0003-initial/stream
{"seq": 7, "base_seq": 6, "trigger": "edit", "truncated": false,
 "files": [{"path": "src/report/index.ts", "status": "modified", "additions": 12, "deletions": 3,
            "binary": false, "patch": "@@ -4,6 +4,15 @@\n…"}],
 "removed": ["src/old.ts"]}
→ 200 {"accepted": true, "seq": 7}   // or {"accepted": false, "reason": "stale" | "rate" | "resync", "seq": 6}
```

- **What the driver sends.** `git diff` of the worktree, untracked files included and ignored ones not, against `base_sha` (or `merge.sha` when the round merges the line), through a private index, so neither the agent's index nor HEAD is touched. A post is a delta against the snapshot the gateway last accepted (`base_seq`): only the files whose patch changed, and the paths that left the change (`removed`). `base_seq: 0` is a full snapshot (the first post, and the one after a `resync` answer). A binary file has `"patch": null`. Patch text is capped at 64 KB and 200 files for the stored snapshot (`truncated`; a delta that would pass the cap is kept with the overflowing files' patches `null`). Lines that look like secrets are replaced before the post (`harness/streamdiff.py`). The driver posts only when the worktree's tree changed since its last post, and never the state before the agent started. A first-design driver (no `base_seq`, no `removed`) is read as posting full snapshots.
- **When.** Claude Code touches a marker file after each `Edit`, `Write`, `MultiEdit` or `NotebookEdit` (a `PostToolUse` hook; like `live_sync_midrun` it drops `--safe-mode` for those invocations). The driver checks the marker every 0.1 s, waits 0.3 s for a burst of edits to settle, and also looks every 3 s (edits through Bash, Codex). It posts at most once per invocation every 0.5 s; the gateway accepts one every 400 ms.
- **What the gateway does.** The Worker checks the slot token and validates the body; the run's `RunStreamDO` checks the slot owns an invocation the RunDO opened (`src/stream/stream-rules.ts`): `409 stream_off` (the run does not stream), `404 unknown_invocation` (not open yet: the RunDO opens it in the background), `409 closed_invocation`, `403 wrong_slot`. A seq not newer than the stored one of the same invocation is ignored (`stale`, so a retried post is harmless), a post within 400 ms of the last accepted one is refused (`rate`), and a `base_seq` that is not the stored seq answers `resync`. It scans only the delta's files for secrets again, writes the bean's summary row and the changed files' rows (`stream_beans`, `stream_files`; never the event log, so replays, `events.jsonl` and summaries are unchanged; the engine never reads them), and pushes.
- **The stream socket.** `GET /runs/:run/streams?key=<view token>` (hibernatable). On open, every bean's summary; then `{"type": "bean.streaming", "task", "inv", "agent", "seq", "t", "files": [{path, status, additions, deletions}], "additions", "deletions", "truncated", "redacted"}` to every socket per accepted post. A socket sends `{"type": "subscribe", "beans": ["t001"]}` (at most 32, replacing its set, kept across hibernation) and gets `{"type": "bean.snapshot", "task", "inv", "seq", "files"}` for each subscribed bean streaming now, then `{"type": "bean.patch", "task", "inv", "seq", "base_seq", "files", "removed"}` per accepted post (`base_seq: 0` replaces the snapshot). A socket that misses a patch subscribes again for a fresh snapshot.
- **The commit supersedes it.** The RunDO's step that ends the invocation (its result, a watchdog, an abort) closes it on the StreamDO, which drops the snapshot and sends `{"type": "bean.streaming.end", "task", "inv", "t"}`. At `done` every stream ends (`finish`); the reap deletes the StreamDO's storage (`clear`). An alarm sweeps invocations whose close never arrived (agent timeout plus 5 minutes).
- **Reading it.** RPC `beanStreams(run)` lists the summaries of every bean streaming now; `beanStream(run, bean)` returns the latest snapshot with its patches, or `null` (both answered by the StreamDO; an unknown run reads as nothing streaming). A gateway deployed before streaming has neither method; the web app and the MCP server check for them (`shared-ask/forge/bean-stream.ts`).

Decisions (admin): `POST /v1/runs/:run/decisions/D001 {"winner": "t005", "text": "…"}` answers `200 {"run", "card": "D001", "winner": "t005", "accepted": true}`. `text` is optional, up to 2,000 characters. It is the decision as the test author and the loser's re-execution read it; without it the engine writes one. Errors:

- `404 unknown_card`: the card is not open;
- `422 invalid_winner`: the winner is not one of the card's tasks;
- `409 invalid_state`: the run is not running.

## How the engine maps to the harness

`src/engine` is a pure state machine: `step(state, input, env) → {state, effects, response}`. The inputs are polls, results, progress, job outcomes, timer ticks, decisions, start and stop. The effects are events, poll replies and jobs. It never reads the clock or bindings. The RunDO applies one input at a time, persists the state and that step's events atomically in SQLite, then performs the effects. Timers (CI latency, pre-land latency, the oracle, retries, the wall clock) live in the state and fire from the DO alarm.

| Harness | Engine |
|---|---|
| `core.py` `Race` (invoke, commit_task, drop, budget, shutdown, final_check) | `invocations.ts`, `tasks.ts`, `lifecycle.ts`, `final-check.ts` |
| `ci.py` `CI.run` + `run_ci` (K slots, suite then emulated latency) | `ci.ts`; suites run as `check` jobs on `run-<run>-ci-<k>` |
| `summary.py` `build` | `summary.ts` |
| `prompts.py`, `preland_red`, `informed_red` | `prompts.ts` (verbatim, except v2's `informedConflictPrompt`) |
| `policy_queue.py` | `queue/` |
| `policy_beanstalk_v2.py` `place` (FIFO), `decide` | `v2/v2-policy.ts`, `v2/v2-decisions.ts` |
| `policy_beanstalk_preland.py` `land`, `try_optimistic`, `publish`, `resolve_on` | `v2/v2-landing.ts`; the committer lock is `v2/v2-turn.ts` |
| `policy_beanstalk_v2.py` `repair_before_landing`, `culprit_tasks`, `culprit_context` | `v2/v2-repair.ts`; diffs come from a `diff` job (`src/git/diff-text.ts`) |
| `policy_beanstalk.py` `maybe_validate`, `on_validation`, `promote` | `v2/v2-validator.ts` |
| `policy_beanstalk.py` `open_ticket`, `bisect_trunk`, `first_bad`, `leave_one_out`, `revert_culprit` | `v2/v2-tickets.ts` |

Runner instances per run:

- `run-<run>-committer` squashes, reverts and moves refs, with write tokens. It never runs a suite.
- `run-<run>-sandbox-<slot>` runs v2's pre-land checks with a read token.
- `run-<run>-ci-<k>` runs validations, bisection probes and the final check with read tokens.

A run therefore needs `agents + ci_slots + 1` container instances. They are `standard-2` (1 vCPU); on `standard-1` suites took 12.7 s median against 0.9 s locally. `max_instances` is 48 and `sleepAfter` is 2 min: a cloud race at 24 hit the cap while the previous runs' idle runners were still asleep (10 min), and four beans were dropped as infrastructure failures. 48 fits a 20-agent v2 run (23 instances) beside other work, and one 30-agent run (33) but not two back to back while the first one's runners are still in their 2-minute `sleepAfter`; it is left at 48, because the client now waits out capacity refusals (below) for about 4 minutes, longer than that tail.

The runner client (`src/runner/runner-client.ts` over `runner-transport.ts`):

- **Contract version.** Before an instance's first job it reads `/version` once (cached per instance name) and compares `api_version` with `RUNNER_API_VERSION`. A difference, or a `400` naming an unknown field, fails the job for good with the message `runner_version_mismatch: runner instance <name> speaks runner API <n>, this gateway speaks <m> …` (error code `runner_version_mismatch`), so the abort or drop says what to deploy. Deploy the gateway and the image together (`pnpm -F @beanstalk/gateway deploy` builds the image and stamps its commit, packages/runner/README.md "Image version").
- **Capacity.** "Maximum number of running container instances exceeded", a 429 or a 503 is retried inside the client: waits of 5, 10, 15 then 20 s, spread ±20 % by the instance name (deterministic), for about 4 minutes in all, each logged as `runner capacity exhausted, waiting`. Only then does the engine see a retryable failure, so capacity no longer spends its per-job attempts (in `cf-v2-sonnet-12-s7` it dropped four beans after about 90 s of engine retries).
- **Unknown commits.** `422 unknown_commit` is retryable for `check` and `update-ref` (a candidate pushed moments earlier may not be visible yet; both calls are idempotent) and final for the others.
- `RUST_LOG` of each instance follows the Worker's `LOG_LEVEL`, as does the container class's own logging.

### Where v2 differs from the harness

- **Pre-land squash.** It runs on the committer, not in the sandbox, because the runner's `/v1/squash` publishes a candidate ref and so needs a write token.
- **Optimistic disjointness.** The test uses the union of the files of the sprout commits that landed meanwhile, not `git diff head0 head`. This is conservative.
- **Decision cards.** A card can also be answered by the admin route or the web app (`decide`). Under `decision_outcome: decline` (v2.0), when the arriving bean wins, the landed losers are reverted in the turn and dropped, and the arriving bean goes back to its landing loop. The harness's `arriving` oracle drops the arriving task anyway. Under `reexecute` (the v2.2 default) nothing is reverted, as described below.
- **Revert-first after a bisection.** Revert-first also follows a trunk bisection when no read-set suspect exists; the harness would send a fixer there. No fixer is ever sent.
- **Markers after an informed rework.** Conflict markers left after an informed rework drop the bean.
- **Structural merge tier (v2 only).** For v2, the runner retries a squash conflict with Mergiraf on the conflicted files (the runner README's merge tiers): every squash job carries `structural_merge` (`usesStructuralMerge` in `@beanstalk/shared-race/run-config`), true for v2 unless the run sets `structural_merge: false` (v2.4). The queue always sends `false`, so it stays identical to the harness and to the baseline races already recorded, and `RunConfig` refuses `structural_merge: true` for it. A structurally merged bean is a normal candidate: it takes its pre-land check like any other, and its `land` event carries `resolved: "structural"` (the tier of the bean's latest clean squash, kept on the landing flow). A conflict that remains goes back to the author as before.
- **Conflict prompt.** v2's conflict rework (`informedConflictPrompt`) adds to the harness's words both sides of up to 4 conflict blocks from the runner's `hunks`, the landed beans that wrote the sprout's side of a conflicted file since the bean last merged the sprout (newest first, at most 3, each with its title and intent), and an instruction to keep both intents. The queue keeps the harness's `reworkConflictPrompt`.
- **Protected tests.** The `protect` list is computed when the invocation is created.
- **The stalk ref.** It follows promotions through serialized compare-and-swap ref updates.
- **Error budget.** The error-budget controller is not built; v2 reports `error_budget: 999`.

## The v2.2 to v2.5 rules

The experiments validated the v2.2 rules (`docs/claude-opus/11-experiments-summary.md`). v2.3 answers v2.2's first real race (cloud run `qpucqup50w`, 12 Sonnet agents, seed 7). There, 24 beans were green and 16 dropped, 11 of them innocent beans that spent their rework rounds on reds that were not theirs. Each rule is a `RunConfig` field, on by default for `beanstalk-v2` unless the table says otherwise (`validation_first`, `tests_first` and `targeted_landing_check` are off; `start_order` is `fifo`, see [Dependency-aware starts](#dependency-aware-starts)). The combined simulator table for the merged engine is in `docs/claude-opus/11-experiments-summary.md` (v2.5); the smaller tables below were measured on each rule's own branch before the merge:

| Rule | Config (default) | What the engine does | From |
|---|---|---|---|
| Sprout window | `window: aimd` (`off`), `window_start: 8`, `window_growth: 2`, `window_max: 16`, `window_min: 2` | At most W commits sit above the last validated sprout commit. A green bean beyond the window waits, oldest first (`window.wait`), and is checked against the window again when its turn comes. W starts at `window_start` (8; v2.3: 4), grows by `window_growth` (2) per green validation to `window_max` (16) and halves on a red sprout to `window_min` (2), once per red episode (`window.resize`). A red whose failures an open ticket already covers does not halve it again. Every bisection stays within W. When nothing can make room (no validation, nothing to repair), one bean at a time goes through | v2.3 |
| Re-check that measures what it skips | `recheck: sampled` (`adaptive`, `file`, `hunk`, `never`), `recheck_fallback: file` (`hunk`) | A green bean whose files overlap commits that landed during its check checks again. `sampled` re-checks until 5 re-checks in a row come back green, then skips all but 1 in 4. A red re-check or a red sprout starts it re-checking again. v2.2's `adaptive` judged by first checks on a calm base, which lag the contention. It skips while the last 20 pre-land checks hold at least 5 outcomes and under 10% red. `hunk` re-checks only when changed line ranges in a shared file are within 3 lines | v2.3; E2 |
| Release the agent during its check | `release_on_check: true` | The agent's slot is free once its bean is submitted. A red check or a conflict queues a rework for the next free slot, preferring the author's slot, and reworks go before new tasks. The rework resumes the author's session | E5 |
| Flake confirmation | `flake_confirm: true` | Before revert-first, a red validation runs again on the same commit. If a file that failed the first run fails again, the red stands. Otherwise the engine logs `flake.suspected`, records the test as flaky and counts the validation green. Pre-land reds are never re-run | E3 |
| Inherited reds | `inherited_reds: readset` (`validation`, `off`) | A pre-land red that is the sprout's, not the bean's, costs no rework round. `preland.check` carries `inherited: true`, and the bean waits for the sprout to move, or for its repair to end, then checks again (at most 3 times). A failing test is the sprout's when it already failed a validation of the sprout the bean was checked on (`validation`, E6). Under `readset`, it is also the sprout's when the bean changed neither the test file nor any file in its import closure, as the runner reports it. A bean that changed a file every test depends on is never cleared this way: `package.json`, a lockfile, `tsconfig*.json`, a vitest/vite/jest config | v2.3; E6 |
| Early tickets | `early_tickets: true` | An inherited red is a sighting of a red sprout at the commit it was checked on. Two beans' sightings of one test file there, or one sighting and a red validation of that commit, prove it red. Revert-first starts at once (`ticket.open` with `early: true`), with read-set suspects among the commits since the last green validation, without waiting for the validation queue. A sighting also confirms a red validation that waits for its flake re-run | v2.3 |
| Reconcile before a card | `reconcile: true` (`false`: v2.3) | Where a card would be raised, a `reconcile` invocation first gets both tasks' intents and both owners' failing tests, on the arriving bean's branch with the sprout its red check ran on merged in (`workspace.merge`), so every landed party's code is in the author's tree, as its prompt says (before this, the author got the bean's own head, and at least 8 recorded contradictions said the parties "have not landed here"). It may amend the two tasks' acceptance tests only, updating assertions that pin a value the other intent legitimately changes. A commit that changes them is RECONCILED: the bean's own tests are amended at once, and the landed task's travel with the bean as a carried amendment (they land with it, and are rolled back if it is dropped). The bean then checks again; a green check is the proof. A commit that changes nothing is a CONTRADICTION, and only that raises the card. An author that fails to run (`infra_error`: a crash, a timeout, a lost watchdog) found nothing: it is retried once (`invocation.retry`), and a second failure goes on to an informed repair naming the parties, with the pair left unreconciled (never a contradiction or a card). Each pair is reconciled once, and decided once, whichever bean of it arrives: after a reset swaps their roles, the earlier reconcile and decision stand (`isDecided` and `isReconciled` look up both orientations), and `decisionsInForce` already listed the card for either bean. The same setting re-checks, without a rework round, a red whose failing tests belong to a task reverted after the check began (`preland.recheck` with `stale`) | v2.4 |
| Escalate after one repeated red | `escalate_after: 1` (`2`: v2.4) | v2.4 spent two informed repairs on a pair before reconcile and a card, and after a card never escalated again: t032 in `cf-v24-sonnet-12-s7` spent about 8 minutes of reworks against t005. Now a red repeats against a culprit when one of its failing test files failed in the previous red against that culprit. After one repeat the bean escalates: reconcile if the pair was not reconciled, else a card if it was not decided. A culprit already reconciled and decided drops the bean (`pre-land check still red against <culprit> after its decision card`, `stuck_drops`) instead of spending its remaining rounds. Tail fix: a card no longer resets the count, so a re-executed loser red again on a file its card was raised on is stuck at once (first rescued, with `rescue`); a rescue keeps the count against decided culprits, so the next such red drops it v2.4's third red of an undecided pair still escalates when the failing files keep changing | v2.5 |
| Reconcile every landed party | `reconcile_parties: 3` (`1`: v2.4) | A clash can involve more than one landed task: t032's tests also clashed with a third task's free-shipping threshold, so reconciling t032 with t005 alone ended in a CONTRADICTION. The reconcile takes in the stuck culprit, then the owners of the failing tests and the read-set suspects since the bean's base, at most 3 tasks. The author sees every intent and may amend those tasks' acceptance tests only, under the same guard (never loosen an assertion; CONTRADICTION when the code looks wrong). Each changed landed test is carried by the bean for its owner. `decision.reconcile` and, on a contradiction, `decision.request` carry `parties` (and the request the author's `reason`); the card itself still decides the pair | v2.5 |
| Revert a lone suspect at once | `single_suspect_revert: true` | When a red sprout's suspects narrow to one commit (by read set, or the commit a bisection just found), revert-first reverts it without searching the unvalidated range again. The flake re-run before the ticket and the validation after the revert still apply. `false` bisects as the harness does | v2.5 |
| Name culprits in the bean's base | `base_culprits: true` | A pre-land red names, right after the owners of failing acceptance tests, the newest landed bean that wrote the read set of a failing test the bean itself changed, even one that landed before the bean started (or before its rework merged the sprout). Informed reworks get its intent and diff, and its reds count towards reconcile and the card. `false` names only beans since the bean's base | v2.5 |
| Validations before bisects | `validation_first: false` | When on, a sprout validation queues even with every CI slot taken while a bisection runs, ahead of the waiting probes, and takes the next free slot; the flake re-run goes ahead too. Off by default: in the simulator it slowed red episodes, because the head it validates still holds the culprit | v2.5 |
| Structural merge tier | `structural_merge: true` (v2 only; `false`: v2.4) | A squash that git's line merge conflicts is retried by the runner with Mergiraf on exactly the conflicted paths, when each is a supported code type; kept only if clean and free of markers. The bean then takes its pre-land check as usual and its `land` event says `resolved: "structural"`. A conflict that remains goes back to the author with both sides of up to 4 hunks (`informedConflictPrompt`). The queue never uses it | v2.5 |
| Final suite re-run | with `flake_confirm` | A red final suite on a stalk commit that v2 validated green runs once more, and the second result counts (`ci.start`/`ci.end` with `rerun: true`). Before, one flaky run in the final check reported a green stalk as wrong. The queue and v2.0 keep the harness's single run | v2.5 fix |
| Cards that re-execute the loser | `decision_outcome: reexecute` (`decline`), `decision_mode: oracle` (`human`), `human_timeout_seconds: null` | The winner is never reverted. See below. With `reconcile`, the loser's test author also sees the winner's failing tests as they are now | E6 |
| Tests first | `tests_first: false` (`true`) | Before a task's implementer starts, a `test-first` invocation (a fresh session on the task's slot and base) writes the task's acceptance tests from its intent alone. The engine reads the new test files it committed, other tasks' test paths excluded, and runs them on the base (fail-first, 10 s emulated, capped at the pre-land latency). Files that fail there and parse replace the given tests as the task's protected acceptance tests: the implementer's `acceptance`, its prompts, the protection of landed tests, culprits, reconcile and the final check all use them. No such file (or no commit, or a failed job): the given tests stay. Either way `tests.first` logs it and the implementer starts | v2.5; E1 |
| Live sprout sync | `live_sync: off` (`overlap`, `all`) | When a bean lands, beans whose agents are working get it at their next safe point. A `claude -p` session cannot be interrupted, so that is the end of the agent's current invocation (initial run or rework): its first squash afterwards merges every bean that landed meanwhile. `overlap` takes those whose files meet the bean's own (union-merged files such as `CHANGELOG.md` aside) or that the arena declares coupled with it, by either side; `all` takes every one. A clean squash: before the pre-land check, the bean's agent (kept for the squash, session resumed) gets a `sync` invocation with the sprout head merged and a short prompt naming the landed beans and files: re-run the tests, fix what broke, otherwise change nothing (`sync.applied`). No round is spent; the bean then squashes and is checked as usual, without a second sync. A conflict: nothing is merged, and the conflict rework's prompt opens with a note naming them (`sync.noted`). Optimistic pre-land mode only. Opt-in track (`variant_additions`: `live_sync:overlap` or `live_sync:all`) | new; simulated only |
| Mid-run live sync | `live_sync_midrun: false` (`true`) | Sync while the agent works. Each progress report of a running `initial` or `rework` invocation may come back with an offer of the beans that landed since its line and meet its bean (the `live_sync` rule over the files the driver reports: `all` when `live_sync` is `all`, else `overlap`), each offered once, with the sprout head (`sync.midrun.offered`). The driver's hook in the agent's session (`research/race/harness/midrun.py`; Claude Code `PostToolUse` via `--settings`, Codex note-only) merges it under the agent's uncommitted work between tool calls when that is safe and clean, or only tells the agent; the result reports which (`sync.midrun.applied`, `sync.midrun.noted`), and an applied merge moves the bean's merged line to that sprout. The pre-land check runs as usual. Independent of `live_sync`. Opt-in track (`variant_additions`: `live_sync_midrun`) | new; smoke-tested |
| Bean invocation ceiling | `max_bean_invocations: 10` (`0`: off) | Tail fix. Every agent invocation a bean uses counts: its initial run, informed and conflict reworks, reconciles, its test authors, card re-executions and the rescue (not `sync` turns or the tests-first author, nor runs that failed for infrastructure reasons). When a bean's check fails (red or a conflict) after that many, it is dropped (`still failing after N agent invocations (max_bean_invocations N)`, `invocation_drops`), whatever reset its rounds. It is checked at each failed attempt, so work already under way (a reconcile and the card it raises) finishes first. In the 16-seed simulator races the most a green bean needed was 9 (t028 in the earlier race, seed 1: an informed repair, a reconcile and a card, three more informed repairs, then the rescue that landed it), so 8 would have cost a green | v2.5 tail fix |
| Tail guard | `tail_guard_minutes: 3` (`0`: off; v2.5: 10) | Tail fix. When nothing is left to start and every bean not yet landed has failed a check at least once, a bean that made no progress for that long (a failing set it had not seen before, any landing in the run, or the end of a dynamic-culprit search for it: the search is the engine's work, not the bean's stall) is dropped at its next failed attempt (`no progress for N minutes with only stuck beans left (tail_guard_minutes)`, `tail_drops`), so the run ends instead of running to the wall cap. With `park`, it is parked instead | v2.5 tail fix; 3 min with parking |
| Parking | `park: true` (`false`: v2.5) | A bean that needs a person is **parked**, a terminal state of its own, instead of being retried or dropped: (1) a card's loser whose re-execution is still red against the decided counterpart (no rescue: `needs a person: two specs disagree (t005)`); (2) a bean at `max_bean_invocations` (`needs a person: still failing after 10 attempts`); (3) a bean the tail guard catches (`needs a person: no progress for 3 minutes`; either bound says `two specs disagree` for a card's loser); (4) a bean whose card only a person answers (`decision_mode: human` with no `human_timeout_seconds`, or `decision_oracle: none`): `needs a person: decision card D001 (t002 vs t001)`, at once. Parking frees the bean's agent and logs `task.parked` (`task`, `reason`); a bean parked while it lands rolls back the amendments it carried, but one parked on an open card keeps them (a reconcile's carried amendment of a landed party's tests, an earlier card's), so a person's answer takes it up again with them. The race finishes when every bean is green, dropped or parked: a parked bean's open card does not hold it, and nothing else of the bean's runs on. Parked beans do not ship. A person's answer to a parked bean's card during the race takes the bean up again. The queue ignores it | parking (owner's decision, 2026-10-06) |
| Red-window reset | `red_reset: true` (`false`: v2.5) | 30-agent stall fix. A red validation whose culprit is not one clean lone-suspect revert away (no lone read-set suspect, or its revert conflicts) resets the sprout instead of bisecting: in the turn, ahead of waiting landings, one commit on the sprout head takes the stalk's tree (the runner's `revert` with `to`: it undoes `stalk..head` and never conflicts), so neither the sprout nor the stalk moves backwards. Its tree passed a validation already, so it is promoted without CI. The beans that landed above the stalk are requeued (`bean.requeued`): each re-runs its pre-land check in its own sandbox on the new sprout and lands again. The red's read-set suspects among them go one at a time (each when the one before it landed or left), so two culprits never re-land side by side; a bean built on a requeued one squashes without it (the merge base keeps only its own change); a conflict goes to its author as usual. The culprit is named by its own red re-check, whose informed rework gives its author the failing tests and the landed beans it collided with. A bean is requeued at most twice; a window holding one requeued that often is bisected as before. Logs `sprout.reset` (`ticket`, `red_idx`, `green_idx`, `trunk_idx`, `sha`, `requeued`) and `bean.requeued` (`task`, `ticket`, `trunk_idx`). Guards (2026-10-07): when the reset job starts, the validations of every commit it resets are cancelled, and no validation starts while a reset (or, with `red_reset`, a lone suspect's revert, whose validations at or above its target are cancelled when it starts) is built and published, so no green can arrive for a tree the reset discards; a cancelled suite keeps its CI slot until the runner returns it, and that outcome is dropped. A ticket a green promotion closed meanwhile publishes nothing (its revert or reset is dropped in the turn) and is never closed twice; a reset whose stalk moved meanwhile is planned again, and one already published is not promoted (an `error` event). A bean's red pre-land check on a sprout commit a reset discarded since re-checks on the new sprout without a round or culprits (`preland.recheck` with `stale`), and failing tests of requeued beans count as stale. A held suspect that is parked (or green, or dropped) lets the next one go. A requeued card loser's branch goes back from the test author's commit to its own head before its squash. Without `release_on_check`, a requeued bean's rework waits for a free slot when its old one works for another bean | stall fix (2026-10-06) |
| Requeue repair | `requeue_repair: true` (`false`: the reset as first built) | Burst tail fix for the red-window reset. Each reset's read-set suspects requeue in a chain of their own, not behind an earlier reset's, and the next suspect goes as soon as the current one has a verdict: it landed or left, or its check came back red or conflicted (it is then with its author, and its next attempt is checked on a sprout holding whatever landed meanwhile). Two suspects of one reset that are red against each other skip the informed rework and go to reconcile and, on a contradiction, a card at once: the pair already broke the sprout together. Before, one chain held every reset's suspects, each until the one before it landed or left, so one suspect's card held the others back for minutes (burst, seed 3: t019's card held t010, t003, t022 and t016 for ten minutes). No new events | stall fix, burst tail (2026-10-06) |
| Check reuse | `reuse_checks: true` (`false`: validate every head on CI) | A bean that lands on the sprout head it was checked on lands the very commit its full pre-land check passed, so validating that head on CI would run the same suite on the same tree again. With reuse, such a head is green without CI (as the reset commit is): the stalk moves to it, the window grows as on a green validation, and CI runs of older commits still validating or waiting for their flake re-run are cancelled the way the reset cancels them (a red below a green head is stale; a running suite keeps its slot until the runner returns it). Like a validation, no head is reused while a reset or revert is built or published; it is reused once that is done. Keyed by commit sha, because the runner reports no tree ids and a commit fixes its tree; a re-squash on a moved sprout is a new commit and is validated as before. The extra files (none for either) and the suite (the whole suite; a targeted check never counts) are the same for a pre-land check and a validation. Only greens are kept, one per bean (its newest checked candidate): a red validation still waits for its flake re-run unless sighted. What it gives up: the second, independent run of a green tree, which could catch a test that fails only sometimes; such a test is run again by the next validation of a later head (every later tree contains this one) and by the final check. Logs `check.reused` (`sha`, `trunk_idx`, `task`, `source: preland`, the `cancelled` CI runs), then `green.promote` | new (2026-10-06) |
| Promotion by evidence | `evidence_promotion: false` (`true`); `evidence_read_sets: complete` (`static`) | A sprout commit above the stalk is green without CI when every test of its tree is vouched for by a green full check of some tree: a bean's pre-land check, or a sprout commit a full suite passed or that was itself promoted this way. A test is vouched for by a tree when its read set (always including the test file) misses every file that may differ between that tree and the commit: the files of every sprout commit after the tree's base (reverts and resets included), plus the bean's own change while its landing (the checked commit, or a textual re-squash of it) is not among them. A file every test depends on (`package.json`, lockfiles, `tsconfig*.json`, vitest/vite/jest config) touches every test; a changed file that is another resolution of a module a test reads (`src/a.ts` beside `src/a/index.ts`) counts as read. The commit's tests are those an anchor (a sprout voucher, or a check whose bean landed in range) holds unchanged, plus every test file a commit since changed. No evidence while the sprout is known red (a ticket, a red at or below the commit, a red waiting for its re-run), when a landed bean has no green full check with read sets, for a structural merge whose own tree was never checked, or for a test a red audit caught (`distrusted`). Read sets come from checks run with `all_read_sets`; `complete` trusts only read sets the runner marks `read_sets_complete`. The newest commit with evidence is promoted (the window counts it validated, older validations are cancelled as for reuse). Logs `promote.evidence`, then `green.promote`; a validation that runs instead logs `evidence.refused` | new (2026-10-07) |
| Affected validation | `affected_validation: false` (`true`), with `evidence_promotion` | A commit without full evidence is validated on only the tests nothing vouches for (`ci.start` `targeted: true`, `tests`), when its tests are all known; the full suite otherwise. Its emulated latency is `ci_overhead_seconds` plus `ci_seconds` times the share of tests it runs. Green: promoted on that evidence (`promote.evidence` with `targeted`). Red: a red validation as any other (flake re-run of the same tests, ticket, reset) | new (2026-10-07) |
| Background audit | `audit_every: 4` (`0`: only before the end), with `evidence_promotion` | The full suite on the stalk, once `audit_every` commits were promoted without a full suite since the last one and a CI slot is idle (nothing queued), and always before the race ends (the race does not finish with an unaudited stalk). Green: the stalk is verified. Red: re-run once (`flake_confirm`); the same file failing again confirms it: the stalk moves back to the newest commit a full suite passed (the ref is force-updated with a lease), the beans promoted since are `landed` again, the failing tests are never vouched for again, and the red settles as a red validation of the audited commit (window halved, ticket, reset). Runs are `ci.start`/`ci.end` with `purpose: validate`, `audit: true`; a confirmed red logs `green.demote` | new (2026-10-07) |
| Validation debounce | `validation_debounce: false` (`true`); `validation_debounce_seconds: 15`, `validation_tick_seconds: 60` | Coop's timing rule. A validation a landing asks for starts after min(15 s, time to the next 60 s tick), so landings close together share it; one asked for in the step a validation settled starts at once. Repair landings are never delayed. Measured and left off (`docs/claude-opus/11`, "Event-driven promotion") | new (2026-10-07) |
| CI overhead | `ci_overhead_seconds: 0` | Fixed seconds every CI-slot run adds to `ci_seconds` (a runner's setup, about 12 s on GitHub Actions); the final check has none. An affected validation pays it in full | new (2026-10-07) |
| One ticket per red episode | `episode_tickets: false` (`true`) | While a ticket opened below it is open (or escalated with its red still above the stalk), a red validation opens no ticket and runs no flake re-run, and a bean checked on a sprout known red whose check fails every file the sprout's validation failed waits for the sprout (an inherited red, not a culprit). Measured and left off: alone it held beans on an unrevertable red (burst30 at 30 agents, 30th green 17.0 to 23.6 min); with the reset it changes nothing | stall fix, off |
| Repair landings | `repair_landing: false` (`true`) | A bean whose full pre-land check is green on a sprout commit known red lands even when the window is full, and its validation goes ahead of bisect probes. Measured and left off: it changed no simulated race (no fixer was held by the window there) | stall fix, off |
| Targeted check of the exact landing tree | `targeted_landing_check: false` (`true`) | Where a green bean would land on a moved sprout without a full re-check (no shared file, `sampled` skipping, disjoint hunks), it first runs only some tests on the exact tree that would land (`preland.check` with `targets`, 10 s emulated, capped at the pre-land latency): its own acceptance tests, those of the beans that landed meanwhile and their test files, and every test whose read set meets the bean's files. A test whose known read set misses either side (the bean's files, or what landed meanwhile) cannot see them combine and is left to validation, so it usually runs nothing and lands as before (`preland.optimistic`). The first targeted check runs outside the turn; if the sprout moved again meanwhile, the next runs inside it, so a busy sprout cannot keep a bean chasing. A red one is an ordinary red pre-land check, and also sets the `sampled` meter re-checking; a green one does not count as a re-check. Full checks then ask the runner for every passing test's read set too (`all_read_sets`, answered in `passing_read_sets`). The full suite still runs at validation | v2.5; E1 |

A decided card works in one of two ways:

- **Keep-landed** (the landed bean wins):
  1. A `test-author` invocation, a fresh session, amends the loser's acceptance tests on the loser's snapshot.
  2. The amended tests must fail there first. If they do not, the amendment is `rejected`.
  3. The loser re-executes from the sprout head, in a fresh session, with the decision text, the winner's intent and diff, and every earlier decision in force on it (decisions compose).
- **Adopt-in-place** (the arriving bean wins):
  1. The author amends the landed loser's tests on the red head.
  2. The winner merges the author's commit and lands.
  3. The loser's spec changes when the winner lands, and rolls back if the winner is dropped.

Under `decision_mode: human`, a card waits for `decide` (RPC) or the admin route. With `human_timeout_seconds` set, the oracle answers after the timeout, and `decision.made` says `oracle: "timeout:<oracle>"`.

**Events.** New types:

- `spec.amended` and `flake.suspected` (v2.2);
- `window.wait` and `window.resize` (v2.3);
- `decision.reconcile` (v2.4: `task`, `against`, `outcome` `reconciled` or `contradiction`, the changed `files`, the author's `reason`, `inv`; v2.5: `parties` when more than one landed task took part);
- `tests.first` (v2.5: `task`, `status` `accepted` or `fallback`, `base`, the author's `files`, the `accepted` ones, the proof's `failing_tests`, `problems`, `inv`);
- `sync.applied` (`live_sync`: `task`, the `sprout` merged, the `landed` beans, the `files` of the sync commit, `inv`) and `sync.noted` (`task`, `sprout`, `landed`, the landed beans' `files` that met the bean, the squash's `conflicts`);
- `sync.midrun.offered`, `sync.midrun.applied` and `sync.midrun.noted` (`live_sync_midrun`: `task`, `inv`, the offered `sprout`, the `landed` beans, `files`; `noted` adds the hook's `reason`);
- `task.parked` (`park`: `task`, `reason`). The task status `parked` is new too: `runView`'s and `listRuns`' task counts carry `parked`;
- `sprout.reset` and `bean.requeued` (`red_reset`, fields in the rules table). The web app's reducer marks the window's commits reverted, adds the reset commit, and gives the bean the step `requeued`.
- `check.reused` (`reuse_checks`, fields in the rules table). The web app does not model it (unknown types are skipped); the `green.promote` that follows moves its stalk.
- `promote.evidence` (`evidence_promotion`: `sha`, `trunk_idx`, the previous `green_idx`, the `beans` promoted, the number of `tests`, the `checked` trees that vouched (`task`, `sha`, `base_idx`, the `changed` files between it and the commit, `changed_count`, how many tests it `vouched` for), `overlaps` (tests whose read set a checked tree's change met: `test`, `checked`, `files`), `targeted` (`ci`, `tests`) after an affected validation, the `cancelled` CI runs), so a judge can audit each promotion; then `green.promote`.
- `evidence.refused` (`sha`, `trunk_idx`, `reason`: `no-read-sets`, `unchecked-bean`, `structural`, `known-red` or `affected`; `tests`, the `affected` tests (20 listed, `affected_count`), `overlaps`), logged when a validation starts instead.
- `green.demote` (a confirmed red audit: the new stalk `sha` and `trunk_idx`, `from_idx`, the `audit_sha`/`audit_idx`, the `failing` files, the `tasks` landed again). The web app does not model it yet.

Optional fields on existing types:

- `decision.made.outcome` and `.text`;
- `rework.start.card`;
- `preland.check.inherited`;
- `ticket.open.early`;
- `preland.recheck.stale`;
- `decision.request.parties` and `.reason` (v2.5, a multi-party contradiction);
- `preland.check.targets` (v2.5);
- `ci.start.rerun` and `ci.end.rerun` (v2.5, the final suite's re-run).

v2.5 adds no event types for its lone-suspect reverts and base culprits: a lone-suspect revert logs `ticket.culprit` with no `ci.start` of purpose `bisect` before it, and a base culprit appears in `rework.start.culprits`.

`summary.json` adds `variant_additions` after `variant` (see [Version labels](#version-labels)) and the v2.2 to v2.5 keys after the harness's v2 keys (`window`, `window_size`, `window_waits`, `recheck_samples`, `early_tickets`, `early_tickets_opened`, `confirmed_by_sighting`, `reconcile`, `reconciles`, `reconciled`, `contradictions`, `stale_rechecks`, `escalate_after`, `reconcile_parties`, `stuck_drops`, then the E6 keys below (with `dynamic_culprits` on, also `dynamic_culprit_skips`; with either tail bound on, `max_bean_invocations`, `tail_guard_minutes`, `invocation_drops` and `tail_drops`, and the row `Max bean invocations / tail guard minutes / dropped by each`) and `tests_first`, `tests_first_accepted`, `tests_first_fallbacks`, `targeted_landing_check`, `targeted_checks`, `targeted_red`; with `live_sync` on, also `live_sync`, `syncs_applied` and `syncs_noted` at the end; with `live_sync_midrun`, then `live_sync_midrun`, `midrun_offered`, `midrun_applied` and `midrun_noted`), and the matching rows after `Variant`. With check reuse on, the block then has `reuse_checks`, `checks_reused` and `ci_superseded` (and the row `Checks reused as validations / superseded CI runs cancelled` after the stall-fix row). With any stall-fix rule on, the block ends with `red_reset`, `episode_tickets`, `repair_landing`, `requeue_repair`, `resets`, `requeued`, `episode_reds`, `episode_inherited` and `repair_landings`, and the row `Sprout resets (beans requeued) / episode reds (inherited checks) / repair landings` follows the tail bounds' row. With `park` on (v2 only), the block adds `park: true` after the tail bounds' keys, and the summary itself adds `parked` (a list of `{task, reason}`) after `drops_by_reason`; `summary.md` shows it as the row `Parked, needs a person`. Parked beans count in neither `tasks_green` nor `tasks_dropped`. `runView`'s `policy_state` shows `window` (size, unvalidated, waiting beans) and `recheck_mode`.

**Replay parity.** `V20_SETTINGS` (exported by `@beanstalk/shared-race/run-config`) reproduces the event streams the engine logged before v2.2, byte for byte. It turns every later rule and every opt-in track off:

```json
{"recheck": "file", "window": "off", "release_on_check": false, "flake_confirm": false,
 "inherited_reds": "off", "early_tickets": false, "reconcile": false, "decision_outcome": "decline",
 "escalate_after": 2, "reconcile_parties": 1, "single_suspect_revert": false,
 "validation_first": false, "base_culprits": false, "window_start": 4, "structural_merge": false,
 "start_cards": false, "rescue": false, "dynamic_culprits": false,
 "max_bean_invocations": 0, "tail_guard_minutes": 0, "park": false,
 "red_reset": false, "episode_tickets": false, "repair_landing": false,
 "tests_first": false, "targeted_landing_check": false, "start_order": "fifo"}
```

`src/engine/parity.test.ts` checks this over 11 golden scenarios. Such a run reports `variant: "v2"`.

### Presets

`preset: "demo"` pins `DEMO_SETTINGS` (`RUN_PRESETS` in `@beanstalk/shared-race/run-config`): v2.5 with dependency-aware starts, the tail fix and parking, whatever the defaults become. It is `V25_SETTINGS` (every v2.5 rule at its v2.5 value, `max_bean_invocations: 10`, `tail_guard_minutes: 10`, `park: false`: the engine behind the published numbers, the three-seed races `cf-v25dep2-sonnet-12-s7`, `-s11`, `-s13`) plus `park: true`, `tail_guard_minutes: 3`, `start_order: "dependency"` and the stall fix's `red_reset: true` (`episode_tickets` and `repair_landing` pinned off), with `tests_first`, `targeted_landing_check`, `live_sync` and `live_sync_midrun` off. `preset: "v24"` pins `V24_SETTINGS` (the `cf-v24-*` races). A field the preset pins may be repeated with the same value; a different value is refused (`400`), so a stray environment knob cannot change a demo race. With the queue, `structural_merge` is not pinned (it is v2 only; the queue never merges structurally). The preset is recorded in the run's config and in its `listRuns` row (`preset`). The driver's `--preset demo` (or `--preset v24`) sends it.

### Version labels

`summary.json`'s `variant` names the rules a run used; its `Variant` row says them in words.

| Variant | When | Reproduce with |
|---|---|---|
| `v2.5` | any v2.5 rule is on: `escalate_after: 1`, `reconcile_parties` above 1 (with `reconcile`), `single_suspect_revert`, `validation_first`, `base_culprits`, window sizes other than 4/+2/16/2 (with `window: aimd`), `structural_merge`, `start_cards`, `rescue`, `dynamic_culprits`, `max_bean_invocations` or `tail_guard_minutes` above 0, `park`, any stall-fix rule (`red_reset`, `episode_tickets`, `repair_landing`) | the defaults |
| `v2.4` | no v2.5 rule, `reconcile` on | `V24_SETTINGS` (= `V25_RULES_OFF`) |
| `v2.3` | no v2.5 rule, no `reconcile`, any v2.3 rule (`window: aimd`, `recheck: sampled`, `inherited_reds: readset`, `early_tickets`) | `V23_SETTINGS` |
| `v2.2` | none of the above | `V22_SETTINGS` |
| `v2` | exactly the harness's v2 rules | `V20_SETTINGS` |

`V22_SETTINGS` also gets the two bug fixes below, and every v2.2+ preset gets the final suite re-run.

Five opt-in tracks never change the variant: `tests_first`, `targeted_landing_check`, `start_order: dependency`, `live_sync` and `live_sync_midrun`. A run lists the ones it used in `variant_additions` (`["tests_first", "targeted_landing_check", "start_order:dependency", "live_sync:overlap", "live_sync_midrun"]`), and the `Variant` row adds them after a ` + ` each (`v2.5: ... + tests first + targeted landing check`). So "v2.5 with the tests track" is `variant: "v2.5"` with two additions, and v2.4 with tests first is `variant: "v2.4"` with one.

The driver passes every knob through from the environment: `PRELAND_RECHECK`, `PRELAND_ADAPT_FALLBACK`, `WINDOW`, `RELEASE_ON_CHECK`, `FLAKE_CONFIRM`, `INHERITED_REDS`, `EARLY_TICKETS`, `RECONCILE`, `DECISION_OUTCOME`, `DECISION_MODE`, `HUMAN_TIMEOUT_SECONDS`, `ESCALATE_AFTER`, `RECONCILE_PARTIES`, `SINGLE_SUSPECT_REVERT`, `VALIDATION_FIRST`, `BASE_CULPRITS`, `WINDOW_START`, `WINDOW_GROWTH`, `WINDOW_MAX`, `WINDOW_MIN`, `STRUCTURAL_MERGE`, `START_CARDS`, `RESCUE`, `DYNAMIC_CULPRITS`, `MAX_BEAN_INVOCATIONS`, `TAIL_GUARD_MINUTES`, `PARK`, `RED_RESET`, `EPISODE_TICKETS`, `REPAIR_LANDING`, `REQUEUE_REPAIR`, `REUSE_CHECKS`, `TESTS_FIRST`, `TARGETED_LANDING_CHECK`, `START_ORDER`, `LIVE_SYNC` and `LIVE_SYNC_MIDRUN`. It sends them only when they are set (and only for v2), so the gateway's defaults apply otherwise. The phase races of one deployed engine set them as follows (unset variables keep the v2.5 defaults):

| Phase | Environment |
|---|---|
| v2.4 baseline | `ESCALATE_AFTER=2 RECONCILE_PARTIES=1 SINGLE_SUSPECT_REVERT=0 VALIDATION_FIRST=0 BASE_CULPRITS=0 WINDOW_START=4 STRUCTURAL_MERGE=0 START_CARDS=0 RESCUE=0 DYNAMIC_CULPRITS=0 MAX_BEAN_INVOCATIONS=0 TAIL_GUARD_MINUTES=0` |
| v2.5a (B: lone suspects, base culprits, window 8) | `ESCALATE_AFTER=2 RECONCILE_PARTIES=1 STRUCTURAL_MERGE=0 START_CARDS=0 RESCUE=0 DYNAMIC_CULPRITS=0` |
| v2.5b (+ A: escalation, parties) | `STRUCTURAL_MERGE=0 START_CARDS=0 RESCUE=0 DYNAMIC_CULPRITS=0` |
| v2.5c (+ C: structural merges) | `START_CARDS=0 RESCUE=0 DYNAMIC_CULPRITS=0` |
| v2.5d (+ E: start cards, rescue, dynamic culprits) = v2.5 | none |
| v2.5 + dependency starts | `START_ORDER=dependency` |
| v2.5 + tests track | `TESTS_FIRST=1 TARGETED_LANDING_CHECK=1` |
| v2.5 + live sync | `LIVE_SYNC=overlap` (or `all`) |
| v2.5 + mid-run live sync | `LIVE_SYNC_MIDRUN=1` (optionally with `LIVE_SYNC=overlap`) |

The phases v2.5a to v2.5d keep the tail fix's two bounds on (it came after their races); add `MAX_BEAN_INVOCATIONS=0 TAIL_GUARD_MINUTES=0` to reproduce a race run before it, such as `cf-v25dep-sonnet-12-s7`. The `v24` preset and every older preset turn them off; the `demo` preset keeps them on. Parking is on by default and in the `demo` preset; `PARK=0 TAIL_GUARD_MINUTES=10` reproduces the `cf-v25dep2-*` races, and every older preset (and the parity settings) turns it off. The red-window reset is on by default and in the `demo` preset; `RED_RESET=0` without a preset (the preset pins it) reproduces `cf-demo-sonnet-30-s7`, and `V25_SETTINGS`, `v24` and every older preset turn it off. Check reuse and the requeue repair are on by default and in the `demo` preset (since 2026-10-06, after `cf-demo2-sonnet-30-s7`); `REUSE_CHECKS=0 REQUEUE_REPAIR=0` without a preset reproduces the `demo` engine of that race, and `V25_SETTINGS`, `v24` and every older preset turn both off.

### Fixes and simulator scenarios

**Fixed in v2.3.** Two bugs from v2.2 and v2:

- A red validation whose re-run was red again was taken for a flake when a ticket opened meanwhile covered its failures. The engine then promoted a red commit to the stalk.
- The leave-one-out culprit search gave every probe the commit of the probe built last. One probe's result was then lost, and the ticket never finished.

**The burst scenario.** `src/engine/v2/v2-burst.test.ts` replays the shape of the race:
- twelve agents released during their checks, with initial runs of 15–35 s and a tail of slower beans;
- two CI slots;
- four coupled pairs that each break a module test together.

v2.2 drops 20 of 40 beans there, 16 of them still red after their pre-land reworks. v2.3 drops none and finishes sooner.

**The 30-agent stall (burst30).** `src/engine/testing/burst30.ts` replays the stall of `cf-demo-sonnet-30-s7` (`v2-burst30.test.ts`): the arena's 40 tasks with their real modules and card pairs, and a whole-suite break by two migration beans that cannot be reverted, fixed forward late by t026. It is calibrated to the run's timings (75 s CI). `burst30Scenario(seed, agents, config)` runs it at any agent count. `src/engine/testing/culprit-study.ts` is a model, not the engine: it compares culprit-isolation strategies on single red episodes (`v2-culprit-study.test.ts`). Both are described in `docs/claude-opus/11-experiments-summary.md`, "30-agent post-mortem". To build the stall, the toy world gained `revertConflicts`, `fixes` and `requiresFile`.

**Reset guards (2026-10-07).** A review of the red-window reset found these holes, each fixed with a regression test (`v2-reset.test.ts` unless named):

- A validation of a commit above the red one could come back green while the reset job ran: it promoted the window and closed the ticket, then the reset closed it a second time and promoted the reset commit, whose tree is the old stalk, so the stalk went backwards under green beans. Validations are now cancelled when the reset job starts (not when it lands), none starts while a reset or (with `red_reset`) a lone suspect's revert is built and published, a ticket a green closed meanwhile publishes nothing, and a reset over a moved stalk is never promoted.
- A cancelled validation freed its CI slot at once while its suite still ran: the next run shared the container, a retryable failure re-ran a suite nobody read, and a final failure aborted the race. The slot now stays reserved until the runner returns the job, whose outcome is dropped; a job waiting for its retry is not re-issued (`ci.ts`, `engine.ts`; queue batches cancel as before).
- A held suspect parked by a card only a person answers kept its landing flow, so the requeue chain never moved on and the race ran to the wall clock. A parked, green or dropped suspect now lets the next one go.
- A bean whose pre-land check ran on a sprout commit the reset discarded came back red with the window's failures and blamed innocent landed beans. Such a red re-checks without a round or culprits (`preland.recheck` with `stale`). In burst30 seed 7 (30 agents, demo preset) t031 no longer blames t001 and t002: 12 reworks instead of 14, 39 green and t023 parked as before, 30th green at 12.8 min, 35th at 17.1 (16.4), done at 22.0 min (22.8) (`v2-burst30.test.ts` pins them). t023's earlier red, checked on the break before any validation saw it, still names t001 and t002: nothing knew the sprout was red then.
- Tickets a green promotion closed stopped requesting bisection and leave-one-out rounds.
- A bean re-checking after its re-squash, or starting a targeted check outside the turn, passed the turn on before it left its inbound step, so the next holder's window counted it and could log a spurious `window.wait` (`v2-burst.test.ts`, the earlier race, seed 11). The flaky race's seed 9 then draws its v2.4 final suite green; `v2-stalk.test.ts` shows the final suite's re-run on seed 11 instead.
- Without `release_on_check`, a requeued (or unparked) bean's rework went to its old slot even when another bean held it, overwriting that slot's pending invocation. It now waits for a free slot.
- A requeued card loser's branch could point at the test author's commit (adopt-in-place amends the landed loser's tests on its branch): its squash then took the author's commit, not the bean. The branch goes back to the bean's own head first (an `update-ref` with a lease, retried once from what it finds).
- A restart re-issued jobs waiting for their retry timer, which then ran twice; a lost long-poll reply stranded its invocation until the watchdog (see the driver contract: it is re-delivered now; `engine.test.ts`).

**The three-way clash.** `src/engine/v2/v2-reconcile.test.ts` replays t032 of `cf-v24-sonnet-12-s7`: the arriving bean's shipping clashes with one landed task's pinned total and another's free-shipping threshold. Simulated (3 agents, 60 s CI); the burst and calm rows are the scenarios above (12 agents, 2 CI slots, seed 7):

| Scenario | v2.4 | v2.5 escalation only | v2.5 |
|---|---|---|---|
| Three-way clash: t032 | dropped at 16.2 min, 7 reworks, 2 contradictions, 2 cards | dropped at 10.4 min, 3 reworks | **green at 6.5 min**, 1 rework, 1 reconcile, no card |
| Two-way, reconcilable: t032 green | 8.5 min, 2 reworks | 6.9 min, 1 rework | 6.9 min, 1 rework |
| Two-way, genuine contradiction: t032 dropped | at 13.7 min, 6 reworks | at 9.0 min, 3 reworks | at 9.0 min, 3 reworks |
| Burst (40 beans) | 40 green, 19.2 min, 12 reworks, 4 cards | | 40 green, **17.4 min**, 8 reworks, 4 cards |
| Calm (40 beans) | 40 green, 8.5 min | | 40 green, 8.5 min |

Every row's final check is correct; v2.2's burst row (27 green, 23.9 min) is unchanged with `escalate_after: 2`.

**The t032 tail (v2.5 tail fix).** In the real races `cf-v25dep-sonnet-12-s7` and `-s11` (12 Sonnet agents, dependency starts), every other bean was done by minute 14 (s7) or 23 (s11), and t032 ran until the 60-minute wall cap. It clashed with t005's pinned total and with t033's free-shipping threshold, both in its base. Three causes, each fixed:

1. **Nothing bounded a bean's total work.** Its rounds started over at the card's re-execution and again at the rescue (`max_rework` counts rounds since the last reset), and the card reset the repeat count, so the drop after the decision needed a fresh red after the card and another after the rescue. Now a card keeps the count (the first red after it on the card's failing file is stuck), a rescue keeps it against decided culprits, and `max_bean_invocations` caps the total.
2. **A full dynamic-culprit search on every red.** Each red probed 24 candidates, four suites at a time in one sandbox: 6 to 12 minutes a search, five searches. None could confirm a culprit: two landed beans broke t032's own test together, so leaving either out fixed nothing, and the real ones (landed early) were not even among the 24 newest. Now: at most 6 candidates, one search per set of named counterparts, none once a named counterpart is decided.
3. **No run-level guard.** `tail_guard_minutes` drops beans that make no progress once only stuck beans are left.

`src/engine/v2/v2-tail.test.ts` replays the clash (t032's own test broken by t005 and t030 together, eight decoys its test also reads, a stubborn loser; 4 agents, 60 s CI). "Before" was measured when the simulator's probes cost no time; "After" charges each probe the pre-land latency (60 s) on top of its suite, as the real race's probes cost (with free probes it was dropped at 9.3 min). Each skipped search of 6 to 9 candidates, 2 at a time, would cost 3 to 5 more minutes here:

| t032 | Before the fix | After |
|---|---|---|
| Outcome | dropped at 12.5 min | dropped at 12.3 min (`pre-land check still red against t005 after its decision card`) |
| Red pre-land checks | 6 | 4 |
| Dynamic-culprit searches (candidates each) | 6 (9) | 1 (6) |
| Agent invocations | 8 | 6 |
| Reworks | informed, re-execution, informed, rescue, informed | informed, re-execution, rescue |

The burst, calm, earlier, flaky and declared races are unchanged over 16 seeds (the simulator table in `docs/claude-opus/11-experiments-summary.md`, v2.5 rows): none has a bean whose own test fails against a landed bean, and no bean reaches either bound (every mean is identical to three decimals). A ceiling of 8 would have dropped one innocent bean in the earlier race (seed 1) that its rescue landed, so the default is 10.

**Parking (owner's decision, 2026-10-06).** In the three-seed races `cf-v25dep2-sonnet-12-s7`, `-s11`, `-s13` the last useful green came at 23.0 / 19.1 / 26.7 min and the runs ended at 33.1 / 25.4 / 31.3 min: the engine kept retrying and waiting (the 10-minute tail guard, the invocation ceiling, then the final check) on one or two hopeless beans, typically a genuine spec contradiction (t032). In a real repository such a bean waits for a person while everything else ships, so `park` parks it (the rules table). `src/engine/v2/v2-park.test.ts` measures it in the simulator, park off (`park: false`, `tail_guard_minutes: 10`, v2.5 as published) against on (the defaults); "done" is the end of the race, and the final check takes no simulated time:

| Scenario | Last green | Park off: done (stuck bean) | Park on: done (stuck bean) |
|---|---|---|---|
| t032 loop (`v2-tail.test.ts`'s scenario, 4 agents, 60 s CI) | 3.3 min | 12.3 min (dropped after a rescue: `still red against t005 after its decision card`) | **11.0 min** (parked at the re-execution's red: `two specs disagree (t005)`, no rescue). Its one dynamic-culprit search, 6 probes 2 at a time at a pre-land latency each, takes about 3 minutes; the search's end counts as progress, so the 3-minute guard no longer parks it at its second red (8.2 min, `no progress for 3 minutes`, before the reconcile or the card could run) |
| Two-way genuine contradiction (t031 under t005, 2 agents) | 2.2 min | 10.7 min (dropped after a rescue) | **8.9 min** (parked, `two specs disagree (t005)`) |
| A card only a person answers (`decision_mode: human`, no timeout) | | waits for the person | parked when the card opens; the race ends with the last other green |

The time left between the last green and the end is the stuck bean's own first attempts (an informed rework, the reconcile that finds the CONTRADICTION, the card, the test author and the re-execution), which parking keeps; it removes the rescue and the reds after it. The burst, calm, earlier and flaky races are unchanged over 16 seeds (every `numbers()` field identical with park off and on): none has a stuck bean. The parity settings are unchanged (`park: false`). The queue never parks; its events are byte-identical with `park` on or off.

### Start cards, rescue and dynamic culprits (E6)

The rest of E6 (`docs/claude-opus/exp/e6-decision-cards.md` §2.4, §2.5, §5.3). Each is a `RunConfig` field, on by default for `beanstalk-v2`, and off in the parity settings. They are v2.5 rules (see [Version labels](#version-labels)); the summary also reports them by their own keys.

| Rule | Config (default) | What the engine does | E6 |
|---|---|---|---|
| Start cards from declared couplings | `start_cards: true` | Tasks declare semantic couplings (`couplings`, type `semantic`, either side). When a bean is about to start and a declared partner is on the sprout, the pair's card is raised before any work (`decision.request` with `trigger: "start"`, `attempts: 0`); its agent is released meanwhile. The card runs as any other: the oracle or a human decides, the test author amends the loser's tests (fail-first on the sprout head for an arriving loser; in place for a landed loser, merged and carried by the arriving winner). Then the bean's initial run starts from the sprout head with the decision, the winner's intent and diff, and its amended tests (E6's `start_context` prompt). At most one start card per bean. Against a declared partner still in flight: the first red check that names it goes to reconcile (or the card) at once instead of after three, and a bean whose check passed is checked again when a declared partner landed meanwhile, even on disjoint files (E6 `partner_rechecks`) | `CARD_AFTER_KNOWN=-1`, `COUPLING_PRIOR=arena` |
| Rescue | `rescue: true` | When a bean's rework rounds run out (a red check or an unresolved conflict), it is re-executed once from scratch: a fresh session on the sprout head, with the last merged tree's failing tests (up to 12) and every decision in force (`rescue.start`, then `rework.start` with `reason: "rescue"`). Its rounds start over; a second exhaustion drops it. This also catches a card's loser whose re-execution still fails. Since the tail fix, a rescued bean red again against a decided counterpart on the same failing file is dropped at once, and `max_bean_invocations` counts the rescue | `RESCUE=1` |
| Dynamic culprits | `dynamic_culprits: true` | When a bean's own acceptance tests fail its check (and no landed declared partner's tests do), the landed beans whose files those tests read are probed wherever they landed, before the bean's snapshot too: declared partners first, then the newest, at most 6 (24 before the tail fix), at most 4 at a time and never more than the run's CI slots. A probe reverts one bean from the checked tree and runs the suite in the agent's sandbox (no emulated latency in the engine; never on a CI slot, so validations never queue behind probes). In the real race a probe costs about a pre-land check (`cf-demo2-sonnet-30-s7`: 2.5 to 3.7 minutes per search of 6), and the simulator charges each probe suite the pre-land latency on top of its suite time; the bean is confirmed when the own failing tests pass without it. Confirmed beans replace v2's read-set guess (commits since the snapshot), and none confirmed names none (`culprit.dynamic`). Tail fix: one search per bean and set of counterparts its red names (failing-test owners, base and read-set culprits); a later red naming the same set reuses the answer, and a red naming a counterpart a card already decided searches nothing. A search whose candidates were all probed by an earlier search of the bean that confirmed none is skipped too (`emptySearches`; in `cf-demo2-sonnet-30-s7` t032 spent 8.7 of the race's last 9.5 minutes in three searches of the same six candidates under three different named sets, each `confirmed: []`). All three count in `dynamic_culprit_skips`. A confirmed culprit that a reset or revert has since taken off the sprout is not named. E6 ranked candidates by covered lines (`node --test --experimental-test-coverage` and `git blame`); the runner reports no coverage, so the order is partners, then recency | `DYNAMIC_CULPRITS=1` |

Events: `rescue.start` (`task`, `why`, `rounds`) and `culprit.dynamic` (`task`, `candidates`, `confirmed`) are new; `decision.request.trigger` is optional. `summary.json` adds `start_cards`, `start_cards_raised`, `rescue`, `rescues`, `dynamic_culprits`, `dynamic_culprit_runs` and `dynamic_culprit_probes` after `stale_rechecks`, and the row `Start cards / rescues / dynamic culprit searches (probes)`.

In the simulator (`v2-start.test.ts`, `v2-burst.test.ts`; 40 beans, 12 replay agents, 2 CI slots, seed 7):

| Scenario | v2.4 (the E6 rules off) | With the E6 rules |
|---|---|---|
| Burst (4 coupled pairs, undeclared) | 40 green, 19.2 min | identical: 40 green, 19.2 min |
| Burst, pairs declared as couplings | 40 green, 19.2 min | 40 green, **16.0 min** (cards at the first red) |
| Calm (overlaps only) | 40 green, 8.5 min | identical |
| v2.2 rules on the burst | 27 green, 13 dropped (9 still red) | with `rescue`: 36 green, 0 still red |
| A bean whose own test pins what a landed partner changed | dropped (no culprit named) | start card, amended, green with no red check; without start cards, dynamic culprits name the partner and a card ships it |

**Still not ported from E6:** the contract oracle, `CARD_AFTER=1` for undeclared pairs (v2.5 asks after one repeated red, not the first), coverage-ranked culprit candidates, and adopt-arriving by revert (E6 found in-place adoption was the rule). A start card's initial run that fails to start is retried with the plain initial prompt (its amended tests still apply).

**Forge-owned tests (v2.5, E1), off by default.** `src/engine/v2/v2-forge-tests.test.ts` shows both rules in the simulator (2 replay agents, 60 s CI):

| Scenario | Off | On |
|---|---|---|
| Weak given test: the implementer's bug passes it; the author's test pins the behaviour | green in 3.0 min, every signal green, **the bug is on the stalk** | `tests.first` accepted; the first pre-land check is red, one informed rework; green in 5.0 min, bug-free stalk |
| Semantic clash without a shared file: t002 breaks t001's test once both are in | t002 lands unchecked on the moved sprout; 2 red validations (the flake re-run), revert, **t002 dropped**; 4.3 min | the targeted check (`tests/t001.test.ts` only) is red before landing, one rework; **both green**, 0 red validations; 4.0 min |
| Author's test passes on the base (`VACUOUS`) | — | `tests.first` fallback; the given tests stay |

On the burst and calm scenarios (`v2-burst.test.ts`, 40 tasks, 12 agents, seed 7):

| Variant | Burst: green / red validations / done | Calm: green / done |
|---|---|---|
| v2.4 | 40 / 0 / 19.2 min | 40 / 8.5 min |
| v2.4 + targeted check | 40 / 0 / 19.2 min (identical events: no test read both sides) | 40 / 8.5 min (identical) |
| v2.4 + tests first | 40 / 0 / 14.0 min | 40 / 10.9 min |
| v2.5 (both) | 40 / 0 / 14.0 min | 40 / 10.9 min |

Tests first costs the author step (about 10 s of replay time and $0.005 per task here; E1 measured about $0.09 a task and 40% more wall time with real agents). On the burst it staggers the starts, which the replay agents reward; do not read the faster burst as a real gain. Both stay off by default: E1 measured them only together, on one race, and the arena's given tests see more cross-task contracts (5 of 5) than authors writing from one issue (1 of 5). A real race on the arena with the given tests hidden is the next step. The driver passes them from `TESTS_FIRST` and `TARGETED_LANDING_CHECK`. Replay agents write no tests for `test-first`, so a replay race falls back to the given tests.

## Dependency-aware starts

E4 found the limit at scale is independent work, not the committer (`docs/claude-opus/exp/e4-scale-replay.md`). With `start_order: dependency`, `src/engine/v2/v2-start-order.ts` picks the bean a free agent starts (the hook is `dispatch` in `v2-policy.ts`):

1. Two tasks depend on each other when their predicted footprints (`footprint.predicted`) share a module or the arena declares a coupling; the earlier in priority order goes first. Modules more than a third of the tasks predict (`src`, `(root)`) are ignored.
2. Age bound: a task that clashes with no bean in flight starts next once `ageBound` later tasks have started ahead of it (`rule: aged`). `ageBound` is `min(max(4, ⌈agents / 2⌉), max(1, ⌊tasks / 4⌋))`: 10 for 30 agents on 40 tasks, 6 for 12 agents. A task that clashes with a bean in flight is waiting for that bean, not starved; the stall bound (5) limits that wait. (Aging such beans too started the burst's culprits on top of their in-flight partners: under the v2.2 rules up to 16 more beans dropped.)
3. Otherwise a bean that clashes with no bean in flight (started, not landed) and no earlier unstarted task, longest dependent chain first (`disjoint` when it is the head, else `critical-path`).
4. Otherwise the bean with the fewest clashes, if it clashes with at most 2 beans in flight (`least-overlap`).
5. Otherwise the agent waits for a landing, for at most `STALL_SECONDS` (180 s): a bean whose clashing beans in flight all started that long ago starts anyway (`stalled`, fewest clashes first). A bean waiting for its start card holds no `startedAt` until the card's initial run; it counts from when its card opened (before, it counted as started now, so a clash with a carded bean never stalled). It is then the newest start in its chain, so a stuck chain takes one more bean per stall. When the agent waits, a `start-wake` policy timer wakes the scheduler when the first stall bound runs out, so a free agent never waits more than 180 s beside an unstarted bean. Nothing in flight always leaves a clear bean, so this never deadlocks.

Parked beans (waiting for a person) are not in flight: they do not hold their chain back.

The old age bound, a task fallen `max(4, 2 × agents)` starts behind its FIFO turn, could not fire at scale: 60 starts for 30 agents, more than a 40-task race has, and a task late in the list can never fall more than a few starts behind. In the 30-agent race `cf-demo-sonnet-30-s7` (demo preset) only 21 beans started in the first wave (9 agents got none, and 7 of the 30 never ran an invocation all race); from 9.7 to 26.7 minutes nothing started while four billing beans (t031, t032, t036, t039) waited behind three or four billing beans in flight, stuck in reworks and decisions (and from 19 minutes one of them, t023, parked), with more than 20 agents idle. t039 started at 32.9 minutes. Replayed by hand on the same timeline, the stall bound and parked beans out of flight would have started t031 at about 12 minutes and t039 by about 21.

`placement.decision` carries the rule, the overlap and the occupied modules; `summary.json` adds `start_order` only when it is not `fifo`, so FIFO runs stay byte-identical. Simulated results on the current engine (replay agents; v2.5 defaults unless the row says otherwise), before and after the bounds above:

| Scenario | FIFO | Dependency, old bound | Dependency, new bounds |
|---|---|---|---|
| Burst, 40 tasks, 12 agents | 40 green, done 16.1 min, 30th green 12.9 | 40 green, done 11.1, 30th green 7.5 | 40 green, done 14.0, 30th green 6.4 |
| Burst under the v2.2 rules | 20 green, 11 red validations, done 21.8 | 36 green, 2 red validations, done 10.6 | 36 green, 0 red validations, done 8.9 |
| 30 agents, 40 tasks in chains (9, 6, 5, 4, 3, 3, 2) | 40 green, 48 conflicts, last start 4.6 min, done 17.0 | 40 green, 29 conflicts, last start 20.8, done 28.9; a free agent sat 362 s beside unstarted work | 40 green, 32 conflicts, last start 17.3, done 25.3; at most 180 s |
| 100 tasks in chains, 32 agents, v2.4 rules | 98 green, 2 dropped, 54 conflicts, done 28.3 | 100 green, 31 conflicts, done 32.5 | 100 green, 32 conflicts, done 32.3 |
| 200 tasks in chains, 64 agents, v2.4 rules | 173 green, 27 dropped, 187 conflicts, 170th green 26.3, done 28.4 | 200 green, 108 conflicts, 170th green 28.2, done 60.5 | 198 green, 2 dropped, 123 conflicts, 170th green 28.6, done 58.9 |
| 200 tasks in chains, 64 agents | 200 green, 188 conflicts, done 31.2 | 200 green, 110 conflicts, done 60.9 | 200 green, 130 conflicts, done 61.2 |

Where every pipelined chain bean really conflicts with the one before (the synthetic chains), waiting is the point of dependency starts and FIFO still finishes first; the bounds trade a few of the saved conflicts for agents that no longer sit idle for long. Shorter stalls help the 30-agent row (90 s: last start 9.6 min, done 20.6; 120 s: 12.1 and 22.4) but give back 8 to 31 more conflicts on the 200-task chains, drop beans under the v2.4 rules (up to 12 of 200, 1 of 100) and break the 100-task chain test, so 180 s stays. The `v2-start-order.test.ts` regression ("more agents than independent work") runs the 30-agent row and checks the 180 s idle bound and the age bound.

The default stays `fifo` until a real-agent race confirms it. The gap found here (a bean started on top of its landed coupled partner could not name it as a culprit, because culprits were commits since the bean's base, so a semantic clash reworked to a drop instead of a card) is closed in v2.5: `start_cards` raises the declared pair's card before the bean starts, `base_culprits` names a partner in the base when the failing test reads what the bean changed, and `dynamic_culprits` probes it when the bean's own tests fail (`v2-start-order.test.ts`, "F's culprit gap"). The 200-task row was measured with the v2.4 rules; under v2.5's rescue, FIFO keeps all 200 too (dependency starts still cut the conflicts by about 40%), and the test runs a 100-task, 32-agent version to keep `pnpm check` fast.

## RPC for the web app

The web app (`packages/web`) calls the gateway over Workers RPC, never HTTP. It uses a service binding to this Worker's default entrypoint, `Gateway` (a `WorkerEntrypoint`). The types live in `@beanstalk/shared-race/rpc`:

```jsonc
// packages/web/wrangler.jsonc
"services": [{ "binding": "GATEWAY", "service": "beanstalk-gateway" }]
```

`wrangler types` types the binding as a plain `Fetcher`. Narrow it where it is used, to `Fetcher & GatewayRpc`; the generated `Env` stays as generated.

```ts
import type { GatewayRpc } from '@beanstalk/shared-race/rpc';

export type GatewayRpc = {
  listRuns(limit?: number): Promise<readonly RunListItem[]>;
  runView(run: string): Promise<RpcResult<RunView>>;
  runEvents(run: string, after: number, limit: number): Promise<RpcResult<RunEventsPage>>;
  decide(
    run: string,
    card: string,
    winner: string,
    actor: string,
    text?: string,
  ): Promise<RpcResult<{ readonly accepted: true }>>;
  viewToken(run: string): Promise<RpcResult<ViewToken>>;
  repoTree(
    run: string,
    ref: RepoRef,
    path?: string,
    recursive?: boolean,
  ): Promise<RpcResult<RepoTree>>;
  repoFile(run: string, ref: RepoRef, path: string): Promise<RpcResult<RepoFile>>;
  repoDiff(
    run: string,
    fromRef: RepoRef,
    toRef: RepoRef,
    paths?: readonly string[],
  ): Promise<RpcResult<RepoDiff>>;
  repoLog(
    run: string,
    ref: RepoRef,
    paths: readonly string[] | null,
    limit: number,
  ): Promise<RpcResult<RepoLog>>;
  repoGrep(
    run: string,
    ref: RepoRef,
    pattern: string,
    paths?: readonly string[],
    regex?: boolean, // default: `pattern` is a literal
  ): Promise<RpcResult<RepoGrep>>;
  beansByPath(run: string, paths: readonly string[]): Promise<RpcResult<readonly BeanSummary[]>>;
  beanDetail(run: string, bean: string): Promise<RpcResult<BeanDetail>>;
  decisions(run: string, paths?: readonly string[]): Promise<RpcResult<readonly DecisionRecord[]>>;
  testsFor(run: string, paths: readonly string[]): Promise<RpcResult<readonly TestCoverage[]>>;
  beanStreams(run: string): Promise<RpcResult<readonly BeanStreamSummary[]>>; // stream_diffs
  beanStream(run: string, bean: string): Promise<RpcResult<BeanStream | null>>; // stream_diffs
};

type RpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { code: string; status: number; message: string } };
```

Every method but `listRuns` answers an `RpcResult`. Errors use the HTTP API's codes and statuses:

- `invalid_request` 400;
- `not_found` 404;
- `unknown_card` 404;
- `invalid_winner` 422;
- `invalid_state` 409;
- `upstream_failed` 502.

Anything unexpected throws. The value types (`RunView`, `RepoTree`, `BeanDetail`, …) are documented field by field in `packages/shared-race/src/rpc.ts`.

| Method | What it answers | Bound |
|---|---|---|
| `listRuns(limit = 50)` | Every run, newest first, from the `RunIndex` Durable Object, which each RunDO updates as it steps | 200 runs |
| `runView(run)` | The run view, the same as `GET /v1/runs/:run` | |
| `runEvents(run, after, limit)` | `events.jsonl` lines after sequence number `after`, `next_after`, and `done` once the run is over and this page reached the end of the log (a reader stops on it) | 5,000 per page |
| `decide(run, card, winner, actor, text?)` | The only write: answers an open card, as the admin route does. `actor` names who decided (an email or a handle); the log records `human:<actor>`, and a leading `human:` is not doubled. `text` is the decision's wording | `text` 2,000 chars |
| `viewToken(run)` | A one-hour view token, and `live_path` for the live socket | |
| `repoTree(run, ref, path?, recursive?)` | One directory level at a ref. With `recursive`, every entry under the path in one call, sorted by path (one Artifacts read per level, in parallel batches) | 1,000 entries; 5,000 recursive |
| `repoFile(run, ref, path)` | A file at a ref. Binary files have no `content` | 256 KiB |
| `repoDiff(run, fromRef, toRef, paths?)` | Changed files with line counts, and a unified patch. A blob over 256 KB is not read: the file shows as binary (`Bin <before> -> <after> bytes`). Patches are rendered file by file and rendering stops once the cap is crossed, so the cut text says `at least N more chars` | 200 files, 100 KB of patch |
| `repoLog(run, ref, paths, limit)` | History at a ref, newest first. With `paths`, only commits whose change against their first parent touches them | 100 commits; 200 scanned when filtering |
| `repoGrep(run, ref, pattern, paths?, regex?)` | Matching lines of text files at a ref. `pattern` (1 to 200 characters) is a literal string; with `regex: true` it is a JavaScript regular expression limited to a safe subset (`src/repo/grep-pattern.ts`): a repeated group may not contain a repeat or an alternation (`(a+)+`, `(a\|aa)*`), and backreferences and lookbehind are refused (`400 invalid_request`). Lines are tested up to 2,000 characters | 300 files, 200 matches |
| `beansByPath(run, paths)` | Beans whose files lie under `paths` (every bean for `[]`). A bean's files are those of its landing, or else of its last commit, plus its acceptance tests. Each bean carries its `intent` (the task's prompt) | 200 beans |
| `beanDetail(run, bean)` | One bean's story from the event log: status, agent, intent, files, acceptance tests (amended or not), invocations, pre-land checks (`inherited` included), reworks and decisions | |
| `decisions(run, paths?)` | Decision cards, open and decided, with the failing tests and reds that raised them, outcome, text, who answered and the amendment. With `paths`, only cards whose beans or amendments touch them | |
| `testsFor(run, paths)` | Acceptance tests whose static import closure covers the paths, with their owner's status. Relative imports only, read at the sprout (the stalk for the queue), at most 5,000 files listed | |

Refs are `sprout`, `stalk`, `beans/<task>` or a 40-hex sha (`REPO_REF_PATTERN`). Paths are relative and inside the repo, at most 100 per call. When a bound is hit, the answer says `truncated: true`.

**The live socket.** RPC cannot carry a WebSocket, so the web Worker proxies the existing feed through the binding's `fetch`:

```ts
const token = await env.GATEWAY.viewToken(run);
if (!token.ok) return new Response(token.error.message, { status: token.error.status });
const url = new URL(token.value.live_path, 'https://gateway.internal');
url.searchParams.set('key', token.value.token);
return env.GATEWAY.fetch(new Request(url, request)); // keeps the client's Upgrade: websocket
```

The feed sends the run view first, then each step's events; an `update` carries `view` only when it changed since the last one sent (a viewer keeps the last view it got).

**Trust boundary.** The binding is the boundary: RPC calls are not authenticated by the gateway. Only the web Worker holds the binding, and it must authenticate its users before it calls `decide`. Repository reads go through the gateway's own Artifacts binding, so no token leaves the gateway.

**Where repo reads come from.** The brief asked for grep and diff on the runner, with a read-only token on a CI instance. The runner has no grep or diff endpoint, and the runner crate was outside this change. So `src/adapters/repo-explorer.ts` computes both in the Worker, from Artifacts tree and blob reads, within the bounds above. A grep runs inside the RunDO, on the thread that runs the engine, so its pattern is a literal unless the caller asks for the safe regex subset (see `repoGrep`), and lines are cut at 2,000 characters before the test; a pathological pattern cannot pin a race. Moving grep and diff to the runner later changes only that adapter.

## Repository engines: the git-native flow

The full design, messages and contracts are in `docs/claude-opus/18-git-native-flow.md`; this is the map.

- **What.** A continuous engine (`RunConfig.continuous`, `CONTINUOUS_SETTINGS`: the `demo` rules without a race's bounds) in a `RunDO` keyed by an engine id derived from `<owner>/<repo>`. No task list: beans arrive by push. It never finishes, sets no wall clock and no invocation watchdog, and never deletes its repository.
- **Push = submit** (`src/push/push-proxy.ts`). The proxy reads the push's commands and options (`src/git/push-request.ts`), refuses what is not one `refs/heads/bean/<name>` (in the protocol: `ng` plus a `remote:` line), forwards the rest to Artifacts with the options stripped, then hands the new head to the engine. `push-options` is added to the receive-pack advertisement (`src/git/advertisement.ts`). With `-o wait` the response streams progress, keepalives and the verdict before its final flush.
- **The push driver** (`src/push/push-driver.ts`) stands where the Python driver stands in a race: internal long polls on free slots; an `initial` invocation answered at once with the pushed head; a rework held until the bean's next push. It folds engine events into the `push_beans` table (`src/push/push-events.ts`) and publishes each bean's phase as the annotated tag `refs/beans/<name>/status` (`src/push/status-publisher.ts`, objects and packs built in the Worker by `src/git/pack-writer.ts`).
- **Engine changes** for intake only: the `admit` input (`src/engine/intake.ts`), a pushed bean's fork point as its base (`beginTask`), and the continuous switches in `settle`, `startRace` and `deliverPending`. The squash reads a continuous engine's beans at `refs/heads/bean/<name>`; its slots share two sandboxes.
- **RPC** (`RepoEngineRpc` in `@beanstalk/shared-race/rpc`, on the default entrypoint): `openRepoEngine(input) → {engineId, created, base_sha, git_path}`, `gitToken(engineId, user, ttl?)`, `pushedBeans(engineId)`, `closeRepoEngine(engineId, {deleteRepo})`. Every read RPC above takes the engine id as `run`.
- **Tests**: `test/git-native.test.ts` (the flow through the Worker with git's wire format), `src/git/git-native-wire.test.ts`, `src/push/*.test.ts`. A real git client: `research/race/git_native/local_e2e.py` (local stack, real checks) and `staging_e2e.py` (a deployed gateway); both run `demo.sh`.

## Running locally

```bash
cp .dev.vars.example .dev.vars            # fill ADMIN_TOKEN and RUN_TOKEN_SECRET (each at least 32 characters; a shorter one makes every request answer 500 `misconfigured`)
pnpm -F @beanstalk/gateway dev            # wrangler dev: needs Docker (runner) and a Cloudflare login (Artifacts is remote-only)
pnpm -F @beanstalk/gateway test           # Miniflare; fakes for Artifacts, the git remote and the runner; no network
pnpm -F @beanstalk/gateway types          # regenerate worker-configuration.d.ts after editing wrangler.jsonc
```

Without Docker or a Cloudflare login, `research/race/stream_e2e/devstack.py up` runs this Worker under `wrangler dev` with a local Artifacts stand-in (real bare repos behind `remotes.py`) and a local runner (real squashes, every check green), next to the web app under `vite dev`, so a real driver and real `claude -p` sessions can race against it (`stream_e2e/race.sh`). It was built to prove streaming diffs end to end (`docs/claude-opus/14-repository-experience.md`, streaming note).

The tests cover:

- the engine with a toy git and scripted agents, through the discrete-event simulator (`src/engine/testing/simulator.ts`):
  - queue races;
  - v2 races for a clean landing, an optimistic landing, a re-check, a conflict, an informed rework, decision cards, revert-first with and without bisection, and the leave-one-out search;
  - each v2.2 and v2.3 rule (`src/engine/v2/v2-rules.test.ts`);
  - the v2.2 burst and a calm race, v2.2 against v2.3 (`src/engine/v2/v2-burst.test.ts`);
  - reconcile before a card, a genuine contradiction, and the stale-failure guard (`src/engine/v2/v2-reconcile.test.ts`);
  - tests first (weak given tests, a fallback) and the targeted landing check (a semantic clash only it catches) (`src/engine/v2/v2-forge-tests.test.ts`), and v2.5 on the burst and calm races;
- determinism, and replay parity with the pre-v2.2 engine;
- the shell end to end: routes, auth, the git proxy and full races over HTTP (`SELF.fetch`), and every RPC method through the default entrypoint (`test/rpc.test.ts`, with `exports.default` from `cloudflare:workers`).

The pool's workerd predates the compatibility date in `wrangler.jsonc`, so the test config clamps the date to the newest one that workerd supports.
