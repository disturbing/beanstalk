# Race: beanstalk / claude

_forge: cloudflare, run ed2f1pbpef on https://beanstalk-gateway.devaccounts-1password.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 90.562 |
| Tasks green / landed / dropped / total | 34 / 36 / 6 / 40 |
| Drops by reason | pre-land check still red: 1; reverted: 2; unresolved conflict: 3 |
| Wall-clock (min) | 22.53 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 9.1 / 18.62 |
| Agent minutes busy / blocked / idle | 35.85 / 0 / 234.47 |
| Invocations (initial / rework / fixer / classifier) | 40 / 32 / 0 / 0 |
| Cost USD (total) | 5.5987 |
| Cost USD by kind | initial 1.9807, reconcile 0.0909, rework 3.5270 |
| CI runs / minutes | 26 / 32 |
| CI runs by purpose | validate 20, bisect 6 |
| Textual conflicts met | 23 |
| Red validations | 8 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 34 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 2 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6389 / 0.4616 / 0.5111 |
| Footprint vs oracle: P / R / F1 | 0.6667 / 0.463 / 0.5222 |
| Variant | v2.5: v2.4, with escalation after one repeated red, every landed party reconciled, lone suspects reverted at once, base and dynamic culprits, a wider window, structural merges, start cards and one rescue |
| Informed reworks / decision cards / revert-first tickets | 9 / 0 / 2 |
| Agent released on check / reworks that waited for an agent / wait minutes | yes / 0 / 0.0 |
| Validation re-runs / suspected flakes | 2 / 0 |
| Inherited reds waited out (no rework round spent) | 26 |
| Reconciles (reconciled / contradictions) / stale re-checks | 1 (1 / 0) / 2 |
| Escalate after (failed repairs) / reconcile parties / dropped stuck after a card | 2 / 1 / 0 |
| Start cards / rescues / dynamic culprit searches (probes) | off / off / off |
| Tests first (accepted / fallbacks) / targeted landing checks (red) | off / off |
| Sprout window at the end / window waits / early tickets / re-check samples | 14 / 41 / 0 / 1 |
| Spec amendments (amended / none / rejected / rolled back) / re-executions / adopted in place | 0 / 0 / 0 / 1 / 0 / 0 |
| Pre-land checks (red) / reworks / drops | 128 (39) / 9 / 1 |
| Pre-land check minutes | 157.5 |
| Re-check rule / skipped (adaptive) / hunk-disjoint / hunk-overlap | sampled / 4 / 0 / 0 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 31 / 35 / 0 |
| Placements disjoint / overlapping | 40 / 0 |
| Fast-trunk landings (task / fixer / revert) | 36 / 0 / 2 |
| Validations (green / red) | 12 / 6 |
| Repair tickets (closed / escalated / by method) | 0 / 2 / {'read-set': 2} |
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
| t001 | green | a3 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a9 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a4 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t004 | green | a5 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a8 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a6 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a2 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a7 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a0 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | green | a11 | 3 | 3 | 0 | src/db | src, src/billing, src/db, src/users | True |
| t011 | green | a10 | 3 | 2 | 0 | src/orders | src, src/db, src/notifications, src/orders, src/shipping | True |
| t012 | green | a1 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | dropped | a2 | 3 | 2 | 0 | src/notifications | - | False |
| t014 | green | a8 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a0 | 1 | 1 | 0 | src/billing | src/billing | True |
| t016 | green | a7 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a3 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a0 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a6 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a9 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a4 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | dropped | a5 | 3 | 2 | 0 | src/billing | - | False |
| t023 | green | a2 | 3 | 2 | 0 | src/billing | src/billing, src/lib | True |
| t024 | dropped | a1 | 3 | 2 | 0 | src/db | - | False |
| t025 | green | a3 | 1 | 1 | 0 | src/notifications | src/notifications | True |
| t026 | green | a0 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a1 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a11 | 2 | 1 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a7 | 0 | 0 | 0 | src/cart | src/orders | True |
| t030 | green | a8 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | dropped | a9 | 0 | 0 | 0 | src/billing | src, src/billing | False |
| t032 | dropped | a6 | 2 | 0 | 0 | src/billing | - | False |
| t033 | green | a4 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a0 | 3 | 2 | 0 | src/inventory | src/inventory | True |
| t035 | green | a1 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | dropped | a0 | 3 | 3 | 0 | src/billing | src, src/billing | False |
| t037 | green | a2 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a3 | 1 | 1 | 0 | src/cart | src/billing | True |
| t039 | green | a10 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t040 | green | a11 | 0 | 0 | 0 | src/db | src/billing | True |
