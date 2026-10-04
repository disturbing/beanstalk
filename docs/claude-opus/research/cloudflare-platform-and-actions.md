# Beanstalk research: Cloudflare platform facts and GitHub Actions portability

Researched 2026-10-03. Sources are primary docs (developers.cloudflare.com pages fetched as Markdown, docs.github.com, actions/runner and actions/toolkit source on GitHub) unless marked. Where a fact is inferred rather than documented, it says **[inferred]** or **[verify]**.

---

## 0. Key points

1. **Competition**: submissions close **Wed Oct 14, 2026, 11:59 PM PDT** (11 days from today). Three finalists are announced **Fri Oct 16**. Finalists give a **10-minute live demo at Cloudflare Connect (Moscone West, SF) on Wed Oct 21**, and the winner must be there in person. Judging: originality and quality of the agent-collaboration prototype **50%**, multi-agent concurrency, coordination, context, review and conflict handling **25%**, ease of use and UX **25%**. Each is scored 1–5, and ties go to the originality score. Hard requirements: **you must use Workers and Artifacts**, the project must let multiple agents work on changes at the same time, the license must be MIT, Apache-2.0 or BSD-2/3 with a LICENSE file, and you need a 5–10 minute demo video, a repo URL and run instructions. Entrants must be **US or Canada residents, 18 or older**, with one submission each. The prize is $25K in Cloudflare credits (valid 12 months) plus the VIP speaker dinner on Monday Oct 19.
2. **Artifacts is only a Git store.** It gives you isolated repos, fork, read APIs, repo-scoped tokens, events and smart-HTTP Git. It has **no PRs, merges, diffs, branch protection, server hooks, search, or write API in the binding**. Writes go over the Git protocol, either isomorphic-git from a Worker or real git in a sandbox. Limits: **1 GB per repo, 32 MB per blob, 2,000 Git requests per 10 s per repo, 2,000 control-plane requests per 10 s per namespace, push is protocol v1 only, no `filter`.** The intended model is a repo per agent or task, with namespaces sharded for throughput. Everything above the store — review, merge queues, conflict handling — is what the competition expects entrants to build.
3. **Containers and Sandboxes** run each instance in a **Firecracker microVM, linux/amd64 only**, with every process holding root-equivalent capabilities. The largest size is **4 vCPU / 12 GiB / 20 GB disk**, and the image counts against that disk. The account cap is **1,500 concurrent vCPU**: about 375 standard-4 or 750 standard-3 jobs at once. Cold starts are **1–3 s**. Disk is ephemeral, but snapshots of up to 20 GB are kept for 30 days. Docker-in-Docker works only with `--iptables=false` (plus `--ip-forward=false` under the `durable_object` scheduling policy) and **`--network=host`**. No GPUs are offered, and `/dev/kvm` is not documented, so assume there is none.
4. **Running GitHub Actions unmodified** has two parts. You need a **server side** that does what GitHub does: parse workflows, expand matrix, `needs` and reusable workflows, handle concurrency, and serve the runner protocol, cache, artifacts, OIDC and the GitHub API. You also need a **runner side**: the official `actions/runner`, or an act-based runner, running inside a CF container with DinD. **The hardest incompatibilities:**
   - No macOS, Windows or arm64 runners, and no GPU or KVM.
   - Docker networking without iptables breaks service containers, container jobs, Docker actions, buildx, compose and kind unless shimmed.
   - `actions/upload-artifact@v4+` throws `GHESNotSupportedError` unless `GITHUB_SERVER_URL` is github.com, `*.ghe.com` or `*.localhost`, and the cache v2 client is gated the same way.
   - OIDC tokens can't come from `token.actions.githubusercontent.com`, so cloud trust policies must be reconfigured.
   - Actions that call the GitHub REST or GraphQL API, or the `gh` CLI, need a GitHub-compatible API.
   - Resource ceilings (20 GB disk, while GitHub's full image is over 18 GB) and lifetime caveats (host restarts, a 6 h inactivity cap without alarms).
5. **Prior art**:
   - **Gitea, Forgejo, nektos/act and ChristopherHX/runner.server** all reimplement the orchestration side, with documented gaps.
   - **Blacksmith, Depot, Namespace, Ubicloud, RunsOn and WarpBuild** only replace the compute. They keep GitHub as the orchestrator, run full VMs, and intercept cache traffic transparently.
   - **BuildJet shut down**, stopping jobs on 2026-03-31.
   - **GitHub's own container-based `ubuntu-slim` runner** has no Docker, so no container jobs, and a 15-minute job cap. It is the closest analogue to a CF-container runner.
   - Cloudflare's own **`@cloudflare/ci`** (Workflows + Sandbox, snapshot-cached runners) is a non-Actions CI built for Artifacts pushes.

---

## 1. Competition: rules, dates, judging

Sources: https://www.cloudflare.com/git-competition/ , the rules PDF https://www.cloudflare.com/documents/build-next-gen-git-platform-competition-terms.pdf , the submit form https://www.cloudflare.com/git-competition/submit , the blog https://blog.cloudflare.com/next-git-platform-on-cloudflare/ , and Connect dates (Oct 19–21, Moscone West) via https://www.govevents.com/event/28792/cloudflare-connect-2026 .

| Item | Value |
|---|---|
| Name | "Build the Next-Gen Git Platform on Cloudflare Competition" (page title "Build the next GitHub") |
| Challenge text | "Build a new way for hundreds of thousands of agents to work on changes concurrently… Feel free to rethink repositories, branches, pull requests, worktrees, code review, and merge conflicts. Get creative with it." |
| Contest period | Oct 1, 2026 9:00 AM EDT → **Oct 14, 2026 11:59 PM PDT** (the sponsor's clock is official) |
| Finalists announced | **Oct 16, 2026** (page) |
| Live demo | Each of the 3 finalists gets **10 minutes on stage at Cloudflare Connect, Moscone West, SF, Oct 21, 2026**. The winner is announced at Connect and **must be physically present**. |
| Prize | 1st place: **$25,000 USD in Cloudflare credits** (valid 12 months) plus a Connect VIP Speakers Dinner invite (Monday night). All finalists: reasonable travel and hotel plus Connect tickets for up to **2 people per team**. |
| Eligibility | Legal resident of the **US or Canada**, **18+** at start. Excluded: sanctioned persons, Cloudflare employees, officers, directors and their families or households, and government employees. "Void outside of the United States and Canada." |
| Submission contents | Application form, **5–10 minute demo video** (MP4, WebM or MOV, ≤ 2 GiB), **open-source repo URL**, **instructions to run**, project vision, and "How you used Cloudflare". You must tick "I confirm this project was built using Cloudflare Workers and Artifacts." |
| Mandatory tech | "Entrants must use Cloudflare's developer platform, **including Cloudflare Workers and Artifacts**, to build their Project, which **must enable multiple agents working on changes concurrently**." |
| License | **MIT, Apache 2.0, or BSD 2- or 3-Clause**, and the repo must include a LICENSE file |
| Limits | One submission per entrant. No automated entries. No attacks on competitor products. Original work only, with no third-party copyrighted material unless you have permission. |
| Judging (finalists and winner) | (1) **Originality and quality of the prototype for agent-oriented software collaboration: 50%**; (2) **effectiveness of multi-agent concurrency, coordination, context preservation, review, and conflict handling: 25%**; (3) **ease of use and product/UX: 25%**. Each is scored 1–5. Ties go to the higher score in (1). |
| IP | You keep ownership. Cloudflare gets a license to promotional "Content" (video, name, presentation). Submissions are **not confidential**, and Cloudflare "may develop… products… similar to or compete with Projects." |
| Retention | Submission data and video are kept up to 180 days |

The blog says what Cloudflare wants: "At a minimum, we want to see multiple agents working on changes concurrently." It names the open problems as how agents know what others are working on, conflicting changes, reviewing agent changes at scale, and preserving the reasoning behind changes. The products it recommends are Workers, Artifacts, Workers Builds, Previews and Workflows.

**Implications**: Artifacts must carry real load in the demo. Concurrency and conflict handling are worth 25% and should be visible on screen, e.g. a swarm view and a merge queue. UX is another 25%. With 11 days left, scope down hard.

---

## 2. Cloudflare Artifacts (the Git store)

Docs: https://developers.cloudflare.com/artifacts/ . Blog (Apr 2026 beta): https://blog.cloudflare.com/artifacts-git-for-agents-beta/ . Changelog: https://developers.cloudflare.com/artifacts/platform/changelog/

### 2.1 Status and model
- Private beta on 2026-04-16. **Open beta on 2026-10-01.** Requires **Workers Paid**. Billing starts **Oct 14, 2026** per the pricing page and changelog; the competition blog says Oct 15.
- "Versioned storage that speaks Git." Each repo is "an isolated Git service with its own remote URL, tokens, and durable state". A repo sits in a namespace, and the namespace is created implicitly. Fork "creates a new repo that starts from an existing repo's history, then diverges independently."
- **Internals (blog)**: built on **Durable Objects**. Git objects live in the DO's **SQLite**, chunked because of the 2 MB row limit. Snapshots go to **R2** and auth tokens to **KV**. The Git server is a **~100 KB Zig→Wasm** implementation covering SHA-1, zlib, deltas, pack parsing and smart HTTP. Fetch and push stream so they fit within about 128 MB of DO memory. Durability: synchronous replication across data centers, with asynchronous copies to object storage and snapshots.
- Scale claims: "tens of millions of repos", "10,000 forks from a known-good starting point".
- Data localization: a namespace can be pinned to `eu` or `us` at creation, and this can't be changed later (2026-08-13).

### 2.2 Interfaces
| Interface | Auth | Operations |
|---|---|---|
| Workers binding `env.ARTIFACTS` (`"artifacts": [{binding, namespace}]`, Wrangler ≥ 4.145.0) | binding | Namespace methods: `create(name,{readOnly,description,setDefaultBranch})`, `get(name)` (a disposable RPC handle, use `using`), `list({limit,cursor})` (status `ready`, `importing` or `forking`), `import({source:{url,branch,depth},target:{name,opts}})`, `delete(name)`. Repo handle methods: `info()`, `createToken(scope='write', ttl)`, `listTokens()`, `revokeToken()`, `fork(name,{readOnly,defaultBranchOnly,description})`, `log({ref,limit≤1000,offset})` (first-parent only), `readCommit(sha)`, `readTree(sha)` (immediate children only), `readBlob(sha)`, `readFile({ref,path})` (returns a MIME-typed Blob) |
| REST `api.cloudflare.com/client/v4/accounts/:id/artifacts/namespaces/:ns/...` | CF API token (Artifacts Read or Edit) | Namespaces (create with `jurisdiction`, list, get). Repos: create, list (`limit` ≤ 200, search, sort by created, updated, last_push or name), get, delete (202), fork, import (public HTTPS remote). Content: `/log`, `/commit/:sha`, `/tree/:sha`, `/blob/:sha`, `/file?ref&path`, `/raw/:ref/:path`. Tokens: list, create (TTL **60 s to 31,536,000 s, default 86,400 s**), revoke. |
| Git smart HTTP `https://<ACCOUNT_ID>.artifacts.cloudflare.net/git/<ns>/<repo>.git` | repo token, as Bearer in `http.extraHeader` or as the Basic-auth password (**the username is ignored**) | clone, fetch, pull, push. Token format `art_v1_<40hex>?expires=<unix>`. Scopes: `read` or `write`. |
| Wrangler | | `wrangler artifacts namespaces list/get`, `repos create/list/get/delete/issue-token` |
| Dashboard | | namespaces, repos, files, commits, tokens (2026-06-17) |

**The binding can't write files.** The isomorphic-git example says: "The Artifacts binding creates and manages repos, but it cannot read or write files inside them — for that, you need Git." In practice it can read files but not write them. Writes go through isomorphic-git with an in-memory fs in a Worker, which is subject to the 128 MB isolate memory limit, or through real git in a Sandbox.

### 2.3 Git protocol support (https://developers.cloudflare.com/artifacts/api/git-protocol/)
| Operation | Support |
|---|---|
| clone/fetch (`git-upload-pack`) | **v1 and v2.** v2 has `ls-refs` and `fetch`. v1 supports shallow and deepen fetches; the blog also lists deepen-since and deepen-relative. |
| push (`git-receive-pack`) | **v1 only. v2 receive-pack is not supported.** |
| Optional v1 capabilities | **Partial. `filter` (partial clone) and `include-tag` are not supported.** Git clients ignore an unsupported filter with a warning **[inferred]**. |
| git notes | Supported and recommended for prompts and model output. Push and fetch `refs/notes/*` explicitly. |
| Not documented | Atomic push, SSH, LFS, server-side hooks, protected refs, fetch-by-SHA of unadvertised commits **[verify; `actions/checkout` fetches by SHA]** |

### 2.4 Limits (https://developers.cloudflare.com/artifacts/platform/limits/)
| Limit | Value |
|---|---|
| Control-plane request rate | **2,000 requests per 10 s per namespace** (~200 rps) |
| Git request rate | **2,000 requests per 10 s per repo** |
| Storage per repo | **1 GB** |
| File or blob size | **32 MB** |
| Storage per account | 1 TB (can be raised) |
| Repos and namespaces | Unlimited |
| Names | 2–63 characters (namespace). Must start with a letter or digit, then `[A-Za-z0-9._-]`. |
| Errors of note | `IMPORT_IN_PROGRESS` 10302 and `FORK_IN_PROGRESS` 10303 (returned as 409 Conflict, retriable), `REMOTE_AUTH_REQUIRED` 10106 (**import only works for public HTTPS remotes**), `MEMORY_LIMIT` 10402 |

### 2.5 Pricing (https://developers.cloudflare.com/artifacts/platform/pricing/)
| Unit | Workers Paid (Free plan: unavailable) |
|---|---|
| Operations ("create, push, pull, clone…") | First **10,000 per month free**, then **$0.15 per 1,000** |
| Storage | First **1 GB-month free**, then **$0.50 per GB-month** (average of daily peaks, the same method as DO SQLite). Replicas are not billed. |

Example: 100k agent sessions × 20 ops = 2M ops, which costs about **$300**. **How forks are stored (copy-on-write vs. copied) is undocumented**, and it drives storage cost. Measure it on day 1.

### 2.6 Events and integrations
- **Event subscriptions** (via Queues event subscriptions):
  - Account-level: `cf.artifacts.repo.created`, `.deleted`, `.forked`, `.imported`.
  - Repo-level: `cf.artifacts.repo.pushed` (ref, before, after, a truncatable commit list with author, committer and parents), `.cloned`, `.fetched`, `.token.created`, `.token.revoked`.
  - https://developers.cloudflare.com/artifacts/guides/event-subscriptions/
- **Wrangler `triggers.events`** can start a **Workflow** straight from `cf.artifacts.repo.pushed`, filtered by namespace and optionally by `repoName`. A WfP `dispatch_namespace` target is also supported. https://developers.cloudflare.com/artifacts/guides/build-and-deploy-on-push/
- **`@cloudflare/ci`** (npm 0.2.0, 2026-09-14, Apache-2.0, https://github.com/cloudflare/ci) is "Cloudflare-native continuous integration powered by Workflows and Sandbox". A `CIWorkflow.pipeline()` calls `ci.runner({name, command, cache:{inputs:[lockfiles]}})`. Cached runners **snapshot the sandbox** and later runners branch from that snapshot. Retries come from Workflow step config. This is not GitHub Actions YAML.
- **Workers Builds ↔ Artifacts**: the production branch must be **`main`** (the only option). Other branches get Worker Previews. https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/artifacts-integration/
- **Worker Previews**: up to **500 Previews per Worker** (paid) and 100 deployments per Preview. Each Preview automatically gets its own DO namespace and container instances. Workflows are not per-preview, and queue consumers can't target a Preview. https://developers.cloudflare.com/workers/previews/
- **ArtifactFS** (`github.com/cloudflare/artifact-fs`, Go plus FUSE) starts from a blobless clone and hydrates blobs lazily, prioritizing manifests. The blog says it mounts a 2.4 GB repo in about 10–15 s. Works with any Git remote. https://developers.cloudflare.com/artifacts/guides/artifact-fs/
- **Metrics**: the GraphQL dataset `artifactsEventsAdaptiveGroups` (count, duration quantiles, per repo, eventType, errorMessage), kept 31 days.

### 2.7 Gaps for a GitHub competitor (Beanstalk must build all of these)
PRs and change objects, review records, merge or merge-queue, test-merge commits (`refs/pull/N/merge`), diff and compare APIs, conflict detection, branch protection, rulesets, required checks, server hooks, code search, LFS, SSH, private-repo import (do it with `git push --mirror` from a sandbox), and a file-write API. Access policy has to come from **who receives write tokens**, since tokens are per repo with read or write scope. The natural design: agents push only to their own fork repos, and only Beanstalk's merge service holds write tokens for canonical repos. Shard namespaces so you stay under 200 rps of control-plane traffic each: 100k forks in one namespace take about 500 s, while 50 namespaces take about 10 s.

---

## 3. Compute: Dynamic Workers, Containers, Sandboxes

### 3.1 Workers baseline (https://developers.cloudflare.com/workers/platform/limits/)
On Paid:
- CPU **5 min per request** (default 30 s).
- **128 MB** memory per isolate.
- **10,000 subrequests** by default (configurable up to 10M).
- **6 simultaneous outgoing connections** per request.
- Worker size 64 MiB. **500 Workers per account**; Workers for Platforms has no script cap.
- HTTP wall time unlimited while the client stays connected.
- Cron, Queue consumer and DO alarm invocations get 15 min wall time.

### 3.2 Dynamic Workers / Worker Loader (https://developers.cloudflare.com/dynamic-workers/)
- `env.LOADER.load(code)` creates a one-off Worker; `env.LOADER.get(id, () => code)` creates a reusable one.
- `WorkerCode` fields: `compatibilityDate`, `compatibilityFlags`, `mainModule`, `modules` (js, cjs, py, text, data, wasm, json), `env` (structured-clonable values plus service or loopback bindings), `globalOutbound` (`null` blocks egress, or pass a stub to intercept it), `tails`, `limits: {cpuMs, subRequests}`.
- Isolation is a V8 isolate plus the Workers process sandbox. **No child processes, no native add-ons, partial Node APIs.** Not suitable for `npm test` in general.
- **Concurrency**: at most **4 distinct Dynamic Workers in flight per Worker request** and **10 per Durable Object**. https://developers.cloudflare.com/dynamic-workers/platform/limits/
- **Pricing**: **$0.002 per unique Dynamic Worker per day** (the table lists "1,000 unique Dynamic Workers per month" included; uniqueness is by ID plus code). Requests $0.30/M, CPU $0.02/M ms, including startup CPU. https://developers.cloudflare.com/dynamic-workers/pricing/
- Extras:
  - **Durable Object Facets**: dynamic code with its own isolated SQLite.
  - **Dynamic Workflows** (`@cloudflare/dynamic-workflows`): tenant or agent code that gets durable `step.do`, `sleep` and `waitForEvent`. A good fit for "agent-authored automation".
  - **Code Mode** (`@cloudflare/codemode`): the model writes JS against typed methods.

### 3.3 Containers (https://developers.cloudflare.com/containers/)
**Instance types** (https://developers.cloudflare.com/containers/platform/limits/):

| Type | vCPU | Mem | Disk | Max concurrent per account (binding constraint) |
|---|---|---|---|---|
| lite | 1/16 | 256 MiB | 2 GB | 15,000 (disk) |
| basic | 1/4 | 1 GiB | 4 GB | 6,000 (vCPU) — *not allowed in `ctx.container.start()`* |
| standard-1 | 1/2 | 4 GiB | 8 GB | ~1,536 (memory) |
| standard-2 | 1 | 6 GiB | 12 GB | ~1,024 (memory) |
| standard-3 | 2 | 8 GiB | 16 GB | 750 (vCPU) |
| standard-4 | 4 | 12 GiB | 20 GB | 375 (vCPU) |

- Custom sizes: 1–4 vCPU, ≤ 12 GiB, ≤ 20 GB disk, at least 3 GiB of memory per vCPU.
- Account limits: **6 TiB memory, 1,500 vCPU, 30 TB disk concurrent** (raised 15× on 2026-02-25). **Image size ≤ instance disk**, and **50 GB total image storage** per account. Larger sizes need the account team or a request form.
- **Pricing** (https://developers.cloudflare.com/containers/platform/pricing/): billed per 10 ms of running time.
  - Memory: $0.0000025 per GiB-s (25 GiB-h/month included).
  - CPU: **$0.000020 per vCPU-s of active use** (375 vCPU-min included).
  - Disk: $0.00000007 per GB-s (200 GB-h included).
  - Memory and disk are billed on what's provisioned; CPU only on actual use.
  - Egress: $0.025/GB in NA/EU (1 TB included), $0.04–0.05/GB elsewhere.
  - Worked examples [my math]: a fully busy 10-min job costs about **$0.0215 on standard-2 ($0.0022/min)** and about **$0.067 on standard-4 ($0.0067/min)**. GitHub's Linux 2-core is **$0.006/min** and 4-core **$0.012/min** (https://docs.github.com/en/billing/reference/actions-runner-pricing).
- **Runtime** (https://developers.cloudflare.com/containers/concepts/architecture/):
  - "Each container instance runs in a **Firecracker microVM** with its own kernel and network." **Images must be `linux/amd64`.**
  - Cold start "often in the 1–3 second range", depending on image size and entrypoint.
  - Instances are reachable only through their Durable Object. Inbound traffic must be HTTP via the Worker: **no inbound TCP or UDP from end users**.
  - Can't "Load kernel modules or access host hardware" (https://developers.cloudflare.com/sandbox/sdk/concepts/containers/).
  - Under the `durable_object` policy, "every process has the same Linux capabilities as `root`" (https://developers.cloudflare.com/sandbox/concepts/security/).
  - **No GPUs** are exposed (third-party summary https://www.hivebook.wiki/wiki/cloudflare-containers-workers-native-container-runtime-with-sandbox-sdk; the docs don't mention GPUs). **KVM and nested virtualization aren't documented. Assume they're absent [verify].**
- **Lifetime**:
  - No fixed maximum runtime.
  - On platform stops (host restarts "on an irregular cadence", rollouts) the main process gets **SIGTERM, up to 15 min to exit, then SIGKILL**. "Cloudflare does not guarantee that any container instance will run for a set period."
  - OOM restarts the instance. There's no swap.
  - Sandbox lifetime: after the DO goes idle, `setInactivityTimeout()` keeps the instance alive **up to 6 hours**. "Code that runs inside the instance does not count as activity", so long builds need **DO alarms** as a keep-alive, and the timeout must be re-set after the DO restarts. https://developers.cloudflare.com/sandbox/concepts/lifetime/
- **Disk** is ephemeral and starts fresh from the image. **Snapshots** (`ctx.container.snapshotContainer()`, `durable_object` policy only, public beta) capture the writable root filesystem but not memory, processes, `/run` or mounts. **Max 20 GB.** **30-day TTL, refreshed on restore.** A snapshot is tied to the image version it came from. R2 can be mounted over FUSE, but "not SSD-like performance". https://developers.cloudflare.com/containers/guides/snapshots/
- **Scheduling policies** (https://developers.cloudflare.com/containers/configuration/scheduling-policy/):
  - `default`: one image and instance type per app, with rollouts and `max_instances`. Can pull from Docker Hub, ECR and GAR **without caching**.
  - `durable_object` (**beta**): the DO picks an image or snapshot and a size per `ctx.container.start({image, instance, enableInternet, env, labels, containerSnapshot})`. It allows **up to 100 named images**, which must be **digest-pinned in `registry.cloudflare.com`** (no direct Docker Hub, ECR or GAR), or the managed `cloudflare/debian-trixie` image (Node 24.20). There's no `max_instances`.
  - Container API (https://developers.cloudflare.com/containers/api/durable-object-container/): `exec(cmd[], {env, user, signal, pty, stdout/stderr})`, `monitor()`, `signal()`, `destroy()`, `setInactivityTimeout()`, `getTcpPort()`, `inspect()`, `interceptOutboundHttp/Https/AllOutboundHttp`. `exec` has **no built-in timeout**, and `output()` buffers into DO memory.
- **Egress control** (https://developers.cloudflare.com/containers/configuration/outbound-traffic/):
  - `enableInternet` (the `Container` class allows Internet by default; `ctx.container.start()` requires an explicit value; the Sandbox docs default to **false**), `allowedHosts` and `deniedHosts` (globs), plus `outbound` and `outboundByHost` handlers that run in the Workers runtime with all bindings.
  - **HTTPS interception** (`interceptHttps = true`) injects an ephemeral CA at `/etc/cloudflare/certs/cloudflare-containers-ca.crt`, which you must trust at the entrypoint.
  - **This lets credentials be injected at egress**, so secrets never enter the sandbox.
  - Handlers see only ports 80 and 443. With Internet off, other ports are blocked and DNS answers only covered hosts. With Internet on, other ports bypass the deny lists.
- **Docker-in-Docker** (https://developers.cloudflare.com/containers/faq/#can-i-run-docker-inside-a-container-docker-in-docker): "Yes."
  - Base it on `docker:dind`, with `dockerd --iptables=false --ip6tables=false --ip-forward=false`. Under the `durable_object` policy, dockerd **exits** on startup unless `--ip-forward=false` is set.
  - **Run as root. Rootless Docker does not start.**
  - "Cloudflare Containers do not support iptables manipulation… use the `--network=host` flag with `docker run`… `docker build --network=host`."
  - Built images are lost when the sandbox sleeps.
  - The older 0.x Sandbox DinD guide uses `docker:dind-rootless` as root. Follow the newer FAQ.
- SSH into live containers is supported (DO policy, `ssh` and `authorized_keys`).

### 3.4 Sandbox SDK (https://developers.cloudflare.com/sandbox/)
- `@cloudflare/sandbox` **1.0.0** (npm, released by 2026-09-30) is now a thin layer. **You write the Durable Object** and call `this.ctx.container.*` directly. The 0.x features (sessions, previews, tunnels, backups, code interpreter) either move into your DO code or are dropped. There are no built-in retries or timeouts: wrap commands in coreutils `timeout`. The image must provide every tool you use. https://developers.cloudflare.com/sandbox/sdk/migrate/changes-in-1-0/
- There are two sandbox environments, both reached through your Worker: **Containers** for full Linux, and **Dynamic Workers** for JS against methods you pass in. https://developers.cloudflare.com/sandbox/concepts/
- Guides cover coding agents (Claude Code, Codex, Cursor, Devin, OpenCode), previews on their own hostnames, R2 mounts, snapshots, and "Run tests from a Git repository".
- 0.x note: with HTTP transport each SDK call is a subrequest. Use RPC transport to get around that.

---

## 4. Coordination and storage primitives (key numbers)

| Product | Limits that matter | Pricing (Workers Paid) | Source |
|---|---|---|---|
| **Durable Objects** (SQLite) | Unlimited objects. **10 GB per object.** 2 MB key+value or row. 100 KB SQL statements. 30 s CPU per request by default (configurable to 5 min). WebSocket messages 32 MiB. RPC/HTTP wall time unlimited while connected. Alarms get 15 min. | Requests $0.15/M (1M incl). Duration $12.50/M GB-s (400k incl). Rows read $0.001/M (25B incl). Rows written $1.00/M (50M incl). Storage $0.20/GB-mo (5 GB incl). | https://developers.cloudflare.com/durable-objects/platform/limits/ , /pricing/ |
| **Workflows** | **50,000 concurrent instances per account** (`waiting` instances don't count). **Creation rate 300/s per account and 100/s per workflow.** 2M queued. 10,000 steps by default (up to 25,000). 1 MiB per step result or event. 1 GB state per instance. Sleeps up to 365 d. Completed state kept 30 d. 100 cron schedules per account. | Requests $0.30/M. CPU $0.02/M ms. Storage $0.20/GB-mo. **Steps: 500k/mo incl, then $0.80 per 100k.** | https://developers.cloudflare.com/workflows/reference/limits/ , /pricing/ |
| **Queues** | 10,000 queues. **128 KB per message.** **5,000 msg/s per queue.** Batches of 100. Retention up to 14 d. 25 GB backlog. 250 concurrent push consumers. 15 min consumer wall time. `delaySeconds` up to 24 h. | $0.40/M ops (1M incl). Messages over 64 KB count double. | https://developers.cloudflare.com/queues/platform/limits/ |
| **K2** (new durable log, public beta) | 10 GB per account during beta. **20 streams per account.** Retention 1 h–30 d (default 7 d). 5 MB per request, ~1 MB per record. Subscriptions can be shared or fan-out. | n/a (beta) | https://developers.cloudflare.com/k2/platform/limits/ |
| **R2** | Unlimited storage. 5 TiB objects (5 GiB single-part). 1M buckets. **1 write/s per key.** | $0.015/GB-mo. Class A $4.50/M, Class B $0.36/M. **Egress free.** | https://developers.cloudflare.com/r2/platform/limits/ , /pricing/ |
| **D1** | **50,000 databases per account. 10 GB each.** 1 TB per account. 30 s per query. 30-day Time Travel. | Rows read $0.001/M (25B incl). Rows written $1.00/M (50M incl). Storage $0.75/GB-mo (5 GB incl). | https://developers.cloudflare.com/d1/platform/limits/ |
| **KV** | 1 write/s per key. 25 MiB values. Eventually consistent (min `cacheTtl` 30 s). | n/a | https://developers.cloudflare.com/kv/platform/limits/ |

Design notes: agent push storms go into Queues before Workflows, because of the 300/s creation cap. Use one DO per repo, branch, concurrency group or merge queue to serialize. Store logs, caches and artifacts in R2. Use K2 for an append-only activity feed. Capacity caveat: K2 is limited to 20 streams per account.

---

## 5. Other Cloudflare services relevant to Beanstalk

- **Browser Run** (formerly Browser Rendering, https://developers.cloudflare.com/browser-run/limits/):
  - Paid limits: 200 concurrent browsers per account and 3 new per second. Idle timeout is 60 s; `keep_alive` extends it to 10 min.
  - Pricing: **10 browser-hours per month included, then $0.09/h**, and **10 concurrent browsers (monthly average) included, then $2 each**.
  - Use: screenshot or UI-diff review of Preview deployments for agents and reviewers.
- **Workers for Platforms** (https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/pricing/):
  - $25/mo. 20M requests and 60M CPU-ms included. **1,000 scripts included, then $0.02 per script.** No limit on scripts.
  - The pricing page says "Max of 30 seconds of CPU time per invocation".
  - Dispatch namespaces and outbound Workers. Isolation: `caches.default` is disabled, and up to 8 tags per script.
  - Use: deploy per-agent or per-branch user apps. Artifacts triggers can target `dispatch_namespace`.
- **Access / OAuth**:
  - **`@cloudflare/workers-oauth-provider` v1.2.1** (https://github.com/cloudflare/workers-oauth-provider). OAuth 2.1 provider for Workers, with split `OAuthProvider` (authorization server) and `OAuthResourceServer` roles. Pre-registered clients, **CIMD and DCR**, PKCE, token exchange, RFC 9728 metadata, and the MCP authorization 2026-07-28 spec. Needs a `OAUTH_KV` namespace. "Tokens, codes and secrets are stored only as hashes; `props` are encrypted."
  - Cloudflare Access can act as the OAuth or SSO provider for MCP servers and can protect Previews. https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/
  - The Zero Trust free tier covers up to 50 users (third-party source).
- **Agents SDK / MCP** (https://developers.cloudflare.com/agents/platform/limits/):
  - Up to "tens of millions+" concurrent agents per account.
  - **1 GB state per agent.**
  - **30 s compute per request or message**, refreshed with each one.
  - Includes sub-agents (`subAgent()`), the Think harness, Code Mode, an MCP client and server via handler APIs (the `McpAgent` class is now **deprecated and feature-frozen**), and Streamable HTTP transport.
  - Use: an agent-facing MCP server for Beanstalk ("claim task, open change, request review…") with one Code Mode tool.

---

## 6. GitHub Actions portability

### 6.1 Who does what in real GitHub Actions
- **Server (GitHub "Actions service")**:
  - Event → workflow selection (`on:` filters) and parsing.
  - Job-level expression evaluation: `if`, `runs-on`, `strategy`, `concurrency`, `environment`, `env`.
  - Matrix expansion (≤ 256 jobs), `needs` graph and outputs.
  - Reusable workflow expansion: **≤ 10 levels of nesting and ≤ 50 workflows per run** since 2025-11 (https://github.blog/changelog/2025-11-06-new-releases-for-github-actions-november-2025/).
  - Concurrency groups (`queue: max` lets up to 100 wait; https://github.blog/changelog/2026-05-07-github-actions-concurrency-groups-now-allow-larger-queues/).
  - Environments and protection rules, secrets and vars resolution, minting **GITHUB_TOKEN** (a GitHub App installation token scoped by `permissions:`), and minting the job runtime token.
  - Runner matching and scheduling, action resolution and tarball URLs, logs, check runs, annotations, summaries, artifacts, cache, and OIDC.
- **Runner (`actions/runner`, C#)**:
  - Step-level expressions, including `hashFiles`.
  - Running `run:` steps in shells, plus JS actions (node20/node24 from the runner's externals), composite actions and Docker actions.
  - Container jobs and service containers via the Docker CLI.
  - Workflow commands (`GITHUB_ENV`, `OUTPUT`, `PATH`, `STEP_SUMMARY`, `::add-mask::`, `::error::` annotations, problem matchers), log streaming, and job completion.

So "running Actions unmodified" means rebuilding the server and providing a compatible runner environment.

### 6.2 The runner protocol (what a server must emulate for the official runner)
- **Registration**: `config.sh --url … --token <registration token>`, where the token comes from `POST /repos/{o}/{r}/actions/runners/registration-token`. Or use **JIT**: `POST /repos/{o}/{r}/actions/runners/generate-jitconfig` (also org-level) with `{name, runner_group_id, labels[1..100], work_folder}`, which returns `encoded_jit_config` for `./run.sh --jitconfig`. `--ephemeral` makes the runner take one job. https://docs.github.com/en/rest/actions/self-hosted-runners
- **Credentials**: the config contains an RSA key. The runner signs a JWT and exchanges it at the authorization URL for an OAuth bearer token. The config fields include `ServerUrl`, `ServerUrlV2` and `UseV2Flow`. Depot's walkthrough: https://depot.dev/blog/github-actions-runner-architecture-part-1-the-listener
- **Broker (V2 flow)** (`src/Sdk/WebApi/WebApi/BrokerHttpClient.cs`): `POST {ServerUrlV2}/session`, then a long poll on `GET /message?sessionId=…&status=Online&runnerVersion&os&architecture&disableUpdate` (held about 50 s, 202 when empty), plus `/acknowledge`. Message types include `RunnerJobRequest`, with a body carrying `runner_request_id` and `run_service_url`, as well as cancellation, refresh, broker-migration and others.
- **Run service** (`src/Sdk/RSWebApi/RunServiceHttpClient.cs`): `POST {run_service_url}/acquirejob` returns the full `AgentJobRequestMessage`. It contains steps as template tokens, `ContextData` (github, needs, strategy, matrix…), `Variables`, `MaskHints`, `JobContainer`, `JobServiceContainers`, `Resources.Endpoints` (SystemVssConnection with the access token and data such as CacheServerUrl, ResultsServiceUrl, GenerateIdTokenUrl and PipelinesServiceUrl), `Snapshot` (custom images) and `FileTable`. The runner must acquire within about 2 minutes. `renewjob` runs every minute (the lock lasts about 10 min). `completejob` carries result, outputs, step results and annotations.
- **Launch service**: `POST /actions/build/{planId}/jobs/{jobId}/runnerresolve/actions` resolves `uses:` into tarball download info (`src/Sdk/WebApi/WebApi/LaunchHttpClient.cs`).
- **Results service** (Twirp, `ResultsHttpClient.cs`): `results.services.receiver.Receiver/{GetStepSummarySignedBlobURL, CreateStepSummaryMetadata, GetStepLogsSignedBlobURL, CreateStepLogsMetadata, GetJobLogsSignedBlobURL, CreateJobLogsMetadata, GetJobDiagLogsSignedBlobURL}` and `github.actions.results.api.v1.WorkflowStepUpdateService/WorkflowStepsUpdate`. Uploads use Azure Block or Append Blob semantics, and live logs go over a WebSocket ("liveConsoleFeedUrl").
- **Step runtime environment** (`NodeScriptActionHandler.cs`): `ACTIONS_RUNTIME_URL`, `ACTIONS_RUNTIME_TOKEN`, `ACTIONS_CACHE_URL` (v1), `ACTIONS_RESULTS_URL` (v2 cache and v4 artifacts), `ACTIONS_CACHE_SERVICE_V2`, `ACTIONS_CACHE_MODE`, `ACTIONS_ID_TOKEN_REQUEST_URL` and `_TOKEN`, plus `GITHUB_SERVER_URL`, `GITHUB_API_URL`, `GITHUB_GRAPHQL_URL` and `GITHUB_TOKEN`.
- **Legacy (V1) flow**: Azure DevOps-style `_apis/connectionData` location service with GUID resource IDs, `_apis/distributedtask/...` pools, sessions, messages, timelines, logs and `actiondownloadinfo`.
- **Hosts the runner talks to**: `github.com`, `api.github.com`, `*.actions.githubusercontent.com` (broker, run, pipelines, OIDC), `codeload.github.com`, `results-receiver.actions.githubusercontent.com`, `*.blob.core.windows.net`, and the update hosts. Outbound 443 only. https://docs.github.com/en/actions/reference/runners/self-hosted-runners
- **Extension points**:
  - **Container hooks** (`ACTIONS_RUNNER_CONTAINER_HOOKS` points at a JS file implementing `prepare_job`, `cleanup_job`, `run_container_step` and `run_script_step`) replace the runner's Docker calls. They're gated by the server feature flag `DistributedTask.AllowRunnerContainerHooks`. ADR: https://github.com/actions/runner/pull/1891 ; implementations: https://github.com/actions/runner-container-hooks
  - Job-started and job-completed hooks (ADR 1751).
  - `RUNNER_ALLOW_RUNASROOT=1` lets the runner run as root.
  - The official image `actions/runner/images/Dockerfile` is built on dotnet `runtime-deps:8.0-noble` and adds the docker CLI 29.x, buildx, sudo, git and a `runner` user (uid 1001).
- **Proof that the server can be emulated**: **ChristopherHX/runner.server** (MIT, active 2026-09) is a fork of actions/runner that adds `Runner.Server`, "a runner backend like github actions", which the official runner connects to. https://github.com/ChristopherHX/runner.server

### 6.3 Reimplementations and alternatives
| Project | What it replaces | How | Gaps and lessons |
|---|---|---|---|
| **nektos/act** (72k★, MIT) | Server and runner, for local use | A Go engine runs each job in Docker (catthehacker images) or on the host (`-P label=-self-hosted`). Built-in cache server (v1) and artifact server (v3 and **v4**, PR #2224). Sets `GITHUB_SERVER_URL=https://github.com` by default (the `--github-instance` default), so the v4 GHES gate passes **[inferred]**. | Ignores `concurrency`, `run-name`, step summary, problem matchers, annotations, `permissions`, `timeout-minutes`, `continue-on-error` and `environment`. Incomplete `github` context. **No OIDC URL.** Node must be on PATH. https://nektosact.com/not_supported.html . The "full" image is a filesystem dump of GitHub's runner and is **over 18 GB** (https://nektosact.com/usage/runners.html). |
| **Gitea Actions plus act_runner** | Server | Go server using a fork of act's jobparser. The runner protocol is connect-RPC `runner.v1.RunnerService/{Register, Declare, FetchTask, UpdateTask, UpdateLog}`. A `Task` carries the expanded single-job YAML, the github context, secrets, needs and vars (https://gitea.com/gitea/actions-proto-def). | `environment` is ignored. Problem matchers and annotations are ignored. Expressions are limited. Complex `runs-on` is restricted. Tokens can't publish packages. https://docs.gitea.com/usage/actions/comparison . **`upload-artifact@v4` fails with `GHESNotSupportedError`**, so users switch to forks such as `christopherhx/gitea-upload-artifact` (https://github.com/go-gitea/gitea/issues/36024). |
| **Forgejo Actions plus forgejo-runner** | Server | Same lineage. Docker, LXC and host backends. | Supports concurrency (best-effort), **OIDC (`enable-openid-connect`)**, services, container jobs, reusable workflows (no cross-instance expansion), matrix, `timeout-minutes` and `continue-on-error`. https://forgejo.org/docs/latest/user/actions/reference/ |
| **ChristopherHX/github-act-runner** | Runner | Implements GitHub's runner protocol in Go on top of act | Inherits act's gaps |
| **Blacksmith** | Compute only (GitHub stays the orchestrator) | Bare-metal gaming CPUs plus NVMe, with **one Firecracker VM per job**. **Transparent cache**: an NGINX proxy in the VM plus nftables and DNS remapping, Twirp v2, and Azure-like URLs translated to MinIO. The toolkit "skips… concurrency optimizations" when the hostname isn't `blob.core.windows.net`. Reports about 327 MB/s cache downloads. | https://www.blacksmith.sh/blog/cache |
| **Depot** | Compute | EC2 standby pools, one per AMI, which brings start time to about **5 s** (a fresh EC2 boot takes up to 55 s). Uses `workflow_job` webhooks. Evaluated Firecracker but rejected it on IOPS. Depot Cache. | https://depot.dev/blog/github-actions-breaking-five-second-barrier |
| **Namespace** | Compute | Its own datacenter. **Cache Volumes**: jobs are scheduled onto nodes that already hold the cache revision. macOS M-series. | https://namespace.so/blog/so-you-want-to-build-your-own-datacenter |
| **Ubicloud** | Compute | Bare-metal VMs. **Transparent cache** behind `actions/cache` and `setup-*` (its cache actions are deprecated). About $0.0012–0.0016/min. | https://www.ubicloud.com/blog/ubicloud-premium-runners-40-faster-builds-10x-larger-cache |
| **RunsOn** | Compute, in your own AWS account | EC2 plus an S3 "magic cache" sidecar that intercepts cache requests | https://github.com/runs-on/runs-on |
| **WarpBuild** | Compute | Ephemeral VMs plus **snapshots** of full VM state, priced per restore | https://latchkey.dev/learn/runners/warpbuild-runners-explained |
| **BuildJet** | — | **Shut down**: no signups after 2026-02-06 and no jobs after **2026-03-31** | https://latchkey.dev/learn/runners/buildjet-alternatives |
| **GitHub `ubuntu-slim`** | GitHub's own container runner | 1 vCPU, 5 GB RAM. Runs "inside of a container rather than a dedicated VM", with "hypervisor level 2 isolation". **15-minute job cap. No Docker, so `container:` jobs don't work.** $0.002/min. | https://github.blog/changelog/2026-01-22-1-vcpu-linux-runner-now-generally-available-in-github-actions/ , https://github.com/actions/runner-images/issues/13541 |

Lessons:
- High-fidelity compute vendors all run **full VMs with GitHub's image** and **intercept cache and blob traffic transparently**.
- The open-source control-plane reimplementations all **drop or approximate** annotations, problem matchers, environments, permissions and the v4 artifacts gate.
- GitHub's own container runner simply leaves out Docker.

### 6.4 The runner image
- GitHub-hosted standard Linux: **public repos get 4 vCPU, 16 GB RAM, 14 GB SSD; private repos get 2 vCPU, 8 GB.** Arm64 labels: `ubuntu-24.04-arm` and `-22.04-arm`. `ubuntu-latest` moves to **26.04 in November 2026**. **Passwordless sudo.** https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- The Ubuntu 24.04 image (image version 20260927, kernel 6.17 azure, **systemd 255**; https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md) ships with:
  - Multiple Clang and GCC versions, Julia, Kotlin, Node 22, Python 3.12, Ruby, Swift 6.4, Java, PHP, Haskell, Rust, Go and PyPy toolcaches, and .NET.
  - **Docker server and client 28.0.4, Compose 2.38, Buildx, Podman, Buildah, Kind, Minikube** and kubectl.
  - AWS, Azure, GCloud and gh CLIs.
  - Chrome, Firefox and Edge plus their drivers.
  - **PostgreSQL 16 and MySQL 8, disabled by default, so users run `sudo systemctl start postgresql.service`.**
  - Apache and nginx (inactive), and the Android SDK.
- The full image doesn't fit a 20 GB CF instance, since the catthehacker full dump alone is over 18 GB.
- **Plan**: a slim image (official `actions-runner` base plus dockerd plus git, node, python and build-essential, about 1–3 GB) and rely on `setup-*` actions or tool-cache downloads. Optionally build per-repo **"warm" snapshots** (CF snapshots ≤ 20 GB, the same idea as GitHub's custom images, GA 2026-03-26: https://github.blog/changelog/2026-03-26-custom-images-for-github-hosted-runners-are-now-generally-available/).

### 6.5 Docker-dependent features on CF DinD
- **Service containers** (`services:`): when a job uses `container:` or `services:`, the runner runs `docker network create github_network_<id>` (`ContainerOperationProvider.cs`) and starts the services with network aliases and health checks.
  - If the job runs on the host, it reaches services at `localhost:<mapped port>`.
  - If the job runs in a container, it reaches them by the service label as hostname.
  - CF has no iptables, so there's no NAT, so bridge networks have **no egress**. Inter-container traffic on a bridge and docker-proxy port publishing *may* still work, depending on whether the guest kernel has bridge and veth **[verify]**.
  - Robust shim: a docker-CLI wrapper or container hooks that turn the network into `--network host`, add `/etc/hosts` aliases pointing to `127.0.0.1`, and report container ports as mapped ports. Two services on the same port would conflict.
- **Container jobs** (`container:`): the runner runs `docker create` with workspace and externals mounts and `docker exec`s every step. This works inside DinD, because the mounts come from the same VM filesystem. Internet access from the job container needs host networking (the same shim).
- **Docker actions** (`runs.using: docker`, `uses: docker://img`): the runner does `docker build` or `pull` and then `run --network github_network…`. Shim: `--network host`, and `docker build --network=host`.
- **buildx**: the `docker/setup-buildx-action` default `docker-container` driver runs privileged BuildKit on a bridge, so it has no egress. Shim: `driver-opts: network=host`, or use the `docker` driver.
- **compose, kind, minikube, k3d**: compose needs bridge networks unless rewritten to host networking, so it's hard. Kind and minikube need nested privileged containers **plus iptables in node network namespaces (kube-proxy, CNI)**, so they're likely impossible **[verify]**.
- **Image pulls**: the `durable_object` policy can't start arbitrary Docker Hub images as *sibling* CF containers (CF registry only). Pull inside DinD instead. Docker Hub's anonymous limit is **100 pulls per 6 h per IPv4 or /64** (https://docs.docker.com/docker-hub/usage/), and CF egress IPs may be shared. Use an authenticated pull-through mirror backed by R2.

### 6.6 Cache and artifacts protocols and the GHES gate
- **Cache**: `@actions/cache` (actions/toolkit `packages/cache/src/internal/config.ts`) picks **v2 only if `ACTIONS_CACHE_SERVICE_V2` is set *and* `GITHUB_SERVER_URL` host is `github.com`, `*.ghe.com` or `*.localhost`**. Otherwise it treats the host as GHES and uses **v1**.
  - **v1 REST** at `ACTIONS_CACHE_URL` + `_apis/artifactcache/`: `GET cache?keys=&version=` returns `archiveLocation`, `POST caches` reserves, `PATCH caches/{id}` uploads with `Content-Range`, and `POST caches/{id}` commits.
  - **v2 Twirp** at `ACTIONS_RESULTS_URL` + `/twirp/github.actions.results.api.v1.CacheService/{CreateCacheEntry, FinalizeCacheEntryUpload, GetCacheEntryDownloadURL}`, with signed Azure-Blob URLs.
  - GitHub's limit is 10 GB of cache per repo and 200 uploads per minute.
  - Implementing v1 or v2 on Worker plus R2 is well trodden: act, Gitea, Blacksmith, and falcondev-oss/github-actions-cache-server.
- **Artifacts v4**: `@actions/artifact`, used by `upload-artifact@v4+` and `download-artifact@v4+`, calls Twirp `github.actions.results.api.v1.ArtifactService/{CreateArtifact, FinalizeArtifact, ListArtifacts, GetSignedArtifactURL, DeleteArtifact}` and then uploads 8 MB chunks through the Azure Blob SDK to the signed URL. **It throws `GHESNotSupportedError` for any `GITHUB_SERVER_URL` host other than github.com, `*.ghe.com` or `*.localhost`** (`packages/artifact/src/internal/client.ts`). The v3 actions use `ACTIONS_RUNTIME_URL` pipelines APIs and are deprecated on github.com.
- **Shim options** for "unmodified":
  - (a) Present `GITHUB_SERVER_URL=https://<x>.localhost`, map it in `/etc/hosts` to an in-VM reverse proxy that forwards to Beanstalk, and trust a local CA (`NODE_EXTRA_CA_CERTS` as well). Caveat: curl and git resolve `*.localhost` to loopback by themselves, which is fine with a loopback proxy.
  - (b) **Present `https://github.com`** and use CF **`interceptHttps` outbound handlers** to serve github.com, api.github.com, *.actions.githubusercontent.com and blob URLs from Beanstalk, passing unknown repos through to real GitHub. This has the highest fidelity: v2 cache, v4 artifacts and `isGhes()==false` everywhere. It is confusing, though, for workflows that really talk to github.com.
  - (c) Rewrite `uses:` to compatible forks. This modifies the workflow.

### 6.7 Identity
- **GITHUB_TOKEN**:
  - It's a GitHub App installation token for the repo. It expires at job end, or at most 6 h on hosted and 24 h on self-hosted runners.
  - Events it triggers **don't start new runs**, except `workflow_dispatch` and `repository_dispatch`. PR events it triggers now start runs in an approval-required state.
  - Scopes: `actions, artifact-metadata, attestations, checks, code-quality, contents, deployments, discussions, id-token, issues, packages, pages, pull-requests, security-events, statuses, vulnerability-alerts`.
  - Rate limit: 1,000 requests per hour per repo (15,000 on Enterprise Cloud).
  - Fork PRs get a read-only token and no secrets.
  - https://docs.github.com/en/actions/concepts/security/github_token , https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
  - Beanstalk mints its own scoped token. Actions use `GITHUB_API_URL` and GraphQL through octokit, so you need a **GitHub-compatible REST API subset**: contents, git refs/trees/blobs/commits, pulls, issues and comments, checks, statuses, releases, deployments, actions artifacts and caches. **GraphQL** matters for `gh` and some actions. `actions/checkout` sends `AUTHORIZATION: basic base64(x-access-token:<token>)` to `${GITHUB_SERVER_URL origin}/${owner}/${repo}` and **drops any path prefix**. That means a Worker Git proxy at the domain root has to map to `…artifacts.cloudflare.net/git/<ns>/<repo>.git` and swap in an Artifacts token. Because Artifacts ignores the Basic username, the token swap is trivial.
- **OIDC**: the issuer is `https://token.actions.githubusercontent.com` with `/.well-known/openid-configuration`. The job needs `permissions: id-token: write`. Tokens are fetched with `ACTIONS_ID_TOKEN_REQUEST_URL&audience=…` using a Bearer `ACTIONS_ID_TOKEN_REQUEST_TOKEN`. Claims: `sub` (`repo:OWNER/REPO:ref:refs/heads/BRANCH`; repos created after 2026-07-15 use the immutable form `repo:OWNER@OWNER-ID/REPO@REPO-ID:…`), `aud`, `repository`, `repository_owner`, `ref`, `sha`, `workflow`, `job_workflow_ref`, `environment`, `run_id`, `actor` and `runner_environment`. https://docs.github.com/en/actions/reference/security/oidc . Beanstalk can run its own issuer with a JWKS from a Worker and mirror the claim shapes. **Users must add Beanstalk as a new IdP in AWS, GCP or Azure.** GitHub's issuer can't be impersonated.

### 6.8 Server-side semantics (all implementable in Workers, Durable Objects and Workflows)
- **Parsing and expressions**: the official MIT TypeScript libraries **`@actions/workflow-parser`** and **`@actions/expressions`** (v0.3.61, 2026-08, actions/languageservices) run in Workers. Use them for workflow templates, job-level expressions, matrix, and `fromJSON`-driven dynamic matrices.
- **Matrix**: ≤ 256 jobs, `include`, `exclude`, `fail-fast`, `max-parallel`.
- **needs and outputs, `if`, `continue-on-error`, `timeout-minutes`** (default 360).
- **Reusable workflows**: local, cross-repo, and repos on GitHub (fetched over the API), with `secrets: inherit`.
- **Concurrency**: `group`, `cancel-in-progress`, and `queue: single|max` (up to 100 queued). A DO per group fits well.
- **Events**: synthesize **GitHub-shaped webhook payloads** for `push`, `pull_request` (including `refs/pull/N/merge` **test-merge commits** Beanstalk must create), `workflow_dispatch`, `schedule` (a central scheduler DO, since Workflows has 100 cron schedules and Workers 250), `workflow_run`, `merge_group`, `issue_comment`.
- **Environments**: secrets, required reviewers (humans or agents), wait timers, branch policies.
- **Limits to copy**: 6 h hosted and 5 d self-hosted jobs, 35-day runs, a 24 h self-hosted queue, 500 KB workflow files. https://docs.github.com/en/actions/reference/limits

### 6.9 Compatibility matrix (Linux jobs on CF Containers/Sandbox with a Beanstalk control plane)
Legend:
- **W**: works with no special handling.
- **S**: works with a shim Beanstalk owns. The workflow YAML stays unmodified.
- **H**: hard. A large build effort, partial fidelity, or unverified platform behaviour.
- **X**: impossible on CF compute. Route it to a bring-your-own (BYO) runner.

| Feature | Rating | Notes |
|---|---|---|
| `run:` steps in bash or sh, with Python and Node installed | W | Root-capable VM with sudo. Build the image accordingly. |
| JS actions (node20/node24), composite actions, local `./` actions | W | The official runner handles these. Action tarballs come from Launch-style resolution: serve from Artifacts or R2, or proxy to codeload.github.com with an injected GitHub token. |
| Workflow commands (`GITHUB_ENV`, `OUTPUT`, `PATH`, `STATE`, masking, grouping) | W | Runner-side |
| Annotations, problem matchers, step summaries | S | The runner produces them. Beanstalk must implement Results and completejob ingestion. Act and Gitea ignore them. |
| Live logs | S | Results upload plus the WebSocket feed, fanned out through a DO |
| `actions/checkout` (shallow, by SHA, submodules) | S | A Worker Git proxy at `/<owner>/<repo>` maps to the Artifacts remote and swaps the token. Fetch-by-SHA support **[verify]**. `filter` and sparse checkout fall back to a full fetch. |
| Checkout with `lfs: true` | H | No LFS in Artifacts (and 32 MB blobs). Needs an LFS batch API on R2. |
| Checkout over SSH (`ssh-key`) | X / H | No inbound TCP or SSH Git endpoint |
| Matrix, needs, outputs, `if`, `continue-on-error`, `timeout-minutes` | S | Server-side with `@actions/*` libraries |
| Reusable workflows (10 levels, 50 per run) | S | Fetch from Beanstalk or GitHub |
| `concurrency` (`group`, `cancel-in-progress`, `queue: max`) | S | DO per group |
| Events: push, pull_request, workflow_dispatch, schedule, workflow_run | S | Synthesize GitHub payloads and test-merge refs |
| GitHub-only events (discussions, registry_package, dependabot, security) | H | No equivalent domain objects |
| Secrets, vars, environments, required reviewers | S | Beanstalk-native, plus egress credential injection where possible |
| `permissions:` and GITHUB_TOKEN scopes | S | Map to Beanstalk token scopes |
| Actions calling the REST API (octokit via `GITHUB_API_URL`) | S / H | Common endpoints are S. Full coverage is H. |
| `gh` CLI and GraphQL-based actions | H | Needs a GraphQL subset and `GH_HOST` handling |
| `actions/cache` | S | v1 REST on Worker plus R2, or v2 Twirp if the server URL presents as github.com or `*.localhost` |
| `upload-artifact@v4+` / `download-artifact@v4+` | H | **GHES gate.** Needs the github.com-impersonation or `*.localhost` shim plus Twirp and Azure-Blob emulation on R2. Otherwise the YAML must change. |
| OIDC (`id-token: write`) | S (re-config) | Beanstalk issuer. Cloud trust policies must change. Truly unmodified cloud trust is **X**. |
| `services:` (Postgres, Redis…) | S / H | Host networking, `/etc/hosts` aliases and port rewriting. Health checks work. Port collisions possible. Bridge behaviour **[verify]**. |
| `container:` jobs | S / H | DinD works. Egress needs host networking. |
| Docker container actions, `docker://` steps | S | `--network host` and `build --network=host` |
| `docker build` / `buildx` / `build-push-action` | S | Default dockerd driver, or `network=host` driver opts. Layer cache lost on stop, so use registry or R2 cache or snapshots. |
| `docker compose` with custom networks | H | Rewrite to host networking or accept no egress |
| kind, minikube, k3d, Kubernetes-in-Docker | H → likely X | Needs iptables in nested network namespaces **[verify]** |
| `sudo systemctl start postgresql` (preinstalled services) | S | No systemd as PID 1. Add a `systemctl` shim (e.g. docker-systemctl-replacement) or preinstall service scripts. |
| Preinstalled toolchain expectations (Chrome, az, gcloud, Android SDK…) | S / H | A slim image misses them. `setup-*` actions work. Bigger images are capped at 20 GB (instance disk). |
| Playwright or browsers | S | Install with deps. May need a larger `/dev/shm` (root can remount). |
| Jobs needing > 4 vCPU, > 12 GiB RAM, > ~15 GB free disk | H / X | CF caps at standard-4 unless the account team raises it. Spill to R2 FUSE (slow). |
| Long jobs (multi-hour) | H | No hard cap, but host restarts give SIGTERM plus 15 min. Needs DO alarm keep-alive (inactivity cap is 6 h), checkpointing and auto-retry. |
| `runs-on: ubuntu-*` x64 | S | Map labels to instance types or images |
| `runs-on: ubuntu-*-arm` (arm64) | X (H via QEMU) | amd64 only. binfmt and QEMU depend on guest kernel support **[verify]** and are slow. |
| Windows and macOS runners | X | BYO runner via the emulated protocol |
| GPU runners | X | No GPUs exposed |
| KVM: Android emulator, nested VMs, Vagrant, Firecracker-in-CI | X | `/dev/kvm` not exposed **[verify]** |
| Inbound connections to the job (webhook receivers, `nc -l` from the internet) | H | Only HTTP via Worker or DO. Outbound tunnels work. |
| Egress-heavy jobs (big pulls and downloads) | S | $0.025/GB after 1 TB in NA/EU. Add R2-backed npm, PyPI and OCI mirrors via outbound handlers. |
| Concurrency at swarm scale | H | 1,500 vCPU per account means about 750 standard-3 jobs at once. Tier checks: Dynamic Workers for lint and static checks, containers for full CI, warm snapshots. |
| Self-hosted runner registration and JIT (external machines) | S / H | Emulate broker, run, launch and results. runner.server proves it can be done. The protocol is undocumented and moves, so pin the runner version and use `--disableupdate`. |

### 6.10 Recommended approach for Beanstalk
1. **Control plane (Workers, DOs, Workflows, Queues)**:
   - Artifacts `cf.artifacts.repo.pushed` goes to a Queue, then into a "WorkflowRun" orchestrator (a DO or a CF Workflow instance per run).
   - Parse with `@actions/workflow-parser` and evaluate with `@actions/expressions`.
   - Expand matrix, needs and reusable workflows, and apply concurrency DOs.
   - Run a job scheduler that maps `runs-on` to instance size.
2. **Data plane**: one **CF Container per job** (Firecracker, ephemeral), under the `durable_object` policy, with a digest-pinned image. The image combines the official runner image, `dockerd --iptables=false --ip6tables=false --ip-forward=false`, and a docker-CLI or container-hook network shim. Keep it alive with DO alarms. Use snapshots for warm, dependency-cached images per repo and lockfile, as `@cloudflare/ci` does. Use outbound handlers to route `beanstalk`, `github` and registry hosts to Workers and to inject credentials.
3. **Runner choice**:
   - **Fast path for the competition**: run **nektos/act** or **forgejo-runner `exec`** inside the sandbox in host mode, fed with a synthesized event payload. act already passes the v4 artifacts gate by presenting github.com and has built-in cache and artifact servers. Expect act's documented gaps.
   - **High-fidelity path, after the competition**: emulate GitHub's runner service (broker, run, launch, results, Twirp cache and artifacts, OIDC issuer) so the **unmodified official `actions/runner`** works, both on CF and on **BYO macOS, Windows, GPU and arm64 machines**.
4. **Agent-first extras**: annotations, step summaries and job logs become structured feedback for agents (MCP tools). Required checks feed a Beanstalk merge queue DO. Previews (Workers Previews and WfP) and Browser Run screenshots support review.

### 6.11 Day-1 experiments
- In a `durable_object`-policy container with DinD, check whether `docker network create` and bridge container-to-container traffic work, whether `-p` publishing works, and whether `/dev/kvm`, `binfmt_misc`, `/dev/fuse` and nftables are present.
- Check whether Artifacts allows `git fetch origin <sha>` for an unadvertised SHA (the `actions/checkout` path), what happens with `--filter=blob:none`, whether `--atomic` push works, and push throughput under contention.
- Measure fork latency and storage: is it copy-on-write or a copy? Measure the cost of 1,000 forks.
- Measure end-to-end CI latency: cold start plus clone plus install, with and without snapshot restore.
- Check isomorphic-git merge in a Worker against a 1 GB repo limit and 128 MB memory. Decide where test-merge commits are computed: Worker or sandbox.

---

## 7. Source index (primary)
- Competition: https://www.cloudflare.com/git-competition/ · rules PDF https://www.cloudflare.com/documents/build-next-gen-git-platform-competition-terms.pdf · https://www.cloudflare.com/git-competition/submit · https://blog.cloudflare.com/next-git-platform-on-cloudflare/
- Artifacts: https://developers.cloudflare.com/artifacts/llms.txt (all pages fetched) · https://blog.cloudflare.com/artifacts-git-for-agents-beta/ · https://github.com/cloudflare/ci · https://github.com/cloudflare/artifact-fs
- Containers: https://developers.cloudflare.com/containers/platform/limits/ · /platform/pricing/ · /concepts/architecture/ · /faq/ · /configuration/scheduling-policy/ · /guides/snapshots/ · /guides/image-management/ · /configuration/outbound-traffic/ · /api/durable-object-container/ · https://developers.cloudflare.com/changelog/post/2026-02-25-higher-container-resource-limits/ · https://developers.cloudflare.com/changelog/post/2026-04-13-containers-sandbox-ga/
- Sandbox: https://developers.cloudflare.com/sandbox/ · /concepts/ · /concepts/lifetime/ · /concepts/security/ · /sdk/guides/docker-in-docker/ · /sdk/migrate/changes-in-1-0/
- Dynamic Workers: https://developers.cloudflare.com/dynamic-workers/ · /platform/limits/ · /pricing/ · /usage/limits/ · /usage/dynamic-workflows/ · /api-reference/
- Workers, DO, Workflows, Queues, R2, D1, KV, K2, Browser Run, WfP, Agents: the limits and pricing pages linked in §4–5
- GitHub: https://docs.github.com/en/actions/reference/limits · /runners/github-hosted-runners · /runners/self-hosted-runners · https://docs.github.com/en/rest/actions/self-hosted-runners · /security/oidc · /concepts/security/github_token · /workflows-and-actions/workflow-syntax · https://docs.github.com/en/billing/reference/actions-runner-pricing
- Runner source: https://github.com/actions/runner (BrokerHttpClient.cs, RunServiceHttpClient.cs, LaunchHttpClient.cs, ResultsHttpClient.cs, NodeScriptActionHandler.cs, ContainerOperationProvider.cs, AgentJobRequestMessage.cs, images/Dockerfile, docs/adrs/1891-container-hooks.md) · https://github.com/actions/runner-container-hooks
- Toolkit source: https://github.com/actions/toolkit (packages/cache/src/internal/config.ts, cacheHttpClient.ts, generated cache.twirp-client.ts; packages/artifact/src/internal/shared/config.ts, internal/client.ts) · https://github.com/actions/checkout (src/url-helper.ts, git-auth-helper.ts) · https://github.com/actions/languageservices
- Alternatives: https://nektosact.com/not_supported.html · https://docs.gitea.com/usage/actions/comparison · https://gitea.com/gitea/actions-proto-def · https://forgejo.org/docs/latest/user/actions/reference/ · https://github.com/ChristopherHX/runner.server · https://depot.dev/blog/github-actions-runner-architecture-part-1-the-listener · https://www.blacksmith.sh/blog/cache · https://depot.dev/blog/github-actions-breaking-five-second-barrier · https://github.blog/changelog/2026-01-22-1-vcpu-linux-runner-now-generally-available-in-github-actions/
