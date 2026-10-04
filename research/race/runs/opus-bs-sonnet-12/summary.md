# Race: beanstalk / claude

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

**Aborted:** signal SIGTERM

| Metric | Value |
|---|---|
| Changes reaching green per hour | 2.99 |
| Tasks green / landed / dropped / total | 2 / 39 / 2 / 40 |
| Drops by reason | reverted: 1; unresolved conflict: 1 |
| Wall-clock (min) | 40.13 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 1.24 / 1.25 |
| Agent minutes busy / blocked / idle | 36.62 / 0.69 / 444.23 |
| Invocations (initial / rework / fixer / classifier) | 40 / 27 / 12 / 0 |
| Cost USD (total) | 7.6343 |
| Cost USD by kind | fixer 2.4337, initial 2.0444, rework 3.1562 |
| CI runs / minutes | 61 / 62.82 |
| CI runs by purpose | validate 15, bisect 44, bisect-cancelled 2 |
| Textual conflicts met | 28 |
| Red validations | 13 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 2 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6667 / 0.4603 / 0.5188 |
| Footprint vs oracle: P / R / F1 | 0.6667 / 0.4487 / 0.512 |
| Placements disjoint / overlapping | 10 / 30 |
| Fast-trunk landings (task / fixer / revert) | 39 / 8 / 2 |
| Validations (green / red) | 2 / 13 |
| Repair tickets (closed / escalated / by method) | 3 / 4 / {'read-set': 7} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 12,
  "ci_seconds": 60.0,
  "ci_slots": 2,
  "batch": null,
  "seed": 7,
  "budget_usd": 75.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": true,
  "snapshot": "green",
  "queue_hold": null,
  "error_budget": 3,
  "footprint": "predictor",
  "tasks": 40,
  "protect_tests": "own"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t001 | landed | a0 | 0 | 0 | 0 | src/orders | src/billing, src/orders | False |
| t002 | landed | a9 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | False |
| t003 | landed | a1 | 0 | 0 | 0 | src/billing | src, src/billing | False |
| t004 | green | a10 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | landed | a2 | 0 | 0 | 0 | src/lib | src/lib | False |
| t006 | landed | a11 | 0 | 0 | 0 | src/billing | src, src/billing | False |
| t007 | landed | a5 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | False |
| t008 | landed | a3 | 0 | 0 | 0 | src/inventory | src/inventory | False |
| t009 | landed | a10 | 1 | 1 | 0 | src/orders | src, src/orders | False |
| t010 | landed | a4 | 3 | 3 | 0 | src/db | src, src/billing, src/db, src/users | False |
| t011 | landed | a3 | 3 | 3 | 0 | src/orders | src, src/db, src/notifications, src/orders, src/shipping | False |
| t012 | green | a5 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | landed | a6 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | False |
| t014 | landed | a2 | 0 | 0 | 0 | src/auth | src/auth | False |
| t015 | landed | a11 | 1 | 1 | 0 | src/billing | src/billing | False |
| t016 | landed | a8 | 0 | 0 | 0 | src/billing | src/billing | False |
| t017 | landed | a6 | 0 | 0 | 0 | src/orders | src/billing | False |
| t018 | landed | a9 | 0 | 0 | 0 | src/orders | src/notifications | False |
| t019 | landed | a7 | 0 | 0 | 0 | src/cart | src, src/orders | False |
| t020 | landed | a0 | 0 | 0 | 0 | src/auth | src/users | False |
| t021 | landed | a1 | 0 | 0 | 0 | src/db | src/catalog | False |
| t022 | landed | a2 | 3 | 3 | 0 | src/billing | src, src/billing | False |
| t023 | landed | a6 | 1 | 1 | 0 | src/billing | src/billing, src/lib | False |
| t024 | dropped | a5 | 3 | 4 | 0 | src/db | - | False |
| t025 | landed | a8 | 1 | 1 | 0 | src/notifications | src/notifications | False |
| t026 | landed | a9 | 1 | 1 | 0 | src/billing | src/billing | False |
| t027 | landed | a0 | 0 | 0 | 0 | src/db | src/users | False |
| t028 | landed | a1 | 1 | 1 | 0 | src/orders | src, src/shipping | False |
| t029 | landed | a7 | 1 | 1 | 0 | src/cart | src/inventory, src/orders | False |
| t030 | landed | a10 | 0 | 0 | 0 | src/cart | src/orders | False |
| t031 | landed | a11 | 0 | 0 | 0 | src/billing | src, src/billing | False |
| t032 | dropped | a0 | 0 | 0 | 0 | src/billing | src, src/orders | False |
| t033 | landed | a8 | 0 | 0 | 0 | src/shipping | src/shipping | False |
| t034 | landed | a10 | 2 | 2 | 0 | src/inventory | src/inventory | False |
| t035 | landed | a9 | 0 | 0 | 0 | src/cart | src/cart | False |
| t036 | landed | a0 | 3 | 3 | 0 | src/billing | src, src/billing | False |
| t037 | landed | a11 | 0 | 0 | 0 | src/db | src/catalog | False |
| t038 | landed | a6 | 1 | 1 | 0 | src/cart | src/billing | False |
| t039 | landed | a7 | 0 | 0 | 0 | src/billing | src, src/billing | False |
| t040 | landed | a1 | 1 | 1 | 0 | src/db | src/billing | False |
