#!/bin/sh
# One streaming race against the local devstack (devstack.py up), watched by observe.mjs.
#   stream_e2e/race.sh <name> [model] [agents] [tasks...]     from research/race
# Needs playwright-core where node can find it (PLAYWRIGHT_DIR, default: this directory).
set -e
NAME=${1:?name}; MODEL=${2:-haiku}; AGENTS=${3:-3}; shift 3 2>/dev/null || shift $#
TASKS=${*:-t001 t003 t101}
HERE=$(cd "$(dirname "$0")" && pwd)
LOCAL=$HERE/.local
OUT=$LOCAL/runs/$NAME
SHOTS=$LOCAL/shots/$NAME
eval "$(python3 "$HERE/devstack.py" env)"
rm -rf "$OUT" "$SHOTS"
mkdir -p "$SHOTS" "$LOCAL/runs"
PW=${PLAYWRIGHT_DIR:-$HERE}; cp "$HERE/observe.mjs" "$PW/observe.mjs"
(cd "$PW" && node "$PW/observe.mjs" http://127.0.0.1:5391 "$OUT" "${BEAN:-t101}" "$SHOTS" > "$SHOTS.observe.log" 2>&1 &)
python3 race.py --forge cloudflare --policy beanstalk-v2 --agent claude --model "$MODEL" --agents "$AGENTS" \
  --tasks $TASKS --ci-seconds 2 --snapshot head --error-budget 999 --protect-tests landed --max-usd 3 \
  --budget-usd 3 --max-turns 30 --agent-timeout 600 --stream-diffs --keep-repo \
  --arena "$LOCAL/arena" --repo "$LOCAL/arena.git" --out "$OUT" --force
