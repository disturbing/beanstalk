#!/bin/bash
# After the diagnostic replay ends, stop driver 67704 before it queues the real diagnostic race (driver B has it).
cd "$(dirname "$0")/.."
until grep -q "end e2-replay-v2nr-8-s11" runs/e2-races.log; do sleep 1; done
kids=$(pgrep -P 67704 2>/dev/null)
sleep 3   # let it log the gate result
kids="$kids $(pgrep -P 67704 2>/dev/null)"
kill 67704 $kids 2>/dev/null
echo "$(date '+%F %T') switch2: stopped driver 67704 after the diagnostic replay; driver B runs the real race" >> runs/e2-races.log
