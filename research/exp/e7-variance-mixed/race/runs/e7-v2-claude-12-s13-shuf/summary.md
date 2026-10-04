# Race: beanstalk / claude

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 160.889 |
| Tasks green / landed / dropped / total | 37 / 37 / 3 / 40 |
| Drops by reason | declined by decision D001: 1; unresolved conflict: 2 |
| Wall-clock (min) | 13.8 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 3.24 / 7.61 |
| Agent minutes busy / blocked / idle | 25.26 / 84.94 / 55.39 |
| Invocations (initial / rework / fixer / classifier) | 40 / 22 / 0 / 0 |
| Cost USD (total) | 4.4758 |
| Cost USD by kind | initial 2.2270, rework 2.2488 |
| CI runs / minutes | 18 / 18.8 |
| CI runs by purpose | validate 18 |
| Textual conflicts met | 11 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 37 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 4 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6486 / 0.4617 / 0.5153 |
| Footprint vs oracle: P / R / F1 | 0.6757 / 0.4662 / 0.5288 |
| Variant | v2: pre-land check, informed author repair, decision cards, revert-first |
| Informed reworks / decision cards / revert-first tickets | 11 / 1 / 0 |
| Pre-land checks (red) / reworks / drops | 78 (12) / 11 / 0 |
| Pre-land check minutes | 82.33 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 31 / 19 / 1 |
| Placements disjoint / overlapping | 40 / 0 |
| Fast-trunk landings (task / fixer / revert) | 37 / 0 / 0 |
| Validations (green / red) | 18 / 0 |
| Repair tickets (closed / escalated / by method) | 0 / 0 / {} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 12,
  "ci_seconds": 60.0,
  "ci_slots": 2,
  "batch": null,
  "seed": 13,
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
| t017 | green | a0 | 0 | 0 | 0 | src/orders | src/billing | True |
| t021 | green | a1 | 0 | 0 | 0 | src/db | src/catalog | True |
| t016 | green | a2 | 0 | 0 | 0 | src/billing | src/billing | True |
| t034 | green | a3 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t026 | green | a4 | 0 | 0 | 0 | src/billing | src/billing | True |
| t039 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | green | a6 | 0 | 0 | 0 | src/billing | src/billing | True |
| t025 | green | a7 | 0 | 0 | 0 | src/notifications | src/notifications | True |
| t007 | green | a8 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t035 | green | a9 | 0 | 0 | 0 | src/cart | src/cart | True |
| t009 | green | a10 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | green | a11 | 3 | 2 | 0 | src/db | src, src/billing, src/db, src/users | True |
| t003 | green | a0 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t020 | green | a3 | 0 | 0 | 0 | src/auth | src/users | True |
| t022 | green | a6 | 3 | 2 | 0 | src/billing | src, src/billing | True |
| t037 | green | a4 | 0 | 0 | 0 | src/db | src/catalog | True |
| t014 | green | a7 | 0 | 0 | 0 | src/auth | src/auth | True |
| t038 | green | a1 | 0 | 0 | 0 | src/cart | src/billing | True |
| t005 | green | a9 | 0 | 0 | 0 | src/lib | src/lib | True |
| t008 | green | a10 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t033 | green | a5 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t002 | green | a3 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t019 | green | a8 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t040 | green | a4 | 0 | 0 | 0 | src/db | src/billing | True |
| t027 | green | a1 | 0 | 0 | 0 | src/db | src/users | True |
| t031 | green | a2 | 3 | 2 | 0 | src/billing | src, src/billing, src/lib | True |
| t013 | green | a9 | 3 | 2 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t006 | green | a7 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t036 | green | a10 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t032 | dropped | a5 | 2 | 0 | 0 | src/billing | - | False |
| t011 | dropped | a4 | 3 | 1 | 0 | src/orders | - | False |
| t024 | dropped | a1 | 3 | 1 | 0 | src/db | - | False |
| t001 | green | a3 | 0 | 0 | 0 | src/orders | src/billing | True |
| t015 | green | a0 | 0 | 0 | 0 | src/billing | src/billing | True |
| t029 | green | a8 | 0 | 0 | 0 | src/cart | src/orders | True |
| t030 | green | a3 | 0 | 0 | 0 | src/cart | src/orders | True |
| t018 | green | a7 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t028 | green | a10 | 0 | 0 | 0 | src/orders | src, src/shipping | True |
| t023 | green | a0 | 2 | 1 | 0 | src/billing | src/billing, src/lib | True |
| t012 | green | a3 | 0 | 0 | 0 | src/auth | src/auth | True |
