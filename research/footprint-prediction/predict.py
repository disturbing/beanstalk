#!/usr/bin/env python3
"""Run every footprint-prediction method on a corpus and write predictions and metrics.

    python3 predict.py workers-sdk            # also: codex, platform (private: outputs go to out/private/platform/)
    python3 predict.py --help

Every method is time-respecting.  For change k it may use only changes with seq < k and the tree at k's parent
(maintained incrementally from the first-parent history of the bare repo).  The first 50% of the corpus is the
tuning slice (hyperparameters, calibration, blend weights, thresholds); metrics are reported on the last 50%.

Methods: prior, lexical, knn, cochange, combined (and, via ``jev_client.py``, jev).  Two text variants are run:
title-only (the headline: PR bodies are often written after the fact) and title+body (reported with a ``+body``
suffix on the method name).

Outputs in ``out/<corpus>/`` (``out/private/<corpus>/`` for private corpora): ``predictions.jsonl``,
``metrics.json``, ``metrics.md``, ``fit.json`` and, when ``--jev-sample`` is positive, ``jev_inputs.jsonl``.
"""
from __future__ import annotations

import argparse
import array
import collections
import json
import os
import random
import subprocess
import sys
import time
from typing import Iterable, Mapping, Sequence

sys.dont_write_bytecode = True  # never write .pyc files next to ../common/corpus.py
HERE = os.path.dirname(os.path.abspath(__file__))
RESEARCH = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(RESEARCH, "common"))

import predictor as P  # noqa: E402
from corpus import module_of, package_roots  # noqa: E402  (common/corpus.py)

CORPORA = {
    "workers-sdk": {"data": "data/workers-sdk/corpus.jsonl", "repo": "corpora/workers-sdk.git", "private": False},
    "codex": {"data": "data/codex/corpus.jsonl", "repo": "corpora/codex.git", "private": False},
    "platform": {"data": "data/private/platform/corpus.jsonl", "repo": "corpora/platform.git", "private": True},
}
DISSOLVABLE = frozenset({"lockfile", "changelog", "snapshot", "generated"})
VARIANTS = ("title", "title_body")
REFRESH_EVERY = 20  # changes between idf / norm refreshes of the lexical index
TOPK_MAX = 10

# Hyperparameter grids searched on the tuning slice (objective: best-threshold micro-F1).
GRID = {
    "prior": [(w, h) for w in (20, 40, 80, 160, 320, 1000, 4000) for h in (None, 10, 20, 40, 80, 160, 320) if h is None or h <= w],
    "lex": [(nw, al) for nw in (1.5, 3.0, 8.0) for al in (0.0, 0.25, 0.5, 0.75, 1.0)],
    "knn": [(k, pw, lam, dec) for k in (5, 10, 20, 40, 60) for pw in (1.0, 2.0) for lam in (0.1, 0.5, 1.5)
            for dec in (None, 300.0)],
    "co": [(win, kap) for win in (None, 600) for kap in (1.0, 2.0, 6.0)],
}
QUICK_GRID = {
    "prior": [(300, 100), (1000, None)],
    "lex": [(3.0, 1.0), (3.0, 0.5)],
    "knn": [(10, 1.0, 0.3, None), (20, 2.0, 0.3, 300.0)],
    "co": [(None, 4.0)],
}


def log(*a) -> None:
    print(f"[{time.strftime('%H:%M:%S')}]", *a, file=sys.stderr, flush=True)


def write_atomic(path: str, text: str) -> None:
    """Write via a temporary file and rename, so a reader (step 3) never sees a half-written output."""
    tmp = f"{path}.tmp{os.getpid()}"
    with open(tmp, "w") as fh:
        fh.write(text)
    os.replace(tmp, path)


# --------------------------------------------------------------------------------------------------
# Corpus, repo, tree
# --------------------------------------------------------------------------------------------------

def git(repo: str, *args: str) -> str:
    res = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, encoding="utf-8", errors="replace")
    if res.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {res.stderr.strip()}")
    return res.stdout


def pseudo_module(path: str, module: str, depth: int) -> str:
    """Finer label for a file: its module plus the first ``depth`` directories below the module root (supplementary
    granularity experiment; ``depth=0`` is the corpus's own module)."""
    if not depth:
        return module
    rel = path[len(module) + 1:] if module != "(root)" and path.startswith(module + "/") else path
    segs = rel.split("/")[:-1][:depth]
    if not segs:
        return module
    return ("" if module == "(root)" else module + "/") + "/".join(segs)


def relabel(records: list[dict], depth: int) -> list[dict]:
    """Replace each file's module (and the change's module list) by the finer label."""
    if not depth:
        return records
    for r in records:
        for f in r["files"]:
            f["module"] = pseudo_module(f["path"], f["module"], depth)
        r["modules"] = sorted({f["module"] for f in r["files"]})
    return records


def load_corpus(path: str) -> list[dict]:
    with open(path) as fh:
        recs = [json.loads(line) for line in fh if line.strip()]
    recs.sort(key=lambda r: r["seq"])
    return recs


class TreeTracker:
    """Replays the first-parent history so that, before change k is predicted, the tracked tree is exactly the
    tree at k's parent.  ``advance_to(sha)`` returns the file events (op, path, module) since the last call."""

    def __init__(self, repo: str, records: Sequence[Mapping], roots: Sequence[str], module_depth: int | None = None,
                 granularity: int = 0) -> None:
        self.repo = repo
        self.roots = list(roots)
        self.module_depth = module_depth
        self.granularity = granularity
        self.base = records[0]["parent"]
        listing = git(repo, "ls-tree", "-r", "--name-only", "-z", self.base)
        self.base_paths = [p for p in listing.split("\0") if p]
        self.chain: list[list[tuple[str, str]]] = []
        self.index: dict[str, int] = {}
        out = git(repo, "log", "--first-parent", "--diff-merges=first-parent", "--no-renames", "--name-status", "-z",
                  "--format=%x1e%H", "--reverse", f"{self.base}..{records[-1]['sha']}")
        for chunk in out.split("\x1e")[1:]:
            sha, _, rest = chunk.partition("\0")
            toks = rest.lstrip("\n").split("\0")
            entries = []
            i = 0
            while i + 1 < len(toks) and toks[i]:
                entries.append((toks[i][0], toks[i + 1]))
                i += 2
            self.index[sha.strip()] = len(self.chain)
            self.chain.append(entries)
        self.pos = 0

    def module(self, path: str) -> str:
        return pseudo_module(path, module_of(path, self.roots, self.module_depth), self.granularity)

    def initial_events(self) -> list[tuple[str, str, str]]:
        return [("A", p, self.module(p)) for p in self.base_paths]

    def advance_to(self, sha: str) -> list[tuple[str, str, str]]:
        if sha == self.base:
            return []
        target = self.index.get(sha)
        if target is None:
            raise KeyError(f"commit {sha} is not on the first-parent chain")
        events: list[tuple[str, str, str]] = []
        while self.pos <= target:
            for status, path in self.chain[self.pos]:
                if status == "D":
                    events.append(("D", path, ""))
                elif status in ("A", "C"):
                    events.append(("A", path, self.module(path)))
            self.pos += 1
        return events


def apply_events(pred: P.Predictor, events: Iterable[tuple[str, str, str]]) -> None:
    for op, path, module in events:
        if op == "A":
            pred.add_file(path, module)
        else:
            pred.remove_file(path)


# --------------------------------------------------------------------------------------------------
# Metrics
# --------------------------------------------------------------------------------------------------

def prf(tp: float, fp: float, fn: float) -> dict:
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    f = 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else 0.0
    return {"precision": p, "recall": r, "f1": f}


def best_threshold(pairs: list[tuple[float, int]], total_pos: int, min_threshold: float = 1e-6) -> tuple[float, float]:
    """(threshold, micro-F1) maximising F1 for sets ``{p >= t}``.  ``pairs`` are (probability, is_actual)."""
    if not pairs or total_pos <= 0:
        return 1.0, 0.0
    pairs = sorted(pairs, key=lambda x: -x[0])
    tp = fp = 0
    best = (0.0, 1.0)
    n = len(pairs)
    i = 0
    while i < n:
        p = pairs[i][0]
        j = i
        while j < n and pairs[j][0] == p:
            if pairs[j][1]:
                tp += 1
            else:
                fp += 1
            j += 1
        f1 = 2 * tp / (2 * tp + fp + (total_pos - tp))
        if f1 > best[0] and p >= min_threshold:
            best = (f1, p)
        i = j
    return best[1], best[0]


def threshold_for_recall(pairs: list[tuple[float, int]], total_pos: int, target: float) -> float | None:
    """Highest threshold whose micro recall on ``pairs`` reaches ``target`` (None if unreachable)."""
    if not pairs or total_pos <= 0:
        return None
    pairs = sorted(pairs, key=lambda x: -x[0])
    tp = 0
    i = 0
    n = len(pairs)
    while i < n:
        p = pairs[i][0]
        j = i
        while j < n and pairs[j][0] == p:
            tp += pairs[j][1]
            j += 1
        if tp / total_pos >= target:
            return p
        i = j
    return None


def ranked(probs: Mapping[str, float]) -> list[str]:
    return [m for m, _ in sorted(probs.items(), key=lambda kv: (-kv[1], kv[0]))]


def evaluate_sets(pred_sets: Sequence[set], actual_sets: Sequence[set]) -> dict:
    """Micro and per-change precision / recall / F1 for predicted vs actual module sets."""
    tp = fp = fn = 0
    ps, rs, fs, nonempty = [], [], [], 0
    for pr, ac in zip(pred_sets, actual_sets):
        hit = len(pr & ac)
        tp += hit
        fp += len(pr) - hit
        fn += len(ac) - hit
        p = hit / len(pr) if pr else 0.0
        r = hit / len(ac) if ac else 0.0
        f = 2 * p * r / (p + r) if p + r else 0.0
        ps.append(p)
        rs.append(r)
        fs.append(f)
        nonempty += 1 if pr else 0
    n = max(1, len(actual_sets))
    micro = prf(tp, fp, fn)
    micro.update({"tp": tp, "fp": fp, "fn": fn})
    return {"micro": micro,
            "per_change": {"precision": sum(ps) / n, "recall": sum(rs) / n, "f1": sum(fs) / n, "coverage": nonempty / n},
            "n_changes": len(actual_sets), "avg_predicted": (tp + fp) / n}


def recall_at(probs_list: Sequence[Mapping[str, float]], actual_sets: Sequence[set], ks=(1, 3, 5)) -> dict:
    out = {}
    tops = [ranked(p) for p in probs_list]
    total = sum(len(a) for a in actual_sets)
    for k in ks:
        hits = 0
        per = 0.0
        hit_any = 0
        for top, ac in zip(tops, actual_sets):
            h = len(set(top[:k]) & ac)
            hits += h
            per += h / len(ac) if ac else 0.0
            hit_any += 1 if h else 0
        n = max(1, len(actual_sets))
        out[str(k)] = {"micro": hits / total if total else 0.0, "per_change": per / n, "hit": hit_any / n}
    return out


def choose_topk(probs_list, actual_sets, kmax=TOPK_MAX) -> int:
    tops = [ranked(p) for p in probs_list]
    total = sum(len(a) for a in actual_sets)
    best = (-1.0, 1)
    for k in range(1, kmax + 1):
        tp = sum(len(set(t[:k]) & a) for t, a in zip(tops, actual_sets))
        npred = sum(min(k, len(t)) for t in tops)
        f = 2 * tp / (npred + total) if npred + total else 0.0
        if f > best[0] + 1e-12:
            best = (f, k)
    return best[1]


OPERATING_THRESHOLDS = (0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.7)
RECALL_TARGETS = (0.6, 0.8)
SIZE_BUCKETS = ((1, 1), (2, 3), (4, 8), (9, 10 ** 9))


def at_recall_targets(tune_pairs, total_pos, eval_probs, eval_actual) -> dict:
    """Threshold chosen on the tuning slice as the highest one reaching a target recall; reported on the evaluation slice."""
    out = {}
    for target in RECALL_TARGETS:
        thr = threshold_for_recall(tune_pairs, total_pos, target)
        if thr is None:
            out[str(target)] = None
            continue
        r = evaluate_sets([{m for m, p in probs.items() if p >= thr} for probs in eval_probs], eval_actual)
        out[str(target)] = {"threshold": thr, "precision": r["micro"]["precision"], "recall": r["micro"]["recall"],
                            "f1": r["micro"]["f1"], "avg_predicted": r["avg_predicted"]}
    return out


def operating_points(eval_probs, eval_actual) -> list[dict]:
    """Micro P/R/F1 on the evaluation slice at fixed probability thresholds (the precision / recall trade-off)."""
    out = []
    for t in OPERATING_THRESHOLDS:
        r = evaluate_sets([{m for m, p in probs.items() if p >= t} for probs in eval_probs], eval_actual)
        out.append({"threshold": t, "precision": r["micro"]["precision"], "recall": r["micro"]["recall"], "f1": r["micro"]["f1"],
                    "per_change_recall": r["per_change"]["recall"], "avg_predicted": r["avg_predicted"]})
    return out


def calibration_table(eval_probs, eval_actual, bins: int = 10) -> dict:
    """Reliability of the probabilities over all scored (change, module) pairs: mean predicted vs observed rate per bin."""
    edges = [i / bins for i in range(bins + 1)]
    cnt = [0] * bins
    psum = [0.0] * bins
    hit = [0] * bins
    brier = 0.0
    n = 0
    for probs, ac in zip(eval_probs, eval_actual):
        for m, p in probs.items():
            b = min(bins - 1, int(p * bins))
            y = 1 if m in ac else 0
            cnt[b] += 1
            psum[b] += p
            hit[b] += y
            brier += (p - y) ** 2
            n += 1
    rows = [{"lo": edges[i], "hi": edges[i + 1], "n": cnt[i], "mean_predicted": psum[i] / cnt[i] if cnt[i] else None,
             "observed": hit[i] / cnt[i] if cnt[i] else None} for i in range(bins)]
    ece = sum(abs(r["mean_predicted"] - r["observed"]) * r["n"] for r in rows if r["n"]) / n if n else 0.0
    return {"bins": rows, "ece": ece, "brier": brier / n if n else 0.0, "pairs": n}


def by_size(pred_sets, eval_actual) -> list[dict]:
    """Micro recall / precision by the number of modules the change actually touched."""
    out = []
    for lo, hi in SIZE_BUCKETS:
        idx = [i for i, a in enumerate(eval_actual) if lo <= len(a) <= hi]
        if not idx:
            continue
        r = evaluate_sets([pred_sets[i] for i in idx], [eval_actual[i] for i in idx])
        out.append({"modules": f"{lo}" if lo == hi else (f"{lo}-{hi}" if hi < 10 ** 9 else f"{lo}+"), "n_changes": len(idx),
                    "precision": r["micro"]["precision"], "recall": r["micro"]["recall"], "per_change_recall": r["per_change"]["recall"]})
    return out


def method_report(tune_probs, tune_actual, eval_probs, eval_actual, keep: dict | None = None) -> dict:
    """Threshold and top-k chosen on the tuning slice, reported on the evaluation slice.
    ``keep`` (optional) receives the evaluation-slice sets and probabilities for the paired bootstrap."""
    total_pos = sum(len(a) for a in tune_actual)
    pairs = [(p, 1 if m in a else 0) for probs, a in zip(tune_probs, tune_actual) for m, p in probs.items()]
    thr, tune_f1 = best_threshold(pairs, total_pos)
    pred_sets = [{m for m, p in probs.items() if p >= thr} for probs in eval_probs]
    at_thr = evaluate_sets(pred_sets, eval_actual)
    k = choose_topk(tune_probs, tune_actual)
    topk_sets = [set(ranked(p)[:k]) for p in eval_probs]
    at_k = evaluate_sets(topk_sets, eval_actual)
    if keep is not None:
        keep.update(thr_sets=pred_sets, topk_sets=topk_sets, probs=eval_probs, actual=eval_actual)
    rep = {
        "threshold": thr, "tuning_f1": tune_f1,
        "precision": at_thr["micro"]["precision"], "recall": at_thr["micro"]["recall"], "f1": at_thr["micro"]["f1"],
        "micro": at_thr["micro"], "per_change": at_thr["per_change"], "avg_predicted": at_thr["avg_predicted"],
        "top_k": {"k": k, "precision": at_k["micro"]["precision"], "recall": at_k["micro"]["recall"], "f1": at_k["micro"]["f1"],
                  "micro": at_k["micro"], "per_change": at_k["per_change"]},
        "recall_at": recall_at(eval_probs, eval_actual),
        "at_recall": at_recall_targets(pairs, total_pos, eval_probs, eval_actual),
        "operating_points": operating_points(eval_probs, eval_actual),
        "by_size": by_size(pred_sets, eval_actual),
        "calibration": calibration_table(eval_probs, eval_actual),
        "n_eval": len(eval_actual),
    }
    return rep


def restrict(probs: Mapping[str, float], drop: set) -> dict[str, float]:
    return {m: p for m, p in probs.items() if m not in drop} if drop else dict(probs)


# --------------------------------------------------------------------------------------------------
# Tuning pass
# --------------------------------------------------------------------------------------------------

class Collector:
    """(score, label) pairs of one hyperparameter setting on the tuning queries."""

    def __init__(self, keep: int = 40) -> None:
        self.scores = array.array("f")
        self.labels = bytearray()
        self.pos = 0
        self.keep = keep

    def add(self, scores: Mapping[str, float], actual: set) -> None:
        self.pos += len(actual)
        items = [(s, m) for m, s in scores.items() if s > 0]
        if len(items) > self.keep:
            items = sorted(items, key=lambda x: -x[0])[: self.keep]
        for s, m in items:
            self.scores.append(s)
            self.labels.append(1 if m in actual else 0)

    def best_f1(self) -> float:
        pairs = list(zip(self.scores, self.labels))
        return best_threshold(pairs, self.pos)[1]


def tune(records: Sequence[Mapping], repo: str, roots: Sequence[str], n_tune: int, use_body: bool, grid: Mapping,
         stride: int, module_depth: int | None = None, burn: int = 1, granularity: int = 0, lag: int = 0) -> tuple[dict, dict]:
    """One time-respecting pass over the tuning slice scoring every grid setting; returns (best params, results).
    Changes before ``burn`` only build history (cold start); they are not scored.  With ``lag`` L the history a change
    sees stops L changes before it (the L most recent changes are "still in flight")."""
    tracker = TreeTracker(repo, records[:n_tune], roots, module_depth, granularity)
    cat = P.Catalog()
    resolver = P.RefResolver(cat)
    lex = {nw: P.LexicalIndex(nw, 1.0) for nw in sorted({nw for nw, _ in grid["lex"]})}
    alphas = sorted({al for _, al in grid["lex"]})
    priors = {(w, h): P.RecencyPrior(w, h) for w, h in grid["prior"]}
    knn = P.KnnIndex()
    cos = {(w, kap): P.CoChange(w, kappa=kap) for w, kap in grid["co"]}
    coll = {("prior", g): Collector() for g in grid["prior"]}
    coll.update({("lex", g): Collector() for g in grid["lex"]})
    coll.update({("knn", g): Collector() for g in grid["knn"]})
    coll.update({("co", g): Collector() for g in grid["co"]})

    def add_events(events):
        for op, path, module in events:
            if op == "A":
                if path not in cat.file_module:
                    cat.add(path, module)
                    for ix in lex.values():
                        ix.add_file(path, module)
            else:
                m = cat.file_module.get(path)
                if m is not None:
                    cat.remove(path)
                    for ix in lex.values():
                        ix.remove_file(path, m)

    add_events(tracker.initial_events())
    for ix in lex.values():
        ix.refresh()
    pending: collections.deque = collections.deque()
    for k, rec in enumerate(records[:n_tune]):
        add_events(tracker.advance_to(rec["parent"]))
        if k % REFRESH_EVERY == 0:
            for ix in lex.values():
                ix.refresh()
        text = P.task_text(rec["title"], rec["body"], use_body)
        title = P.clean_title(rec["title"])
        actual = set(rec["modules"])
        toks = P.tokenize(text)
        refs = resolver.resolve(title, text)
        tags = P.tag_keys(title)
        if k % stride == 0 and k >= burn:
            for g in grid["prior"]:
                coll[("prior", g)].add(priors[g].scores(), actual)
            for nw, ix in lex.items():
                multi = ix.score(toks, alphas) if ix._nfiles else {al: {} for al in alphas}
                for (gnw, gal) in grid["lex"]:
                    if gnw == nw:
                        coll[("lex", (gnw, gal))].add(multi[gal], actual)
            nb = knn.neighbors(toks)
            for g in grid["knn"]:
                kk, pw, lam, dec = g
                coll[("knn", g)].add(P.knn_vote(nb, knn.doc_modules, kk, pw, lam, seq_of=P._identity,
                                                query_seq=len(knn), decay=dec), actual)
            for g in grid["co"]:
                coll[("co", g)].add(cos[g].score(refs, tags), actual)
        pending.append((rec["modules"], toks, refs, tags))
        if len(pending) > lag:
            mods, o_toks, o_refs, o_tags = pending.popleft()
            for pr in priors.values():
                pr.add(mods)
            knn.add(o_toks, mods)
            for c in cos.values():
                c.observe(mods, o_refs, o_tags)
    results = {}
    best: dict = {}
    for name in ("prior", "lex", "knn", "co"):
        scored = sorted(((coll[(name, g)].best_f1(), g) for g in grid[name]), key=lambda x: -x[0])
        results[name] = [{"setting": list(g), "tuning_f1": round(f, 4)} for f, g in scored]
        best[name] = scored[0][1]
    w, h = best["prior"]
    nw, al = best["lex"]
    kk, pw, lam, dec = best["knn"]
    cw, ck = best["co"]
    params = {"prior_window": w, "prior_halflife": h, "lex_name_weight": nw, "lex_alpha": al,
              "knn_k": kk, "knn_power": pw, "knn_lambda": lam, "knn_decay": dec, "co_window": cw, "co_kappa": ck}
    return params, results


# --------------------------------------------------------------------------------------------------
# Final pass: raw component scores for every change
# --------------------------------------------------------------------------------------------------

def final_pass(records: Sequence[Mapping], repo: str, roots: Sequence[str], params: Mapping, use_body: bool,
               sample_ks: set[int] | None = None, module_depth: int | None = None,
               verify_ks: set[int] | None = None, granularity: int = 0, lag: int = 0) -> tuple[list[dict], dict]:
    """Per change: raw component scores for candidate modules, from history strictly before it (``lag`` L: strictly
    before the L most recent changes, which are treated as still in flight)."""
    tracker = TreeTracker(repo, records, roots, module_depth, granularity)
    pred = P.Predictor(params, use_body=use_body)
    apply_events(pred, tracker.initial_events())
    pred.lex.refresh()
    rows: list[dict] = []
    descs: dict[int, dict] = {}
    seen_modules: set[str] = set()
    pending: collections.deque = collections.deque()
    t0 = time.time()
    for k, rec in enumerate(records):
        apply_events(pred, tracker.advance_to(rec["parent"]))
        if verify_ks and k in verify_ks:
            truth = {p for p in git(repo, "ls-tree", "-r", "--name-only", "-z", rec["parent"]).split("\0") if p}
            if truth != set(pred.catalog.file_module):
                raise AssertionError(f"tree tracker diverged at change {k}: {len(truth ^ set(pred.catalog.file_module))} paths differ")
        if k % REFRESH_EVERY == 0:
            pred.lex.refresh()
        comps = pred.components(rec["title"], rec["body"])
        cands: dict[str, tuple] = {}
        for name in P.METHODS:
            for m in comps[name]:
                if m not in cands:
                    cands[m] = tuple(comps[n].get(m, 0.0) for n in P.METHODS)
        actual = rec["modules"]
        universe = set(pred.catalog.module_files) | seen_modules
        rows.append({"cands": cands, "reach": sum(1 for m in actual if m in universe),
                     "pool": sum(1 for m in actual if m in cands), "refs": len(comps["refs"])})
        if sample_ks and k in sample_ks:
            descs[k] = {m: pred.catalog.representative_files(m, pred.touch.get(m), 5) for m in cands}
        pending.append((rec, comps["refs"]))
        if len(pending) > lag:
            old, old_refs = pending.popleft()
            pred.observe(old, refs=old_refs)
            seen_modules.update(old["modules"])
        if (k + 1) % 1000 == 0:
            log(f"  final pass {k + 1}/{len(records)} ({time.time() - t0:.0f}s)")
    return rows, descs


# --------------------------------------------------------------------------------------------------
# Fit calibration + blend + thresholds, evaluate
# --------------------------------------------------------------------------------------------------

def fit_blend(rows: Sequence[dict], records: Sequence[Mapping], tune_idx: Sequence[int], seed: int,
              neg_rate: float = 0.25) -> P.Blend:
    samples = {name: [] for name in P.METHODS}
    for k in tune_idx:
        actual = set(records[k]["modules"])
        for m, feats in rows[k]["cands"].items():
            y = 1.0 if m in actual else 0.0
            for i, name in enumerate(P.METHODS):
                samples[name].append((feats[i], y, 1.0))
    cal = {name: P.Isotonic.fit(samples[name]) for name in P.METHODS}
    rng = random.Random(seed)
    lr_rows = []
    for k in tune_idx:
        actual = set(records[k]["modules"])
        for m, feats in rows[k]["cands"].items():
            y = 1.0 if m in actual else 0.0
            if y == 0.0 and rng.random() > neg_rate:
                continue
            f = [P.logit(cal[name](feats[i])) for i, name in enumerate(P.METHODS)]
            lr_rows.append((f, y, 1.0 if y else 1.0 / neg_rate))
    beta = P.fit_logistic(lr_rows, l2=1.0)
    return P.Blend(cal, beta)


def method_probs(row: Mapping, blend: P.Blend) -> dict[str, dict[str, float]]:
    """Probabilities per method for one change."""
    out = {name: {} for name in (*P.METHODS, "combined")}
    for m, feats in row["cands"].items():
        raw = dict(zip(P.METHODS, feats))
        for name in P.METHODS:
            if raw[name] > 0:
                out[name][m] = blend.cal[name](raw[name])
        out["combined"][m] = blend(raw)
    return out


def dissolvable_only_modules(records: Sequence[Mapping]) -> set[str]:
    cats: dict[str, set[str]] = collections.defaultdict(set)
    for r in records:
        for f in r["files"]:
            cats[f["module"]].add(f["category"])
    return {m for m, c in cats.items() if c <= DISSOLVABLE}


def _block_indices(n: int, rng: random.Random, block: int = 20) -> list[int]:
    idx: list[int] = []
    while len(idx) < n:
        s = rng.randrange(n)
        idx.extend(range(s, min(n, s + block)))
    return idx[:n]


def paired_bootstrap(kept: Mapping[str, dict], target: str, base: str = "prior", reps: int = 300, seed: int = 7) -> dict:
    """95% interval (moving-block bootstrap over evaluation changes, blocks of 20 consecutive changes) of the micro-metric
    differences ``target - base``: F1 at the tuned thresholds, and recall@1 / @3 / @5."""
    a = kept[target]
    n = len(a["actual"])
    if not n:
        return {}
    tops = {name: [ranked(p) for p in kept[name]["probs"]] for name in (target, base)}
    actual = a["actual"]
    n_act = [len(x) for x in actual]

    def f1_arrays(sets):
        tp = [len(s & x) for s, x in zip(sets, actual)]
        fp = [len(s) - t for s, t in zip(sets, tp)]
        fn = [len(x) - t for x, t in zip(actual, tp)]
        return tp, fp, fn

    arr = {name: f1_arrays(kept[name]["thr_sets"]) for name in (target, base)}
    rec = {(name, k): [len(set(t[:k]) & x) for t, x in zip(tops[name], actual)] for name in (target, base) for k in (1, 3, 5)}

    def metrics_for(idx):
        out = {}
        for name in (target, base):
            tp, fp, fn = (sum(map(v.__getitem__, idx)) for v in arr[name])
            out[(name, "f1")] = 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else 0.0
            tot = sum(map(n_act.__getitem__, idx))
            for k in (1, 3, 5):
                out[(name, f"r{k}")] = sum(map(rec[(name, k)].__getitem__, idx)) / tot if tot else 0.0
        return out

    point = metrics_for(range(n))
    rng = random.Random(seed)
    diffs: dict[str, list[float]] = {m: [] for m in ("f1", "r1", "r3", "r5")}
    for _ in range(reps):
        m = metrics_for(_block_indices(n, rng))
        for key in diffs:
            diffs[key].append(m[(target, key)] - m[(base, key)])
    out = {}
    for key, vals in diffs.items():
        vals.sort()
        lo, hi = vals[int(0.025 * len(vals))], vals[min(len(vals) - 1, int(0.975 * len(vals)))]
        out[{"f1": "f1", "r1": "recall_at_1", "r3": "recall_at_3", "r5": "recall_at_5"}[key]] = {
            "diff": point[(target, key)] - point[(base, key)], "ci95": [lo, hi]}
    return out


def evaluate_variant(rows, records, n_tune, blend, drop: set, burn: int = 0) -> tuple[dict, list[dict]]:
    """Metrics per method on the evaluation slice (thresholds chosen on tuning changes ``burn..n_tune``) and the
    per-change probabilities of every change."""
    all_probs = [method_probs(rows[k], blend) for k in range(len(records))]
    methods = {}
    kept: dict[str, dict] = {}
    for name in (*P.METHODS, "combined"):
        tp_, ta_, ep_, ea_ = [], [], [], []
        for k in range(burn, len(records)):
            actual = set(records[k]["modules"]) - drop
            if not actual:
                continue
            probs = restrict(all_probs[k][name], drop)
            if k < n_tune:
                tp_.append(probs)
                ta_.append(actual)
            else:
                ep_.append(probs)
                ea_.append(actual)
        kept[name] = {}
        methods[name] = method_report(tp_, ta_, ep_, ea_, kept[name])
    for name in methods:
        if name != "prior" and kept[name].get("actual"):
            methods[name]["vs_prior"] = paired_bootstrap(kept, name, "prior")
    if kept.get("combined", {}).get("actual"):
        methods["combined"]["vs_knn"] = paired_bootstrap(kept, "combined", "knn")
    return methods, all_probs


def ceilings(rows, records, n_tune) -> dict:
    """Upper bounds on recall for any method of this family (all modules, evaluation slice)."""
    tot = reach = pool = 0
    for k in range(n_tune, len(records)):
        tot += len(records[k]["modules"])
        reach += rows[k]["reach"]
        pool += rows[k]["pool"]
    return {"eval_actual_modules": tot, "reachable_recall": reach / tot if tot else 0.0,
            "candidate_pool_recall": pool / tot if tot else 0.0}


# --------------------------------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------------------------------

def out_dir(corpus: str, private: bool, base: str | None = None) -> str:
    root = base or os.path.join(HERE, "out")
    return os.path.join(root, "private", corpus) if private else os.path.join(root, corpus)


def trim(probs: Mapping[str, float], n: int = 20, floor: float = 0.02) -> dict[str, float]:
    """Keep the top ``n`` modules with probability >= ``floor`` (pair flagging never looks below 0.05)."""
    items = [(m, p) for m, p in probs.items() if p >= floor]
    items.sort(key=lambda kv: (-kv[1], kv[0]))
    return {m: round(p, 3) for m, p in items[:n]}


def fmt(x: float, digits: int = 3) -> str:
    return f"{x:.{digits}f}"


def render_markdown(metrics: Mapping, private: bool) -> str:
    lines = [f"# Footprint prediction: {'(private corpus) ' if private else ''}{metrics['corpus']}", ""]
    lines.append(f"Changes: {metrics['n_changes']}: burn-in {metrics['burn_in']} (history only), tuning "
                 f"{metrics['tune_range'][1] - metrics['tune_range'][0]}, evaluation {metrics['eval_range'][1] - metrics['eval_range'][0]} "
                 f"(the last 50% by merge order). Thresholds, top-k, calibration and blend weights are fitted on the tuning slice only. "
                 f"P / R / F1 are micro-averaged over (change, module) pairs at the threshold that maximises F1 on the tuning slice; "
                 f"R@k is the share of actual modules found in the top k; hit@1 is the share of changes whose top-1 module is touched.")
    lines.append("")

    def table(methods: Mapping, title: str) -> list[str]:
        out = [f"### {title}", "",
               "| method | thr | P | R | F1 | per-change P/R/F1 | top-k (k) P/R/F1 | R@1 | R@3 | R@5 | hit@1 | avg pred |",
               "|---|---|---|---|---|---|---|---|---|---|---|---|"]
        for name, r in methods.items():
            pc = r["per_change"]
            tk = r["top_k"]
            ra = r["recall_at"]
            out.append(f"| {name} | {fmt(r['threshold'], 3)} | {fmt(r['precision'])} | {fmt(r['recall'])} | {fmt(r['f1'])} | "
                       f"{fmt(pc['precision'], 2)}/{fmt(pc['recall'], 2)}/{fmt(pc['f1'], 2)} | "
                       f"({tk['k']}) {fmt(tk['precision'], 2)}/{fmt(tk['recall'], 2)}/{fmt(tk['f1'], 2)} | "
                       f"{fmt(ra['1']['micro'])} | {fmt(ra['3']['micro'])} | {fmt(ra['5']['micro'])} | {fmt(ra['1']['hit'], 2)} | "
                       f"{fmt(r['avg_predicted'], 1)} |")
        out.append("")
        return out

    def lift(methods: Mapping, title: str) -> list[str]:
        rows = [(n, r["vs_prior"]) for n, r in methods.items() if r.get("vs_prior")]
        if not rows:
            return []
        out = [f"### {title}", "",
               "Difference to the `prior` baseline (top modules by recent frequency, no text), 95% interval from a block bootstrap "
               "over evaluation changes. An interval that excludes 0 means the method adds something over the prior.", "",
               "| method | dF1 | dR@1 | dR@3 | dR@5 |", "|---|---|---|---|---|"]

        def cell(d):
            return f"{d['diff']:+.3f} [{d['ci95'][0]:+.3f}, {d['ci95'][1]:+.3f}]"
        for n, v in rows:
            out.append(f"| {n} | {cell(v['f1'])} | {cell(v['recall_at_1'])} | {cell(v['recall_at_3'])} | {cell(v['recall_at_5'])} |")
        vk = (methods.get("combined") or {}).get("vs_knn")
        if vk:
            out.append(f"| combined minus knn | {cell(vk['f1'])} | {cell(vk['recall_at_1'])} | {cell(vk['recall_at_3'])} | {cell(vk['recall_at_5'])} |")
        out.append("")
        return out

    def detail(methods: Mapping, title: str) -> list[str]:
        out = []
        c = methods.get("combined")
        if not c:
            return out
        out += [f"### {title}", "", "`combined`, micro P / R / F1 on the evaluation slice at fixed thresholds, with the `prior` for reference:", "",
                "| threshold | combined P | R | F1 | avg predicted | prior P | R | F1 |", "|---|---|---|---|---|---|---|---|"]
        pr = {o["threshold"]: o for o in methods["prior"]["operating_points"]}
        for o in c["operating_points"]:
            p = pr[o["threshold"]]
            out.append(f"| {o['threshold']} | {fmt(o['precision'])} | {fmt(o['recall'])} | {fmt(o['f1'])} | {fmt(o['avg_predicted'], 1)} | "
                       f"{fmt(p['precision'])} | {fmt(p['recall'])} | {fmt(p['f1'])} |")
        out += ["", "Recall by the number of modules the change actually touched (`combined` vs `prior`, tuned thresholds):", "",
                "| modules touched | changes | combined recall | combined precision | prior recall |", "|---|---|---|---|---|"]
        pbs = {b["modules"]: b for b in methods["prior"]["by_size"]}
        for b in c["by_size"]:
            out.append(f"| {b['modules']} | {b['n_changes']} | {fmt(b['recall'])} | {fmt(b['precision'])} | {fmt(pbs.get(b['modules'], {}).get('recall', 0.0))} |")
        cal = c["calibration"]
        out += ["", "Threshold chosen on the tuning slice to reach a target micro recall (the kill condition is recall < 0.6), reported on the evaluation slice:", "",
                "| method | target recall | threshold | P | R | F1 | avg predicted |", "|---|---|---|---|---|---|---|"]
        for name in ("combined", "knn", "prior"):
            for t, v in (methods[name].get("at_recall") or {}).items():
                if v:
                    out.append(f"| {name} | {t} | {fmt(v['threshold'])} | {fmt(v['precision'])} | {fmt(v['recall'])} | {fmt(v['f1'])} | {fmt(v['avg_predicted'], 1)} |")
                else:
                    out.append(f"| {name} | {t} | unreachable | | | | |")
        out += ["", f"Calibration of `combined` over the {cal['pairs']} scored (change, module) pairs: ECE {fmt(cal['ece'], 4)}, Brier {fmt(cal['brier'], 4)}.", ""]
        return out

    lines += table(metrics["methods"], "Title only (headline), all modules")
    lines += lift(metrics["methods"], "Does text add anything over the prior? (title only, all modules)")
    lines += detail(metrics["methods"], "Operating points and change size (title only, all modules)")
    if metrics.get("methods_title_body"):
        lines += table(metrics["methods_title_body"], "Title + body, all modules (optimistic: bodies are often written after the change)")
        lines += lift(metrics["methods_title_body"], "Does text add anything over the prior? (title + body, all modules)")
    sub = metrics.get("substantive")
    if sub:
        lines.append(f"Modules made only of dissolvable files (lockfile, changelog, snapshot, generated) are ignored in the "
                     f"substantive view: {metrics['dissolvable_only_modules_display']}.")
        lines.append("")
        lines += table(sub["methods"], "Substantive view, title only")
        lines += lift(sub["methods"], "Does text add anything over the prior? (title only, substantive view)")
        if sub.get("methods_title_body"):
            lines += table(sub["methods_title_body"], "Substantive view, title + body")
    ce = metrics.get("ceilings", {})
    if ce:
        lines.append("### Ceilings (evaluation slice, all modules, title-only candidate pool)")
        lines.append("")
        lines.append(f"- reachable recall (actual module exists in the tree at the parent or in earlier history): {fmt(ce['reachable_recall'])}")
        lines.append(f"- candidate-pool recall of the combined method (actual module is among the scored candidates): {fmt(ce['candidate_pool_recall'])}")
        lines.append("")
    fit = metrics.get("fit", {})
    if fit:
        lines.append("### Fitted settings (tuning slice)")
        lines.append("")
        lines.append("```")
        lines.append(json.dumps(fit.get("params", {}), indent=1))
        lines.append("```")
        lines.append("")
    if metrics.get("pair_flagging"):
        import evaluate_pairs
        lines.append(evaluate_pairs.render_markdown(metrics["pair_flagging"], private))
        lines.append("")
    if metrics.get("jev"):
        import jev_client
        lines.append(jev_client.render_markdown(metrics["jev"], private))
        lines.append("")
    return "\n".join(lines)


# --------------------------------------------------------------------------------------------------
# Driver
# --------------------------------------------------------------------------------------------------

def run_corpus(name: str, data_path: str, repo: str, private: bool, out_base: str | None, seed: int, quick: bool,
               variants: Sequence[str], jev_sample: tuple[int, int], limit: int | None, verify: int,
               module_depth: int | None, tune_stride: int | None, dev: bool = False, granularity: int = 0, lag: int = 0) -> dict:
    t_start = time.time()
    records = relabel(load_corpus(data_path), granularity)
    if dev:  # design iteration touches only the first half of the corpus (tune on its first half, validate on its second)
        records = records[: len(records) // 2]
    if limit:
        records = records[:limit]
    n = len(records)
    n_tune = n // 2
    burn = max(20, n // 10)  # cold start: these changes only build history
    log(f"{name}: {n} changes, burn-in [0,{burn}) tune [{burn},{n_tune}) eval [{n_tune},{n})")
    roots = [] if module_depth else package_roots(repo, "main")
    drop = dissolvable_only_modules(records)
    stride = tune_stride or (1 if n_tune <= 800 else 2)
    grid = QUICK_GRID if quick else GRID
    rng = random.Random(seed)
    jev_tune_n, jev_eval_n = jev_sample
    eval_idx = list(range(n_tune, n))
    tune_idx_all = list(range(burn, n_tune))
    sample_eval = sorted(rng.sample(eval_idx, min(jev_eval_n, len(eval_idx)))) if jev_eval_n else []
    sample_tune = sorted(rng.sample(tune_idx_all, min(jev_tune_n, len(tune_idx_all)))) if jev_tune_n else []
    sample_ks = set(sample_eval) | set(sample_tune)
    verify_ks = set(random.Random(seed + 1).sample(range(n), min(verify, n))) if verify else None

    per_variant = {}
    all_probs_by_variant = {}
    fits = {}
    descs = {}
    for variant in variants:
        use_body = variant == "title_body"
        log(f"{name}/{variant}: tuning ({'quick' if quick else 'full'} grid, stride {stride})")
        params, tune_results = tune(records, repo, roots, n_tune, use_body, grid, stride, module_depth, burn, granularity, lag)
        log(f"{name}/{variant}: best params {params}")
        log(f"{name}/{variant}: final pass")
        rows, d = final_pass(records, repo, roots, params, use_body, sample_ks if variant == "title" else None,
                             module_depth, verify_ks, granularity, lag)
        if variant == "title":
            descs = d
        log(f"{name}/{variant}: fitting calibration and blend on the tuning slice")
        blend = fit_blend(rows, records, range(burn, n_tune), seed)
        log(f"{name}/{variant}: blend weights {[round(b, 3) for b in blend.beta]}")
        methods, all_probs = evaluate_variant(rows, records, n_tune, blend, set(), burn)
        sub_methods = None
        if drop:
            sub_methods, _ = evaluate_variant(rows, records, n_tune, blend, drop, burn)
        ce = ceilings(rows, records, n_tune)
        per_variant[variant] = {"methods": methods, "substantive": sub_methods, "ceilings": ce}
        all_probs_by_variant[variant] = all_probs
        fits[variant] = {"params": params, "blend": blend.to_json(), "tuning": tune_results,
                         "beta": blend.beta, "features": list(P.BLEND_FEATURES)}
        _ = rows

    # ----- write outputs
    outd = out_dir(name, private, out_base)
    if granularity or lag:  # supplementary experiments stay inside the corpus's own output dir (so platform stays under out/private/)
        outd = os.path.join(outd, "-".join(([f"granularity-d{granularity}"] if granularity else []) + ([f"lag{lag}"] if lag else [])))
    os.makedirs(outd, exist_ok=True)
    lines = []
    for k, rec in enumerate(records):
        pred = {}
        for variant in variants:
            suffix = "+body" if variant == "title_body" else ""
            for method, probs in all_probs_by_variant[variant][k].items():
                if variant == "title_body" and method == "prior":
                    continue
                pred[method + suffix] = trim(probs)
        lines.append(json.dumps({"id": rec["id"], "seq": rec["seq"], "split": "tune" if k < n_tune else "eval",
                                 "actual_modules": rec["modules"], "pred": pred}))
    write_atomic(os.path.join(outd, "predictions.jsonl"), "\n".join(lines) + "\n")

    by_rank = [m for m, _ in collections.Counter(m for r in records for m in r["modules"]).most_common()]
    metrics = {
        "corpus": name, "private": private, "granularity": granularity, "lag": lag, "n_changes": n, "burn_in": burn, "tune_range": [burn, n_tune],
        "eval_range": [n_tune, n], "seed": seed,
        "headline": {"variant": "title", "view": "all"},
        "methods": per_variant["title"]["methods"] if "title" in per_variant else {},
        "ceilings": per_variant["title"]["ceilings"] if "title" in per_variant else {},
        "dissolvable_only_modules": sorted(drop),
        "dissolvable_only_modules_display": ", ".join(sorted(drop)) if not private else ", ".join(f"M{by_rank.index(m) + 1}" for m in sorted(drop)),
        "fit": {"params": fits.get("title", {}).get("params", {}), "title_body_params": fits.get("title_body", {}).get("params", {}),
                "blend_beta": {v: fits[v]["beta"] for v in fits}, "features": list(P.BLEND_FEATURES)},
        "text_variants": list(variants),
    }
    if "title_body" in per_variant:
        metrics["methods_title_body"] = per_variant["title_body"]["methods"]
        metrics["ceilings_title_body"] = per_variant["title_body"]["ceilings"]
    if drop:
        metrics["substantive"] = {"methods": (per_variant.get("title") or {}).get("substantive") or {}}
        if "title_body" in per_variant:
            metrics["substantive"]["methods_title_body"] = per_variant["title_body"]["substantive"]
    write_atomic(os.path.join(outd, "fit.json"), json.dumps(fits, indent=1))
    write_atomic(os.path.join(outd, "metrics.json"), json.dumps(metrics, indent=1))
    write_atomic(os.path.join(outd, "metrics.md"), render_markdown(metrics, private))

    # ----- Jev inputs: top-30 combined candidates with short module descriptions
    if sample_ks and "title" in all_probs_by_variant:
        with open(os.path.join(outd, "jev_inputs.jsonl"), "w") as fh:
            for k in sorted(sample_ks):
                probs = all_probs_by_variant["title"][k]["combined"]
                top = ranked(probs)[:30]
                rec = records[k]
                fh.write(json.dumps({
                    "id": rec["id"], "seq": rec["seq"], "split": "tune" if k < n_tune else "eval",
                    "title": P.clean_title(rec["title"]), "actual_modules": rec["modules"],
                    "candidates": [{"module": m, "p_combined": round(probs[m], 4), "files": descs.get(k, {}).get(m, [])} for m in top],
                }) + "\n")
    log(f"{name}: done in {time.time() - t_start:.0f}s -> {outd}")
    return metrics


def lexical_samples(name: str, seed: int = 7) -> list[tuple[float, float, float]]:
    """(score, actual?, weight) of the zero-history lexical method over a corpus's tuning slice (default lexical params)."""
    meta = CORPORA[name]
    records = load_corpus(os.path.join(RESEARCH, meta["data"]))
    repo = os.path.join(RESEARCH, meta["repo"])
    n = len(records)
    n_tune, burn = n // 2, max(20, n // 10)
    roots = package_roots(repo, "main")
    tracker = TreeTracker(repo, records[:n_tune], roots)
    pred = P.Predictor({})
    apply_events(pred, tracker.initial_events())
    pred.lex.refresh()
    samples = []
    for k, rec in enumerate(records[:n_tune]):
        apply_events(pred, tracker.advance_to(rec["parent"]))
        if k % REFRESH_EVERY == 0:
            pred.lex.refresh()
        if k < burn:
            continue
        actual = set(rec["modules"])
        scores = pred.lex.score(P.tokenize(P.task_text(rec["title"], rec["body"], False)))
        top = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))[: pred.params["lex_top"]]
        samples.extend((s, 1.0 if m in actual else 0.0, 1.0) for m, s in top)
    return samples


def export_defaults(corpora: Sequence[str] = ("workers-sdk", "codex"), out_base: str | None = None) -> str:
    """Write ``defaults.json``: the lexical calibration pooled over the public corpora, and the history-mode
    parameters and blend fitted on the largest of them (read from ``out/<corpus>/fit.json``)."""
    samples: list[tuple[float, float, float]] = []
    for c in corpora:
        samples.extend(lexical_samples(c))
    cal = P.Isotonic.fit(samples)
    sizes = {c: sum(1 for _ in open(os.path.join(RESEARCH, CORPORA[c]["data"]))) for c in corpora}
    biggest = max(sizes, key=sizes.get)
    with open(os.path.join(out_dir(biggest, False, out_base), "fit.json")) as fh:
        fit = json.load(fh)["title"]
    defaults = {
        "lexical": {"params": {"lex_name_weight": P.DEFAULT_PARAMS["lex_name_weight"], "lex_alpha": P.DEFAULT_PARAMS["lex_alpha"]},
                    "calibration": cal.to_json(), "fitted_on": list(corpora)},
        "history": {"params": fit["params"], "blend": fit["blend"], "fitted_on": biggest},
    }
    path = os.path.join(HERE, "defaults.json")
    with open(path, "w") as fh:
        json.dump(defaults, fh, indent=1)
    return path


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Run all footprint-prediction methods on a corpus (time-respecting; tune on the first "
                                             "50%, report on the last 50%).")
    ap.add_argument("corpus", nargs="?", help="workers-sdk | codex | platform, or a name used with --data/--repo")
    ap.add_argument("--export-defaults", action="store_true",
                    help="write defaults.json for predictor.predict() from the public corpora (run workers-sdk and codex first)")
    ap.add_argument("--data", help="corpus.jsonl (default: data/<corpus>/corpus.jsonl)")
    ap.add_argument("--repo", help="bare repo (default: corpora/<corpus>.git)")
    ap.add_argument("--private", action="store_true", help="write under out/private/ (always on for platform)")
    ap.add_argument("--out", help="output base dir (default: ./out)")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--quick", action="store_true", help="small hyperparameter grid (smoke tests)")
    ap.add_argument("--variants", default="title,title_body", help="comma list of text variants: title, title_body")
    ap.add_argument("--jev-sample", default="40,250", metavar="TUNE,EVAL",
                    help="seeded sample sizes (tuning slice, evaluation slice) written to jev_inputs.jsonl; 0,0 disables")
    ap.add_argument("--limit", type=int, help="use only the first N changes (smoke tests)")
    ap.add_argument("--verify-tree", type=int, default=0, metavar="N",
                    help="check the incrementally tracked tree against git ls-tree at N random changes")
    ap.add_argument("--module-depth", type=int, help="module = first N directory segments (arena)")
    ap.add_argument("--tune-stride", type=int, help="score every Nth tuning change during hyperparameter search")
    ap.add_argument("--jev", action="store_true",
                    help="after the other methods, send the sampled changes to Jev (needs TypeSafe credits; at most 1,000 calls "
                         "in total across corpora) and add the Jev-vs-combined comparison to metrics.json / metrics.md")
    ap.add_argument("--granularity", type=int, default=0, metavar="D",
                    help="supplementary experiment: predict directories instead of modules -- the module plus its first D "
                         "directories below the module root (0 = the corpus's own modules)")
    ap.add_argument("--lag", type=int, default=0, metavar="L",
                    help="supplementary experiment: a change's history stops L changes before it (the L most recent changes "
                         "are treated as still in flight, as for concurrent agents); the pair window of step 1 is 20, so L=19")
    ap.add_argument("--dev", action="store_true",
                    help="development mode: use only the first half of the corpus (tune on its first half, validate on its "
                         "second) so design decisions never see the evaluation slice")
    a = ap.parse_args(argv)
    if a.export_defaults:
        print(export_defaults(out_base=a.out))
        return 0
    if not a.corpus:
        ap.error("a corpus name is required")

    meta = CORPORA.get(a.corpus, {})
    data = a.data or os.path.join(RESEARCH, meta.get("data", f"data/{a.corpus}/corpus.jsonl"))
    repo = a.repo or os.path.join(RESEARCH, meta.get("repo", f"corpora/{a.corpus}.git"))
    private = a.private or meta.get("private", False)
    jt, je = (int(x) for x in a.jev_sample.split(","))
    variants = [v for v in a.variants.split(",") if v]
    for v in variants:
        if v not in VARIANTS:
            ap.error(f"unknown variant {v}")
    if a.jev and (a.granularity or a.lag or "title" not in variants or (jt, je) == (0, 0)):
        ap.error("--jev needs the plain run with a title-only Jev sample (no --granularity / --lag, --jev-sample not 0,0)")
    run_corpus(a.corpus, data, repo, private, a.out, a.seed, a.quick, variants, (jt, je), a.limit, a.verify_tree,
               a.module_depth, a.tune_stride, a.dev, a.granularity, a.lag)
    if a.jev:
        import jev_client
        out = jev_client.run(a.corpus, a.out, seed=a.seed)
        if out.get("fatal"):
            log(f"Jev stopped: HTTP {out['fatal'].get('status')}: {str(out['fatal'].get('error'))[:200]}")
        res = jev_client.evaluate(a.corpus, a.out)
        u = res["usage"]
        log(f"Jev: {u['answered']} of {u['sampled_changes']} sampled changes answered, {u['failed_final']} failed, "
            f"{u['http_requests']} HTTP requests, estimated ${u['estimated_cost_usd']:.4f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
