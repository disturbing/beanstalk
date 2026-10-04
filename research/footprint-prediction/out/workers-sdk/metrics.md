# Footprint prediction: workers-sdk

Changes: 1286: burn-in 128 (history only), tuning 515, evaluation 643 (the last 50% by merge order). Thresholds, top-k, calibration and blend weights are fitted on the tuning slice only. P / R / F1 are micro-averaged over (change, module) pairs at the threshold that maximises F1 on the tuning slice; R@k is the share of actual modules found in the top k; hit@1 is the share of changes whose top-1 module is touched.

### Title only (headline), all modules

| method | thr | P | R | F1 | per-change P/R/F1 | top-k (k) P/R/F1 | R@1 | R@3 | R@5 | hit@1 | avg pred |
|---|---|---|---|---|---|---|---|---|---|---|---|
| prior | 0.260 | 0.666 | 0.453 | 0.540 | 0.67/0.51/0.55 | (2) 0.67/0.45/0.54 | 0.274 | 0.517 | 0.619 | 0.81 | 2.0 |
| lexical | 0.133 | 0.315 | 0.353 | 0.333 | 0.36/0.42/0.34 | (2) 0.45/0.30/0.36 | 0.191 | 0.355 | 0.413 | 0.56 | 3.3 |
| knn | 0.342 | 0.729 | 0.581 | 0.646 | 0.74/0.67/0.67 | (2) 0.76/0.51/0.61 | 0.288 | 0.635 | 0.741 | 0.85 | 2.3 |
| cochange | 0.333 | 0.830 | 0.448 | 0.582 | 0.62/0.56/0.56 | (2) 0.80/0.47/0.59 | 0.242 | 0.543 | 0.619 | 0.71 | 1.6 |
| combined | 0.416 | 0.759 | 0.581 | 0.658 | 0.75/0.69/0.67 | (2) 0.78/0.53/0.63 | 0.285 | 0.653 | 0.760 | 0.84 | 2.3 |

### Does text add anything over the prior? (title only, all modules)

Difference to the `prior` baseline (top modules by recent frequency, no text), 95% interval from a block bootstrap over evaluation changes. An interval that excludes 0 means the method adds something over the prior.

| method | dF1 | dR@1 | dR@3 | dR@5 |
|---|---|---|---|---|
| lexical | -0.206 [-0.229, -0.182] | -0.083 [-0.110, -0.063] | -0.162 [-0.184, -0.141] | -0.206 [-0.229, -0.180] |
| knn | +0.107 [+0.093, +0.123] | +0.013 [+0.007, +0.021] | +0.117 [+0.100, +0.140] | +0.123 [+0.105, +0.144] |
| cochange | +0.042 [+0.016, +0.073] | -0.032 [-0.047, -0.011] | +0.025 [-0.005, +0.063] | +0.000 [-0.030, +0.035] |
| combined | +0.118 [+0.100, +0.138] | +0.010 [+0.001, +0.018] | +0.136 [+0.120, +0.157] | +0.141 [+0.122, +0.164] |
| combined minus knn | +0.012 [-0.001, +0.022] | -0.003 [-0.012, +0.004] | +0.019 [+0.010, +0.026] | +0.019 [+0.009, +0.028] |

### Operating points and change size (title only, all modules)

`combined`, micro P / R / F1 on the evaluation slice at fixed thresholds, with the `prior` for reference:

| threshold | combined P | R | F1 | avg predicted | prior P | R | F1 |
|---|---|---|---|---|---|---|---|
| 0.05 | 0.418 | 0.805 | 0.550 | 5.7 | 0.228 | 0.786 | 0.353 |
| 0.1 | 0.529 | 0.733 | 0.615 | 4.1 | 0.341 | 0.652 | 0.448 |
| 0.2 | 0.654 | 0.664 | 0.659 | 3.0 | 0.607 | 0.475 | 0.533 |
| 0.3 | 0.714 | 0.617 | 0.662 | 2.5 | 0.666 | 0.453 | 0.540 |
| 0.4 | 0.757 | 0.588 | 0.662 | 2.3 | 0.666 | 0.453 | 0.540 |
| 0.5 | 0.790 | 0.558 | 0.654 | 2.1 | 0.676 | 0.433 | 0.528 |
| 0.7 | 0.843 | 0.476 | 0.609 | 1.7 | 0.806 | 0.274 | 0.409 |

Recall by the number of modules the change actually touched (`combined` vs `prior`, tuned thresholds):

| modules touched | changes | combined recall | combined precision | prior recall |
|---|---|---|---|---|
| 1 | 86 | 0.628 | 0.338 | 0.279 |
| 2-3 | 410 | 0.782 | 0.774 | 0.601 |
| 4-8 | 128 | 0.423 | 0.924 | 0.362 |
| 9+ | 19 | 0.150 | 0.892 | 0.150 |

Threshold chosen on the tuning slice to reach a target micro recall (the kill condition is recall < 0.6), reported on the evaluation slice:

| method | target recall | threshold | P | R | F1 | avg predicted |
|---|---|---|---|---|---|---|
| combined | 0.6 | 0.330 | 0.726 | 0.607 | 0.661 | 2.5 |
| combined | 0.8 | 0.025 | 0.315 | 0.851 | 0.460 | 7.9 |
| knn | 0.6 | 0.358 | 0.735 | 0.576 | 0.646 | 2.3 |
| knn | 0.8 | 0.023 | 0.302 | 0.849 | 0.445 | 8.3 |
| prior | 0.6 | 0.139 | 0.400 | 0.584 | 0.475 | 4.3 |
| prior | 0.8 | 0.033 | 0.178 | 0.843 | 0.294 | 13.9 |

Calibration of `combined` over the 54543 scored (change, module) pairs: ECE 0.0036, Brier 0.0161.

### Title + body, all modules (optimistic: bodies are often written after the change)

| method | thr | P | R | F1 | per-change P/R/F1 | top-k (k) P/R/F1 | R@1 | R@3 | R@5 | hit@1 | avg pred |
|---|---|---|---|---|---|---|---|---|---|---|---|
| prior | 0.260 | 0.666 | 0.453 | 0.540 | 0.67/0.51/0.55 | (2) 0.67/0.45/0.54 | 0.274 | 0.517 | 0.619 | 0.81 | 2.0 |
| lexical | 0.133 | 0.315 | 0.353 | 0.333 | 0.36/0.42/0.34 | (2) 0.45/0.30/0.36 | 0.191 | 0.355 | 0.413 | 0.56 | 3.3 |
| knn | 0.365 | 0.735 | 0.577 | 0.647 | 0.74/0.67/0.67 | (2) 0.76/0.51/0.61 | 0.288 | 0.635 | 0.741 | 0.85 | 2.3 |
| cochange | 0.333 | 0.830 | 0.448 | 0.582 | 0.62/0.56/0.56 | (2) 0.80/0.47/0.59 | 0.242 | 0.543 | 0.619 | 0.71 | 1.6 |
| combined | 0.462 | 0.769 | 0.576 | 0.659 | 0.75/0.68/0.67 | (2) 0.78/0.53/0.63 | 0.285 | 0.649 | 0.757 | 0.84 | 2.2 |

### Does text add anything over the prior? (title + body, all modules)

Difference to the `prior` baseline (top modules by recent frequency, no text), 95% interval from a block bootstrap over evaluation changes. An interval that excludes 0 means the method adds something over the prior.

| method | dF1 | dR@1 | dR@3 | dR@5 |
|---|---|---|---|---|
| lexical | -0.206 [-0.229, -0.182] | -0.083 [-0.109, -0.063] | -0.162 [-0.184, -0.141] | -0.206 [-0.229, -0.180] |
| knn | +0.107 [+0.092, +0.124] | +0.013 [+0.007, +0.021] | +0.118 [+0.100, +0.142] | +0.123 [+0.106, +0.144] |
| cochange | +0.042 [+0.016, +0.073] | -0.032 [-0.047, -0.011] | +0.025 [-0.005, +0.063] | +0.000 [-0.030, +0.035] |
| combined | +0.120 [+0.101, +0.137] | +0.011 [+0.001, +0.019] | +0.132 [+0.116, +0.155] | +0.138 [+0.119, +0.160] |
| combined minus knn | +0.012 [+0.002, +0.023] | -0.003 [-0.012, +0.004] | +0.014 [+0.005, +0.022] | +0.015 [+0.005, +0.023] |

Modules made only of dissolvable files (lockfile, changelog, snapshot, generated) are ignored in the substantive view: .changeset.

### Substantive view, title only

| method | thr | P | R | F1 | per-change P/R/F1 | top-k (k) P/R/F1 | R@1 | R@3 | R@5 | hit@1 | avg pred |
|---|---|---|---|---|---|---|---|---|---|---|---|
| prior | 0.180 | 0.385 | 0.318 | 0.348 | 0.42/0.39/0.36 | (2) 0.36/0.33/0.35 | 0.246 | 0.414 | 0.545 | 0.53 | 1.8 |
| lexical | 0.224 | 0.448 | 0.343 | 0.388 | 0.40/0.46/0.39 | (2) 0.45/0.41/0.43 | 0.264 | 0.481 | 0.550 | 0.57 | 1.6 |
| knn | 0.342 | 0.659 | 0.425 | 0.517 | 0.68/0.57/0.56 | (2) 0.54/0.50/0.52 | 0.327 | 0.586 | 0.690 | 0.70 | 1.4 |
| cochange | 0.336 | 0.805 | 0.340 | 0.478 | 0.63/0.52/0.53 | (1) 0.81/0.33/0.47 | 0.329 | 0.482 | 0.563 | 0.71 | 0.9 |
| combined | 0.241 | 0.605 | 0.507 | 0.552 | 0.65/0.68/0.60 | (1) 0.76/0.35/0.48 | 0.353 | 0.598 | 0.721 | 0.76 | 1.8 |

### Does text add anything over the prior? (title only, substantive view)

Difference to the `prior` baseline (top modules by recent frequency, no text), 95% interval from a block bootstrap over evaluation changes. An interval that excludes 0 means the method adds something over the prior.

| method | dF1 | dR@1 | dR@3 | dR@5 |
|---|---|---|---|---|
| lexical | +0.040 [+0.006, +0.068] | +0.017 [-0.001, +0.034] | +0.067 [+0.042, +0.094] | +0.005 [-0.027, +0.032] |
| knn | +0.168 [+0.145, +0.198] | +0.081 [+0.063, +0.101] | +0.172 [+0.144, +0.203] | +0.144 [+0.118, +0.171] |
| cochange | +0.129 [+0.101, +0.172] | +0.083 [+0.055, +0.121] | +0.068 [+0.038, +0.109] | +0.018 [-0.020, +0.059] |
| combined | +0.203 [+0.180, +0.234] | +0.107 [+0.086, +0.133] | +0.184 [+0.156, +0.217] | +0.176 [+0.148, +0.203] |
| combined minus knn | +0.035 [+0.022, +0.048] | +0.026 [+0.017, +0.036] | +0.012 [+0.000, +0.023] | +0.031 [+0.016, +0.042] |

### Substantive view, title + body

| method | thr | P | R | F1 | per-change P/R/F1 | top-k (k) P/R/F1 | R@1 | R@3 | R@5 | hit@1 | avg pred |
|---|---|---|---|---|---|---|---|---|---|---|---|
| prior | 0.180 | 0.385 | 0.318 | 0.348 | 0.42/0.39/0.36 | (2) 0.36/0.33/0.35 | 0.246 | 0.414 | 0.545 | 0.53 | 1.8 |
| lexical | 0.226 | 0.448 | 0.343 | 0.388 | 0.40/0.46/0.39 | (2) 0.45/0.41/0.43 | 0.264 | 0.481 | 0.550 | 0.57 | 1.6 |
| knn | 0.361 | 0.665 | 0.421 | 0.515 | 0.68/0.56/0.56 | (2) 0.54/0.50/0.52 | 0.327 | 0.585 | 0.690 | 0.70 | 1.4 |
| cochange | 0.336 | 0.805 | 0.340 | 0.478 | 0.63/0.52/0.53 | (1) 0.81/0.33/0.47 | 0.329 | 0.482 | 0.563 | 0.71 | 0.9 |
| combined | 0.290 | 0.631 | 0.491 | 0.552 | 0.66/0.66/0.60 | (2) 0.55/0.52/0.54 | 0.346 | 0.594 | 0.715 | 0.74 | 1.7 |

### Ceilings (evaluation slice, all modules, title-only candidate pool)

- reachable recall (actual module exists in the tree at the parent or in earlier history): 0.992
- candidate-pool recall of the combined method (actual module is among the scored candidates): 0.978

### Fitted settings (tuning slice)

```
{
 "prior_window": 160,
 "prior_halflife": 80,
 "lex_name_weight": 1.5,
 "lex_alpha": 0.0,
 "knn_k": 60,
 "knn_power": 1.0,
 "knn_lambda": 0.1,
 "knn_decay": 300.0,
 "co_window": null,
 "co_kappa": 1.0
}
```

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

