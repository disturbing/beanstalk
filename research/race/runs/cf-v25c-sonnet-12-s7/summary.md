# Race: beanstalk / claude

_forge: cloudflare, run paux95dd8k on https://beanstalk-gateway.devaccounts-1password.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 86.162 |
| Tasks green / landed / dropped / total | 30 / 33 / 10 / 40 |
| Drops by reason | pre-land check still red: 3; pre-land check still red against t005: 1; reverted: 3; unresolved conflict: 3 |
| Wall-clock (min) | 20.89 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 10.43 / 19.07 |
| Agent minutes busy / blocked / idle | 42.5 / 0 / 208.19 |
| Invocations (initial / rework / fixer / classifier) | 40 / 48 / 0 / 0 |
| Cost USD (total) | 8.7064 |
| Cost USD by kind | initial 1.9736, reconcile 0.0570, rework 6.6115, test-author 0.0642 |
| CI runs / minutes | 26 / 31.01 |
| CI runs by purpose | validate 22, bisect 4 |
| Textual conflicts met | 28 |
| Red validations | 9 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 30 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 2 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6364 / 0.4343 / 0.4889 |
| Footprint vs oracle: P / R / F1 | 0.6667 / 0.4394 / 0.504 |
| Variant | v2.5: v2.4, with escalation after one repeated red, every landed party reconciled, lone suspects reverted at once, base and dynamic culprits, a wider window, structural merges, start cards and one rescue |
| Informed reworks / decision cards / revert-first tickets | 18 / 2 / 3 |
| Agent released on check / reworks that waited for an agent / wait minutes | yes / 0 / 0.0 |
| Validation re-runs / suspected flakes | 3 / 0 |
| Inherited reds waited out (no rework round spent) | 11 |
| Reconciles (reconciled / contradictions) / stale re-checks | 1 (0 / 1) / 3 |
| Escalate after (failed repairs) / reconcile parties / dropped stuck after a card | 1 / 3 / 1 |
| Start cards / rescues / dynamic culprit searches (probes) | off / off / off |
| Tests first (accepted / fallbacks) / targeted landing checks (red) | off / off |
| Sprout window at the end / window waits / early tickets / re-check samples | 16 / 67 / 1 / 1 |
| Spec amendments (amended / none / rejected / rolled back) / re-executions / adopted in place | 0 / 2 / 0 / 0 / 2 / 0 |
| Pre-land checks (red) / reworks / drops | 122 (38) / 18 / 4 |
| Pre-land check minutes | 147.44 |
| Re-check rule / skipped (adaptive) / hunk-disjoint / hunk-overlap | sampled / 4 / 0 / 0 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 30 / 30 / 0 |
| Placements disjoint / overlapping | 40 / 0 |
| Fast-trunk landings (task / fixer / revert) | 33 / 0 / 3 |
| Validations (green / red) | 13 / 6 |
| Repair tickets (closed / escalated / by method) | 0 / 3 / {'read-set': 3} |
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
| t001 | green | a8 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a7 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a11 | 3 | 2 | 0 | src/billing | src, src/billing | True |
| t004 | green | a5 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a4 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a6 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | dropped | a3 | 3 | 2 | 0 | src/orders | - | False |
| t008 | green | a9 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a3 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | green | a1 | 3 | 1 | 0 | src/db | src, src/billing, src/db, src/users | True |
| t011 | dropped | a0 | 0 | 0 | 0 | src/orders | src, src/db, src/orders, src/shipping | False |
| t012 | green | a2 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a4 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a2 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a5 | 0 | 0 | 0 | src/billing | src/billing | True |
| t016 | green | a2 | 3 | 2 | 0 | src/billing | src/billing | True |
| t017 | green | a9 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a3 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a6 | 3 | 2 | 0 | src/cart | src, src/orders | True |
| t020 | green | a7 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a0 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | dropped | a1 | 3 | 2 | 0 | src/billing | src, src/billing, src/notifications | False |
| t023 | dropped | a10 | 3 | 2 | 0 | src/billing | - | False |
| t024 | green | a0 | 3 | 2 | 0 | src/db | src, src/billing, src/db | True |
| t025 | dropped | a8 | 3 | 1 | 0 | src/notifications | - | False |
| t026 | green | a9 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a4 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a8 | 1 | 1 | 0 | src/orders | src, src/shipping | True |
| t029 | dropped | a2 | 3 | 2 | 0 | src/cart | - | False |
| t030 | green | a3 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | dropped | a7 | 0 | 0 | 0 | src/billing | src, src/billing | False |
| t032 | dropped | a1 | 5 | 1 | 0 | src/billing | - | False |
| t033 | green | a0 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | dropped | a4 | 3 | 2 | 0 | src/inventory | - | False |
| t035 | green | a9 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | dropped | a7 | 3 | 2 | 0 | src/billing | - | False |
| t037 | green | a3 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a0 | 3 | 2 | 0 | src/cart | src/billing | True |
| t039 | green | a8 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t040 | green | a1 | 3 | 2 | 0 | src/db | src/billing | True |
