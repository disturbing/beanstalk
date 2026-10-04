#!/usr/bin/env python3
"""One-line progress of a running race: minutes, greens, landed, running tasks, spend, conflicts, reds, reworks."""
import collections
import json
import sys

run = sys.argv[1]
ev = [json.loads(line) for line in open(f"{run}/events.jsonl") if line.strip()]
c = collections.Counter(e["type"] for e in ev)
greens = set()
for e in ev:
    if e["type"] == "green.promote":
        greens |= set(e.get("tasks") or [])
spent = max((e.get("spent_usd") or 0) for e in ev) if ev else 0
t0 = next((e["t"] for e in ev if e["type"] == "race.start"), 0)
reds = sum(1 for e in ev if e["type"] == "ci.end" and e.get("green") is False and e.get("purpose") in ("batch", "validate"))
pre_red = sum(1 for e in ev if e["type"] == "preland.check" and not e.get("green"))
print(f"{run}: {(ev[-1]['t'] - t0) / 60:.1f} min, greens {len(greens)}, starts {c['task.start']}, "
      f"inv {c['invocation.start']}/{c['invocation.end']}, ${spent:.2f}, conflicts {c['merge.conflict']}, "
      f"red CI {reds}, red pre-land {pre_red}, reworks {c['rework.start']}, drops {c['task.drop']}, "
      f"errors {c['error']}, abort {[e.get('reason') for e in ev if e['type'] == 'abort']}")
