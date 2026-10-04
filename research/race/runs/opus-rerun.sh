#!/bin/bash
cd "$(dirname "$0")/.."
COMMON="--agent claude --model sonnet --agents 12 --budget-usd 75 --ci-seconds 60 --ci-slots 2 --seed 7 --protect-tests landed --max-wall-minutes 45"
name=opus-beanstalk-preland-sonnet-12-landed-r2
echo "$(date +%H:%M:%S) start $name"
python3 race.py --policy beanstalk-preland $COMMON --snapshot green --error-budget 3 --out runs/$name > runs/$name.log 2>&1
echo "$(date +%H:%M:%S) end $name exit $?"
name=opus-beanstalk-v2-sonnet-12-landed-r2
echo "$(date +%H:%M:%S) start $name"
DECISION_SECONDS=30 DECISION_ORACLE=landed python3 race.py --policy beanstalk-v2 $COMMON --snapshot head --error-budget 999 --out runs/$name > runs/$name.log 2>&1
echo "$(date +%H:%M:%S) end $name exit $?"
echo "$(date +%H:%M:%S) rerun done"
