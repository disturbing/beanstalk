# Checks config: `.beanstalk/checks.toml`

Built 2026-10-07 (backlog `16` item 2.3). A persistent repository says what a bean must pass before it lands in one file, `.beanstalk/checks.toml`, read from the exact tree each check runs on. The engine and push flow are `18-git-native-flow.md`; repositories are `20-repositories.md`.

## 1. The format

```toml
# .beanstalk/checks.toml
image = "node"                                    # the runner image; "node" is the only one today
command = ["node", "--test", "spec/**/*.spec.mjs"] # an argv, never a shell
timeout_seconds = 60                              # the whole suite's limit
protected_paths = ["data/schema.json", "migrations/**"]

[env]
KV_LIMIT = "3"
```

| Key | Type | Default | Rules |
|---|---|---|---|
| `image` | string | `"node"` | Only `"node"`: the runner image ships Node 25.8.1 and nothing else (§6). |
| `command` | array of strings | `["node", "--test"]` | Runs as an argv (no shell, no `npm test`). Must start with `node` and contain `--test`: the runner puts its reporters after `node` and reads node's junit report. At most 64 arguments of at most 500 characters. Options take their value with `=` (`--test-concurrency=1`); arguments after `--test` that do not start with `-` are the test files or globs, which targeted checks replace. |
| `timeout_seconds` | integer | 300 | 1 to 1800. A suite that runs out of time is re-run, never a red (`18` §7.1). |
| `protected_paths` | array of patterns | `[]` | Relative to the root, no `..`, at most 100. `*` and `?` stay within a path segment, `**` is any number of segments, a trailing `/` is everything under that directory, anything else is an exact path. `.beanstalk/**` is always protected on top. |
| `[env]` | table of strings | none | At most 32 upper-case names; `PATH`, `HOME`, `CI`, `GIT_*`, `LD_*`, `NODE_TEST*` and `BWRAP*` are the runner's and refused. |

Any other key is refused by name (`unknown key "comand" (did you mean "command"?)`). The file is at most 16,000 characters. One suite per repository: the starter's old draft (`[[check]]` with `command = "npm test"`, never read by anything) is refused with a sentence saying how to write the new form. The TypeScript starter now writes `image = "node"`, `command = ["node", "--test"]`, `timeout_seconds = 120`, `protected_paths = []`.

Parser and validation: `packages/shared-race/src/checks-config.ts` (smol-toml 1.9.0, BSD-3-Clause, and Zod), shared by the gateway and the web so the page shows exactly what the engine runs.

## 2. What happens on a push

Every check of a repository engine (a bean's pre-land check, the sprout's validations, culprit probes, re-checks) first reads `.beanstalk/checks.toml` from the commit it checks. For a pre-land check that commit is the bean squashed onto the sprout, so **a bean that changes the file is checked by its own copy**, and every later bean inherits whatever landed.

| The tree has | The check | The push sees |
|---|---|---|
| no file | green with no tests, no runner call; the bean lands on a clean merge | `beanstalk: no .beanstalk/checks.toml on this tree: no checks run, and a bean lands when it merges cleanly` |
| an invalid file | red without running anything; one failing "test", `.beanstalk/checks.toml > the checks config is valid` | `beanstalk: .beanstalk/checks.toml is invalid:` and one line per problem (`line 2, column 19: invalid value`, `command: must be an argv array such as ["node", "--test"]; it never runs through a shell`, `image: "rust" is not available: …`), then the usual RED verdict quoting them |
| a valid file | the runner runs `command` with `env` and `timeout_seconds` | `beanstalk: checks from .beanstalk/checks.toml: node --test --test-concurrency=1 'spec/**/*.spec.mjs' (image node, timeout 60 s, env KV_LIMIT)` |

The backlog chose "no checks" for a missing file (a person adds the file to require tests); the start page and Settings say so in the same words.

### Protected paths

A bean's pre-land check compares the files the bean changes (the runner's squash `files`, sprout to merged tree) with the patterns **of the sprout's file** (the bean's own copy cannot unprotect itself) plus `.beanstalk/**`. If it touches one and its push may not, the check is red before any suite runs:

```
beanstalk: changes protected paths (data/schema.json): refused for a deploy token acting for @coop-chk
beanstalk: RED: schema was not landed. Merged onto the sprout, these tests failed:
beanstalk:   - data/schema.json > changes a protected path
beanstalk: output:
beanstalk:   This bean changes protected paths: data/schema.json.
beanstalk:   The sprout protects .beanstalk/**, data/schema.json (protected_paths in .beanstalk/checks.toml; .beanstalk/** always).
beanstalk:   Only the owner or a maintainer, pushing with a personal token or an SSH key, may change them;
beanstalk:   this push was by a deploy token acting for @coop-chk.
```

**Who may:** the repository's owner or a collaborator with the maintain role, pushing with their own credential (a personal token `bsu_` or an SSH key). Agent session tokens (`bss_`, MCP), deploy tokens (`bsd_`) and engine tokens never may, whoever they act for; the push line names who was allowed (`allowed for @coop-chk (owner, with a personal token)`). So an agent cannot weaken the checks it is judged by, and the backlog's "refused or flagged" is **refused** (a red the author reworks by dropping the change); there is no flag-and-ask card yet (§6). The decision is made per push from the credential the gateway verified (`checks/protected-access.ts`), kept on the pushed bean, and applied when its check runs.

## 3. How it is built

```
git push ─▶ push-proxy: credential + role ─▶ protectedAccess on the PushBean
engine: squash job (runner) ─▶ landing_trees(sha → bean, onto, files)       RunDO SQLite
engine: check job ─▶ planCheck: read checks.toml at sha (and at onto for a pre-land check)
                     ├─ protected change, not allowed ─▶ red, no runner call
                     ├─ missing ─▶ green, no tests, no runner call
                     ├─ invalid ─▶ red, no runner call
                     └─ valid ─▶ runner /v1/check with cmd, env, suite_timeout_seconds
                     lines ─▶ check_lines(sha) ─▶ preland.check event fold ─▶ remote: lines
```

- `checks/repository-checks.ts` decides (`planCheck`, `decide`, `protectedGuard`); `checks/check-store.ts` keeps the squashes and lines (500 rows each); `run/run-jobs.ts` asks it before every check when the engine reads repository checks; `push/push-events.ts` prints the lines before the check's verdict.
- The config is read through the Artifacts binding. A commit not readable yet (the runner's candidate push is eventually consistent) is a retryable job failure, **never** "no file": a missing commit must not land a bean without checks.
- **No runner change** (runner API stays 4): the runner already takes `cmd`, `env` and `suite_timeout_seconds`.
- `RunConfig.checks_source` (`suite` | `repository`) says where an engine's checks come from. Engines opened from the registry get `repository`; an operator who opens an engine with `settings.suite` (load tests, paired comparisons) gets `suite`, and `settings.engine.checks_source` pins either. **Engines opened before this change** have no field: a continuous engine with the default suite reads repository checks (`checksSourceOf`), so existing repositories switch when the gateway is deployed (§6).

## 4. On the web

- **Settings → Checks** (everyone with a role; read-only, since the file changes by a maintainer's bean): the effective config of the stalk (what runs, image, time limit, environment, protected paths including `.beanstalk/**`) and the file itself behind a disclosure; "No checks" with how to add them; or "Invalid" with every problem.
- **The start page's "What counts as green"** shows the same summary (`components/repository/checks-config.tsx`, `ChecksSummary`), ready for the Checks tab of backlog 2.7 to reuse.

Screenshots (staging, night and day, phone): `exp/checks-config/`.

## 5. Verified

**Tests** (`pnpm check` exits 0):
- `shared-race/src/checks-config.test.ts`: examples for every key and message, and fast-check properties: every valid config written as TOML reads back equal; any input (text or binary) never throws and an invalid answer always has a non-empty reason; any unknown key is named; each of the runner's own variables is refused by name; every valid config gives a suite the runner contract (`RunSuite`) accepts; directory patterns cover everything under them and nothing beside; `*` never crosses `/`; flagged files are a subset of the changed ones and always include the checks file.
- `gateway/src/checks/repository-checks.test.ts`: the decision table, protected paths taken from the sprout not the bean, validations not guarded, who may change protected paths per credential and role, the starter's file valid.
- `gateway/test/checks-config.test.ts`, end to end through the Worker, the engine DO, the fake Artifacts and the fake runner (whose squashes now land in the fake trunk repo as the real runner's candidates do): no file lands with no runner call; an agent's change to the checks is refused; the owner's checks then run with their argv, env and timeout for later beans, and a protected migration is refused; an invalid file is a red naming both problems.

**Staging** (`beanstalk-gateway-staging-checks` with its runner on standard-2, `beanstalk-web-staging-checks`, Artifacts `beanstalk-race-staging-checks` / `beanstalk-repos-staging-checks`, D1 `beanstalk-forge-staging-checks` and `beanstalk-identity-staging-checks`): passkey sign-up as `coop-chk` in headless Chrome, three repositories from the web, a personal token and two deploy tokens from the web, then real `git push -o wait` by hand. Transcript: `exp/checks-config/staging-transcript.txt`.

| Repository | Push | Credential | Result |
|---|---|---|---|
| `node-app` (TypeScript starter) | `add-truncate` | owner, personal token | `checks from .beanstalk/checks.toml: node --test (image node, timeout 120 s)`, green 5.1 s, landed and validated, 19 s |
| | `shout` (a failing test) | owner | red, `test/shout.test.ts > shouts with an exclamation mark` |
| | `weaken-checks` | deploy token | refused: `.beanstalk/checks.toml` is protected |
| | `bad-checks` (`command = "npm test"`) | owner | allowed to change it, then red: `command: must be an argv array …` |
| `kv-spec` (empty start, `spec/*.spec.mjs`, ESM) | `notes` | deploy token | `no .beanstalk/checks.toml …: no checks run`, landed, 20 s |
| | `setup` (adds the checks above) | owner | `node --test --test-concurrency=1 'spec/**/*.spec.mjs' (image node, timeout 60 s, env KV_LIMIT)`, green 7.9 s; the spec asserts `KV_LIMIT` is `"3"` and sits where `node --test`'s defaults would not look, so the green proves both |
| | `off-by-one` | deploy token | red, `spec/kv.spec.mjs > keeps KV_LIMIT keys from the checks environment`, naming `setup` as the bean it collided with |
| | `schema` | deploy token | refused: `data/schema.json` is protected by the file |
| | `get-or` (a new spec) | deploy token | green under the repository's checks, landed |
| `rust-lib` (a Rust crate) | `crate` (`image = "rust"`, `command = ["cargo", "test"]`) | owner | red, three problems named: the image, `command` must start with `node`, and must run `node --test` |

## 6. Open items and decisions for Coop

1. **Other languages (the image question).** The runner image has only Node, and its check reads node's junit reporter, so a Rust or Python suite cannot run; the file says so precisely instead of pretending. Options, not built:
   - *A second runner image per toolchain* (`runner-rust`: Debian + rustup stable + cargo cache; `runner-python`: uv + CPython), each its own Container class and `max_instances`, chosen by `image`. The runner binary is the same; the check needs an **exit-code mode** (green = exit 0; failing tests from a JUnit file the command writes, when it can: `cargo nextest --profile ci`, `pytest --junitxml`), a runner API 5 change. Cost: images of 1 to 2 GB (Rust) built and pushed per deploy, cold starts, and dependencies fetched with no network at check time (vendored or snapshotted like `/opt/arena-deps`).
   - *Sandbox SDK* with a per-repository Dockerfile: most general, but builds per repository and a new trust boundary.
   - Recommendation: keep `node` until a real user needs another language; then add `runner-rust` behind `image = "rust"` with the exit-code mode, measured like fastify (`packages/runner/README.md`).
2. **Dependencies.** Nothing is installed at check time and suites run offline, so only zero-dependency projects (or the image's arena snapshots, deliberately not exposed in the file) work. A repository with `node_modules` needs an install step with a cache keyed by the lockfile; not designed yet.
3. **Existing repositories switch on deploy.** Live repositories made from the starter before today hold the old `[[check]]` draft: once the gateway is deployed, every bean there is red with the sentence that says how to rewrite it, until the owner pushes the new file with a personal token. Repositories without the file go from `node --test` to no checks. Alternative: pin engines opened before the deploy to `checks_source: suite` (one admin call each). Coop's call.
4. **Refused, not flagged.** A protected change by an agent is a red the author must drop. A "flag" variant (land it after a maintainer approves a decision card) waits for decision routing (Phase 3).
5. **Deploy tokens never change protected paths**, even ones a maintainer made for CI. If CI should, a per-token "may change checks" setting is the place.
6. **Validations read the checks of the tree they validate** (the sprout head), so a landed config change applies to the next validation at once.
7. Seen on staging, not this lane's: a repository creation whose web request was cut off left its name reserved ("You already have a repository named …") but unlisted; the registry should release or finish such rows.
