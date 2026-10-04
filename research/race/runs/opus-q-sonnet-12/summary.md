# Race: queue / claude

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=queue, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 112.992 |
| Tasks green / landed / dropped / total | 38 / 38 / 2 / 40 |
| Drops by reason | ejected (conflict): 2 |
| Wall-clock (min) | 20.18 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 4.12 / 16.8 |
| Agent minutes busy / blocked / idle | 28.27 / 0.59 / 213.28 |
| Invocations (initial / rework / fixer / classifier) | 40 / 32 / 0 / 0 |
| Cost USD (total) | 4.8389 |
| Cost USD by kind | initial 2.1106, rework 2.7283 |
| CI runs / minutes | 29 / 30.08 |
| CI runs by purpose | batch 17, batch-cancelled 2, bisect 10 |
| Textual conflicts met | 29 |
| Red validations | 5 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 37 / 40 |
| Final green correct (suite + every green task's acceptance) | False |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6579 / 0.4548 / 0.5105 |
| Footprint vs oracle: P / R / F1 | 0.6842 / 0.4561 / 0.5211 |
| Batches (green / red / cancelled) | 12 / 5 / 2 |
| Bisections / bisect CI runs | 5 / 10 |
| Ejections (conflict / red) | 29 / 5 |
| PRs held behind in-flight conflicts | 9 |
| Mean batch size | 2.684 |

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
  "protect_tests": "own"
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
| t007 | green | a6 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | False |
| t008 | green | a7 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a8 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | green | a7 | 3 | 3 | 0 | src/db | src, src/billing, src/db, src/users | True |
| t011 | green | a0 | 1 | 1 | 0 | src/orders | src, src/db, src/notifications, src/orders, src/shipping | True |
| t012 | green | a11 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a11 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a3 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a7 | 0 | 0 | 0 | src/billing | src/billing | True |
| t016 | green | a5 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a4 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a8 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a0 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a9 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a1 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | green | a2 | 3 | 3 | 0 | src/billing | src, src/billing | True |
| t023 | green | a4 | 1 | 1 | 0 | src/billing | src/billing, src/lib | True |
| t024 | green | a1 | 3 | 3 | 0 | src/db | src, src/billing, src/db | True |
| t025 | green | a0 | 3 | 2 | 1 | src/notifications | src/notifications | True |
| t026 | green | a2 | 1 | 1 | 0 | src/billing | src/billing | True |
| t027 | green | a11 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a0 | 2 | 2 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a1 | 3 | 3 | 0 | src/cart | src/orders | True |
| t030 | green | a9 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | green | a6 | 2 | 1 | 1 | src/billing | src, src/billing | True |
| t032 | dropped | a0 | 3 | 1 | 3 | src/billing | - | False |
| t033 | green | a0 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a6 | 1 | 1 | 0 | src/inventory | src/inventory | True |
| t035 | green | a9 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | dropped | a0 | 3 | 4 | 0 | src/billing | - | False |
| t037 | green | a10 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a0 | 1 | 1 | 0 | src/cart | src/billing | True |
| t039 | green | a1 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t040 | green | a8 | 1 | 1 | 0 | src/db | src/billing | True |
