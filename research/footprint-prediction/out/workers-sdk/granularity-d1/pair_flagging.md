### Pair flagging (step 1 pairs)

pairs with both changes in the evaluation slice: 10302 tested pairs (126 conflict, 10176 clean; 117 conflict after merge drivers). Excluded and only counted: 1725 entangled, 0 error. Base conflict rate 0.0122 (0.0114 after drivers). A pair is flagged when the predicted module sets intersect.

**all modules, raw**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 1.000 | 0.700 | 0.0174 | 1.4 | 0.704 |
| oracle: pair shares a file | 1.000 | 0.044 | 0.2188 | 17.9 | 0.056 |
| combined @ tuned thr 0.205 | 0.968 | 0.968 | 0.0122 | 1.0 | 0.968 |
| combined p>=0.1 | 0.968 | 0.982 | 0.0121 | 1.0 | 0.982 |
| combined p>=0.2 | 0.968 | 0.968 | 0.0122 | 1.0 | 0.968 |
| combined p>=0.3 | 0.960 | 0.953 | 0.0123 | 1.0 | 0.953 |
| combined p>=0.5 | 0.897 | 0.860 | 0.0128 | 1.0 | 0.860 |
| combined top-1 | 0.698 | 0.557 | 0.0153 | 1.3 | 0.558 |
| combined top-3 | 0.960 | 0.984 | 0.0119 | 1.0 | 0.984 |
| prior @ tuned thr 0.215 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.2 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.3 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.5 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior top-1 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior top-3 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |

**all modules, after drivers**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 1.000 | 0.701 | 0.0161 | 1.4 | 0.704 |
| oracle: pair shares a file | 1.000 | 0.045 | 0.2031 | 17.9 | 0.056 |
| combined @ tuned thr 0.205 | 0.966 | 0.968 | 0.0113 | 1.0 | 0.968 |
| combined p>=0.1 | 0.966 | 0.982 | 0.0112 | 1.0 | 0.982 |
| combined p>=0.2 | 0.966 | 0.968 | 0.0113 | 1.0 | 0.968 |
| combined p>=0.3 | 0.957 | 0.953 | 0.0114 | 1.0 | 0.953 |
| combined p>=0.5 | 0.915 | 0.859 | 0.0121 | 1.1 | 0.860 |
| combined top-1 | 0.701 | 0.557 | 0.0143 | 1.3 | 0.558 |
| combined top-3 | 0.957 | 0.984 | 0.0111 | 1.0 | 0.984 |
| prior @ tuned thr 0.215 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.2 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.3 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.5 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior top-1 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior top-3 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |

**substantive modules, raw**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 0.984 | 0.294 | 0.0399 | 3.3 | 0.302 |
| oracle: pair shares a file | 1.000 | 0.044 | 0.2188 | 17.9 | 0.056 |
| combined @ tuned thr 0.205 | 0.921 | 0.829 | 0.0136 | 1.1 | 0.830 |
| combined p>=0.1 | 0.968 | 0.938 | 0.0126 | 1.0 | 0.938 |
| combined p>=0.2 | 0.929 | 0.837 | 0.0135 | 1.1 | 0.838 |
| combined p>=0.3 | 0.905 | 0.731 | 0.0151 | 1.2 | 0.733 |
| combined p>=0.5 | 0.738 | 0.527 | 0.0170 | 1.4 | 0.530 |
| combined top-1 | 0.738 | 0.532 | 0.0169 | 1.4 | 0.535 |
| combined top-3 | 0.952 | 0.887 | 0.0131 | 1.1 | 0.888 |
| prior @ tuned thr 0.215 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.2 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.3 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.5 | 0.730 | 0.754 | 0.0118 | 1.0 | 0.754 |
| prior top-1 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior top-3 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |

**substantive modules, after drivers**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 1.000 | 0.294 | 0.0376 | 3.3 | 0.302 |
| oracle: pair shares a file | 1.000 | 0.045 | 0.2031 | 17.9 | 0.056 |
| combined @ tuned thr 0.205 | 0.940 | 0.828 | 0.0129 | 1.1 | 0.830 |
| combined p>=0.1 | 0.966 | 0.938 | 0.0117 | 1.0 | 0.938 |
| combined p>=0.2 | 0.949 | 0.837 | 0.0129 | 1.1 | 0.838 |
| combined p>=0.3 | 0.923 | 0.731 | 0.0143 | 1.3 | 0.733 |
| combined p>=0.5 | 0.744 | 0.527 | 0.0159 | 1.4 | 0.530 |
| combined top-1 | 0.735 | 0.532 | 0.0156 | 1.4 | 0.535 |
| combined top-3 | 0.957 | 0.887 | 0.0122 | 1.1 | 0.888 |
| prior @ tuned thr 0.215 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.2 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.3 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.5 | 0.726 | 0.754 | 0.0109 | 1.0 | 0.754 |
| prior top-1 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior top-3 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |

