#!/bin/sh
# Usage: ./run.sh <lang> [extra ti.py args]   (lang: python ts java go rust)
# Runs the whole experiment for one language in its tracing container; results land in results/<lang>/.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
lang="$1"; shift
img="ti-$lang"; [ "$lang" = ts ] && img=ti-node
exec docker run --rm -v "$here/harness:/ti:ro" -v "$here/projects/$lang:/src:ro" -v "$here/results:/out" \
  "$img" python3 /ti/ti.py --lang "$lang" "$@"
