| Run | 20th green | 30th green | 35th green | Done (min) | Greens | Dropped | Red validations | Textual conflicts | Rework invocations | Cost: Claude + Codex (est.) | Cost total | Final green correct | Suite median; load average at start -> end |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| queue, mixed fleet, seed 7 (e7-queue-mixed-12-s7) | 8.3 | 17.5 | 21.5 | 23.6 | 36 | 4 | 8 | 23 | 27 | $3.11 + $0.89 | $4.00 | True | 0.8 s; 8.14 4.90 4.99 -> 8.54 4.40 4.10 |
| queue, Claude only (opus-queue-sonnet-12-landed) | 5.2 | 10.4 | 15.5 | 16.5 | 37 | 3 | 7 | 26 | 30 | $4.42 | $4.42 | True | 0.8 s; n/a |
| queue, Claude only (opus-queue-sonnet-12-s11) | 4.2 | 20.5 | n/a | 34.7 | 34 | 6 | 14 | 22 | 30 | $4.10 | $4.10 | True | 1.0 s; n/a |
| v2, mixed fleet, seed 7 (e7-v2-mixed-12-s7) | 8.6 | 11.6 | 13.6 | 15.2 | 36 | 4 | 3 | 21 | 33 | $3.04 + $1.51 | $4.55 | True | 0.6 s; 29.10 32.63 18.12 -> 3.34 6.75 10.75 |
| v2, Claude only (opus-v2fair-sonnet-12-s7) | 7.3 | 9.7 | 11.3 | 11.3 | 35 | 5 | 1 | 21 | 37 | $5.29 | $5.29 | True | 0.6 s; n/a |
| v2, Claude only (opus-v2fair-sonnet-12-s11) | 9.4 | 10.9 | n/a | 14.0 | 34 | 6 | 2 | 16 | 36 | $5.62 | $5.62 | True | 0.7 s; n/a |
