#!/usr/bin/env python3
"""Turn step 1 (contention-replay) and step 2 (footprint-prediction) outputs into simulator
parameters: params/<corpus>.json, or params/private/<corpus>.json for private corpora.

Inputs (paths default to the research/ layout in README.md; override any of them):
  step 1  contention-replay/out/<corpus>/            summary.json (required), pairs.jsonl (optional)
          contention-replay/out/private/<corpus>/    for private corpora
  step 2  footprint-prediction/out/<corpus>/         metrics.json (optional)
  corpus  data/<corpus>/corpus.jsonl                 module sets and file counts (optional)

What it sets
  p_file, p_module, p_disjoint   by_overlap_class rates (class model)
  p_per_file, p_per_file_diss    fitted per shared file from pairs.jsonl (per_file model), so a
                                 pair's conflict probability compounds with the files it shares
  dissolvable_share, dependency_rate, q_sem (only if step 1 ran a semantic check)
  recall, precision              step 2, best-F1 method at its chosen threshold (or --method)
  footprint                      the empirical change list (module sets + file counts per module),
                                 module sizes, commutative modules, dissolvable file ranks, and
                                 the Zipf exponent fitted so the simulated share of file-sharing
                                 pairs matches step 1
Everything else (CI time, agent work time, p_self, flake rate, ...) comes from params/default.json.

Private corpora (platform): module names are replaced by popularity ranks M1, M2, ... and the
file goes to params/private/, which is git-ignored.
Standard library only.
"""
from __future__ import annotations

import argparse
import collections
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RESEARCH = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import sim  # noqa: E402

PRIVATE_CORPORA = {"platform"}
DISSOLVABLE = {"lockfile", "changelog", "snapshot", "generated"}
COMMUTATIVE_SHARE = 0.9     # a module whose file touches are >= 90% dissolvable is commutative


try:
    sys.path.insert(0, os.path.join(RESEARCH, "common"))
    from corpus import classify as _corpus_classify  # type: ignore
except Exception:  # pragma: no cover - common/ missing
    _corpus_classify = None


def _classify(path: str) -> str:
    """Category of a path, using common/corpus.py's rules when available."""
    if _corpus_classify is not None:
        return _corpus_classify(path)
    low = path.lower()
    if low.endswith((".lock", "lock.json", "lock.yaml", "go.sum")):
        return "lockfile"
    if "changelog" in low or "/.changeset/" in low or low.startswith(".changeset/"):
        return "changelog"
    return "source"


SAFE_KEYS = {"file", "module", "disjoint", "pairs", "conflicts", "rate", "top1_share", "top3_share", "hhi",
             "mean", "p50", "pairs_checked", "clean_but_broken", "raw", "after_drivers", "drivers",
             "with_drivers", "without_drivers", "dissolvable_removed", "recall", "precision", "f1",
             "conflict_recall", "clean_flag_rate", "threshold", "k", "path", "p_per_file",
             "p_per_file_diss", "class_pairs", "class_conflicts", "mean_shared_files", "target_file_share_of_sharing_pairs",
             "achieved", "zipf_s", "method", "lift", "used", "aligned", "other_split", "missing_method",
             "unknown_module", "points", "predicted", "module-level", "file-oracle", "module-oracle",
             "hot-file-rule", "lockfile", "changelog", "migration", "snapshot", "manifest", "generated",
             "ci", "docs", "test", "source", "clean", "conflict", "entangled"}


def scrub_private(o, dropped: list, path: str = ""):
    """Keep only numbers and known aggregate keys (module names never reach a private params file
    via the measured block)."""
    if isinstance(o, dict):
        out = {}
        for k, v in o.items():
            ks = str(k)
            if ks in SAFE_KEYS or ks.replace(".", "", 1).isdigit():
                out[ks] = scrub_private(v, dropped, f"{path}/{ks}")
            else:
                dropped.append(f"{path}/{ks}")
        return out
    if isinstance(o, list):
        return [scrub_private(v, dropped, path) for v in o if isinstance(v, (int, float, dict, list))]
    if isinstance(o, (int, float)) or o is None:
        return o
    if path.endswith("/path"):
        return o
    dropped.append(path)
    return None


def read_json(path: str):
    with open(path) as fh:
        return json.load(fh)


def read_jsonl(path: str):
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if line:
                yield json.loads(line)


def first_existing(*paths: str) -> str | None:
    for p in paths:
        if p and os.path.exists(p):
            return p
    return None


# --------------------------------------------------------------------------------------
# Step 1
# --------------------------------------------------------------------------------------
def class_rates(summary: dict) -> dict:
    out = {}
    boc = summary.get("by_overlap_class") or {}
    for c in ("file", "module", "disjoint"):
        d = boc.get(c) or {}
        pairs = d.get("pairs") or 0
        conflicts = d.get("conflicts")
        rate = d.get("rate")
        if rate is None and pairs:
            rate = (conflicts or 0) / pairs
        out[c] = {"pairs": pairs, "conflicts": conflicts, "rate": rate}
    return out


def solve_per_file(groups: list[tuple[int, int]]) -> float | None:
    """p such that sum_i [1 - (1 - p)^n_i] = sum_i y_i over pairs (n_i shared files, y_i conflict)."""
    groups = [(n, y) for n, y in groups if n > 0]
    if not groups:
        return None
    target = sum(y for _, y in groups)
    if target <= 0:
        return 0.0
    if target >= len(groups):
        return 1.0
    lo, hi = 0.0, 1.0
    for _ in range(60):
        mid = (lo + hi) / 2
        val = sum(1.0 - (1.0 - mid) ** n for n, _ in groups)
        if val < target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def per_file_from_pairs(pairs_path: str) -> dict:
    """Fit per-shared-file conflict probabilities (non-dissolvable and dissolvable files) on the
    file-class pairs of step 1, excluding entangled pairs."""
    nd_groups: list[tuple[int, int]] = []
    d_groups: list[tuple[int, int]] = []
    n_pairs = collections.Counter()
    conflicts = collections.Counter()
    shared_counts = []
    for p in read_jsonl(pairs_path):
        if p.get("result") == "entangled":
            continue
        cls = p.get("overlap_class")
        n_pairs[cls] += 1
        if p.get("result") == "conflict":
            conflicts[cls] += 1
        if cls != "file":
            continue
        shared = [s if isinstance(s, str) else s.get("path", "") for s in p.get("shared_files") or []]
        cats = {}
        for cf in p.get("conflict_files") or []:
            cats[cf.get("path")] = cf.get("category") or _classify(cf.get("path", ""))
        n_nd = n_d = 0
        y_nd = y_d = 0
        for path in shared:
            cat = cats.get(path) or _classify(path)
            if cat in DISSOLVABLE:
                n_d += 1
            else:
                n_nd += 1
        if p.get("result") == "conflict":
            conf_cats = [cats[k] for k in cats] or ["source"]
            y_nd = int(any(c not in DISSOLVABLE for c in conf_cats))
            y_d = int(any(c in DISSOLVABLE for c in conf_cats))
        nd_groups.append((n_nd, y_nd))
        d_groups.append((n_d, y_d))
        shared_counts.append(len(shared))
    total = sum(n_pairs.values())
    return {
        "p_per_file": solve_per_file(nd_groups),
        "p_per_file_diss": solve_per_file(d_groups),
        "pairs": total,
        "class_pairs": dict(n_pairs),
        "class_conflicts": dict(conflicts),
        "mean_shared_files": round(sum(shared_counts) / len(shared_counts), 3) if shared_counts else None,
    }


# --------------------------------------------------------------------------------------
# Step 2
# --------------------------------------------------------------------------------------
BREAKDOWNS = {"by_size", "per_change", "micro", "calibration", "operating_points", "at_recall", "recall_at",
              "top_k", "topk", "ceilings", "fit", "text_variants", "pair_flagging"}


def find_recall_precision(metrics, method: str | None = None, operating_point: str = "f1",
                          variant: str = "methods"):
    """Module-level recall and precision from step 2's metrics.json.

    Step 2 layout: metrics[variant][method] = {threshold, precision, recall, f1, at_recall{...},
    top_k{...}, ...}; variant 'methods' is title-only (the honest headline), 'methods_title_body'
    is optimistic. operating_point: 'f1' (the method's tuned threshold), 'recall:<target>'
    (at_recall), or 'topk'. Without that layout, falls back to the shallowest {recall, precision}
    entry that is not a breakdown (by_size, per_change, ...)."""
    table = metrics.get(variant) if isinstance(metrics, dict) else None
    if isinstance(table, dict) and any(isinstance(v, dict) and "recall" in v for v in table.values()):
        rows = []
        for name, m in table.items():
            if not isinstance(m, dict) or "recall" not in m:
                continue
            if method and name != method:
                continue
            entry, path = m, f"{variant}/{name}"
            if operating_point.startswith("recall:"):
                key = operating_point.split(":", 1)[1]
                entry = (m.get("at_recall") or {}).get(key)
                path += f"/at_recall/{key}"
            elif operating_point == "topk":
                entry = m.get("top_k")
                path += "/top_k"
            if not isinstance(entry, dict) or "recall" not in entry:
                continue
            r, p = float(entry["recall"]), float(entry["precision"])
            f1 = float(entry.get("f1") or (2 * r * p / (r + p) if r + p else 0.0))
            rows.append({"path": path, "method": name, "recall": r, "precision": p, "f1": f1,
                         "threshold": entry.get("threshold", m.get("threshold"))})
        if rows:
            return max(rows, key=lambda c: c["f1"])
    cands = []

    def walk(o, path):
        if isinstance(o, dict):
            r, p = o.get("recall"), o.get("precision")
            if isinstance(r, (int, float)) and isinstance(p, (int, float)) and not isinstance(r, bool):
                f1 = o.get("f1")
                if not isinstance(f1, (int, float)):
                    f1 = 2 * r * p / (r + p) if r + p > 0 else 0.0
                cands.append({"path": "/".join(path), "recall": float(r), "precision": float(p),
                              "f1": float(f1), "method": path[-1] if path else None,
                              "threshold": o.get("threshold"), "depth": len(path)})
            for k, v in o.items():
                walk(v, path + (str(k),))
        elif isinstance(o, list):
            for i, v in enumerate(o):
                walk(v, path + (str(i),))

    walk(metrics, ())
    want_topk = operating_point == "topk"
    pool = [c for c in cands
            if not (set(c["path"].split("/")) & (BREAKDOWNS - ({"top_k", "topk"} if want_topk else set())))]
    if want_topk:
        pool = [c for c in pool if any(seg in ("top_k", "topk") for seg in c["path"].split("/"))] or pool
    if method:
        pool = [c for c in pool if method in c["path"].split("/")]
    if not pool:
        return None
    shallow = min(c["depth"] for c in pool)
    pool = [c for c in pool if c["depth"] == shallow]
    return max(pool, key=lambda c: c["f1"])


def find_pair_flagging(metrics, method: str | None, threshold) -> dict | None:
    """Step 2's pair flagging for the chosen method at the threshold nearest the one used."""
    pf = metrics.get("pair_flagging") if isinstance(metrics, dict) else None
    if not isinstance(pf, dict):
        return None
    views = pf.get("views")
    if isinstance(views, dict) and method:
        view = views.get("all") or next(iter(views.values()), {})
        rows = ((view.get("methods") or {}).get(method) or {}).get("thresholds") or []
        if rows:
            if isinstance(threshold, (int, float)):
                row = min(rows, key=lambda r: abs(float(r.get("threshold", 0)) - threshold))
            else:
                row = rows[len(rows) // 2]
            out = {"method": method, "threshold": row.get("threshold")}
            for k in ("raw", "after_drivers"):
                if isinstance(row.get(k), dict):
                    out[k] = {kk: row[k].get(kk) for kk in ("conflict_recall", "clean_flag_rate", "lift")}
            return out
    if method and method in pf:
        return {method: pf[method]}
    return None


def flag_points_from_step2(step2: str, method: str | None, target: float = 0.60, tol: float = 0.05,
                           allow_body: bool = False) -> tuple[dict, dict]:
    """Pair-level placement operating points (conflict recall, clean-flag rate; after merge
    drivers) from step 2's pair_flagging.json at module level and every directory granularity.

    predicted     lowest clean-flag rate among predictors within +-tol of the target conflict recall
                  (title only unless allow_body: bodies are often written after the change)
    module-level  the chosen method's flag at its tuned module threshold
    file-oracle   a perfect file-level footprint
    module-oracle a perfect module-level footprint"""
    files = [(0, os.path.join(step2, "pair_flagging.json"))]
    files += [(d, os.path.join(step2, f"granularity-d{d}", "pair_flagging.json")) for d in (1, 2, 3)]
    cands = []
    points: dict = {}
    src: dict = {}

    def pt(r: dict):
        d = r.get("after_drivers") or r.get("raw") or r
        cr, cf = d.get("conflict_recall"), d.get("clean_flag_rate")
        return (float(cr), float(cf)) if isinstance(cr, (int, float)) and isinstance(cf, (int, float)) else None

    for gran, path in files:
        if not os.path.exists(path):
            continue
        views = (read_json(path).get("views") or {})
        for view, vd in views.items():
            for meth, md in (vd.get("methods") or {}).items():
                if meth.startswith("prior") or not isinstance(md, dict):
                    continue
                if meth.endswith("+body") and not allow_body:
                    continue
                rows = [(f"p>={r.get('threshold')}", r) for r in md.get("thresholds") or []]
                rows += [(f"top-{r.get('k')}", r) for r in md.get("topk") or []]
                if isinstance(md.get("tuned"), dict):
                    rows.append(("tuned", md["tuned"]))
                for lab, r in rows:
                    p = pt(r)
                    if p:
                        cands.append({"granularity": gran, "view": view, "method": meth, "point": lab,
                                      "recall": p[0], "clean": p[1]})
            if gran == 0 and view == "all":
                for name, key in (("file-oracle", "oracle_file"), ("module-oracle", "oracle_module")):
                    if isinstance(vd.get(key), dict) and pt(vd[key]):
                        points[name] = list(pt(vd[key]))
                        src[name] = f"step 2 {key}, module level, view all"
                m = (vd.get("methods") or {}).get(method or "combined") or {}
                if isinstance(m.get("tuned"), dict) and pt(m["tuned"]):
                    points["module-level"] = list(pt(m["tuned"]))
                    src["module-level"] = f"step 2 '{method or 'combined'}' at its tuned module threshold"
    if cands:
        near = [c for c in cands if abs(c["recall"] - target) <= tol]
        best = min(near, key=lambda c: c["clean"]) if near else min(cands, key=lambda c: abs(c["recall"] - target))
        points["predicted"] = [best["recall"], best["clean"]]
        src["predicted"] = (f"step 2 {best['method']} {best['point']}, granularity d{best['granularity']}, "
                            f"view {best['view']} (lowest clean-flag rate with conflict recall within "
                            f"{tol} of {target}{'' if allow_body else ', title only'})")
    points["hot-file-rule"] = [0.30, 0.02]
    src["hot-file-rule"] = "ASSUMED scenario (orchestrator): serialise only the few files that dominate conflicts"
    return {k: [round(v[0], 4), round(v[1], 4)] for k, v in points.items()}, src


# --------------------------------------------------------------------------------------
# Corpus footprints
# --------------------------------------------------------------------------------------
def footprints_from_corpus(corpus_path: str, private: bool, max_changes: int | None) -> dict:
    changes = list(read_jsonl(corpus_path))
    if max_changes:
        changes = changes[-max_changes:]
    touch_mod = collections.Counter()
    touch_diss = collections.Counter()
    change_mod = collections.Counter()
    file_touch: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    file_cat: dict[tuple[str, str], str] = {}
    for c in changes:
        mods = set()
        for f in c.get("files") or []:
            m = f.get("module") or "(root)"
            cat = f.get("category") or _classify(f.get("path", ""))
            mods.add(m)
            touch_mod[m] += 1
            touch_diss[m] += cat in DISSOLVABLE
            file_touch[m][f.get("path", "")] += 1
            file_cat[(m, f.get("path", ""))] = cat
        for m in mods:
            change_mod[m] += 1
    order = sorted(change_mod, key=lambda m: (-change_mod[m], m))
    index = {m: i for i, m in enumerate(order)}
    modules = []
    for i, m in enumerate(order):
        ranked = sorted(file_touch[m].items(), key=lambda kv: (-kv[1], kv[0]))
        diss_ranks = [r for r, (path, _) in enumerate(ranked) if file_cat[(m, path)] in DISSOLVABLE]
        share = touch_diss[m] / touch_mod[m] if touch_mod[m] else 0.0
        modules.append({
            "name": f"M{i + 1}" if private else m,
            "size": len(ranked),
            "changes": change_mod[m],
            "pop": round(change_mod[m] / len(changes), 5),
            "diss_touch_share": round(share, 4),
            "commutative": share >= COMMUTATIVE_SHARE,
            "diss_ranks": diss_ranks[:64],
        })
    entries = []
    ids = []
    for c in changes:
        per = collections.Counter((f.get("module") or "(root)") for f in c.get("files") or [])
        if per:
            entries.append([[index[m], n] for m, n in sorted(per.items(), key=lambda kv: index[kv[0]])])
            ids.append(c.get("id"))
    return {"modules": modules, "changes": entries, "n_changes": len(entries), "ids": ids,
            "index": index}


def predicted_sets(pred_path: str, method: str, threshold: float, index: dict, ids: list,
                   split: str | None = "eval") -> tuple[list, dict]:
    """Step 2's predicted module set per change (method at threshold), aligned with `ids`.
    Only the evaluation split by default: thresholds were tuned on the other slice."""
    by_id = {}
    stats = collections.Counter()
    for r in read_jsonl(pred_path):
        if split and r.get("split") not in (None, split):
            stats["other_split"] += 1
            continue
        probs = (r.get("pred") or {}).get(method)
        if probs is None:
            stats["missing_method"] += 1
            continue
        mods = []
        for m, p in probs.items():
            if p >= threshold:
                if m in index:
                    mods.append(index[m])
                else:
                    stats["unknown_module"] += 1
        by_id[r.get("id")] = sorted(mods)
        stats["used"] += 1
    aligned = [by_id.get(i) for i in ids]
    stats["aligned"] = sum(1 for a in aligned if a is not None)
    return aligned, dict(stats)


def fit_zipf_from_touches(corpus_path: str) -> float | None:
    """Pooled log-log slope of file touch counts against popularity rank within modules."""
    file_touch: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for c in read_jsonl(corpus_path):
        for f in c.get("files") or []:
            file_touch[f.get("module") or "(root)"][f.get("path", "")] += 1
    xs, ys = [], []
    for counts in file_touch.values():
        ranked = sorted(counts.values(), reverse=True)
        if len(ranked) < 5:
            continue
        for r, n in enumerate(ranked[:200]):
            xs.append(math.log(r + 1))
            ys.append(math.log(n))
    if len(xs) < 10:
        return None
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    sxx = sum((x - mx) ** 2 for x in xs)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    return max(0.3, min(3.0, -sxy / sxx)) if sxx > 0 else None


def fit_zipf_to_pairs(params: dict, target_file_given_shared: float, window: int,
                      n_tasks: int = 2500, seed: int = 0) -> tuple[float, float]:
    """Exponent s whose simulated share of file-sharing pairs among module-sharing pairs matches
    step 1's (bisection; the share rises with s)."""
    def share(s: float) -> float:
        p = sim.deep_merge(params, {"footprint": {"zipf_s": s}})
        st = sim.footprint_stats(p, seed=seed, n_tasks=n_tasks, window=window)["raw"]["class_share"]
        denom = st["file"] + st["module"]
        return st["file"] / denom if denom > 0 else 0.0

    lo, hi = 0.2, 3.0
    s_lo, s_hi = share(lo), share(hi)
    if target_file_given_shared <= s_lo:
        return lo, s_lo
    if target_file_given_shared >= s_hi:
        return hi, s_hi
    val = s_lo
    for _ in range(12):
        mid = (lo + hi) / 2
        val = share(mid)
        if val < target_file_given_shared:
            lo = mid
        else:
            hi = mid
    return round((lo + hi) / 2, 3), val


# --------------------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------------------
def calibrate(a) -> dict:
    corpus = a.corpus
    private = a.private if a.private is not None else corpus in PRIVATE_CORPORA
    sub = os.path.join("private", corpus) if private else corpus
    step1 = a.step1 or first_existing(
        os.path.join(RESEARCH, "contention-replay", "out", sub),
        os.path.join(RESEARCH, "contention-replay", "out", corpus))
    if not step1 or not os.path.exists(os.path.join(step1, "summary.json")):
        raise SystemExit(f"step 1 summary.json not found (looked in {step1}); pass --step1")
    step2 = a.step2 or first_existing(
        os.path.join(RESEARCH, "footprint-prediction", "out", sub),
        os.path.join(RESEARCH, "footprint-prediction", "out", corpus))
    corpus_file = a.corpus_file or first_existing(
        os.path.join(RESEARCH, "data", sub, "corpus.jsonl"),
        os.path.join(RESEARCH, "data", corpus, "corpus.jsonl"))

    params = sim.load_params(a.base)
    for k in ("sources", "scenarios", "sanity_targets", "description", "name"):
        params.pop(k, None)
    notes: list[str] = []
    measured: dict = {}

    # ---- step 1
    summary = read_json(os.path.join(step1, "summary.json"))
    rates = class_rates(summary)
    measured["by_overlap_class"] = rates
    for c, key in (("file", "p_file"), ("module", "p_module"), ("disjoint", "p_disjoint")):
        if rates[c]["rate"] is not None:
            params[key] = round(float(rates[c]["rate"]), 6)
    if summary.get("dissolvable_share") is not None:
        params["dissolvable_share"] = round(float(summary["dissolvable_share"]), 6)
    if summary.get("dependency_rate") is not None:
        params["dependency_rate"] = round(float(summary["dependency_rate"]), 6)
    if summary.get("window_size"):
        params["dep_window"] = int(summary["window_size"])
    sem = summary.get("semantic")
    if isinstance(sem, dict) and sem.get("rate") is not None:
        params["q_sem"] = round(float(sem["rate"]), 6)
        notes.append(f"q_sem set from step 1's semantic check ({sem.get('clean_but_broken')} of "
                     f"{sem.get('pairs_checked')} clean pairs broke); experiments.py still sweeps q_sem.")
    else:
        notes.append("q_sem not measured by step 1; kept the default and swept by experiments.py.")
    for key in ("conflict_rate", "conflict_rate_after_drivers", "entangled_rate", "per_change_collision_rate",
                "p_collision_among_n", "module_concentration", "max_compatible_batch", "category_share",
                "window_size", "windows", "changes", "eligible", "pairs", "dependency_rate", "semantic"):
        if key in summary:
            measured[key] = summary[key]

    pairs_path = os.path.join(step1, "pairs.jsonl")
    if os.path.exists(pairs_path):
        pf = per_file_from_pairs(pairs_path)
        measured["pairs_jsonl"] = pf
        if pf["p_per_file"] is not None:
            params["conflict_model"] = "per_file"
            params["p_per_file"] = round(pf["p_per_file"], 6)
            if pf["p_per_file_diss"] is not None:
                params["p_per_file_diss"] = round(pf["p_per_file_diss"], 6)
            notes.append("conflict_model per_file: per-shared-file probabilities fitted on step 1's "
                         "file-class pairs (entangled pairs excluded).")
    else:
        params["conflict_model"] = "class"
        notes.append("pairs.jsonl not found: class model (p_file / p_module / p_disjoint with "
                     "dissolvable_share) instead of the per-file model.")

    # ---- step 2
    if step2 and os.path.exists(os.path.join(step2, "metrics.json")):
        metrics = read_json(os.path.join(step2, "metrics.json"))
        rp = find_recall_precision(metrics, a.method, a.operating_point, a.variant)
        if rp:
            params["recall"] = round(rp["recall"], 4)
            params["precision"] = round(rp["precision"], 4)
            measured["prediction"] = rp
            notes.append(f"recall/precision from step 2 metrics.json entry '{rp['path']}' "
                         f"(F1 {rp['f1']:.3f}).")
            flag = find_pair_flagging(metrics, rp.get("method"), rp.get("threshold"))
            if flag is not None:
                measured["pair_flagging"] = flag
    else:
        notes.append("step 2 metrics.json not found: recall/precision kept at the defaults.")
    if step2 and os.path.exists(os.path.join(step2, "pair_flagging.json")):
        rp = measured.get("prediction") or {}
        pts, psrc = flag_points_from_step2(step2, rp.get("method"), a.flag_target_recall, 0.05, a.flag_body)
        if "predicted" in pts:
            params["placement_model"] = "pair"
            params["flag_recall"], params["flag_clean"] = pts["predicted"]
            params["flag_points"] = pts
            measured["flag_points"] = {"points": pts, "sources": psrc}
            notes.append(f"pair-level placement at step 2's measured operating point {pts['predicted']} "
                         f"({psrc['predicted']}).")

    # ---- footprints
    if corpus_file:
        fp = footprints_from_corpus(corpus_file, private, a.max_changes)
        params["footprint"] = {
            "model": "empirical",
            "modules": fp["modules"],
            "changes": fp["changes"],
            "zipf_s": params["footprint"].get("zipf_s", 1.0),
            "block_len": int(summary.get("window_size") or a.block_len),
            "gen_seed": 7,
        }
        rp = measured.get("prediction")
        pred_path = os.path.join(step2, "predictions.jsonl") if step2 else None
        if rp and pred_path and os.path.exists(pred_path) and isinstance(rp.get("threshold"), (int, float)):
            aligned, pst = predicted_sets(pred_path, rp["method"], float(rp["threshold"]),
                                          fp["index"], fp["ids"], a.split or None)
            if pst.get("aligned", 0) >= 20:
                params["footprint"]["predicted"] = aligned
                params["prediction_model"] = "empirical"
                measured["predictions_jsonl"] = pst
                notes.append(f"prediction_model empirical: step 2's '{rp['method']}' predicted sets at "
                             f"threshold {float(rp['threshold']):.3f} for {pst['aligned']} changes "
                             f"({a.split or 'all'} split); tasks are bootstrapped from those changes.")
        measured["corpus_changes"] = fp["n_changes"]
        measured["modules"] = len(fp["modules"])
        measured["commutative_modules"] = [m["name"] for m in fp["modules"] if m["commutative"]]
        s_touch = fit_zipf_from_touches(corpus_file)
        if s_touch:
            params["footprint"]["zipf_s"] = round(s_touch, 3)
            measured["zipf_s_touch_fit"] = round(s_touch, 3)
        fc = rates["file"]["pairs"] or 0
        mc = rates["module"]["pairs"] or 0
        if a.fit_zipf and fc + mc > 0:
            target = fc / (fc + mc)
            s_fit, achieved = fit_zipf_to_pairs(params, target, int(summary.get("window_size") or 20))
            params["footprint"]["zipf_s"] = s_fit
            measured["zipf_fit"] = {"target_file_share_of_sharing_pairs": round(target, 4),
                                    "achieved": round(achieved, 4), "zipf_s": s_fit}
            notes.append("zipf_s fitted so the simulated share of file-sharing pairs among "
                         "module-sharing pairs matches step 1.")
    else:
        notes.append("corpus.jsonl not found: kept the parametric footprint model.")

    check = sim.footprint_stats(params, n_tasks=a.check_tasks, window=int(summary.get("window_size") or 20))
    if private:
        dropped: list = []
        commutative = measured.pop("commutative_modules", None)
        measured = scrub_private(measured, dropped)
        if commutative is not None:
            measured["commutative_modules"] = commutative     # already rank names (M1, M2, ...)
        if dropped:
            notes.append(f"private corpus: dropped {len(dropped)} non-aggregate measured fields.")
    params["name"] = corpus
    params["description"] = (f"Calibrated from steps 1-2 for corpus '{corpus}'. Rates are measured on "
                             f"that corpus; agent, CI and failure parameters are the defaults.")
    params["calibration"] = {
        "corpus": corpus,
        "private": private,
        "inputs": {"step1": os.path.relpath(step1, RESEARCH),
                   "step2": os.path.relpath(step2, RESEARCH) if step2 else None,
                   "corpus": os.path.relpath(corpus_file, RESEARCH) if corpus_file else None,
                   "base": os.path.relpath(a.base, RESEARCH) if a.base and a.base != "none" else a.base},
        "measured": measured,
        "simulated_check": check,
        "notes": notes,
    }
    return params


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Build params/<corpus>.json from steps 1-2 outputs.")
    ap.add_argument("--corpus", required=True, help="corpus name, e.g. codex, workers-sdk, platform")
    ap.add_argument("--step1", help="step 1 output dir (default contention-replay/out/[private/]<corpus>)")
    ap.add_argument("--step2", help="step 2 output dir (default footprint-prediction/out/[private/]<corpus>)")
    ap.add_argument("--corpus-file", help="corpus.jsonl (default data/[private/]<corpus>/corpus.jsonl)")
    ap.add_argument("--base", default=os.path.join(HERE, "params", "default.json"),
                    help="params supplying everything not calibrated (default params/default.json)")
    ap.add_argument("--out", help="output path (default params/<corpus>.json or params/private/<corpus>.json)")
    priv = ap.add_mutually_exclusive_group()
    priv.add_argument("--private", dest="private", action="store_true", default=None,
                      help="anonymise module names and write under params/private/")
    priv.add_argument("--public", dest="private", action="store_false",
                      help="keep module names and write under params/")
    ap.add_argument("--method", help="step 2 method to take recall/precision from (default best F1)")
    ap.add_argument("--operating-point", default="f1",
                    help="step 2 operating point: f1 (tuned threshold, default), recall:0.6, recall:0.8 or topk")
    ap.add_argument("--split", default="eval",
                    help="predictions.jsonl split to use for real predicted sets ('' = all)")
    ap.add_argument("--flag-target-recall", type=float, default=0.60,
                    help="conflict recall of the predicted placement operating point (default 0.60)")
    ap.add_argument("--flag-body", action="store_true",
                    help="allow title+body predictors for the placement operating point (optimistic)")
    ap.add_argument("--variant", default="methods",
                    help="step 2 table: methods (title only, default) or methods_title_body (optimistic)")
    ap.add_argument("--no-fit-zipf", dest="fit_zipf", action="store_false",
                    help="keep the touch-count Zipf exponent instead of fitting it to step 1's pairs")
    ap.add_argument("--block-len", type=int, default=20, help="bootstrap block length if step 1 has no window")
    ap.add_argument("--max-changes", type=int, default=None, help="use only the newest N corpus changes")
    ap.add_argument("--check-tasks", type=int, default=3000, help="tasks drawn for the simulated pair check")
    a = ap.parse_args(argv)

    params = calibrate(a)
    private = params["calibration"]["private"]
    out = a.out or os.path.join(HERE, "params", "private" if private else "", f"{a.corpus}.json")
    if private and "private" not in os.path.normpath(out).split(os.sep):
        raise SystemExit(f"refusing to write private corpus params outside a private/ directory: {out}")
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "w") as fh:
        json.dump(params, fh, indent=1)
        fh.write("\n")
    chk = params["calibration"]["simulated_check"]["drivers"]
    print(f"wrote {out}")
    print(f"  conflict_model={params['conflict_model']} p_file={params['p_file']} p_per_file={params['p_per_file']} "
          f"p_module={params['p_module']} dissolvable_share={params['dissolvable_share']} "
          f"dependency_rate={params['dependency_rate']} recall={params['recall']} precision={params['precision']} "
          f"zipf_s={params['footprint'].get('zipf_s')}")
    print(f"  simulated pairs (drivers on): class_share={chk['class_share']} "
          f"pair_conflict_rate={chk['pair_conflict_rate']} per_change_collision_rate={chk['per_change_collision_rate']}")
    for n in params["calibration"]["notes"]:
        print(f"  note: {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
