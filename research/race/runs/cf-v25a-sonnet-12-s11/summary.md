# Race: beanstalk / claude

_forge: cloudflare, run 0sapn4n65r on https://beanstalk-gateway.devaccounts-1password.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 105.526 |
| Tasks green / landed / dropped / total | 33 / 35 / 7 / 40 |
| Drops by reason | reverted: 2; unresolved conflict: 5 |
| Wall-clock (min) | 18.76 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 9.29 / 12.75 |
| Agent minutes busy / blocked / idle | 28.95 / 0 / 196.2 |
| Invocations (initial / rework / fixer / classifier) | 40 / 26 / 0 / 0 |
| Cost USD (total) | 4.9616 |
| Cost USD by kind | initial 1.9952, reconcile 0.1220, rework 2.8445 |
| CI runs / minutes | 24 / 30.19 |
| CI runs by purpose | validate 21, bisect 3 |
| Textual conflicts met | 18 |
| Red validations | 10 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 34 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 4 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6 / 0.4476 / 0.4952 |
| Footprint vs oracle: P / R / F1 | 0.6286 / 0.4476 / 0.5048 |
| Variant | v2.5: v2.4, with escalation after one repeated red, every landed party reconciled, lone suspects reverted at once, base and dynamic culprits, a wider window, structural merges, start cards and one rescue |
| Informed reworks / decision cards / revert-first tickets | 8 / 0 / 2 |
| Agent released on check / reworks that waited for an agent / wait minutes | yes / 0 / 0.0 |
| Validation re-runs / suspected flakes | 4 / 0 |
| Inherited reds waited out (no rework round spent) | 11 |
| Reconciles (reconciled / contradictions) / stale re-checks | 1 (1 / 0) / 0 |
| Escalate after (failed repairs) / reconcile parties / dropped stuck after a card | 2 / 1 / 0 |
| Start cards / rescues / dynamic culprit searches (probes) | off / off / off |
| Tests first (accepted / fallbacks) / targeted landing checks (red) | off / off |
| Sprout window at the end / window waits / early tickets / re-check samples | 10 / 48 / 0 / 2 |
| Spec amendments (amended / none / rejected / rolled back) / re-executions / adopted in place | 0 / 0 / 0 / 0 / 0 / 0 |
| Pre-land checks (red) / reworks / drops | 101 (20) / 8 / 0 |
| Pre-land check minutes | 123.01 |
| Re-check rule / skipped (adaptive) / hunk-disjoint / hunk-overlap | sampled / 7 / 0 / 0 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 33 / 28 / 1 |
| Placements disjoint / overlapping | 40 / 0 |
| Fast-trunk landings (task / fixer / revert) | 35 / 0 / 2 |
| Validations (green / red) | 11 / 6 |
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
| t002 | green | a1 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a6 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | green | a7 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a8 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a11 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a4 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a2 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a9 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | dropped | a3 | 3 | 2 | 0 | src/db | - | False |
| t011 | dropped | a0 | 3 | 1 | 0 | src/orders | - | False |
| t012 | green | a5 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | dropped | a5 | 3 | 2 | 0 | src/notifications | - | False |
| t014 | green | a2 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a8 | 1 | 1 | 0 | src/billing | src/billing | True |
| t016 | green | a7 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a10 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a11 | 1 | 1 | 0 | src/orders | src/notifications | True |
| t019 | green | a9 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a1 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a0 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | green | a3 | 2 | 2 | 0 | src/billing | src, src/billing | True |
| t023 | dropped | a10 | 1 | 1 | 0 | src/billing | src/billing, src/lib | False |
| t024 | dropped | a6 | 3 | 2 | 0 | src/db | - | False |
| t025 | green | a4 | 0 | 0 | 0 | src/notifications | src/notifications | True |
| t026 | green | a8 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a11 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a2 | 1 | 1 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a7 | 0 | 0 | 0 | src/cart | src/inventory, src/orders | True |
| t030 | green | a1 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | dropped | a5 | 0 | 0 | 0 | src/billing | src, src/billing | False |
| t032 | green | a4 | 2 | 0 | 0 | src/billing | src, src/orders | True |
| t033 | green | a8 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | dropped | a0 | 3 | 2 | 0 | src/inventory | - | True |
| t035 | green | a9 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | green | a11 | 3 | 3 | 0 | src/billing | src, src/billing | True |
| t037 | green | a10 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a1 | 0 | 0 | 0 | src/cart | src/billing | True |
| t039 | green | a6 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t040 | green | a2 | 0 | 0 | 0 | src/db | src/billing | True |
