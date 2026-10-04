## Primary view: clean runs only (seeds 5, 7, 11)

### Per-seed runs

| Seed (order) | Policy | 20th green | 30th green | 35th green | Done | Greens | Cost | Red validations | Dropped | Correct | Note |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 5 (shuffled) | queue | 6.6 | 12.0 | 24.9 | 28.0 | 36 | $4.87 | 10 | 4 | True |  |
| 5 (shuffled) | v2 | 7.6 | 10.9 | 13.2 | 14.4 | 37 | $5.60 | 2 | 3 | True |  |
| 7 (id) | queue | 5.2 | 10.4 | 15.5 | 16.5 | 37 | $4.42 | 7 | 3 | True |  |
| 7 (id) | v2 | 7.3 | 9.7 | 11.3 | 11.3 | 35 | $5.29 | 1 | 5 | True |  |
| 11 (id) | queue | 4.2 | 20.5 | n/a | 34.7 | 34 | $4.10 | 14 | 6 | True |  |
| 11 (id) | v2 | 9.4 | 10.9 | n/a | 14.0 | 34 | $5.62 | 2 | 6 | True |  |

### Aggregates over seeds (mean [min, max], sd, n reached)

| Metric | queue | v2 |
|---|---|---|
| 20th green (min) | 5.4 [4.2, 6.6], sd 1.2 | 8.1 [7.3, 9.4], sd 1.1 |
| 30th green (min) | 14.3 [10.4, 20.5], sd 5.4 | 10.5 [9.7, 10.9], sd 0.7 |
| 35th green (min) | 20.2 [15.5, 24.9], sd 6.7 (n=2 of 3) | 12.2 [11.3, 13.2], sd 1.3 (n=2 of 3) |
| time to done (min) | 26.4 [16.5, 34.7], sd 9.2 | 13.2 [11.3, 14.4], sd 1.7 |
| cost ($) | 4.46 [4.10, 4.87], sd 0.38 | 5.50 [5.29, 5.62], sd 0.19 |
| red validations | 10.3 [7.0, 14.0], sd 3.5 | 1.7 [1.0, 2.0], sd 0.6 |
| red pre-land checks (v2) / red batches (queue) | 10.3 [7.0, 14.0], sd 3.5 | 18.7 [16.0, 23.0], sd 3.8 |
| CI minutes | 39.5 [25.4, 52.7], sd 13.7 | 20.3 [18.2, 23.4], sd 2.7 |
| agent-side check minutes (v2) | n/a | 88.8 [83.9, 95.4], sd 5.9 |
| greens | 35.7 [34.0, 37.0], sd 1.5 | 35.3 [34.0, 37.0], sd 1.5 |
| dropped | 4.3 [3.0, 6.0], sd 1.5 | 4.7 [3.0, 6.0], sd 1.5 |
| textual conflicts | 23.3 [22.0, 26.0], sd 2.3 | 17.3 [15.0, 21.0], sd 3.2 |
| rework invocations | 29.3 [28.0, 30.0], sd 1.2 | 34.0 [29.0, 37.0], sd 4.4 |

### Paired by seed: queue / v2 (>1 means v2 is faster); cost is v2 / queue

| Metric | seed 5 | seed 7 | seed 11 | geometric mean [bootstrap 95% CI] | t interval on logs | v2 faster in |
|---|---|---|---|---|---|---|
| 20th green | 0.87 | 0.71 | 0.45 | 0.65 [0.50, 0.83] | [0.28, 1.52] | 0 of 3 |
| 30th green | 1.09 | 1.07 | 1.88 | 1.30 [1.08, 1.68] | [0.59, 2.86] | 3 of 3 |
| 35th green | 1.89 | 1.37 | n/a | 1.61 [1.38, 1.87] | [0.21, 12.54] | 2 of 2 |
| done | 1.95 | 1.46 | 2.48 | 1.92 [1.55, 2.35] | [0.99, 3.70] | 3 of 3 |
| p90 task start to green | 2.85 | 2.08 | 3.27 | 2.68 [2.23, 3.17] | [1.51, 4.77] | 3 of 3 |
| cost (v2 / queue) | 1.15 | 1.20 | 1.37 | 1.24 [1.16, 1.33] | [0.98, 1.55] | v2 cheaper in 0 of 3 |
| red validations (queue, v2) | 10, 2 | 7, 1 | 14, 2 | mean difference 8.7 [6.4, 11.1] | | |

### Unpaired view (runs resampled independently within a policy)

| Metric | ratio of means | 95% CI | exact permutation p (two-sided) |
|---|---|---|---|
| 20th green, queue / v2 | 0.66 | [0.52, 0.83] | 0.100 |
| 30th green, queue / v2 | 1.36 | [0.99, 1.95] | 0.300 |
| 35th green, queue / v2 | 1.65 | [1.17, 2.20] | 0.333 |
| done, queue / v2 | 1.99 | [1.24, 2.66] | 0.100 |
| cost, v2 / queue | 1.23 | [1.13, 1.34] | 0.100 |

## Secondary view: every run including flagged ones (seeds 3, 5, 7, 11)

### Per-seed runs

| Seed (order) | Policy | 20th green | 30th green | 35th green | Done | Greens | Cost | Red validations | Dropped | Correct | Note |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 3 (shuffled) | queue | 12.5 | 15.7 | 24.8 | 25.8 | 36 | $4.38 | 7 | 4 | True | concurrent + very high load |
| 3 (shuffled) | v2 | 13.5 | 19.9 | n/a | 22.0 | 34 | $4.19 | 0 | 6 | True | concurrent + very high load |
| 5 (shuffled) | queue | 6.6 | 12.0 | 24.9 | 28.0 | 36 | $4.87 | 10 | 4 | True |  |
| 5 (shuffled) | v2 | 7.6 | 10.9 | 13.2 | 14.4 | 37 | $5.60 | 2 | 3 | True |  |
| 7 (id) | queue | 5.2 | 10.4 | 15.5 | 16.5 | 37 | $4.42 | 7 | 3 | True |  |
| 7 (id) | v2 | 7.3 | 9.7 | 11.3 | 11.3 | 35 | $5.29 | 1 | 5 | True |  |
| 11 (id) | queue | 4.2 | 20.5 | n/a | 34.7 | 34 | $4.10 | 14 | 6 | True |  |
| 11 (id) | v2 | 9.4 | 10.9 | n/a | 14.0 | 34 | $5.62 | 2 | 6 | True |  |

### Aggregates over seeds (mean [min, max], sd, n reached)

| Metric | queue | v2 |
|---|---|---|
| 20th green (min) | 7.1 [4.2, 12.5], sd 3.7 | 9.5 [7.3, 13.5], sd 2.8 |
| 30th green (min) | 14.6 [10.4, 20.5], sd 4.5 | 12.8 [9.7, 19.9], sd 4.7 |
| 35th green (min) | 21.7 [15.5, 24.9], sd 5.4 (n=3 of 4) | 12.2 [11.3, 13.2], sd 1.3 (n=2 of 4) |
| time to done (min) | 26.3 [16.5, 34.7], sd 7.5 | 15.4 [11.3, 22.0], sd 4.6 |
| cost ($) | 4.44 [4.10, 4.87], sd 0.32 | 5.17 [4.19, 5.62], sd 0.68 |
| red validations | 9.5 [7.0, 14.0], sd 3.3 | 1.2 [0.0, 2.0], sd 1.0 |
| red pre-land checks (v2) / red batches (queue) | 9.5 [7.0, 14.0], sd 3.3 | 17.5 [14.0, 23.0], sd 3.9 |
| CI minutes | 38.1 [25.4, 52.7], sd 11.5 | 22.7 [18.2, 30.0], sd 5.3 |
| agent-side check minutes (v2) | n/a | 91.3 [83.9, 99.0], sd 7.0 |
| greens | 35.8 [34.0, 37.0], sd 1.3 | 35.0 [34.0, 37.0], sd 1.4 |
| dropped | 4.2 [3.0, 6.0], sd 1.3 | 5.0 [3.0, 6.0], sd 1.4 |
| textual conflicts | 23.2 [22.0, 26.0], sd 1.9 | 16.8 [15.0, 21.0], sd 2.9 |
| rework invocations | 28.5 [26.0, 30.0], sd 1.9 | 31.8 [25.0, 37.0], sd 5.7 |

### Paired by seed: queue / v2 (>1 means v2 is faster); cost is v2 / queue

| Metric | seed 3 | seed 5 | seed 7 | seed 11 | geometric mean [bootstrap 95% CI] | t interval on logs | v2 faster in |
|---|---|---|---|---|---|---|---|
| 20th green | 0.93 | 0.87 | 0.71 | 0.45 | 0.71 [0.53, 0.90] | [0.42, 1.20] | 0 of 4 |
| 30th green | 0.79 | 1.09 | 1.07 | 1.88 | 1.15 [0.86, 1.63] | [0.65, 2.03] | 3 of 4 |
| 35th green | n/a | 1.89 | 1.37 | n/a | 1.61 [1.38, 1.87] | [0.21, 12.54] | 2 of 2 |
| done | 1.17 | 1.95 | 1.46 | 2.48 | 1.69 [1.31, 2.20] | [1.01, 2.85] | 4 of 4 |
| p90 task start to green | 1.82 | 2.85 | 2.08 | 3.27 | 2.44 [1.95, 3.05] | [1.59, 3.75] | 4 of 4 |
| cost (v2 / queue) | 0.96 | 1.15 | 1.20 | 1.37 | 1.16 [1.01, 1.31] | [0.91, 1.47] | v2 cheaper in 1 of 4 |
| red validations (queue, v2) | 7, 0 | 10, 2 | 7, 1 | 14, 2 | mean difference 8.2 [6.5, 10.8] | | |

### Unpaired view (runs resampled independently within a policy)

| Metric | ratio of means | 95% CI | exact permutation p (two-sided) |
|---|---|---|---|
| 20th green, queue / v2 | 0.75 | [0.45, 1.19] | 0.314 |
| 30th green, queue / v2 | 1.14 | [0.76, 1.68] | 0.514 |
| 35th green, queue / v2 | 1.77 | [1.26, 2.20] | 0.200 |
| done, queue / v2 | 1.70 | [1.17, 2.39] | 0.057 |
| cost, v2 / queue | 1.17 | [1.01, 1.30] | 0.114 |

### Machine load per run

| Run | Start uptime | End uptime | suite s (median, p90) | Claude CLI startup ms (median) | Flag |
|---|---|---|---|---|---|
| flagged-highload-e7-queue-claude-12-s3-shuf | not recorded | not recorded | 17.6, 27.8 | 15688 | concurrent + very high load |
| e7-queue-claude-12-s5-shuf | 1 day,  5:23, 12 users, load averages: 163.31 154.78 238.33 | 1 day,  5:51, 12 users, load averages: 10.22 27.40 69.12 | 3.1, 9.3 | 740 |  |
| opus-queue-sonnet-12-landed | not recorded | not recorded | 0.8, 1.4 | 332 |  |
| opus-queue-sonnet-12-s11 | not recorded | not recorded | 1.0, 1.4 | 294 |  |
| flagged-highload-e7-v2-claude-12-s3-shuf | not recorded | not recorded | 19.4, 26.2 | 13586 | concurrent + very high load |
| e7-v2-claude-12-s5-shuf | 1 day,  6:24, 12 users, load averages: 7.61 8.23 18.19 | 1 day,  6:38, 12 users, load averages: 44.25 60.11 50.53 | 2.9, 6.3 | 589 |  |
| opus-v2fair-sonnet-12-s7 | not recorded | not recorded | 0.6, 1.2 | 228 |  |
| opus-v2fair-sonnet-12-s11 | not recorded | not recorded | 0.7, 1.5 | 266 |  |
