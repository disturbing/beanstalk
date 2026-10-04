# Race: beanstalk / replay

_measured: arena=arena-long@26eecce0/ddd3b27a, 16 tasks, policy=beanstalk, agent=replay (replay control: reference patches, synthetic timings)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 279.656 |
| Tasks green / landed / dropped / total | 6 / 6 / 10 / 16 |
| Drops by reason | replay could not repair the pre-land failure (limitation of replay agents): 6; replay could not resolve the conflict (limitation of replay agents): 4 |
| Wall-clock (min) | 1.29 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 0.51 / 0.75 |
| Agent minutes busy / blocked / idle | 5.02 / 3.17 / 2.11 |
| Invocations (initial / rework / fixer / classifier) | 16 / 10 / 0 / 0 |
| Cost USD (total) | 0.0 |
| Cost USD by kind | initial 0.0000, rework 0.0000 |
| CI runs / minutes | 6 / 0.78 |
| CI runs by purpose | validate 6 |
| Textual conflicts met | 4 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 6 / 16 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.8333 / 0.3389 / 0.4722 |
| Footprint vs oracle: P / R / F1 | 0.8333 / 0.3389 / 0.4722 |
| Variant | v2: pre-land check, informed author repair, decision cards, revert-first |
| Informed reworks / decision cards / revert-first tickets | 6 / 0 / 0 |
| Pre-land checks (red) / reworks / drops | 22 (6) / 6 / 0 |
| Pre-land check minutes | 2.87 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 6.0 / 2 / 7 / 1 |
| Placements disjoint / overlapping | 16 / 0 |
| Fast-trunk landings (task / fixer / revert) | 6 / 0 / 0 |
| Validations (green / red) | 6 / 0 |
| Repair tickets (closed / escalated / by method) | 0 / 0 / {} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 8,
  "ci_seconds": 6.0,
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
| L02 | dropped | a1 | 1 | 0 | 0 | src/orders | - | False |
| L03 | dropped | a2 | 1 | 1 | 0 | src/billing | - | False |
| L04 | green | a3 | 0 | 0 | 0 | src/lib | src/lib, src/users | True |
| L05 | green | a4 | 0 | 0 | 0 | src/billing | src, src/billing, src/lib | True |
| L06 | green | a5 | 0 | 0 | 0 | src/notifications | src/inventory, src/notifications | True |
| L07 | dropped | a6 | 1 | 1 | 0 | src/db | - | False |
| L08 | green | a7 | 0 | 0 | 0 | src/db | src, src/catalog, src/db, src/orders, src/shipping | True |
| L09 | dropped | a0 | 1 | 1 | 0 | src/auth | - | False |
| L10 | dropped | a4 | 1 | 1 | 0 | src/orders | - | False |
| L11 | dropped | a5 | 1 | 0 | 0 | src/billing | - | False |
| L12 | dropped | a1 | 1 | 0 | 0 | src/billing | - | False |
| L13 | dropped | a3 | 1 | 0 | 0 | src/billing | - | False |
| L14 | green | a7 | 0 | 0 | 0 | src/shipping | src, src/shipping | True |
| L15 | dropped | a6 | 1 | 0 | 0 | src/cart | - | False |
| L16 | dropped | a4 | 1 | 0 | 0 | src/cart | - | False |
