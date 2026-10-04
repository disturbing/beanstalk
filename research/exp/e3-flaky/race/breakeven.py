#!/usr/bin/env python3
"""E3: at what flake rate does a "re-run every red" mitigation start to pay? Arithmetic on measured races (expected, not measured).

Usage: python3 breakeven.py --v2 runs/<v2 race> [...] --queue runs/<queue race> [...]

A re-run costs one more check (the emulated 60 s, on the bean's own critical path) for EVERY red, real or flaky; it saves,
for a flaky red, the detour the red causes. So it pays when
        r * checks * saved_per_flake  >  real_reds * rerun_seconds      =>      r* = real_reds * t_rerun / (checks * saved)
Inputs from the races (several races: averaged):
  v2 pre-land:   checks, real red checks, seconds one check takes (t_rerun), and the detour of a needless rework: from the
                 red check to the landing of the same bean, minus the re-run that would have replaced it (t_rerun).
                 Only the checks that are really green (checks - real reds) can flake.
  queue batch:   batches, real red batches, seconds a batch takes, and the detour of a red batch: for the PRs in it, the
                 time from the red result to their landing (a green batch lands its PRs at once). A retry also holds up the
                 PRs of the speculative batches behind it, which roughly doubles its cost (the "with PRs behind" line).
Validation re-runs (v2 (ii)) are not in this table: a red validation is rare (1-2 per race) and the re-run costs no bean time,
so it pays at any rate that can produce a wrongful revert.
"""
from __future__ import annotations

import argparse
import os
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flake_report import load  # noqa: E402


def v2_inputs(run: str) -> dict:
    ev, _ = load(run)
    firsts = [e for e in ev if e["type"] == "preland.check" and not e.get("rerun")]
    secs = [e.get("check_seconds") or 0.0 for e in firsts]
    real = [e for e in firsts if e.get("green") is False and not e.get("flaked")]
    land = {}
    for e in ev:
        if e["type"] == "land" and e.get("task"):
            land.setdefault(e["task"], e["t"])
    detours = []
    for e in firsts:
        if e.get("flaked") and e["task"] in land:   # a flaky red that was not absorbed: the bean took the rework detour
            detours.append(land[e["task"]] - e["t"])
    return {"checks": len(firsts), "real_reds": len(real), "t_check": statistics.fmean(secs) if secs else 60.0,
            "detours": detours}


def queue_inputs(run: str) -> dict:
    ev, _ = load(run)
    batches = [e for e in ev if e["type"] == "ci.end" and e.get("purpose") == "batch" and e.get("green") is not None
               and not e.get("rerun")]
    land = {}
    for e in ev:
        if e["type"] == "land" and e.get("task") and e.get("target") == "main":
            land.setdefault(e["task"], e["t"])
    detours, real_red = [], 0
    for b in batches:
        if b["green"]:
            continue
        if not b.get("flaked"):
            real_red += 1
        for t in b.get("tasks") or []:
            if t in land:
                detours.append(max(0.0, land[t] - b["t"]))
    secs = [b.get("ci_seconds") or 60.0 for b in batches]
    return {"batches": len(batches), "real_reds": real_red, "t_batch": statistics.fmean(secs) if secs else 65.0,
            "detours": detours}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--v2", nargs="+", required=True)
    ap.add_argument("--queue", nargs="+", required=True)
    a = ap.parse_args()
    vs = [v2_inputs(r) for r in a.v2]
    qs = [queue_inputs(r) for r in a.queue]
    checks = statistics.fmean(v["checks"] for v in vs)
    real = statistics.fmean(v["real_reds"] for v in vs)
    t = statistics.fmean(v["t_check"] for v in vs)
    det = [d for v in vs for d in v["detours"]]
    green = checks - real
    print(f"v2 pre-land: {checks:.0f} checks ({green:.0f} really green), {real:.1f} real red checks per race, one check {t:.0f} s")
    if det:
        saved = statistics.fmean(det) - t
        print(f"  detour of a needless rework (red -> landing): {statistics.fmean(det):.0f} s over {len(det)} flaky reds; "
              f"a re-run replaces {t:.0f} s of it, so it saves {saved:.0f} s per flake")
        if saved > 0:
            print(f"  re-run every red pays above r* = {real * t / (green * saved):.1%} per run "
                  f"(at 5%: saves {0.05 * green * saved / 60:.1f} bean-min, costs {real * t / 60:.1f} bean-min); "
                  f"re-run of 5 s instead: r* = {real * 5 / (green * (statistics.fmean(det) - 5)):.1%}")
    else:
        print("  no unabsorbed flaky red in these races: pass an unmitigated race at a flake rate > 0")
    batches = statistics.fmean(x["batches"] for x in qs)
    real_q = statistics.fmean(x["real_reds"] for x in qs)
    tb = statistics.fmean(x["t_batch"] for x in qs)
    detq = [d for x in qs for d in x["detours"]]
    green_q = batches - real_q
    print(f"queue: {batches:.0f} batches ({green_q:.0f} really green), {real_q:.1f} real red batches per race, one batch {tb:.0f} s")
    if detq:
        mean = statistics.fmean(detq)
        print(f"  detour of a PR in a red batch (red result -> landing): {mean:.0f} s over {len(detq)} PRs; a retry costs "
              f"{tb:.0f} s on every red batch before anything behind it can resolve")
        print(f"  retry every red batch pays above r* = {real_q * tb / (green_q * mean):.1%} per run; with the PRs behind a red "
              f"batch held up as well, about {2 * real_q * tb / (green_q * mean):.1%}")


if __name__ == "__main__":
    main()
