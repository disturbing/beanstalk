# Race: queue / claude

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=queue, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 72.683 |
| Tasks green / landed / dropped / total | 36 / 36 / 4 / 40 |
| Drops by reason | ejected (conflict): 2; ejected (red): 2 |
| Wall-clock (min) | 29.72 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 3.98 / 13.09 |
| Agent minutes busy / blocked / idle | 151.26 / 0.47 / 204.89 |
| Invocations (initial / rework / fixer / classifier) | 40 / 21 / 0 / 0 |
| Cost USD (total) | 4.6064 |
| Cost USD by kind | initial 2.2416, rework 2.3649 |
| CI runs / minutes | 43 / 43.37 |
| CI runs by purpose | batch 25, batch-cancelled 4, bisect 14 |
| Textual conflicts met | 16 |
| Red validations | 9 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 36 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 9 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6389 / 0.4653 / 0.5157 |
| Footprint vs oracle: P / R / F1 | 0.6667 / 0.4653 / 0.525 |
| Batches (green / red / cancelled) | 16 / 9 / 4 |
| Bisections / bisect CI runs | 6 / 14 |
| Ejections (conflict / red) | 16 / 9 |
| PRs held behind in-flight conflicts | 9 |
| Mean batch size | 2.069 |

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
  "tasks": 40,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t001 | green | a0 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a1 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a9 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t004 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a4 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a6 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a7 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a8 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | green | a1 | 2 | 1 | 1 | src/db | src, src/billing, src/db, src/users | True |
| t011 | dropped | a2 | 3 | 4 | 0 | src/orders | - | False |
| t012 | green | a11 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a11 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a3 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a7 | 0 | 0 | 0 | src/billing | src/billing | True |
| t016 | green | a4 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a0 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a5 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a8 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a1 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a7 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | green | a9 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t023 | green | a6 | 0 | 0 | 0 | src/billing | src/billing, src/lib | True |
| t024 | dropped | a0 | 3 | 3 | 1 | src/db | - | False |
| t025 | green | a1 | 2 | 1 | 1 | src/notifications | src/notifications | True |
| t026 | green | a9 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a11 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a1 | 0 | 0 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a3 | 0 | 0 | 0 | src/cart | src/inventory, src/orders | True |
| t030 | green | a2 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | green | a0 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t032 | dropped | a0 | 3 | 0 | 4 | src/billing | - | False |
| t033 | green | a11 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a5 | 1 | 1 | 0 | src/inventory | src/inventory | True |
| t035 | green | a5 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | dropped | a2 | 3 | 2 | 2 | src/billing | - | False |
| t037 | green | a2 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a1 | 0 | 0 | 0 | src/cart | src/billing | True |
| t039 | green | a3 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t040 | green | a11 | 0 | 0 | 0 | src/db | src/billing | True |
