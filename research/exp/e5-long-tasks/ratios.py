#!/usr/bin/env python3
"""v2's lead over the queue, per condition: time ratios (queue / v2; > 1 means v2 is faster) and cost ratios.

  python3 ratios.py "LABEL=QUEUE_RUN,V2_RUN" ... [--fracs 0.5 0.75 0.9] [--md out.md]

Per condition: minutes to the k-th verified green at fractions of the task count (k = ceil(frac x n)), minutes to done,
$ to the k-th green and total $, each queue/v2. "n/r" = not reached by that run. Same definitions as runstats.py.
"""
import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from runstats import analyse  # noqa: E402


def r(a, b):
    return "n/r" if a is None or b is None or b == 0 else f"{a / b:.2f}"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("conds", nargs="+")
    ap.add_argument("--fracs", nargs="+", type=float, default=[0.5, 0.75, 0.9])
    ap.add_argument("--md")
    a = ap.parse_args()
    head = ["condition", "tasks"] + [f"{int(f * 100)}% green min q / v2 = ratio" for f in a.fracs] + \
           ["done min q / v2 = ratio", "greens q / v2", "$ to " + f"{int(a.fracs[0] * 100)}% q / v2", "total $ q / v2 = ratio"]
    lines = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    for spec in a.conds:
        label, _, pair = spec.partition("=")
        qpath, vpath = pair.split(",")
        q, v = analyse("q", qpath, a.fracs), analyse("v", vpath, a.fracs)
        cells = [label, str(q["n_tasks"])]
        for f in a.fracs:
            kq, kv = q[f"k{f}"], v[f"k{f}"]
            cells.append(f"{kq['min'] if kq['min'] is not None else 'n/r'} / {kv['min'] if kv['min'] is not None else 'n/r'} = {r(kq['min'], kv['min'])}")
        cells.append(f"{q['done_min']} / {v['done_min']} = {r(q['done_min'], v['done_min'])}")
        cells.append(f"{q['greens']} / {v['greens']}")
        f0 = a.fracs[0]
        cells.append(f"{q[f'k{f0}']['usd']} / {v[f'k{f0}']['usd']}")
        cells.append(f"{q['cost_usd']} / {v['cost_usd']} = {r(q['cost_usd'], v['cost_usd'])}")
        lines.append("| " + " | ".join(cells) + " |")
    out = "\n".join(lines)
    print(out)
    if a.md:
        open(a.md, "w", encoding="utf-8").write(out + "\n")


if __name__ == "__main__":
    main()
