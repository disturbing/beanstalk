# Race: beanstalk / mixed

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=mixed (sonnet+codex-default)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 141.714 |
| Tasks green / landed / dropped / total | 36 / 36 / 4 / 40 |
| Drops by reason | pre-land check still red: 1; unresolved conflict: 3 |
| Wall-clock (min) | 15.24 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 4.3 / 7.02 |
| Agent minutes busy / blocked / idle | 38.74 / 92.02 / 52.15 |
| Invocations (initial / rework / fixer / classifier) | 40 / 33 / 0 / 0 |
| Cost USD (total) | 4.5501 |
| Cost USD by kind | initial 2.0706, rework 2.4796 |
| CI runs / minutes | 23 / 23.29 |
| CI runs by purpose | validate 18, bisect 5 |
| Textual conflicts met | 21 |
| Red validations | 3 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 36 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 1 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6389 / 0.4444 / 0.4991 |
| Footprint vs oracle: P / R / F1 | 0.6667 / 0.4514 / 0.5158 |
| Variant | v2: pre-land check, informed author repair, decision cards, revert-first |
| Informed reworks / decision cards / revert-first tickets | 12 / 0 / 1 |
| Pre-land checks (red) / reworks / drops | 84 (13) / 12 / 1 |
| Pre-land check minutes | 84.97 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 31 / 21 / 1 |
| Placements disjoint / overlapping | 40 / 0 |
| Fast-trunk landings (task / fixer / revert) | 36 / 0 / 0 |
| Validations (green / red) | 15 / 3 |
| Repair tickets (closed / escalated / by method) | 1 / 1 / {'read-set': 1} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 12,
  "ci_seconds": 60.0,
  "ci_slots": 2,
  "batch": null,
  "seed": 7,
  "budget_usd": 15.0,
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
| t004 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a4 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | dropped | a6 | 3 | 2 | 0 | src/orders | - | False |
| t008 | green | a7 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a8 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | dropped | a9 | 3 | 2 | 0 | src/db | - | False |
| t011 | green | a10 | 0 | 0 | 0 | src/orders | src, src/db, src/orders, src/shipping | True |
| t012 | green | a11 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a0 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a4 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a8 | 1 | 1 | 0 | src/billing | src/billing | True |
| t016 | green | a2 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a11 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a7 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a1 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a5 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a4 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | green | a0 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t023 | green | a11 | 1 | 1 | 0 | src/billing | src/billing, src/lib, src/notifications | True |
| t024 | green | a10 | 3 | 2 | 0 | src/db | src, src/billing, src/db, src/lib | True |
| t025 | dropped | a3 | 3 | 3 | 0 | src/notifications | - | False |
| t026 | green | a1 | 2 | 1 | 0 | src/billing | src/billing | True |
| t027 | green | a2 | 2 | 1 | 0 | src/db | src/notifications, src/users | True |
| t028 | green | a4 | 3 | 2 | 0 | src/orders | src, src/db, src/shipping | True |
| t029 | green | a7 | 2 | 1 | 0 | src/cart | src/notifications, src/orders, src/shipping | True |
| t030 | green | a5 | 2 | 1 | 0 | src/cart | src/orders | True |
| t031 | green | a8 | 3 | 2 | 0 | src/billing | src, src/billing | True |
| t032 | dropped | a0 | 3 | 1 | 0 | src/billing | - | False |
| t033 | green | a11 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a11 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t035 | green | a2 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | green | a5 | 2 | 1 | 0 | src/billing | src, src/billing | True |
| t037 | green | a1 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a10 | 0 | 0 | 0 | src/cart | src/billing | True |
| t039 | green | a6 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t040 | green | a9 | 0 | 0 | 0 | src/db | src/billing | True |
