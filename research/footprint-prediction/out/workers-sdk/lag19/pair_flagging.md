### Pair flagging (step 1 pairs)

pairs with both changes in the evaluation slice: 10302 tested pairs (126 conflict, 10176 clean; 117 conflict after merge drivers). Excluded and only counted: 1725 entangled, 0 error. Base conflict rate 0.0122 (0.0114 after drivers). A pair is flagged when the predicted module sets intersect.

**all modules, raw**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 1.000 | 0.737 | 0.0165 | 1.4 | 0.740 |
| oracle: pair shares a file | 1.000 | 0.044 | 0.2188 | 17.9 | 0.056 |
| combined @ tuned thr 0.412 | 0.944 | 0.920 | 0.0125 | 1.0 | 0.921 |
| combined p>=0.1 | 0.976 | 0.983 | 0.0121 | 1.0 | 0.983 |
| combined p>=0.2 | 0.976 | 0.968 | 0.0123 | 1.0 | 0.968 |
| combined p>=0.3 | 0.976 | 0.955 | 0.0125 | 1.0 | 0.955 |
| combined p>=0.5 | 0.921 | 0.875 | 0.0129 | 1.1 | 0.876 |
| combined top-1 | 0.659 | 0.546 | 0.0147 | 1.2 | 0.547 |
| combined top-3 | 0.976 | 0.988 | 0.0121 | 1.0 | 0.988 |
| prior @ tuned thr 0.319 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.2 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.3 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.5 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior top-1 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior top-3 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |

**all modules, after drivers**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 1.000 | 0.737 | 0.0154 | 1.4 | 0.740 |
| oracle: pair shares a file | 1.000 | 0.045 | 0.2031 | 17.9 | 0.056 |
| combined @ tuned thr 0.412 | 0.949 | 0.920 | 0.0117 | 1.0 | 0.921 |
| combined p>=0.1 | 0.974 | 0.983 | 0.0113 | 1.0 | 0.983 |
| combined p>=0.2 | 0.974 | 0.968 | 0.0114 | 1.0 | 0.968 |
| combined p>=0.3 | 0.974 | 0.955 | 0.0116 | 1.0 | 0.955 |
| combined p>=0.5 | 0.932 | 0.875 | 0.0121 | 1.1 | 0.876 |
| combined top-1 | 0.650 | 0.546 | 0.0135 | 1.2 | 0.547 |
| combined top-3 | 0.974 | 0.988 | 0.0112 | 1.0 | 0.988 |
| prior @ tuned thr 0.319 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.2 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.3 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.5 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior top-1 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior top-3 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |

**substantive modules, raw**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 0.992 | 0.358 | 0.0332 | 2.7 | 0.366 |
| oracle: pair shares a file | 1.000 | 0.044 | 0.2188 | 17.9 | 0.056 |
| combined @ tuned thr 0.412 | 0.881 | 0.702 | 0.0153 | 1.3 | 0.705 |
| combined p>=0.1 | 0.976 | 0.968 | 0.0123 | 1.0 | 0.968 |
| combined p>=0.2 | 0.976 | 0.898 | 0.0133 | 1.1 | 0.899 |
| combined p>=0.3 | 0.937 | 0.813 | 0.0141 | 1.1 | 0.815 |
| combined p>=0.5 | 0.810 | 0.617 | 0.0160 | 1.3 | 0.619 |
| combined top-1 | 0.770 | 0.555 | 0.0169 | 1.4 | 0.558 |
| combined top-3 | 0.976 | 0.964 | 0.0124 | 1.0 | 0.964 |
| prior @ tuned thr 0.319 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.2 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.3 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.5 | 0.746 | 0.801 | 0.0114 | 0.9 | 0.800 |
| prior top-1 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior top-3 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |

**substantive modules, after drivers**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 1.000 | 0.359 | 0.0310 | 2.7 | 0.366 |
| oracle: pair shares a file | 1.000 | 0.045 | 0.2031 | 17.9 | 0.056 |
| combined @ tuned thr 0.412 | 0.897 | 0.702 | 0.0145 | 1.3 | 0.705 |
| combined p>=0.1 | 0.974 | 0.968 | 0.0114 | 1.0 | 0.968 |
| combined p>=0.2 | 0.974 | 0.898 | 0.0123 | 1.1 | 0.899 |
| combined p>=0.3 | 0.957 | 0.813 | 0.0133 | 1.2 | 0.815 |
| combined p>=0.5 | 0.821 | 0.617 | 0.0151 | 1.3 | 0.619 |
| combined top-1 | 0.778 | 0.555 | 0.0158 | 1.4 | 0.558 |
| combined top-3 | 0.974 | 0.964 | 0.0115 | 1.0 | 0.964 |
| prior @ tuned thr 0.319 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.2 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.3 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.5 | 0.744 | 0.801 | 0.0106 | 0.9 | 0.800 |
| prior top-1 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior top-3 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |

