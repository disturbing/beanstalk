# GitHub races (`--forge github`)

`race.py --forge github` runs the queue race with **GitHub as the integrator**: a real public repository in an organisation, GitHub's merge queue (a repository ruleset), and GitHub Actions running the arena's suite. Agents run on this machine through the same adapters as every other race (`harness/agents.py`), so this arm and the Beanstalk arm (`--forge cloudflare`, `REMOTE.md`) differ only in the forge. It is the GitHub arm of `docs/claude-opus/17-cloud-agent-swarm.md`, with laptop agents and polling instead of containers and webhooks (doc 17 §6, first cut line). The code is `harness/forge_github.py` (the race) and `harness/github.py` (the `gh` CLI client).

## Run one, or a pair

```bash
cd research/race
# GitHub arm alone (replay agents: free apart from Actions minutes, which are free on public repos)
python3 race.py --forge github --gh-owner kintohubtest --policy queue --agent replay --agents 4 --ci-slots 2 \
  --seed 7 --tasks 8 --protect-tests landed --ci-seconds 0 --repo ../corpora/arena.git --out runs/gh-replay-shop-4-s7
# both arms, one after the other, same agents / prompts / model / effort / task order / N / K; prints both kth_green rows
python3 pair.py --gh-owner kintohubtest --gateway $GW --agent codex --model gpt-6.1-sol --effort medium \
  --agents 4 --ci-slots 2 --seed 7 --out runs/pair-shop-codex-4-s7
```

`pair.py` runs `--forge github --policy queue` and `--forge cloudflare --policy beanstalk-v2 --preset demo` (`--b-forge local` for development only) with one shared argument list (`--agent --model --effort --agents --ci-slots --batch --seed --tasks --arena --repo`, limits, `--protect-tests landed`, `--ci-seconds 0`), alternates the arm order by seed (odd seeds GitHub first; `--order` overrides), and writes `<out>-github/`, `<out>-beanstalk/`, `<out>-pair.md` and `<out>-pair.json`. `--dry` prints the two commands.

## What the driver does

1. **Repository** `<owner>/beanstalk-race-<arena>-<seed>` (`--gh-repo` overrides; the synthetic arena is `shop`). New: created public with squash merges and auto-merge allowed. Existing: only when its description starts with `Beanstalk race` (it was created here); the ruleset is disabled, open PRs are closed, and `main` is force-pushed (`--no-gh-reset` refuses instead). Repos are never deleted.
2. **Base:** the arena's `main` plus one commit with `.github/workflows/suite.yml` (the suite on `pull_request` and `merge_group`, one job named `suite`, `concurrency` cancelling a PR's superseded run). A real arena's `arena.json` gives the Node version, the test globs and the dependency lockfile (copied to `.github/race/` and installed with `npm ci` outside the checkout; the suite step is timed separately). This commit is the only difference from the Beanstalk arm's base.
3. **Ruleset** on the default branch: `merge_queue` (`max_entries_to_build` = `--ci-slots`, `max_entries_to_merge` = `--batch`, `ALLGREEN`, `SQUASH`, minimum 1, no wait, 30 min check timeout), `required_status_checks` (`suite`), `pull_request` with 0 approvals, no force pushes, no deletion, no bypass actors.
4. **A bean:** the agent works in a local worktree of the arena clone (no remote, no token). The driver commits as the queue race does (acceptance and landed tests restored), pushes `task/<id>` (pushes are spaced `--gh-push-interval`, 10 s = GitHub's recommended 6 per minute), opens a PR (title = task title, body = the task), enables auto-merge, and with `--gh-enqueue direct` (default) calls `enqueuePullRequest` as soon as the PR check is green on that head.
5. **Outcomes** by polling (`--gh-poll`, 2 s; one GraphQL query for PRs, queue entries and add/remove timeline events, one REST page of Actions runs, plus one jobs call per finished run and one log download per red run):
   - merged: `land` (`target: "main"`) and `task.green` per PR, `green.promote` per poll;
   - removed from the queue (`gh.dequeued` with GitHub's raw reason), a red PR check, or `mergeable: CONFLICTING`: the queue's `queue.eject` with cause `conflict` or `red`, then the queue race's rework flow on GitHub's `main`: a conflict goes to the agent with the markers (`rework_conflict`), a clean merge of `main` is pushed and re-queued without the agent (`requeued_without_agent`), a red goes to the agent with the failing tests and output parsed from the job log (`rework_red`); after `--max-rework` the PR is closed and the task dropped;
   - `ci.start` / `ci.end` per Actions run: purpose `precheck` (the PR's own check) or `batch` (a merge group), with the job's real duration (`ci_seconds`), the suite step's (`suite_seconds`), GitHub's times in `gh_at`, and the tasks in the group.
6. **End:** unmerged PRs are closed (that also stops the queue; `--gh-keep-open` keeps them), `main` is fetched, and the harness's own final check runs locally on it (same code as every local race).

Agent outages (refused credentials, rate limits, API 5xx) are retried with backoff and never counted as the agent's work, and stop the race after 5 minutes, as in the Cloudflare driver.

## Outputs

As every race: `events.jsonl`, `summary.json`, `summary.md`, `config.json` (adds `forge: "github"` and a `github` block). `kth_green.py`, `summary.py` and `report.py` read the run unchanged; `policy` is `github-queue`. Event `t` is when the driver observed the event (median poll lag about 3 s at a 4 s poll in the first run; `github.poll_lag_s` reports it); GitHub's own times are kept as `gh_at` and drive the `github` block:

| `summary.json` `github.*` | Meaning |
|---|---|
| `queue_wait_to_merge_s`, `queue_wait_to_removal_s` | added to the queue → merged / removed (median, p90) |
| `submit_to_enqueue_s` | push → added to the queue (PR check plus enqueue latency) |
| `kickouts`, `kickouts_by_cause`, `kickouts_by_gh_reason` | removals and red/conflicting PRs handed back, by derived cause and GitHub's reason (`merge_conflict`, `failed_checks`, or `CONFLICTING` / `PR_CHECK_FAILED` when the PR never entered) |
| `rebases_with_agent`, `rebases_without_agent` | rework invocations; re-queues after a clean merge of `main` |
| `actions` | runs and minutes by event, job and suite-step duration, runner pickup (run created → job started) |
| `merges` | PRs merged, merge operations (PRs merged within 2 s of each other), max PRs and operations in any 60 s, group sizes |
| `api` | pushes, mutations, queries, REST calls, waits in the limiter, `rate_limited` hits and `retry_after_s` (also logged as `gh.rate_limited` events) |

## Measured GitHub behaviour (kintohubtest, 2026-10-07, synthetic arena, 2 s suite)

- **Actions:** a PR check or merge-group run takes 14–24 s for a 2 s suite (checkout + setup-node ≈ 12 s); runner pickup ≈ 0–3 s on the Free plan.
- **Auto-merge is lazy:** with only `gh pr merge --auto`, a PR whose check was green waited 20–130 s before GitHub added it to the queue (6 PRs). Direct `enqueuePullRequest` added it at once; that is the default, to be generous to GitHub.
- **Queue latency:** first merge-group run created about 19 s after the first enqueue; after a merge or removal the next groups start about 4 s later; a merge lands about 2 s after its group's run ends.
- **Build concurrency bounds the batch:** with `max_entries_to_build` 2 and `max_entries_to_merge` 4, GitHub built two groups at a time (entry 1, entries 1+2) and merged both together, so merges came in pairs every ~36 s; `max_entries_to_merge` above K had no effect.
- **The "1 merged PR per minute" limit did not bind:** 4 PRs merged in 36 s (two pairs), and merge operations were 36 s apart. A merge-queue merge of two PRs is two squash commits pushed at the same second, so a group counts as one merge operation, not one per PR (or the limit does not apply to the queue). No `gh.rate_limited` in any run so far.
- **Removal reasons** (`RemovedFromMergeQueueEvent.reason`, lower case): `merged`, `merge_conflict` (conflicts with an entry ahead, not with `main`), `failed_checks` (its group's suite failed; groups built on top of it are rebuilt). `enqueuePullRequest` refuses a PR with a red required check ("Pull request has failing required statuses") or a conflict ("Pull request has merge conflicts and Pull request not in mergeable state").

## Runs so far (synthetic arena, `kintohubtest`)

| Run | What | Result |
|---|---|---|
| `runs/gh-replay-shop-4-s7` | 4 replay agents, 8 tasks, K 2 | 8/8 green, correct, 4.5 min; 1 conflict kick-out reworked |
| `runs/gh-codex-shop-2-s3` | 2 Codex agents (`gpt-6.1-sol`, effort medium), 4 tasks | 4/4 green, correct, 4.0 min, $0.18 estimated |
| `runs/gh-replay-shop-4-s11` | 4 replay agents, all 40 tasks | 25 green, 15 dropped (replay cannot repair the arena's semantic breaks; real agents can), correct, 17.9 min; 16 kick-outs (14 red PR checks, 2 conflicts), 64 Actions runs, 14.4 Actions minutes, 169 mutations, 0 rate limits |
| `runs/pair-cf-shop-replay-4-s7-*` | `pair.py`, replay, 8 tasks, 4 agents, K 2, GitHub then the deployed gateway (`--preset demo`) | 7th green: GitHub 4.1 min, Beanstalk 1.8 min; both 8/8 and correct |

Replay agents measure the forge's mechanics only; these rows are smoke tests, not results.

## Tests

`tests/test_github.py` (in `python3 -m unittest discover -s tests`): replay races against `tests/fake_github.py` (a bare repo, PR checks and a merge queue that run the fixture's real suite) for a clean race, a conflict handed back to the agent, a red merge group with failures from the job log, auto-merge mode, the reset of an existing repo, and refusing a repo the harness did not create; plus recorded GitHub responses (`tests/fixtures/github/`: a poll, a runs page, a red job log) for the parsers, the rate-limit retry, the push limiter and the token-free git environment.
