#!/bin/bash
# Sequential Sonnet race matrix with --protect-tests landed (all landed acceptance tests protected).
cd "$(dirname "$0")/.."
while ps -p 89840 >/dev/null 2>&1; do sleep 15; done   # wait for the running beanstalk/own run
COMMON="--agent claude --model sonnet --agents 12 --budget-usd 75 --ci-seconds 60 --ci-slots 2 --seed 7 --protect-tests landed --max-wall-minutes 45"
for spec in "queue:--batch 4 --no-queue-hold" "beanstalk:--snapshot green --error-budget 3" "beanstalk-preland:--snapshot green --error-budget 3"; do
  pol=${spec%%:*}; extra=${spec#*:}
  name=opus-${pol}-sonnet-12-landed
  echo "$(date +%H:%M:%S) start $name"
  python3 race.py --policy $pol $COMMON $extra --out runs/$name > runs/$name.log 2>&1
  echo "$(date +%H:%M:%S) end $name exit $?"
done
echo "$(date +%H:%M:%S) matrix done"
