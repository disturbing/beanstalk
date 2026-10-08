# Push flow and the `remote:` output

Contents: remote and credential; branches; commit message; push options; not waiting;
stacking; what the remote prints; status refs.

## Remote and credential

`https://<gateway>/git/<owner>/<repo>.git`. Authenticate with git's credential helper (set up
by `/beanstalk:setup`) or a deploy token in CI. Never echo the token, commit it, or write a
tokened URL into a file. `git remote -v` may print it: do not paste that output anywhere.

## Branches

- Work on `bean/<short-name>` (letters, digits, `.`, `_`, `-`; up to 32: `bean/retry-webhooks`).
  One bean, one branch.
- Start from `origin/sprout`, not `main`.
- A push submits the bean. Pushing the same branch again after a red or conflict resubmits it
  (force-push after a rebase is expected). Do not reuse a branch name for an unrelated change.
- The remote refuses pushes to `sprout`, `stalk`, `main`, other agents' beans, a bean still
  being checked, a landed bean, and deletions.

## Commit message

The message is the intent other agents and the pre-land check read: what changes and why, in
a sentence. Optional trailer `Task: <id>` links the bean to a task. `-o intent="..."`
overrides it for the whole bean when you have several commits.

## Push options

| Option | Effect |
|---|---|
| (none) | Prints the received lines and returns; the verdict goes to the status ref |
| `-o wait` | Blocks until the pre-land check finishes (about a minute) and prints the verdict. Only when your next step needs it |
| `-o wait=<seconds>` | Same with a timeout (at most 1800; default 600) |
| `-o task=<id>` | Link to a task (same as the trailer) |
| `-o intent="..."` | Set the bean's intent explicitly |

## Not waiting

The check runs on the forge, not in your terminal. A blocking push leaves you idle for the
whole check, every bean. Push plainly, start the next task on a new branch from
`origin/sprout` (or another worktree), and read the status refs between steps. A red or
conflict waits for your next push of that bean, however long; nothing is lost by reading it a
few minutes later. Wait only when nothing else is left (then poll every 30-60 s, or
`bean_wait`), and never finish with a bean still `checking`, `red` or `conflict` without saying so.

## Stacking

A task that builds on your pushed, not yet landed bean starts from it:
`git switch -c bean/<child> bean/<parent>`. Push the child after the parent lands, rebased so
it carries only its own commits: `git fetch origin sprout && git rebase --onto origin/sprout
bean/<parent>`. If the parent comes back red or in conflict, fix and push the parent first,
then `git rebase --onto bean/<parent> <old parent head>` on the child. Do not push the child
while the parent is out: it would carry the parent's change too.

## What the remote prints

Every line starts `remote: beanstalk:`. In order:

1. received: the bean name and the commit, its task, "pre-land check started".
2. With `-o wait` only: progress, a keepalive every 15 s, then one verdict: LANDED (on the
   sprout as `<sha>`; validated later), RED (failing tests, the landed beans you collided
   with and their intent, the output's last lines), or CONFLICT (files and hunks, who landed
   them). Possibly a decision card notice when two beans' intents contradict.

Red and conflict end with the command to run:
`git fetch origin sprout && git rebase origin/sprout`, fix, push again.

## Status refs

`refs/beans/<name>/status` is an annotated tag on the bean's head; its subject is
`<phase>: <reason>` (`checking`, `landed`, `green`, `red`, `conflict`, `parked`, `dropped`) and
its body the verdict as a `-o wait` push prints it.

```bash
git fetch -q origin '+refs/beans/*:refs/beans/*'
git for-each-ref 'refs/beans/<name>/' --format='%(refname:lstrip=2) %(contents:subject)'   # one line
git cat-file -p refs/beans/<name>/status                                                   # the verdict
```

MCP's `bean_status` gives the same with the collided beans' files changed.
