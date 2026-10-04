#!/usr/bin/env python3
"""E3: the tables of the write-up, from run directories (so nothing is copied by hand).

Usage: python3 tables.py runs/e3-r05-queue-retry runs/e3-r05-v2-plain runs/e3-r05-v2-mitigated [--ref <no-flake runs...>]
                         [--k 20 30 35] [--md out.md]

A: headline (k-th green minutes / agent $, greens, dropped, cost, wall clock, final correctness, machine load)
B: what the flakes did (flaked runs, re-runs and what triggered them, needless reworks and their cost, wrongful reverts,
   flaked validations and what became of their tickets, check minutes)
C: cost by invocation kind and test compute
``--ref`` adds no-flake reference races (earlier runs, other day and load) to table A, marked as such.
"""
from __future__ import annotations

import argparse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flake_report import analyse, load  # noqa: E402
from kth_green import cost_at, green_times  # noqa: E402


def uptime_loads(run: str) -> str:
    """'start / end' 1-minute load averages from runs/<name>.uptime.txt (written around the race by race_with_uptime.sh)."""
    path = os.path.join(os.path.dirname(run.rstrip("/")), os.path.basename(run.rstrip("/")) + ".uptime.txt")
    try:
        text = open(path).read()
    except OSError:
        return "-"
    loads = re.findall(r"load averages?: ([\d.]+)", text)
    return f"{loads[0]} / {loads[-1]}" if len(loads) >= 2 else "-"


def label(run: str, ref: bool) -> str:
    name = os.path.basename(run.rstrip("/")).replace("e3-", "")
    return f"{name} (no-flake reference)" if ref else name


def table_a(runs: list[tuple[str, bool]], ks: list[int]) -> str:
    head = ["race", "flake rate", "mitigations"] + [f"{k}th green min / $" for k in ks] + [
        "greens", "dropped", "total $", "wall min", "final correct", "load1 mean / max (start / end of uptime)"]
    lines = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    for run, ref in runs:
        ev, s = load(run)
        a = analyse(run)
        g = green_times(ev)
        cells = [label(run, ref), "0" if ref else str(a["rate"]),
                 ", ".join(k.replace("rerun_", "re-run ").replace("retry_batch", "retry batch")
                           for k, v in a["mitigations"].items() if v) or "none"]
        for k in ks:
            cells.append(f"{g[k - 1][0] / 60:.1f} / {cost_at(ev, g[k - 1][0]):.2f}" if len(g) >= k else "not reached")
        m = a["machine"] or {}
        cells += [str(a["greens"]), str(a["dropped"]), f"{a['cost_usd']:.2f}", str(a["wall_min"]), str(a["correct"]),
                  (f"{m.get('load1_mean', '-')} / {m.get('load1_max', '-')} ({uptime_loads(run)})" if m else "-")]
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


def table_b(runs: list[str]) -> str:
    head = ["race", "suite runs (preland / validate / batch / bisect)", "flaked runs", "real red checks", "re-runs: on a flake / on a real red",
            "absorbed", "needless reworks / ejections ($)", "agent edited files in", "wrongful reverts / reverts",
            "flaked validations: tickets / exonerated / reverted", "decision cards fed by flakes", "flaky tests found (flips)"]
    lines = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    for run in runs:
        a = analyse(run)
        r = a["ci_runs"]
        rr = a["reruns"].values()
        real_reds = sum(a["real_reds"].values())
        needless = a["needless_reworks"]
        lines.append("| " + " | ".join([
            label(run, False), f"{r.get('preland', 0)} / {r.get('validate', 0)} / {r.get('batch', 0)} / {r.get('bisect', 0)}",
            str(a["flaked_runs"]), str(real_reds),
            f"{sum(x.get('on_flake', 0) for x in rr)} / {sum(x.get('on_real', 0) for x in rr)}",
            f"{sum(x['absorbed'] for x in rr)} of {sum(x['count'] for x in rr)}",
            f"{needless} / {a['queue_needless_ejections']} (${a['needless_rework_cost_usd']:.2f})",
            f"{a['needless_that_edited_files']} of {needless}", f"{a['wrongful_reverts']} / {a['reverts']}",
            f"{a['flaked_validations']}: {a['flake_tickets']} / {a['flake_tickets_exonerated']} / {a['flake_tickets_reverted']}",
            f"{a['cards_fed_by_flakes']} of {a['cards']}",
            ", ".join(f"{t.split(' > ')[0].split('/')[-1].replace('.test.ts', '')} x{n}" for t, n in a["flaky_tests"].items()) or "none"]) + " |")
    return "\n".join(lines)


def table_c(runs: list[str]) -> str:
    head = ["race", "agent $ total", "initial", "rework", "fixer", "needless rework $", "$ thrown away by wrongful reverts",
            "pre-land + CI check minutes", "of which re-runs", "CI slot utilization", "task start to green p50 / p90 (min)"]
    lines = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    for run in runs:
        a = analyse(run)
        c = a["cost_by_kind"]
        t = a["task_start_to_green"] or {}
        lines.append("| " + " | ".join([
            label(run, False), f"{a['cost_usd']:.2f}", f"{c.get('initial', 0):.2f}", f"{c.get('rework', 0):.2f}", f"{c.get('fixer', 0):.2f}",
            f"{a['needless_rework_cost_usd']:.2f}", f"{a['lost_work_usd']:.2f}", str(a["total_check_minutes"]), str(a["rerun_minutes"]),
            str(a["ci_slot_utilization"]),
            f"{(t.get('median') or 0) / 60:.1f} / {(t.get('p90') or 0) / 60:.1f}"]) + " |")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("runs", nargs="+")
    ap.add_argument("--ref", nargs="*", default=[])
    ap.add_argument("--k", nargs="+", type=int, default=[20, 30, 35])
    ap.add_argument("--md")
    a = ap.parse_args()
    out = ["### A. Headline", "", table_a([(r, False) for r in a.runs] + [(r, True) for r in a.ref], a.k), "",
           "### B. What the flakes did", "", table_b(a.runs), "", "### C. Cost", "", table_c(a.runs), ""]
    text = "\n".join(out)
    print(text)
    if a.md:
        with open(a.md, "w", encoding="utf-8") as fh:
            fh.write(text)


if __name__ == "__main__":
    main()
