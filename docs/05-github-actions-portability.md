# GitHub Actions portability on Cloudflare

Research date: **2026-10-03**. Sources are linked beside the claims they support. This is an architecture proposal and a validation plan; no runner was deployed and no compatibility result below is a measured pass.

## Recommendation

Beanstalk should import `.github/workflows/*.yml`, inspect their dependencies, and give each workflow a concrete compatibility report. Use **Cloudflare Containers for Linux jobs**, **Workers for the scheduler and APIs**, and **Dynamic Workers for bounded policy evaluation and selected portable code**. Provide an external Linux runner route for workloads whose operating-system or networking requirements exceed the Cloudflare environment.

The useful product promise is: **“Import your Linux workflows, see precisely what runs unchanged, and get a tested migration for the rest.”** An unconditional “GitHub Actions works out of the box” claim is unsupported. Linux execution, YAML semantics, GitHub's service APIs, and deployment identity are four separate compatibility problems.

Two findings change the design substantially:

- Cloudflare now explicitly documents Docker-in-Docker. Its supported recipe disables iptables and IP forwarding, runs the daemon as root, and uses host networking for inner containers and networked image builds. Rootless Docker does not start. This makes Docker execution plausible but creates a service-networking compatibility gap. [Cloudflare Containers FAQ](https://developers.cloudflare.com/containers/faq/)
- GitHub's runner is a client of GitHub's control plane. Running that binary in a Cloudflare container does not create an independent Actions service. A native Beanstalk implementation needs its own workflow scheduler, identity, artifact/cache services, and supported API contract. [Self-hosted runner reference](https://docs.github.com/en/actions/reference/runners/self-hosted-runners)

## Choose the control plane deliberately

| Route | What Beanstalk supplies | What it solves | Remaining constraint |
|---|---|---|---|
| GitHub-connected bridge | Ephemeral Linux capacity, GitHub App integration, imported results | Fast initial adoption while the repository/workflow remains on GitHub | GitHub still schedules jobs and owns Actions APIs, tokens, and event semantics; runner labels usually need changing |
| Independent Actions-compatible engine | Own scheduler plus a pinned execution engine and compatibility services | Workflows for repositories hosted only by Beanstalk | Largest implementation effort; engine choice alone does not provide full parity |
| Native Beanstalk tasks | Typed task DAG, capability grants, immutable inputs and evidence | Best experience for agent-generated work | New format is an adoption burden; maintain an Actions importer |

**Proposed sequence:** native import and analysis first; a GitHub-connected bridge as an optional migration aid; an independently executed, explicitly bounded Linux profile next. Keep one internal task/evidence model behind both engines so the bridge does not become the permanent architecture.

`act` is useful as an execution spike and differential-test target. Its own documentation lists ignored concurrency, permissions, job timeouts, environments, and incomplete cancellation/OIDC behavior. Those cannot be silently ignored in production; Beanstalk must enforce them outside the engine or reject affected workflows. [act unsupported functionality](https://nektosact.com/not_supported.html)

Forgejo is useful implementation evidence and possibly a component source, but it explicitly targets familiarity rather than complete compatibility. Its documented differences include runner image contents, missing context keys, ignored permissions, and a different OIDC enabling mechanism. Choosing Forgejo does not remove the compatibility work. Assess component licenses separately before adopting code. [Forgejo's comparison](https://forgejo.org/docs/latest/user/actions/github-actions/)

Reusing or adapting GitHub's open runner protocol would couple Beanstalk to the corresponding service contract and its evolution. Treat that as a separate prototype with update and conformance costs, rather than assuming an open client implies a turnkey open server.

## Runtime and compatibility matrix

“Candidate” means technically plausible and requires the tests below. “Adapter” means Beanstalk must implement behavior beyond starting a Linux process. “External” is the proposed fallback until equivalent behavior is demonstrated.

| Workflow feature | Dynamic Workers | Cloudflare Linux Container / sandbox | Proposed import treatment |
|---|---|---|---|
| YAML parsing, expressions, policy evaluation | Good fit for bounded work | Possible but wasteful | Workers control plane; reject unsupported semantics early |
| Bash `run`, Git, package managers, compilers | No general Linux process environment | Candidate | Core Linux profile with pinned tools |
| JavaScript actions | Only an audited portable subset | Candidate with required Node runtimes | Default to Linux; never classify portability by `.js` extension |
| Composite actions | Only if every nested operation is portable | Candidate | Recursively inventory `run` and `uses` dependencies |
| Local actions and remote action repositories | Fetch/inspect possible | Candidate | Resolve refs to SHAs and record provenance |
| `container:` job image | No | Candidate, adapter needed | Verify working directories, UID, shell, volumes, libc, and tools |
| Dockerfile / `docker://` actions | No | Candidate with DinD host networking | Check image build/run, entrypoint, signals and mounted workspace |
| `services:` PostgreSQL/Redis/etc. | No | Adapter or external | Bridge DNS, port publishing and isolation are material gaps |
| `docker build`, Compose, Buildx | No | Limited candidate | Host networking may work; probe each driver and topology |
| Native extensions / browser tests | Usually require Linux | Candidate within image/resources | Include OS libraries; exercise sandbox/browser launch |
| Privileged devices, kernel modules, KVM, nested clusters, GPU | No | Unverified / outside initial profile | External; do not equate root inside a guest with arbitrary host capabilities |
| Windows/macOS jobs | No | No native execution | External providers or explicit unsupported status |
| ARM-specific jobs | Do not infer native architecture equivalence | Verify target platform and available images | Initial profile should state its verified CPU architecture; route others externally |
| Large monorepo builds | Resource dependent | Instance disk/RAM can block | Inspect estimated disk/toolchain footprint before admission |
| `needs`, matrices, conditions, job outputs, reusable workflows | Scheduler concern | Executor alone insufficient | Implement a documented semantics profile |
| `GITHUB_TOKEN`, `gh`, REST/GraphQL | Service concern | Linux alone insufficient | Compatibility API/token adapters or explicit retained GitHub dependency |
| Artifacts, caches, OIDC, environments | Service concern | Linux alone insufficient | Versioned adapters with independent tests |

Workers' Node compatibility includes actual implementations, partial APIs, and import-only stubs. `node:child_process` is explicitly a nonfunctional stub; importing it is not evidence that an action can spawn Git, Bash, or a compiler. Cloudflare's current sandbox documentation distinguishes the full Linux container environment from Dynamic Workers. [Node compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/), [sandbox environment overview](https://developers.cloudflare.com/sandbox/)

### Why service containers are the hard boundary

GitHub connects container jobs to services using a Docker bridge and service-name DNS. Jobs running on the host use published ports, and dynamically allocated ports appear in job context. [GitHub service networking](https://docs.github.com/en/actions/tutorials/use-containerized-services/use-docker-service-containers)

**Inference:** Cloudflare's documented host-network DinD recipe does not preserve those semantics automatically. A job expecting `postgres:5432`, two databases listening on the same port in separate namespaces, or `job.services.db.ports[...]` may fail even when `docker run hello-world` passes. Rewriting everything to `localhost` is insufficient.

**Proposed adapter experiments:** assign service-specific loopback addresses and DNS mappings where the guest permits them; add explicit TCP proxies and port allocation; otherwise allocate separate service instances behind authenticated routes. Preserve health checks, cancellation, teardown, and the original job context. Any topology that cannot preserve the workflow's observable behavior goes to an external runner. One outer container belongs to one CI job and trust domain; inner host networking must never combine unrelated customers.

GitHub offers Linux runner container customization hooks for preparing jobs, executing container/script steps, and cleanup. These are a potential bridge integration point; they remain public preview and need pinned-version testing. [Container customization hooks](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/customize-containers)

## The compatibility services Beanstalk must build

| Surface | Proposed behavior | Failure to catch |
|---|---|---|
| Workflow compiler | Versioned parser, expression evaluator, DAG, event/path/ref filters, matrix expansion, defaults, reusable workflow resolution | A successful job that was scheduled from the wrong event or commit |
| Step execution contract | Environment files, outputs, PATH changes, state, pre/post steps, shell exit behavior, masking, summaries, annotations | Cleanup omitted on cancellation; outputs silently lost |
| Git and checkout | Git HTTP endpoint, exact refs, scoped checkout token, archive fallback if supported; test submodules/LFS separately | Checkout succeeds against GitHub's original repository instead of Beanstalk |
| Action resolver | Fetch public action code by immutable SHA, mirror/cache under policy, verify inputs/runtime, record recursive dependencies | Mutable tag changes between analysis and execution |
| Token service | Per-job, short-lived Beanstalk API token with repository and operation scope; enforce `permissions` at API boundary | A read-only fork job receives write access |
| GitHub API adapter | Explicitly supported REST endpoints for checks, statuses, releases and PRs; separately inventory GraphQL and `gh` | Setting `GITHUB_API_URL` appears sufficient while an action hardcodes `api.github.com` |
| Artifact service | R2-backed objects plus run/job ownership, upload/finalize/download protocol, retention, integrity and access checks | Modern action expects GitHub's service protocol; a generic S3 endpoint cannot answer it |
| Cache service | Version-aware reserve/upload/commit/restore, key matching, branch visibility and trust boundaries | Untrusted PR cache poisons protected-branch builds |
| OIDC issuer | Discovery/JWKS, short lifetime, audience checks, immutable repository/workflow/run identity | Existing cloud trust accepts only GitHub's issuer |
| Environments | Approval and protection state enforced before secrets and deployment credentials are released | An engine ignores `environment:` and deploys immediately |
| Logs and evidence | Append-only stream chunks, correct ordering, redaction, exit cause, exact inputs and outputs | Infrastructure interruption is reported as code failure or success |

These are engineering proposals, not a claim that Cloudflare ships an Actions compatibility service.

Keep compatibility Checks/Statuses API writes separate from authoritative admission evidence. A workflow with permission to post a status must not manufacture its own required pass by reusing a check name. Only coordinator-authenticated completion for the exact job, attempt, lease generation, candidate and trusted check definition may create an acceptance receipt; other statuses remain advisory or require a separately registered trusted issuer. Beanstalk's per-job API token is also distinct from an Artifacts Git token: the latter grants repository-level access, so untrusted jobs receive only a task-fork credential. Canonical write credentials remain inside the publication service.

Specific source-backed traps:

- `actions/checkout` supports a configurable GitHub server URL, but its behavior includes token handling and repository API assumptions. Its current README also documents changes in credential persistence and runner minimum versions for Docker action authentication. Test exact releases and SHAs. [actions/checkout](https://github.com/actions/checkout)
- Modern `actions/upload-artifact` versions have backend requirements; the upstream README still states that v4+ is unsupported on GHES. Matching YAML inputs does not establish backend parity. Either implement and test that protocol or present an explicit replacement action; do not silently substitute code beneath an upstream SHA. [actions/upload-artifact](https://github.com/actions/upload-artifact)
- `actions/cache` changed backend protocol and Node runtime requirements across releases. Certify a version matrix, including caches invoked indirectly by setup actions. [actions/cache](https://github.com/actions/cache)
- GitHub OIDC uses GitHub's issuer and documented claims. A Beanstalk issuer requires a new cloud trust relationship; copying the subject string cannot make it a GitHub-issued token. Use immutable IDs from the beginning and provide generated AWS/Azure/GCP trust-policy migration previews. [GitHub OIDC reference](https://docs.github.com/en/actions/reference/security/oidc)

Keep upstream GitHub credentials distinct from Beanstalk job tokens. Public action resolution may use a controlled GitHub fetch credential without granting workflow code access to it. A workflow that intentionally publishes to a retained GitHub release or package registry still needs authorized GitHub credentials; show that dependency in the import report.

## Event correctness is merge correctness

GitHub has distinct `pull_request`, `pull_request_target`, and `merge_group` semantics. Pull-request validation normally uses a synthetic merge ref; merge queue checks require the `merge_group` trigger. Required checks that never run can block merging. [Workflow events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)

**Proposed Beanstalk rules:**

1. Store the event payload, triggering actor, workflow commit, checkout commit, base commit, policy revision, and trust domain as separate immutable fields.
2. Emit compatible PR and merge-group contexts where supported. Queue admission runs against the exact combined candidate commit, not merely the author's last branch commit.
3. Bind acceptance to the exact candidate commit and tree, event context, workflow/checkout/base identities, dependency inputs, runner image, policy revision, trusted producer, and job/attempt generation. Tree equality alone is insufficient when behavior depends on commit identity or history. Rebuilding the candidate invalidates incompatible evidence.
4. Distinguish failed, cancelled, skipped, unsupported, timed out, and infrastructure-interrupted states. Missing evidence cannot become green.
5. Apply concurrency keys across distributed executors; terminate the process tree and revoke job credentials on cancellation.
6. Treat `pull_request_target` as a separate trusted workflow category. Do not run attacker-controlled fork code with base-repository deployment credentials.

For thousands of agents, compute reuse should operate on proven input equivalence. A package test can be reused across candidate branches only when its dependency closure, image, tools, relevant environment and trust provenance match. A textual diff or model assurance is not a sufficient cache key. Nondeterministic tests remain subject to periodic reruns and measured flake policy.

## Images, lifecycle, availability, and capacity

GitHub's runner-images repository builds VM images. Copying its runner label onto a small Debian container does not reproduce the VM, installed SDKs, filesystem layout, kernel capabilities, or privileged tooling. The source currently lists `ubuntu-latest` against Ubuntu 24.04 while also listing newer explicit images: aliases need versioned policy. [GitHub runner image source](https://raw.githubusercontent.com/actions/runner-images/main/README.md)

**Proposal:** maintain a compact Beanstalk Ubuntu compatibility image plus optional toolchain layers. Publish its software manifest, digest, security update policy, and intentional differences. Resolve every imported runner label to a recorded digest; give customers a visible image migration report when that mapping changes. Include supported Node action runtimes, Git, Bash, certificates, tar/zstd, and selected compilers. Demand-driven tool downloads must be checksummed and captured in the run manifest.

Current Cloudflare limits retrieved on 2026-10-03:

| Item | Documented value | Design implication |
|---|---|---|
| `standard-1` | 0.5 vCPU, 4 GiB RAM, 8 GB disk | Small tests; can be slow for CPU-heavy compilation |
| `standard-2` | 1 vCPU, 6 GiB RAM, 12 GB disk | Modest Linux build profile |
| `standard-3` | 2 vCPU, 8 GiB RAM, 16 GB disk | Mid-sized tests/builds |
| `standard-4` | 4 vCPU, 12 GiB RAM, 20 GB disk | Largest predefined instance; not a large GitHub VM substitute |
| Account aggregate | 1,500 concurrent vCPU; 6 TiB RAM; 30 TB disk | Admission must account for every dimension |
| Image storage | 50 GB per account | A broad toolchain catalog needs image reuse and capacity planning |
| Snapshots | Up to 20 GB, 30-day retention refreshed on restore | Useful acceleration; not the permanent source of truth |

[Cloudflare instance and account limits](https://developers.cloudflare.com/containers/platform/limits/)

Derived capacity examples, assuming nothing else uses the account: `standard-3` reaches the CPU ceiling at **750 concurrent jobs**; `standard-4` at **375**. One thousand logical agents is therefore compatible with a much smaller active build pool. Fair scheduling, dependency-aware admission and sleeping agents matter more than promising one warm machine per agent. These are resource arithmetic, not guaranteed available regional capacity.

Dynamic Workers allow **four distinct in-flight children per Worker request** or **ten per Durable Object's shared I/O context**. Shard execution across job/cohort coordinators and queues rather than making one Durable Object fan out to a thousand active children. [Dynamic Worker limits](https://developers.cloudflare.com/dynamic-workers/platform/limits/)

Cloudflare's live Sandboxes documentation now treats SDK 0.x as legacy and describes the current Container API path. The old `/sandbox/1-0-preview/` URL redirects to that overview; the `durable_object` scheduling policy is identified as public beta. This differs from older local guidance describing everything as an `@next` preview. Verify the installed package line against live documentation when implementation begins. [Current sandbox overview](https://developers.cloudflare.com/sandbox/)

Container disks are ephemeral across sleep; platform interruptions can stop running jobs, and there is no guaranteed uninterrupted runtime. Persist checkout manifests, logs and artifacts outside the guest. Design interruption/retry as explicit states, and never retry a deployment side effect merely because an executor disappeared. [Container lifecycle FAQ](https://developers.cloudflare.com/containers/faq/)

For interactive debugging, reproduce a failed job in a separate sandbox from immutable inputs. Do not silently resume the original privileged deployment environment. A preview should be identified by repository, candidate SHA, build digest, data fixture revision, and authorization policy; connect it to the same evidence record used by merge admission.

## Cost model before a “cheap CI” promise

Cloudflare bills active CPU usage but provisioned memory and disk while containers run. Published marginal rates are **$0.000020/vCPU-second**, **$0.0000025/GiB-second RAM**, and **$0.00000007/GB-second disk**. Workers Paid starts at $5/month with allowances; Worker, Durable Object, logs and network charges also matter. Container egress has regional pricing, unlike assuming all Workers traffic is free. [Container pricing](https://developers.cloudflare.com/containers/platform/pricing/)

Derived example, excluding included allowances and all ancillary costs: one `standard-3` job provisioned for ten minutes and fully using two CPUs costs:

```text
CPU:     2 × 600 × $0.000020   = $0.024000
Memory:  8 × 600 × $0.0000025  = $0.012000
Disk:   16 × 600 × $0.00000007 = $0.000672
Total:                           $0.036672
```

Ten thousand such jobs per day would be roughly **$366.72/day of container compute resources alone**. Compilation speed, startup, package downloads, unused runtime, cache hit rates and service containers can move the real figure substantially. A slower small machine can cost more per completed job than a faster large one. Benchmark dollars per verified change and queue latency together.

Dynamic Workers have a separate daily uniqueness charge: after included usage, $0.002 per unique Worker per day, plus request and CPU charges. Identity and code changes affect uniqueness; invoking without a stable ID can increase the count. Reuse an ID for the same content where appropriate, while preserving isolation and version correctness. [Dynamic Worker pricing](https://developers.cloudflare.com/dynamic-workers/pricing/)

**Proposed spend controls:** per-organization concurrency and monetary budgets; bounded speculative builds; cancellation of superseded candidates; trusted cache domains; fair queues; maximum retry spend; preview TTLs; and a displayed estimate before expanding a 100-by-100 test matrix. Charge or budget both agent reasoning and execution against the same work item so inexpensive proposals cannot trigger unbounded expensive builds.

## A concrete conformance program

All stages below are **proposed and unrun**. Passing a local Docker test does not certify Cloudflare's deployed runtime. Pin the workflow corpus, action SHAs, engine version, image digest and provider configuration. Compare observable outputs with an authorized GitHub reference run, accounting explicitly for intentional identity/domain differences.

### Stage A — Linux execution probe

Run in the actual Cloudflare instance: checkout a small repository; Bash, Node and Python commands; writable workspace; Git history and refs; native package install; signal handling; background process; cancellation and restart. Record startup latency, CPU time, peak RAM/disk, exit reason and log completeness. Test egress allowed/denied and ensure a terminated job cannot keep using its token.

### Stage B — Actions mechanics

Use fixtures for step outputs, job outputs, matrices with include/exclude, `needs` with failures/skips, `if: always()`, `continue-on-error`, shell failure, timeout, pre/post actions, local composite actions, reusable workflows, concurrency cancellation and environment approval. Verify that unsupported features yield an explicit unsupported result before the job runs.

### Stage C — Docker and service topology

Start with a plain Docker action and a networked image build using Cloudflare's documented daemon settings. Then test job image + PostgreSQL + Redis; service DNS; health checks; dynamic ports; two services with identical internal ports; volume writes across steps; Compose; and cancellation cleanup. A failure in bridge networking means that profile remains adapter/external, even if simple Docker actions pass.

### Stage D — Identity and service integrations

Test checkout against Beanstalk alone, private submodules, LFS, artifact roundtrip across jobs, cache exact/fallback hits, cache rejection across trust domains, denied write permissions, OIDC audience and repository constraints, and secret release after environment approval. Include third-party actions that hardcode GitHub APIs to verify the scanner reports them. Certify each action/backend version pair independently.

### Stage E — Merge and scale semantics

Generate PR and merge-group events, change the base while jobs run, cancel/requeue a candidate, restart an executor, redeliver a completion event, and submit a stale success. Verify exactly one authoritative terminal outcome and no merge against stale evidence. Exercise 10, 100, then 1,000 queued work items while keeping active execution below admitted resources; measure starvation and p95 admission delay.

A minimal *candidate* fixture for the independently executed profile follows. Version tags are readable examples; the test corpus must resolve them to immutable SHAs. This checks a useful slice only and is not proof of Docker, API, or OIDC compatibility.

```yaml
name: beanstalk-portability-probe
on:
  push:
  pull_request:
  merge_group:
permissions:
  contents: read
jobs:
  produce:
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    outputs:
      observed: ${{ steps.probe.outputs.observed }}
    steps:
      - uses: actions/checkout@v6
      - id: probe
        shell: bash
        run: |
          set -euo pipefail
          test "$(git rev-parse HEAD)" = "$GITHUB_SHA"
          echo "observed=$GITHUB_SHA" >> "$GITHUB_OUTPUT"
          printf '%s\n' "$GITHUB_SHA" > result.txt
      - uses: actions/upload-artifact@v4
        with:
          name: probe-output
          path: result.txt
  consume:
    needs: produce
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: probe-output
      - shell: bash
        env:
          EXPECTED_SHA: ${{ needs.produce.outputs.observed }}
        run: test "$(cat result.txt)" = "$EXPECTED_SHA"
```

For the GitHub-connected bridge, runner labels must select the registered Beanstalk runner pool instead. For a native import, the visible report must distinguish an unchanged action from a replacement and from a provider-dependent call.

Proposed launch gate: publish the full fixture list, passing action versions, unsupported features, and observed failure modes. Every workflow advertised as unchanged must pass against both reference and Beanstalk execution without hidden source substitutions. All permission, stale-evidence, cleanup and secret-isolation tests are mandatory; a high percentage pass rate cannot compensate for one authorization failure.

## Product opportunity beyond compatibility

**A workflow migration microscope.** Put the workflow on the repository canvas. Clicking a job shows the exact tools, API hosts, credentials, resource estimates and unsupported behaviors discovered by analysis and observed execution. Jev can answer “Why can't this workflow move?” with linked evidence and a reviewed patch.

**A reusable proof store.** Turn each trusted successful job into evidence over immutable inputs. Thousands of agents can ask whether an equivalent proof exists before spending another build. Keep the equivalence rule inspectable and conservative.

**A failure laboratory.** A failed PR opens a disposable reproduction with the checked-out commit, toolchain and allowed fixtures already present. Give a debugging agent a bounded capability to inspect and propose a fix; give a reviewer a live preview of the resulting candidate.

**An execution planner with honest constraints.** Jev can propose “these 800 edits reduce to 23 independent affected-package test sets” and show the dependency analysis. The scheduler can speculate within a budget, but protected-branch integration still requires evidence for the actual candidate state.

**A portability contract maintained in public.** Support status should be a machine-readable artifact per workflow/action/image combination. If an upstream action changes, Beanstalk can run conformance before promoting the version and show exactly which customers are affected. That contract is more defensible than competing on a claim of universal YAML compatibility.
