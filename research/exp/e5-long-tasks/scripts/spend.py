#!/usr/bin/env python3
"""Total agent spend of experiment E5 (budget: under $40 in all): probes, pre-flights and every real-agent run under
race/runs/e5-* (contaminated and re-run ones included).

  python3 scripts/spend.py                 print the breakdown
  python3 scripts/spend.py --need 9        exit 1 when total + 9 would reach the $39 line (a margin under the $40 cap)
  python3 scripts/spend.py --need auto     need = max(9, 1.5 x the dearest E5 race so far)
Costs are the CLI's own total_cost_usd at list price.
"""
import argparse
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CAP, MARGIN = 40.0, 1.0


def run_cost(path: str) -> float:
    s = os.path.join(path, "summary.json")
    if os.path.exists(s):
        try:
            return float(json.load(open(s)).get("cost_usd") or 0.0)
        except (OSError, ValueError):
            pass
    ev = os.path.join(path, "events.jsonl")
    total = 0.0
    if os.path.exists(ev):
        for line in open(ev):
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if e.get("type") == "invocation.end":
                total += float(e.get("cost_usd") or 0.0)
    return total


def ledger() -> tuple[list[tuple[str, float]], float, float]:
    rows = []
    probe = 0.0
    for f in glob.glob(os.path.join(ROOT, "data", "probe", "*.json")):
        if os.path.basename(f).startswith(("single", "pilot-compounds", "final-compounds")):
            probe += sum(float(r.get("cost_usd") or 0.0) for r in json.load(open(f)))
    rows.append(("probes (single-session timing)", probe))
    pre = 0.0
    p = os.path.join(ROOT, "data", "preflight.jsonl")
    if os.path.exists(p):
        for line in open(p):
            try:
                pre += float(json.loads(line).get("cost") or 0.0)
            except ValueError:
                pass
    rows.append(("pre-flight auth checks", pre))
    dearest = 0.0
    for d in sorted(glob.glob(os.path.join(ROOT, "race", "runs", "e5-*"))):
        if os.path.isdir(d) and "replay" not in d and "dry" not in d:
            c = run_cost(d)
            dearest = max(dearest, c)
            rows.append((os.path.basename(d), c))
    return rows, sum(c for _, c in rows), dearest


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--need", help="USD the next race may cost, or 'auto'")
    ap.add_argument("--md", action="store_true", help="print the ledger as a markdown table and exit")
    a = ap.parse_args()
    rows, total, dearest = ledger()
    if a.md:
        print("| What | Agent spend |\n|---|---|")
        for name, c in rows:
            print(f"| {name} | ${c:.2f} |")
        print(f"| **Total** (cap $40) | **${total:.2f}** |")
        sys.exit(0)
    for name, c in rows:
        print(f"  {name:45s} ${c:7.3f}")
    print(f"  {'TOTAL':45s} ${total:7.3f}   (cap ${CAP:.0f})")
    if a.need:
        # stop flag: `touch race/runs/e5-STOP` makes every hold finish the race it is running and start no further one
        # (used to honour the coordinator's slot-fairness request without killing a race)
        if os.path.exists(os.path.join(ROOT, "race", "runs", "e5-STOP")):
            print("stop flag race/runs/e5-STOP is set: no further races", file=sys.stderr)
            sys.exit(1)
        need = max(9.0, 1.5 * dearest) if a.need == "auto" else float(a.need)
        if total + need >= CAP - MARGIN:
            print(f"spend guard: ${total:.2f} + ${need:.2f} for the next race would reach ${CAP - MARGIN:.0f}", file=sys.stderr)
            sys.exit(1)
        print(f"  next race allowed: ${total:.2f} + ${need:.2f} < ${CAP - MARGIN:.0f}")
