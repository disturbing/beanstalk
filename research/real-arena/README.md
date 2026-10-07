# Real-task arenas

Race arenas built from a real repository's merged pull requests, for races that pit Beanstalk against GitHub's
merge queue on work nobody designed for us (design: `docs/claude-opus/17-cloud-agent-swarm.md` §2). The first one
is `fastify/`. The designed arena (`../arena/`) stays the development fixture; these are its real counterpart.

```
real-arena/
  build.py          clone, pin dependencies, fetch PR text, chain build, credits, offline suite check
  contention.py     contention profile of an arena, next to the designed arena's (profile.json)
  materialize.py    the bare repository the race clones (main = the base, upstream history up to it)
  solvability.py    solo Codex pilot: one agent per task, one try, through the race's Codex adapter
  realarena.py      shared pieces (arena.json, git, suite runs)
  extract_tests.mjs splits added/changed test cases out of a shared test file (from E2)
  fastify/
    arena.json      upstream, base and end commits, path classes, the suite and agent settings the race reads
    deps/           package.json at the base + the pinned package-lock.json (node_modules is git-ignored)
    pr/<n>.json     cached PR metadata (title, body, author, merge time, linked issues)
    tasks/tNNN.json prompt, acceptance tests, oracle paths, upstream PR/author/files, expected overlap
    solutions/      tNNN.patch (reference solution, what replay agents apply); tNNN.standalone.patch for
                    dependent tasks; tNNN.own.diff + tNNN.background.diff where the reference carries
                    folded non-task commits
    window.json     every candidate in history order: kept, or excluded with the reason
    profile.json    contention profile (with the designed arena's for comparison)
    solvability.json  the Codex pilot's per-task results
    suite.json      base-suite timings and the offline check
    CREDITS.md      upstream licence and every PR author
  upstream/         git-ignored clones;  .work/  git-ignored scratch worktrees
```

## How a task is made

Each task is one merged upstream pull request (`build.py`, generalised from E2's `build_chain.py`):

* **Prompt**: the PR title and description, with the template's comments and checklist removed and links to the
  answer (the PR, commits, compares, branches, files) stripped. A thin description falls back to the linked issue.
* **Acceptance tests** (held out of the repository, handed to the agent and restored before every commit, exactly as
  the designed arena's): test files the PR added, and the test cases it added or changed in an existing test file,
  extracted into `<dir>/<stem>.pr<N>.test.js` next to it with its imports, helpers and hooks.
* **Reference solution**: everything else the PR changed (source, types, docs, and the residual edits of shared test
  files), re-based in history order.
* **Chain build** (doc 17 §2.1): the PRs are applied in merge order on top of each other, starting from the base. A PR
  is kept only when its acceptance tests fail on the chain before it and the whole suite passes after it (one retry
  for a flaky red). Dependent PRs therefore stay in: the race starts every agent from the base, so a task whose
  prerequisite has not landed has to do that part too or meet it when it lands. Base + every reference solution in
  order + every acceptance test is green by construction.
* **Background folds** (new here): when a PR does not re-base because it builds on a window commit that is not a task
  (a security fix pushed without a PR, a perf change whose tests pass before it, an excluded PR), those commits are
  folded into that task's reference solution as background, in history order, recorded in
  `upstream.background`. Without folding, fastify's window kept 25 of 55 candidates; most losses cascaded from a few
  such commits. Folds are capped (no dependency change, at most 400 source lines), so the v6 `next` merge (59 files,
  a new undici major) is never folded and the tasks that need it are excluded. The contention profile attributes
  folded lines to no task. When only non-source files still conflict (a shared test file's residual edits next to an
  earlier task's extracted cases, docs, type tests), the chain's version is kept (`upstream.kept_chain_version_of`)
  and validation decides.
* **Standalone references** (`build.py standalone`): a dependent task's reference only applies once its
  prerequisites have landed. `solutions/tNNN.standalone.patch` is the same change plus the smallest set of earlier
  tasks' changes it needs (`upstream.prerequisites`), against the base, checked to pass the task's acceptance tests.
  Replay agents apply it when the reference does not apply to their head (`harness/agents.py`), as a real agent would
  have to do the prerequisite's part; real agents never see any solution file.
* **Excluded**: PRs without a PR number (direct pushes, security advisories), bot PRs, docs/CI/dependency-only
  changes (no source or no test change), PRs whose tests pass before the change, PRs whose suite is red after it,
  and PRs that need an unfoldable commit. `window.json` lists every one with its reason.
* **Offline**: the suite needs no network beyond localhost. `build.py offline` runs it inside Codex's sandbox with the
  race's loopback-only profile (internet refused), and the solvability pilot's agents ran under the same profile.

## Running a race on it

```bash
cd research/real-arena
python3 build.py clone fastify          # upstream clone (about 30 MB, full history for blame)
python3 build.py deps fastify           # npm ci from fastify/deps/package-lock.json (213 MB, git-ignored)
python3 materialize.py fastify          # research/corpora/real-arena-fastify.git, main = the base
cd ../race
python3 race.py --arena ../real-arena/fastify --dry-run --out runs/fastify-dry          # checks every task
python3 race.py --arena ../real-arena/fastify --policy queue --agent replay --agents 8 --ci-slots 4 \
    --batch 4 --ci-seconds 4.5 --replay-median 6 --out runs/fastify-replay-q
python3 race.py --arena ../real-arena/fastify --policy beanstalk-v2 --agent codex --model gpt-6.1-sol \
    --effort medium --agents 8 --ci-slots 4 --out runs/fastify-codex-v2
```

`--repo` defaults to the arena's `arena.json` `repo`. The harness reads the rest of `arena.json` through
`research/race/harness/suite.py`: the test globs and Node options for CI and agents, the dependency snapshot
(symlinked above every worktree), the sentence agents are told about running tests, and `agent_network: loopback`,
which gives Codex a permissions profile that allows binding and connecting to localhost while its network proxy
refuses every domain (fastify's tests listen on ports; the default no-network sandbox refuses `listen`). Node's
env-proxy support hangs a few of fastify's tests inside that proxy, hence `--no-use-env-proxy` in the test command.

On Cloudflare (`race.py --forge cloudflare`, `research/race/REMOTE.md`) the driver sends the same suite in the run
config (`suite`: the argv, the files argv, `env`, the snapshot name and the test hint), so the gateway's checks run
the same globs and its prompts are byte for byte the harness's. The runner image installs each arena's
`deps/package-lock.json` at build time (`npm ci --ignore-scripts`, as the GitHub arm does before its timed suite step)
into `/opt/arena-deps/<arena>/node_modules`, runs Node 25.8.1 (`node` above), and gives each suite a network
namespace with loopback only (`packages/runner/README.md`). A new arena therefore needs its lockfile added to the
`deps` stage of `packages/runner/Dockerfile`, and the runner image rebuilt, before a cloud race.

Rebuild from scratch: `python3 build.py all fastify`, then `contention.py fastify --synthetic`,
`solvability.py fastify`, and `build.py chain fastify --skip-pr <unsolved>` to drop what no agent solved.
