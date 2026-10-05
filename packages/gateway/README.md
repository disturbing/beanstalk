# @beanstalk/gateway

The race gateway (plan `docs/claude-opus/10-cf-prototype-plan.md`, items 2–3 of §7). It is a Worker that runs agent races in the cloud. It does four things:

- holds one Durable Object per run (`RunDO`), which runs a deterministic race engine;
- hands work to Python driver slots over long polls;
- proxies git for the agents, which never hold Artifacts tokens;
- drives the runner container for squashes, reverts, suites and ref updates.

It also serves the web app over RPC (see [RPC for the web app](#rpc-for-the-web-app)).

The engine ports two harness policies, `queue` (the baseline) and `beanstalk-v2` (the product). v2 runs the v2.4 rules by default (see [The v2.2 to v2.4 rules](#the-v22-to-v24-rules)). Every run logs `events.jsonl` in the harness schema and writes a `summary.json`, so `research/race` tools (`summary.py`, `report.py`, `kth_green.py`) read cloud runs unchanged.

## Names

| Public name (API, refs, live page) | What it is | Harness name (events, summary) |
|---|---|---|
| **bean** | One agent's change: the branch `refs/heads/beans/<task>` of the run repo `race-<run>`, pushed by the driver | task worktree, `task/<id>` |
| **sprout** | The staged line `refs/heads/sprout` of the run repo `race-<run>`. Beans land here after their pre-land check passes | `trunk` (`trunk_idx`, `land.target: "trunk"`) |
| **stalk** | The stable line `refs/heads/stalk`. It only moves to validated commits and is the run repo's default branch | `green` (`green.promote`, `green_idx`) |

Event types and field names stay identical to the harness. The queue has no staged line: it lands verified batches straight on the stalk, and its `land` events keep `target: "main"`. Prompts are the harness's, word for word, so they still say "trunk" and "main".

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
| `POST /v1/runs/:run/reap` | admin | `{dry_run}` (default `true`). A dry run lists the run's Artifacts repos: `race-<run>`, plus any `race-<run>-*` left by earlier gateways. `{"dry_run": false}` deletes them. `409` while the race runs |
| `GET /v1/runs/:run` | admin, view or slot token | The run view (state, slots, CI, cost, `policy_state`) |
| `GET /v1/runs/:run/summary` | reader | `summary.json` |
| `GET /v1/runs/:run/events?after=&limit=&format=json\|jsonl` | reader | The event log. `jsonl` is byte-for-byte `events.jsonl` |
| `GET /v1/runs/:run/live` | reader (`?key=`) | WebSocket feed: the view, then each step's events |
| `GET /runs/:run?key=<view token>` | view token in the page URL | Live page: lanes, sprout and stalk, beans, decision cards, CI, cost |
| `POST /v1/runs/:run/agents/:slot/next` | slot token | Long poll, up to 25 s, for the slot's next invocation |
| `POST /v1/runs/:run/invocations/:inv/result` | slot token | The invocation's result, posted after the driver commits and pushes |
| `POST /v1/runs/:run/invocations/:inv/progress` | slot token | `{cost_usd}`, the running estimate. The answer can tell the driver to abort |
| `/git/<namespace>/<repo>.git/*` | slot or seed token, as Bearer or Basic password | Git smart-HTTP proxy. A slot reads the run repo and pushes only its own bean branch `refs/heads/beans/<task>`; the proxy refuses other refs and deletions. The seed token pushes the sprout and the stalk before the start. Bodies stream through; the gateway mints a short-lived Artifacts token server-side |

Errors are `{"error": {"code", "message", "issues?"}}`. Run tokens are `bst1.<claims>.<HMAC>` with scope `slot`, `seed` or `view`.

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
curl -s -H "$A" $GW/v1/runs/$RUN/summary > summary.json
curl -s -H "$A" -H 'content-type: application/json' -d '{"dry_run": false}' $GW/v1/runs/$RUN/reap
```

`run.json` is the harness's `RaceConfig` with the same names and defaults, plus `tasks`, in the arena JSON format. v2 adds these fields:

- `preland_mode`: `optimistic` (the default) or `locked`;
- `preland_seconds`: `null` (the default) means `ci_seconds`;
- `decision_seconds`: 30 by default;
- `decision_oracle`: `landed` (the default), `arriving` or `none` (wait for the admin);
- the v2.2 to v2.4 rules, all on by default: `window`, `recheck`, `recheck_fallback`, `release_on_check`, `flake_confirm`, `inherited_reds`, `early_tickets`, `reconcile`, `decision_outcome`, `decision_mode` and `human_timeout_seconds` (see [The v2.2 to v2.4 rules](#the-v22-to-v24-rules));
- E6's remaining rules, also on by default: `start_cards`, `rescue` and `dynamic_culprits` (see [Start cards, rescue and dynamic culprits](#start-cards-rescue-and-dynamic-culprits-e6)).

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

`kind` is one of these:

- `initial`;
- `rework`;
- `fixer` (the queue only);
- `test-author` (v2.2 cards);
- `reconcile` (v2.4: a test author amends both clashing tasks' acceptance tests on the arriving bean's branch; like `test-author`, only changes to the `acceptance` files are committed).

With `release_on_check`, a rework can come to any slot. Its `resume` names the author's session. So the driver runs every invocation in the bean's own directory (`work/agents/<task>`), whichever slot it came to, and the session resumes there. Sessions live on the machine that ran them, so `remote.py` drives every slot of a run from one process. A resume that fails is retried once as a fresh session.

For each invocation:

1. Check out the bean at `head_sha`, or `base_sha` before the first push.
2. If `merge` is set, fetch `merge.ref` from `repo_url` and merge `merge.sha` with `--no-commit --no-ff`. Skip this when `merge.sha` is already an ancestor.
3. Run the agent.
4. Restore `acceptance`, and restore each `protect` file whose content is in the lineage.
5. Commit with `commit_message`, unless conflict markers are left. A `test-author` invocation is the exception: its `acceptance` files are the tests to amend, written at the start and never restored, and the driver commits changes to those files only, discarding any other change.
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

The result body is `InvocationResult.to_event()` plus the git fields. Unknown keys are dropped. `turns` and `wall_seconds` are accepted as fallbacks for `num_turns` and `wall_ms`.

Progress uses the same shape: `POST …/progress {"cost_usd": 0.02}` answers `{"abort": false}`, or `{"abort": true, "reason": "budget: …"}`.

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
| `prompts.py`, `preland_red`, `informed_red` | `prompts.ts` (verbatim) |
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

A run therefore needs `agents + ci_slots + 1` container instances. They are `standard-2` (1 vCPU); on `standard-1` suites took 12.7 s median against 0.9 s locally. `max_instances` is 48 and `sleepAfter` is 2 min: a cloud race at 24 hit the cap while the previous runs' idle runners were still asleep (10 min), and four beans were dropped as infrastructure failures. 48 fits a 20-agent v2 run (23 instances) beside other work.

### Where v2 differs from the harness

- **Pre-land squash.** It runs on the committer, not in the sandbox, because the runner's `/v1/squash` publishes a candidate ref and so needs a write token.
- **Optimistic disjointness.** The test uses the union of the files of the sprout commits that landed meanwhile, not `git diff head0 head`. This is conservative.
- **Decision cards.** A card can also be answered by the admin route or the web app (`decide`). Under `decision_outcome: decline` (v2.0), when the arriving bean wins, the landed losers are reverted in the turn and dropped, and the arriving bean goes back to its landing loop. The harness's `arriving` oracle drops the arriving task anyway. Under `reexecute` (the v2.2 default) nothing is reverted, as described below.
- **Revert-first after a bisection.** Revert-first also follows a trunk bisection when no read-set suspect exists; the harness would send a fixer there. No fixer is ever sent.
- **Markers after an informed rework.** Conflict markers left after an informed rework drop the bean.
- **Protected tests.** The `protect` list is computed when the invocation is created.
- **The stalk ref.** It follows promotions through serialized compare-and-swap ref updates.
- **Error budget.** The error-budget controller is not built; v2 reports `error_budget: 999`.

## The v2.2 to v2.4 rules

The experiments validated the v2.2 rules (`docs/claude-opus/11-experiments-summary.md`). v2.3 answers v2.2's first real race (cloud run `qpucqup50w`, 12 Sonnet agents, seed 7). There, 24 beans were green and 16 dropped, 11 of them innocent beans that spent their rework rounds on reds that were not theirs. Each rule is a `RunConfig` field, on by default for `beanstalk-v2`:

| Rule | Config (default) | What the engine does | From |
|---|---|---|---|
| Sprout window | `window: aimd` (`off`) | At most W commits sit above the last validated sprout commit. A green bean beyond the window waits, oldest first (`window.wait`), and is checked against the window again when its turn comes. W starts at 4, grows by 2 per green validation (to 16) and halves on a red sprout (to 2), once per red episode (`window.resize`). A red whose failures an open ticket already covers does not halve it again. Every bisection stays within W. When nothing can make room (no validation, nothing to repair), one bean at a time goes through | v2.3 |
| Re-check that measures what it skips | `recheck: sampled` (`adaptive`, `file`, `hunk`, `never`), `recheck_fallback: file` (`hunk`) | A green bean whose files overlap commits that landed during its check checks again. `sampled` re-checks until 5 re-checks in a row come back green, then skips all but 1 in 4. A red re-check or a red sprout starts it re-checking again. v2.2's `adaptive` judged by first checks on a calm base, which lag the contention. It skips while the last 20 pre-land checks hold at least 5 outcomes and under 10% red. `hunk` re-checks only when changed line ranges in a shared file are within 3 lines | v2.3; E2 |
| Release the agent during its check | `release_on_check: true` | The agent's slot is free once its bean is submitted. A red check or a conflict queues a rework for the next free slot, preferring the author's slot, and reworks go before new tasks. The rework resumes the author's session | E5 |
| Flake confirmation | `flake_confirm: true` | Before revert-first, a red validation runs again on the same commit. If a file that failed the first run fails again, the red stands. Otherwise the engine logs `flake.suspected`, records the test as flaky and counts the validation green. Pre-land reds are never re-run | E3 |
| Inherited reds | `inherited_reds: readset` (`validation`, `off`) | A pre-land red that is the sprout's, not the bean's, costs no rework round. `preland.check` carries `inherited: true`, and the bean waits for the sprout to move, or for its repair to end, then checks again (at most 3 times). A failing test is the sprout's when it already failed a validation of the sprout the bean was checked on (`validation`, E6). Under `readset`, it is also the sprout's when the bean changed neither the test file nor any file in its import closure, as the runner reports it. A bean that changed a file every test depends on is never cleared this way: `package.json`, a lockfile, `tsconfig*.json`, a vitest/vite/jest config | v2.3; E6 |
| Early tickets | `early_tickets: true` | An inherited red is a sighting of a red sprout at the commit it was checked on. Two beans' sightings of one test file there, or one sighting and a red validation of that commit, prove it red. Revert-first starts at once (`ticket.open` with `early: true`), with read-set suspects among the commits since the last green validation, without waiting for the validation queue. A sighting also confirms a red validation that waits for its flake re-run | v2.3 |
| Reconcile before a card | `reconcile: true` (`false`: v2.3) | Where a card would be raised, a `reconcile` invocation first gets both tasks' intents and both owners' failing tests, on the arriving bean's branch (which already merged the landed task). It may amend the two tasks' acceptance tests only, updating assertions that pin a value the other intent legitimately changes. A commit that changes them is RECONCILED: the bean's own tests are amended at once, and the landed task's travel with the bean as a carried amendment (they land with it, and are rolled back if it is dropped). The bean then checks again; a green check is the proof. A commit that changes nothing is a CONTRADICTION, and only that raises the card. Each pair is reconciled once. The same setting re-checks, without a rework round, a red whose failing tests belong to a task reverted after the check began (`preland.recheck` with `stale`) | v2.4 |
| Cards that re-execute the loser | `decision_outcome: reexecute` (`decline`), `decision_mode: oracle` (`human`), `human_timeout_seconds: null` | The winner is never reverted. See below. With `reconcile`, the loser's test author also sees the winner's failing tests as they are now | E6 |

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
- `decision.reconcile` (v2.4: `task`, `against`, `outcome` `reconciled` or `contradiction`, the changed `files`, the author's `reason`, `inv`).

Optional fields on existing types:

- `decision.made.outcome` and `.text`;
- `rework.start.card`;
- `preland.check.inherited`;
- `ticket.open.early`;
- `preland.recheck.stale`.

`summary.json` adds the v2.2 to v2.4 keys after the harness's v2 keys (`window`, `window_size`, `window_waits`, `recheck_samples`, `early_tickets`, `early_tickets_opened`, `confirmed_by_sighting`, `reconcile`, `reconciles`, `reconciled`, `contradictions`, `stale_rechecks`), and the matching rows after `Variant`. `runView`'s `policy_state` shows `window` (size, unvalidated, waiting beans) and `recheck_mode`.

**Replay parity.** These settings reproduce the event streams the engine logged before v2.2, byte for byte:

```json
{"recheck": "file", "window": "off", "release_on_check": false, "flake_confirm": false,
 "inherited_reds": "off", "early_tickets": false, "reconcile": false, "decision_outcome": "decline",
 "start_cards": false, "rescue": false, "dynamic_culprits": false}
```

`src/engine/parity.test.ts` checks this over 11 golden scenarios. Such a run reports `variant: "v2"`. A run with `reconcile` reports `"v2.4"`, one with any other v2.3 rule `"v2.3"`, and any other run `"v2.2"`. `{"reconcile": false}` runs v2.3 again, and these settings run v2.2:

```json
{"recheck": "adaptive", "window": "off", "inherited_reds": "validation", "early_tickets": false,
 "reconcile": false}
```

v2.2 there also gets the two bug fixes below. The driver passes the knobs through from `PRELAND_RECHECK`, `PRELAND_ADAPT_FALLBACK`, `WINDOW`, `RELEASE_ON_CHECK`, `FLAKE_CONFIRM`, `INHERITED_REDS`, `EARLY_TICKETS`, `RECONCILE`, `DECISION_OUTCOME`, `DECISION_MODE`, `HUMAN_TIMEOUT_SECONDS`, `START_CARDS`, `RESCUE` and `DYNAMIC_CULPRITS`. It sends them only when they are set, so the gateway's defaults apply otherwise.

**Fixed in v2.3.** Two bugs from v2.2 and v2:

- A red validation whose re-run was red again was taken for a flake when a ticket opened meanwhile covered its failures. The engine then promoted a red commit to the stalk.
- The leave-one-out culprit search gave every probe the commit of the probe built last. One probe's result was then lost, and the ticket never finished.

**The burst scenario.** `src/engine/v2/v2-burst.test.ts` replays the shape of the race:
- twelve agents released during their checks, with initial runs of 15–35 s and a tail of slower beans;
- two CI slots;
- four coupled pairs that each break a module test together.

v2.2 drops 20 of 40 beans there, 16 of them still red after their pre-land reworks. v2.3 drops none and finishes sooner.

### Start cards, rescue and dynamic culprits (E6)

The rest of E6 (`docs/claude-opus/exp/e6-decision-cards.md` §2.4, §2.5, §5.3). Each is a `RunConfig` field, on by default for `beanstalk-v2`, and off in the parity settings. They change no label: `variant` still names the v2.x rules, and the summary reports these by their own keys.

| Rule | Config (default) | What the engine does | E6 |
|---|---|---|---|
| Start cards from declared couplings | `start_cards: true` | Tasks declare semantic couplings (`couplings`, type `semantic`, either side). When a bean is about to start and a declared partner is on the sprout, the pair's card is raised before any work (`decision.request` with `trigger: "start"`, `attempts: 0`); its agent is released meanwhile. The card runs as any other: the oracle or a human decides, the test author amends the loser's tests (fail-first on the sprout head for an arriving loser; in place for a landed loser, merged and carried by the arriving winner). Then the bean's initial run starts from the sprout head with the decision, the winner's intent and diff, and its amended tests (E6's `start_context` prompt). At most one start card per bean. Against a declared partner still in flight: the first red check that names it goes to reconcile (or the card) at once instead of after three, and a bean whose check passed is checked again when a declared partner landed meanwhile, even on disjoint files (E6 `partner_rechecks`) | `CARD_AFTER_KNOWN=-1`, `COUPLING_PRIOR=arena` |
| Rescue | `rescue: true` | When a bean's rework rounds run out (a red check or an unresolved conflict), it is re-executed once from scratch: a fresh session on the sprout head, with the last merged tree's failing tests (up to 12) and every decision in force (`rescue.start`, then `rework.start` with `reason: "rescue"`). Its rounds start over; a second exhaustion drops it. This also catches a card's loser whose re-execution still fails | `RESCUE=1` |
| Dynamic culprits | `dynamic_culprits: true` | When a bean's own acceptance tests fail its check (and no landed declared partner's tests do), the landed beans whose files those tests read are probed wherever they landed, before the bean's snapshot too: declared partners first, then the newest, at most 24, four at a time. A probe reverts one bean from the checked tree and runs the suite in the agent's sandbox (no emulated latency); the bean is confirmed when the own failing tests pass without it. Confirmed beans replace v2's read-set guess (commits since the snapshot), and none confirmed names none (`culprit.dynamic`). E6 ranked candidates by covered lines (`node --test --experimental-test-coverage` and `git blame`); the runner reports no coverage, so the order is partners, then recency | `DYNAMIC_CULPRITS=1` |

Events: `rescue.start` (`task`, `why`, `rounds`) and `culprit.dynamic` (`task`, `candidates`, `confirmed`) are new; `decision.request.trigger` is optional. `summary.json` adds `start_cards`, `start_cards_raised`, `rescue`, `rescues`, `dynamic_culprits`, `dynamic_culprit_runs` and `dynamic_culprit_probes` after `stale_rechecks`, and the row `Start cards / rescues / dynamic culprit searches (probes)`.

In the simulator (`v2-start.test.ts`, `v2-burst.test.ts`; 40 beans, 12 replay agents, 2 CI slots, seed 7):

| Scenario | v2.4 (the E6 rules off) | With the E6 rules |
|---|---|---|
| Burst (4 coupled pairs, undeclared) | 40 green, 19.2 min | identical: 40 green, 19.2 min |
| Burst, pairs declared as couplings | 40 green, 19.2 min | 40 green, **16.0 min** (cards at the first red) |
| Calm (overlaps only) | 40 green, 8.5 min | identical |
| v2.2 rules on the burst | 27 green, 13 dropped (9 still red) | with `rescue`: 36 green, 0 still red |
| A bean whose own test pins what a landed partner changed | dropped (no culprit named) | start card, amended, green with no red check; without start cards, dynamic culprits name the partner and a card ships it |

**Still not ported from E6:** the contract oracle, `CARD_AFTER=1` for undeclared pairs (v2 asks after its usual three reds), coverage-ranked culprit candidates, and adopt-arriving by revert (E6 found in-place adoption was the rule). The targeted check of the exact landing tree (E1) is not built either. A start card's initial run that fails to start is retried with the plain initial prompt (its amended tests still apply).

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
  ): Promise<RpcResult<RepoGrep>>;
  beansByPath(run: string, paths: readonly string[]): Promise<RpcResult<readonly BeanSummary[]>>;
  beanDetail(run: string, bean: string): Promise<RpcResult<BeanDetail>>;
  decisions(run: string, paths?: readonly string[]): Promise<RpcResult<readonly DecisionRecord[]>>;
  testsFor(run: string, paths: readonly string[]): Promise<RpcResult<readonly TestCoverage[]>>;
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
| `runEvents(run, after, limit)` | `events.jsonl` lines after sequence number `after`, and `next_after` | 5,000 per page |
| `decide(run, card, winner, actor, text?)` | The only write: answers an open card, as the admin route does. `actor` names who decided (an email or a handle); the log records `human:<actor>`, and a leading `human:` is not doubled. `text` is the decision's wording | `text` 2,000 chars |
| `viewToken(run)` | A one-hour view token, and `live_path` for the live socket | |
| `repoTree(run, ref, path?, recursive?)` | One directory level at a ref. With `recursive`, every entry under the path in one call, sorted by path (one Artifacts read per level, in parallel batches) | 1,000 entries; 5,000 recursive |
| `repoFile(run, ref, path)` | A file at a ref. Binary files have no `content` | 256 KiB |
| `repoDiff(run, fromRef, toRef, paths?)` | Changed files with line counts, and a unified patch | 200 files, 100 KB of patch |
| `repoLog(run, ref, paths, limit)` | History at a ref, newest first. With `paths`, only commits whose change against their first parent touches them | 100 commits; 200 scanned when filtering |
| `repoGrep(run, ref, pattern, paths?)` | Matching lines of text files at a ref. `pattern` is a JavaScript regular expression of 1 to 200 characters, tested line by line | 300 files, 200 matches |
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

The feed sends the run view first, then each step's events.

**Trust boundary.** The binding is the boundary: RPC calls are not authenticated by the gateway. Only the web Worker holds the binding, and it must authenticate its users before it calls `decide`. Repository reads go through the gateway's own Artifacts binding, so no token leaves the gateway.

**Where repo reads come from.** The brief asked for grep and diff on the runner, with a read-only token on a CI instance. The runner has no grep or diff endpoint, and the runner crate was outside this change. So `src/adapters/repo-explorer.ts` computes both in the Worker, from Artifacts tree and blob reads, within the bounds above. A grep pattern runs in the gateway, where the Worker's CPU limit bounds a pathological one. Moving grep and diff to the runner later changes only that adapter.

## Running locally

```bash
cp .dev.vars.example .dev.vars            # fill ADMIN_TOKEN and RUN_TOKEN_SECRET
pnpm -F @beanstalk/gateway dev            # wrangler dev: needs Docker (runner) and a Cloudflare login (Artifacts is remote-only)
pnpm -F @beanstalk/gateway test           # Miniflare; fakes for Artifacts, the git remote and the runner; no network
pnpm -F @beanstalk/gateway types          # regenerate worker-configuration.d.ts after editing wrangler.jsonc
```

The tests cover:

- the engine with a toy git and scripted agents, through the discrete-event simulator (`src/engine/testing/simulator.ts`):
  - queue races;
  - v2 races for a clean landing, an optimistic landing, a re-check, a conflict, an informed rework, decision cards, revert-first with and without bisection, and the leave-one-out search;
  - each v2.2 and v2.3 rule (`src/engine/v2/v2-rules.test.ts`);
  - the v2.2 burst and a calm race, v2.2 against v2.3 (`src/engine/v2/v2-burst.test.ts`);
  - reconcile before a card, a genuine contradiction, and the stale-failure guard (`src/engine/v2/v2-reconcile.test.ts`);
- determinism, and replay parity with the pre-v2.2 engine;
- the shell end to end: routes, auth, the git proxy and full races over HTTP (`SELF.fetch`), and every RPC method through the default entrypoint (`test/rpc.test.ts`, with `exports.default` from `cloudflare:workers`).

The pool's workerd predates the compatibility date in `wrangler.jsonc`, so the test config clamps the date to the newest one that workerd supports.
