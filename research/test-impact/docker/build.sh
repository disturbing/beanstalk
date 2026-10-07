#!/bin/sh
# Builds the five tracing images (native platform; strace semantics are the same on amd64).
set -eu
cd "$(dirname "$0")"
for l in python node java go rust; do
  docker build -q -t "ti-$l" -f "$l.Dockerfile" . &
done
wait
