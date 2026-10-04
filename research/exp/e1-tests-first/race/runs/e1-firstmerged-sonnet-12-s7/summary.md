# Race: beanstalk / claude

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 102.834 |
| Tasks green / landed / dropped / total | 37 / 37 / 3 / 40 |
| Drops by reason | declined by decision D001: 1; pre-land check still red: 1; unresolved conflict: 1 |
| Wall-clock (min) | 21.59 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 5.12 / 10.35 |
| Agent minutes busy / blocked / idle | 43.83 / 166.36 / 48.87 |
| Invocations (initial / rework / fixer / classifier) | 40 / 24 / 0 / 0 |
| Cost USD (total) | 7.9755 |
| Cost USD by kind | initial 2.2850, rework 2.1367, testauthor 3.5538 |
| CI runs / minutes | 29 / 30.11 |
| CI runs by purpose | validate 29 |
| Textual conflicts met | 16 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 31 / 40 |
| Final green correct (suite + every green task's acceptance) | False |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 2 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6757 / 0.4522 / 0.5135 |
| Footprint vs oracle: P / R / F1 | 0.6757 / 0.4595 / 0.5216 |
| Variant | v2, tests first: separate test author, fail-first proof, protected tests; arena tests hidden (oracle only) |
| Test-author sessions / proofs (rejected) / author drops | 40 / 40 (0) / 0 |
| Author files accepted / vacuous / broken; edits reverted / files removed | 40 / 0 / 0; 0 / 0 |
| Pre-land reds for missing bean tests | 0 |
| Merged-tree checks (E1_MERGED_CHECK): mode / checks (red) / landings after one / minutes | targeted / 89 (1) / 29 / 16.14 |
| Informed reworks / decision cards / revert-first tickets | 8 / 1 / 0 |
| Pre-land checks (red) / reworks / drops | 104 (9) / 8 / 1 |
| Pre-land check minutes | 108.27 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 0 / 42 / 6 |
| Placements disjoint / overlapping | 40 / 0 |
| Fast-trunk landings (task / fixer / revert) | 37 / 0 / 0 |
| Validations (green / red) | 29 / 0 |
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
| t001 | green | a0 | 0 | 0 | 0 | src/orders | src/billing, src/orders | True |
| t002 | green | a1 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a2 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a4 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a6 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | False |
| t008 | green | a7 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a8 | 1 | 1 | 0 | src/orders | src, src/orders | True |
| t010 | green | a9 | 2 | 2 | 0 | src/db | src, src/billing, src/db, src/orders, src/users | True |
| t011 | green | a10 | 3 | 2 | 0 | src/orders | src, src/db, src/notifications, src/orders, src/shipping | True |
| t012 | green | a11 | 0 | 0 | 0 | src/auth | src/auth | False |
| t013 | green | a4 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a7 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a11 | 1 | 1 | 0 | src/billing | src/billing | True |
| t016 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a6 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a5 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a0 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a1 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a7 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | green | a2 | 2 | 2 | 0 | src/billing | src, src/billing | True |
| t023 | green | a5 | 0 | 0 | 0 | src/billing | src/billing, src/lib | True |
| t024 | dropped | a3 | 3 | 2 | 0 | src/db | - | False |
| t025 | green | a1 | 1 | 1 | 0 | src/notifications | src/notifications | False |
| t026 | green | a7 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a0 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a4 | 0 | 0 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a9 | 0 | 0 | 0 | src/cart | src/inventory, src/orders | True |
| t030 | green | a6 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | green | a7 | 0 | 0 | 0 | src/billing | src, src/billing | False |
| t032 | dropped | a8 | 3 | 0 | 0 | src/billing | - | False |
| t033 | green | a5 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a0 | 1 | 1 | 0 | src/inventory | src/inventory | True |
| t035 | dropped | a1 | 2 | 0 | 0 | src/cart | - | False |
| t036 | green | a11 | 2 | 2 | 0 | src/billing | src, src/billing | False |
| t037 | green | a4 | 0 | 0 | 0 | src/db | src/catalog | False |
| t038 | green | a9 | 0 | 0 | 0 | src/cart | src/billing | True |
| t039 | green | a7 | 3 | 2 | 0 | src/billing | src, src/billing, src/lib | True |
| t040 | green | a5 | 0 | 0 | 0 | src/db | src/billing | True |
