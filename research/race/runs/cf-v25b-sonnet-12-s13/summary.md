# Race: beanstalk / claude

_forge: cloudflare, run eqvvbk61eo on https://beanstalk-gateway.devaccounts-1password.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 58.781 |
| Tasks green / landed / dropped / total | 29 / 33 / 11 / 40 |
| Drops by reason | pre-land check still red: 3; reverted: 4; unresolved conflict: 4 |
| Wall-clock (min) | 29.6 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 20.63 / 25.17 |
| Agent minutes busy / blocked / idle | 35.18 / 0 / 320.04 |
| Invocations (initial / rework / fixer / classifier) | 40 / 32 / 0 / 0 |
| Cost USD (total) | 6.8262 |
| Cost USD by kind | initial 1.9079, reconcile 0.0582, rework 4.8601 |
| CI runs / minutes | 38 / 45.61 |
| CI runs by purpose | validate 25, bisect 13 |
| Textual conflicts met | 21 |
| Red validations | 15 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 30 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.5758 / 0.4167 / 0.4616 |
| Footprint vs oracle: P / R / F1 | 0.6061 / 0.4167 / 0.4717 |
| Variant | v2.5: v2.4, with escalation after one repeated red, every landed party reconciled, lone suspects reverted at once, base and dynamic culprits, a wider window, structural merges, start cards and one rescue |
| Informed reworks / decision cards / revert-first tickets | 11 / 0 / 4 |
| Agent released on check / reworks that waited for an agent / wait minutes | yes / 0 / 0.0 |
| Validation re-runs / suspected flakes | 7 / 0 |
| Inherited reds waited out (no rework round spent) | 15 |
| Reconciles (reconciled / contradictions) / stale re-checks | 1 (1 / 0) / 2 |
| Escalate after (failed repairs) / reconcile parties / dropped stuck after a card | 1 / 3 / 0 |
| Start cards / rescues / dynamic culprit searches (probes) | off / off / off |
| Tests first (accepted / fallbacks) / targeted landing checks (red) | off / off |
| Sprout window at the end / window waits / early tickets / re-check samples | 12 / 54 / 0 / 2 |
| Spec amendments (amended / none / rejected / rolled back) / re-executions / adopted in place | 0 / 0 / 0 / 2 / 0 / 0 |
| Pre-land checks (red) / reworks / drops | 104 (32) / 11 / 3 |
| Pre-land check minutes | 128.33 |
| Re-check rule / skipped (adaptive) / hunk-disjoint / hunk-overlap | sampled / 7 / 0 / 0 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 30 / 20 / 0 |
| Placements disjoint / overlapping | 40 / 0 |
| Fast-trunk landings (task / fixer / revert) | 33 / 0 / 4 |
| Validations (green / red) | 10 / 8 |
| Repair tickets (closed / escalated / by method) | 0 / 4 / {'read-set': 4} |
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
| t001 | green | a9 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a0 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a3 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | green | a11 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a1 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a8 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | dropped | a7 | 3 | 2 | 0 | src/orders | - | False |
| t008 | green | a5 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a6 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | dropped | a4 | 3 | 2 | 0 | src/db | - | False |
| t011 | dropped | a10 | 0 | 0 | 0 | src/orders | src, src/db, src/orders, src/shipping | False |
| t012 | green | a2 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a2 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a5 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | dropped | a9 | 3 | 2 | 0 | src/billing | - | False |
| t016 | green | a3 | 2 | 1 | 0 | src/billing | src/billing | True |
| t017 | green | a8 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a6 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a11 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a0 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a10 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | dropped | a5 | 3 | 2 | 0 | src/billing | - | False |
| t023 | dropped | a3 | 2 | 1 | 0 | src/billing | - | False |
| t024 | green | a7 | 1 | 1 | 0 | src/db | src, src/billing, src/db | True |
| t025 | dropped | a0 | 3 | 2 | 0 | src/notifications | src/notifications | False |
| t026 | green | a8 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a6 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a0 | 1 | 1 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a2 | 0 | 0 | 0 | src/cart | src/inventory, src/orders | True |
| t030 | green | a5 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | dropped | a1 | 0 | 0 | 0 | src/billing | src, src/billing | False |
| t032 | dropped | a11 | 0 | 0 | 0 | src/billing | src, src/orders | False |
| t033 | green | a10 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | dropped | a1 | 3 | 2 | 0 | src/inventory | - | True |
| t035 | green | a8 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | dropped | a6 | 3 | 2 | 0 | src/billing | - | False |
| t037 | green | a5 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a7 | 0 | 0 | 0 | src/cart | src/billing | True |
| t039 | green | a2 | 2 | 1 | 0 | src/billing | src, src/billing | True |
| t040 | green | a1 | 3 | 2 | 0 | src/db | src/billing | True |
