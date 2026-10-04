#!/bin/bash
# Outer loop for the paid E5 races. Each condition is one pair of races (v2 and queue, back to back) in ONE machine-wide slot
# (research/tools/race-slot.sh, first come first served; a pair is under the coordinator's 90-minute hold limit).
# Condition A: the 16 compound tasks (no emulated drift). Condition B (supplement c): the 40 single tasks, every agent
# invocation held to 7 x its real wall time. B is queued only after A is final, so my waiters never hog both slots.
# Re-queues after an auth outage / far-off rate limit / used-up hold time; stops on a spend-guard or unexpected failure.
cd "$(dirname "$0")/.." || exit 1
cond_done() { python3 - "$1" <<'PY'
import json, sys
sys.path.insert(0, "scripts")
from hold import CONDITIONS, load_state, FINAL
st = load_state()
sys.exit(0 if all(st.get(n, {}).get("verdict") in FINAL for n, *_ in CONDITIONS[sys.argv[1]]) else 1)
PY
}
python3 scripts/check_replay.py race/runs/e5-replay-queue-long race/runs/e5-replay-v2-long-drift3 || { echo "replay gate FAILED"; exit 1; }
for COND in A B; do
  tries=0
  until cond_done $COND; do
    tries=$((tries+1)); [ $tries -gt 12 ] && { echo "condition $COND: too many holds"; exit 1; }
    echo "$(date +%H:%M:%S) queued condition $COND (hold $tries) | $(uptime)"
    ../../tools/race-slot.sh python3 scripts/hold.py $COND; rc=$?
    echo "$(date +%H:%M:%S) hold $COND exit $rc"
    case $rc in
      0|78) ;;
      75|76) sleep 300 ;;
      *) echo "condition $COND stopped: exit $rc"; exit $rc ;;
    esac
  done
  echo "$(date +%H:%M:%S) condition $COND final"
done
echo "$(date +%H:%M:%S) all conditions final"
