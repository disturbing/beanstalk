# Race: beanstalk / claude

_forge: cloudflare, run 0t1ywb18vm on https://beanstalk-gateway.devaccounts-1password.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 54.849 |
| Tasks green / landed / dropped / total | 37 / 39 / 3 / 40 |
| Drops by reason | pre-land check still red: 1; reverted: 2 |
| Wall-clock (min) | 40.48 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 5.64 / 24.5 |
| Agent minutes busy / blocked / idle | 53.23 / 0 / 432.47 |
| Invocations (initial / rework / fixer / classifier) | 40 / 41 / 0 / 0 |
| Cost USD (total) | 7.8048 |
| Cost USD by kind | initial 1.9029, reconcile 0.3165, rework 5.1965, test-author 0.3889 |
| CI runs / minutes | 34 / 44.7 |
| CI runs by purpose | validate 23, bisect 11 |
| Textual conflicts met | 12 |
| Red validations | 8 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 37 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 6 |
| Footprint (predictor) vs actual: P / R / F1 | 0.641 / 0.4325 / 0.4863 |
| Footprint vs oracle: P / R / F1 | 0.6667 / 0.4444 / 0.5077 |
| Variant | v2.5: v2.4, with escalation after one repeated red, every landed party reconciled, lone suspects reverted at once, base and dynamic culprits, a wider window, structural merges, start cards and one rescue |
| Informed reworks / decision cards / revert-first tickets | 15 / 8 / 3 |
| Agent released on check / reworks that waited for an agent / wait minutes | yes / 0 / 0.0 |
| Validation re-runs / suspected flakes | 4 / 0 |
| Inherited reds waited out (no rework round spent) | 1 |
| Reconciles (reconciled / contradictions) / stale re-checks | 7 (2 / 5) / 0 |
| Escalate after (failed repairs) / reconcile parties / dropped stuck after a card | 1 / 3 / 0 |
| Start cards / rescues / dynamic culprit searches (probes) | 0 / 4 / 13 (168) |
| Tests first (accepted / fallbacks) / targeted landing checks (red) | off / off |
| Sprout window at the end / window waits / early tickets / re-check samples | 12 / 36 / 0 / 2 |
| Spec amendments (amended / none / rejected / rolled back) / re-executions / adopted in place | 3 / 5 / 0 / 0 / 8 / 0 |
| Pre-land checks (red) / reworks / drops | 114 (32) / 17 / 1 |
| Pre-land check minutes | 153.49 |
| Re-check rule / skipped (adaptive) / hunk-disjoint / hunk-overlap | sampled / 9 / 0 / 0 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 35 / 32 / 1 |
| Placements disjoint / overlapping | 40 / 0 |
| Fast-trunk landings (task / fixer / revert) | 39 / 0 / 2 |
| Validations (green / red) | 15 / 4 |
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
| t001 | green | a3 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a9 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a0 | 2 | 1 | 0 | src/billing | src, src/billing | True |
| t004 | green | a1 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a4 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a7 | 1 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a11 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a2 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | dropped | a0 | 1 | 0 | 0 | src/db | src, src/billing, src/db, src/users | False |
| t011 | green | a10 | 0 | 0 | 0 | src/orders | src, src/db, src/orders, src/shipping | True |
| t012 | green | a6 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a6 | 2 | 1 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a1 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a11 | 0 | 0 | 0 | src/billing | src/billing | True |
| t016 | green | a4 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a2 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a2 | 1 | 0 | 0 | src/orders | src/notifications, src/shipping | True |
| t019 | green | a5 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a7 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a0 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | green | a10 | 6 | 0 | 0 | src/billing | src, src/billing, src/catalog, src/lib, src/orders | True |
| t023 | green | a8 | 1 | 1 | 0 | src/billing | src/billing, src/lib | True |
| t024 | dropped | a9 | 2 | 1 | 0 | src/db | src, src/billing, src/db | False |
| t025 | green | a11 | 0 | 0 | 0 | src/notifications | src/notifications | True |
| t026 | green | a2 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a1 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a1 | 1 | 1 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a3 | 1 | 1 | 0 | src/cart | src/orders | True |
| t030 | green | a7 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | green | a0 | 3 | 1 | 0 | src/billing | src, src/billing, src/db | True |
| t032 | green | a0 | 7 | 0 | 0 | src/billing | src/orders | True |
| t033 | green | a5 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a11 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t035 | green | a1 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | dropped | a0 | 8 | 2 | 0 | src/billing | - | False |
| t037 | green | a7 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a8 | 4 | 2 | 0 | src/cart | src/billing | True |
| t039 | green | a9 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t040 | green | a0 | 1 | 1 | 0 | src/db | src/billing | True |
