# Race: beanstalk / replay

_measured: arena=real-arena@d2af54e6/0cba7528, 24 tasks, policy=beanstalk, agent=replay (replay control: reference patches, synthetic timings)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 656.816 |
| Tasks green / landed / dropped / total | 24 / 24 / 0 / 24 |
| Drops by reason | none |
| Wall-clock (min) | 2.19 |
| Wall-clock to all-green (min) | 2.19 |
| Task start to green, median / p90 (min) | 0.78 / 0.95 |
| Agent minutes busy / blocked / idle | 3.4 / 10.64 / 3.51 |
| Invocations (initial / rework / fixer / classifier) | 24 / 0 / 0 / 0 |
| Cost USD (total) | 0.0 |
| Cost USD by kind | initial 0.0000 |
| CI runs / minutes | 24 / 3.04 |
| CI runs by purpose | validate 24 |
| Textual conflicts met | 0 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 24 / 24 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | test/specs/commonmark/commonmark.0.31.2.json, test/specs/gfm/commonmark.0.31.2.json, test/unit/Lexer.test.js |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.9167 / 0.9167 / 0.9167 |
| Footprint vs oracle: P / R / F1 | 0.9167 / 0.9167 / 0.9167 |
| Variant | v2: pre-land check, informed author repair, decision cards, revert-first |
| Informed reworks / decision cards / revert-first tickets | 0 / 0 / 0 |
| Pre-land checks (red) / reworks / drops | 67 (0) / 0 / 0 |
| Pre-land check minutes | 8.4 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 5.0 / 12 / 43 / 10 |
| Placements disjoint / overlapping | 24 / 0 |
| Fast-trunk landings (task / fixer / revert) | 24 / 0 / 0 |
| Validations (green / red) | 24 / 0 |
| Repair tickets (closed / escalated / by method) | 0 / 0 / {} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 8,
  "ci_seconds": 5.0,
  "ci_slots": 2,
  "batch": null,
  "seed": 7,
  "budget_usd": 25.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": true,
  "snapshot": "head",
  "queue_hold": null,
  "error_budget": 999,
  "footprint": "predictor",
  "tasks": 24,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t001 | green | a0 | 0 | 0 | 0 | src | src | True |
| t002 | green | a1 | 0 | 0 | 0 | src | src | True |
| t003 | green | a2 | 0 | 0 | 0 | src | src | True |
| t004 | green | a3 | 0 | 0 | 0 | src | src | True |
| t005 | green | a4 | 0 | 0 | 0 | src | src | True |
| t006 | green | a5 | 0 | 0 | 0 | src | src | True |
| t007 | green | a6 | 0 | 0 | 0 | docs/img | src | True |
| t008 | green | a7 | 0 | 0 | 0 | src | src | True |
| t009 | green | a4 | 0 | 0 | 0 | src | src | True |
| t010 | green | a5 | 0 | 0 | 0 | src | src | True |
| t011 | green | a0 | 0 | 0 | 0 | src | src | True |
| t012 | green | a7 | 0 | 0 | 0 | src | src | True |
| t013 | green | a2 | 0 | 0 | 0 | src | src | True |
| t014 | green | a1 | 0 | 0 | 0 | src | src | True |
| t015 | green | a4 | 0 | 0 | 0 | src | src | True |
| t016 | green | a6 | 0 | 0 | 0 | src | src | True |
| t017 | green | a3 | 0 | 0 | 0 | src | src | True |
| t018 | green | a5 | 0 | 0 | 0 | src | src | True |
| t019 | green | a6 | 0 | 0 | 0 | src | src | True |
| t020 | green | a7 | 0 | 0 | 0 | src | src | True |
| t021 | green | a2 | 0 | 0 | 0 | src | src | True |
| t022 | green | a0 | 0 | 0 | 0 | src | src | True |
| t023 | green | a4 | 0 | 0 | 0 | src | src | True |
| t024 | green | a1 | 0 | 0 | 0 | (root) | bin | True |
