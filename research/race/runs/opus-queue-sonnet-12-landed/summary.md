# Race: queue / claude

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=queue, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 134.772 |
| Tasks green / landed / dropped / total | 37 / 37 / 3 / 40 |
| Drops by reason | ejected (conflict): 2; ejected (red): 1 |
| Wall-clock (min) | 16.47 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 4.84 / 12.66 |
| Agent minutes busy / blocked / idle | 21.1 / 0.41 / 176.16 |
| Invocations (initial / rework / fixer / classifier) | 40 / 30 / 0 / 0 |
| Cost USD (total) | 4.4167 |
| Cost USD by kind | initial 2.0370, rework 2.3797 |
| CI runs / minutes | 28 / 25.39 |
| CI runs by purpose | batch 20, batch-cancelled 3, bisect 5 |
| Textual conflicts met | 26 |
| Red validations | 7 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 37 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 1 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6486 / 0.4595 / 0.5126 |
| Footprint vs oracle: P / R / F1 | 0.6757 / 0.4617 / 0.5243 |
| Batches (green / red / cancelled) | 13 / 7 / 3 |
| Bisections / bisect CI runs | 3 / 5 |
| Ejections (conflict / red) | 26 / 7 |
| PRs held behind in-flight conflicts | 10 |
| Mean batch size | 2.435 |

## Config

```json
{
  "agents": 12,
  "ci_seconds": 60.0,
  "ci_slots": 2,
  "batch": 4,
  "seed": 7,
  "budget_usd": 75.0,
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
| t001 | green | a0 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a1 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a1 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t004 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a4 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a0 | 1 | 1 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a7 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a8 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | dropped | a5 | 3 | 4 | 0 | src/db | - | False |
| t011 | green | a10 | 0 | 0 | 0 | src/orders | src, src/db, src/orders, src/shipping | True |
| t012 | green | a11 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a11 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a7 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t016 | green | a4 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a5 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a1 | 1 | 0 | 1 | src/orders | src/notifications, src/shipping | True |
| t019 | green | a8 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a3 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a9 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | green | a0 | 3 | 3 | 0 | src/billing | src, src/billing | True |
| t023 | green | a1 | 1 | 1 | 0 | src/billing | src/billing, src/lib | True |
| t024 | green | a1 | 3 | 3 | 0 | src/db | src, src/billing, src/db, src/lib | True |
| t025 | green | a0 | 3 | 2 | 1 | src/notifications | src/notifications | True |
| t026 | green | a2 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a0 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a2 | 1 | 1 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a2 | 2 | 2 | 0 | src/cart | src/orders | True |
| t030 | green | a3 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | green | a6 | 2 | 1 | 1 | src/billing | src, src/billing | True |
| t032 | dropped | a1 | 3 | 1 | 3 | src/billing | - | False |
| t033 | green | a7 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a5 | 1 | 1 | 0 | src/inventory | src/inventory | True |
| t035 | green | a0 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | dropped | a0 | 3 | 3 | 1 | src/billing | - | False |
| t037 | green | a3 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a7 | 1 | 1 | 0 | src/cart | src/billing | True |
| t039 | green | a6 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t040 | green | a0 | 1 | 1 | 0 | src/db | src/billing | True |
