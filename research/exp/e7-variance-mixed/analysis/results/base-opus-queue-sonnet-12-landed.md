## opus-queue-sonnet-12-landed (queue, fleet: claude only)

| | claude |
|---|---|
| tasks authored | 40 |
| first attempt passes its own acceptance tests (pass of checked) | 40 of 40 |
| first attempt passes the whole suite of its snapshot (pass of checked) | 40 of 40 |
| reached green | 37 |
| green and accepted | 37 |
| dropped | 3 |
| landed with no conflict, red or rework | 24 |
| textual conflicts met | 26 |
| tasks with a conflict | 15 |
| red pre-land checks / red batches | 7 |
| tasks with a red | 5 |
|   of which its own acceptance tests failed | 6 |
|   of which only other tasks' tests failed | 1 |
| rework rounds on its tasks | 30 |
| tasks needing at least one rework | 16 |
| invocations run (initial / rework) | 40 / 30 |
| agent cost, USD (all its invocations) | 4.42 |
| tokens, thousands: fresh input / cache read + write / output | 1 / 5694 / 133 |
| cost per initial invocation, USD | 0.051 |
| cost per rework invocation, USD | 0.079 |
| initial invocation wall time, median s | 17.6 |
| initial invocation turns/items, median | 9.0 |
| rework wall time, median s | 16.1 |
| non-success invocations | 0 |
| timeouts | 0 |
| tasks where the agent edited a protected test | 1 |
| hot files touched per change | 0.57 |
| files per change | 2.05 |

Rework rounds by the vendor that ran them, and what happened next for that task:

| Executing vendor | rework rounds | next: landed | next: collided again | next: dropped | on the other vendor's task |
|---|---|---|---|---|---|
| claude | 30 | 13 | 17 | 0 | 0 |

### Concurrent landed pairs (leave-one-out revert)

| Pair type | concurrent pairs probed | conflicting | conflict rate [Wilson 95%] | entangled (excluded) | pairs sharing a file | share-a-file rate [Wilson 95%] | conflicts among sharing pairs |
|---|---|---|---|---|---|---|---|
| same-claude | 604 | 12 | 2.0% [1.1%, 3.4%] | 62 | 64 | 10.6% [8.4%, 13.3%] | 11 of 64 |

Logged conflict events by collider vendor: 0.0 cross, 26.0 same (0 unattributed); cross share of events 0.00 against 0.00 of 666 concurrent pairs.
