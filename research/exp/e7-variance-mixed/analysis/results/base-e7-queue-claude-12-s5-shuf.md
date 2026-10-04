## e7-queue-claude-12-s5-shuf (queue, fleet: claude only)

| | claude |
|---|---|
| tasks authored | 40 |
| first attempt passes its own acceptance tests (pass of checked) | 40 of 40 |
| first attempt passes the whole suite of its snapshot (pass of checked) | 40 of 40 |
| reached green | 36 |
| green and accepted | 36 |
| dropped | 4 |
| landed with no conflict, red or rework | 25 |
| textual conflicts met | 22 |
| tasks with a conflict | 13 |
| red pre-land checks / red batches | 10 |
| tasks with a red | 7 |
|   of which its own acceptance tests failed | 6 |
|   of which only other tasks' tests failed | 4 |
| rework rounds on its tasks | 28 |
| tasks needing at least one rework | 15 |
| invocations run (initial / rework) | 40 / 28 |
| agent cost, USD (all its invocations) | 4.87 |
| tokens, thousands: fresh input / cache read + write / output | 1 / 5858 / 145 |
| cost per initial invocation, USD | 0.052 |
| cost per rework invocation, USD | 0.099 |
| initial invocation wall time, median s | 19.9 |
| initial invocation turns/items, median | 9.5 |
| rework wall time, median s | 23.5 |
| non-success invocations | 0 |
| timeouts | 0 |
| tasks where the agent edited a protected test | 3 |
| hot files touched per change | 0.57 |
| files per change | 2.05 |

Rework rounds by the vendor that ran them, and what happened next for that task:

| Executing vendor | rework rounds | next: landed | next: collided again | next: dropped | on the other vendor's task |
|---|---|---|---|---|---|
| claude | 28 | 11 | 17 | 0 | 0 |

### Concurrent landed pairs (leave-one-out revert)

| Pair type | concurrent pairs probed | conflicting | conflict rate [Wilson 95%] | entangled (excluded) | pairs sharing a file | share-a-file rate [Wilson 95%] | conflicts among sharing pairs |
|---|---|---|---|---|---|---|---|
| same-claude | 578 | 12 | 2.1% [1.2%, 3.6%] | 52 | 56 | 9.7% [7.5%, 12.4%] | 12 of 56 |

Logged conflict events by collider vendor: 0.0 cross, 22.0 same (0 unattributed); cross share of events 0.00 against 0.00 of 630 concurrent pairs.
