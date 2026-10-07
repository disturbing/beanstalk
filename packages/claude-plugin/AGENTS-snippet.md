<!-- Paste into your repo's AGENTS.md (Codex, Cursor, Copilot, Gemini CLI). Items marked COMING are not live on the server yet. -->
## Working on this Beanstalk repository

Git is the interface; the Beanstalk MCP server is optional context. The remote is a Beanstalk gateway (`https://<gateway>/git/<owner>/<repo>.git`); the only client setup is a credential (token in the URL or git credential helper). Never print or commit it.

Terms: a **bean** = one small change on branch `bean/<short-name>`. **Sprout** = latest integrated state; build on it. **Stalk** = validated line. Never push to `sprout`, `stalk` or `main` (refused).

Flow:
1. `git fetch origin sprout && git checkout -b bean/<short-name> origin/sprout`
2. Work, commit. The commit message is the intent (one sentence, why); optional trailer `Task: <id>`.
3. `git fetch origin sprout && git rebase origin/sprout` if it moved.
4. `git push -o wait origin bean/<short-name>` submits the bean (`-o task=<id>`, `-o intent="..."` optional); `-o wait` blocks until the pre-land check finishes.
5. Read the `remote:` lines. Green: it landed on the sprout. **Red**: failing tests, the landed bean you collided with and its intent; `git fetch origin sprout && git rebase origin/sprout`, fix the code, push again. **Conflict**: files and who landed them; rebase, keep both intents, remove all markers, push again. **Inherited red** (sprout already failing): not yours; wait, rebase, retry. **Decision card**: a person decides; wait, do not work around it. Status ref: `refs/beans/<name>/status` (`git fetch origin 'refs/beans/*:refs/beans/*'`).

Rules: one intent per bean, keep beans small. Acceptance tests (yours and landed beans') are protected: never edit, skip or weaken them; fix the code. Update other existing tests only if your change intentionally alters their expectations (say so in the commit). After three failed rounds on one red, stop and ask. Never undo other beans' work.

Optional MCP (`beanstalk` server, OAuth): before starting (`ask_repo`; `work_overlaps(paths)` shows who is editing the same files now), on a red needing more context (`checks_get`), for decision cards and bean-to-bean conversation (`bean_context`, `bean_thread_post`, `bean_inbox_read`). Not needed for the normal clone, branch, commit, push cycle.

COMING: git-native intake (pushing `bean/<name>`, push options, `remote:` verdicts, status refs), MCP OAuth, task claim and `bean_open` tools. Today beans are `beans/<task>` branches pushed by a driver and verdicts come through MCP `change_status` / `checks_get`.
