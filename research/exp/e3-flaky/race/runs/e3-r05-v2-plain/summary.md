# Race: beanstalk / claude

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 177.302 |
| Tasks green / landed / dropped / total | 37 / 37 / 3 / 40 |
| Drops by reason | declined by decision D001: 1; unresolved conflict: 2 |
| Wall-clock (min) | 12.52 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 4.34 / 6.51 |
| Agent minutes busy / blocked / idle | 25.0 / 91.02 / 34.23 |
| Invocations (initial / rework / fixer / classifier) | 40 / 36 / 0 / 0 |
| Cost USD (total) | 5.1987 |
| Cost USD by kind | initial 2.5232, rework 2.6755 |
| CI runs / minutes | 20 / 20.35 |
| CI runs by purpose | validate 17, bisect 3 |
| Textual conflicts met | 19 |
| Red validations | 1 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 37 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 1 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6486 / 0.4595 / 0.5126 |
| Footprint vs oracle: P / R / F1 | 0.6757 / 0.4617 / 0.5243 |
| Variant | v2: pre-land check, informed author repair, decision cards, revert-first |
| Informed reworks / decision cards / revert-first tickets | 16 / 1 / 1 |
| Validation re-runs (absorbed / total) / wrongful reverts | 0 / 0 / 0 |
| Pre-land checks (red) / reworks / drops | 87 (18) / 17 / 0 |
| Pre-land check minutes | 88.39 |
| Pre-land re-runs (absorbed / total) / needless reworks | 0 / 0 / 3 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 33 / 19 / 2 |
| Placements disjoint / overlapping | 40 / 0 |
| Fast-trunk landings (task / fixer / revert) | 37 / 0 / 0 |
| Validations (green / red) | 16 / 1 |
| Repair tickets (closed / escalated / by method) | 0 / 1 / {'read-set': 1} |
| Error-budget pauses / paused minutes | 0 / 0.0 |
| Machine load average, 1 min (start / mean / max / end) on 18 cores | 5.0 / 10.3 / 22.9 / 2.8 |
| Flake model (rate per run / seed / pool) | 0.05 / 7 / 6 |
| Mitigations (re-run pre-land / re-run validation / retry batch / quarantine flips) | False / False / False / 0 |
| CI runs flaked (of all runs) / by purpose | 3 of 107 / {'preland': 3} |
| Re-runs: absorbed / total (by purpose) | 0 / 0 (-) |
| Needless reworks (flake-only reds) / their cost USD | 3 / 0.1876 |
| Wrongful reverts / reverts | 0 / 0 |
| Flaked validations: tickets opened / exonerated by a later green / reverted | 0: 0 / 0 / 0 |
| Flaky tests found (flips) | none |

## Config

```json
{
  "agents": 12,
  "ci_seconds": 60.0,
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
  "tasks": 40,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t001 | green | a0 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a1 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a2 | 3 | 2 | 0 | src/billing | src, src/billing | True |
| t004 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a4 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a5 | 3 | 1 | 0 | src/billing | src, src/billing | True |
| t007 | green | a6 | 2 | 1 | 0 | src/orders | src, src/db, src/notifications, src/orders | True |
| t008 | green | a7 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a8 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | dropped | a9 | 3 | 2 | 0 | src/db | - | False |
| t011 | green | a10 | 0 | 0 | 0 | src/orders | src, src/db, src/orders, src/shipping | True |
| t012 | green | a11 | 1 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a3 | 3 | 2 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a7 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a4 | 0 | 0 | 0 | src/billing | src/billing | True |
| t016 | green | a8 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a0 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a1 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a4 | 2 | 1 | 0 | src/cart | src, src/orders | True |
| t020 | green | a11 | 2 | 1 | 0 | src/auth | src/users | True |
| t021 | green | a10 | 2 | 1 | 0 | src/db | src/catalog | True |
| t022 | green | a0 | 2 | 1 | 0 | src/billing | src, src/billing | True |
| t023 | green | a1 | 2 | 1 | 0 | src/billing | src/billing, src/lib | True |
| t024 | green | a8 | 2 | 1 | 0 | src/db | src, src/billing, src/db | True |
| t025 | green | a7 | 1 | 1 | 0 | src/notifications | src/notifications | True |
| t026 | green | a6 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a9 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a6 | 1 | 1 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a1 | 1 | 1 | 0 | src/cart | src/orders | True |
| t030 | green | a9 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | green | a7 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t032 | dropped | a4 | 2 | 0 | 0 | src/billing | - | False |
| t033 | green | a10 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a8 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t035 | green | a9 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | dropped | a11 | 3 | 1 | 0 | src/billing | - | False |
| t037 | green | a5 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a0 | 0 | 0 | 0 | src/cart | src/billing | True |
| t039 | green | a10 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t040 | green | a8 | 0 | 0 | 0 | src/db | src/billing | True |
