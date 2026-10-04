#!/bin/bash
# Free smoke test of the v2r policy with replay agents (reference patches, synthetic timings), inside the same slot hold as
# the real v2r race: 6 agents on the 40 single tasks at 1/10 time scale (CI / pre-land check 6 s, replay median 2 s, drift x3).
# Passes when the race ended without errors on a correct final green, with at least 3 greens, drift events, and at least one
# rework that waited for an agent (agent.acquired), i.e. the release / re-acquire path ran.
cd "$(dirname "$0")/../race" || exit 1
NAME=e5-replay-v2r-short
PRELAND_MODE=optimistic PRELAND_SECONDS=6 DECISION_SECONDS=3 DECISION_ORACLE=landed \
python3 race.py --policy beanstalk-v2r --agent replay --agents 6 --ci-seconds 6 --ci-slots 2 --replay-median 2 --seed 7 \
  --protect-tests landed --budget-usd 20 --max-wall-minutes 20 --force --drift-factor 3 \
  --arena ../arena --repo ../corpora/arena.git --snapshot head --error-budget 999 --out runs/$NAME > runs/$NAME.log 2>&1
cd .. || exit 1
python3 scripts/check_replay.py race/runs/$NAME || exit 1
python3 - "$NAME" <<'PY'
import json, sys
ev = [json.loads(l) for l in open(f"race/runs/{sys.argv[1]}/events.jsonl")]
n = sum(1 for e in ev if e["type"] == "agent.acquired")
w = [e["waited_seconds"] for e in ev if e["type"] == "agent.acquired"]
print(f"agent.acquired events: {n}, waited max {max(w) if w else 0} s")
sys.exit(0 if n > 0 else 1)
PY
