### e7-queue-mixed-12-s7 against 2 Claude-only baseline runs (opus-queue-sonnet-12-landed, opus-queue-sonnet-12-s11)

Same tasks, matched per author vendor of the mixed run. Baseline = Claude Sonnet on every task.

| Author vendor (tasks) | metric | mixed run | Claude-only baselines on the same tasks |
|---|---|---|---|
| claude (27) | first attempt passes its own acceptance tests | 27 of 27 | 54 of 54 (100%) |
| claude (27) | first attempt passes the whole suite of its snapshot | 27 of 27 | 54 of 54 (100%) |
| claude (27) | cost of the first attempt, USD | 0.054 | 0.056 |
| claude (27) | wall time of the first attempt, s | 18.3 | 17.7 |
| claude (27) | turns / items of the first attempt | 10.0 | 9.8 |
| claude (27) | files per change | 2.19 | 2.19 |
| claude (27) | hot files per change | 0.70 | 0.70 |
| claude (27) | rework rounds per task | 0.78 | 0.81 |
| claude (27) | textual conflicts per task | 0.67 | 0.57 |
| claude (27) | red checks per task | 0.26 | 0.35 |
| claude (27) | rework cost per task, USD | 0.065 | 0.055 |
| codex (13) | first attempt passes its own acceptance tests | 13 of 13 | 26 of 26 (100%) |
| codex (13) | first attempt passes the whole suite of its snapshot | 13 of 13 | 26 of 26 (100%) |
| codex (13) | cost of the first attempt, USD | 0.041 | 0.054 |
| codex (13) | wall time of the first attempt, s | 40.6 | 17.1 |
| codex (13) | turns / items of the first attempt | 7.6 | 9.3 |
| codex (13) | files per change | 1.62 | 1.77 |
| codex (13) | hot files per change | 0.31 | 0.31 |
| codex (13) | rework rounds per task | 0.46 | 0.62 |
| codex (13) | textual conflicts per task | 0.38 | 0.65 |
| codex (13) | red checks per task | 0.08 | 0.08 |
| codex (13) | rework cost per task, USD | 0.021 | 0.044 |

Do changes touch the same files more across vendors? All 780 task pairs, first attempts only. The tasks are labelled with this run's vendor split; the same labels are applied to every Claude-only baseline run, so the task mix cancels. Noise = standard deviation of a baseline run's count around the mean of the other baselines (leave-one-out).

| Pair type | pairs | sharing a file in the mixed run | Claude-only baselines, same labels: mean [min, max] | mixed minus baseline mean | baseline noise (sd) | deviation / noise |
|---|---|---|---|---|---|---|
| cross | 351 | 37 | 41.3 [39, 43] (n=6) | -4.3 | 1.6 | -2.6 |
| same | 429 | 72 | 73.5 [72, 78] (n=6) | -1.5 | 2.7 | -0.6 |

Leave-one-out conflicts among concurrent landed pairs (rate = conflicting / probed), under the same labels, against the Claude-only baselines:

| Pair type | mixed run: conflicting / probed | rate | Claude-only baselines, same labels: mean rate [min, max] |
|---|---|---|---|
| cross | 9 / 265 | 3.4% | 2.2% [0.8%, 4.2%] (n=6) |
| same | 5 / 312 | 1.6% | 1.6% [0.8%, 2.0%] (n=6) |

Conflict given a shared file (concurrent landed pairs whose first attempts touch a common file: the pairs that can conflict), same labels, against the Claude-only baselines pooled:

| Pair type | mixed run: conflicting / sharing a file | rate | Claude-only baselines, same labels: pooled conflicting / sharing | pooled rate [per-run min, max] |
|---|---|---|---|---|
| cross | 9 / 23 | 39% | 22 / 98 | 22% [11%, 30%] |
| same | 5 / 36 | 14% | 18 / 158 | 11% [5%, 33%] |

Footprint divergence (mean Jaccard of the first attempt's file set for the same task; 1 = identical):

| Comparison | mean Jaccard | pairs |
|---|---|---|
| Codex (mixed run) vs Claude (baselines) | 0.94 | 78 |
| Claude (mixed run) vs Claude (baselines) | 0.96 | 162 |
| Claude vs Claude, between baseline runs | 0.96 | 600 |
