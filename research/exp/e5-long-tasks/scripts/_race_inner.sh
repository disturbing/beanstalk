#!/bin/bash
# One real-agent race, no slot handling (the caller holds the machine-wide slot). Prints START/END with uptime.
#   scripts/_race_inner.sh NAME POLICY ARENA_SET DRIFT_FACTOR        POLICY = queue | v2 | v2r ; ARENA_SET = long | short
# Settings required by the brief: --protect-tests landed --ci-seconds 60 --ci-slots 2 --agent claude --model sonnet
# --max-wall-minutes 60 --budget-usd 20, 12 agents, seed 7; v2: PRELAND_MODE=optimistic PRELAND_SECONDS=60 --snapshot head
# --error-budget 999 (decision cards: oracle landed, 30 s = harness defaults); queue: --batch 4 --no-queue-hold.
NAME=$1; POLICY=$2; SET=$3; DRIFT=${4:-1}
cd "$(dirname "$0")/../race" || exit 1
case "$SET" in
  long)  ARENA="--arena ../arena-long --repo ../corpora/arena-long.git" ;;
  short) ARENA="--arena ../arena --repo ../corpora/arena.git" ;;
  *) echo "unknown arena set $SET"; exit 2 ;;
esac
COMMON="--agent claude --model sonnet --agents 12 --seed ${SEED:-7} --protect-tests landed --ci-seconds 60 --ci-slots 2 --max-wall-minutes 60 --budget-usd 20 --drift-factor $DRIFT --force"
UPLOG="$(pwd)/runs/e5-uptime.log"
echo "$(date +%H:%M:%S) START $NAME ($POLICY, $SET, drift x$DRIFT) | $(uptime)" | tee -a "$UPLOG"
if [ "$POLICY" = "queue" ]; then
  python3 race.py --policy queue $COMMON $ARENA --batch 4 --no-queue-hold --out runs/$NAME > runs/$NAME.log 2>&1
else
  # v2 (the brief's policy) or v2r (E5 extra: the same with the agent released while its change is checked)
  POL=beanstalk-v2; [ "$POLICY" = "v2r" ] && POL=beanstalk-v2r
  PRELAND_MODE=optimistic PRELAND_SECONDS=60 DECISION_SECONDS=30 DECISION_ORACLE=landed \
    python3 race.py --policy $POL $COMMON $ARENA --snapshot head --error-budget 999 --out runs/$NAME > runs/$NAME.log 2>&1
fi
rc=$?
echo "$(date +%H:%M:%S) END $NAME exit $rc | $(uptime)" | tee -a "$UPLOG"
exit $rc
