# Race: queue / claude

_measured: arena=arena@26eecce0/8c321b35, 12 tasks, policy=queue, agent=claude (sonnet)_

**Aborted:** signal SIGTERM

| Metric | Value |
|---|---|
| Changes reaching green per hour | 89.943 |
| Tasks green / landed / dropped / total | 2 / 2 / 0 / 12 |
| Drops by reason | none |
| Wall-clock (min) | 1.33 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 0.72 / 0.72 |
| Agent minutes busy / blocked / idle | 3.46 / 0.02 / 1.85 |
| Invocations (initial / rework / fixer / classifier) | 12 / 0 / 0 / 0 |
| Cost USD (total) | 0.6058 |
| Cost USD by kind | initial 0.6058 |
| CI runs / minutes | 6 / 2.24 |
| CI runs by purpose | batch 3, batch-cancelled 1, bisect-cancelled 2 |
| Textual conflicts met | 0 |
| Red validations | 1 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 2 / 12 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.5 / 0.5 / 0.5 |
| Footprint vs oracle: P / R / F1 | 0.5 / 0.5 / 0.5 |
| Batches (green / red / cancelled) | 2 / 1 / 1 |
| Bisections / bisect CI runs | 1 / 0 |
| Ejections (conflict / red) | 0 / 0 |
| PRs held behind in-flight conflicts | 1 |
| Mean batch size | 1.75 |

## Config

```json
{
  "agents": 4,
  "ci_seconds": 30.0,
  "ci_slots": 2,
  "batch": 4,
  "seed": 1,
  "budget_usd": 12.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": true,
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
| t001 | green | a0 | 0 | 0 | 0 | src/orders | src/billing | True |
| t003 | testing | a1 | 0 | 0 | 0 | src/billing | - | False |
| t005 | green | a2 | 0 | 0 | 0 | src/lib | src/lib | True |
| t008 | testing | a3 | 0 | 0 | 0 | src/inventory | - | False |
| t017 | testing | a0 | 0 | 0 | 0 | src/orders | - | False |
| t023 | testing | a2 | 0 | 0 | 0 | src/billing | - | False |
| t028 | queued | a3 | 0 | 0 | 0 | src/orders | - | False |
| t031 | queued | a0 | 0 | 0 | 0 | src/billing | - | False |
| t032 | queued | a1 | 0 | 0 | 0 | src/billing | - | False |
| t034 | queued | a2 | 0 | 0 | 0 | src/inventory | - | False |
| t036 | queued | a3 | 0 | 0 | 0 | src/billing | - | False |
| t040 | queued | a2 | 0 | 0 | 0 | src/db | - | False |
