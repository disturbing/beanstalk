# Race: beanstalk / claude

_forge: cloudflare, run qpucqup50w on https://beanstalk-gateway.devaccounts-1password.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 57.863 |
| Tasks green / landed / dropped / total | 24 / 28 / 16 / 40 |
| Drops by reason | pre-land check still red: 11; reverted: 4; unresolved conflict: 1 |
| Wall-clock (min) | 24.89 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 24.46 / 24.86 |
| Agent minutes busy / blocked / idle | 34.9 / 0 / 263.74 |
| Invocations (initial / rework / fixer / classifier) | 40 / 36 / 0 / 0 |
| Cost USD (total) | 6.018 |
| Cost USD by kind | initial 2.4016, rework 3.6165 |
| CI runs / minutes | 36 / 46.34 |
| CI runs by purpose | validate 13, bisect 23 |
| Textual conflicts met | 17 |
| Red validations | 10 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 24 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6071 / 0.4435 / 0.4905 |
| Footprint vs oracle: P / R / F1 | 0.6429 / 0.4435 / 0.5024 |
| Variant | v2.2: pre-land check, adaptive re-check, agent released during checks, flake-confirmed revert-first, inherited reds waited out, cards that re-execute the loser |
| Informed reworks / decision cards / revert-first tickets | 19 / 0 / 4 |
| Agent released on check / reworks that waited for an agent / wait minutes | yes / 0 / 0.0 |
| Validation re-runs / suspected flakes | 4 / 0 |
| Inherited reds waited out (no rework round spent) | 0 |
| Spec amendments (amended / none / rejected / rolled back) / re-executions / adopted in place | 0 / 0 / 0 / 0 / 0 / 0 |
| Pre-land checks (red) / reworks / drops | 70 (30) / 19 / 11 |
| Pre-land check minutes | 88.19 |
| Re-check rule / skipped (adaptive) / hunk-disjoint / hunk-overlap | adaptive / 15 / 0 / 0 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 27 / 0 / 0 |
| Placements disjoint / overlapping | 40 / 0 |
| Fast-trunk landings (task / fixer / revert) | 28 / 0 / 4 |
| Validations (green / red) | 3 / 6 |
| Repair tickets (closed / escalated / by method) | 0 / 4 / {'read-set': 4} |
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
| t001 | green | a7 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a9 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a8 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | green | a6 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a10 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | dropped | a0 | 3 | 1 | 0 | src/orders | - | False |
| t008 | green | a4 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a0 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | dropped | a2 | 3 | 1 | 0 | src/db | - | False |
| t011 | green | a1 | 0 | 0 | 0 | src/orders | src, src/db, src/orders, src/shipping | True |
| t012 | green | a11 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a11 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a6 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | dropped | a4 | 3 | 2 | 0 | src/billing | - | False |
| t016 | green | a10 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a7 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | dropped | a0 | 0 | 0 | 0 | src/orders | src/notifications | False |
| t019 | green | a5 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a9 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a2 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | dropped | a1 | 3 | 3 | 0 | src/billing | - | False |
| t023 | dropped | a1 | 3 | 1 | 0 | src/billing | - | False |
| t024 | dropped | a5 | 3 | 2 | 0 | src/db | - | False |
| t025 | dropped | a7 | 3 | 2 | 0 | src/notifications | - | False |
| t026 | green | a8 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a0 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | dropped | a0 | 3 | 1 | 0 | src/orders | - | False |
| t029 | dropped | a10 | 3 | 1 | 0 | src/cart | - | False |
| t030 | green | a11 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | dropped | a2 | 0 | 0 | 0 | src/billing | src, src/billing | False |
| t032 | dropped | a9 | 0 | 0 | 0 | src/billing | src, src/orders | False |
| t033 | dropped | a0 | 0 | 0 | 0 | src/shipping | src/shipping | False |
| t034 | dropped | a8 | 3 | 1 | 0 | src/inventory | - | False |
| t035 | green | a7 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | dropped | a3 | 3 | 1 | 0 | src/billing | - | False |
| t037 | green | a5 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a11 | 0 | 0 | 0 | src/cart | src/billing | True |
| t039 | green | a1 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t040 | dropped | a9 | 3 | 1 | 0 | src/db | - | False |
