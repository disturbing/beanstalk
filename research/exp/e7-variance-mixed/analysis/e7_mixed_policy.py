#!/usr/bin/env python3
"""E7 part B: queue vs v2 under the mixed fleet, beside the Claude-only runs of the same seed and task order.

Usage: python3 e7_mixed_policy.py --queue-mixed RUN --v2-mixed RUN [--queue-claude RUN ...] [--v2-claude RUN ...]
Prints one markdown table: time to the 20th/30th/35th green and to done, greens, drops, red validations, textual
conflicts, rework invocations, and cost split into Claude (reported by the CLI) and Codex (estimated from tokens at
the adapter's configured price), plus the load covariates (start/end uptime, suite seconds) of every run.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import e7_stats as st  # noqa: E402


def vendor_costs(path: str) -> dict:
    ev = [json.loads(line) for line in open(os.path.join(path, "events.jsonl"), encoding="utf-8") if line.strip()]
    vend = {e["inv"]: e.get("adapter") for e in ev if e["type"] == "invocation.start"}
    cost, n, tok = defaultdict(float), defaultdict(int), defaultdict(lambda: defaultdict(int))
    for e in ev:
        if e["type"] == "invocation.end":
            v = vend.get(e["inv"]) or "claude"
            cost[v] += e.get("cost_usd") or 0.0
            n[v] += 1
            for k, x in (e.get("usage") or {}).items():
                tok[v][k] += x or 0
    return {"cost": dict(cost), "n": dict(n), "tokens": {v: dict(t) for v, t in tok.items()}}


def row(label: str, path: str) -> list[str]:
    m = st.run_metrics(path)
    if not m:
        return [label, "not run"] + [""] * 12
    vc = vendor_costs(path)
    cl, cx = vc["cost"].get("claude", 0.0), vc["cost"].get("codex", 0.0)
    u = m["uptime"] or {}
    load = "n/a" if not u else f"{(u.get('start_uptime') or '').split('load averages: ')[-1]} -> " \
                               f"{(u.get('end_uptime') or '').split('load averages: ')[-1]}"
    f = st.fmt
    return [label, f(m["t20"]), f(m["t30"]), f(m["t35"]), f(m["done"]), str(m["greens"]), str(m["dropped"]),
            str(m["red"]), str(m["conflicts"]), str(m["rework"]),
            f"${cl:.2f}" + (f" + ${cx:.2f}" if cx else ""), f"${cl + cx:.2f}", str(m["correct"]),
            f"{f(m['suite_seconds_median'])} s; {load}" + (f" ({m['flag']})" if m["flag"] else "")]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--queue-mixed")
    ap.add_argument("--v2-mixed")
    ap.add_argument("--queue-claude", nargs="*", default=[])
    ap.add_argument("--v2-claude", nargs="*", default=[])
    ap.add_argument("--md")
    a = ap.parse_args()
    head = ["Run", "20th green", "30th green", "35th green", "Done (min)", "Greens", "Dropped", "Red validations",
            "Textual conflicts", "Rework invocations", "Cost: Claude + Codex (est.)", "Cost total", "Final green correct",
            "Suite median; load average at start -> end"]
    rows = []
    for pol, mixed, claude in (("queue", a.queue_mixed, a.queue_claude), ("v2", a.v2_mixed, a.v2_claude)):
        if mixed:
            rows.append(row(f"{pol}, mixed fleet, seed 7 ({os.path.basename(mixed.rstrip('/'))})", mixed))
        for c in claude:
            rows.append(row(f"{pol}, Claude only ({os.path.basename(c.rstrip('/'))})", c))
    md = "| " + " | ".join(head) + " |\n|" + "---|" * len(head) + "\n" + "\n".join("| " + " | ".join(r) + " |" for r in rows)
    print(md)
    if a.md:
        with open(a.md, "w", encoding="utf-8") as fh:
            fh.write(md + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
