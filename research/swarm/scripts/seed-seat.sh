#!/bin/sh
# Stores a ChatGPT login for Codex as a leased seat in beanstalk-swarm's broker (lease mode).
# Run by Coop himself; it never prints a token.
#
#   SWARM_URL=https://beanstalk-swarm.<subdomain>.workers.dev research/swarm/scripts/seed-seat.sh [options]
#
#   --seat NAME     seat name (default: default)
#   --device-auth   log in with a device code instead of the browser (enable device-code login in
#                   ChatGPT's security settings first)
#   --from-home     upload ~/.codex/auth.json (this laptop's own login) instead of a fresh one
#
# Default: a fresh, separate login (`codex login` into a throwaway CODEX_HOME). It is a session of
# its own, so the swarm may refresh it (refresh tokens rotate on use) without logging this laptop
# out; the throwaway directory is deleted afterwards. With --from-home the laptop and the swarm
# share one login, so the swarm never refreshes it: it works until its access token expires, then
# lease mode stops with "seat expired" and this script is run again.
#
# The swarm admin token comes from $SWARM_ADMIN_TOKEN or research/swarm/.dev.vars, and reaches curl
# through a config file readable only by you, never argv. The auth.json body goes to the swarm over
# HTTPS, where the broker encrypts it under SEAT_KEY; no route ever returns it.
set -eu

seat=default
mode=browser
while [ $# -gt 0 ]; do
  case "$1" in
    --seat) seat="$2"; shift 2 ;;
    --device-auth) mode=device; shift ;;
    --from-home) mode=home; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
: "${SWARM_URL:?set SWARM_URL to the beanstalk-swarm Worker URL}"
here="$(cd "$(dirname "$0")" && pwd)"
token="${SWARM_ADMIN_TOKEN:-}"
if [ -z "$token" ] && [ -f "$here/../.dev.vars" ]; then
  token="$(sed -n 's/^SWARM_ADMIN_TOKEN=//p' "$here/../.dev.vars" | tr -d "\"'")"
fi
[ -n "$token" ] || { echo "no SWARM_ADMIN_TOKEN (env or research/swarm/.dev.vars)" >&2; exit 1; }

umask 077
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT INT TERM
printf 'header = "Authorization: Bearer %s"\n' "$token" > "$work/curl.conf"

case "$mode" in
  home)
    auth="${CODEX_HOME:-$HOME/.codex}/auth.json"
    refreshable=0
    echo "uploading this laptop's own login ($auth); the swarm will not refresh it"
    ;;
  *)
    mkdir "$work/codex-home"
    if [ "$mode" = device ]; then
      CODEX_HOME="$work/codex-home" codex login --device-auth
    else
      CODEX_HOME="$work/codex-home" codex login
    fi
    auth="$work/codex-home/auth.json"
    refreshable=1
    ;;
esac
[ -f "$auth" ] || { echo "no auth.json at $auth" >&2; exit 1; }

status="$(curl -sS -o "$work/reply.json" -w '%{http_code}' --config "$work/curl.conf" \
  -X PUT -H 'content-type: application/json' --data-binary "@$auth" \
  "$SWARM_URL/v1/seats/$seat?refreshable=$refreshable")"
# The reply is a summary (name, refreshable, expiry, lease); it never contains a token.
cat "$work/reply.json"; echo
[ "$status" = 201 ] || { echo "the swarm answered $status" >&2; exit 1; }
echo "seat '$seat' stored (refreshable=$refreshable)"
