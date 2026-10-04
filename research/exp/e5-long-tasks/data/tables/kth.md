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
