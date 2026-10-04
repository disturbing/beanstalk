# Race: queue / claude

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=queue, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 77.227 |
| Tasks green / landed / dropped / total | 36 / 36 / 4 / 40 |
| Drops by reason | ejected (conflict): 3; ejected (red): 1 |
| Wall-clock (min) | 27.97 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 6.1 / 18.97 |
| Agent minutes busy / blocked / idle | 26.6 / 1.09 / 307.95 |
| Invocations (initial / rework / fixer / classifier) | 40 / 28 / 0 / 0 |
| Cost USD (total) | 4.8657 |
| Cost USD by kind | initial 2.0798, rework 2.7859 |
| CI runs / minutes | 40 / 40.51 |
| CI runs by purpose | batch 21, batch-cancelled 4, bisect 15 |
| Textual conflicts met | 22 |
| Red validations | 10 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 36 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 5 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6389 / 0.4514 / 0.5065 |
| Footprint vs oracle: P / R / F1 | 0.6667 / 0.4676 / 0.5278 |
| Batches (green / red / cancelled) | 11 / 10 / 4 |
| Bisections / bisect CI runs | 8 / 15 |
| Ejections (conflict / red) | 22 / 10 |
| PRs held behind in-flight conflicts | 12 |
| Mean batch size | 2.72 |

## Config

```json
{
  "agents": 12,
  "ci_seconds": 60.0,
  "ci_slots": 2,
  "batch": 4,
  "seed": 5,
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
| t015 | green | a0 | 0 | 0 | 0 | src/billing | src/billing | True |
| t013 | green | a1 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t034 | green | a2 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t001 | green | a3 | 0 | 0 | 0 | src/orders | src/billing | True |
| t028 | green | a4 | 0 | 0 | 0 | src/orders | src, src/shipping | True |
| t023 | green | a5 | 0 | 0 | 0 | src/billing | src/billing, src/lib | True |
| t002 | green | a6 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t033 | green | a7 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t035 | green | a8 | 0 | 0 | 0 | src/cart | src/cart | True |
| t030 | green | a9 | 0 | 0 | 0 | src/cart | src/orders | True |
| t014 | green | a10 | 0 | 0 | 0 | src/auth | src/auth | True |
| t039 | green | a11 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t012 | green | a2 | 0 | 0 | 0 | src/auth | src/auth | True |
| t029 | green | a2 | 1 | 1 | 0 | src/cart | src/orders | True |
| t022 | green | a0 | 2 | 2 | 0 | src/billing | src, src/billing | True |
| t031 | green | a3 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t020 | green | a10 | 0 | 0 | 0 | src/auth | src/users | True |
| t019 | green | a8 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t016 | green | a4 | 0 | 0 | 0 | src/billing | src/billing | True |
| t036 | dropped | a0 | 3 | 3 | 1 | src/billing | - | False |
| t032 | dropped | a0 | 3 | 0 | 4 | src/billing | - | False |
| t018 | green | a5 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t040 | green | a0 | 1 | 1 | 0 | src/db | src/billing | True |
| t009 | green | a1 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t007 | green | a11 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t038 | green | a0 | 1 | 1 | 0 | src/cart | src/billing | True |
| t017 | green | a5 | 0 | 0 | 0 | src/orders | src/billing | True |
| t011 | dropped | a0 | 3 | 3 | 1 | src/orders | - | False |
| t026 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t021 | green | a10 | 0 | 0 | 0 | src/db | src/catalog | True |
| t004 | green | a2 | 1 | 1 | 0 | src/billing | src/billing | True |
| t010 | dropped | a0 | 3 | 3 | 1 | src/db | - | False |
| t037 | green | a5 | 0 | 0 | 0 | src/db | src/catalog | True |
| t003 | green | a0 | 2 | 2 | 0 | src/billing | src, src/billing | True |
| t027 | green | a8 | 0 | 0 | 0 | src/db | src/users | True |
| t025 | green | a0 | 2 | 1 | 1 | src/notifications | src/notifications | True |
| t024 | green | a0 | 3 | 2 | 1 | src/db | src, src/billing, src/db, src/lib | True |
| t008 | green | a2 | 1 | 1 | 0 | src/inventory | src/inventory | True |
| t005 | green | a0 | 1 | 0 | 1 | src/lib | src/billing, src/lib | True |
| t006 | green | a4 | 1 | 1 | 0 | src/billing | src, src/billing | True |
