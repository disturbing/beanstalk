#!/bin/bash
# Start the real E3 races once validate.sh has passed. Each race takes its own race slot (drive.py wraps every race in
# race-slot.sh separately and re-queues for the next one), so this process holds nothing while it waits.
# Usage: ./after_validation.sh probe r05-v2-plain r05-v2-mitigated r05-queue-retry
cd "$(dirname "$0")"
while [ ! -f runs/e3-validated.ok ]; do
  if [ -f runs/e3-validate-failed ]; then echo "validation failed: $(cat runs/e3-validate-failed); not starting the races"; exit 1; fi
  sleep 15
done
echo "validation passed at $(cat runs/e3-validated.ok); starting: $*"
exec python3 drive.py "$@"
