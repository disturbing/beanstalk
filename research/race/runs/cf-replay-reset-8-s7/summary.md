# Race: beanstalk / replay

_forge: cloudflare, run bjp3k7h1ts on https://beanstalk-gateway.devaccounts-1password.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=replay (replay control: reference patches, synthetic timings)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 150.946 |
| Tasks green / landed / dropped / total | 23 / 24 / 17 / 40 |
| Drops by reason | replay could not repair the pre-land failure (limitation of replay agents): 11; replay could not resolve the conflict (limitation of replay agents): 5; reverted: 1 |
| Parked, needs a person | none |
| Wall-clock (min) | 9.14 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 2.81 / 6.69 |
| Agent minutes busy / blocked / idle | 25.82 / 0 / 47.32 |
| Invocations (initial / rework / fixer / classifier) | 40 / 20 / 0 / 0 |
| Cost USD (total) | 0 |
| Cost USD by kind | initial 0.0000, rework 0.0000, test-author 0.0000 |
| CI runs / minutes | 36 / 9.33 |
| CI runs by purpose | validate 36 |
| Textual conflicts met | 7 |
| Red validations | 13 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 23 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6667 / 0.4687 / 0.5236 |
| Footprint vs oracle: P / R / F1 | 0.6667 / 0.4687 / 0.5236 |
| Variant | v2.5: v2.4, with escalation after one repeated red, every landed party reconciled, lone suspects reverted at once, base and dynamic culprits, a wider window, structural merges, start cards and one rescue + dependency-aware starts |
| Informed reworks / decision cards / revert-first tickets | 11 / 3 / 4 |
| Agent released on check / reworks that waited for an agent / wait minutes | yes / 0 / 0.0 |
| Validation re-runs / suspected flakes | 6 / 0 |
| Inherited reds waited out (no rework round spent) | 1 |
| Reconciles (reconciled / contradictions) / stale re-checks | 0 (0 / 0) / 4 |
| Escalate after (failed repairs) / reconcile parties / dropped stuck after a card | 1 / 3 / 0 |
| Start cards / rescues / dynamic culprit searches (probes) | 3 / 0 / 8 (37) |
| Max bean invocations / tail guard minutes / dropped by each | 10 / 3 / 0 / 0 |
| Sprout resets (beans requeued) / episode reds (inherited checks) / repair landings | 2 (10) / 0 (0) / 0 |
| Tests first (accepted / fallbacks) / targeted landing checks (red) | off / off |
| Sprout window at the end / window waits / early tickets / re-check samples | 16 / 28 / 0 / 3 |
| Spec amendments (amended / none / rejected / rolled back) / re-executions / adopted in place | 0 / 3 / 0 / 0 / 0 / 0 |
| Pre-land checks (red) / reworks / drops | 78 (18) / 13 / 0 |
| Pre-land check minutes | 21.63 |
| Re-check rule / skipped (adaptive) / hunk-disjoint / hunk-overlap | sampled / 10 / 0 / 0 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 4.5 / 28 / 22 / 3 |
| Placements disjoint / overlapping | 9 / 31 |
| Fast-trunk landings (task / fixer / revert) | 34 / 0 / 1 |
| Validations (green / red) | 23 / 7 |
| Repair tickets (closed / escalated / by method) | 3 / 4 / {'read-set': 4} |
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
| t001 | green | a2 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a4 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | dropped | a5 | 1 | 0 | 0 | src/billing | src, src/billing | False |
| t004 | green | a0 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a7 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a7 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a4 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a1 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | dropped | a6 | 1 | 1 | 0 | src/orders | - | False |
| t010 | dropped | a3 | 0 | 0 | 0 | src/db | src, src/billing, src/db, src/orders | False |
| t011 | dropped | a4 | 1 | 1 | 0 | src/orders | - | False |
| t012 | green | a6 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a0 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a3 | 1 | 1 | 0 | src/auth | src/auth | True |
| t015 | dropped | a2 | 1 | 0 | 0 | src/billing | - | False |
| t016 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a1 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | dropped | a0 | 1 | 0 | 0 | src/orders | - | False |
| t019 | green | a4 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a0 | 0 | 0 | 0 | src/auth | src/auth, src/users | True |
| t021 | green | a6 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | dropped | a1 | 1 | 0 | 0 | src/billing | - | False |
| t023 | dropped | a3 | 1 | 0 | 0 | src/billing | - | False |
| t024 | dropped | a1 | 1 | 1 | 0 | src/db | src, src/billing, src/db | False |
| t025 | green | a5 | 1 | 1 | 0 | src/notifications | src/notifications | True |
| t026 | green | a0 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | dropped | a0 | 1 | 0 | 0 | src/db | - | False |
| t028 | green | a2 | 0 | 0 | 0 | src/orders | src, src/shipping | True |
| t029 | dropped | a2 | 1 | 0 | 0 | src/cart | - | False |
| t030 | green | a3 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | dropped | a2 | 1 | 0 | 0 | src/billing | - | False |
| t032 | dropped | a3 | 1 | 0 | 0 | src/billing | - | False |
| t033 | dropped | a7 | 1 | 0 | 0 | src/shipping | - | False |
| t034 | dropped | a0 | 2 | 1 | 0 | src/inventory | - | False |
| t035 | green | a6 | 0 | 0 | 0 | src/cart | src/cart, src/inventory | True |
| t036 | dropped | a4 | 1 | 1 | 0 | src/billing | - | False |
| t037 | green | a0 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a1 | 1 | 0 | 0 | src/cart | src/billing | True |
| t039 | green | a7 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t040 | dropped | a1 | 1 | 0 | 0 | src/db | - | False |
