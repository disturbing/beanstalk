#!/bin/bash
# E3 validation, free (replay agents, fake CLIs), run as ONE race under the machine-wide race slot with at most 4
# node processes (1 suite at a time, 3 test files in parallel):
#   1. the E3 race tests and the harness's own policy tests on the fixture arena;
#   2. a pre-flight on the real arena: 10 tasks, 6 replay agents, a high flake rate, each policy variant once;
# This is a short hold of its own. On success it writes runs/e3-validated.ok; the probe and the real races are separate
# holds (one slot per race).
# Usage: research/tools/race-slot.sh ./validate.sh [unittest names...]   (names given: only step 1 with those)
cd "$(dirname "$0")"
export RACE_NODE_SUITES=1 RACE_NODE_CONCURRENCY=3
rm -f runs/e3-validated.ok runs/e3-validate-failed
trap 'rc=$?; [ $rc -ne 0 ] && date "+%F %T exit $rc" > runs/e3-validate-failed' EXIT
echo "uptime at start: $(uptime)"
steps=1
if [ $# -eq 0 ]; then
  steps=2
  set -- tests.test_flake.RacesV2 tests.test_flake.RacesQueue tests.test_flake.ZKthGreen \
         tests.test_race.QueuePolicy tests.test_race.BeanstalkPolicy tests.test_race.ZEvents
fi
python3 -m unittest -v "$@"
rc=$?
if [ $rc -ne 0 ] || [ $steps -eq 1 ]; then echo "uptime at end: $(uptime)"; exit $rc; fi

echo "=== pre-flight on the real arena (replay agents, 10 tasks, flake rate 0.2) ==="
COMMON="--agent replay --agents 6 --tasks 10 --ci-seconds 3 --ci-slots 2 --replay-median 4 --replay-sigma 0.4 --protect-tests landed --seed 7 --max-wall-minutes 20 --force"
export PRELAND_MODE=optimistic PRELAND_SECONDS=3 DECISION_SECONDS=1 FLAKE_RATE=0.2
for arm in v2plain v2mit queueretry; do
  case $arm in
    v2plain)    args="--policy beanstalk-v2 --snapshot head --error-budget 999"; extra="" ;;
    v2mit)      args="--policy beanstalk-v2 --snapshot head --error-budget 999"; extra="FLAKE_RERUN_PRELAND=1 FLAKE_RERUN_VALIDATE=1" ;;
    queueretry) args="--policy queue --batch 4 --no-queue-hold"; extra="FLAKE_RETRY_BATCH=1" ;;
  esac
  echo "--- $arm"
  env $extra python3 race.py $COMMON $args --out runs/e3-pre-$arm > runs/e3-pre-$arm.log 2>&1
  rc=$?
  echo "exit $rc"
  python3 flake_report.py runs/e3-pre-$arm 2>&1 | head -12
  # the real races only start if the pre-flight finished, was not aborted and ended on a correct stalk
  python3 - "$arm" "$rc" <<'PY' || { echo "PRE-FLIGHT $arm FAILED: not going on to the real races"; echo "uptime at end: $(uptime)"; exit 1; }
import json, sys
arm, rc = sys.argv[1], int(sys.argv[2])
s = json.load(open(f"runs/e3-pre-{arm}/summary.json"))
bad = [m for m, ok in {"exit status": rc == 0, "not aborted": not s.get("aborted"),
                       "final correct": (s.get("final") or {}).get("correct") is True,
                       "flake books built": "error" not in (s.get("flake") or {})}.items() if not ok]
print("pre-flight checks:", "all ok" if not bad else f"FAILED {bad}")
sys.exit(1 if bad else 0)
PY
done

# Success marker: the real races are launched by after_validation.sh only once this file exists. The real races are NOT
# part of this hold; each one takes its own slot (drive.py wraps every race in race-slot.sh separately).
date '+%F %T' > runs/e3-validated.ok
echo "validation passed; marker written. uptime at end: $(uptime)"
exit 0
