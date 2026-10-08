#!/bin/sh
# The spike's runs, by name:  ./cases.sh <case> <instance> <log-name> [extra run.py args…]
# Needs SPIKE_TOKEN_FILE; the Beanstalk case also needs BEANSTALK_SECRETS (a 0600 env file
# holding BEANSTALK_READ_TOKEN, written by beanstalk_repo.py token).
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
case_name="$1"; instance="$2"; log="$here/out/$3.txt"; shift 3
mkdir -p "$here/out"
deps="$here/../real-arena/fastify/deps"
spike="$here/spike.sh"
spike_host="${SPIKE_URL:-https://beanstalk-actions-spike.devaccounts-1password.workers.dev}"
origin="https://github.com/spike/actions-spike.git"
race_files="--extra .github/race/package.json=$deps/package.json --extra .github/race/package-lock.json=$deps/package-lock.json"
case "$case_name" in
  deploy)
    "$spike" "$here/workflows/deploy-shape.yml" --instance "$instance" --origin "$origin" --log "$log" "$@" ;;
  fastify-github)
    # shellcheck disable=SC2086
    "$spike" "$here/workflows/node-ci-fastify.yml" --instance "$instance" --event-name pull_request \
      --origin "$origin" $race_files --log "$log" "$@" ;;
  fastify-beanstalk)
    # shellcheck disable=SC2086
    "$spike" "$here/workflows/node-ci-beanstalk.yml" --instance "$instance" --event-name pull_request \
      --origin "$origin" --secret-file "$BEANSTALK_SECRETS" $race_files \
      --event-json "{\"spike\":{\"repository\":\"beanstalk-actions-spike/beanstalk-actions-spike-fastify\",\"server\":\"$spike_host\",\"ref\":\"810e3d548eeceb32c948a0fbfdd90d6d1e6098ce\"}}" \
      --log "$log" "$@" ;;
  default-instance)
    # Defaults-only checkout; act points GITHUB_SERVER_URL at the spike's git host. Pass the
    # secrets file (GITHUB_TOKEN=<Beanstalk token>) and act flags after the log name.
    "$spike" "$here/workflows/node-ci-default.yml" --instance "$instance" --origin "$origin" \
      --arg=--github-instance --arg="${spike_host#https://}" --log "$log" "$@" ;;
  cache-artifacts)
    "$spike" "$here/workflows/cache-artifacts.yml" --instance "$instance" --origin "$origin" --log "$log" "$@" ;;
  runner-features)
    "$spike" "$here/workflows/runner-features.yml" --instance "$instance" --origin "$origin" --log "$log" "$@" ;;
  docker)
    "$spike" "$here/workflows/docker-features.yml" --instance "$instance" --origin "$origin" --log "$log" "$@" ;;
  *) echo "unknown case $case_name" >&2; exit 2 ;;
esac
