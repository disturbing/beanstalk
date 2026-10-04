#!/bin/bash
# Run one race command and record the machine's uptime (load averages) when it actually starts and when it ends.
# Usage (inside the race slot): research/tools/race-slot.sh ./race_with_uptime.sh <run name> python3 race.py ...
# Writes runs/<run name>.uptime.txt; the harness also logs machine.load events every minute into events.jsonl.
cd "$(dirname "$0")"
name=$1; shift
mkdir -p runs
f="runs/$name.uptime.txt"
# E3_AUTHCHECK=1: a 1-turn Haiku call first (a few thousandths of a dollar). Exit 76 = not logged in / 403: the driver
# waits and re-queues; nothing is spent on a race that would only fail.
if [ -n "$E3_AUTHCHECK" ]; then python3 authcheck.py || exit $?; fi
{ echo "start $(date '+%F %T')"; uptime; echo "vm.loadavg $(sysctl -n vm.loadavg)"; } > "$f"
"$@"; rc=$?
{ echo "end $(date '+%F %T') exit $rc"; uptime; echo "vm.loadavg $(sysctl -n vm.loadavg)"; } >> "$f"
exit $rc
