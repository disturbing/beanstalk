#!/usr/bin/env python3
"""E3: expected damage of flakes per 40-task race, from the suite-run counts of a measured race (arithmetic, not a simulation).

Usage: python3 expected.py --v2 runs/<v2 race> [...] --queue runs/<queue race> [...] [--rates 0.01 0.02 0.05 0.1] [--md out.md]
(several races per policy: their counts are averaged)

Each policy faces a number of suite runs per race; a run that is really green flakes with probability r (independent per run; a
flake never changes a run that is really red, so only the green runs are exposed). From the counts in the given races (a flaked
run was green, so it stays in the exposed count):

  v2 plain         needless reworks = r * pre-land checks;  wrongful reverts = r * validations * p_revert, where
                   p_revert is the share of a race's validations whose flaky red would end in a revert rather than be
                   exonerated by a newer green validation first (exoneration.py, from the same race's timeline)
  v2 mitigated     both need two flakes in a row (r^2); a red costs one extra run (all real reds and all flakes)
  queue plain      needless ejections = r * (batch + bisect runs)
  queue + retry    needless ejections = r^2 * the same; a red batch costs one extra run (all real reds and all flakes)

The cost of one event is read from the races too (agent $ per rework, minutes per run), so the table is a transfer of
measured costs to other flake rates, nothing more.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from exoneration import analyse as exoneration  # noqa: E402
from flake_report import load, run_kind  # noqa: E402


def counts(run: str) -> dict:
    ev, s = load(run)
    runs: dict[str, int] = {}
    real: dict[str, int] = {}
    for e in ev:
        k = run_kind(e)
        if not k or e.get("rerun"):
            continue
        if e.get("flaked"):          # not a run the policy needed: it replaced a green run
            runs[k] = runs.get(k, 0) + 1
            continue
        runs[k] = runs.get(k, 0) + 1
        if e.get("green") is False:
            real[k] = real.get(k, 0) + 1
    rework_cost = [e.get("cost_usd") or 0.0 for e in ev if e["type"] == "invocation.end" and e.get("kind") == "rework"]
    return {"runs": runs, "real_reds": real, "rework_usd": statistics.fmean(rework_cost) if rework_cost else 0.08,
            "greens": s.get("tasks_green"), "tasks": s.get("tasks"),
            "p_revert": exoneration(run, 80.0)["p_revert_given_flaky_validation"]}


def mean_counts(runs: list[str]) -> dict:
    """Average the per-race counts of several races of one policy."""
    cs = [counts(r) for r in runs]
    out: dict = {"runs": {}, "real_reds": {}}
    for key in ("runs", "real_reds"):
        for k in sorted({k for c in cs for k in c[key]}):
            out[key][k] = statistics.fmean(c[key].get(k, 0) for c in cs)
    out["rework_usd"] = statistics.fmean(c["rework_usd"] for c in cs)
    out["p_revert"] = statistics.fmean(c["p_revert"] for c in cs)
    out["n"] = len(cs)
    return out


def pm(n: float, p: float) -> str:
    """Binomial mean and standard deviation of the number of events among n independent runs, each with probability p."""
    return f"{n * p:.2f} +- {math.sqrt(max(n * p * (1 - p), 0.0)):.1f}"


def table(v2: dict, q: dict, rates: list[float]) -> str:
    rr_pre = v2["real_reds"].get("preland", 0)
    rr_val = v2["real_reds"].get("validate", 0)
    rr_q = q["real_reds"].get("batch", 0)
    n_pre = v2["runs"].get("preland", 0) - rr_pre            # only runs that are really green can flake
    n_val = v2["runs"].get("validate", 0) - rr_val
    n_q = q["runs"].get("batch", 0) + q["runs"].get("bisect", 0) - rr_q - q["real_reds"].get("bisect", 0)
    p_rev = v2["p_revert"]
    rows = ["| flake rate r | policy | flaked runs per race | needless reworks / ejections (mean +- sd) | wrongful reverts (mean +- sd; P at least one) | extra agent $ | extra suite runs from the mitigation |",
            "|---|---|---|---|---|---|---|"]
    for r in rates:
        p_any = 1 - (1 - r * p_rev) ** n_val
        rows.append(f"| {r:.0%} | v2, no mitigation | {r * (n_pre + n_val):.1f} | {pm(n_pre, r)} | {pm(n_val, r * p_rev)} ({p_any:.0%}) | "
                    f"{r * n_pre * v2['rework_usd']:.2f} | 0 |")
        p_any2 = 1 - (1 - r * r * p_rev) ** n_val
        rows.append(f"| {r:.0%} | v2, re-run pre-land and validation | {r * (n_pre + n_val):.1f} | {pm(n_pre, r * r)} | "
                    f"{pm(n_val, r * r * p_rev)} ({p_any2:.1%}) | {r * r * n_pre * v2['rework_usd']:.3f} | "
                    f"{rr_pre + r * n_pre:.0f} pre-land + {rr_val + r * n_val:.0f} validation |")
        rows.append(f"| {r:.0%} | queue, no retry | {r * n_q:.1f} | {pm(n_q, r)} | n/a | {r * n_q * q['rework_usd']:.2f} | 0 |")
        rows.append(f"| {r:.0%} | queue + retry | {r * n_q:.1f} | {pm(n_q, r * r)} | n/a | {r * r * n_q * q['rework_usd']:.3f} | "
                    f"{rr_q + r * q['runs'].get('batch', 0):.0f} batch |")
    return "\n".join(rows)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--v2", required=True, nargs="+")
    ap.add_argument("--queue", required=True, nargs="+")
    ap.add_argument("--rates", nargs="+", type=float, default=[0.01, 0.02, 0.05, 0.10])
    ap.add_argument("--md")
    a = ap.parse_args()
    v2, q = mean_counts(a.v2), mean_counts(a.queue)
    print(f"v2 (mean of {v2['n']}): runs {v2['runs']}, real reds {v2['real_reds']}, rework ${v2['rework_usd']:.3f}, "
          f"p_revert {v2['p_revert']:.2f}")
    print(f"queue (mean of {q['n']}): runs {q['runs']}, real reds {q['real_reds']}, rework ${q['rework_usd']:.3f}")
    out = table(v2, q, a.rates)
    print(out)
    if a.md:
        with open(a.md, "w", encoding="utf-8") as fh:
            fh.write(out + "\n")


if __name__ == "__main__":
    main()
