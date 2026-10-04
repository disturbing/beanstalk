# Footprint prediction: codex

Changes: 6777: burn-in 677 (history only), tuning 2711, evaluation 3389 (the last 50% by merge order). Thresholds, top-k, calibration and blend weights are fitted on the tuning slice only. P / R / F1 are micro-averaged over (change, module) pairs at the threshold that maximises F1 on the tuning slice; R@k is the share of actual modules found in the top k; hit@1 is the share of changes whose top-1 module is touched.

### Title only (headline), all modules

| method | thr | P | R | F1 | per-change P/R/F1 | top-k (k) P/R/F1 | R@1 | R@3 | R@5 | hit@1 | avg pred |
|---|---|---|---|---|---|---|---|---|---|---|---|
| prior | 0.132 | 0.285 | 0.398 | 0.332 | 0.29/0.49/0.32 | (4) 0.26/0.42/0.32 | 0.183 | 0.378 | 0.452 | 0.44 | 3.4 |
| lexical | 0.186 | 0.307 | 0.450 | 0.365 | 0.35/0.58/0.38 | (4) 0.28/0.46/0.35 | 0.200 | 0.395 | 0.523 | 0.49 | 3.6 |
| knn | 0.231 | 0.477 | 0.468 | 0.472 | 0.50/0.56/0.47 | (3) 0.41/0.50/0.45 | 0.266 | 0.502 | 0.619 | 0.65 | 2.4 |
| cochange | 0.170 | 0.396 | 0.195 | 0.261 | 0.17/0.24/0.17 | (4) 0.31/0.31/0.31 | 0.122 | 0.268 | 0.342 | 0.30 | 1.2 |
| combined | 0.243 | 0.532 | 0.472 | 0.500 | 0.54/0.59/0.50 | (3) 0.42/0.52/0.47 | 0.288 | 0.523 | 0.645 | 0.70 | 2.2 |

### Does text add anything over the prior? (title only, all modules)

Difference to the `prior` baseline (top modules by recent frequency, no text), 95% interval from a block bootstrap over evaluation changes. An interval that excludes 0 means the method adds something over the prior.

| method | dF1 | dR@1 | dR@3 | dR@5 |
|---|---|---|---|---|
| lexical | +0.033 [+0.022, +0.043] | +0.017 [+0.005, +0.033] | +0.017 [+0.007, +0.029] | +0.071 [+0.060, +0.085] |
| knn | +0.140 [+0.127, +0.152] | +0.083 [+0.073, +0.095] | +0.123 [+0.113, +0.137] | +0.167 [+0.154, +0.182] |
| cochange | -0.071 [-0.085, -0.054] | -0.061 [-0.073, -0.046] | -0.110 [-0.123, -0.094] | -0.110 [-0.126, -0.092] |
| combined | +0.168 [+0.155, +0.181] | +0.106 [+0.096, +0.119] | +0.145 [+0.134, +0.157] | +0.193 [+0.181, +0.207] |
| combined minus knn | +0.028 [+0.022, +0.035] | +0.022 [+0.018, +0.027] | +0.021 [+0.016, +0.025] | +0.026 [+0.021, +0.030] |

### Operating points and change size (title only, all modules)

`combined`, micro P / R / F1 on the evaluation slice at fixed thresholds, with the `prior` for reference:

| threshold | combined P | R | F1 | avg predicted | prior P | R | F1 |
|---|---|---|---|---|---|---|---|
| 0.05 | 0.245 | 0.746 | 0.369 | 7.4 | 0.155 | 0.551 | 0.242 |
| 0.1 | 0.350 | 0.648 | 0.455 | 4.5 | 0.237 | 0.436 | 0.307 |
| 0.2 | 0.485 | 0.518 | 0.501 | 2.6 | 0.348 | 0.324 | 0.336 |
| 0.3 | 0.582 | 0.420 | 0.488 | 1.8 | 0.430 | 0.202 | 0.275 |
| 0.4 | 0.664 | 0.342 | 0.452 | 1.3 | 0.449 | 0.169 | 0.246 |
| 0.5 | 0.737 | 0.265 | 0.389 | 0.9 | 0.000 | 0.000 | 0.000 |
| 0.7 | 0.867 | 0.139 | 0.239 | 0.4 | 0.000 | 0.000 | 0.000 |

Recall by the number of modules the change actually touched (`combined` vs `prior`, tuned thresholds):

| modules touched | changes | combined recall | combined precision | prior recall |
|---|---|---|---|---|
| 1 | 1596 | 0.730 | 0.406 | 0.621 |
| 2-3 | 1105 | 0.513 | 0.531 | 0.397 |
| 4-8 | 601 | 0.385 | 0.713 | 0.333 |
| 9+ | 87 | 0.203 | 0.801 | 0.237 |

Threshold chosen on the tuning slice to reach a target micro recall (the kill condition is recall < 0.6), reported on the evaluation slice:

| method | target recall | threshold | P | R | F1 | avg predicted |
|---|---|---|---|---|---|---|
| combined | 0.6 | 0.149 | 0.426 | 0.582 | 0.492 | 3.3 |
| combined | 0.8 | 0.033 | 0.202 | 0.793 | 0.322 | 9.5 |
| knn | 0.6 | 0.157 | 0.374 | 0.576 | 0.454 | 3.7 |
| knn | 0.8 | 0.031 | 0.182 | 0.775 | 0.295 | 10.4 |
| prior | 0.6 | 0.040 | 0.134 | 0.598 | 0.219 | 10.9 |
| prior | 0.8 | 0.022 | 0.071 | 0.756 | 0.131 | 25.7 |

Calibration of `combined` over the 248923 scored (change, module) pairs: ECE 0.0029, Brier 0.0215.

### Title + body, all modules (optimistic: bodies are often written after the change)

| method | thr | P | R | F1 | per-change P/R/F1 | top-k (k) P/R/F1 | R@1 | R@3 | R@5 | hit@1 | avg pred |
|---|---|---|---|---|---|---|---|---|---|---|---|
| prior | 0.132 | 0.285 | 0.398 | 0.332 | 0.29/0.49/0.32 | (4) 0.26/0.42/0.32 | 0.183 | 0.378 | 0.452 | 0.44 | 3.4 |
| lexical | 0.220 | 0.429 | 0.406 | 0.417 | 0.44/0.50/0.42 | (3) 0.35/0.44/0.39 | 0.243 | 0.436 | 0.572 | 0.59 | 2.3 |
| knn | 0.279 | 0.593 | 0.598 | 0.596 | 0.65/0.72/0.62 | (3) 0.49/0.60/0.54 | 0.322 | 0.599 | 0.727 | 0.78 | 2.5 |
| cochange | 0.236 | 0.725 | 0.198 | 0.311 | 0.31/0.23/0.24 | (3) 0.39/0.42/0.40 | 0.209 | 0.422 | 0.528 | 0.51 | 0.7 |
| combined | 0.282 | 0.716 | 0.540 | 0.616 | 0.71/0.66/0.63 | (3) 0.50/0.62/0.56 | 0.349 | 0.622 | 0.748 | 0.85 | 1.8 |

### Does text add anything over the prior? (title + body, all modules)

Difference to the `prior` baseline (top modules by recent frequency, no text), 95% interval from a block bootstrap over evaluation changes. An interval that excludes 0 means the method adds something over the prior.

| method | dF1 | dR@1 | dR@3 | dR@5 |
|---|---|---|---|---|
| lexical | +0.085 [+0.072, +0.098] | +0.061 [+0.048, +0.076] | +0.058 [+0.048, +0.071] | +0.120 [+0.107, +0.131] |
| knn | +0.264 [+0.252, +0.275] | +0.140 [+0.129, +0.153] | +0.221 [+0.210, +0.235] | +0.275 [+0.261, +0.289] |
| cochange | -0.021 [-0.037, -0.005] | +0.026 [+0.015, +0.043] | +0.044 [+0.031, +0.059] | +0.076 [+0.061, +0.090] |
| combined | +0.283 [+0.272, +0.296] | +0.166 [+0.155, +0.182] | +0.243 [+0.231, +0.258] | +0.296 [+0.282, +0.310] |
| combined minus knn | +0.020 [+0.012, +0.028] | +0.027 [+0.022, +0.032] | +0.022 [+0.016, +0.028] | +0.021 [+0.015, +0.026] |

### Ceilings (evaluation slice, all modules, title-only candidate pool)

- reachable recall (actual module exists in the tree at the parent or in earlier history): 0.996
- candidate-pool recall of the combined method (actual module is among the scored candidates): 0.982

### Fitted settings (tuning slice)

```
{
 "prior_window": 1000,
 "prior_halflife": null,
 "lex_name_weight": 3.0,
 "lex_alpha": 0.25,
 "knn_k": 60,
 "knn_power": 2.0,
 "knn_lambda": 0.1,
 "knn_decay": 300.0,
 "co_window": null,
 "co_kappa": 1.0
}
```

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

