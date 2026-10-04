# Race: beanstalk / claude

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 506.538 |
| Tasks green / landed / dropped / total | 36 / 36 / 4 / 40 |
| Drops by reason | pre-land check still red: 2; unresolved conflict: 2 |
| Wall-clock (min) | 4.26 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 2.01 / 2.55 |
| Agent minutes busy / blocked / idle | 22.98 / 1.87 / 26.33 |
| Invocations (initial / rework / fixer / classifier) | 40 / 27 / 0 / 0 |
| Cost USD (total) | 4.5007 |
| Cost USD by kind | initial 2.4670, rework 2.0336 |
| CI runs / minutes | 7 / 7.11 |
| CI runs by purpose | validate 7 |
| Textual conflicts met | 19 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 36 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 4 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6389 / 0.463 / 0.5139 |
| Footprint vs oracle: P / R / F1 | 0.6667 / 0.4676 / 0.5278 |
| Variant | pre-land check (repair before landing, same session) |
| Pre-land checks (red) / reworks / drops | 46 (10) / 8 / 2 |
| Pre-land check minutes | 0.77 |
| Placements disjoint / overlapping | 10 / 30 |
| Fast-trunk landings (task / fixer / revert) | 36 / 0 / 0 |
| Validations (green / red) | 7 / 0 |
| Repair tickets (closed / escalated / by method) | 0 / 0 / {} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 12,
  "ci_seconds": 60.0,
  "ci_slots": 2,
  "batch": null,
  "seed": 7,
  "budget_usd": 75.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": true,
  "snapshot": "green",
  "queue_hold": null,
  "error_budget": 3,
  "footprint": "predictor",
  "tasks": 40,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t001 | green | a0 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a9 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a1 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t004 | green | a10 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a2 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a11 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a5 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a3 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a10 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | dropped | a4 | 3 | 2 | 0 | src/db | - | False |
| t011 | dropped | a3 | 3 | 2 | 0 | src/orders | - | False |
| t012 | green | a5 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a6 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a0 | 1 | 1 | 0 | src/auth | src/auth | True |
| t015 | green | a2 | 0 | 0 | 0 | src/billing | src/billing | True |
| t016 | green | a11 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a8 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a9 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a7 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a6 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a2 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | green | a8 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t023 | green | a10 | 1 | 1 | 0 | src/billing | src/billing, src/lib | True |
| t024 | green | a5 | 3 | 2 | 0 | src/db | src, src/billing, src/db | True |
| t025 | green | a6 | 1 | 1 | 0 | src/notifications | src/notifications | True |
| t026 | green | a9 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a11 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a2 | 1 | 1 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a7 | 0 | 0 | 0 | src/cart | src/inventory, src/orders | True |
| t030 | green | a1 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | green | a7 | 2 | 1 | 0 | src/billing | src, src/billing, src/lib | True |
| t032 | dropped | a0 | 3 | 0 | 0 | src/billing | - | False |
| t033 | green | a8 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a9 | 1 | 1 | 0 | src/inventory | src/inventory | True |
| t035 | green | a11 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | dropped | a1 | 3 | 2 | 0 | src/billing | - | False |
| t037 | green | a11 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a8 | 1 | 1 | 0 | src/cart | src/billing | True |
| t039 | green | a9 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t040 | green | a6 | 1 | 1 | 0 | src/db | src/billing | True |
