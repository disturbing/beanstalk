#!/usr/bin/env python3
"""Gate before any paid race: the free replay control must have run clean on the compound arena.

Passes when, for every given run directory: the race ended (race.end present), no `error` events were logged,
the final check ran on a green suite and every green task's acceptance tests pass (final.correct), at least 3 tasks
reached green (not collapsed), and (for runs with --drift-factor > 1) invocation.drift events exist. Exit 0 = pass.
Replay agents only re-apply reference patches, so on the dense compound arena most compounds that collide are dropped
("limitation of replay agents"): the green count is a smoke signal, not a result.
"""
import json
import sys

ok = True
for run in sys.argv[1:]:
    try:
        ev = [json.loads(l) for l in open(f"{run}/events.jsonl") if l.strip()]
        s = json.load(open(f"{run}/summary.json"))
    except (OSError, ValueError) as e:
        print(f"FAIL {run}: {e}")
        ok = False
        continue
    errs = [e for e in ev if e["type"] == "error"]
    start = next((e for e in ev if e["type"] == "race.start"), {})
    drift = [e for e in ev if e["type"] == "invocation.drift"]
    final = s.get("final") or {}
    problems = []
    if not any(e["type"] == "race.end" for e in ev):
        problems.append("no race.end")
    if errs:
        problems.append(f"{len(errs)} error events: {errs[0].get('error')}")
    if not final.get("suite_green") or not final.get("correct"):
        problems.append(f"final check not correct: {final.get('suite_green')}/{final.get('correct')}")
    if s.get("tasks_green", 0) < 3:
        problems.append(f"only {s.get('tasks_green')}/{s.get('tasks')} green")
    if (start.get("drift_factor") or 1) > 1 and not drift:
        problems.append("drift requested but no invocation.drift events")
    print(("FAIL " if problems else "ok   ") + f"{run}: green {s.get('tasks_green')}/{s.get('tasks')}, dropped {s.get('tasks_dropped')}, "
          f"cost ${s.get('cost_usd')}, wall {s.get('wall_seconds')} s, drift events {len(drift)}, aborted={s.get('aborted')} "
          + "; ".join(problems))
    ok = ok and not problems
sys.exit(0 if ok else 1)
