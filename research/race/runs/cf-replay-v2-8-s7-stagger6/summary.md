# Race: beanstalk / replay

_forge: cloudflare, run 8b631jl0w3 on https://beanstalk-gateway.devaccounts-1password.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=replay (replay control: reference patches, synthetic timings)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 58.387 |
| Tasks green / landed / dropped / total | 8 / 8 / 32 / 40 |
| Drops by reason | agent failed to run: 32 |
| Wall-clock (min) | 8.22 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 1.4 / 2.21 |
| Agent minutes busy / blocked / idle | 32.26 / 24.99 / 8.52 |
| Invocations (initial / rework / fixer / classifier) | 104 / 0 / 0 / 0 |
| Cost USD (total) | 0 |
| Cost USD by kind | initial 0.0000 |
| CI runs / minutes | 8 / 3 |
| CI runs by purpose | validate 8 |
| Textual conflicts met | 0 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 8 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.875 / 0.5833 / 0.6667 |
| Footprint vs oracle: P / R / F1 | 0.875 / 0.5833 / 0.6667 |
| Variant | v2: pre-land check, informed author repair, decision cards, revert-first |
| Informed reworks / decision cards / revert-first tickets | 0 / 0 / 0 |
| Pre-land checks (red) / reworks / drops | 14 (0) / 0 / 0 |
| Pre-land check minutes | 4.64 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 4.5 / 6 / 6 / 1 |
| Placements disjoint / overlapping | 40 / 0 |
| Fast-trunk landings (task / fixer / revert) | 8 / 0 / 0 |
| Validations (green / red) | 8 / 0 |
| Repair tickets (closed / escalated / by method) | 0 / 0 / {} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 8,
  "ci_seconds": 4.5,
  "ci_slots": 2,
  "batch": null,
  "seed": 7,
  "budget_usd": 25,
  "max_turns": 40,
  "agent_timeout": 900,
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
| t004 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a4 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a6 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a7 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | dropped | a0 | 0 | 0 | 0 | src/orders | - | False |
| t010 | dropped | a1 | 0 | 0 | 0 | src/db | - | False |
| t011 | dropped | a3 | 0 | 0 | 0 | src/orders | - | False |
| t012 | dropped | a4 | 0 | 0 | 0 | src/auth | - | False |
| t013 | dropped | a6 | 0 | 0 | 0 | src/notifications | - | False |
| t014 | dropped | a2 | 0 | 0 | 0 | src/auth | - | False |
| t015 | dropped | a7 | 0 | 0 | 0 | src/billing | - | False |
| t016 | dropped | a5 | 0 | 0 | 0 | src/billing | - | False |
| t017 | dropped | a1 | 0 | 0 | 0 | src/orders | - | False |
| t018 | dropped | a0 | 0 | 0 | 0 | src/orders | - | False |
| t019 | dropped | a3 | 0 | 0 | 0 | src/cart | - | False |
| t020 | dropped | a4 | 0 | 0 | 0 | src/auth | - | False |
| t021 | dropped | a6 | 0 | 0 | 0 | src/db | - | False |
| t022 | dropped | a2 | 0 | 0 | 0 | src/billing | - | False |
| t023 | dropped | a7 | 0 | 0 | 0 | src/billing | - | False |
| t024 | dropped | a5 | 0 | 0 | 0 | src/db | - | False |
| t025 | dropped | a1 | 0 | 0 | 0 | src/notifications | - | False |
| t026 | dropped | a3 | 0 | 0 | 0 | src/billing | - | False |
| t027 | dropped | a0 | 0 | 0 | 0 | src/db | - | False |
| t028 | dropped | a6 | 0 | 0 | 0 | src/orders | - | False |
| t029 | dropped | a4 | 0 | 0 | 0 | src/cart | - | False |
| t030 | dropped | a2 | 0 | 0 | 0 | src/cart | - | False |
| t031 | dropped | a5 | 0 | 0 | 0 | src/billing | - | False |
| t032 | dropped | a7 | 0 | 0 | 0 | src/billing | - | False |
| t033 | dropped | a1 | 0 | 0 | 0 | src/shipping | - | False |
| t034 | dropped | a3 | 0 | 0 | 0 | src/inventory | - | False |
| t035 | dropped | a0 | 0 | 0 | 0 | src/cart | - | False |
| t036 | dropped | a6 | 0 | 0 | 0 | src/billing | - | False |
| t037 | dropped | a4 | 0 | 0 | 0 | src/db | - | False |
| t038 | dropped | a2 | 0 | 0 | 0 | src/cart | - | False |
| t039 | dropped | a7 | 0 | 0 | 0 | src/billing | - | False |
| t040 | dropped | a3 | 0 | 0 | 0 | src/db | - | False |
