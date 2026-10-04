# Race: queue / replay

_measured: arena=arena-long@26eecce0/ddd3b27a, 16 tasks, policy=queue, agent=replay (replay control: reference patches, synthetic timings)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 472.089 |
| Tasks green / landed / dropped / total | 5 / 5 / 11 / 16 |
| Drops by reason | replay could not resolve the conflict or red (limitation of replay agents): 11 |
| Wall-clock (min) | 0.64 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 0.24 / 0.34 |
| Agent minutes busy / blocked / idle | 3.09 / 0.17 / 1.83 |
| Invocations (initial / rework / fixer / classifier) | 16 / 13 / 0 / 0 |
| Cost USD (total) | 0.0 |
| Cost USD by kind | initial 0.0000, rework 0.0000 |
| CI runs / minutes | 3 / 0.33 |
| CI runs by purpose | batch 3 |
| Textual conflicts met | 13 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 5 / 16 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.8 / 0.45 / 0.5467 |
| Footprint vs oracle: P / R / F1 | 0.8 / 0.45 / 0.5467 |
| Batches (green / red / cancelled) | 3 / 0 / 0 |
| Bisections / bisect CI runs | 0 / 0 |
| Ejections (conflict / red) | 13 / 0 |
| PRs held behind in-flight conflicts | 2 |
| Mean batch size | 1.667 |

## Config

```json
{
  "agents": 8,
  "ci_seconds": 6.0,
  "ci_slots": 2,
  "batch": 4,
  "seed": 7,
  "budget_usd": 20.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": false,
  "snapshot": null,
  "queue_hold": false,
  "error_budget": null,
  "footprint": "predictor",
  "tasks": 16,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| L01 | green | a0 | 0 | 0 | 0 | src/orders | src, src/billing | True |
| L02 | dropped | a3 | 1 | 1 | 0 | src/orders | - | False |
| L03 | dropped | a6 | 2 | 2 | 0 | src/billing | - | False |
| L04 | dropped | a4 | 1 | 1 | 0 | src/lib | - | False |
| L05 | dropped | a2 | 1 | 1 | 0 | src/billing | - | False |
| L06 | green | a5 | 0 | 0 | 0 | src/notifications | src/inventory, src/notifications | True |
| L07 | green | a6 | 0 | 0 | 0 | src/db | src, src/billing, src/db, src/orders | True |
| L08 | dropped | a0 | 1 | 1 | 0 | src/db | - | False |
| L09 | green | a0 | 0 | 0 | 0 | src/auth | src/auth, src/users | True |
| L10 | dropped | a5 | 1 | 1 | 0 | src/orders | - | False |
| L11 | dropped | a1 | 1 | 1 | 0 | src/billing | - | False |
| L12 | dropped | a6 | 1 | 1 | 0 | src/billing | - | False |
| L13 | green | a7 | 0 | 0 | 0 | src/billing | src/billing | True |
| L14 | dropped | a2 | 1 | 1 | 0 | src/shipping | - | False |
| L15 | dropped | a0 | 1 | 1 | 0 | src/cart | - | False |
| L16 | dropped | a1 | 2 | 2 | 0 | src/cart | - | False |
