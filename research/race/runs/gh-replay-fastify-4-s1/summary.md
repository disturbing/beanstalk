# Race: github-queue / replay

_measured: arena=fastify@810e3d54/76b98b25, 6 tasks, policy=github-queue, agent=replay (replay control: reference patches, synthetic timings)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 46.913 |
| Tasks green / landed / dropped / total | 5 / 5 / 1 / 6 |
| Drops by reason | replay could not resolve the conflict or red (limitation of replay agents): 1 |
| Wall-clock (min) | 6.39 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 2.94 / 4.32 |
| Agent minutes busy / blocked / idle | 2.84 / 17.96 / 4.79 |
| Invocations (initial / rework / fixer / classifier) | 6 / 1 / 0 / 0 |
| Cost USD (total) | 0.0 |
| Cost USD by kind | initial 0.0000, rework 0.0000 |
| CI runs / minutes | 11 / 9.2 |
| CI runs by purpose | precheck 6, batch 5 |
| Textual conflicts met | 1 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 6 / 6 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | test/issue-4959.test.js, test/logger/logging.test.js, test/route.6.test.js, test/route.7.test.js, test/types/fastify.test-d.ts, test/types/instance.test-d.ts, test/validation-error-handling.test.js |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.8 / 0.6667 / 0.7 |
| Footprint vs oracle: P / R / F1 | 0.8 / 0.6667 / 0.7 |
| Ejections (conflict / red) | 1 / 0 |
| GitHub repo | https://github.com/kintohubtest/beanstalk-race-fastify-1 |
| Queue wait to merge, median / p90 (min) | 1.67 / 2.43 |
| Queue wait to removal, median / p90 (min) | 1.23 / 1.23 |
| Push to enqueued (PR check + enqueue), median (min) | 0.98 |
| Kick-outs (by cause) | 1 (conflict 1) |
| Kick-outs by GitHub reason | merge_conflict 1 |
| Rebases: with agent / without agent | 1 / 0 |
| Actions runs: PR checks / merge groups | 6 / 5 |
| Actions minutes (PR / group / total) | 4.98 / 4.21 / 9.19 |
| Runner pickup, median (s) | 3.0 |
| Actions job / suite step, median (s) | 50.0 / 32.0 |
| Merges: PRs / merge operations / max PRs in 60 s | 5 / 3 / 2 |
| GitHub API: mutations / pushes / rate-limited | 25 / 7 / 0 |
| Push wait in rate limiter (s) | 20.1 |

## Config

```json
{
  "agents": 4,
  "ci_seconds": 0.0,
  "ci_slots": 2,
  "batch": null,
  "seed": 1,
  "budget_usd": 25.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": false,
  "snapshot": null,
  "queue_hold": null,
  "error_budget": null,
  "footprint": "predictor",
  "tasks": 6,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t001 | green | a0 | 0 | 0 | 0 | lib | lib | True |
| t002 | green | a1 | 0 | 0 | 0 | lib | lib | True |
| t003 | green | a2 | 0 | 0 | 0 | types, .github/workflows | lib | True |
| t004 | green | a3 | 0 | 0 | 0 | lib | lib | True |
| t005 | dropped | a2 | 1 | 1 | 0 | types | - | True |
| t006 | green | a3 | 0 | 0 | 0 | types | (root), lib, types | True |
