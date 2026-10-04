#!/bin/bash
# SUPERSEDED by race_e6.sh (same race settings, plus an auth probe, a post-race auth scan and the demo rehearsal gate).
# Kept because it produced runs/e6-contract-sonnet-12-s7 and the excluded run 1 (now *-run1-contaminated).
# E6 races (Sonnet, 12 agents, seed 7, 40 tasks): v2 + decision outcomes under two oracles.
#   keep : DECISION_ORACLE=landed   (keep-landed-adapt: the arriving bean is re-executed under the landed spec)
#   contract : DECISION_ORACLE=contract (the bean that changes the shared contract wins)
# Run through the machine-wide race slot:  research/tools/race-slot.sh research/exp/e6-decisions/run_races.sh [keep] [contract]
# Each race records `uptime` at its start and end in <run>/uptime.txt. Stops after a race that errored (exit 3).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/race"
export PRELAND_MODE=optimistic PRELAND_SECONDS=60 DECISION_SECONDS=30 DECISION_MODE=oracle
export CARD_AFTER=1 CARD_AFTER_KNOWN=-1 COUPLING_PRIOR=arena SPEC_AMEND=1 RESCUE=1 ADOPT_MODE=revert
if [ "${SKIP_TESTS:-0}" != "1" ]; then  # the replay tests first: no agent money is spent on a broken harness
  echo "$(date +%H:%M:%S) unit and replay tests"
  if ! python3 -m unittest tests.test_decisions > runs/_unittest-e6-prerace.log 2>&1; then
    tail -30 runs/_unittest-e6-prerace.log >&2
    echo "tests failed; no races started" >&2
    exit 4
  fi
fi
COMMON=(--policy beanstalk-e6 --agent claude --model sonnet --agents 12 --seed 7 --snapshot head --error-budget 999
        --protect-tests landed --ci-seconds 60 --ci-slots 2 --max-wall-minutes 45 --budget-usd 20)
for which in "${@:-keep contract}"; do
  for w in $which; do
    case "$w" in
      keep) oracle=landed ;;
      contract) oracle=contract ;;
      *) echo "unknown race $w" >&2; exit 2 ;;
    esac
    out="runs/e6-$w-sonnet-12-s7"
    mkdir -p "$out"
    echo "$(date +%H:%M:%S) start $out (oracle $oracle)"
    uptime > "$out/uptime.txt"
    DECISION_ORACLE=$oracle python3 race.py "${COMMON[@]}" --out "$out" --force > "$out.log" 2>&1
    rc=$?
    uptime >> "$out/uptime.txt"
    echo "$(date +%H:%M:%S) end $out exit $rc"
    if grep -q '"type": "error"' "$out/events.jsonl" 2>/dev/null || grep -q "rate limited" "$out/events.jsonl" 2>/dev/null; then
      echo "race errored or was rate limited; not starting the next one" >&2
      exit 3
    fi
  done
done

# Free rehearsal of DEMO.md (human mode, replay agents) with a click bot standing in for Coop: it clicks the first
# card "keep landed" and the second "adopt arriving"; later cards fall back to the table oracle after 20 s.
# (demo.sh itself takes the race slot, so it cannot run inside this one.)
if [ "${DEMO_REPLAY:-1}" = "1" ]; then
  out="runs/demo-human-replay-check"
  port=8791
  echo "$(date +%H:%M:%S) start $out"
  python3 tools/click_bot.py $port keep-landed adopt-arriving > "$out.clicks.log" 2>&1 &
  bot=$!
  DECISION_MODE=human HUMAN_OPEN=0 HUMAN_PORT=$port HUMAN_TIMEOUT=20 HUMAN_FALLBACK=table PRELAND_SECONDS=5 \
    python3 race.py --policy beanstalk-e6 --agent replay --agents 4 \
      --tasks t002 t005 t011 t018 t022 t023 t028 t031 t032 t036 --snapshot head --error-budget 999 \
      --protect-tests landed --ci-slots 2 --ci-seconds 5 --replay-median 8 --replay-sigma 0.3 --seed 7 \
      --max-wall-minutes 20 --out "$out" --force > "$out.log" 2>&1
  echo "$(date +%H:%M:%S) end $out exit $?"
  kill $bot 2>/dev/null
fi
