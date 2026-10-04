# Race: beanstalk / replay

_measured: arena=arena@26eecce0/8c321b35, 12 tasks, policy=beanstalk, agent=replay (replay control: reference patches, synthetic timings)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 745.754 |
| Tasks green / landed / dropped / total | 10 / 10 / 2 / 12 |
| Drops by reason | replay could not repair the pre-land failure (limitation of replay agents): 1; replay could not resolve the conflict (limitation of replay agents): 1 |
| Wall-clock (min) | 0.8 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 0.35 / 0.51 |
| Agent minutes busy / blocked / idle | 0.89 / 2.24 / 1.7 |
| Invocations (initial / rework / fixer / classifier) | 12 / 2 / 0 / 0 |
| Cost USD (total) | 0.0 |
| Cost USD by kind | initial 0.0000, rework 0.0000 |
| CI runs / minutes | 9 / 0.88 |
| CI runs by purpose | validate 9 |
| Textual conflicts met | 1 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 10 / 12 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.9 / 0.6083 / 0.69 |
| Footprint vs oracle: P / R / F1 | 0.9 / 0.6083 / 0.69 |
| Variant | v2: pre-land check, informed author repair, decision cards, revert-first |
| Informed reworks / decision cards / revert-first tickets | 1 / 0 / 0 |
| Pre-land checks (red) / reworks / drops | 17 (1) / 1 / 0 |
| Pre-land check minutes | 1.7 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 3.0 / 7 / 6 / 0 |
| Placements disjoint / overlapping | 12 / 0 |
| Fast-trunk landings (task / fixer / revert) | 10 / 0 / 0 |
| Validations (green / red) | 9 / 0 |
| Repair tickets (closed / escalated / by method) | 0 / 0 / {} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 6,
  "ci_seconds": 3.0,
  "ci_slots": 2,
  "batch": null,
  "seed": 3,
  "budget_usd": 25.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": true,
  "snapshot": "head",
  "queue_hold": null,
  "error_budget": 999,
  "footprint": "predictor",
  "tasks": 12,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t004 | green | a0 | 0 | 0 | 0 | src/billing | src/billing | True |
| t006 | green | a1 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t008 | green | a2 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t011 | green | a3 | 0 | 0 | 0 | src/orders | src, src/db, src/orders, src/shipping | True |
| t012 | green | a4 | 0 | 0 | 0 | src/auth | src/auth | True |
| t009 | green | a5 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t003 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t010 | dropped | a0 | 1 | 0 | 0 | src/db | - | False |
| t002 | green | a4 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t007 | dropped | a2 | 1 | 1 | 0 | src/orders | - | False |
| t001 | green | a3 | 0 | 0 | 0 | src/orders | src/billing | True |
| t005 | green | a4 | 0 | 0 | 0 | src/lib | src/lib | True |
