# Race: beanstalk / replay

_measured: arena=arena@26eecce0/8c321b35, 8 tasks, policy=beanstalk, agent=replay (replay control: reference patches, synthetic timings)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 1529.635 |
| Tasks green / landed / dropped / total | 6 / 6 / 2 / 8 |
| Drops by reason | replay could not resolve the conflict (limitation of replay agents): 2 |
| Wall-clock (min) | 0.24 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 0.07 / 0.1 |
| Agent minutes busy / blocked / idle | 0.51 / 0.03 / 0.4 |
| Invocations (initial / rework / fixer / classifier) | 8 / 2 / 0 / 0 |
| Cost USD (total) | 0.0 |
| Cost USD by kind | initial 0.0000, rework 0.0000 |
| CI runs / minutes | 5 / 0.13 |
| CI runs by purpose | validate 5 |
| Textual conflicts met | 2 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 6 / 8 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.8333 / 0.5555 / 0.6389 |
| Footprint vs oracle: P / R / F1 | 0.8333 / 0.5555 / 0.6389 |
| Placements disjoint / overlapping | 4 / 4 |
| Fast-trunk landings (task / fixer / revert) | 6 / 0 / 0 |
| Validations (green / red) | 5 / 0 |
| Repair tickets (closed / escalated / by method) | 0 / 0 / {} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 4,
  "ci_seconds": 1.0,
  "ci_slots": 2,
  "batch": null,
  "seed": 5,
  "budget_usd": 25.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": true,
  "snapshot": "green",
  "queue_hold": null,
  "error_budget": 3,
  "footprint": "predictor",
  "tasks": 8,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t002 | green | a0 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a1 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | green | a2 | 0 | 0 | 0 | src/billing | src/billing | True |
| t007 | dropped | a0 | 1 | 1 | 0 | src/orders | - | False |
| t009 | green | a3 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t017 | dropped | a3 | 1 | 1 | 0 | src/orders | - | False |
| t029 | green | a2 | 0 | 0 | 0 | src/cart | src/orders | True |
| t033 | green | a3 | 0 | 0 | 0 | src/shipping | src/shipping | True |
