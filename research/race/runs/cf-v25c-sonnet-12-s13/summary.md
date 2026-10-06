# Race: beanstalk / claude

_forge: cloudflare, run s1kx9ldcme on https://beanstalk-gateway.devaccounts-1password.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 103.31 |
| Tasks green / landed / dropped / total | 34 / 36 / 6 / 40 |
| Drops by reason | pre-land check still red: 3; reverted: 2; unresolved conflict: 1 |
| Wall-clock (min) | 19.75 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 7.57 / 15.76 |
| Agent minutes busy / blocked / idle | 31.21 / 0 / 205.74 |
| Invocations (initial / rework / fixer / classifier) | 40 / 26 / 0 / 0 |
| Cost USD (total) | 5.4475 |
| Cost USD by kind | initial 1.9399, reconcile 0.1755, rework 3.3022, test-author 0.0300 |
| CI runs / minutes | 24 / 31.34 |
| CI runs by purpose | validate 19, bisect 5 |
| Textual conflicts met | 14 |
| Red validations | 7 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 34 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6389 / 0.4593 / 0.5093 |
| Footprint vs oracle: P / R / F1 | 0.6667 / 0.4606 / 0.5204 |
| Variant | v2.5: v2.4, with escalation after one repeated red, every landed party reconciled, lone suspects reverted at once, base and dynamic culprits, a wider window, structural merges, start cards and one rescue |
| Informed reworks / decision cards / revert-first tickets | 11 / 1 / 3 |
| Agent released on check / reworks that waited for an agent / wait minutes | yes / 0 / 0.0 |
| Validation re-runs / suspected flakes | 3 / 0 |
| Inherited reds waited out (no rework round spent) | 14 |
| Reconciles (reconciled / contradictions) / stale re-checks | 2 (2 / 0) / 1 |
| Escalate after (failed repairs) / reconcile parties / dropped stuck after a card | 1 / 3 / 0 |
| Start cards / rescues / dynamic culprit searches (probes) | off / off / off |
| Tests first (accepted / fallbacks) / targeted landing checks (red) | off / off |
| Sprout window at the end / window waits / early tickets / re-check samples | 6 / 59 / 0 / 1 |
| Spec amendments (amended / none / rejected / rolled back) / re-executions / adopted in place | 0 / 1 / 0 / 2 / 1 / 0 |
| Pre-land checks (red) / reworks / drops | 115 (32) / 11 / 3 |
| Pre-land check minutes | 144.3 |
| Re-check rule / skipped (adaptive) / hunk-disjoint / hunk-overlap | sampled / 5 / 0 / 0 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 35 / 34 / 0 |
| Placements disjoint / overlapping | 40 / 0 |
| Fast-trunk landings (task / fixer / revert) | 36 / 0 / 2 |
| Validations (green / red) | 12 / 4 |
| Repair tickets (closed / escalated / by method) | 1 / 3 / {'read-set': 3} |
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
| t001 | green | a1 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a5 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | dropped | a6 | 3 | 1 | 0 | src/billing | - | False |
| t004 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a7 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a2 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a0 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a10 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a11 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | dropped | a9 | 3 | 1 | 0 | src/db | - | False |
| t011 | dropped | a0 | 2 | 2 | 0 | src/orders | src, src/db, src/notifications, src/orders, src/shipping | False |
| t012 | green | a8 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a8 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a10 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a7 | 2 | 2 | 0 | src/billing | src/billing | True |
| t016 | green | a1 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a3 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a2 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a11 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a9 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a0 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | green | a4 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t023 | green | a5 | 1 | 1 | 0 | src/billing | src/billing, src/lib | True |
| t024 | green | a3 | 2 | 1 | 0 | src/db | src, src/billing, src/db | True |
| t025 | green | a7 | 2 | 1 | 0 | src/notifications | src/notifications | True |
| t026 | green | a2 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a6 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a10 | 1 | 1 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a8 | 0 | 0 | 0 | src/cart | src/inventory, src/orders | True |
| t030 | green | a9 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | dropped | a1 | 0 | 0 | 0 | src/billing | src, src/billing | False |
| t032 | dropped | a2 | 4 | 0 | 0 | src/billing | - | False |
| t033 | green | a11 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a1 | 1 | 1 | 0 | src/inventory | src/inventory | True |
| t035 | green | a6 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | dropped | a2 | 3 | 1 | 0 | src/billing | - | False |
| t037 | green | a3 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a5 | 0 | 0 | 0 | src/cart | src/billing | True |
| t039 | green | a9 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t040 | green | a4 | 1 | 1 | 0 | src/db | src/billing | True |
