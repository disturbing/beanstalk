### Pair flagging (step 1 pairs)

pairs with both changes in the evaluation slice: 10302 tested pairs (126 conflict, 10176 clean; 117 conflict after merge drivers). Excluded and only counted: 1725 entangled, 0 error. Base conflict rate 0.0122 (0.0114 after drivers). A pair is flagged when the predicted module sets intersect.

**all modules, raw**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 1.000 | 0.693 | 0.0176 | 1.4 | 0.696 |
| oracle: pair shares a file | 1.000 | 0.044 | 0.2188 | 17.9 | 0.056 |
| combined @ tuned thr 0.168 | 0.968 | 0.978 | 0.0121 | 1.0 | 0.978 |
| combined p>=0.1 | 0.968 | 0.986 | 0.0120 | 1.0 | 0.985 |
| combined p>=0.2 | 0.968 | 0.969 | 0.0122 | 1.0 | 0.969 |
| combined p>=0.3 | 0.968 | 0.955 | 0.0124 | 1.0 | 0.956 |
| combined p>=0.5 | 0.913 | 0.859 | 0.0130 | 1.1 | 0.860 |
| combined top-1 | 0.770 | 0.704 | 0.0134 | 1.1 | 0.705 |
| combined top-3 | 0.968 | 0.984 | 0.0120 | 1.0 | 0.984 |
| prior @ tuned thr 0.142 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.2 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.3 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.5 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior top-1 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior top-3 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |

**all modules, after drivers**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 1.000 | 0.693 | 0.0163 | 1.4 | 0.696 |
| oracle: pair shares a file | 1.000 | 0.045 | 0.2031 | 17.9 | 0.056 |
| combined @ tuned thr 0.168 | 0.966 | 0.978 | 0.0112 | 1.0 | 0.978 |
| combined p>=0.1 | 0.966 | 0.986 | 0.0111 | 1.0 | 0.985 |
| combined p>=0.2 | 0.966 | 0.969 | 0.0113 | 1.0 | 0.969 |
| combined p>=0.3 | 0.966 | 0.955 | 0.0115 | 1.0 | 0.956 |
| combined p>=0.5 | 0.915 | 0.859 | 0.0121 | 1.1 | 0.860 |
| combined top-1 | 0.761 | 0.704 | 0.0123 | 1.1 | 0.705 |
| combined top-3 | 0.966 | 0.984 | 0.0111 | 1.0 | 0.984 |
| prior @ tuned thr 0.142 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.2 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.3 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.5 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior top-1 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior top-3 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |

**substantive modules, raw**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 0.984 | 0.239 | 0.0485 | 4.0 | 0.248 |
| oracle: pair shares a file | 1.000 | 0.044 | 0.2188 | 17.9 | 0.056 |
| combined @ tuned thr 0.168 | 0.937 | 0.804 | 0.0142 | 1.2 | 0.805 |
| combined p>=0.1 | 0.968 | 0.911 | 0.0130 | 1.1 | 0.912 |
| combined p>=0.2 | 0.937 | 0.758 | 0.0151 | 1.2 | 0.760 |
| combined p>=0.3 | 0.865 | 0.611 | 0.0172 | 1.4 | 0.614 |
| combined p>=0.5 | 0.667 | 0.444 | 0.0183 | 1.5 | 0.447 |
| combined top-1 | 0.690 | 0.495 | 0.0170 | 1.4 | 0.498 |
| combined top-3 | 0.905 | 0.761 | 0.0145 | 1.2 | 0.763 |
| prior @ tuned thr 0.142 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.2 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.3 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior p>=0.5 | 0.929 | 0.926 | 0.0123 | 1.0 | 0.927 |
| prior top-1 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |
| prior top-3 | 1.000 | 1.000 | 0.0122 | 1.0 | 1.000 |

**substantive modules, after drivers**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 1.000 | 0.239 | 0.0458 | 4.0 | 0.248 |
| oracle: pair shares a file | 1.000 | 0.045 | 0.2031 | 17.9 | 0.056 |
| combined @ tuned thr 0.168 | 0.940 | 0.804 | 0.0133 | 1.2 | 0.805 |
| combined p>=0.1 | 0.966 | 0.911 | 0.0120 | 1.1 | 0.912 |
| combined p>=0.2 | 0.940 | 0.758 | 0.0141 | 1.2 | 0.760 |
| combined p>=0.3 | 0.880 | 0.611 | 0.0163 | 1.4 | 0.614 |
| combined p>=0.5 | 0.675 | 0.444 | 0.0172 | 1.5 | 0.447 |
| combined top-1 | 0.701 | 0.495 | 0.0160 | 1.4 | 0.498 |
| combined top-3 | 0.906 | 0.761 | 0.0135 | 1.2 | 0.763 |
| prior @ tuned thr 0.142 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.2 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.3 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior p>=0.5 | 0.923 | 0.927 | 0.0113 | 1.0 | 0.927 |
| prior top-1 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |
| prior top-3 | 1.000 | 1.000 | 0.0114 | 1.0 | 1.000 |

