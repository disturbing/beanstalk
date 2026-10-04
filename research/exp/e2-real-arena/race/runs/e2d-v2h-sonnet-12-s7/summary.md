# Race: beanstalk / claude

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 141.97 |
| Tasks green / landed / dropped / total | 29 / 31 / 11 / 40 |
| Drops by reason | declined by decision D001: 1; declined by decision D002: 1; pre-land check still red: 5; reverted: 2; unresolved conflict: 2 |
| Wall-clock (min) | 12.26 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 3.19 / 6.75 |
| Agent minutes busy / blocked / idle | 30.54 / 80.31 / 36.22 |
| Invocations (initial / rework / fixer / classifier) | 40 / 39 / 0 / 0 |
| Cost USD (total) | 6.0352 |
| Cost USD by kind | initial 2.5728, rework 3.4624 |
| CI runs / minutes | 18 / 18.5 |
| CI runs by purpose | validate 15, bisect 3 |
| Textual conflicts met | 15 |
| Red validations | 4 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 30 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 3 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6452 / 0.4355 / 0.4936 |
| Footprint vs oracle: P / R / F1 | 0.6774 / 0.4543 / 0.5183 |
| Variant | v2: pre-land check, informed author repair, decision cards, revert-first |
| Informed reworks / decision cards / revert-first tickets | 24 / 2 / 2 |
| Pre-land checks (red) / reworks / drops | 77 (31) / 24 / 5 |
| Pre-land check minutes | 78.5 |
| Re-check rule / skipped (adaptive) / hunk-disjoint / hunk-overlap | hunk / 0 / 7 / 6 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 29 / 6 / 0 |
| Placements disjoint / overlapping | 40 / 0 |
| Fast-trunk landings (task / fixer / revert) | 31 / 0 / 2 |
| Validations (green / red) | 11 / 4 |
| Repair tickets (closed / escalated / by method) | 0 / 2 / {'read-set': 2} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 12,
  "ci_seconds": 60.0,
  "ci_slots": 2,
  "batch": null,
  "seed": 7,
  "budget_usd": 12.0,
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
| t001 | green | a0 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a1 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a2 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t004 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a4 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a6 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a7 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a8 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | dropped | a9 | 3 | 2 | 0 | src/db | - | False |
| t011 | dropped | a10 | 1 | 1 | 0 | src/orders | src, src/db, src/orders, src/shipping | False |
| t012 | green | a11 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a11 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a7 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a0 | 0 | 0 | 0 | src/billing | src/billing | True |
| t016 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a4 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a5 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a1 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a6 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a8 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | dropped | a0 | 3 | 2 | 0 | src/billing | - | False |
| t023 | green | a4 | 2 | 1 | 0 | src/billing | src/billing, src/lib | True |
| t024 | green | a7 | 2 | 0 | 0 | src/db | src, src/billing, src/db, src/lib | True |
| t025 | dropped | a5 | 3 | 1 | 0 | src/notifications | - | False |
| t026 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a6 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a1 | 2 | 2 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a10 | 2 | 0 | 0 | src/cart | src/inventory, src/orders | True |
| t030 | green | a11 | 2 | 0 | 0 | src/cart | src/orders | True |
| t031 | dropped | a8 | 3 | 1 | 0 | src/billing | - | False |
| t032 | dropped | a2 | 2 | 0 | 0 | src/billing | - | False |
| t033 | green | a3 | 2 | 1 | 0 | src/shipping | src/notifications, src/shipping | True |
| t034 | dropped | a6 | 3 | 1 | 0 | src/inventory | - | True |
| t035 | green | a9 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | dropped | a9 | 0 | 0 | 0 | src/billing | src, src/billing | False |
| t037 | green | a1 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | dropped | a4 | 3 | 1 | 0 | src/cart | - | False |
| t039 | dropped | a3 | 3 | 1 | 0 | src/billing | - | False |
| t040 | dropped | a7 | 2 | 0 | 0 | src/db | - | False |
