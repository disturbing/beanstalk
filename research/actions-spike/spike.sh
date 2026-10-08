#!/bin/sh
# run.py against the deployed spike Worker; the token stays in a 0600 file outside the repo.
export SPIKE_URL="${SPIKE_URL:-https://beanstalk-actions-spike.devaccounts-1password.workers.dev}"
export SPIKE_TOKEN_FILE="${SPIKE_TOKEN_FILE:?set SPIKE_TOKEN_FILE}"
exec python3 "$(dirname "$0")/run.py" "$@"
