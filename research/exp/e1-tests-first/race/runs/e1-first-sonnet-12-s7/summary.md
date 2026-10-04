# Race: beanstalk / claude

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 94.251 |
| Tasks green / landed / dropped / total | 30 / 33 / 10 / 40 |
| Drops by reason | declined by decision D001: 1; reverted: 3; unresolved conflict: 6 |
| Wall-clock (min) | 19.1 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 6.47 / 9.14 |
| Agent minutes busy / blocked / idle | 64.17 / 121.66 / 43.35 |
| Invocations (initial / rework / fixer / classifier) | 40 / 50 / 0 / 0 |
| Cost USD (total) | 11.5323 |
| Cost USD by kind | initial 2.3825, rework 5.7254, testauthor 3.4244 |
| CI runs / minutes | 27 / 28.42 |
| CI runs by purpose | validate 22, bisect 5 |
| Textual conflicts met | 20 |
| Red validations | 5 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 29 / 40 |
| Final green correct (suite + every green task's acceptance) | False |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 1 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6364 / 0.4682 / 0.5121 |
| Footprint vs oracle: P / R / F1 | 0.6364 / 0.4444 / 0.499 |
| Variant | v2, tests first: separate test author, fail-first proof, protected tests; arena tests hidden (oracle only) |
| Test-author sessions / proofs (rejected) / author drops | 40 / 40 (0) / 0 |
| Author files accepted / vacuous / broken; edits reverted / files removed | 40 / 0 / 0; 0 / 0 |
| Pre-land reds for missing bean tests | 0 |
| Informed reworks / decision cards / revert-first tickets | 29 / 1 / 3 |
| Pre-land checks (red) / reworks / drops | 102 (31) / 30 / 0 |
| Pre-land check minutes | 107.5 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 30 / 19 / 1 |
| Placements disjoint / overlapping | 40 / 0 |
| Fast-trunk landings (task / fixer / revert) | 33 / 0 / 3 |
| Validations (green / red) | 17 / 5 |
| Repair tickets (closed / escalated / by method) | 0 / 3 / {'read-set': 3} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 12,
  "ci_seconds": 60.0,
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
| t001 | green | a0 | 0 | 0 | 0 | src/orders | src/orders | True |
| t002 | green | a1 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | dropped | a2 | 3 | 2 | 0 | src/billing | - | False |
| t004 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a4 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | dropped | a6 | 3 | 2 | 0 | src/orders | - | False |
| t008 | green | a7 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a8 | 1 | 1 | 0 | src/orders | src, src/orders | True |
| t010 | green | a9 | 3 | 1 | 0 | src/db | src, src/billing, src/db, src/notifications, src/users | True |
| t011 | green | a10 | 0 | 0 | 0 | src/orders | src, src/db, src/orders, src/shipping | True |
| t012 | green | a11 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a7 | 2 | 1 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a4 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a11 | 0 | 0 | 0 | src/billing | src/billing | True |
| t016 | green | a5 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | dropped | a0 | 0 | 0 | 0 | src/orders | src/billing | False |
| t018 | dropped | a1 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a3 | 3 | 1 | 0 | src/cart | src, src/orders | True |
| t020 | green | a10 | 3 | 1 | 0 | src/auth | src/users | True |
| t021 | green | a4 | 3 | 1 | 0 | src/db | src/catalog, src/notifications | True |
| t022 | dropped | a5 | 3 | 2 | 0 | src/billing | - | False |
| t023 | green | a0 | 2 | 1 | 0 | src/billing | src/billing, src/lib | True |
| t024 | dropped | a1 | 3 | 2 | 0 | src/db | - | False |
| t025 | dropped | a8 | 3 | 2 | 0 | src/notifications | - | False |
| t026 | green | a11 | 2 | 1 | 0 | src/billing | src/billing | True |
| t027 | green | a9 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a1 | 0 | 0 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a6 | 0 | 0 | 0 | src/cart | src/inventory, src/orders | True |
| t030 | green | a7 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | green | a10 | 0 | 0 | 0 | src/billing | src, src/billing | False |
| t032 | dropped | a0 | 2 | 0 | 0 | src/billing | - | False |
| t033 | green | a3 | 2 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a11 | 3 | 1 | 0 | src/inventory | src/inventory | True |
| t035 | dropped | a2 | 0 | 0 | 0 | src/cart | src/cart | False |
| t036 | dropped | a4 | 3 | 1 | 0 | src/billing | - | False |
| t037 | green | a8 | 0 | 0 | 0 | src/db | src/catalog | False |
| t038 | green | a9 | 2 | 0 | 0 | src/cart | src/billing | True |
| t039 | green | a6 | 2 | 0 | 0 | src/billing | src, src/billing, src/lib | True |
| t040 | green | a5 | 2 | 0 | 0 | src/db | src/orders | True |
