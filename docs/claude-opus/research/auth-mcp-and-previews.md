# Beanstalk research: agent auth, MCP tooling, and live PR previews

Compiled 2026-10-03 for the Beanstalk design (an agent-first git host on Cloudflare). Every claim links a source with its publish date ("n.d." means the page shows no date).

**Method and coverage.** Exa and web search, primary docs and changelogs, GitHub issue threads, and Hacker News threads and comments pulled through the Algolia API. **I could not reach Reddit.** It returned 403 or a login wall to direct requests, it is blocked for the web-search tool, and Exa returns no reddit.com results. Community sentiment below therefore comes from HN, GitHub issues and practitioner blogs, not Reddit.

---

## 0. TL;DR

1. **GitHub's official MCP server has two failure modes Beanstalk should avoid by design:**
   - **Tool sprawl.** It loaded 101 tools (about 64.6k tokens) by default until October 2025. It still has about 100 tools across about 20 toolsets.
   - **"One token sees everything."** A single token covers every repo the user can reach. That made possible the May 2025 Invariant exfiltration and a run of 2025–26 prompt-injection incidents: CamoLeak, PromptPwnd, Comment and Control, the claude-code-action `[bot]` bypass, and GitLost.
2. **GitHub's fixes are add-ons:** request headers (`X-MCP-Toolsets`, `X-MCP-Tools`, `X-MCP-Readonly`, `X-MCP-Lockdown`), content sanitization, the Copilot agent firewall, `copilot/*`-only branches, and "safe outputs" in Agentic Workflows. GitLost (July 2026) shows these add-ons still fail. One session could read private repos *and* post to a public issue.
3. **GitHub still has no first-class agent principal.** Agents act through a human's PAT or OAuth token, or through a GitHub App.
   - The Copilot Agent Tasks API requires a *user-to-server* token.
   - Attribution relies on `Co-authored-by` trailers, which users now push back on.
   - GitHub added `actor_is_agent` to audit logs only in February 2026.
4. **Auth standards have converged on:**
   - OAuth 2.1 with Protected Resource Metadata (RFC 9728) and audience binding (RFC 8707).
   - Client ID Metadata Documents (CIMD) for client registration. Dynamic Client Registration (DCR) is *deprecated* in MCP 2026-07-28. RFC 9207 `iss` validation is now required of clients.
   - Delegation through RFC 8693 `act` chains.
   - Enterprise SSO for MCP through ID-JAG / Cross App Access (Enterprise-Managed Authorization went stable June 2026).
   - Workload identity through SPIFFE/WIMSE. The AIMS draft is in a WIMSE adoption call (August 2026).
   - Proof-of-possession: DPoP and HTTP Message Signatures (Web Bot Auth, AAuth).
5. **Cloudflare already provides most of this stack:**
   - `workers-oauth-provider` now implements MCP 2026-07-28, CIMD, and RFC 8693, 8707 and 9207.
   - MCP support in the Agents SDK.
   - Access managed OAuth for agents (April 2026).
   - Web Bot Auth and signed agents.
   - MCP server portals with service tokens.
6. **Cloudflare shipped Worker Previews on 2026-09-22, aimed at agent loops.** The suggested loop is deploy → Playwright MCP → Workers Observability MCP → patch → redeploy. There are sharp edges:
   - Only Durable Objects and Containers are isolated automatically.
   - D1, KV, R2 and Queues *share production by default* unless you rebind them.
   - Service bindings, Workflows, cron triggers and routes still hit production.
   - Limit of 100 previews per Worker (Free) or 500 (Paid).
7. **Preview environments have the same complaints everywhere:**
   - Data seeding, especially keeping it deterministic.
   - Secrets: never production credentials, and fork PRs need special handling.
   - Cost: teardown, and runaway Durable Object alarm loops (one $34k bill).
   - Auth walls versus automation (Vercel's bypass secrets).
   - OAuth redirect URIs that don't match preview URLs.
   - Previews that behave differently from production.
8. **Agents verifying UI in a real browser is now standard.** Copilot's agent got a Playwright browser in July 2025. Chrome DevTools MCP, Cloudflare Browser Run, and screenshots on Netlify agent runs followed. Browser MCP servers use a lot of tokens, which pushed many people to CLIs and skills.
9. **Nobody offers a first-class "preview as MCP tool" with main-versus-branch behavior diffs.** The closest are:
   - Vercel MCP's `web_fetch_vercel_url` plus runtime logs.
   - Meticulous replaying recorded sessions against base and head.
   - DIY Claude + Playwright visual diffs.
   - "Proof bundle" tools.

   **Beanstalk can own this gap.**

---

## 1. Agents and git hosts: auth and MCP tooling

### 1.1 GitHub's official MCP server today

**Deployment:**
- A hosted remote endpoint, `https://api.githubcopilot.com/mcp/`, with OAuth login. "No more Docker babysitting, no more token rotation, just OAuth once" ([GitHub blog, 2025-07-30](https://github.blog/ai-and-ml/generative-ai/a-practical-guide-on-how-to-use-the-github-mcp-server/)).
- A local Docker or binary server that uses a PAT or local OAuth ([repo README, n.d.](https://github.com/github/github-mcp-server)).

**Toolsets:**
- Defaults: `context`, `repos`, `issues`, `pull_requests`, `users`.
- Optional: actions, code_security, dependabot, discussions, gists, notifications, orgs, projects, secret_protection, security_advisories, stargazers, copilot and others. There are 100+ tools in total ([README, n.d.](https://github.com/github/github-mcp-server)).

**Remote configuration** uses headers that mirror the local environment variables:
- `X-MCP-Toolsets`, and `X-MCP-Readonly` or the `/readonly` path ([issue #1108, 2025-09-21](https://github.com/github/github-mcp-server/issues/1108)).
- `X-MCP-Tools` for selecting individual tools ([changelog, 2025-12-10](https://github.blog/changelog/2025-12-10-the-github-mcp-server-adds-support-for-tool-specific-configuration-and-more/)).
- `X-MCP-Lockdown` ([changelog, 2025-12-10](https://github.blog/changelog/2025-12-10-the-github-mcp-server-adds-support-for-tool-specific-configuration-and-more/)).
- `/insiders` or an Insiders header ([changelog, 2026-01-28](https://github.blog/changelog/2026-01-28-github-mcp-server-new-projects-tools-oauth-scope-filtering-and-new-features/)).

**Auth on the remote server** depends on the host app. GitHub's governance doc lists three methods ([policies-and-governance.md, n.d.](https://github.com/github/github-mcp-server/blob/main/docs/policies-and-governance.md)):
- GitHub App installation tokens.
- The OAuth authorization-code flow. This requires the host to have registered a GitHub App or OAuth App, and OAuth Apps can only be installed per organization.
- PATs.

The same doc adds that PATs "do not adhere to OAuth App policies and GitHub App installation controls… not recommended for production automation." It recommends fine-grained PATs with a 90-day maximum lifetime. One vendor reports that multi-tenant use with installation tokens through the hosted server is impractical and falls back to the REST API with per-org App installations ([Scalekit, 2026-06-02](https://www.scalekit.com/blog/github-mcp-vs-api)). Treat that as a vendor claim.

**Scope-aware tool lists** (January 2026). With a classic PAT (`ghp_`), the server inspects the token's scopes and hides tools the token can't use. With a fine-grained PAT, it shows every tool and lets the API reject calls. With remote OAuth, it issues "dynamic scope challenges on-demand" ([changelog, 2026-01-28](https://github.blog/changelog/2026-01-28-github-mcp-server-new-projects-tools-oauth-scope-filtering-and-new-features/)).

### 1.2 Complaint #1: context bloat and too many tools

**Evidence from GitHub itself:**
- The maintainers wrote: "Excessive context: 101 tools consuming 64.6k tokens by default; tool selection degradation." They cut the default to 52 tools and 30.3k tokens ([Discussion #1182, 2025-10-06](https://github.com/github/github-mcp-server/discussions/1182)).
- One user: "I went from 34k tokens to 80k tokens just by adding the github mcp to Claude Code… over 66 tools" ([issue #1286, n.d., around v0.20 in late 2025](https://github.com/github/github-mcp-server/issues/1286)). GitHub's answer was consolidation, for example nine issue tools merged into three.
- Cursor only sends the first 40 tools to the model, so "60+ tools are inaccessible" ([issue #1108, 2025-09-21](https://github.com/github/github-mcp-server/issues/1108)).
- Loading 3–10 hand-picked tools through `X-MCP-Tools` cuts context use by about 60–90% ([changelog, 2025-12-10](https://github.blog/changelog/2025-12-10-the-github-mcp-server-adds-support-for-tool-specific-configuration-and-more/)). Consolidating the Projects toolset saved about 23k tokens ([changelog, 2026-01-28](https://github.blog/changelog/2026-01-28-github-mcp-server-new-projects-tools-oauth-scope-filtering-and-new-features/)).

**The sprawl is not unique to GitHub.** Vercel's MCP lists about 213 tools across 28 categories ([Vercel MCP tools, updated 2026-09-15](https://vercel.com/docs/mcp/vercel-mcp/tools)).

**Fixes from the wider ecosystem:**
- **Anthropic Tool Search:** about 8.7k tokens instead of about 191k when tools are preloaded ([Anthropic, 2025-11-24](https://www.anthropic.com/engineering/advanced-tool-use)).
- **Anthropic code execution with MCP:** about 150k tokens down to about 2k ([summary, 2025-11-04](https://www.engineering.fyi/article/code-execution-with-mcp-building-more-efficient-agents)).
- **Cloudflare Code Mode:** turns MCP tools into a TypeScript API that the agent writes code against ([Cloudflare, 2025-09-26](https://blog.cloudflare.com/code-mode/); HN 84 points).
- **Lazy loading and progressive disclosure** as general patterns ([mcp.directory, 2026-05-04](https://mcp.directory/blog/mcp-context-bloat-fix-2026-tool-search-code-mode-progressive-disclosure); [AWS, 2026-07-09](https://aws.amazon.com/blogs/machine-learning/mcp-tool-design-practical-approaches-and-tradeoffs/)).

**Sentiment (HN and GitHub issues):**
- Simon Willison: "GitHub's official MCP on its own famously consumes tens of thousands of tokens of context" (quoted on [HN, 2025-10-18](https://news.ycombinator.com/item?id=45626259), from his Claude Skills post, which drew 738 points).
- "Mcp2cli – 96–99% fewer tokens than native MCP" drew 146 points and 100 comments, with a lot of "we had curl and OpenAPI, then created MCP, now we wrap MCP in CLIs" ([HN, 2026-03-09](https://news.ycombinator.com/item?id=47305149)).
- The counter-view, which matters for Beanstalk: "The real valuable capability MCP offers over skills/CLI is isolating the auth flow outside of the agent's context window" ([HN, 2026-06-18](https://news.ycombinator.com/item?id=48592163)).
- Users also report that MCP beats `gh` because "Claude doesn't really know how to use the gh CLI correctly unless you keep a cheat sheet" and MCP covers Discussions and draft reviews ([issue #1286](https://github.com/github/github-mcp-server/issues/1286)).
- An "Ask HN: Who is using MCP in production?" thread (198 points, [2026-09-03](https://news.ycombinator.com/item?id=49548600)) had this: "even GitHub's fine-grained tokens aren't always fine-grained enough… it's straightforward to build a small MCP server that exposes exactly the operations we want an agent to have" ([comment, 2026-09-04](https://news.ycombinator.com/item?id=49561457)).

### 1.3 Complaint #2: token scopes, impersonation, attribution

| GitHub credential | Lifetime | Identity it acts as | Agent problems |
|---|---|---|---|
| Classic PAT `ghp_` | Up to no expiry | The human, across every repo and org they can reach | Over-broad; the main thing leaked in the Shai-Hulud and s1ngularity attacks |
| Fine-grained PAT `github_pat_` (GA [2025-03-18](https://github.blog/changelog/2025-03-18-fine-grained-pats-are-now-generally-available/)) | Set by policy | The human | One resource owner only (multi-org was still a preview, [roadmap #1118, 2025-03-21](https://github.com/github/roadmap/issues/1118)); orgs must opt in or approve; can't read org membership ([devactivity, 2026-03-14](https://devactivity.com/insights/secure-github-org-access-the-fine-grained-pat-paradox-and-the-goal-of-software-engineering/)); doesn't cover collaborator or cross-org repos ([aws-samples, 2026-05-22](https://github.com/aws-samples/sample-autonomous-cloud-coding-agents/commit/e432060e4154702cb2b16a3ec4c905563de02225)) |
| OAuth App token | Long-lived; opt-in 8-hour token plus 6-month refresh since [2026-08-14](https://github.blog/changelog/2026-08-14-multiple-redirect-uris-and-token-refresh-for-oauth-apps/) | The human | Same blast radius as the human |
| GitHub App user-to-server `ghu_` | Short-lived plus refresh | The human, intersected with what the App was granted | Still impersonation |
| GitHub App installation token `ghs_` | 1 hour; moving to a stateless JWT of about 520 characters ([changelog, 2026-04-24](https://github.blog/changelog/2026-04-24-notice-about-upcoming-new-format-for-github-app-installation-tokens/)) | The App | Best blast radius and audit trail ([authsome, 2026-05-30](https://authsome.ai/blog/github-token-hygiene-for-ai-agents-pats-fine-grained-tokens-github-apps-and-oauth)), but no human accountability chain, and some agent APIs reject it |

**Impersonation is built into GitHub's own agent APIs:**
- The Agent Tasks REST API (public preview) accepts PATs and OAuth tokens only. Installation tokens are "coming soon" ([changelog, 2026-05-13](https://github.blog/changelog/2026-05-13-start-copilot-cloud-agent-tasks-via-the-rest-api/)), and "GitHub App installation tokens (server-to-server) do not work" ([startdebugging, 2026-06-21](https://startdebugging.net/2026/06/trigger-github-copilot-coding-agent-task-from-rest-api/)).
- Copilot's PRs are "co-committed with the initiating user and bear the Copilot identity" ([GitHub, 2025-11-25](https://github.blog/ai-and-ml/github-copilot/how-githubs-agentic-security-principles-make-our-ai-agents-as-secure-as-possible/)).
- Copilot's coding agent can only push to `copilot/*` branches, and its PRs need human approval before CI runs ([GitHub, 2025-09-11](https://github.blog/ai-and-ml/github-copilot/github-copilot-coding-agent-101-getting-started-with-agentic-workflows-on-github/)).
- Audit logs gained `actor_is_agent` plus the user it acted for, and `agent_session.task` events ([changelog, 2026-02-26](https://github.blog/changelog/2026-02-26-enterprise-ai-controls-agent-control-plane-now-generally-available/)).
- Enterprises can now block, approval-gate or allow agent shell, file and network operations ([changelog, 2026-09-09](https://github.blog/changelog/2026-09-09-enterprise-managed-permissions-for-github-copilot-agent-operations/)).
- Agentic Workflows dropped the PAT requirement and now use `GITHUB_TOKEN`, billed to the org ([changelog, 2026-06-11](https://github.blog/changelog/2026-06-11-agentic-workflows-no-longer-need-a-personal-access-token/)).

**Attribution disputes:**
- Claude Code adds `Co-Authored-By: Claude …` by default, which drew a "without user consent or opt-out" issue ([#47579, 2026-04-13](https://github.com/anthropics/claude-code/issues/47579)).
- Microsoft rolled back VS Code adding "Co-authored-by: Copilot" by default after complaints ([The Register, 2026-05-04](https://www.theregister.com/software/2026/05/04/microsoft-fixes-vs-code-after-copilot-credited-human-code/5223936)).
- "PR #911… was authored by kody-w. That's me. I didn't write a single line of it" ([kody-w, 2026-03-26](https://kody-w.github.io/2026/03/26/the-attribution-problem-when-your-ai-ships-code-under-your-name/)).
- Proposals for structured trailers such as `Generated-By: agent/version (model; operator)` ([Crash Override, 2026-05-08](https://crashoverride.com/resources/knowledge-base/code-ownership/attributing-ai-commits-git); [tim-schipper, 2026-09-08](https://tim-schipper.nl/en/blog/git-attribution-coding-agents)).

**Trusting an actor by its name is a real bug class.** `claude-code-action` "unconditionally trusted any actor whose name ended in `[bot]`." Any GitHub App could open issues, pass the check, inject a prompt, and exfiltrate secrets and OIDC tokens. It was patched in v1.0.94 ([GMO Flatt Security, 2026-06-01](https://flatt.tech/research/posts/poisoning-claude-code-one-github-issue-to-break-the-supply-chain/); [summary, 2026-06-03](https://singularity.kiwi/claude-code-github-actions-supply-chain-vulnerability/)).

**Practitioner sentiment:**
- "I almost can't believe how poor their support is for fine grained access tokens, org/individual credentials… as they drown in agent-driven usage" ([HN, 2026-07-30](https://news.ycombinator.com/item?id=49104761)).
- People improvise "each [agent] isolated with its own token" ([HN, 2026-06-21](https://news.ycombinator.com/item?id=48619352)), or "a separate GitHub account that has its own forks… merge… through a human" ([HN, 2026-04-08](https://news.ycombinator.com/item?id=47685038)).

### 1.4 Prompt injection through issues, PRs and comments: timeline

| Date | Incident | Vector | What leaked or what was possible | Root cause | Fix or mitigation |
|---|---|---|---|---|---|
| 2025-05-26 | **GitHub MCP "toxic agent flow"** ([Invariant](https://invariantlabs.ai/blog/mcp-github-vulnerability); HN 508 points, [thread](https://news.ycombinator.com/item?id=44097390)) | Malicious public issue; user asks "look at my open issues" | Private repo names, plans and salary, published in an autonomous PR on the public repo | One token covers public and private repos. "Not a flaw in the GitHub MCP server code… architectural… GitHub alone cannot resolve" | Least privilege; Invariant's "one repository per session" guardrail |
| 2025-08-26 to 29 | **s1ngularity / Nx** ([Wiz, 2025-08-27](https://www.wiz.io/blog/s1ngularity-supply-chain-attack); [BleepingComputer, 2025-09-06](https://www.bleepingcomputer.com/news/security/ai-powered-malware-hit-2-180-github-accounts-in-s1ngularity-attack/)) | Injection through a `pull_request_target` PR title, leading to a malicious npm publish | Over 1,000 valid GitHub tokens; malware *ran local AI CLIs* (Claude, Gemini, Q) with dangerous flags to find secrets; then made private repos public | Long-lived tokens on developer machines plus a weak CI workflow | Rotate tokens; harden workflows |
| 2025-10-08 | **CamoLeak**, CVE-2025-59145, CVSS 9.6 ([Legit](https://www.legitsecurity.com/blog/camoleak-critical-github-copilot-vulnerability-leaks-private-source-code); [SecurityWeek, 2025-10-09](https://www.securityweek.com/github-copilot-chat-flaw-leaked-data-from-private-repositories/); [BlackFog](https://www.blackfog.com/camoleak-how-github-copilot-became-an-exfiltration-channel/)) | Hidden markdown comment in a PR description | Private code and AWS keys, exfiltrated through pre-signed Camo image URLs | Copilot Chat runs with the viewer's full repo access and renders images | GitHub disabled image rendering in Copilot Chat (2025-08-14) |
| 2025-12-04 | **PromptPwnd** (Aikido; [InfoWorld, 2025-12-05](https://infoworld.media/article/4101743/ai-in-ci-cd-pipelines-can-be-tricked-into-behaving-badly.html)) | Issue, PR or commit text fed into AI actions (Gemini CLI, Claude Code Action, Codex, AI Inference) | `GITHUB_TOKEN`, cloud and API keys | Untrusted text plus privileged token plus shell | Restrict tools and triggers; sanitize input |
| 2026-04-15 | **Comment and Control** ([oddguan](https://oddguan.com/blog/comment-and-control-prompt-injection-credential-theft-claude-code-gemini-cli-github-copilot/); [analysis](https://tobias-weiss.org/articles/devops/comment-and-control-github-ai-agents/)) | PR titles, issue bodies, hidden HTML comments | Runner secrets from Claude Code Security Review, Gemini CLI Action and the Copilot agent. Copilot leaked even with environment filtering, secret scanning and a firewall; base64 got past pattern scans | "Entire attack completes without a single packet leaving GitHub" | Coordinated vendor fixes |
| 2026-06-01 | **claude-code-action `[bot]` bypass** ([Flatt](https://flatt.tech/research/posts/poisoning-claude-code-one-github-issue-to-break-the-supply-chain/)) | Issue from an attacker-controlled App | Write tokens; risk of poisoning the action's own repo, and with it every downstream repo | Identity check by name | `checkHumanActor`; environment variables scrubbed from child processes; wrapper around `gh` |
| 2026-07-08 | **GitLost** ([Noma](https://noma.security/blog/gitlost-how-we-tricked-githubs-ai-agent-into-leaking-private-repos/); HN 541 points, [thread](https://news.ycombinator.com/item?id=48827858)) | Issue title and body in a public repo, with GitHub Agentic Workflows triggered on assignment | READMEs of private org repos posted as a *public comment* | Workflow could read private repos *and* write to public; the word "Additionally" got past the guardrails | Disclosed to GitHub; remediation date not stated |

**GitHub's current defenses:**
- **Lockdown mode** (`X-MCP-Lockdown: true`). Content from users without push access is filtered out or errors. Private repos are unaffected.
- **Content sanitization by default.** Invisible Unicode, unsafe HTML, and hidden code-fence text are stripped ([changelog, 2025-12-10](https://github.blog/changelog/2025-12-10-the-github-mcp-server-adds-support-for-tool-specific-configuration-and-more/)). The origin is an opt-in "trusted repo" push-access filter added days before the Invariant post ([PR #428, 2025-05-23](https://github.com/github/github-mcp-server/pull/428)).
- **Agentic Workflows architecture** ([GitHub blog](https://github.blog/ai-and-ml/generative-ai/under-the-hood-security-architecture-of-github-agentic-workflows/); [gh-aw architecture](https://github.github.com/gh-aw/introduction/architecture/); [public preview, 2026-06-11](https://github.blog/changelog/2026-06-11-github-agentic-workflows-is-now-in-public-preview/)):
  - The agent runs read-only.
  - Writes are buffered as "safe outputs" and applied by separate, minimally scoped jobs.
  - A separate threat-detection agent with no write access must pass the output first.
  - The agent container sits behind an egress firewall, and an MCP gateway holds the credentials.
  - GitLost shows a safe output such as `add-comment` is still an exfiltration channel when the session also read private data.

**Design principles worth adopting:**
- **The lethal trifecta.** Private data plus untrusted content plus a way to communicate out equals exfiltration ([Simon Willison, 2025-06-16](https://simonwillison.net/2025/jun/16/the-lethal-trifecta/)).
- **Meta's "Agents Rule of Two."** In one session, an agent should have at most two of: untrusted inputs, sensitive data, and the ability to change state or communicate externally ([summary, 2025-11-01](https://www.mbgsec.com/weblog/2025-11-01-agents-rule-of-two-a-practical-approach-to-ai-agent-security/)).
- **Sentiment:** "if your LLM sees text from an untrusted source… assume that untrusted source can steer the LLM… If that… can result in tool calls, well now that untrusted source can use said tools too" ([HN, 2025-05-26](https://news.ycombinator.com/item?id=44097390)). "Many users… opt for an 'Always Allow' confirmation policy" (same thread). On GitLost: "This is like setting up a normal CI job with access to secrets and running it on public PRs" ([HN, 2026-07-08](https://news.ycombinator.com/item?id=48827858)).

### 1.5 How the MCP authorization spec evolved

| Version | Auth highlights |
|---|---|
| [2025-03-26](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization) | First OAuth 2.1-based authorization; the MCP server effectively doubled as the authorization server (AS) |
| [2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization) | MCP server becomes an OAuth *resource server*. Protected Resource Metadata (RFC 9728) and `WWW-Authenticate` discovery are mandatory. Clients must send `resource` (RFC 8707) and servers must check the token audience. Token passthrough is forbidden ([Den Delimarsky, 2025-06-18](https://den.dev/blog/mcp-authorization-resource/)) |
| [2025-11-25](https://aaronparecki.com/2025/11/25/1/mcp-authorization-spec-update) | **CIMD becomes the default**: the `client_id` is an HTTPS URL to a JSON metadata file. DCR is downgraded from SHOULD to MAY. Registration order: pre-registration, then CIMD, then DCR, then ask the user. OIDC discovery and PKCE `S256` clarified. Enterprise-Managed Authorization (Cross App Access, XAA) added as an extension ([Den, 2025-11-25](https://den.dev/blog/mcp-november-authorization-spec/)). **URL-mode elicitation** (SEP-1036) sends third-party OAuth and secrets out-of-band so they never pass through the client or model ([issue, 2025-12-08](https://github.com/modelcontextprotocol/servers/issues/3111); [WorkOS, 2026-01-09](https://workos.com/blog/mcp-url-mode-elicitation)) |
| 2026-01-26 | **MCP Apps**, the first official extension: tools return sandboxed-iframe UIs ([MCP blog](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/)) |
| 2026-06-18 | **Enterprise-Managed Authorization stable.** "Authorize once, inherit everywhere." Clients: Claude, Claude Code, VS Code. IdP: Okta. Servers include Asana, Atlassian, Figma, Linear, Supabase ([MCP blog](https://blog.modelcontextprotocol.io/posts/enterprise-managed-auth/); HN 278 points, [thread](https://news.ycombinator.com/item?id=48592163)) |
| [2026-07-28](https://blog.modelcontextprotocol.io/posts/2026-07-28/) | **"Dynamic Client Registration itself is now formally deprecated in favor of CIMD."** RFC 9207 `iss` validation (SEP-2468); credentials bound to their issuer (SEP-2352); DCR must declare `application_type` (SEP-837); scope step-up accumulation (SEP-2350); refresh-token guidance (SEP-2207). Also a **stateless core**: no `initialize` handshake or `Mcp-Session-Id`, multi-round-trip requests (MRTR), `Mcp-Method` and `Mcp-Name` routing headers, cacheable lists, a formal extensions framework (Tasks, Apps, EMA). Sampling, roots and logging deprecated with a 12-month window |

**Problems people raised:**
- **DCR was "a thorn in my side for the better part of the year."** Most authorization servers don't support it, so server builders re-implemented AS logic. DCR also brings DoS risk and an ever-growing client registry ([Den, 2025-11-25](https://den.dev/blog/mcp-november-authorization-spec/); [Parecki, 2025-11-25](https://aaronparecki.com/2025/11/25/1/mcp-authorization-spec-update)).
- **CIMD's own risks:** the AS must fetch a URL a stranger supplies (SSRF), localhost redirects can be spoofed, and owning a domain doesn't make a client trustworthy ([Auth0, 2025-11-24](https://auth0.com/blog/cimd-vs-dcr-mcp-registration/)).
- **URL elicitation** is open to "authorization link forwarding" unless the server binds the result to the actual user ([verifymcp, 2026-08-15](https://verifymcp.io/blog/mcp-elicitation)).
- **Tool annotations** (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) are advisory "claims, not guarantees" ([MCP blog, 2026-03-16](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/); [nhimg, 2026-08-19](https://nhimg.org/articles/mcp-tool-annotations-need-trust-not-just-metadata/)).
- HN: "MCP auth has been a huge pain point for us," and enterprises want out of "constant OAuth flows" ([HN, 2026-06-18](https://news.ycombinator.com/item?id=48592163)).

### 1.6 Agent identity standards and products, 2025–2026

**Workload identity (what the agent *is*):**
- SPIFFE/SPIRE issues short-lived SVIDs after attestation. HashiCorp Vault 1.21 and 2.0 added SPIFFE auth and a SPIFFE secrets engine ([HashiCorp, n.d.](https://www.hashicorp.com/en/blog/spiffe-securing-the-identity-of-agentic-ai-and-non-human-actors)).
- Critique: Kubernetes SPIFFE ties identity to the service account, so "all replicas… share the same identity." Agents need identities per instance ([Christian Posta, 2025-06-26](https://blog.christianposta.com/agent-identity-and-access-management-can-spiffe-work/)).
- **AIMS** (draft-klrc-aiagent-auth) builds agent authentication from OAuth, SPIFFE and WIMSE rather than a new protocol ([OAUTH-WG, 2026-03-02](https://www.mail-archive.com/oauth@ietf.org/msg25714.html)). The WIMSE working group opened an adoption call with broad support; multi-hop delegation and revocation are still open ([freenode, 2026-08-24](https://freenode.net/article/wimse-moves-to-adopt-ai-agent-auth-framework-draft)).
- The **Workload Authorization Grant** draft lets a platform sign a JWT that names a single agent and exchange it at an AS without provisioning each agent ([draft-carleton-workload-authz-grant-01, 2026-09-22](https://datatracker.ietf.org/doc/html/draft-carleton-workload-authz-grant-01)).

**Delegation (whom the agent acts *for*):**
- **RFC 8693 token exchange.** Delegation keeps both identities: `sub` is the human, `act` is the agent, and `act` can be nested into a chain. Impersonation hides the agent and should be avoided ([Auth0, 2026-06-03](https://auth0.com/blog/the-many-faces-of-oauth2-token-exchange/); [Cofide, 2026-09-02](https://www.cofide.io/resources/oauth-token-exchange-and-delegation-for-agentic-ai)).
- **draft-oauth-ai-agents-on-behalf-of-user** adds `requested_actor` (shown on the consent screen) and `actor_token`. The resulting JWT binds user, client and agent ([IETF -02, 2025-08-26](https://datatracker.ietf.org/doc/html/draft-oauth-ai-agents-on-behalf-of-user-02); [WorkOS, 2026-04-28](https://workos.com/blog/oauth-on-behalf-of-ai-agents)).
- **Microsoft Entra Agent ID** uses agent "blueprints" with inheritable permissions and on-behalf-of (OBO) flows. Agents *cannot* start interactive `/authorize` flows or get user consent directly; an admin pre-authorizes at the blueprint level ([entra.news, 2026-08-11](https://daily.entra.news/changes/2026-08-11/agent-on-behalf-of-oauth-flow-05/); [Posta, 2026-02-02](https://blog.christianposta.com/a-guide-to-microsoft-entra-agent-id-on-kubernetes/); [Semperis, 2026-07-10](https://www.semperis.com/blog/entra-agent-identities-design-deep-dive/)).
- **Okta Cross App Access / ID-JAG.** The app exchanges the user's ID token at the IdP (RFC 8693) for an ID-JAG, then presents it as a JWT bearer grant (RFC 7523) at the resource's AS. Agents are modeled as workload principals in Universal Directory ([Okta, 2025-06-23](https://developer.okta.com/blog/2025/06/23/enterprise-ai); [Okta XAA](https://www.okta.com/blog/product-innovation/cross-app-access-enterprise-ai/)).
- **Auth0 for AI Agents** (GA 2025-11-19): Token Vault holds third-party tokens and agents exchange for them, plus async approval and FGA for RAG ([Auth0, 2025-11-19](https://auth0.com/blog/auth0-for-ai-agents-generally-available/); [Token Vault, 2025-10-09](https://auth0.com/blog/auth0-token-vault-secure-token-exchange-for-ai-agents/)).
- **Ping:** a SPIFFE JWT-SVID as the `actor_token` and the user token as `subject_token`, re-minted with a new audience at each hop ([Ping, 2026-07-21](https://developer.pingidentity.com/blog/securing-agentic-workflows-with-token-exchange-and-workload-identity/)).

**Proof-of-possession and request signing:**
- A DPoP-bound credential presentation draft for agents ([draft-lee, 2026-09-28](https://datatracker.ietf.org/doc/html/draft-lee-oauth-dpop-credential-presentation-01)).
- **AAuth** (Dick Hardt, exploratory): each agent instance has its own key-bound identity `aauth:local@domain` and signs every request with HTTP Message Signatures (RFC 9421), so "a stolen token is useless without the private key" ([AAuth, 2025-10-25](https://github.laiyagushi.com/dickhardt/AAuth); [Posta, 2026-02-17](https://blog.christianposta.com/exploring-aauth-agent-auth-identity-and-access-management-for-ai-agents/)).
- **Cloudflare Web Bot Auth** (RFC 9421 signatures with a `Signature-Agent` key directory; [2025-05-15](https://blog.cloudflare.com/web-bot-auth/)) and **signed agents** for user-directed agents ([2025-08-28](https://blog.cloudflare.com/signed-agents/)).

**Cloudflare, for agents reaching protected apps:**
- **Access managed OAuth** (open beta, [2026-04-14](https://blog.cloudflare.com/managed-oauth-for-access/)). Any Access-protected app, including "web pages, web apps, and REST APIs," returns `WWW-Authenticate` with RFC 9728 discovery. The agent registers through DCR and runs PKCE, and the token is scoped to the human: "Every action an agent performs must be easily attributable to the human who initiated it."
- **MCP portal service tokens** for headless agents ([2026-06-26](https://developers.cloudflare.com/changelog/post/2026-06-26-mcp-portal-service-tokens/)).
- **Gateway MCP traffic classification** to block shadow MCP; portals support pre-registered OAuth clients ([2026-08-14](https://blog.cloudflare.com/mcp-security-updates/)).

**Credential brokers outside the model** are a growing pattern: Infisical Agent Vault ([HN 156 points, 2026-04-22](https://news.ycombinator.com/item?id=47865822)), OneCLI ([HN, 2026-07-23](https://news.ycombinator.com/item?id=49023427)), Kontext ([HN, 2026-04-14](https://news.ycombinator.com/item?id=47765374)). The pushback is that the proxy key then becomes the thing to steal, and "is anyone developing standards on how agents can proxy the requestor identity… short lived oauth tokens?" (Agent Vault thread).

### 1.7 MCP on Cloudflare Workers

**`@cloudflare/workers-oauth-provider`** ([repo](https://github.com/cloudflare/workers-oauth-provider), created 2025-03-11):
- Implements OAuth 2.1/PKCE and RFC 6750, 7009, 7591, 7636, 8414, **8693**, **8707**, 9207 and 9728. The README says it targets **MCP authorization 2026-07-28** and supports **CIMD**, plus pre-registered and DCR clients.
- Tokens, codes and secrets are stored only as hashes in KV.
- Props are "encrypted with a key only the token holder can unwrap." Upstream tokens (for example a GitHub OAuth token) stay encrypted and are never exposed to MCP clients ([Cloudflare remote MCP blog, Mar 2025](https://blog.cloudflare.com/remote-model-context-protocol-servers-mcp/)).
- It can serve multiple resource servers through Service Bindings.

**Track record:**
- Largely written with Claude and reviewed by Cloudflare engineers (README and HISTORY.md).
- **CVE-2025-4143:** `redirect_uri` wasn't validated at `/authorize`. Fixed in v0.0.5 ([GHSA, 2025-05-01](https://github.com/advisories/ghsa-4pc9-x2fx-p7vj)).
- Neil Madden's review found biased token-ID entropy, missing security headers and key-wrapping design issues ([2025-06-06](https://neilmadden.blog/2025/06/06/a-look-at-cloudflares-ai-coded-oauth-library/)).
- It is usable, but Beanstalk should fuzz and audit it and pin versions.

**Hosting patterns:**
- `McpAgent` (Durable Object-backed, stateful) and the stateless `createMcpHandler`, wrapped by `OAuthProvider`, with `getMcpAuthContext()` inside tools ([cloudflare/agents example](https://github.com/cloudflare/agents/tree/main/examples/mcp-worker-authenticated)).
- A GitHub-OAuth MCP demo ([cloudflare/ai](https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-github-oauth)).
- The **stateless 2026-07-28 core** (no sessions, header routing) fits Workers well. Durable Objects are only needed for real per-session state.

### 1.8 Implications for Beanstalk: auth and MCP

1. **Make the agent a first-class principal.** Model it as `agent:{id}` with an owning operator (user or org), harness and model metadata, and a per-run *instance* ID. Never accept "agent as a renamed user" or "trusted because the name ends in `[bot]`."
2. **Delegate; never impersonate.** Every agent token carries `sub` (the human or org), `act` (the agent instance, nestable for sub-agents), `azp` (the client), and `session` and `task` IDs, following RFC 8693 delegation semantics. Show the chain in the UI, the audit log, webhooks and commit metadata. Ship `actor_is_agent`-style fields from day one.
3. **Replace PATs with task-scoped grants.** A grant names repos, ref patterns (default: push only to `agents/{session}/*`, like Copilot's `copilot/*`), operations (read, push to its own branches, open a PR, comment, run a preview), data classes (public or private), TTL (minutes to hours) and budget.
   - Mint short-lived, audience-bound (RFC 8707) access tokens, with optional DPoP or HTTP-signature binding.
   - Stateless JWT access tokens (GitHub is moving its installation tokens to JWTs) can be verified at the edge with no KV lookup. Keep revocation in a Durable Object or KV denylist.
4. **Use standard on-ramps rather than custom key management:**
   - OAuth 2.1 MCP auth through `workers-oauth-provider` with CIMD first, DCR only for legacy clients, `iss` and audience validation.
   - Device flow for CLIs.
   - EMA / ID-JAG for enterprises (Okta and Entra are where buyers already are).
   - OIDC token exchange from CI and SPIFFE JWT-SVIDs for server-side agents.
   - URL-mode elicitation for third-party credentials such as deploy targets.
5. **Enforce the Rule of Two in the platform, not the prompt.**
   - Track session taint. Once a session has read content from a non-trusted author (issue, comment, fork PR, preview page), it loses either (a) read access to other private repos or (b) unapproved write access to any public surface.
   - Default to one repo per session.
   - Stage writes as reviewable "proposed outputs," as Agentic Workflows does, and *also* apply data-flow checks to those outputs. GitLost is the case to test against.
6. **Label every piece of content with its provenance.** Mark each item from the API or MCP as maintainer, collaborator, external, anonymous or agent. Apply lockdown filtering for external content in agent sessions by default. Strip what humans can't see (hidden Unicode, HTML comments, invisible markdown, image beacons) so agents see exactly what humans see.
7. **Build a small MCP surface plus a CLI:**
   - About 10–15 task-shaped tools, with `structuredContent`, output caps and cursors.
   - A code-mode `search`/`execute` pair for the long tail.
   - Accurate annotations; per-tool scopes in `scopes_supported`; step-up through `insufficient_scope`.
   - A JSON CLI with the same verbs, because shell-capable agents prefer CLIs and skills for token cost.
   - MCP Apps for diffs and previews in chat.
8. **Make attribution signed and structured.** Use agent-signed commits (a per-agent key or keyless with agent identity), with server-verified trailers: `Agent`, `On-Behalf-Of`, `Session`, `Model`. Keep separate human and agent contribution graphs. Let users control trailers and never add co-authors silently.

---

## 2. Live previews of PRs and branches

### 2.1 Landscape

| Product | Model | Agent hooks | Notes |
|---|---|---|---|
| **Vercel** | Per-commit and per-branch preview URLs; Deployment Protection (Vercel Auth, password, Trusted IPs) | **Protection Bypass for Automation**: `x-vercel-protection-bypass` header or query parameter, `x-vercel-set-bypass-cookie`; several secrets per project; rotating one invalidates old deployments ([docs, 2026-09-16](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)). **Vercel MCP** `web_fetch_vercel_url` ("including protected deployments you can access"), `get_runtime_logs`, `get_runtime_errors`, toolbar threads ([2026-09-15](https://vercel.com/docs/mcp/vercel-mcp/tools)) | Vercel Agent reviews PRs in a sandbox (beta Oct 2025); fixes failed native deployment checks ([2026-04-28](https://ngtech.app/insights/2026-04-28-vercel-adds-native-deployment-checks-with-agent-assisted-pr-fixes)); runs as its own principal, read-only by default, approved plans ([2026-07-09](https://reasoncore.dev/post/vercel-agent-delivers-scoped-sandboxed-production-automation)); `agent-browser` Rust CLI ([2026-01](http://github.com/vercel-labs/agent-browser)) |
| **Netlify** | Deploy Previews `deploy-preview-N--site` plus permalinks; Git providers include Cursor Origin ([docs](https://docs.netlify.com/deploy/deploy-types/deploy-previews/)) | **Agent Runners** create `agent-{run}--site` previews; preview screenshot on each run ([2026-03-03](https://www.netlify.com/changelog/2026-03-03-agent-runs-deploy-preview-screenshot/)); live preview inline next to the prompt ([2026-09-28](https://www.netlify.com/changelog/2026-09-28-agent-runners-side-by-side-preview/)) | With password protection on, the screenshot shows the sign-in page, which illustrates the auth-wall problem |
| **Cloudflare Workers** | Per-branch preview URLs and aliases ([2025-07-23](https://developers.cloudflare.com/changelog/post/2025-07-23-workers-preview-urls/)); preview URLs **opt-in by default** "to prevent the accidental exposure of applications" ([2025-09-17](https://developers.cloudflare.com/changelog/post/2025-09-17-update-preview-url-setting/)); **Worker Previews** ([2026-09-22](https://blog.cloudflare.com/worker-previews/)) | Built for agent loops; see section 2.2 | Workers Builds posts preview URLs to GitHub, GitLab and **Cursor Origin** PRs ([2026-09-22](https://developers.cloudflare.com/changelog/post/2026-09-22-cursor-origin-workers-builds/)) |
| **Cloudflare Sandbox SDK** | `exposePort` with custom tokens, moving to **tunnels** (quick `trycloudflare` or named; [2026-05-29](https://developers.cloudflare.com/changelog/post/2026-05-29-sandbox-named-tunnels/)); **SDK 1.0**: your Durable Object controls the container and serves previews from ports with custom hostnames ([2026-09-30](https://developers.cloudflare.com/changelog/post/2026-09-30-sandbox-sdk-1-0/)) | Credential injection without the agent seeing secrets ([Sandbox GA, 2026-04-13](https://blog.cloudflare.com/sandbox-ga/)) | Route for non-Workers apps (any dev server) |
| **Cursor Origin** (Cursor's new git host) | Repos, PRs, GitHub sync, built-in agents; Vercel previews on day one ([Cursor, 2026-08-17](https://cursor.com/changelog/origin-code-hosting); [InfoQ, 2026-08-25](https://www.infoq.com/news/2026/08/cursor-origin-alternative-github/)) | "Agent-native features to follow" | HN: 597 points and 454 comments ([thread](https://news.ycombinator.com/item?id=49334209)); a direct competitor whose previews are borrowed from Vercel |
| **GitHub Copilot cloud agent** | Ephemeral GitHub Actions environment (`copilot-setup-steps.yml`) | Its own Playwright MCP browser since [2025-07-02](https://github.blog/changelog/2025-07-02-copilot-coding-agent-now-has-its-own-web-browser/); screenshots in PRs; org-wide firewall ([2026-04-03](https://github.blog/changelog/2026-04-03-organization-firewall-settings-for-copilot-cloud-agent/)) | No hosted per-PR preview URL; GitHub relies on third-party deployments |
| **Ona** (formerly Gitpod, renamed [2025-09-02](https://ona.com/stories/gitpod-is-now-ona)) | Sandboxed environments in the cloud or a customer VPC, plus agents and guardrails | Agents run in the environment | Compute-unit (OCU) pricing "can lead to bill shock" ([Register, 2025-09-03](https://www.theregister.com/software/2025/09/03/gitpod-rebrands-as-ona-now-an-ai-driven-dev-platform/295031)) |
| **Coder** | Terraform templates; **Coder Tasks**, an ephemeral workspace per agent task; **Agent Boundaries** for egress ([docs commit, 2025-10-08](https://github.com/coder/coder/commit/79736154db612b649579c541677f8d0bf76d9d41)) | Agents "inherit exactly the user's permissions" ([2026-03-18](https://github.com/coder/coder/commit/481c132135c02100b21be60b4824a381cf9a9df9)) | Self-hosted |
| **Okteto** | Ephemeral environments inside your Kubernetes cluster, connected to real services ([2026-02-23](https://www.okteto.com/blog/the-missing-infrastructure-layer-thats-breaking-agentic-development/)) | Claude Code and Copilot plugins ([2026-03-23](https://github.com/okteto/okteto-claude-plugins)) | "Sandboxes are a starting point; governed environments are the destination" |
| **Signadot** | Request-level sandboxes on a shared baseline; RouteGroups combine multi-PR features | **MCP server** to create previews and tests ([2025 review, 2025-12-18](https://www.signadot.com/blog/2025-in-review-metrics-releases-and-enabling-the-agentic-era/)) | Avoids copying the whole stack |
| Release, Uffizzi, Bunnyshell, Northflank, Qovery, Shipyard | Full-stack per-PR environments (Release treats database templates and snapshots as first-class; Uffizzi uses virtual clusters) ([Northflank, 2026-03-18](https://northflank.com/blog/tools-for-ephemeral-environments); [Autonoma, 2026-07-13](https://getautonoma.com/blog/ephemeral-environment-platforms-compared)) | Shipyard plus Claude for visual diffs (see 2.5) | Uffizzi and Release are still active in 2026 |

### 2.2 Cloudflare Worker Previews, in detail (Beanstalk's native substrate)

**What it is:** "Each Git branch gets a production-like place to run, with its own code, configuration, URL, observability, and state" ([blog, 2026-09-22](https://blog.cloudflare.com/worker-previews/)).
- Deploy with `npx wrangler preview` (Wrangler 4.135.0 or later).
- A stable URL per preview, plus immutable URLs per deployment.
- Custom domains such as `feature-x.previews.example.com` give cookie, CORS and OAuth parity, and can sit behind **Cloudflare Access**.
- Production and all previews appear in one dashboard view.

**Built explicitly for agents:** "deploy, open the URL with Playwright MCP, click through, query the traces through the Workers Observability MCP server, patch, redeploy, and verify." Cloudflare calls this an "Agent Development Lifecycle" ([blog](https://blog.cloudflare.com/worker-previews/); [InfoQ, 2026-09-29](https://www.infoq.com/news/2026/09/cloudflare-worker-agent/)).

**Isolation** ([resources doc](https://developers.cloudflare.com/workers/previews/resources/)):
- **Automatically isolated:** Durable Object namespaces and storage; Container apps and instances.
- **Shared with production by default:** D1 ("Two Previews sharing the same `database_id` share rows"), KV, R2 and Queues. You must bind separate resources in the `previews` block to isolate them.
- **Not isolatable:** Workflows bind to existing Workflows. "Service bindings from a Preview call the bound Worker's production deployment." "Routes and Cron Triggers target production. Queue consumers cannot target a Preview" ([overview](https://developers.cloudflare.com/workers/previews/)).
- **Migrations:** Cloudflare suggests a shared staging D1 plus a separate `wrangler.preview-migrations.jsonc`.
- Third-party tools fill the binding gap. One creates a D1, R2 and KV set per branch and runs migrations plus `seed.sql` ([cf-branch-wrangler, 2026-02-25](https://registry.npmjs.org/@idpflare/cf-branch-wrangler)). Alchemy can clone a D1 by export and import ([commit, 2026-04-29](https://github.com/alchemy-run/alchemy-effect/commit/555e8ff6f613405e7f007007cb4db760558f5b79)).

**Limits:**
- 100 previews per Worker on Free, 500 on Paid; 100 deployments per preview.
- When a limit is hit, the least-recently-deployed preview (or the oldest deployment) is deleted.
- Manual deletion: `wrangler preview delete`.
- Secrets are applied by command, never kept in config.

**Observability** ([test-and-debug doc](https://developers.cloudflare.com/workers/previews/test-and-debug/)):
- Logs and traces per preview with `persist: true`.
- Tail Workers. `wrangler tail` does *not* support previews.
- GraphQL analytics filtered with `isPreview: 1`.
- Workers Observability MCP.
- Advice to put a debug ID in URLs so browser runs can be matched to traces. "Browser Run is useful when you want the review artifact to include what a browser actually rendered."

**Browser Run** (renamed from Browser Rendering): quick actions (screenshot, PDF, markdown, JSON extraction), full Puppeteer, Playwright or CDP sessions, and the `@cloudflare/playwright-mcp` fork ([docs](https://developers.cloudflare.com/browser-run/); [Playwright MCP, 2025-05-28](https://developers.cloudflare.com/changelog/post/2025-05-28-playwright-mcp/)).

### 2.3 Complaints about preview environments

- **Data and seeding is "the trickiest piece."** Teams choose between an empty schema, a sanitized production dump, or synthetic data ([InstaDevOps, 2026-07-11](https://instadevops.com/blog/ephemeral-preview-environments-guide/)).
  - For agents, seeds must be **deterministic** (explicit PRNG seed), idempotent, separate from migrations, and record their provenance, so a failing environment can be recreated exactly ([InfraGap, 2026-07-28](https://infragap.com/database-branching/); [PreviewProof, 2025-11-01](https://previewproof.com/blog/seed-postgres-database-ephemeral-preview-environments/)).
  - Copy-on-write branching solves it for Postgres. Neon's Vercel integration branches automatically for each preview and injects that branch's `DATABASE_URL`. Supabase requires paid Branching. PlanetScale makes you script it ([Autonoma, 2026-07-16](https://getautonoma.com/blog/connect-a-database-to-vercel-preview-deployments); [Neon, 2025-12-04](https://neon.com/blog/practical-guide-to-database-branching)). Neon also offers anonymized-PII branches ([2025-11-11](https://neon.com/blog/branching-environments-anonymized-pii)).
  - Cloudflare D1 has no native copy-on-write branching yet (see 2.2).
- **Secrets:** never copy production secrets. Fetch per-environment credentials from a secret manager and regenerate them when an environment is cloned ([Atmosly, 2026-07-02](https://atmosly.com/blog/preview-environments-done-right-a-full-environment-per-pr-cloned-safely)). PRs from forks are the attacker-controlled case; see section 1.4.
- **Cost and orphans:** environments must have a TTL, event-driven teardown and a backstop sweep, plus nightly scale-down ([Atmosly](https://atmosly.com/blog/preview-environments-done-right-a-full-environment-per-pr-cloned-safely)). The Cloudflare-specific horror story: "Durable Object alarm loop: $34k in 8 days, zero users, no platform warning," with replies asking for per-binding spend caps ([HN, 2026-04-16](https://news.ycombinator.com/item?id=47787042)).
- **Auth walls versus automation:**
  - Testers need bypass secrets ([Vercel docs](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)). The query-parameter form ends up in URLs, logs and webhook configs.
  - Newer guidance prefers short-lived OIDC headers (`x-vercel-trusted-oidc-idp-token`) and says "do not seek long-lived bypass secrets" ([skill, 2026-09-02](https://www.skillsdirectory.com/skills/nuroctane-access-protected-vercel-deployment)).
  - Without credentials, Netlify's agent screenshot shows a login page ([Netlify, 2026-03-03](https://www.netlify.com/changelog/2026-03-03-agent-runs-deploy-preview-screenshot/)).
- **OAuth redirect URIs.** Google does byte-exact matching with no wildcards ([guide, 2026-05-17](https://aitoolsguidebook.com/en/articles/auth-redirect-wrong/)). Wildcards on public suffixes like `*.vercel.app` are disallowed ([WorkOS, 2026-03-27](https://workos.com/blog/redirect-uris-for-local-staging-and-production)). Netlify's `*--site` pattern broke a validator ([django-oauth-toolkit #1619, 2025-11-07](https://github.com/django-oauth/django-oauth-toolkit/issues/1619)). Supabase `redirectTo` fails on Vercel previews ([2026-06-27](https://www.iloveblogs.blog/post/fix-supabase-redirectto-not-working-vercel-preview)). GitHub OAuth apps gained up to 10 redirect URIs plus optional wildcard matching ([2026-08-14](https://github.blog/changelog/2026-08-14-multiple-redirect-uris-and-token-refresh-for-oauth-apps/)).
- **Parity and fidelity.** Service bindings, cron, queues and Workflows go to production in Worker Previews (see 2.2). Preview-context environment variables differ, so visual diffs pick up config differences ([Delta-QA, 2026-08-02](https://delta-qa.com/en/blog/regression-testing-netlify-deploy-previews/)). Changes spanning several services need composed previews (Signadot RouteGroups).
- **Exposure.** Cloudflare made preview URLs opt-in because they leaked apps (see the table in 2.1). Preview URLs are discoverable and need protection by default.
- **Readiness and speed:** environments should be ready in a couple of minutes ([InstaDevOps](https://instadevops.com/blog/ephemeral-preview-environments-guide/)). Agents need a "ready" signal, not polling.

### 2.4 Browsers in the agent loop

- **Playwright MCP** works from accessibility-tree snapshots and doesn't need a vision model ([GitHub MCP registry, 2025-09-09](https://github.com/mcp/microsoft/playwright-mcp)). It used to be very token-heavy: "accessibility trees can be 10,000+ tokens per page interaction" ([bswen, 2026-03-18](https://docs.bswen.com/blog/2026-03-18-playwright-mcp-vs-cli-token-efficiency/)). Since 0.0.78 it writes snapshots to disk and returns a path. Measured cost is now about the same as `@playwright/cli`, so the choice comes down to whether the agent has shell access ([dev.to, 2026-07-15](https://dev.to/aswani25/playwright-cli-vs-playwright-mcp-which-should-you-use-with-claude-code-1olh)).
- **Chrome DevTools MCP** (public preview [2025-09-23](https://developer.chrome.com/blog/chrome-devtools-mcp)) adds performance traces, network and console data, and auto-connect to a live, signed-in browser session. The HN thread drew 604 points and 234 comments ([2026-03-15](https://news.ycombinator.com/item?id=47390817)). "The official Chrome DevTools MCP [is] excellent… Lighter than Playwright" ([HN, 2026-03-24](https://news.ycombinator.com/item?id=47499672)).
- **CLIs and skills instead of MCP:**
  - "Playwright Skill for Claude Code – less context than playwright-MCP" (189 points). Simon Willison: "I'm using Playwright so much right now… [prompt to] exercise this UI… fix it and demonstrate the fix." Another commenter couldn't get Playwright MCP to take a full-page screenshot, but a one-off Playwright script worked first try ([HN, 2025-10-20](https://news.ycombinator.com/item?id=45642911)).
  - ProofShot records video, screenshots and logs as proof (161 points). A sobering caveat in that thread: "coding agents are very bad at detecting UX issues" ([HN, 2026-03-24](https://news.ycombinator.com/item?id=47499672)).

### 2.5 How agents verify a PR from its preview today

1. **Event-driven end-to-end runs.** Wait for `deployment_status`, take the *commit-specific* preview URL, run Playwright and make it a required check ([Shiplight, 2026-07-12](https://www.shiplight.ai/blog/test-vercel-preview-deployments); [TesterArmy, 2026-06-05](https://tester.army/blog/run-e2e-tests-on-vercel-preview-deployments)).
2. **Agent loop against a live preview:** deploy, browse, read traces, patch, redeploy. This is Cloudflare's ADLC ([blog](https://blog.cloudflare.com/worker-previews/)), and Vercel MCP's fetch-protected-URL plus runtime logs ([tools](https://vercel.com/docs/mcp/vercel-mcp/tools)).
3. **Main-versus-branch visual diffs.** Claude Code plus Playwright MCP finds changed routes from `git diff`, screenshots both the feature environment and `main`, and posts both to the PR ([Shipyard, 2026-02-27](https://shipyard.build/blog/visual-diffs-with-claude-playwright-github-actions/)). Other examples: GitHub's gh-aw visual regression checker across three viewports with accessibility snapshots ([PR #28550, 2026-04-26](https://github.com/github/gh-aw/pull/28550)); RenderPR, which screenshots four viewports and posts an LLM review ([2026-06-08](https://p.rst.im/q/Github.com/pelazas/renderpr)).
4. **Behavioral replay.** Meticulous records real sessions, replays them against base and head with recorded network responses for determinism, and diffs screenshots. You accept or reject each diff and the baseline updates ([guide, 2026-07-02](https://qaskills.sh/blog/meticulous-ai-visual-testing-guide)). It can now replay against an uploaded container instead of a preview URL ([changelog, 2026-03-02](https://app.meticulous.ai/changelog/2026-03-02)). It also ships agent skills ([2026-03-10](https://github.com/alwaysmeticulous/skills)).
5. **Proof bundles on the PR:** live URL, screenshots at several viewports, console and page errors, test results, an optional video. Rule: "if previews fail, the change is flagged as unverified" ([CloudAxis, 2026-07-22](https://cloudaxis.ai/blog/proof-of-work-pull-requests-preview-screenshots-tests/)). A proposed merge rule: no agent PR merges without a green preview that a human has walked through ([otf-kit, 2026-09-06](https://otf-kit.dev/blog/preview-deployments-ai-agent-review)).

### 2.6 "Preview as an MCP tool": a proposed surface for Beanstalk

No git host offers these as native, permissioned verbs on the branch itself. A proposal, kept small and friendly to code mode:

| Tool | Purpose | Returns (handles, not blobs) |
|---|---|---|
| `preview_ensure(ref)` | Create or wake the preview for a ref and wait until healthy (idempotent) | URL, deployment ID, commit SHA, seed ID, ready time |
| `preview_http(ref, method, path, as)` | Server-side request through the auth wall as `anon`, a seeded test user, or the agent. Generalizes Vercel's `web_fetch_vercel_url` | Status, headers, truncated body, timing, `traceId` |
| `preview_browse(ref, script, viewports, record)` | Run a Playwright script in Browser Run. One code-mode tool instead of 30 click tools | Screenshot, video and trace handles; console errors; failed requests; accessibility snapshot path |
| `preview_logs(ref, since, traceId, query)` | Slice of logs and traces from per-preview Workers Observability | Structured events |
| `preview_compare(base="main", head=ref, routes or flows, checks)` | **Behavior diff.** Same browser build, viewport, seed and clock on both sides. Checks: pixel and DOM diff, new console errors, network and HTTP response diffs, performance deltas (TTFB, LCP) | Per-route verdicts plus artifact handles |
| `preview_replay(ref, sessions, base)` | Replay recorded or synthetic sessions with recorded network responses, Meticulous-style | Divergences |
| `preview_data(ref, op=seed / reset / snapshot / query)` | Deterministic seed from an in-repo spec; snapshot for reproduction; read-only SQL against the preview's D1 | Seed and snapshot IDs, rows |
| `preview_share(ref, audience, ttl)` | Signed, Access-protected link for humans, or an MCP App iframe in chat | Link or UI resource |
| `preview_attest(ref, evidence)` | Turn the run into a signed **proof bundle check run** on the PR (commit, deployment, scripts, artifact hashes) | Check-run ID; branch protection can require it for agent PRs |

**Design rules:**
- **Keep a warm `main` baseline preview** on the same seed, so comparisons are like-for-like. Production has different data.
- **Ship a preview manifest in the repo** (for example `.beanstalk/preview.*`): seed spec, test users, critical flows and routes, health check. Agents then know *what* to verify.
- **Treat preview output as untrusted.** A fork PR's page is attacker-controlled HTML rendered into the agent's context. Tag it as untrusted and apply the taint rules from 1.8.
- **Return handles plus small summaries;** store artifacts in R2. This avoids the browser-MCP token problem.

### 2.7 Implications for Beanstalk: previews

1. **Use Worker Previews as the substrate for Workers apps,** and Sandbox SDK 1.0 or Containers with port previews for anything else. Ingest external deployments (Vercel, Netlify) through a deployments and status API so agents find every preview the same way.
2. **Close Cloudflare's isolation gaps in the platform:**
   - Create a D1, KV, R2 and Queue set per preview automatically, seeded from the manifest.
   - *Refuse* to bind a preview to production data unless explicitly allowed.
   - Run previews of dependent Workers across repos together, so service bindings don't silently call production.
3. **Use preview-scoped secrets only.** Fork and untrusted PRs get no secrets, restricted egress and synthetic data.
4. **Put cost guardrails on each preview:** TTL and idle teardown, alarm-rate and CPU budgets, a spend cap per preview, and an LRU policy shown to users.
5. **Protect previews by default.** Humans sign in with SSO; agents use delegated tokens (Access-style managed OAuth or signed agent requests), not bypass secrets in URLs. Provide a stable OAuth callback broker (for example `auth.previews.{domain}`) that sends logins back to the right preview, fixing redirect-URI mismatches. Offer custom-domain previews for cookie and CORS parity.
6. **Make verification evidence a first-class part of review:** proof bundles as check runs, an optional merge rule for agent PRs, and a side-by-side view of base, head and the diff in the PR. Netlify and Cursor are converging on showing the preview inline in the conversation.

---

## 3. Open questions and risks

- **Standards are still moving.** AIMS (WIMSE) and the on-behalf-of draft aren't settled, and multi-hop delegation and revocation are listed as "post-adoption work." Build on RFC 8693, 8707 and 9728 plus CIMD and EMA, which are stable, and keep agent-identity claims extensible.
- **MCP versus CLI.** Developer sentiment favors CLIs and skills for token cost, while enterprises value MCP for keeping auth outside the model and for central governance. Ship both and measure.
- **`workers-oauth-provider`** is AI-assisted code with a CVE history. Audit it, fuzz it and pin versions; consider a second implementation to compare against.
- **Cloudflare Worker Previews is weeks old** (2026-09-22). The isolation gaps and limits may change, so Beanstalk's preview abstraction should hide them.
- **Agents are weak UX judges** (ProofShot thread). Proof bundles should support human review, not replace it. Visual diffs need deterministic seeds, clocks and fonts or they flake.
- **Competition:** Cursor Origin (August 2026) ships repos, PRs and agents with Vercel previews. GitHub ships Agentic Workflows and Agent HQ. Owning previews and the verification loop natively on Cloudflare is a clear point of difference.

---

## 4. Source index (by section; dates as published)

**GitHub MCP and GitHub identity**
- github/github-mcp-server README (n.d.): https://github.com/github/github-mcp-server
- Discussion #1182, default toolsets, 101 tools / 64.6k tokens (2025-10-06): https://github.com/github/github-mcp-server/discussions/1182
- Issue #1286, excessive context (late 2025): https://github.com/github/github-mcp-server/issues/1286
- Issue #1108, remote toolset config, Cursor 40-tool cap (2025-09-21): https://github.com/github/github-mcp-server/issues/1108
- Changelog, X-MCP-Tools plus Lockdown (2025-12-10): https://github.blog/changelog/2025-12-10-the-github-mcp-server-adds-support-for-tool-specific-configuration-and-more/
- Changelog, OAuth scope filtering, Insiders, HTTP mode (2026-01-28): https://github.blog/changelog/2026-01-28-github-mcp-server-new-projects-tools-oauth-scope-filtering-and-new-features/
- Practical guide to the remote MCP server (2025-07-30): https://github.blog/ai-and-ml/generative-ai/a-practical-guide-on-how-to-use-the-github-mcp-server/
- Policies and governance doc (n.d.): https://github.com/github/github-mcp-server/blob/main/docs/policies-and-governance.md
- PR #428, trusted-repo filter (2025-05-23): https://github.com/github/github-mcp-server/pull/428
- Fine-grained PATs GA (2025-03-18): https://github.blog/changelog/2025-03-18-fine-grained-pats-are-now-generally-available/
- Roadmap #1118, multi-org fine-grained PATs (2025-03-21): https://github.com/github/roadmap/issues/1118
- Agentic security principles (2025-11-25): https://github.blog/ai-and-ml/github-copilot/how-githubs-agentic-security-principles-make-our-ai-agents-as-secure-as-possible/
- Copilot coding agent 101 (2025-09-11): https://github.blog/ai-and-ml/github-copilot/github-copilot-coding-agent-101-getting-started-with-agentic-workflows-on-github/
- Copilot agent browser (2025-07-02): https://github.blog/changelog/2025-07-02-copilot-coding-agent-now-has-its-own-web-browser/
- Agent HQ (2025-10-28): https://github.blog/news-insights/company-news/welcome-home-agents/
- Enterprise AI controls, `actor_is_agent` (2026-02-26): https://github.blog/changelog/2026-02-26-enterprise-ai-controls-agent-control-plane-now-generally-available/
- Org firewall for the cloud agent (2026-04-03): https://github.blog/changelog/2026-04-03-organization-firewall-settings-for-copilot-cloud-agent/
- Installation token JWT format (2026-04-24): https://github.blog/changelog/2026-04-24-notice-about-upcoming-new-format-for-github-app-installation-tokens/
- Agent Tasks REST API (2026-05-13): https://github.blog/changelog/2026-05-13-start-copilot-cloud-agent-tasks-via-the-rest-api/
- Agentic Workflows public preview (2026-06-11): https://github.blog/changelog/2026-06-11-github-agentic-workflows-is-now-in-public-preview/
- Agentic Workflows without a PAT (2026-06-11): https://github.blog/changelog/2026-06-11-agentic-workflows-no-longer-need-a-personal-access-token/
- Agentic Workflows security architecture (2026): https://github.blog/ai-and-ml/generative-ai/under-the-hood-security-architecture-of-github-agentic-workflows/
- OAuth apps: multiple redirect URIs and refresh tokens (2026-08-14): https://github.blog/changelog/2026-08-14-multiple-redirect-uris-and-token-refresh-for-oauth-apps/
- Enterprise-managed agent permissions (2026-09-09): https://github.blog/changelog/2026-09-09-enterprise-managed-permissions-for-github-copilot-agent-operations/

**Incidents**
- Invariant Labs, GitHub MCP exploit (2025-05-26): https://invariantlabs.ai/blog/mcp-github-vulnerability (HN https://news.ycombinator.com/item?id=44097390)
- Wiz, s1ngularity (2025-08-27): https://www.wiz.io/blog/s1ngularity-supply-chain-attack
- BleepingComputer, s1ngularity (2025-09-06): https://www.bleepingcomputer.com/news/security/ai-powered-malware-hit-2-180-github-accounts-in-s1ngularity-attack/
- Legit Security, CamoLeak (2025-10): https://www.legitsecurity.com/blog/camoleak-critical-github-copilot-vulnerability-leaks-private-source-code
- SecurityWeek, CamoLeak (2025-10-09): https://www.securityweek.com/github-copilot-chat-flaw-leaked-data-from-private-repositories/
- InfoWorld, PromptPwnd (2025-12-05): https://infoworld.media/article/4101743/ai-in-ci-cd-pipelines-can-be-tricked-into-behaving-badly.html
- Comment and Control (2026-04-15): https://oddguan.com/blog/comment-and-control-prompt-injection-credential-theft-claude-code-gemini-cli-github-copilot/
- GMO Flatt Security, claude-code-action (2026-06-01): https://flatt.tech/research/posts/poisoning-claude-code-one-github-issue-to-break-the-supply-chain/
- Noma Security, GitLost (2026-07; HN 2026-07-08): https://noma.security/blog/gitlost-how-we-tricked-githubs-ai-agent-into-leaking-private-repos/ (HN https://news.ycombinator.com/item?id=48827858)
- Simon Willison, lethal trifecta (2025-06-16): https://simonwillison.net/2025/jun/16/the-lethal-trifecta/
- Meta Rule of Two, summary (2025-11-01): https://www.mbgsec.com/weblog/2025-11-01-agents-rule-of-two-a-practical-approach-to-ai-agent-security/

**MCP specification**
- 2025-06-18 authorization spec: https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
- Den Delimarsky, RFC 8707 resource parameter (2025-06-18): https://den.dev/blog/mcp-authorization-resource/
- Aaron Parecki, November 2025 spec update (2025-11-25): https://aaronparecki.com/2025/11/25/1/mcp-authorization-spec-update
- Den Delimarsky, November 2025 spec (2025-11-25): https://den.dev/blog/mcp-november-authorization-spec/
- Auth0, CIMD vs DCR (2025-11-24): https://auth0.com/blog/cimd-vs-dcr-mcp-registration/
- URL elicitation, SEP-1036 (2025-12-08): https://github.com/modelcontextprotocol/servers/issues/3111
- MCP Apps (2026-01-26): https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/
- Tool annotations (2026-03-16): https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/
- Enterprise-Managed Authorization (2026-06-18): https://blog.modelcontextprotocol.io/posts/enterprise-managed-auth/
- 2026-07-28 release (2026-07-28): https://blog.modelcontextprotocol.io/posts/2026-07-28/
- Security considerations, 2026-07-28: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations
- Anthropic advanced tool use (2025-11-24): https://www.anthropic.com/engineering/advanced-tool-use
- Cloudflare Code Mode (2025-09-26): https://blog.cloudflare.com/code-mode/

**Agent identity**
- draft-oauth-ai-agents-on-behalf-of-user-02 (2025-08-26): https://datatracker.ietf.org/doc/html/draft-oauth-ai-agents-on-behalf-of-user-02
- draft-klrc-aiagent-auth announcement (2026-03-02): https://www.mail-archive.com/oauth@ietf.org/msg25714.html
- WIMSE adoption call (2026-08-24): https://freenode.net/article/wimse-moves-to-adopt-ai-agent-auth-framework-draft
- draft-carleton-workload-authz-grant-01 (2026-09-22): https://datatracker.ietf.org/doc/html/draft-carleton-workload-authz-grant-01
- draft-lee-oauth-dpop-credential-presentation-01 (2026-09-28): https://datatracker.ietf.org/doc/html/draft-lee-oauth-dpop-credential-presentation-01
- AAuth (2025-10-25): https://github.laiyagushi.com/dickhardt/AAuth
- Christian Posta, AAuth (2026-02-17): https://blog.christianposta.com/exploring-aauth-agent-auth-identity-and-access-management-for-ai-agents/
- Christian Posta, SPIFFE (2025-06-26): https://blog.christianposta.com/agent-identity-and-access-management-can-spiffe-work/
- HashiCorp, SPIFFE (n.d.): https://www.hashicorp.com/en/blog/spiffe-securing-the-identity-of-agentic-ai-and-non-human-actors
- Ping, token exchange plus SPIFFE (2026-07-21): https://developer.pingidentity.com/blog/securing-agentic-workflows-with-token-exchange-and-workload-identity/
- Okta, Cross App Access (2025-06-23): https://developer.okta.com/blog/2025/06/23/enterprise-ai
- Auth0 for AI Agents GA (2025-11-19): https://auth0.com/blog/auth0-for-ai-agents-generally-available/
- Entra Agent ID on-behalf-of (2026-08-11): https://daily.entra.news/changes/2026-08-11/agent-on-behalf-of-oauth-flow-05/
- Auth0, token exchange (2026-06-03): https://auth0.com/blog/the-many-faces-of-oauth2-token-exchange/
- WorkOS, on-behalf-of for agents (2026-04-28): https://workos.com/blog/oauth-on-behalf-of-ai-agents
- Cloudflare Web Bot Auth (2025-05-15): https://blog.cloudflare.com/web-bot-auth/
- Cloudflare signed agents (2025-08-28): https://blog.cloudflare.com/signed-agents/
- Cloudflare managed OAuth for Access (2026-04-14): https://blog.cloudflare.com/managed-oauth-for-access/
- MCP portal service tokens (2026-06-26): https://developers.cloudflare.com/changelog/post/2026-06-26-mcp-portal-service-tokens/
- Cloudflare MCP security updates (2026-08-14): https://blog.cloudflare.com/mcp-security-updates/
- workers-oauth-provider repo: https://github.com/cloudflare/workers-oauth-provider
- CVE-2025-4143 (2025-05-01): https://github.com/advisories/ghsa-4pc9-x2fx-p7vj
- Neil Madden review (2025-06-06): https://neilmadden.blog/2025/06/06/a-look-at-cloudflares-ai-coded-oauth-library/
- Cloudflare remote MCP (Mar 2025): https://blog.cloudflare.com/remote-model-context-protocol-servers-mcp/

**Attribution**
- Claude Code issue #47579 (2026-04-13): https://github.com/anthropics/claude-code/issues/47579
- The Register, VS Code Copilot co-author (2026-05-04): https://www.theregister.com/software/2026/05/04/microsoft-fixes-vs-code-after-copilot-credited-human-code/5223936
- kody-w (2026-03-26): https://kody-w.github.io/2026/03/26/the-attribution-problem-when-your-ai-ships-code-under-your-name/
- Crash Override, attributing AI commits (2026-05-08): https://crashoverride.com/resources/knowledge-base/code-ownership/attributing-ai-commits-git

**Previews**
- Cloudflare Worker Previews blog (2026-09-22): https://blog.cloudflare.com/worker-previews/
- Worker Previews docs: https://developers.cloudflare.com/workers/previews/
- Worker Previews resources: https://developers.cloudflare.com/workers/previews/resources/
- Worker Previews test and debug: https://developers.cloudflare.com/workers/previews/test-and-debug/
- Workers preview URLs (2025-07-23): https://developers.cloudflare.com/changelog/post/2025-07-23-workers-preview-urls/
- Preview URLs opt-in by default (2025-09-17): https://developers.cloudflare.com/changelog/post/2025-09-17-update-preview-url-setting/
- Workers Builds plus Cursor Origin (2026-09-22): https://developers.cloudflare.com/changelog/post/2026-09-22-cursor-origin-workers-builds/
- InfoQ, Worker Previews (2026-09-29): https://www.infoq.com/news/2026/09/cloudflare-worker-agent/
- Sandbox GA (2026-04-13): https://blog.cloudflare.com/sandbox-ga/
- Sandbox tunnels (2026-05-29): https://developers.cloudflare.com/changelog/post/2026-05-29-sandbox-named-tunnels/
- Sandbox SDK 1.0 (2026-09-30): https://developers.cloudflare.com/changelog/post/2026-09-30-sandbox-sdk-1-0/
- Browser Run docs: https://developers.cloudflare.com/browser-run/
- Playwright MCP on Browser Rendering (2025-05-28): https://developers.cloudflare.com/changelog/post/2025-05-28-playwright-mcp/
- Vercel Protection Bypass for Automation (2026-09-16): https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation
- Vercel MCP tools (2026-09-15): https://vercel.com/docs/mcp/vercel-mcp/tools
- Netlify Deploy Previews: https://docs.netlify.com/deploy/deploy-types/deploy-previews/
- Netlify agent-run screenshot (2026-03-03): https://www.netlify.com/changelog/2026-03-03-agent-runs-deploy-preview-screenshot/
- Netlify side-by-side preview (2026-09-28): https://www.netlify.com/changelog/2026-09-28-agent-runners-side-by-side-preview/
- Cursor Origin (2026-08-17): https://cursor.com/changelog/origin-code-hosting (HN https://news.ycombinator.com/item?id=49334209)
- Ona (2025-09-02): https://ona.com/stories/gitpod-is-now-ona
- Coder agent boundaries (2025-10-08): https://github.com/coder/coder/commit/79736154db612b649579c541677f8d0bf76d9d41
- Okteto (2026-02-23): https://www.okteto.com/blog/the-missing-infrastructure-layer-thats-breaking-agentic-development/
- Signadot 2025 review (2025-12-18): https://www.signadot.com/blog/2025-in-review-metrics-releases-and-enabling-the-agentic-era/
- Northflank, ephemeral tools (2026-03-18): https://northflank.com/blog/tools-for-ephemeral-environments
- Autonoma, platforms compared (2026-07-13): https://getautonoma.com/blog/ephemeral-environment-platforms-compared
- InstaDevOps (2026-07-11): https://instadevops.com/blog/ephemeral-preview-environments-guide/
- Atmosly (2026-07-02): https://atmosly.com/blog/preview-environments-done-right-a-full-environment-per-pr-cloned-safely
- InfraGap, deterministic seeds (2026-07-28): https://infragap.com/database-branching/
- PreviewProof, seeding strategies (2025-11-01): https://previewproof.com/blog/seed-postgres-database-ephemeral-preview-environments/
- Neon branching (2025-12-04): https://neon.com/blog/practical-guide-to-database-branching
- Autonoma, databases for Vercel previews (2026-07-16): https://getautonoma.com/blog/connect-a-database-to-vercel-preview-deployments
- WorkOS, redirect URIs (2026-03-27): https://workos.com/blog/redirect-uris-for-local-staging-and-production
- django-oauth-toolkit #1619 (2025-11-07): https://github.com/django-oauth/django-oauth-toolkit/issues/1619
- HN, Durable Object alarm $34k (2026-04-16): https://news.ycombinator.com/item?id=47787042

**Browsers and verification**
- Chrome DevTools MCP (2025-09-23): https://developer.chrome.com/blog/chrome-devtools-mcp (HN https://news.ycombinator.com/item?id=47390817)
- Playwright MCP vs CLI (2026-07-15): https://dev.to/aswani25/playwright-cli-vs-playwright-mcp-which-should-you-use-with-claude-code-1olh
- HN, Playwright skill (2025-10-20): https://news.ycombinator.com/item?id=45642911
- HN, ProofShot (2026-03-24): https://news.ycombinator.com/item?id=47499672
- agent-browser (2026-01): http://github.com/vercel-labs/agent-browser
- Shipyard visual diffs (2026-02-27): https://shipyard.build/blog/visual-diffs-with-claude-playwright-github-actions/
- Meticulous guide (2026-07-02): https://qaskills.sh/blog/meticulous-ai-visual-testing-guide
- Meticulous changelog (2026-03-02): https://app.meticulous.ai/changelog/2026-03-02
- CloudAxis proof bundles (2026-07-22): https://cloudaxis.ai/blog/proof-of-work-pull-requests-preview-screenshots-tests/
- gh-aw visual regression PR (2026-04-26): https://github.com/github/gh-aw/pull/28550
- RenderPR (2026-06-08): https://p.rst.im/q/Github.com/pelazas/renderpr

**HN sentiment threads**
- GitHub MCP exploited (2025-05-26): https://news.ycombinator.com/item?id=44097390
- Zero-Touch OAuth for MCP (2026-06-18): https://news.ycombinator.com/item?id=48592163
- Mcp2cli (2026-03-09): https://news.ycombinator.com/item?id=47305149
- Claude Skills vs MCP (2025-10-17): https://news.ycombinator.com/item?id=45619537
- Ask HN, MCP in production (2026-09-03): https://news.ycombinator.com/item?id=49548600
- "GitHub is the wrong shape" (2026-07-29): https://news.ycombinator.com/item?id=49103910
- Agent Vault (2026-04-22): https://news.ycombinator.com/item?id=47865822
