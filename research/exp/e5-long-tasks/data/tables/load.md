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
