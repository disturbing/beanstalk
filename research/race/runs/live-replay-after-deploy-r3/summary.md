# Race: beanstalk / replay

_forge: cloudflare, run klv1otqqot on https://beanstalk-gateway.devaccounts-1password.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=replay (replay control: reference patches, synthetic timings)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 239.446 |
| Tasks green / landed / dropped / total | 25 / 25 / 15 / 40 |
| Drops by reason | replay could not repair the pre-land failure (limitation of replay agents): 13; replay could not resolve the conflict (limitation of replay agents): 2 |
| Parked, needs a person | none |
| Wall-clock (min) | 6.26 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 1.27 / 2.3 |
| Agent minutes busy / blocked / idle | 23.16 / 0 / 26.96 |
| Invocations (initial / rework / fixer / classifier) | 40 / 18 / 0 / 0 |
| Cost USD (total) | 0 |
| Cost USD by kind | initial 0.0000, rework 0.0000, test-author 0.0000 |
| CI runs / minutes | 19 / 3.01 |
| CI runs by purpose | validate 19 |
| Textual conflicts met | 5 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 25 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.72 / 0.52 / 0.58 |
| Footprint vs oracle: P / R / F1 | 0.72 / 0.52 / 0.58 |
| Variant | v2.5: v2.4, with escalation after one repeated red, every landed party reconciled, lone suspects reverted at once, base and dynamic culprits, a wider window, structural merges, start cards and one rescue + dependency-aware starts |
| Informed reworks / decision cards / revert-first tickets | 13 / 3 / 0 |
| Agent released on check / reworks that waited for an agent / wait minutes | yes / 1 / 0.04 |
| Validation re-runs / suspected flakes | 0 / 0 |
| Inherited reds waited out (no rework round spent) | 0 |
| Reconciles (reconciled / contradictions) / stale re-checks | 0 (0 / 0) / 0 |
| Escalate after (failed repairs) / reconcile parties / dropped stuck after a card | 1 / 3 / 0 |
| Start cards / rescues / dynamic culprit searches (probes) | 3 / 0 / 11 (58) |
| Max bean invocations / tail guard minutes / dropped by each | 10 / 3 / 0 / 0 |
| Sprout resets (beans requeued) / episode reds (inherited checks) / repair landings | 0 (0) / 0 (0) / 0 |
| Checks reused as validations / superseded CI runs cancelled | 6 / 0 |
| Tests first (accepted / fallbacks) / targeted landing checks (red) | off / off |
| Sprout window at the end / window waits / early tickets / re-check samples | 16 / 0 / 0 / 0 |
| Spec amendments (amended / none / rejected / rolled back) / re-executions / adopted in place | 0 / 3 / 0 / 0 / 0 / 0 |
| Pre-land checks (red) / reworks / drops | 57 (13) / 13 / 0 |
| Pre-land check minutes | 8.7 |
| Re-check rule / skipped (adaptive) / hunk-disjoint / hunk-overlap | sampled / 2 / 0 / 0 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 4.5 / 19 / 15 / 2 |
| Placements disjoint / overlapping | 9 / 31 |
| Fast-trunk landings (task / fixer / revert) | 25 / 0 / 0 |
| Validations (green / red) | 19 / 0 |
| Repair tickets (closed / escalated / by method) | 0 / 0 / {} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 8,
  "ci_seconds": 4.5,
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
| t001 | green | a3 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a4 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a7 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | green | a5 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a5 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a7 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | dropped | a3 | 1 | 0 | 0 | src/orders | - | False |
| t008 | green | a6 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a6 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | dropped | a4 | 1 | 0 | 0 | src/db | - | False |
| t011 | dropped | a5 | 1 | 0 | 0 | src/orders | - | False |
| t012 | green | a1 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a2 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a0 | 1 | 1 | 0 | src/auth | src/auth | True |
| t015 | dropped | a4 | 1 | 1 | 0 | src/billing | - | False |
| t016 | green | a1 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | dropped | a1 | 1 | 0 | 0 | src/orders | - | False |
| t018 | dropped | a3 | 1 | 0 | 0 | src/orders | - | False |
| t019 | green | a0 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a6 | 0 | 0 | 0 | src/auth | src/auth, src/users | True |
| t021 | green | a0 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | dropped | a1 | 1 | 0 | 0 | src/billing | - | False |
| t023 | dropped | a1 | 1 | 0 | 0 | src/billing | - | False |
| t024 | green | a1 | 0 | 0 | 0 | src/db | src, src/billing, src/db | True |
| t025 | green | a5 | 1 | 1 | 0 | src/notifications | src/notifications | True |
| t026 | green | a4 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | dropped | a3 | 1 | 0 | 0 | src/db | - | False |
| t028 | green | a4 | 0 | 0 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a3 | 0 | 0 | 0 | src/cart | src/orders | True |
| t030 | green | a0 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | dropped | a1 | 1 | 0 | 0 | src/billing | - | False |
| t032 | dropped | a2 | 1 | 0 | 0 | src/billing | - | False |
| t033 | green | a2 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | dropped | a3 | 1 | 1 | 0 | src/inventory | - | False |
| t035 | green | a2 | 1 | 1 | 0 | src/cart | src/cart, src/inventory | True |
| t036 | green | a3 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t037 | green | a1 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | dropped | a3 | 1 | 0 | 0 | src/cart | - | False |
| t039 | dropped | a0 | 1 | 0 | 0 | src/billing | - | False |
| t040 | dropped | a1 | 1 | 0 | 0 | src/db | - | False |
