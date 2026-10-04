# Race: beanstalk / claude

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 145.357 |
| Tasks green / landed / dropped / total | 34 / 35 / 6 / 40 |
| Drops by reason | declined by decision D001: 1; pre-land check still red: 2; reverted: 1; unresolved conflict: 2 |
| Wall-clock (min) | 14.03 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 3.42 / 6.47 |
| Agent minutes busy / blocked / idle | 26.07 / 102.7 / 39.64 |
| Invocations (initial / rework / fixer / classifier) | 40 / 36 / 0 / 0 |
| Cost USD (total) | 5.6229 |
| Cost USD by kind | initial 2.7108, rework 2.9122 |
| CI runs / minutes | 19 / 19.24 |
| CI runs by purpose | validate 19 |
| Textual conflicts met | 16 |
| Red validations | 2 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 35 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 1 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6857 / 0.4881 / 0.5448 |
| Footprint vs oracle: P / R / F1 | 0.6857 / 0.4738 / 0.5352 |
| Variant | v2: pre-land check, informed author repair, decision cards, revert-first |
| Informed reworks / decision cards / revert-first tickets | 20 / 1 / 1 |
| Pre-land checks (red) / reworks / drops | 94 (23) / 20 / 2 |
| Pre-land check minutes | 95.36 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 29 / 25 / 2 |
| Placements disjoint / overlapping | 40 / 0 |
| Fast-trunk landings (task / fixer / revert) | 35 / 0 / 1 |
| Validations (green / red) | 17 / 2 |
| Repair tickets (closed / escalated / by method) | 0 / 1 / {'read-set': 1} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 12,
  "ci_seconds": 60.0,
  "ci_slots": 2,
  "batch": null,
  "seed": 11,
  "budget_usd": 75.0,
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
| t001 | green | a0 | 0 | 0 | 0 | src/orders | src/billing, src/orders | True |
| t002 | green | a1 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | dropped | a2 | 3 | 2 | 0 | src/billing | - | False |
| t004 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a4 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a6 | 3 | 3 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a7 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a8 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | dropped | a9 | 3 | 3 | 0 | src/db | - | False |
| t011 | dropped | a10 | 0 | 0 | 0 | src/orders | src, src/db, src/orders, src/shipping | False |
| t012 | green | a11 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a11 | 3 | 1 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a7 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t016 | green | a4 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a8 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a1 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a0 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a8 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a7 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | green | a3 | 2 | 0 | 0 | src/billing | src, src/billing | True |
| t023 | green | a1 | 2 | 0 | 0 | src/billing | src/billing, src/lib | True |
| t024 | green | a5 | 2 | 2 | 0 | src/db | src, src/billing, src/db | True |
| t025 | green | a10 | 2 | 0 | 0 | src/notifications | src/notifications | True |
| t026 | green | a4 | 2 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a8 | 2 | 1 | 0 | src/db | src/users | True |
| t028 | green | a7 | 2 | 1 | 0 | src/orders | src, src/shipping | True |
| t029 | dropped | a0 | 3 | 2 | 0 | src/cart | - | True |
| t030 | green | a5 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | green | a2 | 2 | 1 | 0 | src/billing | src, src/billing | True |
| t032 | dropped | a8 | 2 | 0 | 0 | src/billing | - | False |
| t033 | green | a9 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a5 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t035 | green | a3 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | dropped | a1 | 3 | 0 | 0 | src/billing | - | False |
| t037 | green | a10 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a4 | 0 | 0 | 0 | src/cart | src/billing | True |
| t039 | green | a7 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t040 | green | a5 | 0 | 0 | 0 | src/db | src/billing | True |
