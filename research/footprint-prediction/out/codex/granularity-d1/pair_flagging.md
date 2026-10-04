### Pair flagging (step 1 pairs)

pairs with both changes in the evaluation slice: 53083 tested pairs (863 conflict, 52220 clean; 731 conflict after merge drivers). Excluded and only counted: 11118 entangled, 0 error. Base conflict rate 0.0163 (0.0138 after drivers). A pair is flagged when the predicted module sets intersect.

**all modules, raw**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 1.000 | 0.292 | 0.0536 | 3.3 | 0.303 |
| oracle: pair shares a file | 1.000 | 0.060 | 0.2171 | 13.4 | 0.075 |
| combined @ tuned thr 0.213 | 0.959 | 0.735 | 0.0211 | 1.3 | 0.739 |
| combined p>=0.1 | 0.999 | 0.943 | 0.0172 | 1.1 | 0.944 |
| combined p>=0.2 | 0.968 | 0.768 | 0.0204 | 1.3 | 0.771 |
| combined p>=0.3 | 0.856 | 0.531 | 0.0260 | 1.6 | 0.536 |
| combined p>=0.5 | 0.512 | 0.209 | 0.0390 | 2.4 | 0.214 |
| combined top-1 | 0.612 | 0.320 | 0.0306 | 1.9 | 0.325 |
| combined top-3 | 0.933 | 0.787 | 0.0192 | 1.2 | 0.789 |
| prior @ tuned thr 0.146 | 1.000 | 1.000 | 0.0163 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0163 | 1.0 | 1.000 |
| prior p>=0.2 | 1.000 | 1.000 | 0.0163 | 1.0 | 1.000 |
| prior p>=0.3 | 1.000 | 1.000 | 0.0163 | 1.0 | 1.000 |
| prior p>=0.5 | 0.000 | 0.000 | n/a | n/a | 0.000 |
| prior top-1 | 0.988 | 0.980 | 0.0164 | 1.0 | 0.981 |
| prior top-3 | 1.000 | 1.000 | 0.0163 | 1.0 | 1.000 |

**all modules, after drivers**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 1.000 | 0.294 | 0.0454 | 3.3 | 0.303 |
| oracle: pair shares a file | 1.000 | 0.062 | 0.1839 | 13.4 | 0.075 |
| combined @ tuned thr 0.213 | 0.958 | 0.736 | 0.0178 | 1.3 | 0.739 |
| combined p>=0.1 | 0.999 | 0.943 | 0.0146 | 1.1 | 0.944 |
| combined p>=0.2 | 0.967 | 0.769 | 0.0173 | 1.3 | 0.771 |
| combined p>=0.3 | 0.852 | 0.532 | 0.0219 | 1.6 | 0.536 |
| combined p>=0.5 | 0.523 | 0.209 | 0.0337 | 2.4 | 0.214 |
| combined top-1 | 0.654 | 0.321 | 0.0277 | 2.0 | 0.325 |
| combined top-3 | 0.956 | 0.787 | 0.0167 | 1.2 | 0.789 |
| prior @ tuned thr 0.146 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |
| prior p>=0.2 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |
| prior p>=0.3 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |
| prior p>=0.5 | 0.000 | 0.000 | n/a | n/a | 0.000 |
| prior top-1 | 0.989 | 0.980 | 0.0139 | 1.0 | 0.981 |
| prior top-3 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |

**substantive modules, raw**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 1.000 | 0.292 | 0.0536 | 3.3 | 0.303 |
| oracle: pair shares a file | 1.000 | 0.060 | 0.2171 | 13.4 | 0.075 |
| combined @ tuned thr 0.213 | 0.959 | 0.735 | 0.0211 | 1.3 | 0.739 |
| combined p>=0.1 | 0.999 | 0.943 | 0.0172 | 1.1 | 0.944 |
| combined p>=0.2 | 0.968 | 0.768 | 0.0204 | 1.3 | 0.771 |
| combined p>=0.3 | 0.856 | 0.531 | 0.0260 | 1.6 | 0.536 |
| combined p>=0.5 | 0.512 | 0.209 | 0.0390 | 2.4 | 0.214 |
| combined top-1 | 0.612 | 0.320 | 0.0306 | 1.9 | 0.325 |
| combined top-3 | 0.933 | 0.787 | 0.0192 | 1.2 | 0.789 |
| prior @ tuned thr 0.146 | 1.000 | 1.000 | 0.0163 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0163 | 1.0 | 1.000 |
| prior p>=0.2 | 1.000 | 1.000 | 0.0163 | 1.0 | 1.000 |
| prior p>=0.3 | 1.000 | 1.000 | 0.0163 | 1.0 | 1.000 |
| prior p>=0.5 | 0.000 | 0.000 | n/a | n/a | 0.000 |
| prior top-1 | 0.988 | 0.980 | 0.0164 | 1.0 | 0.981 |
| prior top-3 | 1.000 | 1.000 | 0.0163 | 1.0 | 1.000 |

**substantive modules, after drivers**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 1.000 | 0.294 | 0.0454 | 3.3 | 0.303 |
| oracle: pair shares a file | 1.000 | 0.062 | 0.1839 | 13.4 | 0.075 |
| combined @ tuned thr 0.213 | 0.958 | 0.736 | 0.0178 | 1.3 | 0.739 |
| combined p>=0.1 | 0.999 | 0.943 | 0.0146 | 1.1 | 0.944 |
| combined p>=0.2 | 0.967 | 0.769 | 0.0173 | 1.3 | 0.771 |
| combined p>=0.3 | 0.852 | 0.532 | 0.0219 | 1.6 | 0.536 |
| combined p>=0.5 | 0.523 | 0.209 | 0.0337 | 2.4 | 0.214 |
| combined top-1 | 0.654 | 0.321 | 0.0277 | 2.0 | 0.325 |
| combined top-3 | 0.956 | 0.787 | 0.0167 | 1.2 | 0.789 |
| prior @ tuned thr 0.146 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |
| prior p>=0.2 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |
| prior p>=0.3 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |
| prior p>=0.5 | 0.000 | 0.000 | n/a | n/a | 0.000 |
| prior top-1 | 0.989 | 0.980 | 0.0139 | 1.0 | 0.981 |
| prior top-3 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |

