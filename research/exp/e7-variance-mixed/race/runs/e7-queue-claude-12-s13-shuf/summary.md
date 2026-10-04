# Race: queue / claude

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=queue, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 77.741 |
| Tasks green / landed / dropped / total | 35 / 35 / 5 / 40 |
| Drops by reason | ejected (conflict): 2; ejected (red): 3 |
| Wall-clock (min) | 27.01 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 3.27 / 12.79 |
| Agent minutes busy / blocked / idle | 23.82 / 0.96 / 299.38 |
| Invocations (initial / rework / fixer / classifier) | 40 / 30 / 0 / 0 |
| Cost USD (total) | 4.3926 |
| Cost USD by kind | initial 2.4240, rework 1.9686 |
| CI runs / minutes | 40 / 39.54 |
| CI runs by purpose | batch 21, batch-cancelled 4, bisect 15 |
| Textual conflicts met | 23 |
| Red validations | 12 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 35 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 4 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6286 / 0.4629 / 0.5095 |
| Footprint vs oracle: P / R / F1 | 0.6571 / 0.4643 / 0.521 |
| Batches (green / red / cancelled) | 9 / 12 / 4 |
| Bisections / bisect CI runs | 10 / 15 |
| Ejections (conflict / red) | 23 / 12 |
| PRs held behind in-flight conflicts | 10 |
| Mean batch size | 2.56 |

## Config

```json
{
  "agents": 12,
  "ci_seconds": 60.0,
  "ci_slots": 2,
  "batch": 4,
  "seed": 13,
  "budget_usd": 15.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": false,
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
| t017 | green | a0 | 0 | 0 | 0 | src/orders | src/billing | True |
| t021 | green | a1 | 0 | 0 | 0 | src/db | src/catalog | True |
| t016 | green | a2 | 0 | 0 | 0 | src/billing | src/billing | True |
| t034 | green | a3 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t026 | green | a4 | 0 | 0 | 0 | src/billing | src/billing | True |
| t039 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | green | a6 | 0 | 0 | 0 | src/billing | src/billing | True |
| t025 | green | a7 | 0 | 0 | 0 | src/notifications | src/notifications | True |
| t007 | green | a8 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t035 | green | a9 | 0 | 0 | 0 | src/cart | src/cart | True |
| t009 | green | a10 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | dropped | a0 | 3 | 3 | 1 | src/db | - | False |
| t003 | green | a0 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t020 | green | a3 | 0 | 0 | 0 | src/auth | src/users | True |
| t022 | dropped | a3 | 3 | 3 | 1 | src/billing | - | False |
| t037 | green | a4 | 0 | 0 | 0 | src/db | src/catalog | True |
| t014 | green | a7 | 0 | 0 | 0 | src/auth | src/auth | True |
| t038 | green | a10 | 0 | 0 | 0 | src/cart | src/billing | True |
| t005 | green | a2 | 0 | 0 | 0 | src/lib | src/lib | True |
| t008 | green | a1 | 1 | 1 | 0 | src/inventory | src/inventory | True |
| t033 | green | a5 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t002 | green | a1 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t019 | green | a8 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t040 | green | a3 | 0 | 0 | 0 | src/db | src/billing | True |
| t027 | green | a10 | 0 | 0 | 0 | src/db | src/users | True |
| t031 | green | a4 | 3 | 2 | 1 | src/billing | src, src/billing | True |
| t013 | dropped | a5 | 3 | 2 | 2 | src/notifications | - | False |
| t006 | green | a2 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t036 | green | a1 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t032 | dropped | a0 | 3 | 0 | 4 | src/billing | - | False |
| t011 | green | a0 | 3 | 3 | 0 | src/orders | src, src/db, src/notifications, src/orders, src/shipping | True |
| t024 | green | a1 | 2 | 2 | 0 | src/db | src, src/billing, src/db | True |
| t001 | green | a5 | 0 | 0 | 0 | src/orders | src/billing | True |
| t015 | green | a8 | 2 | 2 | 0 | src/billing | src/billing | True |
| t029 | green | a5 | 1 | 1 | 0 | src/cart | src/orders | True |
| t030 | green | a2 | 0 | 0 | 0 | src/cart | src/orders | True |
| t018 | green | a0 | 1 | 1 | 0 | src/orders | src/notifications | True |
| t028 | green | a4 | 1 | 1 | 0 | src/orders | src, src/shipping | True |
| t023 | dropped | a0 | 3 | 1 | 3 | src/billing | - | False |
| t012 | green | a11 | 0 | 0 | 0 | src/auth | src/auth | True |
