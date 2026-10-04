# Race: beanstalk / claude

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 143.983 |
| Tasks green / landed / dropped / total | 36 / 37 / 4 / 40 |
| Drops by reason | declined by decision D001: 1; pre-land check still red: 1; reverted: 1; unresolved conflict: 1 |
| Wall-clock (min) | 15.0 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 3.77 / 6.25 |
| Agent minutes busy / blocked / idle | 21.47 / 107.15 / 51.4 |
| Invocations (initial / rework / fixer / classifier) | 40 / 20 / 0 / 0 |
| Cost USD (total) | 4.4392 |
| Cost USD by kind | initial 2.1556, rework 2.2836 |
| CI runs / minutes | 22 / 22.41 |
| CI runs by purpose | validate 22 |
| Textual conflicts met | 11 |
| Red validations | 4 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 36 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 4 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6216 / 0.455 / 0.4811 |
| Footprint vs oracle: P / R / F1 | 0.6757 / 0.4617 / 0.5243 |
| Variant | v2: pre-land check, informed author repair, decision cards, revert-first |
| Informed reworks / decision cards / revert-first tickets | 9 / 1 / 1 |
| Validation re-runs (absorbed / total) / wrongful reverts | 2 / 3 / 1 |
| Pre-land checks (red) / reworks / drops | 99 (27) / 9 / 1 |
| Pre-land check minutes | 101.51 |
| Pre-land re-runs (absorbed / total) / needless reworks | 5 / 16 / 0 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 34 / 26 / 1 |
| Placements disjoint / overlapping | 40 / 0 |
| Fast-trunk landings (task / fixer / revert) | 37 / 0 / 1 |
| Validations (green / red) | 18 / 1 |
| Repair tickets (closed / escalated / by method) | 0 / 1 / {'read-set': 1} |
| Error-budget pauses / paused minutes | 0 / 0.0 |
| Machine load average, 1 min (start / mean / max / end) on 18 cores | 5.9 / 16.1 / 41.9 / 6.8 |
| Flake model (rate per run / seed / pool) | 0.05 / 7 / 6 |
| Mitigations (re-run pre-land / re-run validation / retry batch / quarantine flips) | True / True / False / 0 |
| CI runs flaked (of all runs) / by purpose | 9 of 121 / {'preland': 5, 'validate': 4} |
| Re-runs: absorbed / total (by purpose) | 7 / 19 (preland 5/16, validate 2/3) |
| Needless reworks (flake-only reds) / their cost USD | 0 / 0 |
| Wrongful reverts / reverts | 1 / 1 |
| Flaked validations: tickets opened / exonerated by a later green / reverted | 3: 1 / 0 / 1 |
| Flaky tests found (flips) | src/shipping/shipping.test.ts > classifies destinations relative to the home country x1, src/orders/checkout.test.ts > turns the cart into a confirmed, invoiced order and empties the cart x3, src/shipping/shipping.test.ts > adds a charge for every started kilogram after the first x3, src/notifications/notifications.test.ts > shows a customer their own notifications, newest first x2 |

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
| t003 | green | a2 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t004 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a4 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a6 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a7 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a8 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | green | a9 | 3 | 2 | 0 | src/db | src, src/billing, src/db, src/users | True |
| t011 | dropped | a10 | 3 | 2 | 0 | src/orders | - | False |
| t012 | green | a11 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a11 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a7 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t016 | green | a0 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a4 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a8 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a1 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a3 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a6 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | green | a7 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t023 | green | a4 | 0 | 0 | 0 | src/billing | src/billing, src/lib | True |
| t024 | green | a8 | 3 | 2 | 0 | src/db | src, src/billing, src/db, src/lib | True |
| t025 | green | a5 | 2 | 1 | 0 | src/notifications | src/notifications | True |
| t026 | green | a0 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a3 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a6 | 0 | 0 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a1 | 0 | 0 | 0 | src/cart | src/inventory, src/orders | True |
| t030 | green | a11 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | dropped | a3 | 3 | 2 | 0 | src/billing | src, src/billing, src/lib | False |
| t032 | dropped | a1 | 2 | 0 | 0 | src/billing | - | False |
| t033 | green | a2 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a7 | 0 | 0 | 0 | src/inventory | - | True |
| t035 | green | a0 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | dropped | a4 | 3 | 1 | 0 | src/billing | - | False |
| t037 | green | a11 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a6 | 0 | 0 | 0 | src/cart | src/billing | True |
| t039 | green | a7 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t040 | green | a0 | 0 | 0 | 0 | src/db | src/billing | True |
