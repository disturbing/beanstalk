# Race: queue / claude

_forge: cloudflare, run e2im4vksal on https://beanstalk-gateway.devaccounts-1password.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=queue, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 54.3 |
| Tasks green / landed / dropped / total | 35 / 35 / 5 / 40 |
| Drops by reason | ejected (conflict): 1; ejected (red): 4 |
| Wall-clock (min) | 38.67 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 7.08 / 24.47 |
| Agent minutes busy / blocked / idle | 27.13 / 1.93 / 1131.16 |
| Invocations (initial / rework / fixer / classifier) | 40 / 27 / 0 / 0 |
| Cost USD (total) | 4.3248 |
| Cost USD by kind | initial 2.0269, rework 2.2979 |
| CI runs / minutes | 39 / 50.99 |
| CI runs by purpose | batch 19, batch-cancelled 4, bisect 16 |
| Textual conflicts met | 22 |
| Red validations | 11 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 35 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 4 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6286 / 0.4714 / 0.5191 |
| Footprint vs oracle: P / R / F1 | 0.6571 / 0.4714 / 0.5286 |
| Batches (green / red / cancelled) | 8 / 10 / 5 |
| Bisections / bisect CI runs | 8 / 16 |
| Ejections (conflict / red) | 22 / 10 |
| PRs held behind in-flight conflicts | 8 |
| Mean batch size | 2.652 |

## Config

```json
{
  "agents": 30,
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
| t001 | green | a18 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a20 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a1 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t004 | green | a29 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a7 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a1 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a0 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a23 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a17 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | dropped | a1 | 3 | 3 | 1 | src/db | - | False |
| t011 | dropped | a4 | 3 | 3 | 1 | src/orders | - | False |
| t012 | green | a25 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a13 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a22 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a11 | 0 | 0 | 0 | src/billing | src/billing | True |
| t016 | green | a6 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a19 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a2 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a8 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a21 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a4 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | green | a3 | 3 | 2 | 1 | src/billing | src, src/billing | True |
| t023 | green | a0 | 1 | 1 | 0 | src/billing | src/billing, src/lib | True |
| t024 | dropped | a2 | 3 | 3 | 1 | src/db | - | False |
| t025 | green | a1 | 2 | 2 | 0 | src/notifications | src/notifications | True |
| t026 | green | a16 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a27 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a1 | 1 | 1 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a9 | 0 | 0 | 0 | src/cart | src/orders | True |
| t030 | green | a3 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | green | a0 | 1 | 0 | 1 | src/billing | src, src/billing | True |
| t032 | dropped | a0 | 3 | 0 | 4 | src/billing | - | False |
| t033 | green | a2 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a2 | 1 | 1 | 0 | src/inventory | src/inventory | True |
| t035 | green | a4 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | dropped | a0 | 3 | 3 | 1 | src/billing | - | False |
| t037 | green | a7 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a3 | 1 | 1 | 0 | src/cart | src/billing | True |
| t039 | green | a11 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t040 | green | a1 | 1 | 1 | 0 | src/db | src/billing | True |
