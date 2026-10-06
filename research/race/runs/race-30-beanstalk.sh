#!/bin/bash
# Wait for the 30-agent queue race, deploy the gateway with parking, then race Beanstalk with 30 agents.
cd "$(dirname "$0")/.."
while pgrep -f "cf-queue-sonnet-30-s7" >/dev/null; do sleep 30; done
echo "queue race finished $(date +%H:%M)"
(cd ../../packages/gateway && CLOUDFLARE_ACCOUNT_ID=${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID} npx wrangler deploy --secrets-file .dev.vars 2>&1 | grep -E "Version ID|ERROR" | grep -v -i token) || { echo "deploy failed"; exit 1; }
GW=https://beanstalk-gateway.devaccounts-1password.workers.dev
../tools/race-slot.sh python3 race.py --forge cloudflare --gateway $GW --agent claude --model sonnet --agents 30 --ci-seconds 60 --ci-slots 2 --seed 7 --budget-usd 75 --max-wall-minutes 60 --protect-tests landed --policy beanstalk-v2 --preset demo --preland-mode optimistic --preland-seconds 60 --decision-seconds 30 --out runs/cf-demo-sonnet-30-s7 --force > runs/cf-demo-sonnet-30-s7.log 2>&1
echo "beanstalk-30 done $? $(date +%H:%M)"
python3 kth_green.py runs/cf-queue-sonnet-30-s7 runs/cf-demo-sonnet-30-s7 2>&1 | tail -4
