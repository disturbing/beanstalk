# Race: queue / claude

_forge: cloudflare, run 848zhf9mmx on https://beanstalk-gateway.devaccounts-1password.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=queue, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 60.086 |
| Tasks green / landed / dropped / total | 37 / 37 / 3 / 40 |
| Drops by reason | ejected (conflict): 2; ejected (red): 1 |
| Wall-clock (min) | 36.95 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 10.43 / 28.18 |
| Agent minutes busy / blocked / idle | 28.52 / 0.5 / 414.34 |
| Invocations (initial / rework / fixer / classifier) | 40 / 29 / 0 / 0 |
| Cost USD (total) | 4.02 |
| Cost USD by kind | initial 2.3956, rework 1.6244 |
| CI runs / minutes | 43 / 51.37 |
| CI runs by purpose | batch 20, batch-cancelled 5, bisect 18 |
| Textual conflicts met | 24 |
| Red validations | 8 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 36 / 40 |
| Final green correct (suite + every green task's acceptance) | False |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6486 / 0.4595 / 0.5126 |
| Footprint vs oracle: P / R / F1 | 0.6757 / 0.4595 / 0.5216 |
| Batches (green / red / cancelled) | 12 / 8 / 5 |
| Bisections / bisect CI runs | 8 / 18 |
| Ejections (conflict / red) | 24 / 8 |
| PRs held behind in-flight conflicts | 14 |
| Mean batch size | 2.8 |

## Config

```json
{
  "agents": 12,
  "ci_seconds": 60,
  "ci_slots": 2,
  "batch": 4,
  "seed": 7,
  "budget_usd": 75,
  "max_turns": 40,
  "agent_timeout": 900,
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
| t001 | green | a6 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a7 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a0 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | green | a2 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a8 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a10 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a0 | 1 | 1 | 0 | src/orders | src, src/db, src/orders | False |
| t008 | green | a3 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a1 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | green | a2 | 3 | 3 | 0 | src/db | src, src/billing, src/db, src/users | True |
| t011 | green | a11 | 0 | 0 | 0 | src/orders | src, src/db, src/orders, src/shipping | True |
| t012 | green | a4 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a4 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a2 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a0 | 2 | 2 | 0 | src/billing | src/billing | True |
| t016 | green | a6 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a8 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a0 | 1 | 0 | 1 | src/orders | src/notifications | True |
| t019 | green | a1 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a5 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a7 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | green | a0 | 3 | 2 | 1 | src/billing | src, src/billing | True |
| t023 | green | a2 | 1 | 1 | 0 | src/billing | src/billing, src/lib | True |
| t024 | dropped | a1 | 3 | 4 | 0 | src/db | - | False |
| t025 | green | a0 | 3 | 2 | 1 | src/notifications | src/notifications | True |
| t026 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a4 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a1 | 1 | 1 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a0 | 2 | 2 | 0 | src/cart | src/orders | True |
| t030 | green | a2 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | green | a0 | 1 | 0 | 1 | src/billing | src, src/billing | True |
| t032 | dropped | a0 | 3 | 0 | 4 | src/billing | - | False |
| t033 | green | a3 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a1 | 1 | 1 | 0 | src/inventory | src/inventory | True |
| t035 | green | a1 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | dropped | a2 | 3 | 4 | 0 | src/billing | - | False |
| t037 | green | a2 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a8 | 0 | 0 | 0 | src/cart | src/billing | True |
| t039 | green | a11 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t040 | green | a3 | 1 | 1 | 0 | src/db | src/billing | True |
