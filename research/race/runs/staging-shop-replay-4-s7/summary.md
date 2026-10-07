# Race: beanstalk / replay

_forge: cloudflare, run tjyitgg4tj on https://beanstalk-gateway-staging.devaccounts-1password.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 8 tasks, policy=beanstalk, agent=replay (replay control: reference patches, synthetic timings)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 187.927 |
| Tasks green / landed / dropped / total | 8 / 8 / 0 / 8 |
| Drops by reason | none |
| Parked, needs a person | none |
| Wall-clock (min) | 2.55 |
| Wall-clock to all-green (min) | 2.52 |
| Task start to green, median / p90 (min) | 1.35 / 1.84 |
| Agent minutes busy / blocked / idle | 4.52 / 0 / 5.7 |
| Invocations (initial / rework / fixer / classifier) | 8 / 0 / 0 / 0 |
| Cost USD (total) | 0 |
| Cost USD by kind | initial 0.0000 |
| CI runs / minutes | 6 / 0.96 |
| CI runs by purpose | validate 6 |
| Textual conflicts met | 0 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 8 / 8 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.875 / 0.5833 / 0.6667 |
| Footprint vs oracle: P / R / F1 | 0.875 / 0.5833 / 0.6667 |
| Variant | v2.5: v2.4, with escalation after one repeated red, every landed party reconciled, lone suspects reverted at once, base and dynamic culprits, a wider window, structural merges, start cards and one rescue + dependency-aware starts |
| Informed reworks / decision cards / revert-first tickets | 0 / 0 / 0 |
| Agent released on check / reworks that waited for an agent / wait minutes | yes / 0 / 0.0 |
| Validation re-runs / suspected flakes | 0 / 0 |
| Inherited reds waited out (no rework round spent) | 0 |
| Reconciles (reconciled / contradictions) / stale re-checks | 0 (0 / 0) / 0 |
| Escalate after (failed repairs) / reconcile parties / dropped stuck after a card | 1 / 3 / 0 |
| Start cards / rescues / dynamic culprit searches (probes) | 0 / 0 / 0 (0) |
| Max bean invocations / tail guard minutes / dropped by each | 10 / 3 / 0 / 0 |
| Sprout resets (beans requeued) / episode reds (inherited checks) / repair landings | 0 (0) / 0 (0) / 0 |
| Checks reused as validations / superseded CI runs cancelled | 2 / 0 |
| Tests first (accepted / fallbacks) / targeted landing checks (red) | off / off |
| Sprout window at the end / window waits / early tickets / re-check samples | 16 / 0 / 0 / 0 |
| Spec amendments (amended / none / rejected / rolled back) / re-executions / adopted in place | 0 / 0 / 0 / 0 / 0 / 0 |
| Pre-land checks (red) / reworks / drops | 13 (0) / 0 / 0 |
| Pre-land check minutes | 3.29 |
| Re-check rule / skipped (adaptive) / hunk-disjoint / hunk-overlap | sampled / 0 / 0 / 0 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 0.0 / 6 / 5 / 1 |
| Placements disjoint / overlapping | 4 / 4 |
| Fast-trunk landings (task / fixer / revert) | 8 / 0 / 0 |
| Validations (green / red) | 6 / 0 |
| Repair tickets (closed / escalated / by method) | 0 / 0 / {} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 4,
  "ci_seconds": 0,
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
  "tasks": 8,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t001 | green | a0 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a2 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a1 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a1 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a2 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a3 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a0 | 0 | 0 | 0 | src/inventory | src/inventory | True |
