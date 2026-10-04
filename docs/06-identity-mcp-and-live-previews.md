# Identity, MCP, and executable branch previews

Research and design memo · 2026-10-03 · All external sources accessed 2026-10-03.

**Recommendation:** make a preview an addressable, reproducible part of a change. A person or agent should be able to say “open the exact version that passed checkout tests, as a new customer,” inspect it, and attach observations to that version. Authentication should connect the human's intent to the agent's work and to the evidence, without giving every agent a human's general credentials.

This is a proposed Beanstalk design, not implemented behavior. **Fact** labels describe documented platform behavior; **proposal** labels describe our architecture; **unknown** labels identify assumptions requiring a technical spike. Example domains, identifiers, budgets, and timeouts are illustrative.

## 1. What the platform can actually provide today

| Verified fact | Consequence for Beanstalk |
| --- | --- |
| Artifacts distinguishes Workers bindings, Cloudflare API tokens for REST, and repository-scoped Git tokens with `read` or `write` access. Public documentation does not expose branch-, path-, or commit-scoped Git tokens. | Mint task-fork tokens for agents. Keep canonical repository write credentials in a trusted integration service. A Beanstalk capability cannot magically narrow a native token after the client receives it. [Artifacts authentication](https://developers.cloudflare.com/artifacts/guides/authentication/) |
| Artifacts provides ordinary Git over HTTPS, including clone/fetch/pull/push. Fetch supports protocol v1/v2; push uses v1 receive-pack. | HTTPS is a credible first transport. Verify every permitted push path before claiming protection for branches. [Git protocol](https://developers.cloudflare.com/artifacts/api/git-protocol/) |
| Ordinary Workers do not currently accept inbound TCP connections. | Standard SSH Git hosting needs a separate TCP/SSH service or a different supported ingress product; it is additional infrastructure. [Workers protocols](https://developers.cloudflare.com/workers/reference/protocols/) |
| Workers Previews have separate settings, URLs, and observability. URLs are public by default. The documented cap is 100 previews per Worker on Free and 500 on Paid; the oldest by last deployment is evicted when the cap is reached. | Use native Previews for supported branch workflows, but do not model 10,000 agent experiments as 10,000 native previews on one Worker. [Workers Previews](https://developers.cloudflare.com/workers/previews/) |
| Native Previews automatically isolate Durable Objects and Containers. D1, KV, and R2 require separate resource bindings. Service bindings target the other Worker's production deployment; Workflow bindings target existing Workflows; previews cannot consume Queues. | A separate application URL is insufficient evidence of an isolated environment. Compile and verify an explicit dependency manifest. [Resources and isolation](https://developers.cloudflare.com/workers/previews/resources/) |
| Dynamic Workers can load code at runtime. Their outbound access defaults to the parent's access; `globalOutbound: null` blocks network calls, and a service binding can mediate them. | Useful for cheap JavaScript previews and controlled adapter code. Set outbound policy explicitly. [Dynamic Workers API](https://developers.cloudflare.com/dynamic-workers/api-reference/) |
| Current Sandboxes documentation fronts Linux application ports through a Worker. It recommends separate preview hostnames and supports WebSocket forwarding. | Put authorization before the application, then route to its private port. Do not expose an alternative unauthenticated route. [Preview a web application](https://developers.cloudflare.com/sandbox/previews/) |
| Browser Run, previously Browser Rendering, provides headless browsers, screenshots, Playwright, CDP, and MCP integrations. Paid defaults are 200 concurrent browser sessions and three new instances per second; increases require account approval. | Queue browser work and reuse resources within appropriate trust boundaries. Thousands of logical agents do not imply thousands of immediately available browser sessions. [Browser Run](https://developers.cloudflare.com/browser-run/), [limits](https://developers.cloudflare.com/browser-run/limits/) |

**Documentation drift matters.** The current Sandbox docs were updated September 30 and describe the newer native container API; older `/sandbox/sdk/` pages explicitly document SDK 0.x. Do not implement a new service from a cached `exposePort()`/`startProcess()` example without checking its version. The current migration API map describes the replacements. [Sandbox overview](https://developers.cloudflare.com/sandbox/), [API migration map](https://developers.cloudflare.com/sandbox/sdk/migrate/api-map/)

## 2. Give each agent an accountable identity and a bounded assignment

**Proposal:** represent an agent run as a principal with a delegation chain:

`organization → initiating human or service → approved assignment → coordinator → worker run → exact tool invocation`

The identity record contains the human or service responsible for the assignment, agent provider/model when known, runtime identity, parent run, assignment ID, policy version, creation/expiry times, and a revocation generation. A model name is descriptive metadata, not proof of origin. Distinguish platform-observed facts from self-reported agent metadata.

A human signs in through an ordinary identity provider. The human authorizes an assignment such as “implement and test candidate checkout flows in this repository, with this spending envelope.” Agents can work inside that envelope without repetitive prompts. A materially broader operation—production deployment, new sensitive data access, publishing externally—uses the organization's existing policy and, when required, a separate approval bound to the precise artifact.

Proposed capability record, retained server-side or encoded in a signed token as appropriate:

```json
{
  "issuer": "https://identity.beanstalk.example",
  "subject": "agent-run:run_418",
  "delegated_by": "assignment:checkout_17",
  "tenant_id": "org_12",
  "audience": "https://mcp.beanstalk.example/mcp",
  "repository_id": "repo_shop",
  "task_fork_id": "fork_run_418",
  "actions": ["repository.read", "change.propose", "preview.create", "preview.observe"],
  "constraints": {
    "base_commit_oid": "6fdcbbf9e68f3bd394b8e37c4ac171531f79bfe1",
    "write_destination": "fork_run_418",
    "production_access": false,
    "max_delegation_depth": 1,
    "budget_reservation_id": "reserve_93"
  },
  "expires_at": "2026-10-03T02:05:00Z",
  "policy_version": "policy_8",
  "revocation_generation": 14
}
```

These are **Beanstalk claims**, not an Artifacts token schema. Validate audience, issuer, tenant, resource, action, expiry, and active delegation on each sensitive operation. The body of a tool request never overrides the caller's tenant. Child capabilities may only attenuate rights and expiry; issuing ten children must reserve portions of the same shared budget rather than multiply it. Rate limits and atomic budget reservations live in a trusted service, not in fields the agent can edit.

Separate credentials by purpose:

| Credential | Intended audience | Allowed authority |
| --- | --- | --- |
| Human application session | Beanstalk control application | The person's organization membership and explicitly granted actions |
| Remote MCP access token | The canonical Beanstalk MCP URI | Discovery and tool calls under the delegated assignment |
| Git credential | Exact Artifacts task repository, or a Beanstalk Git gateway | Clone/push for that repository only; no preview or deployment authority |
| Preview viewer capability | One preview gateway/resource | Open one immutable preview or a declared set of previews |
| Browser job identity | Browser broker and selected preview | One bounded observation session and permitted synthetic persona |
| Deployment credential | Trusted deployment service / provider | Deploy the already selected artifact to its authorized environment |
| Third-party installation credential | GitHub API/Git, where migration requires it | Only the selected installation/repositories/permissions |

Token exchange occurs inside a trusted broker after authorization. Do not forward an MCP token to Git, a preview app, GitHub, or Cloudflare. An untrusted tool result must not be able to nominate a new audience and receive a credential for it.

GitHub migration can use a GitHub App installation instead of collecting broad personal access tokens. Installation tokens can be restricted by repository and permission and currently expire after one hour. Beanstalk should hold the app credentials in its connector service and attribute the initiating human/run separately. [GitHub Apps versus OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps)

## 3. Repository access: fork boundaries before clever token claims

**Proposal:** each independently trusted agent job receives a task repository fork based on an exact canonical commit. The agent can use standard Git freely inside that fork. It submits a candidate commit and its evidence to a separate integration service. Only that service may update canonical protected refs after checking current policy, expected base, current head, and acceptance evidence.

This maps directly to Artifacts' documented repository isolation and per-repository tokens. Forks have separate access tokens and lifecycle; the docs explicitly suggest repository-per-agent/session/task when those units need independent access and cleanup. [How Artifacts works](https://developers.cloudflare.com/artifacts/concepts/how-artifacts-works/), [repository scope](https://developers.cloudflare.com/artifacts/concepts/repositories/)

**Important implementation boundary:** a proxy that checks a branch name and then gives the agent a canonical-repository write token has not protected that branch. The agent could use the token against the native remote. Branch restriction requires authoritative enforcement on every mutation path, or withholding that credential completely. The first prototype should choose withholding and task forks.

Likewise, “may modify `src/checkout/`” is a change-admission rule, not confidential file access. A full clone can expose repository history and reachable objects. For code the agent must not read, provide a deliberately sanitized repository or a constrained file API, and make the reduced context visible in the assignment.

Start with HTTPS Git and a credential helper/broker. Do not persist credentials in clone URLs, screenshots, repository config, or ordinary logs. For hosted jobs, inject upstream credentials in a trusted outbound handler only for an exact HTTPS destination and operation. The entire task sandbox must be assumed able to exercise any authority made available to it; hiding the credential's bytes alone does not prevent misuse of the broker.

**Unknown to validate:** Artifacts' exact token expiry/revocation behavior, canonical ref update guarantees, fork cost at repository scale, and the integration path for importing a candidate's object graph. Do not promise protected refs, atomic multi-ref transactions, or custom receive hooks merely because the storage speaks Git.

## 4. A preview needs an immutable identity and a mutable entry point

**Proposal:** maintain two addresses with distinct behavior:

- A convenient change/branch entry point, such as `https://app.beanstalk.example/org/shop/changes/418/preview`, resolves the current ready deployment and redirects with `Cache-Control: no-store`.
- An immutable application hostname, such as `https://p-7km2.beanstalk-preview.example`, selects exactly one recorded preview manifest. Its opaque ID is a locator, not authorization.

Avoid forwarding all asset requests through a branch alias that changes mid-session. A person who loaded HTML from commit A must not accidentally receive an API implementation or JavaScript bundle from commit B after an agent pushes. Redirecting to an immutable preview origin pins the visit; the canvas can show “a newer candidate is ready” without silently replacing the current one.

The immutable manifest contains:

```text
tenant + repository + exact source commit + change revision
build artifact digest + build recipe digest + dependency lock digest
runtime/image digest + runtime compatibility settings
environment manifest digest + dataset snapshot ID + schema version
allowed outbound destinations + secret binding version identifiers
created_by + policy decision + creation/expiry times
```

Never store secret values in that manifest. Source commit alone is insufficient identity: a changed image, secret, dataset, or dependency resolution can change observable behavior. A rebuild or fixture reset that changes the manifest creates a new preview identity. The code artifact can be immutable while a test database changes during a visit; label that distinction and record fixture/checkpoint IDs for replayable observations.

Creation sequence:

1. Resolve a branch/change revision once, producing a specific commit ID and revision number. Authorize those values.
2. Reserve build resources and create a durable operation record with an idempotency key.
3. Build from that exact source into an immutable artifact. Record digests and provenance supplied by the trusted build service.
4. Provision the declared test resources and authorize their bindings before execution.
5. Run readiness and isolation checks. The trusted gateway writes preview metadata headers after stripping app-supplied equivalents.
6. Publish the immutable preview. Update the branch pointer only with a compare-and-swap against the revision observed in step 1.
7. If the branch moved meanwhile, retain the completed preview as evidence for the old revision; do not present it as current.

A review records `source_commit`, `preview_manifest_digest`, `dataset_checkpoint`, and `evidence_ids`. A later merge or promotion checks them against the selected candidate. Construct the final integration commit before authoritative validation and publish that exact tested commit. Even when two commits have the same tree, history, `GITHUB_SHA`, event context, or embedded build metadata can change behavior; evidence reuse requires an explicit input-equivalence rule. A feature branch screenshot alone does not prove the integrated result works.

## 5. Authentication must end before untrusted application code begins

**Proposal:** serve the control application and user code from different registrable domains in production. The example `.example` names above are placeholders; production should use distinct owned domains, with preview-specific hostnames beneath the user-code domain. Protect the preview gateway, remove control credentials before forwarding, and keep application login separate from gateway login.

Human flow:

1. The person opens a preview through the Beanstalk canvas or a direct authenticated URL.
2. The identity service checks membership or a deliberately granted external-review invitation.
3. A short-lived, single-use authorization code is bound to the exact preview, browser login transaction, redirect target, and viewer. Exchange it at a trusted route for a host-only `__Host-` gateway session with `Secure; HttpOnly; Path=/` and an explicit SameSite policy. Redact codes from logs and promptly redirect to a clean application URL.
4. The gateway validates that session on every request, strips its cookie and authentication headers from the upstream request, and forwards only permitted application data.
5. Treat application-generated cookies separately; reject attempts to overwrite the reserved gateway cookie or set cookies for a parent/sibling domain. Require host-only application cookies so one preview cannot write cookies shared with other tenants' previews. Enforce CSRF protections on the control API and preview-management routes.

The default share action invites named viewers. A bearer share link can be an explicit opt-in for a fixed preview, short duration, and limited dataset; communicate that forwarding it forwards access. It is a different credential from an MCP access token. Do not put MCP bearer tokens in query strings.

Cloudflare Access can provide an enterprise outer gate and identity-provider login. Its service tokens authenticate automation using an ID/secret header pair and a Service Auth policy. Keep those credentials at the gateway/broker; a shared long-lived Access service token is not the complete per-agent authorization model. [Access service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)

Gateway access and application identity are different. After being allowed to view a preview, a reviewer may choose “new customer,” “existing customer,” or “store manager” within its synthetic dataset. Create those test sessions through a trusted fixture adapter. Do not reuse production user sessions or place production refresh tokens in the preview.

A preview on its own origin remains capable of sending requests elsewhere. Restrict credentialed CORS on the control plane, validate request origin where appropriate, apply CSRF controls, and use `postMessage` only with exact origin and message-schema validation. In the canvas, render a separate origin in a sandboxed frame with a narrow capability set. Give users an authenticated open-in-tab fallback when browser restrictions prevent framed login or third-party cookies. Never weaken global cookies to make the iframe work.

## 6. Isolation is about dependencies, people, and time

**Fact:** all processes within one Cloudflare Linux sandbox share its files, local services, and capabilities. A separate Linux user is not a reliable isolation boundary there. Cloudflare's current guidance treats the sandbox as the smallest trust unit, recommends keeping credentials outside it, and requires explicit network controls. [Sandbox security](https://developers.cloudflare.com/sandbox/concepts/security/)

**Proposal:** share compiled artifacts where safe; give mutually untrusted jobs separate sandboxes and mutable data. A collaborative room may deliberately share state, but its members must be told that edits and test actions affect one another.

| Dependency | Default preview behavior | Permitted extension |
| --- | --- | --- |
| SQL database | New test database or separately enforced tenant/schema with synthetic seed data | Explicitly approved sanitized snapshot; record schema and snapshot versions |
| R2/object storage | Separate bucket or trusted broker enforcing a preview namespace | Read-only fixture set with documented expiry |
| KV | Separate namespace or scoped broker | Safe immutable fixture cache |
| Durable Objects | Separate namespace or broker-derived IDs with enforced preview identity | Declared collaboration within a preview room |
| Queues and scheduled jobs | Dedicated test queue/consumer stack or deterministic simulator | Explicit preview-only dispatch; never implicit production consumption |
| Secrets | Test credentials through limited brokers where possible | Per-preview credential issuance for an integration's test environment |
| Email, payments, notifications | Capture sink / sandbox provider | Explicit test-account workflow |
| Outbound network | Deny by default; declared services via enforcement outside the application | Reviewed integration-specific destinations and methods |
| Browser session | Fresh isolated context with a synthetic test persona | Explicit session handoff within the same preview and authority |

Prefixes are conventions unless a trusted enforcement layer prevents access outside them. Likewise, a dedicated database connection is only isolated if it cannot access other databases or privileged service APIs. Validate generated binding manifests and surface failures as “environment not isolated,” not merely a warning badge.

Dynamic Workers are suitable for runtime-loaded JavaScript previews; Workers for Platforms supports managed deployment of untrusted customer Workers with explicit bindings and per-customer limits. Linux applications and development servers need Containers. Choose the runtime from application requirements, not from a blanket “every branch is a Worker” rule. [Workers for Platforms](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/)

**Unknowns:** faithful cloning of complex application state, provider-specific OAuth callback registration, WebSocket lifetimes, custom domains, production-like multi-service wiring, and private network access all need application-specific tests. Record unsupported integrations in the preview manifest; a mocked payment provider must not appear as a real end-to-end payment validation.

## 7. MCP should expose operations the agent can reason about

**Fact:** the current MCP authorization page resolves to protocol revision `2026-07-28`. HTTP authorization uses OAuth 2.1, Protected Resource Metadata, and audience-bound access tokens; resource indicators identify the MCP server. Client ID Metadata Documents are preferred, while dynamic client registration is retained as deprecated compatibility. Invalid/expired tokens receive HTTP 401; insufficient authority receives HTTP 403. [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)

**Proposal:** publish a remote HTTP MCP service with its canonical resource URI and OAuth metadata, using a conforming SDK. Support a documented client/version compatibility matrix. Use per-client consent, PKCE and redirect validation for delegated human access. Machine clients use registered workload identities under organization policy. Never accept arbitrary upstream tokens as MCP credentials. MCP's security guidance specifically addresses token passthrough and confused-deputy risks. [MCP security guidance](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices)

Expose a small stable tool vocabulary, returning concise summaries plus machine-readable results and resource handles. Put large logs, diffs, manifests, and screenshots behind individually authorized resources. Authenticate a caller when it reads the resource; knowing a handle is not enough. Discovery can vary by caller authorization, but tool annotations such as read-only or destructive are descriptive metadata rather than enforcement. [MCP tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)

Proposed application contracts; these are not complete MCP wire messages:

| Tool | Required inputs | Useful output and semantics |
| --- | --- | --- |
| `beanstalk_repository_resolve` | `repository_id`, exactly one of `ref` / `change_id` / `commit_oid` | Exact source commit, revision, permissions, current preview if present |
| `beanstalk_workspace_create` | `repository_id`, `base_commit_oid`, `assignment_id`, `idempotency_key` | Task fork ID, credential-helper configuration/handle, expiry, budget reservation |
| `beanstalk_change_submit` | `workspace_id`, `candidate_commit_oid`, `expected_base_oid`, `evidence_ids`, `idempotency_key` | Change/revision ID or explicit stale-base/conflict result |
| `beanstalk_preview_create` | `repository_id`, `commit_oid`, `environment_profile`, `idempotency_key` | Durable operation ID; eventual immutable preview manifest and URL |
| `beanstalk_operation_get` | `operation_id` | `queued`, `running`, `ready`, `failed`, `canceled`, or `expired`; progress and retry hint |
| `beanstalk_preview_observe` | `preview_id`, `scenario_id`, `persona_id`, `idempotency_key` | Browser observation operation ID and eventual screenshot/tree/trace evidence |
| `beanstalk_preview_session_open` | `preview_id`, `persona_id`, `purpose`, `idempotency_key` | Auth-bound browser session handle, allowed origins, expiry; no provider credential |
| `beanstalk_preview_grant` | `preview_id`, `recipient_ids`, `expires_at`, `idempotency_key` | Exact viewer grant records and authenticated entry URL; separate sharing authority |
| `beanstalk_preview_stop` | `preview_id`, `idempotency_key` | Stops compute and viewer sessions; preserves retained evidence and manifest |
| `beanstalk_evidence_get` | `evidence_id` | Provenance, observation limits, resource links, retention deadline |

For open-ended browser work, hand the caller an authenticated, preview-bound browser tool surface. Do not hand over an account-wide CDP endpoint. Navigations, downloads, file uploads, external origins, and browser storage each remain limited by the selected session's authority. A scenario runner is safer and easier to compare than arbitrary browser scripting for known acceptance tests; both can coexist.

Example `beanstalk_preview_create` input schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["repository_id", "commit_oid", "environment_profile", "idempotency_key"],
  "properties": {
    "repository_id": { "type": "string", "minLength": 1 },
    "commit_oid": { "type": "string", "minLength": 1 },
    "environment_profile": { "type": "string", "enum": ["synthetic-web", "synthetic-api"] },
    "max_lifetime_seconds": { "type": "integer", "minimum": 60, "maximum": 3600 },
    "idempotency_key": { "type": "string", "minLength": 16, "maxLength": 128 }
  }
}
```

Validate the object ID against the repository's supported format and require an accessible commit object, not merely an existing blob or tree. Resource profiles are platform-owned templates, not arbitrary binding maps from agent-controlled YAML. The caller may request a shorter lifetime; it cannot exceed its policy allowance by choosing a larger number.

Async work should survive client disconnection. Return an operation handle immediately in a normal tool result, then expose `operation_get` for broad client compatibility. Where a client opts into the current Tasks extension, use it. The `2026-07-28` Tasks extension is separately negotiated and must not return its task result shape to an unaware client. [MCP Tasks extension](https://modelcontextprotocol.github.io/ext-tasks/specification/2026-07-28/tasks.html)

Idempotency keys are scoped to tenant + principal/assignment + operation type. Persist a hash of canonical inputs with the result; replay returns the existing operation, and different inputs under the same key return `IDEMPOTENCY_CONFLICT`. A JSON-RPC request ID alone is insufficient. Authorization is checked again on replay; an old success cannot resurrect revoked access.

Proposed tool error payloads use stable codes such as `STALE_REVISION`, `PREVIEW_NOT_READY`, `PREVIEW_EXPIRED`, `ENVIRONMENT_UNSUPPORTED`, `ISOLATION_FAILED`, `BUDGET_EXHAUSTED`, `CAPACITY_QUEUED`, and `IDEMPOTENCY_CONFLICT`, with `retryable`, `retry_after_ms`, and a useful next action. Domain failures use `isError: true`; malformed protocol requests use JSON-RPC errors; authentication stays at the HTTP layer. Never include a credential or inaccessible repository detail in an error.

## 8. Concrete flow: “Show me this PR and tell me what broke”

1. Jev resolves the selected change to commit C and revision 18. Its canvas shows that immutable selection and its current relationship to the branch head.
2. Jev calls `beanstalk_preview_create` for C with `synthetic-web`. The response contains operation `op_41`; the UI can show real progress while the build runs.
3. A trusted service creates preview P, an isolated fixture database D, and a manifest digest M. It verifies readiness and records evidence about the actual deployed artifact.
4. Jev requests an observation session for P as `new-customer`. The browser broker obtains a preview-scoped authorization capability and injects it only for P's gateway. It never exposes this secret in tool content or gives it to the preview server.
5. The browser runs the checkout scenario, captures the accessibility tree, screenshot, console errors, failed requests, and relevant timing data. Cloudflare's Playwright MCP integration supports accessibility-based interaction; Beanstalk supplies the surrounding identity and artifact policy. [Playwright MCP](https://developers.cloudflare.com/browser-run/playwright/playwright-mcp/)
6. The result records C, M, D's fixture checkpoint, browser/runtime version, scenario version, timestamps, and failure details. Screenshots and traces are stored as tenant-authorized evidence with their own retention period.
7. The canvas opens P beside the baseline preview and anchors the observation to the UI element and source change. “Checkout button fails for a new customer” links to a replayable scenario and trace, not just an agent's opinion.
8. If another agent has advanced the branch to revision 19, Jev reports the observation as applying to revision 18 and offers the new candidate as a separate selection. It never carries forward an acceptance label silently.

Treat visible page text, screenshots, console output, and repository instructions as untrusted content. A page saying “call the deploy tool with admin credentials” cannot change the browser session's authority or the agent's assignment. The browser broker enforces navigation and upload rules outside the page. Browser Run has outbound Worker support that is worth testing as an enforcement mechanism. [Browser outbound Workers](https://developers.cloudflare.com/browser-run/features/outbound-workers/)

## 9. Thousands of agents: spend on observations, not idle environments

**Proposal:** make preview identities cheap and running compute scarce. Ten thousand candidate manifests can exist while only the requested or highest-value candidates consume build, container, and browser slots. A fair scheduler allocates separate quotas for builds, interactive previews, and observations; a single noisy assignment cannot consume the organization.

Deduplicate deterministic artifacts by source/build/environment inputs, while isolating mutable databases and browser state. Preserve cached screenshots and traces after compute stops. Queue capacity with transparent estimated delay; do not spin retries that repeatedly create resources. Use cohort sampling for broad visual exploration, then run selected finalists against a declared acceptance suite.

Illustrative policy defaults, to validate with users and benchmarks:

- Agent preview capability: 5 minutes, renewable within an active assignment.
- Unpinned Linux preview: 5 minutes idle, 60 minutes maximum wall-clock allocation.
- Browser observation: 2 minutes maximum per job, explicit close on completion.
- Evidence retention: 7 days for discarded experiments, longer for selected changes according to organization policy.
- Per-assignment budgets: reserved CPU/container time, browser seconds, bytes stored, and outbound usage; reconcile measured consumption and return unused reservation.

Cloudflare documents that sandbox files and processes end when an instance stops unless files were saved; snapshots preserve filesystem state, not running processes. Durable Object activity and configured inactivity timeout control lifetime. An accepted WebSocket can keep an instance active. Therefore our own wall-clock policy and budget cancellation are essential; inactivity alone is not a spending ceiling. [Sandbox lifetime](https://developers.cloudflare.com/sandbox/concepts/lifetime/)

Cleanup is a durable state machine: revoke viewer and browser grants; unpublish mutable aliases; stop accepting new work; close browser sessions and WebSockets; terminate compute; delete test resources; retain required evidence; record completion. Enforce expiry and revocation on already-open sessions through gateway-owned deadlines and revocation events; checking only the initial WebSocket upgrade is insufficient. Run periodic reconciliation to catch partial failures. An expired URL returns an authenticated explanation with a rebuild action, never a silently repurposed environment belonging to another user.

## 10. Ideas worth testing, and where they can fail

| Idea | Why it could be distinctive | Question that could kill it |
| --- | --- | --- |
| **Executable review object**: a change includes its demo, data fixture, scenario, and evidence | Humans and agents discuss the same observable behavior | Can a reviewer replay it quickly enough, including stateful apps? |
| **Witness agent**: an independent observer chooses scenarios and signs an observation record | A code-writing agent does not grade its own claims | A signature identifies the reporter, not truth. Require broker-observed execution, deterministic tests, and diverse observations; correlated model errors remain possible. |
| **Parallel persona rooms**: invite product, accessibility, security, and performance agents into isolated copies of one candidate | Concurrent exploration without test accounts trampling each other | Is copying data expensive, and do synthetic personas hide production-only failures? |
| **Capability receipt on every canvas card**: show who asked for work, which authority it used, and its exact candidate | Makes a swarm legible without exposing secrets | Does it become audit noise? Default to exceptions and expandable receipts. |
| **Replay from any observation**: click an error to recreate the runtime and fixture checkpoint | Replaces “cannot reproduce” with a concrete debugging start | External time, randomness, integrations, and mutable secrets prevent exact replay; disclose fidelity. |
| **Preview tournament**: agents propose variants; cheap checks eliminate failures; humans compare a few live finalists | More ideas can be explored without a thousand open browser tabs | Can the scoring reward superficial screenshots? Tie selection to user tasks and explicit quality constraints. |
| **Scoped live collaboration**: a person and agent share one browser session with a visible handoff | Human judgement can intervene at the exact failure | Shared authority and mutable state are hazardous; bind handoff to the preview and record control changes. |

First technical spike: one Artifacts repository, two agent forks, one trusted integration identity, one synthetic web application, one isolated database, and one authenticated browser observation. Deliberately push a new revision during preview creation; reuse an idempotency key; revoke the parent assignment; attempt to navigate to a different preview; attempt to read another tenant's evidence; and leave a WebSocket open past the allocation deadline. The design earns credibility when those cases produce predictable outcomes.

The architectural bet is that a repository can be explored through **authorized, executable evidence**. The canvas and Jev become the interface to that evidence; immutable identities, separate authority, and isolated state make the interface trustworthy.
