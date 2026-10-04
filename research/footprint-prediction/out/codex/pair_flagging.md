### Pair flagging (step 1 pairs)

pairs with both changes in the evaluation slice: 53083 tested pairs (863 conflict, 52220 clean; 731 conflict after merge drivers). Excluded and only counted: 11118 entangled, 0 error. Base conflict rate 0.0163 (0.0138 after drivers). A pair is flagged when the predicted module sets intersect.

**all modules, raw**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 1.000 | 0.330 | 0.0477 | 2.9 | 0.341 |
| oracle: pair shares a file | 1.000 | 0.060 | 0.2171 | 13.4 | 0.075 |
| combined @ tuned thr 0.243 | 0.874 | 0.530 | 0.0265 | 1.6 | 0.536 |
| combined p>=0.1 | 0.987 | 0.868 | 0.0184 | 1.1 | 0.870 |
| combined p>=0.2 | 0.920 | 0.631 | 0.0235 | 1.4 | 0.636 |
| combined p>=0.3 | 0.800 | 0.433 | 0.0296 | 1.8 | 0.439 |
| combined p>=0.5 | 0.512 | 0.166 | 0.0485 | 3.0 | 0.172 |
| combined top-1 | 0.604 | 0.297 | 0.0325 | 2.0 | 0.302 |
| combined top-3 | 0.968 | 0.825 | 0.0190 | 1.2 | 0.827 |
| prior @ tuned thr 0.132 | 1.000 | 1.000 | 0.0163 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0163 | 1.0 | 1.000 |
| prior p>=0.2 | 1.000 | 1.000 | 0.0163 | 1.0 | 1.000 |
| prior p>=0.3 | 1.000 | 1.000 | 0.0163 | 1.0 | 1.000 |
| prior p>=0.5 | 0.000 | 0.000 | n/a | n/a | 0.000 |
| prior top-1 | 1.000 | 1.000 | 0.0163 | 1.0 | 1.000 |
| prior top-3 | 1.000 | 1.000 | 0.0163 | 1.0 | 1.000 |

**all modules, after drivers**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 1.000 | 0.332 | 0.0404 | 2.9 | 0.341 |
| oracle: pair shares a file | 1.000 | 0.062 | 0.1839 | 13.4 | 0.075 |
| combined @ tuned thr 0.243 | 0.882 | 0.531 | 0.0227 | 1.6 | 0.536 |
| combined p>=0.1 | 0.986 | 0.869 | 0.0156 | 1.1 | 0.870 |
| combined p>=0.2 | 0.923 | 0.632 | 0.0200 | 1.5 | 0.636 |
| combined p>=0.3 | 0.813 | 0.434 | 0.0255 | 1.9 | 0.439 |
| combined p>=0.5 | 0.536 | 0.167 | 0.0430 | 3.1 | 0.172 |
| combined top-1 | 0.627 | 0.297 | 0.0286 | 2.1 | 0.302 |
| combined top-3 | 0.977 | 0.825 | 0.0163 | 1.2 | 0.827 |
| prior @ tuned thr 0.132 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |
| prior p>=0.2 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |
| prior p>=0.3 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |
| prior p>=0.5 | 0.000 | 0.000 | n/a | n/a | 0.000 |
| prior top-1 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |
| prior top-3 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |

