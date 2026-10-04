### Pair flagging (step 1 pairs)

pairs with both changes in the evaluation slice: 10302 tested pairs (126 conflict, 10176 clean; 117 conflict after merge drivers). Excluded and only counted: 1725 entangled, 0 error. Base conflict rate 0.0122 (0.0114 after drivers). A pair is flagged when the predicted module sets intersect.

**all modules, raw**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 1.000 | 0.737 | 0.0165 | 1.4 | 0.740 |
| oracle: pair shares a file | 1.000 | 0.044 | 0.2188 | 17.9 | 0.056 |
| combined @ tuned thr 0.416 | 0.929 | 0.903 | 0.0126 | 1.0 | 0.904 |
| combined p>=0.1 | 0.976 | 0.984 | 0.0121 | 1.0 | 0.984 |
| combined p>=0.2 | 0.968 | 0.956 | 0.0124 | 1.0 | 0.956 |
| combined p>=0.3 | 0.952 | 0.939 | 0.0124 | 1.0 | 0.940 |
| combined p>=0.5 | 0.889 | 0.851 | 0.0128 | 1.0 | 0.852 |
| combined top-1 | 0.524 | 0.444 | 0.0144 | 1.2 | 0.445 |
| combined top-3 | 0.976 | 0.987 | 0.0121 | 1.0 | 0.986 |
| prior @ tuned thr 0.260 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
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
| combined @ tuned thr 0.416 | 0.940 | 0.903 | 0.0118 | 1.0 | 0.904 |
| combined p>=0.1 | 0.974 | 0.984 | 0.0112 | 1.0 | 0.984 |
| combined p>=0.2 | 0.974 | 0.956 | 0.0116 | 1.0 | 0.956 |
| combined p>=0.3 | 0.957 | 0.939 | 0.0116 | 1.0 | 0.940 |
| combined p>=0.5 | 0.906 | 0.851 | 0.0121 | 1.1 | 0.852 |
| combined top-1 | 0.513 | 0.444 | 0.0131 | 1.2 | 0.445 |
| combined top-3 | 0.974 | 0.987 | 0.0112 | 1.0 | 0.986 |
| prior @ tuned thr 0.260 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
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
| combined @ tuned thr 0.416 | 0.865 | 0.665 | 0.0159 | 1.3 | 0.667 |
| combined p>=0.1 | 0.976 | 0.959 | 0.0124 | 1.0 | 0.959 |
| combined p>=0.2 | 0.937 | 0.865 | 0.0132 | 1.1 | 0.866 |
| combined p>=0.3 | 0.897 | 0.787 | 0.0139 | 1.1 | 0.788 |
| combined p>=0.5 | 0.817 | 0.588 | 0.0169 | 1.4 | 0.591 |
| combined top-1 | 0.786 | 0.500 | 0.0191 | 1.6 | 0.503 |
| combined top-3 | 0.968 | 0.954 | 0.0124 | 1.0 | 0.954 |
| prior @ tuned thr 0.260 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.2 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.3 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.5 | 0.833 | 0.838 | 0.0122 | 1.0 | 0.838 |
| prior top-1 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior top-3 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |

**substantive modules, after drivers**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 1.000 | 0.359 | 0.0310 | 2.7 | 0.366 |
| oracle: pair shares a file | 1.000 | 0.045 | 0.2031 | 17.9 | 0.056 |
| combined @ tuned thr 0.416 | 0.880 | 0.665 | 0.0150 | 1.3 | 0.667 |
| combined p>=0.1 | 0.974 | 0.959 | 0.0115 | 1.0 | 0.959 |
| combined p>=0.2 | 0.957 | 0.865 | 0.0126 | 1.1 | 0.866 |
| combined p>=0.3 | 0.915 | 0.787 | 0.0132 | 1.2 | 0.788 |
| combined p>=0.5 | 0.838 | 0.588 | 0.0161 | 1.4 | 0.591 |
| combined top-1 | 0.795 | 0.500 | 0.0179 | 1.6 | 0.503 |
| combined top-3 | 0.974 | 0.954 | 0.0116 | 1.0 | 0.954 |
| prior @ tuned thr 0.260 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.2 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.3 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.5 | 0.846 | 0.838 | 0.0115 | 1.0 | 0.838 |
| prior top-1 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior top-3 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |

