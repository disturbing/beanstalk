#!/usr/bin/env python3
"""One line about a race in progress: clock, tasks green/landed, spend, flaked runs, re-runs, needless reworks, reverts, load.

Usage: python3 progress.py runs/<name>            (or no argument: the newest runs/e3-* directory)
"""
from __future__ import annotations

import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness.flake import metrics  # noqa: E402


def line(run: str) -> str:
    try:
        with open(os.path.join(run, "events.jsonl"), encoding="utf-8") as fh:
            ev = [json.loads(x) for x in fh if x.strip()]
    except OSError:
        return f"{os.path.basename(run)}: no events yet"
    if not ev:
        return f"{os.path.basename(run)}: empty"
    greens = set()
    for e in ev:
        if e["type"] == "green.promote":
            greens |= set(e.get("tasks") or [])
        elif e["type"] in ("task.green", "land") and e.get("target") == "main" and e.get("task"):
            greens.add(e["task"])
    landed = {e["task"] for e in ev if e["type"] == "land" and e.get("task")}
    spent = max([e.get("spent_usd") or 0 for e in ev if e["type"] == "invocation.end"] or [0])
    m = metrics(ev)
    load = [e for e in ev if e["type"] == "machine.load"]
    end = next((e for e in ev if e["type"] == "race.end"), None)
    rr = m["reruns"].values()
    return (f"{os.path.basename(run)}: t={ev[-1]['t'] / 60:.1f} min green {len(greens)} landed {len(landed)} spent ${spent:.2f} "
            f"| flaked {m['flaked_runs']} of {m['ci_runs_total']} runs | re-runs {sum(r['absorbed'] for r in rr)}/{sum(r['count'] for r in rr)} "
            f"| needless {m['needless_reworks']} wrongful {m['wrongful_reverts']}/{m['reverts']} "
            f"| load1 {load[-1]['load1'] if load else '-'}" + (f" | ENDED aborted={end.get('aborted')}" if end else ""))


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("run", nargs="?", help="run directory (default: the newest runs/e3-* directory)")
    a = ap.parse_args()
    here = os.path.dirname(os.path.abspath(__file__))
    run = a.run or max(glob.glob(os.path.join(here, "runs", "e3-*", "events.jsonl")), key=os.path.getmtime, default=None)
    if run and run.endswith("events.jsonl"):
        run = os.path.dirname(run)
    print(line(run) if run else "no e3 run yet")
