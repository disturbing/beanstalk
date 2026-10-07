#!/usr/bin/env python3
"""The measured set as one markdown table (both forges per N and seed), with each run's gateway era and capacity.

  python3 loadgen/table.py runs/lg-fastify-*-s*-github runs/lg-fastify-*-s*-beanstalk
"""
from __future__ import annotations

import json
import os
import re
import sys


def m(s: float | None) -> str:
    return "-" if s is None else f"{s / 60:.1f}"


def era(s: dict) -> str:
    label = s.get("label") or ""
    v = re.search(r"gateway ([0-9a-f]{8})", label)
    if s["forge"] == "github":
        return "GitHub" + (" (alone)" if "alone" in label else "")
    if "pre-fix" in label or not v:
        return "pre-fix (2 shared sandboxes)" + (f", {v.group(1)}" if v else "")
    cap = (s.get("forge_detail") or {}).get("preland_capacity") or {}
    if cap.get("sandboxes") == 2:
        return f"{v.group(1)}, 2 shared sandboxes"
    return f"{v.group(1)}, {cap.get('sandboxes')} sandboxes" + (" (alone)" if "alone" in label else "")


def main(runs: list[str]) -> None:
    rows = []
    for r in runs:
        with open(os.path.join(r, "summary.json"), encoding="utf-8") as fh:
            s = json.load(fh)
        rows.append((s["config"]["workers"], s["config"]["seed"], 0 if s["forge"] == "github" else 1,
                     os.path.basename(r.rstrip("/")), s))
    rows.sort()
    head = ["N", "seed", "forge / era", "integrated", "ready→integrated med/p90 min", "ready→stable med/p90",
            "enqueue→merged med/p90", "waiting share change/worker", "red/conflict kick-outs", "rebases",
            "per 10 min (peak)", "CI min", "max concurrent pre-checks", "suite timeouts", "wall min", "correct"]
    out = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    for n, seed, _, name, s in rows:
        fd = s.get("forge_detail") or {}
        rx = s.get("reactions") or {}
        r, st, eq = s["ready_to_integrated_s"], s["ready_to_stable_s"], s["enqueue_to_merged_s"]
        if s["forge"] == "github":
            conc = (fd.get("concurrency") or {}).get("max_concurrent_pr_checks")
            timeouts = "-"
        else:
            cap = fd.get("preland_capacity") or {}
            conc, timeouts = cap.get("max_concurrent_checks"), cap.get("suite_timeouts")
        out.append("| " + " | ".join(str(x) for x in [
            n, seed, era(s), f"{s['tasks_green']}/{s['tasks']}", f"{m(r['median'])} / {m(r['p90'])}",
            f"{m(st['median'])} / {m(st['p90'])}", f"{m(eq['median'])} / {m(eq['p90'])}" if eq["n"] else "-",
            f"{s['waiting_share_of_change_life']} / {s['waiting_share_of_worker_time']}",
            f"{rx.get('red', 0)} / {rx.get('conflict', 0)}", rx.get("rebase", 0),
            f"{s['throughput_per_10min']} ({s['peak_integrated_in_10min']})", s.get("ci_minutes"), conc, timeouts,
            f"{s['wall_seconds'] / 60:.1f}", (s.get("final") or {}).get("correct")]) + " |")
    print("\n".join(out))


if __name__ == "__main__":
    main(sys.argv[1:])
