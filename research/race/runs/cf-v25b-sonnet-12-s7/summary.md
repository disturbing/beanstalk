# Race: beanstalk / claude

_forge: cloudflare, run cycowcu5zi on https://beanstalk-gateway.devaccounts-1password.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 124.705 |
| Tasks green / landed / dropped / total | 31 / 32 / 9 / 40 |
| Drops by reason | pre-land check still red against t005: 1; reverted: 1; unresolved conflict: 7 |
| Wall-clock (min) | 14.92 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 9.13 / 12.05 |
| Agent minutes busy / blocked / idle | 35.31 / 0 / 143.67 |
| Invocations (initial / rework / fixer / classifier) | 40 / 35 / 0 / 0 |
| Cost USD (total) | 5.9363 |
| Cost USD by kind | initial 1.9973, reconcile 0.0622, rework 3.7899, test-author 0.0869 |
| CI runs / minutes | 19 / 22.53 |
| CI runs by purpose | validate 16, bisect 3 |
| Textual conflicts met | 24 |
| Red validations | 5 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 32 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.5938 / 0.4375 / 0.4844 |
| Footprint vs oracle: P / R / F1 | 0.625 / 0.4375 / 0.4948 |
| Variant | v2.5: v2.4, with escalation after one repeated red, every landed party reconciled, lone suspects reverted at once, base and dynamic culprits, a wider window, structural merges, start cards and one rescue |
| Informed reworks / decision cards / revert-first tickets | 9 / 2 / 1 |
| Agent released on check / reworks that waited for an agent / wait minutes | yes / 0 / 0.0 |
| Validation re-runs / suspected flakes | 2 / 0 |
| Inherited reds waited out (no rework round spent) | 11 |
| Reconciles (reconciled / contradictions) / stale re-checks | 1 (1 / 0) / 0 |
| Escalate after (failed repairs) / reconcile parties / dropped stuck after a card | 1 / 3 / 1 |
| Start cards / rescues / dynamic culprit searches (probes) | off / off / off |
| Tests first (accepted / fallbacks) / targeted landing checks (red) | off / off |
| Sprout window at the end / window waits / early tickets / re-check samples | 16 / 39 / 0 / 1 |
| Spec amendments (amended / none / rejected / rolled back) / re-executions / adopted in place | 0 / 2 / 0 / 1 / 2 / 0 |
| Pre-land checks (red) / reworks / drops | 98 (24) / 9 / 1 |
| Pre-land check minutes | 118.77 |
| Re-check rule / skipped (adaptive) / hunk-disjoint / hunk-overlap | sampled / 4 / 0 / 0 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 28 / 23 / 0 |
| Placements disjoint / overlapping | 40 / 0 |
| Fast-trunk landings (task / fixer / revert) | 32 / 0 / 1 |
| Validations (green / red) | 11 / 3 |
| Repair tickets (closed / escalated / by method) | 0 / 1 / {'read-set': 1} |
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
| t001 | green | a6 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a9 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a1 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | green | a2 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a3 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a8 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a4 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a7 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a5 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | dropped | a4 | 3 | 2 | 0 | src/db | - | False |
| t011 | dropped | a0 | 3 | 2 | 0 | src/orders | - | False |
| t012 | green | a0 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a0 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a7 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a1 | 2 | 2 | 0 | src/billing | src/billing | True |
| t016 | green | a6 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a3 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a5 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a8 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a9 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a11 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | dropped | a2 | 3 | 2 | 0 | src/billing | - | False |
| t023 | green | a8 | 3 | 2 | 0 | src/billing | src/billing, src/lib | True |
| t024 | dropped | a3 | 3 | 2 | 0 | src/db | - | False |
| t025 | dropped | a0 | 3 | 2 | 0 | src/notifications | - | False |
| t026 | green | a5 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a9 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a2 | 1 | 1 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a7 | 2 | 2 | 0 | src/cart | src/inventory, src/orders | True |
| t030 | green | a6 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | dropped | a7 | 0 | 0 | 0 | src/billing | src, src/billing | False |
| t032 | dropped | a1 | 4 | 0 | 0 | src/billing | - | False |
| t033 | green | a5 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | dropped | a6 | 3 | 2 | 0 | src/inventory | - | True |
| t035 | green | a9 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | dropped | a1 | 3 | 3 | 0 | src/billing | - | False |
| t037 | green | a11 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a4 | 0 | 0 | 0 | src/cart | src/billing | True |
| t039 | green | a8 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t040 | green | a1 | 1 | 1 | 0 | src/db | src/billing | True |
