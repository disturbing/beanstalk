# Race: beanstalk / claude

_forge: cloudflare, run zd6gw25yjh on https://beanstalk-gateway.devaccounts-1password.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 85.598 |
| Tasks green / landed / dropped / total | 39 / 39 / 0 / 40 |
| Drops by reason | none |
| Parked, needs a person | t032 (needs a person: two specs disagree (t005)) |
| Wall-clock (min) | 27.34 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 4.7 / 11.28 |
| Agent minutes busy / blocked / idle | 30.62 / 0 / 789.49 |
| Invocations (initial / rework / fixer / classifier) | 40 / 17 / 0 / 0 |
| Cost USD (total) | 4.7376 |
| Cost USD by kind | initial 2.0927, reconcile 0.1635, rework 2.1840, test-author 0.2974 |
| CI runs / minutes | 24 / 32.19 |
| CI runs by purpose | validate 24 |
| Textual conflicts met | 7 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 39 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 5 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6667 / 0.456 / 0.5145 |
| Footprint vs oracle: P / R / F1 | 0.6923 / 0.4573 / 0.5248 |
| Variant | v2.5: v2.4, with escalation after one repeated red, every landed party reconciled, lone suspects reverted at once, base and dynamic culprits, a wider window, structural merges, start cards and one rescue + dependency-aware starts |
| Informed reworks / decision cards / revert-first tickets | 7 / 7 / 0 |
| Agent released on check / reworks that waited for an agent / wait minutes | yes / 0 / 0.0 |
| Validation re-runs / suspected flakes | 0 / 0 |
| Inherited reds waited out (no rework round spent) | 0 |
| Reconciles (reconciled / contradictions) / stale re-checks | 3 (0 / 3) / 0 |
| Escalate after (failed repairs) / reconcile parties / dropped stuck after a card | 1 / 3 / 0 |
| Start cards / rescues / dynamic culprit searches (probes) | 4 / 0 / 6 (36) |
| Max bean invocations / tail guard minutes / dropped by each | 10 / 3 / 0 / 0 |
| Sprout resets (beans requeued) / episode reds (inherited checks) / repair landings | 0 (0) / 0 (0) / 0 |
| Tests first (accepted / fallbacks) / targeted landing checks (red) | off / off |
| Sprout window at the end / window waits / early tickets / re-check samples | 16 / 12 / 0 / 0 |
| Spec amendments (amended / none / rejected / rolled back) / re-executions / adopted in place | 2 / 5 / 0 / 0 / 3 / 0 |
| Pre-land checks (red) / reworks / drops | 85 (11) / 7 / 0 |
| Pre-land check minutes | 117.31 |
| Re-check rule / skipped (adaptive) / hunk-disjoint / hunk-overlap | sampled / 2 / 0 / 0 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 31 / 30 / 6 |
| Placements disjoint / overlapping | 9 / 31 |
| Fast-trunk landings (task / fixer / revert) | 39 / 0 / 0 |
| Validations (green / red) | 24 / 0 |
| Repair tickets (closed / escalated / by method) | 0 / 0 / {} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 30,
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
| t001 | green | a8 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a18 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a27 | 1 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | green | a22 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a28 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a20 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a11 | 1 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a25 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a0 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | green | a10 | 4 | 1 | 0 | src/db | src, src/billing, src/db, src/users | True |
| t011 | green | a1 | 3 | 1 | 0 | src/orders | src, src/db, src/notifications, src/orders, src/shipping | True |
| t012 | green | a7 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a26 | 2 | 1 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a4 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a4 | 0 | 0 | 0 | src/billing | src/billing | True |
| t016 | green | a1 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a1 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a1 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a17 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a24 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a13 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | green | a0 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t023 | green | a1 | 0 | 0 | 0 | src/billing | src/billing, src/lib | True |
| t024 | green | a3 | 0 | 0 | 0 | src/db | src, src/billing, src/db | True |
| t025 | green | a6 | 0 | 0 | 0 | src/notifications | src/notifications | True |
| t026 | green | a0 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a0 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a1 | 0 | 0 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a16 | 1 | 1 | 0 | src/cart | src/orders | True |
| t030 | green | a23 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | green | a1 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t032 | parked | a0 | 2 | 0 | 0 | src/billing | - | False |
| t033 | green | a19 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a2 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t035 | green | a0 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | green | a0 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t037 | green | a2 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a2 | 2 | 2 | 0 | src/cart | src/billing | True |
| t039 | green | a1 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t040 | green | a0 | 0 | 0 | 0 | src/db | src/billing | True |
