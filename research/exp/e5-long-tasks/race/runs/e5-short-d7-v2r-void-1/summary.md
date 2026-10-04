# Race: beanstalk / claude

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

**Aborted:** rate limited (five_hour, resets at 1791031200): stopping rather than dropping tasks

| Metric | Value |
|---|---|
| Changes reaching green per hour | 87.433 |
| Tasks green / landed / dropped / total | 17 / 20 / 2 / 40 |
| Drops by reason | reverted: 2 |
| Wall-clock (min) | 11.67 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 4.28 / 8.96 |
| Agent minutes busy / blocked / idle | 139.84 / 0.13 / 0.03 |
| Invocations (initial / rework / fixer / classifier) | 37 / 13 / 0 / 0 |
| Cost USD (total) | 4.5245 |
| Cost USD by kind | initial 2.0627, rework 1.2254 |
| CI runs / minutes | 16 / 15.91 |
| CI runs by purpose | validate 12, bisect 3, validate-cancelled 1 |
| Textual conflicts met | 13 |
| Red validations | 5 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 17 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 1 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6 / 0.4542 / 0.495 |
| Footprint vs oracle: P / R / F1 | 0.65 / 0.5042 / 0.545 |
| Variant | v2r: v2 with the agent released while its change is checked (E5 extra) |
| Reworks that waited for an agent / total wait s / longest s | 24 / 1009.0 / 238.8 |
| Informed reworks / decision cards / revert-first tickets | 13 / 0 / 2 |
| Pre-land checks (red) / reworks / drops | 43 (13) / 13 / 0 |
| Pre-land check minutes | 43.43 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 19 / 5 / 0 |
| Placements disjoint / overlapping | 37 / 0 |
| Fast-trunk landings (task / fixer / revert) | 20 / 0 / 2 |
| Validations (green / red) | 7 / 5 |
| Repair tickets (closed / escalated / by method) | 0 / 2 / {'read-set': 2} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

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
| t003 | running | a2 | 2 | 1 | 0 | src/billing | - | False |
| t004 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a4 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | rework | a6 | 2 | 2 | 0 | src/orders | - | False |
| t008 | green | a7 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a8 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | rework | a9 | 3 | 3 | 0 | src/db | - | False |
| t011 | dropped | a10 | 0 | 0 | 0 | src/orders | src, src/db, src/orders, src/shipping | False |
| t012 | green | a11 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | rework | a11 | 2 | 1 | 0 | src/notifications | - | False |
| t014 | green | a3 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a4 | 0 | 0 | 0 | src/billing | src/billing | True |
| t016 | green | a7 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a0 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a5 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a8 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a1 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a9 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | rework | a10 | 1 | 0 | 0 | src/billing | - | False |
| t023 | rework | a6 | 1 | 0 | 0 | src/billing | - | False |
| t024 | rework | a0 | 1 | 1 | 0 | src/db | - | False |
| t025 | rework | a2 | 3 | 2 | 0 | src/notifications | - | False |
| t026 | dropped | a5 | 1 | 0 | 0 | src/billing | src/billing, src/notifications | False |
| t027 | green | a1 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | rework | a3 | 2 | 2 | 0 | src/orders | - | False |
| t029 | rework | a7 | 1 | 0 | 0 | src/cart | - | False |
| t030 | rework | a9 | 2 | 1 | 0 | src/cart | - | False |
| t031 | rework | a8 | 1 | 0 | 0 | src/billing | - | False |
| t032 | rework | a1 | 1 | 0 | 0 | src/billing | - | False |
| t033 | rework | a2 | 1 | 0 | 0 | src/shipping | - | False |
| t034 | running | a3 | 1 | 0 | 0 | src/inventory | - | False |
| t035 | rework | a9 | 1 | 0 | 0 | src/cart | - | False |
| t036 | running | a7 | 0 | 0 | 0 | src/billing | - | False |
| t037 | landed | a0 | 0 | 0 | 0 | src/db | src/catalog | False |
| t038 | pending | - | 0 | 0 | 0 | src/cart | - | False |
| t039 | pending | - | 0 | 0 | 0 | src/billing | - | False |
| t040 | pending | - | 0 | 0 | 0 | src/db | - | False |
