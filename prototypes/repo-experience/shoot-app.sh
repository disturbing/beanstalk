#!/bin/sh
# Usage: ./shoot-app.sh name "path?query" [width] [height] [theme]   (dev server on :5173)
cd "$(dirname "$0")"
W=${3:-1440}; H=${4:-900}; THEME=${5:-light}
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --window-size=$W,$H --virtual-time-budget=9000 --blink-settings=preferredColorScheme=$([ "$THEME" = dark ] && echo 0 || echo 1) \
  --screenshot="shots/app/$1.png" "http://localhost:5173$2" 2>/dev/null
