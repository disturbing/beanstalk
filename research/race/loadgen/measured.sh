#!/usr/bin/env bash
# The measured set: both forges at once per (N, seed), one pair at a time (pairs share the org's Actions job cap).
#   GW=https://<gateway> DEV_VARS=<gateway .dev.vars> loadgen/measured.sh "4 8 16" "7 11 13"
set -uo pipefail
cd "$(dirname "$0")/.."
: "${GW:?gateway URL}" "${DEV_VARS:?gateway .dev.vars}"
NS=${1:-"4 8 16"}; SEEDS=${2:-"7 11 13"}
for SEED in $SEEDS; do
  for N in $NS; do
    OUT=runs/lg-fastify-$N-s$SEED${SUFFIX:-}
    if [ -f "$OUT-github/summary.json" ] && [ -f "$OUT-beanstalk/summary.json" ]; then continue; fi
    # never overlap another live run (another agent's orchestrated races share the gateway and the Actions cap)
    HOST=$(echo "$GW" | sed -E 's|https?://([^/]+).*|\1|; s|\.|\\.|g')
    while pgrep -f "$HOST|orchestrated" >/dev/null; do sleep 30; done
    echo "== $(date -u +%H:%M:%S) N=$N seed=$SEED"
    python3 -m loadgen.run --forge both --workers "$N" --seed "$SEED" --gateway "$GW" --dev-vars "$DEV_VARS" \
      --label "measured${GW_VERSION:+ gateway $GW_VERSION}" --out "$OUT"
    # stop when GitHub rate limits bit (recorded in the run); the caller decides
    if grep -q '"gh.rate_limited"' "$OUT-github/events.jsonl" 2>/dev/null; then
      echo "GitHub rate limits hit in $OUT-github; stopping"; exit 4
    fi
  done
done
