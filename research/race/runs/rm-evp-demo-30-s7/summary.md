# Race: beanstalk / replay

_forge: cloudflare, run f2jrpba33c on https://beanstalk-gateway-staging-rm.<subdomain>.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=replay (replay control: reference patches, synthetic timings)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 181.372 |
| Tasks green / landed / dropped / total | 24 / 24 / 16 / 40 |
| Drops by reason | replay could not repair the pre-land failure (limitation of replay agents): 12; replay could not resolve the conflict (limitation of replay agents): 4 |
| Parked, needs a person | none |
| Wall-clock (min) | 7.94 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 3.04 / 4.6 |
| Agent minutes busy / blocked / idle | 21.33 / 0 / 216.86 |
| Invocations (initial / rework / fixer / classifier) | 40 / 19 / 0 / 0 |
| Cost USD (total) | 0 |
| Cost USD by kind | initial 0.0000, rework 0.0000, test-author 0.0000 |
| CI runs / minutes | 10 / 8.52 |
| CI runs by purpose | validate 5, validate-cancelled 5 |
| Textual conflicts met | 7 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 24 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.7083 / 0.5278 / 0.5833 |
| Footprint vs oracle: P / R / F1 | 0.7083 / 0.5278 / 0.5833 |
| Variant | v2.5: v2.4, with escalation after one repeated red, every landed party reconciled, lone suspects reverted at once, base and dynamic culprits, a wider window, structural merges, start cards and one rescue + dependency-aware starts |
| Informed reworks / decision cards / revert-first tickets | 11 / 3 / 0 |
| Agent released on check / reworks that waited for an agent / wait minutes | yes / 0 / 0.0 |
| Validation re-runs / suspected flakes | 0 / 0 |
| Inherited reds waited out (no rework round spent) | 0 |
| Reconciles (reconciled / contradictions) / stale re-checks | 0 (0 / 0) / 0 |
| Escalate after (failed repairs) / reconcile parties / dropped stuck after a card | 1 / 3 / 0 |
| Start cards / rescues / dynamic culprit searches (probes) | 3 / 0 / 11 (58) |
| Max bean invocations / tail guard minutes / dropped by each | 10 / 3 / 0 / 0 |
| Sprout resets (beans requeued) / episode reds (inherited checks) / repair landings | 0 (0) / 0 (0) / 0 |
| Checks reused as validations / superseded CI runs cancelled | 4 / 5 |
| Tests first (accepted / fallbacks) / targeted landing checks (red) | off / off |
| Sprout window at the end / window waits / early tickets / re-check samples | 16 / 10 / 0 / 0 |
| Spec amendments (amended / none / rejected / rolled back) / re-executions / adopted in place | 0 / 3 / 0 / 0 / 0 / 0 |
| Pre-land checks (red) / reworks / drops | 58 (12) / 12 / 0 |
| Pre-land check minutes | 41.25 |
| Re-check rule / skipped (adaptive) / hunk-disjoint / hunk-overlap | sampled / 2 / 0 / 0 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 30.0 / 20 / 15 / 1 |
| Placements disjoint / overlapping | 9 / 31 |
| Fast-trunk landings (task / fixer / revert) | 24 / 0 / 0 |
| Validations (green / red) | 5 / 0 |
| Repair tickets (closed / escalated / by method) | 0 / 0 / {} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 30,
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
| t001 | green | a20 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a22 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a26 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | green | a21 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a19 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a9 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | dropped | a3 | 1 | 0 | 0 | src/orders | - | False |
| t008 | dropped | a25 | 1 | 1 | 0 | src/inventory | - | False |
| t009 | green | a3 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | dropped | a14 | 1 | 0 | 0 | src/db | - | False |
| t011 | dropped | a4 | 1 | 0 | 0 | src/orders | - | False |
| t012 | green | a3 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | dropped | a4 | 1 | 1 | 0 | src/notifications | - | False |
| t014 | green | a0 | 2 | 2 | 0 | src/auth | src/auth | True |
| t015 | dropped | a1 | 1 | 1 | 0 | src/billing | - | False |
| t016 | green | a2 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | dropped | a0 | 1 | 0 | 0 | src/orders | - | False |
| t018 | dropped | a1 | 1 | 0 | 0 | src/orders | - | False |
| t019 | green | a24 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a12 | 0 | 0 | 0 | src/auth | src/auth, src/users | True |
| t021 | green | a6 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | dropped | a5 | 1 | 0 | 0 | src/billing | - | False |
| t023 | dropped | a0 | 1 | 0 | 0 | src/billing | - | False |
| t024 | green | a7 | 0 | 0 | 0 | src/db | src, src/billing, src/db | True |
| t025 | green | a29 | 0 | 0 | 0 | src/notifications | src/notifications | True |
| t026 | green | a2 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | dropped | a1 | 1 | 0 | 0 | src/db | - | False |
| t028 | green | a2 | 1 | 1 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a23 | 0 | 0 | 0 | src/cart | src/orders | True |
| t030 | green | a8 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | dropped | a1 | 1 | 0 | 0 | src/billing | - | False |
| t032 | dropped | a1 | 1 | 0 | 0 | src/billing | - | False |
| t033 | green | a27 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a13 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t035 | green | a0 | 0 | 0 | 0 | src/cart | src/cart, src/inventory | True |
| t036 | green | a2 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t037 | green | a2 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | dropped | a2 | 1 | 1 | 0 | src/cart | - | False |
| t039 | dropped | a0 | 1 | 0 | 0 | src/billing | - | False |
| t040 | dropped | a3 | 1 | 0 | 0 | src/db | - | False |
