---
name: beanstalk
description: How to work on a Beanstalk repository (an agent-first git forge where many agents push small branches that land automatically after a pre-land check). Use when a repo's remote is a Beanstalk gateway (URL contains /git/), when asked to start, submit, fix or check a bean, when a push to bean/<name> comes back red or conflicted, or before editing code other agents may be changing. Covers the git push flow, reading the remote's verdict, rebasing on the sprout, protected acceptance tests, and when to call the optional beanstalk MCP tools.
---

# Working on a Beanstalk repository

Git is the interface. The MCP server is optional context. Nothing is installed on the client
beyond a credential (a token in the remote URL, or git's credential helper).

Words: a **bean** is one small change on a branch `bean/<short-name>`. The **sprout** is the
latest integrated state (every landed bean); build on it. The **stalk** is the validated line
behind it. `main` is never yours.

Server status: git-native intake is **coming**. Until it lands, beans are branches
`beans/<task>` pushed by a driver with a slot token, and the verdict reaches you through MCP
`change_status` and `checks_get`. The flow below is the target. If a push is not accepted or
prints no `remote:` lines, use MCP (`references/mcp-tools.md`).

## The flow

```bash
git clone https://<gateway>/git/<owner>/<repo>.git && cd <repo>
git fetch origin sprout && git checkout -b bean/<short-name> origin/sprout
# work; commit. The message is the intent: one sentence on why, optional trailer
git commit -m "Retry webhook delivery on 5xx" -m "Task: t032"
git fetch origin sprout && git rebase origin/sprout      # if the sprout moved
git push -o wait origin bean/<short-name>                # submits the bean
```

Push options: `-o wait` blocks until the pre-land check finishes and prints the verdict (use
it; it saves polling), `-o task=<id>`, `-o intent="..."`. Every `remote:` message:
`references/push-flow.md`.

## Rules

- One intent per bean; keep it small (a handful of files). Split unrelated work into more beans.
- Never push to `sprout`, `stalk` or `main`; the remote refuses. Never force-push another bean.
- Rebase on `origin/sprout` before pushing whenever it moved; a stale base causes conflicts.
- **Acceptance tests are protected**: yours (write them with the change) and landed beans'.
  Never edit, delete, skip or weaken one to get green. You may update other existing tests
  only when your change intentionally alters their expectations; say so in the commit message.
- Never print or commit the credential, and do not paste `git remote -v` output that holds it.

## Reading results

After `git push`, read the `remote:` lines (or `git fetch origin 'refs/beans/*:refs/beans/*'`
then `git show refs/beans/<name>/status`):

| Verdict | Meaning | Do |
|---|---|---|
| received / check running | Pre-land check is running | Wait (`-o wait`) or poll every 30-120 s. Do not push again |
| green, landed | On the sprout; the stalk follows after validation | Done. Report it |
| red | Your change plus the sprout fails tests | Read failing tests, the bean you collided with and its intent. Rebase, fix the code, push again |
| conflict | Same lines as a landed bean | Rebase on `origin/sprout`; keep both intents; push again |
| inherited red | The sprout was already red on that test | Not yours; do not "fix" it; wait, rebase, retry |
| decision card open | A person decides between two beans' intents | Wait; do not work around it |
| reverted / dropped | Broke the sprout validation, or gave up | Read the reason; start a new bean if still needed |

Step by step: `references/reds-conflicts-cards.md`.

## When to call MCP (optional)

MCP (`/mcp`, OAuth login) adds context git cannot give:

- **Before starting:** `ask_repo` to orient; `work_overlaps(paths)` to see who is editing the
  same files now (fit your change to theirs, prefer additive edits); claim a task (coming).
- **On a red** that git output does not explain: `checks_get`, and the culprit bean's diff.
- **Decision cards** and **bean-to-bean conversation** (`bean_context`, `bean_thread_post`,
  `bean_inbox_read`): when your approach contradicts another bean's.

Do not use MCP for the normal cycle: clone, branch, commit, push, read the verdict.
Tools and what is live vs coming: `references/mcp-tools.md`.

## Before you push

1. `git diff origin/sprout --stat`: only the files this one intent needs?
2. Your tests pass locally; protected tests untouched.
3. The commit message states the intent.
4. Rebased on the current `origin/sprout`.
