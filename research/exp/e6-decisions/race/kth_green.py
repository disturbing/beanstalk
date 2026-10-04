#!/usr/bin/env python3
"""Time and money to the k-th verified green, per run (the comparable race metric; see docs/claude-opus/09 §1.2).

Usage: python3 kth_green.py runs/<a> runs/<b> ... [--k 20 30 35] [--md out.md]

For each run: when the k-th task reached green (minutes since race start) and the cumulative agent cost at
that moment; plus final greens, total cost, wall clock, red validations and final correctness from summary.json.
"""
from __future__ import annotations

import argparse
import json
import os


def load(run: str) -> tuple[list[dict], dict]:
    with open(os.path.join(run, "events.jsonl"), encoding="utf-8") as fh:
        ev = [json.loads(line) for line in fh if line.strip()]
    summary = {}
    sp = os.path.join(run, "summary.json")
    if os.path.exists(sp):
        with open(sp, encoding="utf-8") as fh:
            summary = json.load(fh)
    return ev, summary


def green_times(ev: list[dict]) -> list[tuple[float, str]]:
    """(t, task) for each task's first green, from green.promote (beanstalk) or task green events (queue)."""
    seen: dict[str, float] = {}
    for e in ev:
        tasks: list[str] = []
        if e["type"] == "green.promote":
            tasks = list(e.get("tasks") or [])
        elif e["type"] in ("task.green", "land") and e.get("target") in ("main",) and e.get("task"):
            tasks = [e["task"]]
        for t in tasks:
            seen.setdefault(t, e["t"])
    return sorted((t, task) for task, t in seen.items())


def cost_at(ev: list[dict], t: float) -> float:
    return sum((e.get("cost_usd") or 0.0) for e in ev if e["type"] == "invocation.end" and e["t"] <= t)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("runs", nargs="+")
    ap.add_argument("--k", nargs="+", type=int, default=[20, 30, 35])
    ap.add_argument("--md", help="also write the table to this markdown file")
    a = ap.parse_args()
    head = ["run", "policy", "model", "agents"] + [f"{k}th green min / $" for k in a.k] + \
           ["greens", "total $", "wall min", "red validations", "correct"]
    rows = []
    for run in a.runs:
        ev, s = load(run)
        g = green_times(ev)
        cfg = s.get("config", {})
        cells = [os.path.basename(run.rstrip("/")), str(s.get("policy", "?")) +
                 (f" ({s['beanstalk'].get('variant')})" if isinstance(s.get("beanstalk"), dict) and
                  s["beanstalk"].get("variant") else ""),
                 str(s.get("model") or cfg.get("model") or "?"), str(cfg.get("agents", "?"))]
        for k in a.k:
            if len(g) >= k:
                t = g[k - 1][0]
                cells.append(f"{t / 60:.1f} / {cost_at(ev, t):.2f}")
            else:
                cells.append("not reached")
        fc = s.get("final") or s.get("final_check") or {}
        cells += [str(len(g)), f"{s.get('cost_usd') if isinstance(s.get('cost_usd'), (int, float)) else sum((e.get('cost_usd') or 0) for e in ev if e['type'] == 'invocation.end'):.2f}",
                  f"{(s.get('wall_seconds') or ev[-1]['t']) / 60:.1f}", str(s.get("red_validations", "?")),
                  str(fc.get("correct", "?"))]
        rows.append(cells)
    lines = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    lines += ["| " + " | ".join(r) + " |" for r in rows]
    out = "\n".join(lines)
    print(out)
    if a.md:
        with open(a.md, "w", encoding="utf-8") as fh:
            fh.write(out + "\n")


if __name__ == "__main__":
    main()
