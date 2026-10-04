#!/usr/bin/env python3
"""E7 part B: matched comparisons of a mixed-fleet run against the Claude-only baseline runs on the SAME tasks.

Input is the JSON written by e7_mixed.py (--json). The baseline runs (seeds 7 and 11, id order, Sonnet) cover
all 40 tasks, so for every task a Codex agent authored in the mixed run there is a Claude-only reference:
first-attempt acceptance, first-attempt cost and wall time, files touched, and which files.

Usage: python3 e7_compare.py --mixed results/mixed-<name>.json --baseline results/base-<a>.json [...] [--md out.md]

Outputs per vendor (author of the task in the mixed run):
  * first attempt passes its own acceptance tests: mixed run vs the baselines' rate on the same tasks;
  * cost / wall / turns of the first attempt, mixed run vs baselines on the same tasks;
  * files per change and hot files per change;
  * footprint divergence: mean Jaccard of the first-attempt file sets for the same task, Codex-vs-Claude against
    Claude-vs-Claude (across the baseline runs). A lower cross-vendor value means the vendors pick different
    files for the same task, one way cross-vendor pairs can collide differently.
"""
from __future__ import annotations

import argparse
import itertools
import json
import os
import statistics
import sys

HOT = ("CHANGELOG.md", "README.md", "src/routes.ts", "src/types.ts", "src/config.ts", "src/lib/money.ts",
       "src/db/migrations/index.ts")


def load(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        d = json.load(fh)
    # e7_mixed.py writes {run name: entry}; take the single entry
    name, entry = next(iter(d.items()))
    entry["name"] = name
    return entry


def jaccard(a: list[str], b: list[str]) -> float | None:
    A, B = set(a), set(b)
    if not A and not B:
        return None
    return len(A & B) / len(A | B)


def mean(xs: list[float]) -> float | None:
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def sd(xs: list[float]) -> float | None:
    xs = [x for x in xs if x is not None]
    return statistics.stdev(xs) if len(xs) > 1 else None


def f(x, d=2) -> str:
    return "n/a" if x is None else f"{x:.{d}f}"


def matched(mixed: dict, baselines: list[dict]) -> dict:
    """Per author vendor in the mixed run: the same tasks' values in the mixed run and in the baselines."""
    out: dict[str, dict] = {}
    for vendor in sorted({t["vendor"] for t in mixed["tasks"].values()}):
        tids = [tid for tid, t in mixed["tasks"].items() if t["vendor"] == vendor]
        rec: dict = {"tasks": len(tids)}
        for key in ("first_own_pass", "first_suite_pass"):
            mv = [mixed["tasks"][t][key] for t in tids if mixed["tasks"][t][key] is not None]
            bv = [b["tasks"][t][key] for b in baselines for t in tids if b["tasks"].get(t, {}).get(key) is not None]
            rec[key] = {"mixed": (sum(map(bool, mv)), len(mv)), "baseline": (sum(map(bool, bv)), len(bv))}
        for key in ("first_cost", "first_wall", "first_turns", "files", "rework_cost", "reworks", "conflicts", "reds"):
            mv = [mixed["tasks"][t][key] for t in tids if mixed["tasks"][t][key] is not None]
            bv = [mean([b["tasks"][t][key] for b in baselines if b["tasks"].get(t, {}).get(key) is not None])
                  for t in tids]
            rec[key] = {"mixed": mean(mv), "baseline": mean(bv)}
        hot = lambda files: sum(1 for x in files if x in HOT)  # noqa: E731
        rec["hot_files"] = {
            "mixed": mean([hot(mixed["tasks"][t]["initial_files"]) for t in tids]),
            "baseline": mean([hot(b["tasks"][t]["initial_files"]) for b in baselines for t in tids
                              if t in b["tasks"]])}
        out[vendor] = rec
    return out


def divergence(mixed: dict, baselines: list[dict]) -> dict:
    """Same task, different run: Jaccard of the first-attempt file sets."""
    cross: list[float] = []
    within_claude: list[float] = []
    per_task: dict[str, dict] = {}
    for tid, t in mixed["tasks"].items():
        refs = [b["tasks"][tid]["initial_files"] for b in baselines if tid in b["tasks"]]
        if t["vendor"] == "codex":
            js = [jaccard(t["initial_files"], r) for r in refs]
            cross += [j for j in js if j is not None]
            per_task[tid] = {"codex_vs_claude": mean(js)}
    for tid in mixed["tasks"]:
        refs = [b["tasks"][tid]["initial_files"] for b in baselines if tid in b["tasks"]]
        for a, b in itertools.combinations(refs, 2):
            j = jaccard(a, b)
            if j is not None:
                within_claude.append(j)
    cl_in_mixed = []
    for tid, t in mixed["tasks"].items():
        if t["vendor"] == "claude":
            cl_in_mixed += [j for j in (jaccard(t["initial_files"], b["tasks"][tid]["initial_files"])
                                        for b in baselines if tid in b["tasks"]) if j is not None]
    return {"codex_vs_claude": mean(cross), "codex_vs_claude_n": len(cross),
            "claude_vs_claude_baselines": mean(within_claude), "claude_vs_claude_n": len(within_claude),
            "claude_in_mixed_vs_baselines": mean(cl_in_mixed), "claude_in_mixed_n": len(cl_in_mixed),
            "per_task": per_task}


def all_pairs_overlap(run: dict) -> dict[frozenset, bool]:
    """For every pair of tasks: do their first attempts touch a common file (acceptance tests excluded)?
    A property of the two diffs, independent of landing order, so it exists for all 780 pairs of a run."""
    tids = [t for t, r in run["tasks"].items() if r.get("initial_files") is not None]
    out = {}
    for a, b in itertools.combinations(tids, 2):
        out[frozenset((a, b))] = bool(set(run["tasks"][a]["initial_files"]) & set(run["tasks"][b]["initial_files"]))
    return out


def labelled_type(labels: dict[str, str], a: str, b: str) -> str:
    return "cross" if labels[a] != labels[b] else "same"


def overlap_counts(run: dict, labels: dict[str, str]) -> dict[str, list[int]]:
    """[pairs sharing a file, pairs] by pair type, for ``run``'s own diffs under a given task->vendor labelling."""
    out = {"cross": [0, 0], "same": [0, 0]}
    for key, flag in all_pairs_overlap(run).items():
        a, b = tuple(key)
        if a in labels and b in labels:
            t = labelled_type(labels, a, b)
            out[t][0] += 1 if flag else 0
            out[t][1] += 1
    return out


def overlap_vs_baseline(mixed: dict, baselines: list[dict]) -> dict:
    """Label transfer. Label the tasks with the mixed run's vendor split (which tasks Codex got) and count
    file-sharing pairs by type in (a) the mixed run and (b) every Claude-only baseline run under the SAME labels.
    The baselines say what that task split gives when every agent is Claude (task mix cancels); their
    leave-one-out deviations from each other are the noise floor for a Claude-only run."""
    labels = {t: r["vendor"] for t, r in mixed["tasks"].items()}
    obs = overlap_counts(mixed, labels)
    base = [overlap_counts(b, labels) for b in baselines]
    out: dict[str, dict] = {}
    for typ in ("cross", "same"):
        counts = [b[typ][0] for b in base]
        exp = mean(counts)
        loo = [c - mean([x for j, x in enumerate(counts) if j != i]) for i, c in enumerate(counts)] if len(counts) > 2 else []
        floor = sd(loo)
        dev = obs[typ][0] - exp
        out[typ] = {"pairs": obs[typ][1], "observed": obs[typ][0], "baseline_mean": exp,
                    "baseline_min": min(counts), "baseline_max": max(counts), "deviation": dev,
                    "noise_sd": floor, "z": (dev / floor) if floor else None, "n_baselines": len(counts)}
    return out


def conflict_rates(run: dict, labels: dict[str, str]) -> dict[str, list[int]]:
    """[conflicting, probed] among concurrent landed pairs by pair type under a labelling."""
    out = {"cross": [0, 0], "same": [0, 0]}
    for p in run.get("pair_rows", []):
        if p["status"] not in ("clean", "conflict") or p["i"] not in labels or p["j"] not in labels:
            continue
        t = labelled_type(labels, p["i"], p["j"])
        out[t][0] += 1 if p["status"] == "conflict" else 0
        out[t][1] += 1
    return out


def conflict_given_overlap_rates(run: dict, labels: dict[str, str]) -> dict[str, list[int]]:
    """[conflicting, probed] among concurrent landed pairs whose first attempts share a file (the pairs that
    can conflict at all), by pair type under a labelling."""
    out = {"cross": [0, 0], "same": [0, 0]}
    for p in run.get("pair_rows", []):
        if p["status"] not in ("clean", "conflict") or not p.get("shared_files"):
            continue
        if p["i"] not in labels or p["j"] not in labels:
            continue
        t = labelled_type(labels, p["i"], p["j"])
        out[t][0] += 1 if p["status"] == "conflict" else 0
        out[t][1] += 1
    return out


def conflicts_given_overlap_vs_baseline(mixed: dict, baselines: list[dict]) -> dict:
    labels = {t: r["vendor"] for t, r in mixed["tasks"].items()}
    obs = conflict_given_overlap_rates(mixed, labels)
    base = [conflict_given_overlap_rates(b, labels) for b in baselines]
    out: dict[str, dict] = {}
    for typ in ("cross", "same"):
        rates = [b[typ][0] / b[typ][1] for b in base if b[typ][1]]
        pooled = [sum(b[typ][0] for b in base), sum(b[typ][1] for b in base)]
        out[typ] = {"conflicts": obs[typ][0], "probed": obs[typ][1],
                    "rate": (obs[typ][0] / obs[typ][1]) if obs[typ][1] else None,
                    "baseline_pooled": pooled, "baseline_rate_pooled": (pooled[0] / pooled[1]) if pooled[1] else None,
                    "baseline_rate_min": min(rates) if rates else None,
                    "baseline_rate_max": max(rates) if rates else None, "n_baselines": len(rates)}
    return out


def conflicts_vs_baseline(mixed: dict, baselines: list[dict]) -> dict:
    """Same label transfer for leave-one-out conflicts among concurrent landed pairs (rates, since the baselines
    land their changes in a different order and so probe different pairs)."""
    labels = {t: r["vendor"] for t, r in mixed["tasks"].items()}
    obs = conflict_rates(mixed, labels)
    base = [conflict_rates(b, labels) for b in baselines]
    out: dict[str, dict] = {}
    for typ in ("cross", "same"):
        rates = [b[typ][0] / b[typ][1] for b in base if b[typ][1]]
        out[typ] = {"conflicts": obs[typ][0], "probed": obs[typ][1],
                    "rate": (obs[typ][0] / obs[typ][1]) if obs[typ][1] else None,
                    "baseline_rate_mean": mean(rates), "baseline_rate_min": min(rates) if rates else None,
                    "baseline_rate_max": max(rates) if rates else None, "n_baselines": len(rates)}
    return out


def md(mixed: dict, baselines: list[dict], pool: list[dict] | None = None) -> str:
    """``baselines``: same-policy, same-order Claude-only runs (per-task matched metrics). ``pool``: every
    Claude-only run (footprints are nearly policy-independent), for the label-transfer overlap, conflict and
    divergence analyses; defaults to ``baselines``."""
    pool = pool or baselines
    m = matched(mixed, baselines)
    L = [f"### {mixed['name']} against {len(baselines)} Claude-only baseline runs ("
         + ", ".join(b["name"] for b in baselines) + ")", "",
         "Same tasks, matched per author vendor of the mixed run. Baseline = Claude Sonnet on every task.", "",
         "| Author vendor (tasks) | metric | mixed run | Claude-only baselines on the same tasks |", "|---|---|---|---|"]
    for v, r in m.items():
        for key, label in (("first_own_pass", "first attempt passes its own acceptance tests"),
                           ("first_suite_pass", "first attempt passes the whole suite of its snapshot")):
            a, b = r[key]["mixed"], r[key]["baseline"]
            L.append(f"| {v} ({r['tasks']}) | {label} | {a[0]} of {a[1]} | {b[0]} of {b[1]} "
                     f"({(b[0] / b[1]) if b[1] else float('nan'):.0%}) |")
        for key, label, d in (("first_cost", "cost of the first attempt, USD", 3), ("first_wall", "wall time of the first attempt, s", 1),
                              ("first_turns", "turns / items of the first attempt", 1), ("files", "files per change", 2),
                              ("hot_files", "hot files per change", 2), ("reworks", "rework rounds per task", 2),
                              ("conflicts", "textual conflicts per task", 2), ("reds", "red checks per task", 2),
                              ("rework_cost", "rework cost per task, USD", 3)):
            L.append(f"| {v} ({r['tasks']}) | {label} | {f(r[key]['mixed'], d)} | {f(r[key]['baseline'], d)} |")
    ov = overlap_vs_baseline(mixed, pool)
    L += ["", "Do changes touch the same files more across vendors? All 780 task pairs, first attempts only. The tasks "
          "are labelled with this run's vendor split; the same labels are applied to every Claude-only baseline "
          "run, so the task mix cancels. Noise = standard deviation of a baseline run's count around the mean "
          "of the other baselines (leave-one-out).", "",
          "| Pair type | pairs | sharing a file in the mixed run | Claude-only baselines, same labels: mean [min, max] | "
          "mixed minus baseline mean | baseline noise (sd) | deviation / noise |", "|---|---|---|---|---|---|---|"]
    for typ in ("cross", "same"):
        o = ov[typ]
        L.append(f"| {typ} | {o['pairs']} | {o['observed']} | {f(o['baseline_mean'], 1)} [{o['baseline_min']}, "
                 f"{o['baseline_max']}] (n={o['n_baselines']}) | {o['deviation']:+.1f} | {f(o['noise_sd'], 1)} | "
                 f"{f(o['z'], 1)} |")
    cf = conflicts_vs_baseline(mixed, pool)
    L += ["", "Leave-one-out conflicts among concurrent landed pairs (rate = conflicting / probed), under the same "
          "labels, against the Claude-only baselines:", "",
          "| Pair type | mixed run: conflicting / probed | rate | Claude-only baselines, same labels: mean rate [min, max] |",
          "|---|---|---|---|"]
    for typ in ("cross", "same"):
        o = cf[typ]
        L.append(f"| {typ} | {o['conflicts']} / {o['probed']} | {f(o['rate'] and 100 * o['rate'], 1)}% | "
                 f"{f(o['baseline_rate_mean'] and 100 * o['baseline_rate_mean'], 1)}% "
                 f"[{f(o['baseline_rate_min'] and 100 * o['baseline_rate_min'], 1)}%, "
                 f"{f(o['baseline_rate_max'] and 100 * o['baseline_rate_max'], 1)}%] (n={o['n_baselines']}) |")
    cg = conflicts_given_overlap_vs_baseline(mixed, pool)
    L += ["", "Conflict given a shared file (concurrent landed pairs whose first attempts touch a common file: the pairs "
          "that can conflict), same labels, against the Claude-only baselines pooled:", "",
          "| Pair type | mixed run: conflicting / sharing a file | rate | Claude-only baselines, same labels: pooled conflicting / sharing | pooled rate [per-run min, max] |",
          "|---|---|---|---|---|"]
    for typ in ("cross", "same"):
        o = cg[typ]
        bp = o["baseline_pooled"]
        L.append(f"| {typ} | {o['conflicts']} / {o['probed']} | {f(o['rate'] is not None and 100 * o['rate'] or None, 0)}% | "
                 f"{bp[0]} / {bp[1]} | {f(o['baseline_rate_pooled'] is not None and 100 * o['baseline_rate_pooled'] or None, 0)}% "
                 f"[{f(o['baseline_rate_min'] is not None and 100 * o['baseline_rate_min'] or None, 0)}%, "
                 f"{f(o['baseline_rate_max'] is not None and 100 * o['baseline_rate_max'] or None, 0)}%] |")
    dv = divergence(mixed, pool)
    L += ["", "Footprint divergence (mean Jaccard of the first attempt's file set for the same task; 1 = identical):", "",
          "| Comparison | mean Jaccard | pairs |", "|---|---|---|",
          f"| Codex (mixed run) vs Claude (baselines) | {f(dv['codex_vs_claude'])} | {dv['codex_vs_claude_n']} |",
          f"| Claude (mixed run) vs Claude (baselines) | {f(dv['claude_in_mixed_vs_baselines'])} | {dv['claude_in_mixed_n']} |",
          f"| Claude vs Claude, between baseline runs | {f(dv['claude_vs_claude_baselines'])} | {dv['claude_vs_claude_n']} |", ""]
    return "\n".join(L)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--mixed", nargs="+", required=True)
    ap.add_argument("--baseline", nargs="+", required=True, help="same-policy Claude-only runs in the same task order")
    ap.add_argument("--pool", nargs="*", default=[], help="all Claude-only runs, for the label-transfer analyses")
    ap.add_argument("--md")
    a = ap.parse_args()
    base = [load(p) for p in a.baseline]
    pool = [load(p) for p in a.pool] or None
    out = "\n".join(md(load(p), base, pool) for p in a.mixed)
    print(out)
    if a.md:
        with open(a.md, "w", encoding="utf-8") as fh:
            fh.write(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
