# Footprint prediction: codex

Changes: 6777: burn-in 677 (history only), tuning 2711, evaluation 3389 (the last 50% by merge order). Thresholds, top-k, calibration and blend weights are fitted on the tuning slice only. P / R / F1 are micro-averaged over (change, module) pairs at the threshold that maximises F1 on the tuning slice; R@k is the share of actual modules found in the top k; hit@1 is the share of changes whose top-1 module is touched.

### Title only (headline), all modules

| method | thr | P | R | F1 | per-change P/R/F1 | top-k (k) P/R/F1 | R@1 | R@3 | R@5 | hit@1 | avg pred |
|---|---|---|---|---|---|---|---|---|---|---|---|
| prior | 0.167 | 0.302 | 0.381 | 0.337 | 0.30/0.47/0.33 | (4) 0.26/0.42/0.32 | 0.183 | 0.378 | 0.455 | 0.44 | 3.1 |
| lexical | 0.186 | 0.307 | 0.450 | 0.365 | 0.35/0.58/0.38 | (4) 0.28/0.46/0.35 | 0.200 | 0.395 | 0.523 | 0.49 | 3.6 |
| knn | 0.242 | 0.476 | 0.481 | 0.479 | 0.50/0.59/0.48 | (3) 0.41/0.51/0.45 | 0.261 | 0.506 | 0.638 | 0.63 | 2.5 |
| cochange | 0.167 | 0.402 | 0.191 | 0.259 | 0.17/0.24/0.17 | (4) 0.31/0.31/0.31 | 0.122 | 0.266 | 0.340 | 0.30 | 1.2 |
| combined | 0.242 | 0.502 | 0.512 | 0.507 | 0.54/0.65/0.52 | (3) 0.43/0.53/0.48 | 0.299 | 0.535 | 0.656 | 0.73 | 2.5 |

### Does text add anything over the prior? (title only, all modules)

Difference to the `prior` baseline (top modules by recent frequency, no text), 95% interval from a block bootstrap over evaluation changes. An interval that excludes 0 means the method adds something over the prior.

| method | dF1 | dR@1 | dR@3 | dR@5 |
|---|---|---|---|---|
| lexical | +0.028 [+0.017, +0.038] | +0.017 [+0.005, +0.033] | +0.017 [+0.007, +0.029] | +0.069 [+0.058, +0.081] |
| knn | +0.141 [+0.131, +0.151] | +0.078 [+0.069, +0.088] | +0.128 [+0.119, +0.138] | +0.184 [+0.174, +0.195] |
| cochange | -0.078 [-0.092, -0.060] | -0.061 [-0.073, -0.046] | -0.112 [-0.126, -0.096] | -0.114 [-0.130, -0.098] |
| combined | +0.170 [+0.159, +0.180] | +0.117 [+0.107, +0.129] | +0.157 [+0.147, +0.168] | +0.201 [+0.190, +0.213] |
| combined minus knn | +0.028 [+0.021, +0.035] | +0.039 [+0.034, +0.044] | +0.029 [+0.022, +0.035] | +0.018 [+0.012, +0.023] |

### Operating points and change size (title only, all modules)

`combined`, micro P / R / F1 on the evaluation slice at fixed thresholds, with the `prior` for reference:

| threshold | combined P | R | F1 | avg predicted | prior P | R | F1 |
|---|---|---|---|---|---|---|---|
| 0.05 | 0.225 | 0.802 | 0.351 | 8.7 | 0.159 | 0.544 | 0.246 |
| 0.1 | 0.317 | 0.706 | 0.438 | 5.4 | 0.229 | 0.448 | 0.303 |
| 0.2 | 0.454 | 0.562 | 0.502 | 3.0 | 0.341 | 0.329 | 0.335 |
| 0.3 | 0.564 | 0.450 | 0.501 | 1.9 | 0.432 | 0.193 | 0.266 |
| 0.4 | 0.662 | 0.363 | 0.469 | 1.3 | 0.445 | 0.177 | 0.253 |
| 0.5 | 0.746 | 0.281 | 0.409 | 0.9 | 0.000 | 0.000 | 0.000 |
| 0.7 | 0.875 | 0.152 | 0.259 | 0.4 | 0.000 | 0.000 | 0.000 |

Recall by the number of modules the change actually touched (`combined` vs `prior`, tuned thresholds):

| modules touched | changes | combined recall | combined precision | prior recall |
|---|---|---|---|---|
| 1 | 1596 | 0.812 | 0.377 | 0.612 |
| 2-3 | 1105 | 0.553 | 0.501 | 0.375 |
| 4-8 | 601 | 0.412 | 0.692 | 0.316 |
| 9+ | 87 | 0.210 | 0.887 | 0.221 |

Threshold chosen on the tuning slice to reach a target micro recall (the kill condition is recall < 0.6), reported on the evaluation slice:

| method | target recall | threshold | P | R | F1 | avg predicted |
|---|---|---|---|---|---|---|
| combined | 0.6 | 0.154 | 0.394 | 0.623 | 0.483 | 3.8 |
| combined | 0.8 | 0.034 | 0.183 | 0.843 | 0.301 | 11.2 |
| knn | 0.6 | 0.147 | 0.369 | 0.618 | 0.462 | 4.1 |
| knn | 0.8 | 0.035 | 0.176 | 0.835 | 0.291 | 11.6 |
| prior | 0.6 | 0.043 | 0.135 | 0.594 | 0.220 | 10.7 |
| prior | 0.8 | 0.022 | 0.075 | 0.747 | 0.136 | 24.3 |

Calibration of `combined` over the 248880 scored (change, module) pairs: ECE 0.0036, Brier 0.0210.

### Ceilings (evaluation slice, all modules, title-only candidate pool)

- reachable recall (actual module exists in the tree at the parent or in earlier history): 0.996
- candidate-pool recall of the combined method (actual module is among the scored candidates): 0.981

### Fitted settings (tuning slice)

```
{
 "prior_window": 4000,
 "prior_halflife": 320,
 "lex_name_weight": 3.0,
 "lex_alpha": 0.25,
 "knn_k": 60,
 "knn_power": 2.0,
 "knn_lambda": 0.1,
 "knn_decay": null,
 "co_window": null,
 "co_kappa": 2.0
}
```
