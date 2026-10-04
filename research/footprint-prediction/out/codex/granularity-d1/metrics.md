# Footprint prediction: codex

Changes: 6777: burn-in 677 (history only), tuning 2711, evaluation 3389 (the last 50% by merge order). Thresholds, top-k, calibration and blend weights are fitted on the tuning slice only. P / R / F1 are micro-averaged over (change, module) pairs at the threshold that maximises F1 on the tuning slice; R@k is the share of actual modules found in the top k; hit@1 is the share of changes whose top-1 module is touched.

### Title only (headline), all modules

| method | thr | P | R | F1 | per-change P/R/F1 | top-k (k) P/R/F1 | R@1 | R@3 | R@5 | hit@1 | avg pred |
|---|---|---|---|---|---|---|---|---|---|---|---|
| prior | 0.146 | 0.258 | 0.350 | 0.297 | 0.26/0.45/0.29 | (5) 0.24/0.37/0.29 | 0.114 | 0.279 | 0.373 | 0.37 | 4.4 |
| lexical | 0.155 | 0.245 | 0.456 | 0.319 | 0.27/0.59/0.32 | (5) 0.25/0.39/0.31 | 0.106 | 0.259 | 0.390 | 0.34 | 6.0 |
| knn | 0.196 | 0.408 | 0.505 | 0.451 | 0.42/0.62/0.44 | (4) 0.37/0.46/0.41 | 0.187 | 0.399 | 0.521 | 0.60 | 4.0 |
| cochange | 0.124 | 0.353 | 0.080 | 0.130 | 0.06/0.08/0.06 | (5) 0.22/0.21/0.21 | 0.024 | 0.141 | 0.210 | 0.08 | 0.7 |
| combined | 0.213 | 0.449 | 0.490 | 0.469 | 0.48/0.62/0.48 | (4) 0.39/0.48/0.43 | 0.204 | 0.413 | 0.536 | 0.66 | 3.5 |

### Does text add anything over the prior? (title only, all modules)

Difference to the `prior` baseline (top modules by recent frequency, no text), 95% interval from a block bootstrap over evaluation changes. An interval that excludes 0 means the method adds something over the prior.

| method | dF1 | dR@1 | dR@3 | dR@5 |
|---|---|---|---|---|
| lexical | +0.022 [+0.013, +0.030] | -0.008 [-0.018, +0.004] | -0.019 [-0.029, -0.010] | +0.017 [+0.007, +0.027] |
| knn | +0.154 [+0.145, +0.164] | +0.073 [+0.066, +0.083] | +0.120 [+0.112, +0.131] | +0.148 [+0.139, +0.158] |
| cochange | -0.167 [-0.184, -0.147] | -0.090 [-0.097, -0.082] | -0.138 [-0.153, -0.123] | -0.163 [-0.179, -0.145] |
| combined | +0.172 [+0.161, +0.183] | +0.091 [+0.082, +0.101] | +0.134 [+0.123, +0.146] | +0.163 [+0.152, +0.176] |

### Operating points and change size (title only, all modules)

`combined`, micro P / R / F1 on the evaluation slice at fixed thresholds, with the `prior` for reference:

| threshold | combined P | R | F1 | avg predicted | prior P | R | F1 |
|---|---|---|---|---|---|---|---|
| 0.05 | 0.207 | 0.766 | 0.326 | 11.9 | 0.139 | 0.535 | 0.221 |
| 0.1 | 0.301 | 0.659 | 0.414 | 7.1 | 0.215 | 0.407 | 0.282 |
| 0.2 | 0.435 | 0.509 | 0.469 | 3.8 | 0.309 | 0.264 | 0.285 |
| 0.3 | 0.547 | 0.396 | 0.460 | 2.3 | 0.361 | 0.133 | 0.194 |
| 0.4 | 0.635 | 0.300 | 0.408 | 1.5 | 0.419 | 0.024 | 0.046 |
| 0.5 | 0.713 | 0.217 | 0.333 | 1.0 | 0.000 | 0.000 | 0.000 |
| 0.7 | 0.843 | 0.100 | 0.179 | 0.4 | 0.000 | 0.000 | 0.000 |

Recall by the number of modules the change actually touched (`combined` vs `prior`, tuned thresholds):

| modules touched | changes | combined recall | combined precision | prior recall |
|---|---|---|---|---|
| 1 | 1209 | 0.788 | 0.288 | 0.590 |
| 2-3 | 1145 | 0.585 | 0.396 | 0.427 |
| 4-8 | 812 | 0.463 | 0.567 | 0.304 |
| 9+ | 223 | 0.301 | 0.754 | 0.237 |

Threshold chosen on the tuning slice to reach a target micro recall (the kill condition is recall < 0.6), reported on the evaluation slice:

| method | target recall | threshold | P | R | F1 | avg predicted |
|---|---|---|---|---|---|---|
| combined | 0.6 | 0.118 | 0.330 | 0.631 | 0.433 | 6.2 |
| combined | 0.8 | 0.025 | 0.140 | 0.841 | 0.240 | 19.4 |
| knn | 0.6 | 0.105 | 0.304 | 0.630 | 0.410 | 6.7 |
| knn | 0.8 | 0.025 | 0.130 | 0.838 | 0.226 | 20.8 |
| prior | 0.6 | 0.042 | 0.118 | 0.587 | 0.197 | 16.1 |
| prior | 0.8 | unreachable | | | | |

Calibration of `combined` over the 331769 scored (change, module) pairs: ECE 0.0036, Brier 0.0219.

Modules made only of dissolvable files (lockfile, changelog, snapshot, generated) are ignored in the substantive view: codex-rs/hooks/schema.

### Substantive view, title only

| method | thr | P | R | F1 | per-change P/R/F1 | top-k (k) P/R/F1 | R@1 | R@3 | R@5 | hit@1 | avg pred |
|---|---|---|---|---|---|---|---|---|---|---|---|
| prior | 0.146 | 0.258 | 0.350 | 0.297 | 0.26/0.45/0.29 | (5) 0.24/0.37/0.29 | 0.114 | 0.279 | 0.373 | 0.37 | 4.4 |
| lexical | 0.156 | 0.247 | 0.456 | 0.321 | 0.28/0.59/0.32 | (5) 0.25/0.39/0.31 | 0.106 | 0.260 | 0.391 | 0.34 | 6.0 |
| knn | 0.196 | 0.408 | 0.505 | 0.452 | 0.42/0.62/0.44 | (4) 0.37/0.46/0.41 | 0.187 | 0.399 | 0.521 | 0.60 | 4.0 |
| cochange | 0.124 | 0.353 | 0.080 | 0.130 | 0.06/0.08/0.06 | (5) 0.22/0.21/0.21 | 0.024 | 0.141 | 0.210 | 0.08 | 0.7 |
| combined | 0.213 | 0.449 | 0.490 | 0.469 | 0.48/0.62/0.48 | (4) 0.39/0.48/0.43 | 0.204 | 0.413 | 0.536 | 0.66 | 3.5 |

### Does text add anything over the prior? (title only, substantive view)

Difference to the `prior` baseline (top modules by recent frequency, no text), 95% interval from a block bootstrap over evaluation changes. An interval that excludes 0 means the method adds something over the prior.

| method | dF1 | dR@1 | dR@3 | dR@5 |
|---|---|---|---|---|
| lexical | +0.024 [+0.014, +0.032] | -0.008 [-0.018, +0.004] | -0.019 [-0.028, -0.009] | +0.018 [+0.008, +0.028] |
| knn | +0.155 [+0.145, +0.164] | +0.073 [+0.066, +0.083] | +0.120 [+0.112, +0.131] | +0.148 [+0.139, +0.158] |
| cochange | -0.167 [-0.184, -0.147] | -0.090 [-0.097, -0.082] | -0.138 [-0.153, -0.123] | -0.163 [-0.179, -0.145] |
| combined | +0.172 [+0.161, +0.183] | +0.091 [+0.082, +0.101] | +0.134 [+0.124, +0.146] | +0.163 [+0.152, +0.176] |

### Ceilings (evaluation slice, all modules, title-only candidate pool)

- reachable recall (actual module exists in the tree at the parent or in earlier history): 0.992
- candidate-pool recall of the combined method (actual module is among the scored candidates): 0.961

### Fitted settings (tuning slice)

```
{
 "prior_window": 4000,
 "prior_halflife": 320,
 "lex_name_weight": 3.0,
 "lex_alpha": 0.0,
 "knn_k": 60,
 "knn_power": 2.0,
 "knn_lambda": 0.5,
 "knn_decay": null,
 "co_window": null,
 "co_kappa": 1.0
}
```
