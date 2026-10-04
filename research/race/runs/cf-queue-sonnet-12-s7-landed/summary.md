# Race: queue / claude

_forge: cloudflare, run u0ntf65lbe on https://beanstalk-gateway.devaccounts-1password.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=queue, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 53.21 |
| Tasks green / landed / dropped / total | 36 / 36 / 4 / 40 |
| Drops by reason | ejected (conflict): 1; ejected (red): 3 |
| Wall-clock (min) | 40.59 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 10.46 / 25.21 |
| Agent minutes busy / blocked / idle | 25.25 / 0.05 / 461.83 |
| Invocations (initial / rework / fixer / classifier) | 40 / 29 / 0 / 0 |
| Cost USD (total) | 4.1202 |
| Cost USD by kind | initial 2.3958, rework 1.7244 |
| CI runs / minutes | 45 / 56.7 |
| CI runs by purpose | batch 21, batch-cancelled 4, bisect 20 |
| Textual conflicts met | 24 |
| Red validations | 10 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 36 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 2 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6389 / 0.4653 / 0.5157 |
| Footprint vs oracle: P / R / F1 | 0.6667 / 0.4653 / 0.525 |
| Batches (green / red / cancelled) | 11 / 9 / 5 |
| Bisections / bisect CI runs | 9 / 20 |
| Ejections (conflict / red) | 24 / 9 |
| PRs held behind in-flight conflicts | 12 |
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
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t001 | green | a2 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a3 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a11 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | green | a6 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a8 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a0 | 1 | 1 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a9 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a7 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | dropped | a3 | 3 | 3 | 1 | src/db | - | False |
| t011 | green | a0 | 0 | 0 | 0 | src/orders | src, src/db, src/orders, src/shipping | True |
| t012 | green | a1 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a1 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a9 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a1 | 2 | 2 | 0 | src/billing | src/billing | True |
| t016 | green | a5 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a6 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a0 | 1 | 0 | 1 | src/orders | src/notifications | True |
| t019 | green | a3 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a2 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a0 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | green | a1 | 3 | 3 | 0 | src/billing | src, src/billing | True |
| t023 | green | a1 | 1 | 1 | 0 | src/billing | src/billing, src/lib | True |
| t024 | dropped | a1 | 3 | 3 | 1 | src/db | - | False |
| t025 | green | a0 | 3 | 2 | 1 | src/notifications | src/notifications | True |
| t026 | green | a8 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a9 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a4 | 1 | 1 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a0 | 2 | 2 | 0 | src/cart | src/orders | True |
| t030 | green | a1 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | green | a0 | 1 | 0 | 1 | src/billing | src, src/billing | True |
| t032 | dropped | a0 | 3 | 0 | 4 | src/billing | - | False |
| t033 | green | a3 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a5 | 1 | 1 | 0 | src/inventory | src/inventory | True |
| t035 | green | a8 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | dropped | a2 | 3 | 4 | 0 | src/billing | - | False |
| t037 | green | a1 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a6 | 0 | 0 | 0 | src/cart | src/billing | True |
| t039 | green | a4 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t040 | green | a1 | 1 | 1 | 0 | src/db | src/billing | True |
