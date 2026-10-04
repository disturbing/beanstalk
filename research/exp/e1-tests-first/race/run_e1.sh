#!/bin/bash
# E1 real-agent races: v2 with Sonnet x 12 on the 40 arena tasks, seed 7 by default, through the machine-wide
# FIFO slot limiter (research/tools/race-slot.sh), one slot per race. Arm (a), tests given, is the existing
# research/race/runs/opus-v2fair-sonnet-12-s7 and is not re-run.
# Usage: run_e1.sh [seed] [arms...]   arms: self | first | firstmerged (first + E1_MERGED_CHECK=targeted)
# First the free fake-Claude gate (e1_fake_gate.sh, its own slot); then each arm's paid race in its own slot,
# stopping at the first failure. Each race runs auth_probe.py first and records `uptime` at its real start and
# end in runs/<name>.uptime.
cd "$(dirname "$0")"
SLOT=/Users/coop/Workspace/beanstalk/research/tools/race-slot.sh
SEED=${1:-7}; shift
ARMS=${*:-self first}
echo "$(date +%H:%M:%S) queue gate"
$SLOT ./e1_fake_gate.sh || { echo "$(date +%H:%M:%S) gate failed: no paid race started"; exit 1; }
export PRELAND_MODE=optimistic PRELAND_SECONDS=60 DECISION_SECONDS=30 DECISION_ORACLE=landed PROOF_SECONDS=10 AUTHOR_ATTEMPTS=2
for arm in $ARMS; do
  name=e1-$arm-sonnet-12-s$SEED
  tests=$arm; merged=""
  if [ "$arm" = firstmerged ]; then tests=first; merged=targeted; fi
  echo "$(date +%H:%M:%S) queue $name"
  E1_MERGED_CHECK=$merged MERGED_SECONDS=10 $SLOT ./race_with_uptime.sh "$name" --policy beanstalk-v2 --agent claude \
    --model sonnet --agents 12 --budget-usd 25 --ci-seconds 60 --ci-slots 2 --protect-tests landed --max-wall-minutes 45 \
    --snapshot head --error-budget 999 --seed "$SEED" --tests "$tests"
  rc=$?
  echo "$(date +%H:%M:%S) finished $name exit $rc"
  [ $rc -eq 0 ] || exit $rc
done
echo "$(date +%H:%M:%S) launcher done"
