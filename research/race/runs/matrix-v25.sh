#!/bin/bash
# Phase-by-phase v2.5 races on one deployed engine; each phase is a set of driver env knobs.
cd "$(dirname "$0")/.."
GW=https://beanstalk-gateway.devaccounts-1password.workers.dev
# 1. free smoke test of the deployed v2.5 engine
python3 race.py --forge cloudflare --gateway $GW --policy beanstalk-v2 --agent replay --agents 8 --ci-seconds 4.5 --ci-slots 2 --seed 7 \
  --preland-mode optimistic --preland-seconds 4.5 --decision-seconds 1 --out runs/cf-replay-v25-8-s7 --force > runs/cf-replay-v25-8-s7.log 2>&1 \
  || { echo "smoke failed"; exit 1; }
grep -E "^\| (Tasks green|Final green correct|Variant)" runs/cf-replay-v25-8-s7/summary.md
COMMON="--forge cloudflare --gateway $GW --agent claude --model sonnet --agents 12 --ci-seconds 60 --ci-slots 2 --budget-usd 75 --max-wall-minutes 60 --protect-tests landed --policy beanstalk-v2 --preland-mode optimistic --preland-seconds 60 --decision-seconds 30"
declare -a NAMES=(v25a v25b v25c v25d v25dep)
declare -a ENVS=(
  "ESCALATE_AFTER=2 RECONCILE_PARTIES=1 STRUCTURAL_MERGE=0 START_CARDS=0 RESCUE=0 DYNAMIC_CULPRITS=0"
  "STRUCTURAL_MERGE=0 START_CARDS=0 RESCUE=0 DYNAMIC_CULPRITS=0"
  "START_CARDS=0 RESCUE=0 DYNAMIC_CULPRITS=0"
  ""
  "START_ORDER=dependency"
)
for SEED in 7 11 13; do
  for i in "${!NAMES[@]}"; do
    OUT=runs/cf-${NAMES[$i]}-sonnet-12-s$SEED
    env ${ENVS[$i]} ../tools/race-slot.sh python3 race.py $COMMON --seed $SEED --out $OUT --force > $OUT.log 2>&1 &
    sleep 45
  done
done
wait
echo "matrix done $(date +%H:%M)"
