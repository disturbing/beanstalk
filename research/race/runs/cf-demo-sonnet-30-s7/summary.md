# Race: beanstalk / claude

_forge: cloudflare, run xmlr1sgs3e on https://beanstalk-gateway.devaccounts-1password.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 50.328 |
| Tasks green / landed / dropped / total | 36 / 38 / 2 / 40 |
| Drops by reason | reverted: 2 |
| Parked, needs a person | t023 (needs a person: two specs disagree (t012)); t032 (needs a person: two specs disagree (t028)) |
| Wall-clock (min) | 42.92 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 5.26 / 22.57 |
| Agent minutes busy / blocked / idle | 30.74 / 0 / 1256.82 |
| Invocations (initial / rework / fixer / classifier) | 40 / 23 / 0 / 0 |
| Cost USD (total) | 4.8526 |
| Cost USD by kind | initial 2.2618, reconcile 0.1608, rework 2.1429, test-author 0.2870 |
| CI runs / minutes | 43 / 55.43 |
| CI runs by purpose | validate 27, bisect 16 |
| Textual conflicts met | 8 |
| Red validations | 10 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 36 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 2 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6579 / 0.443 / 0.5035 |
| Footprint vs oracle: P / R / F1 | 0.6842 / 0.4561 / 0.5211 |
| Variant | v2.5: v2.4, with escalation after one repeated red, every landed party reconciled, lone suspects reverted at once, base and dynamic culprits, a wider window, structural merges, start cards and one rescue + dependency-aware starts |
| Informed reworks / decision cards / revert-first tickets | 9 / 8 / 5 |
| Agent released on check / reworks that waited for an agent / wait minutes | yes / 0 / 0.0 |
| Validation re-runs / suspected flakes | 5 / 0 |
| Inherited reds waited out (no rework round spent) | 3 |
| Reconciles (reconciled / contradictions) / stale re-checks | 3 (1 / 2) / 1 |
| Escalate after (failed repairs) / reconcile parties / dropped stuck after a card | 1 / 3 / 0 |
| Start cards / rescues / dynamic culprit searches (probes) | 4 / 1 / 7 (42) |
| Max bean invocations / tail guard minutes / dropped by each | 10 / 3 / 0 / 0 |
| Tests first (accepted / fallbacks) / targeted landing checks (red) | off / off |
| Sprout window at the end / window waits / early tickets / re-check samples | 16 / 17 / 0 / 1 |
| Spec amendments (amended / none / rejected / rolled back) / re-executions / adopted in place | 1 / 7 / 0 / 1 / 4 / 0 |
| Pre-land checks (red) / reworks / drops | 84 (22) / 10 / 0 |
| Pre-land check minutes | 110.75 |
| Re-check rule / skipped (adaptive) / hunk-disjoint / hunk-overlap | sampled / 4 / 0 / 0 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 33 / 19 / 0 |
| Placements disjoint / overlapping | 9 / 31 |
| Fast-trunk landings (task / fixer / revert) | 38 / 0 / 2 |
| Validations (green / red) | 17 / 5 |
| Repair tickets (closed / escalated / by method) | 0 / 5 / {'read-set': 5} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 30,
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
| t001 | green | a9 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a7 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a27 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | green | a24 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a8 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a11 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a0 | 2 | 1 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a29 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | dropped | a1 | 0 | 0 | 0 | src/orders | src, src/orders | False |
| t010 | green | a0 | 2 | 1 | 0 | src/db | src, src/billing, src/db, src/users | True |
| t011 | green | a4 | 0 | 0 | 0 | src/orders | src, src/db, src/orders, src/shipping | True |
| t012 | green | a16 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a2 | 2 | 1 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a22 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a1 | 6 | 2 | 0 | src/billing | src/billing | True |
| t016 | green | a0 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a1 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a1 | 2 | 0 | 0 | src/orders | src/notifications, src/shipping | True |
| t019 | green | a25 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a12 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a13 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | dropped | a3 | 0 | 0 | 0 | src/billing | src, src/billing | False |
| t023 | parked | a0 | 3 | 0 | 0 | src/billing | - | False |
| t024 | green | a15 | 0 | 0 | 0 | src/db | src, src/billing, src/db | True |
| t025 | green | a6 | 0 | 0 | 0 | src/notifications | src/notifications | True |
| t026 | green | a1 | 1 | 0 | 0 | src/billing | src/billing, src/db | True |
| t027 | green | a2 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a2 | 2 | 2 | 0 | src/orders | src, src/db, src/shipping | True |
| t029 | green | a17 | 0 | 0 | 0 | src/cart | src/orders | True |
| t030 | green | a23 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | green | a0 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t032 | parked | a2 | 2 | 0 | 0 | src/billing | - | False |
| t033 | green | a14 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a3 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t035 | green | a0 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | green | a0 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t037 | green | a3 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a1 | 1 | 1 | 0 | src/cart | src/billing | True |
| t039 | green | a0 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t040 | green | a1 | 0 | 0 | 0 | src/db | src/billing | True |
