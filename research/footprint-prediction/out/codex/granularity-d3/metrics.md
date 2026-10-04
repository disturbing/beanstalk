# Footprint prediction: codex

Changes: 6777: burn-in 677 (history only), tuning 2711, evaluation 3389 (the last 50% by merge order). Thresholds, top-k, calibration and blend weights are fitted on the tuning slice only. P / R / F1 are micro-averaged over (change, module) pairs at the threshold that maximises F1 on the tuning slice; R@k is the share of actual modules found in the top k; hit@1 is the share of changes whose top-1 module is touched.

### Title only (headline), all modules

| method | thr | P | R | F1 | per-change P/R/F1 | top-k (k) P/R/F1 | R@1 | R@3 | R@5 | hit@1 | avg pred |
|---|---|---|---|---|---|---|---|---|---|---|---|
| prior | 0.101 | 0.163 | 0.270 | 0.203 | 0.17/0.29/0.18 | (9) 0.16/0.28/0.20 | 0.054 | 0.131 | 0.195 | 0.27 | 8.3 |
| lexical | 0.107 | 0.163 | 0.282 | 0.206 | 0.17/0.36/0.19 | (9) 0.16/0.28/0.20 | 0.051 | 0.125 | 0.186 | 0.25 | 8.7 |
| knn | 0.178 | 0.373 | 0.375 | 0.374 | 0.37/0.43/0.34 | (7) 0.30/0.42/0.35 | 0.103 | 0.246 | 0.345 | 0.52 | 5.1 |
| cochange | 0.122 | 0.256 | 0.138 | 0.180 | 0.13/0.17/0.12 | (9) 0.20/0.28/0.23 | 0.043 | 0.122 | 0.189 | 0.22 | 2.7 |
| combined | 0.171 | 0.378 | 0.400 | 0.388 | 0.38/0.48/0.36 | (7) 0.31/0.44/0.37 | 0.112 | 0.261 | 0.363 | 0.56 | 5.3 |

### Does text add anything over the prior? (title only, all modules)

Difference to the `prior` baseline (top modules by recent frequency, no text), 95% interval from a block bootstrap over evaluation changes. An interval that excludes 0 means the method adds something over the prior.

| method | dF1 | dR@1 | dR@3 | dR@5 |
|---|---|---|---|---|
| lexical | +0.003 [-0.005, +0.012] | -0.004 [-0.009, +0.002] | -0.006 [-0.015, +0.004] | -0.008 [-0.018, +0.003] |
| knn | +0.170 [+0.160, +0.181] | +0.048 [+0.044, +0.053] | +0.115 [+0.107, +0.124] | +0.150 [+0.142, +0.159] |
| cochange | -0.024 [-0.041, -0.007] | -0.012 [-0.017, -0.006] | -0.009 [-0.017, +0.000] | -0.005 [-0.018, +0.006] |
| combined | +0.185 [+0.175, +0.195] | +0.057 [+0.052, +0.063] | +0.130 [+0.120, +0.139] | +0.169 [+0.159, +0.179] |

### Operating points and change size (title only, all modules)

`combined`, micro P / R / F1 on the evaluation slice at fixed thresholds, with the `prior` for reference:

| threshold | combined P | R | F1 | avg predicted | prior P | R | F1 |
|---|---|---|---|---|---|---|---|
| 0.05 | 0.186 | 0.676 | 0.291 | 18.3 | 0.105 | 0.438 | 0.169 |
| 0.1 | 0.282 | 0.533 | 0.369 | 9.5 | 0.163 | 0.271 | 0.203 |
| 0.2 | 0.410 | 0.358 | 0.383 | 4.4 | 0.238 | 0.098 | 0.139 |
| 0.3 | 0.508 | 0.243 | 0.329 | 2.4 | 0.000 | 0.000 | 0.000 |
| 0.4 | 0.584 | 0.163 | 0.255 | 1.4 | 0.000 | 0.000 | 0.000 |
| 0.5 | 0.674 | 0.103 | 0.179 | 0.8 | 0.000 | 0.000 | 0.000 |
| 0.7 | 0.809 | 0.028 | 0.054 | 0.2 | 0.000 | 0.000 | 0.000 |

Recall by the number of modules the change actually touched (`combined` vs `prior`, tuned thresholds):

| modules touched | changes | combined recall | combined precision | prior recall |
|---|---|---|---|---|
| 1 | 647 | 0.587 | 0.152 | 0.238 |
| 2-3 | 1093 | 0.529 | 0.265 | 0.311 |
| 4-8 | 1094 | 0.444 | 0.420 | 0.312 |
| 9+ | 555 | 0.303 | 0.616 | 0.226 |

Threshold chosen on the tuning slice to reach a target micro recall (the kill condition is recall < 0.6), reported on the evaluation slice:

| method | target recall | threshold | P | R | F1 | avg predicted |
|---|---|---|---|---|---|---|
| combined | 0.6 | 0.077 | 0.242 | 0.587 | 0.343 | 12.2 |
| combined | 0.8 | 0.019 | 0.107 | 0.802 | 0.189 | 37.6 |
| knn | 0.6 | 0.084 | 0.218 | 0.592 | 0.319 | 13.7 |
| knn | 0.8 | 0.019 | 0.093 | 0.806 | 0.166 | 43.7 |
| prior | 0.6 | unreachable | | | | |
| prior | 0.8 | unreachable | | | | |

Calibration of `combined` over the 647939 scored (change, module) pairs: ECE 0.0021, Brier 0.0194.

Modules made only of dissolvable files (lockfile, changelog, snapshot, generated) are ignored in the substantive view: codex-rs/cli/src/doctor/snapshots, codex-rs/cli/src/snapshots, codex-rs/cli/tests/snapshots, codex-rs/codex-mcp/src/snapshots, codex-rs/core/src/guardian/snapshots, codex-rs/core/src/session/snapshots, codex-rs/core/src/unified_exec/snapshots, codex-rs/core/tests/suite/snapshots, codex-rs/ext/skills/tests/snapshots, codex-rs/hooks/schema/generated, codex-rs/mermaid/src/snapshots, codex-rs/tui/src/analytics/snapshots, codex-rs/tui/src/app/snapshots, codex-rs/tui/src/bottom_pane/snapshots, codex-rs/tui/src/chatwidget/snapshots, codex-rs/tui/src/clipboard_copy/snapshots, codex-rs/tui/src/exec_cell/snapshots, codex-rs/tui/src/external_agent_config_migration/snapshots, codex-rs/tui/src/history_cell/snapshots, codex-rs/tui/src/markdown_render/snapshots, codex-rs/tui/src/onboarding/snapshots, codex-rs/tui/src/pager_overlay/snapshots, codex-rs/tui/src/render/snapshots, codex-rs/tui/src/snapshots, codex-rs/tui/src/status/snapshots, codex-rs/tui/src/status_indicator_widget/snapshots, codex-rs/tui/src/streaming/snapshots, codex-rs/tui/src/thread_transcript/snapshots, codex-rs/tui/src/tooltips/snapshots, codex-rs/tui/src/transcript_view/snapshots, codex-rs/tui/src/tui/snapshots, codex-rs/tui/tests/suite/snapshots, sdk/python/src/codex_app_server/generated, sdk/python/src/openai_codex/generated.

### Substantive view, title only

| method | thr | P | R | F1 | per-change P/R/F1 | top-k (k) P/R/F1 | R@1 | R@3 | R@5 | hit@1 | avg pred |
|---|---|---|---|---|---|---|---|---|---|---|---|
| prior | 0.102 | 0.164 | 0.279 | 0.207 | 0.17/0.30/0.19 | (9) 0.16/0.29/0.20 | 0.057 | 0.137 | 0.203 | 0.27 | 8.2 |
| lexical | 0.093 | 0.178 | 0.299 | 0.223 | 0.19/0.38/0.21 | (8) 0.18/0.30/0.23 | 0.061 | 0.151 | 0.219 | 0.29 | 8.1 |
| knn | 0.178 | 0.372 | 0.385 | 0.379 | 0.37/0.45/0.35 | (6) 0.32/0.39/0.35 | 0.107 | 0.257 | 0.357 | 0.52 | 5.0 |
| cochange | 0.130 | 0.266 | 0.132 | 0.177 | 0.13/0.16/0.12 | (8) 0.21/0.27/0.23 | 0.045 | 0.127 | 0.197 | 0.22 | 2.4 |
| combined | 0.171 | 0.379 | 0.405 | 0.392 | 0.39/0.49/0.37 | (7) 0.31/0.45/0.37 | 0.117 | 0.272 | 0.376 | 0.56 | 5.2 |

### Does text add anything over the prior? (title only, substantive view)

Difference to the `prior` baseline (top modules by recent frequency, no text), 95% interval from a block bootstrap over evaluation changes. An interval that excludes 0 means the method adds something over the prior.

| method | dF1 | dR@1 | dR@3 | dR@5 |
|---|---|---|---|---|
| lexical | +0.016 [+0.008, +0.025] | +0.004 [-0.002, +0.010] | +0.014 [+0.005, +0.023] | +0.016 [+0.006, +0.026] |
| knn | +0.172 [+0.162, +0.181] | +0.050 [+0.046, +0.056] | +0.120 [+0.113, +0.129] | +0.154 [+0.145, +0.164] |
| cochange | -0.030 [-0.045, -0.014] | -0.012 [-0.018, -0.007] | -0.009 [-0.018, +0.000] | -0.007 [-0.019, +0.005] |
| combined | +0.185 [+0.175, +0.196] | +0.060 [+0.055, +0.066] | +0.135 [+0.127, +0.145] | +0.173 [+0.163, +0.185] |

### Ceilings (evaluation slice, all modules, title-only candidate pool)

- reachable recall (actual module exists in the tree at the parent or in earlier history): 0.986
- candidate-pool recall of the combined method (actual module is among the scored candidates): 0.948

### Fitted settings (tuning slice)

```
{
 "prior_window": 1000,
 "prior_halflife": 160,
 "lex_name_weight": 1.5,
 "lex_alpha": 0.25,
 "knn_k": 60,
 "knn_power": 2.0,
 "knn_lambda": 0.1,
 "knn_decay": null,
 "co_window": null,
 "co_kappa": 2.0
}
```
