# Race: queue / replay

_measured: arena=fastify@810e3d54/76b98b25, 38 tasks, policy=queue, agent=replay (replay control: reference patches, synthetic timings)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 111.013 |
| Tasks green / landed / dropped / total | 30 / 30 / 8 / 38 |
| Drops by reason | replay could not resolve the conflict or red (limitation of replay agents): 8 |
| Wall-clock (min) | 16.21 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 1.14 / 6.42 |
| Agent minutes busy / blocked / idle | 23.71 / 78.06 / 27.95 |
| Invocations (initial / rework / fixer / classifier) | 38 / 13 / 0 / 0 |
| Cost USD (total) | 0.0 |
| Cost USD by kind | initial 0.0000, rework 0.0000 |
| CI runs / minutes | 55 / 28.61 |
| CI runs by purpose | batch 28, batch-cancelled 11, bisect 16 |
| Textual conflicts met | 4 |
| Red validations | 12 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 32 / 38 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | test/404s.test.js, test/client-timeout.test.js, test/close.test.js, test/constrained-routes.test.js, test/content-parser.test.js, test/content-type.test.js, test/custom-parser.0.test.js, test/custom-parser.1.test.js, test/custom-parser.3.test.js, test/hooks.test.js, test/http-methods/get.test.js, test/http-methods/lock.test.js, test/http-methods/propfind.test.js, test/http-methods/proppatch.test.js, test/http2/plain.test.js, test/https/https.test.js, test/internals/errors.test.js, test/internals/reply.test.js, test/internals/request.test.js, test/issue-4959.test.js, test/logger/logging.test.js, test/max-requests-per-socket.test.js, test/reply-error.test.js, test/reply-trailers.test.js, test/request-error.test.js, test/route.6.test.js, test/route.7.test.js, test/schema-examples.test.js, test/schema-feature.test.js, test/schema-serialization.test.js, test/schema-special-usage.test.js, test/schema-validation.test.js, test/server.test.js, test/skip-reply-send.test.js, test/trust-proxy.test.js, test/types/fastify.test-d.ts, test/types/instance.test-d.ts, test/types/logger.test-d.ts, test/types/register.test-d.ts, test/types/reply.test-d.ts, test/types/request.test-d.ts, test/types/route.test-d.ts, test/validation-error-handling.test.js |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.5333 / 0.5111 / 0.5167 |
| Footprint vs oracle: P / R / F1 | 0.5333 / 0.5111 / 0.5167 |
| Batches (green / red / cancelled) | 15 / 9 / 15 |
| Bisections / bisect CI runs | 6 / 16 |
| Ejections (conflict / red) | 4 / 9 |
| PRs held behind in-flight conflicts | 4 |
| Mean batch size | 1.795 |

## Config

```json
{
  "agents": 8,
  "ci_seconds": 1.0,
  "ci_slots": 4,
  "batch": 4,
  "seed": 1,
  "budget_usd": 25.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": false,
  "snapshot": null,
  "queue_hold": true,
  "error_budget": null,
  "footprint": "predictor",
  "tasks": 38,
  "protect_tests": "own"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t001 | green | a0 | 0 | 0 | 0 | lib | lib | True |
| t002 | green | a1 | 0 | 0 | 0 | lib | lib | True |
| t003 | green | a2 | 0 | 0 | 0 | types | lib | True |
| t004 | green | a3 | 0 | 0 | 0 | lib | lib | True |
| t005 | dropped | a4 | 1 | 1 | 0 | types | - | True |
| t006 | green | a5 | 0 | 0 | 0 | types | (root), lib, types | True |
| t007 | green | a6 | 1 | 1 | 0 | types | lib | True |
| t008 | green | a7 | 0 | 0 | 0 | types | lib | True |
| t009 | dropped | a3 | 1 | 1 | 0 | lib | - | False |
| t010 | green | a5 | 0 | 0 | 0 | types | lib | True |
| t011 | green | a7 | 0 | 0 | 0 | lib | lib | True |
| t012 | green | a0 | 0 | 0 | 0 | .github/workflows | lib | True |
| t013 | dropped | a1 | 1 | 0 | 1 | types | - | False |
| t014 | green | a2 | 0 | 0 | 0 | types | lib | True |
| t015 | green | a5 | 0 | 0 | 0 | lib | lib | True |
| t016 | green | a7 | 0 | 0 | 0 | lib | lib | True |
| t017 | dropped | a4 | 1 | 0 | 1 | lib | - | False |
| t018 | dropped | a3 | 1 | 0 | 1 | types | - | False |
| t019 | green | a0 | 0 | 0 | 0 | .github/workflows | lib, types | True |
| t020 | dropped | a2 | 1 | 0 | 1 | lib | - | False |
| t021 | green | a5 | 1 | 0 | 1 | lib | lib | True |
| t022 | green | a7 | 1 | 0 | 1 | examples | lib | True |
| t023 | dropped | a1 | 1 | 0 | 1 | types | - | True |
| t024 | green | a3 | 0 | 0 | 0 | types | lib | True |
| t025 | green | a4 | 0 | 0 | 0 | lib | lib | True |
| t026 | dropped | a2 | 1 | 1 | 0 | .github/workflows | - | False |
| t027 | green | a0 | 0 | 0 | 0 | lib | lib | True |
| t028 | green | a3 | 0 | 0 | 0 | lib | lib | True |
| t029 | green | a4 | 0 | 0 | 0 | lib | lib | True |
| t030 | green | a5 | 1 | 0 | 1 | .github/workflows | lib | True |
| t031 | green | a6 | 0 | 0 | 0 | lib | lib | True |
| t032 | green | a7 | 0 | 0 | 0 | types | lib | True |
| t033 | green | a0 | 1 | 0 | 1 | types | (root) | True |
| t034 | green | a2 | 0 | 0 | 0 | lib | lib | True |
| t035 | green | a3 | 0 | 0 | 0 | lib | lib | True |
| t036 | green | a4 | 0 | 0 | 0 | lib | lib | True |
| t037 | green | a6 | 0 | 0 | 0 | examples/benchmark | lib | True |
| t038 | green | a7 | 0 | 0 | 0 | types | lib | True |
