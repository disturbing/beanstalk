# Race: beanstalk / claude

_measured: arena=arena@26eecce0/8c321b35, 40 tasks, policy=beanstalk, agent=claude (sonnet)_

| Metric | Value |
|---|---|
| Changes reaching green per hour | 154.451 |
| Tasks green / landed / dropped / total | 39 / 39 / 1 / 40 |
| Drops by reason | unresolved conflict: 1 |
| Wall-clock (min) | 15.15 |
| Wall-clock to all-green (min) | not reached |
| Task start to green, median / p90 (min) | 3.76 / 6.93 |
| Agent minutes busy / blocked / idle | 30.49 / 99.83 / 51.48 |
| Invocations (initial / rework / fixer / classifier) | 40 / 19 / 0 / 0 |
| Cost USD (total) | 5.9156 |
| Cost USD by kind | initial 3.4962, rework 2.4194 |
| CI runs / minutes | 20 / 20.73 |
| CI runs by purpose | validate 20 |
| Textual conflicts met | 18 |
| Red validations | 0 |
| Final green: suite green | True |
| Final green: tasks accepted / total | 33 / 40 |
| Final green correct (suite + every green task's acceptance) | False |
| Base tests edited by landed changes | src/auth/auth.test.ts, src/billing/billing.test.ts, src/billing/discounts.test.ts, src/billing/invoice.test.ts, src/billing/tax.test.ts, src/cart/cart.test.ts, src/catalog/catalog.test.ts, src/config.test.ts, src/db/migrate.test.ts, src/inventory/inventory.test.ts, src/lib/money.test.ts, src/notifications/notifications.test.ts, src/orders/checkout.test.ts, src/orders/orders.test.ts, src/shipping/shipping.test.ts, src/users/users.test.ts |
| Acceptance tests restored before commit (own / other tasks') | 0 / 3 |
| Footprint (predictor) vs actual: P / R / F1 | 0.6667 / 0.4581 / 0.5162 |
| Footprint vs oracle: P / R / F1 | 0.6667 / 0.4487 / 0.512 |
| Variant | v2, tests self: agents write their own tests; arena tests hidden (oracle only) |
| Landed beans with / without new test files | 1 / 38 |
| Informed reworks / decision cards / revert-first tickets | 1 / 0 / 0 |
| Pre-land checks (red) / reworks / drops | 84 (1) / 1 / 0 |
| Pre-land check minutes | 87.19 |
| Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks | optimistic / 60.0 / 33 / 29 / 3 |
| Placements disjoint / overlapping | 40 / 0 |
| Fast-trunk landings (task / fixer / revert) | 39 / 0 / 0 |
| Validations (green / red) | 20 / 0 |
| Repair tickets (closed / escalated / by method) | 0 / 0 / {} |
| Error-budget pauses / paused minutes | 0 / 0.0 |

## Config

```json
{
  "agents": 12,
  "ci_seconds": 60.0,
  "ci_slots": 2,
  "batch": null,
  "seed": 7,
  "budget_usd": 25.0,
  "max_turns": 40,
  "agent_timeout": 900.0,
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
| t001 | green | a0 | 0 | 0 | 0 | src/orders | src/billing, src/orders | True |
| t002 | green | a1 | 0 | 0 | 0 | src/orders | src/catalog, src/lib, src/orders | True |
| t003 | green | a2 | 2 | 2 | 0 | src/billing | src, src/billing | True |
| t004 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t005 | green | a4 | 0 | 0 | 0 | src/lib | src/lib | False |
| t006 | green | a5 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t007 | green | a6 | 3 | 3 | 0 | src/orders | src, src/db, src/lib, src/orders | True |
| t008 | green | a7 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t009 | green | a8 | 0 | 0 | 0 | src/orders | src, src/orders | True |
| t010 | green | a9 | 2 | 2 | 0 | src/db | src, src/billing, src/db, src/orders, src/users | True |
| t011 | green | a10 | 0 | 0 | 0 | src/orders | src, src/db, src/orders, src/shipping | True |
| t012 | green | a11 | 0 | 0 | 0 | src/auth | src/auth | True |
| t013 | green | a4 | 1 | 1 | 0 | src/notifications | src, src/billing, src/notifications | True |
| t014 | green | a7 | 0 | 0 | 0 | src/auth | src/auth | True |
| t015 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t016 | green | a0 | 0 | 0 | 0 | src/billing | src/billing | True |
| t017 | green | a11 | 0 | 0 | 0 | src/orders | src/billing | True |
| t018 | green | a1 | 0 | 0 | 0 | src/orders | src/notifications | False |
| t019 | green | a5 | 0 | 0 | 0 | src/cart | src, src/orders | True |
| t020 | green | a7 | 0 | 0 | 0 | src/auth | src/users | True |
| t021 | green | a10 | 0 | 0 | 0 | src/db | src/catalog | True |
| t022 | green | a11 | 1 | 1 | 0 | src/billing | src, src/billing | True |
| t023 | green | a1 | 0 | 0 | 0 | src/billing | src/billing, src/lib | True |
| t024 | dropped | a0 | 3 | 2 | 0 | src/db | - | False |
| t025 | green | a8 | 1 | 1 | 0 | src/notifications | src/notifications | False |
| t026 | green | a3 | 0 | 0 | 0 | src/billing | src/billing | True |
| t027 | green | a5 | 1 | 1 | 0 | src/db | src/users | True |
| t028 | green | a7 | 0 | 0 | 0 | src/orders | src, src/shipping | True |
| t029 | green | a4 | 1 | 1 | 0 | src/cart | src/orders | True |
| t030 | green | a10 | 0 | 0 | 0 | src/cart | src/orders | True |
| t031 | green | a1 | 1 | 1 | 0 | src/billing | src, src/billing | False |
| t032 | green | a10 | 1 | 1 | 0 | src/billing | src, src/orders | False |
| t033 | green | a11 | 0 | 0 | 0 | src/shipping | src/shipping | True |
| t034 | green | a3 | 0 | 0 | 0 | src/inventory | src/inventory | True |
| t035 | green | a7 | 0 | 0 | 0 | src/cart | src/cart | True |
| t036 | green | a5 | 1 | 1 | 0 | src/billing | src, src/billing | False |
| t037 | green | a8 | 0 | 0 | 0 | src/db | src/catalog | True |
| t038 | green | a9 | 1 | 1 | 0 | src/cart | src/billing | True |
| t039 | green | a3 | 0 | 0 | 0 | src/billing | src, src/billing | True |
| t040 | green | a1 | 0 | 0 | 0 | src/db | src/billing | True |
