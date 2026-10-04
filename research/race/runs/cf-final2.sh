#!/bin/bash
cd "$(dirname "$0")/.."
GW=https://beanstalk-gateway.devaccounts-1password.workers.dev
COMMON="--forge cloudflare --gateway $GW --agent claude --model sonnet --agents 12 --ci-seconds 60 --ci-slots 2 --seed 7 --budget-usd 75 --max-wall-minutes 50 --protect-tests landed"
../tools/race-slot.sh python3 race.py --policy queue $COMMON --batch 4 --no-queue-hold --out runs/cf-queue-sonnet-12-s7-landed > runs/cf-queue-sonnet-12-s7-landed.log 2>&1
echo "$(date +%H:%M:%S) end cloud queue landed $?"
../tools/race-slot.sh python3 race.py --policy beanstalk-v2 $COMMON --preland-mode optimistic --preland-seconds 60 --decision-seconds 30 --out runs/cf-v2-sonnet-12-s7-r2 > runs/cf-v2-sonnet-12-s7-r2.log 2>&1
echo "$(date +%H:%M:%S) end cloud v2 r2 $?"
echo "final2 done"
