### e7-v2-mixed-12-s7 against 2 Claude-only baseline runs (opus-v2fair-sonnet-12-s7, opus-v2fair-sonnet-12-s11)

Same tasks, matched per author vendor of the mixed run. Baseline = Claude Sonnet on every task.

| Author vendor (tasks) | metric | mixed run | Claude-only baselines on the same tasks |
|---|---|---|---|
| claude (20) | first attempt passes its own acceptance tests | 20 of 20 | 39 of 40 (98%) |
| claude (20) | first attempt passes the whole suite of its snapshot | 18 of 20 | 34 of 40 (85%) |
| claude (20) | cost of the first attempt, USD | 0.062 | 0.072 |
| claude (20) | wall time of the first attempt, s | 22.1 | 21.1 |
| claude (20) | turns / items of the first attempt | 11.9 | 11.2 |
| claude (20) | files per change | 2.45 | 2.42 |
| claude (20) | hot files per change | 0.85 | 0.80 |
| claude (20) | rework rounds per task | 0.90 | 1.02 |
| claude (20) | textual conflicts per task | 0.55 | 0.57 |
| claude (20) | red checks per task | 0.40 | 0.53 |
| claude (20) | rework cost per task, USD | 0.090 | 0.081 |
| codex (20) | first attempt passes its own acceptance tests | 19 of 20 | 38 of 40 (95%) |
| codex (20) | first attempt passes the whole suite of its snapshot | 17 of 20 | 33 of 40 (82%) |
| codex (20) | cost of the first attempt, USD | 0.042 | 0.059 |
| codex (20) | wall time of the first attempt, s | 41.7 | 18.1 |
| codex (20) | turns / items of the first attempt | 7.5 | 9.1 |
| codex (20) | files per change | 1.65 | 1.68 |
| codex (20) | hot files per change | 0.35 | 0.35 |
| codex (20) | rework rounds per task | 0.75 | 0.80 |
| codex (20) | textual conflicts per task | 0.50 | 0.35 |
| codex (20) | red checks per task | 0.25 | 0.47 |
| codex (20) | rework cost per task, USD | 0.034 | 0.061 |

Do changes touch the same files more across vendors? All 780 task pairs, first attempts only. The tasks are labelled with this run's vendor split; the same labels are applied to every Claude-only baseline run, so the task mix cancels. Noise = standard deviation of a baseline run's count around the mean of the other baselines (leave-one-out).

| Pair type | pairs | sharing a file in the mixed run | Claude-only baselines, same labels: mean [min, max] | mixed minus baseline mean | baseline noise (sd) | deviation / noise |
|---|---|---|---|---|---|---|
| cross | 400 | 56 | 57.7 [56, 59] (n=6) | -1.7 | 1.2 | -1.3 |
| same | 380 | 48 | 57.2 [55, 61] (n=6) | -9.2 | 2.4 | -3.7 |

Leave-one-out conflicts among concurrent landed pairs (rate = conflicting / probed), under the same labels, against the Claude-only baselines:

| Pair type | mixed run: conflicting / probed | rate | Claude-only baselines, same labels: mean rate [min, max] |
|---|---|---|---|
| cross | 3 / 135 | 2.2% | 1.3% [0.8%, 1.7%] (n=6) |
| same | 4 / 107 | 3.7% | 2.6% [0.9%, 4.6%] (n=6) |

Conflict given a shared file (concurrent landed pairs whose first attempts touch a common file: the pairs that can conflict), same labels, against the Claude-only baselines pooled:

| Pair type | mixed run: conflicting / sharing a file | rate | Claude-only baselines, same labels: pooled conflicting / sharing | pooled rate [per-run min, max] |
|---|---|---|---|---|
| cross | 2 / 16 | 12% | 12 / 126 | 10% [n/a%, 29%] |
| same | 3 / 12 | 25% | 28 / 130 | 22% [7%, 31%] |

Footprint divergence (mean Jaccard of the first attempt's file set for the same task; 1 = identical):

| Comparison | mean Jaccard | pairs |
|---|---|---|
| Codex (mixed run) vs Claude (baselines) | 0.98 | 120 |
| Claude (mixed run) vs Claude (baselines) | 0.87 | 120 |
| Claude vs Claude, between baseline runs | 0.96 | 600 |
