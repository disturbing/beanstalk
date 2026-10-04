#!/bin/bash
# Runs inside ONE race-slot.sh slot: pre-flight the agent CLIs, then exec the race.
# Usage: e7_race.sh <claude|mixed> <race.py arguments...>      exit 75 = pre-flight failed, no race started
cd "$(dirname "$0")"
fleet=$1; shift
python3 e7_preflight.py --fleet "$fleet" || { echo "[e7] pre-flight failed: an agent CLI is not usable right now; no race started" >&2; exit 75; }
exec python3 race.py "$@"
