# Race: beanstalk / replay

_forge: cloudflare, run uvis16a7v0 on https://beanstalk-gateway-staging.devaccounts-1password.workers.dev_

_measured: arena=fastify@810e3d54/76b98b25, 8 tasks, policy=beanstalk, agent=replay (replay control: reference patches, synthetic timings)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 61.054 |
| Tasks green / landed / dropped / total | 8 / 8 / 0 / 8 |
| Drops by reason | none |
| Parked, needs a person | none |
| Wall-clock (min) | 7.86 |
| Wall-clock to all-green (min) | 7.84 |
| Task start to green, median / p90 (min) | 4.81 / 5.73 |
| Agent minutes busy / blocked / idle | 15.56 / 0 / 15.89 |
| Invocations (initial / rework / fixer / classifier) | 8 / 1 / 0 / 0 |
| Cost USD (total) | 0 |
| Cost USD by kind | initial 0.0000, rework 0.0000 |
| CI runs / minutes | 3 / 2.92 |
| CI runs by purpose | validate 1, validate-cancelled 2 |
| Textual conflicts met | 1 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 8 / 8 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | test/content-parser.test.js, test/content-type.test.js, test/custom-parser.0.test.js, test/custom-parser.1.test.js, test/custom-parser.3.test.js, test/issue-4959.test.js, test/logger/logging.test.js, test/route.6.test.js, test/route.7.test.js, test/schema-validation.test.js, test/types/fastify.test-d.ts, test/types/instance.test-d.ts, test/validation-error-handling.test.js |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.5 / 0.4167 / 0.4375 |
| Footprint vs oracle: P / R / F1 | 0.5 / 0.4167 / 0.4375 |
| Variant | v2.5: v2.4, with escalation after one repeated red, every landed party reconciled, lone suspects reverted at once, base and dynamic culprits, a wider window, structural merges, start cards and one rescue + dependency-aware starts |
| Informed reworks / decision cards / revert-first tickets | 0 / 0 / 0 |
| Agent released on check / reworks that waited for an agent / wait minutes | yes / 0 / 0.0 |
| Validation re-runs / suspected flakes | 0 / 0 |
| Inherited reds waited out (no rework round spent) | 0 |
| Reconciles (reconciled / contradictions) / stale re-checks | 0 (0 / 0) / 0 |
| Escalate after (failed repairs) / reconcile parties / dropped stuck after a card | 1 / 3 / 0 |
| Start cards / rescues / dynamic culprit searches (probes) | 0 / 0 / 0 (0) |
| Max bean invocations / tail guard minutes / dropped by each | 10 / 3 / 0 / 0 |
| Sprout resets (beans requeued) / episode reds (inherited checks) / repair landings | 0 (0) / 0 (0) / 0 |
| Checks reused as validations / superseded CI runs cancelled | 4 / 2 |
| Tests first (accepted / fallbacks) / targeted landing checks (red) | off / off |
| Sprout window at the end / window waits / early tickets / re-check samples | 16 / 0 / 0 / 0 |
| Spec amendments (amended / none / rejected / rolled back) / re-executions / adopted in place | 0 / 0 / 0 / 0 / 0 / 0 |
| Pre-land checks (red) / reworks / drops | 12 (0) / 0 / 0 |
| Pre-land check minutes | 12.08 |
| Re-check rule / skipped (adaptive) / hunk-disjoint / hunk-overlap | sampled / 0 / 0 / 0 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 0.0 / 4 / 3 / 1 |
| Placements disjoint / overlapping | 2 / 6 |
| Fast-trunk landings (task / fixer / revert) | 8 / 0 / 0 |
| Validations (green / red) | 1 / 0 |
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
  "budget_usd": 25,
  "max_turns": 40,
  "agent_timeout": 900,
  "union_merge": true,
  "snapshot": "head",
  "queue_hold": null,
  "error_budget": 999,
  "footprint": "predictor",
  "tasks": 8,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t001 | green | a3 | 0 | 0 | 0 | lib | lib | True |
| t002 | green | a2 | 0 | 0 | 0 | lib | lib | True |
| t003 | green | a0 | 0 | 0 | 0 | types, .github/workflows | lib | True |
| t004 | green | a1 | 0 | 0 | 0 | lib | lib | True |
| t005 | green | a3 | 0 | 0 | 0 | types | (root), lib | True |
| t006 | green | a0 | 1 | 1 | 0 | types | (root), lib, types | True |
| t007 | green | a1 | 0 | 0 | 0 | types | lib | True |
| t008 | green | a2 | 0 | 0 | 0 | types | lib | True |
