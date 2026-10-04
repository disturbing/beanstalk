# Race: beanstalk / replay

_measured: arena=arena@26eecce0/8c321b35, 10 tasks, policy=beanstalk, agent=replay (replay control: reference patches, synthetic timings)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 254.102 |
| Tasks green / landed / dropped / total | 9 / 9 / 1 / 10 |
| Drops by reason | replay could not repair the pre-land failure (limitation of replay agents): 1 |
| Wall-clock (min) | 2.13 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 1.16 / 1.75 |
| Agent minutes busy / blocked / idle | 1.23 / 6.67 / 4.85 |
| Invocations (initial / rework / fixer / classifier) | 10 / 2 / 0 / 0 |
| Cost USD (total) | 0.0 |
| Cost USD by kind | initial 0.0000, rework 0.0000 |
| CI runs / minutes | 9 / 3.18 |
| CI runs by purpose | validate 9 |
| Textual conflicts met | 0 |
| Red validations | 1 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 9 / 10 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.8889 / 0.5741 / 0.6667 |
| Footprint vs oracle: P / R / F1 | 0.8889 / 0.5741 / 0.6667 |
| Variant | v2: pre-land check, informed author repair, decision cards, revert-first |
| Informed reworks / decision cards / revert-first tickets | 2 / 0 / 0 |
| Validation re-runs (absorbed / total) / wrongful reverts | 1 / 1 / 0 |
| Pre-land checks (red) / reworks / drops | 19 (4) / 2 / 0 |
| Pre-land check minutes | 6.52 |
| Pre-land re-runs (absorbed / total) / needless reworks | 0 / 2 / 1 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 3.0 / 7 / 6 / 0 |
| Placements disjoint / overlapping | 10 / 0 |
| Fast-trunk landings (task / fixer / revert) | 9 / 0 / 0 |
| Validations (green / red) | 8 / 0 |
| Repair tickets (closed / escalated / by method) | 0 / 0 / {} |
| Error-budget pauses / paused minutes | 0 / 0.0 |
| Machine load average, 1 min (start / mean / max / end) on 18 cores | 50.8 / 72.5 / 84.4 / 79.1 |
| Flake model (rate per run / seed / pool) | 0.2 / 7 / 6 |
| Mitigations (re-run pre-land / re-run validation / retry batch / quarantine flips) | True / True / False / 0 |
| CI runs flaked (of all runs) / by purpose | 3 of 28 / {'preland': 2, 'validate': 1} |
| Re-runs: absorbed / total (by purpose) | 1 / 3 (preland 0/2, validate 1/1) |
| Needless reworks (flake-only reds) / their cost USD | 1 / 0.0 |
| Wrongful reverts / reverts | 0 / 0 |
| Flaked validations: tickets opened / exonerated by a later green / reverted | 1: 0 / 0 / 0 |
| Flaky tests found (flips) | src/billing/discounts.test.ts > takes a percentage or a fixed amount off x2, src/shipping/shipping.test.ts > adds a charge for every started kilogram after the first x1 |

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
| t001 | green | a0 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a1 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a2 | 1 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a4 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a4 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a0 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a5 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | dropped | a4 | 1 | 0 | 0 | src/db | - | False |
