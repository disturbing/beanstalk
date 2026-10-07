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
- **Repositories have their own Artifacts namespace** (`beanstalk-repos`, binding `REPOS`), apart from race repos (`beanstalk-race`, binding `ARTIFACTS`). The hourly sweep lists only the race namespace, so it cannot see a person's repository, whatever its name; a repository engine's RunDO also refuses any reap or sweep (409), and picks its namespace from what it drives (`selectedArtifactsPort` in `adapters/artifacts.ts`). Test: `spend-guards.test.ts`, "never deletes a person's repository, however old" (a sweep with `older_than_hours: 0`, plus a `race-*`-named repo planted in the repositories' namespace).
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
- **Files rail:** the right-hand context rail on the Files page still has its "agents" sections, and an "agent activity" answer says "Session a0"; both show only when someone asks about a slot.

Done 2026-10-07 (live rollout, §5): repository pages name the pushing person (`last push @coop: add-truncate`, `@coop` where a race shows `a0`, "pushed by @coop") and suggest repository questions; handles that clash with routes are refused at sign-up; the plugin install line is real.

## 5. Live

Rolled out 2026-10-07 to the live stack (`*.<sub>.workers.dev`): gateway, web, MCP, with production resources D1 `beanstalk-identity` and `beanstalk-forge` (migrations applied), KV `beanstalk-oauth`, and the Artifacts namespace `beanstalk-repos` (created by its first repository). Their ids are in the `wrangler.jsonc` files; another account replaces them (or removes `database_id` / `id` to let Wrangler provision new ones). No new secrets: sessions, passkey challenges and tokens are random values hashed in D1, and the OAuth provider encrypts grant props with keys derived from each token.

- **Reserved handles:** one list, `packages/shared-identity/src/reserved-handles.ts`, used by sign-up (`Handle`) and by the web's owner routes (`isReservedOwner`, plus static files). `web/src/repositories/reserved-routes.test.ts` reads the router's top-level directories (`app/*`) and fails if any is not refused as a handle, so a new route must be added there.
- **Claude Code plugin:** `.claude-plugin/marketplace.json` at the repository root lists `packages/claude-plugin`. `claude plugin marketplace add disturbing/beanstalk && claude plugin install beanstalk@beanstalk` (the public repository's default branch is `prototype`, so no branch needs naming; `disturbing/beanstalk#<branch>` names another). Verified with Claude Code 2.1.292 from a local checkout (marketplace added, plugin installed, its MCP server listed); `#prototype` is accepted as a ref.
- **Codex:** `codex mcp add beanstalk --url <live mcp>/mcp && codex mcp login beanstalk`.
- **Races after the deploy:** a replay race (shop arena, seed 7, `--preset demo`, `--max-usd 1`) gave 25 of 40 green with 15 replay-limitation drops, the same as the integration branch's run with these flags (`runs/live-replay-after-deploy`). After the gateway was redeployed with `origin/prototype` at `9702954` (runner API 4), the first race met the old runner image mid-rollout (21 `runner_version_mismatch` drops, `-r2`); five minutes later it gave 25 of 40 again with no infrastructure drop (`-r3`), and an admin-opened repository took a pushed bean green in 4.7 s on the new image.
- **Walk-through on live, 22 of 22 checks** (headless Chrome with a CDP virtual authenticator; the script stayed in the session scratchpad): passkey sign-up as `beanstalk-smoke`; `smoke-greeter` from the TypeScript starter, whose start page shows the real install lines; a personal token with write access (masked before the screenshot); `git clone` through the credential helper; a `bean/add-truncate` commit (a function and its test), `git push -o wait`: pre-land check green on the merged tree in 5.1 s, LANDED, validated on the stalk, **17.0 s** for the push; the status ref read; the repository page with the bean, "last push @beanstalk-smoke: add-truncate" and repository-shaped Ask suggestions; Home listing it; `claude mcp add --transport http` then `claude mcp login` in a pseudo-terminal: "Needs authentication", consent as "Claude Code", "Connected", and `claude -p` calling `whoami` → `{"handle":"beanstalk-smoke","client":"Claude Code","via":"oauth","scopes":["read"],…}`; then the repository deleted (404), the token revoked and refused by git. The account is left for Coop to delete. Files: `exp/live/01-…13-*.png`, `push-transcript.txt`, `mcp-login-transcript.txt`, `whoami.txt`.
- **Engine settings per repository:** the template relies on the default `node --test` suite; `checks.toml` is written but not read by the engine yet (backlog 2.3).
