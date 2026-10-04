#!/bin/bash
# Per-vendor / pair / first-attempt / per-task analysis of the Claude-only runs (seeds 7 and 11 baselines, seed 5
# and seed 3), nice'd and single-threaded so it can run beside timing-sensitive races.
cd "$(dirname "$0")"
R=/Users/coop/Workspace/beanstalk/research/race/runs
N=/Users/coop/Workspace/beanstalk/research/exp/e7-variance-mixed/race/runs
for run in $R/opus-queue-sonnet-12-landed $R/opus-queue-sonnet-12-s11 $R/opus-v2fair-sonnet-12-s7 $R/opus-v2fair-sonnet-12-s11 \
           $N/e7-queue-claude-12-s5-shuf $N/e7-v2-claude-12-s5-shuf; do
  name=$(basename $run)
  [ -f results/base-$name.json ] && grep -q '"tasks"' results/base-$name.json && { echo "$(date +%H:%M:%S) skip $name (done)"; continue; }
  nice -n 19 python3 e7_mixed.py $run --json results/base-$name.json --md results/base-$name.md > /dev/null 2>&1
  echo "$(date +%H:%M:%S) done $name"
done
