# Research method and evidence limits

Research conducted on **3 October 2026** using ordinary web search/browsing and the **Exa Search API**, as requested. Local credentials were read only to authenticate requests to Exa. Keys are not included in these documents, saved search metadata, or command output. Queries contained public research topics, not private source code.

## What was searched

Nine Exa queries covered PR review overload, parallel-agent worktrees and semantic conflicts, merge-queue cost/flakiness, Cursor Origin, maintainer policies, Actions compatibility, Cloudflare Artifacts, and empirical productivity research. They returned 47 result entries across 47 distinct URLs; discovery is not the same as verification. The API reported an aggregate **$0.056** for these searches. That is the provider-reported query charge, not an account invoice or the cost of this overall research session.

The reproducible [Exa search log](research/exa-search-log.json) records queries, domain filters, result URLs/titles, provider dates, extraction lengths, and reported costs. It deliberately excludes full page bodies and credentials. Requests used `type: auto`, 6–7 requested results, and bounded text extraction. [Exa search API](https://exa.ai/docs/reference/search).

Ordinary search supplemented Exa with current Reddit threads, Hacker News discussions, Cursor forum reports, GitHub issues/discussions, competitor documentation, and official Cloudflare/GitHub/MCP specifications. Representative search families:

- `Cursor git competitor 2026 code hosting GitHub`, followed by Origin's launch, documentation and technical rationale.
- GitHub AI agent PR review overload, unwanted AI contributions, permission prompts, and parallel agent merge problems.
- Merge queues, stale/duplicate CI, flaky tests, service-container behavior and Actions portability.
- Cloudflare competition → Artifacts documentation → binding, Git protocol, authentication, limits, pricing, events and filesystem behavior.
- Dynamic Workers, Containers/Sandboxes, Workers Previews, Access, Browser Run, and the current MCP authorization specification.
- Foremerge/Entire/Jujutsu and large-scale integration systems as prior art, including sources that challenge novelty claims.

Each substantive document links the sources actually supporting its claims. The field-research table records source dates and retrieval caveats. The Exa log preserves discovery metadata; it is not an assertion that every hit was useful or accurate.

## How evidence was handled

**Official documentation** supports current product capabilities and constraints, but remains a provider claim until tested in the target account/runtime. Rapidly changing Cloudflare and MCP docs were checked live; old local SDK guidance was not treated as current API truth.

**Issue and forum reports** are primary evidence that someone encountered or reported a problem, not proof of prevalence or a still-open defect. Fixes and newer documentation override old claims about missing capabilities. Several Exa GitHub Community extracts contained only organization boilerplate and were not sufficient evidence on their own.

**Reddit and Hacker News** help discover language, objections, and practical experiences. They are self-selected, sometimes promotional, and often impossible to reproduce. An Exa Reddit-filtered query returned no results; ordinary web search supplied Reddit material. Some exact posting dates or full comments were inaccessible, and the field-research document marks those limitations rather than inventing them.

**Research studies and vendor experiments** apply to their particular tasks, tools and period. The older METR productivity finding is not a current blanket estimate; later work and measurement caveats are included in the evidence discussion. A claimed fleet experiment is not independently reproduced throughput.

**Our inference** connects an observation to a possible opportunity. **Our proposal** describes a system we could build. **Derived arithmetic** explores stated assumptions. None should be read as market validation, a passing benchmark, or an implemented capability.

## What this pass did not establish

It did not measure market prevalence, willingness to pay, production reliability, Cloudflare account-specific capacity, cross-fork billing behavior, Linux workflow compatibility, or useful throughput from 1,000 agents. It did not deploy runners, create cloud repositories, submit a competition entry, or contact discussion participants. The [validation plan](07-validation-and-demo-plan.md) turns these unknowns into concrete next experiments.

The concept HTML is a communication aid with invented data and predefined layouts. It tests neither Jev's ability to generate useful views nor whether people make better decisions with a canvas.

Local verification passed for document links, fenced JSON examples, balanced code fences, and absence of the used Exa credentials in delivered files. The HTML was exercised in Chromium across all three views at 390, 768, and 1440 pixels, including question switching, simulated previews, stale-state handling, evidence-dialog dismissal and focus restoration. No external network requests, page errors, or horizontal viewport overflow were observed. This was not a cross-browser or full accessibility audit.

For a follow-up evidence pass, prioritize observed pilot workflows and timed review tasks over collecting more complaints. Recheck platform limits, preview isolation, action versions, and Origin's evolving feature set at implementation time.
