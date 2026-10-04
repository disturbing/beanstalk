# Race: beanstalk / replay

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=replay (replay control: reference patches, synthetic timings)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 1198.723 |
| Tasks green / landed / dropped / total | 24 / 24 / 16 / 40 |
| Drops by reason | replay could not repair the pre-land failure (limitation of replay agents): 8; replay could not resolve the conflict (limitation of replay agents): 8 |
| Wall-clock (min) | 1.2 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 0.34 / 0.49 |
| Agent minutes busy / blocked / idle | 3.51 / 7.05 / 3.86 |
| Invocations (initial / rework / fixer / classifier) | 40 / 16 / 0 / 0 |
| Cost USD (total) | 0.0 |
| Cost USD by kind | initial 0.0000, rework 0.0000 |
| CI runs / minutes | 17 / 1.71 |
| CI runs by purpose | validate 17 |
| Textual conflicts met | 8 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 24 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6667 / 0.4549 / 0.5167 |
| Footprint vs oracle: P / R / F1 | 0.6667 / 0.4549 / 0.5167 |
| Variant | v2: pre-land check, informed author repair, decision cards, revert-first |
| Informed reworks / decision cards / revert-first tickets | 8 / 0 / 0 |
| Pre-land checks (red) / reworks / drops | 60 (8) / 8 / 0 |
| Pre-land check minutes | 6.23 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 4.5 / 19 / 23 / 3 |
| Placements disjoint / overlapping | 40 / 0 |
| Fast-trunk landings (task / fixer / revert) | 24 / 0 / 0 |
| Validations (green / red) | 17 / 0 |
| Repair tickets (closed / escalated / by method) | 0 / 0 / {} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 12,
  "ci_seconds": 4.5,
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
  "tasks": 40,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t001 | green | a0 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a1 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a2 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | dropped | a3 | 1 | 1 | 0 | src/billing | - | False |
| t005 | green | a4 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | dropped | a6 | 1 | 1 | 0 | src/orders | - | False |
| t008 | green | a7 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a8 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | green | a9 | 0 | 0 | 0 | src/db | src, src/billing, src/db, src/orders | True |
| t011 | dropped | a10 | 1 | 1 | 0 | src/orders | - | False |
| t012 | green | a11 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a4 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a9 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | dropped | a11 | 1 | 1 | 0 | src/billing | - | False |
| t016 | green | a0 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | dropped | a7 | 1 | 1 | 0 | src/orders | - | False |
| t018 | green | a6 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a3 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a10 | 0 | 0 | 0 | src/auth | src/auth, src/users | True |
| t021 | green | a1 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | dropped | a5 | 1 | 1 | 0 | src/billing | - | False |
| t023 | dropped | a4 | 1 | 0 | 0 | src/billing | - | False |
| t024 | dropped | a2 | 1 | 0 | 0 | src/db | - | False |
| t025 | dropped | a8 | 1 | 0 | 0 | src/notifications | - | False |
| t026 | green | a5 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | dropped | a6 | 1 | 1 | 0 | src/db | - | False |
| t028 | green | a0 | 0 | 0 | 0 | src/orders | src, src/shipping | True |
| t029 | dropped | a10 | 1 | 0 | 0 | src/cart | - | False |
| t030 | green | a9 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | dropped | a1 | 1 | 0 | 0 | src/billing | - | False |
| t032 | dropped | a11 | 1 | 0 | 0 | src/billing | - | False |
| t033 | green | a7 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | dropped | a5 | 1 | 0 | 0 | src/inventory | - | False |
| t035 | green | a4 | 0 | 0 | 0 | src/cart | src/cart, src/inventory | True |
| t036 | green | a6 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t037 | green | a3 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a8 | 0 | 0 | 0 | src/cart | src/billing | True |
| t039 | dropped | a9 | 1 | 1 | 0 | src/billing | - | False |
| t040 | dropped | a2 | 1 | 0 | 0 | src/db | - | False |
