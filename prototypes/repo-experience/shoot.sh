#!/bin/sh
# Usage: ./shoot.sh name "query" [width] [height]
cd "$(dirname "$0")"
W=${3:-1440}; H=${4:-900}
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --window-size=$W,$H --virtual-time-budget=6000 --screenshot="shots/$1.png" \
  "file://$PWD/index.html?$2" 2>/dev/null
