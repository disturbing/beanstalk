# Race: github-queue / codex

_measured: arena=arena@26eecce0/8c321b35, 4 tasks, policy=github-queue, agent=codex (gpt-6.1-sol)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 60.141 |
| Tasks green / landed / dropped / total | 4 / 4 / 0 / 4 |
| Drops by reason | none |
| Wall-clock (min) | 3.99 |
| Wall-clock to all-green (min) | 3.99 |
| Task start to green, median / p90 (min) | 2.0 / 2.08 |
| Agent minutes busy / blocked / idle | 2.48 / 5.5 / 0.0 |
| Invocations (initial / rework / fixer / classifier) | 4 / 0 / 0 / 0 |
| Cost USD (total) | 0.1775 |
| Cost USD by kind | initial 0.1775 |
| CI runs / minutes | 8 / 1.67 |
| CI runs by purpose | precheck 4, batch 4 |
| Textual conflicts met | 0 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 4 / 4 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.75 / 0.4583 / 0.5417 |
| Footprint vs oracle: P / R / F1 | 0.75 / 0.4583 / 0.5417 |
| Ejections (conflict / red) | 0 / 0 |
| GitHub repo | https://github.com/kintohubtest/beanstalk-race-shop-3 |
| Queue wait to merge, median / p90 (min) | 0.82 / 0.86 |
| Queue wait to removal, median / p90 (min) | - / - |
| Push to enqueued (PR check + enqueue), median (min) | 0.40 |
| Kick-outs (by cause) | 0 () |
| Kick-outs by GitHub reason | none |
| Rebases: with agent / without agent | 0 / 0 |
| Actions runs: PR checks / merge groups | 4 / 4 |
| Actions minutes (PR / group / total) | 0.81 / 0.88 / 1.69 |
| Runner pickup, median (s) | 4.0 |
| Actions job / suite step, median (s) | 12.5 / 2.0 |
| Merges: PRs / merge operations / max PRs in 60 s | 4 / 2 / 2 |
| GitHub API: mutations / pushes / rate-limited | 15 / 5 / 0 |
| Push wait in rate limiter (s) | 3.02 |

## Config

```json
{
  "agents": 2,
  "ci_seconds": 0.0,
  "ci_slots": 2,
  "batch": null,
  "seed": 3,
  "budget_usd": 5.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": false,
  "snapshot": null,
  "queue_hold": null,
  "error_budget": null,
  "footprint": "predictor",
  "tasks": 4,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t001 | green | a0 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a1 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a0 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | green | a1 | 0 | 0 | 0 | src/billing | src/billing | True |
