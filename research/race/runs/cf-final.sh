#!/bin/bash
cd "$(dirname "$0")/.."
GW=https://beanstalk-gateway.devaccounts-1password.workers.dev
COMMON="--forge cloudflare --gateway $GW --agent claude --model sonnet --agents 12 --ci-seconds 60 --ci-slots 2 --seed 7 --budget-usd 75 --max-wall-minutes 45"
echo "$(date +%H:%M:%S) start cloud v2 sonnet"
../tools/race-slot.sh python3 race.py --policy beanstalk-v2 $COMMON --preland-mode optimistic --preland-seconds 60 --decision-seconds 30 --out runs/cf-v2-sonnet-12-s7 > runs/cf-v2-sonnet-12-s7.log 2>&1
echo "$(date +%H:%M:%S) end cloud v2 $?"
../tools/race-slot.sh python3 race.py --policy queue $COMMON --batch 4 --no-queue-hold --out runs/cf-queue-sonnet-12-s7 > runs/cf-queue-sonnet-12-s7.log 2>&1
echo "$(date +%H:%M:%S) end cloud queue $?"
echo "final done"
