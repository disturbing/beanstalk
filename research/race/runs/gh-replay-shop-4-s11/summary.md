# Race: github-queue / replay

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=github-queue, agent=replay (replay control: reference patches, synthetic timings)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 83.95 |
| Tasks green / landed / dropped / total | 25 / 25 / 15 / 40 |
| Drops by reason | replay could not resolve the conflict or red (limitation of replay agents): 15 |
| Wall-clock (min) | 17.87 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 1.87 / 2.47 |
| Agent minutes busy / blocked / idle | 17.78 / 47.92 / 5.77 |
| Invocations (initial / rework / fixer / classifier) | 40 / 16 / 0 / 0 |
| Cost USD (total) | 0.0 |
| Cost USD by kind | initial 0.0000, rework 0.0000 |
| CI runs / minutes | 64 / 14.43 |
| CI runs by purpose | precheck 39, batch 25 |
| Textual conflicts met | 2 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 25 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 0 |
| Footprint (predictor) vs actual: P / R / F1 | 0.68 / 0.48 / 0.54 |
| Footprint vs oracle: P / R / F1 | 0.68 / 0.48 / 0.54 |
| Ejections (conflict / red) | 2 / 14 |
| GitHub repo | https://github.com/kintohubtest/beanstalk-race-shop-11 |
| Queue wait to merge, median / p90 (min) | 0.85 / 1.03 |
| Queue wait to removal, median / p90 (min) | - / - |
| Push to enqueued (PR check + enqueue), median (min) | 0.44 |
| Kick-outs (by cause) | 16 (conflict 2, red 14) |
| Kick-outs by GitHub reason | CONFLICTING 2, PR_CHECK_FAILED 14 |
| Rebases: with agent / without agent | 16 / 0 |
| Actions runs: PR checks / merge groups | 39 / 25 |
| Actions minutes (PR / group / total) | 8.74 / 5.67 / 14.41 |
| Runner pickup, median (s) | 3.0 |
| Actions job / suite step, median (s) | 13.0 / 3.0 |
| Merges: PRs / merge operations / max PRs in 60 s | 25 / 19 / 4 |
| GitHub API: mutations / pushes / rate-limited | 169 / 42 / 0 |
| Push wait in rate limiter (s) | 89.63 |

## Config

```json
{
  "agents": 4,
  "ci_seconds": 0.0,
  "ci_slots": 2,
  "batch": null,
  "seed": 11,
  "budget_usd": 25.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
  "union_merge": false,
  "snapshot": null,
  "queue_hold": null,
  "error_budget": null,
  "footprint": "predictor",
  "tasks": 40,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t001 | green | a0 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a1 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a2 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t004 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a0 | 1 | 1 | 0 | src/lib | src/lib | True |
| t006 | green | a2 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a3 | 0 | 0 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a1 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a2 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | dropped | a3 | 1 | 0 | 1 | src/db | - | False |
| t011 | dropped | a0 | 1 | 0 | 1 | src/orders | - | False |
| t012 | green | a1 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a3 | 0 | 0 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a2 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | dropped | a0 | 1 | 0 | 1 | src/billing | - | False |
| t016 | green | a1 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | dropped | a0 | 1 | 0 | 1 | src/orders | - | False |
| t018 | green | a3 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a2 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a0 | 0 | 0 | 0 | src/auth | src/auth, src/users | True |
| t021 | green | a1 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | dropped | a2 | 1 | 0 | 1 | src/billing | - | False |
| t023 | dropped | a3 | 1 | 0 | 1 | src/billing | - | False |
| t024 | dropped | a0 | 1 | 0 | 1 | src/db | - | False |
| t025 | dropped | a1 | 1 | 0 | 1 | src/notifications | - | False |
| t026 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | dropped | a2 | 1 | 0 | 1 | src/db | - | False |
| t028 | green | a0 | 0 | 0 | 0 | src/orders | src, src/shipping | True |
| t029 | dropped | a1 | 1 | 0 | 1 | src/cart | - | False |
| t030 | green | a2 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | dropped | a3 | 1 | 0 | 1 | src/billing | - | False |
| t032 | dropped | a1 | 1 | 0 | 1 | src/billing | - | False |
| t033 | green | a0 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | dropped | a3 | 1 | 0 | 1 | src/inventory | - | False |
| t035 | green | a2 | 0 | 0 | 0 | src/cart | src/cart, src/inventory | True |
| t036 | green | a1 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t037 | green | a3 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a0 | 0 | 0 | 0 | src/cart | src/billing | True |
| t039 | dropped | a2 | 1 | 1 | 0 | src/billing | - | False |
| t040 | dropped | a1 | 1 | 0 | 1 | src/db | - | False |
