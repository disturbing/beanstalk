# 25 · Actions and Automations: GitHub Actions workflows and GitOps automations

Written 2026-10-08 from `prototype` at `6d4ffea`. Design only: nothing here is built. Names as everywhere: a **bean** is one change, the **sprout** is the staged line, the **stalk** is the stable line.

**Coop's direction (owner decisions, 2026-10-08).** Hooks, CI and CD are GitHub Actions: Beanstalk runs `.github/workflows/*.yml`. Automations move out of the database into files (`.beanstalk/automations/*.yml`) with the same `on:` trigger model plus Beanstalk events. Editing one in the UI makes a commit that lands on the stalk. The repository gets an **Automations** tab with two kinds, **Actions** and **Automations**, shown the way GitHub shows them and editable from the UI or the file.

**What this replaces.** `16` §1 put "GitHub Actions compatibility" out of scope and §3.6 designed automations as AutomationDO rows created by `automation_create`. Both change here. What `16` §3.6 decided still holds: outputs are typed Beanstalk objects, tools are direct MCP only (no Composio, decision of 2026-10-06), budgets per run, Rule of Two for untrusted input.

**Inputs.** `docs/claude-05-github-actions-on-cloudflare.md` (Option C bootstrapped with A), Codex's `docs/05-github-actions-portability.md`, `16`, `18`, `19`, `20`, `22`, `23`, `24`, the web app's repository tabs (`packages/web/app/[owner]/[repo]/`), the swarm's credential broker (`packages/swarm/src/broker/`, `src/agent/virtual-hosts.ts`).

---

## 0. The recommendation in one screen

1. **One schema, two folders.** An automation is a GitHub Actions workflow. `.github/workflows/` is strict GitHub syntax, so the files still work if the repository goes back to GitHub. `.beanstalk/automations/` uses the same syntax plus three extensions: Beanstalk events in `on:`, `beanstalk/*` built-in actions (agent sessions and typed outputs), and a `runs-on: beanstalk-isolate` job that runs in a Dynamic Worker instead of a container. One parser, one run engine, one run UI.
2. **Git holds the definitions, and the database is only an index.** Each time the stalk moves, the gateway reads both folders at the new stalk head and recompiles the repository's index (schedules, event subscriptions, compatibility report). Nothing is edited in the database. A UI edit is a bean authored by the person, so it goes through the pre-land check, lands on the sprout and becomes live when the stalk takes it.
3. **Event mapping keeps a GitHub repository's CI working.** `push` to `main` means the stalk moved. `pull_request` means a bean was pushed, and it runs on the bean squashed onto the sprout, which is GitHub's merge ref. `merge_group` means the sprout's validation. The checks in `checks.toml` stay as the fast pre-land path. A new `[actions]` table in it says which workflow jobs are required at pre-land or at validation, the way branch protection does on GitHub.
4. **Two substrates: isolates and containers.** Jobs that need Linux (shell, toolchains, `npm ci`, `wrangler deploy`) run in Containers. Most automations, and light steps that are only JavaScript, HTTP or an agent hand-off, run in **Dynamic Workers**: isolates that start in milliseconds and cost about a thousandth of a container job, with egress, bindings and secrets controlled by the loader (§3.9). The control plane (parsing, expressions, triggers, the DAG) is our own trusted code, so it stays in ordinary Workers and DOs.
5. **Execution of container jobs before the deadline:** one container per workflow run, with `act` in host mode driving the jobs inside it. `act`'s own artifact and cache servers then work across jobs at no cost to us. Logs come from `act --json` and are split into jobs and steps. **After the deadline:** one container per job, a native step runner, and our own cache, artifact and OIDC services (`claude-05` Option C).
6. **Secrets never reach agents.** Repository secrets are envelope-encrypted, injected into a job container's environment only for the steps that name them, and masked in the log stream. Agent steps run in a separate sandbox with no secrets. Model keys and MCP connection tokens are added at egress by virtual hosts, as the swarm's broker does today. A bean pushed by an agent session or a deploy token runs its `pull_request` workflows like a fork PR does on GitHub: a read-only token and no secrets.
7. **Workflow and automation files are always protected paths**, the same as `checks.toml`. Agents cannot change the code that holds the secrets.
8. **Before 10-14:** an Actions MVP with `push` to the stalk, `workflow_dispatch`, `schedule`, repository secrets, act in a container, the Actions list, the run and job graph, live logs, and a "deploy to Cloudflare when the stalk moves" example. That is about 6.5 agent-days in three parallel lanes. Automations, the editor and the `pull_request`/`merge_group` gating come after.

---

## 1. File formats

### 1.1 `.github/workflows/*.yml`: GitHub's schema, honestly subset

Parsed with GitHub's own `@actions/workflow-parser` and `@actions/expressions` (MIT, TypeScript, run in the Worker and in the browser), so there is no YAML or expression engine of our own. Every file gets a **compatibility report**: each feature is *runs*, *runs differently* (with the difference stated) or *never runs here* (with the reason). The report shows in the editor, on the workflow page and in the push line of the bean that changes the file.

| Feature | v1 (MVP, act host mode) | v2 (native runner) |
|---|---|---|
| `on: push` (branch filters, `paths`) | Yes, see §2 | Yes |
| `workflow_dispatch` with `inputs` | Yes | Yes |
| `schedule` (cron, UTC, at least every 5 min) | Yes, from the stalk's files | Yes |
| `pull_request`, `merge_group` | Parsed and reported as "after the MVP" | Yes, §2 |
| `repository_dispatch` | No | Yes (webhook and MCP, §1.3) |
| `workflow_run`, `workflow_call` (reusable, same repo) | No | Yes |
| `issues`, `release`, `pull_request_target`, `issue_comment`, … | Never (no such object on Beanstalk) | `pull_request_target` refused on purpose (§3.6) |
| Jobs, `needs`, `if`, job outputs, `strategy.matrix` | Yes (act) | Yes (our DAG) |
| `run` steps (bash, sh, python), `defaults`, `working-directory`, `env` | Yes | Yes |
| JavaScript actions (node20, node24) and composite actions | Yes | Yes |
| Docker actions, `container:`, `services:` | No (needs DinD, §6.3) | After the DinD spike |
| `concurrency` (workflow level) | Yes, enforced by us outside act | Job level too |
| `timeout-minutes`, cancel | Yes, enforced by us (act ignores them) | Yes |
| `permissions` | Yes, applied when the job token is minted (§3.5) | Yes |
| `secrets.*`, `vars.*` | Repository level | Org level, environments |
| `GITHUB_STEP_SUMMARY`, `::error::` annotations | Annotations parsed from the log; summaries no | Yes |
| `actions/cache`, `upload-artifact`/`download-artifact@v4` | Within one run (act's local servers) | Our R2 services, across runs |
| `id-token: write` (OIDC) | No | Beanstalk issuer (§3.5) |
| `environment:` with approvals | Ignored, and said so | A decision card releases the secrets |
| `runs-on` | `ubuntu-latest`, `ubuntu-24.04` → our image; anything else never runs | Plus sizes (`beanstalk-4cpu`) |

### 1.2 The "deploy to Cloudflare when the stalk moves" example (MVP)

```yaml
# .github/workflows/deploy.yml   (unchanged from a GitHub repository)
name: Deploy
on:
  push:
    branches: [main]            # on Beanstalk: the stalk moved (a validated commit)
  workflow_dispatch:
concurrency: { group: deploy, cancel-in-progress: false }
permissions: { contents: read }
jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci
      - run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
```

The same file runs on GitHub with no change. That is the point of keeping `.github/workflows/` strict.

### 1.3 `.beanstalk/automations/*.yml`: the same schema plus three extensions

```yaml
# .beanstalk/automations/posthog-errors.yml
name: PostHog errors → beans
on:
  schedule: [{ cron: "0 * * * *" }]
  workflow_dispatch:
  validation_red:                     # a Beanstalk event (extension 1)
permissions:
  beans: write                        # Beanstalk permissions: beans, comments, threads, decisions
  comments: write
jobs:
  triage:
    runs-on: beanstalk-isolate        # extension 3: a Dynamic Worker, no container (§3.9)
    steps:
      - id: triage
        uses: beanstalk/agent@v1      # extension 2: a built-in action
        with:
          harness: claude-code        # claude-code | codex
          model: sonnet
          budget-usd: 0.50            # hard stop; the run fails "over budget" between turns
          max-minutes: 10
          mcp: [posthog]              # names of direct MCP connections (Settings → Connections)
          tools: posthog.error_tracking_list_issues, posthog.error_tracking_get_issue
          outputs: open-bean, comment # what it may do on Beanstalk; nothing else is granted
          prompt: |
            List PostHog issues that are active with ≥5 occurrences in 24 h.
            Skip any already linked to a bean (dedupe key: the PostHog issue id).
            Open one bean per real bug with the top frame's file as its area.
      - if: steps.triage.outputs.beans == '[]' && github.event_name == 'validation_red'
        uses: beanstalk/comment@v1
        with:
          on: validation               # the red validation that triggered the run
          body: "No PostHog errors match this red."
```

**The extensions:**

| Extension | What |
|---|---|
| Beanstalk events in `on:` | `bean_opened`, `bean_landed`, `bean_red`, `bean_parked`, `stalk_moved`, `validation_red`, `decision_opened`, `decision_decided`, `thread_message`, each with optional filters (`paths`, `beans`, `authors`) |
| External triggers | `repository_dispatch` (GitHub's own event) with `types`: `POST /hooks/<owner>/<repo>/dispatch` with an HMAC or bearer hook secret, and the MCP tool `automation_dispatch`. App webhooks (Sentry, PostHog) point at that URL with a `type` |
| `runs-on: beanstalk-isolate` | The job runs in a Dynamic Worker (a V8 isolate loaded at run time), with no container (§3.9). It allows `beanstalk/*` steps and `beanstalk/script@v1` (JavaScript, like `actions/github-script`), and refuses `run:` and container actions. In `.beanstalk/automations/` this is the default when `runs-on` is omitted. `runs-on: ubuntu-latest` jobs work too and get a container like any Actions job |
| `beanstalk/agent@v1` | Hands the step to a cloud agent session (§3.7). Inputs: `harness`, `model`, `budget-usd`, `max-minutes`, `mcp` (connection names), `tools` (allowlist), `outputs` (allowed typed outputs), `prompt`. Step outputs: `beans`, `comments`, `summary`, `cost-usd` (JSON) |
| Typed outputs as actions | `beanstalk/open-bean@v1` (intent, task, area, evidence URL, `dedupe-key`), `beanstalk/comment@v1` (on a bean, validation, decision or thread), `beanstalk/answer-thread@v1`, `beanstalk/decision@v1` (raise a card), `beanstalk/notify@v1`. They are usable from `run:`-free recipe jobs without any model, which is `16`'s "Recipe" kind |
| `push-bean` output (agent step, opt-in) | The session also implements the bean it opened and pushes it as `bean/<name>`. It then goes through the normal pre-land check. It never lands anything itself |

**Why one schema and not a separate one (decision D1).** A separate automation schema would mean a second parser, a second run engine, a second run UI and a second thing for people and agents to learn, all to express the same `on:` → jobs → steps shape. Using `uses:` for the Beanstalk steps keeps every file valid YAML under GitHub's step grammar, so editors and actionlint still work. We extend the parser's schema JSON with the new events, permissions and `runs-on: beanstalk-isolate`; we do not fork the parser. The two folders keep the boundary visible. A Beanstalk event in `.github/workflows/` is refused with "move it to `.beanstalk/automations/`" because GitHub would reject that file. The cost is that an automation looks like CI to someone who expects a form, and the editor's form view (§4) takes care of that.

**Run as.** An automation acts as the repository's bot principal `@<repo>[automation]` (like `github-actions[bot]`), capped by its `permissions:`. Its beans show "opened by automation posthog-errors.yml (last changed by @coop)". Spend is charged to the repository's owner (decision D7).

---

## 2. GitHub events on Beanstalk

| GitHub event | Beanstalk moment | Commit the run sees | Notes |
|---|---|---|---|
| `push` to `main` / `master` / the base branch | **The stalk moved** (`stalk.promoted`) | the new stalk head; `before` = the old one | The base branch name is an alias for `stalk`, so `branches: [main]` and `if: github.ref == 'refs/heads/main'` keep working. `github.ref` is `refs/heads/<base>`, and `BEANSTALK_LINE=stalk` is set too (decision D3: mirror `refs/heads/main` to the stalk) |
| `push` to `stalk` / `sprout` by name | stalk moved / a bean landed on the sprout | that line's head | `sprout` is landed but not yet validated |
| `push` to `bean/**` | a bean was pushed | the bean's head | Rarely wanted; `pull_request` is the useful one |
| `push` tags | none | — | Beanstalk refuses tag pushes today |
| `pull_request` `opened` / `synchronize` | a bean was pushed (first push / a rework push) | **the bean squashed onto the sprout**: the engine's candidate tree, which is GitHub's `refs/pull/N/merge` | `number` is a stable per-bean number. `head.ref` is `bean/<name>`. `base.ref` is the base branch |
| `pull_request` `closed` | the bean landed (`merged: true`) or was dropped or parked (`merged: false`) | landed sha | |
| `merge_group` `checks_requested` | **the sprout's validation** (the batch of landed beans not yet on the stalk) | the sprout head being validated | Validation already plays merge-group CI's role (`18` §7) |
| `workflow_dispatch`, `schedule`, `repository_dispatch` | button, MCP, cron, webhook | the stalk head | Files are read from the stalk, as GitHub reads from the default branch |

**Which copy of the workflow runs.** For `push`, `schedule` and `dispatch` it is the copy on the commit that was pushed or on the stalk. For `pull_request` it is the bean's merged tree, the same rule as `checks.toml` (`24` §2). That is safe because workflow files are protected (§4.4): only a maintainer's own bean can change them.

### 2.1 Gating, and what happens to `checks.toml` (decision D2)

The engine's per-bean pre-land check runs in seconds on a warm sandbox with no network (`24`, `18` §7.1). A GitHub workflow takes minutes: checkout, setup, install, test. If every bean were gated on a full workflow, the engine would lose the speed it measured in the races, and the culprit probes and re-checks would each start a full workflow. So:

- **Keep `checks.toml` as the fast path.** It is not deprecated. It is the per-bean check the engine runs, re-runs and probes.
- **New `[actions]` table** (protected like the rest of the file), the equivalent of branch protection's required checks:

  ```toml
  [actions]
  preland    = ["ci.yml:lint"]            # required for a bean to land (workflow:job, on pull_request)
  validation = ["ci.yml"]                 # required for the stalk to move (merge_group, or pull_request jobs re-run on the sprout)
  ```

  A required job's verdict feeds the engine like a check verdict does: green; red with failing tests if the job uploads JUnit (`beanstalk-junit` artifact name), otherwise red with the job and step name; timeout or infrastructure loss is never red (`18` §7.1). Workflow jobs that are not listed are **advisory**. They run, show on the bean and the run views, and gate nothing.
- **A repository moved from GitHub** with workflows but no `checks.toml` (recommendation): its `pull_request` and `merge_group` jobs are required **at validation**, not at pre-land. The stalk then never moves past CI that GitHub would have required, and beans still land quickly. The import also opens a bean that proposes a `checks.toml` with the suite command found in the workflow (`npm test`, `cargo test`), for a maintainer to land.
- Culprit probes on a red validation re-run only the failing required jobs, on the probe trees, within the repository's Actions concurrency.

---

## 3. Execution

### 3.1 Shape

```
stalk moves / bean pushed / cron / dispatch / repo event
        │  gateway repo-events consumer (one consumer per queue) ──RPC──▶ beanstalk-actions
        ▼
ActionsDO (one per repository)      index compiled from the stalk's files; schedules as alarms;
        │                           concurrency groups; per-repo limits; dispatch API
        ▼
WorkflowRunDO (one per run)         plan (parser + expressions), job DAG, status, cancel,
        │                           log fan-out to viewers (hibernatable WebSockets / SSE)
        ├─▶ JobDO + container  (runs-on: ubuntu-*)   MVP: one container per run, act drives the jobs
        │      Rust supervisor (axum): runs act --json / the native step runner, streams stdout
        │      outbound: bs.internal (git, API), actions.internal (action tarballs), internet (npm, wrangler)
        ├─▶ Dynamic Worker     (runs-on: beanstalk-isolate)  beanstalk/* and script steps; RPC stubs, egress gateway (§3.9)
        └─▶ AgentSandbox       (beanstalk/agent)      cloud session, no secrets, virtual hosts only
logs ─▶ JobDO SQLite ring (live) ─▶ R2 actions/<repo>/<run>/<job>/<seq>.log (64 KiB segments)
```

- **New package `packages/actions`** (Worker `beanstalk-actions`): ActionsDO, WorkflowRunDO, JobDO (Container DO, `durable_object` scheduling), the `worker_loaders` binding `LOADER` for isolate steps (§3.9), R2 bucket `beanstalk-actions`, and the `ActionsRpc` contract in `shared-race`. Keeping it out of the gateway keeps untrusted job I/O away from the engine, the reason `16` §3.1 gave for a separate automations Worker.
- **New crate `packages/actions-runner`**: the image and the supervisor (Rust, per `AGENTS.md`). The image is Ubuntu 24.04, git, bash, Node 20 and 24, Python 3, `act` (MIT, pinned), and a small preloaded tool cache. It aims at 3 to 4 GB because of the 50 GB account image cap and cold starts.
- **Why DOs and not Cloudflare Workflows for the DAG.** A run needs a single owner for cancellation, concurrency groups, live log fan-out and timeouts (alarms), and a DAG of at most 256 jobs is small. Workflows would add a second state machine and still need the DO. Workflows stays a candidate for the agent session's lifecycle.
- **Keep-alive.** Code running in a container does not count as activity, so JobDO sets an alarm every minute that renews the container's inactivity timeout and enforces `timeout-minutes` (`claude-05` §3).

### 3.2 act first, then native

| | MVP: act in host mode | v2: native |
|---|---|---|
| Container | one per run, `standard-2` by default | one per job (matrix legs included) |
| Command | `act <event> -W <file> -e event.json -P ubuntu-latest=-self-hosted --json --secret-file … --var-file … --artifact-server-path … --github-instance <beanstalk host> --action-offline-mode` (flags pinned to the act version; jobs run one at a time inside the container if the pinned act cannot isolate host-mode workspaces) | a Node step runner (script, node, composite handlers, env files, `::commands::`) driven by our plan |
| DAG, `needs`, outputs, matrix | act | WorkflowRunDO |
| Cache and artifacts | act's local servers, within one run | our twirp services on R2 (cache v2, artifacts v4), across runs |
| What we add outside act | concurrency, timeouts, cancel (`kill`), `permissions` at token mint, masking, annotations from the log | everything |
| Known gaps | act's list (`nektosact.com/not_supported.html`): summaries, problem matchers, `environment`, OIDC | the DinD-dependent features only |

The Worker-side parts (triggers, plan, token, secrets, logs, UI) are the same in both columns, so none of the MVP is thrown away (`claude-05` §5).

### 3.3 Logs

The supervisor streams `act --json` lines (job, step, stage, output) to JobDO in batches every 250 ms or 16 KiB. JobDO masks secrets (each value plus its base64 and URL-encoded forms, and `::add-mask::` values), stores the live tail in SQLite (last 2,000 lines per job) and flushes 64 KiB segments to R2. Viewers subscribe to WorkflowRunDO, and a late viewer reads R2 first and then the tail. A run keeps an immutable **manifest** in R2: event payload, workflow sha, checkout sha, image digest, act version, every action resolved to a sha, and the secrets referenced by name (never values).

### 3.4 Secrets and variables

- **Where:** FORGE D1 `repository_secrets` (repo, name, ciphertext, iv, key version, created by, updated at). Each value is encrypted with a per-repository data key, and that key is wrapped by a Secrets Store key-encryption key, which is `16` §5.2's plan for provider keys. `vars` are plain rows. Owner and maintain roles set them in Settings → Secrets. The value is write-only: it is never shown or returned, and Settings lists names and "updated by, when". The audit log records changes in `repository_audit`.
- **Injection:** the WorkflowRunDO decrypts only the secrets the plan references, just before the job starts, and passes them to the supervisor over the container's exec channel as `--secret-file` content in a tmpfs. They are never in the image, argv, the manifest or the logs. They are dropped when the job ends.
- **Who gets none.** A `pull_request` run for a bean pushed by an agent session (`bss_`), a deploy token (`bsd_`) or a read-or-write collaborator who is not a maintainer gets no secrets and a read-only job token, like a fork PR on GitHub (decision D4). Agent steps (§3.7) never get secrets in any form; `${{ secrets.* }}` in a `beanstalk/agent` input is a parse error.
- **Known residual risk.** A `push` workflow on the stalk runs code that agents wrote, such as `package.json` scripts, with deploy secrets. That is the same as auto-merge on GitHub. Protected paths stop agents from editing the workflow; they do not stop agents from editing what the workflow calls. Mitigation in v2: `environment:` with a required approval card before secrets are released, and an option to list what deploys may run.

### 3.5 Job token (`GITHUB_TOKEN`) and OIDC

- **Job token** `bsj_…`: minted per job by the actions Worker and stored hashed in FORGE. It is bound to the repository engine and to the job's lifetime plus 5 minutes, and revoked when the job ends. `verifyGitCredential` gets one more branch. Its scopes come from `permissions:`: `contents: read` fetches, and `contents: write` may push **`bean/<name>` only**, so a job that writes code makes a bean that goes through the pre-land check. Sprout and stalk are never reachable, as for every credential (`AGENTS.md`). `GITHUB_SERVER_URL` and `GITHUB_API_URL` point at `bs.internal`, and the outbound handler adds the token for git. The environment variable still holds it, because actions read `GITHUB_TOKEN`; it is short-lived and scoped. A GitHub-shaped REST subset (repos, contents, commit statuses) is v2.
- **OIDC (v2):** a Beanstalk issuer at `https://<domain>/_actions/oidc` with discovery and JWKS (keys in Secrets Store). Claims mirror GitHub's: `sub` is `repo:<owner>/<repo>:ref:refs/heads/stalk`, plus `repository`, `ref`, `sha`, `workflow_ref`, `run_id`, `actor`. It works only where the user registers our issuer (AWS, GCP, Azure, Vault). Cloudflare deploys use an API token secret.

### 3.6 Actions from github.com

`uses: owner/repo@ref` is resolved by the actions Worker, not the container: ref → sha through the GitHub API with a GitHub App installation token (the swarm's BrokerDO pattern, so we are not on the 60 requests per hour unauthenticated limit shared by Cloudflare egress IPs). The tarball is fetched from codeload, stored in R2 under `actions/<owner>/<repo>/<sha>.tar.gz`, and served to the container through `actions.internal`, where act's action cache reads it offline. The sha is recorded in the manifest. A tag that moves later does not change a run that already started. Policy (v2): allow all public actions (default), allow only an org allowlist, or allow sha-pinned only. `pull_request_target` is refused: it exists to give untrusted heads trusted secrets.

### 3.7 Agent steps

A `beanstalk/agent@v1` step leases an `AgentSandbox`, built from the swarm's (`packages/swarm/src/agent/`). It has no internet, and its virtual hosts are its only egress:

| Host | What the handler adds | What the container sees |
|---|---|---|
| `model.internal` | the provider key (BYO key from identity, or Beanstalk's) through AI Gateway, with the run's budget enforced per request | a dummy key |
| `bs.internal` | a `bss_` session token for `@<repo>[automation]`, bound to the repository, with scopes taken from `outputs` (`open-bean` → `bean_open`, `push-bean` → write, `comment` / `answer-thread` → collaborate) | Beanstalk MCP at `http://bs.internal/mcp`, with no token |
| `mcp.internal/<connection>` | the direct MCP connection's OAuth token (from identity, encrypted, refreshed in the Worker) | the MCP endpoint, filtered to the `tools` allowlist |

Trigger payloads (an issue title, a webhook body) are passed to the prompt as data labelled untrusted (taint U). An external write such as Slack or Linear is not a typed output; it waits for the approval card of `16` §3.6. The session's transcript and cost go to the run log, and the run stops when `budget-usd` is spent. This needs `16` Phase 5's cloud sessions, so agent steps come after it. Recipe automations, made only of `beanstalk/*` actions, do not.

### 3.8 Capacity, limits and cost

- **One compute ledger.** `RunnerCapacity` (`18` §7.1) leases sandboxes for checks against the runner class's `max_instances`. Actions jobs and agent sandboxes are separate container classes, but they share the account's vCPU and memory, and they compete with checks for the same budget. Generalise it to lease kinds with priorities: pre-land check > validation > required Actions job > race > advisory Actions job > automation > agent step. Each repository gets a floor (2 check sandboxes, unchanged) and a cap (default 4 concurrent Actions jobs and 2 agent sessions). A queued job waits in its WorkflowRunDO, and waiting never counts toward a job's timeout.
- **Limits (beta defaults):** a 60-minute default and 6-hour maximum per job, 256 jobs per run, 20 queued runs per repository, a cron interval of at least 5 minutes, 500 MiB of logs per run, and 7-day log and artifact retention.
- **Cost (Containers pricing, `claude-05` §3):** a 5-minute `standard-2` job at 50 % CPU costs about 6 GiB × 300 s × $0.0000025 + 300 × 0.5 × $0.00002 = **$0.0075**. A 10-minute `standard-3` job costs about $0.025. The same 10 minutes on GitHub's 2-core Linux runner is $0.06. Add the R2 writes for logs (cents per thousand runs) and DO requests. An agent step costs model tokens plus about $0.13 per sandbox-hour (`17` §3.2). Spend shows per run and per workflow, and a monthly cap per repository lives in Settings, not in git, because it is billing.

### 3.9 Dynamic Workers versus Containers

**What Dynamic Workers are** (Cloudflare docs, `developers.cloudflare.com/dynamic-workers/`, read 2026-10-08; the limits page was last updated 2026-08-27). A Worker with a `worker_loaders` binding (`{"binding": "LOADER"}`) loads code at run time into its own V8 isolate. `env.LOADER.load(code)` makes a one-off isolate. `env.LOADER.get(id, () => code)` caches one by id so it stays warm across requests. The code object carries `compatibilityDate`, `mainModule`, `modules`, `env` and `globalOutbound`. Its `env` holds **RPC stubs** that the loader creates (`ctx.exports.X({ props })`). Props stay in the loader, and stubs cannot be forged. `globalOutbound: null` makes every `fetch()`/`connect()` throw. A `WorkerEntrypoint` there sees every outbound request and can block it, rewrite it or add credentials. Per-invocation `limits: { cpuMs, subRequests }` apply, and going over throws at once. Without them the Workers plan's limits apply: an isolate has 128 MB of memory, and CPU defaults to 30 s and can go up to 5 min. At most **4** Dynamic Workers can be in flight per Worker request and **10 per Durable Object**, and in-flight requests to the same one count once. Pricing (Workers Paid only): 1,000 unique Dynamic Workers a month included, then **$0.002 per unique Worker per day**, plus requests and CPU at Workers Standard rates ($0.30 per million, $0.02 per million CPU-ms). An isolate has **no subprocesses** (`node:child_process` is a stub), no persistent filesystem and no Linux userland.

**The split:**

| Work | Where | Why |
|---|---|---|
| Parsing workflows and automations, `${{ }}` expressions, trigger matching, the DAG, concurrency | **Ordinary Workers and DOs** (ActionsDO, WorkflowRunDO) | This is our own trusted code (`@actions/workflow-parser`) running over untrusted *data*. An isolate per evaluation would add the 4/10 in-flight limit and unique-Worker charges and buy no isolation. This differs from the coordinator's proposed split (decision D11) |
| Automations: event or webhook → MCP or API calls → decide → open a bean, comment, raise a card | **Dynamic Worker** (`runs-on: beanstalk-isolate`) | Millisecond start, no image, and per-repository isolation of user-written step code |
| Light Actions steps: `beanstalk/script@v1` (JavaScript with an `octokit`-shaped Beanstalk client, like `actions/github-script`), HTTP and webhook calls, the `beanstalk/agent` hand-off | **Dynamic Worker** | They need no Linux. The agent *session* still runs in an AgentSandbox container (Claude Code and Codex need Linux); the isolate only starts it, waits and collects its typed outputs |
| Shell, toolchains, `npm ci`, tests, builds, `wrangler deploy`, any JavaScript action that spawns processes or uses the filesystem | **Container** (`runs-on: ubuntu-*`) | Needs Linux processes and disk |

**How a job is classified.** It is decided by the label only, never inferred from what the steps contain:
- `runs-on: beanstalk-isolate` → isolate. Validation refuses `run:`, Docker actions and marketplace JavaScript actions in such a job, with the reason, so a job never fails halfway because a step needed Linux.
- `.beanstalk/automations/` with no `runs-on` → isolate (the default there). `.github/workflows/` always needs `runs-on`, as on GitHub, and `ubuntu-*` always means a container, even when every step would fit an isolate. A GitHub workflow keeps GitHub's behaviour, and running `actions/github-script` in an isolate would silently break any script that calls `exec` or `fs`.
- The compatibility report suggests the label: "this job only calls `beanstalk/*` and HTTP; `runs-on: beanstalk-isolate` would start in milliseconds instead of seconds". Changing it stays the author's decision.
- Inferring the substrate from the steps was rejected. It works for built-ins, but a marketplace JavaScript action can reach `child_process` through any dependency, and the failure would show up only at run time.

**Security model for user code in an isolate.**
- **One isolate per step bundle and repository.** The id is `<repo id>:<sha of the step's resolved code>`, loaded with `get`, so runs of the same automation reuse a warm isolate and two repositories never share one. Each step is a separate invocation with fresh props, and there is no shared global state between runs we rely on (state goes through stubs).
- **No network by default.** `globalOutbound` is the loader's `IsolateEgress` entrypoint, constructed with props for the run: repository, run, job, the automation's `allowed-hosts` and the secret names it may use. Requests to hosts not on the list throw. MCP connections are not URLs the code can reach; they are stubs (below).
- **Secrets never enter the isolate.** Code refers to a secret by a placeholder (`secret("POSTHOG_KEY")` returns the opaque string `bs-secret:POSTHOG_KEY`). `IsolateEgress` replaces the placeholder in request **headers only**, and only for hosts the file pairs with that secret (`with: { secret-hosts: { POSTHOG_KEY: [us.posthog.com] } }`). A placeholder in a body, URL or another host's header is refused, not sent, so code cannot copy a secret to a host it controls. Responses are masked for secret values before the code sees them. This is the swarm broker's virtual-host rule (`packages/swarm/src/agent/virtual-hosts.ts`) applied inside one Worker.
- **Bindings are capability stubs, scoped by `permissions:`.** `env.BEANSTALK` (`openBean`, `comment`, `answerThread`, `raiseDecision`, `notify`, read-only `repo`/`bean`/`stalk` queries) acts as `@<repo>[automation]`, has only the methods the file's permissions grant, and has per-run rate and output caps. There is one `env.MCP_<name>` per declared connection, which lists and calls only the allowlisted tools, with the OAuth token added in the loader. There is no D1, KV, R2 or service binding of ours. Trigger payloads arrive as data labelled untrusted (taint U, `16` §3.6).
- **Limits per step:** `cpuMs` 5,000 by default (at most 30,000), `subRequests` 200, a step timeout of 5 minutes wall clock (enforced by WorkflowRunDO; the isolate can wait on I/O without spending CPU). A step that goes over fails as "over limit", which is not a code error.
- **What is still shared:** isolates run on Cloudflare's multi-tenant V8 boundary, the same boundary every Worker relies on. Code that needs a stronger boundary than that, or that needs Linux, goes to a container job.

**Concurrency.** The 10-per-DO cap applies per WorkflowRunDO, which owns one run, so it bounds the isolate steps of one run that are in flight at once (matrix legs queue beyond 10). Isolate steps never take container capacity from the `RunnerCapacity` ledger (§3.8). A per-repository cap of 20 concurrent isolate steps keeps a webhook storm in check.

**Cost and cold start compared** (Workers Paid; container rates from §3.8):

| | Dynamic Worker step | Container job (`standard-1`, the smallest that runs a toolchain) |
|---|---|---|
| Start | an isolate: milliseconds (warm by id with `get`) | 1 to 3 s for the container, plus checkout and setup (`claude-05` §3) |
| A typical recipe step (3 MCP calls, 50 ms CPU, 2 s waiting on I/O) | about $0.0000013 (one request plus 50 CPU-ms); the unique-Worker charge of $0.002 a day falls on each automation that runs that day, beyond 1,000 a month | 0.5 vCPU, 4 GiB for at least about 10 s: about $0.0002, and in practice 30 s or more with setup, about $0.0005 |
| An hourly automation for a month (720 runs) | about $0.06 a month, almost all of it the unique-Worker day charge | about $0.36 a month |
| Can run shell, compilers, `wrangler` | No | Yes |

The isolate is roughly 100 to 1,000 times cheaper per step and starts about a thousand times faster. That is why automations, which are mostly I/O and decisions, belong there.

---

## 4. A UI edit is a commit

### 4.1 Why

A file that is the truth needs exactly one way to change it, or the UI and the file drift apart. Making a UI edit an ordinary bean gives, for free: history and blame (`git log .beanstalk/automations/`), revert, review by the people who watch the stalk, the protected-path rule, validation before anything goes live, and agents and people seeing the same definition. "A commit on main" in Beanstalk terms is a bean that lands: it is on the sprout once its pre-land check is green, and live once the stalk validates it, which is when the index recompiles.

### 4.2 The flow

```
editor (form ⇄ YAML) ── Save ──▶ web server action (person signed in, role ≥ maintain)
   validate (shared parser, same as the engine) ── errors? stay in the editor
   gateway RPC commitFile(repo, path, base: sprout head, content, message, author: person)
     builds blob + trees + commit in the Worker (extends git/pack-writer.ts, which already writes tags)
     pushes it as bean/ui-<slug>-<n> with the person's own credential kind ("web, personal")
   engine: normal flow ─ pre-land check on the merged tree (the suite + "workflow files are valid")
                       ─ LANDED on the sprout ─ validated ─ stalk moves ─ index recompiles
editor shows: Saved as bean ui-deploy-3 · checking → landed → live (the same journey as Changes)
```

- **The author is the person** (`Author: coop <coop@users.<domain>>`, committer `beanstalk`), so blame names them and the protected-path rule sees a maintainer's personal credential.
- **"Workflow files are valid"** joins the pre-land check, like `checks.toml`'s invalid file (`24` §2). A bean that breaks a workflow file is red with each problem, whoever pushed it with git. The editor runs the same validation first, so a UI save is never red for that reason.
- **Formatting is kept.** Form edits apply to a YAML CST (the `yaml` package's Document API), so comments, key order and quoting survive and the diff is the minimum change.

### 4.3 Validation before commit

Schema errors, with line and column and "did you mean"; expressions parsed; cron checked and its next three times shown; the compatibility report (§1.1); secrets and variables named in the file that do not exist; `uses:` resolvable to a sha, with a warning for an unpinned tag; MCP connections and tools that do not exist; budget present on every agent step; a Beanstalk event in `.github/workflows/` refused with the folder to use.

### 4.4 Protected paths

`.github/workflows/**`, `.github/actions/**` and `.beanstalk/automations/**` join `.beanstalk/checks.toml` in the always-protected list (`24` §2). Only the owner or a maintainer may change them, with a personal token, an SSH key or the web editor. Agent sessions, deploy tokens and job tokens are refused with the same red as today. A write collaborator's UI save is labelled "Propose". It makes the bean, which is refused at pre-land until the flag-and-approve card arrives (`24` §6.4, Phase 3), and the editor says so before they save. Recommendation for later: an agent's proposed workflow change becomes a decision card with the diff and its compatibility report, and a maintainer's yes lands it as their own.

### 4.5 Conflicts

The editor opens the file at the **sprout** head (latest landed) and records that sha. On save:
- **The file has not changed since:** the bean lands as normal.
- **Changed by someone else in the meantime:** the engine's squash conflicts, or the server sees the newer blob first. The editor shows a three-way view (theirs, yours, merged). For form edits it re-applies the same structured change to the new file, because form changes are recorded as operations ("set `on.schedule[0].cron`"), and asks to confirm. YAML-mode edits get a text merge.
- **Landed but not yet live:** the editor and the list show "landed, live when the stalk validates" with the sprout sha, and the index runs the stalk's copy until then.

---

## 5. UI

The repository shell becomes **Code, Changes, History, Automations, Ask, People, Settings**. The tab shows a red dot when the latest run of a required workflow on the stalk is red.

### 5.1 Automations tab: the Actions list

```
┌ acme / shop · Automations                                              [New ▾] ┐
│ ( Actions 3 )  Automations 2                    filter: [all ▾] [branch: stalk ▾] │
├──────────────────────┬────────────────────────────────────────────────────────────┤
│ All workflows        │ Deploy                                   [Run workflow ▾]  │
│ ● CI           ✓     │ .github/workflows/deploy.yml · on push(main=stalk), dispatch│
│ ● Deploy       ✓     │ compatibility: runs ✓  (1 note: concurrency enforced by us) │
│ ● Nightly e2e  ✗     │ ────────────────────────────────────────────────────────── │
│                      │ ✓ #41 stalk moved  ac12ade "Add total"   @coop  1m 52s  2m │
│ Compatibility        │ ✓ #40 stalk moved  9f1e0c2 "Slugify"     @dana  1m 47s  1h │
│ 1 workflow has notes │ ✗ #39 dispatch     stalk                 @coop  0m 31s  3h │
│                      │ ⋯ load more                                                │
└──────────────────────┴────────────────────────────────────────────────────────────┘
 New ▾: Workflow from a template (Deploy to Cloudflare, Node CI, Rust CI) · Automation · Import from GitHub
```

### 5.2 A run: the job graph

```
┌ Deploy #41 · stalk moved · ac12ade "Add total" · @coop   ✓ 1m 52s   [Re-run ▾] [⋯] ┐
│ Summary   Jobs   Manifest                                                          │
│                                                                                    │
│   ┌──────────┐      ┌──────────┐      ┌──────────────┐                             │
│   │ ✓ lint   │─────▶│ ✓ test   │─────▶│ ✓ deploy     │   matrix legs fold under    │
│   │   12 s   │  ┌──▶│  48 s    │      │   41 s       │   their job (test ×3 ▸)     │
│   └──────────┘  │   └──────────┘      └──────────────┘                             │
│   ┌──────────┐  │                                                                  │
│   │ ✓ build  │──┘   annotations: 0 errors · 1 warning (src/cart.ts:12 unused var)  │
│   └──────────┘                                                                     │
│ Triggered by the stalk moving to ac12ade (validated 14:02:11) · image ubuntu@sha…  │
└────────────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 A job: steps and live logs

```
┌ Deploy #41 › deploy                                         ● running 0:37   [Cancel] ┐
│ ✓ Set up job                      2 s                                                 │
│ ✓ actions/checkout@v4 (b4ffde6)   1 s                                                 │
│ ✓ actions/setup-node@v4 (39370e…) 6 s                                                 │
│ ✓ npm ci                          18 s                                                │
│ ● npx wrangler deploy             live ▾                                              │
│   12 │ Total Upload: 41.20 KiB / gzip: 9.87 KiB                                       │
│   13 │ Uploaded shop (2.31 sec)                                                       │
│   14 │ Deployed shop triggers (0.42 sec)                                              │
│   15 │   https://shop.acme.workers.dev                                                │
│   16 │ CLOUDFLARE_API_TOKEN=***                                                       │
│   ▌ following                                                    [raw] [download]     │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

### 5.4 The Automations list

```
┌ acme / shop · Automations                                              [New ▾] ┐
│  Actions 3  ( Automations 2 )                                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│ ● PostHog errors → beans   hourly · validation_red · PostHog (MCP)               │
│     last 09:00 ✓ 41 issues · 3 beans opened (t051 t052 t053) · $0.21 · 1m 10s   │
│ ● Red too long → page      validation_red for 30 min · notify                    │
│     last 08:12 ✓ 1 notification · $0.00                                         │
│ ○ Weekly digest            Mon 08:00 · paused (if: false in the file)            │
└─────────────────────────────────────────────────────────────────────────────────┘
```

An automation's run uses the same views as an Actions run. An agent step's log is the session's transcript, with each tool call folded and each typed output linked (bean, comment, thread).

### 5.5 The editor (form ⇄ YAML, kept in sync)

```
┌ Edit · .beanstalk/automations/posthog-errors.yml        ( Form )  YAML     [Cancel] ┐
│ Name      [PostHog errors → beans                     ]                             │
│ WHEN      [⏱ Schedule  0 * * * *  next: 10:00, 11:00, 12:00 ]  [×]                  │
│           [◆ Beanstalk event  validation_red  ▾]               [×]                  │
│           [+ trigger ▾  push · dispatch · webhook · bean_landed · decision_opened …] │
│ DO        Step 1  Agent session                                                     │
│             Harness [Claude Code ▾]  Model [sonnet ▾]  Budget [$0.50]  Max [10 min] │
│             MCP     [posthog ✓ connected (Dana)]  Tools [2 of 14 ▾]                 │
│             May     [✓ open beans] [✓ comment] [ ] push beans [ ] answer threads     │
│             Prompt  [List PostHog issues that are active with ≥5 …              ]   │
│           Step 2  Comment  if: no beans and event is validation_red                 │
│           [+ step ▾  agent · open bean · comment · decision · notify · run (container)]│
│ ✓ valid · 0 notes                                                                   │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ Commit  [Run hourly and on red validations                    ]                     │
│ Saves as a bean by @coop: pre-land check, then live when the stalk validates it.     │
│                                                    [Save as bean]  [Save and run now]│
└─────────────────────────────────────────────────────────────────────────────────────┘
```

YAML mode is a code editor with the same validation inline. Switching modes is lossless. A construct the form cannot show (an unusual expression) shows as a read-only YAML block inside the form, with "edit in YAML". The editor is the same shape as the MCP tools, so an agent can say "add a nightly e2e run" and get the same validated file as a proposed bean (§4.4).

**MCP tools** (P1: every screen has a verb): `workflow_list(repo)`, `workflow_dispatch(repo, workflow, inputs)`, `run_list(repo, workflow?)`, `run_status(repo, run)`, `run_logs(repo, run, job, tail?)`, `automation_dispatch(repo, automation, payload)`. There is no create or edit tool: agents change files with git, like any other file.

---

## 6. Plan, risks, decisions

### 6.1 Before the 10-14 deadline: the Actions MVP (about 6.5 agent-days, three lanes)

| # | Item | Acceptance | Size |
|---|---|---|---|
| M1 | Parser and index: `@actions/workflow-parser` in `packages/actions`, compile `.github/workflows/*` at each stalk move (fed by the gateway's repo-events consumer), compatibility report | A workflow with a Docker action is listed as "never runs here: Docker actions need DinD" | 1 |
| M2 | Runner image and Rust supervisor, JobDO (container, keep-alive alarm, timeout, cancel), `act --json` → job/step log stream → SQLite tail + R2 | `act` runs the deploy example in a `standard-2` container on staging; cancel kills it within 5 s | 2 |
| M3 | ActionsDO and WorkflowRunDO: `push` (stalk, `main` alias), `workflow_dispatch` (web button + MCP), `schedule` (alarms), workflow-level `concurrency` | A bean landing and validating starts the deploy; a cron run fires within a minute | 1 |
| M4 | Secrets and vars (Settings, envelope encryption, injection, masking); `bsj_` job token for checkout; protected paths for `.github/workflows/**` | The token never appears in logs (masked test); an agent bean that touches a workflow is red | 1 |
| M5 | Web: Automations tab (Actions only): list, run history, job graph, live job logs, Run workflow | Night, day and phone screenshots; live log follows a running job | 1.5 |
| M6 | The example end to end on staging: a Worker repository whose stalk deploys itself with `wrangler deploy` | A pushed bean is LANDED → validated → deployed, with a transcript and screenshots | 0.5 |

Left out on purpose: `pull_request`/`merge_group` and gating, the editor, Automations, cache and artifact services, DinD, OIDC, org secrets. The demo line is "push a bean, it lands, the stalk moves, Cloudflare deploys it, and the logs are live in Beanstalk." **Cut order if the race work needs the days:** M3's schedule, then M5's graph (keep the list and the logs), then M4's vars. M6 is the demo and stays.

### 6.2 After

| Phase | Items | Effort |
|---|---|---|
| A2 · CI parity | `pull_request` / `merge_group` mapping (§2), the `[actions]` table in `checks.toml` and required verdicts into the engine, the bean page's "Checks" list, re-run job, annotations and summaries, import from GitHub with the compatibility report and a proposed `checks.toml` | 5 |
| A3 · Native runner | one container per job, the Node step runner, cache v2 and artifacts v4 services on R2, the action resolver policy, the `bsj_` REST subset, job-level concurrency, matrix in our DAG, reusable workflows (same repo) | 8 |
| A4 · Editor | the form ⇄ YAML editor, `commitFile` RPC (commit builder in the Worker), validation, conflict merge, "Propose" for non-maintainers | 4 |
| A5 · Automations v1, on Dynamic Workers | `.beanstalk/automations/` schema extension; the `worker_loaders` binding and the isolate step host in `beanstalk-actions` (`IsolateEgress`, secret placeholders, the `BEANSTALK` and `MCP_<name>` stubs, per-step limits); `beanstalk/*` typed-output actions and `beanstalk/script@v1`; Beanstalk events from repo-events; `repository_dispatch` webhooks; the Automations sub-tab; MCP tools; the repository bot principal. No container is involved: an automation that needs Linux uses a `runs-on: ubuntu-latest` job | 6 |
| A6 · Agent steps | `beanstalk/agent@v1` (the hand-off runs in the isolate, the session in an AgentSandbox) on `16` Phase 5 cloud sessions, direct MCP connections through `mcp.internal`, budgets, transcript as log | 4 (after Phase 5) |
| A7 · Trust | OIDC issuer, environments with approval cards, org secrets, the DinD spike and then `services:`/`container:`/Docker actions with host networking, larger instances | 6 |

### 6.3 Risks

| Risk | Effect | Mitigation |
|---|---|---|
| **DinD** (Cloudflare documents it; an August spike says it fails in production, `claude-05` §3) | `container:`, `services:`, Docker actions and `docker build` jobs cannot run | Not in the MVP. A spike in A7 on a `durable_object` container. Until then the compatibility report says "never runs here" before anything starts |
| **act fidelity** | act ignores timeouts, concurrency, permissions and environments; jobs share one machine | Enforce them outside act (§3.2); report the remaining gaps; native runner in A3 |
| **Image pinning** | GitHub's `ubuntu-latest` is a 20+ GB VM, ours is about 4 GB, so tools are missing, and image updates change behaviour | Publish the image's tool list and digest; record the digest per run; `setup-*` actions fill gaps (slower); version the alias change and report it |
| **Fetching actions from github.com** | Rate limits (unauthenticated requests share Cloudflare's egress IPs), moving tags, outages, supply chain | Resolve in the Worker with a GitHub App token; cache tarballs by sha in R2; record shas; allowlist and sha-only policies in A3 |
| **Secrets and agent-written code** | A stalk deploy runs code that an agent changed, with the deploy secret | Workflow files protected; no secrets for agent-pushed `pull_request` runs; environments with approval (A7); the risk is stated in Settings → Secrets |
| **Capacity contention** | Actions jobs crowd out pre-land checks and the engine slows down | Lease priorities with checks first (§3.8); per-repository caps |
| **Container restarts** (no runtime guarantee) | A long job dies, and a deploy half-runs | Infrastructure loss is shown as such and never as red. No automatic retry for jobs that ran a step with secrets; the person re-runs |
| **Cost runaway** | Tight crons and wide matrices | Cron ≥ 5 min, 256-job cap, monthly cap per repository, estimate shown before a dispatch with a large matrix |
| **Dynamic Workers limits** (4 in flight per request, 10 per DO; 128 MB; CPU ≤ 5 min; no processes) | A large fan-out queues; a heavy script fails as over limit | One WorkflowRunDO per run holds the in-flight isolates; per-step `cpuMs`; the label refuses Linux-needing steps before they run; a job that outgrows an isolate moves to a container |
| **Secret exfiltration from isolate code** | User code copies a secret to its own host | Secrets never enter the isolate: header-only placeholder substitution for hosts paired in the file, everything else refused (§3.9) |
| **Deadline** | 6.5 agent-days against 6 calendar days that are shared with the race | Three lanes (M1+M3, M2+M4, M5) and the cut order in §6.1 |

### 6.4 Decisions for Coop

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | Automations schema | (a) Actions syntax plus extensions, in its own folder; (b) a separate schema | **(a)**: one parser, engine and UI; `.github/workflows/` stays strict so it still runs on GitHub |
| D2 | `checks.toml` against workflows | (a) keep it as the fast pre-land path, with an `[actions]` table for required jobs; (b) deprecate it, so workflows are the checks; (c) workflows are only advisory | **(a)**. A moved repository without `checks.toml` gets its PR and merge-group workflows required **at validation**, plus a proposed `checks.toml` bean |
| D3 | `main` on Beanstalk | (a) mirror `refs/heads/<base>` to the stalk head and alias it in filters and `github.ref`; (b) only the alias | **(a)**: clones' default branch and workflows' `refs/heads/main` checks both just work |
| D4 | Secrets for beans from agents and deploy tokens | (a) none, read-only token (fork-PR rule); (b) the same as people | **(a)** |
| D5 | Agents changing workflows and automations | (a) refused (red) now, decision card later; (b) allowed | **(a)**, with the card in Phase 3 |
| D6 | MVP execution | (a) one container per run, act drives the jobs; (b) one container per job from day one | **(a)** for 10-14 (artifacts and cache work within a run at no cost); (b) in A3 |
| D7 | Who an automation acts as | (a) the repository's bot principal, charged to the owner; (b) the person who last changed the file | **(a)**: it does not break when that person leaves; beans still name the file's last editor |
| D8 | Actions from github.com | (a) all public actions, resolved to a sha and mirrored; (b) allowlist only | **(a)** in the MVP, with the allowlist as an org setting in A3. Needs a GitHub App (Coop creates it, about 10 minutes; the swarm's App may be reused if its permissions allow public reads) |
| D9 | Beta limits and who pays | caps per repository and month | 4 concurrent jobs, 60-minute default, a cap of 2,000 job-minutes per repository per month in the free beta |
| D10 | Is the MVP in the 10-14 submission at all | (a) yes, as scoped in §6.1; (b) after the deadline, with the race first | **(a) only if** the race result is settled by 10-11; otherwise (b), and the submission shows this design and the compatibility report on a real repository's workflows (M1 alone, 1 day) |
| D11 | Where Dynamic Workers run | (a) user step code and automations only, with the control plane (parsing, expressions, triggers, DAG) in ordinary Workers and DOs; (b) the control plane in Dynamic Workers too, as the coordinator proposed | **(a)**. The control plane is our trusted code over untrusted data, so an isolate adds limits and charges and no isolation. Revisit if repositories ever supply their own trigger or policy code |
| D12 | Classifying a job as isolate or container | (a) by label only (`beanstalk-isolate`; the default for automations with no `runs-on`), with a suggestion in the report; (b) inferred from the steps | **(a)**: inference is right for built-ins but fails at run time for marketplace actions that spawn processes |

**Where this differs from Codex's `05-github-actions-portability.md`.** Codex leads with import, a per-workflow compatibility report and an optional GitHub-connected runner bridge, and calls a new native task format an adoption burden. This design agrees on the report (§1.1, made the editor's and the push's feedback) and on enforcing act's gaps from outside. It does not plan the GitHub bridge: Coop's direction is that Beanstalk runs the workflows itself. It also takes Codex's rule that a workflow's status writes never manufacture an engine acceptance: only verdicts that the actions Worker records for a required job feed the engine (§2.1). Codex also puts "bounded policy evaluation" in Dynamic Workers; this design keeps evaluation of our own code in ordinary Workers and uses isolates for repository-supplied code (D11).
