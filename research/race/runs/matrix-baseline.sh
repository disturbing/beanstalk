#!/bin/bash
# Baseline seeds for the phase-by-phase comparison: queue and v2.4 on seeds 11 and 13 (seed 7 exists).
cd "$(dirname "$0")/.."
GW=https://beanstalk-gateway.devaccounts-1password.workers.dev
COMMON="--forge cloudflare --gateway $GW --agent claude --model sonnet --agents 12 --ci-seconds 60 --ci-slots 2 --budget-usd 75 --max-wall-minutes 60 --protect-tests landed"
for SEED in 11 13; do
  ../tools/race-slot.sh python3 race.py --policy queue $COMMON --seed $SEED --batch 4 --no-queue-hold --out runs/cf-queue-sonnet-12-s$SEED > runs/cf-queue-sonnet-12-s$SEED.log 2>&1 &
  sleep 30
  ../tools/race-slot.sh python3 race.py --policy beanstalk-v2 $COMMON --seed $SEED --preland-mode optimistic --preland-seconds 60 --decision-seconds 30 --out runs/cf-v24-sonnet-12-s$SEED > runs/cf-v24-sonnet-12-s$SEED.log 2>&1 &
  sleep 30
done
wait
echo "baseline done $(date +%H:%M)"
