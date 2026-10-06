# Race: beanstalk / claude

_forge: cloudflare, run qz10uakzgi on https://beanstalk-gateway.devaccounts-1password.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 95.281 |
| Tasks green / landed / dropped / total | 39 / 39 / 1 / 40 |
| Drops by reason | pre-land check still red against t002: 1 |
| Wall-clock (min) | 24.56 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 5.75 / 15.11 |
| Agent minutes busy / blocked / idle | 42.74 / 0 / 251.96 |
| Invocations (initial / rework / fixer / classifier) | 40 / 22 / 0 / 0 |
| Cost USD (total) | 5.1886 |
| Cost USD by kind | initial 1.9759, reconcile 0.3370, rework 2.6208, test-author 0.2549 |
| CI runs / minutes | 20 / 27.1 |
| CI runs by purpose | validate 20 |
| Textual conflicts met | 6 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 39 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 4 |
| Footprint (predictor) vs actual: P / R / F1 | 0.641 / 0.4466 / 0.5017 |
| Footprint vs oracle: P / R / F1 | 0.6667 / 0.4444 / 0.5077 |
| Variant | v2.5: v2.4, with escalation after one repeated red, every landed party reconciled, lone suspects reverted at once, base and dynamic culprits, a wider window, structural merges, start cards and one rescue |
| Informed reworks / decision cards / revert-first tickets | 9 / 6 / 0 |
| Agent released on check / reworks that waited for an agent / wait minutes | yes / 0 / 0.0 |
| Validation re-runs / suspected flakes | 0 / 0 |
| Inherited reds waited out (no rework round spent) | 0 |
| Reconciles (reconciled / contradictions) / stale re-checks | 7 (3 / 4) / 0 |
| Escalate after (failed repairs) / reconcile parties / dropped stuck after a card | 1 / 3 / 1 |
| Start cards / rescues / dynamic culprit searches (probes) | 0 / 1 / 11 (116) |
| Tests first (accepted / fallbacks) / targeted landing checks (red) | off / off |
| Sprout window at the end / window waits / early tickets / re-check samples | 16 / 33 / 0 / 2 |
| Spec amendments (amended / none / rejected / rolled back) / re-executions / adopted in place | 2 / 4 / 0 / 1 / 6 / 0 |
| Pre-land checks (red) / reworks / drops | 105 (20) / 9 / 1 |
| Pre-land check minutes | 132.16 |
| Re-check rule / skipped (adaptive) / hunk-disjoint / hunk-overlap | sampled / 6 / 0 / 0 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 32 / 41 / 4 |
| Placements disjoint / overlapping | 40 / 0 |
| Fast-trunk landings (task / fixer / revert) | 39 / 0 / 0 |
| Validations (green / red) | 20 / 0 |
| Repair tickets (closed / escalated / by method) | 0 / 0 / {} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 12,
  "ci_seconds": 60,
  "ci_slots": 2,
  "batch": null,
  "seed": 11,
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
| t001 | green | a7 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a9 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a3 | 1 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | green | a0 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a1 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a2 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a11 | 1 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a8 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a4 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | green | a10 | 3 | 0 | 0 | src/db | src, src/billing, src/db | True |
| t011 | green | a5 | 0 | 0 | 0 | src/orders | src, src/db, src/orders, src/shipping | True |
| t012 | green | a6 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a0 | 2 | 1 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a1 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a8 | 1 | 1 | 0 | src/billing | src/billing | True |
| t016 | green | a6 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a2 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a1 | 1 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a4 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a3 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a9 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | dropped | a0 | 4 | 0 | 0 | src/billing | - | False |
| t023 | green | a5 | 2 | 1 | 0 | src/billing | src/billing, src/lib | True |
| t024 | green | a11 | 3 | 2 | 0 | src/db | src, src/billing, src/db | True |
| t025 | green | a2 | 0 | 0 | 0 | src/notifications | src/notifications | True |
| t026 | green | a7 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a6 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a8 | 1 | 1 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a3 | 0 | 0 | 0 | src/cart | src/orders | True |
| t030 | green | a1 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | green | a0 | 1 | 0 | 0 | src/billing | src, src/billing | True |
| t032 | green | a4 | 2 | 0 | 0 | src/billing | src, src/orders, src/shipping | True |
| t033 | green | a9 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a5 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t035 | green | a10 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | green | a2 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t037 | green | a11 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a7 | 0 | 0 | 0 | src/cart | src/billing | True |
| t039 | green | a6 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t040 | green | a1 | 0 | 0 | 0 | src/db | src/billing | True |
