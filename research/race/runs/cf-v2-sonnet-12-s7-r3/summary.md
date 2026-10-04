# Race: beanstalk / claude

_forge: cloudflare, run 7z4j84eqvl on https://beanstalk-gateway.devaccounts-1password.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 119.944 |
| Tasks green / landed / dropped / total | 35 / 35 / 5 / 40 |
| Drops by reason | declined by decision D001: 1; pre-land check still red: 1; unresolved conflict: 3 |
| Wall-clock (min) | 17.51 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 5.14 / 8.12 |
| Agent minutes busy / blocked / idle | 33.61 / 124.35 / 52.15 |
| Invocations (initial / rework / fixer / classifier) | 40 / 35 / 0 / 0 |
| Cost USD (total) | 5.0014 |
| Cost USD by kind | initial 2.5986, rework 2.4027 |
| CI runs / minutes | 23 / 28.67 |
| CI runs by purpose | validate 20, bisect 3 |
| Textual conflicts met | 18 |
| Red validations | 3 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 35 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 1 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6286 / 0.4643 / 0.5114 |
| Footprint vs oracle: P / R / F1 | 0.6571 / 0.4643 / 0.521 |
| Variant | v2: pre-land check, informed author repair, decision cards, revert-first |
| Informed reworks / decision cards / revert-first tickets | 16 / 1 / 1 |
| Pre-land checks (red) / reworks / drops | 91 (19) / 17 / 1 |
| Pre-land check minutes | 111.5 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 31 / 18 / 1 |
| Placements disjoint / overlapping | 40 / 0 |
| Fast-trunk landings (task / fixer / revert) | 35 / 0 / 0 |
| Validations (green / red) | 17 / 3 |
| Repair tickets (closed / escalated / by method) | 0 / 1 / {'read-set': 1} |
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
| t001 | green | a2 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a1 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a6 | 3 | 2 | 0 | src/billing | src, src/billing | True |
| t004 | green | a10 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a9 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | dropped | a3 | 3 | 1 | 0 | src/billing | - | False |
| t007 | dropped | a8 | 3 | 2 | 0 | src/orders | - | False |
| t008 | green | a0 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a5 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | dropped | a11 | 3 | 3 | 0 | src/db | - | False |
| t011 | green | a4 | 0 | 0 | 0 | src/orders | src, src/db, src/orders, src/shipping | True |
| t012 | green | a7 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a9 | 3 | 2 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a0 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a10 | 0 | 0 | 0 | src/billing | src/billing | True |
| t016 | green | a7 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a5 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a2 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a1 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a10 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a0 | 1 | 0 | 0 | src/db | src/catalog, src/notifications, src/shipping | True |
| t022 | green | a4 | 2 | 1 | 0 | src/billing | src, src/billing | True |
| t023 | green | a7 | 1 | 0 | 0 | src/billing | src/billing, src/lib | True |
| t024 | green | a5 | 2 | 1 | 0 | src/db | src, src/billing, src/db | True |
| t025 | green | a2 | 2 | 1 | 0 | src/notifications | src/notifications | True |
| t026 | green | a1 | 2 | 1 | 0 | src/billing | src/billing | True |
| t027 | green | a10 | 2 | 1 | 0 | src/db | src/users | True |
| t028 | green | a0 | 0 | 0 | 0 | src/orders | src, src/db, src/shipping | True |
| t029 | green | a7 | 1 | 1 | 0 | src/cart | src/orders | True |
| t030 | green | a0 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | green | a10 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t032 | dropped | a4 | 2 | 0 | 0 | src/billing | - | False |
| t033 | green | a8 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a2 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t035 | green | a11 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | dropped | a1 | 3 | 0 | 0 | src/billing | - | False |
| t037 | green | a3 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a6 | 1 | 1 | 0 | src/cart | src/billing | True |
| t039 | green | a0 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t040 | green | a8 | 0 | 0 | 0 | src/db | src/billing | True |
