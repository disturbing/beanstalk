#!/usr/bin/env python3
"""E5 results table: one row per race, the metrics the question asks for, from events.jsonl + summary.json.

  python3 runstats.py LABEL=runs/dir [LABEL=runs/dir ...] [--fracs 0.5 0.75 0.9] [--md out.md] [--json out.json]

Columns: k-th green (minutes / $) at fractions of the task count (time and money to the k-th verified green,
as race/kth_green.py), done time, greens, rechecks and optimistic landings (v2), conflicts, informed reworks,
decision cards, red validations, cost, bean drift (landings absorbed by the sprout while a bean was being
written), real and in-race bean authoring time, machine load at start and end.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from e5lib import cost_at, green_times, load_run  # noqa: E402


def pct(xs: list[float], q: float) -> float | None:
    if not xs:
        return None
    xs = sorted(xs)
    k = (len(xs) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def loadavg(ev: list[dict], typ: str) -> str:
    e = next((x for x in ev if x["type"] == typ), None)
    if not e:
        return "not logged"
    la = e.get("loadavg") or []
    up = e.get("uptime", "")
    return (" / ".join(str(x) for x in la[:1]) + " (" + up.split("load averages:")[-1].strip() + ")") if up else str(la)


def analyse(label: str, path: str, fracs: list[float]) -> dict:
    run = load_run(path, transcripts=False)
    ev, s = run.events, run.summary
    n = run.n_tasks
    cfg = s.get("config", {})
    g = green_times(ev)
    row: dict = {"label": label, "run": run.name, "policy": s.get("policy"), "n_tasks": n,
                 "agents": cfg.get("agents"), "drift_factor": run.drift_factor, "aborted": s.get("aborted")}
    pol = s.get("beanstalk") or {}
    row["variant"] = pol.get("variant") or ("queue" if s.get("queue") else "?")
    ks = []
    for f in fracs:
        k = max(1, math.ceil(f * n))
        ks.append(k)
        if len(g) >= k:
            t = g[k - 1][0]
            row[f"k{f}"] = {"k": k, "min": round(t / 60, 2), "usd": round(cost_at(ev, t), 2)}
        else:
            row[f"k{f}"] = {"k": k, "min": None, "usd": None}
    row["greens"] = len(g)
    row["done_min"] = round((s.get("wall_seconds") or ev[-1]["t"]) / 60, 2)
    row["cost_usd"] = round(s.get("cost_usd") or 0.0, 2)
    row["red_validations"] = s.get("red_validations")
    row["drops_by_reason"] = s.get("drops_by_reason")
    rb: dict[str, int] = {}
    for e in ev:
        if e["type"] == "rework.start":
            rb[e.get("reason") or "?"] = rb.get(e.get("reason") or "?", 0) + 1
    row["reworks_by_reason"] = rb
    row["test_minutes_ci"] = s.get("ci_minutes_total")
    row["conflicts"] = s.get("textual_conflicts")
    row["final_correct"] = (s.get("final") or {}).get("correct")
    row["dropped"] = s.get("tasks_dropped")
    inv = s.get("invocations") or {}
    row["initial"], row["rework"] = inv.get("initial", 0), inv.get("rework", 0)
    row["cost_by_kind"] = s.get("cost_by_kind")
    row["start_to_green_med_p90_min"] = [None if v is None else round(v / 60, 2) for v in
                                         (s.get("task_start_to_green_seconds", {}).get("median"),
                                          s.get("task_start_to_green_seconds", {}).get("p90"))]
    row["ci_minutes"] = s.get("ci_minutes_total")
    am = s.get("agent_minutes") or {}
    row["agent_minutes_busy_blocked_idle"] = [am.get("busy"), am.get("blocked"), am.get("idle")]
    # v2 / queue specifics
    if pol:
        row.update({"preland_checks": pol.get("preland_checks"), "preland_red": pol.get("preland_red"),
                    "optimistic_landings": pol.get("preland_optimistic_landings"),
                    "rechecks": pol.get("preland_rechecks"), "locked_fallbacks": pol.get("preland_locked_fallbacks"),
                    "informed_reworks": pol.get("informed_reworks"), "cards": pol.get("cards"),
                    "revert_first": pol.get("revert_first"), "preland_minutes": pol.get("preland_seconds")})
        if row["preland_minutes"] is not None:
            row["preland_minutes"] = round(row["preland_minutes"] / 60, 1)
        row["test_minutes_total"] = round((row["preland_minutes"] or 0) + (row["test_minutes_ci"] or 0), 1)
    if pol:
        # was a recheck (the trunk moved under a checked change and shared a file with it) worth its 60 s? the next
        # pre-land check of the same task tells: green = the first check would have sufficed, red = it caught something
        pending: dict[str, bool] = {}
        rc_green = rc_red = 0
        for e in ev:
            if e["type"] == "preland.recheck":
                pending[e["task"]] = True
            elif e["type"] == "preland.check" and pending.pop(e["task"], False):
                rc_green += bool(e.get("green"))
                rc_red += not e.get("green")
        row["recheck_outcome_green_red"] = [rc_green, rc_red]
        lands = [x for x in run.landings if x.get("kind") == "task"]
        row["landings"] = len(lands)
        row["optimistic_share"] = round((pol.get("preland_optimistic_landings") or 0) / len(lands), 2) if lands else None
        row["checks_per_landing"] = round((pol.get("preland_checks") or 0) / len(lands), 2) if lands else None
    q = s.get("queue") or {}
    if q:
        row["test_minutes_total"] = round(row["test_minutes_ci"] or 0, 1)
        row.update({"batches": f"{q.get('batches_green')}/{q.get('batches_red')}/{q.get('batches_cancelled')}",
                    "ejections_conflict": q.get("ejections_conflict"), "ejections_red": q.get("ejections_red"),
                    "bisect_runs": q.get("bisect_runs"), "held_behind": q.get("held_behind_inflight")})
    # bean authoring time (real and in-race) and drift absorbed by the sprout while a bean was being written
    ini = [i for i in load_run(path, transcripts=False).invocations if i.kind == "initial"]
    row["initial_wall_s_med"] = round(statistics.median(i.wall for i in ini), 1) if ini else None
    row["initial_wall_s_p90"] = round(pct([i.wall for i in ini], 0.9) or 0, 1) if ini else None
    row["initial_inrace_s_med"] = round(statistics.median(i.wall + i.drift for i in ini), 1) if ini else None
    row["initial_inrace_s_p90"] = round(pct([i.wall + i.drift for i in ini], 0.9) or 0, 1) if ini else None
    rw = [i for i in run.invocations if i.kind == "rework"]
    row["rework_inrace_s_med"] = round(statistics.median(i.wall + i.drift for i in rw), 1) if rw else None
    drift_during = []
    drift_to_land = []
    land_by_task = {x["task"]: x for x in run.landings if x.get("kind", "task") == "task"}
    first_end = {i.task: i.end for i in sorted(ini, key=lambda i: i.start)}
    for task, st in run.starts.items():
        fe = first_end.get(task)
        if fe is not None:
            drift_during.append(sum(1 for x in run.landings if x["task"] != task and st < x["epoch"] <= fe))
        lt = land_by_task.get(task)
        if lt is not None:
            drift_to_land.append(sum(1 for x in run.landings if x["task"] != task and st < x["epoch"] < lt["epoch"]))
    # integration latency: from the end of the bean's first authoring to landing on the sprout (v2) / the stalk (queue),
    # and to green. The gate each policy puts between "agent finished" and "landed".
    submit_land, submit_green = [], []
    gt = {task: t for t, task in g}
    race_t = {x["task"]: x["t"] for x in run.landings if x.get("kind", "task") == "task"}
    ini_end_t = {}
    for e in ev:
        if e["type"] == "invocation.end" and e.get("kind") == "initial" and e.get("task") not in ini_end_t:
            ini_end_t[e["task"]] = e["t"]
    for task, te in ini_end_t.items():
        if task in race_t:
            submit_land.append(race_t[task] - te)
        if task in gt:
            submit_green.append(gt[task] - te)
    row["submit_to_land_s_med_p90"] = [round(pct(submit_land, 0.5), 1), round(pct(submit_land, 0.9), 1)] if submit_land else None
    row["submit_to_green_s_med_p90"] = [round(pct(submit_green, 0.5), 1), round(pct(submit_green, 0.9), 1)] if submit_green else None
    depth = [e["depth"] for e in ev if e["type"] == "queue.enqueue"]
    row["queue_max_depth"] = max(depth) if depth else None
    row["landings_during_first_authoring_med_p90"] = [pct(drift_during, 0.5), pct(drift_during, 0.9)] if drift_during else None
    row["landings_start_to_land_med_p90"] = [pct(drift_to_land, 0.5), pct(drift_to_land, 0.9)] if drift_to_land else None
    row["load_start"] = loadavg(ev, "race.start")
    row["load_end"] = loadavg(ev, "race.end")
    samples = [e["loadavg"][0] for e in ev if e["type"] == "load.sample" and e.get("loadavg")]
    row["load1_mean_max"] = [round(statistics.fmean(samples), 1), round(max(samples), 1)] if samples else None
    suites = [e.get("suite_seconds") for e in ev if e["type"] in ("ci.end", "preland.check") and e.get("suite_seconds") is not None]
    row["suite_seconds_med_p90"] = [round(pct(suites, 0.5), 2), round(pct(suites, 0.9), 2)] if suites else None
    return row


def markdown(rows: list[dict], fracs: list[float]) -> str:
    def kcell(r: dict, f: float) -> str:
        c = r[f"k{f}"]
        return "not reached" if c["min"] is None else f"{c['min']:.1f} / ${c['usd']:.2f}"

    head = ["run", "policy", "tasks", "drift x", "initial bean min (real / in race)"] + \
           [f"{int(f * 100)}% green (k={rows[0][f'k{f}']['k']}) min / $" if len({r['n_tasks'] for r in rows}) == 1 else
            f"{int(f * 100)}% green min / $" for f in fracs] + \
           ["done min", "greens", "rechecks / optimistic", "conflicts", "informed reworks", "cards", "red validations", "cost $"]
    lines = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    for r in rows:
        v2 = r.get("variant") in ("v2", "v2r")
        cells = [r["label"], r["variant"], str(r["n_tasks"]), f"{r['drift_factor']:g}",
                 f"{r['initial_wall_s_med'] / 60:.1f} / {r['initial_inrace_s_med'] / 60:.1f}"]
        cells += [kcell(r, f) for f in fracs]
        cells += [f"{r['done_min']:.1f}", f"{r['greens']}/{r['n_tasks']}",
                  f"{r.get('rechecks')} / {r.get('optimistic_landings')}" if v2 else "n/a (queue)",
                  str(r["conflicts"]), str(r.get("informed_reworks")) if v2 else f"{r.get('rework')} reworks (ejections {r.get('ejections_conflict')}c/{r.get('ejections_red')}r)",
                  str(r.get("cards")) if v2 else "n/a", str(r["red_validations"]), f"{r['cost_usd']:.2f}"]
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("runs", nargs="+", help="LABEL=path or path")
    ap.add_argument("--fracs", nargs="+", type=float, default=[0.5, 0.75, 0.9])
    ap.add_argument("--md")
    ap.add_argument("--json")
    a = ap.parse_args()
    rows = []
    for spec in a.runs:
        label, _, path = spec.partition("=") if "=" in spec else (os.path.basename(spec.rstrip("/")), "", spec)
        rows.append(analyse(label, path, a.fracs))
    md = markdown(rows, a.fracs)
    print(md)
    if a.md:
        with open(a.md, "w", encoding="utf-8") as fh:
            fh.write(md + "\n")
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(rows, fh, indent=1, default=str)


if __name__ == "__main__":
    main()
