#!/usr/bin/env python3
"""Pre-flight for a paid race: one tiny Claude Code call with the race's model and environment (no tools, 1 turn).

  python3 scripts/preflight.py [--model sonnet] [--wait-minutes 10]

Exit 0: the CLI authenticated and answered. Exit 75: still failing after --wait-minutes (auth outage "403 Request not
allowed", rate limit, overload): do not start a race now. Each call costs about a cent; every call is appended to
data/preflight.jsonl so the spend is on record (scripts/spend.py counts it).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "race"))
from harness.agents import agent_env  # noqa: E402


def once(model: str) -> dict:
    argv = ["claude", "-p", "--output-format", "json", "--model", model, "--max-turns", "1", "--tools", "",
            "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--setting-sources", "", "--disable-slash-commands",
            "--no-session-persistence", "--max-budget-usd", "0.05"]
    t0 = time.time()
    try:
        res = subprocess.run(argv, input="Reply with the single word: ok", capture_output=True, text=True, timeout=120,
                             env=agent_env(), cwd="/tmp")
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": repr(e)[:200], "cost": 0.0, "seconds": round(time.time() - t0, 1)}
    obj = None
    try:
        obj = json.loads(res.stdout.strip() or "{}")
    except ValueError:
        pass
    if not isinstance(obj, dict) or obj.get("type") != "result":
        return {"ok": False, "error": (res.stderr or res.stdout)[-200:], "cost": 0.0, "seconds": round(time.time() - t0, 1)}
    ok = not obj.get("is_error") and not obj.get("api_error_status")
    return {"ok": ok, "error": None if ok else str(obj.get("result"))[:200], "status": obj.get("api_error_status"),
            "cost": float(obj.get("total_cost_usd") or 0.0), "seconds": round(time.time() - t0, 1)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="sonnet")
    ap.add_argument("--wait-minutes", type=float, default=10.0)
    a = ap.parse_args()
    deadline = time.time() + a.wait_minutes * 60
    log = os.path.join(ROOT, "data", "preflight.jsonl")
    os.makedirs(os.path.dirname(log), exist_ok=True)
    while True:
        r = once(a.model)
        r["at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        with open(log, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(r) + "\n")
        print("preflight:", json.dumps(r), flush=True)
        if r["ok"]:
            return 0
        if time.time() >= deadline:
            return 75
        time.sleep(60)


if __name__ == "__main__":
    sys.exit(main())
