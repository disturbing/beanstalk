#!/usr/bin/env python3
"""Exit 0 when a (replay) run finished without an abort or a harness error and its final green is correct."""
import json
import os
import sys

run = sys.argv[1]
s = json.load(open(os.path.join(run, "summary.json")))
errors = [json.loads(line) for line in open(os.path.join(run, "events.jsonl")) if '"type": "error"' in line]
final = s.get("final") or {}
greens, tasks = s.get("tasks_green") or 0, s.get("tasks") or 1
ok = (not s.get("aborted") and final.get("correct") is True and not errors and greens >= 0.8 * tasks
      and (final.get("suite_tests") or 0) >= 1699)
print(f"gate {run}: aborted={s.get('aborted')} correct={final.get('correct')} errors={len(errors)} "
      f"greens={s.get('tasks_green')}/{s.get('tasks')} -> {'ok' if ok else 'FAILED'}")
sys.exit(0 if ok else 1)
