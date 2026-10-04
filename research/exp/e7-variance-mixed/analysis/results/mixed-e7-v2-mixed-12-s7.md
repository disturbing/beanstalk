## e7-v2-mixed-12-s7 (v2, fleet: {'claude': 6, 'codex': 6})

| | claude | codex |
|---|---|---|
| tasks authored | 20 | 20 |
| first attempt passes its own acceptance tests (pass of checked) | 20 of 20 | 19 of 20 |
| first attempt passes the whole suite of its snapshot (pass of checked) | 18 of 20 | 17 of 20 |
| reached green | 18 | 18 |
| green and accepted | 18 | 18 |
| dropped | 2 | 2 |
| landed with no conflict, red or rework | 13 | 13 |
| textual conflicts met | 11 | 10 |
| tasks with a conflict | 7 | 7 |
| red pre-land checks / red batches | 8 | 5 |
| tasks with a red | 6 | 5 |
|   of which its own acceptance tests failed | 1 | 1 |
|   of which only other tasks' tests failed | 7 | 4 |
| rework rounds on its tasks | 18 | 15 |
| tasks needing at least one rework | 7 | 7 |
| invocations run (initial / rework) | 20 / 18 | 20 / 15 |
| agent cost, USD (all its invocations) | 3.04 | 1.51 |
| tokens, thousands: fresh input / cache read + write / output | 0 / 4013 / 78 | 728 / 2693 / 26 |
| cost per initial invocation, USD | 0.062 | 0.042 |
| cost per rework invocation, USD | 0.100 | 0.045 |
| initial invocation wall time, median s | 22.0 | 41.8 |
| initial invocation turns/items, median | 11.5 | 7.0 |
| rework wall time, median s | 16.9 | 48.3 |
| non-success invocations | 0 | 0 |
| timeouts | 0 | 0 |
| tasks where the agent edited a protected test | 1 | 0 |
| hot files touched per change | 0.85 | 0.35 |
| files per change | 2.45 | 1.65 |

Rework rounds by the vendor that ran them, and what happened next for that task:

| Executing vendor | rework rounds | next: landed | next: collided again | next: dropped | on the other vendor's task |
|---|---|---|---|---|---|
| claude | 18 | 5 | 12 | 1 | 0 |
| codex | 15 | 5 | 8 | 2 | 0 |

Codex models observed (from Codex session rollouts): {'gpt-6.1-sol (effort model default)': 35} (0 rollouts not found)

### Concurrent landed pairs (leave-one-out revert)

| Pair type | concurrent pairs probed | conflicting | conflict rate [Wilson 95%] | entangled (excluded) | pairs sharing a file | share-a-file rate [Wilson 95%] | conflicts among sharing pairs |
|---|---|---|---|---|---|---|---|
| cross | 135 | 3 | 2.2% [0.8%, 6.3%] | 10 | 16 | 11.9% [7.4%, 18.4%] | 2 of 16 |
| same-claude | 56 | 2 | 3.6% [1.0%, 12.1%] | 4 | 8 | 14.3% [7.4%, 25.7%] | 2 of 8 |
| same-codex | 51 | 2 | 3.9% [1.1%, 13.2%] | 4 | 4 | 7.8% [3.1%, 18.5%] | 1 of 4 |
| same (all) | 107 | 4 | 3.7% [1.5%, 9.2%] |  | 12 | 11.2% [6.5%, 18.6%] | 3 of 12 |

Fisher exact, cross vs same: conflict rate p = 0.703; share-a-file rate p = 1.000

Logged conflict events by collider vendor: 8.9 cross, 12.1 same (0 unattributed); cross share of events 0.42 against 0.56 of 260 concurrent pairs.
