#!/bin/bash
# E6 demo: click real decision cards in human mode during a small race (4 agents, the coupled tasks only).
#
#   research/exp/e6-decisions/demo.sh            # real Sonnet sessions (about $1-3, 10-20 minutes)
#   research/exp/e6-decisions/demo.sh replay     # free rehearsal: reference patches, short emulated CI
#
# A browser tab opens on http://127.0.0.1:8765/ (the card board) once the race holds the machine-wide race slot.
# Each card waits HUMAN_TIMEOUT seconds (default 600) for a click, then the table oracle answers.
# Override anything below from the environment, e.g. HUMAN_TIMEOUT=120 HUMAN_PORT=8800 demo.sh.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
AGENT="${1:-claude}"
cd "$HERE/race"

export DECISION_MODE=human
export HUMAN_OPEN="${HUMAN_OPEN:-1}" HUMAN_PORT="${HUMAN_PORT:-8765}"
export HUMAN_TIMEOUT="${HUMAN_TIMEOUT:-600}" HUMAN_FALLBACK="${HUMAN_FALLBACK:-table}"
export CARD_AFTER_KNOWN="${CARD_AFTER_KNOWN:--1}" CARD_AFTER="${CARD_AFTER:-1}"
export COUPLING_PRIOR=arena SPEC_AMEND=1 RESCUE=1 PRELAND_MODE=optimistic

TASKS="t002 t005 t011 t018 t022 t023 t028 t031 t032 t036"
OUT="runs/demo-human-$AGENT-$(date +%m%d-%H%M%S)"
ARGS=(--policy beanstalk-e6 --agent "$AGENT" --agents 4 --tasks $TASKS --snapshot head --error-budget 999
      --protect-tests landed --ci-slots 2 --max-wall-minutes 45 --budget-usd 5 --seed 7 --out "$OUT")
if [ "$AGENT" = "claude" ]; then
  export PRELAND_SECONDS="${PRELAND_SECONDS:-60}"
  ARGS+=(--model sonnet --ci-seconds 60)
else
  export PRELAND_SECONDS="${PRELAND_SECONDS:-5}"
  ARGS+=(--ci-seconds 5 --replay-median 8 --replay-sigma 0.3)
fi

echo "E6 demo ($AGENT): cards at http://127.0.0.1:$HUMAN_PORT/ once the race starts; run directory $OUT"
mkdir -p "$OUT"
# the race slot caps the races running on the machine; the run records the load next to its timings
# real agents: a 1-turn Haiku auth probe first (a few thousandths of a dollar); a logged-out CLI stops here (exit 76)
PROBE=true
[ "$AGENT" = "claude" ] && PROBE="python3 tools/authcheck.py"
../../../tools/race-slot.sh bash -c "$PROBE"' || exit $?; uptime > "$0/uptime.txt"; python3 race.py "$@"; rc=$?; uptime >> "$0/uptime.txt"; exit $rc' \
  "$OUT" "${ARGS[@]}" --force
echo
echo "Decisions: $OUT/decisions.jsonl   Summary: $OUT/summary.md"
echo "Tables:    (cd $HERE/race && python3 analyze_e6.py $OUT)"
