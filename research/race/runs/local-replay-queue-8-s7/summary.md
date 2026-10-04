# Race: queue / replay

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=queue, agent=replay (replay control: reference patches, synthetic timings)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 412.322 |
| Tasks green / landed / dropped / total | 25 / 25 / 15 / 40 |
| Drops by reason | replay could not resolve the conflict or red (limitation of replay agents): 15 |
| Wall-clock (min) | 3.64 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 0.52 / 0.88 |
| Agent minutes busy / blocked / idle | 17.54 / 8.43 / 3.13 |
| Invocations (initial / rework / fixer / classifier) | 40 / 16 / 0 / 0 |
| Cost USD (total) | 0.0 |
| Cost USD by kind | initial 0.0000, rework 0.0000 |
| CI runs / minutes | 46 / 4.21 |
| CI runs by purpose | batch 28, batch-cancelled 8, bisect 10 |
| Textual conflicts met | 5 |
| Red validations | 11 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 25 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.68 / 0.48 / 0.54 |
| Footprint vs oracle: P / R / F1 | 0.68 / 0.48 / 0.54 |
| Batches (green / red / cancelled) | 17 / 11 / 8 |
| Bisections / bisect CI runs | 6 / 10 |
| Ejections (conflict / red) | 5 / 11 |
| PRs held behind in-flight conflicts | 1 |
| Mean batch size | 1.389 |

## Config

```json
{
  "agents": 8,
  "ci_seconds": 4.5,
  "ci_slots": 2,
  "batch": 4,
  "seed": 7,
  "budget_usd": 25.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": false,
  "snapshot": null,
  "queue_hold": true,
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
| t002 | green | a1 | 1 | 1 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a2 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a4 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a6 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a7 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a4 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | dropped | a5 | 1 | 1 | 0 | src/db | - | False |
| t011 | dropped | a0 | 1 | 1 | 0 | src/orders | - | False |
| t012 | green | a2 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a6 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a3 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | dropped | a1 | 1 | 0 | 1 | src/billing | - | False |
| t016 | green | a4 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | dropped | a5 | 1 | 0 | 1 | src/orders | - | False |
| t018 | green | a6 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a2 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a7 | 0 | 0 | 0 | src/auth | src/auth, src/users | True |
| t021 | green | a2 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | dropped | a4 | 1 | 0 | 1 | src/billing | - | False |
| t023 | dropped | a0 | 1 | 0 | 1 | src/billing | - | False |
| t024 | dropped | a1 | 1 | 0 | 1 | src/db | - | False |
| t025 | dropped | a3 | 1 | 0 | 1 | src/notifications | - | False |
| t026 | green | a6 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | dropped | a7 | 1 | 0 | 1 | src/db | - | False |
| t028 | green | a5 | 0 | 0 | 0 | src/orders | src, src/shipping | True |
| t029 | dropped | a4 | 1 | 0 | 1 | src/cart | - | False |
| t030 | green | a3 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | dropped | a1 | 1 | 1 | 0 | src/billing | - | False |
| t032 | dropped | a2 | 1 | 0 | 1 | src/billing | - | False |
| t033 | green | a6 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | dropped | a7 | 1 | 0 | 1 | src/inventory | - | False |
| t035 | green | a0 | 0 | 0 | 0 | src/cart | src/cart, src/inventory | True |
| t036 | green | a3 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t037 | green | a5 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a6 | 0 | 0 | 0 | src/cart | src/billing | True |
| t039 | dropped | a4 | 1 | 1 | 0 | src/billing | - | False |
| t040 | dropped | a1 | 1 | 0 | 1 | src/db | - | False |
