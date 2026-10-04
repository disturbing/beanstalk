## e7-queue-mixed-12-s7 (queue, fleet: {'claude': 6, 'codex': 6})

| | claude | codex |
|---|---|---|
| tasks authored | 27 | 13 |
| first attempt passes its own acceptance tests (pass of checked) | 27 of 27 | 13 of 13 |
| first attempt passes the whole suite of its snapshot (pass of checked) | 27 of 27 | 13 of 13 |
| reached green | 23 | 13 |
| green and accepted | 23 | 13 |
| dropped | 4 | 0 |
| landed with no conflict, red or rework | 16 | 10 |
| textual conflicts met | 18 | 5 |
| tasks with a conflict | 10 | 3 |
| red pre-land checks / red batches | 7 | 1 |
| tasks with a red | 5 | 1 |
|   of which its own acceptance tests failed | 5 | 1 |
|   of which only other tasks' tests failed | 2 | 0 |
| rework rounds on its tasks | 21 | 6 |
| tasks needing at least one rework | 11 | 3 |
| invocations run (initial / rework) | 27 / 20 | 13 / 7 |
| agent cost, USD (all its invocations) | 3.11 | 0.89 |
| tokens, thousands: fresh input / cache read + write / output | 1 / 3770 / 97 | 450 / 1524 / 14 |
| cost per initial invocation, USD | 0.054 | 0.041 |
| cost per rework invocation, USD | 0.083 | 0.052 |
| initial invocation wall time, median s | 17.2 | 38.1 |
| initial invocation turns/items, median | 9 | 7 |
| rework wall time, median s | 15.0 | 44.9 |
| non-success invocations | 0 | 0 |
| timeouts | 0 | 0 |
| tasks where the agent edited a protected test | 1 | 0 |
| hot files touched per change | 0.70 | 0.31 |
| files per change | 2.19 | 1.62 |

Rework rounds by the vendor that ran them, and what happened next for that task:

| Executing vendor | rework rounds | next: landed | next: collided again | next: dropped | on the other vendor's task |
|---|---|---|---|---|---|
| claude | 20 | 7 | 13 | 0 | 3 |
| codex | 7 | 3 | 4 | 0 | 4 |

Codex models observed (from Codex session rollouts): {'gpt-6.1-sol (effort model default)': 20} (0 rollouts not found)

### Concurrent landed pairs (leave-one-out revert)

| Pair type | concurrent pairs probed | conflicting | conflict rate [Wilson 95%] | entangled (excluded) | pairs sharing a file | share-a-file rate [Wilson 95%] | conflicts among sharing pairs |
|---|---|---|---|---|---|---|---|
| cross | 265 | 9 | 3.4% [1.8%, 6.3%] | 34 | 23 | 8.7% [5.9%, 12.7%] | 9 of 23 |
| same-claude | 246 | 5 | 2.0% [0.9%, 4.7%] | 7 | 33 | 13.4% [9.7%, 18.2%] | 5 of 33 |
| same-codex | 66 | 0 | 0.0% [0.0%, 5.5%] | 12 | 3 | 4.5% [1.6%, 12.5%] | 0 of 3 |
| same (all) | 312 | 5 | 1.6% [0.7%, 3.7%] |  | 36 | 11.5% [8.5%, 15.6%] | 5 of 36 |

Fisher exact, cross vs same: conflict rate p = 0.184; share-a-file rate p = 0.273

Logged conflict events by collider vendor: 8.9 cross, 14.1 same (0 unattributed); cross share of events 0.39 against 0.47 of 630 concurrent pairs.
