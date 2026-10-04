# Race: beanstalk / claude

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

**Aborted:** rate limited (five_hour, resets at 1790995200): stopping rather than dropping tasks

| Metric | Value |
|---|---|
| Changes reaching green per hour | 364.88 |
| Tasks green / landed / dropped / total | 21 / 32 / 1 / 40 |
| Drops by reason | pre-land check still red: 1 |
| Wall-clock (min) | 3.45 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 2.07 / 2.37 |
| Agent minutes busy / blocked / idle | 27.35 / 12.01 / 2.07 |
| Invocations (initial / rework / fixer / classifier) | 39 / 18 / 0 / 0 |
| Cost USD (total) | 4.108 |
| Cost USD by kind | initial 2.0240, rework 1.8422 |
| CI runs / minutes | 6 / 6.1 |
| CI runs by purpose | validate 4, validate-cancelled 2 |
| Textual conflicts met | 18 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 21 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 2 |
| Footprint (predictor) vs actual: P / R / F1 | 0.625 / 0.4844 / 0.526 |
| Footprint vs oracle: P / R / F1 | 0.6562 / 0.4844 / 0.5365 |
| Variant | pre-land check (repair before landing, same session) |
| Pre-land checks (red) / reworks / drops | 36 (3) / 2 / 1 |
| Pre-land check minutes | 2.3 |
| Placements disjoint / overlapping | 10 / 30 |
| Fast-trunk landings (task / fixer / revert) | 33 / 0 / 0 |
| Validations (green / red) | 4 / 0 |
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
| t003 | green | a1 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | green | a10 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a2 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a11 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a0 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a3 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a10 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | dropped | a4 | 3 | 3 | 0 | src/db | - | False |
| t011 | rework | a3 | 2 | 2 | 0 | src/orders | - | False |
| t012 | green | a5 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a6 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a5 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a2 | 1 | 1 | 0 | src/billing | src/billing | True |
| t016 | green | a11 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a8 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a9 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a7 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a6 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a10 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | landed | a1 | 1 | 1 | 0 | src/billing | src, src/billing | False |
| t023 | landed | a8 | 1 | 1 | 0 | src/billing | src/billing, src/lib | False |
| t024 | running | a5 | 2 | 1 | 0 | src/db | - | False |
| t025 | landed | a11 | 1 | 1 | 0 | src/notifications | src/notifications | False |
| t026 | landed | a9 | 1 | 1 | 0 | src/billing | src/billing | False |
| t027 | green | a6 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | landed | a0 | 1 | 1 | 0 | src/orders | src, src/shipping | False |
| t029 | landed | a7 | 1 | 1 | 0 | src/cart | src/inventory, src/orders | False |
| t030 | landed | a10 | 0 | 0 | 0 | src/cart | src/orders | False |
| t031 | landed | a2 | 2 | 1 | 0 | src/billing | - | False |
| t032 | rework | a6 | 1 | 1 | 0 | src/billing | - | False |
| t033 | green | a8 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | landed | a10 | 1 | 1 | 0 | src/inventory | src/inventory | False |
| t035 | landed | a9 | 0 | 0 | 0 | src/cart | src/cart | False |
| t036 | rework | a7 | 1 | 1 | 0 | src/billing | - | False |
| t037 | landed | a8 | 0 | 0 | 0 | src/db | src/catalog | False |
| t038 | landed | a11 | 0 | 0 | 0 | src/cart | src/billing | False |
| t039 | rework | a1 | 1 | 1 | 0 | src/billing | - | False |
| t040 | running | a9 | 0 | 0 | 0 | src/db | - | False |
