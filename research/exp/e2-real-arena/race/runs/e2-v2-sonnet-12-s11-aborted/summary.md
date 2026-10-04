# Race: beanstalk / claude

_measured: arena=real-arena@d2af54e6/0cba7528, 24 tasks, policy=beanstalk, agent=claude (sonnet)_

**Aborted:** error in validate-10: GitError('git checkout -q -f --detach 32a06e78b387c9e95acfef6a48e7f5f448557ebb failed (128): fatal: unable to write new index file')

| Metric | Value |
|---|---|
| Changes reaching green per hour | 71.745 |
| Tasks green / landed / dropped / total | 10 / 11 / 0 / 24 |
| Drops by reason | none |
| Wall-clock (min) | 8.36 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 4.61 / 7.35 |
| Agent minutes busy / blocked / idle | 12.75 / 87.61 / 0.0 |
| Invocations (initial / rework / fixer / classifier) | 22 / 0 / 0 / 0 |
| Cost USD (total) | 1.3633 |
| Cost USD by kind | initial 1.3633 |
| CI runs / minutes | 10 / 11.24 |
| CI runs by purpose | validate 10 |
| Textual conflicts met | 0 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 10 / 24 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | test/unit/Lexer.test.js |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 1.0 / 1.0 / 1.0 |
| Footprint vs oracle: P / R / F1 | 1.0 / 1.0 / 1.0 |
| Variant | v2: pre-land check, informed author repair, decision cards, revert-first |
| Informed reworks / decision cards / revert-first tickets | 0 / 0 / 0 |
| Pre-land checks (red) / reworks / drops | 47 (0) / 0 / 0 |
| Pre-land check minutes | 51.65 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 6 / 28 / 6 |
| Placements disjoint / overlapping | 23 / 0 |
| Fast-trunk landings (task / fixer / revert) | 11 / 0 / 0 |
| Validations (green / red) | 10 / 0 |
| Repair tickets (closed / escalated / by method) | 0 / 0 / {} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 12,
  "ci_seconds": 60.0,
  "ci_slots": 2,
  "batch": null,
  "seed": 11,
  "budget_usd": 25.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": true,
  "snapshot": "head",
  "queue_hold": null,
  "error_budget": 999,
  "footprint": "predictor",
  "tasks": 24,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t001 | green | a0 | 0 | 0 | 0 | src | src | True |
| t002 | green | a1 | 0 | 0 | 0 | src | src | True |
| t003 | green | a2 | 0 | 0 | 0 | src | src | True |
| t004 | green | a3 | 0 | 0 | 0 | src | src | True |
| t005 | green | a4 | 0 | 0 | 0 | src | src | True |
| t006 | green | a5 | 0 | 0 | 0 | src | src | True |
| t007 | running | a6 | 0 | 0 | 0 | docs/img | - | False |
| t008 | running | a7 | 0 | 0 | 0 | src | - | False |
| t009 | green | a8 | 0 | 0 | 0 | src | src | True |
| t010 | green | a9 | 0 | 0 | 0 | src | src | True |
| t011 | landed | a10 | 0 | 0 | 0 | src | src | False |
| t012 | green | a11 | 0 | 0 | 0 | src | src | True |
| t013 | running | a2 | 0 | 0 | 0 | src | - | False |
| t014 | green | a5 | 0 | 0 | 0 | src | src | True |
| t015 | running | a8 | 0 | 0 | 0 | src | - | False |
| t016 | running | a3 | 0 | 0 | 0 | src | - | False |
| t017 | running | a9 | 0 | 0 | 0 | src | - | False |
| t018 | running | a0 | 0 | 0 | 0 | src | - | False |
| t019 | running | a4 | 0 | 0 | 0 | src | - | False |
| t020 | running | a5 | 0 | 0 | 0 | src | - | False |
| t021 | running | a11 | 0 | 0 | 0 | src | - | False |
| t022 | running | a1 | 0 | 0 | 0 | src | - | False |
| t023 | running | a10 | 0 | 0 | 0 | src | - | False |
| t024 | pending | - | 0 | 0 | 0 | (root) | - | False |
