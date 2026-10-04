# Race: queue / mixed

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=queue, agent=mixed (sonnet+codex-default)_

**Aborted:** signal SIGTERM

| Metric | Value |
|---|---|
| Changes reaching green per hour | 83.341 |
| Tasks green / landed / dropped / total | 31 / 31 / 4 / 40 |
| Drops by reason | conflict markers left: 4 |
| Wall-clock (min) | 22.32 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 7.26 / 19.33 |
| Agent minutes busy / blocked / idle | 37.28 / 1.54 / 229.0 |
| Invocations (initial / rework / fixer / classifier) | 40 / 28 / 0 / 0 |
| Cost USD (total) | 3.1893 |
| Cost USD by kind | initial 1.9816, rework 1.2078 |
| CI runs / minutes | 38 / 37.96 |
| CI runs by purpose | batch 16, batch-cancelled 7, bisect 15 |
| Textual conflicts met | 18 |
| Red validations | 7 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 32 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 2 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6452 / 0.4597 / 0.5129 |
| Footprint vs oracle: P / R / F1 | 0.6452 / 0.4435 / 0.5022 |
| Batches (green / red / cancelled) | 9 / 7 / 6 |
| Bisections / bisect CI runs | 7 / 15 |
| Ejections (conflict / red) | 18 / 7 |
| PRs held behind in-flight conflicts | 11 |
| Mean batch size | 3.087 |

## Config

```json
{
  "agents": 12,
  "ci_seconds": 60.0,
  "ci_slots": 2,
  "batch": 4,
  "seed": 7,
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
| t001 | green | a0 | 0 | 0 | 0 | src/orders | src/billing, src/orders | True |
| t002 | green | a1 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a2 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a4 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a0 | 1 | 1 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a7 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a8 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | dropped | a2 | 3 | 3 | 0 | src/db | - | False |
| t011 | green | a10 | 0 | 0 | 0 | src/orders | src, src/db, src/orders, src/shipping | True |
| t012 | green | a11 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a4 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a8 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | testing | a0 | 2 | 2 | 0 | src/billing | - | False |
| t016 | green | a10 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a6 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a0 | 1 | 0 | 1 | src/orders | src/notifications | True |
| t019 | green | a7 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a11 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a3 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | dropped | a1 | 3 | 1 | 1 | src/billing | - | False |
| t023 | green | a3 | 1 | 1 | 0 | src/billing | src/billing, src/lib | True |
| t024 | dropped | a2 | 3 | 2 | 0 | src/db | - | False |
| t025 | testing | a3 | 3 | 2 | 1 | src/notifications | - | False |
| t026 | green | a9 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a6 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a4 | 1 | 1 | 0 | src/orders | src, src/shipping | True |
| t029 | dropped | a0 | 3 | 1 | 1 | src/cart | - | True |
| t030 | green | a10 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | testing | a1 | 2 | 1 | 1 | src/billing | - | False |
| t032 | testing | a0 | 1 | 0 | 1 | src/billing | - | False |
| t033 | green | a10 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a0 | 1 | 1 | 0 | src/inventory | src/inventory | True |
| t035 | green | a11 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | queued | a0 | 2 | 1 | 1 | src/billing | - | False |
| t037 | green | a3 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a7 | 0 | 0 | 0 | src/cart | src/billing | True |
| t039 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t040 | green | a2 | 1 | 1 | 0 | src/db | src/billing | True |
