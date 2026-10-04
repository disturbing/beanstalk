# Race: queue / mixed

_measured: arena=arena@26eecce0/8c321b35, 4 tasks, policy=queue, agent=mixed (sonnet+codex-default)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 218.914 |
| Tasks green / landed / dropped / total | 4 / 4 / 0 / 4 |
| Drops by reason | none |
| Wall-clock (min) | 1.1 |
| Wall-clock to all-green (min) | 1.1 |
| Task start to green, median / p90 (min) | 0.72 / 1.03 |
| Agent minutes busy / blocked / idle | 1.6 / 0.01 / 2.78 |
| Invocations (initial / rework / fixer / classifier) | 4 / 1 / 0 / 0 |
| Cost USD (total) | 0.1648 |
| Cost USD by kind | initial 0.1321, rework 0.0326 |
| CI runs / minutes | 4 / 1.36 |
| CI runs by purpose | batch 4 |
| Textual conflicts met | 1 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 4 / 4 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.0 / 0.0 / 0.0 |
| Footprint vs oracle: P / R / F1 | 0.25 / 0.125 / 0.1667 |
| Batches (green / red / cancelled) | 4 / 0 / 0 |
| Bisections / bisect CI runs | 0 / 0 |
| Ejections (conflict / red) | 1 / 0 |
| PRs held behind in-flight conflicts | 0 |
| Mean batch size | 1.0 |

## Config

```json
{
  "agents": 4,
  "ci_seconds": 20.0,
  "ci_slots": 2,
  "batch": 2,
  "seed": 7,
  "budget_usd": 3.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": false,
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
| t001 | green | a0 | 0 | 0 | 0 | src/orders | src/billing | True |
| t020 | green | a1 | 0 | 0 | 0 | src/auth | src/users | True |
| t027 | green | a2 | 0 | 0 | 0 | src/db | src/users | True |
| t040 | green | a0 | 1 | 1 | 0 | src/db | src/billing | True |
