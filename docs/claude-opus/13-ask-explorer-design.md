# Ask: the repo explorer that re-shapes itself around a question

**Coop's direction (2026-10-04):** the canvas is good for watching a race, but the main surface is the *repository*. When someone asks "what are the recent changes on coupons?", the UI should become a GitHub-style explorer **filtered and arranged for that question**:
- only the relevant files in the tree;
- their diffs;
- the beans and sprout or stalk commits involved, and the agents behind them;
- the decisions taken along the way.

It shouldn't just show the raw message history.

## 1. The base layout is the explorer

This is GitHub's repo view, kept familiar so muscle memory transfers. Every answer is the same layout with a different configuration.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ Ask ▸ [ what changed recently on coupons?                         ] (sprout ▾)│
├──────────────┬────────────────────────────────────────────┬───────────────────┤
│ FILE TREE    │ MAIN PANE                                  │ CONTEXT RAIL      │
│ (filtered)   │ file view │ diff view │ bean view          │ beans · agents ·  │
│              │                                            │ decisions · tests │
└──────────────┴────────────────────────────────────────────┴───────────────────┘
  answer chips:  [coupons ×] [last 24 h ×] [sprout vs stalk] [+3 beans in flight]
```

- **File tree (left):** the full tree, or with a question active only the matched files and their ancestors. Each matched file carries badges for change count, in-flight beans, red tests and decision records. Clearing the question returns the full tree.
- **Main pane (centre):** one of three views:
  - **file:** content at the chosen ref, with the lines changed in the question's range highlighted;
  - **diff:** a combined or per-bean diff of the matched files over the range;
  - **bean:** one bean's intent, diff, pre-land checks, reworks, decision and agent.
- **Context rail (right):**
  - beans touching the matched files, as a timeline (landed on sprout, promoted to stalk, reverted, in flight), each with its agent;
  - decision records and spec amendments;
  - the acceptance tests that cover the files, with pass or fail state.
- **Answer chips:** the parsed question (entities, time range, ref) shown as removable filters. Removing a chip re-runs the query, which keeps the answer editable and honest about what was understood.

## 2. A question becomes a view spec, not a generated layout

```json
{ "class": "recent-changes",
  "entities": { "feature": "coupons", "paths": [], "agent": null, "bean": null },
  "range": { "since": "24h", "ref": "sprout" },
  "view": { "tree": "filtered", "main": "diff", "rail": ["beans", "decisions", "tests"] } }
```

**The pipeline** follows the canvas rule: code computes, a classifier picks, nothing writes layout.
1. **Classify** the question into one of the classes in §3 and extract entities: a constrained JSON choice over the catalog.
   - The classifier is Jev when credits exist; until then a small Workers AI model behind AI Gateway, which is allowed for non-coding roles.
   - Either way, the output is validated against the catalog and falls back to `explore` with full-text search.
2. **Resolve entities to files**, in code:
   - a feature term becomes files by combining (a) path and name matches, (b) a content grep at the ref, (c) files touched by beans whose title or intent mentions the term, and (d) files under the acceptance tests that mention it, ranked;
   - the top N become the file set, shown as chips the user can prune.
3. **Query** the gateway: the tree at the ref, diffs over the range, beans by path (from run events), decisions, tests.
4. **Render** the fixed layout with the chosen view configuration.
5. **Optionally narrate:** a two-line Claude caption from the computed results, never from raw repo text.

## 3. Question classes (v1 catalog)

| Class | Example | Tree | Main | Rail |
|---|---|---|---|---|
| `recent-changes` | "what changed recently on coupons?" | filtered to the feature's files | combined diff over the range | beans timeline, decisions |
| `who-why` | "who changed tax rounding and why?" | filtered | file with blame-by-bean highlights | beans with intents, decision records |
| `in-flight` | "what's being worked on in billing right now?" | filtered, in-flight badges | bean view of the busiest bean | agents and lanes for those files |
| `what-broke` | "why did the sprout go red at 3pm?" | the failing tests' read set | diff of the culprit bean | red validations, reverts, repairs |
| `pending-promotion` | "what's on sprout but not on stalk?" | files differing sprout vs stalk | diff stalk..sprout | beans awaiting promotion, validation ETA |
| `decisions` | "what did we decide about money formatting?" | files under the decision | file with the amended tests | decision cards, spec amendments |
| `tests-for` | "what tests cover checkout?" | tests plus the code they import | the test file | pass/fail history |
| `agent-activity` | "what has codex-7 done today?" | files that agent touched | bean list | that agent's beans |
| `bean` | "show bean t032" | that bean's files | bean view | checks, reworks, decision |
| `explore` (fallback) | anything else / a path | full tree with search hits | file | recent beans |

## 4. Data the gateway must serve (RPC, read-only, scoped to a run or repo)

- `repoTree(run, ref, path?)`, `repoFile(run, ref, path)`, `repoDiff(run, fromRef, toRef, paths?)`, `repoLog(run, ref, paths?, limit)`, `repoGrep(run, ref, pattern, paths?)`. These go through the Artifacts binding (`readTree`, `readFile`, `log`), plus the runner for grep and diff where the binding can't.
- `beansByPath(run, paths)` and `beanDetail(run, bean)`, from the RunDO's event log: which beans touched which files, status, agent, intent, decision.
- `decisions(run, paths?)`, `testsFor(run, paths)` (acceptance tests whose import closure covers the paths; the runner already computes read sets).

## 5. Why this rather than a free canvas

- **Familiar first:** it's GitHub's layout, so nothing is new until you ask. Asking only filters and arranges it.
- **Inspectable:** every answer is a view spec with visible chips, and the same spec is available to agents as JSON over MCP (`ask_repo`). Humans and agents see the same facts.
- **Bounded:** the catalog is a fixed set of question classes and panels. New classes are added deliberately, as reviewed code, from logged unanswered questions (see `04` §5.4).
