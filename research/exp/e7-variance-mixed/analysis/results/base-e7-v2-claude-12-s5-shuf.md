## e7-v2-claude-12-s5-shuf (v2, fleet: claude only)

| | claude |
|---|---|
| tasks authored | 40 |
| first attempt passes its own acceptance tests (pass of checked) | 39 of 40 |
| first attempt passes the whole suite of its snapshot (pass of checked) | 37 of 40 |
| reached green | 37 |
| green and accepted | 37 |
| dropped | 3 |
| landed with no conflict, red or rework | 28 |
| textual conflicts met | 15 |
| tasks with a conflict | 11 |
| red pre-land checks / red batches | 16 |
| tasks with a red | 12 |
|   of which its own acceptance tests failed | 8 |
|   of which only other tasks' tests failed | 8 |
| rework rounds on its tasks | 29 |
| tasks needing at least one rework | 12 |
| invocations run (initial / rework) | 40 / 29 |
| agent cost, USD (all its invocations) | 5.60 |
| tokens, thousands: fresh input / cache read + write / output | 1 / 7381 / 145 |
| cost per initial invocation, USD | 0.054 |
| cost per rework invocation, USD | 0.118 |
| initial invocation wall time, median s | 21.3 |
| initial invocation turns/items, median | 9.0 |
| rework wall time, median s | 25.2 |
| non-success invocations | 0 |
| timeouts | 0 |
| tasks where the agent edited a protected test | 1 |
| hot files touched per change | 0.57 |
| files per change | 2.02 |

Rework rounds by the vendor that ran them, and what happened next for that task:

| Executing vendor | rework rounds | next: landed | next: collided again | next: dropped | on the other vendor's task |
|---|---|---|---|---|---|
| claude | 29 | 9 | 19 | 1 | 0 |

### Concurrent landed pairs (leave-one-out revert)

| Pair type | concurrent pairs probed | conflicting | conflict rate [Wilson 95%] | entangled (excluded) | pairs sharing a file | share-a-file rate [Wilson 95%] | conflicts among sharing pairs |
|---|---|---|---|---|---|---|---|
| same-claude | 288 | 6 | 2.1% [1.0%, 4.5%] | 16 | 32 | 11.1% [8.0%, 15.3%] | 4 of 32 |

Logged conflict events by collider vendor: 0.0 cross, 15.0 same (0 unattributed); cross share of events 0.00 against 0.00 of 304 concurrent pairs.
