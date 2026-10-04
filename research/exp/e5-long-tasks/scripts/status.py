#!/usr/bin/env python3
"""Live status of a running (or finished) race from events.jsonl: python3 scripts/status.py RUN_DIR"""
import collections
import json
import sys

ev = [json.loads(l) for l in open(sys.argv[1] + "/events.jsonl") if l.strip()]
c = collections.Counter(e["type"] for e in ev)
t = ev[-1]["t"]
last_cost = max((e.get("spent_usd", 0) for e in ev if e["type"] == "invocation.end"), default=0)
greens = sum(len(e.get("tasks") or []) for e in ev if e["type"] == "green.promote") + sum(1 for e in ev if e["type"] == "land" and e.get("target") == "main")
drops = [(e["task"], e["reason"][:50]) for e in ev if e["type"] == "task.drop"]
print(f"t={t / 60:.1f} min  spent ${last_cost:.2f}  starts {c['task.start']}  invocations {c['invocation.end']}  landings {c['land']}  greens {greens}  "
      f"conflicts {c['merge.conflict']}  reworks {c['rework.start']}  preland checks {c['preland.check']}  rechecks {c['preland.recheck']}  "
      f"optimistic {c['preland.optimistic']}  cards {c['decision.request']}  validations {c['ci.end']}  drops {len(drops)}")
for d in drops:
    print("   dropped", d)
end = [e for e in ev if e["type"] in ("race.end", "final.check")]
if end:
    print("   ", end[-1]["type"], {k: v for k, v in end[-1].items() if k in ("aborted", "suite_green", "correct", "tasks_accepted")})
