#!/bin/bash
# After driver 1 (old shell driver, pid 44753) finishes the queue seed-11 race, stop it before it queues the diagnostic
# and the E2b races, and hand the diagnostic to the new Python driver (auth check + contamination scan).
cd "$(dirname "$0")/.."
until grep -q "end e2-queue-sonnet-12-s11" runs/e2-races.log; do sleep 1; done
kids=$(pgrep -P 44753 2>/dev/null)
kill 44753 $kids 2>/dev/null
sleep 2
pkill -f "e2-replay-v2nr-8-s11" 2>/dev/null
sleep 5
rm -rf runs/e2-replay-v2nr-8-s11 runs/e2-replay-v2nr-8-s11.log runs/e2-replay-v2nr-8-s11.uptime
echo "$(date '+%F %T') switch: stopped the shell driver after queue s11; the diagnostic goes to e2_drive.py" >> runs/e2-races.log
exec python3 e2_drive.py v2nr:11:replay v2nr:11:real:6
