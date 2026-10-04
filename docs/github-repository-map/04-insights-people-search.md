# Insights, people, discovery and notifications

These views summarize different populations. A contributor graph, stars total, watcher list and profile contribution calendar must not be treated as interchangeable measures of repository users or productivity. Research date: 2026-10-03; [evidence legend](README.md#evidence-legend).

## Analytics and activity components

| ID | Surface/component | Data shown | Actions/drilldown | States/gates | Evidence |
| --- | --- | --- | --- | --- | --- |
| I001 | Insights navigation | Graph/view names | Pulse, contributors, community, traffic, commits, frequency, dependencies, network/forks; Actions usage/performance | Plan, visibility, enabled feature | D [N01]; dependencies and Actions metrics in 03 |
| I002 | Pulse period selector | Selected reporting window | Change window | Default last seven days | D [N02] |
| I003 | Pulse work summary | Open/merged PRs, open/closed issues | Open underlying work item | Activity window, not all-time backlog | D/I [N02] |
| I004 | Pulse commit contribution graph | Top contributors' default-branch commits in window | Inspect contributor/details | Top 15; eligible coauthors included | D [N02] |
| I005 | Contributors ranked panels | Contributor identity and commit activity | Profile; selected period | Top 100, default branch; merge/empty commits excluded | D [N03] |
| I006 | Contributor period control | Current time selection | Change period | Documented Period: All default | D [N03] |
| I007 | Contributor chart table/export | Numeric series; CSV/PNG option | Switch table/download | Graph control available | D [N03] |
| I008 | Contributor exclusion/staleness explanation | Missing account, branch scope, refresh delay | Explain absence | Email mapping/history rewrites | D [N03] |
| I009 | Traffic visitors chart | Views/unique visitors by day | Hover exact day | Previous 14 days; push access | D [N04] |
| I010 | Traffic clones chart | Full clones/unique cloners | Hover exact day | Excludes fetches | D [N04] |
| I011 | Referring sites table | Referrer, views/uniques | Follow referring path | Excludes GitHub/search engines | D [N04] |
| I012 | Popular content table | Paths, views/uniques | Open repository content | Daily refresh; access scope | D [N04] |
| I013 | Traffic date/freshness context | UTC buckets, refresh time | Inspect date labels | Visitor/clone hourly; referrals/content daily | D [N04] |
| I014 | Yearly commit chart | Weekly nonmerge commits | Select week | Certain graphs require fewer than 10,000 commits | D [N05] |
| I015 | Selected-week commit chart | Average commits by weekday | Inspect weekdays | Selected-week context | D [N05] |
| I016 | Code frequency chart | Weekly additions/deletions | Inspect range | Signed measure; not net size/effort | D [N05] |
| I017 | Code frequency table/export | Numeric values, CSV/PNG | Switch/export | Documented graph controls | D [N05] |
| I018 | Punch-card/participation data boundary | Hour/weekday or owner/all weekly aggregates | Optional Beanstalk analytics | API evidence; current UI placement unverified | D/I [N06] |
| I019 | Graph loading/limit state | Computation pending or unsupported | Retry/explain | API 202/204/422; never show fabricated zero | D/I [N06] |
| I020 | Network graph | Fork-branch commit topology over time | Pan/keyboard/open commit | At most 100 recent pushed branches | D [N07] |
| I021 | Forks list | Fork identity/activity/popularity/open work | Open fork | Repository access/visibility | D [N07] |
| I022 | Fork filters/sort | Period, active/inactive/starred/archived | Filter/sort/save defaults | Documented presets; selection shared across fork pages | D [N07] |
| I023 | Activity event stream | Pushes, PR merges, force pushes, branch creation/deletion | Open actor/commit | Authenticated actor differs from author | D [N08] |
| I024 | Activity filter toolbar | Branch/user/type/time | Search/select filters | All-branches option | D [N08] |
| I025 | Activity compare action | Exact event range | Compare changes | Force push needs prior/new tip context | D/I [N08] |
| I026 | Community standards checklist | Recommended health files present/missing | Open file/add/propose | Public repositories | D [N09] |
| I027 | Community profile metrics | File detection and health percentage | Inspect missing recommendation | API excludes forks; not security/product quality | D [N10] |
| I028 | Dependents/used-by link | Repositories/packages depending on project | Explore dependency relationships | Ecosystem support/incomplete discovery | I; dependency inventory in 03 |
| I029 | Stars trend data boundary | Weekly star-created counts | Optional trend/drilldown | API calendar boundaries not guaranteed UTC | D/I [N11]; no claimed native repo chart |

## Reading the metrics correctly

Traffic's retention and permissions differ from public popularity counters. A 14-day window cannot support a year-over-year chart without previously retained snapshots. Label any longer-history Beanstalk view as locally collected. A release annotation can align dates; it does not establish causality. [Traffic API][N12].

Cached statistics can return a pending response while background computation runs. Some endpoints fail at 10,000 commits, and contributor additions/deletions may be zeroed at that size; endpoint-specific behavior matters. Charts need **pending**, **unsupported**, **partial** and **true zero** states. [Statistics API][N06].

Language proportions describe bytes of eligible code after Linguist classification/exclusions, not file counts or engineering time. They derive from default-branch analysis and may lag a push. Preserve those definitions when turning the strip into a file-map overlay. [Official Linguist implementation notes][N13].

The UI docs describe broad access to stargazer lists, while newer API docs announce admin/collaborator restrictions and retain contradictory public-endpoint notes. Watching listings carry a similar transition. Counts and identities therefore require separate capability checks; aggregate star history does not justify reconstructing person-level activity. [Stars usage][N14], [starring API][N11], [watching API][N15].

## People and repository search

| ID | Surface/component | Data shown | Actions/drilldown | States/gates | Evidence |
| --- | --- | --- | --- | --- | --- |
| I030 | Contributor avatar summary | Selected contributor accounts/count | Contributor graph/profile | Display subset vs total | I; detailed graph [N03] |
| I031 | Author/committer identity | Git names/emails, mapped account | Commit/account link | Unmapped author and bot supported | I; Git model in 01/05 |
| I032 | User hovercard | Name, status, local time/context | Profile; focus/close | Visibility/availability fields | D/I [N16] |
| I033 | Role/association badge | Author/member/collaborator/bot context | Explain relation | Relation to this repository, not global trust | I |
| I034 | People listings | Stargazers/watchers/contributors | Open person; page list | Different listing access/data populations | D/I [N03], [N11], [N15] |
| I035 | Linked profile | Identity, pinned repositories, contribution calendar/activity | Date/range/event drilldown | Private details anonymized/access scoped | D [N17]; full profile outside scope |
| I036 | Repository search scope | Repository qualifier/query | Submit/narrow/expand scope | Accessible content only | D [N18] |
| I037 | Search suggestions | Recent searches/resources/files | Quick jump | Context and access dependent | D [N18] |
| I038 | Search result type/navigation | Code, commits, issues/PRs, discussions, wikis, packages etc | Switch type/open result | Queries differ by engine | D/I [N18] |
| I039 | Code query/filter controls | Repo/path/language/symbol/content qualifiers | Compose/refine query | Login/default branch; definitions-only symbol search | D [N19], [N25] |
| I040 | Code match preview | File path and matching code context | Open file/line; expand identical files | Nonexhaustive index; 100-result cap; no sorting | D/I [N25] |
| I041 | Non-code search/sort | Entity-specific filters and results | Filter/sort/open entity | Different syntax from code search | D/I [N18] |
| I042 | No-results/access/index state | Query and available scope | Edit/reset/sign in | No matches differs from unindexed/unavailable | I |
| I043 | Topic discovery handoff | Topic name and related repositories | Open topic repository list | Topic names public | D [N20] |

Code search's `symbol:` addresses definitions rather than every reference. A file finder, text search, symbol navigation, commit search and issue filter are distinct modes. Beanstalk can use one entry point with explicit mode/scope labels; it must not present one parser as compatible with all GitHub query types. [Code-search syntax][N19].

Native code search requires login even for public repositories and searches the **default branch**, regardless of the file browser's selected branch/tag/SHA. It is nonexhaustive: generated/vendored/binary/non-UTF-8 and some large content are excluded; very large repositories may be unindexed. Results stop at 100 without sorting. Revision-aware or exhaustive Beanstalk search would require additional indexing infrastructure, with its coverage disclosed. [Code-search limitations][N25].

Profiles' activity calendars apply their own contribution eligibility and privacy rules. They cannot substitute for the repository contributor graph or an ownership directory. Busy status is relevant in reviewer/assignee suggestions; it does not establish actual team capacity. [Profile reference][N16], [profile contributions][N17].

## Repository-linked notifications

| ID | Surface/component | Data shown | Actions/drilldown | States/gates | Evidence |
| --- | --- | --- | --- | --- | --- |
| I044 | Inbox repository group/filter | Repository and thread notifications | Open repository group | Per viewer; access can disappear | D/I [N21] |
| I045 | Notification row | Subject, update, reason, read/saved state | Open thread | Unread/read/done/retained | D/I [N21] |
| I046 | Notification triage controls | Selection and triage action | Read/unread/done/unsubscribe/save | Save is per-item in detailed flow | D [N21], [N22] |
| I047 | Reason filters | Assignment, participation, review request, mention, CI, security | Filter attention queue | Documented reason vocabulary | D [N23] |
| I048 | Inbox query limits | Repo/type/reason/author/org | Create/refine custom filter | No full-text title search or NOT; 15 custom filters | D [N23] |
| I049 | Thread notification toolbar | Current originating notification | Done/save/read/unsubscribe/back | Entered from notification | D [N22] |
| I050 | Thread custom subscription | Selected issue/PR event types | Customize/save | Participation/mentions can resubscribe | D [N22] |
| I051 | Subscription vs triage distinction | Watch/thread mode and inbox state | Unwatch/unsubscribe or mark done | Done does not unsubscribe | D/I [N21], [N24] |
| I052 | Missing notification destination | Removed/inaccessible thread | Return to inbox | Access/deletion/archiving; exact UI unverified | I |

Notification retention text changes between cached search snippets and fetched canonical articles. This map uses read/save/done distinctions without treating a month count as a durable product rule. A clone should choose and disclose its own retention behavior. [Inbox article][N21], [single-notification article][N22].

## Visualization ideas and validation

1. **Linked analytics small multiples**: align Pulse, commits, traffic and releases, each with its own units/availability/window. Brushing selects records. Useful for release investigation; refuse comparisons when scopes are incompatible.
2. **People by responsibility**: directory grouped by reviewed/owned/contributed paths with evidence links. Use CODEOWNERS as explicit ownership and recent activity as a different relationship. Keep contributor history visible; do not rank people by commits or inferred productivity.
3. **Fork discovery table plus divergence lanes**: show recent update, ahead/behind and upstream relationship. Compute divergence from actual Git refs; metadata alone cannot prove code divergence. Keep sorting/filtering for finding one fork.
4. **Repository attention queue**: group notifications by work item, action needed and why received. Keep source reason, unread/done/subscription separate. Hidden/private work must not enter public counts.
5. **Code distribution file map**: language/churn/ownership selectable overlays on the directory tree. Preserve byte-based language definition, exact file paths, and a sortable table.

Validate analytics with an empty repository, a repository above graph limits, recent history rewrite, nondefault-only contributor, anonymous Git author, bot contributor, private access denial and a 14-day traffic boundary. Validate search with renamed files, default-vs-feature branch differences, symbol references, inaccessible repositories and invalid queries. Validate notifications with a done-but-subscribed thread, new mention after unsubscribe and a destination that became inaccessible.

[N01]: https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/about-repository-graphs
[N02]: https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/using-pulse-to-view-a-summary-of-repository-activity
[N03]: https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/viewing-a-projects-contributors
[N04]: https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/viewing-traffic-to-a-repository
[N05]: https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/analyzing-changes-to-a-repositorys-content
[N06]: https://docs.github.com/en/rest/metrics/statistics
[N07]: https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/understanding-connections-between-repositories
[N08]: https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/using-the-activity-view-to-see-changes-to-a-repository
[N09]: https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/about-community-profiles-for-public-repositories
[N10]: https://docs.github.com/en/rest/metrics/community
[N11]: https://docs.github.com/en/rest/activity/starring
[N12]: https://docs.github.com/en/rest/metrics/traffic
[N13]: https://raw.githubusercontent.com/github-linguist/linguist/main/docs/how-linguist-works.md
[N14]: https://docs.github.com/en/get-started/exploring-projects-on-github/saving-repositories-with-stars
[N15]: https://docs.github.com/en/rest/activity/watching
[N16]: https://docs.github.com/en/account-and-profile/reference/profile-reference
[N17]: https://docs.github.com/en/account-and-profile/concepts/contributions-on-your-profile
[N18]: https://docs.github.com/en/search-github/getting-started-with-searching-on-github/about-searching-on-github
[N19]: https://docs.github.com/en/search-github/github-code-search/understanding-github-code-search-syntax
[N20]: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics
[N21]: https://docs.github.com/en/subscriptions-and-notifications/how-tos/viewing-and-triaging-notifications/managing-notifications-from-your-inbox
[N22]: https://docs.github.com/en/subscriptions-and-notifications/how-tos/viewing-and-triaging-notifications/triaging-a-single-notification
[N23]: https://docs.github.com/en/subscriptions-and-notifications/reference/inbox-filters
[N24]: https://docs.github.com/en/subscriptions-and-notifications/get-started/configuring-notifications
[N25]: https://docs.github.com/en/search-github/github-code-search/about-github-code-search
