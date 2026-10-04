# Race: beanstalk / replay

_measured: arena=arena@26eecce0/8c321b35, 10 tasks, policy=beanstalk, agent=replay (replay control: reference patches, synthetic timings)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 81.966 |
| Tasks green / landed / dropped / total | 6 / 6 / 4 / 10 |
| Drops by reason | pre-land check still red: 4 |
| Wall-clock (min) | 4.39 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 0.56 / 1.67 |
| Agent minutes busy / blocked / idle | 5.09 / 8.02 / 4.46 |
| Invocations (initial / rework / fixer / classifier) | 10 / 25 / 0 / 0 |
| Cost USD (total) | 0.0 |
| Cost USD by kind | author 0.0000, initial 0.0000, reexec 0.0000, rescue 0.0000, rework 0.0000 |
| CI runs / minutes | 10 / 0.92 |
| CI runs by purpose | validate 10 |
| Textual conflicts met | 2 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 6 / 10 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.5 / 0.3333 / 0.3889 |
| Footprint vs oracle: P / R / F1 | 0.5 / 0.3333 / 0.3889 |
| Variant | e6: v2 + decision outcomes (loser re-executed), spec amendments, earlier cards, rescue |
| Decision mode / oracle / CARD_AFTER / CARD_AFTER_KNOWN / prior | human / landed / 1 / -1 / arena |
| Decision cards (by trigger / by outcome) | 9 ({'preland': 6, 'start': 3} / {'keep-landed': 5, 'adopt-arriving': 4}) |
| Losers shipped / losers | 3 / 7 {'t002': 'dropped', 't005': 'green', 't011': 'dropped', 't022': 'green', 't031': 'dropped', 't032': 'green', 't036': 'dropped'} |
| Spec amendments (accepted / none needed / rejected) | 3 / 6 / 0 |
| Re-executions by reason (cost USD) | {'keep-landed': 5, 'adopt-arriving': 2, 'rescue': 4} ({'keep-landed': 0.0, 'adopt-arriving': 0.0, 'rescue': 0.0}) |
| Test-author cost USD / fail-first runs | 0.0 / 3 |
| Decision reverts / revert conflicts / requeued / partner re-checks | 2 / 0 / 2 / 0 |
| Informed reworks / decision cards / revert-first tickets | 23 / 9 / 0 |
| Pre-land checks (red) / reworks / drops | 50 (39) / 23 / 4 |
| Pre-land check minutes | 4.75 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 5.0 / 2 / 3 / 0 |
| Placements disjoint / overlapping | 12 / 0 |
| Fast-trunk landings (task / fixer / revert) | 8 / 0 / 2 |
| Validations (green / red) | 10 / 0 |
| Repair tickets (closed / escalated / by method) | 0 / 0 / {} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 4,
  "ci_seconds": 5.0,
  "ci_slots": 2,
  "batch": null,
  "seed": 7,
  "budget_usd": 25.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": true,
  "snapshot": "head",
  "queue_hold": null,
  "error_budget": 999,
  "footprint": "predictor",
  "tasks": 10,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t002 | dropped | a1 | 11 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | False |
| t005 | green | a0 | 0 | 0 | 0 | src/lib | src/lib | True |
| t011 | dropped | a2 | 8 | 2 | 0 | src/orders | - | False |
| t018 | green | a3 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t022 | green | a1 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t023 | green | a3 | 0 | 0 | 0 | src/billing | src/billing, src/lib | True |
| t028 | green | a0 | 0 | 0 | 0 | src/orders | src, src/shipping | True |
| t031 | dropped | a3 | 7 | 0 | 0 | src/billing | - | False |
| t032 | green | a0 | 1 | 0 | 0 | src/billing | src, src/orders, src/shipping | True |
| t036 | dropped | a2 | 7 | 0 | 0 | src/billing | - | False |
