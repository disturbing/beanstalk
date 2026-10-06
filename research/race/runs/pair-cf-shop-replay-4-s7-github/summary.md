# Race: github-queue / replay

_measured: arena=arena@26eecce0/8c321b35, 8 tasks, policy=github-queue, agent=replay (replay control: reference patches, synthetic timings)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 96.733 |
| Tasks green / landed / dropped / total | 8 / 8 / 0 / 8 |
| Drops by reason | none |
| Wall-clock (min) | 4.96 |
| Wall-clock to all-green (min) | 4.96 |
| Task start to green, median / p90 (min) | 1.94 / 2.44 |
| Agent minutes busy / blocked / idle | 2.88 / 13.7 / 3.27 |
| Invocations (initial / rework / fixer / classifier) | 8 / 1 / 0 / 0 |
| Cost USD (total) | 0.0 |
| Cost USD by kind | initial 0.0000, rework 0.0000 |
| CI runs / minutes | 17 / 3.48 |
| CI runs by purpose | precheck 9, batch 8 |
| Textual conflicts met | 2 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 8 / 8 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.875 / 0.5833 / 0.6667 |
| Footprint vs oracle: P / R / F1 | 0.875 / 0.5833 / 0.6667 |
| Ejections (conflict / red) | 2 / 0 |
| GitHub repo | https://github.com/kintohubtest/beanstalk-race-shop-7 |
| Queue wait to merge, median / p90 (min) | 0.88 / 1.20 |
| Queue wait to removal, median / p90 (min) | 1.32 / 1.32 |
| Push to enqueued (PR check + enqueue), median (min) | 0.38 |
| Kick-outs (by cause) | 2 (conflict 2) |
| Kick-outs by GitHub reason | CONFLICTING 1, merged 1 |
| Rebases: with agent / without agent | 1 / 1 |
| Actions runs: PR checks / merge groups | 9 / 8 |
| Actions minutes (PR / group / total) | 1.79 / 1.69 / 3.48 |
| Runner pickup, median (s) | 3.0 |
| Actions job / suite step, median (s) | 12.0 / 2.0 |
| Merges: PRs / merge operations / max PRs in 60 s | 8 / 6 / 3 |
| GitHub API: mutations / pushes / rate-limited | 30 / 11 / 0 |
| Push wait in rate limiter (s) | 49.52 |

## Config

```json
{
  "agents": 4,
  "ci_seconds": 0.0,
  "ci_slots": 2,
  "batch": null,
  "seed": 7,
  "budget_usd": 25.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": false,
  "snapshot": null,
  "queue_hold": null,
  "error_budget": null,
  "footprint": "predictor",
  "tasks": 8,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t001 | green | a0 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a1 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a2 | 0 | 1 | 0 | src/billing | src, src/billing | True |
| t004 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a0 | 1 | 1 | 0 | src/lib | src/lib | True |
| t006 | green | a1 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a3 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a2 | 0 | 0 | 0 | src/inventory | src/inventory | True |
