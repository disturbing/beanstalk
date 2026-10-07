#!/usr/bin/env bash
# Beanstalk-only A/B on fastify: the continuous engine's defaults (demo rules) against the same plus evidence
# promotion (read_maps=preland, evidence_promotion, affected_validation, audit_every=4, evidence_read_sets=complete),
# same schedule, seed and N, both at once on one gateway.
#   GW=https://<gateway> DEV_VARS=<gateway .dev.vars> loadgen/ab_evidence.sh <workers> <seed> [out prefix]
set -euo pipefail
cd "$(dirname "$0")/.."
N=${1:?workers}; SEED=${2:?seed}; PREFIX=${3:-runs/lg-ab-fastify-$N-s$SEED}
: "${GW:?gateway URL}" "${DEV_VARS:?gateway .dev.vars}"
python3 -m loadgen.run --forge beanstalk --workers "$N" --seed "$SEED" --gateway "$GW" --dev-vars "$DEV_VARS" \
  --label "ab demo" --out "$PREFIX-demo" > "$PREFIX-demo.log" 2>&1 &
A=$!
python3 -m loadgen.run --forge beanstalk --workers "$N" --seed "$SEED" --gateway "$GW" --dev-vars "$DEV_VARS" \
  --bs-evidence --label "ab evidence" --out "$PREFIX-evidence" > "$PREFIX-evidence.log" 2>&1 &
B=$!
wait $A; wait $B
python3 loadgen/report.py "$PREFIX-demo" "$PREFIX-evidence"
