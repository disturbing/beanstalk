# Race: beanstalk / claude

_forge: cloudflare, run z7ma47bi23 on https://beanstalk-gateway.devaccounts-1password.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 113.839 |
| Tasks green / landed / dropped / total | 34 / 35 / 6 / 40 |
| Drops by reason | pre-land check still red: 1; reverted: 1; unresolved conflict: 4 |
| Wall-clock (min) | 17.92 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 9.8 / 14.61 |
| Agent minutes busy / blocked / idle | 32.29 / 0 / 182.75 |
| Invocations (initial / rework / fixer / classifier) | 40 / 36 / 0 / 0 |
| Cost USD (total) | 5.1421 |
| Cost USD by kind | initial 2.3612, rework 2.7450, test-author 0.0359 |
| CI runs / minutes | 22 / 27.9 |
| CI runs by purpose | validate 20, bisect 2 |
| Textual conflicts met | 23 |
| Red validations | 4 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 34 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 4 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6286 / 0.4629 / 0.5095 |
| Footprint vs oracle: P / R / F1 | 0.6571 / 0.4643 / 0.521 |
| Variant | v2.3: pre-land check, sprout window, sampled re-check, agent released during checks, read-set inherited reds, early revert-first, cards that re-execute the loser |
| Informed reworks / decision cards / revert-first tickets | 12 / 1 / 1 |
| Agent released on check / reworks that waited for an agent / wait minutes | yes / 0 / 0.0 |
| Validation re-runs / suspected flakes | 1 / 0 |
| Inherited reds waited out (no rework round spent) | 19 |
| Sprout window at the end / window waits / early tickets / re-check samples | 16 / 51 / 0 / 1 |
| Spec amendments (amended / none / rejected / rolled back) / re-executions / adopted in place | 0 / 1 / 0 / 0 / 1 / 0 |
| Pre-land checks (red) / reworks / drops | 118 (33) / 12 / 1 |
| Pre-land check minutes | 144.52 |
| Re-check rule / skipped (adaptive) / hunk-disjoint / hunk-overlap | sampled / 3 / 0 / 0 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 31 / 30 / 1 |
| Placements disjoint / overlapping | 40 / 0 |
| Fast-trunk landings (task / fixer / revert) | 35 / 0 / 1 |
| Validations (green / red) | 16 / 3 |
| Repair tickets (closed / escalated / by method) | 0 / 1 / {'read-set': 1} |
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
| t002 | green | a0 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a10 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | green | a9 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a6 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a1 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a3 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a2 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a4 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | dropped | a11 | 3 | 2 | 0 | src/db | - | False |
| t011 | green | a7 | 3 | 2 | 0 | src/orders | src, src/db, src/notifications, src/orders, src/shipping | True |
| t012 | green | a5 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a5 | 3 | 2 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a6 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a9 | 3 | 3 | 0 | src/billing | src/billing | True |
| t016 | green | a2 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a1 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a4 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a8 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a0 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a11 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | dropped | a0 | 3 | 2 | 0 | src/billing | - | False |
| t023 | green | a3 | 1 | 1 | 0 | src/billing | src/billing, src/lib | True |
| t024 | dropped | a0 | 3 | 2 | 0 | src/db | - | False |
| t025 | green | a9 | 1 | 1 | 0 | src/notifications | src/notifications | True |
| t026 | green | a4 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a6 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a10 | 1 | 1 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a1 | 1 | 1 | 0 | src/cart | src/orders | True |
| t030 | green | a2 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | dropped | a5 | 0 | 0 | 0 | src/billing | src, src/billing | False |
| t032 | dropped | a2 | 6 | 0 | 0 | src/billing | - | False |
| t033 | green | a4 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a8 | 1 | 1 | 0 | src/inventory | src/inventory | True |
| t035 | green | a9 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | dropped | a3 | 3 | 2 | 0 | src/billing | - | False |
| t037 | green | a11 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a2 | 2 | 1 | 0 | src/cart | src/billing | True |
| t039 | green | a10 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t040 | green | a7 | 1 | 1 | 0 | src/db | src/billing | True |
