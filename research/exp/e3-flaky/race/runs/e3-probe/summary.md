# Race: beanstalk / claude

_measured: arena=arena@26eecce0/8c321b35, 1 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 42.669 |
| Tasks green / landed / dropped / total | 1 / 1 / 0 / 1 |
| Drops by reason | none |
| Wall-clock (min) | 1.41 |
| Wall-clock to all-green (min) | 1.41 |
| Task start to green, median / p90 (min) | 1.41 / 1.41 |
| Agent minutes busy / blocked / idle | 0.38 / 0.69 / 0.34 |
| Invocations (initial / rework / fixer / classifier) | 1 / 1 / 0 / 0 |
| Cost USD (total) | 0.0631 |
| Cost USD by kind | initial 0.0361, rework 0.0269 |
| CI runs / minutes | 1 / 0.34 |
| CI runs by purpose | validate 1 |
| Textual conflicts met | 0 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 1 / 1 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 1.0 / 1.0 / 1.0 |
| Footprint vs oracle: P / R / F1 | 1.0 / 1.0 / 1.0 |
| Variant | v2: pre-land check, informed author repair, decision cards, revert-first |
| Informed reworks / decision cards / revert-first tickets | 0 / 0 / 0 |
| Validation re-runs (absorbed / total) / wrongful reverts | 0 / 0 / 0 |
| Pre-land checks (red) / reworks / drops | 2 (1) / 1 / 0 |
| Pre-land check minutes | 0.68 |
| Pre-land re-runs (absorbed / total) / needless reworks | 0 / 0 / 1 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 20.0 / 0 / 0 / 0 |
| Placements disjoint / overlapping | 1 / 0 |
| Fast-trunk landings (task / fixer / revert) | 1 / 0 / 0 |
| Validations (green / red) | 1 / 0 |
| Repair tickets (closed / escalated / by method) | 0 / 0 / {} |
| Error-budget pauses / paused minutes | 0 / 0.0 |
| Machine load average, 1 min (start / mean / max / end) on 18 cores | 9.6 / 6.8 / 9.6 / 5.3 |
| Flake model (rate per run / seed / pool) | 1.0 / 7 / 6 |
| Mitigations (re-run pre-land / re-run validation / retry batch / quarantine flips) | False / False / False / 0 |
| CI runs flaked (of all runs) / by purpose | 1 of 3 / {'preland': 1} |
| Re-runs: absorbed / total (by purpose) | 0 / 0 (-) |
| Needless reworks (flake-only reds) / their cost USD | 1 / 0.0269 |
| Wrongful reverts / reverts | 0 / 0 |
| Flaked validations: tickets opened / exonerated by a later green / reverted | 0: 0 / 0 / 0 |
| Flaky tests found (flips) | src/orders/checkout.test.ts > turns the cart into a confirmed, invoiced order and empties the cart x1 |

## Config

```json
{
  "agents": 1,
  "ci_seconds": 20.0,
  "ci_slots": 2,
  "batch": null,
  "seed": 7,
  "budget_usd": 3.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": true,
  "snapshot": "head",
  "queue_hold": null,
  "error_budget": 999,
  "footprint": "predictor",
  "tasks": 1,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t012 | green | a0 | 1 | 0 | 0 | src/auth | src/auth | True |
