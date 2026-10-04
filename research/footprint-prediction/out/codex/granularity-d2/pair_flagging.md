### Pair flagging (step 1 pairs)

pairs with both changes in the evaluation slice: 53083 tested pairs (863 conflict, 52220 clean; 731 conflict after merge drivers). Excluded and only counted: 11118 entangled, 0 error. Base conflict rate 0.0163 (0.0138 after drivers). A pair is flagged when the predicted module sets intersect.

**all modules, raw**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 1.000 | 0.222 | 0.0693 | 4.3 | 0.234 |
| oracle: pair shares a file | 1.000 | 0.060 | 0.2171 | 13.4 | 0.075 |
| combined @ tuned thr 0.196 | 0.855 | 0.556 | 0.0248 | 1.5 | 0.561 |
| combined p>=0.1 | 0.985 | 0.856 | 0.0187 | 1.1 | 0.858 |
| combined p>=0.2 | 0.849 | 0.544 | 0.0252 | 1.5 | 0.549 |
| combined p>=0.3 | 0.638 | 0.286 | 0.0356 | 2.2 | 0.292 |
| combined p>=0.5 | 0.255 | 0.060 | 0.0661 | 4.1 | 0.063 |
| combined top-1 | 0.299 | 0.086 | 0.0545 | 3.4 | 0.089 |
| combined top-3 | 0.784 | 0.466 | 0.0271 | 1.7 | 0.471 |
| prior @ tuned thr 0.114 | 1.000 | 1.000 | 0.0163 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0163 | 1.0 | 1.000 |
| prior p>=0.2 | 0.971 | 0.980 | 0.0161 | 1.0 | 0.980 |
| prior p>=0.3 | 0.000 | 0.000 | n/a | n/a | 0.000 |
| prior p>=0.5 | 0.000 | 0.000 | n/a | n/a | 0.000 |
| prior top-1 | 0.962 | 0.964 | 0.0162 | 1.0 | 0.964 |
| prior top-3 | 1.000 | 1.000 | 0.0163 | 1.0 | 1.000 |

**all modules, after drivers**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 1.000 | 0.224 | 0.0587 | 4.3 | 0.234 |
| oracle: pair shares a file | 1.000 | 0.062 | 0.1839 | 13.4 | 0.075 |
| combined @ tuned thr 0.196 | 0.855 | 0.557 | 0.0210 | 1.5 | 0.561 |
| combined p>=0.1 | 0.984 | 0.856 | 0.0158 | 1.1 | 0.858 |
| combined p>=0.2 | 0.850 | 0.545 | 0.0213 | 1.5 | 0.549 |
| combined p>=0.3 | 0.636 | 0.287 | 0.0301 | 2.2 | 0.292 |
| combined p>=0.5 | 0.265 | 0.060 | 0.0583 | 4.2 | 0.063 |
| combined top-1 | 0.330 | 0.086 | 0.0509 | 3.7 | 0.089 |
| combined top-3 | 0.829 | 0.466 | 0.0242 | 1.8 | 0.471 |
| prior @ tuned thr 0.114 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |
| prior p>=0.2 | 0.967 | 0.980 | 0.0136 | 1.0 | 0.980 |
| prior p>=0.3 | 0.000 | 0.000 | n/a | n/a | 0.000 |
| prior p>=0.5 | 0.000 | 0.000 | n/a | n/a | 0.000 |
| prior top-1 | 0.967 | 0.964 | 0.0138 | 1.0 | 0.964 |
| prior top-3 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |

**substantive modules, raw**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 1.000 | 0.222 | 0.0694 | 4.3 | 0.234 |
| oracle: pair shares a file | 1.000 | 0.060 | 0.2171 | 13.4 | 0.075 |
| combined @ tuned thr 0.196 | 0.855 | 0.556 | 0.0248 | 1.5 | 0.561 |
| combined p>=0.1 | 0.985 | 0.856 | 0.0187 | 1.1 | 0.858 |
| combined p>=0.2 | 0.849 | 0.544 | 0.0252 | 1.5 | 0.549 |
| combined p>=0.3 | 0.638 | 0.286 | 0.0356 | 2.2 | 0.292 |
| combined p>=0.5 | 0.255 | 0.060 | 0.0661 | 4.1 | 0.063 |
| combined top-1 | 0.299 | 0.086 | 0.0545 | 3.4 | 0.089 |
| combined top-3 | 0.786 | 0.468 | 0.0270 | 1.7 | 0.473 |
| prior @ tuned thr 0.114 | 1.000 | 1.000 | 0.0163 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0163 | 1.0 | 1.000 |
| prior p>=0.2 | 0.971 | 0.980 | 0.0161 | 1.0 | 0.980 |
| prior p>=0.3 | 0.000 | 0.000 | n/a | n/a | 0.000 |
| prior p>=0.5 | 0.000 | 0.000 | n/a | n/a | 0.000 |
| prior top-1 | 0.962 | 0.964 | 0.0162 | 1.0 | 0.964 |
| prior top-3 | 1.000 | 1.000 | 0.0163 | 1.0 | 1.000 |

**substantive modules, after drivers**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 1.000 | 0.224 | 0.0588 | 4.3 | 0.234 |
| oracle: pair shares a file | 1.000 | 0.062 | 0.1839 | 13.4 | 0.075 |
| combined @ tuned thr 0.196 | 0.855 | 0.557 | 0.0210 | 1.5 | 0.561 |
| combined p>=0.1 | 0.984 | 0.856 | 0.0158 | 1.1 | 0.858 |
| combined p>=0.2 | 0.850 | 0.545 | 0.0213 | 1.5 | 0.549 |
| combined p>=0.3 | 0.636 | 0.287 | 0.0301 | 2.2 | 0.292 |
| combined p>=0.5 | 0.265 | 0.060 | 0.0583 | 4.2 | 0.063 |
| combined top-1 | 0.330 | 0.086 | 0.0509 | 3.7 | 0.089 |
| combined top-3 | 0.830 | 0.468 | 0.0242 | 1.8 | 0.473 |
| prior @ tuned thr 0.114 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |
| prior p>=0.2 | 0.967 | 0.980 | 0.0136 | 1.0 | 0.980 |
| prior p>=0.3 | 0.000 | 0.000 | n/a | n/a | 0.000 |
| prior p>=0.5 | 0.000 | 0.000 | n/a | n/a | 0.000 |
| prior top-1 | 0.967 | 0.964 | 0.0138 | 1.0 | 0.964 |
| prior top-3 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |

