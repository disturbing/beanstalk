# Race: queue / replay

_measured: arena=arena@26eecce0/8c321b35, 4 tasks, policy=queue, agent=replay (replay control: reference patches, synthetic timings)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 1173.991 |
| Tasks green / landed / dropped / total | 2 / 2 / 2 / 4 |
| Drops by reason | replay could not resolve the conflict or red (limitation of replay agents): 2 |
| Wall-clock (min) | 0.1 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 0.05 / 0.05 |
| Agent minutes busy / blocked / idle | 0.2 / 0.01 / 0.2 |
| Invocations (initial / rework / fixer / classifier) | 4 / 2 / 0 / 0 |
| Cost USD (total) | 0.0 |
| Cost USD by kind | initial 0.0000, rework 0.0000 |
| CI runs / minutes | 3 / 0.07 |
| CI runs by purpose | batch 3 |
| Textual conflicts met | 1 |
| Red validations | 1 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 2 / 4 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.5 / 0.25 / 0.3333 |
| Footprint vs oracle: P / R / F1 | 0.5 / 0.25 / 0.3333 |
| Batches (green / red / cancelled) | 2 / 1 / 0 |
| Bisections / bisect CI runs | 0 / 0 |
| Ejections (conflict / red) | 1 / 1 |
| PRs held behind in-flight conflicts | 0 |
| Mean batch size | 1.0 |

## Config

```json
{
  "agents": 4,
  "ci_seconds": 1.0,
  "ci_slots": 2,
  "batch": 4,
  "seed": 3,
  "budget_usd": 25.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": true,
  "snapshot": null,
  "queue_hold": false,
  "error_budget": null,
  "footprint": "predictor",
  "tasks": 4,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t001 | dropped | a0 | 1 | 1 | 0 | src/orders | - | False |
| t005 | dropped | a1 | 1 | 0 | 1 | src/lib | - | False |
| t031 | green | a2 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t040 | green | a3 | 0 | 0 | 0 | src/db | src/billing | True |
