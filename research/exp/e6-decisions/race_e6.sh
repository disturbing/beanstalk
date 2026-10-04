#!/bin/bash
# One E6 race (Sonnet, 12 agents, seed 7, 40 tasks), run inside the machine-wide race slot:
#   research/tools/race-slot.sh research/exp/e6-decisions/race_e6.sh keep|contract [run-name]
#     keep     DECISION_ORACLE=landed   (keep-landed-adapt)
#     contract DECISION_ORACLE=contract (the bean that changes the shared contract wins)
# Steps: the replay tests (skip with SKIP_TESTS=1), a 1-turn Haiku auth probe (exit 76 when logged out / 403), uptime,
# the race, uptime, then a scan of the events for authentication failures (exit 76 = contaminated: re-run it).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/race"
which="${1:?keep or contract}"
case "$which" in
  keep) oracle=landed ;;
  contract) oracle=contract ;;
  *) echo "unknown race $which" >&2; exit 2 ;;
esac
out="runs/${2:-e6-$which-sonnet-12-s7}"
export PRELAND_MODE=optimistic PRELAND_SECONDS=60 DECISION_SECONDS=30 DECISION_MODE=oracle DECISION_ORACLE=$oracle
export CARD_AFTER=1 CARD_AFTER_KNOWN=-1 COUPLING_PRIOR=arena SPEC_AMEND=1 RESCUE=1 ADOPT_MODE=revert DYNAMIC_CULPRITS=1
if [ "${SKIP_TESTS:-0}" != "1" ]; then
  echo "$(date +%H:%M:%S) unit and replay tests"
  if ! python3 -m unittest tests.test_decisions > "runs/_unittest-$which.log" 2>&1; then
    tail -30 "runs/_unittest-$which.log" >&2
    echo "tests failed; no race started" >&2
    exit 4
  fi
fi
if [ "${DEMO_CHECK:-1}" = "1" ]; then  # the DEMO.md rehearsal (replay, human mode, a click bot): free, ~2 min
  demo="runs/demo-human-replay-check"
  python3 tools/click_bot.py 8791 keep-landed adopt-arriving > "$demo.clicks.log" 2>&1 &
  bot=$!
  DECISION_MODE=human HUMAN_OPEN=0 HUMAN_PORT=8791 HUMAN_TIMEOUT=20 HUMAN_FALLBACK=table PRELAND_SECONDS=5 \
    python3 race.py --policy beanstalk-e6 --agent replay --agents 4 \
      --tasks t002 t005 t011 t018 t022 t023 t028 t031 t032 t036 --snapshot head --error-budget 999 \
      --protect-tests landed --ci-slots 2 --ci-seconds 5 --replay-median 8 --replay-sigma 0.3 --seed 7 \
      --max-wall-minutes 20 --out "$demo" --force > "$demo.log" 2>&1
  drc=$?
  kill $bot 2>/dev/null
  echo "$(date +%H:%M:%S) demo rehearsal exit $drc"
  if grep -q '"type": "error"' "$demo/events.jsonl"; then echo "demo rehearsal errored; no race started" >&2; exit 5; fi
fi
python3 tools/authcheck.py || exit $?
mkdir -p "$out"
echo "$(date +%H:%M:%S) start $out (oracle $oracle)"
uptime > "$out/uptime.txt"
python3 race.py --policy beanstalk-e6 --agent claude --model sonnet --agents 12 --seed 7 --snapshot head \
  --error-budget 999 --protect-tests landed --ci-seconds 60 --ci-slots 2 --max-wall-minutes 45 --budget-usd 20 \
  --out "$out" --force > "$out.log" 2>&1
rc=$?
uptime >> "$out/uptime.txt"
echo "$(date +%H:%M:%S) end $out exit $rc"
python3 tools/authcheck.py --scan "$out" || exit $?
exit $rc
