# contention-replay (step 1)

Do concurrently developed changes textually conflict, and do the conflicts cluster? `replay.py`
replays a corpus from `../common/corpus.py` against its git mirror with `git merge-tree`
(git 2.53, `--stdin` batches, `--jobs` worker processes). Standard library only.

## Run

```bash
python3 replay.py --corpus-file ../data/workers-sdk/corpus.jsonl --repo ../corpora/workers-sdk.git --out out/workers-sdk
python3 replay.py --corpus-file ../data/workers-sdk/corpus.jsonl --repo ../corpora/workers-sdk.git --out out/workers-sdk/w50 --window 50
python3 replay.py --corpus-file ../data/codex/corpus.jsonl --repo ../corpora/codex.git --out out/codex
python3 replay.py --corpus-file ../data/private/platform/corpus.jsonl --repo ../corpora/platform.git --out out/private/platform
python3 table.py                     # out/summary_table.md from every out/**/summary.json
python3 -m unittest discover -s tests
```

Useful flags: `--window W` (default 20; branch mode: all changes), `--collision-windows 10,20,50`,
`--max-windows N` (first N windows), `--sample-windows N --sample-method even|random --seed S`
(pair test on N full windows; recorded under `sampling` in summary.json), `--jobs N`, `--keep-scratch`.
Semantic check: `--check-cmd CMD [--check-setup CMD] [--check-sample N] [--check-timeout S]`.
Runtimes on 18 cores: workers-sdk about 1 minute, codex about 9.

## What it measures

**Pair test (leave-one-out revert)**, for every pair i < j with j − i < W:

1. `X = merge-tree --merge-base=sha_i parent_j parent_i`: parent_j with i reverted. If that conflicts,
   the pair is `entangled`: a change between i and j built on i's lines, so the pair can't be isolated.
2. `X' = commit-tree X -p parent_j` (fixed identity and date), then
   `merge-tree --name-only --merge-base=parent_j X' sha_j`: a conflict means j overlaps i textually, so the two
   could not have been developed concurrently without a git conflict. Conflicted paths come from this merge.

`conflict_rate` = conflicts / (clean + conflict). `conflict_rate_bound` also counts entangled pairs
that share a file, over all pairs. **Branch mode** (every record has the same parent, as in the arena)
merges the two branch tips directly over the common base; it is detected automatically.

**Window-base pass**: fixed windows of W changes. Each change is re-applied onto the parent of its
window's first change. `per_change_collision_rate` = the share of changes (excluding each window's
first) that conflict there, i.e. that collide with at least one concurrent predecessor. Computed for
every `--collision-windows` size. This pass alone cannot measure pairwise conflicts: a change that
overlaps an earlier one already fails here, so it is never paired (this was the bias of the first design).

**Semantic check**: for sampled clean pairs, `git archive | tar -x` the tree with only i, the tree
with only j and the merged tree (branch mode: tip_i, tip_j, merge result; history mode: parent_j, j
re-applied without i, commit j). Then run `--check-setup` and `--check-cmd` in each. `clean_but_broken`
means both pass alone and the merge fails. Logs go to `<out>/semantic_logs/`.

## Outputs (`--out`)

- `pairs.jsonl`: the README contract, with `result` ∈ clean | conflict | entangled. `window` is
  `b_seq // W` (the fixed window of the later change); per-window metrics use pairs with both ends in one window.
- `changes.jsonl`: the window-base pass at `--window` (`eligible` = re-applies on its window base).
- `summary.json`: the contract fields plus results and shares, `conflict_rate_bound`, overlap
  classes (also on non-dissolvable "code" files), dissolvable shares (README rule and a strict
  variant that keeps only content and binary conflicts, since modify/delete never reaches a merge driver), module and file concentration with an activity baseline, greedy
  max compatible batch, per-window counts, authorship pairing, conflict rate by seq distance,
  footprint distributions, P(share module/file), implied P(≥1 collision among n), `window_base` for
  every collision window, `window_consistency` (window-base pass versus pair test), runtime and parameters.
- `semantic.jsonl`: only with `--check-cmd`.

Categories come from `corpus.py`'s `classify()` at runtime, not the stored `category` field.

## Safety

- The source repository is only read. Work happens in `<out>/.scratch-<pid>/repo.git`, whose packs are
  copy-on-write clones (`cp -c`) of the source packs, or a `pack-objects` pack for loose-object sources.
  Each task writes into its own object directory, deleted when the task ends.
  Alternates are avoided, because git refreshes the mtime of an alternate's pack whenever it writes an object that already exists there.
- A corpus under a `private/` directory is refused unless `--out` (and the scratch dir) are also under `private/`.
  `table.py` prints aggregate numbers only.

## Caveats

- Shallow mirrors: the first change's parent is the shallow boundary commit (its tree is present). Commits
  `corpus.py` dropped (bots, more than 400 files, empty) still sit between corpus changes. They are part of
  parent_j, and they count as concurrent predecessors in the window-base pass without being window members.
- Entangled pairs (14 to 16% on the public corpora) are excluded from `conflict_rate`. They overlap more often than
  tested pairs do, so the tested rate falls with seq distance (`by_distance`) while the bound rises.
- Renames: git's rename detection is on (`merge.directoryRenames=conflict`, git defaults; user config ignored).
  Overlap classes use corpus paths plus `old_path`; module sets use the corpus `modules[]` field.
- Binary files conflict as `CONFLICT (binary)`, with no size limit. Merge commits (platform) are replayed as
  their first-parent diff. `corpus.py` keeps git's C-quoted form for non-ASCII paths; `replay.py` unquotes them at load time.
