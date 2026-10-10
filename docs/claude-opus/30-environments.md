# 30 · Environments: staging and production from a fork

Written 2026-10-09 on a worktree branch from `prototype` at `8126876`. The owner's words: "ideally we need to find a way to fork our open source repo to setup a staging and production environment with configured wrangler config". This doc is the design; `scripts/environments.mjs`, `environments/example/` and the template `wrangler.jsonc` files are the implementation.

## 1. The problem

- Every `packages/*/wrangler.jsonc` in the public repo carried one account's D1 `database_id`s, the OAuth KV id and `*.workers.dev` URLs of that account's subdomain.
- Staging stacks were made by copying configs by hand (`-staging-ev`, `-staging-act1..3`, `-staging-org`, `-staging-sec`, `-staging-set`, ...), and some of those edits leaked into commits.
- `scripts/deploy-all.mjs` deployed four packages (gateway, web, mcp, site). It did not know the Actions executor, the SSH or OIDC Workers, or the gateway's `ACTIONS_SECRETS_KEY`, `OIDC_REQUEST_SECRET` and `OIDC_SIGNING_KEYS`.
- A self-hoster who forks had to hand-edit about ten configs, and then fight every upstream change to them.

## 2. Options

| Option | How | Verdict |
|---|---|---|
| **A. Fork with environment overlays** | The fork edits the tracked `wrangler.jsonc` files (or patches them) with its ids and URLs | Every upstream change to a config conflicts with the fork's edit. The ids stay mixed into code files. No help for provisioning. Rejected |
| **B. Wrangler `env.staging` / `env.production` blocks** | One `wrangler.jsonc` per package with an `env` block per environment | Bindings (`d1_databases`, `kv_namespaces`, `services`, `vars`, `queues`, `r2_buckets`, `artifacts`, `durable_objects`, `containers`) are not inherited by an env block, so each block repeats them all: about 80 lines times two environments times eight packages. If the blocks live upstream, the public repo carries account ids again; if they live in the fork, every upstream binding change conflicts. Worker names become `beanstalk-gateway-staging` automatically, which is nice, but `services[].service` still has to be repeated by hand. Rejected |
| **C. Templates plus a generator** | The tracked `wrangler.jsonc` is a template with base names and `local-*` placeholders. One fork-owned file per environment (`environments/<env>/env.jsonc`) holds the account, a name suffix, the workers.dev subdomain, custom URLs and overrides. A script writes `packages/<pkg>/wrangler.<env>.jsonc` (git-ignored) and deploys with `wrangler deploy --config` | **Chosen.** The rules that turn a template into an environment (suffix every Worker, service target, database, bucket, queue, namespace; fill ids; derive the origins) are written once, in code, instead of eight times per environment. Upstream changes to templates flow into every environment with no merge conflict, because the fork only owns files under `environments/` |
| **D. The `cf` CLI** | Cloudflare's new CLI manages environments natively | The owner decided to stay on Wrangler until after the deadline (2026-10-14). Revisit then: C's env file maps directly onto it |

Why C over B in one line: B makes the environment a property of each config file, so N packages × M environments copies; C makes it one file per environment and one rule set for all packages.

## 3. Layout

```
environments/
  example/env.jsonc                 public: documented template, placeholder account
  staging/env.jsonc                 fork-owned: account, suffix "-staging", subdomain, packages, overrides
  staging/resources.json            fork-owned, written by provision: D1 and KV ids, derived vars
  staging/secrets/<pkg>.vars        never committed anywhere: secret values (mode 0600)
  production/env.jsonc              fork-owned: suffix "" (today's names), packages live today
  production/resources.json
packages/<pkg>/wrangler.jsonc       public template
packages/<pkg>/wrangler.<env>.jsonc generated, git-ignored, beside the template so every relative
                                    path (main, migrations_dir, container image, assets) still resolves
scripts/environments.mjs            generate | provision | deploy | verify | smoke
```

The public repo's `.gitignore` ignores `environments/*` except `example/`, `environments/**/secrets/` and `packages/*/wrangler.*.jsonc`. A fork commits its `env.jsonc` and `resources.json` once with `git add -f`; after that git tracks them like any file. Nothing the fork owns is a path upstream writes, so `git merge upstream/prototype` never conflicts on configuration.

### 3.1 env.jsonc

```jsonc
{
  "account_id": "<32 hex>",               // every Wrangler call for this env targets it
  "prefix": "gitstalk",                  // optional: replaces the templates' gitstalk- (§13.1)
  "suffix": "-staging",                   // "" keeps the base (production) names
  "workers_dev_subdomain": "<subdomain>", // https://<worker>.<subdomain>.workers.dev
  "urls": { "web": "https://git.example.com" },   // optional custom origins
  "packages": ["actions-executor", "gateway", "web", "mcp", "ssh", "oidc", "site"],
  "overrides": { "<pkg>": { /* merged into that package's generated config */ } }
}
```

Overrides merge objects key by key; arrays of bindings, containers or rate limits merge by `binding`, `class_name`, `name` or `queue`; anything else replaces. Staging uses them for smaller container pools (with the matching `*_MAX_INSTANCES` vars), its own sign-in rate-limit namespace, and `SSH_TUNNEL=on` (no Spectrum app in front of a test stack). Routes and custom domains go in `overrides.<pkg>.routes`.

### 3.2 What the generator does to a template

| Template field | Generated |
|---|---|
| `name` | `name + suffix` (`beanstalk-gateway-staging`) |
| `account_id` | from env.jsonc (pins the account; the templates have none) |
| `services[].service` (`beanstalk-*`) | `+ suffix`, so staging only ever binds staging |
| `d1_databases[]` | `database_name + suffix`; `database_id` from resources.json |
| `kv_namespaces[].id` (`local-<title>`) | the id of KV namespace `<title><suffix>` from resources.json |
| `r2_buckets[].bucket_name`, `queues.*.queue`, `artifacts[].namespace`, `vars.ARTIFACTS_NAMESPACE` | `+ suffix` |
| `analytics_engine_datasets[].dataset` | `+ suffix` with `_` (`product_events_staging`), so staging never counts as product use |
| `PUBLIC_URL`, `WEB_URL`, `GIT_ORIGIN`, `MCP_URL` (gateway, web, mcp) | this environment's origins: `urls.<pkg>` or the workers.dev address |
| a var named in `resources.vars` (`SSH_HOST_KEY_FINGERPRINT`) | that value, in every package that declares the var |
| anything in `overrides.<pkg>` | merged last |

Missing ids fail generation with the names and "run provision". Production's suffix is empty, so production keeps every current name: nothing live moves.

## 4. Commands

```bash
pnpm env:provision <env>   # idempotent
pnpm env:deploy <env> [--only gateway,web] [--dry-run]
pnpm env:verify <env> --against <git ref>
pnpm env:smoke <env> [--repo owner/name]   # GITSTALK_TOKEN=<personal token> for whoami and clone
pnpm env:generate <env>    # only writes the configs (for wrangler tail, d1 execute, secret put -c ...)
pnpm env:secrets <env> [--to-github owner/repo]   # push Worker secrets, or store them for CI (§13.4)
```

**provision**: for every resource the environment's packages bind, by its suffixed name: D1 (`d1 list`, `d1 create`), KV (`kv namespace list/create`), R2 (`r2 bucket info/create`; `beanstalk-actions-logs*` gets its 30-day expiry rule on creation), queues (`queues info/create`). Artifacts namespaces have no create command; the first repository in one creates it, so provision creates and deletes a probe repository (`beanstalk-provision-probe`). A namespace that was deleted keeps its name blocked for a while (`Namespace is not active`, code 10200); provision reports that instead of failing, and running it again later finishes the job. The ids go into `resources.json`. Then secrets (§5), then the configs, then `wrangler d1 migrations apply <db> --remote` for each database once, from the first package that binds it (forge from the gateway's `migrations/`, identity from `packages/shared-identity/migrations`). Run it again after an upstream merge that adds a resource or a migration.

**deploy**: regenerates the configs, checks every selected package's required secrets (§5) and Docker if any package has containers, then deploys in the fixed order **actions-executor, gateway, mcp, web, ssh, oidc, swarm, site**: each Worker after the Workers it binds to (mcp before web because the web binds `MCP`). The executor and the gateway bind each other, and Cloudflare refuses a service binding to a Worker that does not exist (error 10143, seen on the first staging deploy), so on an environment's first deploy a Worker whose bound Worker is missing goes up once without that binding and again, whole, after the rest. Later deploys are one pass. The web app is built with `GITSTALK_WRANGLER_CONFIG=wrangler.<env>.jsonc vite build` (the Cloudflare Vite plugin's `configPath`) and deployed from `dist/server/wrangler.json`. The gateway and swarm builds keep their Docker wrappers (`WRANGLER_DOCKER_BIN`). Secrets in `environments/<env>/secrets/<pkg>.vars` go up with the version through a temporary JSON `--secrets-file` (mode 0600, deleted after); secrets already on the Worker are kept (`--secrets-file` is additive).

**verify**: generates every package's config for the environment and compares it, value by value, with `git show <ref>:packages/<pkg>/wrangler.jsonc` (ignoring the added `account_id`). It is how the migration was checked (§7) and how a fork can check that an upstream merge changed only what it meant to.

**smoke**: gateway `/healthz`; the web's `/signup` page; with `GITSTALK_TOKEN`, `GET /v1/whoami`; with `--repo`, `git clone` over HTTPS from the web origin (the token goes through `GIT_CONFIG_*` environment variables, never a command line).

`scripts/deploy-all.mjs` is gone; `pnpm env:deploy` replaces it.

## 5. Secrets

Required per package, checked before any deploy (a missing one fails the whole deploy before anything uploads; `--dry-run` only warns):

| Package | Required | Optional (uploaded when present in the env's secrets file) |
|---|---|---|
| actions-executor | `ADMIN_TOKEN` | `STANDALONE_SECRETS` |
| gateway | `ADMIN_TOKEN`, `RUN_TOKEN_SECRET`, `ACTIONS_SECRETS_KEY`, `OIDC_REQUEST_SECRET`, `OIDC_SIGNING_KEYS` | `OIDC_REQUEST_SECRET_PREVIOUS` |
| web | `DEMO_PASSWORD` | `TURNSTILE_SECRET_KEY` |
| mcp, site | none | |
| ssh | `SSH_HOST_KEY` | |
| oidc | `OIDC_SIGNING_KEYS`, `OIDC_REQUEST_SECRET` | `OIDC_REQUEST_SECRET_PREVIOUS` |
| swarm | `SWARM_ADMIN_TOKEN`, `SEAT_KEY` | `OPENAI_API_KEY`, `GATEWAY_ADMIN_TOKEN` |

The list is each template's `secrets.required` plus, for the gateway, the two OIDC secrets (the code treats them as optional so tests and bare local dev run without them; a deployment with Actions must have them). A secret counts as present if it is in the env's secrets file or already set on the Worker (`wrangler secret list`, names only).

`provision` generates a value only for a required secret that is in neither place: 32 random bytes (base64 for `ACTIONS_SECRETS_KEY` and `SEAT_KEY`, base64url otherwise), `oidc-keys.mjs new` for `OIDC_SIGNING_KEYS`, `ssh-keygen -t ed25519` for `SSH_HOST_KEY` (its fingerprint goes into `resources.json` as `SSH_HOST_KEY_FINGERPRINT` for the ssh and web vars). It never replaces a secret a Worker already has: rotating `ACTIONS_SECRETS_KEY` would make every stored Actions secret unreadable. The script prints secret names, never values. Production's secrets dir can stay empty: its Workers already hold every required secret, and deploy checks their names.

## 6. Local dev, types and tests

The templates stay valid local configs: ids are `local-beanstalk-forge`, `local-beanstalk-identity`, `local-beanstalk-oauth` (Miniflare keys local storage by them, and every package that binds the identity database uses the same placeholder, so local Workers share it as deployed ones do), and the origins point at local dev (`http://localhost:5173` web, `:8787` gateway, `:8788` mcp). `wrangler types` keeps reading `wrangler.jsonc`; the gateway's `worker-configuration.d.ts` changed only in its two URL literals. The vitest pools read the templates as before, so tests keep running on Miniflare. Local D1 data kept under the old real ids is not reused (Miniflare looks it up by id); `wrangler d1 migrations apply <db> --local` recreates it.

## 7. Migration of production

Production's values moved out of the tracked configs into `environments/production/env.jsonc` (account, empty suffix, subdomain, the six packages live today: actions-executor, gateway, web, mcp, swarm, site) and `resources.json` (the two D1 ids and the OAuth KV id). Both are git-ignored in the public checkout until the private fork exists (§8).

Checks:

- `pnpm env:verify production --against 8126876`: all eight packages identical to the last commit with the ids in it.
- `pnpm env:deploy production --dry-run` beside `wrangler deploy --dry-run` of `8126876`'s own configs: the same bindings, vars and sizes for every package (§9 has the result).

## 8. The private fork

GitHub does not let a fork of a public repository be private, so the "fork" is a private repository with the public one as `upstream`:

1. Create an empty private repository, e.g. `disturbing/beanstalk-deploy` (no README, no licence).
2. `git clone git@github.com:disturbing/beanstalk.git beanstalk-deploy && cd beanstalk-deploy`
   `git remote rename origin upstream && git remote add origin git@github.com:disturbing/beanstalk-deploy.git`
3. Copy `environments/production/{env.jsonc,resources.json}` and `environments/staging/{env.jsonc,resources.json}` from the checkout that ran provision, and the `secrets/` directories next to them (they stay ignored).
4. `git add -f environments/production/env.jsonc environments/production/resources.json environments/staging/env.jsonc environments/staging/resources.json && git commit -m "environments: staging and production" && git push -u origin prototype`
5. Sync: `git fetch upstream && git merge upstream/prototype`. The fork never edits upstream's files, so the merge is a fast-forward or a clean merge. After a merge that adds a resource or a migration, run `pnpm env:provision <env>` before `pnpm env:deploy <env>`.

The fork commits ids and URLs (not secrets). Secrets live in `environments/<env>/secrets/` on the deploying machine and on the Workers themselves; CI needs none of them (§10).

### 8.1 Soft fork: configuration in variables, nothing committed

Owner, 2026-10-09: "soft fork and setup override ENV VARS to override wrangler". A fork does not have to commit anything: when `environments/<env>/env.jsonc` is absent, `scripts/environments.mjs` reads the same content from variables, so a plain public fork (planned: the `gitstalk` GitHub org) holds its configuration in GitHub environment variables and stays byte-identical to upstream.

| Variable | Replaces | Notes |
|---|---|---|
| `GITSTALK_ENV_CONFIG` | `env.jsonc` | Full JSONC content; used only when the file is absent |
| `GITSTALK_ENV_RESOURCES` | `resources.json` | Ids, not secrets. Provision prints the value to set when it runs from variables |
| `GITSTALK_ACCOUNT_ID` | `account_id` | Applied on top of either source. `CLOUDFLARE_ACCOUNT_ID` is deliberately not read, so a shell default cannot redirect a deploy |
| `GITSTALK_SUFFIX`, `GITSTALK_WORKERS_DEV_SUBDOMAIN` | `suffix`, `workers_dev_subdomain` | Local use; CI does not pass the suffix (an unset GitHub variable is "", which means production names) |

Each variable is also read under its name from before the rename (2026-10-10, §12): `BEANSTALK_ENV_CONFIG` and the rest count when the `GITSTALK_*` one is unset or empty (an unset GitHub variable arrives empty), so a fork configured before the rename keeps deploying.

`.github/workflows/deploy.yml` passes the first three (both names) from the GitHub environment (`staging`, `production`), with `CLOUDFLARE_API_TOKEN` as a secret. Worker secrets stay on the Workers; `env:deploy` checks their names. Checked: `env:verify production --against 8126876` gives identical configs from the files and from the variables.

Fork setup: fork `disturbing/beanstalk` into the org, create GitHub environments `staging` and `production`, set `GITSTALK_ENV_CONFIG` and `GITSTALK_ENV_RESOURCES` from the local `environments/<env>/` files and the secret `CLOUDFLARE_API_TOKEN`, then sync with GitHub's "Sync fork" or `git merge upstream/prototype`; deploys follow.

## 9. Results (2026-10-09)

**Production unchanged.** `pnpm env:verify production --against 8126876`: actions-executor, gateway, web, mcp, ssh, oidc, swarm and site all identical. `pnpm env:deploy production --dry-run` passed for the six production packages, and its secrets check found every required secret already on the live Workers (gateway's five included). Each package was also dry-run with `8126876`'s own `wrangler.jsonc`: the same bindings table and the same upload size for actions-executor (7 bindings), gateway (28), mcp (14), swarm (10) and site; for web the same 25 bindings and the same uncompressed size, gzip 0.01 KiB apart, which is build noise (two builds of the *same* config differ in 79 bundle files), and the built `dist/server/wrangler.json` differs only in `configPath` and the added `account_id`. Production was not deployed.

**Staging, deployed with the tooling** (account `2c7358a6…`, the devaccounts workers.dev subdomain): Workers `beanstalk-actions-executor-staging`, `beanstalk-gateway-staging`, `beanstalk-mcp-staging`, `beanstalk-web-staging`, `beanstalk-ssh-staging`, `beanstalk-oidc-staging`, `beanstalk-site-staging`; D1 `beanstalk-forge-staging` (8 migrations) and `beanstalk-identity-staging` (5); KV `beanstalk-oauth-staging`; R2 `beanstalk-actions-logs-staging` (30-day expiry) and `beanstalk-media-staging`; queue `beanstalk-repo-events-staging`; Artifacts `beanstalk-race-stg` and `beanstalk-repos-stg` (an override in staging's env.jsonc, see below); analytics dataset `product_events_staging`. Containers: runner 4 × standard-4, executor 2 × standard-4, SSH 3 × lite. The first deploy hit error 10143 (the executor binds the not-yet-deployed gateway), which is what the bootstrap pass in §4 now handles; the second first-deploy went through it.

Smoke (`pnpm env:smoke staging --repo <handle>/<repo>`, after a passkey sign-up and a write token from Settings in a headless browser): gateway `/healthz` 200; `/signup` 200; `whoami` with the token answers `user <handle>`; `git clone` over HTTPS, from the web origin, of a new repository started as Empty (a README on `stalk`). Accounts `smoke-env` to `smoke-env5` are left on staging.

What went wrong on the way: a parallel teardown of the old `-staging-*` stacks also deleted this stack's Workers, D1, KV, R2, queue and Artifacts namespaces once (its match was wider than `-staging-<suffix>`). Provision and deploy rebuilt it in about ten minutes from `env.jsonc` alone, which is the point of the design; Artifacts still refused the deleted `beanstalk-{race,repos}-staging` names (`Namespace is not active`) 40 minutes later, so staging's env.jsonc overrides the gateway's two namespaces (and `ARTIFACTS_NAMESPACE`) to `-stg`. Once Artifacts frees the names the override can go; staging's repositories would stay behind in the `-stg` namespaces.

## 10. CI (superseded by §13.3)

`.github/workflows/deploy.yml` deploys `staging` on every push to `prototype` and `production` on a manual run (`workflow_dispatch` with `environment: production`, which can require a reviewer in GitHub's environment settings). It needs one repository secret, `CLOUDFLARE_API_TOKEN` (Workers Scripts, D1, KV, R2, Queues, Containers and Artifacts edit). Each job runs only when its `environments/<env>/env.jsonc` is committed, so in the public repo, where none is, it does nothing. It does not provision or upload secrets: the Workers already hold them and deploy checks their names. Later the same steps can run on Gitstalk Actions.

## 11. Open

- The hosted service's public addresses also appear outside configs: `packages/claude-plugin/.mcp.json`, the plugin's setup scripts, `packages/web/src/setup/*.ts` and `packages/site/public/site.js`. They name the hosted Gitstalk, as `gh` names github.com, so they stay; a self-hoster's plugin points at its own MCP URL by editing `.mcp.json`. A later change can read them from the web's `MCP_URL` var. The full list, for the move to gitstalk.io, is in §12.3 step 6.
- The gateway's types are strict (`"beanstalk-race"`, `"48"` as literal types); an environment's different values are still plain strings at run time. Switching the gateway to `--strict-vars false` like web and mcp would make the types honest.
- After the deadline: replace the Wrangler calls with the `cf` CLI's environments.

## 12. The rename to Gitstalk

Owner, 2026-10-10: "gitstalk is it please rename everything to that, but lets still keep the concept of growing beanstalks in the app". "Beanstalk" clashed with an existing git host (Wildbit's beanstalkapp.com) and beanstalk.ai was taken. Taglines: "Watch your work grow like a beanstalk" (primary) and "Agents grow together". Domains: **gitstalk.io** for production and **gitstalk.dev** for staging, both owned and already zones on Cloudflare.

The rename is two phases. Phase A (done, this change) renames everything a person or an agent reads and every code identifier, and moves no live address. Phase B (§12.3, a plan) moves Workers, resources and URLs to `gitstalk-*` and the domains.

### 12.1 Phase A: what changed

- **Product copy** in the web app, the marketing site and its docs, emails, the MCP server (`name: 'gitstalk'`, instructions, tool descriptions), passkey relying-party name, realms, log and redaction prefixes, the promo film's lockup.
- **The plugin** is `gitstalk@gitstalk` (`/gitstalk:setup`, `/gitstalk:bean-status`, skill and MCP server `gitstalk`, version 0.7.0). The marketplace is still this repository, `disturbing/beanstalk`; the one constant for it is `PLUGIN_MARKETPLACE` in `packages/shared-race/src/plugin.ts`, used by every install line the web app and the gateway print (the static pages spell it out, §12.3 step 7).
- **Code identifiers**: package scope `@gitstalk/*`, the root workspace `gitstalk`, the `gitstalk-packages` skill, `GITSTALK_EVENTS`/`GitstalkEvent`, the MCP entrypoint class `GitstalkMcp` (a default `WorkerEntrypoint`, not a Durable Object), the job tool `gitstalk-deps` at `/opt/gitstalk/bin`. No Rust crate name contained the old name.
- **Git identities of new commits**: seed commits `Gitstalk <seed@gitstalk.invalid>`, engine status tags `gitstalk <engine@gitstalk.invalid>`, the runner's squashes `gitstalk-runner <runner@gitstalk.invalid>` (the automation editor still treats `beanstalk-runner` in older history as the runner), automation bots `<id>@automations.gitstalk`. The default actor of an automation run without a person is `gitstalk` (reserved as a handle, as `beanstalk` stays).

### 12.2 Phase A: compatibility, and what kept its name

| What | Now | Still read | Rule |
|---|---|---|---|
| Repository config directory | `.gitstalk/` (`checks.toml`, `backlog.md`, `automations/`) | `.beanstalk/` | `packages/shared-race/src/config-dir.ts`: a `.gitstalk/` file wins over its `.beanstalk/` namesake (both read at once, no extra round trip). Both `checks.toml` paths are always protected. Automations are listed from both folders; a `.gitstalk/automations/<name>` hides `.beanstalk/automations/<name>`. The builder saves new automations under `.gitstalk/automations/` and edits a file where it is. Messages name the file actually read |
| Repository and org variables | `GITSTALK_DEPS_CACHE`, `GITSTALK_DEPS_SNAPSHOT_MAX`, `GITSTALK_NPM_AUDIT` | `BEANSTALK_*` | `productVariable` in `shared-race/src/actions.ts` (and the runner's `deps_cache_budget`): the `GITSTALK_` name wins. Saving Settings → Actions writes the new name and deletes the old one |
| Environment tooling | `GITSTALK_ENV_CONFIG`, `_ENV_RESOURCES`, `_ACCOUNT_ID`, `_SUFFIX`, `_WORKERS_DEV_SUBDOMAIN`, `GITSTALK_TOKEN` (smoke) | `BEANSTALK_*` | `setting()` in `scripts/environments.mjs`; empty counts as unset. `deploy.yml` passes both names |
| Automation runs | `GITSTALK_MEMORY`, `_EVENT`, `_ACTOR`, `_AUTOMATION`, `_MEMORY_REF`, `_LINE`, `_REPOSITORY_ID`; payload key `gitstalk` | `BEANSTALK_*` set too; payload key `beanstalk` too | Every run sets both names (`withLegacyNames`), so scripts written before the rename run unchanged |
| Dependency cache action | `uses: gitstalk/deps-cache@v1` | `beanstalk/deps-cache@v1` | Both match in the runner's planner. The snapshot key format stays `beanstalk-deps/1`, so no cache is invalidated |
| Setup scripts | `GITSTALK_WEB`, `_CREDENTIAL_HELPER`, `_NO_BROWSER`, `~/.config/gitstalk`, `~/.ssh/gitstalk_ed25519` | `BEANSTALK_*`, `~/.config/beanstalk`, the `# beanstalk:` marker in `~/.ssh/config` | A machine set up before keeps its remembered key; an existing `beanstalk_ed25519` key is offered like any key file |
| Plugin | `gitstalk@gitstalk` | (no alias) | An install of `beanstalk@beanstalk` keeps working against the same URLs; to update, uninstall it and install `gitstalk@gitstalk` (the agents docs say so) |

Kept on purpose, because changing them would break something live or persisted:

- **Deployed Worker names** (`beanstalk-*`, `-staging`), **Durable Object classes**, **D1, KV, R2, queue, Artifacts and analytics names**, and every **`*.workers.dev` URL**: installed plugins, MCP OAuth grants, passkeys and git remotes point at them. `pnpm env:verify` and a generated-config comparison against `873e833` show no change.
- **Token prefixes** (`bsu_`, `bss_`, `bsd_`, `bsj_`, `bst1`, `bsoidc.`), **cookie names**, the session HMAC context, the localStorage keys (`beanstalk-theme`, `beanstalk.connect-tab`), the product-events id salt, the secrets' encryption context and the MCP consent KV prefix: opaque, or changing them signs people out, resets settings or makes stored secrets unreadable.
- **Persisted engine names**: the policy id `beanstalk-v2` (and `policy: beanstalk` in run configs, summaries and squash messages), the automation trigger kind `beanstalk` in the workflow index, `refs/beanstalk/*` (the runner's candidate and fetch refs in every live repository), the OIDC claim `runner_environment: beanstalk-hosted` (cloud trust policies match on it), internal wire headers (`x-beanstalk-*`).
- **The metaphor**: beans, sprout, stalk, `bean/<name>`, `refs/beans/*`, `refs/wait/*`, the push options and the `remote: beanstalk:` verdict prefix (owner: keep "the remote: verdict wording"), "The beanstalk" panel and "Ask the beanstalk anything", the plant glyphs, the `beanstalk-shop` demo repository.
- **History**: the research corpus, the Codex docs, `claude-0*`/`claude-1*`, `claude-opus/01`–`15`, `exp/`, `research/` and the `promo/` and `prototypes/` sources keep the name as written (`docs/claude-README.md` notes the rename). The repository folder and the GitHub repository are unchanged.

### 12.3 Phase B: moving Workers, resources and URLs to gitstalk-* (plan; steps 1-4 done 2026-10-10, §13)

Production will be **rebuilt fresh in the Cloudflare account that owns the gitstalk.io and gitstalk.dev zones** (owner, 2026-10-10; another agent does it after this change lands). The old account's `beanstalk-*` stack keeps serving until step 8. Order matters: a step never points a client at something that does not answer yet.

1. **Hostnames.** Recommended layout (staging mirrors it on gitstalk.dev):

   | Host | Serves | Why |
   |---|---|---|
   | `gitstalk.io` | The web app, and git over HTTPS at `https://gitstalk.io/<owner>/<repo>.git` | GitHub's shape: the repository page and its clone URL are the same address. The web Worker already serves git on its own origin (`GIT_ORIGIN` = the web URL), so this costs nothing |
   | `gitstalk.io/` signed out, `/docs/*`, `/about.html` and the other site pages | The marketing site | Recommended: the web Worker forwards those paths to the site Worker over a service binding (one more binding and a path list beside `STATIC_PATHS`; signed-out `/` serves the landing instead of the benchmark page). The alternative, Workers routes for the site's paths on the same hostname as the web's custom domain, needs every site file listed (routes only take a trailing wildcard) and a check of how routes and a custom domain on one hostname are ordered; not recommended |
   | `mcp.gitstalk.io` | MCP and its OAuth endpoints | An OAuth issuer of its own, stable across web changes |
   | `api.gitstalk.io` | The gateway's public routes (`/v1`, `/_actions/*`, the Actions OIDC issuer) | Today `PUBLIC_URL` of the gateway; jobs and cloud trust policies reach it |
   | `ssh.gitstalk.io` | Git over SSH through Spectrum (`ssh://git@ssh.gitstalk.io/<owner>/<repo>.git`) | `git@gitstalk.io:owner/repo.git` at the apex would need a Spectrum app on the same hostname as the proxied web app; check whether Spectrum and HTTP can share it before promising the shorter form. `SSH_TUNNEL` stays off in production |
   | (later) mail | Magic-link and notification sender, e.g. `signin@gitstalk.io` | Email Sending needs the domain onboarded (`19-accounts-and-auth.md`) |

   The zones are on Cloudflare already, so Workers custom domains work; no nameserver change is needed.
2. **Templates to `gitstalk-*`.** One commit renames the base names in every `packages/*/wrangler.jsonc` (Worker `name`, `services[].service`, D1 `database_name` and the `local-*` ids, KV titles, R2 buckets, queues, Artifacts namespaces and `ARTIFACTS_NAMESPACE`, the analytics dataset), and the code that names them: `scripts/environments.mjs` (`R2_EXPIRE_DAYS`, `PROBE_REPO`, the `beanstalk-` prefix test for services), `reserved-handles.ts` (reserve the new namespaces, keep the old), the vitest configs and tests that use `/git/beanstalk-race/` paths, the gateway's literal var types (`wrangler types`). Durable Object classes keep their names (a fresh account has no migrations to carry, but nothing gains from renaming them). With this commit `env:verify` against the old ref shows only the intended name changes.
3. **Staging on gitstalk.dev.** In the new account: `environments/staging/env.jsonc` with `account_id`, `suffix: "-staging"`, `urls` (`web: https://gitstalk.dev`, `mcp: https://mcp.gitstalk.dev`, `gateway: https://api.gitstalk.dev`, `site` served through the web) and `overrides.<pkg>.routes` with `custom_domain: true` per host; `pnpm env:provision staging`, `pnpm env:deploy staging`, `pnpm env:smoke staging --repo …`, plus a passkey sign-up, a push, an Actions run with OIDC and an MCP sign-in from Claude Code against `mcp.gitstalk.dev`.
4. **Production on gitstalk.io**, the same way with `suffix: ""`. Decide first whether to carry data over or start fresh: D1 (`wrangler d1 export` / `execute --file`), Artifacts repositories (re-import each with its git URL), R2 (logs can be left behind), KV OAuth grants (not portable: clients sign in again). Secrets are generated anew by provision except `ACTIONS_SECRETS_KEY`, which must be copied if stored Actions secrets move with the data.
5. **Identity continuity.** Passkeys are bound to their relying-party id, the old `beanstalk-web.<subdomain>.workers.dev` host: they do not work on gitstalk.io. People sign in by email magic link (or register a new passkey) on the new host; say so on the old sign-in page. Session cookies do not move either. MCP OAuth: the issuer becomes `https://mcp.gitstalk.io`; every client runs `claude mcp login plugin:gitstalk:gitstalk` once. Actions OIDC: the issuer becomes `https://api.gitstalk.io/_actions/oidc`; anyone trusting the old issuer in AWS, GCP or Azure adds the new one before switching (publish the date; keep the old issuer answering until step 8). `runner_environment` stays `beanstalk-hosted` unless the owner decides to change the claim with that notice.
6. **URLs in code and the plugin**, in one commit after step 4 is live: `packages/claude-plugin/.mcp.json` and `PLUGIN_MCP_URL` (`packages/web/src/setup/agent-installs.ts`, a test keeps them equal), `PUBLIC_WEB` in `packages/web/src/setup/setup-scripts.ts` and the default `WEB` in both setup scripts, `MCP_URL` in `packages/site/public/site.js`, the sign-up links on `packages/site/public/index.html`, `environments/example/env.jsonc`, the README's examples. Bump the plugin's version so installs update; old installs keep the old URL until they do, which step 7 handles.
7. **The workers.dev aliases.** Keep the old account's Workers answering for a published window: `beanstalk-web.*` and `beanstalk-site.*` redirect (301) to the same path on gitstalk.io (git's smart HTTP follows the redirect on its first request), `beanstalk-mcp.*` answers MCP with an error that names the new URL and the reinstall line, `beanstalk-gateway.*` keeps the old OIDC issuer and job routes until the last old run ends. Disable `workers_dev` on the new account's Workers once the custom domains work, so there is one address per thing.
8. **Retire the old stack** after the window: delete the old Workers, then the resources, from the old account. Nothing in the new account depends on them.
9. **The GitHub repository** moves to the `gitstalk` org (`gitstalk/gitstalk`): GitHub redirects the old URL for git and the web, but plugin marketplaces store the path, so change `PLUGIN_MARKETPLACE` in `packages/shared-race/src/plugin.ts` and `PLUGIN_REPO` in `packages/site/public/site.js`, the install lines spelled out in `packages/site/public` (index, agent, docs), `packages/claude-plugin/README.md`, the root README and the `https://github.com/disturbing/beanstalk` links (licence, changelog, issues). An existing install keeps working through the redirect until it is reinstalled. The soft-fork plan of §8.1 then applies to the org's own deployment repository.

### 12.4 Phase A verification (2026-10-10)

See §12.5 for the staging deploy; the checks: `pnpm check` exits 0 (TypeScript and Rust), `sh packages/claude-plugin/test/setup-tests.sh` passes (28 checks, one for the `BEANSTALK_WEB` fallback), `node scripts/check-docs.mjs` passes, and `pnpm env:verify production --against 873e833` prints exactly what it prints at `873e833` itself (its 13 lines are the environment's own URLs and ids against the template's local placeholders), while every package's generated production and staging config is value-for-value identical to the one `873e833` generates.

### 12.5 Staging (2026-10-10)

`pnpm env:deploy staging` deployed all seven staging Workers under their old names (`beanstalk-*-staging`, the same configs as before the rename); `pnpm env:smoke staging`: gateway `/healthz` and web `/signup` ok. A headless Chrome with a virtual passkey then checked the rename end to end: the staging landing's title is "Gitstalk: watch your work grow like a beanstalk" with the gitstalk wordmark; `/signup` is titled "Sign up · gitstalk" and has no "Beanstalk" left; a new account (`gs-smoke-*`) made an Empty repository and a write token, cloned it over HTTPS, and pushed one bean adding `.gitstalk/automations/new-folder.yml` and `.beanstalk/automations/old-folder.yml`, which landed with `-o wait`; the repository's Automations tab listed both and named `.gitstalk/automations`; MCP `initialize` with the token answered `serverInfo.name: "gitstalk"`. Production was not deployed.

## 13. Phase B built: gitstalk.io (production) and gitstalk.dev (staging), 2026-10-10

Owner, 2026-10-10: gitstalk.io is production, gitstalk.dev staging, both zones in the account that owns them (not the devaccounts one); start fresh (no data carried over); `gitstalk-*` names from day one; "the config needs to be automated still so a fork makes most sense with secrets in the private fork and updates from the original fork on github, so we should configure a github actions to do the above". The old account's `beanstalk-*` stack stays up, untouched, until the cut-over (§12.3 steps 7 and 8).

### 13.1 Names: templates are gitstalk-\*, an environment's prefix can keep beanstalk-\*

- Every template's Worker and resource base name is `gitstalk-*` (Worker `name`, `services[].service`, D1 `database_name` and the `local-gitstalk-*` placeholder ids, the KV title, R2 buckets, the queue, Artifacts namespaces and `ARTIFACTS_NAMESPACE`); tests and vitest configs follow; `wrangler types` regenerated. `reserved-handles.ts` reserves `gitstalk-race` and `gitstalk-repos` beside the old two.
- `env.jsonc` takes `"prefix"` (default `"gitstalk"`): it replaces the templates' `gitstalk-` in every name, so `gitstalk-gateway` becomes `<prefix>-gateway<suffix>`. `R2_EXPIRE_DAYS` and the Artifacts probe repository use the new base names.
- The old stack's env files are now `environments/legacy/` (was `production`: devaccounts account, suffix `""`) and `environments/legacy-staging/` (was `staging`), both with `"prefix": "beanstalk"`. They live in the private deploy repo and on the owner's machine; CI never deploys them (no GitHub environment has their name). While the old stack lives, deploy it with `pnpm env:deploy legacy` from a checkout that has its secrets.
- Proof that the old stack is unchanged: the configs that `61c3420`'s own script and templates generate for production and staging were compared, value by value, with what this change generates for `legacy` and `legacy-staging`. Every package is identical except one field: the web's `main` is `./worker/index.ts` instead of `vinext/server/fetch-handler` (§13.2; without a SITE binding the new entry hands every request to the same vinext App Router handler). No name, id, binding or var differs. `env:verify legacy --against 61c3420` prints the same environment-versus-template lines it printed at `61c3420`, plus that `main` line.
- `ORDER` puts the site before the web (the web binds it): actions-executor, gateway, mcp, site, web, ssh, oidc, swarm.

### 13.2 Hostnames: Workers Custom Domains from `urls`

| Host (staging) | Worker | Serves |
|---|---|---|
| `gitstalk.io` (`gitstalk.dev`) | `gitstalk-web` | The app, and git over HTTPS: `https://gitstalk.io/<owner>/<repo>.git`. The marketing site through the web (below) |
| `mcp.gitstalk.io` (`mcp.gitstalk.dev`) | `gitstalk-mcp` | MCP at `/mcp`, its OAuth issuer and metadata |
| `api.gitstalk.io` (`api.gitstalk.dev`) | `gitstalk-gateway` | `/v1`, `/_actions/*` for jobs, the Actions OIDC issuer `https://api.gitstalk.io/_actions/oidc`, `/healthz` |
| `ssh.gitstalk.io` (`ssh.gitstalk.dev`) | `gitstalk-ssh` | `/host-key` and the `/tunnel` WebSocket (`SSH_TUNNEL=on`); no port 22 |
| (none) | `gitstalk-site` | Reached through the web's SITE binding (and its workers.dev address) |
| (none) | `gitstalk-actions-executor` | Service binding from the gateway only |

- **Generation.** For each package whose `urls.<pkg>` is an https origin outside `workers.dev`, the generator sets `routes: [{ pattern: <host>, custom_domain: true }]`; Wrangler attaches the domain on deploy (Cloudflare makes the DNS record and the certificate). A `urls.<pkg>` with a path fails generation. Every URL var follows `urls`: gateway `PUBLIC_URL` and `WEB_URL`; mcp `PUBLIC_URL` (its OAuth issuer), `WEB_URL`, `GIT_ORIGIN`; web `GIT_ORIGIN`, `MCP_URL` (`https://mcp.gitstalk.io/mcp`), `DOCS_URL` (`https://gitstalk.io/docs/`).
- **The site at the apex.** When `urls.site` equals `urls.web`, the generator gives the web a `SITE` service binding to the site Worker, and the site no domain. `packages/web/worker/index.ts` (the web's new entry; vinext supports a custom `worker/index.ts`) hands to SITE, for GET and HEAD only: `/docs` and below; root files with an extension other than `setup.sh`, `setup.ps1` and `favicon.ico` (`/site.css`, `/about.html`, `/favicon.svg`; handles cannot contain a dot); the bare `/about`, `/privacy` and `/terms` (reserved handles); and `/` when the request has no session cookie (the landing; signed in, `/` stays Home). The web's own static assets are served before the Worker runs, so they never reach this check. Chosen over Workers routes for the site's paths because a route cannot see the cookie that decides `/`, and a Custom Domain takes precedence over routes on its hostname anyway.
- **OIDC issuer.** The gateway's issuer is `<PUBLIC_URL>/_actions/oidc` when `OIDC_ISSUER_URL` is unset, so `https://api.gitstalk.io/_actions/oidc` follows from `urls.gateway` with no extra var; checked live (discovery's `issuer`). The standalone `oidc` Worker is not deployed in either environment.
- **Passkeys and cookies.** The relying-party id is the request's hostname (`siteOrigin` in `shared-identity`), and only the web runs ceremonies, so on production it is exactly `gitstalk.io`; the MCP consent screen sends people to the web's `/connect`, so no other host needs passkeys. A passkey for `gitstalk.io` would also be usable from its subdomains, but none asks for one. Session cookies are `__Host-` (host-only, no `Domain`), so no cookie domain is needed or possible.
- **SSH.** Both zones are on the Free plan; Spectrum for SSH needs Pro or higher. The SSH Worker runs with `SSH_TUNNEL=on`, the web's `SSH_HOST` stays empty, and `/gitstalk:setup` uses HTTPS and a token. To open port 22: upgrade gitstalk.io to Pro, add a Spectrum SSH application on `ssh.gitstalk.io` pointing at the `gitstalk-ssh` Worker, set the web's `SSH_HOST` and turn the tunnel off (overrides in env.jsonc).
- **workers.dev** stays on for every Worker (handy for checks); turn it off with `overrides.<pkg>.workers_dev: false` once the custom domains have run for a while (§12.3 step 7).

### 13.3 Secrets

- `pnpm env:secrets <env>` pushes every secret the environment holds to its Worker with `wrangler secret bulk --name <worker>`, the values on stdin (never on a command line, never printed). A Worker not deployed yet gets them with its first deploy instead (deploy already uploads them with the version through a temporary `--secrets-file`). It ends by naming required secrets still missing.
- Sources, merged per package: `environments/<env>/secrets/<pkg>.vars`, then `GITSTALK_SECRETS_JSON` (`{"<pkg>": {"NAME": "value"}}`), which wins. `readSecrets` reads both, so provision's "generate only what is missing", deploy's secret check and its `--secrets-file` all see CI's secrets. A malformed `GITSTALK_SECRETS_JSON` fails with a message that never echoes it.
- `pnpm env:secrets <env> --to-github <owner/repo>` (the owner's machine only; refused when `CI` is set) builds that JSON from the local files and runs `gh secret set GITSTALK_SECRETS_JSON --env <env> --repo <owner/repo>` with it on stdin.
- The first provision generates the secrets (as §5), then prints the `--to-github` line and a reminder to back up `secrets/`: `ACTIONS_SECRETS_KEY` cannot be read back from a Worker. In CI, a newly required secret is generated, deployed and kept on the Worker, with a warning that it is not in `GITSTALK_SECRETS_JSON`.
- AI Gateway: provision checks the gateways named by `AUTOMATIONS_AI_GATEWAY` and `JEV_GATEWAY` (`default`) and creates them when `CLOUDFLARE_API_TOKEN` can (the Wrangler OAuth login cannot: the AI Gateway API answers code 10000). In the new account the `default` gateway worked without being created by hand: an agent automation's model calls went through it on staging (§13.6).

### 13.4 The private deploy repository and CI

**Repository**: `https://github.com/disturbing/gitstalk-deploy` (private; the `gitstalk` org did not exist, so it is under the owner's account and can be transferred later). Its `main` is the public `prototype` history plus commits of its own: `environments/{production,staging,legacy,legacy-staging}/{env.jsonc,resources.json}` and `.github/workflows/sync-upstream.yml`. Nothing secret. Until this change is merged upstream, `main` carries this branch's commits too. A local clone: `git clone https://github.com/disturbing/gitstalk-deploy && git remote add upstream https://github.com/disturbing/beanstalk.git`.

**Workflows**

- `deploy.yml` (from the public repo, so upstream improves it): staging on every push to `main` (or `prototype`, for a soft fork); production on `workflow_dispatch` with `environment: production`, or on a pushed `production-*` tag, through the GitHub environment `production`. Steps: checkout (full history, for the runner image's tag), free disk space, pnpm, Node 24, `pnpm install --frozen-lockfile`, `pnpm check`, a clear failure if `CLOUDFLARE_API_TOKEN` is absent, then `env:provision`, `env:secrets`, `env:deploy`, `env:smoke`. One run per environment at a time, never cancelled. The Rust half of `pnpm check` runs on `RUSTUP_TOOLCHAIN: 1.96.0`, the `RUST_VERSION` of every container Dockerfile: the first CI run failed on GitHub's stable 1.99, whose new clippy lints (`assert_is_empty`, unused `async` in trait impls) fail `-D warnings` on code that passes on 1.96; bump both together. Wrangler builds the three container images (runner, actions-runner, ssh-server) with the runner's Docker on `ubuntu-latest`, which is amd64, the platform Cloudflare Containers run; each Dockerfile's build context is the repo root (`image_build_context: "../.."`), which the checkout provides.
- `sync-upstream.yml` (deploy repo only): hourly at :17 and on demand. Fetches upstream `prototype`; if `main` already contains it, stops; otherwise merges (a fast-forward when possible), pushes `main`, and dispatches `deploy.yml` for staging (a push made with `GITHUB_TOKEN` starts no workflow; a dispatch does). On a merge conflict it pushes the upstream commit to `sync/upstream-<sha>` and opens a pull request. `GITHUB_TOKEN` may not push commits that change `.github/workflows/`; when upstream does, the push fails and the job opens an issue, unless the repository secret `SYNC_TOKEN` exists (a fine-grained token for this repository: Contents, Pull requests and Workflows read/write), in which case the push itself starts the deploy.

**GitHub environments** (set with `gh`): `staging` and `production`, each with the secret `GITSTALK_SECRETS_JSON` (8 secrets: actions-executor, gateway, web, ssh). `production` accepts deployments only from branch `main` and tags `production-*`. Required reviewers on a private repository need a paid GitHub plan (the API answered 422), so production is gated by the manual trigger and the branch policy until the owner upgrades. **Missing: `CLOUDFLARE_API_TOKEN`** in both environments; the owner creates it. Until then a run tests the code (`pnpm check`) and stops with that message.

**Cloudflare API token** (dashboard → My Profile → API Tokens → Create Custom Token, or an account-owned token), one for both environments or one each:

| Scope | Permission | Access |
|---|---|---|
| Account (the gitstalk zones' account) | Workers Scripts | Edit |
| Account | D1 | Edit |
| Account | Workers KV Storage | Edit |
| Account | Workers R2 Storage | Edit |
| Account | Queues | Edit |
| Account | Containers | Edit |
| Account | Artifacts | Edit |
| Account | AI Gateway | Edit |
| Account | Workers AI | Read |
| Account | Account Settings | Read |
| Zone: gitstalk.io and gitstalk.dev | Workers Routes | Edit |
| Zone: gitstalk.io and gitstalk.dev | DNS | Edit |
| Zone: gitstalk.io and gitstalk.dev | SSL and Certificates | Edit |
| Zone: gitstalk.io and gitstalk.dev | Zone | Read |

Store it with `gh secret set CLOUDFLARE_API_TOKEN --env staging --repo disturbing/gitstalk-deploy` (then `--env production`), pasting the value at the prompt.

### 13.5 Runbook

- **Routine**: merge to the public `prototype`; within the hour sync-upstream merges it into the deploy repo's `main` and staging deploys. Production: Actions → deploy → Run workflow → `production`, or push a `production-<date>` tag in the deploy repo.
- **From the owner's machine** (a clone of the deploy repo, `environments/<env>/secrets/` restored from the backup): `pnpm install`, `wrangler login`, then `pnpm env:provision <env>`, `pnpm env:secrets <env>`, `pnpm env:deploy <env>`, `pnpm env:smoke <env>`. The first provision's secrets are backed up in `~/Workspace/gitstalk-secrets-backup/{staging,production}/` (owner-only permissions) and stored in the GitHub environments.
- **Rotate a secret**: edit `secrets/<pkg>.vars` (never `ACTIONS_SECRETS_KEY` while stored Actions secrets matter), `pnpm env:secrets <env>`, then `pnpm env:secrets <env> --to-github disturbing/gitstalk-deploy`.
- **A new resource or migration upstream**: nothing to do; CI's provision creates it and migrates D1 before deploying. Provision rewrites `resources.json` on the runner only; when a new id appears, commit the file from a local provision so local runs match.
- **If the public merge of this change is a squash or rebase**, the next sync conflicts on files both sides changed and opens a pull request; resolve it by taking upstream's side for everything outside `environments/` and `sync-upstream.yml`.

### 13.6 Results (2026-10-10)

The account answered every product with no billing or plan error: Workers, D1, KV, R2, Queues, Containers (three applications per environment), Artifacts namespaces and Custom Domains, all from this machine with the Wrangler OAuth login. Both zones are on the Free plan.

| Check | Staging (gitstalk.dev) | Production (gitstalk.io) |
|---|---|---|
| `env:provision` | 2 D1 (10 + 6 migrations), KV, 3 R2 (logs with 30-day expiry), queue, 2 Artifacts namespaces | same |
| `env:deploy` | 6 Workers, first deploy through the bootstrap pass, 4 custom domains | same |
| `env:smoke` (gateway, sign-up page, MCP metadata, docs) | ok | ok; with a token also `whoami` and `git clone https://gitstalk.io/<handle>/smoke-repo.git` |
| Passkey sign-up (headless Chrome, virtual authenticator), Empty repository, write token | ok | ok |
| Clone from the web host, push `bean/smoke` with `-o wait` | landed and validated onto the stalk | landed (pre-land check 6.5 s) and validated |
| `.github/workflows/ci.yml` | run by hand: succeeded (14 s); a "stalk moved" run too | run by hand: succeeded (18 s); a "stalk moved" run too |
| `.gitstalk/automations/hello.yml` (`harness: shell`) run by hand | succeeded | succeeded |
| Agent automation (`@cf/moonshotai/kimi-k2.7-code` through AI Gateway `default`) | succeeded: 3 model calls, $0.0045 | not run |
| MCP `initialize` with the token at `mcp.<host>/mcp` | `serverInfo.name: gitstalk` | same |
| Site at the apex | landing at `/` signed out, `/docs/`, `/about`, `/site.css` | same |
| Throwaway accounts deleted | yes (`gs-smoke-*`; two half-made ones from a script error removed with SQL, they had no repositories) | yes; 0 users left |

Not done: an MCP OAuth sign-in from Claude Code (`claude mcp login`) against `mcp.gitstalk.dev` needs a person at a browser; the OAuth metadata and a token-authenticated `initialize` were checked instead. No Actions job asked for an OIDC token; the issuer's discovery document answers on `api.<host>`.

CI in the deploy repository: with the Rust pin, `deploy` on a push to `main` ran `pnpm check` green on `ubuntu-latest` (about 12 minutes) and stopped, as designed, at the missing `CLOUDFLARE_API_TOKEN`; `sync-upstream` run by hand found `main` already containing upstream `prototype` and exited. Provision, deploy and smoke from CI wait for the token.
