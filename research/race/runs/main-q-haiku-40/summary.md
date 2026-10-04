# Race: queue / claude

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=queue, agent=claude (haiku)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 106.987 |
| Tasks green / landed / dropped / total | 35 / 35 / 5 / 40 |
| Drops by reason | ejected (conflict): 3; ejected (red): 2 |
| Wall-clock (min) | 19.63 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 2.62 / 10.11 |
| Agent minutes busy / blocked / idle | 57.59 / 0.12 / 99.32 |
| Invocations (initial / rework / fixer / classifier) | 40 / 28 / 0 / 0 |
| Cost USD (total) | 6.9259 |
| Cost USD by kind | initial 2.4615, rework 4.4644 |
| CI runs / minutes | 29 / 26.81 |
| CI runs by purpose | batch 19, bisect 7, batch-cancelled 3 |
| Textual conflicts met | 27 |
| Red validations | 6 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 35 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 25 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6571 / 0.4809 / 0.5333 |
| Footprint vs oracle: P / R / F1 | 0.6857 / 0.4809 / 0.5429 |
| Batches (green / red / cancelled) | 13 / 6 / 3 |
| Bisections / bisect CI runs | 5 / 7 |
| Ejections (conflict / red) | 27 / 6 |
| PRs held behind in-flight conflicts | 9 |
| Mean batch size | 2.182 |

## Config

```json
{
  "agents": 8,
  "ci_seconds": 60.0,
  "ci_slots": 2,
  "batch": 4,
  "seed": 7,
  "budget_usd": 25.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": true,
  "snapshot": null,
  "queue_hold": false,
  "error_budget": null,
  "footprint": "predictor",
  "tasks": 40,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t001 | green | a0 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a1 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a2 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a4 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a6 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a7 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a4 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | dropped | a1 | 3 | 3 | 1 | src/db | - | False |
| t011 | dropped | a4 | 3 | 4 | 0 | src/orders | - | False |
| t012 | green | a5 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a1 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a2 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a6 | 1 | 1 | 0 | src/billing | src/billing | True |
| t016 | green | a4 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a6 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a5 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a6 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a7 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a2 | 1 | 1 | 0 | src/db | src/catalog | True |
| t022 | green | a3 | 3 | 3 | 0 | src/billing | src, src/billing | True |
| t023 | green | a5 | 1 | 1 | 0 | src/billing | src/billing, src/lib | True |
| t024 | green | a1 | 3 | 3 | 0 | src/db | src, src/billing, src/db | True |
| t025 | green | a0 | 1 | 1 | 0 | src/notifications | src/notifications | True |
| t026 | green | a7 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a4 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | dropped | a1 | 3 | 2 | 2 | src/orders | - | False |
| t029 | green | a3 | 1 | 1 | 0 | src/cart | src/orders | True |
| t030 | green | a4 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | green | a1 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t032 | dropped | a1 | 3 | 1 | 3 | src/billing | - | False |
| t033 | green | a6 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a0 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t035 | green | a7 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | dropped | a0 | 3 | 4 | 0 | src/billing | - | False |
| t037 | green | a0 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a1 | 1 | 1 | 0 | src/cart | src/billing | True |
| t039 | green | a1 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t040 | green | a1 | 0 | 0 | 0 | src/db | src/billing | True |
