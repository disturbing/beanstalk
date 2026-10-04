### Results table

| run | policy | tasks | drift x | initial bean min (real / in race) | 50% green (k=20) min / $ | 75% green (k=30) min / $ | 87% green (k=35) min / $ | done min | greens | rechecks / optimistic | conflicts | informed reworks | cards | red validations | cost $ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| short, seed 7 / queue | queue | 40 | 1 | 0.3 / 0.3 | 5.2 / $3.03 | 10.4 / $3.98 | 15.5 / $4.42 | 16.5 | 37/40 | n/a (queue) | 26 | 30 reworks (ejections 26c/7r) | n/a | 7 | 4.42 |
| short, seed 7 / v2 | v2 | 40 | 1 | 0.3 / 0.3 | 7.3 / $4.79 | 9.7 / $5.21 | 11.3 / $5.29 | 11.3 | 35/40 | 12 / 31 | 21 | 16 | 1 | 1 | 5.29 |
| short, seed 11 / queue | queue | 40 | 1 | 0.3 / 0.3 | 4.2 / $2.65 | 20.5 / $3.77 | not reached | 34.7 | 34/40 | n/a (queue) | 22 | 30 reworks (ejections 22c/14r) | n/a | 14 | 4.10 |
| short, seed 11 / v2 | v2 | 40 | 1 | 0.3 / 0.3 | 9.4 / $5.32 | 10.9 / $5.54 | not reached | 14.0 | 34/40 | 25 / 29 | 16 | 20 | 1 | 2 | 5.62 |

### `race/kth_green.py` output (time in minutes since the race started / cumulative agent cost)

**short, seed 7** (k = 20, 30, 35 of 40):

| run | policy | model | agents | 20th green min / $ | 30th green min / $ | 35th green min / $ | greens | total $ | wall min | red validations | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|
| opus-queue-sonnet-12-landed | queue | sonnet | 12 | 5.2 / 3.03 | 10.4 / 3.98 | 15.5 / 4.42 | 37 | 4.42 | 16.5 | 7 | True |
| opus-v2fair-sonnet-12-s7 | beanstalk (v2) | sonnet | 12 | 7.3 / 4.79 | 9.7 / 5.21 | 11.3 / 5.29 | 35 | 5.29 | 11.3 | 1 | True |

**short, seed 11** (k = 20, 30, 35 of 40):

| run | policy | model | agents | 20th green min / $ | 30th green min / $ | 35th green min / $ | greens | total $ | wall min | red validations | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|
| opus-queue-sonnet-12-s11 | queue | sonnet | 12 | 4.2 / 2.65 | 20.5 / 3.77 | not reached | 34 | 4.10 | 34.7 | 14 | True |
| opus-v2fair-sonnet-12-s11 | beanstalk (v2) | sonnet | 12 | 9.4 / 5.32 | 10.9 / 5.54 | not reached | 34 | 5.62 | 14.0 | 2 | True |

### v2's lead (queue / v2; above 1 = v2 is faster or cheaper)

| condition | 50% green | 75% green | 87% green | done | total $ |
|---|---|---|---|---|---|
| short, seed 7 | 0.71 (5.25 / 7.35 min) | 1.07 (10.37 / 9.66 min) | 1.37 (15.46 / 11.31 min) | 1.46 (16.47 / 11.3 min) | 0.84 ($4.42 / $5.29) |
| short, seed 11 | 0.45 (4.21 / 9.4 min) | 1.88 (20.5 / 10.93 min) | n/r (n/r / n/r min) | 2.48 (34.74 / 14.03 min) | 0.73 ($4.1 / $5.62) |

### What a bean lives through

| run | initial bean s (real med / in race med / in race p90) | rework in race s (med) | landings absorbed during first authoring (med / p90) | landings from start to own landing (med / p90) | submit to land s (med / p90) | submit to green s (med / p90) | queue max depth | agent min busy / blocked / idle | suite s (med / p90) | load avg 1 min at start / end |
|---|---|---|---|---|---|---|---|---|---|---|
| short, seed 7 / queue | 17.6 / 17.6 / 26.4 | 16.1 | 0 / 0 | 18 / 32.4 | 272.5 / 738.9 | 272.5 / 738.9 | 37 | 21.1 / 0.41 / 176.16 | 0.85 / 1.21 | not logged / not logged |
| short, seed 7 / v2 | 17.2 / 17.2 / 30.5 | 18.6 | 1 / 4 | 5 / 14.6 | 61.1 / 233.6 | 199.4 / 345.7 | - | 24.08 / 84.81 / 26.76 | 0.58 / 0.92 | not logged / not logged |
| short, seed 11 / queue | 15.5 / 15.5 / 25.9 | 14.1 | 0 / 0 | 16.5 / 29.7 | 214.7 / 1250.2 | 214.7 / 1250.2 | 37 | 20.62 / 0.29 / 396.03 | 0.87 / 1.38 | not logged / not logged |
| short, seed 11 / v2 | 20.4 / 20.4 / 30.7 | 18.5 | 0.5 / 4 | 6 / 11 | 93.6 / 278.8 | 180.5 / 364.7 | - | 26.07 / 102.7 / 39.64 | 0.72 / 1.35 | not logged / not logged |

### v2 internals

| run | pre-land checks (red) | rechecks (green / red outcome) | optimistic landings of landings | locked fallbacks | checks per landing | pre-land check minutes | revert-first |
|---|---|---|---|---|---|---|---|
| short, seed 7 / v2 | 83 (17) | 12 (10 / 2) | 31 of 35 | 1 | 2.37 | 83.9 | 1 |
| short, seed 11 / v2 | 94 (23) | 25 (21 / 4) | 29 of 35 | 2 | 2.69 | 95.4 | 1 |

### Queue internals

| run | batches green / red / cancelled | ejections conflict / red | bisect CI runs | PRs held behind in-flight conflicts | reworks | CI minutes |
|---|---|---|---|---|---|---|
| short, seed 7 / queue | 13/7/3 | 26 / 7 | 5 | 10 | 30 | 25.39 |
| short, seed 11 / queue | 8/14/6 | 22 / 14 | 24 | 15 | 30 | 52.73 |

### In-flight overlap (from the stream-json transcripts: Read / Edit / Write paths with timestamps)

| run | beans | authoring window s (median) | beans authoring at once (peak / mean) | pairs whose authoring windows overlap | pairs that touched a common source file | both | same file held at the same moment | same file edited at the same moment | peers per bean (median / max) | designed semantic pairs overlapping in flight |
|---|---|---|---|---|---|---|---|---|---|---|
| short, seed 7 / queue | 40 | 17.6 | 12 / 4.13 | 378 of 780 | 133 | 72 | 38 | 31 | 1.0 / 7 | 4 of 5 |
| short, seed 7 / v2 | 40 | 17.2 | 12 / 3.19 | 179 of 780 | 195 | 80 | 38 | 28 | 1.0 / 8 | 0 of 5 |
| short, seed 11 / queue | 40 | 15.5 | 12 / 2.93 | 373 of 780 | 130 | 72 | 37 | 24 | 1.0 / 7 | 3 of 5 |
| short, seed 11 / v2 | 40 | 20.4 | 12 / 3.43 | 178 of 780 | 204 | 82 | 50 | 45 | 1.0 / 10 | 0 of 5 |

### Who collided with whom, and when the other bean landed

Each textual conflict, queue ejection and informed rework is paired with the landed change(s) it collided with. Phase = when that change landed relative to the affected bean: **before start** (already in its base: no drift), **during authoring** (a live session existed: a mid-flight notice could have reached it), **after authoring** (the bean was waiting in a queue, a pre-land check or a rework: only the gate acts). Counts are event-partner pairs; cost is the rework invocation each event triggered, split across its partners.

| run | kind | events | pairs | before start | during authoring | after authoring | rework $ (during / after) | pairs observable before the bean's first end | median lead s |
|---|---|---|---|---|---|---|---|---|---|
| short, seed 7 / queue | conflict | 26 | 70 | 0 | 0 | 70 | 0 / 2.016 | 65/70 | 7.7 |
| short, seed 7 / v2 | conflict | 21 | 35 | 0 | 4 | 31 | 0.104 / 1.325 | 19/35 | 9.0 |
| short, seed 7 / v2 | informed-red | 16 | 31 | 5 | 8 | 18 | 0.393 / 0.674 | 5/31 | 9.0 |
| short, seed 11 / queue | conflict | 22 | 46 | 0 | 0 | 46 | 0 / 1.126 | 43/46 | 8.1 |
| short, seed 11 / v2 | conflict | 16 | 20 | 0 | 2 | 18 | 0.194 / 0.973 | 16/20 | 9.1 |
| short, seed 11 / v2 | informed-red | 20 | 39 | 11 | 6 | 22 | 0.255 / 0.746 | 12/39 | 9.1 |

### Would watching reads and edits have predicted the collisions? (observe-then-place)

Pair rule over all pairs of beans; a pair "collided" if a textual conflict, an ejection or an informed rework involved both.

| run | collided pairs of all | rule | pairs flagged | precision | recall | lift | clean pairs flagged |
|---|---|---|---|---|---|---|---|
| short, seed 7 / queue | 54 of 780 | hold_overlap | 38 | 0.395 | 0.278 | 5.7 | 0.032 |
| short, seed 7 / queue | 54 of 780 | edit_overlap | 31 | 0.387 | 0.222 | 5.59 | 0.026 |
| short, seed 7 / queue | 54 of 780 | window_and_file | 72 | 0.389 | 0.519 | 5.62 | 0.061 |
| short, seed 7 / v2 | 52 of 780 | hold_overlap | 38 | 0.237 | 0.173 | 3.55 | 0.04 |
| short, seed 7 / v2 | 52 of 780 | edit_overlap | 28 | 0.25 | 0.135 | 3.75 | 0.029 |
| short, seed 7 / v2 | 52 of 780 | window_and_file | 80 | 0.225 | 0.346 | 3.38 | 0.085 |
| short, seed 11 / queue | 37 of 780 | hold_overlap | 37 | 0.297 | 0.297 | 6.27 | 0.035 |
| short, seed 11 / queue | 37 of 780 | edit_overlap | 24 | 0.333 | 0.216 | 7.03 | 0.022 |
| short, seed 11 / queue | 37 of 780 | window_and_file | 72 | 0.292 | 0.568 | 6.15 | 0.069 |
| short, seed 11 / v2 | 41 of 780 | hold_overlap | 50 | 0.18 | 0.22 | 3.42 | 0.055 |
| short, seed 11 / v2 | 41 of 780 | edit_overlap | 45 | 0.178 | 0.195 | 3.38 | 0.05 |
| short, seed 11 / v2 | 41 of 780 | window_and_file | 82 | 0.195 | 0.39 | 3.71 | 0.089 |

### Designed semantic couplings: were the two beans in flight together?

| run | pair | both being written at once (s) | holding the same file at once (s) | common source files touched at any time | landed order |
|---|---|---|---|---|---|
| short, seed 7 / queue | t002+t022 | 2.0 | 0.0 | - | t002 then t022 |
| short, seed 7 / queue | t005+t031 | 0.0 | 0.0 | src/lib/money.ts | t005 then t031 |
| short, seed 7 / queue | t011+t018 | 7.3 | 0.0 | src/shipping/service.ts | t011 then t018 |
| short, seed 7 / queue | t023+t036 | 6.4 | 0.0 | src/billing/invoice.ts | t023 then t036 |
| short, seed 7 / queue | t028+t032 | 8.7 | 0.3 | src/types.ts | t028 then t032 |
| short, seed 7 / v2 | t002+t022 | 0.0 | 0.0 | - | t002 then t022 |
| short, seed 7 / v2 | t005+t031 | 0.0 | 0.0 | src/lib/money.ts | t005 then t031 |
| short, seed 7 / v2 | t011+t018 | 0.0 | 0.0 | - | t011 then t018 |
| short, seed 7 / v2 | t023+t036 | 0.0 | 0.0 | src/billing/invoice.ts | t023 then t036 |
| short, seed 7 / v2 | t028+t032 | 0.0 | 0.0 | src/shipping/service.ts, src/types.ts | t028 then t032 |
| short, seed 11 / queue | t002+t022 | 0.0 | 0.0 | - | t002 then t022 |
| short, seed 11 / queue | t005+t031 | 0.0 | 0.0 | - | t005 then t031 |
| short, seed 11 / queue | t011+t018 | 11.0 | 0.0 | src/notifications/templates.ts | t018 then t011 |
| short, seed 11 / queue | t023+t036 | 2.6 | 0.0 | src/billing/invoice.ts | t036 then t023 |
| short, seed 11 / queue | t028+t032 | 12.3 | 1.1 | src/types.ts | t028 then t032 |
| short, seed 11 / v2 | t002+t022 | 0.0 | 0.0 | - | t002 then t022 |
| short, seed 11 / v2 | t005+t031 | 0.0 | 0.0 | - | t005 then t031 |
| short, seed 11 / v2 | t011+t018 | 0.0 | 0.0 | - | t018 then t011 |
| short, seed 11 / v2 | t023+t036 | 0.0 | 0.0 | - | t023 then t036 |
| short, seed 11 / v2 | t028+t032 | 0.0 | 0.0 | src/notifications/templates.ts, src/shipping/service.ts, src/types.ts | t028 then t032 |

