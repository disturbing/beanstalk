# Research and reproducibility

Research targets the GitHub.com repository interface as documented on **2026-10-03**, with Settings excluded. Three subagents researched separate feature domains and then reviewed the combined map. The coordinating pass covered shell, Insights, people/search, data contracts and visualization ideas. This folder stores evidence and review records; it contains no GitHub credentials or full scraped articles.

## Source registries

Each record includes a stable source ID, primary-source URL, title, feature, read method and research date. A source marked verified means it was read for its relevant behavior. It does not mean authenticated UI interaction or screenshot verification occurred.

| Registry | Coverage |
| --- | --- |
| [code-sources.json](code-sources.json) | Code, files, Git, forks, releases and conditional action publication |
| [collaboration-sources.json](collaboration-sources.json) | Issues, PRs, reviews, Discussions, Projects, Wiki and repository agents |
| [automation-sources.json](automation-sources.json) | Actions, deployment, packages, dependencies, security and quality |
| [shell-insights-sources.json](shell-insights-sources.json) | Navigation, subscriptions, development entry, analytics, people/search and shared API constraints |

Multiple registries can cite the same article under domain-specific IDs. Unique URL counts therefore differ from source-record counts. Sources are GitHub Docs, observed public GitHub markup, the official Linguist repository and Git's own manuals.

## Crawl and structural checks

Run from the Beanstalk root:

```sh
python3 docs/github-repository-map/research/validate_map.py
python3 docs/github-repository-map/research/validate_map.py --fetch
```

[validate_map.py](validate_map.py) checks unique component/source IDs, six-column component rows, local file links, reference resolution, citation/registry agreement, primary-source hosts and balanced code fences. It generates [component-index.json](component-index.json) and [structural-validation.json](structural-validation.json). The index contains each component's document/line and table cells for a later backlog import.

With `--fetch`, the checker retrieves registered sources, follows redirects and records status, content type, title/headings, digest and official-docs links in [source-crawl.json](source-crawl.json). Successful prior checks are reused with their original timestamps; new or failed URLs are fetched. No continuous recrawl is scheduled. A nonzero exit indicates structural issues or failed source retrieval.

The one-hop discovery candidates include shared navigation, configuration and unrelated product pages. That list is a review aid, not a claim that every linked page was read or is relevant. Human feature traversal and independent review determine scope; a successful HTTP response establishes reachability only.

Some initial guessed article paths failed. The research followed current official section links instead: Pulse uses `using-pulse-to-view-a-summary-of-repository-activity`, Traffic uses `viewing-traffic-to-a-repository`, Codespaces uses `developing-in-a-codespace`, and contribution semantics uses the current account/profile concepts path. Official raw Linguist content was used when the browser-rendered repository page was unavailable. Failed guesses are not presented as verified sources.

## Independent review

| Artifact | Purpose |
| --- | --- |
| [audit-code.json](audit-code.json) | Git/search/review-evidence and runtime-data critique |
| [audit-automation.json](audit-automation.json) | Conditional publication, alert access/state and delivery/provenance critique |
| [audit-collaboration.json](audit-collaboration.json) | Cross-feature usage and collaboration critique |
| [audit-resolutions.json](audit-resolutions.json) | Finding-by-finding corrections and evidence |
| [audit-followup-discovery.json](audit-followup-discovery.json) | Final one-hop feature discovery and the inventory that accounts for each surface |
| [audit-final-review.json](audit-final-review.json) | Bounded final consistency check and session-log PR-creation correction |

Original findings remain intact so the resolution record can be compared with the critique. [Coverage and validation](../07-coverage-and-validation.md) states the completed checks and remaining live fixtures. The artifacts do not establish pixel parity, authenticated behavior, a tested Beanstalk app or measured usability improvements.
