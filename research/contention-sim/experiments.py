#!/usr/bin/env python3
"""Sweep the contention simulator and write out/<params-name>/results.csv and results.md.

Groups (each configuration runs --seeds seeds; seeds are common random numbers, so every
policy faces the same tasks, footprints and latent conflict draws for a given seed):
  main     every spec policy at N in {5, 20, 100, 500, 1000}, M = 10 N, R = max(2, N/10)
  queue    stronger queue baselines: batch size k in {1, 16}, the partitioned queue (k = 1, 4)
  fair     fairness variants: released queue agents, queue suspects, Beanstalk quarantine
           promotion, no error budget, green snapshots, wait fallback
  qsem     q_sem in {0, 0.05, 0.1, 0.2}
  rho      recall in {0.4, 0.6, 0.8, 1.0} (perturbation model)
  fixedR   R = 10 at every N (CI saturation)
  regime   failure and conflict regimes: p_self 0.05 / 0.30, the 'aidev-upper' conflict
           scenario, 30-minute CI
--grid quick trims every group to N in {20, 100} and 3 seeds for a fast look.

Private params (params/private/*.json) write to out/private/<name>/, which is git-ignored.
Outputs are simulated numbers. Standard library only.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import sys
import time
from multiprocessing import Pool

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import sim  # noqa: E402

N_ALL = [5, 20, 100, 500, 1000]
T95 = {1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262,
       10: 2.228, 11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131, 19: 2.093, 29: 2.045}

# (label, policy, overrides). Labels name a variant; the policy column keeps the base policy.
QUEUE_BEST = [
    ("serial", "serial", {}),
    ("batched k=4", "batched", {}),
    ("batched k=1", "batched", {"batch_k": 1}),
    ("batched k=16", "batched", {"batch_k": 16}),
    ("batched-aimd", "batched-aimd", {}),
    ("batched-par k=1", "batched-par", {"batch_k": 1}),
    ("batched-par k=4", "batched-par", {"batch_k": 4}),
    ("batched+place", "batched+place", {}),
]
QUEUE_LABELS = {lab for lab, _, _ in QUEUE_BEST} | {"batched k=1 released", "batched k=4 suspects",
                                                    "batched-par k=4 suspects"}
BEAN_SPEC = "beanstalk"


DEFAULT_FLAG_POINTS = {"predicted-best": [0.60, 0.15], "predicted-typical": [0.60, 0.25],
                       "module-level": [0.90, 0.60], "file-oracle": [1.00, 0.05], "hot-file-rule": [0.30, 0.02]}


def grid(which: str, params: dict) -> list[dict]:
    """Configurations for a sweep. 'full' is the default-params study; 'corpus' is the smaller
    grid for calibrated params; 'quick' is a smoke test. Trims (to stay near 15 minutes):
    k = 16 and the partitioned queue with k = 4 only at N <= 100; q_sem, placement and recall
    sweeps stop at N = 500 (placement keeps N = 1000 for two operating points); fixed-R at
    N = 1000 runs three policies."""
    cfgs: list[dict] = []
    points = params.get("flag_points") or DEFAULT_FLAG_POINTS

    def add(group, label, policy, N, over=None, note=""):
        cfgs.append({"group": group, "label": label, "policy": policy, "N": N, "over": over or {},
                     "note": note})

    if which == "quick":
        Ns, N3, Np, Nq, Nf = [20, 100], [20, 100], [20, 100], [20, 100], [20]
    elif which == "corpus":
        Ns, N3, Np, Nq, Nf = N_ALL, [20, 100, 1000], [20, 100, 500], [20, 100], []
    else:
        Ns, N3, Np, Nq, Nf = N_ALL, [20, 100, 1000], [20, 100, 500], [20, 100, 500], [5, 20, 500, 1000]
    for N in Ns:
        add("main", "serial", "serial", N)
        add("main", "batched k=4", "batched", N)
        add("main", "batched-aimd", "batched-aimd", N)
        add("main", "batched+place", "batched+place", N)
        add("main", "beanstalk", "beanstalk", N)
        add("main", "beanstalk-noplace", "beanstalk-noplace", N)
        add("queue", "batched k=1", "batched", N, {"batch_k": 1})
        add("queue", "batched-par k=1", "batched-par", N, {"batch_k": 1})
        if N <= 100:
            add("queue", "batched k=16", "batched", N, {"batch_k": 16})
            add("queue", "batched-par k=4", "batched-par", N, {"batch_k": 4})
    for N in N3:
        add("fair", "batched k=1 released", "batched", N, {"batch_k": 1, "queue_agents": "released"})
        if N <= 100:
            add("fair", "batched k=4 suspects", "batched", N, {"queue_suspects": True})
            add("fair", "batched-par k=4 suspects", "batched-par", N, {"batch_k": 4, "queue_suspects": True})
        add("fair", "beanstalk quarantine", "beanstalk", N, {"green_mode": "quarantine"})
        add("fair", "beanstalk no-budget", "beanstalk", N, {"budget": False})
        add("fair", "beanstalk quarantine no-budget", "beanstalk", N, {"green_mode": "quarantine", "budget": False})
        add("fair", "beanstalk-noplace quarantine", "beanstalk-noplace", N, {"green_mode": "quarantine"})
        if which != "corpus":
            add("fair", "beanstalk snapshot=green", "beanstalk", N, {"snapshot": "green"})
            add("fair", "beanstalk module placement", "beanstalk", N, {"placement_model": "module"})
    # placement operating points (pair level), soft and hard
    for name, (fr, fc) in points.items():
        for N in Np + ([1000] if which == "full" and name in ("predicted-typical", "file-oracle") else []):
            for mode, fb in (("soft", "least-overlap"), ("hard", "wait")):
                add("place", f"beanstalk {mode}", "beanstalk", N,
                    {"flag_recall": fr, "flag_clean": fc, "placement_fallback": fb}, note=name)
    for N in N3[:2]:
        for mode, fb in (("soft", "least-overlap"), ("hard", "wait")):
            add("place", f"batched+place {mode}", "batched+place", N, {"placement_fallback": fb},
                note="default point")
            add("place", f"beanstalk module {mode}", "beanstalk", N,
                {"placement_model": "module", "placement_fallback": fb}, note="module sets")
    # spec's recall sweep, as pair-level conflict recall at the default clean-flag rate
    if which != "corpus":
        for rho in (0.4, 0.6, 0.8, 1.0):
            for N in Np:
                add("rho", "beanstalk soft", "beanstalk", N, {"flag_recall": rho})
                if N <= 100:
                    add("rho", "beanstalk hard", "beanstalk", N, {"flag_recall": rho, "placement_fallback": "wait"})
    for q in (0.0, 0.05, 0.1, 0.2):
        for N in Nq:
            add("qsem", "batched k=1", "batched", N, {"batch_k": 1, "q_sem": q})
            add("qsem", "batched-par k=1", "batched-par", N, {"batch_k": 1, "q_sem": q})
            add("qsem", "beanstalk", "beanstalk", N, {"q_sem": q})
            add("qsem", "beanstalk quarantine", "beanstalk", N, {"q_sem": q, "green_mode": "quarantine"})
            if N <= 100:
                add("qsem", "batched-aimd", "batched-aimd", N, {"q_sem": q})
                add("qsem", "beanstalk-noplace", "beanstalk-noplace", N, {"q_sem": q})
    for N in Nf:
        labs = [("serial", "serial", {}), ("batched k=1", "batched", {"batch_k": 1}),
                ("batched-par k=1", "batched-par", {"batch_k": 1}), ("beanstalk", "beanstalk", {}),
                ("beanstalk quarantine", "beanstalk", {"green_mode": "quarantine"})]
        if N >= 1000:
            labs = [labs[1], labs[2], labs[3]]
        for label, pol, over in labs:
            add("fixedR", label, pol, N, over | {"ci_slots": 10})
    if which != "corpus":
        regimes = [("p_self=0.05", {"p_self": 0.05}), ("p_self=0.30", {"p_self": 0.30}),
                   ("aidev-upper", (params.get("scenarios", {}).get("aidev-upper") or {"p_per_file": 0.35})),
                   ("T=30min", {"test_minutes": 30.0})]
        for name, over in regimes:
            over = {k: v for k, v in over.items() if k != "note"}
            for N in [20, 100]:
                for label, pol, o2 in [("batched k=1", "batched", {"batch_k": 1}), ("batched k=4", "batched", {}),
                                       ("batched-par k=1", "batched-par", {"batch_k": 1}),
                                       ("beanstalk", "beanstalk", {}),
                                       ("beanstalk quarantine", "beanstalk", {"green_mode": "quarantine"})]:
                    add("regime", label, pol, N, o2 | over, note=name)
    return cfgs


def cost(cfg: dict) -> float:
    """Rough relative run time, used to start the heaviest jobs first."""
    n = cfg["N"]
    over = cfg["over"]
    c = n ** 1.4
    if cfg["policy"] in ("batched", "batched+place", "batched-par", "batched-aimd") and \
            over.get("batch_k", 4) > 1:
        c *= 4
    if cfg["policy"].startswith("beanstalk"):
        c *= 1 + 8 * over.get("q_sem", 0.0) / 0.1      # semantic churn makes fast-trunk runs slow
        if over.get("green_mode") == "quarantine" or over.get("snapshot") == "green" or over.get("budget") is False:
            c *= 3
    return c


_PARAMS: dict = {}


def _init_worker(params: dict) -> None:
    global _PARAMS
    _PARAMS = params


def run_job(job):
    cfg, seed = job
    p = sim.deep_merge(_PARAMS, cfg["over"])
    p["agents"] = cfg["N"]
    t0 = time.time()
    r = sim.run_one(p, cfg["policy"], seed)
    r["wall_s"] = round(time.time() - t0, 2)
    return cfg, seed, r


def key_of(cfg: dict) -> tuple:
    return (cfg["group"], cfg["label"], cfg["note"], cfg["N"], json.dumps(cfg["over"], sort_keys=True))


def _num(v: str):
    """Parse a runs.csv cell back into a number, bool or None."""
    if v in ("", "None"):
        return None
    if v in ("True", "False"):
        return v == "True"
    try:
        f = float(v)
        return int(f) if f.is_integer() and "." not in v and "e" not in v.lower() else f
    except ValueError:
        return v


def mean_ci(xs: list[float]) -> tuple[float, float]:
    xs = [x for x in xs if x is not None and not (isinstance(x, float) and math.isnan(x))]
    if not xs:
        return float("nan"), float("nan")
    m = sum(xs) / len(xs)
    if len(xs) < 2:
        return m, float("nan")
    sd = math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))
    df = len(xs) - 1
    t = T95.get(df) or (2.045 if df < 30 else 1.96)
    return m, t * sd / math.sqrt(len(xs))


def fmt(m: float, ci: float, nd: int = 1) -> str:
    if m != m:
        return "-"
    if ci != ci:
        return f"{m:.{nd}f}"
    return f"{m:.{nd}f} ± {ci:.{nd}f}"


METRICS = ["green_per_h", "steady_green_per_h", "makespan_h", "lat_p50_min", "lat_p95_min", "busy_pct",
           "rework_pct", "blocked_pct", "idle_pct", "busy_agent_h", "rework_agent_h", "blocked_agent_h",
           "idle_agent_h", "idle_placement_agent_h", "idle_paused_agent_h", "ci_min", "ci_util_pct", "ci_runs",
           "ci_aborted", "conflicts", "dissolved", "reds", "culprits", "false_blames", "fixes", "overlap_starts",
           "max_red_age_min", "mean_red_age_min", "green_staleness_min", "green_gap_max_min", "paused_min",
           "max_open_reds", "bisect_rounds", "cancelled_units", "searches", "search_runs", "suspect_hits",
           "val_runs", "R", "M", "wall_s"]


def aggregate(rows: list[dict]) -> dict:
    agg: dict = {}
    for r in rows:
        agg.setdefault(r["_key"], {"cfg": r["_cfg"], "runs": []})["runs"].append(r)
    for v in agg.values():
        runs = v["runs"]
        v["n"] = len(runs)
        v["complete"] = sum(1 for r in runs if r.get("complete"))
        for m in METRICS:
            v[m] = mean_ci([r.get(m) for r in runs])
        v["by_seed"] = {r["seed"]: r for r in runs}
    return agg


def find(agg: dict, group: str, label: str, N: int, note: str = "", over: dict | None = None):
    for v in agg.values():
        c = v["cfg"]
        if c["group"] == group and c["label"] == label and c["N"] == N and c["note"] == note and \
                (over is None or c["over"] == over):
            return v
    return None


def paired_ratio(a: dict, b: dict, metric: str = "green_per_h") -> tuple[float, float]:
    """Mean and 95% CI of the per-seed ratio a/b (common random numbers make seeds paired)."""
    xs = []
    for seed, ra in a["by_seed"].items():
        rb = b["by_seed"].get(seed)
        if rb and ra.get(metric) and rb.get(metric):
            xs.append(ra[metric] / rb[metric])
    return mean_ci(xs)


def write_outputs(out_dir: str, params_name: str, params: dict, rows: list[dict], seeds: int, wall: float,
                  which: str) -> None:
    wall = sum(float(r.get("wall_s") or 0) for r in rows)    # CPU-seconds summed over every run
    agg = aggregate(rows)
    # results.csv: one row per configuration, mean and ci95 per metric
    with open(os.path.join(out_dir, "results.csv"), "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["group", "label", "policy", "note", "N", "overrides", "seeds", "complete"] +
                   [f"{m}_{s}" for m in METRICS for s in ("mean", "ci95")])
        for v in sorted(agg.values(), key=lambda v: (v["cfg"]["group"], v["cfg"]["N"], v["cfg"]["label"],
                                                      v["cfg"]["note"])):
            c = v["cfg"]
            w.writerow([c["group"], c["label"], c["policy"], c["note"], c["N"], json.dumps(c["over"], sort_keys=True),
                        v["n"], v["complete"]] +
                       [("" if x != x else round(x, 4)) for m in METRICS for x in v[m]])
    md = render_md(agg, params_name, params, seeds, wall, which)
    with open(os.path.join(out_dir, "results.md"), "w") as fh:
        fh.write(md)


def render_md(agg: dict, params_name: str, params: dict, seeds: int, wall: float, which: str) -> str:
    L: list[str] = []
    Ns = sorted({v["cfg"]["N"] for v in agg.values() if v["cfg"]["group"] == "main"})
    L.append(f"# Contention simulation results: `{params_name}` (simulated)\n")
    L.append(f"Generated by `experiments.py --params {params_name}` ({which} grid), {seeds} seeds per "
             f"configuration, {len(agg)} configurations, {wall / 60:.0f} CPU-minutes of simulation "
             f"(sum of per-run times; divide by the worker count for wall clock). "
             "Every number below is **simulated**. Cells are mean ± 95% CI over seeds; seeds are common "
             "random numbers (same tasks, footprints and latent draws for every policy). "
             "M = 10 N tasks; R = max(2, N/10) CI slots unless stated.\n")
    inc = [(v["cfg"]["label"], v["cfg"]["N"], v["cfg"]["over"], v["n"] - v["complete"])
           for v in agg.values() if v["complete"] < v["n"]]
    if inc:
        L.append("**Incomplete runs** (stopped by a deterministic cap before every task was green; their "
                 "green/h is throughput over the simulated horizon). `stall_hours` = 500 stops a run whose "
                 "green has not advanced for 500 simulated hours (a livelock); `max_events` and `max_hours` "
                 f"are backstops: {inc}\n")

    def table(group_labels, title, metric="green_per_h", nd=1, Ns=Ns, note=""):
        L.append(f"\n### {title}\n")
        L.append("| policy | " + " | ".join(f"N={n}" for n in Ns) + " |")
        L.append("|---|" + "---|" * len(Ns))
        for group, label in group_labels:
            cells = []
            for n in Ns:
                v = find(agg, group, label, n, note)
                cells.append(fmt(*v[metric], nd) if v else "")
            if any(cells):
                L.append(f"| {label} | " + " | ".join(cells) + " |")

    main_rows = [("main", "serial"), ("main", "batched k=4"), ("queue", "batched k=1"), ("queue", "batched k=16"),
                 ("main", "batched-aimd"), ("queue", "batched-par k=1"), ("queue", "batched-par k=4"),
                 ("main", "batched+place"), ("fair", "batched k=1 released"), ("fair", "batched k=4 suspects"),
                 ("fair", "batched-par k=4 suspects"),
                 ("main", "beanstalk"), ("main", "beanstalk-noplace"), ("fair", "beanstalk quarantine"),
                 ("fair", "beanstalk-noplace quarantine"), ("fair", "beanstalk no-budget"),
                 ("fair", "beanstalk quarantine no-budget"), ("fair", "beanstalk snapshot=green"),
                 ("fair", "beanstalk module placement")]
    L.append("## Primary metric: changes reaching validated green per hour\n")
    fp = (params.get("flag_recall"), params.get("flag_clean"))
    L.append("`beanstalk` is the policy as specified (prefix promotion, error budget B = 3 open reds, "
             f"A = 30 min) with soft pair-level placement at operating point {fp} (conflict recall, "
             "clean-flag rate). Rows below it are variants; `quarantine` promotes the tested head minus "
             "known culprits (an extension, not the spec). Queue rows above it are the baselines.")
    table(main_rows, "Green changes per hour (simulated)")

    # kill condition
    L.append("\n## Kill condition: Beanstalk vs the best batched queue\n")
    L.append("Best queue = the queue configuration with the highest mean at that N among serial, batched "
             "k = 1/4/16, AIMD, the partitioned queue, batched+place and the released/suspects variants. "
             "Ratios are per-seed paired (same seed = same world) with 95% CIs. The step-3 kill condition "
             "is < 1.5x.\n")
    L.append("| N | best queue | queue /h | beanstalk /h | ratio | beanstalk quarantine /h | ratio | best Beanstalk variant | ratio |")
    L.append("|---|---|---|---|---|---|---|---|---|")
    for n in Ns:
        queues = [v for v in agg.values() if v["cfg"]["N"] == n and v["cfg"]["label"] in QUEUE_LABELS
                  and v["cfg"]["group"] in ("main", "queue", "fair")]
        beans = [v for v in agg.values() if v["cfg"]["N"] == n and v["cfg"]["label"].startswith("beanstalk")
                 and v["cfg"]["group"] in ("main", "fair")]
        if not queues or not beans:
            continue
        bq = max(queues, key=lambda v: v["green_per_h"][0])
        bs = find(agg, "main", BEAN_SPEC, n)
        bqz = find(agg, "fair", "beanstalk quarantine", n)
        bb = max(beans, key=lambda v: v["green_per_h"][0])
        r1 = paired_ratio(bs, bq) if bs else (float("nan"),) * 2
        r2 = paired_ratio(bqz, bq) if bqz else (float("nan"),) * 2
        r3 = paired_ratio(bb, bq)
        L.append(f"| {n} | {bq['cfg']['label']} | {fmt(*bq['green_per_h'])} | "
                 f"{fmt(*bs['green_per_h']) if bs else '-'} | {fmt(*r1, 2)}x | "
                 f"{fmt(*bqz['green_per_h']) if bqz else '-'} | {fmt(*r2, 2)}x | "
                 f"{bb['cfg']['label']} ({fmt(*bb['green_per_h'])}) | {fmt(*r3, 2)}x |")

    # secondary metrics
    L.append("\n## Secondary metrics at default parameters\n")
    sec = [("lat_p50_min", "p50 done→green (min)", 0), ("lat_p95_min", "p95 done→green (min)", 0),
           ("makespan_h", "wall-clock to all-green (h)", 1), ("busy_pct", "agent busy %", 0),
           ("rework_pct", "agent rework %", 0), ("blocked_pct", "agent blocked %", 0),
           ("idle_pct", "agent idle %", 0), ("ci_util_pct", "CI utilisation %", 0),
           ("ci_min", "CI minutes", 0), ("conflicts", "textual conflicts", 0), ("reds", "red CI runs", 0),
           ("culprits", "bad changes caught", 0), ("max_red_age_min", "max red age (min)", 0),
           ("green_staleness_min", "green staleness, time-avg (min)", 0),
           ("green_gap_max_min", "longest green gap (min)", 0), ("paused_min", "budget pause (min)", 0)]
    pols = [("main", "serial"), ("queue", "batched k=1"), ("main", "batched k=4"), ("main", "batched-aimd"),
            ("queue", "batched-par k=1"), ("main", "batched+place"), ("main", "beanstalk"),
            ("main", "beanstalk-noplace"), ("fair", "beanstalk quarantine")]
    for n in Ns:
        cols = [(g, l) for g, l in pols if find(agg, g, l, n)]
        if not cols:
            continue
        L.append(f"\n### N = {n}\n")
        L.append("| metric | " + " | ".join(l for _, l in cols) + " |")
        L.append("|---|" + "---|" * len(cols))
        for m, title, nd in sec:
            L.append(f"| {title} | " + " | ".join(fmt(find(agg, g, l, n)[m][0], float('nan'), nd) for g, l in cols) + " |")

    # sensitivity tables
    def sweep_table(group, title, key, values, labels, Ns_, fmtkey=str, note=""):
        L.append(f"\n### {title}\n")
        hdr = [f"{l} N={n}" for l in labels for n in Ns_]
        L.append(f"| {key} | " + " | ".join(hdr) + " |")
        L.append("|---|" + "---|" * len(hdr))
        for val in values:
            cells = []
            for l in labels:
                for n in Ns_:
                    v = next((v for v in agg.values() if v["cfg"]["group"] == group and v["cfg"]["label"] == l
                              and v["cfg"]["N"] == n and v["cfg"]["over"].get(key) == val
                              and v["cfg"]["note"] == note), None)
                    cells.append(fmt(*v["green_per_h"]) if v else "")
            L.append(f"| {fmtkey(val)} | " + " | ".join(cells) + " |")

    L.append("\n## Sensitivity (green changes per hour, simulated)\n")
    qN = sorted({v["cfg"]["N"] for v in agg.values() if v["cfg"]["group"] == "qsem"})
    if qN:
        L.append(f"Default q_sem in the main table is {params.get('q_sem')}.")
        sweep_table("qsem", "Semantic-break rate q_sem", "q_sem", [0.0, 0.05, 0.1, 0.2],
                    ["batched k=1", "batched-par k=1", "beanstalk", "beanstalk quarantine"], qN)
        sub = [n for n in qN if n < 1000]
        sweep_table("qsem", "q_sem: AIMD queue and Beanstalk without placement", "q_sem", [0.0, 0.05, 0.1, 0.2],
                    ["batched-aimd", "beanstalk-noplace"], sub)
    pN = sorted({v["cfg"]["N"] for v in agg.values() if v["cfg"]["group"] == "place"})
    if pN:
        L.append("\n### Placement operating points (pair level)\n")
        L.append("A held task flags a candidate with probability *conflict recall* if the pair would "
                 "textually conflict, else with the *clean-flag rate*. Soft placement takes the candidate "
                 "with the fewest flags (agents never idle); hard placement starts only unflagged tasks. "
                 "Cells: green/h; then textual conflicts; then effective concurrency (busy share x N).\n")
        pts = {v["cfg"]["note"]: (v["cfg"]["over"].get("flag_recall"), v["cfg"]["over"].get("flag_clean"))
               for v in agg.values() if v["cfg"]["group"] == "place" and "flag_recall" in v["cfg"]["over"]}
        for metric, title, nd in (("green_per_h", "green per hour", 1), ("conflicts", "textual conflicts", 0),
                                  ("busy_pct", "effective concurrency (agents busy)", 1)):
            L.append(f"\n{title}:\n")
            L.append("| operating point (recall, clean) | mode | " + " | ".join(f"N={n}" for n in pN) + " |")
            L.append("|---|---|" + "---|" * len(pN))
            for g, lab in (("main", "beanstalk-noplace"),):
                cells = [fmt(*find(agg, g, lab, n)[metric], nd) if find(agg, g, lab, n) and metric != "busy_pct"
                         else (f"{find(agg, g, lab, n)['busy_pct'][0] * n / 100:.1f}" if find(agg, g, lab, n) else "")
                         for n in pN]
                L.append(f"| no placement | - | " + " | ".join(cells) + " |")
            for name, (fr, fc) in pts.items():
                for mode in ("soft", "hard"):
                    cells = []
                    for n in pN:
                        v = find(agg, "place", f"beanstalk {mode}", n, name)
                        if not v:
                            cells.append("")
                        elif metric == "busy_pct":
                            cells.append(f"{v['busy_pct'][0] * n / 100:.1f}")
                        else:
                            cells.append(fmt(*v[metric], nd))
                    L.append(f"| {name} ({fr}, {fc}) | {mode} | " + " | ".join(cells) + " |")
            for note, labs in (("module sets", ("beanstalk module soft", "beanstalk module hard")),
                               ("default point", ("batched+place soft", "batched+place hard"))):
                for lab in labs:
                    cells = []
                    for n in pN:
                        v = find(agg, "place", lab, n, note)
                        if not v:
                            cells.append("")
                        elif metric == "busy_pct":
                            cells.append(f"{v['busy_pct'][0] * n / 100:.1f}")
                        else:
                            cells.append(fmt(*v[metric], nd))
                    if any(cells):
                        L.append(f"| {lab} ({note}) | {lab.split()[-1]} | " + " | ".join(cells) + " |")
    rN = sorted({v["cfg"]["N"] for v in agg.values() if v["cfg"]["group"] == "rho"})
    if rN:
        L.append(f"\nRecall sweep: pair-level conflict recall rho at clean-flag rate {params.get('flag_clean')}.")
        sweep_table("rho", "Placement recall rho", "flag_recall", [0.4, 0.6, 0.8, 1.0],
                    ["beanstalk soft", "beanstalk hard"], rN)
    # k sweep
    L.append("\n### Batch size k (linear batched queue)\n")
    L.append("| k | " + " | ".join(f"N={n}" for n in Ns) + " |")
    L.append("|---|" + "---|" * len(Ns))
    for k, (g, l) in [(1, ("queue", "batched k=1")), (4, ("main", "batched k=4")), (16, ("queue", "batched k=16")),
                      ("AIMD", ("main", "batched-aimd"))]:
        L.append(f"| {k} | " + " | ".join(fmt(*find(agg, g, l, n)['green_per_h']) if find(agg, g, l, n) else ''
                                          for n in Ns) + " |")
    fN = sorted({v["cfg"]["N"] for v in agg.values() if v["cfg"]["group"] == "fixedR"})
    if fN:
        L.append("\n### Fixed R = 10 CI slots (CI saturation)\n")
        labs = ["serial", "batched k=1", "batched-par k=1", "beanstalk", "beanstalk quarantine"]
        L.append("| policy | " + " | ".join(f"N={n}" for n in fN) + " | CI util % at max N |")
        L.append("|---|" + "---|" * (len(fN) + 1))
        for l in labs:
            vs = [find(agg, "fixedR", l, n) for n in fN]
            last = vs[-1]
            L.append(f"| {l} | " + " | ".join(fmt(*v['green_per_h']) if v else '' for v in vs) +
                     f" | {fmt(last['ci_util_pct'][0], float('nan'), 0) if last else ''} |")
    regs = sorted({v["cfg"]["note"] for v in agg.values() if v["cfg"]["group"] == "regime"})
    if regs:
        L.append("\n### Regimes (N = 20 and 100)\n")
        labs = ["batched k=1", "batched k=4", "batched-par k=1", "beanstalk", "beanstalk quarantine"]
        L.append("| regime | " + " | ".join(f"{l} N={n}" for l in labs for n in (20, 100)) + " |")
        L.append("|---|" + "---|" * (2 * len(labs)))
        for rg in regs:
            cells = []
            for l in labs:
                for n in (20, 100):
                    v = find(agg, "regime", l, n, rg)
                    cells.append(fmt(*v["green_per_h"]) if v else "")
            L.append(f"| {rg} | " + " | ".join(cells) + " |")
    # lock collapse
    hard = [v for v in agg.values() if v["cfg"]["group"] == "place" and v["cfg"]["label"].endswith("hard")]
    if hard:
        L.append("\n### Cursor lock-collapse check\n")
        L.append("Cursor: '20 agents would slow to the throughput of 1-3 with most time spent waiting on locks'. "
                 "Hard placement is the scheduler-held analogue of locks. Effective concurrency = busy share x N.\n")
        L.append("| N | signal | hard: agents busy | hard: green/h | soft: agents busy | soft: green/h |")
        L.append("|---|---|---|---|---|---|")
        for v in sorted(hard, key=lambda v: (v["cfg"]["N"], v["cfg"]["note"])):
            n, note = v["cfg"]["N"], v["cfg"]["note"]
            soft = find(agg, "place", v["cfg"]["label"].replace("hard", "soft"), n, note)
            L.append(f"| {n} | {v['cfg']['label'].replace(' hard', '')} {note} | "
                     f"{v['busy_pct'][0] * n / 100:.1f} | {fmt(*v['green_per_h'])} | "
                     f"{(soft['busy_pct'][0] * n / 100) if soft else float('nan'):.1f} | "
                     f"{fmt(*soft['green_per_h']) if soft else '-'} |")
    st = sim.footprint_stats(params, n_tasks=3000)
    L.append("\n## Footprint model check (pairs within 20 consecutive tasks)\n")
    L.append("| statistic | raw | with merge drivers |")
    L.append("|---|---|---|")
    for k in ("pair_conflict_rate", "per_change_collision_rate", "sem_exposed_share", "mean_shared_files",
              "pred_conflict_recall", "pred_clean_flag_rate"):
        L.append(f"| {k} | {st['raw'][k]} | {st['drivers'][k]} |")
    for c in ("file", "module", "disjoint"):
        L.append(f"| share of pairs, {c} overlap / conflict rate | {st['raw']['class_share'][c]} / "
                 f"{st['raw']['rate_by_class'][c]} | {st['drivers']['class_share'][c]} / "
                 f"{st['drivers']['rate_by_class'][c]} |")
    L.append("")
    return "\n".join(L)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Run the simulator sweep and write results.csv / results.md.")
    ap.add_argument("--params", default=os.path.join(HERE, "params", "default.json"))
    ap.add_argument("--seeds", type=int, default=10)
    ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2) - 2))
    ap.add_argument("--grid", choices=["full", "corpus", "quick"], default="full",
                    help="full (default params study), corpus (smaller grid for calibrated params), quick")
    ap.add_argument("--groups", default="", help="comma-separated subset of groups to run")
    ap.add_argument("--out", help="output dir (default out/<params-name>, out/private/<name> for private params)")
    ap.add_argument("--set", action="append", default=[], metavar="KEY=VALUE",
                    help="override a parameter for every run")
    ap.add_argument("--resume", action="store_true",
                    help="keep the runs already in runs.csv and only run the missing (configuration, seed) pairs")
    a = ap.parse_args(argv)

    params = sim.apply_sets(sim.load_params(a.params), a.set)
    name = os.path.splitext(os.path.basename(a.params))[0]
    private = "private" in os.path.normpath(os.path.abspath(a.params)).split(os.sep) or \
        bool((params.get("calibration") or {}).get("private"))
    out_dir = a.out or os.path.join(HERE, "out", "private" if private else "", name)
    if private and "private" not in os.path.normpath(os.path.abspath(out_dir)).split(os.sep):
        raise SystemExit(f"refusing to write private results outside a private/ directory: {out_dir}")
    os.makedirs(out_dir, exist_ok=True)
    seeds = min(a.seeds, 3) if a.grid == "quick" else a.seeds
    cfgs = grid(a.grid, params)
    if a.groups:
        keep = set(a.groups.split(","))
        cfgs = [c for c in cfgs if c["group"] in keep]
    runs_path = os.path.join(out_dir, "runs.csv")
    rows: list[dict] = []
    by_key = {key_of(c): c for c in cfgs}
    if a.resume and os.path.exists(runs_path):
        with open(runs_path, newline="") as fh:
            for r in csv.DictReader(fh):
                k = (r["group"], r["label"], r["note"], int(r["N"]), r["overrides"])
                if k not in by_key:
                    continue
                row = {kk: _num(v) for kk, v in r.items()}
                row["_key"] = k
                row["_cfg"] = by_key[k]
                rows.append(row)
    have = {(r["_key"], int(r["seed"])) for r in rows}
    jobs = [(c, s) for c in sorted(cfgs, key=cost, reverse=True) for s in range(seeds)
            if (key_of(c), s) not in have]
    print(f"{len(cfgs)} configurations x {seeds} seeds: {len(jobs)} runs to do ({len(rows)} kept) on "
          f"{a.jobs} processes -> {out_dir}", flush=True)
    t0 = time.time()
    fields = list(rows[0].keys())[:-2] if rows else None
    with open(runs_path, "a" if rows else "w", newline="") as fh, \
            Pool(a.jobs, initializer=_init_worker, initargs=(params,)) as pool:
        w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore") if fields else None
        for i, (cfg, seed, r) in enumerate(pool.imap_unordered(run_job, jobs, chunksize=1), 1):
            row = {"group": cfg["group"], "label": cfg["label"], "note": cfg["note"],
                   "overrides": json.dumps(cfg["over"], sort_keys=True)} | r
            if w is None:
                fields = list(row.keys())
                w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
                w.writeheader()
            w.writerow(row)
            fh.flush()
            row["_key"] = key_of(cfg)
            row["_cfg"] = cfg
            rows.append(row)
            if i % 100 == 0 or i == len(jobs):
                el = time.time() - t0
                print(f"  {i}/{len(jobs)} runs, {el / 60:.1f} min", flush=True)
    wall = time.time() - t0
    write_outputs(out_dir, name, params, rows, seeds, wall, a.grid)
    print(f"done in {wall / 60:.1f} min: {out_dir}/results.csv, results.md, runs.csv")
    return 0


if __name__ == "__main__":
    sys.exit(main())
