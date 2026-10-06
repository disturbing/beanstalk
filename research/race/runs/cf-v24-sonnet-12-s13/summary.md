# Race: beanstalk / claude

_forge: cloudflare, run y7wlrasqjy on https://beanstalk-gateway.devaccounts-1password.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 78.102 |
| Tasks green / landed / dropped / total | 33 / 36 / 7 / 40 |
| Drops by reason | pre-land check still red: 2; reverted: 3; unresolved conflict: 2 |
| Wall-clock (min) | 25.35 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 12.99 / 22.62 |
| Agent minutes busy / blocked / idle | 38.58 / 0 / 265.64 |
| Invocations (initial / rework / fixer / classifier) | 40 / 30 / 0 / 0 |
| Cost USD (total) | 5.8319 |
| Cost USD by kind | initial 2.0203, reconcile 0.0492, rework 3.7624 |
| CI runs / minutes | 32 / 38.55 |
| CI runs by purpose | validate 27, bisect 5 |
| Textual conflicts met | 24 |
| Red validations | 13 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 33 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 3 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6111 / 0.4375 / 0.488 |
| Footprint vs oracle: P / R / F1 | 0.6389 / 0.4375 / 0.4972 |
| Variant | v2.4: v2.3, with clashing tests reconciled before a card and stale reds re-checked |
| Informed reworks / decision cards / revert-first tickets | 6 / 0 / 3 |
| Agent released on check / reworks that waited for an agent / wait minutes | yes / 0 / 0.0 |
| Validation re-runs / suspected flakes | 5 / 0 |
| Inherited reds waited out (no rework round spent) | 35 |
| Reconciles (reconciled / contradictions) / stale re-checks | 1 (1 / 0) / 1 |
| Sprout window at the end / window waits / early tickets / re-check samples | 15 / 72 / 0 / 2 |
| Spec amendments (amended / none / rejected / rolled back) / re-executions / adopted in place | 0 / 0 / 0 / 1 / 0 / 0 |
| Pre-land checks (red) / reworks / drops | 133 (45) / 6 / 2 |
| Pre-land check minutes | 164.77 |
| Re-check rule / skipped (adaptive) / hunk-disjoint / hunk-overlap | sampled / 6 / 0 / 0 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 34 / 32 / 0 |
| Placements disjoint / overlapping | 40 / 0 |
| Fast-trunk landings (task / fixer / revert) | 36 / 0 / 3 |
| Validations (green / red) | 14 / 8 |
| Repair tickets (closed / escalated / by method) | 0 / 3 / {'read-set': 3} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 12,
  "ci_seconds": 60,
  "ci_slots": 2,
  "batch": null,
  "seed": 13,
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
| t001 | green | a10 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a7 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a0 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t004 | green | a8 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a2 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a0 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a11 | 2 | 2 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a9 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a5 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | dropped | a3 | 3 | 3 | 0 | src/db | - | False |
| t011 | green | a4 | 0 | 0 | 0 | src/orders | src, src/db, src/orders, src/shipping | True |
| t012 | green | a6 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a6 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a5 | 2 | 1 | 0 | src/auth | src/auth | True |
| t015 | green | a0 | 0 | 0 | 0 | src/billing | src/billing | True |
| t016 | green | a9 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a2 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | dropped | a10 | 0 | 0 | 0 | src/orders | src/notifications | False |
| t019 | green | a5 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a4 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a7 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | green | a0 | 3 | 2 | 0 | src/billing | src, src/billing | True |
| t023 | green | a3 | 1 | 1 | 0 | src/billing | src/billing, src/lib | True |
| t024 | dropped | a2 | 3 | 2 | 0 | src/db | - | False |
| t025 | dropped | a10 | 3 | 3 | 0 | src/notifications | - | False |
| t026 | green | a1 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a0 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a0 | 2 | 1 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a6 | 1 | 1 | 0 | src/cart | src/inventory, src/orders | True |
| t030 | green | a9 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | dropped | a4 | 0 | 0 | 0 | src/billing | src, src/billing | False |
| t032 | dropped | a1 | 2 | 0 | 0 | src/billing | src, src/orders | False |
| t033 | green | a5 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a10 | 1 | 1 | 0 | src/inventory | src/inventory | True |
| t035 | green | a0 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | dropped | a3 | 3 | 3 | 0 | src/billing | - | False |
| t037 | green | a7 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a9 | 1 | 1 | 0 | src/cart | src/billing | True |
| t039 | green | a11 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t040 | green | a8 | 1 | 1 | 0 | src/db | src/billing | True |
