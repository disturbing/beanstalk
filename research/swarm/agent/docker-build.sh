#!/bin/sh
# The docker binary Wrangler uses for beanstalk-swarm's deploy (WRANGLER_DOCKER_BIN). Wrangler
# pipes the Dockerfile on stdin (`docker build -f - <context>`), which hides the per-Dockerfile
# ignore file (agent/Dockerfile.dockerignore) that lets research/race/harness and the arena into
# the build context past the repo's .dockerignore. For `build`, this names the Dockerfile by path
# instead (same content); every other command passes through unchanged. DOCKER names the real binary.
set -eu
docker_bin="${DOCKER:-docker}"
if [ "${1:-}" != build ]; then
  exec "$docker_bin" "$@"
fi
here="$(cd "$(dirname "$0")" && pwd)"
shift
out=""
while [ $# -gt 0 ]; do
  if [ "$1" = "-f" ] && [ "${2:-}" = "-" ]; then
    out="$out -f $here/Dockerfile"
    shift 2
    continue
  fi
  out="$out $(printf '%s' "$1" | sed "s/'/'\\\\''/g; s/^/'/; s/\$/'/")"
  shift
done
cat > /dev/null # the Dockerfile Wrangler sent on stdin; the file on disk is the same one
eval "exec \"\$docker_bin\" build $out"
