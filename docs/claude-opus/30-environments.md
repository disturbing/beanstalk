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
pnpm env:smoke <env> [--repo owner/name]   # BEANSTALK_TOKEN=<personal token> for whoami and clone
pnpm env:generate <env>    # only writes the configs (for wrangler tail, d1 execute, secret put -c ...)
```

**provision**: for every resource the environment's packages bind, by its suffixed name: D1 (`d1 list`, `d1 create`), KV (`kv namespace list/create`), R2 (`r2 bucket info/create`; `beanstalk-actions-logs*` gets its 30-day expiry rule on creation), queues (`queues info/create`). Artifacts namespaces have no create command; the first repository in one creates it, so provision creates and deletes a probe repository (`beanstalk-provision-probe`). A namespace that was deleted keeps its name blocked for a while (`Namespace is not active`, code 10200); provision reports that instead of failing, and running it again later finishes the job. The ids go into `resources.json`. Then secrets (§5), then the configs, then `wrangler d1 migrations apply <db> --remote` for each database once, from the first package that binds it (forge from the gateway's `migrations/`, identity from `packages/shared-identity/migrations`). Run it again after an upstream merge that adds a resource or a migration.

**deploy**: regenerates the configs, checks every selected package's required secrets (§5) and Docker if any package has containers, then deploys in the fixed order **actions-executor, gateway, mcp, web, ssh, oidc, swarm, site**: each Worker after the Workers it binds to (mcp before web because the web binds `MCP`). The executor and the gateway bind each other, and Cloudflare refuses a service binding to a Worker that does not exist (error 10143, seen on the first staging deploy), so on an environment's first deploy a Worker whose bound Worker is missing goes up once without that binding and again, whole, after the rest. Later deploys are one pass. The web app is built with `BEANSTALK_WRANGLER_CONFIG=wrangler.<env>.jsonc vite build` (the Cloudflare Vite plugin's `configPath`) and deployed from `dist/server/wrangler.json`. The gateway and swarm builds keep their Docker wrappers (`WRANGLER_DOCKER_BIN`). Secrets in `environments/<env>/secrets/<pkg>.vars` go up with the version through a temporary JSON `--secrets-file` (mode 0600, deleted after); secrets already on the Worker are kept (`--secrets-file` is additive).

**verify**: generates every package's config for the environment and compares it, value by value, with `git show <ref>:packages/<pkg>/wrangler.jsonc` (ignoring the added `account_id`). It is how the migration was checked (§7) and how a fork can check that an upstream merge changed only what it meant to.

**smoke**: gateway `/healthz`; the web's `/signup` page; with `BEANSTALK_TOKEN`, `GET /v1/whoami`; with `--repo`, `git clone` over HTTPS from the web origin (the token goes through `GIT_CONFIG_*` environment variables, never a command line).

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
| `BEANSTALK_ENV_CONFIG` | `env.jsonc` | Full JSONC content; used only when the file is absent |
| `BEANSTALK_ENV_RESOURCES` | `resources.json` | Ids, not secrets. Provision prints the value to set when it runs from variables |
| `BEANSTALK_ACCOUNT_ID` | `account_id` | Applied on top of either source. `CLOUDFLARE_ACCOUNT_ID` is deliberately not read, so a shell default cannot redirect a deploy |
| `BEANSTALK_SUFFIX`, `BEANSTALK_WORKERS_DEV_SUBDOMAIN` | `suffix`, `workers_dev_subdomain` | Local use; CI does not pass the suffix (an unset GitHub variable is "", which means production names) |

`.github/workflows/deploy.yml` passes the first three from the GitHub environment (`staging`, `production`), with `CLOUDFLARE_API_TOKEN` as a secret. Worker secrets stay on the Workers; `env:deploy` checks their names. Checked: `env:verify production --against 8126876` gives identical configs from the files and from the variables.

Fork setup: fork `disturbing/beanstalk` into the org, create GitHub environments `staging` and `production`, set `BEANSTALK_ENV_CONFIG` and `BEANSTALK_ENV_RESOURCES` from the local `environments/<env>/` files and the secret `CLOUDFLARE_API_TOKEN`, then sync with GitHub's "Sync fork" or `git merge upstream/prototype`; deploys follow.

## 9. Results (2026-10-09)

**Production unchanged.** `pnpm env:verify production --against 8126876`: actions-executor, gateway, web, mcp, ssh, oidc, swarm and site all identical. `pnpm env:deploy production --dry-run` passed for the six production packages, and its secrets check found every required secret already on the live Workers (gateway's five included). Each package was also dry-run with `8126876`'s own `wrangler.jsonc`: the same bindings table and the same upload size for actions-executor (7 bindings), gateway (28), mcp (14), swarm (10) and site; for web the same 25 bindings and the same uncompressed size, gzip 0.01 KiB apart, which is build noise (two builds of the *same* config differ in 79 bundle files), and the built `dist/server/wrangler.json` differs only in `configPath` and the added `account_id`. Production was not deployed.

**Staging, deployed with the tooling** (account `2c7358a6…`, the devaccounts workers.dev subdomain): Workers `beanstalk-actions-executor-staging`, `beanstalk-gateway-staging`, `beanstalk-mcp-staging`, `beanstalk-web-staging`, `beanstalk-ssh-staging`, `beanstalk-oidc-staging`, `beanstalk-site-staging`; D1 `beanstalk-forge-staging` (8 migrations) and `beanstalk-identity-staging` (5); KV `beanstalk-oauth-staging`; R2 `beanstalk-actions-logs-staging` (30-day expiry) and `beanstalk-media-staging`; queue `beanstalk-repo-events-staging`; Artifacts `beanstalk-race-stg` and `beanstalk-repos-stg` (an override in staging's env.jsonc, see below); analytics dataset `product_events_staging`. Containers: runner 4 × standard-4, executor 2 × standard-4, SSH 3 × lite. The first deploy hit error 10143 (the executor binds the not-yet-deployed gateway), which is what the bootstrap pass in §4 now handles; the second first-deploy went through it.

Smoke (`pnpm env:smoke staging --repo <handle>/<repo>`, after a passkey sign-up and a write token from Settings in a headless browser): gateway `/healthz` 200; `/signup` 200; `whoami` with the token answers `user <handle>`; `git clone` over HTTPS, from the web origin, of a new repository started as Empty (a README on `stalk`). Accounts `smoke-env` to `smoke-env5` are left on staging.

What went wrong on the way: a parallel teardown of the old `-staging-*` stacks also deleted this stack's Workers, D1, KV, R2, queue and Artifacts namespaces once (its match was wider than `-staging-<suffix>`). Provision and deploy rebuilt it in about ten minutes from `env.jsonc` alone, which is the point of the design; Artifacts still refused the deleted `beanstalk-{race,repos}-staging` names (`Namespace is not active`) 40 minutes later, so staging's env.jsonc overrides the gateway's two namespaces (and `ARTIFACTS_NAMESPACE`) to `-stg`. Once Artifacts frees the names the override can go; staging's repositories would stay behind in the `-stg` namespaces.

## 10. CI

`.github/workflows/deploy.yml` deploys `staging` on every push to `prototype` and `production` on a manual run (`workflow_dispatch` with `environment: production`, which can require a reviewer in GitHub's environment settings). It needs one repository secret, `CLOUDFLARE_API_TOKEN` (Workers Scripts, D1, KV, R2, Queues, Containers and Artifacts edit). Each job runs only when its `environments/<env>/env.jsonc` is committed, so in the public repo, where none is, it does nothing. It does not provision or upload secrets: the Workers already hold them and deploy checks their names. Later the same steps can run on Beanstalk Actions.

## 11. Open

- The hosted service's public addresses also appear outside configs: `packages/claude-plugin/.mcp.json`, the plugin's setup scripts, `packages/web/src/setup/*.ts` and `packages/site/public/site.js`. They name the hosted Beanstalk, as `gh` names github.com, so they stay; a self-hoster's plugin points at its own MCP URL by editing `.mcp.json`. A later change can read them from the web's `MCP_URL` var.
- The gateway's types are strict (`"beanstalk-race"`, `"48"` as literal types); an environment's different values are still plain strings at run time. Switching the gateway to `--strict-vars false` like web and mcp would make the types honest.
- After the deadline: replace the Wrangler calls with the `cf` CLI's environments.
