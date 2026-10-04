# Coverage and validation record

Research date: **2026-10-03**, targeting GitHub.com. Three delegated research passes covered Code/Git/releases, work/reviews/community, and automation/delivery/security. The coordinating pass covered shell, analytics, people, discovery, shared state/data contracts and the visualization catalog. Reviews and generated evidence live in [research/](research/).

## What coverage means

The inventory maps **component groups with distinct data or behavior**, not every CSS variant, icon, DOM node or undocumented A/B test. Every major repository feature family found in the official-docs crawl is accounted for below, including gated and linked surfaces. A component marked I has a documented capability or reason to exist but an inferred decomposition/arrangement. The map is suitable for planning and design comparison; authenticated interaction and pixel parity remain untested.

Settings pages are deliberately excluded. An action living inside a feature, such as commenting, editing a file, creating a release, selecting a merge method, approving a deployment or triaging an alert, remains included. Configuration effects are represented as availability/permission states.

## Feature coverage matrix

| Family / traversal path | Inventory | Verified understanding | Live validation still needed |
| --- | --- | --- | --- |
| Repository identity, visibility, tabs, overflow, banners | 00 / S | Identity/state/capability separation; conditional tab labels | Authenticated and narrow viewport tab order |
| About, topics, funding, resources, reporting | 00 / S | Metadata/content and discovery links | Optional sidebar ordering/visibility |
| Star, watch, fork, template | 00 / S; 01 / C | Personal state and clone/fork/template distinctions | Count/list permissions and current menus |
| Tree, directories, selected revision, file finder | 01 / C | Ref/path/commit context and directory entries | Deep trees, ref names with slashes, loading |
| File source, raw, download, lines, links, symbols | 01 / C | Immutable permalinks; definitions vs references | Supported-language fixtures/focus behavior |
| Rich file renderers and nontext fallbacks | 01 / C | Prose, images/diffs, PDF, tables, maps, STL, notebooks, Mermaid | Actual renderer failures, size limits and accessibility |
| Blame, file history, commit history, signatures | 01 / C | Attribution/history differences; author/committer/signature | Tooltip wording and merge-parent display |
| Create/edit/upload/move/rename/delete/commit | 01 / C | Target branch/fork proposal; upload/policy errors | Protection/secret failures and editor validations |
| Branches, tags, Git DAG and comparisons | 01 / C; 05 | Snapshot comparison vs reachability; merge base | Branch deletion ambiguity, large comparison UI |
| Fork creation/sync/upstream/network | 01 / C; 04 / I | Repo boundary and actual divergence; network display limits | Cross-fork permissions and conflict flows |
| Releases/notes/assets/drafts/prerelease/latest | 01 / C | Tag vs release vs archive; immutable assets/attestations; conditional action publication | Draft roles, asset platform metadata and agreement gates |
| Special files / license / citation / ownership | 01 / C | Branch-specific consumers and detected metadata | Ambiguous/invalid ownership and license fixtures |
| Markdown, references, comments, reactions, moderation | 02 / W | Composer/slash prompts/timeline and content action semantics | Attachments, hidden/deleted/locked interactions |
| Issue list/filter/new/forms/detail/timeline | 02 / W | Entity states, metadata, forms and views | Role-specific field edits/bulk actions |
| Labels, milestones, issue types/fields | 02 / W | Repo/org/project scopes; milestone form/deletion effects | Role gates, feature rollout and exact field menus |
| Sub-issues, hierarchy and blockers | 02 / W | Hierarchy vs dependencies; completion vs closure reason | Cross-repo permissions and tree overflow |
| PR creation/base/head/draft/list/conversation | 02 / W | Evolving proposal, commit context and personal-fork edit grant | Fork/base-change creation and secret-access consequence |
| PR commits/checks/findings/files changed | 02 / W; 03 / A | Different evidence categories and exact changeset | Current Findings rollout and ordering |
| File diffs/hunks/threads/suggestions/reviews | 02 / W; 01 / C | Old/new coordinate, outdated/resolved, pending/submitted distinctions | Rebase, multi-line suggestion and viewed-state fixtures |
| Merge readiness/conflicts/methods/revert | 02 / W | Policy/review/check inputs; resulting Git effects | Race/push-after-review and resolution tools |
| Auto-merge/merge queue/stacked PRs/archive PR | 02 / W | Separate states and preview restrictions | Queue candidate revisions/stack restacking |
| Discussions/categories/polls/answers/moderation | 02 / W | Format and answered/closed state distinctions | Category permission documentation conflict |
| Projects table/board/roadmap/chart/item/fields | 02 / W | User/org ownership, view-specific state and TSV view export | Private items, export contents and role-specific edits |
| Wiki pages/edit/history/sidebar | 02 / W | Separate wiki revision history | Rename/link/history interactions |
| Repository Agents and contextual Copilot | 02 / W; 00 / S | Agent kind/apps, assignment/invocation, sharing/query/continuation and separate trust approval | Preview, OAuth, third-party/session permissions and batch fix destinations |
| Agents Automations and issue suggestions | 02 / W; 05 | Creator-private definitions, shared sessions, triggers/tools/lifecycle and rationale/proposal acceptance | Role/rollout, event filters and proposal races |
| Agentic Workflows | 03 / A118 | Versioned Markdown + compiled lock file, standard PR/Actions execution; distinct origin/visibility | Preview output controls and authenticated authoring handoff |
| Actions workflow list/filter/dispatch/controls | 03 / A | Definition/run/attempt identities and triggers | Current menus and preview gates |
| Actions progress/DAG/matrix/job/step/logs | 03 / A | Scheduling/wait/execution/conclusion and retry separation | Live updates, reconnect, cancellation races |
| Actions output/checks/artifacts/cache/runners | 03 / A | Provider checks vs Actions; retention, boundaries and agent failed-job delegation | Displayed metadata, custom check controls and approval races |
| Insights Actions usage/performance metrics | 03 / A | Repository metrics, filters, periods and export | Data exclusions/role-specific visualization and large history |
| Deployments/environment approval/Pages | 03 / A | Exact deployed revision, active status and gates without deployment records | Current entry wording, environment-only wait and runtime URL availability |
| Packages and linked production artifacts | 03 / A | Registry versions vs releases/run artifacts; distinct linked storage/runtime records | Registry-specific UI and provenance linkage |
| Security policy/private reports/advisories | 03 / A | Confidential triage/draft/publication/remediation | Participant/admin visibility |
| Dependencies/dependents/SBOM/Dependabot jobs | 03 / A; 04 / I | Dependency paths and incomplete supported coverage | Unsupported ecosystem and metadata fixtures |
| Vulnerabilities/malware/security update PRs | 03 / A | Findings, dismissal/fix, agent/update job distinctions | Current Malware grouping and permissions |
| Code scanning/data flow/tool health/AI Scan | 03 / A | Branch/configuration state and source-specific tool result | New preview UI and third-party metadata |
| Secret scanning/push/merge gates/bypass requests | 03 / A | Validity vs resolution, revocation vs deletion and individual assignment access | Provider support, access revocation and cross-view request status |
| Code Quality/coverage/license findings | 03 / A | Tool quality vs security; actual uploaded line coverage | Entitlement, preview/exception request flows |
| Pulse/traffic/contributors/commits/frequency/community | 04 / I | Units/populations/windows/exclusions/limits/freshness | Table/export/large-repo states |
| People/hovercards/profile handoff | 04 / I | Account vs Git identities and access-limited activity | Anonymous/bot/private/SSO examples |
| Repository search/code queries/typed results | 04 / I | Different search engines/scopes and indexed coverage | Indexed branch/rename and no-match fixtures |
| Notifications/watch/thread/triage | 00 / S; 04 / I | Subscription and inbox states are independent | Retention/list-access transitions |
| Shared UI/accessibility/error/partial/stale states | 00 / S; 05 | Reusable contracts and noncolor state explanations | Keyboard/screen reader/responsive tests |

All rows have a responsible inventory rather than an unassigned feature family. Detailed rows carry their own source/permission/uncertainty information; this matrix is a cross-check, not a second source of product facts.

## Validation performed

<!-- validation-summary-start -->
The final generated check records **464 component groups** across five inventories, **308 source records / 294 unique primary-source URLs**, and **38 cross-domain visualization hypotheses**. All 294 registered URLs were reachable; there were **0 fetch failures and 0 structural issues**. Source timestamps are retained in the crawl artifact.

| Inventory | Groups |
| --- | ---: |
| Repository shell | 54 |
| Code/Git/releases | 91 |
| Work/reviews/community/agents | 149 |
| Automation/delivery/security | 118 |
| Insights/people/search | 52 |

Three independent review passes and a bounded final review produced **19 actionable findings**, all corrected and recorded in the resolution ledger. Four follow-up discovery checks are separately accounted for. The usability protocol and authenticated live fixtures are specified for future work; they were not run.
<!-- validation-summary-end -->

The reproducible checker validates component ID uniqueness, component-row structure, local document links, reference resolution, source-registry schema and primary-source hosts. With `--fetch`, it retrieves registered source URLs, follows redirects, records HTTP status, title/headings, response digest and official-docs links, and exposes one-hop discovery candidates. It reuses already successful checks while retaining their original timestamps.

```sh
python3 docs/github-repository-map/research/validate_map.py --fetch
```

[Structural results](research/structural-validation.json), [component index](research/component-index.json), [source crawl](research/source-crawl.json). These validate documentation structure and reachability, not the truth of every sentence. Feature claims were checked by reading primary articles and then independently reviewing material semantics. Sources are paraphrased; no full article copies are stored.

Independent critique: [Code](research/audit-code.json), [automation](research/audit-automation.json), [collaboration](research/audit-collaboration.json), with a finding-by-finding [resolution ledger](research/audit-resolutions.json). The original critique remains intact; the ledger records the corrections and their evidence.

The [follow-up discovery record](research/audit-followup-discovery.json) accounts for four additional usage-family checks: Automations, issue suggestions, app invocation and Agentic Workflows. These were added or connected to existing controls rather than treated as configuration-only links.

The [bounded final review](research/audit-final-review.json) added PR creation from session logs and the “changes pushed, no PR yet” state. It reported no other material issues in the completed additions; this is semantic review, not live browser verification.

The public `github/docs` root and `cli/cli` release feed were inspected as fetched HTML/text. That supports O entries only. No authenticated GitHub browser session, screenshot inspection, application test, user study, implemented UI or measured visualization advantage is claimed.

## Gap-discovery iterations

1. **Initial taxonomy**: code/history/distribution; work/review/community; automation/delivery/security; analytics/people/discovery/shell. Official section indexes led to feature articles rather than stopping at the visible root tabs.
2. **Current-feature additions**: stacked PRs, issue fields/dependencies, PR archiving, repository Agents, PR Findings, Dependabot Malware, AI Scan, Code Quality, line coverage, license-compliance requests and production artifact context.
3. **State correction**: distinguish Git diff/reachability; rereview coordinates; status/check/run; retry attempt; build/deployment; validity/dismissal/fix; denied/disabled/empty; top-N/partial analytics.
4. **Discovery-link audit**: inspect relevant feature links for contextual controls and omitted usage views. The machine's one-hop candidate set includes global navigation, API details and Settings/configuration; not every discovered link is in scope or claimed read.
5. **Independent reviews**: code reviewer checks shared Git/metric contracts; automation reviewer checks evidence/delivery contracts; collaboration reviewer checks the combined inventory and cross-feature flows. Findings and resolution records belong in the research artifacts.

## Conflicts, drift and retired surfaces

| Finding | Treatment in this map | Source evidence |
| --- | --- | --- |
| Branch deletion articles describe different behavior around open PRs | Preserve warning/entry-point distinction; require live fixture before copying behavior | 01 / CS18 and CS20 |
| Generic review guidance excludes Copilot approvals; specialized newer guidance has configured approval preview | Default assisted review and conditional configured approvals kept distinct | 02 source discussion |
| Discussion category permission guidance differs between articles | Preserve least-assumed capability and mark exact role behavior for live check | 02 source discussion |
| Secret push-bypass status labels differ across repo/org views | Preserve source/view-specific states; do not reuse one enum blindly | 03 / AS66–AS68 |
| Stars/watch API docs announce July 2026 listing restrictions alongside older public-access text | Count and person-list capabilities remain separate; no universal public listing guarantee | [starring](https://docs.github.com/en/rest/activity/starring), [watching](https://docs.github.com/en/rest/activity/watching) |
| Notification retention differs in cached snippets vs fetched article text | Use semantic states; avoid a timeless retention constant | [inbox](https://docs.github.com/en/subscriptions-and-notifications/how-tos/viewing-and-triaging-notifications/managing-notifications-from-your-inbox) |
| Tab wording and deployment entry changed | Current label plus older aliases; arrangement not guaranteed | 00/03 sources and public markup |
| Rich tasklist blocks retired | Ordinary Markdown checkboxes and sub-issues retained; retired block not proposed as current parity | 02 sources |
| GitHub Models English docs state full retirement July 30, 2026; older localized pages describe active prompt/model features | Retired Models playground/catalog/inference/BYOK excluded from current UI; Copilot remains separate | [current retirement notice](https://docs.github.com/en/github-models) |
| Issue-rationale availability box describes private/internal Copilot Automations, while the body also describes APIs/Agentic Workflows and a public-repository example | Preserve the documented Automation gate; use an explicit suggestion capability for other producers instead of promising universal repository availability | 02 / COL95–COL96 |

Retired and preview status should be rechecked before implementation, just as plan/permission rules should. Current documentation may mix old screenshots and newer descriptions; exact placement therefore requires separate observation.

## Explicit exclusions and boundaries

| Surface | Scope decision |
| --- | --- |
| Settings tab; access/teams/roles; rulesets/branch protection configuration; webhooks/apps/keys/secrets; notification delivery settings; budgets/billing; runner/environment/Pages setup | Excluded as configuration. Runtime effects and feature actions are mapped. |
| Repository rename/transfer/delete/archive administration | Excluded Settings flows; redirects, fork/archive/read-only outcomes relevant to browsing remain represented. |
| Read-only custom properties reached from About | Boundary entry documented; destination is Settings, so forms/full administration excluded. |
| Full organization/enterprise security/Actions dashboards | Linked repository drilldown and scope distinction only; not misrepresented as repository Insights. |
| Complete global profiles/stars lists/topic catalog/notification product | Repository relationships, actions and relevant drilldowns included; whole products not inventoried. |
| Full VS Code/Codespaces IDE and local Git command UI | Entry, repository revision/source control and lifecycle included; complete editor ecosystem excluded. |
| Copilot CLI/app/Spaces/custom agent administration | Repository-context usage and session handoffs included; separate products and configuration excluded. |
| Global Marketplace, Sponsors checkout and Spark app builder | Repository-facing links/usage context only. |
| GitHub Models / tasklist blocks / Projects classic | Legacy/retired surfaces excluded from current parity; current Projects is inventoried. |
| GHES-version-specific or GHE.com-specific interfaces | Not full separate products; portability/availability caveats where primary docs require them. |

## Remaining live verification fixtures

The next implementation audit needs authorized seeded repositories spanning public/private/internal; read/triage/write/maintain/admin/security roles; enabled/disabled feature tabs; free/paid/licensed preview gates; empty/large/archived repositories; forks and unavailable upstreams.

Run the flows in [05's fixture matrix](05-data-and-state-model.md#minimum-fixture-matrix), checking visible/disabled actions and explanations, current URLs, loading/pagination, keyboard/focus, small-screen behavior, status announcements and source link fidelity. Keep mutations confined to disposable fixture repositories. Record role, repository snapshot, date, viewport and actual observation before converting I entries to O/V.

The usability experiments in [06](06-visualization-opportunities.md#validation-protocol) are separate from parity verification. They determine whether an alternative helps users; reaching a source URL or drawing a graph cannot establish that result.
