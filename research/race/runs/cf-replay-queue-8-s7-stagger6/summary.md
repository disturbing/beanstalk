# Race: queue / replay

_forge: cloudflare, run 660sbtb9xp on https://beanstalk-gateway.devaccounts-1password.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=queue, agent=replay (replay control: reference patches, synthetic timings)_

**Aborted:** squash failed: runner /v1/squash answered 502: {"code":"remote_failed","message":"git fetch against https://<account-id>.artifacts.cloudflare.net/git/beanstalk-race/race-660sbtb9xp-t008.git failed: error: RPC failed; HTTP 500 curl 22 The requested URL returned error: 500\nfatal: expected 'acknowledgments'"}

| Metric | Value |
|---|---|
| Changes reaching green per hour | 190.179 |
| Tasks green / landed / dropped / total | 6 / 6 / 0 / 40 |
| Drops by reason | none |
| Wall-clock (min) | 1.89 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 0.94 / 1.12 |
| Agent minutes busy / blocked / idle | 6.96 / 5.29 / 2.89 |
| Invocations (initial / rework / fixer / classifier) | 10 / 1 / 0 / 0 |
| Cost USD (total) | 0 |
| Cost USD by kind | initial 0.0000, rework 0.0000 |
| CI runs / minutes | 6 / 1.97 |
| CI runs by purpose | batch 5, batch-cancelled 1 |
| Textual conflicts met | 1 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 6 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.8333 / 0.4444 / 0.5556 |
| Footprint vs oracle: P / R / F1 | 0.8333 / 0.4444 / 0.5556 |
| Batches (green / red / cancelled) | 5 / 0 / 0 |
| Bisections / bisect CI runs | 0 / 0 |
| Ejections (conflict / red) | 1 / 0 |
| PRs held behind in-flight conflicts | 0 |
| Mean batch size | 1.167 |

## Config

```json
{
  "agents": 8,
  "ci_seconds": 4.5,
  "ci_slots": 2,
  "batch": 4,
  "seed": 7,
  "budget_usd": 25,
  "max_turns": 40,
  "agent_timeout": 900,
  "union_merge": false,
  "snapshot": null,
  "queue_hold": true,
  "error_budget": null,
  "footprint": "predictor",
  "tasks": 40,
  "protect_tests": "own"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t001 | green | a0 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a1 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a2 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | testing | a4 | 1 | 1 | 0 | src/lib | - | False |
| t006 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a6 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | queued | a7 | 0 | 0 | 0 | src/inventory | - | False |
| t009 | running | a0 | 0 | 0 | 0 | src/orders | - | False |
| t010 | running | a1 | 0 | 0 | 0 | src/db | - | False |
| t011 | running | a2 | 0 | 0 | 0 | src/orders | - | False |
| t012 | running | a3 | 0 | 0 | 0 | src/auth | - | False |
| t013 | running | a5 | 0 | 0 | 0 | src/notifications | - | False |
| t014 | running | a6 | 0 | 0 | 0 | src/auth | - | False |
| t015 | pending | - | 0 | 0 | 0 | src/billing | - | False |
| t016 | pending | - | 0 | 0 | 0 | src/billing | - | False |
| t017 | pending | - | 0 | 0 | 0 | src/orders | - | False |
| t018 | pending | - | 0 | 0 | 0 | src/orders | - | False |
| t019 | pending | - | 0 | 0 | 0 | src/cart | - | False |
| t020 | pending | - | 0 | 0 | 0 | src/auth | - | False |
| t021 | pending | - | 0 | 0 | 0 | src/db | - | False |
| t022 | pending | - | 0 | 0 | 0 | src/billing | - | False |
| t023 | pending | - | 0 | 0 | 0 | src/billing | - | False |
| t024 | pending | - | 0 | 0 | 0 | src/db | - | False |
| t025 | pending | - | 0 | 0 | 0 | src/notifications | - | False |
| t026 | pending | - | 0 | 0 | 0 | src/billing | - | False |
| t027 | pending | - | 0 | 0 | 0 | src/db | - | False |
| t028 | pending | - | 0 | 0 | 0 | src/orders | - | False |
| t029 | pending | - | 0 | 0 | 0 | src/cart | - | False |
| t030 | pending | - | 0 | 0 | 0 | src/cart | - | False |
| t031 | pending | - | 0 | 0 | 0 | src/billing | - | False |
| t032 | pending | - | 0 | 0 | 0 | src/billing | - | False |
| t033 | pending | - | 0 | 0 | 0 | src/shipping | - | False |
| t034 | pending | - | 0 | 0 | 0 | src/inventory | - | False |
| t035 | pending | - | 0 | 0 | 0 | src/cart | - | False |
| t036 | pending | - | 0 | 0 | 0 | src/billing | - | False |
| t037 | pending | - | 0 | 0 | 0 | src/db | - | False |
| t038 | pending | - | 0 | 0 | 0 | src/cart | - | False |
| t039 | pending | - | 0 | 0 | 0 | src/billing | - | False |
| t040 | pending | - | 0 | 0 | 0 | src/db | - | False |
