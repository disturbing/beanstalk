# Race: github-queue / codex

_measured: arena=fastify@810e3d54/76b98b25, 38 tasks, policy=github-queue, agent=codex (gpt-6.1-sol)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 72.089 |
| Tasks green / landed / dropped / total | 37 / 37 / 1 / 38 |
| Drops by reason | ejected (conflict): 1 |
| Wall-clock (min) | 30.8 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 7.17 / 11.87 |
| Agent minutes busy / blocked / idle | 64.37 / 5.87 / 52.94 |
| Invocations (initial / rework / fixer / classifier) | 38 / 8 / 0 / 0 |
| Cost USD (total) | 3.9134 |
| Cost USD by kind | initial 3.3763, rework 0.5370 |
| CI runs / minutes | 82 / 75.23 |
| CI runs by purpose | precheck 45, batch 37 |
| Textual conflicts met | 9 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 37 / 38 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | test/404s.test.js, test/content-parser.test.js, test/custom-parser.0.test.js, test/custom-parser.1.test.js, test/custom-parser.3.test.js, test/diagnostics-channel/error-before-handler.test.js, test/diagnostics-channel/error-request.test.js, test/diagnostics-channel/error-status.test.js, test/find-route.test.js, test/http2/plain.test.js, test/internals/errors.test.js, test/internals/reply.test.js, test/internals/request.test.js, test/logger/logging.test.js, test/logger/options.test.js, test/reply-error.test.js, test/reply-trailers.test.js, test/route-prefix.test.js, test/router-options.test.js, test/schema-validation.test.js, test/trust-proxy.test.js, test/types/fastify.test-d.ts, test/types/instance.test-d.ts, test/types/request.test-d.ts, test/validation-error-handling.test.js |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.5135 / 0.4685 / 0.482 |
| Footprint vs oracle: P / R / F1 | 0.5135 / 0.4685 / 0.482 |
| Ejections (conflict / red) | 9 / 0 |
| GitHub repo | https://github.com/kintohubtest/beanstalk-race-fastify-7 |
| Queue wait to merge, median / p90 (min) | 3.22 / 7.91 |
| Queue wait to removal, median / p90 (min) | 2.75 / 8.00 |
| Push to enqueued (PR check + enqueue), median (min) | 1.13 |
| Kick-outs (by cause) | 9 (conflict 9) |
| Kick-outs by GitHub reason | CONFLICTING 4, merge_conflict 5 |
| Rebases: with agent / without agent | 8 / 0 |
| Actions runs: PR checks / merge groups | 45 / 37 |
| Actions minutes (PR / group / total) | 41.21 / 34.02 / 75.23 |
| Runner pickup, median (s) | 3.0 |
| Actions job / suite step, median (s) | 56.0 / 37.0 |
| Merges: PRs / merge operations / max PRs in 60 s | 37 / 21 / 3 |
| GitHub API: mutations / pushes / rate-limited | 132 / 47 / 0 |
| Push wait in rate limiter (s) | 106.59 |

## Config

```json
{
  "agents": 4,
  "ci_seconds": 0.0,
  "ci_slots": 2,
  "batch": null,
  "seed": 7,
  "budget_usd": 15.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": false,
  "snapshot": null,
  "queue_hold": null,
  "error_budget": null,
  "footprint": "predictor",
  "tasks": 38,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t001 | green | a1 | 0 | 0 | 0 | lib | lib | True |
| t002 | green | a2 | 0 | 0 | 0 | lib | lib | True |
| t003 | green | a0 | 0 | 0 | 0 | types, .github/workflows | lib | True |
| t004 | green | a3 | 0 | 0 | 0 | lib | lib | True |
| t005 | green | a1 | 0 | 0 | 0 | types | (root), lib | True |
| t006 | green | a0 | 1 | 1 | 0 | types | (root), lib, types | True |
| t007 | green | a2 | 0 | 0 | 0 | types | lib | True |
| t008 | green | a3 | 0 | 0 | 0 | types | lib | True |
| t009 | dropped | a2 | 3 | 4 | 0 | lib | - | False |
| t010 | green | a3 | 0 | 0 | 0 | types | lib | True |
| t011 | green | a0 | 0 | 0 | 0 | lib | lib | True |
| t012 | green | a1 | 0 | 0 | 0 | .github/workflows | lib | True |
| t013 | green | a3 | 2 | 2 | 0 | types | lib, types | True |
| t014 | green | a0 | 0 | 0 | 0 | types, .github/workflows | lib | True |
| t015 | green | a0 | 0 | 0 | 0 | lib | lib | True |
| t016 | green | a3 | 0 | 0 | 0 | lib | lib | True |
| t017 | green | a3 | 0 | 0 | 0 | lib | lib, types | True |
| t018 | green | a0 | 0 | 0 | 0 | types | lib | True |
| t019 | green | a3 | 1 | 1 | 0 | .github/workflows | lib | True |
| t020 | green | a1 | 0 | 0 | 0 | lib | lib | True |
| t021 | green | a2 | 0 | 0 | 0 | lib | lib | True |
| t022 | green | a1 | 0 | 0 | 0 | examples | lib | True |
| t023 | green | a0 | 0 | 0 | 0 | types | lib | True |
| t024 | green | a3 | 0 | 0 | 0 | types | lib | True |
| t025 | green | a0 | 0 | 0 | 0 | lib | lib | True |
| t026 | green | a2 | 0 | 0 | 0 | .github/workflows | lib | True |
| t027 | green | a2 | 0 | 0 | 0 | lib | lib | True |
| t028 | green | a3 | 0 | 0 | 0 | lib | lib | True |
| t029 | green | a1 | 0 | 0 | 0 | lib | lib | True |
| t030 | green | a0 | 0 | 0 | 0 | .github/workflows | lib | True |
| t031 | green | a0 | 1 | 1 | 0 | lib | lib | True |
| t032 | green | a3 | 0 | 0 | 0 | types | lib | True |
| t033 | green | a0 | 0 | 0 | 0 | types | (root) | True |
| t034 | green | a1 | 0 | 0 | 0 | lib | lib | True |
| t035 | green | a0 | 0 | 0 | 0 | lib | lib | True |
| t036 | green | a3 | 0 | 0 | 0 | lib | lib | True |
| t037 | green | a1 | 0 | 0 | 0 | examples/benchmark | lib | True |
| t038 | green | a2 | 0 | 0 | 0 | types | lib | True |
