#!/usr/bin/env python3
"""Time and money to the k-th verified green, per run (the comparable race metric; see docs/claude-opus/09 §1.2).

Usage: python3 kth_green.py runs/<a> runs/<b> ... [--k 20 30 35] [--md out.md]

For each run: when the k-th task reached green (minutes since ``race.start``, the clock ``summary.wall_seconds``
uses; ``--raw-clock`` gives the older numbers, minutes since the run's creation) and the cumulative agent cost at
that moment; the median and p90 of each shipped task's start to its first stable (green) commit; when the last
green came; plus final greens, total cost, wall clock, red validations and final correctness from summary.json.
A parked bean (v2 `park`: it waits for a person) is not shipped, like a dropped one; the parked column counts them.
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


def race_start(ev: list[dict]) -> float:
    """``t`` of the run's ``race.start`` (the zero of ``summary.wall_seconds``), or 0 when the log has none. Event
    times count from the run's creation: a cloud run's race.start comes 6.6-14 s later (seeding, start)."""
    return next((float(e["t"]) for e in ev if e["type"] == "race.start"), 0.0)


def start_times(ev: list[dict]) -> dict[str, float]:
    """Each task's first task.start (a start card's bean starts again later; the first start counts)."""
    seen: dict[str, float] = {}
    for e in ev:
        if e["type"] == "task.start" and e.get("task"):
            seen.setdefault(e["task"], e["t"])
    return seen


def percentile(values: list[float], q: float) -> float | None:
    """Linear interpolation between closest ranks (numpy's default), or None for no values."""
    if not values:
        return None
    xs = sorted(values)
    pos = (len(xs) - 1) * q
    lo = int(pos)
    hi = min(lo + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo)


def start_to_green(ev: list[dict], greens: list[tuple[float, str]]) -> tuple[float | None, float | None]:
    """Median and p90 minutes from a shipped task's start to its first green."""
    starts = start_times(ev)
    spans = [(t - starts[task]) / 60 for t, task in greens if task in starts]
    return percentile(spans, 0.5), percentile(spans, 0.9)


def parked_count(ev: list[dict], summary: dict) -> int:
    if isinstance(summary.get("parked"), list):
        return len(summary["parked"])
    return len({e["task"] for e in ev if e["type"] == "task.parked"})


def minutes(value: float | None) -> str:
    return "-" if value is None else f"{value:.1f}"


def cost_at(ev: list[dict], t: float) -> float:
    return sum((e.get("cost_usd") or 0.0) for e in ev if e["type"] == "invocation.end" and e["t"] <= t)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("runs", nargs="+")
    ap.add_argument("--k", nargs="+", type=int, default=[20, 30, 35])
    ap.add_argument("--md", help="also write the table to this markdown file")
    ap.add_argument("--raw-clock", action="store_true",
                    help="minutes since the run's creation (event t) instead of since race.start, as published "
                         "before 2026-10-06")
    a = ap.parse_args()
    head = ["run", "policy", "model", "agents"] + [f"{k}th green min / $" for k in a.k] + \
           ["start to green median / p90 min", "last green min", "greens", "parked", "total $", "wall min",
            "red validations", "correct"]
    rows = []
    for run in a.runs:
        ev, s = load(run)
        g = green_times(ev)
        t0 = 0.0 if a.raw_clock else race_start(ev)
        cfg = s.get("config", {})
        cells = [os.path.basename(run.rstrip("/")), str(s.get("policy", "?")) +
                 (f" ({s['beanstalk'].get('variant')})" if isinstance(s.get("beanstalk"), dict) and
                  s["beanstalk"].get("variant") else ""),
                 str(s.get("model") or cfg.get("model") or "?"), str(cfg.get("agents", "?"))]
        for k in a.k:
            if len(g) >= k:
                t = g[k - 1][0]
                cells.append(f"{(t - t0) / 60:.1f} / {cost_at(ev, t):.2f}")
            else:
                cells.append("not reached")
        fc = s.get("final") or s.get("final_check") or {}
        median, p90 = start_to_green(ev, g)
        cells += [f"{minutes(median)} / {minutes(p90)}", minutes((g[-1][0] - t0) / 60 if g else None)]
        cells += [str(len(g)), str(parked_count(ev, s)), f"{s.get('cost_usd') if isinstance(s.get('cost_usd'), (int, float)) else sum((e.get('cost_usd') or 0) for e in ev if e['type'] == 'invocation.end'):.2f}",
                  f"{(s.get('wall_seconds') or ev[-1]['t'] - race_start(ev)) / 60:.1f}",
                  str(s.get("red_validations", "?")),
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
