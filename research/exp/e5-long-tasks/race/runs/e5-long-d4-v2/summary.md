# Race: beanstalk / claude

_measured: arena=arena-long@26eecce0/ddd3b27a, 16 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 62.764 |
| Tasks green / landed / dropped / total | 13 / 13 / 3 / 16 |
| Drops by reason | pre-land check still red: 2; unresolved conflict: 1 |
| Wall-clock (min) | 12.43 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 5.3 / 9.99 |
| Agent minutes busy / blocked / idle | 57.98 / 34.3 / 56.85 |
| Invocations (initial / rework / fixer / classifier) | 16 / 20 / 0 / 0 |
| Cost USD (total) | 4.2907 |
| Cost USD by kind | initial 1.6116, rework 2.6792 |
| CI runs / minutes | 13 / 13.14 |
| CI runs by purpose | validate 13 |
| Textual conflicts met | 18 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 13 / 16 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 2 |
| Footprint (predictor) vs actual: P / R / F1 | 0.8462 / 0.3744 / 0.4963 |
| Footprint vs oracle: P / R / F1 | 0.8462 / 0.3897 / 0.5128 |
| Variant | v2: pre-land check, informed author repair, decision cards, revert-first |
| Informed reworks / decision cards / revert-first tickets | 2 / 0 / 0 |
| Pre-land checks (red) / reworks / drops | 33 (4) / 2 / 2 |
| Pre-land check minutes | 33.3 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 8 / 6 / 1 |
| Placements disjoint / overlapping | 16 / 0 |
| Fast-trunk landings (task / fixer / revert) | 13 / 0 / 0 |
| Validations (green / red) | 13 / 0 |
| Repair tickets (closed / escalated / by method) | 0 / 0 / {} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 12,
  "ci_seconds": 60.0,
  "ci_slots": 2,
  "batch": null,
  "seed": 7,
  "budget_usd": 20.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": true,
  "snapshot": "head",
  "queue_hold": null,
  "error_budget": 999,
  "footprint": "predictor",
  "tasks": 16,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| L01 | green | a0 | 0 | 0 | 0 | src/orders | src, src/billing | True |
| L02 | green | a1 | 3 | 3 | 0 | src/orders | src, src/billing, src/catalog, src/db, src/lib, src/orders | True |
| L03 | green | a2 | 1 | 1 | 0 | src/billing | src, src/billing, src/db | True |
| L04 | green | a3 | 0 | 0 | 0 | src/lib | src/lib, src/users | True |
| L05 | dropped | a4 | 3 | 3 | 0 | src/billing | - | False |
| L06 | green | a5 | 0 | 0 | 0 | src/notifications | src/inventory, src/notifications | True |
| L07 | dropped | a6 | 3 | 2 | 0 | src/db | - | False |
| L08 | green | a7 | 0 | 0 | 0 | src/db | src, src/catalog, src/db, src/orders, src/shipping | True |
| L09 | green | a8 | 0 | 0 | 0 | src/auth | src/auth, src/users | True |
| L10 | dropped | a9 | 3 | 2 | 0 | src/orders | - | False |
| L11 | green | a10 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| L12 | green | a11 | 2 | 2 | 0 | src/billing | src, src/billing, src/notifications | True |
| L13 | green | a3 | 2 | 2 | 0 | src/billing | src/billing | True |
| L14 | green | a5 | 2 | 2 | 0 | src/shipping | src, src/db, src/shipping | True |
| L15 | green | a7 | 0 | 0 | 0 | src/cart | src/orders | True |
| L16 | green | a8 | 0 | 0 | 0 | src/cart | src/cart, src/inventory | True |
