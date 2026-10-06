# Race: queue / claude

_forge: cloudflare, run p9bg5bxu7m on https://beanstalk-gateway.devaccounts-1password.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=queue, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 45.618 |
| Tasks green / landed / dropped / total | 34 / 34 / 6 / 40 |
| Drops by reason | ejected (conflict): 3; ejected (red): 3 |
| Wall-clock (min) | 44.72 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 5.93 / 23.24 |
| Agent minutes busy / blocked / idle | 34.03 / 0.7 / 1306.86 |
| Invocations (initial / rework / fixer / classifier) | 40 / 31 / 0 / 0 |
| Cost USD (total) | 4.4077 |
| Cost USD by kind | initial 1.9389, rework 2.4688 |
| CI runs / minutes | 45 / 57.75 |
| CI runs by purpose | batch 20, bisect 21, batch-cancelled 4 |
| Textual conflicts met | 24 |
| Red validations | 13 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 34 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 2 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6176 / 0.451 / 0.5 |
| Footprint vs oracle: P / R / F1 | 0.6471 / 0.451 / 0.5098 |
| Batches (green / red / cancelled) | 7 / 13 / 4 |
| Bisections / bisect CI runs | 11 / 21 |
| Ejections (conflict / red) | 24 / 13 |
| PRs held behind in-flight conflicts | 14 |
| Mean batch size | 2.625 |

## Config

```json
{
  "agents": 30,
  "ci_seconds": 60,
  "ci_slots": 2,
  "batch": 4,
  "seed": 13,
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
| t001 | green | a8 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a24 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a0 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t004 | green | a0 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a28 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a0 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t007 | green | a3 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a25 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a23 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | dropped | a0 | 3 | 3 | 1 | src/db | - | False |
| t011 | dropped | a0 | 3 | 3 | 1 | src/orders | - | False |
| t012 | green | a15 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a7 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a1 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a9 | 0 | 0 | 0 | src/billing | src/billing | True |
| t016 | green | a12 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a13 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a20 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a5 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a6 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a14 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | dropped | a1 | 3 | 3 | 1 | src/billing | - | False |
| t023 | dropped | a0 | 3 | 1 | 3 | src/billing | - | False |
| t024 | green | a23 | 3 | 3 | 0 | src/db | src, src/billing, src/db | True |
| t025 | dropped | a17 | 3 | 2 | 2 | src/notifications | - | False |
| t026 | green | a16 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a2 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a18 | 0 | 0 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a3 | 1 | 1 | 0 | src/cart | src/inventory, src/orders | True |
| t030 | green | a17 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | green | a3 | 2 | 1 | 1 | src/billing | src, src/billing | True |
| t032 | dropped | a0 | 3 | 0 | 4 | src/billing | - | False |
| t033 | green | a6 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a1 | 2 | 2 | 0 | src/inventory | src/inventory | True |
| t035 | green | a17 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | green | a13 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t037 | green | a1 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a2 | 1 | 1 | 0 | src/cart | src/billing | True |
| t039 | green | a0 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t040 | green | a1 | 1 | 1 | 0 | src/db | src/billing | True |
