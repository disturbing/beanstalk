# Race: queue / claude

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=queue, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 84.349 |
| Tasks green / landed / dropped / total | 36 / 36 / 4 / 40 |
| Drops by reason | ejected (conflict): 2; ejected (red): 2 |
| Wall-clock (min) | 25.61 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 7.07 / 18.33 |
| Agent minutes busy / blocked / idle | 21.16 / 0.38 / 490.62 |
| Invocations (initial / rework / fixer / classifier) | 40 / 28 / 0 / 0 |
| Cost USD (total) | 4.2836 |
| Cost USD by kind | initial 2.5253, rework 1.7583 |
| CI runs / minutes | 41 / 40.22 |
| CI runs by purpose | batch 22, bisect 15, batch-cancelled 4 |
| Textual conflicts met | 22 |
| Red validations | 10 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 36 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 2 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6667 / 0.4792 / 0.5343 |
| Footprint vs oracle: P / R / F1 | 0.6667 / 0.4653 / 0.525 |
| Batches (green / red / cancelled) | 12 / 10 / 4 |
| Bisections / bisect CI runs | 7 / 15 |
| Ejections (conflict / red) | 22 / 10 |
| PRs held behind in-flight conflicts | 14 |
| Mean batch size | 2.5 |

## Config

```json
{
  "agents": 20,
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
| t001 | green | a0 | 1 | 1 | 0 | src/orders | src/billing, src/orders | True |
| t002 | green | a1 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a1 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t004 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a4 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a6 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a7 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a8 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | green | a1 | 3 | 3 | 0 | src/db | src, src/billing, src/db, src/users | True |
| t011 | dropped | a2 | 3 | 3 | 1 | src/orders | - | False |
| t012 | green | a11 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a12 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a13 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a14 | 0 | 0 | 0 | src/billing | src/billing | True |
| t016 | green | a15 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a16 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a17 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a18 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a19 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a16 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | green | a3 | 3 | 2 | 1 | src/billing | src, src/billing | True |
| t023 | green | a2 | 1 | 1 | 0 | src/billing | src/billing, src/lib | True |
| t024 | dropped | a0 | 3 | 3 | 1 | src/db | - | False |
| t025 | green | a0 | 2 | 1 | 1 | src/notifications | src/notifications | True |
| t026 | green | a14 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a17 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a5 | 1 | 1 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a5 | 0 | 0 | 0 | src/cart | src/orders | True |
| t030 | green | a13 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | green | a0 | 1 | 0 | 1 | src/billing | src, src/billing | True |
| t032 | dropped | a0 | 3 | 0 | 4 | src/billing | - | False |
| t033 | green | a9 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a3 | 1 | 1 | 0 | src/inventory | src/inventory | True |
| t035 | green | a12 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | dropped | a0 | 3 | 3 | 1 | src/billing | - | False |
| t037 | green | a17 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a4 | 1 | 1 | 0 | src/cart | src/billing | True |
| t039 | green | a10 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t040 | green | a2 | 1 | 1 | 0 | src/db | src/billing | True |
