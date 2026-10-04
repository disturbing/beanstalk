### Pair flagging (step 1 pairs)

pairs with both changes in the evaluation slice: 10302 tested pairs (126 conflict, 10176 clean; 117 conflict after merge drivers). Excluded and only counted: 1725 entangled, 0 error. Base conflict rate 0.0122 (0.0114 after drivers). A pair is flagged when the predicted module sets intersect.

**all modules, raw**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 1.000 | 0.679 | 0.0179 | 1.5 | 0.683 |
| oracle: pair shares a file | 1.000 | 0.044 | 0.2188 | 17.9 | 0.056 |
| combined @ tuned thr 0.166 | 0.960 | 0.969 | 0.0121 | 1.0 | 0.969 |
| combined p>=0.1 | 0.968 | 0.979 | 0.0121 | 1.0 | 0.979 |
| combined p>=0.2 | 0.960 | 0.951 | 0.0124 | 1.0 | 0.951 |
| combined p>=0.3 | 0.952 | 0.924 | 0.0126 | 1.0 | 0.925 |
| combined p>=0.5 | 0.905 | 0.841 | 0.0131 | 1.1 | 0.842 |
| combined top-1 | 0.873 | 0.846 | 0.0126 | 1.0 | 0.846 |
| combined top-3 | 0.984 | 0.988 | 0.0122 | 1.0 | 0.988 |
| prior @ tuned thr 0.139 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.2 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.3 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.5 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior top-1 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior top-3 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |

**all modules, after drivers**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 1.000 | 0.680 | 0.0166 | 1.5 | 0.683 |
| oracle: pair shares a file | 1.000 | 0.045 | 0.2031 | 17.9 | 0.056 |
| combined @ tuned thr 0.166 | 0.957 | 0.969 | 0.0112 | 1.0 | 0.969 |
| combined p>=0.1 | 0.966 | 0.979 | 0.0112 | 1.0 | 0.979 |
| combined p>=0.2 | 0.957 | 0.951 | 0.0114 | 1.0 | 0.951 |
| combined p>=0.3 | 0.949 | 0.924 | 0.0117 | 1.0 | 0.925 |
| combined p>=0.5 | 0.915 | 0.841 | 0.0123 | 1.1 | 0.842 |
| combined top-1 | 0.880 | 0.846 | 0.0118 | 1.0 | 0.846 |
| combined top-3 | 0.983 | 0.988 | 0.0113 | 1.0 | 0.988 |
| prior @ tuned thr 0.139 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.2 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.3 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.5 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior top-1 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior top-3 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |

**substantive modules, raw**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 0.984 | 0.136 | 0.0825 | 6.7 | 0.146 |
| oracle: pair shares a file | 1.000 | 0.044 | 0.2188 | 17.9 | 0.056 |
| combined @ tuned thr 0.166 | 0.730 | 0.377 | 0.0234 | 1.9 | 0.381 |
| combined p>=0.1 | 0.810 | 0.583 | 0.0169 | 1.4 | 0.585 |
| combined p>=0.2 | 0.706 | 0.309 | 0.0276 | 2.3 | 0.313 |
| combined p>=0.3 | 0.516 | 0.186 | 0.0332 | 2.7 | 0.190 |
| combined p>=0.5 | 0.341 | 0.068 | 0.0587 | 4.8 | 0.071 |
| combined top-1 | 0.381 | 0.157 | 0.0292 | 2.4 | 0.160 |
| combined top-3 | 0.754 | 0.458 | 0.0200 | 1.6 | 0.461 |
| prior @ tuned thr 0.139 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.2 | 0.762 | 0.733 | 0.0127 | 1.0 | 0.734 |
| prior p>=0.3 | 0.532 | 0.481 | 0.0135 | 1.1 | 0.482 |
| prior p>=0.5 | 0.000 | 0.000 | n/a | n/a | 0.000 |
| prior top-1 | 0.944 | 0.921 | 0.0125 | 1.0 | 0.921 |
| prior top-3 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |

**substantive modules, after drivers**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 1.000 | 0.136 | 0.0778 | 6.9 | 0.146 |
| oracle: pair shares a file | 1.000 | 0.045 | 0.2031 | 17.9 | 0.056 |
| combined @ tuned thr 0.166 | 0.744 | 0.377 | 0.0222 | 2.0 | 0.381 |
| combined p>=0.1 | 0.803 | 0.583 | 0.0156 | 1.4 | 0.585 |
| combined p>=0.2 | 0.718 | 0.309 | 0.0260 | 2.3 | 0.313 |
| combined p>=0.3 | 0.538 | 0.186 | 0.0322 | 2.8 | 0.190 |
| combined p>=0.5 | 0.350 | 0.068 | 0.0559 | 4.9 | 0.071 |
| combined top-1 | 0.393 | 0.157 | 0.0280 | 2.5 | 0.160 |
| combined top-3 | 0.761 | 0.458 | 0.0187 | 1.6 | 0.461 |
| prior @ tuned thr 0.139 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.2 | 0.761 | 0.733 | 0.0118 | 1.0 | 0.734 |
| prior p>=0.3 | 0.530 | 0.481 | 0.0125 | 1.1 | 0.482 |
| prior p>=0.5 | 0.000 | 0.000 | n/a | n/a | 0.000 |
| prior top-1 | 0.949 | 0.921 | 0.0117 | 1.0 | 0.921 |
| prior top-3 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |

