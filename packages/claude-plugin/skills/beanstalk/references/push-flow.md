# Push flow and the `remote:` output

Contents: remote and credential; branches; commit message; push options; what the remote
prints; status refs; live vs coming.

## Remote and credential

`https://<gateway>/git/<owner>/<repo>.git`. Authenticate with a token in the URL or with
git's credential helper. Never echo the token, commit it, or write a tokened URL into a file.
`git remote -v` prints it: do not paste that output anywhere.

## Branches

- Work on `bean/<short-name>` (lowercase, hyphens: `bean/retry-webhooks`). One bean, one branch.
- Start from `origin/sprout`, not `main`.
- A push submits the bean. Pushing the same branch again resubmits it (a new revision,
  typically after a red). Do not reuse a branch name for an unrelated change.
- The remote refuses pushes to `sprout`, `stalk`, `main`, other agents' beans and deletions.

## Commit message

The message is the intent other agents and the pre-land check read: what changes and why, in
a sentence. Optional trailer `Task: <id>` links the bean to a task. `-o intent="..."`
overrides it for the whole bean when you have several commits.

## Push options

| Option | Effect |
|---|---|
| `-o wait` | Block until the pre-land check finishes; print the verdict before returning |
| `-o task=<id>` | Link to a task (same as the trailer) |
| `-o intent="..."` | Set the bean's intent explicitly |

Combine: `git push -o wait -o task=t032 origin bean/retry-webhooks`. A server without an
option ignores it; then poll status.

## What the remote prints

Read every `remote:` line, in this order:

1. received: the bean name and the sprout commit it is based on.
2. check running: the suite started (with `-o wait` the push blocks here).
3. One verdict: green (landed on the sprout), red (failing tests, the landed bean you
   collided with, its intent, and the fix), or conflict (files and hunks, who landed them).
4. Possibly a decision card notice when two beans' intents contradict.

Red and conflict messages end with the command to run:
`git fetch origin sprout && git rebase origin/sprout`, fix, push again.

## Status refs

`refs/beans/<name>/status` holds the latest verdict. Run
`git fetch origin 'refs/beans/*:refs/beans/*'` then `git show refs/beans/<name>/status`.
Use it when you did not push with `-o wait`, or lost the terminal output.

## Live vs coming

COMING (git-native intake): pushing `bean/<name>`, push options, `remote:` verdicts, status
refs. LIVE: beans are branches `refs/heads/beans/<task>` pushed by a driver with a slot token
to the gateway's git proxy; verdicts come through MCP `change_status` and `checks_get`. Push
only the branch you were given. `packages/gateway/README.md` is authoritative.
