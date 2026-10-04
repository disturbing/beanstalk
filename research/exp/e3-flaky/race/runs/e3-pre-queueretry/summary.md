# Race: queue / replay

_measured: arena=arena@26eecce0/8c321b35, 10 tasks, policy=queue, agent=replay (replay control: reference patches, synthetic timings)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 640.635 |
| Tasks green / landed / dropped / total | 9 / 9 / 1 / 10 |
| Drops by reason | replay could not resolve the conflict or red (limitation of replay agents): 1 |
| Wall-clock (min) | 0.84 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 0.26 / 0.49 |
| Agent minutes busy / blocked / idle | 1.61 / 0.08 / 3.37 |
| Invocations (initial / rework / fixer / classifier) | 10 / 2 / 0 / 0 |
| Cost USD (total) | 0.0 |
| Cost USD by kind | initial 0.0000, rework 0.0000 |
| CI runs / minutes | 5 / 0.69 |
| CI runs by purpose | batch 5 |
| Textual conflicts met | 2 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 9 / 10 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.8889 / 0.5741 / 0.6667 |
| Footprint vs oracle: P / R / F1 | 0.8889 / 0.5741 / 0.6667 |
| Batches (green / red / cancelled) | 5 / 0 / 0 |
| Bisections / bisect CI runs | 0 / 0 |
| Ejections (conflict / red) | 2 / 0 |
| Batch re-runs (absorbed / total) | 0 / 0 |
| PRs held behind in-flight conflicts | 1 |
| Mean batch size | 1.8 |
| Machine load average, 1 min (start / mean / max / end) on 18 cores | 95.1 / 89.0 / 95.1 / 82.9 |
| Flake model (rate per run / seed / pool) | 0.2 / 7 / 6 |
| Mitigations (re-run pre-land / re-run validation / retry batch / quarantine flips) | False / False / True / 0 |
| CI runs flaked (of all runs) / by purpose | 0 of 5 / {} |
| Re-runs: absorbed / total (by purpose) | 0 / 0 (-) |
| Needless reworks (flake-only reds) / their cost USD | 0 / 0 |
| Wrongful reverts / reverts | 0 / 0 |
| Flaked validations: tickets opened / exonerated by a later green / reverted | 0: 0 / 0 / 0 |
| Flaky tests found (flips) | none |

## Config

```json
{
  "agents": 6,
  "ci_seconds": 3.0,
  "ci_slots": 2,
  "batch": 4,
  "seed": 7,
  "budget_usd": 25.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": false,
  "snapshot": null,
  "queue_hold": false,
  "error_budget": null,
  "footprint": "predictor",
  "tasks": 10,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t001 | green | a0 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a1 | 1 | 1 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a2 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a4 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a4 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a0 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a2 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | dropped | a0 | 1 | 1 | 0 | src/db | - | False |
