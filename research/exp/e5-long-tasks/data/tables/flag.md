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
