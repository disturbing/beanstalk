# Race: beanstalk / claude

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 92.704 |
| Tasks green / landed / dropped / total | 34 / 34 / 6 / 40 |
| Drops by reason | declined by decision D001: 1; pre-land check still red: 3; unresolved conflict: 2 |
| Wall-clock (min) | 22.01 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 5.7 / 9.5 |
| Agent minutes busy / blocked / idle | 75.4 / 143.68 / 44.98 |
| Invocations (initial / rework / fixer / classifier) | 40 / 25 / 0 / 0 |
| Cost USD (total) | 4.1857 |
| Cost USD by kind | initial 2.6210, rework 1.5647 |
| CI runs / minutes | 23 / 29.97 |
| CI runs by purpose | validate 23 |
| Textual conflicts met | 15 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 34 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 4 |
| Footprint (predictor) vs actual: P / R / F1 | 0.5882 / 0.4044 / 0.4579 |
| Footprint vs oracle: P / R / F1 | 0.6176 / 0.4069 / 0.4706 |
| Variant | v2: pre-land check, informed author repair, decision cards, revert-first |
| Informed reworks / decision cards / revert-first tickets | 10 / 1 / 0 |
| Pre-land checks (red) / reworks / drops | 74 (14) / 10 / 3 |
| Pre-land check minutes | 98.95 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 31 / 15 / 2 |
| Placements disjoint / overlapping | 40 / 0 |
| Fast-trunk landings (task / fixer / revert) | 34 / 0 / 0 |
| Validations (green / red) | 23 / 0 |
| Repair tickets (closed / escalated / by method) | 0 / 0 / {} |
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
| t003 | green | a2 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t035 | green | a7 | 0 | 0 | 0 | src/cart | src/cart | True |
| t009 | green | a1 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t015 | dropped | a0 | 3 | 3 | 0 | src/billing | - | False |
| t007 | green | a10 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t020 | green | a6 | 0 | 0 | 0 | src/auth | src/users | True |
| t032 | green | a8 | 0 | 0 | 0 | src/billing | src, src/orders, src/shipping | True |
| t030 | green | a5 | 0 | 0 | 0 | src/cart | src/orders | True |
| t001 | green | a1 | 0 | 0 | 0 | src/orders | src/billing | True |
| t016 | green | a7 | 0 | 0 | 0 | src/billing | src/billing | True |
| t006 | green | a11 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t011 | dropped | a6 | 3 | 2 | 0 | src/orders | - | False |
| t024 | green | a9 | 3 | 1 | 0 | src/db | src, src/billing, src/db | True |
| t036 | dropped | a3 | 3 | 1 | 0 | src/billing | - | False |
| t029 | green | a8 | 1 | 1 | 0 | src/cart | src/orders | True |
| t014 | green | a1 | 0 | 0 | 0 | src/auth | src/auth | True |
| t019 | green | a7 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t033 | dropped | a11 | 2 | 0 | 0 | src/shipping | - | False |
| t022 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t021 | green | a10 | 0 | 0 | 0 | src/db | src/catalog | True |
| t005 | dropped | a2 | 3 | 0 | 0 | src/lib | - | False |
| t012 | green | a1 | 0 | 0 | 0 | src/auth | src/auth | True |
| t018 | green | a0 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t025 | green | a5 | 1 | 1 | 0 | src/notifications | src/notifications | True |
| t008 | green | a10 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t027 | green | a8 | 0 | 0 | 0 | src/db | src/users | True |
| t002 | green | a4 | 0 | 0 | 0 | src/orders | src/billing, src/catalog, src/lib, src/orders | True |
| t017 | green | a1 | 0 | 0 | 0 | src/orders | src/billing | True |
