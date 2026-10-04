# Race: beanstalk / claude

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 154.519 |
| Tasks green / landed / dropped / total | 37 / 37 / 3 / 40 |
| Drops by reason | pre-land check still red: 2; unresolved conflict: 1 |
| Wall-clock (min) | 14.37 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 4.85 / 6.67 |
| Agent minutes busy / blocked / idle | 29.07 / 98.65 / 44.69 |
| Invocations (initial / rework / fixer / classifier) | 40 / 29 / 0 / 0 |
| Cost USD (total) | 5.5993 |
| Cost USD by kind | initial 2.1736, rework 3.4257 |
| CI runs / minutes | 22 / 23.39 |
| CI runs by purpose | validate 18, bisect 4 |
| Textual conflicts met | 15 |
| Red validations | 2 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 37 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 1 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6486 / 0.4437 / 0.5009 |
| Footprint vs oracle: P / R / F1 | 0.6757 / 0.4617 / 0.5243 |
| Variant | v2: pre-land check, informed author repair, decision cards, revert-first |
| Informed reworks / decision cards / revert-first tickets | 14 / 0 / 1 |
| Pre-land checks (red) / reworks / drops | 83 (16) / 14 / 2 |
| Pre-land check minutes | 87.13 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 30 / 19 / 2 |
| Placements disjoint / overlapping | 40 / 0 |
| Fast-trunk landings (task / fixer / revert) | 37 / 0 / 0 |
| Validations (green / red) | 16 / 2 |
| Repair tickets (closed / escalated / by method) | 1 / 1 / {'read-set': 1} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 12,
  "ci_seconds": 60.0,
  "ci_slots": 2,
  "batch": null,
  "seed": 5,
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
| t015 | green | a0 | 0 | 0 | 0 | src/billing | src/billing | True |
| t013 | green | a1 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t034 | green | a2 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t001 | green | a3 | 0 | 0 | 0 | src/orders | src/billing | True |
| t028 | green | a4 | 0 | 0 | 0 | src/orders | src, src/shipping | True |
| t023 | green | a5 | 0 | 0 | 0 | src/billing | src/billing, src/lib | True |
| t002 | green | a6 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t033 | green | a7 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t035 | green | a8 | 0 | 0 | 0 | src/cart | src/cart | True |
| t030 | green | a9 | 0 | 0 | 0 | src/cart | src/orders | True |
| t014 | green | a10 | 0 | 0 | 0 | src/auth | src/auth | True |
| t039 | green | a11 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t012 | green | a2 | 0 | 0 | 0 | src/auth | src/auth | True |
| t029 | green | a9 | 0 | 0 | 0 | src/cart | src/orders | True |
| t022 | green | a0 | 3 | 2 | 0 | src/billing | src, src/billing | True |
| t031 | green | a3 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t020 | green | a7 | 0 | 0 | 0 | src/auth | src/users | True |
| t019 | green | a10 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t016 | green | a8 | 0 | 0 | 0 | src/billing | src/billing | True |
| t036 | dropped | a6 | 3 | 2 | 0 | src/billing | - | False |
| t032 | dropped | a2 | 3 | 0 | 0 | src/billing | - | False |
| t018 | green | a5 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t040 | green | a11 | 0 | 0 | 0 | src/db | src/billing | True |
| t009 | green | a4 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t007 | green | a7 | 2 | 1 | 0 | src/orders | src, src/db, src/notifications, src/orders | True |
| t038 | green | a9 | 0 | 0 | 0 | src/cart | src/billing | True |
| t017 | green | a1 | 0 | 0 | 0 | src/orders | src/billing | True |
| t011 | green | a3 | 0 | 0 | 0 | src/orders | src, src/db, src/orders, src/shipping | True |
| t026 | green | a9 | 0 | 0 | 0 | src/billing | src/billing | True |
| t021 | green | a4 | 0 | 0 | 0 | src/db | src/catalog | True |
| t004 | green | a5 | 0 | 0 | 0 | src/billing | src/billing | True |
| t010 | dropped | a11 | 3 | 2 | 0 | src/db | - | False |
| t037 | green | a10 | 0 | 0 | 0 | src/db | src/catalog | True |
| t003 | green | a6 | 2 | 1 | 0 | src/billing | src, src/billing | True |
| t027 | green | a8 | 2 | 1 | 0 | src/db | src/users | True |
| t025 | green | a1 | 2 | 1 | 0 | src/notifications | src/notifications | True |
| t024 | green | a9 | 3 | 2 | 0 | src/db | src, src/billing, src/db, src/lib | True |
| t008 | green | a4 | 2 | 1 | 0 | src/inventory | src/inventory | True |
| t005 | green | a3 | 2 | 1 | 0 | src/lib | src/billing, src/lib | True |
| t006 | green | a10 | 2 | 1 | 0 | src/billing | src, src/billing | True |
