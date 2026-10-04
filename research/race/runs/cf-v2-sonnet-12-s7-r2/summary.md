# Race: beanstalk / claude

_forge: cloudflare, run 8598u7h6ss on https://beanstalk-gateway.devaccounts-1password.workers.dev_

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

**Aborted:** revert failed: runner /v1/revert answered 502: {"code":"remote_failed","message":"git push against https://<account-id>.artifacts.cloudflare.net/git/beanstalk-race/race-8598u7h6ss.git failed: remote: Processing objects: 100% (8/8)        \nerror: remote unpack failed: stored delta chain contains a cycle\nerror: failed to push some refs to 'https://<account-id>.artifacts.cloudflare.net/git/beanstalk-race/race-8598u7h6ss.git'\n!\tf55e71ad06231360ec8ace2284fbd80355d09f14:refs/beanstalk/candidates/f55e71ad

| Metric | Value |
|---|---|
| Changes reaching green per hour | 95.891 |
| Tasks green / landed / dropped / total | 27 / 34 / 5 / 40 |
| Drops by reason | declined by decision D001: 1; declined by decision D002: 1; pre-land check still red: 2; unresolved conflict: 1 |
| Wall-clock (min) | 16.89 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 4.14 / 7.22 |
| Agent minutes busy / blocked / idle | 25.06 / 121.32 / 56.35 |
| Invocations (initial / rework / fixer / classifier) | 40 / 18 / 0 / 0 |
| Cost USD (total) | 3.7952 |
| Cost USD by kind | initial 2.4528, rework 1.3424 |
| CI runs / minutes | 20 / 25.47 |
| CI runs by purpose | validate 17, bisect 3 |
| Textual conflicts met | 10 |
| Red validations | 3 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 28 / 40 |
| Final green correct (suite + every green task's acceptance) | True |
| Base tests edited by landed changes | none |
| Acceptance tests restored before commit (own / other tasks') | 0 / 5 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6176 / 0.4681 / 0.5118 |
| Footprint vs oracle: P / R / F1 | 0.6471 / 0.4681 / 0.5216 |
| Variant | v2: pre-land check, informed author repair, decision cards, revert-first |
| Informed reworks / decision cards / revert-first tickets | 8 / 3 / 1 |
| Pre-land checks (red) / reworks / drops | 77 (13) / 8 / 2 |
| Pre-land check minutes | 96.7 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 32 / 22 / 1 |
| Placements disjoint / overlapping | 40 / 0 |
| Fast-trunk landings (task / fixer / revert) | 34 / 0 / 0 |
| Validations (green / red) | 14 / 3 |
| Repair tickets (closed / escalated / by method) | 0 / 1 / {'read-set': 1} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 12,
  "ci_seconds": 60,
  "ci_slots": 2,
  "batch": null,
  "seed": 7,
  "budget_usd": 75,
  "max_turns": 40,
  "agent_timeout": 900,
  "union_merge": true,
  "snapshot": "head",
  "queue_hold": null,
  "error_budget": 999,
  "footprint": "predictor",
  "tasks": 40,
  "protect_tests": "landed"
}
```

## Tasks

| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |
|---|---|---|---|---|---|---|---|---|
| t001 | green | a7 | 0 | 0 | 0 | src/orders | src/billing | True |
| t002 | green | a5 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a6 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t004 | green | a10 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a9 | 0 | 0 | 0 | src/lib | src/lib | True |
| t006 | green | a1 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a11 | 1 | 1 | 0 | src/orders | src, src/db, src/orders | True |
| t008 | green | a3 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a0 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | dropped | a2 | 3 | 3 | 0 | src/db | - | False |
| t011 | green | a4 | 0 | 0 | 0 | src/orders | src, src/db, src/orders, src/shipping | True |
| t012 | green | a8 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | dropped | a10 | 3 | 2 | 0 | src/notifications | - | False |
| t014 | green | a8 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t016 | green | a9 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a7 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a4 | 0 | 0 | 0 | src/orders | src/notifications | True |
| t019 | green | a5 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a8 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a1 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | green | a7 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t023 | green | a9 | 0 | 0 | 0 | src/billing | src/billing, src/lib | True |
| t024 | dropped | a4 | 3 | 2 | 0 | src/db | - | False |
| t025 | green | a11 | 0 | 0 | 0 | src/notifications | src/notifications | True |
| t026 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a8 | 0 | 0 | 0 | src/db | src/users | True |
| t028 | green | a1 | 0 | 0 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a7 | 0 | 0 | 0 | src/cart | src/inventory, src/orders | True |
| t030 | landed | a2 | 0 | 0 | 0 | src/cart | src/orders | False |
| t031 | running | a0 | 2 | 0 | 0 | src/billing | - | False |
| t032 | dropped | a11 | 2 | 0 | 0 | src/billing | - | False |
| t033 | landed | a3 | 0 | 0 | 0 | src/shipping | src/shipping | False |
| t034 | landed | a8 | 1 | 1 | 0 | src/inventory | src/inventory | True |
| t035 | green | a6 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | landed | a5 | 0 | 0 | 0 | src/billing | src, src/billing | False |
| t037 | landed | a1 | 0 | 0 | 0 | src/db | src/catalog | False |
| t038 | landed | a7 | 0 | 0 | 0 | src/cart | src/billing | False |
| t039 | dropped | a6 | 2 | 0 | 0 | src/billing | - | False |
| t040 | landed | a9 | 0 | 0 | 0 | src/db | src/billing | False |
