### Pair flagging (step 1 pairs)

pairs with both changes in the evaluation slice: 53083 tested pairs (863 conflict, 52220 clean; 731 conflict after merge drivers). Excluded and only counted: 11118 entangled, 0 error. Base conflict rate 0.0163 (0.0138 after drivers). A pair is flagged when the predicted module sets intersect.

**all modules, raw**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 1.000 | 0.215 | 0.0713 | 4.4 | 0.228 |
| oracle: pair shares a file | 1.000 | 0.060 | 0.2171 | 13.4 | 0.075 |
| combined @ tuned thr 0.171 | 0.907 | 0.605 | 0.0242 | 1.5 | 0.610 |
| combined p>=0.1 | 0.983 | 0.847 | 0.0188 | 1.2 | 0.849 |
| combined p>=0.2 | 0.839 | 0.512 | 0.0264 | 1.6 | 0.517 |
| combined p>=0.3 | 0.598 | 0.258 | 0.0369 | 2.3 | 0.264 |
| combined p>=0.5 | 0.211 | 0.046 | 0.0710 | 4.4 | 0.048 |
| combined top-1 | 0.317 | 0.108 | 0.0463 | 2.8 | 0.112 |
| combined top-3 | 0.803 | 0.490 | 0.0264 | 1.6 | 0.495 |
| prior @ tuned thr 0.101 | 1.000 | 1.000 | 0.0163 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0163 | 1.0 | 1.000 |
| prior p>=0.2 | 1.000 | 1.000 | 0.0163 | 1.0 | 1.000 |
| prior p>=0.3 | 0.000 | 0.000 | n/a | n/a | 0.000 |
| prior p>=0.5 | 0.000 | 0.000 | n/a | n/a | 0.000 |
| prior top-1 | 0.983 | 0.982 | 0.0163 | 1.0 | 0.982 |
| prior top-3 | 1.000 | 1.000 | 0.0163 | 1.0 | 1.000 |

**all modules, after drivers**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 1.000 | 0.217 | 0.0604 | 4.4 | 0.228 |
| oracle: pair shares a file | 1.000 | 0.062 | 0.1839 | 13.4 | 0.075 |
| combined @ tuned thr 0.171 | 0.904 | 0.606 | 0.0204 | 1.5 | 0.610 |
| combined p>=0.1 | 0.981 | 0.847 | 0.0159 | 1.2 | 0.849 |
| combined p>=0.2 | 0.841 | 0.513 | 0.0224 | 1.6 | 0.517 |
| combined p>=0.3 | 0.601 | 0.259 | 0.0314 | 2.3 | 0.264 |
| combined p>=0.5 | 0.224 | 0.046 | 0.0640 | 4.6 | 0.048 |
| combined top-1 | 0.343 | 0.108 | 0.0424 | 3.1 | 0.112 |
| combined top-3 | 0.840 | 0.490 | 0.0234 | 1.7 | 0.495 |
| prior @ tuned thr 0.101 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |
| prior p>=0.2 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |
| prior p>=0.3 | 0.000 | 0.000 | n/a | n/a | 0.000 |
| prior p>=0.5 | 0.000 | 0.000 | n/a | n/a | 0.000 |
| prior top-1 | 0.982 | 0.982 | 0.0138 | 1.0 | 0.982 |
| prior top-3 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |

**substantive modules, raw**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 0.992 | 0.215 | 0.0709 | 4.4 | 0.227 |
| oracle: pair shares a file | 1.000 | 0.060 | 0.2171 | 13.4 | 0.075 |
| combined @ tuned thr 0.171 | 0.907 | 0.605 | 0.0242 | 1.5 | 0.609 |
| combined p>=0.1 | 0.983 | 0.846 | 0.0188 | 1.2 | 0.849 |
| combined p>=0.2 | 0.839 | 0.512 | 0.0264 | 1.6 | 0.517 |
| combined p>=0.3 | 0.598 | 0.258 | 0.0369 | 2.3 | 0.264 |
| combined p>=0.5 | 0.211 | 0.046 | 0.0710 | 4.4 | 0.048 |
| combined top-1 | 0.316 | 0.108 | 0.0460 | 2.8 | 0.112 |
| combined top-3 | 0.806 | 0.498 | 0.0261 | 1.6 | 0.503 |
| prior @ tuned thr 0.101 | 1.000 | 1.000 | 0.0163 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0163 | 1.0 | 1.000 |
| prior p>=0.2 | 1.000 | 1.000 | 0.0163 | 1.0 | 1.000 |
| prior p>=0.3 | 0.000 | 0.000 | n/a | n/a | 0.000 |
| prior p>=0.5 | 0.000 | 0.000 | n/a | n/a | 0.000 |
| prior top-1 | 0.983 | 0.982 | 0.0163 | 1.0 | 0.982 |
| prior top-3 | 1.000 | 1.000 | 0.0163 | 1.0 | 1.000 |

**substantive modules, after drivers**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 1.000 | 0.216 | 0.0606 | 4.4 | 0.227 |
| oracle: pair shares a file | 1.000 | 0.062 | 0.1839 | 13.4 | 0.075 |
| combined @ tuned thr 0.171 | 0.904 | 0.605 | 0.0204 | 1.5 | 0.609 |
| combined p>=0.1 | 0.981 | 0.847 | 0.0159 | 1.2 | 0.849 |
| combined p>=0.2 | 0.841 | 0.513 | 0.0224 | 1.6 | 0.517 |
| combined p>=0.3 | 0.601 | 0.259 | 0.0314 | 2.3 | 0.264 |
| combined p>=0.5 | 0.224 | 0.046 | 0.0640 | 4.6 | 0.048 |
| combined top-1 | 0.342 | 0.109 | 0.0421 | 3.1 | 0.112 |
| combined top-3 | 0.844 | 0.498 | 0.0231 | 1.7 | 0.503 |
| prior @ tuned thr 0.101 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |
| prior p>=0.2 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |
| prior p>=0.3 | 0.000 | 0.000 | n/a | n/a | 0.000 |
| prior p>=0.5 | 0.000 | 0.000 | n/a | n/a | 0.000 |
| prior top-1 | 0.982 | 0.982 | 0.0138 | 1.0 | 0.982 |
| prior top-3 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |

