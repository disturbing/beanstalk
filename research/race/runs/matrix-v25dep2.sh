#!/bin/bash
# v2.5 + dependency starts with the tail fix, three seeds.
cd "$(dirname "$0")/.."
GW=https://beanstalk-gateway.devaccounts-1password.workers.dev
COMMON="--forge cloudflare --gateway $GW --agent claude --model sonnet --agents 12 --ci-seconds 60 --ci-slots 2 --budget-usd 75 --max-wall-minutes 60 --protect-tests landed --policy beanstalk-v2 --preland-mode optimistic --preland-seconds 60 --decision-seconds 30"
for SEED in 7 11 13; do
  OUT=runs/cf-v25dep2-sonnet-12-s$SEED
  START_ORDER=dependency ../tools/race-slot.sh python3 race.py $COMMON --seed $SEED --out $OUT --force > $OUT.log 2>&1 &
  sleep 45
done
wait
echo "done $(date +%H:%M)"
