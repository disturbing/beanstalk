# Race: beanstalk / replay

_forge: cloudflare, run 6qbk9vmvif on https://beanstalk-gateway-staging.devaccounts-1password.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=replay (replay control: reference patches, synthetic timings)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 149.418 |
| Tasks green / landed / dropped / total | 18 / 18 / 22 / 40 |
| Drops by reason | infrastructure failure: 15; replay could not repair the pre-land failure (limitation of replay agents): 5; replay could not resolve the conflict (limitation of replay agents): 2 |
| Parked, needs a person | none |
| Wall-clock (min) | 7.23 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 2.05 / 2.37 |
| Agent minutes busy / blocked / idle | 20.66 / 0 / 37.17 |
| Invocations (initial / rework / fixer / classifier) | 40 / 9 / 0 / 0 |
| Cost USD (total) | 0 |
| Cost USD by kind | initial 0.0000, rework 0.0000, test-author 0.0000 |
| CI runs / minutes | 8 / 7.34 |
| CI runs by purpose | validate 6, validate-cancelled 2 |
| Textual conflicts met | 4 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 18 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6111 / 0.4352 / 0.4908 |
| Footprint vs oracle: P / R / F1 | 0.6111 / 0.4352 / 0.4908 |
| Variant | v2.5: v2.4, with escalation after one repeated red, every landed party reconciled, lone suspects reverted at once, base and dynamic culprits, a wider window, structural merges, start cards and one rescue + dependency-aware starts |
| Informed reworks / decision cards / revert-first tickets | 5 / 1 / 0 |
| Agent released on check / reworks that waited for an agent / wait minutes | yes / 0 / 0.0 |
| Validation re-runs / suspected flakes | 0 / 0 |
| Inherited reds waited out (no rework round spent) | 0 |
| Reconciles (reconciled / contradictions) / stale re-checks | 0 (0 / 0) / 0 |
| Escalate after (failed repairs) / reconcile parties / dropped stuck after a card | 1 / 3 / 0 |
| Start cards / rescues / dynamic culprit searches (probes) | 1 / 0 / 4 (24) |
| Max bean invocations / tail guard minutes / dropped by each | 10 / 3 / 0 / 0 |
| Sprout resets (beans requeued) / episode reds (inherited checks) / repair landings | 0 (0) / 0 (0) / 0 |
| Checks reused as validations / superseded CI runs cancelled | 2 / 2 |
| Evidence promotions / affected validations / refusals / audits (red) | 5 / 7 / 7 / 1 (0) |
| Tests first (accepted / fallbacks) / targeted landing checks (red) | off / off |
| Sprout window at the end / window waits / early tickets / re-check samples | 16 / 5 / 0 / 0 |
| Spec amendments (amended / none / rejected / rolled back) / re-executions / adopted in place | 0 / 1 / 0 / 0 / 0 / 0 |
| Pre-land checks (red) / reworks / drops | 34 (5) / 5 / 0 |
| Pre-land check minutes | 7.79 |
| Re-check rule / skipped (adaptive) / hunk-disjoint / hunk-overlap | sampled / 3 / 0 / 0 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 0.0 / 16 / 9 / 1 |
| Placements disjoint / overlapping | 18 / 22 |
| Fast-trunk landings (task / fixer / revert) | 18 / 0 / 0 |
| Validations (green / red) | 5 / 0 |
| Repair tickets (closed / escalated / by method) | 0 / 0 / {} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 8,
  "ci_seconds": 60,
  "ci_slots": 2,
  "batch": null,
  "seed": 7,
  "budget_usd": 25,
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
| t001 | dropped | a0 | 0 | 0 | 0 | src/orders | - | False |
| t002 | dropped | a0 | 0 | 0 | 0 | src/orders | - | False |
| t003 | dropped | a6 | 0 | 0 | 0 | src/billing | - | False |
| t004 | dropped | a6 | 0 | 0 | 0 | src/billing | - | False |
| t005 | dropped | a1 | 0 | 0 | 0 | src/lib | - | False |
| t006 | dropped | a7 | 0 | 0 | 0 | src/billing | - | False |
| t007 | green | a1 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | dropped | a4 | 0 | 0 | 0 | src/inventory | - | False |
| t009 | green | a0 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | dropped | a3 | 0 | 0 | 0 | src/db | - | False |
| t011 | dropped | a0 | 1 | 1 | 0 | src/orders | - | False |
| t012 | dropped | a2 | 0 | 0 | 0 | src/auth | - | False |
| t013 | dropped | a7 | 0 | 0 | 0 | src/notifications | - | False |
| t014 | green | a2 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a6 | 0 | 0 | 0 | src/billing | src/billing | True |
| t016 | green | a7 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a3 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a4 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | dropped | a5 | 0 | 0 | 0 | src/cart | - | False |
| t020 | green | a5 | 0 | 0 | 0 | src/auth | src/auth, src/users | True |
| t021 | dropped | a3 | 0 | 0 | 0 | src/db | - | False |
| t022 | green | a6 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t023 | green | a2 | 0 | 0 | 0 | src/billing | src/billing, src/lib | True |
| t024 | dropped | a5 | 1 | 0 | 0 | src/db | - | False |
| t025 | dropped | a7 | 0 | 0 | 0 | src/notifications | - | False |
| t026 | green | a0 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a4 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a1 | 0 | 0 | 0 | src/orders | src, src/shipping | True |
| t029 | dropped | a5 | 0 | 0 | 0 | src/cart | - | False |
| t030 | green | a2 | 1 | 1 | 0 | src/cart | src/orders | True |
| t031 | dropped | a1 | 1 | 0 | 0 | src/billing | - | False |
| t032 | dropped | a2 | 1 | 0 | 0 | src/billing | - | False |
| t033 | dropped | a1 | 0 | 0 | 0 | src/shipping | - | False |
| t034 | green | a4 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t035 | green | a5 | 1 | 1 | 0 | src/cart | src/cart, src/inventory | True |
| t036 | dropped | a0 | 1 | 0 | 0 | src/billing | - | False |
| t037 | green | a7 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | dropped | a3 | 1 | 1 | 0 | src/cart | - | False |
| t039 | dropped | a1 | 1 | 0 | 0 | src/billing | - | False |
| t040 | green | a4 | 0 | 0 | 0 | src/db | src/billing | True |
