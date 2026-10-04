# Footprint prediction: workers-sdk

Changes: 1286: burn-in 128 (history only), tuning 515, evaluation 643 (the last 50% by merge order). Thresholds, top-k, calibration and blend weights are fitted on the tuning slice only. P / R / F1 are micro-averaged over (change, module) pairs at the threshold that maximises F1 on the tuning slice; R@k is the share of actual modules found in the top k; hit@1 is the share of changes whose top-1 module is touched.

### Title only (headline), all modules

| method | thr | P | R | F1 | per-change P/R/F1 | top-k (k) P/R/F1 | R@1 | R@3 | R@5 | hit@1 | avg pred |
|---|---|---|---|---|---|---|---|---|---|---|---|
| prior | 0.215 | 0.633 | 0.335 | 0.438 | 0.63/0.41/0.47 | (2) 0.64/0.34/0.44 | 0.213 | 0.381 | 0.459 | 0.81 | 2.0 |
| lexical | 0.138 | 0.326 | 0.261 | 0.290 | 0.34/0.32/0.29 | (3) 0.35/0.27/0.30 | 0.130 | 0.270 | 0.332 | 0.49 | 3.0 |
| knn | 0.302 | 0.676 | 0.483 | 0.563 | 0.69/0.59/0.59 | (3) 0.62/0.48/0.54 | 0.220 | 0.483 | 0.605 | 0.83 | 2.7 |
| cochange | 0.252 | 0.705 | 0.349 | 0.467 | 0.49/0.44/0.43 | (3) 0.58/0.40/0.47 | 0.157 | 0.400 | 0.485 | 0.60 | 1.9 |
| combined | 0.205 | 0.614 | 0.560 | 0.586 | 0.64/0.68/0.61 | (3) 0.63/0.49/0.55 | 0.220 | 0.494 | 0.614 | 0.84 | 3.5 |

### Does text add anything over the prior? (title only, all modules)

Difference to the `prior` baseline (top modules by recent frequency, no text), 95% interval from a block bootstrap over evaluation changes. An interval that excludes 0 means the method adds something over the prior.

| method | dF1 | dR@1 | dR@3 | dR@5 |
|---|---|---|---|---|
| lexical | -0.149 [-0.174, -0.126] | -0.082 [-0.100, -0.069] | -0.111 [-0.127, -0.093] | -0.127 [-0.149, -0.107] |
| knn | +0.125 [+0.106, +0.144] | +0.007 [+0.002, +0.013] | +0.102 [+0.086, +0.124] | +0.146 [+0.124, +0.171] |
| cochange | +0.029 [-0.005, +0.065] | -0.056 [-0.065, -0.043] | +0.019 [-0.011, +0.053] | +0.026 [-0.005, +0.060] |
| combined | +0.147 [+0.127, +0.167] | +0.008 [+0.002, +0.013] | +0.113 [+0.094, +0.134] | +0.155 [+0.134, +0.180] |

### Operating points and change size (title only, all modules)

`combined`, micro P / R / F1 on the evaluation slice at fixed thresholds, with the `prior` for reference:

| threshold | combined P | R | F1 | avg predicted | prior P | R | F1 |
|---|---|---|---|---|---|---|---|
| 0.05 | 0.351 | 0.723 | 0.472 | 7.8 | 0.189 | 0.662 | 0.294 |
| 0.1 | 0.466 | 0.649 | 0.542 | 5.3 | 0.307 | 0.507 | 0.382 |
| 0.2 | 0.609 | 0.562 | 0.585 | 3.5 | 0.630 | 0.336 | 0.438 |
| 0.3 | 0.683 | 0.516 | 0.588 | 2.9 | 0.636 | 0.335 | 0.439 |
| 0.4 | 0.727 | 0.470 | 0.571 | 2.5 | 0.636 | 0.335 | 0.439 |
| 0.5 | 0.762 | 0.431 | 0.550 | 2.1 | 0.662 | 0.311 | 0.423 |
| 0.7 | 0.829 | 0.359 | 0.501 | 1.6 | 0.807 | 0.213 | 0.337 |

Recall by the number of modules the change actually touched (`combined` vs `prior`, tuned thresholds):

| modules touched | changes | combined recall | combined precision | prior recall |
|---|---|---|---|---|
| 1 | 74 | 0.595 | 0.189 | 0.122 |
| 2-3 | 340 | 0.831 | 0.613 | 0.534 |
| 4-8 | 186 | 0.505 | 0.711 | 0.294 |
| 9+ | 43 | 0.244 | 0.808 | 0.136 |

Threshold chosen on the tuning slice to reach a target micro recall (the kill condition is recall < 0.6), reported on the evaluation slice:

| method | target recall | threshold | P | R | F1 | avg predicted |
|---|---|---|---|---|---|---|
| combined | 0.6 | 0.125 | 0.514 | 0.619 | 0.562 | 4.6 |
| combined | 0.8 | 0.007 | 0.115 | 0.880 | 0.203 | 29.1 |
| knn | 0.6 | 0.132 | 0.497 | 0.618 | 0.551 | 4.7 |
| knn | 0.8 | unreachable | | | | |
| prior | 0.6 | 0.062 | 0.211 | 0.631 | 0.316 | 11.3 |
| prior | 0.8 | unreachable | | | | |

Calibration of `combined` over the 77779 scored (change, module) pairs: ECE 0.0034, Brier 0.0165.

Modules made only of dissolvable files (lockfile, changelog, snapshot, generated) are ignored in the substantive view: .changeset.

### Substantive view, title only

| method | thr | P | R | F1 | per-change P/R/F1 | top-k (k) P/R/F1 | R@1 | R@3 | R@5 | hit@1 | avg pred |
|---|---|---|---|---|---|---|---|---|---|---|---|
| prior | 0.143 | 0.245 | 0.302 | 0.271 | 0.26/0.38/0.26 | (3) 0.27/0.27/0.27 | 0.156 | 0.266 | 0.360 | 0.47 | 3.7 |
| lexical | 0.173 | 0.345 | 0.298 | 0.320 | 0.35/0.43/0.34 | (3) 0.34/0.34/0.34 | 0.165 | 0.339 | 0.412 | 0.50 | 2.6 |
| knn | 0.238 | 0.566 | 0.386 | 0.459 | 0.58/0.53/0.49 | (2) 0.52/0.34/0.42 | 0.211 | 0.435 | 0.544 | 0.64 | 2.1 |
| cochange | 0.252 | 0.636 | 0.267 | 0.376 | 0.47/0.40/0.38 | (3) 0.39/0.34/0.37 | 0.184 | 0.344 | 0.423 | 0.55 | 1.3 |
| combined | 0.205 | 0.537 | 0.443 | 0.486 | 0.57/0.61/0.52 | (2) 0.54/0.36/0.43 | 0.219 | 0.448 | 0.564 | 0.66 | 2.5 |

### Does text add anything over the prior? (title only, substantive view)

Difference to the `prior` baseline (top modules by recent frequency, no text), 95% interval from a block bootstrap over evaluation changes. An interval that excludes 0 means the method adds something over the prior.

| method | dF1 | dR@1 | dR@3 | dR@5 |
|---|---|---|---|---|
| lexical | +0.049 [+0.026, +0.073] | +0.010 [-0.004, +0.021] | +0.072 [+0.049, +0.097] | +0.052 [+0.026, +0.085] |
| knn | +0.188 [+0.158, +0.221] | +0.056 [+0.042, +0.072] | +0.169 [+0.142, +0.197] | +0.184 [+0.156, +0.217] |
| cochange | +0.105 [+0.065, +0.150] | +0.029 [+0.010, +0.055] | +0.078 [+0.049, +0.116] | +0.063 [+0.028, +0.110] |
| combined | +0.215 [+0.186, +0.243] | +0.063 [+0.048, +0.078] | +0.182 [+0.156, +0.210] | +0.204 [+0.173, +0.241] |

### Ceilings (evaluation slice, all modules, title-only candidate pool)

- reachable recall (actual module exists in the tree at the parent or in earlier history): 0.979
- candidate-pool recall of the combined method (actual module is among the scored candidates): 0.944

### Fitted settings (tuning slice)

```
{
 "prior_window": 160,
 "prior_halflife": null,
 "lex_name_weight": 1.5,
 "lex_alpha": 0.0,
 "knn_k": 40,
 "knn_power": 1.0,
 "knn_lambda": 0.5,
 "knn_decay": 300.0,
 "co_window": null,
 "co_kappa": 2.0
}
```
