# Race: queue / claude

_measured: arena=real-arena@d2af54e6/0cba7528, 24 tasks, policy=queue, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 326.306 |
| Tasks green / landed / dropped / total | 24 / 24 / 0 / 24 |
| Drops by reason | none |
| Wall-clock (min) | 4.41 |
| Wall-clock to all-green (min) | 4.41 |
| Task start to green, median / p90 (min) | 3.0 / 4.12 |
| Agent minutes busy / blocked / idle | 9.81 / 0.25 / 42.89 |
| Invocations (initial / rework / fixer / classifier) | 24 / 0 / 0 / 0 |
| Cost USD (total) | 1.5611 |
| Cost USD by kind | initial 1.5611 |
| CI runs / minutes | 8 / 8.35 |
| CI runs by purpose | batch 8 |
| Textual conflicts met | 0 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 24 / 24 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | test/specs/commonmark/commonmark.0.31.2.json, test/specs/gfm/commonmark.0.31.2.json, test/unit/Lexer.test.js |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.9167 / 0.9167 / 0.9167 |
| Footprint vs oracle: P / R / F1 | 0.9167 / 0.9167 / 0.9167 |
| Batches (green / red / cancelled) | 8 / 0 / 0 |
| Bisections / bisect CI runs | 0 / 0 |
| Ejections (conflict / red) | 0 / 0 |
| PRs held behind in-flight conflicts | 0 |
| Mean batch size | 3.0 |

## Config

```json
{
  "agents": 12,
  "ci_seconds": 60.0,
  "ci_slots": 2,
  "batch": 4,
  "seed": 11,
  "budget_usd": 25.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": false,
  "snapshot": null,
  "queue_hold": false,
  "error_budget": null,
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
| t009 | green | a8 | 0 | 0 | 0 | src | src | True |
| t010 | green | a9 | 0 | 0 | 0 | src | src | True |
| t011 | green | a10 | 0 | 0 | 0 | src | src | True |
| t012 | green | a11 | 0 | 0 | 0 | src | src | True |
| t013 | green | a2 | 0 | 0 | 0 | src | src | True |
| t014 | green | a0 | 0 | 0 | 0 | src | src | True |
| t015 | green | a3 | 0 | 0 | 0 | src | src | True |
| t016 | green | a4 | 0 | 0 | 0 | src | src | True |
| t017 | green | a5 | 0 | 0 | 0 | src | src | True |
| t018 | green | a8 | 0 | 0 | 0 | src | src | True |
| t019 | green | a2 | 0 | 0 | 0 | src | src | True |
| t020 | green | a11 | 0 | 0 | 0 | src | src | True |
| t021 | green | a1 | 0 | 0 | 0 | src | src | True |
| t022 | green | a9 | 0 | 0 | 0 | src | src | True |
| t023 | green | a4 | 0 | 0 | 0 | src | src | True |
| t024 | green | a5 | 0 | 0 | 0 | (root) | bin | True |
