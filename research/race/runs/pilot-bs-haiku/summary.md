# Race: beanstalk / claude

_measured: arena=arena@26eecce0/8c321b35, 12 tasks, policy=beanstalk, agent=claude (haiku)_

**Aborted:** budget: $5.01 of $5.00 (mid-invocation)

| Metric | Value |
|---|---|
| Changes reaching green per hour | 22.413 |
| Tasks green / landed / dropped / total | 10 / 12 / 0 / 12 |
| Drops by reason | none |
| Wall-clock (min) | 26.77 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 1.7 / 3.51 |
| Agent minutes busy / blocked / idle | 65.68 / 0.21 / 41.19 |
| Invocations (initial / rework / fixer / classifier) | 12 / 3 / 6 / 0 |
| Cost USD (total) | 5.0076 |
| Cost USD by kind | fixer 2.4074, initial 0.8587, rework 0.6291 |
| CI runs / minutes | 20 / 10.75 |
| CI runs by purpose | validate 19, bisect 1 |
| Textual conflicts met | 3 |
| Red validations | 9 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 10 / 12 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Footprint (predictor) vs actual: P / R / F1 | 0.5833 / 0.4028 / 0.4583 |
| Footprint vs oracle: P / R / F1 | 0.5833 / 0.4167 / 0.4722 |
| Placements disjoint / overlapping | 7 / 5 |
| Fast-trunk landings (task / fixer / revert) | 12 / 6 / 1 |
| Validations (green / red) | 10 / 9 |
| Repair tickets (closed / escalated / by method) | 2 / 1 / {'read-set': 5} |
| Error-budget pauses / paused minutes | 1 / 0.41 |

## Config

```json
{
  "agents": 4,
  "ci_seconds": 30.0,
  "ci_slots": 2,
  "batch": null,
  "seed": 1,
  "budget_usd": 5.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": true,
  "snapshot": "green",
  "queue_hold": null,
  "error_budget": 3,
  "footprint": "predictor",
  "tasks": 12
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t001 | green | a0 | 0 | 0 | 0 | src/orders | src/billing | True |
| t003 | green | a1 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t005 | green | a2 | 0 | 0 | 0 | src/lib | src/lib | True |
| t008 | green | a3 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t017 | green | a2 | 0 | 0 | 0 | src/orders | src/billing | True |
| t023 | green | a0 | 0 | 0 | 0 | src/billing | src/billing, src/lib | True |
| t028 | green | a2 | 0 | 0 | 0 | src/orders | src, src/shipping | True |
| t031 | green | a0 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t032 | landed | a3 | 0 | 0 | 0 | src/billing | src, src/orders | False |
| t034 | green | a3 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t036 | landed | a2 | 1 | 1 | 0 | src/billing | (root), src, src/billing | False |
| t040 | green | a3 | 1 | 1 | 0 | src/db | src/billing | True |
