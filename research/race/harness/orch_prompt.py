"""The orchestrated race's prompt and backlog: one text for both arms except the forge section."""
from __future__ import annotations

from .arena import Task

WORKTREES = ".worktrees"


def backlog(tasks: list[Task], test_hint: str) -> str:
    """``BACKLOG.md``: every task's id, title, description and acceptance tests (full content)."""
    out = ["# Backlog", "",
           f"{len(tasks)} tasks for this repository, in priority order. Each one is a change someone asked for. Every "
           "task comes with acceptance tests: add them to the task's change exactly as given (same path, same "
           "content) and make them pass without breaking the rest of the suite.", "",
           f"Running tests: {test_hint}", ""]
    for t in tasks:
        out += [f"## {t.id}: {t.title}", "", t.prompt.strip(), "", "Acceptance tests:", ""]
        for path, content in sorted(t.acceptance_tests.items()):
            fence = "````" if "```" in content else "```"
            out += [f"`{path}`", "", f"{fence}js", content.rstrip("\n"), fence, ""]
    return "\n".join(out) + "\n"


def shared(n_tasks: int, subagents: int, line: str, test_hint: str, wall_minutes: float) -> str:
    return f"""You are the lead engineer on this repository. `BACKLOG.md` in this directory lists {n_tasks} tasks, each \
with acceptance tests. Ship as many of them as you can: a task is done when its change, with its acceptance tests, \
is integrated by the forge (described below). You decide how to split, order and stack the work.

How to work:
- Work in parallel: give each subagent its own branch in its own `git worktree` (create them under \
`{WORKTREES}/`, for example `git worktree add {WORKTREES}/<branch> -b <branch> origin/{line}`). You may run up to \
{subagents} `worker` subagents at the same time (several Agent calls in one message, or in the background); never \
more than {subagents} at once.
- A change for a task adds that task's acceptance tests exactly as given in `BACKLOG.md` and makes them pass without \
breaking other tests. {test_hint} The dependencies are already installed in a `node_modules` directory above \
this repository, so `require` resolves them from every worktree even though no worktree has its own `node_modules`: \
never install packages.
- Give each worker the absolute path of its worktree. A worker's shell starts in this directory for every command, so \
it uses `git -C <worktree> ...` for git and runs the tests as `cd <worktree> && node ...` in the same command. Don't \
change the given acceptance tests; you may update existing tests whose \
expectations your change intentionally alters.
- Put a `Task: <id>` line (for example `Task: t004`) at the end of the commit message of each task's change. One task \
per change unless you deliberately combine them.
- Integration happens only through the forge as described below; never push to `{line}` yourself.
- `BACKLOG.md` and `{WORKTREES}/` are local notes and scratch space: never commit them.
- You have about {wall_minutes:.0f} minutes. When every task is integrated (or you judge a task impossible), stop and \
reply with one line per task: its id, integrated or not, and why not.
"""


def github_section(repo_url: str) -> str:
    return f"""The forge: GitHub, repository {repo_url} (this directory is a clone; `origin` points to it). `main` is \
protected by a merge queue: changes reach `main` only through pull requests that the queue merges. The required \
check `suite` runs the test suite on each pull request and again on each merge group.
- Submit a change: push its branch (`git push -u origin <branch>`), open a pull request against `main` \
(`gh pr create --base main --head <branch> --title "<title>" --body "Task: <id>"`), then add it to the merge queue \
with `gh pr merge <number> --auto` (it joins the queue once its own check is green).
- Follow it with `gh pr view <number> --json state,mergeStateStatus,statusCheckRollup` and `gh pr checks <number>`; \
`gh run view <run-id> --log-failed` shows a failed check's output. A pull request leaves the queue without merging when \
its merge group fails or conflicts: rebase it onto the new `origin/main` (`git fetch origin && git rebase \
origin/main`), fix it, `git push --force-with-lease`, and enqueue it again.
- It is done when the pull request is merged (state MERGED).
"""


def beanstalk_section(repo_url: str) -> str:
    return f"""The forge: Beanstalk, repository {repo_url} (this directory is a clone; `origin` points to it). It has \
two lines: `sprout` (changes land there after a check of the change merged onto it) and `stalk` (the stable line, \
which follows `sprout` once CI validates it). Branch your work from `origin/sprout`.
- Submit a change: push its branch as a bean, `git push -o wait origin HEAD:refs/heads/bean/<name>` (a bean name is \
letters, digits, `.`, `_` or `-`, up to 32). The push waits for the verdict and prints it (`remote: beanstalk:` lines).
- LANDED means it is on `sprout`. RED or CONFLICT means it was not landed: the push printed the failing tests or the \
conflicting hunks and the landed changes it met. Fix it on the same branch (`git fetch origin sprout && git rebase \
origin/sprout`, fix, commit) and push again to the same bean with `git push -f -o wait origin HEAD:refs/heads/bean/<name>`.
- `git fetch origin '+refs/beans/*:refs/beans/*'` then `git cat-file -p refs/beans/<name>/status` shows a bean's \
current state. Pushing to `sprout`, `stalk` or `main` is refused.
- It is done when the push says LANDED.
"""


def prompt(arm: str, *, repo_url: str, n_tasks: int, subagents: int, test_hint: str, wall_minutes: float) -> str:
    line = "main" if arm == "github" else "sprout"
    section = github_section(repo_url) if arm == "github" else beanstalk_section(repo_url)
    return shared(n_tasks, subagents, line, test_hint, wall_minutes) + "\n" + section


WORKER_PROMPT = ("You are a software engineer working on one change in your own git worktree, whose absolute path "
                 "the lead gives you. Each shell command starts in the lead's directory, so use `git -C <worktree>` "
                 "for git and `cd <worktree> && <command>` for anything else, in one command. The dependencies are "
                 "installed above the repository and resolve from your worktree: never install packages. Use the "
                 "Read, Edit and Write tools with absolute paths inside your worktree. Do exactly what the lead asks, "
                 "run the tests, commit on your branch, and report briefly what you did, the branch and commit, and "
                 "the test result. Stay inside your worktree.")
