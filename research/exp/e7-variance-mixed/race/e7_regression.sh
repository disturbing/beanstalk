#!/bin/bash
# Free regression check of the promoted harness (inside ONE race-slot.sh slot): the full unit-test suite (replay,
# fake claude and fake codex agents), then a small --agent replay race per policy with --shuffle and --agents 6.
cd "$(dirname "$0")"
echo "$(date +%H:%M:%S) regression: unit tests"; uptime
python3 -m unittest discover -s tests > runs/e7-regression-unit.log 2>&1
echo "$(date +%H:%M:%S) unit tests exit $?"; tail -4 runs/e7-regression-unit.log
REPLAY="--agent replay --agents 6 --tasks 12 --shuffle --seed 3 --ci-seconds 3 --ci-slots 2 --replay-median 3 --protect-tests landed --max-wall-minutes 10 --force"
python3 race.py --policy queue --batch 4 --no-queue-hold $REPLAY --out runs/e7-replay-check-queue > runs/e7-replay-check-queue.log 2>&1
echo "$(date +%H:%M:%S) replay queue exit $?"
PRELAND_MODE=optimistic PRELAND_SECONDS=3 python3 race.py --policy beanstalk-v2 --snapshot head --error-budget 999 $REPLAY --out runs/e7-replay-check-v2 > runs/e7-replay-check-v2.log 2>&1
echo "$(date +%H:%M:%S) replay v2 exit $?"
for r in queue v2; do python3 - "$r" <<'PY'
import json, sys
s = json.load(open(f"runs/e7-replay-check-{sys.argv[1]}/summary.json"))
print(sys.argv[1], "aborted", s["aborted"], "greens", s["tasks_green"], "of", s["tasks"], "final correct", s["final"].get("correct"))
PY
done
uptime
