# Race: beanstalk / replay

_measured: arena=fastify@810e3d54/76b98b25, 38 tasks, policy=beanstalk, agent=replay (replay control: reference patches, synthetic timings)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 105.181 |
| Tasks green / landed / dropped / total | 30 / 30 / 8 / 38 |
| Drops by reason | replay could not repair the pre-land failure (limitation of replay agents): 4; replay could not resolve the conflict (limitation of replay agents): 4 |
| Wall-clock (min) | 17.11 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 2.64 / 6.83 |
| Agent minutes busy / blocked / idle | 14.76 / 111.33 / 10.82 |
| Invocations (initial / rework / fixer / classifier) | 38 / 14 / 5 / 0 |
| Cost USD (total) | 0.0 |
| Cost USD by kind | fixer 0.0000, initial 0.0000, rework 0.0000 |
| CI runs / minutes | 30 / 15.88 |
| CI runs by purpose | validate 30 |
| Textual conflicts met | 7 |
| Red validations | 4 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 32 / 38 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | test/404s.test.js, test/client-timeout.test.js, test/close.test.js, test/constrained-routes.test.js, test/content-parser.test.js, test/hooks.test.js, test/http-methods/get.test.js, test/http-methods/lock.test.js, test/http-methods/propfind.test.js, test/http-methods/proppatch.test.js, test/http2/plain.test.js, test/https/https.test.js, test/internals/errors.test.js, test/internals/initial-config.test.js, test/internals/reply.test.js, test/internals/request.test.js, test/issue-4959.test.js, test/logger/logging.test.js, test/max-requests-per-socket.test.js, test/reply-error.test.js, test/reply-trailers.test.js, test/request-error.test.js, test/route.6.test.js, test/route.7.test.js, test/schema-examples.test.js, test/schema-feature.test.js, test/schema-serialization.test.js, test/schema-special-usage.test.js, test/schema-validation.test.js, test/server.test.js, test/skip-reply-send.test.js, test/trust-proxy.test.js, test/types/fastify.test-d.ts, test/types/instance.test-d.ts, test/types/logger.test-d.ts, test/types/register.test-d.ts, test/types/reply.test-d.ts, test/types/request.test-d.ts, test/types/route.test-d.ts, test/validation-error-handling.test.js |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.5667 / 0.5222 / 0.5333 |
| Footprint vs oracle: P / R / F1 | 0.5667 / 0.5222 / 0.5333 |
| Variant | v2: pre-land check, informed author repair, decision cards, revert-first |
| Informed reworks / decision cards / revert-first tickets | 4 / 0 / 1 |
| Pre-land checks (red) / reworks / drops | 37 (7) / 7 / 0 |
| Pre-land check minutes | 16.77 |
| Re-check rule / skipped (adaptive) / hunk-disjoint / hunk-overlap | file / 0 / 0 / 0 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | locked / 0.0 / 0 / 0 / 0 |
| Placements disjoint / overlapping | 38 / 0 |
| Fast-trunk landings (task / fixer / revert) | 30 / 0 / 0 |
| Validations (green / red) | 26 / 4 |
| Repair tickets (closed / escalated / by method) | 4 / 3 / {'bisect': 3, 'read-set': 1} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 8,
  "ci_seconds": 1.0,
  "ci_slots": 4,
  "batch": null,
  "seed": 1,
  "budget_usd": 25.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": true,
  "snapshot": "green",
  "queue_hold": null,
  "error_budget": 3,
  "footprint": "predictor",
  "tasks": 38,
  "protect_tests": "own"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t001 | green | a0 | 0 | 0 | 0 | lib | lib | True |
| t002 | green | a1 | 1 | 0 | 0 | lib | lib | True |
| t003 | green | a2 | 0 | 0 | 0 | types | lib | True |
| t004 | green | a3 | 0 | 0 | 0 | lib | lib | True |
| t005 | dropped | a4 | 1 | 1 | 0 | types | - | True |
| t006 | green | a5 | 0 | 0 | 0 | types | (root), lib, types | True |
| t007 | dropped | a6 | 1 | 1 | 0 | types | - | False |
| t008 | green | a7 | 0 | 0 | 0 | types | lib | True |
| t009 | green | a3 | 1 | 1 | 0 | lib | (root), lib, types | True |
| t010 | green | a5 | 0 | 0 | 0 | types | lib | True |
| t011 | green | a7 | 0 | 0 | 0 | lib | lib | True |
| t012 | dropped | a2 | 2 | 1 | 0 | .github/workflows | - | True |
| t013 | dropped | a4 | 1 | 0 | 0 | types | - | False |
| t014 | green | a6 | 0 | 0 | 0 | types | lib | True |
| t015 | green | a0 | 0 | 0 | 0 | lib | lib | True |
| t016 | green | a5 | 0 | 0 | 0 | lib | lib | True |
| t017 | dropped | a7 | 1 | 1 | 0 | lib | - | False |
| t018 | dropped | a6 | 1 | 0 | 0 | types | - | False |
| t019 | green | a4 | 0 | 0 | 0 | .github/workflows | lib, types | True |
| t020 | dropped | a0 | 1 | 0 | 0 | lib | - | False |
| t021 | green | a5 | 0 | 0 | 0 | lib | lib | True |
| t022 | green | a1 | 0 | 0 | 0 | examples | lib | True |
| t023 | green | a3 | 1 | 1 | 0 | types | lib | True |
| t024 | green | a4 | 0 | 0 | 0 | types | lib | True |
| t025 | green | a6 | 0 | 0 | 0 | lib | lib | True |
| t026 | green | a7 | 1 | 1 | 0 | .github/workflows | lib | True |
| t027 | green | a2 | 0 | 0 | 0 | lib | lib | True |
| t028 | green | a5 | 0 | 0 | 0 | lib | lib | True |
| t029 | green | a0 | 1 | 0 | 0 | lib | lib | True |
| t030 | green | a1 | 0 | 0 | 0 | .github/workflows | lib | True |
| t031 | green | a4 | 0 | 0 | 0 | lib | lib | True |
| t032 | dropped | a6 | 1 | 0 | 0 | types | - | False |
| t033 | green | a5 | 0 | 0 | 0 | types | (root) | True |
| t034 | green | a2 | 0 | 0 | 0 | lib | lib | True |
| t035 | green | a1 | 0 | 0 | 0 | lib | lib | True |
| t036 | green | a4 | 0 | 0 | 0 | lib | lib | True |
| t037 | green | a3 | 0 | 0 | 0 | examples/benchmark | lib | True |
| t038 | green | a5 | 0 | 0 | 0 | types | lib | True |
