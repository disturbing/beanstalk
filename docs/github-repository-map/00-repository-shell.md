# Repository shell and shared components

The shell maintains repository identity while the user moves between different object types. Its primary job is orientation: whose repository, which feature, what reference, what permission, and which data scope. Sources were read on 2026-10-03. D/O/I use the [shared evidence legend](README.md#evidence-legend).

## Identity, navigation and About

| ID | Surface/component | Data shown | Actions/drilldown | States/gates | Evidence |
| --- | --- | --- | --- | --- | --- |
| S001 | Repository identity | Owner / name | Owner page; repository root | Owner may be user or organization | O [M01] |
| S002 | Visibility/state badges | Public/private/internal; archive/template/fork status when applicable | Contextual explanation | Internal and other capabilities vary by product | D/I [M02] |
| S003 | Fork ancestry | Parent repository relation | Open upstream | Fork only; access may change | I [M02]; detailed fork map in 01 |
| S004 | Repository feature tabs | Code, Issues, PRs, Discussions, Actions, Projects, Wiki, Security and quality, Insights; conditional Agents | Navigate feature | Enabled features, access, viewport | O [M01]; D [M03], [M24] |
| S005 | Tab counts/status | Open work counts; feature-specific indicator | Open corresponding filtered list | Meaning varies by feature | O [M01]; I for count contract |
| S006 | Overflow navigation | Additional tabs/actions | Reveal hidden destinations | Narrow viewport | O [M01]; I for breakpoint behavior |
| S007 | Repository state banner | Archived/read-only or policy restriction explanation | Read available context | Archive/state dependent | D/I [M26] |
| S008 | Empty repository onboarding | No commits; initialize/clone/push instructions | First file or local push | Empty repository; role sensitive | I; first-write behavior in 01 |
| S009 | About description/link | Purpose and website | Follow website | Metadata optional | O [M01] |
| S010 | Topic chips | Classification names | Topic discovery/search | Topics public; repository results access scoped | D [M04] |
| S011 | About metadata editor | Description/website/topics | Save content metadata in context | Admin; exact fields need live check | D/I [M04] |
| S012 | Resource links | README/license/contributing/conduct/security | Open file or feature policy | Presence/detection dependent | O [M01]; content details in 01/03 |
| S013 | Sidebar feature summaries | Releases/packages/deployments/contributors | Corresponding feature view | Data/features available | I; detail inventories 01/03/04 |
| S014 | Language strip and legend | Language percentages | Language-filtered code exploration | Cached default-branch analysis | D/I [M05] |
| S015 | Sponsor button | Funding destination(s) | Open sponsor/funding destination | Funding file and owner eligibility | D [M06] |
| S016 | Report repository link | Repository identity in report context | Report form | Abuse flow | D [M07] |
| S017 | Activity link | Repository change history entry | Activity filters/compare | Data/access available | D [M08] |
| S018 | Custom properties boundary link | Organization-defined repository metadata | Read linked properties | Destination classified as Settings; editing excluded | O [M09] |

## Personal repository actions and development entry

| ID | Surface/component | Data shown | Actions/drilldown | States/gates | Evidence |
| --- | --- | --- | --- | --- | --- |
| S019 | Star toggle/count | Bookmarked state, total interest count | Star/unstar; stargazers link | Sign-in; private access | D [M10] |
| S020 | Star lists dropdown | Personal lists and repository membership | Add/remove; create list | Public preview; lists on personal stars page | D [M10] |
| S021 | Watch dropdown | Subscription mode | Participating/mentions; all; custom; ignore | Sign-in, enabled event types | D [M11] |
| S022 | Custom watch choices | Issues/PRs/releases/security/discussions | Choose events and save | Discussions conditional | D [M11] |
| S023 | Watchers count/link | Subscribers, not stars | Watchers list | Listing access differs from count | D [M12]; O label [M01] |
| S024 | Fork button/count | Fork relation/count | Create or open fork | Ownership/policy/access | I; behavior inventoried in 01 |
| S025 | Use template entry | Template repository identity | Create repository or open in codespace | Template flag; distinct from fork | D [M25] |
| S026 | Code acquisition menu | HTTPS/SSH/CLI clone choices | Clone/history or selected-ref source archive | Clone checkout and archive ref differ | D [M27]; detail in 01 |
| S027 | Open in github.dev | Repository/file/PR context | Browser editor | Sign-in; no VM/terminal compute | D [M14] |
| S028 | Codespaces tab | Repository/branch, existing environment choices | Resume/create environment | Nonempty branch; policy/quota | D/I [M15], [M16] |
| S029 | Codespace creation choices | Branch, devcontainer, region, machine | Create with default/advanced choices | Allowed machine types; payer visible | D [M15] |
| S030 | Codespace progress | Allocation/container/connection/setup stage | Connect/retry | Creation can fail; quota/policy | D/I [M15] |
| S031 | Codespace lifecycle status | Running/stopped; retained work | Stop/restart/delete/export | Closing browser does not stop compute | D/I [M16] |
| S032 | Contextual Copilot entry | Repository/file/selected-line context | Ask question, follow up, stop response | Copilot access; context selectable | D [M17] |
| S033 | Copilot chat/session result | Generated response and repository/session context | Follow source links; continue chat | Streaming/error; plan/model availability | D/I [M18]; agent PRs in 02 |

A source ZIP/tar download exposes a selected-ref snapshot without Git history. A normal Git clone brings repository history/refs and normally checks out the default branch; a selected browser ref does not itself change clone arguments. Neither exports issues, review discussions or Actions records. Codespace saved files become remote commits only after commit/push. [Cloning][M27], [archive details in 01](01-code-git-releases.md), [Codespaces lifecycle][M16].

## Shared interaction primitives

The following rows are **Beanstalk presentation contracts inferred from the inventory**, not claims that GitHub documents every detail of its component implementation.

| ID | Surface/component | Data shown | Actions/drilldown | States/gates | Evidence |
| --- | --- | --- | --- | --- | --- |
| S034 | Contextual search/quick jump | Repository scope, query, suggestions | Open result or full search | No matches; private access | D/I [M19] |
| S035 | Command palette | Scope, commands/resources | Keyboard navigate/execute | Preview; disabled by default | D [M13] |
| S036 | Shortcut help | Commands for current surface | Invoke/focus help | Character shortcuts can be disabled | D [M03] |
| S037 | Entity hovercard | Person/issue/PR metadata | Focus or open entity | Permission; missing/deleted entity | D/I [M03], [M20] |
| S038 | Filter selector/token | Current filter, candidate values | Search/select/clear | Multi/single-select; async results | I; filters in domain maps |
| S039 | Sort/layout switch | Ordering and presentation | Sort list; change view | Saved view scope varies | I; Projects/Insights detail maps |
| S040 | Dense object row/card | Icon/state, title, identity, metadata | Open/select/context action | Unread/selected/disabled/partial | I; object-specific inventories |
| S041 | Status/check/review badge | Named state and explanation | Open details | Pending/unknown must stay distinct | I; state model in 05 |
| S042 | Avatar/group/identity badge | User, team, bot, role | Profile/team or filter | Missing identity; access-limited teams | I; identity map in 04 |
| S043 | Timeline event | Actor, action, time, object links | Anchor or inspect event | Edited/outdated/deleted context | I; events in 02/04 |
| S044 | Markdown composer | Text, preview, attachments, references and slash prompts | Draft/preview/post; insert supported content | Validation/upload/error/locked; command preview gate | I; granular composer W002/W130 in 02 |
| S045 | Context/overflow menu | Object-specific actions | Copy/edit/report/etc | Actions capability gated | I; menus in domain maps |
| S046 | Dialog/popover | Selection, consequence, validation | Confirm/cancel/save | Busy/conflict/error; focus return | I |
| S047 | Copy/permalink affordance | Stable or moving object URL | Copy; success feedback | Clipboard failure; ref distinction | D/I [M13]; file details in 01 |
| S048 | Pagination/incremental loading | Loaded count/range | Next/previous/load more | Exhausted/truncated/loading/error | I; page boundaries must be visible |
| S049 | Empty/error/permission panel | Explanation and available next action | Retry, reset filter, sign in/request access | Never encode unavailable as zero | I |
| S050 | Live update/toast/banner | Operation outcome or changed data | Retry/dismiss/refresh | Success/failure/stale/offline | I |
| S051 | Timestamp/tooltip | Relative time with precise instant | Inspect absolute time | Timezone/clock skew | I |
| S052 | Chart/table/export controls | Measure and current scope | View table/export CSV or PNG | Graph-specific availability | D/I [M21], [M22] |
| S053 | Repository Agents entry | Active/past sessions; agent-kind/app choices | Start/monitor; permitted steering; open session/PR | Enablement, paid access, policy, preview and first-use authorization | D [M24]; detailed W122–W141 inventory in 02 |
| S054 | Create from template form | Owner/name/description/visibility; branch inclusion | Generate new repository | Read access; histories distinct from original fork network | D [M25] |

## Shell relationships and adaptation

Repository identity follows every view; selected branch follows tree/file/history but should not silently change issue/project scope. Search scope is separate from file reference. Star membership, watch mode and notification read state are per viewer. An avatar can represent an account while a commit author is an email/name identity; merge those only with evidence.

On narrow layouts, preserve current location, primary action and selected filter before secondary metadata. Move optional panes to deliberate drawers with accessible labels and focus restoration. Keep browser Back, deep links and keyboard interaction predictable. These are Beanstalk design proposals (I); exact GitHub breakpoints, tab order and focus behavior require live verification.

Visualization opportunity: a compact context bar showing repository, feature, current ref/compare range and any data restrictions can reduce disorientation. A large repository graph is excessive for ordinary navigation. Keep recognizable tab/list entry points; introduce relationship views when a question crosses features. See [06](06-visualization-opportunities.md).

## Validation notes

- Public HTML confirms repository labels and links; authenticated menu contents and responsiveness remain I unless a feature article explicitly describes them.
- Watch and star APIs contain July 2026 listing-access restrictions alongside older public-access paragraphs. Preserve count/list separation and require live permission validation before relying on people lists. [Starring][M23], [watching][M12].
- Configuration screens linked from About/feature empty states remain outside scope. Their effects on availability are included.

[M01]: https://github.com/github/docs
[M02]: https://docs.github.com/en/rest/repos/repos
[M03]: https://docs.github.com/en/get-started/accessibility/keyboard-shortcuts
[M04]: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics
[M05]: https://raw.githubusercontent.com/github-linguist/linguist/main/docs/how-linguist-works.md
[M06]: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/displaying-a-sponsor-button-in-your-repository
[M07]: https://docs.github.com/en/communities/maintaining-your-safety-on-github/reporting-abuse-or-spam
[M08]: https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/using-the-activity-view-to-see-changes-to-a-repository
[M09]: https://github.com/github/docs/custom-properties
[M10]: https://docs.github.com/en/get-started/exploring-projects-on-github/saving-repositories-with-stars
[M11]: https://docs.github.com/en/subscriptions-and-notifications/get-started/configuring-notifications
[M12]: https://docs.github.com/en/rest/activity/watching
[M13]: https://docs.github.com/en/get-started/accessibility/github-command-palette
[M14]: https://docs.github.com/en/codespaces/the-githubdev-web-based-editor
[M15]: https://docs.github.com/en/codespaces/developing-in-a-codespace/creating-a-codespace-for-a-repository
[M16]: https://docs.github.com/en/codespaces/about-codespaces/understanding-the-codespace-lifecycle
[M17]: https://docs.github.com/en/get-started/exploring-projects-on-github/using-github-copilot-to-explore-projects
[M18]: https://docs.github.com/en/copilot/how-tos/copilot-on-github/chat-with-copilot/chat-in-github
[M19]: https://docs.github.com/en/search-github/getting-started-with-searching-on-github/about-searching-on-github
[M20]: https://docs.github.com/en/account-and-profile/reference/profile-reference
[M21]: https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/viewing-a-projects-contributors
[M22]: https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/analyzing-changes-to-a-repositorys-content
[M23]: https://docs.github.com/en/rest/activity/starring
[M24]: https://docs.github.com/en/copilot/concepts/agents/cloud-agent/agent-management
[M25]: https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-repository-from-a-template
[M26]: https://docs.github.com/en/repositories/archiving-a-github-repository/archiving-repositories
[M27]: https://docs.github.com/en/repositories/creating-and-managing-repositories/cloning-a-repository
