---
name: beanstalk
description: How to commit, push and land work on a Beanstalk repository, an agent-first git forge where many agents push small bean/<name> branches that land on the sprout after a pre-land check. Use whenever the git remote (origin) is a Beanstalk host (a URL like https://<gateway>/git/<owner>/<repo>.git, a beanstalk host name, or a repo with sprout and stalk branches), before you branch, commit, push or submit work there, when you hand tasks to subagents in such a repo, when a push to bean/<name> comes back red or conflicted, or when asked to start, submit, fix or check a bean. Check `git remote get-url origin` first; skip this skill when origin is GitHub, GitLab, Bitbucket or another forge. Covers pushing without waiting for the check, working on the next task meanwhile, one blocking git wait that the verdict wakes when you are out of work (never sleep-polling), leading subagents, stacking a task on a pushed bean, rebasing on the sprout, protected acceptance tests, and the optional beanstalk MCP tools.
---

# Working on a Beanstalk repository

Git is the interface. The MCP server is optional context. The client needs one thing: git
connected to the person's account (below).

Words: a **bean** is one small change on a branch `bean/<short-name>`. The **sprout** is the
latest integrated state (every landed bean); build on it. The **stalk** is the validated line
behind it. `main` is never yours. The forge's remote is `https://<gateway>/git/<owner>/<repo>.git`.

## Connecting git

If a Beanstalk git command fails with `Authentication failed`, `terminal prompts disabled` or
`remote: Beanstalk: this git is not connected`, run `/beanstalk:setup [owner/repo]` (in Claude
Code; other agents run the same script, `<web>/setup.sh`). It finds the person's SSH keys or
makes one, opens Beanstalk once to approve it, and points git at Beanstalk. Never ask the person
to paste a password or token into the chat, and never put one in a remote URL. CI and scripts
use a deploy token: `BEANSTALK_TOKEN` plus `GIT_CONFIG_*` (the repository page, tab "Env vars").

## The flow: push, then keep working

```bash
git fetch origin sprout && git switch -c bean/<short-name> origin/sprout
# work; commit. The message is the intent: one sentence on why, optional trailer
git commit -m "Retry webhook delivery on 5xx" -m "Task: t032"
git fetch origin sprout && git rebase origin/sprout      # if the sprout moved
git push origin HEAD:refs/heads/bean/<short-name>        # submits the bean; returns in seconds
git fetch origin sprout && git switch -c bean/<next> origin/sprout   # next task, now
```

A plain push returns as soon as the bean is received. The forge then merges it onto the sprout
and runs the whole suite (about a minute). **Never wait on your own check while you have work,
and never `sleep` to poll the forge.** Start the next task at once. Between steps (after a
commit, before a new task) a quick look costs nothing:

```bash
git fetch -q origin '+refs/beans/*:refs/beans/*'
git for-each-ref 'refs/beans/<a>/' 'refs/beans/<b>/' --format='%(refname:lstrip=2) %(contents:subject)'
```

The subject is `<phase>: <reason>`: `checking`, `landed`, `green` (on the stalk), `red`,
`conflict`, `parked`, `dropped`.

**Out of work: one blocking call that the verdict wakes.** Name your beans:

```bash
git push -o bean=<a> -o bean=<b> origin HEAD:refs/wait/any   # returns at the first verdict
git push -o bean=<a> -o bean=<b> origin HEAD:refs/wait/all   # returns when none is checking
```

A push to `refs/wait/any|all` stores nothing. The forge holds it and prints each verdict as it
arrives (`verdict for <bean>: landed|red|conflict`, with the failing tests or hunks), then
`your beans: ...` and the next step. It returns at once when one of them is already red or in
conflict, or none is checking. Without `-o bean=` it covers every bean in flight pushed with your
credential, which subagents share, so workers name their own. It holds up to 9 minutes
(`-o wait=<s>`, at most 1800); in Claude Code give that Bash call `timeout: 600000`. Loop:
wait-any, react (fix a red and push it again), wait-any again; before you finish, `refs/wait/all`
until every bean is `landed` or handed back. MCP `bean_wait` does the same for one bean.

`git push -o wait origin HEAD:refs/heads/bean/<name>` submits and blocks in one step: only when
your very next step needs that verdict. Pushing the same commit again does nothing (git says
"Everything up-to-date"); to re-attach to a bean in check, wait on it as above.

A red or conflict comes back to **you**, its author: commit your work in progress, `git switch
bean/<name>`, rebase on `origin/sprout`, fix, `git push -f origin HEAD:refs/heads/bean/<name>`,
and switch back. A new commit to a bean still being checked is refused (the message says how to
wait for its verdict); its verdict comes first.

**Stacking.** A task that needs your pushed bean that has not landed yet can start on top of
it: `git switch -c bean/<child> bean/<parent>`. Push the child once the parent has landed:
`git fetch origin sprout && git rebase --onto origin/sprout bean/<parent>` (drops the parent's
commits; the sprout has them as a squash), then push. If the parent comes back red, fix and
re-push it, then move the child onto the fixed parent (`git rebase --onto bean/<parent>
<old parent head>`).

**Teams.** When you split work among subagents, each one pushes its own beans from its own
worktree, owns their reds, and when out of tasks waits with `refs/wait/any` naming its beans;
the lead does not push for them. **A lead never sleeps or polls.** In Claude Code, start
workers with the Agent tool in the background (`run_in_background: true`), then end your turn:
Claude Code starts your next turn with a notification each time a worker finishes (`claude -p`
stays alive while background workers run). On each notification read the report, start the
next worker if work remains, and end your turn again. After the last worker has reported, one
`git push origin HEAD:refs/wait/all` (every bean of the shared credential), then report. Push
options and every `remote:` line: `references/push-flow.md`.

## Rules

- One intent per bean; keep it small (a handful of files). Split unrelated work into more beans.
- Never push to `sprout`, `stalk` or `main`; the remote refuses. Never force-push another bean.
- Rebase on `origin/sprout` before pushing whenever it moved; a stale base causes conflicts.
- **Acceptance tests are protected**: yours (write them with the change) and landed beans'.
  Never edit, delete, skip or weaken one to get green. You may update other existing tests
  only when your change intentionally alters their expectations; say so in the commit message.
- Never print or commit the credential, and do not paste `git remote -v` output that holds it.

## Reading results

The status ref above (or `git cat-file -p refs/beans/<name>/status` for the full verdict, or the
`remote:` lines of a wait):

| Verdict | Meaning | Do |
|---|---|---|
| checking | Pre-land check is running | Work on something else. Do not push this bean again |
| landed / green | On the sprout / validated on the stalk | Done. Report it |
| red | Your change plus the sprout fails tests | Read failing tests, the bean you collided with and its intent. Rebase, fix the code, push again |
| conflict | Same lines as a landed bean | Rebase on `origin/sprout`; keep both intents; push again |
| inherited red | The sprout was already red on that test | Not yours; do not "fix" it; wait, rebase, retry |
| decision card open | A person decides between two beans' intents | Wait; do not work around it |
| reverted / dropped | Broke the sprout validation, or gave up | Read the reason; start a new bean if still needed |

Step by step: `references/reds-conflicts-cards.md`.

## When to call MCP (optional)

Git does the work; MCP (`/mcp`, OAuth login) coordinates it and adds context git cannot
give. Tools take the repository as `repo: "owner/name"`.

- **Before starting:** with a backlog, `task_list` then `task_claim` so no other agent takes
  the same task (`task_release` gives one back). `bean_open(repo, bean, intent, task?)`
  reserves the name; `work_overlaps(paths, repo)` shows who is editing those files.
- **After pushing:** `bean_status` (failing tests, the landed bean you collided with, its
  intent and what it changed, next step); `bean_wait` blocks until the check ends, so call it
  only when you have nothing else to do.
- **Credentials:** only if git is not connected and `/beanstalk:setup` is not an option:
  `git_credentials(repo)` gives a one-hour credential for `git credential approve`.
- **Decision cards** and **bean-to-bean conversation** (`bean_context`, `bean_thread_post`,
  `bean_inbox_read`): when your approach contradicts another bean's.

Never use MCP to move code. Tools and their scopes: `references/mcp-tools.md`.

## Before you push

1. `git diff origin/sprout --stat`: only the files this one intent needs?
2. Your tests pass locally; protected tests untouched.
3. The commit message states the intent.
4. Rebased on the current `origin/sprout`.
