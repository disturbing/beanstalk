#!/bin/bash
# Run one race and record `uptime` when it actually starts and ends (runs/<name>.uptime): machine load
# distorts race timings, so every timing is reported next to the load it ran under. A one-turn Haiku auth
# probe (auth_probe.py) runs first; if the CLI is not authenticated the race does not start (exit 75).
# Usage (inside the slot limiter): race_with_uptime.sh <name> <race.py args...>
cd "$(dirname "$0")"
name=$1; shift
python3 auth_probe.py > "runs/$name.probe" 2>&1 || { cat "runs/$name.probe"; exit 75; }
echo "start $(date -u +%FT%TZ) $(uptime)" > "runs/$name.uptime"
python3 race.py "$@" --out "runs/$name" > "runs/$name.log" 2>&1
rc=$?
echo "end $(date -u +%FT%TZ) $(uptime)" >> "runs/$name.uptime"
exit $rc
