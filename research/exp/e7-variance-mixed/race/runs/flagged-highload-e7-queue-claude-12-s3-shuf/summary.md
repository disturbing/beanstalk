# Race: queue / claude

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=queue, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 83.643 |
| Tasks green / landed / dropped / total | 36 / 36 / 4 / 40 |
| Drops by reason | ejected (conflict): 3; ejected (red): 1 |
| Wall-clock (min) | 25.82 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 7.6 / 17.33 |
| Agent minutes busy / blocked / idle | 85.22 / 43.51 / 181.16 |
| Invocations (initial / rework / fixer / classifier) | 40 / 26 / 0 / 0 |
| Cost USD (total) | 4.3816 |
| Cost USD by kind | initial 2.5274, rework 1.8541 |
| CI runs / minutes | 28 / 33.9 |
| CI runs by purpose | batch 17, batch-cancelled 2, bisect 9 |
| Textual conflicts met | 23 |
| Red validations | 7 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 36 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 4 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6389 / 0.45 / 0.5046 |
| Footprint vs oracle: P / R / F1 | 0.6667 / 0.4653 / 0.525 |
| Batches (green / red / cancelled) | 10 / 7 / 2 |
| Bisections / bisect CI runs | 6 / 9 |
| Ejections (conflict / red) | 23 / 7 |
| PRs held behind in-flight conflicts | 8 |
| Mean batch size | 2.947 |

## Config

```json
{
  "agents": 12,
  "ci_seconds": 60.0,
  "ci_slots": 2,
  "batch": 4,
  "seed": 3,
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
| t031 | green | a0 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | green | a1 | 0 | 0 | 0 | src/billing | src/billing | True |
| t034 | green | a2 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t023 | green | a0 | 1 | 1 | 0 | src/billing | src/billing, src/lib | True |
| t010 | green | a2 | 3 | 3 | 0 | src/db | src, src/billing, src/db, src/orders, src/users | True |
| t013 | green | a5 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t028 | green | a6 | 0 | 0 | 0 | src/orders | src, src/shipping | True |
| t037 | green | a7 | 0 | 0 | 0 | src/db | src/catalog | True |
| t040 | green | a8 | 0 | 0 | 0 | src/db | src/billing | True |
| t039 | green | a9 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t026 | green | a10 | 0 | 0 | 0 | src/billing | src/billing | True |
| t038 | green | a11 | 0 | 0 | 0 | src/cart | src/billing | True |
| t003 | green | a1 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t035 | green | a2 | 0 | 0 | 0 | src/cart | src/cart | True |
| t009 | green | a7 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t015 | green | a0 | 2 | 2 | 0 | src/billing | src/billing | True |
| t007 | green | a8 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t020 | green | a11 | 0 | 0 | 0 | src/auth | src/users | True |
| t032 | dropped | a2 | 3 | 1 | 3 | src/billing | - | False |
| t030 | green | a3 | 0 | 0 | 0 | src/cart | src/orders | True |
| t001 | green | a8 | 1 | 1 | 0 | src/orders | src/billing | True |
| t016 | green | a9 | 0 | 0 | 0 | src/billing | src/billing | True |
| t006 | green | a9 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t011 | dropped | a1 | 3 | 4 | 0 | src/orders | - | False |
| t024 | dropped | a0 | 3 | 4 | 0 | src/db | - | False |
| t036 | dropped | a0 | 3 | 2 | 2 | src/billing | - | False |
| t029 | green | a0 | 1 | 1 | 0 | src/cart | src/orders | True |
| t014 | green | a6 | 0 | 0 | 0 | src/auth | src/auth | True |
| t019 | green | a7 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t033 | green | a8 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t022 | green | a0 | 2 | 1 | 1 | src/billing | src, src/billing | True |
| t021 | green | a11 | 0 | 0 | 0 | src/db | src/catalog | True |
| t005 | green | a1 | 2 | 1 | 1 | src/lib | src/billing, src/lib | True |
| t012 | green | a1 | 0 | 0 | 0 | src/auth | src/auth | True |
| t018 | green | a4 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t025 | green | a0 | 1 | 1 | 0 | src/notifications | src/notifications | True |
| t008 | green | a11 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t027 | green | a7 | 0 | 0 | 0 | src/db | src/users | True |
| t002 | green | a3 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t017 | green | a2 | 0 | 0 | 0 | src/orders | src/billing | True |
