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
| Schedules | `schedule.py` | `closed` (default): a worker takes the next task, thinks, pushes, waits for the verdict (`--hold integrate`; `--hold push` moves on), fixes and re-pushes after a kick-out. Think (initial) and fix (rework) times are lognormals fitted to a real run's agent invocations (`--fit-runs`, default the Codex fastify pair `runs/pair-fastify-codex-4-s7-*`: think median 88 s, σ 0.46, n 76; fix median 65 s, σ 0.31, n 10), drawn per (seed, task, kind, attempt), so both forges get the same delays for the same change. `open`: changes become ready at `--rate` per minute (Poisson, or `--fixed`). `recorded`: the push times of a real run (`--record <run>`: each task's first commit, its agent as the worker), compressed by `--speed`, reactions with that run's own rework durations. `orchestrated`: an orchestrated race's run (`--record runs/orch-…`, `harness/orchestrated.py`): each change's first push (PR opened / bean pushed), its task and branch (the worker), compressed by `--speed`; scale it with `--workers` and `--speed` (2x, 4x). |
| Reactions | `driver.py` | Kick-out (red or conflict) → fix delay → fetch the latest line → reset to it and re-apply the reference three-way; files that still conflict take their **upstream version** (the chain build after this task, or after the latest integrated task touching the file when that is later, so its change stays); a second red takes the upstream version of every file the change touches. Up to `--max-attempts` pushes (8), then the change is dropped. Every reaction is counted. |
| GitHub | `forges.py` `GitHubForge` | The GitHub arm's plumbing, imported: `harness/forge_github.py` `github_base` (base + suite workflow + lockfile) and `prepare_github_repo` (create or reset, ruleset), `harness/github.py` client and limiter. Push `lg/<task>`, open a PR, `enqueuePullRequest` as soon as its own check is green; outcomes by polling (merged, removed from the queue, red PR check, `CONFLICTING` twice), the arm's rules. Repo `kintohubtest/beanstalk-loadgen-<arena>-<N>-<seed>`, merge queue `max_entries_to_build` = `--ci-slots` (2), `max_entries_to_merge` = `--batch` (4). |
| Beanstalk | `beanstalk.py`, `forges.py` `BeanstalkForge` | `POST /v1/repos` opens a continuous engine on a fresh Artifacts repo with the arena's suite (doc 18 §8); the base lands as a `seed` bean before the clock starts; each change is `git push -o wait=1800 <url> <sha>:refs/heads/bean/<task>` (force on a re-push); the verdict is parsed from the `remote: beanstalk:` lines; the stalk time comes from `GET /v1/repos/:engine/beans`; CI work from the engine's event log. `--bs-engine k=v` / `--bs-evidence` set engine overrides (`settings.engine`, gateway change in this branch). The engine and its repo are closed and deleted at the end (`--keep-repo` keeps them). |

## Metrics (`summary.json`, `summary.md`, `report.py`)

- **ready → integrated** per change (median, p90): from the commit being ready (just before its first push) to GitHub's `mergedAt` on `main` / the Beanstalk push's `LANDED` line (sprout). **ready → stable**: GitHub the same; Beanstalk to the stalk. **enqueue → merged** (GitHub only): first `AddedToMergeQueue` → merged, which leaves out the PR check before it.
- **waiting share**: time changes spent with the forge (push → verdict, every push) over their life (worker start → integrated), and over N × wall time.
- **rework**: kick-outs by kind (red, conflict), re-makes (`rebase`), upstream files taken, upstream-after-red.
- **throughput**: integrated per 10 min (and the peak 10-minute window), max changes waiting on the forge at once.
- **CI minutes** (runner busy time): GitHub Actions job time (PR checks + merge groups, setup and `npm ci` included; `suite_minutes` is the suite step alone); Beanstalk pre-land suites (`suite_seconds`; `check_minutes` adds squash and waiting for a sandbox) + validations + audits (`ci_seconds`). `python3 -m loadgen.refresh <run>` recomputes them from `engine-events.jsonl`.
- **final correctness**: on the final `main` / stalk, locally, the whole suite, then every task's acceptance tests written in; correct = suite green and every integrated task's acceptance tests committed intact and passing. `matches_chain_build` compares the final tree with the chain build (outside `.github/`).
- `events.jsonl` is in the race's schema (`race.start`, `task.start`, `task.commit`, `queue.submit`, `queue.eject`, `rework.start`, `land`, `task.green` / `green.promote`), so `kth_green.py` reads it.

## Fairness

Same changes, seed, N and schedule on both forges; both arms run at the same time. CI concurrency: GitHub builds `--ci-slots` merge groups at once, Beanstalk's continuous engine has 2 CI slots for validations; its pre-land checks run on 2 shared sandboxes (doc 18 §7), as GitHub's PR checks run on their own runners (up to the org's 20 concurrent jobs). Runners: GitHub `ubuntu-latest` (4 vCPU on public repos), Beanstalk `standard-4` containers (4 vCPU). GitHub pushes are spaced by `--gh-push-interval` (2 s; GitHub recommends about 6 a minute) and mutations by 1 s; every limiter wait and rate-limit hit is recorded under `forge_detail.api`.

## Results: fastify, closed loop (2026-10-07)

Fastify's 38 tasks, closed-loop schedule fitted to the Codex pair (think 88 s, fix 65 s), standalone mode, GitHub
merge queue `max_entries_to_build` 2 / `max_entries_to_merge` 4, Beanstalk 2 CI slots. Each row is a run directory
`runs/lg-fastify-<N>-s<seed>-<forge>` (`-postfix-` for the re-run). `python3 loadgen/table.py runs/lg-fastify-*`
regenerates the table. Final correctness for every run comes from the containerised final check. The local suite
can collide on fastify's fixed port 3000 with other suites on the machine.

| N | seed | forge / era | integrated | ready→integrated med/p90 min | ready→stable med/p90 | enqueue→merged med/p90 | waiting share change/worker | red/conflict kick-outs | rebases | per 10 min (peak) | CI min | max concurrent pre-checks | suite timeouts | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 4 | 7 | GitHub | 38/38 | 3.1 / 4.9 | 3.1 / 4.9 | 1.8 / 3.1 | 0.691 / 0.647 | 1 / 2 | 3 | 7.61 (10) | 75.96 | 4 | - | 49.9 | True |
| 4 | 7 | pre-fix (2 shared sandboxes) | 38/38 | 1.1 / 2.2 | 1.7 / 2.6 | - | 0.452 / 0.433 | 1 / 2 | 3 | 13.58 (17) | 57.62 | 4 | 0 | 28.0 | True |
| 4 | 11 | GitHub | 38/38 | 3.0 / 5.9 | 3.0 / 5.9 | 1.7 / 2.8 | 0.707 / 0.674 | 1 / 2 | 3 | 7.4 (11) | 74.42 | 3 | - | 51.4 | True |
| 4 | 11 | 48ed740e, 2 shared sandboxes | 38/38 | 2.1 / 3.1 | 2.9 / 3.9 | - | 0.609 / 0.579 | 0 / 2 | 2 | 9.9 (13) | 103.71 | 4 | 0 | 38.4 | True |
| 4 | 13 | GitHub | 38/38 | 2.9 / 4.4 | 2.9 / 4.4 | 1.7 / 2.7 | 0.668 / 0.628 | 1 / 3 | 4 | 8.2 (10) | 73.5 | 3 | - | 46.3 | True |
| 4 | 13 | f0843358, 20 sandboxes | 38/38 | 0.7 / 1.4 | 1.4 / 2.0 | - | 0.361 / 0.341 | 1 / 2 | 3 | 15.86 (19) | 38.59 | 3 | 0 | 24.0 | True |
| 8 | 7 | GitHub | 38/38 | 4.0 / 6.9 | 4.0 / 6.9 | 2.5 / 3.7 | 0.715 / 0.648 | 6 / 4 | 10 | 12.24 (16) | 78.64 | 7 | - | 31.0 | True |
| 8 | 7 | pre-fix (2 shared sandboxes) | 38/38 | 2.4 / 4.5 | 3.2 / 5.1 | - | 0.612 / 0.564 | 4 / 2 | 6 | 17.51 (23) | 110.17 | 8 | 0 | 21.7 | True |
| 8 | 11 | GitHub | 38/38 | 4.3 / 6.9 | 4.3 / 6.9 | 2.6 / 4.9 | 0.726 / 0.656 | 2 / 6 | 8 | 11.62 (15) | 79.08 | 7 | - | 32.7 | True |
| 8 | 11 | 48ed740e, 2 shared sandboxes | 38/38 | 1.7 / 5.0 | 2.8 / 5.8 | - | 0.572 / 0.5 | 4 / 2 | 6 | 17.66 (26) | 90.77 | 8 | 0 | 21.5 | True |
| 8 | 13 | GitHub | 38/38 | 3.7 / 5.1 | 3.7 / 5.1 | 2.5 / 3.7 | 0.718 / 0.656 | 3 / 3 | 6 | 12.84 (17) | 73.57 | 7 | - | 29.6 | True |
| 8 | 13 | f0843358, 20 sandboxes | 38/38 | 0.8 / 2.4 | 1.6 / 2.6 | - | 0.393 / 0.343 | 2 / 2 | 4 | 27.46 (34) | 46.61 | 6 | 0 | 13.8 | True |
| 16 | 7 | GitHub | 38/38 | 7.1 / 13.5 | 7.1 / 13.5 | 5.6 / 12.0 | 0.805 / 0.585 | 6 / 8 | 14 | 12.51 (17) | 82.0 | 13 | - | 30.4 | True |
| 16 | 7 | pre-fix (2 shared sandboxes) | 33/38 | 11.0 / 38.1 | 11.7 / 38.7 | - | 0.765 / 0.645 | 105 / 2 | 102 | 5.49 (13) | 594.49 | 16 | 101 | 60.1 | True |
| 16 | 7 | 9709edee, 20 sandboxes (alone) | 38/38 | 1.1 / 3.8 | 2.4 / 4.7 | - | 0.456 / 0.319 | 3 / 7 | 10 | 34.81 (38) | 48.67 | 11 | 0 | 10.9 | True |
| 16 | 11 | GitHub (alone) | 38/38 | 6.6 / 12.7 | 6.6 / 12.7 | 5.2 / 10.5 | 0.775 / 0.613 | 13 / 7 | 20 | 13.68 (18) | 83.75 | 12 | - | 27.8 | True |
| 16 | 11 | 9709edee, 20 sandboxes | 38/38 | 1.0 / 4.9 | 2.1 / 5.7 | - | 0.466 / 0.309 | 7 / 6 | 13 | 30.61 (37) | 55.18 | 12 | 0 | 12.4 | True |
| 16 | 13 | GitHub | 38/38 | 7.1 / 16.2 | 7.1 / 16.2 | 5.4 / 10.8 | 0.774 / 0.585 | 17 / 13 | 30 | 11.71 (15) | 93.14 | 11 | - | 32.5 | True |
| 16 | 13 | f0843358, 20 sandboxes | 38/38 | 0.8 / 3.4 | 1.8 / 4.3 | - | 0.437 / 0.329 | 6 / 4 | 10 | 38.81 (38) | 49.4 | 12 | 0 | 9.8 | True |

Eras of the Beanstalk arm (the live gateway changed during the set):
- **pre-fix (2 shared sandboxes)**: s7 rows on the live gateway before 48ed740e, and the s11 4/8 rows on 48ed740e.
  A continuous engine ran every bean's pre-land check on 2 shared standard-4 sandboxes, queue time counted in the
  300 s suite timeout, and a timeout came back to the author as RED. At N=16 all 16 first checks timed out:
  101 timeouts, 105 false reds, 33/38 integrated in 60 min.
- **9709edee / f0843358, 20 sandboxes**: the capacity fix. Each checking bean gets a sandbox on demand
  (`settings.engine.preland_sandboxes=20`, about the org's 20 concurrent Actions jobs), queue time is excluded from
  timeouts, and capacity timeouts are never red. `ci_slots=2` matches the merge queue's build concurrency.
  f0843358 changed nothing in the push intake path.

Notes on the rows:
- GitHub 16-s7: the pre-fix pair's GitHub arm is the baseline; the capacity fix did not touch GitHub.
- Run alone (labelled in `summary.json`):
  - Beanstalk 16-s7 post-fix: its GitHub arm's setup failed on a GitHub 500, and the barrier released after 900 s.
  - GitHub 16-s11: the paired run stuck on a PR GitHub removed from the queue as "merged" that stayed OPEN for
    over an hour; the first re-run died on a bare push "(failed)". Both cases are handled now.
- GitHub 4-s13: t033's PR merged at 21:21:38Z but one poll read it CLOSED and not merged, so the driver dropped it.
  `summary.json` `patched` records it from GitHub's timeline; the driver now checks `main` first.
- Evidence promotion A/B (staging-lg, `runs/lg-ab-fastify-*`): it does not pay on fastify. 94% of test files are
  affected by any lib/ change, traced pre-land suites cost 1.7–2.6x, there were no window waits to remove, and at
  N=16 the traced suites timed out.

## Tests

`tests/test_loadgen.py`: closed, open (chain mode) and recorded schedules against `tests/fake_github.py` and `tests/fake_beanstalk.py` (a bare repo plus an in-process engine that squashes onto the sprout, runs the fixture's suite, lands or answers red/conflict); the push-verdict parser on the recorded staging transcript (`docs/claude-opus/exp/git-native/staging-transcript.txt`); tokens never in argv or the URL; the fit and the seeded draws.
