# Race: beanstalk / replay

_measured: arena=arena@26eecce0/8c321b35, 10 tasks, policy=beanstalk, agent=replay (replay control: reference patches, synthetic timings)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 178.735 |
| Tasks green / landed / dropped / total | 8 / 9 / 2 / 10 |
| Drops by reason | replay could not repair the pre-land failure (limitation of replay agents): 1; reverted: 1 |
| Wall-clock (min) | 2.69 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 1.04 / 2.43 |
| Agent minutes busy / blocked / idle | 4.24 / 7.62 / 4.25 |
| Invocations (initial / rework / fixer / classifier) | 10 / 5 / 0 / 0 |
| Cost USD (total) | 0.0 |
| Cost USD by kind | initial 0.0000, rework 0.0000 |
| CI runs / minutes | 10 / 3.02 |
| CI runs by purpose | validate 10 |
| Textual conflicts met | 0 |
| Red validations | 1 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 8 / 10 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.8889 / 0.5741 / 0.6667 |
| Footprint vs oracle: P / R / F1 | 0.8889 / 0.5741 / 0.6667 |
| Variant | v2: pre-land check, informed author repair, decision cards, revert-first |
| Informed reworks / decision cards / revert-first tickets | 5 / 0 / 1 |
| Validation re-runs (absorbed / total) / wrongful reverts | 0 / 0 / 1 |
| Pre-land checks (red) / reworks / drops | 19 (5) / 5 / 0 |
| Pre-land check minutes | 7.15 |
| Pre-land re-runs (absorbed / total) / needless reworks | 0 / 0 / 4 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 3.0 / 6 / 5 / 0 |
| Placements disjoint / overlapping | 10 / 0 |
| Fast-trunk landings (task / fixer / revert) | 9 / 0 / 1 |
| Validations (green / red) | 9 / 1 |
| Repair tickets (closed / escalated / by method) | 0 / 1 / {'read-set': 1} |
| Error-budget pauses / paused minutes | 0 / 0.0 |
| Machine load average, 1 min (start / mean / max / end) on 18 cores | 52.1 / 66.3 / 83.9 / 53.6 |
| Flake model (rate per run / seed / pool) | 0.2 / 7 / 6 |
| Mitigations (re-run pre-land / re-run validation / retry batch / quarantine flips) | False / False / False / 0 |
| CI runs flaked (of all runs) / by purpose | 5 of 29 / {'preland': 4, 'validate': 1} |
| Re-runs: absorbed / total (by purpose) | 0 / 0 (-) |
| Needless reworks (flake-only reds) / their cost USD | 4 / 0.0 |
| Wrongful reverts / reverts | 1 / 1 |
| Flaked validations: tickets opened / exonerated by a later green / reverted | 1: 1 / 0 / 1 |
| Flaky tests found (flips) | none |

## Config

```json
{
  "agents": 6,
  "ci_seconds": 3.0,
  "ci_slots": 2,
  "batch": null,
  "seed": 7,
  "budget_usd": 25.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": true,
  "snapshot": "head",
  "queue_hold": null,
  "error_budget": 999,
  "footprint": "predictor",
  "tasks": 10,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t001 | dropped | a0 | 2 | 0 | 0 | src/orders | src/billing | False |
| t002 | green | a1 | 1 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a2 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | green | a3 | 1 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a4 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a4 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a5 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a4 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | dropped | a5 | 1 | 0 | 0 | src/db | - | False |
