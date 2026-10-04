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
