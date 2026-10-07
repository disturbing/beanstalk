# Repositories: create, start, grow

Built 2026-10-07 on branch `worktree-agent-repos` (from `prototype`, merged up to `1d1d0f3`). This is backlog `16` items 2.2 and most of 2.7: persistent repositories owned by a person, created from the web, and the page a new user lands on. The engine and git side is `18-git-native-flow.md`; accounts are `19-accounts-and-auth.md`.

## 1. What a person sees

| Route | What it is |
|---|---|
| `/` signed in | Home: a lead sentence, your repositories (each with "N beans landed, M growing" from its engine), recent activity, New repository. A first visit shows three steps (create, connect an agent, push a bean) and the demo repository. Signed out, `/` is still the benchmark landing, which also lives at `/races`. |
| `/new` | Name (with the owner prefix), description, private or public, and how it starts: the **TypeScript starter** (default), **empty** (a README) or **import a public git URL**. Errors sit beside their field and keep what was typed. |
| `/<owner>/<repo>` before the first bean | The start page (below). |
| `/<owner>/<repo>` after | The repository home from `14` §11, unchanged: the stalk, Growing now, What happened, Ask, Files, beans, decisions, checks, read from the repository's engine. |
| `/<owner>/<repo>/files` | The Files explorer once something grew; the stalk's file list before. |
| `/<owner>/<repo>/settings` | Owner only (others get the same 404 as a missing repository): rename and description, visibility, a collaborators placeholder, delete after typing `<owner>/<name>`. |
| `/<owner>` | The owner's repositories (for now only on your own page; listing someone else's needs a handle lookup from accounts). |

The shell names the repository once (`owner / name` plus a private or public pill), then its tabs. A race keeps its Engine tab; a repository has Settings instead. Night, day (phosphor, paper, blueprint) and phone widths all work; screenshots are in `exp/repos/`.

### The start page

The first screen after "Create repository", so it has one job: say what is there and exactly how to begin.

- **Lead:** "greeter is ready. Its stalk holds the TypeScript starter, 7 files, with tests every bean must pass before it lands."
- **Hand it to an agent:** the install line for Claude Code, Codex (`codex mcp add … --url <mcp>`) and any MCP client, each with Copy, then the sentence to say to the agent.
- **Or push a bean with git:** a `bean/<name>` branch is a bean; the six commands (clone, switch, commit, `git push -o wait origin bean/first-change`) with one Copy; the rules (push only `bean/*`; the password is a personal token from Settings, Tokens).
- **Clone it:** the URL, `https://<gateway>/git/<owner>/<repo>.git`.
- **On the stalk** (the files, read from Artifacts by the gateway) and **What counts as green** (`.beanstalk/checks.toml`, or a note that a bean lands on a clean merge without one).
- **The stalk column** is the real one: the root commit as a leaf, "Fertilized by <owner>", and a breathing bean socket above it: "Your first bean grows here". Once a bean starts, the page becomes the repository home.

## 2. How it works

```
web /new ──createRepository(owner, input)──▶ gateway
                                              ├─ D1 forge: reserve <owner>/<name> (unique per owner, any case)
                                              ├─ Artifacts: create repo-<id> (default branch stalk), or import
                                              ├─ seed: one root commit pushed to stalk and sprout (or point them at the import's head)
                                              ├─ openRepoEngine({ repoName, artifactsRepo, owner }) → engineId
                                              └─ D1: mark ready + "created" activity
web /<owner>/<repo> ─getRepository / repositoryFiles──▶ registry;  runView/runEvents/repoTree(engineId) ──▶ engine
git /git/<owner>/<repo>.git ──▶ registry (name → engine, owner, visibility) ──▶ mayUseEngine ──▶ engine
```

- **Registry in D1, not a Durable Object.** Every registry read is a cross-repository index (an owner's list, a handle-and-name lookup, an engine-to-repository lookup, activity across repositories), and name uniqueness is one unique index on `(owner_id, lower(name))`. A single registry DO would be a global serialisation point for every page load; the engine's hot state stays in its own DO. Tables: `repositories` and `repository_activity` (`packages/gateway/migrations/0001_repositories.sql`, binding `FORGE`).
- **Storage is named by id** (`repo-<12 chars>`), so a rename never moves git data.
- **The first commit is written in the gateway.** `src/git/seed-pack.ts` builds the blobs, trees and commit as a git pack (zlib via `CompressionStream`, SHA-1 ids, checked against `git fsck --strict`); `src/adapters/repository-storage.ts` mints a one-minute write token, pushes `stalk` and `sprout` in one receive-pack request, and revokes it. No token leaves the gateway, and the web never sees one.
- **The TypeScript starter** has no dependencies: `src/text.ts`, `test/text.test.ts` (Node's test runner on `.ts` files, Node 23.6+), `package.json` (`npm test`), `tsconfig.json`, `.beanstalk/checks.toml`, README. The engine's default suite is `node --test`, which runs those tests, so the first bean's pre-land check is real.
- **A failure on the way undoes itself** (registry row and Artifacts repo removed), so the name is free again; a private import URL comes back as an error on the form.
- **Git access has one rule** (`mayUseEngine` in `gateway/src/auth/git-credential.ts`): a token bound to an engine uses that engine; a person's token (`bsu_`, `bss_`) uses the repositories its person owns and reads public ones; run tokens never reach repositories. The git proxy resolves `/git/<owner>/<repo>.git` through the registry, so a renamed repository keeps its engine at its new URL and its old URL answers 404. Engines opened without a registry record (the admin route) keep the derived-id path and are private.
- **Web adapters:** accounts through `src/auth/user.ts` (accounts' module; `src/server/signed-in.ts` redirects to sign in), the registry through `src/repositories/registry-client.ts` (every answer validated with Zod), the engine through the existing run read RPCs keyed by `engine_id`. The repository home and Files explorer are shared components keyed by a base path (`/runs/<run>` or `/<owner>/<repo>`), so races and repositories render the same views.

## 3. Verified

- **Tests:** gateway `test/repositories.test.ts` (create with template, empty and import; per-owner uniqueness ignoring case; invalid names; cleanup after a failed import; private visibility; rename, describe, visibility with activity; ownership; delete; git at the new name and not the old), `src/git/seed-pack.test.ts` (git's object ids, the commit id git computes for the same files, the receive-pack body, refusal parsing), `test/user-credentials.test.ts` (the access rule); web `src/repositories/repositories.test.ts` (the form, create, settings and delete flows, the route lookup, the start guide, growth lines). `pnpm check` exits 0.
- **Staging, end to end** on a separate stack (`beanstalk-web-staging-repos`, `beanstalk-gateway-staging-repos` with its runner, `beanstalk-mcp-staging-repos`, Artifacts namespace `beanstalk-race-staging-repos`, D1 `beanstalk-forge-staging-repos` and `beanstalk-identity-staging-repos`, KV `beanstalk-oauth-staging-repos`), driven by headless Chrome with a virtual authenticator:
  1. passkey sign-up as `coop`;
  2. New repository `greeter` from the TypeScript starter; the start page;
  3. a personal token with write access from Settings, Tokens;
  4. `git clone`, a `bean/add-truncate` commit (a function and its test), `git push -o wait`: received, pre-land check green on the merged tree in 5.9 s, landed on the sprout, validated on the stalk, **18 s** for the whole push;
  5. the repository page switched from the start page to the home with the leaf on the stalk; Home listed "1 bean landed".
  A second person (`dana`) saw the first-visit Home, got a 404 for `coop/greeter` (private), created `my-first-app`, and was told "You already have a repository named my-first-app." on a second try.

## 4. Open

- **Archive**, the Stalk and Insights tabs, collaborators (the settings section is a placeholder; `mayUseEngine` is where they join), org owners.
- **Home's activity** shows registry events only (created, renamed, visibility); landings should come from the engine (backlog 2.6's event queue).
- **Repository home copy is still race-shaped** in places: suggestions such as "what has a0 done?" and "0 people, 0 sessions active" after a person's push. A pushed bean should name its person.
- **Handles must avoid the app's routes** (`api`, `auth`, `login`, `new`, `race`, `races`, `runs`, `settings`, `signup`, `connect`, `inbox`, `assets`): `RESERVED_OWNERS` in `web/src/repositories/paths.ts` answers 404 for them; accounts should refuse them at sign-up.
- **The plugin install line** names `beanstalkdev/beanstalk-plugin`, which is not published yet (backlog 1.4).
- **Engine settings per repository:** the template relies on the default `node --test` suite; `checks.toml` is written but not read by the engine yet (backlog 2.3).
