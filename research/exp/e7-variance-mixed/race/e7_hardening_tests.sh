#!/bin/bash
# Free: harness-hardening tests (fake claude / fake codex CLIs, CI lock paths), inside ONE race-slot.sh slot.
cd "$(dirname "$0")"
echo "$(date +%H:%M:%S) hardening tests"; uptime
python3 -m unittest tests.test_race.CILockPaths tests.test_race.MixedFleet tests.test_race.CodexAndDryRun tests.test_race.ClaudeAdapterWithFakeCli > runs/hardening-unit2.log 2>&1
echo "$(date +%H:%M:%S) exit $?"; tail -6 runs/hardening-unit2.log; uptime
