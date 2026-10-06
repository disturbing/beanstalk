# Cloud races (`--forge cloudflare`)

`race.py --forge cloudflare` runs the same race as the local harness, but every integration decision is made by beanstalk's gateway on Cloudflare (`packages/gateway`): the RunDO picks the work, the runner container squashes, checks, lands and promotes, and the gateway logs `events.jsonl` and writes `summary.json` in the harness schema. Agents still run on this machine, through the harness's own adapters (`harness/agents.py`), so a local/cloud difference is a forge difference, not a driver one. The driver is `harness/remote.py` (`RemoteRace`).

## Run one

```bash
cd research/race
GW=https://beanstalk-gateway.<your-subdomain>.workers.dev   # printed by scripts/deploy-all.mjs
# free control (replay agents), the same flags as a local replay race; --preset demo pins v2.5 + dependency starts
../tools/race-slot.sh python3 race.py --forge cloudflare --gateway $GW --policy queue --agent replay \
  --agents 8 --ci-seconds 4.5 --ci-slots 2 --seed 7 --preset demo --max-usd 5 --out runs/cf-replay-queue-8-s7
../tools/race-slot.sh python3 race.py --forge cloudflare --gateway $GW --policy beanstalk-v2 --agent replay \
  --agents 8 --ci-seconds 4.5 --ci-slots 2 --seed 7 --snapshot head --error-budget 999 --protect-tests landed \
  --preland-mode optimistic --preland-seconds 4.5 --decision-seconds 1 --preset demo --max-usd 5 \
  --out runs/cf-replay-v2-8-s7
python3 kth_green.py runs/cf-replay-queue-8-s7 runs/cf-replay-v2-8-s7
```

- **Admin token:** `$BEANSTALK_ADMIN_TOKEN`, else `ADMIN_TOKEN` in `packages/gateway/.dev.vars`. It is never printed, and it is removed from the environment before any agent starts.
- **Gateway:** `--gateway URL`, or `$BEANSTALK_GATEWAY`.
- **Engine pin:** `--preset demo` runs v2.5 with dependency-aware starts and the tail fix (`DEMO_SETTINGS`: every v2.5 rule at its v2.5 value, `max_bean_invocations` 10, `tail_guard_minutes` 10, `start_order: dependency`, the other opt-in tracks off), the engine behind the published numbers (`runs/cf-v25dep2-sonnet-12-s7`, `-s11`, `-s13`), whatever the gateway's defaults are. `--preset v24` runs v2.4 (`V24_SETTINGS`, the `cf-v24-*` races). A v2 knob from the environment that contradicts the preset makes the gateway refuse the run. With the queue, a preset pins no v2-only rule (the queue never merges structurally). Without a preset, v2 runs the current defaults (v2.5, FIFO starts).
- **Spend guards:** `--max-usd X` aborts the run when agent spend plus its measured infrastructure cost reaches `X` (exit 2, like `--budget-usd`). The run's Artifacts repo is deleted after the final check unless `--keep-repo`; the gateway's hourly sweep deletes anything older than a day. The driver prints the run's infrastructure cost and `summary.json` keeps it under `infra`.
- **Streaming diffs:** `--stream-diffs` sets `stream_diffs` on the run. While an `initial`, `rework`, `sync` or `fixer` invocation runs, the driver posts the bean's working change to `…/invocations/:inv/stream` after each edit tool call (Claude Code's `PostToolUse` hook touches a marker; a 3 s timer covers Bash edits and Codex), at most once per 1.5 s, and logs each post as `driver.stream` (bytes, diff and post times, edit-to-post) in `driver.jsonl` (gateway README, "Streaming diffs"). The engine never reads it. `stream_e2e/` runs the whole loop locally (`devstack.py up`, `race.sh`, `latency.py`, `overhead.py`).
- **Check without a run:** `--dry-run` sets up locally, builds the run config, and checks that the gateway is up and accepts the admin token. It writes `dry_run.json`.
- **Fixed gateway bugs (2026-10-03):**
  - *Fork race at the start:* concurrent bean forks could answer `NOT_FOUND` and abort the run. Fork errors are now retried, and a fork that still fails drops only its task. `--stagger-start 6` is no longer needed.
  - *Late forks were unreadable:* a bean forked after the first landing could not read the run repo's objects. Beans are now branches of the run repo (`refs/heads/beans/<task>`), so there are no late forks.
  - *Artifacts "stored delta chain contains a cycle":* revert pushes were refused. The runner now pushes with `pack.window=0` (`docs/claude-opus/exp/artifacts-delta-cycle-bug.md`).
- **Auth probe:** before a `claude` race creates its run, the driver makes one Haiku turn through the same CLI (about $0.004). If credentials are refused or a rate limit is hit, the race stops there and no run is created. `--no-auth-probe` skips the probe.
- **Policies:** `queue` and `beanstalk-v2` only.
- **v2 knobs:** `--preland-mode`, `--preland-seconds`, `--decision-seconds` and `--decision-oracle` work on both forges. Each resolves from the flag, then the harness's environment variable (`PRELAND_MODE` …), then the harness default (`locked`, 0, 30, `landed`). The same command line therefore means the same race on both forges. v2 on the gateway always implies `--snapshot head --error-budget 999 --protect-tests landed`; an explicit conflicting flag is an error.
- **v2.2 to v2.5 knobs (gateway only, v2 only):** `WINDOW` (`aimd`, `off`), `PRELAND_RECHECK` (`sampled`, `adaptive`, `file`, `hunk`, `never`), `PRELAND_ADAPT_FALLBACK`, `RELEASE_ON_CHECK`, `FLAKE_CONFIRM`, `INHERITED_REDS` (`readset`, `validation`, `off`), `EARLY_TICKETS`, `RECONCILE`, `DECISION_OUTCOME` (`reexecute`, `decline`), `DECISION_MODE` (`oracle`, `human`), `HUMAN_TIMEOUT_SECONDS`, and v2.5's `ESCALATE_AFTER` (`1`, `2`), `RECONCILE_PARTIES` (`1` to `3`), `SINGLE_SUSPECT_REVERT`, `VALIDATION_FIRST`, `BASE_CULPRITS`, `WINDOW_START`, `WINDOW_GROWTH`, `WINDOW_MAX`, `WINDOW_MIN`, `STRUCTURAL_MERGE`, `START_CARDS`, `RESCUE`, `DYNAMIC_CULPRITS`, `TESTS_FIRST`, `TARGETED_LANDING_CHECK`, `START_ORDER` (`fifo`, `dependency`), `LIVE_SYNC` (`off`, `overlap`, `all`), `LIVE_SYNC_MIDRUN` (`1`), and the 30-agent stall fix's `RED_RESET` (`0`: bisect and revert as v2.5), `EPISODE_TICKETS` and `REPAIR_LANDING` (both off by default). The driver sends a knob only when its variable is set, so the gateway's v2.5 defaults apply otherwise:
  - the sprout window (AIMD backpressure), starting at 8;
  - sampled re-checks;
  - the agent released during its check;
  - flake-confirmed reverts, and a red final suite re-run once on a commit validated green;
  - read-set inherited reds;
  - early tickets, and a lone read-set suspect reverted without a bisect;
  - culprits named in the bean's base, and confirmed by leave-one-out probes when the bean's own tests fail;
  - a reconcile step before any card, in which a test author updates values that one task's tests pin and another task legitimately changes, with every landed task behind the failing tests (up to three);
  - escalation after one failed informed repair whose failing test file fails again against the same counterpart (reconcile, then a card; a counterpart already reconciled and decided drops the bean, after one rescue);
  - start cards for declared couplings, and one rescue re-execution when the rework rounds run out;
  - the runner's structural merge tier (Mergiraf) before a conflict; the queue never gets it;
  - losers re-executed against amended tests.

  Tests first, the targeted landing check, dependency-aware starts and live sprout sync stay off unless set. With `LIVE_SYNC`, a bean whose agent worked while other beans landed gets a `sync` invocation before its pre-land check (the new sprout merged, its session resumed); the driver runs it as a rework, and if its own merge conflicts it aborts the merge and posts `sync-conflict` without running the agent (`driver.sync_conflict` in `driver.jsonl`). With `LIVE_SYNC_MIDRUN=1`, `initial` and `rework` invocations of `claude` and `codex` get a hook after every tool call (`harness/midrun.py`): the driver reports the agent's changed files on each `progress` post, fetches any sprout the reply offers and leaves it in `work/midrun/<inv>/pending.json`; the hook merges it under the agent's uncommitted work at a safe point when it merges cleanly, else only adds a note (Codex: note only), and logs to `work/midrun/<inv>/hook.jsonl`, which the driver copies into `driver.jsonl` (`driver.midrun_offered`, `driver.midrun_hook`) and reports in the result (`midrun_syncs`). For Claude Code this drops `--safe-mode` for those invocations (safe mode also disables `--settings` hooks); `--restricted`, `--setting-sources ""`, `--strict-mcp-config` and the tool rules stay. The gateway README's "Version labels" lists the labels and the environment of each phase race (v2.4 baseline, v2.5a to v2.5d, + dependency starts, + tests track). To rerun v2.4, set `ESCALATE_AFTER=2 RECONCILE_PARTIES=1 SINGLE_SUSPECT_REVERT=0 VALIDATION_FIRST=0 BASE_CULPRITS=0 WINDOW_START=4 STRUCTURAL_MERGE=0 START_CARDS=0 RESCUE=0 DYNAMIC_CULPRITS=0` (`V24`). Add `RECONCILE=0` for v2.3; add `PRELAND_RECHECK=adaptive WINDOW=off INHERITED_REDS=validation EARLY_TICKETS=0 RECONCILE=0` for v2.2. To reproduce a pre-v2.2 run, set `V24` plus `PRELAND_RECHECK=file WINDOW=off RELEASE_ON_CHECK=0 FLAKE_CONFIRM=0 INHERITED_REDS=off EARLY_TICKETS=0 RECONCILE=0 DECISION_OUTCOME=decline` (the gateway README, "Replay parity").
- **Outputs** (same as a local run): `events.jsonl` and `summary.json` downloaded from the gateway, `summary.md` rendered by `summary.py`, and `config.json` (adds `forge`, `gateway`, `run`). `work/` holds the bean worktrees, transcripts, the arena snapshot, and `driver.jsonl`, the driver's own log of prepare/merge/push/post per invocation. `summary.py`, `report.py` and `kth_green.py` read the run unchanged.
- **Live page:** its link carries a view token, so it is printed only when stderr is a terminal or with `--live-url`.
- **Exit status:** 0 done, 2 aborted on budget, 3 otherwise. Ctrl-C asks the gateway to stop (it then runs the final check) and still downloads the results; a second Ctrl-C stops waiting.

## What the driver does per invocation (gateway README, "Driver contract")

1. **Workspace:** one clone per task under `work/agents/<task>`. It fetches the bean through the gateway's git proxy with the slot token, checks out `task/<id>` at `head_sha` (`base_sha` before the first push), and writes the acceptance tests before the first run. A worktree whose HEAD and in-progress merge already match is kept as it is, as the harness keeps a task's worktree (markers left from the previous round, or a failed resume retried fresh).
2. **Merge:** fetches `merge.ref` from `repo_url` into the branch the prompts name (`trunk` for the sprout, `main` for the queue's stalk), then runs `git merge --no-commit --no-ff merge.sha`. CHANGELOG merges use `merge=union` per `union_paths`. It skips the merge when `merge.sha` is already an ancestor.
3. **Agent:** runs the run's adapter with the instruction's prompt, `resume`, `model`, `max_turns`, `timeout_seconds` and `budget_cap_usd`. Replay agents get the harness's replay spec: the task's reference patch, the `fix.patch` of each task in `replay.fixes`, `reset_to`, and `check` with the task's tests. Cost estimates go to `progress`; an `abort` answer kills the agent.
   - **Infra failures are never posted as the agent's work.** These are refused credentials (`403 Request not allowed`, `/login`), rate limits (`429`, a rate-limit rejection) and an unavailable API (`5xx`, overloaded). `claude -p` reports them as an `is_error` result. Posting one would make the engine rework or drop the bean.
   - Instead the slot keeps the invocation open, backs off (15 s, doubling to 60 s), and runs it again in the same workspace. The attempt that works is posted, carrying the cost of the failed attempts and a note.
   - A run-wide clock tracks the outage. If failures last 5 minutes without a success in any slot, the driver stops the run with reason `infra: <kind> failures …` (exit 3). `BEANSTALK_OUTAGE_SECONDS` and `BEANSTALK_INFRA_BACKOFF` override the limit and the first pause.
4. **Commit and push:** no commit when the gateway will retry (a failed initial, a failed resume) or markers are left (reworks). Otherwise it restores the task's acceptance tests and the `protect` tests whose content is in HEAD or MERGE_HEAD (`core.py` `restore_acceptance` and `protect_landed`), commits with `commit_message`, and pushes `task/<id>`.
5. **Result:** posts `InvocationResult.to_event()` + `init` + the git fields (`head_sha`, `new_commit`, `files`, `tamper`, `markers_left`, `merge_conflicts`).

Tokens never reach argv, a config file or a log. Git gets the slot or seed token through `GIT_CONFIG_*` environment variables, and every error text is scrubbed. Refreshed slot tokens from `next` replace the old ones; a rejected token is re-issued once through the admin route.

## Tests

`python3 -m unittest discover -s tests` includes `tests/test_remote.py`. It runs the driver against `tests/fake_gateway.py`, a stdlib fake of the gateway's routes whose git proxy is `git http-backend` over local bare repos. A scripted two-task v2 race covers seeding, initial commits and pushes, a conflict rework on a merge of the sprout, a token refresh, progress, paging of events and the summary. Separate tests cover:

- the commit path: tamper and the lineage rule, markers, retries;
- a refused result posted again with the core fields;
- a progress `abort` answer that kills the agent;
- agent-CLI outages with `tests/fake_claude_outage.py`: a short one retried, a long one that stops the run, and the probe;
- the CLI and token handling.
