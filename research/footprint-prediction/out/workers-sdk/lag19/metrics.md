# Footprint prediction: workers-sdk

Changes: 1286: burn-in 128 (history only), tuning 515, evaluation 643 (the last 50% by merge order). Thresholds, top-k, calibration and blend weights are fitted on the tuning slice only. P / R / F1 are micro-averaged over (change, module) pairs at the threshold that maximises F1 on the tuning slice; R@k is the share of actual modules found in the top k; hit@1 is the share of changes whose top-1 module is touched.

### Title only (headline), all modules

| method | thr | P | R | F1 | per-change P/R/F1 | top-k (k) P/R/F1 | R@1 | R@3 | R@5 | hit@1 | avg pred |
|---|---|---|---|---|---|---|---|---|---|---|---|
| prior | 0.319 | 0.666 | 0.453 | 0.540 | 0.67/0.51/0.55 | (2) 0.67/0.45/0.54 | 0.274 | 0.518 | 0.617 | 0.81 | 2.0 |
| lexical | 0.133 | 0.315 | 0.353 | 0.333 | 0.36/0.42/0.34 | (2) 0.45/0.30/0.36 | 0.191 | 0.355 | 0.413 | 0.56 | 3.3 |
| knn | 0.373 | 0.725 | 0.563 | 0.634 | 0.73/0.66/0.65 | (2) 0.75/0.51/0.61 | 0.282 | 0.630 | 0.732 | 0.83 | 2.3 |
| cochange | 0.356 | 0.792 | 0.446 | 0.570 | 0.61/0.56/0.55 | (2) 0.79/0.46/0.59 | 0.239 | 0.541 | 0.616 | 0.70 | 1.7 |
| combined | 0.412 | 0.751 | 0.570 | 0.648 | 0.74/0.67/0.66 | (2) 0.77/0.52/0.62 | 0.284 | 0.643 | 0.746 | 0.84 | 2.2 |

### Does text add anything over the prior? (title only, all modules)

Difference to the `prior` baseline (top modules by recent frequency, no text), 95% interval from a block bootstrap over evaluation changes. An interval that excludes 0 means the method adds something over the prior.

| method | dF1 | dR@1 | dR@3 | dR@5 |
|---|---|---|---|---|
| lexical | -0.206 [-0.229, -0.182] | -0.083 [-0.110, -0.063] | -0.163 [-0.184, -0.143] | -0.204 [-0.231, -0.178] |
| knn | +0.094 [+0.075, +0.113] | +0.008 [+0.002, +0.014] | +0.112 [+0.095, +0.135] | +0.115 [+0.099, +0.138] |
| cochange | +0.031 [+0.002, +0.063] | -0.035 [-0.050, -0.016] | +0.023 [-0.008, +0.062] | -0.001 [-0.035, +0.039] |
| combined | +0.108 [+0.091, +0.126] | +0.010 [+0.001, +0.018] | +0.125 [+0.109, +0.147] | +0.129 [+0.111, +0.146] |
| combined minus knn | +0.014 [+0.002, +0.022] | +0.002 [-0.006, +0.009] | +0.013 [+0.005, +0.020] | +0.014 [+0.002, +0.022] |

### Operating points and change size (title only, all modules)

`combined`, micro P / R / F1 on the evaluation slice at fixed thresholds, with the `prior` for reference:

| threshold | combined P | R | F1 | avg predicted | prior P | R | F1 |
|---|---|---|---|---|---|---|---|
| 0.05 | 0.406 | 0.790 | 0.537 | 5.7 | 0.211 | 0.793 | 0.333 |
| 0.1 | 0.526 | 0.720 | 0.608 | 4.0 | 0.362 | 0.625 | 0.458 |
| 0.2 | 0.642 | 0.641 | 0.642 | 2.9 | 0.585 | 0.482 | 0.529 |
| 0.3 | 0.705 | 0.599 | 0.648 | 2.5 | 0.666 | 0.453 | 0.540 |
| 0.4 | 0.741 | 0.570 | 0.645 | 2.3 | 0.666 | 0.453 | 0.540 |
| 0.5 | 0.774 | 0.548 | 0.642 | 2.1 | 0.680 | 0.427 | 0.525 |
| 0.7 | 0.816 | 0.475 | 0.601 | 1.7 | 0.786 | 0.291 | 0.425 |

Recall by the number of modules the change actually touched (`combined` vs `prior`, tuned thresholds):

| modules touched | changes | combined recall | combined precision | prior recall |
|---|---|---|---|---|
| 1 | 86 | 0.616 | 0.325 | 0.279 |
| 2-3 | 410 | 0.765 | 0.766 | 0.601 |
| 4-8 | 128 | 0.412 | 0.923 | 0.362 |
| 9+ | 19 | 0.164 | 0.900 | 0.150 |

Threshold chosen on the tuning slice to reach a target micro recall (the kill condition is recall < 0.6), reported on the evaluation slice:

| method | target recall | threshold | P | R | F1 | avg predicted |
|---|---|---|---|---|---|---|
| combined | 0.6 | 0.316 | 0.708 | 0.592 | 0.645 | 2.5 |
| combined | 0.8 | 0.023 | 0.295 | 0.844 | 0.437 | 8.4 |
| knn | 0.6 | 0.280 | 0.706 | 0.575 | 0.634 | 2.4 |
| knn | 0.8 | 0.023 | 0.278 | 0.843 | 0.418 | 8.9 |
| prior | 0.6 | 0.112 | 0.401 | 0.579 | 0.474 | 4.3 |
| prior | 0.8 | 0.024 | 0.176 | 0.828 | 0.291 | 13.8 |

Calibration of `combined` over the 54554 scored (change, module) pairs: ECE 0.0044, Brier 0.0170.

Modules made only of dissolvable files (lockfile, changelog, snapshot, generated) are ignored in the substantive view: .changeset.

### Substantive view, title only

| method | thr | P | R | F1 | per-change P/R/F1 | top-k (k) P/R/F1 | R@1 | R@3 | R@5 | hit@1 | avg pred |
|---|---|---|---|---|---|---|---|---|---|---|---|
| prior | 0.164 | 0.350 | 0.348 | 0.349 | 0.39/0.42/0.35 | (2) 0.36/0.34/0.35 | 0.246 | 0.410 | 0.537 | 0.53 | 2.1 |
| lexical | 0.224 | 0.448 | 0.343 | 0.388 | 0.40/0.46/0.39 | (2) 0.45/0.41/0.43 | 0.264 | 0.481 | 0.550 | 0.57 | 1.6 |
| knn | 0.373 | 0.656 | 0.400 | 0.497 | 0.67/0.54/0.54 | (2) 0.53/0.49/0.51 | 0.323 | 0.574 | 0.673 | 0.69 | 1.3 |
| cochange | 0.229 | 0.686 | 0.349 | 0.463 | 0.60/0.52/0.51 | (1) 0.80/0.33/0.46 | 0.325 | 0.481 | 0.557 | 0.70 | 1.1 |
| combined | 0.217 | 0.568 | 0.494 | 0.528 | 0.62/0.66/0.58 | (1) 0.72/0.34/0.46 | 0.337 | 0.588 | 0.692 | 0.72 | 1.9 |

### Does text add anything over the prior? (title only, substantive view)

Difference to the `prior` baseline (top modules by recent frequency, no text), 95% interval from a block bootstrap over evaluation changes. An interval that excludes 0 means the method adds something over the prior.

| method | dF1 | dR@1 | dR@3 | dR@5 |
|---|---|---|---|---|
| lexical | +0.039 [+0.004, +0.071] | +0.017 [-0.001, +0.034] | +0.071 [+0.041, +0.101] | +0.013 [-0.019, +0.046] |
| knn | +0.148 [+0.121, +0.183] | +0.077 [+0.056, +0.102] | +0.163 [+0.137, +0.192] | +0.136 [+0.111, +0.167] |
| cochange | +0.114 [+0.087, +0.153] | +0.079 [+0.054, +0.115] | +0.071 [+0.037, +0.113] | +0.020 [-0.015, +0.065] |
| combined | +0.180 [+0.156, +0.208] | +0.091 [+0.072, +0.114] | +0.178 [+0.150, +0.206] | +0.155 [+0.130, +0.182] |
| combined minus knn | +0.031 [+0.016, +0.045] | +0.015 [+0.006, +0.023] | +0.015 [+0.004, +0.025] | +0.018 [+0.008, +0.028] |

### Ceilings (evaluation slice, all modules, title-only candidate pool)

- reachable recall (actual module exists in the tree at the parent or in earlier history): 0.992
- candidate-pool recall of the combined method (actual module is among the scored candidates): 0.978

### Fitted settings (tuning slice)

```
{
 "prior_window": 320,
 "prior_halflife": 40,
 "lex_name_weight": 1.5,
 "lex_alpha": 0.0,
 "knn_k": 60,
 "knn_power": 1.0,
 "knn_lambda": 0.5,
 "knn_decay": null,
 "co_window": null,
 "co_kappa": 1.0
}
```
