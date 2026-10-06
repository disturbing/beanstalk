# Race: beanstalk / claude

_forge: cloudflare, run j6boaclinn on https://beanstalk-gateway.devaccounts-1password.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 74.02 |
| Tasks green / landed / dropped / total | 39 / 39 / 1 / 40 |
| Drops by reason | no progress for 10 minutes with only stuck beans left (tail_guard_minutes): 1 |
| Wall-clock (min) | 31.61 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 4.81 / 13.13 |
| Agent minutes busy / blocked / idle | 32.57 / 0 / 346.78 |
| Invocations (initial / rework / fixer / classifier) | 40 / 28 / 0 / 0 |
| Cost USD (total) | 6.0807 |
| Cost USD by kind | initial 2.3181, reconcile 0.2613, rework 3.2014, test-author 0.2999 |
| CI runs / minutes | 29 / 35.88 |
| CI runs by purpose | validate 23, bisect 6 |
| Textual conflicts met | 10 |
| Red validations | 4 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 39 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 6 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6667 / 0.4444 / 0.5034 |
| Footprint vs oracle: P / R / F1 | 0.6923 / 0.4573 / 0.5248 |
| Variant | v2.5: v2.4, with escalation after one repeated red, every landed party reconciled, lone suspects reverted at once, base and dynamic culprits, a wider window, structural merges, start cards and one rescue + dependency-aware starts |
| Informed reworks / decision cards / revert-first tickets | 11 / 8 / 2 |
| Agent released on check / reworks that waited for an agent / wait minutes | yes / 0 / 0.0 |
| Validation re-runs / suspected flakes | 2 / 0 |
| Inherited reds waited out (no rework round spent) | 1 |
| Reconciles (reconciled / contradictions) / stale re-checks | 5 (0 / 5) / 0 |
| Escalate after (failed repairs) / reconcile parties / dropped stuck after a card | 1 / 3 / 0 |
| Start cards / rescues / dynamic culprit searches (probes) | 3 / 2 / 7 (40) |
| Max bean invocations / tail guard minutes / dropped by each | 10 / 10 / 0 / 1 |
| Tests first (accepted / fallbacks) / targeted landing checks (red) | off / off |
| Sprout window at the end / window waits / early tickets / re-check samples | 16 / 20 / 0 / 1 |
| Spec amendments (amended / none / rejected / rolled back) / re-executions / adopted in place | 2 / 6 / 0 / 0 / 5 / 0 |
| Pre-land checks (red) / reworks / drops | 89 (19) / 11 / 1 |
| Pre-land check minutes | 113.22 |
| Re-check rule / skipped (adaptive) / hunk-disjoint / hunk-overlap | sampled / 4 / 0 / 0 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 34 / 24 / 0 |
| Placements disjoint / overlapping | 9 / 31 |
| Fast-trunk landings (task / fixer / revert) | 39 / 0 / 0 |
| Validations (green / red) | 19 / 2 |
| Repair tickets (closed / escalated / by method) | 1 / 2 / {'read-set': 2} |
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
| t001 | green | a10 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a5 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a8 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | green | a1 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a0 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a7 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a4 | 1 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a9 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a1 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | green | a0 | 5 | 1 | 0 | src/db | src, src/billing, src/db, src/users | True |
| t011 | green | a0 | 1 | 0 | 0 | src/orders | src, src/db, src/orders, src/shipping | True |
| t012 | green | a6 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a3 | 2 | 1 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a7 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a0 | 4 | 3 | 0 | src/billing | src/billing | True |
| t016 | green | a4 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a0 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a1 | 3 | 1 | 0 | src/orders | src/notifications | True |
| t019 | green | a11 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a10 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a6 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | green | a1 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t023 | green | a0 | 0 | 0 | 0 | src/billing | src/billing, src/lib | True |
| t024 | green | a5 | 0 | 0 | 0 | src/db | src, src/billing, src/db | True |
| t025 | green | a1 | 0 | 0 | 0 | src/notifications | src/notifications | True |
| t026 | green | a0 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a2 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a0 | 2 | 0 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a0 | 1 | 1 | 0 | src/cart | src/orders | True |
| t030 | green | a2 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | green | a1 | 2 | 1 | 0 | src/billing | src, src/billing, src/db | True |
| t032 | dropped | a0 | 4 | 0 | 0 | src/billing | - | False |
| t033 | green | a4 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a9 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t035 | green | a1 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | green | a1 | 2 | 1 | 0 | src/billing | src, src/billing, src/db | True |
| t037 | green | a1 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a2 | 1 | 1 | 0 | src/cart | src/billing | True |
| t039 | green | a0 | 0 | 0 | 0 | src/billing | src, src/billing, src/db | True |
| t040 | green | a3 | 0 | 0 | 0 | src/db | src/billing | True |
