#!/usr/bin/env python3
"""E7 spend ledger: every real-agent run of this experiment, counted whether it was used or discarded.

Claude cost is the CLI's own total_cost_usd (list price; the plan window was exhausted, so every invocation ran on
extra usage). Codex cost is an estimate from tokens at the adapter's configured price (1.25 / 0.125 / 10 USD per
million fresh-input / cached-input / output tokens); the real list price of the default model is not known here and
Codex is billed to the ChatGPT plan, not in dollars.

Usage: python3 e7_ledger.py [--md out.md]
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys
from collections import defaultdict

RUNS = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "race", "runs"))
PREFLIGHT = re.compile(r"claude preflight cost \$([0-9.]+)")
EXTRA_PROBES = [("Codex tiny test in the scratchpad (no harness)", 0.0, 0.0), ("Codex arena task t008 test outside the harness", 0.0, 0.0),
                ("Claude AGENTS.md visibility probe", 0.0053, 0.0)]


def run_split(path: str) -> tuple[float, float, int, dict]:
    claude = codex = 0.0
    n = 0
    tok: dict = defaultdict(int)
    vend = {}
    try:
        with open(os.path.join(path, "events.jsonl"), encoding="utf-8") as fh:
            for line in fh:
                if not line.strip():
                    continue
                e = json.loads(line)
                if e["type"] == "invocation.start":
                    vend[e["inv"]] = e.get("adapter")
                elif e["type"] == "invocation.end":
                    n += 1
                    c = e.get("cost_usd") or 0.0
                    if vend.get(e["inv"]) == "codex":
                        codex += c
                        for k, v in (e.get("usage") or {}).items():
                            tok[k] += v or 0
                    else:
                        claude += c
    except OSError:
        pass
    return claude, codex, n, dict(tok)


def preflight_cost(path: str) -> float:
    total = 0.0
    for log in glob.glob(path + "*.log"):
        try:
            total += sum(float(x) for x in PREFLIGHT.findall(open(log, encoding="utf-8", errors="replace").read()))
        except OSError:
            pass
    return total


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--md")
    a = ap.parse_args()
    dirs = sorted(d for d in glob.glob(os.path.join(RUNS, "*")) if os.path.isdir(d) and re.match(
        r".*/(e7-(queue|v2|smoke)|aborted-e7-|flagged-highload-e7-)", d))
    rows, tc, tx, tp = [], 0.0, 0.0, 0.0
    for d in dirs:
        name = os.path.basename(d)
        claude, codex, n, tok = run_split(d)
        pf = preflight_cost(d)
        tc, tx, tp = tc + claude, tx + codex, tp + pf
        use = ("used" if re.match(r"e7-(queue|v2)", name) else "flagged first run of a re-run seed"
               if name.startswith("flagged") else "discarded (auth outage)" if "outage" in name else
               "pre-check smoke race" if "smoke" in name else "other")
        rows.append(f"| {name} | {use} | {n} | ${claude:.2f} | " + (f"${codex:.2f}" if codex else "") + f" | ${pf:.3f} |")
    extra = sum(c for _, c, _ in EXTRA_PROBES)
    head = ["| Run | Status | Invocations | Claude (reported) | Codex (estimated) | Pre-flight probes |", "|---|---|---|---|---|---|"]
    out = "\n".join(head + rows) + (f"\n| **Total** | | | **${tc:.2f}** | **${tx:.2f}** | **${tp:.3f}** |\n"
                                    f"\nOther probes outside runs: ${extra:.4f} (Claude AGENTS.md visibility probe).\n"
                                    f"Grand total counted against the $70 cap (Claude + Codex estimate + probes): "
                                    f"**${tc + tx + tp + extra:.2f}**; of that, Claude (real extra-usage dollars) "
                                    f"**${tc + tp + extra:.2f}**.\n")
    print(out)
    if a.md:
        with open(a.md, "w", encoding="utf-8") as fh:
            fh.write(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
