# Race: queue / replay

_forge: cloudflare, run l8lw0lwpj5 on https://beanstalk-gateway.devaccounts-1password.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=queue, agent=replay (replay control: reference patches, synthetic timings)_

**Aborted:** fork failed: artifacts open race-l8lw0lwpj5-t005 failed (NOT_FOUND)

| Metric | Value |
|---|---|
| Changes reaching green per hour | 0 |
| Tasks green / landed / dropped / total | 0 / 0 / 0 / 40 |
| Drops by reason | none |
| Wall-clock (min) | 0.14 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | - / - |
| Agent minutes busy / blocked / idle | 0.2 / 0.77 / 0.16 |
| Invocations (initial / rework / fixer / classifier) | 0 / 0 / 0 / 0 |
| Cost USD (total) | 0 |
| Cost USD by kind | - |
| CI runs / minutes | 0 / 0 |
| CI runs by purpose | - |
| Textual conflicts met | 0 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 0 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | - / - / - |
| Footprint vs oracle: P / R / F1 | - / - / - |
| Batches (green / red / cancelled) | 0 / 0 / 0 |
| Bisections / bisect CI runs | 0 / 0 |
| Ejections (conflict / red) | 0 / 0 |
| PRs held behind in-flight conflicts | 0 |
| Mean batch size | None |

## Config

```json
{
  "agents": 8,
  "ci_seconds": 4.5,
  "ci_slots": 2,
  "batch": 4,
  "seed": 7,
  "budget_usd": 25,
  "max_turns": 40,
  "agent_timeout": 900,
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
| t001 | running | a7 | 0 | 0 | 0 | src/orders | - | False |
| t002 | running | a3 | 0 | 0 | 0 | src/orders | - | False |
| t003 | running | a0 | 0 | 0 | 0 | src/billing | - | False |
| t004 | running | a4 | 0 | 0 | 0 | src/billing | - | False |
| t005 | running | a6 | 0 | 0 | 0 | src/lib | - | False |
| t006 | running | a5 | 0 | 0 | 0 | src/billing | - | False |
| t007 | running | a2 | 0 | 0 | 0 | src/orders | - | False |
| t008 | running | a1 | 0 | 0 | 0 | src/inventory | - | False |
| t009 | pending | - | 0 | 0 | 0 | src/orders | - | False |
| t010 | pending | - | 0 | 0 | 0 | src/db | - | False |
| t011 | pending | - | 0 | 0 | 0 | src/orders | - | False |
| t012 | pending | - | 0 | 0 | 0 | src/auth | - | False |
| t013 | pending | - | 0 | 0 | 0 | src/notifications | - | False |
| t014 | pending | - | 0 | 0 | 0 | src/auth | - | False |
| t015 | pending | - | 0 | 0 | 0 | src/billing | - | False |
| t016 | pending | - | 0 | 0 | 0 | src/billing | - | False |
| t017 | pending | - | 0 | 0 | 0 | src/orders | - | False |
| t018 | pending | - | 0 | 0 | 0 | src/orders | - | False |
| t019 | pending | - | 0 | 0 | 0 | src/cart | - | False |
| t020 | pending | - | 0 | 0 | 0 | src/auth | - | False |
| t021 | pending | - | 0 | 0 | 0 | src/db | - | False |
| t022 | pending | - | 0 | 0 | 0 | src/billing | - | False |
| t023 | pending | - | 0 | 0 | 0 | src/billing | - | False |
| t024 | pending | - | 0 | 0 | 0 | src/db | - | False |
| t025 | pending | - | 0 | 0 | 0 | src/notifications | - | False |
| t026 | pending | - | 0 | 0 | 0 | src/billing | - | False |
| t027 | pending | - | 0 | 0 | 0 | src/db | - | False |
| t028 | pending | - | 0 | 0 | 0 | src/orders | - | False |
| t029 | pending | - | 0 | 0 | 0 | src/cart | - | False |
| t030 | pending | - | 0 | 0 | 0 | src/cart | - | False |
| t031 | pending | - | 0 | 0 | 0 | src/billing | - | False |
| t032 | pending | - | 0 | 0 | 0 | src/billing | - | False |
| t033 | pending | - | 0 | 0 | 0 | src/shipping | - | False |
| t034 | pending | - | 0 | 0 | 0 | src/inventory | - | False |
| t035 | pending | - | 0 | 0 | 0 | src/cart | - | False |
| t036 | pending | - | 0 | 0 | 0 | src/billing | - | False |
| t037 | pending | - | 0 | 0 | 0 | src/db | - | False |
| t038 | pending | - | 0 | 0 | 0 | src/cart | - | False |
| t039 | pending | - | 0 | 0 | 0 | src/billing | - | False |
| t040 | pending | - | 0 | 0 | 0 | src/db | - | False |
