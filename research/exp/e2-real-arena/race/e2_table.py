#!/usr/bin/env python3
"""e2 results table: k-th verified green (kth_green.py's definition) plus the context each run needs to be read.

Usage: python3 e2_table.py runs/<a> runs/<b> ... [--k 10 15 20] [--md out.md]

Per run: k-th green (min / cumulative $), done (wall to the end of the race), greens, total $, red validations,
final correctness, p90 task start -> green, reworks, drops, CI minutes (+ v2 pre-land check minutes) and the load
average (1 min) when the race started and ended (runs/<name>.uptime, written by run-e2.sh).
"""
from __future__ import annotations

import argparse
import os
import re

from kth_green import cost_at, green_times, load


def uptime_loads(run: str) -> tuple[str, str]:
    path = run.rstrip("/") + ".uptime"
    if not os.path.exists(path):
        return "?", "?"
    text = open(path, encoding="utf-8").read()
    loads = re.findall(r"load averages?: ([\d.]+)", text)
    return (loads[0] if loads else "?"), (loads[1] if len(loads) > 1 else "?")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("runs", nargs="+")
    ap.add_argument("--k", nargs="+", type=int, default=[10, 15, 20])
    ap.add_argument("--md")
    a = ap.parse_args()
    head = (["run", "policy"] + [f"{k}th green min / $" for k in a.k] +
            ["done min", "greens / tasks", "total $", "red validations", "final correct", "p90 start->green min",
             "reworks", "drops", "CI min (+ pre-land)", "load start / end"])
    rows = []
    for run in a.runs:
        ev, s = load(run)
        g = green_times(ev)
        pol = str(s.get("policy", "?"))
        if isinstance(s.get("beanstalk"), dict) and s["beanstalk"].get("variant"):
            pol = "v2" if s["beanstalk"]["variant"] == "v2" else f"{pol} ({s['beanstalk']['variant']})"
        cells = [os.path.basename(run.rstrip("/")), pol]
        for k in a.k:
            cells.append(f"{g[k - 1][0] / 60:.1f} / {cost_at(ev, g[k - 1][0]):.2f}" if len(g) >= k else "not reached")
        fc = s.get("final") or {}
        lat = s.get("task_start_to_green_seconds") or {}
        inv = s.get("invocations") or {}
        bs = s.get("beanstalk") or {}
        pre = bs.get("preland_seconds")
        ci = f"{s.get('ci_minutes_total', '?')}" + (f" (+{round(pre / 60, 1)})" if pre else "")
        l0, l1 = uptime_loads(run)
        cells += [f"{(s.get('wall_seconds') or ev[-1]['t']) / 60:.1f}" + (" (aborted)" if s.get("aborted") else ""),
                  f"{len(g)} / {s.get('tasks', '?')}", f"{s.get('cost_usd', 0):.2f}", str(s.get("red_validations", "?")),
                  str(fc.get("correct", "?")),
                  f"{lat['p90'] / 60:.1f}" if lat.get("p90") else "?",
                  str(inv.get("rework", 0)), str(s.get("tasks_dropped", "?")), ci, f"{l0} / {l1}"]
        rows.append(cells)
    lines = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)] + ["| " + " | ".join(r) + " |" for r in rows]
    out = "\n".join(lines)
    print(out)
    if a.md:
        with open(a.md, "w", encoding="utf-8") as fh:
            fh.write(out + "\n")


if __name__ == "__main__":
    main()
