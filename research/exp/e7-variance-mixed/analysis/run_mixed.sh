#!/bin/bash
# Part B analysis after the two mixed races finish (nice'd, single-threaded). Usage: ./run_mixed.sh
cd "$(dirname "$0")"
N=../race/runs
R=/Users/coop/Workspace/beanstalk/research/race/runs
Q=$N/e7-queue-mixed-12-s7
V=$N/e7-v2-mixed-12-s7
for run in $Q $V; do
  name=$(basename $run)
  [ -f $run/summary.json ] || { echo "skip $name: not finished"; continue; }
  nice -n 19 python3 e7_mixed.py $run --json results/mixed-$name.json --md results/mixed-$name.md > /dev/null 2>&1
  echo "$(date +%H:%M:%S) analysed $name"
done
POOL="results/base-opus-queue-sonnet-12-landed.json results/base-opus-queue-sonnet-12-s11.json results/base-e7-queue-claude-12-s5-shuf.json results/base-opus-v2fair-sonnet-12-s7.json results/base-opus-v2fair-sonnet-12-s11.json results/base-e7-v2-claude-12-s5-shuf.json"
[ -f results/mixed-e7-queue-mixed-12-s7.json ] && python3 e7_compare.py --mixed results/mixed-e7-queue-mixed-12-s7.json \
  --baseline results/base-opus-queue-sonnet-12-landed.json results/base-opus-queue-sonnet-12-s11.json --pool $POOL --md results/compare-queue.md > /dev/null
[ -f results/mixed-e7-v2-mixed-12-s7.json ] && python3 e7_compare.py --mixed results/mixed-e7-v2-mixed-12-s7.json \
  --baseline results/base-opus-v2fair-sonnet-12-s7.json results/base-opus-v2fair-sonnet-12-s11.json --pool $POOL --md results/compare-v2.md > /dev/null
python3 e7_mixed_policy.py --queue-mixed $Q --v2-mixed $V --queue-claude $R/opus-queue-sonnet-12-landed $R/opus-queue-sonnet-12-s11 \
  --v2-claude $R/opus-v2fair-sonnet-12-s7 $R/opus-v2fair-sonnet-12-s11 --md results/mixed-policy.md > /dev/null
python3 e7_ledger.py --md results/ledger.md > /dev/null
echo "$(date +%H:%M:%S) part B analysis done"
