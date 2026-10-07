# Race: beanstalk / replay

_forge: cloudflare, run g7fgn1bmc9 on https://beanstalk-gateway-staging.<subdomain>.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=replay (replay control: reference patches, synthetic timings)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 139.817 |
| Tasks green / landed / dropped / total | 8 / 8 / 32 / 40 |
| Drops by reason | infrastructure failure: 30; replay could not resolve the conflict (limitation of replay agents): 2 |
| Parked, needs a person | none |
| Wall-clock (min) | 3.43 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 1.22 / 1.52 |
| Agent minutes busy / blocked / idle | 18.76 / 0 / 8.7 |
| Invocations (initial / rework / fixer / classifier) | 40 / 2 / 0 / 0 |
| Cost USD (total) | 0 |
| Cost USD by kind | initial 0.0000, rework 0.0000 |
| CI runs / minutes | 6 / 1.15 |
| CI runs by purpose | validate-cancelled 2, validate 4 |
| Textual conflicts met | 2 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 8 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.375 / 0.25 / 0.2917 |
| Footprint vs oracle: P / R / F1 | 0.375 / 0.25 / 0.2917 |
| Variant | v2.5: v2.4, with escalation after one repeated red, every landed party reconciled, lone suspects reverted at once, base and dynamic culprits, a wider window, structural merges, start cards and one rescue |
| Informed reworks / decision cards / revert-first tickets | 0 / 0 / 0 |
| Agent released on check / reworks that waited for an agent / wait minutes | yes / 0 / 0.0 |
| Validation re-runs / suspected flakes | 0 / 0 |
| Inherited reds waited out (no rework round spent) | 0 |
| Reconciles (reconciled / contradictions) / stale re-checks | 0 (0 / 0) / 0 |
| Escalate after (failed repairs) / reconcile parties / dropped stuck after a card | 1 / 3 / 0 |
| Start cards / rescues / dynamic culprit searches (probes) | 0 / 0 / 0 (0) |
| Max bean invocations / tail guard minutes / dropped by each | 10 / 3 / 0 / 0 |
| Sprout resets (beans requeued) / episode reds (inherited checks) / repair landings | 0 (0) / 0 (0) / 0 |
| Checks reused as validations / superseded CI runs cancelled | 2 / 2 |
| Tests first (accepted / fallbacks) / targeted landing checks (red) | off / off |
| Sprout window at the end / window waits / early tickets / re-check samples | 16 / 0 / 0 / 0 |
| Spec amendments (amended / none / rejected / rolled back) / re-executions / adopted in place | 0 / 0 / 0 / 0 / 0 / 0 |
| Pre-land checks (red) / reworks / drops | 12 (0) / 0 / 0 |
| Pre-land check minutes | 4.05 |
| Re-check rule / skipped (adaptive) / hunk-disjoint / hunk-overlap | sampled / 0 / 0 / 0 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 0.0 / 6 / 2 / 0 |
| Placements disjoint / overlapping | 40 / 0 |
| Fast-trunk landings (task / fixer / revert) | 8 / 0 / 0 |
| Validations (green / red) | 4 / 0 |
| Repair tickets (closed / escalated / by method) | 0 / 0 / {} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 8,
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
  "tasks": 40,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t001 | dropped | a0 | 0 | 0 | 0 | src/orders | - | False |
| t002 | dropped | a3 | 0 | 0 | 0 | src/orders | - | False |
| t003 | dropped | a2 | 0 | 0 | 0 | src/billing | - | False |
| t004 | dropped | a4 | 0 | 0 | 0 | src/billing | - | False |
| t005 | dropped | a5 | 0 | 0 | 0 | src/lib | - | False |
| t006 | dropped | a6 | 0 | 0 | 0 | src/billing | - | False |
| t007 | dropped | a7 | 0 | 0 | 0 | src/orders | - | False |
| t008 | dropped | a1 | 0 | 0 | 0 | src/inventory | - | False |
| t009 | dropped | a5 | 0 | 0 | 0 | src/orders | - | False |
| t010 | dropped | a0 | 0 | 0 | 0 | src/db | - | False |
| t011 | dropped | a2 | 0 | 0 | 0 | src/orders | - | False |
| t012 | dropped | a6 | 0 | 0 | 0 | src/auth | - | False |
| t013 | dropped | a3 | 0 | 0 | 0 | src/notifications | - | False |
| t014 | dropped | a7 | 0 | 0 | 0 | src/auth | - | False |
| t015 | dropped | a4 | 0 | 0 | 0 | src/billing | - | False |
| t016 | dropped | a3 | 0 | 0 | 0 | src/billing | - | False |
| t017 | dropped | a0 | 0 | 0 | 0 | src/orders | - | False |
| t018 | dropped | a6 | 0 | 0 | 0 | src/orders | - | False |
| t019 | dropped | a5 | 0 | 0 | 0 | src/cart | - | False |
| t020 | dropped | a4 | 0 | 0 | 0 | src/auth | - | False |
| t021 | dropped | a1 | 0 | 0 | 0 | src/db | - | False |
| t022 | dropped | a2 | 0 | 0 | 0 | src/billing | - | False |
| t023 | dropped | a5 | 0 | 0 | 0 | src/billing | - | False |
| t024 | dropped | a3 | 0 | 0 | 0 | src/db | - | False |
| t025 | dropped | a0 | 0 | 0 | 0 | src/notifications | - | False |
| t026 | dropped | a7 | 0 | 0 | 0 | src/billing | - | False |
| t027 | dropped | a6 | 0 | 0 | 0 | src/db | - | False |
| t028 | dropped | a4 | 0 | 0 | 0 | src/orders | - | False |
| t029 | green | a0 | 0 | 0 | 0 | src/cart | src/orders | True |
| t030 | dropped | a2 | 0 | 0 | 0 | src/cart | - | False |
| t031 | green | a3 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t032 | green | a1 | 0 | 0 | 0 | src/billing | src, src/orders | True |
| t033 | dropped | a7 | 0 | 0 | 0 | src/shipping | - | False |
| t034 | green | a6 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t035 | green | a5 | 0 | 0 | 0 | src/cart | src/cart, src/inventory | True |
| t036 | dropped | a2 | 1 | 1 | 0 | src/billing | - | False |
| t037 | green | a4 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a7 | 0 | 0 | 0 | src/cart | src/billing | True |
| t039 | dropped | a3 | 1 | 1 | 0 | src/billing | - | False |
| t040 | green | a6 | 0 | 0 | 0 | src/db | src/billing | True |
