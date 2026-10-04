# Footprint prediction: codex

Changes: 6777: burn-in 677 (history only), tuning 2711, evaluation 3389 (the last 50% by merge order). Thresholds, top-k, calibration and blend weights are fitted on the tuning slice only. P / R / F1 are micro-averaged over (change, module) pairs at the threshold that maximises F1 on the tuning slice; R@k is the share of actual modules found in the top k; hit@1 is the share of changes whose top-1 module is touched.

### Title only (headline), all modules

| method | thr | P | R | F1 | per-change P/R/F1 | top-k (k) P/R/F1 | R@1 | R@3 | R@5 | hit@1 | avg pred |
|---|---|---|---|---|---|---|---|---|---|---|---|
| prior | 0.114 | 0.176 | 0.294 | 0.220 | 0.18/0.32/0.20 | (10) 0.15/0.34/0.21 | 0.063 | 0.152 | 0.227 | 0.28 | 7.5 |
| lexical | 0.115 | 0.189 | 0.319 | 0.237 | 0.20/0.41/0.22 | (7) 0.19/0.30/0.23 | 0.068 | 0.162 | 0.236 | 0.30 | 7.6 |
| knn | 0.206 | 0.384 | 0.402 | 0.393 | 0.38/0.46/0.36 | (6) 0.32/0.43/0.36 | 0.117 | 0.280 | 0.387 | 0.53 | 4.7 |
| cochange | 0.125 | 0.276 | 0.139 | 0.185 | 0.13/0.16/0.12 | (8) 0.21/0.30/0.25 | 0.047 | 0.137 | 0.218 | 0.21 | 2.3 |
| combined | 0.196 | 0.386 | 0.424 | 0.404 | 0.39/0.51/0.38 | (5) 0.37/0.41/0.39 | 0.129 | 0.299 | 0.411 | 0.58 | 4.9 |

### Does text add anything over the prior? (title only, all modules)

Difference to the `prior` baseline (top modules by recent frequency, no text), 95% interval from a block bootstrap over evaluation changes. An interval that excludes 0 means the method adds something over the prior.

| method | dF1 | dR@1 | dR@3 | dR@5 |
|---|---|---|---|---|
| lexical | +0.017 [+0.008, +0.026] | +0.005 [+0.000, +0.012] | +0.010 [+0.001, +0.020] | +0.009 [-0.002, +0.021] |
| knn | +0.173 [+0.163, +0.183] | +0.054 [+0.049, +0.060] | +0.128 [+0.117, +0.139] | +0.161 [+0.151, +0.172] |
| cochange | -0.035 [-0.051, -0.017] | -0.016 [-0.022, -0.009] | -0.015 [-0.026, -0.003] | -0.008 [-0.023, +0.006] |
| combined | +0.184 [+0.174, +0.195] | +0.067 [+0.061, +0.072] | +0.147 [+0.136, +0.157] | +0.184 [+0.172, +0.197] |

### Operating points and change size (title only, all modules)

`combined`, micro P / R / F1 on the evaluation slice at fixed thresholds, with the `prior` for reference:

| threshold | combined P | R | F1 | avg predicted | prior P | R | F1 |
|---|---|---|---|---|---|---|---|
| 0.05 | 0.184 | 0.710 | 0.293 | 17.3 | 0.114 | 0.468 | 0.183 |
| 0.1 | 0.269 | 0.584 | 0.368 | 9.7 | 0.165 | 0.321 | 0.218 |
| 0.2 | 0.390 | 0.419 | 0.404 | 4.8 | 0.242 | 0.117 | 0.158 |
| 0.3 | 0.492 | 0.300 | 0.372 | 2.7 | 0.000 | 0.000 | 0.000 |
| 0.4 | 0.569 | 0.212 | 0.308 | 1.7 | 0.000 | 0.000 | 0.000 |
| 0.5 | 0.645 | 0.140 | 0.230 | 1.0 | 0.000 | 0.000 | 0.000 |
| 0.7 | 0.782 | 0.047 | 0.089 | 0.3 | 0.000 | 0.000 | 0.000 |

Recall by the number of modules the change actually touched (`combined` vs `prior`, tuned thresholds):

| modules touched | changes | combined recall | combined precision | prior recall |
|---|---|---|---|---|
| 1 | 735 | 0.605 | 0.164 | 0.279 |
| 2-3 | 1161 | 0.548 | 0.292 | 0.362 |
| 4-8 | 1034 | 0.458 | 0.447 | 0.329 |
| 9+ | 459 | 0.312 | 0.644 | 0.232 |

Threshold chosen on the tuning slice to reach a target micro recall (the kill condition is recall < 0.6), reported on the evaluation slice:

| method | target recall | threshold | P | R | F1 | avg predicted |
|---|---|---|---|---|---|---|
| combined | 0.6 | 0.088 | 0.251 | 0.610 | 0.355 | 10.9 |
| combined | 0.8 | 0.021 | 0.117 | 0.813 | 0.205 | 31.1 |
| knn | 0.6 | 0.092 | 0.228 | 0.618 | 0.333 | 12.2 |
| knn | 0.8 | 0.020 | 0.099 | 0.821 | 0.176 | 37.2 |
| prior | 0.6 | 0.034 | 0.088 | 0.568 | 0.152 | 28.9 |
| prior | 0.8 | unreachable | | | | |

Calibration of `combined` over the 581138 scored (change, module) pairs: ECE 0.0018, Brier 0.0189.

Modules made only of dissolvable files (lockfile, changelog, snapshot, generated) are ignored in the substantive view: codex-rs/cli/src/snapshots, codex-rs/cli/tests/snapshots, codex-rs/codex-mcp/src/snapshots, codex-rs/ext/skills/tests/snapshots, codex-rs/hooks/schema/generated, codex-rs/mermaid/src/snapshots, codex-rs/tui/src/snapshots.

### Substantive view, title only

| method | thr | P | R | F1 | per-change P/R/F1 | top-k (k) P/R/F1 | R@1 | R@3 | R@5 | hit@1 | avg pred |
|---|---|---|---|---|---|---|---|---|---|---|---|
| prior | 0.114 | 0.176 | 0.297 | 0.221 | 0.18/0.32/0.20 | (10) 0.15/0.35/0.21 | 0.063 | 0.154 | 0.229 | 0.28 | 7.5 |
| lexical | 0.115 | 0.193 | 0.315 | 0.240 | 0.21/0.41/0.23 | (8) 0.18/0.33/0.24 | 0.070 | 0.166 | 0.239 | 0.31 | 7.2 |
| knn | 0.206 | 0.383 | 0.403 | 0.393 | 0.38/0.47/0.36 | (6) 0.32/0.43/0.36 | 0.118 | 0.282 | 0.390 | 0.53 | 4.7 |
| cochange | 0.125 | 0.276 | 0.140 | 0.186 | 0.13/0.16/0.12 | (8) 0.21/0.30/0.25 | 0.048 | 0.138 | 0.220 | 0.21 | 2.2 |
| combined | 0.196 | 0.386 | 0.425 | 0.405 | 0.40/0.51/0.38 | (5) 0.37/0.41/0.39 | 0.131 | 0.302 | 0.413 | 0.58 | 4.9 |

### Does text add anything over the prior? (title only, substantive view)

Difference to the `prior` baseline (top modules by recent frequency, no text), 95% interval from a block bootstrap over evaluation changes. An interval that excludes 0 means the method adds something over the prior.

| method | dF1 | dR@1 | dR@3 | dR@5 |
|---|---|---|---|---|
| lexical | +0.019 [+0.010, +0.028] | +0.006 [+0.001, +0.013] | +0.012 [+0.003, +0.022] | +0.011 [-0.000, +0.022] |
| knn | +0.172 [+0.162, +0.182] | +0.055 [+0.050, +0.061] | +0.129 [+0.117, +0.139] | +0.161 [+0.150, +0.172] |
| cochange | -0.035 [-0.051, -0.017] | -0.016 [-0.022, -0.010] | -0.015 [-0.027, -0.004] | -0.009 [-0.023, +0.005] |
| combined | +0.184 [+0.173, +0.195] | +0.067 [+0.062, +0.073] | +0.148 [+0.136, +0.158] | +0.184 [+0.171, +0.196] |

### Ceilings (evaluation slice, all modules, title-only candidate pool)

- reachable recall (actual module exists in the tree at the parent or in earlier history): 0.987
- candidate-pool recall of the combined method (actual module is among the scored candidates): 0.953

### Fitted settings (tuning slice)

```
{
 "prior_window": 4000,
 "prior_halflife": 80,
 "lex_name_weight": 1.5,
 "lex_alpha": 0.25,
 "knn_k": 60,
 "knn_power": 2.0,
 "knn_lambda": 0.5,
 "knn_decay": null,
 "co_window": null,
 "co_kappa": 2.0
}
```
