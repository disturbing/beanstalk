# Race: queue / claude

_measured: arena=arena@26eecce0/8c321b35, 12 tasks, policy=queue, agent=claude (haiku)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 32.072 |
| Tasks green / landed / dropped / total | 11 / 11 / 1 / 12 |
| Drops by reason | ejected (red): 1 |
| Wall-clock (min) | 20.58 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 1.7 / 6.69 |
| Agent minutes busy / blocked / idle | 23.29 / 0.05 / 58.97 |
| Invocations (initial / rework / fixer / classifier) | 12 / 6 / 0 / 0 |
| Cost USD (total) | 2.2801 |
| Cost USD by kind | initial 0.8309, rework 1.4491 |
| CI runs / minutes | 22 / 11.3 |
| CI runs by purpose | batch 12, batch-cancelled 2, bisect 8 |
| Textual conflicts met | 1 |
| Red validations | 6 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 10 / 12 |
| Final green correct (suite + every green task's acceptance) | False |
| Base tests edited by landed changes | none |
| Footprint (predictor) vs actual: P / R / F1 | 0.5455 / 0.4091 / 0.4546 |
| Footprint vs oracle: P / R / F1 | 0.5455 / 0.4091 / 0.4546 |
| Batches (green / red / cancelled) | 6 / 6 / 2 |
| Bisections / bisect CI runs | 4 / 8 |
| Ejections (conflict / red) | 1 / 6 |
| PRs held behind in-flight conflicts | 2 |
| Mean batch size | 1.857 |

## Config

```json
{
  "agents": 4,
  "ci_seconds": 30.0,
  "ci_slots": 2,
  "batch": 4,
  "seed": 1,
  "budget_usd": 5.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": true,
  "snapshot": null,
  "queue_hold": false,
  "error_budget": null,
  "footprint": "predictor",
  "tasks": 12
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t001 | green | a0 | 0 | 0 | 0 | src/orders | src/billing | True |
| t003 | green | a0 | 1 | 0 | 1 | src/billing | src, src/billing | True |
| t005 | green | a2 | 0 | 0 | 0 | src/lib | src/lib | False |
| t008 | green | a3 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t017 | green | a3 | 0 | 0 | 0 | src/orders | src/billing | True |
| t023 | green | a2 | 0 | 0 | 0 | src/billing | src/billing, src/lib | True |
| t028 | green | a0 | 0 | 0 | 0 | src/orders | src, src/db, src/shipping | True |
| t031 | green | a0 | 1 | 0 | 1 | src/billing | src, src/billing | True |
| t032 | green | a0 | 1 | 0 | 1 | src/billing | src, src/orders, src/shipping | True |
| t034 | green | a0 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t036 | dropped | a0 | 3 | 1 | 3 | src/billing | - | False |
| t040 | green | a3 | 0 | 0 | 0 | src/db | src/billing | True |
