#!/bin/bash
# Free control: replay agents (reference patches, synthetic timings) on the compound arena, both policies, at 1/10
# time scale (CI 6 s, replay median 3 s), 8 agents. Checks that the compound tasks load, apply, merge and end in a
# correct final green under the harness, and that --drift-factor works.
# The two replay races run one after the other inside ONE machine-wide race slot (the caller wraps this script:
#   research/tools/race-slot.sh bash scripts/replay_check.sh ), so at most one race runs at a time.
cd "$(dirname "$0")/../race" || exit 1
ARENA="--arena ../arena-long --repo ../corpora/arena-long.git"
COMMON="--agent replay --agents 8 --ci-seconds 6 --ci-slots 2 --replay-median 3 --seed 7 --protect-tests landed --budget-usd 20 --max-wall-minutes 60 --force"
run() { name=$1; shift; echo "$(date +%H:%M:%S) start $name | $(uptime)"; "$@" --out runs/$name > runs/$name.log 2>&1; echo "$(date +%H:%M:%S) end $name exit $? | $(uptime)"; }
run e5-replay-queue-long python3 race.py --policy queue $COMMON $ARENA --batch 4 --no-queue-hold
export PRELAND_MODE=optimistic PRELAND_SECONDS=6 DECISION_SECONDS=3
run e5-replay-v2-long-drift3 python3 race.py --policy beanstalk-v2 $COMMON $ARENA --snapshot head --error-budget 999 --drift-factor 3
echo "$(date +%H:%M:%S) replay check done"
