## Primary view: clean runs only (seeds 5, 7, 11, 13)

### Per-seed runs

| Seed (order) | Policy | 20th green | 30th green | 35th green | Done | Greens | Cost | Red validations | Dropped | Correct | Note |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 5 (shuffled) | queue | 6.6 | 12.0 | 24.9 | 28.0 | 36 | $4.87 | 10 | 4 | True |  |
| 5 (shuffled) | v2 | 7.6 | 10.9 | 13.2 | 14.4 | 37 | $5.60 | 2 | 3 | True |  |
| 7 (id) | queue | 5.2 | 10.4 | 15.5 | 16.5 | 37 | $4.42 | 7 | 3 | True |  |
| 7 (id) | v2 | 7.3 | 9.7 | 11.3 | 11.3 | 35 | $5.29 | 1 | 5 | True |  |
| 11 (id) | queue | 4.2 | 20.5 | n/a | 34.7 | 34 | $4.10 | 14 | 6 | True |  |
| 11 (id) | v2 | 9.4 | 10.9 | n/a | 14.0 | 34 | $5.62 | 2 | 6 | True |  |
| 13 (shuffled) | queue | 4.3 | 11.6 | 27.0 | 27.0 | 35 | $4.39 | 12 | 5 | True |  |
| 13 (shuffled) | v2 | 5.4 | 9.0 | 10.8 | 13.8 | 37 | $4.48 | 0 | 3 | True |  |

### Aggregates over seeds (mean [min, max], sd, n reached)

| Metric | queue | v2 |
|---|---|---|
| 20th green (min) | 5.1 [4.2, 6.6], sd 1.1 | 7.4 [5.4, 9.4], sd 1.6 |
| 30th green (min) | 13.6 [10.4, 20.5], sd 4.6 | 10.1 [9.0, 10.9], sd 1.0 |
| 35th green (min) | 22.4 [15.5, 27.0], sd 6.1 (n=3 of 4) | 11.8 [10.8, 13.2], sd 1.3 (n=3 of 4) |
| time to done (min) | 26.5 [16.5, 34.7], sd 7.5 | 13.4 [11.3, 14.4], sd 1.4 |
| cost ($) | 4.44 [4.10, 4.87], sd 0.32 | 5.25 [4.48, 5.62], sd 0.54 |
| red validations | 10.8 [7.0, 14.0], sd 3.0 | 1.2 [0.0, 2.0], sd 1.0 |
| red pre-land checks (v2) / red batches (queue) | 10.8 [7.0, 14.0], sd 3.0 | 17.0 [12.0, 23.0], sd 4.5 |
| CI minutes | 39.5 [25.4, 52.7], sd 11.2 | 19.9 [18.2, 23.4], sd 2.4 |
| agent-side check minutes (v2) | n/a | 87.2 [82.3, 95.4], sd 5.8 |
| greens | 35.5 [34.0, 37.0], sd 1.3 | 35.8 [34.0, 37.0], sd 1.5 |
| dropped | 4.5 [3.0, 6.0], sd 1.3 | 4.2 [3.0, 6.0], sd 1.5 |
| textual conflicts | 23.2 [22.0, 26.0], sd 1.9 | 15.8 [11.0, 21.0], sd 4.1 |
| rework invocations | 29.5 [28.0, 30.0], sd 1.0 | 31.0 [22.0, 37.0], sd 7.0 |

### Paired by seed: queue / v2 (>1 means v2 is faster); cost is v2 / queue

| Metric | seed 5 | seed 7 | seed 11 | seed 13 | geometric mean [bootstrap 95% CI] | t interval on logs | v2 faster in |
|---|---|---|---|---|---|---|---|
| 20th green | 0.87 | 0.71 | 0.45 | 0.80 | 0.69 [0.52, 0.83] | [0.43, 1.10] | 0 of 4 |
| 30th green | 1.09 | 1.07 | 1.88 | 1.29 | 1.30 [1.08, 1.64] | [0.86, 1.96] | 4 of 4 |
| 35th green | 1.89 | 1.37 | n/a | 2.51 | 1.86 [1.47, 2.36] | [0.88, 3.96] | 3 of 3 |
| done | 1.95 | 1.46 | 2.48 | 1.96 | 1.93 [1.57, 2.33] | [1.36, 2.72] | 4 of 4 |
| p90 task start to green | 2.85 | 2.08 | 3.27 | 1.68 | 2.39 [1.87, 3.05] | [1.48, 3.85] | 4 of 4 |
| cost (v2 / queue) | 1.15 | 1.20 | 1.37 | 1.02 | 1.18 [1.06, 1.31] | [0.97, 1.43] | v2 cheaper in 0 of 4 |
| red validations (queue, v2) | 10, 2 | 7, 1 | 14, 2 | 12, 0 | mean difference 9.5 [7.0, 12.0] | | |

### Unpaired view (runs resampled independently within a policy)

| Metric | ratio of means | 95% CI | exact permutation p (two-sided) |
|---|---|---|---|
| 20th green, queue / v2 | 0.68 | [0.53, 0.90] | 0.057 |
| 30th green, queue / v2 | 1.34 | [1.04, 1.81] | 0.086 |
| 35th green, queue / v2 | 1.91 | [1.34, 2.40] | 0.100 |
| done, queue / v2 | 1.98 | [1.45, 2.47] | 0.029 |
| cost, v2 / queue | 1.18 | [1.05, 1.30] | 0.057 |

### Greens on the stalk after m minutes (clean runs)

| Run | 5 min | 10 min | 15 min | 20 min | 25 min | 30 min | 35 min |
|---|---|---|---|---|---|---|---|
| seed 5 queue | 14 | 25 | 31 | 33 | 35 | 36 | 36 |
| seed 5 v2 | 14 | 22 | 37 | 37 | 37 | 37 | 37 |
| seed 7 queue | 16 | 28 | 34 | 37 | 37 | 37 | 37 |
| seed 7 v2 | 8 | 31 | 35 | 35 | 35 | 35 | 35 |
| seed 11 queue | 21 | 21 | 26 | 28 | 31 | 34 | 34 |
| seed 11 v2 | 11 | 24 | 34 | 34 | 34 | 34 | 34 |
| seed 13 queue | 22 | 27 | 32 | 33 | 34 | 35 | 35 |
| seed 13 v2 | 19 | 33 | 37 | 37 | 37 | 37 | 37 |
| **mean, queue** | **18.2** | **25.2** | **30.8** | **32.8** | **34.2** | **35.5** | **35.5** |
| **mean, v2** | **13.0** | **27.5** | **35.8** | **35.8** | **35.8** | **35.8** | **35.8** |

### What happened inside each run

| Run | Policy | Done (min) | Red batches | Cancelled speculative batches | Bisection CI runs | Ejections (conflict / red) | Held behind in-flight | Drops |
|---|---|---|---|---|---|---|---|---|
| seed 3 shuffled | queue | 25.8 | 7 | 2 | 9 | 23 / 7 | 8 | 4 |
| seed 5 shuffled | queue | 28.0 | 10 | 4 | 15 | 22 / 10 | 12 | 4 |
| seed 7 id | queue | 16.5 | 7 | 3 | 5 | 26 / 7 | 10 | 3 |
| seed 11 id | queue | 34.7 | 14 | 6 | 24 | 22 / 14 | 15 | 6 |
| seed 13 shuffled | queue | 27.0 | 12 | 4 | 15 | 23 / 12 | 10 | 5 |

| Run | Policy | Done (min) | Pre-land checks (red) | Re-checks after the sprout moved | Optimistic landings | Informed reworks | Decision cards | Revert-first | Drops | Agent-side check minutes |
|---|---|---|---|---|---|---|---|---|---|---|
| seed 3 shuffled | v2 | 22.0 | 74 (14) | 15 | 31 | 10 | 1 | 0 | 6 | 98.9 |
| seed 5 shuffled | v2 | 14.4 | 83 (16) | 19 | 30 | 14 | 0 | 1 | 3 | 87.1 |
| seed 7 id | v2 | 11.3 | 83 (17) | 12 | 31 | 16 | 1 | 1 | 5 | 83.9 |
| seed 11 id | v2 | 14.0 | 94 (23) | 25 | 29 | 20 | 1 | 1 | 6 | 95.4 |
| seed 13 shuffled | v2 | 13.8 | 78 (12) | 19 | 31 | 11 | 1 | 0 | 3 | 82.3 |

Queue, clean runs: Spearman rank correlation between red batches and time to done = 0.80 (n = 4).

### Machine load per run

| Run | Start uptime | End uptime | load average (1 min), mean / max of 30 s samples | suite s (median, p90) | Claude CLI startup ms (median) | Flag |
|---|---|---|---|---|---|---|
| flagged-highload-e7-queue-claude-12-s3-shuf | not recorded | not recorded | not recorded / n/a | 17.6, 27.8 | 15688 | concurrent + very high load |
| e7-queue-claude-12-s5-shuf | 1 day,  5:23, 12 users, load averages: 163.31 154.78 238.33 | 1 day,  5:51, 12 users, load averages: 10.22 27.40 69.12 | 56.8 / 195.1 | 3.1, 9.3 | 740 |  |
| opus-queue-sonnet-12-landed | not recorded | not recorded | not recorded / n/a | 0.8, 1.4 | 332 |  |
| opus-queue-sonnet-12-s11 | not recorded | not recorded | not recorded / n/a | 1.0, 1.4 | 294 |  |
| e7-queue-claude-12-s13-shuf | 1 day,  7:45, 12 users, load averages: 9.69 31.40 63.60 | 1 day,  8:12, 12 users, load averages: 5.97 7.05 17.34 | 12.8 / 45.1 | 1.8, 3.5 | 474 |  |
| flagged-highload-e7-v2-claude-12-s3-shuf | not recorded | not recorded | not recorded / n/a | 19.4, 26.2 | 13586 | concurrent + very high load |
| e7-v2-claude-12-s5-shuf | 1 day,  6:24, 12 users, load averages: 7.61 8.23 18.19 | 1 day,  6:38, 12 users, load averages: 44.25 60.11 50.53 | 65.1 / 159.0 | 2.9, 6.3 | 589 |  |
| opus-v2fair-sonnet-12-s7 | not recorded | not recorded | not recorded / n/a | 0.6, 1.2 | 228 |  |
| opus-v2fair-sonnet-12-s11 | not recorded | not recorded | not recorded / n/a | 0.7, 1.5 | 266 |  |
| e7-v2-claude-12-s13-shuf | 1 day,  8:59, 12 users, load averages: 14.03 16.97 20.04 | 1 day,  9:13, 12 users, load averages: 5.93 34.92 38.63 | 54.2 / 173.0 | 2.4, 7.9 | 510 |  |
