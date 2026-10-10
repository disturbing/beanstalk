#!/bin/sh
# Usage: ./shoot.sh name "query" [width] [height]
cd "$(dirname "$0")"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --window-size=${3:-1440},${4:-1000} --virtual-time-budget=6000 --screenshot="shots/$1.png" "file://$PWD/index.html?$2" 2>/dev/null
