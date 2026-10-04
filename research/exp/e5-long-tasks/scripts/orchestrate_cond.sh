#!/bin/bash
# Same loop as orchestrate.sh for ONE condition, with its own state file, so that it can be queued next to another condition
# (one FIFO ticket per hold; tickets are served in order, so queueing two conditions never jumps the line).
#   scripts/orchestrate_cond.sh C
COND=$1
cd "$(dirname "$0")/.." || exit 1
export E5_STATE="$(pwd)/race/runs/e5-state-$COND.json"
cond_done() { python3 - "$1" <<'PY'
import sys
sys.path.insert(0, "scripts")
from hold import CONDITIONS, load_state, FINAL
st = load_state()
sys.exit(0 if all(st.get(n, {}).get("verdict") in FINAL for n, *_ in CONDITIONS[sys.argv[1]]) else 1)
PY
}
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
