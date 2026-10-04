#!/bin/bash
cd "$(dirname "$0")/.."
GW=https://beanstalk-gateway.devaccounts-1password.workers.dev
echo "$(date +%H:%M:%S) start cloud queue"
../tools/race-slot.sh python3 race.py --forge cloudflare --gateway $GW --policy queue --agent replay --agents 8 --ci-seconds 4.5 --ci-slots 2 --seed 7 --out runs/cf2-replay-queue-8-s7 > runs/cf2-replay-queue-8-s7.log 2>&1
echo "$(date +%H:%M:%S) end cloud queue $?"
../tools/race-slot.sh python3 race.py --forge cloudflare --gateway $GW --policy beanstalk-v2 --agent replay --agents 8 --ci-seconds 4.5 --ci-slots 2 --seed 7 --preland-mode optimistic --preland-seconds 4.5 --decision-seconds 1 --out runs/cf2-replay-v2-8-s7 > runs/cf2-replay-v2-8-s7.log 2>&1
echo "$(date +%H:%M:%S) end cloud v2 $?"
echo "parity done"
