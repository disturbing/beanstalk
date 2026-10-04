# Race: queue / claude

_measured: arena=arena-long@26eecce0/ddd3b27a, 16 tasks, policy=queue, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 36.813 |
| Tasks green / landed / dropped / total | 12 / 12 / 4 / 16 |
| Drops by reason | ejected (conflict): 2; ejected (red): 2 |
| Wall-clock (min) | 19.56 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 4.18 / 14.29 |
| Agent minutes busy / blocked / idle | 14.67 / 0.15 / 219.88 |
| Invocations (initial / rework / fixer / classifier) | 16 / 20 / 0 / 0 |
| Cost USD (total) | 4.3963 |
| Cost USD by kind | initial 1.5751, rework 2.8211 |
| CI runs / minutes | 22 / 22.26 |
| CI runs by purpose | batch 15, bisect 7 |
| Textual conflicts met | 16 |
| Red validations | 8 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 12 / 16 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 3 |
| Footprint (predictor) vs actual: P / R / F1 | 0.8333 / 0.3917 / 0.5099 |
| Footprint vs oracle: P / R / F1 | 0.8333 / 0.3944 / 0.5139 |
| Batches (green / red / cancelled) | 7 / 8 / 0 |
| Bisections / bisect CI runs | 5 / 7 |
| Ejections (conflict / red) | 16 / 8 |
| PRs held behind in-flight conflicts | 12 |
| Mean batch size | 1.6 |

## Config

```json
{
  "agents": 12,
  "ci_seconds": 60.0,
  "ci_slots": 2,
  "batch": 4,
  "seed": 11,
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
| L01 | green | a0 | 2 | 1 | 1 | src/orders | src, src/billing | True |
| L02 | green | a0 | 3 | 2 | 1 | src/orders | src, src/billing, src/catalog, src/db, src/lib, src/orders | True |
| L03 | green | a4 | 1 | 1 | 0 | src/billing | src, src/billing, src/db | True |
| L04 | green | a3 | 0 | 0 | 0 | src/lib | src/lib, src/users | True |
| L05 | dropped | a1 | 3 | 2 | 2 | src/billing | - | False |
| L06 | green | a5 | 0 | 0 | 0 | src/notifications | src/inventory, src/notifications | True |
| L07 | dropped | a2 | 3 | 2 | 2 | src/db | - | False |
| L08 | green | a7 | 0 | 0 | 0 | src/db | src, src/catalog, src/db, src/orders, src/shipping | True |
| L09 | green | a8 | 0 | 0 | 0 | src/auth | src/auth, src/users | True |
| L10 | dropped | a0 | 3 | 3 | 1 | src/orders | - | False |
| L11 | green | a10 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| L12 | dropped | a0 | 3 | 3 | 1 | src/billing | - | False |
| L13 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| L14 | green | a1 | 1 | 1 | 0 | src/shipping | src, src/shipping | True |
| L15 | green | a11 | 0 | 0 | 0 | src/cart | src/orders | True |
| L16 | green | a2 | 1 | 1 | 0 | src/cart | src/cart, src/inventory | True |
