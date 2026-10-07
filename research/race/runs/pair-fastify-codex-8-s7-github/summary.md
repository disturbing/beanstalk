# Race: github-queue / codex

_measured: arena=fastify@810e3d54/76b98b25, 38 tasks, policy=github-queue, agent=codex (gpt-6.1-sol)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 78.977 |
| Tasks green / landed / dropped / total | 37 / 37 / 1 / 38 |
| Drops by reason | ejected (conflict): 1 |
| Wall-clock (min) | 28.11 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 5.04 / 6.55 |
| Agent minutes busy / blocked / idle | 59.9 / 145.45 / 19.52 |
| Invocations (initial / rework / fixer / classifier) | 38 / 6 / 0 / 0 |
| Cost USD (total) | 3.571 |
| Cost USD by kind | initial 3.1194, rework 0.4515 |
| CI runs / minutes | 77 / 71.08 |
| CI runs by purpose | precheck 40, batch 37 |
| Textual conflicts met | 7 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 37 / 38 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | test/404s.test.js, test/content-parser.test.js, test/custom-parser.0.test.js, test/custom-parser.1.test.js, test/custom-parser.3.test.js, test/find-route.test.js, test/http2/plain.test.js, test/internals/errors.test.js, test/internals/reply.test.js, test/internals/request.test.js, test/internals/validation.test.js, test/logger/logging.test.js, test/logger/options.test.js, test/reply-trailers.test.js, test/router-options.test.js, test/schema-validation.test.js, test/trust-proxy.test.js, test/types/fastify.test-d.ts, test/types/instance.test-d.ts, test/types/request.test-d.ts, test/validation-error-handling.test.js |
| Acceptance tests restored before commit (own / other tasks') | 0 / 1 |
| Footprint (predictor) vs actual: P / R / F1 | 0.5135 / 0.464 / 0.4775 |
| Footprint vs oracle: P / R / F1 | 0.5135 / 0.4685 / 0.482 |
| Ejections (conflict / red) | 7 / 0 |
| GitHub repo | https://github.com/kintohubtest/beanstalk-race-fastify-7 |
| Queue wait to merge, median / p90 (min) | 2.38 / 3.32 |
| Queue wait to removal, median / p90 (min) | 3.20 / 3.52 |
| Push to enqueued (PR check + enqueue), median (min) | 1.12 |
| Kick-outs (by cause) | 7 (conflict 7) |
| Kick-outs by GitHub reason | CONFLICTING 6, merge_conflict 1 |
| Rebases: with agent / without agent | 6 / 0 |
| Actions runs: PR checks / merge groups | 40 / 37 |
| Actions minutes (PR / group / total) | 37.34 / 33.73 / 71.07 |
| Runner pickup, median (s) | 3.0 |
| Actions job / suite step, median (s) | 56.0 / 37.0 |
| Merges: PRs / merge operations / max PRs in 60 s | 37 / 25 / 3 |
| GitHub API: mutations / pushes / rate-limited | 126 / 45 / 0 |
| Push wait in rate limiter (s) | 55.07 |

## Config

```json
{
  "agents": 8,
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
  "tasks": 38,
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
| t005 | green | a4 | 0 | 0 | 0 | types | (root), lib | True |
| t006 | green | a5 | 1 | 1 | 0 | types | (root), lib, types | True |
| t007 | green | a6 | 0 | 0 | 0 | types | lib | True |
| t008 | green | a7 | 0 | 0 | 0 | types | lib | True |
| t009 | dropped | a0 | 3 | 4 | 0 | lib | - | False |
| t010 | green | a2 | 0 | 0 | 0 | types | lib | True |
| t011 | green | a1 | 0 | 0 | 0 | lib | lib | True |
| t012 | green | a3 | 0 | 0 | 0 | .github/workflows | lib | True |
| t013 | green | a4 | 1 | 1 | 0 | types | lib, types | True |
| t014 | green | a7 | 0 | 0 | 0 | types, .github/workflows | lib | True |
| t015 | green | a2 | 0 | 0 | 0 | lib | lib | True |
| t016 | green | a6 | 0 | 0 | 0 | lib | lib | True |
| t017 | green | a1 | 0 | 0 | 0 | lib | (root), lib, types | True |
| t018 | green | a3 | 0 | 0 | 0 | types | lib | True |
| t019 | green | a5 | 0 | 0 | 0 | .github/workflows | lib | True |
| t020 | green | a7 | 0 | 0 | 0 | lib | lib | True |
| t021 | green | a2 | 0 | 0 | 0 | lib | lib | True |
| t022 | green | a3 | 0 | 0 | 0 | examples | lib | True |
| t023 | green | a6 | 0 | 0 | 0 | types | lib | True |
| t024 | green | a4 | 0 | 0 | 0 | types | lib | True |
| t025 | green | a5 | 0 | 0 | 0 | lib | lib | True |
| t026 | green | a1 | 0 | 0 | 0 | .github/workflows | lib | True |
| t027 | green | a7 | 0 | 0 | 0 | lib | lib | True |
| t028 | green | a0 | 0 | 0 | 0 | lib | lib | True |
| t029 | green | a2 | 1 | 1 | 0 | lib | lib | True |
| t030 | green | a6 | 0 | 0 | 0 | .github/workflows | lib | True |
| t031 | green | a3 | 0 | 0 | 0 | lib | lib | True |
| t032 | green | a5 | 0 | 0 | 0 | types | lib | True |
| t033 | green | a4 | 0 | 0 | 0 | types | (root) | True |
| t034 | green | a7 | 0 | 0 | 0 | lib | lib | True |
| t035 | green | a0 | 0 | 0 | 0 | lib | lib | True |
| t036 | green | a1 | 0 | 0 | 0 | lib | lib | True |
| t037 | green | a6 | 0 | 0 | 0 | examples/benchmark | lib | True |
| t038 | green | a5 | 0 | 0 | 0 | types | lib | True |
