# Race: beanstalk / claude

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

**Aborted:** rate limited (five_hour, resets at 1790995200): stopping rather than dropping tasks

| Metric | Value |
|---|---|
| Changes reaching green per hour | 0.0 |
| Tasks green / landed / dropped / total | 0 / 0 / 0 / 40 |
| Drops by reason | none |
| Wall-clock (min) | 0.04 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | - / - |
| Agent minutes busy / blocked / idle | 0.31 / 0.2 / 0.0 |
| Invocations (initial / rework / fixer / classifier) | 1 / 0 / 0 / 0 |
| Cost USD (total) | 0.0031 |
| Cost USD by kind | initial 0.0000 |
| CI runs / minutes | 0 / 0 |
| CI runs by purpose | - |
| Textual conflicts met | 0 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 0 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | - / - / - |
| Footprint vs oracle: P / R / F1 | - / - / - |
| Variant | v2: pre-land check, informed author repair, decision cards, revert-first |
| Informed reworks / decision cards / revert-first tickets | 0 / 0 / 0 |
| Pre-land checks (red) / reworks / drops | 0 (0) / 0 / 0 |
| Pre-land check minutes | 0.0 |
| Placements disjoint / overlapping | 12 / 0 |
| Fast-trunk landings (task / fixer / revert) | 0 / 0 / 0 |
| Validations (green / red) | 0 / 0 |
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
  "budget_usd": 75.0,
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
| t001 | running | a0 | 0 | 0 | 0 | src/orders | - | False |
| t002 | running | a1 | 0 | 0 | 0 | src/orders | - | False |
| t003 | running | a2 | 0 | 0 | 0 | src/billing | - | False |
| t004 | running | a3 | 0 | 0 | 0 | src/billing | - | False |
| t005 | running | a4 | 0 | 0 | 0 | src/lib | - | False |
| t006 | running | a5 | 0 | 0 | 0 | src/billing | - | False |
| t007 | running | a6 | 0 | 0 | 0 | src/orders | - | False |
| t008 | running | a7 | 0 | 0 | 0 | src/inventory | - | False |
| t009 | running | a8 | 0 | 0 | 0 | src/orders | - | False |
| t010 | running | a9 | 0 | 0 | 0 | src/db | - | False |
| t011 | running | a10 | 0 | 0 | 0 | src/orders | - | False |
| t012 | running | a11 | 0 | 0 | 0 | src/auth | - | False |
| t013 | pending | - | 0 | 0 | 0 | src/notifications | - | False |
| t014 | pending | - | 0 | 0 | 0 | src/auth | - | False |
| t015 | pending | - | 0 | 0 | 0 | src/billing | - | False |
| t016 | pending | - | 0 | 0 | 0 | src/billing | - | False |
| t017 | pending | - | 0 | 0 | 0 | src/orders | - | False |
| t018 | pending | - | 0 | 0 | 0 | src/orders | - | False |
| t019 | pending | - | 0 | 0 | 0 | src/cart | - | False |
| t020 | pending | - | 0 | 0 | 0 | src/auth | - | False |
| t021 | pending | - | 0 | 0 | 0 | src/db | - | False |
| t022 | pending | - | 0 | 0 | 0 | src/billing | - | False |
| t023 | pending | - | 0 | 0 | 0 | src/billing | - | False |
| t024 | pending | - | 0 | 0 | 0 | src/db | - | False |
| t025 | pending | - | 0 | 0 | 0 | src/notifications | - | False |
| t026 | pending | - | 0 | 0 | 0 | src/billing | - | False |
| t027 | pending | - | 0 | 0 | 0 | src/db | - | False |
| t028 | pending | - | 0 | 0 | 0 | src/orders | - | False |
| t029 | pending | - | 0 | 0 | 0 | src/cart | - | False |
| t030 | pending | - | 0 | 0 | 0 | src/cart | - | False |
| t031 | pending | - | 0 | 0 | 0 | src/billing | - | False |
| t032 | pending | - | 0 | 0 | 0 | src/billing | - | False |
| t033 | pending | - | 0 | 0 | 0 | src/shipping | - | False |
| t034 | pending | - | 0 | 0 | 0 | src/inventory | - | False |
| t035 | pending | - | 0 | 0 | 0 | src/cart | - | False |
| t036 | pending | - | 0 | 0 | 0 | src/billing | - | False |
| t037 | pending | - | 0 | 0 | 0 | src/db | - | False |
| t038 | pending | - | 0 | 0 | 0 | src/cart | - | False |
| t039 | pending | - | 0 | 0 | 0 | src/billing | - | False |
| t040 | pending | - | 0 | 0 | 0 | src/db | - | False |
