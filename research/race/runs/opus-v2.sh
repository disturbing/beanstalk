#!/bin/bash
cd "$(dirname "$0")/.."
while ps -p 19584 >/dev/null 2>&1; do sleep 15; done   # after the matrix
name=opus-beanstalk-v2-sonnet-12-landed
echo "$(date +%H:%M:%S) start $name"
DECISION_SECONDS=30 DECISION_ORACLE=landed python3 race.py --policy beanstalk-v2 --agent claude --model sonnet --agents 12 \
  --budget-usd 75 --ci-seconds 60 --ci-slots 2 --seed 7 --protect-tests landed --max-wall-minutes 45 \
  --snapshot head --error-budget 999 --out runs/$name > runs/$name.log 2>&1
echo "$(date +%H:%M:%S) end $name exit $?"
