## opus-queue-sonnet-12-s11 (queue, fleet: claude only)

| | claude |
|---|---|
| tasks authored | 40 |
| first attempt passes its own acceptance tests (pass of checked) | 40 of 40 |
| first attempt passes the whole suite of its snapshot (pass of checked) | 40 of 40 |
| reached green | 34 |
| green and accepted | 34 |
| dropped | 6 |
| landed with no conflict, red or rework | 25 |
| textual conflicts met | 22 |
| tasks with a conflict | 14 |
| red pre-land checks / red batches | 14 |
| tasks with a red | 8 |
|   of which its own acceptance tests failed | 6 |
|   of which only other tasks' tests failed | 8 |
| rework rounds on its tasks | 30 |
| tasks needing at least one rework | 15 |
| invocations run (initial / rework) | 40 / 30 |
| agent cost, USD (all its invocations) | 4.10 |
| tokens, thousands: fresh input / cache read + write / output | 1 / 5446 / 132 |
| cost per initial invocation, USD | 0.059 |
| cost per rework invocation, USD | 0.058 |
| initial invocation wall time, median s | 15.5 |
| initial invocation turns/items, median | 9.0 |
| rework wall time, median s | 14.1 |
| non-success invocations | 0 |
| timeouts | 0 |
| tasks where the agent edited a protected test | 3 |
| hot files touched per change | 0.57 |
| files per change | 2.05 |

Rework rounds by the vendor that ran them, and what happened next for that task:

| Executing vendor | rework rounds | next: landed | next: collided again | next: dropped | on the other vendor's task |
|---|---|---|---|---|---|
| claude | 30 | 9 | 21 | 0 | 0 |

### Concurrent landed pairs (leave-one-out revert)

| Pair type | concurrent pairs probed | conflicting | conflict rate [Wilson 95%] | entangled (excluded) | pairs sharing a file | share-a-file rate [Wilson 95%] | conflicts among sharing pairs |
|---|---|---|---|---|---|---|---|
| same-claude | 529 | 7 | 1.3% [0.6%, 2.7%] | 32 | 62 | 11.7% [9.3%, 14.7%] | 6 of 62 |

Logged conflict events by collider vendor: 0.0 cross, 22.0 same (0 unattributed); cross share of events 0.00 against 0.00 of 561 concurrent pairs.
