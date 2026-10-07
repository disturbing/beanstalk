<!-- Paste into your repo's AGENTS.md (Codex, Cursor, Copilot, Gemini CLI). Items marked COMING are not live on the server yet. -->
## Working on this Beanstalk repository

Git is the interface; the Beanstalk MCP server is optional context. The remote is a Beanstalk gateway (`https://<gateway>/git/<owner>/<repo>.git`).

Connecting git (once per machine; do it when git says `Authentication failed`, `terminal prompts disabled` or `remote: Beanstalk: this git is not connected`): run `curl -fsSL <web>/setup.sh | sh -s -- detect` (Windows: download `<web>/setup.ps1` and run it with `detect`). Ask the person ONE question listing the `option` lines (1Password key first, then ssh-agent keys, key files, "generate a new key"). Then run the same script with `generate` if they chose that, `register --key <file.pub>` or `register --agent-key <fingerprint> --agent "<socket>"` (allow it 10 minutes: the person approves in the browser, or enters the printed code on another device), then `remote <owner>/<repo>` and `verify <owner>/<repo>`. Only public keys are sent. Never ask for a password or token in the chat, never put one in a URL, never print `~/.git-credentials`. CI uses a deploy token in `BEANSTALK_TOKEN` (the repository page, tab "Env vars").

Terms: a **bean** = one small change on branch `bean/<short-name>`. **Sprout** = latest integrated state; build on it. **Stalk** = validated line. Never push to `sprout`, `stalk` or `main` (refused).

Flow:
1. `git fetch origin sprout && git checkout -b bean/<short-name> origin/sprout`
2. Work, commit. The commit message is the intent (one sentence, why); optional trailer `Task: <id>`.
3. `git fetch origin sprout && git rebase origin/sprout` if it moved.
4. `git push -o wait origin bean/<short-name>` submits the bean (`-o task=<id>`, `-o intent="..."` optional); `-o wait` blocks until the pre-land check finishes.
5. Read the `remote:` lines. Green: it landed on the sprout. **Red**: failing tests, the landed bean you collided with and its intent; `git fetch origin sprout && git rebase origin/sprout`, fix the code, push again. **Conflict**: files and who landed them; rebase, keep both intents, remove all markers, push again. **Inherited red** (sprout already failing): not yours; wait, rebase, retry. **Decision card**: a person decides; wait, do not work around it. Status ref: `refs/beans/<name>/status` (`git fetch origin 'refs/beans/*:refs/beans/*'`).

Rules: one intent per bean, keep beans small. Acceptance tests (yours and landed beans') are protected: never edit, skip or weaken them; fix the code. Update other existing tests only if your change intentionally alters their expectations (say so in the commit). After three failed rounds on one red, stop and ask. Never undo other beans' work.

Optional MCP (`beanstalk` server, OAuth; tools take `repo: "owner/name"`). It coordinates and explains; git still moves all code. **Claim before starting**: if the repository has a backlog, `task_list` then `task_claim` (refused = someone holds it; pick another; `task_release` gives back one you will not do), then `bean_open(repo, bean, intent, task?)` to reserve the name and get the branch and push commands; `work_overlaps(paths)` shows who is editing the same files. **After pushing**: without `-o wait`, `bean_wait(repo, bean)`; on a red or conflict, `bean_status(repo, bean)` gives the failing tests and the landed beans you collided with, their intent and files. **Credentials**: only if git is not connected and setup is not possible, `git_credentials(repo)` returns a one-hour credential for that repository; pipe its `credential` field to `git credential approve` (with `credential.https://<gateway host>.useHttpPath true`), never into a URL, file or the chat. Decision cards and bean-to-bean conversation: `bean_context`, `bean_thread_post`, `bean_inbox_read`.

COMING: git over SSH (setup then switches the remote to `ssh://git@<ssh host>/<owner>/<repo>.git`).
