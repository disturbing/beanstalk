# Race: beanstalk / claude

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 164.826 |
| Tasks green / landed / dropped / total | 34 / 35 / 6 / 40 |
| Drops by reason | declined by decision D001: 1; pre-land check still red: 3; reverted: 1; unresolved conflict: 1 |
| Wall-clock (min) | 12.38 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 3.23 / 5.42 |
| Agent minutes busy / blocked / idle | 22.12 / 89.06 / 37.34 |
| Invocations (initial / rework / fixer / classifier) | 40 / 19 / 0 / 0 |
| Cost USD (total) | 3.9906 |
| Cost USD by kind | initial 2.6659, rework 1.3248 |
| CI runs / minutes | 18 / 18.37 |
| CI runs by purpose | validate 18 |
| Textual conflicts met | 10 |
| Red validations | 3 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 34 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 4 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6 / 0.4238 / 0.4762 |
| Footprint vs oracle: P / R / F1 | 0.6286 / 0.4238 / 0.4857 |
| Variant | v2: pre-land check, informed author repair, decision cards, revert-first |
| Informed reworks / decision cards / revert-first tickets | 9 / 1 / 1 |
| Pre-land checks (red) / reworks / drops | 82 (13) / 9 / 3 |
| Pre-land check minutes | 84.05 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 32 / 23 / 2 |
| Placements disjoint / overlapping | 40 / 0 |
| Fast-trunk landings (task / fixer / revert) | 35 / 0 / 1 |
| Validations (green / red) | 15 / 3 |
| Repair tickets (closed / escalated / by method) | 0 / 1 / {'read-set': 1} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 12,
  "ci_seconds": 60.0,
  "ci_slots": 2,
  "batch": null,
  "seed": 3,
  "budget_usd": 15.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": true,
  "snapshot": "head",
  "queue_hold": null,
  "error_budget": 999,
  "footprint": "predictor",
  "tasks": 40,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t031 | green | a0 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | green | a1 | 0 | 0 | 0 | src/billing | src/billing | True |
| t034 | green | a2 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t023 | green | a3 | 1 | 1 | 0 | src/billing | src/billing, src/lib | True |
| t010 | dropped | a4 | 3 | 3 | 0 | src/db | - | False |
| t013 | green | a5 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t028 | green | a6 | 0 | 0 | 0 | src/orders | src, src/shipping | True |
| t037 | green | a7 | 0 | 0 | 0 | src/db | src/catalog | True |
| t040 | green | a8 | 0 | 0 | 0 | src/db | src/billing | True |
| t039 | green | a9 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t026 | green | a10 | 0 | 0 | 0 | src/billing | src/billing | True |
| t038 | green | a11 | 0 | 0 | 0 | src/cart | src/billing | True |
| t003 | green | a11 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t035 | green | a2 | 0 | 0 | 0 | src/cart | src/cart | True |
| t009 | green | a1 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t015 | green | a7 | 0 | 0 | 0 | src/billing | src/billing | True |
| t007 | green | a8 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t020 | green | a0 | 0 | 0 | 0 | src/auth | src/users | True |
| t032 | green | a6 | 0 | 0 | 0 | src/billing | src, src/orders, src/shipping | True |
| t030 | green | a10 | 0 | 0 | 0 | src/cart | src/orders | True |
| t001 | green | a5 | 0 | 0 | 0 | src/orders | src/billing | True |
| t016 | green | a2 | 0 | 0 | 0 | src/billing | src/billing | True |
| t006 | green | a1 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t011 | dropped | a0 | 3 | 2 | 0 | src/orders | - | False |
| t024 | green | a3 | 1 | 1 | 0 | src/db | src, src/billing, src/db | True |
| t036 | dropped | a9 | 3 | 0 | 0 | src/billing | - | False |
| t029 | green | a6 | 0 | 0 | 0 | src/cart | src/orders | True |
| t014 | green | a1 | 0 | 0 | 0 | src/auth | src/auth | True |
| t019 | green | a7 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t033 | dropped | a8 | 2 | 0 | 0 | src/shipping | - | False |
| t022 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t021 | green | a1 | 0 | 0 | 0 | src/db | src/catalog | True |
| t005 | dropped | a10 | 3 | 0 | 0 | src/lib | - | False |
| t012 | green | a2 | 0 | 0 | 0 | src/auth | src/auth | True |
| t018 | green | a1 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t025 | green | a11 | 1 | 1 | 0 | src/notifications | src/notifications | True |
| t008 | green | a7 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t027 | green | a4 | 0 | 0 | 0 | src/db | src/users | True |
| t002 | dropped | a6 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | False |
| t017 | green | a2 | 0 | 0 | 0 | src/orders | src/billing | True |
