#!/bin/bash
# Fair head-to-head: v2 with pre-land checks costing the same 60 s as queue CI, run in parallel per agent.
cd "$(dirname "$0")/.."
COMMON="--agent claude --model sonnet --agents 12 --budget-usd 75 --ci-seconds 60 --ci-slots 2 --protect-tests landed --max-wall-minutes 45"
run() { name=$1; shift; echo "$(date +%H:%M:%S) start $name"; "$@" --out runs/$name > runs/$name.log 2>&1; echo "$(date +%H:%M:%S) end $name exit $?"; }
export PRELAND_MODE=optimistic PRELAND_SECONDS=60 DECISION_SECONDS=30 DECISION_ORACLE=landed
run opus-v2fair-sonnet-12-s7  python3 race.py --policy beanstalk-v2 $COMMON --seed 7  --snapshot head --error-budget 999
run opus-queue-sonnet-12-s11  python3 race.py --policy queue        $COMMON --seed 11 --batch 4 --no-queue-hold
run opus-v2fair-sonnet-12-s11 python3 race.py --policy beanstalk-v2 $COMMON --seed 11 --snapshot head --error-budget 999
echo "$(date +%H:%M:%S) fair done"
