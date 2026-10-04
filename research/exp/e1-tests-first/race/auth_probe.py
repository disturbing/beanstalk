#!/usr/bin/env python3
"""One-turn Haiku call (about $0.004) in the agents' own environment, before a paid race: exit 0 if the Claude
CLI answers, 75 if it reports an authentication failure (403, "not allowed", login) or an error result, so a race
never starts into an auth outage (2026-10-03: agents got "403 Request not allowed / please run /login" as
is_error results, which the harness would have treated as agent failures)."""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from harness.agents import agent_env  # noqa: E402

AUTH = re.compile(r"403|not allowed|log ?in", re.I)


def main() -> int:
    argv = ["claude", "-p", "--output-format", "json", "--model", "haiku", "--max-turns", "1", "--tools", "",
            "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--setting-sources", "",
            "--disable-slash-commands", "--no-session-persistence", "--max-budget-usd", "0.05"]
    with tempfile.TemporaryDirectory() as cwd:
        try:
            pr = subprocess.run(argv, input="Reply with the single word: ok", capture_output=True, text=True,
                                timeout=120, env=agent_env(), cwd=cwd)
        except subprocess.TimeoutExpired:
            print("auth probe: timed out")
            return 75
    try:
        r = json.loads(pr.stdout.strip() or "{}")
    except json.JSONDecodeError:
        r = {}
    text = f"{r.get('result') or ''} {pr.stderr[-500:]}"
    ok = r.get("type") == "result" and not r.get("is_error") and not AUTH.search(str(r.get("result") or ""))
    print(f"auth probe: {'ok' if ok else 'FAILED'} subtype={r.get('subtype')} is_error={r.get('is_error')} "
          f"cost={r.get('total_cost_usd')} text={text.strip()[:160]!r}")
    return 0 if ok else 75


if __name__ == "__main__":
    sys.exit(main())
