#!/bin/bash
cd "$(dirname "$0")/.."
COMMON="--agent claude --model sonnet --agents 20 --budget-usd 75 --ci-seconds 60 --ci-slots 2 --protect-tests landed --max-wall-minutes 45 --seed 7"
run() { name=$1; shift; echo "$(date +%H:%M:%S) start $name"; "$@" --out runs/$name > runs/$name.log 2>&1; echo "$(date +%H:%M:%S) end $name exit $?"; }
export PRELAND_MODE=optimistic PRELAND_SECONDS=60 DECISION_SECONDS=30 DECISION_ORACLE=landed
run opus-v2fair-sonnet-20-s7 python3 race.py --policy beanstalk-v2 $COMMON --snapshot head --error-budget 999
run opus-queue-sonnet-20-s7  python3 race.py --policy queue        $COMMON --batch 4 --no-queue-hold
echo "$(date +%H:%M:%S) twenty done"
