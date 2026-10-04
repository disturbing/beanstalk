# Footprint prediction: workers-sdk

Changes: 1286: burn-in 128 (history only), tuning 515, evaluation 643 (the last 50% by merge order). Thresholds, top-k, calibration and blend weights are fitted on the tuning slice only. P / R / F1 are micro-averaged over (change, module) pairs at the threshold that maximises F1 on the tuning slice; R@k is the share of actual modules found in the top k; hit@1 is the share of changes whose top-1 module is touched.

### Title only (headline), all modules

| method | thr | P | R | F1 | per-change P/R/F1 | top-k (k) P/R/F1 | R@1 | R@3 | R@5 | hit@1 | avg pred |
|---|---|---|---|---|---|---|---|---|---|---|---|
| prior | 0.139 | 0.356 | 0.190 | 0.248 | 0.37/0.27/0.28 | (3) 0.39/0.18/0.25 | 0.124 | 0.181 | 0.212 | 0.81 | 3.5 |
| lexical | 0.085 | 0.140 | 0.200 | 0.165 | 0.15/0.27/0.16 | (7) 0.16/0.18/0.17 | 0.038 | 0.099 | 0.143 | 0.25 | 9.3 |
| knn | 0.168 | 0.450 | 0.309 | 0.367 | 0.56/0.42/0.40 | (4) 0.45/0.28/0.34 | 0.129 | 0.241 | 0.305 | 0.84 | 4.5 |
| cochange | 0.147 | 0.308 | 0.255 | 0.279 | 0.31/0.37/0.27 | (5) 0.37/0.26/0.30 | 0.104 | 0.203 | 0.257 | 0.67 | 5.4 |
| combined | 0.166 | 0.446 | 0.349 | 0.392 | 0.52/0.48/0.42 | (5) 0.43/0.33/0.37 | 0.129 | 0.255 | 0.329 | 0.84 | 5.1 |

### Does text add anything over the prior? (title only, all modules)

Difference to the `prior` baseline (top modules by recent frequency, no text), 95% interval from a block bootstrap over evaluation changes. An interval that excludes 0 means the method adds something over the prior.

| method | dF1 | dR@1 | dR@3 | dR@5 |
|---|---|---|---|---|
| lexical | -0.083 [-0.107, -0.066] | -0.087 [-0.101, -0.078] | -0.083 [-0.099, -0.071] | -0.069 [-0.085, -0.055] |
| knn | +0.119 [+0.096, +0.140] | +0.005 [+0.002, +0.008] | +0.059 [+0.048, +0.072] | +0.092 [+0.077, +0.112] |
| cochange | +0.031 [+0.006, +0.051] | -0.020 [-0.026, -0.015] | +0.022 [+0.010, +0.032] | +0.045 [+0.029, +0.063] |
| combined | +0.144 [+0.122, +0.162] | +0.005 [+0.002, +0.008] | +0.074 [+0.061, +0.087] | +0.117 [+0.099, +0.138] |

### Operating points and change size (title only, all modules)

`combined`, micro P / R / F1 on the evaluation slice at fixed thresholds, with the `prior` for reference:

| threshold | combined P | R | F1 | avg predicted | prior P | R | F1 |
|---|---|---|---|---|---|---|---|
| 0.05 | 0.235 | 0.509 | 0.322 | 14.0 | 0.119 | 0.367 | 0.179 |
| 0.1 | 0.346 | 0.417 | 0.378 | 7.8 | 0.293 | 0.206 | 0.242 |
| 0.2 | 0.484 | 0.326 | 0.390 | 4.4 | 0.547 | 0.154 | 0.240 |
| 0.3 | 0.575 | 0.276 | 0.373 | 3.1 | 0.609 | 0.143 | 0.232 |
| 0.4 | 0.634 | 0.233 | 0.340 | 2.4 | 0.807 | 0.124 | 0.216 |
| 0.5 | 0.689 | 0.204 | 0.315 | 1.9 | 0.807 | 0.124 | 0.216 |
| 0.7 | 0.789 | 0.154 | 0.258 | 1.3 | 0.807 | 0.124 | 0.216 |

Recall by the number of modules the change actually touched (`combined` vs `prior`, tuned thresholds):

| modules touched | changes | combined recall | combined precision | prior recall |
|---|---|---|---|---|
| 1 | 65 | 0.523 | 0.129 | 0.154 |
| 2-3 | 234 | 0.604 | 0.385 | 0.382 |
| 4-8 | 216 | 0.449 | 0.471 | 0.251 |
| 9+ | 128 | 0.223 | 0.577 | 0.107 |

Threshold chosen on the tuning slice to reach a target micro recall (the kill condition is recall < 0.6), reported on the evaluation slice:

| method | target recall | threshold | P | R | F1 | avg predicted |
|---|---|---|---|---|---|---|
| combined | 0.6 | 0.024 | 0.125 | 0.633 | 0.209 | 32.8 |
| combined | 0.8 | 0.007 | 0.035 | 0.839 | 0.066 | 157.6 |
| knn | 0.6 | 0.016 | 0.102 | 0.634 | 0.176 | 40.1 |
| knn | 0.8 | unreachable | | | | |
| prior | 0.6 | unreachable | | | | |
| prior | 0.8 | unreachable | | | | |

Calibration of `combined` over the 144780 scored (change, module) pairs: ECE 0.0017, Brier 0.0185.

Modules made only of dissolvable files (lockfile, changelog, snapshot, generated) are ignored in the substantive view: .changeset, packages/codemods/test/__snapshots__, packages/miniflare/test/snapshots, packages/wrangler/src/build.

### Substantive view, title only

| method | thr | P | R | F1 | per-change P/R/F1 | top-k (k) P/R/F1 | R@1 | R@3 | R@5 | hit@1 | avg pred |
|---|---|---|---|---|---|---|---|---|---|---|---|
| prior | 0.066 | 0.096 | 0.194 | 0.129 | 0.10/0.22/0.11 | (7) 0.12/0.14/0.13 | 0.038 | 0.083 | 0.113 | 0.22 | 11.5 |
| lexical | 0.085 | 0.134 | 0.217 | 0.166 | 0.14/0.32/0.16 | (7) 0.16/0.19/0.17 | 0.042 | 0.109 | 0.158 | 0.24 | 9.2 |
| knn | 0.130 | 0.326 | 0.225 | 0.266 | 0.30/0.31/0.26 | (6) 0.25/0.26/0.26 | 0.075 | 0.177 | 0.234 | 0.43 | 3.9 |
| cochange | 0.103 | 0.170 | 0.238 | 0.198 | 0.16/0.37/0.18 | (6) 0.22/0.21/0.21 | 0.060 | 0.142 | 0.190 | 0.34 | 8.0 |
| combined | 0.117 | 0.304 | 0.306 | 0.305 | 0.32/0.44/0.31 | (6) 0.28/0.29/0.29 | 0.081 | 0.195 | 0.268 | 0.46 | 5.7 |

### Does text add anything over the prior? (title only, substantive view)

Difference to the `prior` baseline (top modules by recent frequency, no text), 95% interval from a block bootstrap over evaluation changes. An interval that excludes 0 means the method adds something over the prior.

| method | dF1 | dR@1 | dR@3 | dR@5 |
|---|---|---|---|---|
| lexical | +0.037 [+0.020, +0.055] | +0.003 [-0.004, +0.011] | +0.026 [+0.013, +0.040] | +0.045 [+0.029, +0.063] |
| knn | +0.138 [+0.112, +0.170] | +0.037 [+0.029, +0.045] | +0.094 [+0.076, +0.114] | +0.122 [+0.102, +0.146] |
| cochange | +0.070 [+0.050, +0.093] | +0.022 [+0.016, +0.032] | +0.058 [+0.044, +0.076] | +0.077 [+0.059, +0.099] |
| combined | +0.176 [+0.154, +0.202] | +0.043 [+0.033, +0.052] | +0.111 [+0.092, +0.133] | +0.155 [+0.133, +0.183] |

### Ceilings (evaluation slice, all modules, title-only candidate pool)

- reachable recall (actual module exists in the tree at the parent or in earlier history): 0.965
- candidate-pool recall of the combined method (actual module is among the scored candidates): 0.863

### Fitted settings (tuning slice)

```
{
 "prior_window": 320,
 "prior_halflife": 80,
 "lex_name_weight": 1.5,
 "lex_alpha": 0.0,
 "knn_k": 20,
 "knn_power": 1.0,
 "knn_lambda": 1.5,
 "knn_decay": 300.0,
 "co_window": null,
 "co_kappa": 2.0
}
```
