# Race: queue / claude

_measured: arena=arena-long@26eecce0/ddd3b27a, 16 tasks, policy=queue, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 46.932 |
| Tasks green / landed / dropped / total | 13 / 13 / 3 / 16 |
| Drops by reason | ejected (conflict): 1; ejected (red): 2 |
| Wall-clock (min) | 16.62 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 6.1 / 12.53 |
| Agent minutes busy / blocked / idle | 15.11 / 0.25 / 184.08 |
| Invocations (initial / rework / fixer / classifier) | 16 / 23 / 0 / 0 |
| Cost USD (total) | 3.5495 |
| Cost USD by kind | initial 1.8765, rework 1.6730 |
| CI runs / minutes | 18 / 18.29 |
| CI runs by purpose | batch 12, bisect 6 |
| Textual conflicts met | 19 |
| Red validations | 7 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 13 / 16 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 6 |
| Footprint (predictor) vs actual: P / R / F1 | 0.8462 / 0.3679 / 0.4887 |
| Footprint vs oracle: P / R / F1 | 0.8462 / 0.3769 / 0.5 |
| Batches (green / red / cancelled) | 5 / 7 / 0 |
| Bisections / bisect CI runs | 5 / 6 |
| Ejections (conflict / red) | 19 / 7 |
| PRs held behind in-flight conflicts | 9 |
| Mean batch size | 1.833 |

## Config

```json
{
  "agents": 12,
  "ci_seconds": 60.0,
  "ci_slots": 2,
  "batch": 4,
  "seed": 7,
  "budget_usd": 20.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": false,
  "snapshot": null,
  "queue_hold": false,
  "error_budget": null,
  "footprint": "predictor",
  "tasks": 16,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| L01 | green | a0 | 1 | 1 | 0 | src/orders | src, src/billing | True |
| L02 | green | a1 | 3 | 2 | 1 | src/orders | src, src/billing, src/catalog, src/db, src/lib, src/orders | True |
| L03 | green | a3 | 2 | 2 | 0 | src/billing | src, src/billing, src/db | True |
| L04 | green | a3 | 0 | 0 | 0 | src/lib | src/lib, src/users | True |
| L05 | green | a4 | 0 | 0 | 0 | src/billing | src, src/billing, src/lib | True |
| L06 | green | a5 | 0 | 0 | 0 | src/notifications | src/inventory, src/notifications | True |
| L07 | dropped | a0 | 3 | 3 | 1 | src/db | - | False |
| L08 | green | a7 | 0 | 0 | 0 | src/db | src, src/catalog, src/db, src/orders, src/shipping | True |
| L09 | green | a8 | 0 | 0 | 0 | src/auth | src/auth, src/users | True |
| L10 | dropped | a2 | 3 | 3 | 1 | src/orders | - | False |
| L11 | dropped | a0 | 3 | 1 | 3 | src/billing | - | False |
| L12 | green | a4 | 3 | 2 | 1 | src/billing | src, src/billing, src/notifications, src/shipping | True |
| L13 | green | a1 | 1 | 1 | 0 | src/billing | src/billing | True |
| L14 | green | a5 | 1 | 1 | 0 | src/shipping | src, src/shipping | True |
| L15 | green | a2 | 1 | 1 | 0 | src/cart | src/inventory, src/orders | True |
| L16 | green | a1 | 2 | 2 | 0 | src/cart | src/cart, src/inventory | True |
