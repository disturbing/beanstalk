# Race: beanstalk / claude

_forge: cloudflare, run ov5lpls6dh on https://beanstalk-gateway.devaccounts-1password.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 111.08 |
| Tasks green / landed / dropped / total | 32 / 34 / 8 / 40 |
| Drops by reason | reverted: 2; unresolved conflict: 6 |
| Wall-clock (min) | 17.28 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 10.99 / 15.76 |
| Agent minutes busy / blocked / idle | 37.27 / 0 / 170.14 |
| Invocations (initial / rework / fixer / classifier) | 40 / 35 / 0 / 0 |
| Cost USD (total) | 5.7529 |
| Cost USD by kind | initial 2.0182, reconcile 0.0431, rework 3.6916 |
| CI runs / minutes | 22 / 26.77 |
| CI runs by purpose | validate 19, bisect 3 |
| Textual conflicts met | 26 |
| Red validations | 5 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 33 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6765 / 0.4853 / 0.5382 |
| Footprint vs oracle: P / R / F1 | 0.7059 / 0.4853 / 0.548 |
| Variant | v2.4: v2.3, with clashing tests reconciled before a card and stale reds re-checked |
| Informed reworks / decision cards / revert-first tickets | 9 / 0 / 2 |
| Agent released on check / reworks that waited for an agent / wait minutes | yes / 0 / 0.0 |
| Validation re-runs / suspected flakes | 2 / 0 |
| Inherited reds waited out (no rework round spent) | 21 |
| Reconciles (reconciled / contradictions) / stale re-checks | 1 (1 / 0) / 4 |
| Sprout window at the end / window waits / early tickets / re-check samples | 16 / 67 / 0 / 2 |
| Spec amendments (amended / none / rejected / rolled back) / re-executions / adopted in place | 0 / 0 / 0 / 1 / 0 / 0 |
| Pre-land checks (red) / reworks / drops | 115 (35) / 9 / 0 |
| Pre-land check minutes | 140.49 |
| Re-check rule / skipped (adaptive) / hunk-disjoint / hunk-overlap | sampled / 6 / 0 / 0 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 33 / 24 / 0 |
| Placements disjoint / overlapping | 40 / 0 |
| Fast-trunk landings (task / fixer / revert) | 34 / 0 / 2 |
| Validations (green / red) | 14 / 3 |
| Repair tickets (closed / escalated / by method) | 0 / 2 / {'read-set': 2} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 12,
  "ci_seconds": 60,
  "ci_slots": 2,
  "batch": null,
  "seed": 11,
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
| t002 | green | a2 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | green | a0 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a9 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a4 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a1 | 2 | 2 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a6 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a11 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | green | a3 | 1 | 1 | 0 | src/db | src, src/billing, src/db, src/users | True |
| t011 | green | a7 | 0 | 0 | 0 | src/orders | src, src/db, src/orders, src/shipping | True |
| t012 | green | a8 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a8 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a9 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a6 | 2 | 2 | 0 | src/billing | src/billing | True |
| t016 | green | a0 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a4 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | dropped | a10 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a2 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a11 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a7 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | green | a1 | 2 | 2 | 0 | src/billing | src, src/billing | True |
| t023 | dropped | a2 | 3 | 2 | 0 | src/billing | - | False |
| t024 | dropped | a4 | 3 | 2 | 0 | src/db | - | False |
| t025 | green | a6 | 3 | 3 | 0 | src/notifications | src/notifications | True |
| t026 | green | a5 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a8 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a0 | 3 | 3 | 0 | src/orders | src, src/notifications, src/shipping | True |
| t029 | dropped | a10 | 3 | 2 | 0 | src/cart | - | False |
| t030 | green | a9 | 2 | 1 | 0 | src/cart | src/orders | True |
| t031 | dropped | a11 | 0 | 0 | 0 | src/billing | src, src/billing | False |
| t032 | dropped | a7 | 2 | 0 | 0 | src/billing | - | False |
| t033 | green | a0 | 2 | 1 | 0 | src/shipping | src/shipping | True |
| t034 | green | a2 | 1 | 1 | 0 | src/inventory | src/inventory | True |
| t035 | green | a5 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | dropped | a8 | 3 | 2 | 0 | src/billing | - | False |
| t037 | green | a6 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a9 | 0 | 0 | 0 | src/cart | src/billing | True |
| t039 | green | a1 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t040 | dropped | a1 | 3 | 2 | 0 | src/db | - | False |
