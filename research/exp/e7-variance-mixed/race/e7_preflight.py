#!/usr/bin/env python3
"""Pre-flight check run inside the race slot, right before a real race: is each agent CLI usable right now?

One tiny call per vendor in the fleet, with the harness's own isolation flags and environment (so a 403 from
an auth or network outage shows up here, not 20 minutes into a race as silent no-op reworks):
  claude  one turn, no tools, ~$0.005
  codex   one turn, read-only sandbox, billed to the ChatGPT plan

Exit 0 when every vendor answers; 75 (EX_TEMPFAIL) when one still fails after the retries.
Usage: python3 e7_preflight.py --fleet claude|mixed [--attempts 3] [--pause 20]
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from harness.agents import agent_env  # noqa: E402

PROMPT = "Reply with the single word OK. Do not use any tools."


def check_claude() -> tuple[bool, str, float]:
    argv = ["claude", "-p", "--output-format", "json", "--model", "sonnet", "--max-turns", "1", "--tools", "",
            "--permission-mode", "acceptEdits", "--permission-prompts", "none", "--strict-mcp-config",
            "--mcp-config", '{"mcpServers":{}}', "--setting-sources", "", "--disable-slash-commands", "--safe-mode",
            "--restricted", "--no-session-persistence", "--max-budget-usd", "0.05"]
    with tempfile.TemporaryDirectory(prefix="e7-preflight-") as cwd:
        try:
            p = subprocess.run(argv, input=PROMPT, cwd=cwd, env=agent_env(), capture_output=True, text=True,
                               timeout=120)
        except (subprocess.SubprocessError, OSError) as e:
            return False, f"claude did not run: {e!r}", 0.0
    try:
        obj = json.loads(p.stdout.strip() or "{}")
    except json.JSONDecodeError:
        return False, f"claude exit {p.returncode}: {(p.stderr or p.stdout).strip()[-300:]}", 0.0
    cost = float(obj.get("total_cost_usd") or 0.0)
    if p.returncode != 0 or obj.get("is_error") or "OK" not in str(obj.get("result", "")):
        return False, f"claude exit {p.returncode}: {str(obj.get('result'))[:300]}", cost
    return True, "claude ok", cost


def check_codex() -> tuple[bool, str, float]:
    with tempfile.TemporaryDirectory(prefix="e7-preflight-") as cwd:
        argv = ["codex", "exec", "--json", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "-s",
                "read-only", "-C", cwd, "-c", 'approval_policy="never"', "-"]
        try:
            p = subprocess.run(argv, input=PROMPT, cwd=cwd, env=agent_env(), capture_output=True, text=True,
                               timeout=180)
        except (subprocess.SubprocessError, OSError) as e:
            return False, f"codex did not run: {e!r}", 0.0
    done = failed = None
    for line in p.stdout.splitlines():
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        if ev.get("type") == "turn.completed":
            done = ev
        elif ev.get("type") == "turn.failed":
            failed = json.dumps(ev)[:300]
    if p.returncode != 0 or done is None or failed:
        return False, f"codex exit {p.returncode}: {failed or (p.stderr or p.stdout).strip()[-300:]}", 0.0
    return True, "codex ok", 0.0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--fleet", choices=["claude", "mixed"], required=True)
    ap.add_argument("--attempts", type=int, default=3)
    ap.add_argument("--pause", type=float, default=20.0)
    a = ap.parse_args()
    checks = [("claude", check_claude)] + ([("codex", check_codex)] if a.fleet == "mixed" else [])
    for attempt in range(1, a.attempts + 1):
        results = [(name, *fn()) for name, fn in checks]
        line = "; ".join(f"{n}: {msg}" for n, ok, msg, _ in results)
        print(f"[e7-preflight] {time.strftime('%H:%M:%S')} attempt {attempt}: {line} "
              f"(claude preflight cost ${sum(c for *_, c in results):.4f})", flush=True)
        if all(ok for _, ok, _, _ in results):
            return 0
        if attempt < a.attempts:
            time.sleep(a.pause)
    return 75


if __name__ == "__main__":
    sys.exit(main())
