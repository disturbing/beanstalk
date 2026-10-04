## opus-v2fair-sonnet-12-s7 (v2, fleet: claude only)

| | claude |
|---|---|
| tasks authored | 40 |
| first attempt passes its own acceptance tests (pass of checked) | 39 of 40 |
| first attempt passes the whole suite of its snapshot (pass of checked) | 35 of 40 |
| reached green | 35 |
| green and accepted | 35 |
| dropped | 5 |
| landed with no conflict, red or rework | 23 |
| textual conflicts met | 21 |
| tasks with a conflict | 15 |
| red pre-land checks / red batches | 17 |
| tasks with a red | 13 |
|   of which its own acceptance tests failed | 5 |
|   of which only other tasks' tests failed | 12 |
| rework rounds on its tasks | 37 |
| tasks needing at least one rework | 17 |
| invocations run (initial / rework) | 40 / 37 |
| agent cost, USD (all its invocations) | 5.29 |
| tokens, thousands: fresh input / cache read + write / output | 1 / 7955 / 150 |
| cost per initial invocation, USD | 0.063 |
| cost per rework invocation, USD | 0.074 |
| initial invocation wall time, median s | 17.2 |
| initial invocation turns/items, median | 10.0 |
| rework wall time, median s | 18.6 |
| non-success invocations | 0 |
| timeouts | 0 |
| tasks where the agent edited a protected test | 1 |
| hot files touched per change | 0.57 |
| files per change | 2.05 |

Rework rounds by the vendor that ran them, and what happened next for that task:

| Executing vendor | rework rounds | next: landed | next: collided again | next: dropped | on the other vendor's task |
|---|---|---|---|---|---|
| claude | 37 | 12 | 21 | 4 | 0 |

### Concurrent landed pairs (leave-one-out revert)

| Pair type | concurrent pairs probed | conflicting | conflict rate [Wilson 95%] | entangled (excluded) | pairs sharing a file | share-a-file rate [Wilson 95%] | conflicts among sharing pairs |
|---|---|---|---|---|---|---|---|
| same-claude | 228 | 7 | 3.1% [1.5%, 6.2%] | 21 | 17 | 7.5% [4.7%, 11.6%] | 5 of 17 |

Logged conflict events by collider vendor: 0.0 cross, 21.0 same (0 unattributed); cross share of events 0.00 against 0.00 of 249 concurrent pairs.
