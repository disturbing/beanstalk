# Race: queue / replay

_measured: arena=arena@26eecce0/8c321b35, 12 tasks, policy=queue, agent=replay (replay control: reference patches, synthetic timings)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 765.895 |
| Tasks green / landed / dropped / total | 10 / 10 / 2 / 12 |
| Drops by reason | replay could not resolve the conflict or red (limitation of replay agents): 2 |
| Wall-clock (min) | 0.78 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 0.26 / 0.57 |
| Agent minutes busy / blocked / idle | 1.38 / 0.31 / 3.01 |
| Invocations (initial / rework / fixer / classifier) | 12 / 5 / 0 / 0 |
| Cost USD (total) | 0.0 |
| Cost USD by kind | initial 0.0000, rework 0.0000 |
| CI runs / minutes | 7 / 0.68 |
| CI runs by purpose | batch 7 |
| Textual conflicts met | 5 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 10 / 12 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.9 / 0.6083 / 0.69 |
| Footprint vs oracle: P / R / F1 | 0.9 / 0.6083 / 0.69 |
| Batches (green / red / cancelled) | 7 / 0 / 0 |
| Bisections / bisect CI runs | 0 / 0 |
| Ejections (conflict / red) | 5 / 0 |
| PRs held behind in-flight conflicts | 1 |
| Mean batch size | 1.429 |

## Config

```json
{
  "agents": 6,
  "ci_seconds": 3.0,
  "ci_slots": 2,
  "batch": 4,
  "seed": 3,
  "budget_usd": 25.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": false,
  "snapshot": null,
  "queue_hold": false,
  "error_budget": null,
  "footprint": "predictor",
  "tasks": 12,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t004 | green | a0 | 0 | 0 | 0 | src/billing | src/billing | True |
| t006 | green | a1 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t008 | green | a2 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t011 | green | a3 | 0 | 0 | 0 | src/orders | src, src/db, src/orders, src/shipping | True |
| t012 | green | a4 | 0 | 0 | 0 | src/auth | src/auth | True |
| t009 | green | a5 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t003 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t010 | dropped | a0 | 1 | 1 | 0 | src/db | - | False |
| t002 | green | a1 | 1 | 1 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t007 | dropped | a0 | 1 | 1 | 0 | src/orders | - | False |
| t001 | green | a4 | 0 | 0 | 0 | src/orders | src/billing | True |
| t005 | green | a0 | 2 | 2 | 0 | src/lib | src/lib | True |
