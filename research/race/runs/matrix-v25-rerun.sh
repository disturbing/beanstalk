#!/bin/bash
# Re-run the phase races lost to the network outage, full v2.5 first.
cd "$(dirname "$0")/.."
GW=https://beanstalk-gateway.devaccounts-1password.workers.dev
COMMON="--forge cloudflare --gateway $GW --agent claude --model sonnet --agents 12 --ci-seconds 60 --ci-slots 2 --budget-usd 75 --max-wall-minutes 60 --protect-tests landed --policy beanstalk-v2 --preland-mode optimistic --preland-seconds 60 --decision-seconds 30"
run() { # name seed env...
  local NAME=$1 SEED=$2; shift 2
  local OUT=runs/cf-$NAME-sonnet-12-s$SEED
  env "$@" ../tools/race-slot.sh python3 race.py $COMMON --seed $SEED --out $OUT --force > $OUT.log 2>&1 &
  sleep 45
}
run v25d 11 X=1
run v25d 13 X=1
run v25dep 7 START_ORDER=dependency
run v25dep 11 START_ORDER=dependency
run v25dep 13 START_ORDER=dependency
for S in 11 13; do
  run v25a $S ESCALATE_AFTER=2 RECONCILE_PARTIES=1 STRUCTURAL_MERGE=0 START_CARDS=0 RESCUE=0 DYNAMIC_CULPRITS=0
  run v25b $S STRUCTURAL_MERGE=0 START_CARDS=0 RESCUE=0 DYNAMIC_CULPRITS=0
  run v25c $S START_CARDS=0 RESCUE=0 DYNAMIC_CULPRITS=0
done
wait
echo "rerun done $(date +%H:%M)"
