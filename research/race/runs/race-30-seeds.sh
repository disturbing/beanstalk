#!/usr/bin/env bash
# 30 agents, seeds 11 and 13: the batched merge queue, then Beanstalk (--preset demo), one race at a time.
cd "$(dirname "$0")/.."
GW=https://beanstalk-gateway.devaccounts-1password.workers.dev
COMMON="--forge cloudflare --gateway $GW --agent claude --model sonnet --agents 30 --ci-seconds 60 --ci-slots 2 --budget-usd 75 --max-usd 80 --max-wall-minutes 60 --protect-tests landed"
for SEED in 11 13; do
  ../tools/race-slot.sh python3 race.py $COMMON --seed $SEED --policy queue --batch 4 --no-queue-hold \
    --out runs/cf-queue-sonnet-30-s$SEED --force > runs/cf-queue-sonnet-30-s$SEED.log 2>&1
  echo "queue s$SEED done $? $(date +%H:%M)"
  ../tools/race-slot.sh python3 race.py $COMMON --seed $SEED --policy beanstalk-v2 --preset demo \
    --preland-mode optimistic --preland-seconds 60 --decision-seconds 30 \
    --out runs/cf-demo2-sonnet-30-s$SEED --force > runs/cf-demo2-sonnet-30-s$SEED.log 2>&1
  echo "beanstalk s$SEED done $? $(date +%H:%M)"
done
python3 kth_green.py runs/cf-queue-sonnet-30-s7 runs/cf-demo2-sonnet-30-s7 runs/cf-queue-sonnet-30-s11 runs/cf-demo2-sonnet-30-s11 runs/cf-queue-sonnet-30-s13 runs/cf-demo2-sonnet-30-s13 --k 35
