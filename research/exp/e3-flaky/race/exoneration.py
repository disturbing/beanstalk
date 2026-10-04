#!/usr/bin/env python3
"""E3: trace-driven estimate of how often a flaky red sprout validation would end in a (wrongful) revert.

Usage: python3 exoneration.py runs/<v2 race without flakes> [...] [--round-seconds 80]

A red validation of sprout head k opens a ticket only if the stalk has not passed k already (otherwise the red is stale).
The culprit search then needs ceil(log3(k - stalk)) rounds of probes, each about --round-seconds (a CI slot is shared with
the validations), and the revert only happens if no newer head validated green meanwhile: such a green closes the
ticket, because a green on a descendant of k means k is not broken. With gap = k - stalk == 1 there is nothing to search
and the revert is immediate. This replays the validations of a measured no-flake race and asks, for each, what a
flaky red there would have led to. It ignores second-order effects (the flake delaying later landings).
"""
from __future__ import annotations

import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flake_report import load  # noqa: E402


def rounds_for(gap: int) -> int:
    n = 0
    while gap > 1:
        probes = max(1, min(2, gap - 1))
        points = sorted({max(1, round(gap * (i + 1) / (probes + 1))) for i in range(probes)})
        points = [p for p in points if 0 < p < gap] or [1]
        gap = gap - max(points)
        n += 1
    return n


def analyse(run: str, round_s: float) -> dict:
    ev, _ = load(run)
    vals = [(e["t"], e.get("trunk_idx"), bool(e.get("green"))) for e in ev
            if e["type"] == "ci.end" and e.get("purpose") == "validate" and e.get("green") is not None and not e.get("rerun")]
    promotes = [(e["t"], e["trunk_idx"]) for e in ev if e["type"] == "green.promote" and "trunk_idx" in e]
    out = {"validations": len(vals), "stale": 0, "immediate": 0, "exonerated": 0, "reverted": 0, "gaps": []}
    for t, k, _ in vals:
        stalk = max([i for tp, i in promotes if tp <= t] or [-1])
        if k is None or k <= stalk:
            out["stale"] += 1
            continue
        gap = k - stalk
        out["gaps"].append(gap)
        if gap == 1:
            out["immediate"] += 1
            out["reverted"] += 1
            continue
        window = rounds_for(gap) * round_s
        saved = any(t < t2 <= t + window and k2 > k and ok2 for t2, k2, ok2 in vals)
        out["exonerated" if saved else "reverted"] += 1
    n = max(1, out["validations"])
    out["p_revert_given_flaky_validation"] = round(out["reverted"] / n, 3)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("runs", nargs="+")
    ap.add_argument("--round-seconds", type=float, default=80.0)
    a = ap.parse_args()
    for r in a.runs:
        o = analyse(r, a.round_seconds)
        gaps = o.pop("gaps")
        print(os.path.basename(r.rstrip("/")), o, "mean gap", round(sum(gaps) / max(1, len(gaps)), 1))


if __name__ == "__main__":
    main()
