#!/bin/bash
cd "$(dirname "$0")/.."
GW=https://beanstalk-gateway.devaccounts-1password.workers.dev
../tools/race-slot.sh python3 race.py --forge cloudflare --gateway $GW --agent claude --model sonnet --agents 30 --ci-seconds 60 --ci-slots 2 --seed 7 --budget-usd 75 --max-wall-minutes 60 --protect-tests landed --policy queue --batch 4 --no-queue-hold --out runs/cf-queue-sonnet-30-s7 --force > runs/cf-queue-sonnet-30-s7.log 2>&1
echo "queue-30 done $? $(date +%H:%M)"
