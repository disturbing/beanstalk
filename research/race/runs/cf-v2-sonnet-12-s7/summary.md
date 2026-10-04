# Race: beanstalk / claude

_forge: cloudflare, run 6mtlyi7rtx on https://beanstalk-gateway.devaccounts-1password.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 140.572 |
| Tasks green / landed / dropped / total | 34 / 34 / 6 / 40 |
| Drops by reason | declined by decision D001: 1; infrastructure failure: 4; pre-land check still red: 1 |
| Wall-clock (min) | 14.51 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 4.11 / 6.34 |
| Agent minutes busy / blocked / idle | 20.66 / 105.61 / 47.88 |
| Invocations (initial / rework / fixer / classifier) | 40 / 15 / 0 / 0 |
| Cost USD (total) | 3.4867 |
| Cost USD by kind | initial 2.4636, rework 1.0231 |
| CI runs / minutes | 17 / 22.15 |
| CI runs by purpose | validate 17 |
| Textual conflicts met | 7 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 34 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 2 |
| Footprint (predictor) vs actual: P / R / F1 | 0.7059 / 0.5024 / 0.5608 |
| Footprint vs oracle: P / R / F1 | 0.7353 / 0.5024 / 0.5706 |
| Variant | v2: pre-land check, informed author repair, decision cards, revert-first |
| Informed reworks / decision cards / revert-first tickets | 8 / 1 / 0 |
| Pre-land checks (red) / reworks / drops | 70 (10) / 8 / 1 |
| Pre-land check minutes | 94.23 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 31 / 22 / 0 |
| Placements disjoint / overlapping | 40 / 0 |
| Fast-trunk landings (task / fixer / revert) | 34 / 0 / 0 |
| Validations (green / red) | 17 / 0 |
| Repair tickets (closed / escalated / by method) | 0 / 0 / {} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 12,
  "ci_seconds": 60,
  "ci_slots": 2,
  "batch": null,
  "seed": 7,
  "budget_usd": 75,
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
| t001 | dropped | a2 | 0 | 0 | 0 | src/orders | - | False |
| t002 | green | a9 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a11 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t004 | green | a1 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a5 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a4 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a10 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a7 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a6 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | green | a8 | 2 | 2 | 0 | src/db | src, src/billing, src/db, src/users | True |
| t011 | dropped | a3 | 0 | 0 | 0 | src/orders | - | False |
| t012 | green | a0 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a4 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a5 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a7 | 0 | 0 | 0 | src/billing | src/billing | True |
| t016 | green | a0 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a10 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | dropped | a2 | 0 | 0 | 0 | src/orders | - | False |
| t019 | dropped | a3 | 0 | 0 | 0 | src/cart | - | False |
| t020 | green | a5 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a1 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | green | a4 | 1 | 0 | 0 | src/billing | src, src/billing | True |
| t023 | green | a10 | 0 | 0 | 0 | src/billing | src/billing, src/lib | True |
| t024 | green | a9 | 2 | 1 | 0 | src/db | src, src/billing, src/db | True |
| t025 | green | a6 | 0 | 0 | 0 | src/notifications | src/notifications | True |
| t026 | green | a7 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a5 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a0 | 0 | 0 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a2 | 1 | 1 | 0 | src/cart | src/orders | True |
| t030 | green | a3 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | green | a6 | 2 | 1 | 0 | src/billing | src, src/billing | True |
| t032 | dropped | a7 | 2 | 0 | 0 | src/billing | - | False |
| t033 | green | a1 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a5 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t035 | green | a11 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | dropped | a4 | 3 | 0 | 0 | src/billing | - | False |
| t037 | green | a1 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a5 | 1 | 1 | 0 | src/cart | src/billing | True |
| t039 | green | a9 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t040 | green | a11 | 0 | 0 | 0 | src/db | src/billing | True |
