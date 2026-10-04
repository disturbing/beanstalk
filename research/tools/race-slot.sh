#!/bin/bash
# Run a command when one of RACE_SLOTS (default 2) machine-wide race slots is free, first come first served.
# Usage: research/tools/race-slot.sh python3 race.py ...   (keeps real-agent races from piling up)
# Each waiter takes a ticket (nanosecond timestamp + pid); only the oldest live ticket may take a free slot,
# so chained jobs that re-queue go to the back instead of re-acquiring at once. Hold one slot per race.
SLOTS=${RACE_SLOTS:-2}
DIR=/private/tmp/claude-501/-Users-coop-Workspace/469e6f7b-45e3-4919-bc23-03d7694a485c/scratchpad/race-slots
Q="$DIR/queue"
mkdir -p "$DIR" "$Q"
ticket="$Q/$(python3 -c 'import time; print(time.time_ns())')-$$"
touch "$ticket"
trap 'rm -f "$ticket"' EXIT
trap 'rm -f "$ticket"; exit 143' INT TERM
announced=0
while true; do
  for t in "$Q"/*; do
    [ -e "$t" ] || continue
    kill -0 "${t##*-}" 2>/dev/null || rm -f "$t"
  done
  for i in $(seq 1 "$SLOTS"); do
    if [ -f "$DIR/slot$i/pid" ] && ! kill -0 "$(cat "$DIR/slot$i/pid")" 2>/dev/null; then rm -rf "$DIR/slot$i"; fi
  done
  first=$(ls "$Q" | sort | head -n 1)
  if [ "$Q/$first" = "$ticket" ]; then
    for i in $(seq 1 "$SLOTS"); do
      if mkdir "$DIR/slot$i" 2>/dev/null; then
        echo $$ > "$DIR/slot$i/pid"
        rm -f "$ticket"
        trap 'rm -rf "$DIR/slot$i"' EXIT
        trap 'rm -rf "$DIR/slot$i"; exit 143' INT TERM
        echo "[race-slot] slot $i acquired $(date +%H:%M:%S): $*" >&2
        "$@"; rc=$?
        rm -rf "$DIR/slot$i"; trap - EXIT INT TERM
        exit $rc
      fi
    done
  elif [ "$announced" = 0 ]; then
    echo "[race-slot] queued $(date +%H:%M:%S) behind $(ls "$Q" | sort | grep -n "$(basename "$ticket")" | cut -d: -f1 | awk '{print $1-1}') waiter(s)" >&2
    announced=1
  fi
  sleep 5
done
