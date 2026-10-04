#!/usr/bin/env python3
"""Pair flagging: would predicted footprints have flagged the pairs that really conflict?

Reads step 1's ``pairs.jsonl`` (``../contention-replay/out/<corpus>/pairs.jsonl``; for platform
``.../out/private/platform/pairs.jsonl``) and this step's ``predictions.jsonl``.  A pair of changes (a, b) is *flagged*
when their predicted module sets intersect; a scheduler would serialise or co-locate flagged pairs.

    python3 evaluate_pairs.py workers-sdk
    python3 evaluate_pairs.py codex --all-pairs --update-metrics

Per method and per setting (a probability threshold ``p >= t``, or the top-k modules) it reports, on pairs whose two
changes are both in the evaluation slice:

* ``conflict_recall``   share of conflicting pairs that were flagged;
* ``clean_flag_rate``   share of clean pairs that were flagged (needless serialisation);
* ``flag_precision``    share of flagged pairs that really conflict, and ``lift`` = flag_precision / base rate of conflict;
* ``flagged_share``     share of all tested pairs flagged.

Populations: ``raw`` (conflict vs clean, as step 1 labels them) and ``after_drivers`` (a conflict only in dissolvable
files -- lockfile, changelog, snapshot, generated -- counts as clean, because a commutative merge driver removes it).
Pairs with result ``entangled`` (a later change built on the earlier one, so the pair cannot be isolated) or ``error``
are EXCLUDED from every rate and only counted.

Views: ``all`` modules, and ``substantive``, which ignores modules made only of dissolvable files (e.g. ``.changeset``)
in both the predicted and the actual sets.  Oracles: ``oracle_module`` (actual module sets intersect) is the upper bound
for any module-level predictor; ``oracle_file`` (the pair shares a file) is the bound for file-level footprints.

Standard library only.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Iterable, Mapping, Sequence

HERE = os.path.dirname(os.path.abspath(__file__))
RESEARCH = os.path.dirname(HERE)
PRIVATE = {"platform"}
DEFAULT_THRESHOLDS = (0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8)
DEFAULT_TOPK = (1, 2, 3, 5)
HEADLINE = ("combined", "prior")


def default_pairs_path(corpus: str) -> str:
    parts = [RESEARCH, "contention-replay", "out"] + (["private"] if corpus in PRIVATE else []) + [corpus, "pairs.jsonl"]
    return os.path.join(*parts)


def default_out_dir(corpus: str, base: str | None = None) -> str:
    root = base or os.path.join(HERE, "out")
    return os.path.join(root, "private", corpus) if corpus in PRIVATE else os.path.join(root, corpus)


def read_jsonl(path: str) -> Iterable[dict]:
    with open(path) as fh:
        for line in fh:
            if line.strip():
                yield json.loads(line)


def rate(num: float, den: float) -> float | None:
    return num / den if den else None


class Counts:
    """Flag counts against one pair population."""

    __slots__ = ("tp", "fn", "fp", "tn")

    def __init__(self) -> None:
        self.tp = self.fn = self.fp = self.tn = 0

    def add(self, positive: bool, flagged: bool) -> None:
        if positive:
            if flagged:
                self.tp += 1
            else:
                self.fn += 1
        elif flagged:
            self.fp += 1
        else:
            self.tn += 1

    def summary(self) -> dict:
        pos = self.tp + self.fn
        neg = self.fp + self.tn
        flagged = self.tp + self.fp
        base = rate(pos, pos + neg)
        prec = rate(self.tp, flagged)
        return {"conflict_recall": rate(self.tp, pos), "clean_flag_rate": rate(self.fp, neg),
                "flag_precision": prec, "lift": (prec / base) if prec is not None and base else None,
                "flagged_share": rate(flagged, pos + neg), "tp": self.tp, "fn": self.fn, "fp": self.fp, "tn": self.tn}


def predicted_set(probs: Mapping[str, float], threshold: float | None, k: int | None, drop: frozenset) -> frozenset:
    items = [(m, p) for m, p in probs.items() if m not in drop]
    if threshold is not None:
        return frozenset(m for m, p in items if p >= threshold)
    items.sort(key=lambda kv: (-kv[1], kv[0]))
    return frozenset(m for m, _ in items[: k or 0])


def evaluate(pairs: Sequence[Mapping], preds: Mapping[int, Mapping], eval_start: int, restrict_eval: bool,
             methods: Sequence[str], tuned: Mapping[str, float], dissolvable_modules: Iterable[str],
             thresholds: Sequence[float] = DEFAULT_THRESHOLDS, topk: Sequence[int] = DEFAULT_TOPK) -> dict:
    """Core computation; ``preds`` maps seq -> {"actual_modules": [...], "pred": {method: {module: p}}}."""
    D = frozenset(dissolvable_modules)
    cnt = {"pairs_in_file": 0, "pairs_in_scope": 0, "clean": 0, "conflict": 0, "conflict_after_drivers": 0,
           "entangled": 0, "error": 0, "out_of_scope": 0, "missing_prediction": 0}
    scoped: list[Mapping] = []
    for p in pairs:
        cnt["pairs_in_file"] += 1
        res = p["result"]
        if restrict_eval and (p["a_seq"] < eval_start or p["b_seq"] < eval_start):
            cnt["out_of_scope"] += 1
            continue
        if p["a_seq"] not in preds or p["b_seq"] not in preds:
            cnt["missing_prediction"] += 1
            continue
        if res in ("entangled", "error"):
            cnt[res] += 1  # excluded from every rate; counted only
            continue
        if res not in ("clean", "conflict"):
            continue
        cnt["pairs_in_scope"] += 1
        cnt[res] += 1
        if res == "conflict" and not p.get("dissolvable_only"):
            cnt["conflict_after_drivers"] += 1
        scoped.append(p)
    need = {s for p in scoped for s in (p["a_seq"], p["b_seq"])}
    base_rate = rate(cnt["conflict"], cnt["conflict"] + cnt["clean"])
    base_after = rate(cnt["conflict_after_drivers"], cnt["pairs_in_scope"])
    out: dict = {"counts": cnt, "base_rate": {"raw": base_rate, "after_drivers": base_after},
                 "restricted_to_eval_slice": restrict_eval, "eval_start": eval_start, "views": {}}
    views = {"all": frozenset()}
    if D:
        views["substantive"] = D
    for view, drop in views.items():
        actual = {s: frozenset(preds[s]["actual_modules"]) - drop for s in need}
        vres: dict = {"oracle_module": None, "oracle_file": None, "methods": {}}

        def tally(flag_fn) -> dict:
            raw, after = Counts(), Counts()
            for p in scoped:
                flagged = flag_fn(p)
                conflict = p["result"] == "conflict"
                raw.add(conflict, flagged)
                after.add(conflict and not p.get("dissolvable_only"), flagged)
            return {"raw": raw.summary(), "after_drivers": after.summary()}

        vres["oracle_module"] = tally(lambda p: not actual[p["a_seq"]].isdisjoint(actual[p["b_seq"]]))
        vres["oracle_file"] = tally(lambda p: bool(p.get("shared_files")))
        for method in methods:
            entry = {"thresholds": [], "topk": [], "tuned": None}
            sets_cache: dict = {}

            def sets_for(threshold: float | None, k: int | None) -> dict:
                key = (threshold, k)
                if key not in sets_cache:
                    sets_cache[key] = {s: predicted_set(preds[s]["pred"].get(method, {}), threshold, k, drop) for s in need}
                return sets_cache[key]

            for t in thresholds:
                sets = sets_for(t, None)
                entry["thresholds"].append({"threshold": t, **tally(lambda p, sets=sets: not sets[p["a_seq"]].isdisjoint(sets[p["b_seq"]]))})
            for k in topk:
                sets = sets_for(None, k)
                entry["topk"].append({"k": k, **tally(lambda p, sets=sets: not sets[p["a_seq"]].isdisjoint(sets[p["b_seq"]]))})
            if method in tuned:
                sets = sets_for(tuned[method], None)
                entry["tuned"] = {"threshold": tuned[method],
                                  **tally(lambda p, sets=sets: not sets[p["a_seq"]].isdisjoint(sets[p["b_seq"]]))}
            vres["methods"][method] = entry
        out["views"][view] = vres
    out["summary"] = flat_summary(out["views"])
    return out


def flat_summary(views: Mapping) -> dict:
    """The contract's shape, flat: ``summary[view][method] = [{threshold, conflict_recall, clean_flag_rate, ...}]`` for the raw
    population (every textual conflict counts) with the after-drivers rates alongside; ``oracle_module`` / ``oracle_file``
    are single entries."""
    def entry(d: Mapping, extra: Mapping | None = None) -> dict:
        raw, after = d["raw"], d["after_drivers"]
        return {**(extra or {}), "conflict_recall": raw["conflict_recall"], "clean_flag_rate": raw["clean_flag_rate"],
                "flag_precision": raw["flag_precision"], "lift": raw["lift"],
                "conflict_recall_after_drivers": after["conflict_recall"], "clean_flag_rate_after_drivers": after["clean_flag_rate"]}

    out: dict = {}
    for view, v in views.items():
        s: dict = {"oracle_module": entry(v["oracle_module"]), "oracle_file": entry(v["oracle_file"])}
        for method, m in v["methods"].items():
            s[method] = [entry(t, {"threshold": t["threshold"]}) for t in m["thresholds"]]
            s[method + ":topk"] = [entry(t, {"k": t["k"]}) for t in m["topk"]]
        out[view] = s
    return out


# -- rendering -------------------------------------------------------------------------------------------

def _f(x, d=3):
    return "n/a" if x is None else f"{x:.{d}f}"


def render_markdown(res: Mapping, private: bool = False) -> str:
    c = res["counts"]
    lines = ["### Pair flagging (step 1 pairs)", ""]
    scope = "pairs with both changes in the evaluation slice" if res["restricted_to_eval_slice"] else "all pairs"
    lines.append(f"{scope}: {c['pairs_in_scope']} tested pairs ({c['conflict']} conflict, {c['clean']} clean; "
                 f"{c['conflict_after_drivers']} conflict after merge drivers). Excluded and only counted: "
                 f"{c['entangled']} entangled, {c['error']} error. Base conflict rate {_f(res['base_rate']['raw'], 4)} "
                 f"({_f(res['base_rate']['after_drivers'], 4)} after drivers). A pair is flagged when the predicted module sets intersect.")
    lines.append("")
    for view, v in res["views"].items():
        for pop in ("raw", "after_drivers"):
            lines.append(f"**{view} modules, {pop.replace('_', ' ')}**")
            lines.append("")
            lines.append("| scheme | conflict recall | clean flag rate | flag precision | lift | flagged share |")
            lines.append("|---|---|---|---|---|---|")

            def row(name, s):
                return (f"| {name} | {_f(s['conflict_recall'])} | {_f(s['clean_flag_rate'])} | {_f(s['flag_precision'], 4)} | "
                        f"{_f(s['lift'], 1)} | {_f(s['flagged_share'])} |")
            lines.append(row("oracle: actual modules intersect", v["oracle_module"][pop]))
            lines.append(row("oracle: pair shares a file", v["oracle_file"][pop]))
            for method in HEADLINE:
                m = v["methods"].get(method)
                if not m:
                    continue
                if m["tuned"]:
                    lines.append(row(f"{method} @ tuned thr {m['tuned']['threshold']:.3f}", m["tuned"][pop]))
                for t in m["thresholds"]:
                    if t["threshold"] in (0.1, 0.2, 0.3, 0.5):
                        lines.append(row(f"{method} p>={t['threshold']}", t[pop]))
                for t in m["topk"]:
                    if t["k"] in (1, 3):
                        lines.append(row(f"{method} top-{t['k']}", t[pop]))
            lines.append("")
    return "\n".join(lines)


# -- CLI ---------------------------------------------------------------------------------------------------

def run(corpus: str, pairs_path: str | None = None, out_base: str | None = None, all_pairs: bool = False,
        update_metrics: bool = False, thresholds: Sequence[float] = DEFAULT_THRESHOLDS, topk: Sequence[int] = DEFAULT_TOPK,
        subdir: str = "") -> dict:
    d = os.path.join(default_out_dir(corpus, out_base), subdir) if subdir else default_out_dir(corpus, out_base)
    pairs_path = pairs_path or default_pairs_path(corpus)
    if not os.path.exists(pairs_path):
        raise SystemExit(f"no pairs file at {pairs_path}: run step 1 (contention-replay/replay.py) for this corpus first")
    with open(os.path.join(d, "metrics.json")) as fh:
        metrics = json.load(fh)
    preds = {r["seq"]: r for r in read_jsonl(os.path.join(d, "predictions.jsonl"))}
    pairs = list(read_jsonl(pairs_path))
    methods = sorted({m for r in preds.values() for m in r["pred"]}, key=lambda m: (m.endswith("+body"), m))
    tuned = {m: metrics["methods"][m]["threshold"] for m in metrics.get("methods", {})}
    tuned.update({f"{m}+body": v["threshold"] for m, v in metrics.get("methods_title_body", {}).items()})
    res = evaluate(pairs, preds, metrics["eval_range"][0], not all_pairs, methods, tuned,
                   metrics.get("dissolvable_only_modules", []), thresholds, topk)
    res.update(corpus=corpus, pairs_file=os.path.basename(pairs_path) if corpus not in PRIVATE else "pairs.jsonl (private)")
    sys.path.insert(0, HERE)
    import predict as PR
    PR.write_atomic(os.path.join(d, "pair_flagging.json"), json.dumps(res, indent=1))
    PR.write_atomic(os.path.join(d, "pair_flagging.md"), render_markdown(res, corpus in PRIVATE) + "\n")
    if update_metrics:
        metrics["pair_flagging"] = res
        PR.write_atomic(os.path.join(d, "metrics.json"), json.dumps(metrics, indent=1))
        PR.write_atomic(os.path.join(d, "metrics.md"), PR.render_markdown(metrics, corpus in PRIVATE))
    return res


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Would predicted footprints have flagged the pairs that really conflict? "
                                             "(reads step 1's pairs.jsonl and out/<corpus>/predictions.jsonl)")
    ap.add_argument("corpus", help="workers-sdk | codex | platform | another corpus with predictions in out/")
    ap.add_argument("--pairs", help="pairs.jsonl (default: ../contention-replay/out/<corpus>/pairs.jsonl; "
                                    "out/private/platform/ for platform)")
    ap.add_argument("--out", help="output base dir holding <corpus>/predictions.jsonl (default ./out)")
    ap.add_argument("--all-pairs", action="store_true",
                    help="use every pair, not only pairs whose two changes are both in the evaluation slice")
    ap.add_argument("--thresholds", default=",".join(str(t) for t in DEFAULT_THRESHOLDS), help="comma list of probability thresholds")
    ap.add_argument("--topk", default=",".join(str(k) for k in DEFAULT_TOPK), help="comma list of k for top-k footprints")
    ap.add_argument("--update-metrics", action="store_true", help="write the result into metrics.json (pair_flagging) and re-render metrics.md")
    ap.add_argument("--subdir", default="", help="read / write inside out/<corpus>/<subdir> (e.g. granularity-d2)")
    a = ap.parse_args(argv)
    res = run(a.corpus, a.pairs, a.out, a.all_pairs, a.update_metrics,
              [float(x) for x in a.thresholds.split(",") if x], [int(x) for x in a.topk.split(",") if x], a.subdir)
    print(render_markdown(res, a.corpus in PRIVATE))
    return 0


if __name__ == "__main__":
    sys.exit(main())
