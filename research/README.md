# Beanstalk contention research

Tests whether "schedule agents like database transactions" beats a good merge queue, before the forge is built. Thesis: `../docs/claude-opus/02-thesis-concurrency-control.md`.

| Step | Question | Folder | Kill condition |
|---|---|---|---|
| 1 | Do concurrent changes really collide, and do collisions cluster? | `contention-replay/` | Conflicts rare or evenly spread: placement has nothing to exploit |
| 2 | Can a change's footprint be predicted from its title/description before it is written? | `footprint-prediction/` | Module recall < 0.6, or most real conflicting pairs not flagged |
| 3 | Given steps 1–2's real numbers, does placement + a non-blocking fast trunk beat a batched merge queue? | `contention-sim/` | < 1.5x changes-reaching-green per hour vs the batched queue |
| 4 | Do real headless agents behave the way the simulator assumes? | `arena/` (demo repo), `race/` (agent race) | Real-agent race contradicts the simulator |

`REPORT.md` holds the findings.

## Corpora

| Name | Source | Changes | Notes |
|---|---|---|---|
| `platform` | a private agent-heavy monorepo (name withheld) | 2,590 since 2026-01-01 | Agent-heavy (Claude, Cursor trailers). **Private: outputs go to `out/private/`, never committed; module names anonymised in anything committed** |
| `workers-sdk` | `cloudflare/workers-sdk` | 1,286 since 2026-03-01 | Human-led TS monorepo with `.changeset/` files |
| `codex` | `openai/codex` | 6,777 since 2026-04-01 | Very high velocity, Rust workspace; agent use mostly unattributed |
| `arena` | `arena/` (built here) | ~40 designed tasks | Demo repo with reference solutions; ground truth for the instruments |
| `real-arena/fastify` | `fastify/fastify` (MIT), chain-built | 38 merged PRs, 2025-11 to 2026-10 | Real tasks for the race against GitHub's merge queue (doc 17); see `real-arena/README.md` |

Rebuild: `corpora/clone.sh`, then
`python3 common/corpus.py corpora/<name>.git --corpus <name> --drop-bots -o data/<name>/corpus.jsonl`.
Platform writes to `data/private/platform/`.
Arena (branch mode):
`python3 common/corpus.py corpora/arena.git --corpus arena --branches 'refs/heads/ref/*' --base main --module-depth 2 -o data/arena/corpus.jsonl`.

`corpora/` and `data/` are git-ignored.

## Data contracts

**Corpus** (`data/<corpus>/corpus.jsonl`, from `common/corpus.py`): one change per line, in merge order.
- Fields: `id`, `seq`, `sha`, `parent`, `title`, `body`, `author`, `date`, `agent`, `pr`.
- `files[]` entries have `path`, `old_path`, `status`, `add`, `del`, `module` and `category`.
- Plus `modules[]` and `categories[]`.
- `category` ∈ lockfile, changelog, migration, snapshot, manifest, generated, ci, docs, test, source.
- **Dissolvable categories:** lockfile, changelog, snapshot and generated. A commutative merge driver (regenerate, or union) removes their conflicts.

**Step 1 method.** For history corpora, every pair (i<j) with seq distance below W is tested by **leave-one-out revert**:
1. Revert i from parent(j) to get X.
2. If the revert conflicts, the pair is `entangled`: a change between them built on i.
3. Otherwise re-apply j onto X. A conflict means j textually overlaps i, so the two could not have been developed concurrently without a git conflict.

Re-applying changes onto a fixed window base is biased toward zero: overlapping changes fail to re-apply and drop out before pairing. It survives only as the per-change metric `per_change_collision_rate`, the share of changes that collide with at least one concurrent predecessor. In branch mode (the arena), all changes share one base and pairs are merged directly.

**Step 1 outputs** (`contention-replay/out/<corpus>/`, private corpora under `out/private/<corpus>/`):
- `pairs.jsonl`, one line per pair: `{corpus, window, a, b, a_seq, b_seq, result: "clean"|"conflict"|"entangled", overlap_class: "file"|"module"|"disjoint", shared_files[], shared_modules[], conflict_files[{path, module, category}], dissolvable_only: bool}`. Entangled pairs are excluded from pairwise rates.
- `changes.jsonl`: `{id, seq, window, eligible, reason: "applies"|"depends_on_window"|"empty"|"error"}`.
- `summary.json`, which must contain at least:
  - `corpus`, `window_size`, `windows`, `changes`, `eligible`, `dependency_rate`, `pairs`, `conflict_rate`;
  - `by_overlap_class.{file,module,disjoint}.{pairs,conflicts,rate}`;
  - `dissolvable_share`, `conflict_rate_after_drivers`, `category_share{}`;
  - `module_concentration{top1_share, top3_share, hhi}`;
  - `max_compatible_batch{mean, p50}` (greedy largest conflict-free subset per window);
  - `semantic`, only when a check command was run: `{pairs_checked, clean_but_broken, rate}`;
  - `entangled_rate` and `per_change_collision_rate` (W = 10, 20, 50);
  - `p_collision_among_n` for n ∈ {5, 20, 100, 1000}, computed as 1 − (1 − p_pair)^(n−1), raw and with dissolvable conflicts removed.

**Step 2 outputs** (`footprint-prediction/out/<corpus>/`):
- `predictions.jsonl`: `{id, seq, actual_modules[], pred: {method: {module: prob}}}`.
- `metrics.json` holds:
  - per method, module-level `recall`, `precision` and `f1`, at the chosen threshold and at top-k;
  - `pair_flagging`: for step 1's pairs, the share of conflicting pairs whose predicted footprints overlap (`conflict_recall`) and the share of clean pairs flagged (`clean_flag_rate`), per threshold.
- Prediction may use only information available before the change (title/description, tree at parent, history strictly earlier).
- `predictor.py` exposes `predict(text, ctx) -> {module: prob}`, usable without history (the arena has none).

**Step 3** (`contention-sim/`):
- `calibrate.py` turns step 1–2 outputs into `params/<corpus>.json`.
- `sim.py` runs the policies on those parameters and writes `out/<corpus>/results.csv` plus a markdown table.

**Arena** (`arena/`):
- `app/`: base source of a small TypeScript service.
  - Zero npm dependencies; Node 25 runs `.ts` natively.
  - Tests are `node --test` from `app/` in under 5 s.
  - Modules are `src/<name>/` (`--module-depth 2` on the repo).
- `tasks/tNNN.json` fields:
  - `id`, `title` (issue-style one line), `prompt` (what the agent is told; issue-style, with no file paths in most tasks);
  - `acceptance_tests` {path: content}, added to the agent's workspace before it starts. They fail on base and pass with a correct solution;
  - `oracle_paths[]`, `oracle_modules[]` (evaluation only; never shown to agents or the scheduler);
  - `kind`, `difficulty` (1–3);
  - `couplings[{with, type: "semantic"|"textual", note}]` (designed interactions).
- `solutions/tNNN.patch`: reference solution, a `git apply` diff against base (source changes only; acceptance tests come from the task JSON).
- `materialize.py` builds `corpora/arena.git`: `main` = base; `refs/heads/ref/tNNN` = base + acceptance tests + solution (one commit each, message = task title).
- `validate.py` must show, for every task:
  - the acceptance tests fail on base;
  - base + solution passes the full suite;
  - each designed semantic coupling merges cleanly but fails tests;
  - each designed textual coupling conflicts.

**Race** (`race/`, step 4):
- Run: `python3 race.py --policy queue|beanstalk --agent claude|codex|replay --agents N --ci-seconds S --ci-slots K --out runs/<name>`.
- Policies share agents, CI capacity and tasks.
- **Fair-comparison flags, use them for both policies:**
  - `--no-queue-hold` (queue authors keep working while their PR waits);
  - `--merge-drivers union` (CHANGELOG union driver for both policies);
  - `--protect-tests landed`: before any agent's work is committed, restore every already-landed task's acceptance test that the agent edited or deleted. This applies only when that task's exact version is in the worktree's history, and every restoration is counted as a tampering attempt. Without it, agents fix collisions by rewriting other tasks' tests, and the queue's CI goes green on tampered tests.
- `runs/<name>/` holds `events.jsonl`, `summary.json` and `summary.md`. Agent worktrees and transcripts go in `runs/<name>/work/` (git-ignored).
- `report.py` compares runs.
- Metrics:
  - changes reaching green per hour, and wall-clock to all-green;
  - agent busy, idle and blocked minutes;
  - agent invocations: initial, rework and fixer;
  - cost (USD, from the agent CLI's JSON);
  - CI runs and minutes;
  - textual conflicts met;
  - red validations;
  - final correctness: every acceptance test plus the full suite green on final green.

## Rules for everything in this folder

- Python 3.11+ standard library only (Node 25 for the arena). Every script has `--help`. Tests run with `python3 -m unittest discover -s tests` inside each step folder.
- Deterministic: every random choice takes `--seed`.
- **Privacy:** anything derived from `platform` stays under `out/private/` or `data/private/`. Committed reports use aggregate numbers only, with module names replaced by ranks (`M1`, `M2`, …).
- No network access except the agent CLIs in step 4 and `corpora/clone.sh`.
- Label simulated numbers as simulated, and measured numbers with their corpus and window.
