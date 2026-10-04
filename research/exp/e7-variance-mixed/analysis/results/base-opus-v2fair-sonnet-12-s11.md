## opus-v2fair-sonnet-12-s11 (v2, fleet: claude only)

| | claude |
|---|---|
| tasks authored | 40 |
| first attempt passes its own acceptance tests (pass of checked) | 38 of 40 |
| first attempt passes the whole suite of its snapshot (pass of checked) | 32 of 40 |
| reached green | 34 |
| green and accepted | 34 |
| dropped | 6 |
| landed with no conflict, red or rework | 25 |
| textual conflicts met | 16 |
| tasks with a conflict | 9 |
| red pre-land checks / red batches | 23 |
| tasks with a red | 12 |
|   of which its own acceptance tests failed | 6 |
|   of which only other tasks' tests failed | 17 |
| rework rounds on its tasks | 36 |
| tasks needing at least one rework | 15 |
| invocations run (initial / rework) | 40 / 36 |
| agent cost, USD (all its invocations) | 5.62 |
| tokens, thousands: fresh input / cache read + write / output | 1 / 8641 / 156 |
| cost per initial invocation, USD | 0.068 |
| cost per rework invocation, USD | 0.081 |
| initial invocation wall time, median s | 20.4 |
| initial invocation turns/items, median | 10.0 |
| rework wall time, median s | 18.5 |
| non-success invocations | 0 |
| timeouts | 0 |
| tasks where the agent edited a protected test | 1 |
| hot files touched per change | 0.57 |
| files per change | 2.05 |

Rework rounds by the vendor that ran them, and what happened next for that task:

| Executing vendor | rework rounds | next: landed | next: collided again | next: dropped | on the other vendor's task |
|---|---|---|---|---|---|
| claude | 36 | 10 | 24 | 2 | 0 |

### Concurrent landed pairs (leave-one-out revert)

| Pair type | concurrent pairs probed | conflicting | conflict rate [Wilson 95%] | entangled (excluded) | pairs sharing a file | share-a-file rate [Wilson 95%] | conflicts among sharing pairs |
|---|---|---|---|---|---|---|---|
| same-claude | 230 | 2 | 0.9% [0.2%, 3.1%] | 14 | 25 | 10.9% [7.5%, 15.6%] | 2 of 25 |

Logged conflict events by collider vendor: 0.0 cross, 9.0 same (7 unattributed); cross share of events 0.00 against 0.00 of 244 concurrent pairs.
