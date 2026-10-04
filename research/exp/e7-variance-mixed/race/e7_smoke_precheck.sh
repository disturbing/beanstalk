#!/bin/bash
# Runs inside ONE race-slot.sh slot: (1) free unit tests with fake claude/codex CLIs, (2) a real mixed smoke race.
cd "$(dirname "$0")"
echo "$(date +%H:%M:%S) slot held: unit tests"; uptime
python3 -m unittest tests.test_race.MixedFleet tests.test_race.CodexAndDryRun.test_race_with_fake_codex \
  tests.test_race.ClaudeAdapterWithFakeCli.test_race_with_fake_claude \
  tests.test_race.ClaudeAdapterWithFakeCli.test_failed_resume_falls_back_to_a_fresh_session \
  tests.test_race.ClaudeAdapterWithFakeCli.test_hard_rate_limit_stops_the_race > runs/precheck-unit.log 2>&1
echo "$(date +%H:%M:%S) unit tests exit $?"; tail -5 runs/precheck-unit.log
echo "$(date +%H:%M:%S) smoke: 4 cheap tasks on 4 agents (a0,a2 Claude; a1,a3 Codex); t001/t040 and t020/t027 collide textually"
uptime > runs/precheck-smoke.uptime
python3 race.py --policy queue --agent mixed --model sonnet --agents 4 --tasks t001 t020 t027 t040 \
  --ci-seconds 20 --ci-slots 2 --batch 2 --no-queue-hold --budget-usd 3 --max-wall-minutes 12 --protect-tests landed \
  --seed 7 --force --out /Users/coop/Workspace/beanstalk/research/exp/e7-variance-mixed/race/runs/e7-smoke-mixed-queue \
  > /Users/coop/Workspace/beanstalk/research/exp/e7-variance-mixed/race/runs/e7-smoke-mixed-queue.log 2>&1
echo "$(date +%H:%M:%S) smoke exit $?"; uptime | tee -a runs/precheck-smoke.uptime
