#!/bin/bash
# e2-real-arena races on the marked arena. Each race takes its own place in the machine-wide FIFO race slot
# (research/tools/race-slot.sh: one slot per race); races in one call run one after another, in order.
# Usage: ./run-e2.sh <policy:seed[:mode[:budget[:arena]]]> ...
#   policy  queue | v2 | v2nr (diagnostic: v2 without the file-overlap re-check)
#   mode    real (default: Sonnet, 12 agents, CI 60 s) | replay (free: 8 agents, 1/12 time scale)
#   budget  USD per real race (default 25)
#   arena   real (default: real-arena, common base) | chain (real-arena/chain, history order: E2b)
#   ./run-e2.sh queue:7 v2:7          -> runs/e2-queue-sonnet-12-s7, runs/e2-v2-sonnet-12-s7
# A failed replay (e2_gate.py) skips the real races after it in the same call.
# Each race records `uptime` when it starts and ends in runs/<name>.uptime.
# (Seed 7 ran with an earlier version that held one slot for the replays and the pair; same race commands.)
set -u
cd "$(dirname "$0")"
SLOT=/Users/coop/Workspace/beanstalk/research/tools/race-slot.sh
echo "$(date '+%F %T') queued $*" >> runs/e2-races.log
gate_failed=0
for spec in "$@"; do
  IFS=: read -r policy seed mode budget arena <<< "$spec"
  case "${arena:-real}" in
    real)  ARENA=../real-arena; prefix=e2 ;;
    chain) ARENA=../real-arena/chain; prefix=e2b ;;
    *) echo "bad arena $arena" >&2; continue ;;
  esac
  COMMON=(--arena "$ARENA" --repo ../real-arena.git --protect-tests landed --ci-slots 2 --seed "$seed")
  if [ "${mode:-real}" = replay ]; then
    name="$prefix-replay-$policy-8-s$seed"
    COMMON+=(--agent replay --agents 8 --ci-seconds 5 --replay-median 8 --max-wall-minutes 30)
    pre=5
  else
    if [ "$gate_failed" = 1 ]; then
      echo "$(date '+%F %T') skip $spec: a replay race in this call failed its gate" >> runs/e2-races.log; continue
    fi
    name="$prefix-$policy-sonnet-12-s$seed"
    read -r cap spent <<< "$(python3 e2_spent.py "${budget:-25}" 59)"   # total agent spend stays under $60
    if awk "BEGIN{exit !($cap < 3)}"; then
      echo "$(date '+%F %T') skip $spec: only \$$cap left under the \$60 total (spent \$$spent)" >> runs/e2-races.log; continue
    fi
    echo "$(date '+%F %T') $name budget \$$cap (spent so far \$$spent)" >> runs/e2-races.log
    COMMON+=(--agent claude --model sonnet --agents 12 --ci-seconds 60 --max-wall-minutes 45 --budget-usd "$cap")
    pre=60
  fi
  case "$policy" in
    queue)   ARGS=(--policy queue --batch 4 --no-queue-hold); recheck=file ;;
    v2)      ARGS=(--policy beanstalk-v2 --snapshot head --error-budget 999); recheck=file ;;
    v2nr)    ARGS=(--policy beanstalk-v2 --snapshot head --error-budget 999); recheck=never ;;
    *) echo "bad policy $policy" >&2; continue ;;
  esac
  PRELAND_MODE=optimistic PRELAND_SECONDS=$pre PRELAND_RECHECK=$recheck DECISION_SECONDS=30 DECISION_ORACLE=landed \
  "$SLOT" bash -c '
    name=$1; shift
    { echo "start $(date "+%F %T")"; uptime; } > "runs/$name.uptime"
    echo "$(date "+%F %T") start $name" >> runs/e2-races.log
    python3 race.py "$@" --out "runs/$name" > "runs/$name.log" 2>&1
    rc=$?
    { echo "end $(date "+%F %T") exit $rc"; uptime; } >> "runs/$name.uptime"
    echo "$(date "+%F %T") end $name exit $rc" >> runs/e2-races.log' _ "$name" "${ARGS[@]}" "${COMMON[@]}"
  if [ "${mode:-real}" = replay ]; then
    python3 e2_gate.py "runs/$name" >> runs/e2-races.log 2>&1 || {
      gate_failed=1; echo "$(date '+%F %T') gate FAILED on $name" >> runs/e2-races.log; }
  fi
done
