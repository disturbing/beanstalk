# Footprint prediction: workers-sdk

Changes: 1286: burn-in 128 (history only), tuning 515, evaluation 643 (the last 50% by merge order). Thresholds, top-k, calibration and blend weights are fitted on the tuning slice only. P / R / F1 are micro-averaged over (change, module) pairs at the threshold that maximises F1 on the tuning slice; R@k is the share of actual modules found in the top k; hit@1 is the share of changes whose top-1 module is touched.

### Title only (headline), all modules

| method | thr | P | R | F1 | per-change P/R/F1 | top-k (k) P/R/F1 | R@1 | R@3 | R@5 | hit@1 | avg pred |
|---|---|---|---|---|---|---|---|---|---|---|---|
| prior | 0.142 | 0.505 | 0.235 | 0.320 | 0.52/0.31/0.35 | (3) 0.45/0.25/0.32 | 0.147 | 0.248 | 0.287 | 0.81 | 2.6 |
| lexical | 0.115 | 0.189 | 0.251 | 0.216 | 0.21/0.32/0.21 | (5) 0.23/0.21/0.22 | 0.068 | 0.155 | 0.208 | 0.37 | 7.3 |
| knn | 0.228 | 0.502 | 0.399 | 0.445 | 0.53/0.51/0.46 | (3) 0.57/0.31/0.40 | 0.152 | 0.308 | 0.407 | 0.83 | 4.4 |
| cochange | 0.176 | 0.432 | 0.325 | 0.371 | 0.41/0.44/0.36 | (5) 0.44/0.36/0.39 | 0.120 | 0.282 | 0.356 | 0.66 | 4.1 |
| combined | 0.168 | 0.465 | 0.450 | 0.457 | 0.50/0.57/0.47 | (4) 0.52/0.38/0.44 | 0.150 | 0.319 | 0.424 | 0.82 | 5.3 |

### Does text add anything over the prior? (title only, all modules)

Difference to the `prior` baseline (top modules by recent frequency, no text), 95% interval from a block bootstrap over evaluation changes. An interval that excludes 0 means the method adds something over the prior.

| method | dF1 | dR@1 | dR@3 | dR@5 |
|---|---|---|---|---|
| lexical | -0.104 [-0.128, -0.085] | -0.079 [-0.093, -0.069] | -0.092 [-0.103, -0.083] | -0.078 [-0.097, -0.064] |
| knn | +0.125 [+0.107, +0.139] | +0.005 [+0.002, +0.009] | +0.061 [+0.051, +0.072] | +0.120 [+0.105, +0.141] |
| cochange | +0.051 [+0.024, +0.075] | -0.027 [-0.033, -0.020] | +0.034 [+0.017, +0.052] | +0.069 [+0.046, +0.093] |
| combined | +0.137 [+0.120, +0.154] | +0.003 [-0.000, +0.007] | +0.071 [+0.060, +0.083] | +0.137 [+0.121, +0.158] |

### Operating points and change size (title only, all modules)

`combined`, micro P / R / F1 on the evaluation slice at fixed thresholds, with the `prior` for reference:

| threshold | combined P | R | F1 | avg predicted | prior P | R | F1 |
|---|---|---|---|---|---|---|---|
| 0.05 | 0.250 | 0.638 | 0.360 | 14.0 | 0.133 | 0.475 | 0.208 |
| 0.1 | 0.369 | 0.537 | 0.438 | 8.0 | 0.317 | 0.284 | 0.300 |
| 0.2 | 0.502 | 0.423 | 0.459 | 4.6 | 0.606 | 0.221 | 0.324 |
| 0.3 | 0.590 | 0.363 | 0.450 | 3.4 | 0.606 | 0.221 | 0.324 |
| 0.4 | 0.648 | 0.316 | 0.425 | 2.7 | 0.606 | 0.221 | 0.324 |
| 0.5 | 0.698 | 0.275 | 0.394 | 2.2 | 0.605 | 0.215 | 0.318 |
| 0.7 | 0.790 | 0.217 | 0.341 | 1.5 | 0.807 | 0.147 | 0.249 |

Recall by the number of modules the change actually touched (`combined` vs `prior`, tuned thresholds):

| modules touched | changes | combined recall | combined precision | prior recall |
|---|---|---|---|---|
| 1 | 68 | 0.603 | 0.134 | 0.147 |
| 2-3 | 253 | 0.708 | 0.400 | 0.453 |
| 4-8 | 214 | 0.537 | 0.505 | 0.273 |
| 9+ | 108 | 0.271 | 0.672 | 0.117 |

Threshold chosen on the tuning slice to reach a target micro recall (the kill condition is recall < 0.6), reported on the evaluation slice:

| method | target recall | threshold | P | R | F1 | avg predicted |
|---|---|---|---|---|---|---|
| combined | 0.6 | 0.058 | 0.272 | 0.617 | 0.377 | 12.5 |
| combined | 0.8 | 0.007 | 0.058 | 0.853 | 0.108 | 81.2 |
| knn | 0.6 | 0.063 | 0.226 | 0.636 | 0.334 | 15.4 |
| knn | 0.8 | unreachable | | | | |
| prior | 0.6 | unreachable | | | | |
| prior | 0.8 | unreachable | | | | |

Calibration of `combined` over the 119180 scored (change, module) pairs: ECE 0.0022, Brier 0.0186.

Modules made only of dissolvable files (lockfile, changelog, snapshot, generated) are ignored in the substantive view: .changeset, packages/codemods/test/__snapshots__, packages/miniflare/test/snapshots, packages/wrangler/src/build.

### Substantive view, title only

| method | thr | P | R | F1 | per-change P/R/F1 | top-k (k) P/R/F1 | R@1 | R@3 | R@5 | hit@1 | avg pred |
|---|---|---|---|---|---|---|---|---|---|---|---|
| prior | 0.085 | 0.148 | 0.209 | 0.173 | 0.15/0.24/0.16 | (6) 0.15/0.20/0.17 | 0.087 | 0.144 | 0.181 | 0.41 | 6.6 |
| lexical | 0.115 | 0.183 | 0.283 | 0.223 | 0.20/0.40/0.23 | (5) 0.23/0.24/0.23 | 0.079 | 0.179 | 0.241 | 0.37 | 7.2 |
| knn | 0.166 | 0.368 | 0.351 | 0.359 | 0.39/0.45/0.36 | (3) 0.41/0.26/0.31 | 0.118 | 0.257 | 0.343 | 0.55 | 4.5 |
| cochange | 0.110 | 0.217 | 0.323 | 0.260 | 0.22/0.46/0.24 | (5) 0.31/0.30/0.30 | 0.104 | 0.229 | 0.296 | 0.49 | 7.0 |
| combined | 0.133 | 0.355 | 0.406 | 0.379 | 0.38/0.55/0.39 | (4) 0.38/0.33/0.35 | 0.121 | 0.271 | 0.370 | 0.56 | 5.4 |

### Does text add anything over the prior? (title only, substantive view)

Difference to the `prior` baseline (top modules by recent frequency, no text), 95% interval from a block bootstrap over evaluation changes. An interval that excludes 0 means the method adds something over the prior.

| method | dF1 | dR@1 | dR@3 | dR@5 |
|---|---|---|---|---|
| lexical | +0.049 [+0.031, +0.068] | -0.008 [-0.016, -0.000] | +0.035 [+0.022, +0.051] | +0.060 [+0.040, +0.081] |
| knn | +0.186 [+0.165, +0.207] | +0.031 [+0.024, +0.040] | +0.114 [+0.097, +0.134] | +0.162 [+0.143, +0.185] |
| cochange | +0.086 [+0.064, +0.108] | +0.017 [+0.009, +0.029] | +0.086 [+0.061, +0.112] | +0.115 [+0.087, +0.147] |
| combined | +0.206 [+0.184, +0.227] | +0.034 [+0.025, +0.042] | +0.128 [+0.110, +0.147] | +0.189 [+0.169, +0.217] |

### Ceilings (evaluation slice, all modules, title-only candidate pool)

- reachable recall (actual module exists in the tree at the parent or in earlier history): 0.970
- candidate-pool recall of the combined method (actual module is among the scored candidates): 0.914

### Fitted settings (tuning slice)

```
{
 "prior_window": 320,
 "prior_halflife": null,
 "lex_name_weight": 1.5,
 "lex_alpha": 0.0,
 "knn_k": 60,
 "knn_power": 1.0,
 "knn_lambda": 1.5,
 "knn_decay": null,
 "co_window": 600,
 "co_kappa": 2.0
}
```
