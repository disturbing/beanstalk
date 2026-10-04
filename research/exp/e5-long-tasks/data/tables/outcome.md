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
