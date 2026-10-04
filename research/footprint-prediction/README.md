# Step 2: footprint prediction

**Question.** Before a change is written, can we predict which modules it will touch from its task text plus information available before the change (history strictly earlier, the tree at its parent)? This decides whether a scheduler can place agent tasks so that they do not collide. Spec and data contracts: `../README.md`. Thesis: `../../docs/claude-opus/02-thesis-concurrency-control.md`.

**Kill condition (from the spec).** Module recall < 0.6, or most real conflicting pairs not flagged.

Every number below is **measured**, on the last 50% of each corpus in merge order (evaluation slice: workers-sdk changes 643 to 1285, 2026-06-11 to 2026-10-02; codex 3388 to 6776, 2026-07-20 to 2026-10-02; platform 1295 to 2589, 2026-05-28 to 2026-09-24), with every threshold, top-k, calibration and blend weight fitted on the first 50% only. Headline text is the **title only** (PR bodies are often written after the fact). Platform is private: only aggregate numbers appear here; everything it produces stays under `out/private/platform/`.

## Answer

**Partly: text plus history clearly beats the history-only baseline, but it is not accurate enough at module granularity to schedule on its own.**

1. **Text adds a lot over the prior** ("the top modules by recent frequency"). Title-only, micro F1 at the tuned threshold: workers-sdk 0.658 vs 0.540, codex 0.500 vs 0.332, platform 0.540 vs 0.414. The paired block-bootstrap interval of the difference excludes 0 in every case (dF1 +0.12, +0.17, +0.13). Nearly all of the gain comes from `knn` (similar past titles vote for their modules); `combined` adds +0.01 to +0.05 F1 on top.
2. **Recall is below the 0.6 line at the F1-optimal operating point on all three corpora**: micro recall 0.58 (workers-sdk), 0.47 (codex), 0.49 (platform); 0.51 for workers-sdk once the trivially predictable `.changeset` module is ignored. Recall@5 is 0.76 / 0.65 / 0.72. Asking for recall 0.6 means predicting about 2.5 to 3.3 modules per change at precision 0.43 to 0.73 (workers-sdk, codex). Most misses are wide changes: 59 to 70% of the missed modules belong to changes touching four or more modules.
3. **Pair flagging.** Predicted module sets intersect for most real conflicting pairs (conflict recall 0.87 to 0.93 at the tuned threshold) but also for a large share of clean pairs (clean flag rate 0.53 to 0.90), so the flag is only weakly informative (lift over the base conflict rate 1.0 to 1.6; 1.2 to 1.3 for workers-sdk without `.changeset` and platform). The limit is the granularity, not the predictor: **even an oracle that knows the actual modules flags 33 to 74% of clean pairs** (36% for workers-sdk without `.changeset`; a file-level oracle flags 4 to 6%). Directories one to three levels below the module root are a better unit (see "Granularity" below). If the 19 most recent changes are also withheld (concurrent agents do not know each other's footprints), module-level accuracy barely moves but the codex lift at the tuned threshold falls from 1.6 to 1.3 ("Concurrent changes are unknown" below).
4. **Verdict against the kill condition.** Recall < 0.6 holds (title-only, F1-optimal threshold). "Most conflicting pairs not flagged" does not hold, but only because the flag is cheap: it also flags most clean pairs. Module-level prediction alone is not a good basis for placement; step 3 should use the measured `conflict_recall` / `clean_flag_rate` curves (`pair_flagging.summary` in `metrics.json`) and treat the module flag as a coarse filter, or move to directory-level footprints.
5. **Jev (item 6 of the spec) was not run.** The API answered every request with HTTP 402 `billing_error` ("Your organization has no available TypeSafe API credits"). Details and how to run it once credits exist are in "Jev" below.

## Run it

```bash
cd research/footprint-prediction
python3 predict.py workers-sdk              # ~25 s;  also: codex (~2.5 min), platform (~40 s, private)
python3 predict.py --export-defaults        # writes defaults.json (used by predictor.predict)
python3 evaluate_pairs.py workers-sdk --update-metrics   # needs ../contention-replay/out/<corpus>/pairs.jsonl (step 1)
python3 jev_client.py run workers-sdk && python3 jev_client.py evaluate workers-sdk   # needs TypeSafe credits (or: predict.py workers-sdk --jev)
python3 -m unittest discover -s tests       # 93 tests, ~35 s
```

Runs are deterministic: a second run reproduces `metrics.json` and `predictions.jsonl` byte for byte (checked on all three corpora). `predict.py --help`, `evaluate_pairs.py --help`, `jev_client.py --help` list every option (`--quick` for a small grid, `--dev` to use only the first half of a corpus, `--granularity D` for the directory experiment, `--lag L` for the concurrent-changes experiment, `--seed`).

| file | what |
|---|---|
| `predictor.py` | the library: `predict(text, ctx) -> {module: probability}`; all five methods; `ctx_from_dir(path)` builds `ctx["modules"]` from a checkout |
| `predict.py` | CLI: tree replay, tuning, calibration and blend, metrics, `predictions.jsonl`, `metrics.json`, `metrics.md`, `fit.json`, `jev_inputs.jsonl` |
| `evaluate_pairs.py` | pair flagging against step 1's `pairs.jsonl`; writes `pair_flagging.json/.md` and (with `--update-metrics`) the `pair_flagging` key of `metrics.json`; `pair_flagging.summary[view][method]` is the flat per-threshold list (`conflict_recall`, `clean_flag_rate`, ...) |
| `jev_client.py` | Jev client (key read in-process, 8 concurrent requests, 1,000-call ledger), runner and Jev-vs-combined evaluation |
| `defaults.json` | calibrators and parameters shipped for `predict()` (lexical calibration pooled over workers-sdk and codex; history-mode blend fitted on codex) |
| `tests/` | 93 unit and integration tests (synthetic git repo, mock Jev server, hand-computed pair flagging) |
| `out/<corpus>/` | outputs; platform under `out/private/platform/` only. `granularity-dN/` subfolders hold the directory experiment. `.gitignore` here excludes the large `predictions.jsonl` dumps (they regenerate byte-for-byte) |

Output layout (`out/<corpus>/`, platform under `out/private/platform/`):

```
predictions.jsonl   {id, seq, split: tune|eval, actual_modules[], pred: {method: {module: prob}}}   (tune = the first half, including the burn-in
                    changes, which are scored but never used for fitting)
                    methods: prior, lexical, knn, cochange, combined; "+body" suffix = title + body (no prior)
metrics.json        corpus, burn_in, tune_range, eval_range, seed, granularity, lag
                    methods.<m>                {threshold, precision, recall, f1, micro, per_change, top_k{k, ...}, recall_at{1,3,5},
                                                at_recall{0.6,0.8}, operating_points[], by_size[], calibration, vs_prior, tuning_f1}
                    methods_title_body.<m>     same for the title + body variant
                    substantive.methods[_title_body]   same without dissolvable-only modules (workers-sdk, platform)
                    ceilings, dissolvable_only_modules, fit
                    pair_flagging              {counts, base_rate, views.{all,substantive}.{oracle_module, oracle_file, methods.<m>.{thresholds[], topk[], tuned}},
                                                summary.<view>.<method>[] = {threshold, conflict_recall, clean_flag_rate, flag_precision, lift, ...}}
                    jev                        after `jev_client.py evaluate`
metrics.md          the same, rendered      fit.json   chosen hyperparameters, tuning grids, calibrators and blend weights
pair_flagging.json/.md   jev_inputs.jsonl (sampled changes, top-30 candidates, representative files)
```

Using the library for the step 4 demo (no history):

```python
import sys; sys.path.insert(0, "research/footprint-prediction")
from predictor import predict, ctx_from_dir
ctx = ctx_from_dir("research/arena/app", depth=2)       # {"modules": {"src/cart": [paths], ...}}
predict("Orders should be cancelled when payment fails", ctx)   # {"src/orders": 0.24, "src/db": 0.05, ...}
```

With `ctx["history"]` (corpus records, oldest first) it blends all signals using `defaults.json`; without history it returns the calibrated lexical score. The first line of `text` is the title, the rest is the body (used with `use_body=True`).

## Method

### Protocol (time-respecting)

* Each corpus is the first-parent change list in merge order. For change *k* a method may use only changes with `seq < k` (their text, modules and files) and the tree at *k*'s parent.
* The tree is replayed from the bare repo: `ls-tree` at the first parent, then `git log --first-parent --name-status` over the whole range, including commits that are not corpus changes (bots, empty, oversize), so the tracked tree equals `git ls-tree` of each change's parent. This is checked at 30 random changes per run (`--verify-tree`) and at every change in a unit test. Modules are the corpus's own labels (nearest package root at the newest commit).
* Text variants: `title` is the PR title with the trailing `(#123)` removed; `title + body` adds the PR body (trailers, comments, images, URLs and e-mail addresses stripped, first 2,500 characters). The variant applies to the query and to the history documents of `knn` alike, and every hyperparameter search and fit is repeated per variant.
* The first 10% of each corpus is **burn-in** (history only; not scored, not used for fitting). Changes from burn-in to 50% are the **tuning slice**; the last 50% is the **evaluation slice**. Hyperparameters (small grids in `predict.py`, objective: best-threshold micro F1 on the tuning slice), isotonic calibration, blend weights, F1 thresholds and top-k are all fitted on the tuning slice. Evaluation changes still see all earlier changes (including earlier evaluation changes) as history, as an online system would.
* `tests/test_predict_cli.py::test_final_pass_is_time_respecting` rewrites the labels (and, separately, the text) of every change from *K* on and asserts that predictions up to *K* do not move. Design iteration used `--dev` (first half of each corpus only; its own 50/50 split), so no design choice looked at the evaluation slices; the one exception is the first end-to-end smoke run on workers-sdk, whose numbers were seen but not used.

### Methods

| method | what it does | tuned |
|---|---|---|
| `prior` | share of the last N changes touching each module, weighted `0.5^(age/halflife)`: an estimate of P(next change touches m). No text. This is the "top-k most frequent modules" baseline (its top-k is reported too). | N, halflife |
| `lexical` | TF-IDF of the task tokens against one document per module, built from the module path (boosted) and the directory and file-name tokens of its files in the tree at the parent. Tokens: camelCase, snake_case, kebab-case and path segments split, stop-words, extensions and commit boilerplate dropped, plural-stemmed. Score `q.d / (\|q\| \|d\|^a ln(1+N)^(1-a))`. Needs no history. | name weight, a |
| `knn` | TF-IDF cosine between the task text and past change texts (idf snapshot refreshed from past documents only); the top-k neighbours vote for their modules, `sum(sim^p) / (sum(sim^p) + lambda)`, optionally with a recency decay. | k, p, lambda, decay |
| `cochange` | Modules the text names explicitly: conventional-commit scopes (`fix(core):`), bracket tags (`[tui]`), `scope:` prefixes, path-like tokens and module names in the text (greedy longest match), resolved against the tree at the parent. Score `1 - prod(1 - conf_r P(m\|r))`, where `P(m\|r)` is the share of past changes touching `r` that also touched `m` and `conf_r` is learned online per (reference kind, module). A scope dictionary learned from history maps tags that match no module name (`[c3]`, `fix(ci):`) to the modules past changes with that tag touched. | window, shrinkage |
| `combined` | Each signal is calibrated to a probability with isotonic regression, then blended with a logistic regression over the logits (`p = sigmoid(b + sum w_i logit(cal_i))`). | weights |
| `jev` | not run, see below | |

Probabilities are calibrated on the tuning slice; on the evaluation slice the expected calibration error of `combined` is 0.002 to 0.005.

### Metrics

Module level, per method: precision / recall / F1 at the threshold that maximises micro F1 on the tuning slice; the same at the top-k with the best tuning F1; recall@1/3/5; micro-averages (pooled over change-module pairs) and per-change means (empty predictions count as precision 0). Also: `hit@1`, operating points at fixed thresholds, thresholds that reach recall 0.6 / 0.8 on the tuning slice, recall by change size, calibration bins, ceilings (an actual module that exists nowhere in the tree or history cannot be predicted: reachable recall is 0.99 on all corpora; the candidate pool contains 0.98 of actual modules), and paired block-bootstrap intervals (blocks of 20 consecutive changes, 300 replicates) for the difference to `prior` and of `combined` to `knn`.

Two views: **all modules** (the spec) and **substantive**, which ignores modules made only of dissolvable files (lockfile, changelog, snapshot, generated). That matters for workers-sdk, where `.changeset` is touched by 77% of changes and is nearly free to predict, and for one platform module. Codex has none.

## Results (evaluation slice, title only unless stated)

Micro P / R / F1 at the tuned threshold; per-change means in brackets.

| corpus (eval changes) | method | P | R | F1 | R@1 | R@3 | R@5 |
|---|---|---|---|---|---|---|---|
| workers-sdk (643) | prior | 0.666 | 0.453 | 0.540 [0.550] | 0.274 | 0.517 [0.575] | 0.619 |
| | **combined** | 0.759 | 0.581 | **0.658** [0.672] | 0.285 | **0.653** [0.766] | 0.760 |
| | knn | 0.729 | 0.581 | 0.646 | 0.288 | 0.635 | 0.741 |
| workers-sdk, substantive | prior | 0.385 | 0.318 | 0.348 [0.358] | 0.246 | 0.414 | 0.545 |
| | **combined** | 0.605 | 0.507 | **0.552** [0.599] | 0.353 | **0.598** | 0.721 |
| codex (3,389) | prior | 0.285 | 0.398 | 0.332 [0.322] | 0.183 | 0.378 [0.473] | 0.452 |
| | **combined** | 0.532 | 0.472 | **0.500** [0.505] | 0.288 | **0.523** [0.667] | 0.645 |
| | knn | 0.477 | 0.468 | 0.472 | 0.266 | 0.502 | 0.619 |
| platform (1,295) | prior | 0.447 | 0.386 | 0.414 [0.443] | 0.254 | 0.479 [0.609] | 0.604 |
| | **combined** | 0.610 | 0.485 | **0.540** [0.592] | 0.341 | **0.607** [0.762] | 0.722 |
| | knn | 0.690 | 0.381 | 0.491 | 0.329 | 0.589 | 0.703 |

(For workers-sdk, `lexical` and `cochange` score F1 0.33 and 0.58 over all modules; for codex 0.37 and 0.26; for platform 0.39 and 0.33. Full tables for every method, variant and view: `out/<corpus>/metrics.md`.)

**Does text add anything over the prior?** Difference to `prior` with 95% interval (title only, all modules):

| corpus | knn dF1 | combined dF1 | combined dR@3 | combined dR@5 | combined minus knn dF1 |
|---|---|---|---|---|---|
| workers-sdk | +0.107 [+0.093, +0.123] | +0.118 [+0.100, +0.138] | +0.136 [+0.120, +0.157] | +0.141 [+0.122, +0.164] | +0.012 [-0.001, +0.022] |
| workers-sdk, substantive | +0.168 [+0.145, +0.198] | +0.203 [+0.180, +0.234] | +0.184 [+0.156, +0.217] | +0.176 [+0.148, +0.203] | +0.035 [+0.022, +0.048] |
| codex | +0.140 [+0.127, +0.152] | +0.168 [+0.155, +0.181] | +0.145 [+0.134, +0.157] | +0.193 [+0.181, +0.207] | +0.028 [+0.022, +0.035] |
| platform | +0.076 [+0.048, +0.100] | +0.126 [+0.102, +0.148] | +0.128 [+0.106, +0.147] | +0.118 [+0.099, +0.137] | +0.050 [+0.038, +0.068] |

`lexical` alone (zero history, text against paths) is about as good as the prior: dF1 over all modules +0.03 (codex), -0.02 (platform), -0.21 (workers-sdk, where the prior gets `.changeset` for free); +0.04 in the substantive view of workers-sdk. It is the right fallback when there is no history, not a strong predictor. Pure `cochange` is precise but covers few changes (workers-sdk: precision 0.83 at recall 0.45).

**Title only vs title + body.** Bodies help where they are real descriptions: codex `combined` F1 0.500 to 0.616 (R@5 0.645 to 0.748), platform 0.540 to 0.596; workers-sdk bodies are empty or only co-author trailers in 99.8% of changes, so nothing changes (0.658 to 0.659). Pair flagging gains too: codex `combined` at the tuned threshold keeps conflict recall 0.86 and cuts the clean flag rate from 0.53 to 0.31 (lift 1.6 to 2.7). Bodies are usually written after the change, so treat title + body as an optimistic bound.

**Recall vs precision.** Thresholds fitted on the tuning slice to reach micro recall 0.6 give, on the evaluation slice: workers-sdk R 0.607 at P 0.726 (2.5 predicted modules per change; substantive R 0.614 at P 0.464, 2.8 per change); codex R 0.582 at P 0.426 (3.3 per change). Platform's evaluation half is harder than its tuning half (combined F1 0.754 on tuning vs 0.540 on evaluation; the text-free prior also drops from 0.524 to 0.414), so the same threshold only reaches R 0.315 there. This is drift, not leakage; a real scheduler would re-fit thresholds online.

**Where recall is lost.** Changes touching four or more modules are 15 to 23% of changes but 59 to 70% of the missed modules (miss rate 0.65 to 0.75, against 0.19 to 0.37 for one-module changes). Wide changes (dependency sweeps, renames) are the hard case.

Agent-authored changes in platform are a little more predictable than human ones (combined F1 0.55 to 0.57 vs 0.50).

### Pair flagging (step 1's pairs, window 20)

Pairs where both changes are in the evaluation slice; `entangled` pairs (a later change built on the earlier one, so the pair cannot be isolated) are excluded from every rate and only counted (14%, 17% and 33% of the pairs for workers-sdk, codex and platform). The flag is "predicted module sets intersect". Columns: share of conflicting pairs flagged (**conflict recall**), share of clean pairs flagged (**clean flag rate**), share of flagged pairs that really conflict (**flag precision**) and that divided by the base conflict rate (**lift**). Among pairs that share a file, 22% (workers-sdk), 22% (codex) and 42% (platform) conflict.

| scheme | workers-sdk (126 conflicts / 10,176 clean; base 1.2%) | workers-sdk without `.changeset` | codex (863 / 52,220; base 1.6%) | platform (597 / 15,769; base 3.7%) |
|---|---|---|---|---|
| oracle: actual modules intersect | 1.00 / 0.74 / 1.7% / 1.4 | 0.99 / 0.36 / 3.3% / 2.7 | 1.00 / 0.33 / 4.8% / 2.9 | 1.00 / 0.43 / 8.1% / 2.2 |
| oracle: pair shares a file | 1.00 / 0.04 / 21.9% / 17.9 | same | 1.00 / 0.06 / 21.7% / 13.4 | 1.00 / 0.05 / 41.7% / 11.4 |
| `combined` at its tuned threshold | 0.93 / 0.90 / 1.3% / 1.0 | 0.87 / 0.66 / 1.6% / 1.3 | 0.87 / 0.53 / 2.7% / 1.6 | 0.92 / 0.76 / 4.4% / 1.2 |
| `combined` p >= 0.5 | 0.89 / 0.85 / 1.3% / 1.0 | 0.82 / 0.59 / 1.7% / 1.4 | 0.51 / 0.17 / 4.9% / 3.0 | 0.81 / 0.55 / 5.3% / 1.5 |
| `combined` p >= 0.7 | 0.75 / 0.67 / 1.4% / 1.1 | 0.56 / 0.36 / 1.9% / 1.5 | 0.26 / 0.05 / 8.6% / 5.3 | 0.59 / 0.31 / 6.8% / 1.9 |
| `combined` top-1 module | 0.52 / 0.44 / 1.4% / 1.2 | 0.79 / 0.50 / 1.9% / 1.6 | 0.60 / 0.30 / 3.3% / 2.0 | 0.78 / 0.53 / 5.3% / 1.5 |
| `combined` title + body, tuned thr | 0.93 / 0.90 / 1.3% / 1.0 | 0.86 / 0.66 / 1.6% / 1.3 | 0.86 / 0.31 / 4.4% / 2.7 | 0.87 / 0.62 / 5.1% / 1.4 |
| `prior` at its tuned threshold | 1.00 / 1.00 / 1.2% / 1.0 | 1.00 / 1.00 / 1.2% / 1.0 | 1.00 / 1.00 / 1.6% / 1.0 | 1.00 / 0.99 / 3.7% / 1.0 |

(Cells: conflict recall / clean flag rate / flag precision / lift; population "raw", i.e. every textual conflict counts. Treating conflicts that exist only in dissolvable files as clean, as a merge driver would, changes the numbers by a point or two: `pair_flagging.json`, population `after_drivers`. Thresholds from 0.05 to 0.8 and top-1/2/3/5 for every method and variant are in `out/<corpus>/pair_flagging.json`.)

Reading: the predicted flag catches most conflicts but is a weak filter. Raising the threshold buys selectivity at the cost of recall (codex p >= 0.7: lift 5.3 but only 26% of conflicts flagged), and stays below what even a perfect module oracle achieves. The distance between the module oracle and the file oracle is the real message: **module-level footprints are too coarse to separate colliding from non-colliding pairs, whatever the predictor.**

### Concurrent changes are unknown (supplementary: `--lag 19`)

The spec lets a change see every change that merged before it. For two concurrent changes that is generous: when a scheduler places change *b*, change *a* is still in flight and its real modules are unknown. `predict.py --lag L` withholds the L most recent changes from every history signal (step 1's window is 20, so `--lag 19` guarantees that no change in a pair's window is visible); the search and fits are repeated under that rule. Effect on `combined`, title only, micro F1: workers-sdk 0.658 to 0.648 (substantive 0.552 to 0.528), codex 0.500 to 0.507, platform 0.540 to 0.505; the gain over the prior stays (dF1 +0.11, +0.17, +0.10, intervals exclude 0). Pair flagging reacts more: at the tuned threshold the lift stays 1.3 (workers-sdk, substantive) and 1.2 (platform) but falls from 1.6 to 1.3 in codex (conflict recall 0.87 to 0.93, clean flag rate 0.53 to 0.70); at p >= 0.5 it falls from 3.0 to 2.3 (codex), 1.4 to 1.3 (workers-sdk, substantive) and 1.5 to 1.3 (platform). Part of the signal in the spec's protocol is the recent history of the very changes a pair is made of, which a scheduler placing concurrent tasks would not have. Numbers in the other tables use the spec's rule.

### Granularity (supplementary, not in the spec)

`predict.py --granularity D` predicts "the module plus its first D directories" instead of the module (e.g. `packages/wrangler/src/api`), with the same pipeline and the same step 1 pairs. Substantive view, `combined`, title only; "oracle" is the actual labels intersecting:

| corpus | D | eval labels | `combined` F1 | oracle: clean flag / lift | tuned threshold: conflict recall / clean flag / lift | p >= 0.5: conflict recall / clean flag / lift |
|---|---|---|---|---|---|---|
| workers-sdk | 0 (modules) | 98 | 0.552 | 0.36 / 2.7 | 0.87 / 0.66 / 1.3 | 0.82 / 0.59 / 1.4 |
| | 1 | 209 | 0.486 | 0.29 / 3.3 | 0.92 / 0.83 / 1.1 | 0.74 / 0.53 / 1.4 |
| | 2 | 398 | 0.379 | 0.24 / 4.0 | 0.94 / 0.80 / 1.2 | 0.67 / 0.44 / 1.5 |
| | 3 | 595 | 0.305 | 0.14 / 6.7 | 0.73 / 0.38 / 1.9 | 0.34 / 0.07 / 4.8 |
| codex | 0 (modules) | 163 | 0.500 | 0.33 / 2.9 | 0.87 / 0.53 / 1.6 | 0.51 / 0.17 / 3.0 |
| | 1 | 359 | 0.469 | 0.29 / 3.3 | 0.96 / 0.74 / 1.3 | 0.51 / 0.21 / 2.4 |
| | 2 | 604 | 0.405 | 0.22 / 4.3 | 0.86 / 0.56 / 1.5 | 0.25 / 0.06 / 4.1 |
| | 3 | 709 | 0.392 | 0.21 / 4.4 | 0.91 / 0.60 / 1.5 | 0.21 / 0.05 / 4.4 |
| platform | 0 (modules) | 73 | 0.540 | 0.43 / 2.2 | 0.92 / 0.76 / 1.2 | 0.81 / 0.55 / 1.5 |
| | 1 | 265 | 0.478 | 0.39 / 2.4 | 0.92 / 0.72 / 1.3 | 0.83 / 0.60 / 1.4 |
| | 2 | 552 | 0.396 | 0.31 / 3.0 | 0.90 / 0.69 / 1.3 | 0.55 / 0.25 / 2.1 |
| | 3 | 832 | 0.360 | 0.28 / 3.3 | 0.88 / 0.64 / 1.3 | 0.57 / 0.30 / 1.9 |

(Substantive view where one exists: workers-sdk without `.changeset`, and directories made only of snapshot / lockfile / generated files; codex at D = 0 has none.)

Finer labels are harder to predict (workers-sdk F1 falls from 0.55 to 0.31, codex from 0.50 to 0.39, platform from 0.54 to 0.36 between D = 0 and 3) but separate pairs better: the oracle's clean flag rate falls (workers-sdk 0.36 to 0.14, codex 0.33 to 0.21, platform 0.43 to 0.28) and predicted flags at p >= 0.5 reach lift 4.1 to 4.8 (workers-sdk at D = 3, codex at D = 2 to 3; platform stays at 1.9 to 2.1). Conflict recall falls with it. There is a trade-off curve, not a free lunch; step 3 can use these curves directly (`out/<corpus>/granularity-dN/pair_flagging.json`). Each granularity runs the same search and fitting procedure on its own labels.

## Jev

Plan (implemented, tested against a local mock server, not run against the real API): for a seeded sample per corpus (40 changes from the tuning slice, used only to pick Jev's threshold, and 250 from the evaluation slice), one request per change carrying the title and, for each of the top-30 `combined` candidates, the module name and up to five representative file paths (most often changed before the change, manifests and lockfiles last), with 30 `noul` questions "Will this change need to modify files in module X?". Candidate order is shuffled with a seeded RNG so `combined`'s ranking does not leak. Evaluation compares Jev with `combined` on the same sample (P/R/F1 at a tuning-sample threshold and at an oracle threshold, recall@1/3/5, MAP), plus a logistic blend of the two, and reports latency, failures and cost. Estimated load: 870 requests, ~1.9M input tokens, about $0.08 at $0.042 per million input tokens (chars/4).

Status: **blocked.** `POST https://api.typesafe.ai/v1/systemone` authenticates with the key from `hyperjev/.dev.vars` but returns `HTTP 402 {"error_type": "billing_error", "message": "Your organization has no available TypeSafe API credits..."}`. Three requests were spent on this (the ledger `out/jev_ledger.json` shows 3 of 1,000; the last one at the end of the work, still 402), and the runner stops on 401/402/403 so a billing problem cannot burn the cap. `out/<corpus>/jev_inputs.jsonl` is ready (`out/private/platform/` for platform, the only place platform module names and paths may go). Once credits exist: `python3 jev_client.py run <corpus>` then `evaluate <corpus>`; results land in `metrics.json` (`jev`) and `metrics.md`. Caveat: because every answer so far was a 402, the live API has never validated the request shape (30 `noul` questions and a ~2k-token state in one call); the shape follows jevroute's verified examples, and a run stops by itself after three 4xx answers in a row, so a schema limit cannot burn the cap (`run --max-candidates N` asks about fewer modules per request).

## What works, what does not, caveats

* **Works:** similar-past-title voting with recency decay (`knn`) is the one strong signal; calibrated blending adds a little and gives usable probabilities (`predictions.jsonl`) for step 3. Explicit scope tags are very precise when present (a tag that names a module is right 92% of the time in workers-sdk, 79% in platform), but not every corpus keeps them: no codex title in the evaluation half carries a leading tag, so `cochange` has little to work with there (F1 0.26).
* **Does not:** lexical matching against paths is only prior-level; titles of wide changes say nothing about their footprint; thresholds tuned on an older half drift (platform); module granularity cannot separate colliding from clean pairs even for an oracle.
* **Module labels are a convention.** Modules are the nearest package root at the newest commit, so a package that no longer exists maps to its parent directory (workers-sdk has a module simply called `packages`), and `.changeset` counts as a module. Report both views for workers-sdk.
* **Titles are a proxy for task descriptions.** Squash-merge titles are often edited after the fact; real task prompts for agents may be longer and richer or vaguer.
* **Single window of history per corpus.** One split, no repeated time folds; the bootstrap intervals describe sampling noise within the evaluation slice, not drift between periods.
* **Pair flagging inherits step 1's design:** pairs inside a window of 20 changes, leave-one-out revert, `entangled` pairs excluded (14 to 33% of pairs, so the conflict population is a biased sample), conflicts are textual only.
* `predictions.jsonl` keeps the top 20 modules with p >= 0.02 per method, so thresholds below 0.02 cannot be re-evaluated from the file.
* The arena has no history; the zero-history `lexical` path was only smoke-tested on its file tree (plausible rankings for hand-written tasks). Measure it on `arena/tasks` (`oracle_modules`) once the tasks exist.
