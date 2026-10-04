#!/bin/bash
cd "$(dirname "$0")/.."
GW=https://beanstalk-gateway.devaccounts-1password.workers.dev
COMMON="--forge cloudflare --gateway $GW --agent claude --model sonnet --agents 12 --ci-seconds 60 --ci-slots 2 --seed 7 --budget-usd 75 --max-wall-minutes 50 --protect-tests landed"
echo "$(date +%H:%M:%S) start real v2.3"
../tools/race-slot.sh python3 race.py --policy beanstalk-v2 $COMMON --preland-mode optimistic --preland-seconds 60 --decision-seconds 30 --out runs/cf-v23-sonnet-12-s7 --force > runs/cf-v23-sonnet-12-s7.log 2>&1
echo "$(date +%H:%M:%S) end real v2.3 exit $?"
