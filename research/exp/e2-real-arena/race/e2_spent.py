#!/usr/bin/env python3
"""Total agent spend (USD, list price as reported by the CLI) over every real e2/e2b race in runs/, and the cap a
new race may use: min(requested, LIMIT - spent). Usage: python3 e2_spent.py [requested] [limit=59]"""
import glob
import json
import os
import sys

spent = 0.0
for ev_path in glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)), "runs", "e2*-sonnet-*", "events.jsonl")):
    cost = 0.0
    for line in open(ev_path, encoding="utf-8"):
        if '"invocation.end"' in line:
            cost += json.loads(line).get("cost_usd") or 0.0
    spent += cost
# probes and smoke tests outside the races (auth checks; the one Haiku smoke test of run-tests, $0.0087)
probes = os.path.join(os.path.dirname(os.path.abspath(__file__)), "runs", "e2-probes.jsonl")
if os.path.exists(probes):
    for line in open(probes, encoding="utf-8"):
        if line.strip():
            spent += json.loads(line).get("cost_usd") or 0.0
req = float(sys.argv[1]) if len(sys.argv) > 1 else 25.0
limit = float(sys.argv[2]) if len(sys.argv) > 2 else 59.0
print(f"{min(req, max(limit - spent, 0.0)):.2f} {spent:.2f}")
