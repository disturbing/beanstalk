# Race: github-queue / codex

_measured: arena=fastify@810e3d54/76b98b25, 38 tasks, policy=github-queue, agent=codex (gpt-6.1-sol)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 51.487 |
| Tasks green / landed / dropped / total | 38 / 38 / 0 / 38 |
| Drops by reason | none |
| Wall-clock (min) | 44.28 |
| Wall-clock to all-green (min) | 44.28 |
| Task start to green, median / p90 (min) | 3.98 / 6.73 |
| Agent minutes busy / blocked / idle | 54.09 / 117.94 / 5.1 |
| Invocations (initial / rework / fixer / classifier) | 38 / 5 / 0 / 0 |
| Cost USD (total) | 3.3105 |
| Cost USD by kind | initial 2.9745, rework 0.3360 |
| CI runs / minutes | 83 / 73.97 |
| CI runs by purpose | precheck 41, batch 41, precheck-cancelled 1 |
| Textual conflicts met | 3 |
| Red validations | 3 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 38 / 38 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | test/404s.test.js, test/content-parser.test.js, test/custom-parser.0.test.js, test/custom-parser.1.test.js, test/custom-parser.3.test.js, test/diagnostics-channel/error-before-handler.test.js, test/find-route.test.js, test/http2/plain.test.js, test/internals/errors.test.js, test/internals/initial-config.test.js, test/internals/request.test.js, test/logger/logging.test.js, test/logger/options.test.js, test/reply-trailers.test.js, test/router-options.test.js, test/schema-validation.test.js, test/trust-proxy.test.js, test/types/fastify.test-d.ts, test/types/instance.test-d.ts, test/types/request.test-d.ts, test/validation-error-handling.test.js |
| Acceptance tests restored before commit (own / other tasks') | 0 / 1 |
| Footprint (predictor) vs actual: P / R / F1 | 0.5263 / 0.4912 / 0.4825 |
| Footprint vs oracle: P / R / F1 | 0.5263 / 0.4649 / 0.4825 |
| Ejections (conflict / red) | 3 / 2 |
| GitHub repo | https://github.com/kintohubtest/beanstalk-race-fastify-7 |
| Queue wait to merge, median / p90 (min) | 1.48 / 2.20 |
| Queue wait to removal, median / p90 (min) | 1.42 / 2.45 |
| Push to enqueued (PR check + enqueue), median (min) | 4.12 |
| Kick-outs (by cause) | 5 (conflict 3, red 2) |
| Kick-outs by GitHub reason | CONFLICTING 2, failed_checks 2, merge_conflict 1 |
| Rebases: with agent / without agent | 5 / 0 |
| Actions runs: PR checks / merge groups | 42 / 41 |
| Actions minutes (PR / group / total) | 37.48 / 36.46 / 73.94 |
| Runner pickup, median (s) | 3.0 |
| Actions job / suite step, median (s) | 56.0 / 37.0 |
| Merges: PRs / merge operations / max PRs in 60 s | 38 / 34 / 2 |
| GitHub API: mutations / pushes / rate-limited | 120 / 44 / 0 |
| Push wait in rate limiter (s) | 8.52 |

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
| t001 | green | a0 | 0 | 0 | 0 | lib | lib | True |
| t002 | green | a1 | 0 | 0 | 0 | lib | lib | True |
| t003 | green | a2 | 0 | 0 | 0 | types, .github/workflows | lib | True |
| t004 | green | a3 | 0 | 0 | 0 | lib | lib | True |
| t005 | green | a0 | 0 | 0 | 0 | types | (root), lib | True |
| t006 | green | a2 | 1 | 1 | 0 | types | (root), lib, types | True |
| t007 | green | a1 | 0 | 0 | 0 | types | lib | True |
| t008 | green | a3 | 0 | 0 | 0 | types | lib | True |
| t009 | green | a0 | 1 | 1 | 0 | lib | (root), lib, types | True |
| t010 | green | a3 | 0 | 0 | 0 | types | lib | True |
| t011 | green | a2 | 0 | 0 | 0 | lib | lib | True |
| t012 | green | a1 | 0 | 0 | 0 | .github/workflows | lib | True |
| t013 | green | a2 | 1 | 1 | 0 | types | lib, types | True |
| t014 | green | a3 | 0 | 0 | 0 | types, .github/workflows | lib | True |
| t015 | green | a1 | 0 | 0 | 0 | lib | lib | True |
| t016 | green | a0 | 0 | 0 | 0 | lib | lib | True |
| t017 | green | a3 | 0 | 0 | 0 | lib | lib, types | True |
| t018 | green | a1 | 2 | 0 | 2 | types | - | True |
| t019 | green | a0 | 0 | 0 | 0 | .github/workflows | lib | True |
| t020 | green | a2 | 0 | 0 | 0 | lib | lib | True |
| t021 | green | a3 | 0 | 0 | 0 | lib | lib | True |
| t022 | green | a0 | 0 | 0 | 0 | examples | lib | True |
| t023 | green | a2 | 0 | 0 | 0 | types | lib | True |
| t024 | green | a3 | 0 | 0 | 0 | types | lib | True |
| t025 | green | a1 | 0 | 0 | 0 | lib | lib | True |
| t026 | green | a0 | 0 | 0 | 0 | .github/workflows | lib | True |
| t027 | green | a2 | 0 | 0 | 0 | lib | lib | True |
| t028 | green | a3 | 0 | 0 | 0 | lib | lib | True |
| t029 | green | a1 | 0 | 0 | 0 | lib | lib | True |
| t030 | green | a0 | 0 | 0 | 0 | .github/workflows | lib | True |
| t031 | green | a2 | 0 | 0 | 0 | lib | lib | True |
| t032 | green | a3 | 0 | 0 | 0 | types | lib | True |
| t033 | green | a1 | 0 | 0 | 0 | types | (root) | True |
| t034 | green | a0 | 0 | 0 | 0 | lib | lib | True |
| t035 | green | a2 | 0 | 0 | 0 | lib | lib | True |
| t036 | green | a3 | 0 | 0 | 0 | lib | lib | True |
| t037 | green | a1 | 0 | 0 | 0 | examples/benchmark | lib | True |
| t038 | green | a0 | 0 | 0 | 0 | types | lib | True |
