# Race: beanstalk / codex

_forge: cloudflare, run fhmwii6hzt on https://beanstalk-gateway.<account>.workers.dev_

_measured: arena=fastify@810e3d54/76b98b25, 38 tasks, policy=beanstalk, agent=codex (gpt-6.1-sol)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 93.639 |
| Tasks green / landed / dropped / total | 38 / 38 / 0 / 38 |
| Drops by reason | none |
| Parked, needs a person | none |
| Wall-clock (min) | 24.35 |
| Wall-clock to all-green (min) | 24.32 |
| Task start to green, median / p90 (min) | 4.84 / 7.66 |
| Agent minutes busy / blocked / idle | 82.61 / 0 / 14.78 |
| Invocations (initial / rework / fixer / classifier) | 38 / 5 / 0 / 0 |
| Cost USD (total) | 3.5506 |
| Cost USD by kind | initial 3.1630, rework 0.3876 |
| CI runs / minutes | 32 / 28.93 |
| CI runs by purpose | validate 32 |
| Textual conflicts met | 4 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 38 / 38 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | test/content-parser.test.js, test/content-type.test.js, test/custom-parser.0.test.js, test/custom-parser.1.test.js, test/custom-parser.3.test.js, test/find-route.test.js, test/http2/plain.test.js, test/internals/errors.test.js, test/internals/initial-config.test.js, test/internals/request.test.js, test/logger/logging.test.js, test/logger/options.test.js, test/reply-error.test.js, test/reply-trailers.test.js, test/router-options.test.js, test/schema-validation.test.js, test/trust-proxy.test.js, test/types/fastify.test-d.ts, test/types/instance.test-d.ts, test/types/request.test-d.ts, test/validation-error-handling.test.js |
| Acceptance tests restored before commit (own / other tasks') | 0 / 2 |
| Footprint (predictor) vs actual: P / R / F1 | 0.5263 / 0.4649 / 0.4825 |
| Footprint vs oracle: P / R / F1 | 0.5263 / 0.4649 / 0.4825 |
| Variant | v2.5: v2.4, with escalation after one repeated red, every landed party reconciled, lone suspects reverted at once, base and dynamic culprits, a wider window, structural merges, start cards and one rescue + dependency-aware starts |
| Informed reworks / decision cards / revert-first tickets | 1 / 0 / 0 |
| Agent released on check / reworks that waited for an agent / wait minutes | yes / 5 / 2.43 |
| Validation re-runs / suspected flakes | 0 / 0 |
| Inherited reds waited out (no rework round spent) | 0 |
| Reconciles (reconciled / contradictions) / stale re-checks | 0 (0 / 0) / 0 |
| Escalate after (failed repairs) / reconcile parties / dropped stuck after a card | 1 / 3 / 0 |
| Start cards / rescues / dynamic culprit searches (probes) | 0 / 0 / 1 (0) |
| Max bean invocations / tail guard minutes / dropped by each | 10 / 3 / 0 / 0 |
| Sprout resets (beans requeued) / episode reds (inherited checks) / repair landings | 0 (0) / 0 (0) / 0 |
| Checks reused as validations / superseded CI runs cancelled | 3 / 0 |
| Tests first (accepted / fallbacks) / targeted landing checks (red) | off / off |
| Sprout window at the end / window waits / early tickets / re-check samples | 16 / 0 / 0 / 3 |
| Spec amendments (amended / none / rejected / rolled back) / re-executions / adopted in place | 0 / 0 / 0 / 0 / 0 / 0 |
| Pre-land checks (red) / reworks / drops | 54 (1) / 1 / 0 |
| Pre-land check minutes | 55.33 |
| Re-check rule / skipped (adaptive) / hunk-disjoint / hunk-overlap | sampled / 10 / 0 / 0 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 0.0 / 35 / 13 / 1 |
| Placements disjoint / overlapping | 7 / 31 |
| Fast-trunk landings (task / fixer / revert) | 38 / 0 / 0 |
| Validations (green / red) | 32 / 0 |
| Repair tickets (closed / escalated / by method) | 0 / 0 / {} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 4,
  "ci_seconds": 0,
  "ci_slots": 2,
  "batch": null,
  "seed": 7,
  "budget_usd": 15,
  "max_turns": 40,
  "agent_timeout": 900,
  "union_merge": true,
  "snapshot": "head",
  "queue_hold": null,
  "error_budget": 999,
  "footprint": "predictor",
  "tasks": 38,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t001 | green | a2 | 0 | 0 | 0 | lib | lib | True |
| t002 | green | a0 | 0 | 0 | 0 | lib | lib | True |
| t003 | green | a1 | 0 | 0 | 0 | types, .github/workflows | lib | True |
| t004 | green | a3 | 0 | 0 | 0 | lib | lib | True |
| t005 | green | a1 | 0 | 0 | 0 | types | (root), lib | True |
| t006 | green | a2 | 0 | 0 | 0 | types | (root), lib, types | True |
| t007 | green | a0 | 0 | 0 | 0 | types | lib | True |
| t008 | green | a3 | 0 | 0 | 0 | types | lib | True |
| t009 | green | a1 | 1 | 1 | 0 | lib | (root), lib, types | True |
| t010 | green | a2 | 0 | 0 | 0 | types | lib | True |
| t011 | green | a0 | 0 | 0 | 0 | lib | lib | True |
| t012 | green | a3 | 0 | 0 | 0 | .github/workflows | lib | True |
| t013 | green | a1 | 3 | 2 | 0 | types | lib, types | True |
| t014 | green | a1 | 0 | 0 | 0 | types, .github/workflows | lib | True |
| t015 | green | a3 | 0 | 0 | 0 | lib | lib | True |
| t016 | green | a0 | 0 | 0 | 0 | lib | lib | True |
| t017 | green | a3 | 0 | 0 | 0 | lib | lib, types | True |
| t018 | green | a0 | 0 | 0 | 0 | types | lib | True |
| t019 | green | a3 | 0 | 0 | 0 | .github/workflows | lib | True |
| t020 | green | a1 | 0 | 0 | 0 | lib | lib | True |
| t021 | green | a2 | 0 | 0 | 0 | lib | lib | True |
| t022 | green | a0 | 0 | 0 | 0 | examples | lib | True |
| t023 | green | a2 | 0 | 0 | 0 | types | lib | True |
| t024 | green | a3 | 0 | 0 | 0 | types | lib | True |
| t025 | green | a1 | 0 | 0 | 0 | lib | lib | True |
| t026 | green | a1 | 0 | 0 | 0 | .github/workflows | lib | True |
| t027 | green | a2 | 0 | 0 | 0 | lib | lib | True |
| t028 | green | a0 | 0 | 0 | 0 | lib | lib | True |
| t029 | green | a2 | 0 | 0 | 0 | lib | lib | True |
| t030 | green | a2 | 0 | 0 | 0 | .github/workflows | lib | True |
| t031 | green | a3 | 1 | 1 | 0 | lib | lib | True |
| t032 | green | a1 | 0 | 0 | 0 | types | lib | True |
| t033 | green | a0 | 0 | 0 | 0 | types | (root) | True |
| t034 | green | a2 | 0 | 0 | 0 | lib | lib | True |
| t035 | green | a1 | 0 | 0 | 0 | lib | lib | True |
| t036 | green | a2 | 0 | 0 | 0 | lib | lib | True |
| t037 | green | a0 | 0 | 0 | 0 | examples/benchmark | lib | True |
| t038 | green | a3 | 0 | 0 | 0 | types | lib | True |
