# Race: beanstalk / codex

_forge: cloudflare, run 7a8c4115wo on https://beanstalk-gateway.devaccounts-1password.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 1 tasks, policy=beanstalk, agent=codex ()_

**Aborted:** swarm: every slot exited before the run ended (every slot exited)

| Metric | Value |
|---|---|
| Changes reaching green per hour | 0 |
| Tasks green / landed / dropped / total | 0 / 0 / 0 / 1 |
| Drops by reason | none |
| Parked, needs a person | none |
| Wall-clock (min) | 1.43 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | - / - |
| Agent minutes busy / blocked / idle | 1.25 / 0 / 0.18 |
| Invocations (initial / rework / fixer / classifier) | 0 / 0 / 0 / 0 |
| Cost USD (total) | 0 |
| Cost USD by kind | - |
| CI runs / minutes | 0 / 0 |
| CI runs by purpose | - |
| Textual conflicts met | 0 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 0 / 1 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | - / - / - |
| Footprint vs oracle: P / R / F1 | - / - / - |
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
| Checks reused as validations / superseded CI runs cancelled | 0 / 0 |
| Tests first (accepted / fallbacks) / targeted landing checks (red) | off / off |
| Sprout window at the end / window waits / early tickets / re-check samples | 8 / 0 / 0 / 0 |
| Spec amendments (amended / none / rejected / rolled back) / re-executions / adopted in place | 0 / 0 / 0 / 0 / 0 / 0 |
| Pre-land checks (red) / reworks / drops | 0 (0) / 0 / 0 |
| Pre-land check minutes | 0.0 |
| Re-check rule / skipped (adaptive) / hunk-disjoint / hunk-overlap | sampled / 0 / 0 / 0 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 4.5 / 0 / 0 / 0 |
| Placements disjoint / overlapping | 1 / 0 |
| Fast-trunk landings (task / fixer / revert) | 0 / 0 / 0 |
| Validations (green / red) | 0 / 0 |
| Repair tickets (closed / escalated / by method) | 0 / 0 / {} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 1,
  "ci_seconds": 4.5,
  "ci_slots": 2,
  "batch": null,
  "seed": 7,
  "budget_usd": 2,
  "max_turns": 40,
  "agent_timeout": 600,
  "union_merge": true,
  "snapshot": "head",
  "queue_hold": null,
  "error_budget": 999,
  "footprint": "predictor",
  "tasks": 1,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t001 | running | a0 | 0 | 0 | 0 | src/orders | - | False |
