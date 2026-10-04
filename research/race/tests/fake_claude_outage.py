#!/usr/bin/env python3
"""Stand-in for ``claude -p`` during an auth outage or a rate limit (tests of harness/remote.py).

The first FAKE_OUTAGE_FAILS calls answer as Claude Code does when its credentials are refused or it is rate
limited: an ``is_error`` result and exit 1, no work done. Later calls are tests/fake_claude.py.
Environment: FAKE_OUTAGE_FAILS (default 0), FAKE_OUTAGE_KIND (auth | login | ratelimit), and fake_claude.py's own
variables; FAKE_CLAUDE_STATE also holds the call counter.
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MESSAGES = {
    "auth": 'API Error: 403 {"error":{"type":"forbidden","message":"Request not allowed"}}',
    "login": "Invalid API key · Please run /login",
    "ratelimit": 'API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"rate limited"}}',
}


def main() -> int:
    state = os.environ.get("FAKE_CLAUDE_STATE") or os.getcwd()
    os.makedirs(state, exist_ok=True)
    counter = os.path.join(state, "outage-calls")
    calls = int(open(counter).read()) if os.path.exists(counter) else 0
    with open(counter, "w") as fh:
        fh.write(str(calls + 1))
    if calls >= int(os.environ.get("FAKE_OUTAGE_FAILS", "0")):
        os.execv(sys.executable, [sys.executable, os.path.join(HERE, "fake_claude.py"), *sys.argv[1:]])
    sys.stdin.read()
    session = "outage-session"
    for ev in ({"type": "system", "subtype": "init", "cwd": os.getcwd(), "session_id": session, "tools": [],
                "mcp_servers": [], "model": "claude-fake", "permissionMode": "acceptEdits"},
               {"type": "result", "subtype": "success", "is_error": True, "duration_ms": 40, "duration_api_ms": 0,
                "num_turns": 1, "result": MESSAGES[os.environ.get("FAKE_OUTAGE_KIND", "auth")], "session_id": session,
                "total_cost_usd": 0, "usage": {"input_tokens": 0, "output_tokens": 0}, "permission_denials": []}):
        sys.stdout.write(json.dumps(ev) + "\n")
    sys.stdout.flush()
    return 1


if __name__ == "__main__":
    sys.exit(main())
