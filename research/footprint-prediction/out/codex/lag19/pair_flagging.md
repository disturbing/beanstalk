### Pair flagging (step 1 pairs)

pairs with both changes in the evaluation slice: 53083 tested pairs (863 conflict, 52220 clean; 731 conflict after merge drivers). Excluded and only counted: 11118 entangled, 0 error. Base conflict rate 0.0163 (0.0138 after drivers). A pair is flagged when the predicted module sets intersect.

**all modules, raw**

| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |
|---|---|---|---|---|---|
| oracle: actual modules intersect | 1.000 | 0.330 | 0.0477 | 2.9 | 0.341 |
| oracle: pair shares a file | 1.000 | 0.060 | 0.2171 | 13.4 | 0.075 |
| combined @ tuned thr 0.242 | 0.926 | 0.697 | 0.0215 | 1.3 | 0.700 |
| combined p>=0.1 | 1.000 | 0.953 | 0.0170 | 1.0 | 0.954 |
| combined p>=0.2 | 0.956 | 0.787 | 0.0197 | 1.2 | 0.790 |
| combined p>=0.3 | 0.863 | 0.560 | 0.0249 | 1.5 | 0.565 |
| combined p>=0.5 | 0.530 | 0.223 | 0.0377 | 2.3 | 0.228 |
| combined top-1 | 0.622 | 0.305 | 0.0326 | 2.0 | 0.310 |
| combined top-3 | 0.977 | 0.870 | 0.0182 | 1.1 | 0.872 |
| prior @ tuned thr 0.167 | 1.000 | 1.000 | 0.0163 | 1.0 | 1.000 |
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
| combined @ tuned thr 0.242 | 0.925 | 0.697 | 0.0182 | 1.3 | 0.700 |
| combined p>=0.1 | 1.000 | 0.953 | 0.0144 | 1.0 | 0.954 |
| combined p>=0.2 | 0.953 | 0.788 | 0.0166 | 1.2 | 0.790 |
| combined p>=0.3 | 0.860 | 0.561 | 0.0210 | 1.5 | 0.565 |
| combined p>=0.5 | 0.536 | 0.224 | 0.0324 | 2.4 | 0.228 |
| combined top-1 | 0.666 | 0.305 | 0.0296 | 2.1 | 0.310 |
| combined top-3 | 0.981 | 0.871 | 0.0155 | 1.1 | 0.872 |
| prior @ tuned thr 0.167 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |
| prior p>=0.1 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |
| prior p>=0.2 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |
| prior p>=0.3 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |
| prior p>=0.5 | 0.000 | 0.000 | n/a | n/a | 0.000 |
| prior top-1 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |
| prior top-3 | 1.000 | 1.000 | 0.0138 | 1.0 | 1.000 |

