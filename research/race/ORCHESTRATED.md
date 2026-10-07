# Orchestrated races (`orchestrated.py`)

A race with no driver: one coding-agent session per forge gets the whole backlog and its own subagents, and decides splitting, ordering, stacking and retries itself. The harness only sets up the forge, starts the session and measures from the forge side afterwards. The question it answers is how fast each forge gets parallel work integrated, not how fast the agent is.

## Run one

```bash
cd research/race
python3 orchestrated.py --forge github --gh-owner kintohubtest --arena ../real-arena/fastify --tasks 10 \
  --model sonnet --worker-model sonnet --subagents 4 --max-usd 20 --max-wall-minutes 90 \
  --out runs/orch-fastify-sonnet-4-t10-github
python3 orchestrated.py --forge beanstalk --gateway https://<gateway> --arena ../real-arena/fastify --tasks 10 \
  --model sonnet --worker-model sonnet --subagents 4 --max-usd 20 --max-wall-minutes 90 \
  --out runs/orch-fastify-sonnet-4-t10-beanstalk
python3 kth_green.py runs/orch-fastify-sonnet-4-t10-github runs/orch-fastify-sonnet-4-t10-beanstalk --k 3 5 8
```

## What the harness does

1. **The repository, from one base.**
   - GitHub: `<owner>/beanstalk-orch-<arena>-<seed>`, public. It holds the arena base plus `suite.yml`, the lockfile under `.github/race/` and the upstream automation removed, exactly as in `forge_github` (`GITHUB.md`). The ruleset is the merge queue with K = `--ci-slots` and batch `--batch`.
   - A warm-up PR (one file changed) is opened and closed first. On a repo created a minute earlier, GitHub ran no workflow for the first PRs, and it never runs one for a PR with no diff (both seen 2026-10-07).
   - Check concurrency, matched explicitly (`docs/claude-opus/18-git-native-flow.md` §7.1): GitHub runs each PR's checks on Actions (about 20 jobs at once for the org) and builds `--ci-slots` merge groups at once; Beanstalk runs one pre-land sandbox per bean in check (32 at most by default) and `ci_slots` validations at once (2). `--preland-concurrency N` sets the Beanstalk arm's `settings.engine` to `{preland_sandboxes: N, ci_slots: --ci-slots}`, so `--preland-concurrency 20` matches the two arms; without it the gateway's defaults apply. It needs a gateway with the runner pool (2026-10-07); an older one refuses `settings.engine`.
   - Beanstalk: an Artifacts repo is seeded with the arena base through a race run's seed token. The admin API has no other way to put existing history into a repository. A repository engine (the git-native flow, `docs/claude-opus/18-git-native-flow.md`) is opened on it with the arena's suite, and a git token is minted for that one repository.
2. **The working tree.**
   - A clone of the forge repo, with `BACKLOG.md` (every task's prompt and acceptance tests) and `.worktrees/` excluded from git.
   - The dependency snapshot is linked above the clone, so every worktree resolves it.
   - The clone's credential helper is `gh auth git-credential` (GitHub) or reads `$BEANSTALK_TOKEN` (Beanstalk). The token never appears in a file or in argv.
3. **The session.** Claude Code `-p` is started with:
   - a `worker` subagent type (`--agents`, its own model) and tools `Read,Edit,Write,Glob,Grep,Bash,Agent,TodoWrite`;
   - `acceptEdits`, no prompts, Bash allowed except gh's admin commands (`repo`, `api`, `auth`, `secret`, `ruleset`, `org`, `workflow`, `variable`), pushes to `main`, `curl`/`wget` and web tools;
   - the budget cap (`--max-budget-usd`) and the wall cap (the process group is killed).

   The prompt (`harness/orch_prompt.py`) is identical on both arms apart from the forge section. It covers parallel subagents with "give each subagent its own branch in its own `git worktree`" under `.worktrees/`, at most N at once, the acceptance tests to add, the `Task: <id>` trailer, never pushing to the line, and the time budget. The forge section says how to submit (PR + `gh pr merge --auto`, or `git push -o wait origin HEAD:refs/heads/bean/<name>`), how to follow, and how to handle a kick-out or a red.
4. **Afterwards.** The harness waits up to `--drain-minutes` for in-flight integrations, then measures (`harness/orch_measure.py`):
   - **Integration (headline):** per change (PR or bean), submitted (PR opened / bean pushed) and ready (PR enqueued / bean pushed) to integrated (merged to `main` / landed on the sprout; Beanstalk also to the stalk), as median and p90. It also reports the rework integration caused (kick-outs, red checks, conflicts, re-pushes), changes integrated per 10 minutes, the most changes waiting at once, and the share of the wall time with a change waiting.
   - **Green per task (secondary):** the integration line's first-parent history is replayed from the base. Each commit gets the canonical acceptance tests of every task not yet green, and a task is green at the first commit where all its files pass. Its time is the merge (GitHub) or the stalk promotion (Beanstalk).
   - **Final check:** the whole suite (retried once on red) and every task's acceptance tests on the line's head.
   - **Session:** model spend, turns, subagent calls (in one message, in the background) and the commands it ran most.

Outputs: `events.jsonl`, in the harness schema (`race.start` at the session start, `task.green` from the replay, `change.ready` / `change.integrated` / `change.stable`, `ci.end`, one `invocation.end` with the session's cost, `final.check`). Also `summary.json` and `summary.md`, `prompt.txt`, and `transcript.jsonl` (the session, scrubbed of the Beanstalk token).

## Credentials and what Coop must do

- **GitHub:** a fine-grained token cannot be created through the API, so the smoke uses the gh CLI's own login, with gh's admin commands denied to the session. For measured races, create a fine-grained PAT limited to the one race repo (contents and pull requests write, actions read) in the GitHub UI. Then run the session with `GH_TOKEN` set to it; the harness passes it through, but this is not wired yet.
- **Beanstalk:** the harness mints a git token bound to the one repository engine through the admin API.
