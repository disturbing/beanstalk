# Race: queue / claude

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=queue, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 75.289 |
| Tasks green / landed / dropped / total | 36 / 36 / 4 / 40 |
| Drops by reason | ejected (conflict): 3; ejected (red): 1 |
| Wall-clock (min) | 28.69 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 4.05 / 17.39 |
| Agent minutes busy / blocked / idle | 21.7 / 0.3 / 322.27 |
| Invocations (initial / rework / fixer / classifier) | 40 / 27 / 0 / 0 |
| Cost USD (total) | 4.996 |
| Cost USD by kind | initial 2.0386, rework 2.9574 |
| CI runs / minutes | 45 / 44.56 |
| CI runs by purpose | batch 31, batch-cancelled 4, bisect 10 |
| Textual conflicts met | 24 |
| Red validations | 18 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 36 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 4 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6389 / 0.4653 / 0.5157 |
| Footprint vs oracle: P / R / F1 | 0.6667 / 0.4653 / 0.525 |
| Batches (green / red / cancelled) | 13 / 7 / 4 |
| Bisections / bisect CI runs | 6 / 10 |
| Ejections (conflict / red) | 24 / 7 |
| Batch re-runs (absorbed / total) | 0 / 7 |
| PRs held behind in-flight conflicts | 12 |
| Mean batch size | 2.5 |
| Machine load average, 1 min (start / mean / max / end) on 18 cores | 6.1 / 5.3 / 17.8 / 4.6 |
| Flake model (rate per run / seed / pool) | 0.05 / 7 / 6 |
| Mitigations (re-run pre-land / re-run validation / retry batch / quarantine flips) | False / False / True / 0 |
| CI runs flaked (of all runs) / by purpose | 0 of 41 / {} |
| Re-runs: absorbed / total (by purpose) | 0 / 7 (batch 0/7) |
| Needless reworks (flake-only reds) / their cost USD | 0 / 0 |
| Wrongful reverts / reverts | 0 / 0 |
| Flaked validations: tickets opened / exonerated by a later green / reverted | 0: 0 / 0 / 0 |
| Flaky tests found (flips) | none |

## Config

```json
{
  "agents": 12,
  "ci_seconds": 60.0,
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
  "tasks": 40,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t001 | green | a0 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a1 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a0 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t004 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a4 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a6 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a7 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a8 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | green | a2 | 3 | 2 | 1 | src/db | src, src/billing, src/db, src/users | True |
| t011 | dropped | a1 | 3 | 3 | 1 | src/orders | - | False |
| t012 | green | a11 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a4 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a3 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a11 | 0 | 0 | 0 | src/billing | src/billing | True |
| t016 | green | a7 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a0 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a8 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a5 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a1 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a0 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | green | a0 | 3 | 3 | 0 | src/billing | src, src/billing | True |
| t023 | green | a1 | 1 | 1 | 0 | src/billing | src/billing, src/lib | True |
| t024 | dropped | a0 | 3 | 3 | 1 | src/db | - | False |
| t025 | green | a0 | 1 | 1 | 0 | src/notifications | src/notifications | True |
| t026 | green | a9 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a8 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a2 | 1 | 1 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a7 | 1 | 1 | 0 | src/cart | src/orders | True |
| t030 | green | a7 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | green | a0 | 1 | 0 | 1 | src/billing | src, src/billing | True |
| t032 | dropped | a0 | 3 | 1 | 3 | src/billing | - | False |
| t033 | green | a5 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a4 | 1 | 1 | 0 | src/inventory | src/inventory | True |
| t035 | green | a9 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | dropped | a3 | 3 | 4 | 0 | src/billing | - | False |
| t037 | green | a7 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a6 | 1 | 1 | 0 | src/cart | src/billing | True |
| t039 | green | a3 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t040 | green | a0 | 1 | 1 | 0 | src/db | src/billing | True |
