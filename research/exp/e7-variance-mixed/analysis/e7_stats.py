#!/usr/bin/env python3
"""E7 part A: variance of "v2 beats the queue" across seeds (12 Sonnet agents, fair checks).

Per-run metrics come from each run's events.jsonl / summary.json through race/kth_green.py (the brief's metric
code); per-policy means and ranges, per-seed paired ratios and exact bootstrap 95% intervals are computed here.

Usage: python3 e7_stats.py [--json out.json] [--md out.md]

Run sets (seed -> run directory) are listed in RUNSETS below. Seeds 7 and 11 are the earlier id-order runs in
research/race/runs; the new seeds are in ../race/runs and were run with --shuffle (the seed then fixes the task
order, identically for both policies).
"""
from __future__ import annotations

import argparse
import itertools
import json
import math
import os
import random
import re
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RACE = os.path.normpath(os.path.join(HERE, "..", "race"))
sys.path.insert(0, RACE)
import kth_green as kg  # noqa: E402  (the brief's metric code; a copy lives in race/)

BASE = "/Users/coop/Workspace/beanstalk/research/race/runs"
NEW = os.path.join(RACE, "runs")

RUNSETS: dict[str, dict[int, str]] = {
    "queue": {7: f"{BASE}/opus-queue-sonnet-12-landed", 11: f"{BASE}/opus-queue-sonnet-12-s11",
              3: f"{NEW}/e7-queue-claude-12-s3-shuf", 5: f"{NEW}/e7-queue-claude-12-s5-shuf",
              13: f"{NEW}/e7-queue-claude-12-s13-shuf"},
    "v2": {7: f"{BASE}/opus-v2fair-sonnet-12-s7", 11: f"{BASE}/opus-v2fair-sonnet-12-s11",
           3: f"{NEW}/e7-v2-claude-12-s3-shuf", 5: f"{NEW}/e7-v2-claude-12-s5-shuf",
           13: f"{NEW}/e7-v2-claude-12-s13-shuf"},
}
FLAGGED_DIR = {("queue", 3): f"{NEW}/flagged-highload-e7-queue-claude-12-s3-shuf",
               ("v2", 3): f"{NEW}/flagged-highload-e7-v2-claude-12-s3-shuf"}
ORDER = {7: "id", 11: "id", 3: "shuffled", 5: "shuffled", 13: "shuffled"}
SEEDS = [3, 5, 7, 11, 13]
KS = (20, 30, 35)
# runs that overlapped another real race at very high machine load (coordinator's note, 2026-10-03 13:18):
# only the FIRST seed-3 runs (moved to flagged-highload-*); the clean re-runs that now carry the original names
# are judged by their own recorded load (see the load table), not flagged by name
FLAGGED_HIGH_LOAD = {"flagged-highload-e7-queue-claude-12-s3-shuf", "flagged-highload-e7-v2-claude-12-s3-shuf"}


def med(xs: list[float]) -> float | None:
    return round(statistics.median(xs), 2) if xs else None


def run_metrics(path: str) -> dict | None:
    if not os.path.exists(os.path.join(path, "summary.json")):
        return None
    ev, s = kg.load(path)
    g = kg.green_times(ev)
    m: dict = {"run": os.path.basename(path), "path": path}
    for k in KS:
        if len(g) >= k:
            t = g[k - 1][0]
            m[f"t{k}"] = t / 60.0
            m[f"cost{k}"] = kg.cost_at(ev, t)
        else:
            m[f"t{k}"] = None
            m[f"cost{k}"] = None
    wall = s.get("wall_seconds") or ev[-1]["t"]
    m["done"] = wall / 60.0
    m["greens"] = len(g)
    m["cost"] = float(s.get("cost_usd") or 0.0)
    m["red"] = int(s.get("red_validations") or 0)
    m["dropped"] = int(s.get("tasks_dropped") or 0)
    m["conflicts"] = int(s.get("textual_conflicts") or 0)
    inv = s.get("invocations") or {}
    m["initial"], m["rework"] = int(inv.get("initial", 0)), int(inv.get("rework", 0))
    bs, qs = s.get("beanstalk") or {}, s.get("queue") or {}
    m["red_caught"] = bs.get("preland_red") if bs else qs.get("batches_red")   # v2: red pre-land checks; queue: red batches
    m["ci_minutes"] = s.get("ci_minutes_total")
    m["preland_minutes"] = round((bs.get("preland_seconds") or 0) / 60, 2) if bs else None
    m["correct"] = bool((s.get("final") or {}).get("correct"))
    m["aborted"] = s.get("aborted")
    m["p90_start_to_green"] = ((s.get("task_start_to_green_seconds") or {}).get("p90") or 0) / 60.0 or None
    # machine-load covariates: how long the suite took (the same suite takes ~2 s on an idle machine),
    # how long the Claude CLI took to start, and wall time not spent in the API
    suites = [e["suite_seconds"] for e in ev if e["type"] in ("ci.end", "preland.check")
              and e.get("suite_seconds") and e.get("purpose") != "final"]
    m["suite_seconds_median"] = med(suites)
    m["suite_seconds_p90"] = med(sorted(suites)[int(0.9 * len(suites)):]) if suites else None
    oh = s.get("invocation_overhead") or {}
    m["startup_ms_median"] = oh.get("startup_ms_median")
    m["overhead_ms_median"] = oh.get("wall_minus_api_ms_median")
    up = os.path.join(os.path.dirname(path), os.path.basename(path) + ".uptime.json")
    m["uptime"] = None
    if os.path.exists(up):
        with open(up, encoding="utf-8") as fh:
            u = json.load(fh)
        m["uptime"] = {k: u.get(k) for k in ("start_uptime", "end_uptime", "load1_mean", "load1_max")}
    m["flag"] = "concurrent + very high load" if m["run"] in FLAGGED_HIGH_LOAD else ""
    return m


# ---- statistics -------------------------------------------------------------------------------------------

def bootstrap_means(xs: list[float], reps: int = 20000, seed: int = 20261003) -> list[float]:
    """Bootstrap distribution of the mean of ``xs``: exact enumeration of all n^n resamples when n <= 7."""
    n = len(xs)
    if n <= 7:
        return [sum(c) / n for c in itertools.product(xs, repeat=n)]
    rng = random.Random(seed)
    return [sum(rng.choice(xs) for _ in range(n)) / n for _ in range(reps)]


def pct(sorted_xs: list[float], q: float) -> float:
    k = (len(sorted_xs) - 1) * q
    lo, hi = int(math.floor(k)), int(math.ceil(k))
    return sorted_xs[lo] + (sorted_xs[hi] - sorted_xs[lo]) * (k - lo)


T975 = {1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262}


def geo_ci(ratios: list[float]) -> dict:
    """Geometric mean of per-seed ratios with a percentile bootstrap 95% CI over seeds (exact for n <= 7).
    ``t_lo``/``t_hi`` is the t interval on the log ratios (df = n - 1): the bootstrap cannot be wider than the
    observed ratios, so at n = 5 it is optimistic."""
    if not ratios:
        return {"n": 0}
    logs = [math.log(r) for r in ratios]
    dist = sorted(math.exp(x) for x in bootstrap_means(logs))
    out = {"n": len(ratios), "geo_mean": math.exp(sum(logs) / len(logs)), "lo": pct(dist, 0.025),
           "hi": pct(dist, 0.975), "min": min(ratios), "max": max(ratios),
           "wins": sum(1 for r in ratios if r > 1.0)}
    if len(logs) >= 2 and (len(logs) - 1) in T975:
        half = T975[len(logs) - 1] * statistics.stdev(logs) / math.sqrt(len(logs))
        out["t_lo"], out["t_hi"] = math.exp(sum(logs) / len(logs) - half), math.exp(sum(logs) / len(logs) + half)
    return out


def diff_ci(diffs: list[float]) -> dict:
    if not diffs:
        return {"n": 0}
    dist = sorted(bootstrap_means(diffs))
    return {"n": len(diffs), "mean": sum(diffs) / len(diffs), "lo": pct(dist, 0.025), "hi": pct(dist, 0.975),
            "min": min(diffs), "max": max(diffs)}


def unpaired_ratio_ci(a: list[float], b: list[float], reps: int = 20000, seed: int = 20261003) -> dict:
    """Ratio of means mean(a)/mean(b), runs resampled independently within each policy."""
    if not a or not b:
        return {"n": (len(a), len(b))}
    rng = random.Random(seed)
    dist = sorted((sum(rng.choice(a) for _ in a) / len(a)) / (sum(rng.choice(b) for _ in b) / len(b))
                  for _ in range(reps))
    return {"n": (len(a), len(b)), "ratio": (sum(a) / len(a)) / (sum(b) / len(b)), "lo": pct(dist, 0.025),
            "hi": pct(dist, 0.975)}


def permutation_p(a: list[float], b: list[float]) -> float | None:
    """Exact two-sided permutation p-value for the difference of means (all splits of the pooled runs)."""
    n, m = len(a), len(b)
    if not n or not m or n + m > 20:
        return None
    pooled = a + b
    obs = abs(sum(a) / n - sum(b) / m)
    hits = total = 0
    for idx in itertools.combinations(range(n + m), n):
        s = set(idx)
        x = [pooled[i] for i in s]
        y = [pooled[i] for i in range(n + m) if i not in s]
        total += 1
        hits += abs(sum(x) / n - sum(y) / m) >= obs - 1e-12
    return hits / total


# ---- assembly -----------------------------------------------------------------------------------------------

def collect() -> dict[str, dict[int, dict]]:
    """One run per policy and seed: the clean run when there is one, else the flagged first run of seed 3
    (kept so the 'all runs' view can show it)."""
    out: dict[str, dict[int, dict]] = {}
    for pol, seeds in RUNSETS.items():
        out[pol] = {}
        for seed, path in seeds.items():
            m = run_metrics(path) or (run_metrics(FLAGGED_DIR[(pol, seed)]) if (pol, seed) in FLAGGED_DIR else None)
            if m:
                out[pol][seed] = m
    return out


def flagged_extra() -> dict[str, dict[int, dict]]:
    """Flagged runs shown beside a clean re-run of the same seed."""
    out: dict[str, dict[int, dict]] = {"queue": {}, "v2": {}}
    for (pol, seed), path in FLAGGED_DIR.items():
        if os.path.exists(RUNSETS[pol][seed] + "/summary.json"):
            m = run_metrics(path)
            if m:
                out[pol][seed] = m
    return out


def clean_seeds(data: dict[str, dict[int, dict]]) -> list[int]:
    return [s for s in SEEDS if s in data["queue"] and s in data["v2"]
            and not data["queue"][s]["flag"] and not data["v2"][s]["flag"]]


def agg(vals: list[float | None]) -> dict:
    xs = [v for v in vals if v is not None]
    if not xs:
        return {"n": 0, "of": len(vals)}
    return {"n": len(xs), "of": len(vals), "mean": sum(xs) / len(xs), "min": min(xs), "max": max(xs),
            "median": statistics.median(xs), "sd": statistics.stdev(xs) if len(xs) > 1 else 0.0}


METRICS = [("t20", "20th green (min)"), ("t30", "30th green (min)"), ("t35", "35th green (min)"),
           ("done", "time to done (min)"), ("cost", "cost ($)"), ("red", "red validations"),
           ("red_caught", "red pre-land checks (v2) / red batches (queue)"),
           ("ci_minutes", "CI minutes"), ("preland_minutes", "agent-side check minutes (v2)"),
           ("greens", "greens"), ("dropped", "dropped"), ("conflicts", "textual conflicts"),
           ("rework", "rework invocations")]


def analyse(data: dict[str, dict[int, dict]], seeds: list[int] | None = None) -> dict:
    seeds = seeds or SEEDS
    res: dict = {"aggregate": {}, "paired": {}, "unpaired": {}, "permutation_p": {}}
    for pol in ("queue", "v2"):
        res["aggregate"][pol] = {k: agg([data[pol][s].get(k) for s in seeds if s in data[pol]]) for k, _ in METRICS}
    both = [s for s in seeds if s in data["queue"] and s in data["v2"]]
    res["pairs"] = both
    for k in ("t20", "t30", "t35", "done", "p90_start_to_green"):
        rows = [(s, data["queue"][s].get(k), data["v2"][s].get(k)) for s in both]
        ratios = [q / v for _, q, v in rows if q and v]
        res["paired"][k] = {"ratio_queue_over_v2": geo_ci(ratios),
                            "per_seed": {s: (q / v if q and v else None) for s, q, v in rows}}
    cost = [(s, data["queue"][s]["cost"], data["v2"][s]["cost"]) for s in both]
    res["paired"]["cost"] = {"ratio_v2_over_queue": geo_ci([v / q for _, q, v in cost if q and v]),
                             "per_seed": {s: (v / q if q and v else None) for s, q, v in cost}}
    reds = [(s, data["queue"][s]["red"], data["v2"][s]["red"]) for s in both]
    res["paired"]["red"] = {"diff_queue_minus_v2": diff_ci([q - v for _, q, v in reds]),
                            "per_seed": {s: (q, v) for s, q, v in reds}}
    for k in ("t20", "t30", "t35", "done", "cost"):
        a = [data["queue"][s][k] for s in seeds if s in data["queue"] and data["queue"][s].get(k) is not None]
        b = [data["v2"][s][k] for s in seeds if s in data["v2"] and data["v2"][s].get(k) is not None]
        res["unpaired"][k] = unpaired_ratio_ci(a, b) if k != "cost" else unpaired_ratio_ci(b, a)
        res["permutation_p"][k] = permutation_p(a, b)
    return res


def fmt(x: float | None, d: int = 1) -> str:
    return "n/a" if x is None else f"{x:.{d}f}"


def md_tables(data: dict, res: dict, seeds: list[int]) -> str:
    L: list[str] = []
    L += ["### Per-seed runs", "",
          "| Seed (order) | Policy | 20th green | 30th green | 35th green | Done | Greens | Cost | Red validations | "
          "Dropped | Correct | Note |", "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for s in seeds:
        for pol in ("queue", "v2"):
            m = data[pol].get(s)
            if not m:
                L.append(f"| {s} ({ORDER[s]}) | {pol} | not run | | | | | | | | | |")
                continue
            note = m["flag"] or ("aborted: " + str(m["aborted"]) if m["aborted"] else "")
            L.append(f"| {s} ({ORDER[s]}) | {pol} | {fmt(m['t20'])} | {fmt(m['t30'])} | {fmt(m['t35'])} | "
                     f"{fmt(m['done'])} | {m['greens']} | ${m['cost']:.2f} | {m['red']} | {m['dropped']} | "
                     f"{m['correct']} | {note} |")
    L += ["", "### Aggregates over seeds (mean [min, max], sd, n reached)", "",
          "| Metric | queue | v2 |", "|---|---|---|"]
    for k, label in METRICS:
        cells = []
        for pol in ("queue", "v2"):
            a = res["aggregate"][pol][k]
            if not a["n"]:
                cells.append("n/a" if k == "preland_minutes" else "not reached in any run")
                continue
            d = 2 if k == "cost" else 1
            extra = "" if a["n"] == a["of"] else f" (n={a['n']} of {a['of']})"
            spread = f", sd {fmt(a['sd'], d)}" if a["n"] > 1 else ""
            cells.append(f"{fmt(a['mean'], d)} [{fmt(a['min'], d)}, {fmt(a['max'], d)}]{spread}{extra}")
        L.append(f"| {label} | {cells[0]} | {cells[1]} |")
    L += ["", "### Paired by seed: queue / v2 (>1 means v2 is faster); cost is v2 / queue", "",
          "| Metric | " + " | ".join(f"seed {s}" for s in res["pairs"]) +
          " | geometric mean [bootstrap 95% CI] | t interval on logs | v2 faster in |",
          "|---|" + "---|" * (len(res["pairs"]) + 3)]
    for k, label in (("t20", "20th green"), ("t30", "30th green"), ("t35", "35th green"), ("done", "done"),
                     ("p90_start_to_green", "p90 task start to green")):
        p = res["paired"][k]
        g = p["ratio_queue_over_v2"]
        cells = [fmt(p["per_seed"].get(s), 2) for s in res["pairs"]]
        ci = (f"{g['geo_mean']:.2f} [{g['lo']:.2f}, {g['hi']:.2f}]" if g["n"] else "n/a")
        tci = f"[{g['t_lo']:.2f}, {g['t_hi']:.2f}]" if "t_lo" in g else "n/a"
        L.append(f"| {label} | " + " | ".join(cells) + f" | {ci} | {tci} | {g.get('wins', 0)} of {g['n']} |")
    p = res["paired"]["cost"]
    g = p["ratio_v2_over_queue"]
    tci = f"[{g['t_lo']:.2f}, {g['t_hi']:.2f}]" if "t_lo" in g else "n/a"
    L.append("| cost (v2 / queue) | " + " | ".join(fmt(p["per_seed"].get(s), 2) for s in res["pairs"]) +
             f" | {g['geo_mean']:.2f} [{g['lo']:.2f}, {g['hi']:.2f}] | {tci} | v2 cheaper in "
             f"{g['n'] - g['wins']} of {g['n']} |" if g["n"] else "| cost | n/a |")
    r = res["paired"]["red"]
    d = r["diff_queue_minus_v2"]
    L.append("| red validations (queue, v2) | " + " | ".join(f"{r['per_seed'][s][0]}, {r['per_seed'][s][1]}"
                                                            for s in res["pairs"]) +
             (f" | mean difference {d['mean']:.1f} [{d['lo']:.1f}, {d['hi']:.1f}] | | |" if d["n"] else " | n/a | | |"))
    L += ["", "### Unpaired view (runs resampled independently within a policy)", "",
          "| Metric | ratio of means | 95% CI | exact permutation p (two-sided) |", "|---|---|---|---|"]
    for k, label in (("t20", "20th green, queue / v2"), ("t30", "30th green, queue / v2"),
                     ("t35", "35th green, queue / v2"), ("done", "done, queue / v2"), ("cost", "cost, v2 / queue")):
        u = res["unpaired"][k]
        pv = res["permutation_p"][k]
        if "ratio" in u:
            L.append(f"| {label} | {u['ratio']:.2f} | [{u['lo']:.2f}, {u['hi']:.2f}] | "
                     f"{'n/a' if pv is None else f'{pv:.3f}'} |")
    return "\n".join(L) + "\n"


def spearman(x: list[float], y: list[float]) -> float | None:
    if len(x) < 3:
        return None

    def ranks(v: list[float]) -> list[float]:
        order = sorted(range(len(v)), key=lambda i: v[i])
        r = [0.0] * len(v)
        i = 0
        while i < len(v):
            j = i
            while j + 1 < len(v) and v[order[j + 1]] == v[order[i]]:
                j += 1
            for k in range(i, j + 1):
                r[order[k]] = (i + j) / 2 + 1
            i = j + 1
        return r
    rx, ry = ranks(x), ranks(y)
    mx, my = sum(rx) / len(rx), sum(ry) / len(ry)
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den = math.sqrt(sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry))
    return num / den if den else None


CHECKPOINTS = (5, 10, 15, 20, 25, 30, 35)


def greens_at(path: str, minute: float) -> int:
    ev, _ = kg.load(path)
    return sum(1 for t, _task in kg.green_times(ev) if t <= minute * 60)


def checkpoint_table(data: dict, seeds: list[int]) -> str:
    """Greens (beans on the stalk) after m minutes, per run: where the two policies cross."""
    L = ["| Run | " + " | ".join(f"{m} min" for m in CHECKPOINTS) + " |", "|---|" + "---|" * len(CHECKPOINTS)]
    means: dict[str, list[list[int]]] = {"queue": [[] for _ in CHECKPOINTS], "v2": [[] for _ in CHECKPOINTS]}
    for s in seeds:
        for pol in ("queue", "v2"):
            m = data[pol].get(s)
            if not m:
                continue
            row = [greens_at(m["path"], c) for c in CHECKPOINTS]
            for i, g in enumerate(row):
                means[pol][i].append(g)
            L.append(f"| seed {s} {pol} | " + " | ".join(str(g) for g in row) + " |")
    for pol in ("queue", "v2"):
        L.append(f"| **mean, {pol}** | " + " | ".join(f"**{sum(c) / len(c):.1f}**" if c else "n/a" for c in means[pol]) + " |")
    return "\n".join(L) + "\n"


def mechanism_table(data: dict) -> str:
    """What happened inside each run: the counters that explain the time to done."""
    L = ["| Run | Policy | Done (min) | Red batches | Cancelled speculative batches | Bisection CI runs | "
         "Ejections (conflict / red) | Held behind in-flight | Drops |", "|---|---|---|---|---|---|---|---|---|"]
    qx, qy = [], []
    for s in SEEDS:
        m = data["queue"].get(s)
        if not m:
            continue
        q = json.load(open(m["path"] + "/summary.json")).get("queue") or {}
        L.append(f"| seed {s} {ORDER[s]} | queue | {m['done']:.1f} | {q.get('batches_red')} | {q.get('batches_cancelled')} | "
                 f"{q.get('bisect_runs')} | {q.get('ejections_conflict')} / {q.get('ejections_red')} | "
                 f"{q.get('held_behind_inflight')} | {m['dropped']} |")
        if not m["flag"] and q.get("batches_red") is not None:
            qx.append(float(q["batches_red"]))
            qy.append(m["done"])
    L += ["", "| Run | Policy | Done (min) | Pre-land checks (red) | Re-checks after the sprout moved | "
          "Optimistic landings | Informed reworks | Decision cards | Revert-first | Drops | Agent-side check minutes |",
          "|---|---|---|---|---|---|---|---|---|---|---|"]
    for s in SEEDS:
        m = data["v2"].get(s)
        if not m:
            continue
        b = json.load(open(m["path"] + "/summary.json")).get("beanstalk") or {}
        L.append(f"| seed {s} {ORDER[s]} | v2 | {m['done']:.1f} | {b.get('preland_checks')} ({b.get('preland_red')}) | "
                 f"{b.get('preland_rechecks')} | {b.get('preland_optimistic_landings')} | {b.get('informed_reworks')} | "
                 f"{b.get('cards')} | {b.get('revert_first')} | {m['dropped']} | "
                 f"{round((b.get('preland_seconds') or 0) / 60, 1)} |")
    rho = spearman(qx, qy)
    note = ""
    if rho is not None:
        note = (f"\nQueue, clean runs: Spearman rank correlation between red batches and time to done = {rho:.2f} "
                f"(n = {len(qx)}).\n")
    return "\n".join(L) + "\n" + note


def short_uptime(text: str | None) -> str:
    """'20:39  up 1 day, 12:36, 12 users, load averages: 1.02 1.39 1.52' -> '20:39, load 1.02 1.39 1.52'."""
    if not text:
        return "not recorded"
    m = re.match(r"\s*(\S+)\s+up .*load averages?:\s*(.*)$", text)
    return f"{m.group(1)}, load {m.group(2).strip()}" if m else text


def load_table(data: dict, extra: dict | None = None) -> str:
    L = ["| Run | `uptime` at start (HH:MM, 1/5/15-min load) | `uptime` at end | 1-min load, mean / max of 30 s samples | "
         "suite s (median, p90) | Claude CLI startup ms (median) | Flag |", "|---|---|---|---|---|---|---|"]
    for pol in ("queue", "v2"):
        runs = [data[pol].get(s) for s in SEEDS] + [m for m in (extra or {}).get(pol, {}).values()]
        for m in runs:
            if not m:
                continue
            u = m["uptime"] or {}
            L.append(f"| {m['run']} | {short_uptime(u.get('start_uptime'))} | "
                     f"{short_uptime(u.get('end_uptime'))} | "
                     f"{fmt(u.get('load1_mean')) if u else 'not recorded'} / {fmt(u.get('load1_max')) if u else 'n/a'} | "
                     f"{fmt(m['suite_seconds_median'])}, {fmt(m['suite_seconds_p90'])} | "
                     f"{fmt(m['startup_ms_median'], 0)} | {m['flag']} |")
    return "\n".join(L) + "\n"


def build_markdown(seeds: list[int]) -> tuple[str, dict]:
    data = collect()
    extra = flagged_extra()
    clean = [x for x in clean_seeds(data) if x in seeds]
    allseeds = [x for x in seeds if x in data["queue"] and x in data["v2"]]
    md = "## Primary view: clean runs only (seeds " + ", ".join(map(str, clean)) + ")\n\n"
    md += md_tables(data, analyse(data, clean), clean) if clean else "no clean pairs yet\n"
    if allseeds != clean:
        md += "\n## Secondary view: every run including flagged ones (seeds " + ", ".join(map(str, allseeds)) + ")\n\n"
        md += md_tables(data, analyse(data, allseeds), allseeds)
    if any(extra.values()):
        md += "\n### Flagged first runs of re-run seeds\n\n"
        for pol in ("queue", "v2"):
            for sd, m in extra[pol].items():
                md += (f"- seed {sd} {pol} (first run, concurrent and under very high load): 20th {fmt(m['t20'])}, "
                       f"30th {fmt(m['t30'])}, 35th {fmt(m['t35'])}, done {fmt(m['done'])} min, "
                       f"{m['greens']} greens, ${m['cost']:.2f}, {m['red']} red validations\n")
    if clean:
        md += "\n### Greens on the stalk after m minutes (clean runs)\n\n" + checkpoint_table(data, clean)
    md += "\n### What happened inside each run\n\n" + mechanism_table(data)
    md += "\n### Machine load per run\n\n" + load_table(data, extra)
    return md, analyse(data, clean or allseeds)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--json")
    ap.add_argument("--md")
    ap.add_argument("--seeds", nargs="+", type=int, default=SEEDS)
    a = ap.parse_args()
    md, res = build_markdown(a.seeds)
    print(md)
    if a.md:
        with open(a.md, "w", encoding="utf-8") as fh:
            fh.write(md)
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump({"runs": collect(), "analysis": res}, fh, indent=1, default=str)
    return 0


if __name__ == "__main__":
    sys.exit(main())
