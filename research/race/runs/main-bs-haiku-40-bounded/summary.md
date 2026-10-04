# Race: beanstalk / claude

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (haiku)_

**Aborted:** wall-clock limit of 60.0 minutes

| Metric | Value |
|---|---|
| Changes reaching green per hour | 35.997 |
| Tasks green / landed / dropped / total | 36 / 39 / 1 / 40 |
| Drops by reason | unresolved conflict: 1 |
| Wall-clock (min) | 60.0 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 2.43 / 4.51 |
| Agent minutes busy / blocked / idle | 123.27 / 1.4 / 355.37 |
| Invocations (initial / rework / fixer / classifier) | 40 / 23 / 13 / 0 |
| Cost USD (total) | 13.8051 |
| Cost USD by kind | fixer 6.0469, initial 2.6151, rework 4.2995 |
| CI runs / minutes | 55 / 57.26 |
| CI runs by purpose | validate 30, bisect 23, bisect-cancelled 2 |
| Textual conflicts met | 24 |
| Red validations | 19 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 36 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 10 |
| Footprint (predictor) vs actual: P / R / F1 | 0.641 / 0.4509 / 0.506 |
| Footprint vs oracle: P / R / F1 | 0.6667 / 0.4509 / 0.5145 |
| Placements disjoint / overlapping | 12 / 28 |
| Fast-trunk landings (task / fixer / revert) | 39 / 13 / 2 |
| Validations (green / red) | 11 / 19 |
| Repair tickets (closed / escalated / by method) | 6 / 7 / {'read-set': 14} |
| Error-budget pauses / paused minutes | 2 / 7.17 |

## Config

```json
{
  "agents": 8,
  "ci_seconds": 60.0,
  "ci_slots": 2,
  "batch": null,
  "seed": 7,
  "budget_usd": 15.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": true,
  "snapshot": "green",
  "queue_hold": null,
  "error_budget": 3,
  "footprint": "predictor",
  "tasks": 40,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t001 | green | a0 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a5 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a1 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t004 | green | a0 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a2 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a2 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a3 | 1 | 1 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a3 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a6 | 1 | 1 | 0 | src/orders | src, src/orders | True |
| t010 | green | a4 | 2 | 2 | 0 | src/db | src, src/billing, src/db, src/orders | True |
| t011 | dropped | a0 | 3 | 4 | 0 | src/orders | - | False |
| t012 | green | a5 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a6 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a5 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a2 | 0 | 0 | 0 | src/billing | src/billing | True |
| t016 | green | a2 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a5 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a4 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a7 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a5 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a6 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | green | a4 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t023 | green | a2 | 2 | 2 | 0 | src/billing | src/billing, src/lib | True |
| t024 | landed | a1 | 3 | 3 | 0 | src/db | src, src/billing, src/db | False |
| t025 | green | a5 | 1 | 1 | 0 | src/notifications | src/notifications | True |
| t026 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a6 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a4 | 0 | 0 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a7 | 2 | 2 | 0 | src/cart | src/orders | True |
| t030 | green | a6 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | green | a3 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t032 | landed | a7 | 1 | 1 | 0 | src/billing | src/orders, src/shipping | False |
| t033 | green | a3 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a4 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t035 | green | a6 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | landed | a4 | 3 | 3 | 0 | src/billing | src, src/billing | False |
| t037 | green | a3 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a5 | 0 | 0 | 0 | src/cart | src/billing | True |
| t039 | green | a6 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t040 | green | a3 | 0 | 0 | 0 | src/db | src/billing | True |
