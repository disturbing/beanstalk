### Results table

| run | policy | tasks | drift x | initial bean min (real / in race) | 50% green min / $ | 75% green min / $ | 87% green min / $ | done min | greens | rechecks / optimistic | conflicts | informed reworks | cards | red validations | cost $ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S: 40 singles, seed 7 / queue | queue | 40 | 1 | 0.3 / 0.3 | 5.2 / $3.03 | 10.4 / $3.98 | 15.5 / $4.42 | 16.5 | 37/40 | n/a (queue) | 26 | 30 reworks (ejections 26c/7r) | n/a | 7 | 4.42 |
| S: 40 singles, seed 7 / v2 | v2 | 40 | 1 | 0.3 / 0.3 | 7.3 / $4.79 | 9.7 / $5.21 | 11.3 / $5.29 | 11.3 | 35/40 | 12 / 31 | 21 | 16 | 1 | 1 | 5.29 |
| S: 40 singles, seed 11 / queue | queue | 40 | 1 | 0.3 / 0.3 | 4.2 / $2.65 | 20.5 / $3.77 | not reached | 34.7 | 34/40 | n/a (queue) | 22 | 30 reworks (ejections 22c/14r) | n/a | 14 | 4.10 |
| S: 40 singles, seed 11 / v2 | v2 | 40 | 1 | 0.3 / 0.3 | 9.4 / $5.32 | 10.9 / $5.54 | not reached | 14.0 | 34/40 | 25 / 29 | 16 | 20 | 1 | 2 | 5.62 |
| A: 16 compounds / queue | queue | 16 | 1 | 0.5 / 0.5 | 6.4 / $3.04 | 12.5 / $3.47 | not reached | 16.6 | 13/16 | n/a (queue) | 19 | 23 reworks (ejections 19c/7r) | n/a | 7 | 3.55 |
| A: 16 compounds / v2 | v2 | 16 | 1 | 0.5 / 0.5 | 6.8 / $4.04 | 7.7 / $4.04 | not reached | 7.7 | 12/16 | 7 / 10 | 14 | 8 | 0 | 3 | 4.04 |
| A2: 16 compounds, repeat / queue | queue | 16 | 1 | 0.5 / 0.5 | 9.4 / $3.24 | 19.6 / $4.40 | not reached | 19.6 | 12/16 | n/a (queue) | 16 | 20 reworks (ejections 16c/8r) | n/a | 8 | 4.40 |
| B: 40 singles, drift x7 / queue | queue | 40 | 7 | 0.3 / 2.2 | 6.7 / $1.49 | 12.5 / $3.06 | 23.8 / $4.30 | 29.7 | 36/40 | n/a (queue) | 16 | 21 reworks (ejections 16c/9r) | n/a | 9 | 4.61 |
| B: 40 singles, drift x7 / v2 | v2 | 40 | 7 | 0.3 / 2.2 | 11.5 / $1.78 | 16.9 / $3.78 | 20.3 / $4.21 | 22.6 | 35/40 | 14 / 30 | 14 | 5 | 1 | 2 | 4.33 |
| C: 16 compounds, drift x4 / queue | queue | 16 | 4 | 0.5 / 2.0 | 10.3 / $3.16 | 13.4 / $4.08 | not reached | 17.4 | 13/16 | n/a (queue) | 20 | 22 reworks (ejections 20c/5r) | n/a | 5 | 4.52 |
| C: 16 compounds, drift x4 / v2 | v2 | 16 | 4 | 0.5 / 2.0 | 7.7 / $3.65 | 10.4 / $4.29 | not reached | 12.4 | 13/16 | 6 / 8 | 18 | 2 | 0 | 0 | 4.29 |

### Outcome and test compute

| run | green / dropped | dropped because | reworks by cause | cost per green $ | test minutes (agent-side checks + CI) | agent minutes busy / blocked / idle |
|---|---|---|---|---|---|---|
| S: 40 singles, seed 7 / queue | 37 / 3 | ejected (conflict): 2; ejected (red): 1 | conflict 24, red 6 | 0.12 | 25.4 | 21.1 / 0.41 / 176.16 |
| S: 40 singles, seed 7 / v2 | 35 / 5 | declined by decision D001: 1; unresolved conflict: 4 | conflict 21, preland-red 16 | 0.15 | 102.1 | 24.08 / 84.81 / 26.76 |
| S: 40 singles, seed 11 / queue | 34 / 6 | ejected (conflict): 3; ejected (red): 3 | conflict 19, red 11 | 0.12 | 52.7 | 20.62 / 0.29 / 396.03 |
| S: 40 singles, seed 11 / v2 | 34 / 6 | declined by decision D001: 1; pre-land check still red: 2; reverted: 1; unresolved conflict: 2 | conflict 16, preland-red 20 | 0.17 | 114.6 | 26.07 / 102.7 / 39.64 |
| A: 16 compounds / queue | 13 / 3 | ejected (conflict): 1; ejected (red): 2 | conflict 18, red 5 | 0.27 | 18.3 | 15.11 / 0.25 / 184.08 |
| A: 16 compounds / v2 | 12 / 4 | pre-land check still red: 3; unresolved conflict: 1 | conflict 14, preland-red 8 | 0.34 | 50.5 | 15.27 / 39.66 / 37.81 |
| A2: 16 compounds, repeat / queue | 12 / 4 | ejected (conflict): 2; ejected (red): 2 | conflict 14, red 6 | 0.37 | 22.3 | 14.67 / 0.15 / 219.88 |
| B: 40 singles, drift x7 / queue | 36 / 4 | ejected (conflict): 2; ejected (red): 2 | conflict 14, red 7 | 0.13 | 43.4 | 151.26 / 0.47 / 204.89 |
| B: 40 singles, drift x7 / v2 | 35 / 5 | declined by decision D001: 1; pre-land check still red: 2; reverted: 1; unresolved conflict: 1 | conflict 14, preland-red 5 | 0.12 | 95.1 | 138.68 / 72.46 / 60.1 |
| C: 16 compounds, drift x4 / queue | 13 / 3 | ejected (conflict): 1; ejected (red): 2 | conflict 19, red 3 | 0.35 | 18.2 | 61.59 / 0.17 / 147.57 |
| C: 16 compounds, drift x4 / v2 | 13 / 3 | pre-land check still red: 2; unresolved conflict: 1 | conflict 18, preland-red 2 | 0.33 | 46.4 | 57.98 / 34.3 / 56.85 |

### `race/kth_green.py` output (time in minutes since the race started / cumulative agent cost)

**S: 40 singles, seed 7** (k = 20, 30, 35 of 40):

| run | policy | model | agents | 20th green min / $ | 30th green min / $ | 35th green min / $ | greens | total $ | wall min | red validations | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|
| opus-queue-sonnet-12-landed | queue | sonnet | 12 | 5.2 / 3.03 | 10.4 / 3.98 | 15.5 / 4.42 | 37 | 4.42 | 16.5 | 7 | True |
| opus-v2fair-sonnet-12-s7 | beanstalk (v2) | sonnet | 12 | 7.3 / 4.79 | 9.7 / 5.21 | 11.3 / 5.29 | 35 | 5.29 | 11.3 | 1 | True |

**S: 40 singles, seed 11** (k = 20, 30, 35 of 40):

| run | policy | model | agents | 20th green min / $ | 30th green min / $ | 35th green min / $ | greens | total $ | wall min | red validations | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|
| opus-queue-sonnet-12-s11 | queue | sonnet | 12 | 4.2 / 2.65 | 20.5 / 3.77 | not reached | 34 | 4.10 | 34.7 | 14 | True |
| opus-v2fair-sonnet-12-s11 | beanstalk (v2) | sonnet | 12 | 9.4 / 5.32 | 10.9 / 5.54 | not reached | 34 | 5.62 | 14.0 | 2 | True |

**A: 16 compounds** (k = 8, 12, 14, 16 of 16):

| run | policy | model | agents | 8th green min / $ | 12th green min / $ | 14th green min / $ | 16th green min / $ | greens | total $ | wall min | red validations | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| e5-long-queue | queue | sonnet | 12 | 6.4 / 3.04 | 12.5 / 3.47 | not reached | not reached | 13 | 3.55 | 16.6 | 7 | True |
| e5-long-v2 | beanstalk (v2) | sonnet | 12 | 6.8 / 4.04 | 7.7 / 4.04 | not reached | not reached | 12 | 4.04 | 7.7 | 3 | True |

**B: 40 singles, drift x7** (k = 20, 30, 35 of 40):

| run | policy | model | agents | 20th green min / $ | 30th green min / $ | 35th green min / $ | greens | total $ | wall min | red validations | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|
| e5-short-d7-queue | queue | sonnet | 12 | 6.7 / 1.49 | 12.5 / 3.06 | 23.8 / 4.30 | 36 | 4.61 | 29.7 | 9 | True |
| e5-short-d7-v2 | beanstalk (v2) | sonnet | 12 | 11.5 / 1.78 | 16.9 / 3.78 | 20.3 / 4.21 | 35 | 4.33 | 22.6 | 2 | True |

**C: 16 compounds, drift x4** (k = 8, 12, 14, 16 of 16):

| run | policy | model | agents | 8th green min / $ | 12th green min / $ | 14th green min / $ | 16th green min / $ | greens | total $ | wall min | red validations | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| e5-long-d4-queue | queue | sonnet | 12 | 10.3 / 3.16 | 13.4 / 4.08 | not reached | not reached | 13 | 4.52 | 17.4 | 5 | True |
| e5-long-d4-v2 | beanstalk (v2) | sonnet | 12 | 7.7 / 3.65 | 10.4 / 4.29 | not reached | not reached | 13 | 4.29 | 12.4 | 0 | True |

### The 2 x 2: v2's lead over the queue by bean size and bean length

Queue / v2 time ratios (above 1: v2 faster); cost is v2 / queue (above 1: v2 dearer). Several samples are listed in the order of the conditions.

| cell | samples | done: queue / v2 | 50% green | 75% green | cost: v2 / queue | greens: queue vs v2 |
|---|---|---|---|---|---|---|
| native singles, ~0.3 min beans (S) | 2 | 1.46 / 2.48 | 0.71 / 0.45 | 1.07 / 1.88 | 1.20 / 1.37 | 37 vs 35; 34 vs 34 (of 40) |
| compounds, ~0.5 min beans (A) | 1 | 2.15 | 0.94 | 1.62 | 1.14 | 13 vs 12 (of 16) |
| native singles, ~2 min beans (B) | 1 | 1.32 | 0.59 | 0.74 | 0.94 | 36 vs 35 (of 40) |
| compounds, ~2 min beans (C) | 1 | 1.40 | 1.34 | 1.29 | 0.95 | 13 vs 13 (of 16) |

### v2's lead (queue / v2; above 1 = v2 is faster or cheaper)

| condition | 50% green | 75% green | 87% green | done | total $ |
|---|---|---|---|---|---|
| S: 40 singles, seed 7 | 0.71 (5.25 / 7.35 min) | 1.07 (10.37 / 9.66 min) | 1.37 (15.46 / 11.31 min) | 1.46 (16.47 / 11.3 min) | 0.84 ($4.42 / $5.29) |
| S: 40 singles, seed 11 | 0.45 (4.21 / 9.4 min) | 1.88 (20.5 / 10.93 min) | n/r (n/r / n/r min) | 2.48 (34.74 / 14.03 min) | 0.73 ($4.1 / $5.62) |
| A: 16 compounds | 0.94 (6.42 / 6.83 min) | 1.62 (12.54 / 7.74 min) | n/r (n/r / n/r min) | 2.15 (16.62 / 7.73 min) | 0.88 ($3.55 / $4.04) |
| B: 40 singles, drift x7 | 0.59 (6.72 / 11.48 min) | 0.74 (12.52 / 16.88 min) | 1.17 (23.78 / 20.26 min) | 1.32 (29.72 / 22.6 min) | 1.06 ($4.61 / $4.33) |
| C: 16 compounds, drift x4 | 1.34 (10.33 / 7.7 min) | 1.29 (13.38 / 10.41 min) | n/r (n/r / n/r min) | 1.40 (17.44 / 12.43 min) | 1.05 ($4.52 / $4.29) |

### What a bean lives through

| run | initial bean s (real med / in race med / in race p90) | rework in race s (med) | landings absorbed during first authoring (med / p90) | landings from start to own landing (med / p90) | submit to land s (med / p90) | submit to green s (med / p90) | queue max depth | agent min busy / blocked / idle | suite s (med / p90) | load avg 1 min at start / end |
|---|---|---|---|---|---|---|---|---|---|---|
| S: 40 singles, seed 7 / queue | 17.6 / 17.6 / 26.4 | 16.1 | 0 / 0 | 18 / 32.4 | 272.5 / 738.9 | 272.5 / 738.9 | 37 | 21.1 / 0.41 / 176.16 | 0.85 / 1.21 | not logged / not logged |
| S: 40 singles, seed 7 / v2 | 17.2 / 17.2 / 30.5 | 18.6 | 1 / 4 | 5 / 14.6 | 61.1 / 233.6 | 199.4 / 345.7 | - | 24.08 / 84.81 / 26.76 | 0.58 / 0.92 | not logged / not logged |
| S: 40 singles, seed 11 / queue | 15.5 / 15.5 / 25.9 | 14.1 | 0 / 0 | 16.5 / 29.7 | 214.7 / 1250.2 | 214.7 / 1250.2 | 37 | 20.62 / 0.29 / 396.03 | 0.87 / 1.38 | not logged / not logged |
| S: 40 singles, seed 11 / v2 | 20.4 / 20.4 / 30.7 | 18.5 | 0.5 / 4 | 6 / 11 | 93.6 / 278.8 | 180.5 / 364.7 | - | 26.07 / 102.7 / 39.64 | 0.72 / 1.35 | not logged / not logged |
| A: 16 compounds / queue | 29.1 / 29.1 / 39.4 | 19.2 | 0 / 0 | 6 / 10.8 | 351.2 / 723 | 351.2 / 723 | 14 | 15.11 / 0.25 / 184.08 | 0.86 / 1.66 | 6.22 / 12.54 |
| A: 16 compounds / v2 | 30.7 / 30.7 / 40.3 | 19.9 | 0 / 1.5 | 4 / 8.8 | 121.4 / 247.3 | 296.2 / 384.9 | - | 15.27 / 39.66 / 37.81 | 0.54 / 0.98 | 3.31 / 6.67 |
| A2: 16 compounds, repeat / queue | 27.5 / 27.5 / 42.3 | 21.3 | 0 / 0 | 5.5 / 9.9 | 222.5 / 815.3 | 222.5 / 815.3 | 14 | 14.67 / 0.15 / 219.88 | 0.67 / 1.01 | 7.17 / 6.41 |
| B: 40 singles, drift x7 / queue | 19.1 / 134.0 / 215.3 | 128.9 | 5.5 / 13 | 11 / 21.5 | 94.9 / 625.3 | 94.9 / 625.3 | 10 | 151.26 / 0.47 / 204.89 | 1.2 / 1.64 | 5.88 / 2.96 |
| B: 40 singles, drift x7 / v2 | 18.5 / 129.8 / 211.0 | 160.7 | 4 / 7 | 7 / 15 | 61.1 / 320.7 | 152.4 / 392.3 | - | 138.68 / 72.46 / 60.1 | 0.61 / 1 | 2.96 / 1.83 |
| C: 16 compounds, drift x4 / queue | 29.8 / 119.2 / 166.2 | 76.4 | 0.5 / 2 | 6 / 10.8 | 482.3 / 690.4 | 482.3 / 690.4 | 10 | 61.59 / 0.17 / 147.57 | 0.63 / 1.28 | 5.81 / 6.64 |
| C: 16 compounds, drift x4 / v2 | 29.9 / 119.4 / 161.7 | 72.3 | 1.5 / 3 | 4 / 10.4 | 121 / 404.6 | 181.7 / 465.4 | - | 57.98 / 34.3 / 56.85 | 0.54 / 0.78 | 6.83 / 2.58 |

### v2 internals

| run | pre-land checks (red) | rechecks (green / red outcome) | optimistic landings of landings | locked fallbacks | checks per landing | pre-land check minutes | revert-first |
|---|---|---|---|---|---|---|---|
| S: 40 singles, seed 7 / v2 | 83 (17) | 12 (10 / 2) | 31 of 35 | 1 | 2.37 | 83.9 | 1 |
| S: 40 singles, seed 11 / v2 | 94 (23) | 25 (21 / 4) | 29 of 35 | 2 | 2.69 | 95.4 | 1 |
| A: 16 compounds / v2 | 39 (11) | 7 (4 / 3) | 10 of 12 | 0 | 3.25 | 39.4 | 1 |
| B: 40 singles, drift x7 / v2 | 64 (8) | 14 (14 / 0) | 30 of 36 | 2 | 1.78 | 64.7 | 1 |
| C: 16 compounds, drift x4 / v2 | 33 (4) | 6 (6 / 0) | 8 of 13 | 1 | 2.54 | 33.3 | 0 |

### Queue internals

| run | batches green / red / cancelled | ejections conflict / red | bisect CI runs | PRs held behind in-flight conflicts | reworks | CI minutes |
|---|---|---|---|---|---|---|
| S: 40 singles, seed 7 / queue | 13/7/3 | 26 / 7 | 5 | 10 | 30 | 25.39 |
| S: 40 singles, seed 11 / queue | 8/14/6 | 22 / 14 | 24 | 15 | 30 | 52.73 |
| A: 16 compounds / queue | 5/7/0 | 19 / 7 | 6 | 9 | 23 | 18.29 |
| A2: 16 compounds, repeat / queue | 7/8/0 | 16 / 8 | 7 | 12 | 20 | 22.26 |
| B: 40 singles, drift x7 / queue | 16/9/4 | 16 / 9 | 14 | 9 | 21 | 43.37 |
| C: 16 compounds, drift x4 / queue | 8/5/0 | 20 / 5 | 5 | 11 | 22 | 18.22 |

### Machine load

`uptime` printed at the start and end of each race (also logged in `events.jsonl`), and the 1-minute load average sampled every 30 s during it (18 cores). The short baselines (S) were run before load logging existed.

| run | uptime at start | uptime at end | 1-min load during the race: mean / max (samples) |
|---|---|---|---|
| S: 40 singles, seed 7 / queue | not logged | not logged | not logged |
| S: 40 singles, seed 7 / v2 | not logged | not logged | not logged |
| S: 40 singles, seed 11 / queue | not logged | not logged | not logged |
| S: 40 singles, seed 11 / v2 | not logged | not logged | not logged |
| A: 16 compounds / queue | load 6.22 7.18 16.48 | load 12.54 10.55 12.68 | 10.8 / 33.3 (33) |
| A: 16 compounds / v2 | load 3.31 7.31 23.31 | load 6.67 7.28 16.57 | 6.9 / 10.6 (15) |
| A2: 16 compounds, repeat / queue | load 7.17 6.26 7.63 | load 6.41 4.67 4.91 | 3.9 / 12.9 (39) |
| B: 40 singles, drift x7 / queue | load 5.88 29.18 36.19 | load 2.96 4.15 10.62 | 11.2 / 40.8 (59) |
| B: 40 singles, drift x7 / v2 | load 2.96 4.14 10.57 | load 1.83 4.28 6.19 | 5.6 / 12.1 (45) |
| C: 16 compounds, drift x4 / queue | load 5.81 5.30 12.65 | load 6.64 6.12 7.60 | 5.0 / 11.6 (34) |
| C: 16 compounds, drift x4 / v2 | load 6.83 14.12 23.90 | load 2.58 4.66 12.47 | 4.9 / 13.0 (24) |

### How the work flows in

Bases: how many landed changes were already on a bean's base when it started (0 = the pristine base; a flood of beans written before anything lands). Staleness: landings between a bean's base and its own landing. Starts: minutes at which the 20th (or last, for 16 beans) and the final task started; greens: minute of the 20th (or all) green; agents: agent minutes busy / blocked (bound to a task that is waiting) / idle.

| run | beans | started on the pristine base | landings on the base at start (median / p90) | landings from base to own landing (median / p90) | task starts: 20th / last (min) | green: 20th (min) | agent min busy / blocked / idle |
|---|---|---|---|---|---|---|---|
| S: 40 singles, seed 7 / queue | 40 | 40 (100%) | 0 / 0 | 18 / 32 | 0.4 / 0.9 | 5.2 | 21.1 / 0.41 / 176.16 |
| S: 40 singles, seed 7 / v2 | 40 | 12 (30%) | 8.5 / 22 | 5 / 14 | 2.4 / 7.7 | 7.3 | 24.08 / 84.81 / 26.76 |
| S: 40 singles, seed 11 / queue | 40 | 40 (100%) | 0 / 0 | 16.5 / 29 | 0.4 / 0.8 | 4.2 | 20.62 / 0.29 / 396.03 |
| S: 40 singles, seed 11 / v2 | 40 | 12 (30%) | 8.5 / 22 | 6 / 11 | 2.5 / 9.1 | 9.4 | 26.07 / 102.7 / 39.64 |
| A: 16 compounds / queue | 16 | 16 (100%) | 0 / 0 | 6 / 10 | 0.4 / 0.4 | n/r | 15.11 / 0.25 / 184.08 |
| A: 16 compounds / v2 | 16 | 12 (75%) | 0 / 2 | 4.0 / 7 | 2.4 / 2.4 | n/r | 15.27 / 39.66 / 37.81 |
| A2: 16 compounds, repeat / queue | 16 | 16 (100%) | 0 / 0 | 5.5 / 9 | 0.4 / 0.4 | n/r | 14.67 / 0.15 / 219.88 |
| B: 40 singles, drift x7 / queue | 40 | 19 (47%) | 2 / 20 | 11.0 / 21 | 2.7 / 7.9 | 6.7 | 151.26 / 0.47 / 204.89 |
| B: 40 singles, drift x7 / v2 | 40 | 12 (30%) | 8.5 / 24 | 7.0 / 13 | 4.7 / 14.1 | 11.5 | 138.68 / 72.46 / 60.1 |
| C: 16 compounds, drift x4 / queue | 16 | 16 (100%) | 0 / 0 | 6 / 10 | 1.6 / 1.6 | n/r | 61.59 / 0.17 / 147.57 |
| C: 16 compounds, drift x4 / v2 | 16 | 12 (75%) | 0 / 2 | 4 / 8 | 3.3 / 3.3 | n/r | 57.98 / 34.3 / 56.85 |

### In-flight overlap (from the stream-json transcripts: Read / Edit / Write paths with timestamps)

| run | beans | authoring window s (median) | beans authoring at once (peak / mean) | pairs whose authoring windows overlap | pairs that touched a common source file | both | same file held at the same moment | same file edited at the same moment | peers per bean (median / max) | designed semantic pairs overlapping in flight |
|---|---|---|---|---|---|---|---|---|---|---|
| S: 40 singles, seed 7 / queue | 40 | 17.6 | 12 / 4.13 | 378 of 780 | 133 | 72 | 38 | 31 | 1.0 / 7 | 4 of 5 |
| S: 40 singles, seed 7 / v2 | 40 | 17.2 | 12 / 3.19 | 179 of 780 | 195 | 80 | 38 | 28 | 1.0 / 8 | 0 of 5 |
| S: 40 singles, seed 11 / queue | 40 | 15.5 | 12 / 2.93 | 373 of 780 | 130 | 72 | 37 | 24 | 1.0 / 7 | 3 of 5 |
| S: 40 singles, seed 11 / v2 | 40 | 20.4 | 12 / 3.43 | 178 of 780 | 204 | 82 | 50 | 45 | 1.0 / 10 | 0 of 5 |
| A: 16 compounds / queue | 16 | 29.1 | 12 / 3.75 | 111 of 120 | 53 | 51 | 38 | 34 | 4.5 / 9 | 5 of 5 |
| A: 16 compounds / v2 | 16 | 30.7 | 12 / 3.6 | 90 of 120 | 66 | 57 | 33 | 30 | 5.0 / 8 | 5 of 5 |
| A2: 16 compounds, repeat / queue | 16 | 27.5 | 12 / 3.45 | 111 of 120 | 51 | 50 | 37 | 29 | 4.5 / 10 | 5 of 5 |
| B: 40 singles, drift x7 / queue [modelled: touches stretched with the session] | 40 | 134.0 | 12 / 5.64 | 394 of 780 | 132 | 83 | 49 | 34 | 1.0 / 9 | 2 of 5 |
| B: 40 singles, drift x7 / queue [touches as they happened] | 40 | 134.0 | 12 / 5.64 | 394 of 780 | 132 | 83 | 71 | 65 | 3.0 / 13 | 2 of 5 |
| B: 40 singles, drift x7 / v2 [modelled: touches stretched with the session] | 40 | 129.8 | 12 / 6.43 | 280 of 780 | 129 | 66 | 33 | 25 | 1.0 / 8 | 2 of 5 |
| B: 40 singles, drift x7 / v2 [touches as they happened] | 40 | 129.8 | 12 / 6.43 | 280 of 780 | 129 | 66 | 50 | 46 | 1.5 / 12 | 2 of 5 |
| C: 16 compounds, drift x4 / queue [modelled: touches stretched with the session] | 16 | 119.2 | 12 / 3.97 | 111 of 120 | 55 | 53 | 38 | 34 | 5.0 / 9 | 5 of 5 |
| C: 16 compounds, drift x4 / queue [touches as they happened] | 16 | 119.2 | 12 / 3.97 | 111 of 120 | 55 | 53 | 50 | 48 | 7.0 / 11 | 5 of 5 |
| C: 16 compounds, drift x4 / v2 [modelled: touches stretched with the session] | 16 | 119.4 | 12 / 5.71 | 102 of 120 | 47 | 44 | 29 | 28 | 3.5 / 8 | 5 of 5 |
| C: 16 compounds, drift x4 / v2 [touches as they happened] | 16 | 119.4 | 12 / 5.71 | 102 of 120 | 47 | 44 | 39 | 38 | 5.0 / 9 | 5 of 5 |

### Who collided with whom, and when the other bean landed

Each textual conflict, queue ejection and informed rework is paired with the landed change(s) it collided with. Phase = when that change landed relative to the affected bean: **before start** (already in its base: no drift), **during authoring** (a live session existed: a mid-flight notice could have reached it), **after authoring** (the bean was waiting in a queue, a pre-land check or a rework: only the gate acts). Counts are event-partner pairs; cost is the rework invocation each event triggered, split across its partners.

| run | kind | events | pairs | before start | during authoring | after authoring | partner submitted during authoring | rework $ (during / after) | pairs observable before the bean's first end | median lead s |
|---|---|---|---|---|---|---|---|---|---|---|
| S: 40 singles, seed 7 / queue | conflict | 26 | 70 | 0 | 0 | 70 | 27/70 | 0 / 2.016 | 65/70 | 7.7 |
| S: 40 singles, seed 7 / v2 | conflict | 21 | 35 | 0 | 4 | 31 | 9/35 | 0.104 / 1.325 | 19/35 | 9.0 |
| S: 40 singles, seed 7 / v2 | informed-red | 16 | 31 | 5 | 8 | 18 | 4/31 | 0.393 / 0.674 | 5/31 | 9.0 |
| S: 40 singles, seed 11 / queue | conflict | 22 | 46 | 0 | 0 | 46 | 18/46 | 0 / 1.126 | 43/46 | 8.1 |
| S: 40 singles, seed 11 / v2 | conflict | 16 | 20 | 0 | 2 | 18 | 10/20 | 0.194 / 0.973 | 16/20 | 9.1 |
| S: 40 singles, seed 11 / v2 | informed-red | 20 | 39 | 11 | 6 | 22 | 4/39 | 0.255 / 0.746 | 12/39 | 9.1 |
| A: 16 compounds / queue | conflict | 19 | 30 | 0 | 0 | 30 | 22/30 | 0 / 1.335 | 30/30 | 14.4 |
| A: 16 compounds / v2 | conflict | 14 | 23 | 0 | 1 | 22 | 14/23 | 0.02 / 1.167 | 16/23 | 12.7 |
| A: 16 compounds / v2 | informed-red | 8 | 16 | 0 | 0 | 16 | 13/16 | 0 / 0.91 | 6/16 | 12.7 |
| A2: 16 compounds, repeat / queue | conflict | 16 | 25 | 0 | 0 | 25 | 14/25 | 0 / 2.009 | 22/25 | 12.9 |
| B: 40 singles, drift x7 / queue [modelled: touches stretched with the session] | conflict | 16 | 39 | 0 | 13 | 26 | 22/39 | 0.471 / 1.209 | 35/39 | 78.4 |
| B: 40 singles, drift x7 / queue [touches as they happened] | conflict | 16 | 39 | 0 | 13 | 26 | 22/39 | 0.471 / 1.209 | 35/39 | 181.3 |
| B: 40 singles, drift x7 / v2 [modelled: touches stretched with the session] | conflict | 14 | 25 | 0 | 10 | 15 | 9/25 | 0.659 / 0.969 | 18/25 | 68.2 |
| B: 40 singles, drift x7 / v2 [modelled: touches stretched with the session] | informed-red | 5 | 10 | 2 | 2 | 6 | 3/10 | 0.132 / 0.264 | 3/10 | 68.2 |
| B: 40 singles, drift x7 / v2 [touches as they happened] | conflict | 14 | 25 | 0 | 10 | 15 | 9/25 | 0.659 / 0.969 | 19/25 | 178.8 |
| B: 40 singles, drift x7 / v2 [touches as they happened] | informed-red | 5 | 10 | 2 | 2 | 6 | 3/10 | 0.132 / 0.264 | 3/10 | 178.8 |
| C: 16 compounds, drift x4 / queue [modelled: touches stretched with the session] | conflict | 20 | 35 | 0 | 4 | 31 | 24/35 | 0.247 / 2.308 | 34/35 | 50.5 |
| C: 16 compounds, drift x4 / queue [touches as they happened] | conflict | 20 | 35 | 0 | 4 | 31 | 24/35 | 0.247 / 2.308 | 35/35 | 112.5 |
| C: 16 compounds, drift x4 / v2 [modelled: touches stretched with the session] | conflict | 18 | 28 | 0 | 3 | 25 | 11/28 | 0.35 / 1.968 | 22/28 | 47.7 |
| C: 16 compounds, drift x4 / v2 [modelled: touches stretched with the session] | informed-red | 2 | 4 | 0 | 1 | 3 | 3/4 | 0.072 / 0.288 | 2/4 | 47.7 |
| C: 16 compounds, drift x4 / v2 [touches as they happened] | conflict | 18 | 28 | 0 | 3 | 25 | 11/28 | 0.35 / 1.968 | 26/28 | 108.8 |
| C: 16 compounds, drift x4 / v2 [touches as they happened] | informed-red | 2 | 4 | 0 | 1 | 3 | 3/4 | 0.072 / 0.288 | 2/4 | 108.8 |

### Notice opportunity: how many collisions involved a partner that landed while the affected bean was still being written

Pooled over textual conflicts, queue ejections and informed reworks (event-partner pairs). Rework $ is what the rework invocations that answered those collisions cost; the share is of the run's total spend. The drifted runs use the modelled lead (touches stretched with the session); landing and submit times are measured.

| run | collision pairs | partner landed before the bean started | partner landed during its first authoring | partner submitted (diff visible) during its first authoring | rework $ answering those collisions: during / after / before start | share of spend answering a collision whose partner landed during authoring |
|---|---|---|---|---|---|---|
| S: 40 singles, seed 7 / queue | 70 | 0 | 0 (0%) | 27 (39%) | 0.00 / 2.02 / 0.00 | 0% |
| S: 40 singles, seed 7 / v2 | 66 | 5 | 12 (18%) | 13 (20%) | 0.50 / 2.00 / 0.25 | 9% |
| S: 40 singles, seed 11 / queue | 46 | 0 | 0 (0%) | 18 (39%) | 0.00 / 1.13 / 0.00 | 0% |
| S: 40 singles, seed 11 / v2 | 59 | 11 | 8 (14%) | 14 (24%) | 0.45 / 1.72 / 0.47 | 8% |
| A: 16 compounds / queue | 30 | 0 | 0 (0%) | 22 (73%) | 0.00 / 1.33 / 0.00 | 0% |
| A: 16 compounds / v2 | 39 | 0 | 1 (3%) | 27 (69%) | 0.02 / 2.08 / 0.00 | 0% |
| A2: 16 compounds, repeat / queue | 25 | 0 | 0 (0%) | 14 (56%) | 0.00 / 2.01 / 0.00 | 0% |
| B: 40 singles, drift x7 / queue | 39 | 0 | 13 (33%) | 22 (56%) | 0.47 / 1.21 / 0.00 | 10% |
| B: 40 singles, drift x7 / v2 | 35 | 2 | 12 (34%) | 12 (34%) | 0.79 / 1.23 / 0.06 | 18% |
| C: 16 compounds, drift x4 / queue | 35 | 0 | 4 (11%) | 24 (69%) | 0.25 / 2.31 / 0.00 | 5% |
| C: 16 compounds, drift x4 / v2 | 32 | 0 | 4 (12%) | 14 (44%) | 0.42 / 2.26 / 0.00 | 10% |

### Would watching reads and edits have predicted the collisions? (observe-then-place)

Pair rule over all pairs of beans; a pair "collided" if a textual conflict, an ejection or an informed rework involved both.

| run | collided pairs of all | rule | pairs flagged | precision | recall | lift | clean pairs flagged |
|---|---|---|---|---|---|---|---|
| S: 40 singles, seed 7 / queue | 54 of 780 | hold_overlap | 38 | 0.395 | 0.278 | 5.7 | 0.032 |
| S: 40 singles, seed 7 / queue | 54 of 780 | edit_overlap | 31 | 0.387 | 0.222 | 5.59 | 0.026 |
| S: 40 singles, seed 7 / queue | 54 of 780 | window_and_file | 72 | 0.389 | 0.519 | 5.62 | 0.061 |
| S: 40 singles, seed 7 / v2 | 52 of 780 | hold_overlap | 38 | 0.237 | 0.173 | 3.55 | 0.04 |
| S: 40 singles, seed 7 / v2 | 52 of 780 | edit_overlap | 28 | 0.25 | 0.135 | 3.75 | 0.029 |
| S: 40 singles, seed 7 / v2 | 52 of 780 | window_and_file | 80 | 0.225 | 0.346 | 3.38 | 0.085 |
| S: 40 singles, seed 11 / queue | 37 of 780 | hold_overlap | 37 | 0.297 | 0.297 | 6.27 | 0.035 |
| S: 40 singles, seed 11 / queue | 37 of 780 | edit_overlap | 24 | 0.333 | 0.216 | 7.03 | 0.022 |
| S: 40 singles, seed 11 / queue | 37 of 780 | window_and_file | 72 | 0.292 | 0.568 | 6.15 | 0.069 |
| S: 40 singles, seed 11 / v2 | 41 of 780 | hold_overlap | 50 | 0.18 | 0.22 | 3.42 | 0.055 |
| S: 40 singles, seed 11 / v2 | 41 of 780 | edit_overlap | 45 | 0.178 | 0.195 | 3.38 | 0.05 |
| S: 40 singles, seed 11 / v2 | 41 of 780 | window_and_file | 82 | 0.195 | 0.39 | 3.71 | 0.089 |
| A: 16 compounds / queue | 23 of 120 | hold_overlap | 38 | 0.447 | 0.739 | 2.33 | 0.216 |
| A: 16 compounds / queue | 23 of 120 | edit_overlap | 34 | 0.471 | 0.696 | 2.46 | 0.186 |
| A: 16 compounds / queue | 23 of 120 | window_and_file | 51 | 0.412 | 0.913 | 2.15 | 0.309 |
| A: 16 compounds / v2 | 33 of 120 | hold_overlap | 33 | 0.394 | 0.394 | 1.43 | 0.23 |
| A: 16 compounds / v2 | 33 of 120 | edit_overlap | 30 | 0.433 | 0.394 | 1.58 | 0.195 |
| A: 16 compounds / v2 | 33 of 120 | window_and_file | 57 | 0.439 | 0.758 | 1.59 | 0.368 |
| A2: 16 compounds, repeat / queue | 20 of 120 | hold_overlap | 37 | 0.378 | 0.7 | 2.27 | 0.23 |
| A2: 16 compounds, repeat / queue | 20 of 120 | edit_overlap | 29 | 0.414 | 0.6 | 2.48 | 0.17 |
| A2: 16 compounds, repeat / queue | 20 of 120 | window_and_file | 50 | 0.38 | 0.95 | 2.28 | 0.31 |
| B: 40 singles, drift x7 / queue [modelled: touches stretched with the session] | 31 of 780 | hold_overlap | 49 | 0.388 | 0.613 | 9.76 | 0.04 |
| B: 40 singles, drift x7 / queue [modelled: touches stretched with the session] | 31 of 780 | edit_overlap | 34 | 0.382 | 0.419 | 9.62 | 0.028 |
| B: 40 singles, drift x7 / queue [modelled: touches stretched with the session] | 31 of 780 | window_and_file | 83 | 0.325 | 0.871 | 8.18 | 0.075 |
| B: 40 singles, drift x7 / queue [touches as they happened] | 31 of 780 | hold_overlap | 71 | 0.366 | 0.839 | 9.21 | 0.06 |
| B: 40 singles, drift x7 / queue [touches as they happened] | 31 of 780 | edit_overlap | 65 | 0.4 | 0.839 | 10.06 | 0.052 |
| B: 40 singles, drift x7 / queue [touches as they happened] | 31 of 780 | window_and_file | 83 | 0.325 | 0.871 | 8.18 | 0.075 |
| B: 40 singles, drift x7 / v2 [modelled: touches stretched with the session] | 30 of 780 | hold_overlap | 33 | 0.273 | 0.3 | 7.09 | 0.032 |
| B: 40 singles, drift x7 / v2 [modelled: touches stretched with the session] | 30 of 780 | edit_overlap | 25 | 0.36 | 0.3 | 9.36 | 0.021 |
| B: 40 singles, drift x7 / v2 [modelled: touches stretched with the session] | 30 of 780 | window_and_file | 66 | 0.273 | 0.6 | 7.09 | 0.064 |
| B: 40 singles, drift x7 / v2 [touches as they happened] | 30 of 780 | hold_overlap | 50 | 0.26 | 0.433 | 6.76 | 0.049 |
| B: 40 singles, drift x7 / v2 [touches as they happened] | 30 of 780 | edit_overlap | 46 | 0.283 | 0.433 | 7.35 | 0.044 |
| B: 40 singles, drift x7 / v2 [touches as they happened] | 30 of 780 | window_and_file | 66 | 0.273 | 0.6 | 7.09 | 0.064 |
| C: 16 compounds, drift x4 / queue [modelled: touches stretched with the session] | 25 of 120 | hold_overlap | 38 | 0.526 | 0.8 | 2.53 | 0.189 |
| C: 16 compounds, drift x4 / queue [modelled: touches stretched with the session] | 25 of 120 | edit_overlap | 34 | 0.559 | 0.76 | 2.68 | 0.158 |
| C: 16 compounds, drift x4 / queue [modelled: touches stretched with the session] | 25 of 120 | window_and_file | 53 | 0.453 | 0.96 | 2.17 | 0.305 |
| C: 16 compounds, drift x4 / queue [touches as they happened] | 25 of 120 | hold_overlap | 50 | 0.48 | 0.96 | 2.3 | 0.274 |
| C: 16 compounds, drift x4 / queue [touches as they happened] | 25 of 120 | edit_overlap | 48 | 0.5 | 0.96 | 2.4 | 0.253 |
| C: 16 compounds, drift x4 / queue [touches as they happened] | 25 of 120 | window_and_file | 53 | 0.453 | 0.96 | 2.17 | 0.305 |
| C: 16 compounds, drift x4 / v2 [modelled: touches stretched with the session] | 22 of 120 | hold_overlap | 29 | 0.414 | 0.545 | 2.26 | 0.173 |
| C: 16 compounds, drift x4 / v2 [modelled: touches stretched with the session] | 22 of 120 | edit_overlap | 28 | 0.429 | 0.545 | 2.34 | 0.163 |
| C: 16 compounds, drift x4 / v2 [modelled: touches stretched with the session] | 22 of 120 | window_and_file | 44 | 0.432 | 0.864 | 2.36 | 0.255 |
| C: 16 compounds, drift x4 / v2 [touches as they happened] | 22 of 120 | hold_overlap | 39 | 0.436 | 0.773 | 2.38 | 0.224 |
| C: 16 compounds, drift x4 / v2 [touches as they happened] | 22 of 120 | edit_overlap | 38 | 0.447 | 0.773 | 2.44 | 0.214 |
| C: 16 compounds, drift x4 / v2 [touches as they happened] | 22 of 120 | window_and_file | 44 | 0.432 | 0.864 | 2.36 | 0.255 |

### Designed semantic couplings: were the two beans in flight together?

| run | pair | both being written at once (s) | holding the same file at once (s) | common source files touched at any time | landed order |
|---|---|---|---|---|---|
| S: 40 singles, seed 7 / queue | t002+t022 | 2.0 | 0.0 | - | t002 then t022 |
| S: 40 singles, seed 7 / queue | t005+t031 | 0.0 | 0.0 | src/lib/money.ts | t005 then t031 |
| S: 40 singles, seed 7 / queue | t011+t018 | 7.3 | 0.0 | src/shipping/service.ts | t011 then t018 |
| S: 40 singles, seed 7 / queue | t023+t036 | 6.4 | 0.0 | src/billing/invoice.ts | t023 then t036 |
| S: 40 singles, seed 7 / queue | t028+t032 | 8.7 | 0.3 | src/types.ts | t028 then t032 |
| S: 40 singles, seed 7 / v2 | t002+t022 | 0.0 | 0.0 | - | t002 then t022 |
| S: 40 singles, seed 7 / v2 | t005+t031 | 0.0 | 0.0 | src/lib/money.ts | t005 then t031 |
| S: 40 singles, seed 7 / v2 | t011+t018 | 0.0 | 0.0 | - | t011 then t018 |
| S: 40 singles, seed 7 / v2 | t023+t036 | 0.0 | 0.0 | src/billing/invoice.ts | t023 then t036 |
| S: 40 singles, seed 7 / v2 | t028+t032 | 0.0 | 0.0 | src/shipping/service.ts, src/types.ts | t028 then t032 |
| S: 40 singles, seed 11 / queue | t002+t022 | 0.0 | 0.0 | - | t002 then t022 |
| S: 40 singles, seed 11 / queue | t005+t031 | 0.0 | 0.0 | - | t005 then t031 |
| S: 40 singles, seed 11 / queue | t011+t018 | 11.0 | 0.0 | src/notifications/templates.ts | t018 then t011 |
| S: 40 singles, seed 11 / queue | t023+t036 | 2.6 | 0.0 | src/billing/invoice.ts | t036 then t023 |
| S: 40 singles, seed 11 / queue | t028+t032 | 12.3 | 1.1 | src/types.ts | t028 then t032 |
| S: 40 singles, seed 11 / v2 | t002+t022 | 0.0 | 0.0 | - | t002 then t022 |
| S: 40 singles, seed 11 / v2 | t005+t031 | 0.0 | 0.0 | - | t005 then t031 |
| S: 40 singles, seed 11 / v2 | t011+t018 | 0.0 | 0.0 | - | t018 then t011 |
| S: 40 singles, seed 11 / v2 | t023+t036 | 0.0 | 0.0 | - | t023 then t036 |
| S: 40 singles, seed 11 / v2 | t028+t032 | 0.0 | 0.0 | src/notifications/templates.ts, src/shipping/service.ts, src/types.ts | t028 then t032 |
| A: 16 compounds / queue | L01+L02 | 30.8 | 0.0 | src/billing/handlers.ts, src/routes.ts | L01 then L02 |
| A: 16 compounds / queue | L04+L12 | 19.1 | 0.0 | - | L04 then L12 |
| A: 16 compounds / queue | L05+L11 | 27.6 | 41.1 | src/billing/invoice.ts, src/billing/tax.ts | L05 then L11 |
| A: 16 compounds / queue | L07+L14 | 18.2 | 9.7 | src/config.ts, src/types.ts | L14 then L07 |
| A: 16 compounds / queue | L08+L12 | 25.1 | 0.0 | src/shipping/service.ts | L08 then L12 |
| A: 16 compounds / v2 | L01+L02 | 51.3 | 56.1 | src/billing/handlers.ts, src/lib/pagination.ts, src/notifications/queue.ts, src/notifications/templates.ts, src/orders/checkout.ts | L01 then L02 |
| A: 16 compounds / v2 | L04+L12 | 16.2 | 0.0 | - | L04 then L12 |
| A: 16 compounds / v2 | L05+L11 | 34.0 | 0.0 | src/billing/service.ts | L11 then L05 |
| A: 16 compounds / v2 | L07+L14 | 11.7 | 0.0 | src/config.ts, src/types.ts | L14 then L07 |
| A: 16 compounds / v2 | L08+L12 | 22.5 | 0.0 | - | L08 then L12 |
| A2: 16 compounds, repeat / queue | L01+L02 | 61.6 | 62.8 | src/billing/handlers.ts, src/lib/pagination.ts, src/orders/checkout.ts, src/orders/handlers.ts, src/orders/service.ts | L01 then L02 |
| A2: 16 compounds, repeat / queue | L04+L12 | 15.0 | 0.0 | - | L04 then L12 |
| A2: 16 compounds, repeat / queue | L05+L11 | 33.4 | 0.0 | - | L11 then L05 |
| A2: 16 compounds, repeat / queue | L07+L14 | 15.5 | 0.0 | src/config.ts, src/types.ts | L14 then L07 |
| A2: 16 compounds, repeat / queue | L08+L12 | 21.0 | 0.0 | - | L08 then L12 |
| B: 40 singles, drift x7 / queue [modelled: touches stretched with the session] | t002+t022 | 0.0 | 0.0 | - | t002 then t022 |
| B: 40 singles, drift x7 / queue [modelled: touches stretched with the session] | t005+t031 | 0.0 | 0.0 | - | t005 then t031 |
| B: 40 singles, drift x7 / queue [modelled: touches stretched with the session] | t011+t018 | 84.6 | 0.0 | src/notifications/templates.ts | t018 then t011 |
| B: 40 singles, drift x7 / queue [modelled: touches stretched with the session] | t023+t036 | 0.0 | 0.0 | src/billing/invoice.ts | t023 then t036 |
| B: 40 singles, drift x7 / queue [modelled: touches stretched with the session] | t028+t032 | 118.9 | 55.7 | src/types.ts | t028 then t032 |
| B: 40 singles, drift x7 / queue [touches as they happened] | t002+t022 | 0.0 | 0.0 | - | t002 then t022 |
| B: 40 singles, drift x7 / queue [touches as they happened] | t005+t031 | 0.0 | 0.0 | - | t005 then t031 |
| B: 40 singles, drift x7 / queue [touches as they happened] | t011+t018 | 84.6 | 0.0 | src/notifications/templates.ts | t018 then t011 |
| B: 40 singles, drift x7 / queue [touches as they happened] | t023+t036 | 0.0 | 0.0 | src/billing/invoice.ts | t023 then t036 |
| B: 40 singles, drift x7 / queue [touches as they happened] | t028+t032 | 118.9 | 109.9 | src/types.ts | t028 then t032 |
| B: 40 singles, drift x7 / v2 [modelled: touches stretched with the session] | t002+t022 | 0.0 | 0.0 | - | t002 then t022 |
| B: 40 singles, drift x7 / v2 [modelled: touches stretched with the session] | t005+t031 | 0.0 | 0.0 | src/lib/money.ts | t005 then t031 |
| B: 40 singles, drift x7 / v2 [modelled: touches stretched with the session] | t011+t018 | 0.0 | 0.0 | - | t011 then t018 |
| B: 40 singles, drift x7 / v2 [modelled: touches stretched with the session] | t023+t036 | 200.1 | 0.0 | - | t023 then t036 |
| B: 40 singles, drift x7 / v2 [modelled: touches stretched with the session] | t028+t032 | 255.8 | 37.7 | src/types.ts | t028 then t032 |
| B: 40 singles, drift x7 / v2 [touches as they happened] | t002+t022 | 0.0 | 0.0 | - | t002 then t022 |
| B: 40 singles, drift x7 / v2 [touches as they happened] | t005+t031 | 0.0 | 0.0 | src/lib/money.ts | t005 then t031 |
| B: 40 singles, drift x7 / v2 [touches as they happened] | t011+t018 | 0.0 | 0.0 | - | t011 then t018 |
| B: 40 singles, drift x7 / v2 [touches as they happened] | t023+t036 | 200.1 | 0.0 | - | t023 then t036 |
| B: 40 singles, drift x7 / v2 [touches as they happened] | t028+t032 | 255.8 | 86.0 | src/types.ts | t028 then t032 |
| C: 16 compounds, drift x4 / queue [modelled: touches stretched with the session] | L01+L02 | 133.9 | 0.0 | src/billing/handlers.ts, src/routes.ts | L01 then L02 |
| C: 16 compounds, drift x4 / queue [modelled: touches stretched with the session] | L04+L12 | 76.6 | 0.0 | - | L04 then L12 |
| C: 16 compounds, drift x4 / queue [modelled: touches stretched with the session] | L05+L11 | 125.3 | 54.3 | src/billing/tax.ts | L05 then L11 |
| C: 16 compounds, drift x4 / queue [modelled: touches stretched with the session] | L07+L14 | 68.7 | 3.6 | src/config.ts, src/types.ts | L14 then L07 |
| C: 16 compounds, drift x4 / queue [modelled: touches stretched with the session] | L08+L12 | 94.9 | 0.0 | src/shipping/service.ts | L08 then L12 |
| C: 16 compounds, drift x4 / queue [touches as they happened] | L01+L02 | 133.9 | 96.4 | src/billing/handlers.ts, src/routes.ts | L01 then L02 |
| C: 16 compounds, drift x4 / queue [touches as they happened] | L04+L12 | 76.6 | 0.0 | - | L04 then L12 |
| C: 16 compounds, drift x4 / queue [touches as they happened] | L05+L11 | 125.3 | 107.6 | src/billing/tax.ts | L05 then L11 |
| C: 16 compounds, drift x4 / queue [touches as they happened] | L07+L14 | 68.7 | 102.1 | src/config.ts, src/types.ts | L14 then L07 |
| C: 16 compounds, drift x4 / queue [touches as they happened] | L08+L12 | 94.9 | 0.0 | src/shipping/service.ts | L08 then L12 |
| C: 16 compounds, drift x4 / v2 [modelled: touches stretched with the session] | L01+L02 | 143.8 | 0.0 | src/billing/handlers.ts, src/routes.ts | L01 then L02 |
| C: 16 compounds, drift x4 / v2 [modelled: touches stretched with the session] | L04+L12 | 75.8 | 0.0 | - | L04 then L12 |
| C: 16 compounds, drift x4 / v2 [modelled: touches stretched with the session] | L05+L11 | 139.6 | 42.0 | src/billing/tax.ts | L11 then L05 |
| C: 16 compounds, drift x4 / v2 [modelled: touches stretched with the session] | L07+L14 | 238.6 | 34.3 | src/config.ts, src/db/migrations/index.ts, src/types.ts | L14 then L07 |
| C: 16 compounds, drift x4 / v2 [modelled: touches stretched with the session] | L08+L12 | 94.7 | 0.0 | - | L08 then L12 |
| C: 16 compounds, drift x4 / v2 [touches as they happened] | L01+L02 | 143.8 | 106.0 | src/billing/handlers.ts, src/routes.ts | L01 then L02 |
| C: 16 compounds, drift x4 / v2 [touches as they happened] | L04+L12 | 75.8 | 0.0 | - | L04 then L12 |
| C: 16 compounds, drift x4 / v2 [touches as they happened] | L05+L11 | 139.6 | 99.7 | src/billing/tax.ts | L11 then L05 |
| C: 16 compounds, drift x4 / v2 [touches as they happened] | L07+L14 | 238.6 | 119.5 | src/config.ts, src/db/migrations/index.ts, src/types.ts | L14 then L07 |
| C: 16 compounds, drift x4 / v2 [touches as they happened] | L08+L12 | 94.7 | 0.0 | - | L08 then L12 |

