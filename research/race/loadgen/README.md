# loadgen: token-free push replay

How fast does a forge integrate parallel work? `loadgen` pushes real changes (the fastify arena's reference solutions) from N parallel workers on a schedule grounded in real agent runs, to **GitHub's merge queue** and to **Beanstalk**, using only git and each forge's own API. No LLM agents, no model spend: the race's replay agent (`harness/agents.py` `ReplayAdapter`) makes every commit.

```bash
cd research/race
# both forges at once (separate processes, same arguments): runs/lg-fastify-8-s7-github/, -beanstalk/
python3 -m loadgen.run --forge both --workers 8 --seed 7 --gateway https://beanstalk-gateway.<account>.workers.dev \
    --out runs/lg-fastify-8-s7
python3 loadgen/report.py runs/lg-fastify-8-s7-github runs/lg-fastify-8-s7-beanstalk   # headline table
python3 kth_green.py runs/lg-fastify-8-s7-github runs/lg-fastify-8-s7-beanstalk          # k-th green
python3 -m unittest tests.test_loadgen                                                  # fakes, no network
```

Credentials: GitHub through the `gh` CLI (Coop's login; the token never enters this process, `harness/github.py`); Beanstalk through the gateway's admin token (`$BEANSTALK_ADMIN_TOKEN` or `--dev-vars <gateway .dev.vars>`), which opens a repository engine and mints a git token that reaches git only through a credential helper reading an environment variable. Nothing prints a token. Output files mask the gateway's workers.dev subdomain.

## What it does

| Piece | File | What |
|---|---|---|
| Changes | `changes.py` | Each task's reference solution plus its acceptance tests as one commit on the line's current head, applied by the replay agent (`git apply --3way`, standalone reference when the prerequisites are not on the head, conflicted hunks union-resolved). `--mode standalone` (default): a dependent task starts whenever a worker is free; `--mode chain`: it waits until every prerequisite is integrated and applies its own reference. A **chain build** (base + every reference in history order, green by the arena's construction) gives each file's upstream version. |
| Schedules | `schedule.py` | `closed` (default): a worker takes the next task, thinks, pushes, waits for the verdict (`--hold integrate`; `--hold push` moves on), fixes and re-pushes after a kick-out. Think (initial) and fix (rework) times are lognormals fitted to a real run's agent invocations (`--fit-runs`, default the Codex fastify pair `runs/pair-fastify-codex-4-s7-*`: think median 88 s, σ 0.46, n 76; fix median 65 s, σ 0.31, n 10), drawn per (seed, task, kind, attempt), so both forges get the same delays for the same change. `open`: changes become ready at `--rate` per minute (Poisson, or `--fixed`). `recorded`: the push times of a real run (`--record <run>`: each task's first commit, its agent as the worker), compressed by `--speed`, reactions with that run's own rework durations. |
| Reactions | `driver.py` | Kick-out (red or conflict) → fix delay → fetch the latest line → reset to it and re-apply the reference three-way; files that still conflict take their **upstream version** (the chain build after this task, or after the latest integrated task touching the file when that is later, so its change stays); a second red takes the upstream version of every file the change touches. Up to `--max-attempts` pushes (8), then the change is dropped. Every reaction is counted. |
| GitHub | `forges.py` `GitHubForge` | The GitHub arm's plumbing, imported: `harness/forge_github.py` `github_base` (base + suite workflow + lockfile) and `prepare_github_repo` (create or reset, ruleset), `harness/github.py` client and limiter. Push `lg/<task>`, open a PR, `enqueuePullRequest` as soon as its own check is green; outcomes by polling (merged, removed from the queue, red PR check, `CONFLICTING` twice), the arm's rules. Repo `kintohubtest/beanstalk-loadgen-<arena>-<N>-<seed>`, merge queue `max_entries_to_build` = `--ci-slots` (2), `max_entries_to_merge` = `--batch` (4). |
| Beanstalk | `beanstalk.py`, `forges.py` `BeanstalkForge` | `POST /v1/repos` opens a continuous engine on a fresh Artifacts repo with the arena's suite (doc 18 §8); the base lands as a `seed` bean before the clock starts; each change is `git push -o wait=1800 <url> <sha>:refs/heads/bean/<task>` (force on a re-push); the verdict is parsed from the `remote: beanstalk:` lines; the stalk time comes from `GET /v1/repos/:engine/beans`; CI work from the engine's event log. `--bs-engine k=v` / `--bs-evidence` set engine overrides (`settings.engine`, gateway change in this branch). The engine and its repo are closed and deleted at the end (`--keep-repo` keeps them). |

## Metrics (`summary.json`, `summary.md`, `report.py`)

- **ready → integrated** per change (median, p90): from the commit being ready (just before its first push) to GitHub's `mergedAt` on `main` / the Beanstalk push's `LANDED` line (sprout). **ready → stable**: GitHub the same; Beanstalk to the stalk. **enqueue → merged** (GitHub only): first `AddedToMergeQueue` → merged, which leaves out the PR check before it.
- **waiting share**: time changes spent with the forge (push → verdict, every push) over their life (worker start → integrated), and over N × wall time.
- **rework**: kick-outs by kind (red, conflict), re-makes (`rebase`), upstream files taken, upstream-after-red.
- **throughput**: integrated per 10 min (and the peak 10-minute window), max changes waiting on the forge at once.
- **CI minutes**: GitHub Actions job time (PR checks + merge groups); Beanstalk pre-land checks (`check_seconds`) + validations + audits.
- **final correctness**: on the final `main` / stalk, locally, the whole suite, then every task's acceptance tests written in; correct = suite green and every integrated task's acceptance tests committed intact and passing. `matches_chain_build` compares the final tree with the chain build (outside `.github/`).
- `events.jsonl` is in the race's schema (`race.start`, `task.start`, `task.commit`, `queue.submit`, `queue.eject`, `rework.start`, `land`, `task.green` / `green.promote`), so `kth_green.py` reads it.

## Fairness

Same changes, seed, N and schedule on both forges; both arms run at the same time. CI concurrency: GitHub builds `--ci-slots` merge groups at once, Beanstalk's continuous engine has 2 CI slots for validations; its pre-land checks run on 2 shared sandboxes (doc 18 §7), as GitHub's PR checks run on their own runners (up to the org's 20 concurrent jobs). Runners: GitHub `ubuntu-latest` (4 vCPU on public repos), Beanstalk `standard-4` containers (4 vCPU). GitHub pushes are spaced by `--gh-push-interval` (2 s; GitHub recommends about 6 a minute) and mutations by 1 s; every limiter wait and rate-limit hit is recorded under `forge_detail.api`.

## Tests

`tests/test_loadgen.py`: closed, open (chain mode) and recorded schedules against `tests/fake_github.py` and `tests/fake_beanstalk.py` (a bare repo plus an in-process engine that squashes onto the sprout, runs the fixture's suite, lands or answers red/conflict); the push-verdict parser on the recorded staging transcript (`docs/claude-opus/exp/git-native/staging-transcript.txt`); tokens never in argv or the URL; the fit and the seeded draws.
