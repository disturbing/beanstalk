# Race: beanstalk / claude

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 114.358 |
| Tasks green / landed / dropped / total | 40 / 40 / 0 / 40 |
| Drops by reason | none |
| Wall-clock (min) | 20.99 |
| Wall-clock to all-green (min) | 20.99 |
| Task start to green, median / p90 (min) | 3.35 / 7.71 |
| Agent minutes busy / blocked / idle | 32.67 / 100.14 / 119.03 |
| Invocations (initial / rework / fixer / classifier) | 40 / 17 / 0 / 0 |
| Cost USD (total) | 4.855 |
| Cost USD by kind | author 0.3460, initial 2.1346, reexec 0.1375, rescue 0.2864, rework 1.9505 |
| CI runs / minutes | 20 / 21.61 |
| CI runs by purpose | validate 20 |
| Textual conflicts met | 15 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 40 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 5 |
| Footprint (predictor) vs actual: P / R / F1 | 0.65 / 0.4437 / 0.5008 |
| Footprint vs oracle: P / R / F1 | 0.675 / 0.4458 / 0.5117 |
| Variant | e6: v2 + decision outcomes (loser re-executed), spec amendments, earlier cards, rescue |
| Decision mode / oracle / CARD_AFTER / CARD_AFTER_KNOWN / prior | oracle / contract / 1 / -1 / arena |
| Decision cards (by trigger / by outcome) | 7 ({'start': 3, 'preland': 4} / {'keep-landed': 5, 'adopt-arriving': 2}) |
| Losers shipped / losers | 7 / 7 {'t005': 'green', 't018': 'green', 't022': 'green', 't028': 'green', 't031': 'green', 't032': 'green', 't036': 'green'} |
| Spec amendments (accepted / none needed / rejected) | 5 / 2 / 0 |
| Re-executions by reason (cost USD) | {'keep-landed': 2, 'rescue': 2} ({'keep-landed': 0.1375, 'rescue': 0.2864}) |
| Test-author cost USD / fail-first runs | 0.346 / 3 |
| Decision reverts / revert conflicts / requeued / partner re-checks | 0 / 0 / 0 / 1 |
| Informed reworks / decision cards / revert-first tickets | 2 / 7 / 0 |
| Pre-land checks (red) / reworks / drops | 78 (9) / 2 / 0 |
| Pre-land check minutes | 84.7 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 32 / 18 / 2 |
| Placements disjoint / overlapping | 40 / 0 |
| Fast-trunk landings (task / fixer / revert) | 40 / 0 / 0 |
| Validations (green / red) | 20 / 0 |
| Repair tickets (closed / escalated / by method) | 0 / 0 / {} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 12,
  "ci_seconds": 60.0,
  "ci_slots": 2,
  "batch": null,
  "seed": 7,
  "budget_usd": 20.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
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
| t001 | green | a0 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a1 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a2 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t004 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a4 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a6 | 1 | 1 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a7 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a8 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | green | a9 | 6 | 4 | 0 | src/db | src, src/billing, src/db, src/users | True |
| t011 | green | a10 | 0 | 0 | 0 | src/orders | src, src/db, src/orders, src/shipping | True |
| t012 | green | a11 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a3 | 3 | 2 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a7 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a0 | 0 | 0 | 0 | src/billing | src/billing | True |
| t016 | green | a4 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a11 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a8 | 2 | 1 | 0 | src/orders | src/notifications | True |
| t019 | green | a1 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a11 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a10 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | green | a0 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t023 | green | a4 | 0 | 0 | 0 | src/billing | src/billing, src/lib | True |
| t024 | green | a7 | 1 | 1 | 0 | src/db | src, src/billing, src/db, src/lib | True |
| t025 | green | a1 | 0 | 0 | 0 | src/notifications | src/notifications | True |
| t026 | green | a5 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a11 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a10 | 0 | 0 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a6 | 0 | 0 | 0 | src/cart | src/inventory, src/orders | True |
| t030 | green | a1 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | green | a0 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t032 | green | a4 | 3 | 1 | 0 | src/billing | src, src/orders | True |
| t033 | green | a11 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a5 | 1 | 1 | 0 | src/inventory | src/inventory | True |
| t035 | green | a1 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | green | a10 | 2 | 2 | 0 | src/billing | src, src/billing | True |
| t037 | green | a2 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a8 | 1 | 1 | 0 | src/cart | src/billing | True |
| t039 | green | a6 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t040 | green | a11 | 0 | 0 | 0 | src/db | src/billing | True |
