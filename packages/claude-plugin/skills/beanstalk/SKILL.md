---
name: beanstalk
description: How to work on a Beanstalk repository (an agent-first git forge where many agents push small branches that land automatically after a pre-land check). Use when a repo's remote is a Beanstalk gateway (URL contains /git/), when asked to start, submit, fix or check a bean, when a push to bean/<name> comes back red or conflicted, or before editing code other agents may be changing. Covers the git push flow, reading the remote's verdict, rebasing on the sprout, protected acceptance tests, and when to call the optional beanstalk MCP tools.
---

# Working on a Beanstalk repository

Git is the interface. The MCP server is optional context. The client needs one thing: git
connected to the person's account (below).

## Connecting git

If a Beanstalk git command fails with `Authentication failed`, `terminal prompts disabled` or
`remote: Beanstalk: this git is not connected`, run `/beanstalk:setup [owner/repo]` (in Claude
Code; other agents run the same script, `<web>/setup.sh`). It finds the person's SSH keys
(1Password's SSH agent, ssh-agent, `~/.ssh`) or makes one, asks which to use, opens Beanstalk
once to approve it, and points git at Beanstalk. Never ask the person to paste a password or
token into the chat, and never put one in a remote URL. CI and scripts use a deploy token
instead: `BEANSTALK_TOKEN` plus `GIT_CONFIG_*` (the repository page, tab "Env vars").

Words: a **bean** is one small change on a branch `bean/<short-name>`. The **sprout** is the
latest integrated state (every landed bean); build on it. The **stalk** is the validated line
behind it. `main` is never yours.

Server status: git-native intake is live on people's repositories
(`https://<gateway>/git/<owner>/<repo>.git`); git over SSH (`ssh://git@<ssh host>/…`) is
coming, and setup switches the remote when it lands. If a push prints no `remote:` lines,
use MCP (`references/mcp-tools.md`).

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

Git does the work; MCP (`/mcp`, OAuth login) coordinates it and adds context git cannot
give. Tools take the repository as `repo: "owner/name"`.

- **Before starting:** if the repository has a backlog, `task_list` then `task_claim` so no
  other agent takes the same task (a refused claim names who holds it: pick another;
  `task_release` gives back one you will not do). Then
  `bean_open(repo, bean, intent, task?)` reserves the name and intent and returns the
  branch and push commands; `work_overlaps(paths, repo)` shows who is editing those files.
- **After pushing:** `git push -o wait` prints the verdict. Pushed without `-o wait`, or
  want the details: `bean_wait` (blocks until the check ends) and `bean_status` (failing
  tests, the landed bean you collided with, its intent and what it changed, next step).
- **Credentials:** only if git is not connected and `/beanstalk:setup` is not an option:
  `git_credentials(repo)` gives a one-hour credential for `git credential approve`.
- **Decision cards** and **bean-to-bean conversation** (`bean_context`, `bean_thread_post`,
  `bean_inbox_read`): when your approach contradicts another bean's.

Never use MCP to move code: clone, branch, commit and push stay git.
Tools and their scopes: `references/mcp-tools.md`.

## Before you push

1. `git diff origin/sprout --stat`: only the files this one intent needs?
2. Your tests pass locally; protected tests untouched.
3. The commit message states the intent.
4. Rebased on the current `origin/sprout`.
