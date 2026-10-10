#!/bin/sh
# Runs setup-tests.sh in Linux containers (and the PowerShell tests in a pwsh container)
# against one fake Gitstalk on this machine. Needs docker and node here; the containers get
# only git, OpenSSH and curl. Nothing of this machine's git, keys or agents is mounted.
#
#   sh run-containers.sh [image …]     default: debian, ubuntu, alpine, pwsh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$(mktemp -d /tmp/bsc.XXXXXX)
trap 'kill "$SERVER" 2>/dev/null; rm -rf "$WORK"' EXIT INT TERM

export GIT_CONFIG_GLOBAL="$WORK/gitconfig" GIT_CONFIG_NOSYSTEM=1
: >"$GIT_CONFIG_GLOBAL"
mkdir -p "$WORK/repos/smoke"
git init -q --bare -b main "$WORK/repos/smoke/demo.git"
git clone -q "$WORK/repos/smoke/demo.git" "$WORK/seed" 2>/dev/null
(cd "$WORK/seed" && echo hi >README && git add README && git -c user.name=t -c user.email=t@t.invalid commit -qm init && git push -q origin HEAD:main)

PORT=18765
node "$HERE/fake-gitstalk.mjs" "$PORT" "$WORK/repos" "http://host.docker.internal:$PORT" >/dev/null &
SERVER=$!
sleep 1

FAILED=0
run() {
  name=$1 image=$2 install=$3 command=$4
  printf '\n=== %s (%s)\n' "$name" "$image"
  docker run --rm --add-host=host.docker.internal:host-gateway \
    -e GITSTALK_TEST_SERVER="http://host.docker.internal:$PORT" \
    -v "$HERE/..:/plugin:ro" --platform "linux/$(uname -m | sed s/x86_64/amd64/)" "$image" sh -c "{ $install; } >/dev/null 2>&1 && $command" || FAILED=$((FAILED + 1))
}

for target in ${*:-debian ubuntu alpine pwsh}; do
  case $target in
    debian) run 'Debian 12, dash as sh' debian:bookworm-slim \
      'apt-get update && apt-get install -y --no-install-recommends git openssh-client curl ca-certificates' \
      'sh /plugin/test/setup-tests.sh' ;;
    ubuntu) run 'Ubuntu 24.04' ubuntu:24.04 \
      'apt-get update && apt-get install -y --no-install-recommends git openssh-client curl ca-certificates' \
      'sh /plugin/test/setup-tests.sh' ;;
    alpine) run 'Alpine, busybox sh' alpine:3.20 'apk add --no-cache git openssh-client curl' \
      'sh /plugin/test/setup-tests.sh' ;;
    pwsh) run 'PowerShell 7 on Linux (.NET SDK image, arm64)' mcr.microsoft.com/dotnet/sdk:8.0 \
      'apt-get update && apt-get install -y --no-install-recommends git openssh-client curl ca-certificates' \
      'pwsh -NoProfile -File /plugin/test/setup-tests.ps1' ;;
  esac
done
printf '\n%s container run(s) failed\n' "$FAILED"
[ "$FAILED" -eq 0 ]
