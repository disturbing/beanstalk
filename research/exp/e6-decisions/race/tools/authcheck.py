#!/usr/bin/env python3
"""Is the Claude CLI logged in and accepted by the API right now? One 1-turn Haiku call through the harness's own adapter.
(Copied from exp/e3-flaky/race/authcheck.py.)

Usage: python3 tools/authcheck.py              exit 0 = ok; 76 = authentication / 403 failure; 1 = any other failure
       python3 tools/authcheck.py --scan RUN   exit 0 = no auth failure in RUN/events.jsonl; 76 = contaminated

Why: during an authentication outage ("403 Request not allowed") ``claude -p`` returns a *result* with ``is_error`` set,
not a crash, so the harness books the invocation as an agent run that changed nothing and the race carries on: a race
that overlaps an outage is contaminated, and nothing in its summary says so. The driver checks before a race starts and
scans its events afterwards.
"""
from __future__ import annotations

import asyncio
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # the race directory (tools/..)
sys.path.insert(0, HERE)

AUTH_FAILED = 76
AUTH = re.compile(r"\b(401|403)\b|not allowed|authenticat|unauthori[sz]ed|forbidden|\blog ?in\b|/login|invalid api key|"
                  r"oauth|credential|token (has )?expired|permission_error", re.I)


def auth_failure(text: str | None) -> bool:
    return bool(text and AUTH.search(text))


def contamination(events: list[dict]) -> dict:
    """Invocations that failed on authentication / 403 (or on anything else) in a finished race's events.

    ``auth``: invocations whose error text matches an authentication failure: the race is contaminated, re-run it.
    ``infra`` / ``errors``: other invocations that produced no result / came back with ``is_error`` (counted, not fatal:
    a turn limit is an ``is_error`` result too)."""
    auth, infra, errors = [], [], []
    for e in events:
        if e.get("type") != "invocation.end":
            continue
        text = f"{e.get('infra_error') or ''} {e.get('result_text') or ''}"
        failed = bool(e.get("infra_error")) or bool(e.get("is_error"))
        if failed and auth_failure(text):
            auth.append(e.get("inv"))
        elif e.get("infra_error"):
            infra.append(e.get("inv"))
        elif e.get("is_error"):
            errors.append(e.get("inv"))
    return {"auth": auth, "infra": infra, "errors": errors}


async def check() -> int:
    from harness.agents import ClaudeAdapter, InvocationSpec
    from harness.procs import ProcRegistry, Runner, Sandbox
    work = os.path.join(HERE, "runs", "_authcheck")
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work)
    try:
        adapter = ClaudeAdapter(Runner(Sandbox(work), ProcRegistry()), model="haiku", max_turns=1, timeout=120,
                                transcripts=os.path.join(work, "transcripts"), persist_sessions=False)
        res = await adapter.run(InvocationSpec(inv_id="authcheck", kind="classifier", task_id=None, agent_id=None,
                                               cwd=work, prompt="Reply with the single word: ok", no_tools=True,
                                               max_turns=1, timeout=120))
    finally:
        shutil.rmtree(work, ignore_errors=True)
    text = f"{res.infra_error or ''} {res.result_text or ''}"
    if res.ok and not res.is_error and not res.infra_error:
        print(f"[authcheck] ok (${res.cost_usd:.4f}, {res.wall_ms / 1000:.1f} s)", flush=True)
        return 0
    print(f"[authcheck] FAILED: {text.strip()[:300]!r}", flush=True)
    return AUTH_FAILED if auth_failure(text) else 1


def scan(run: str) -> int:
    import json
    with open(os.path.join(run, "events.jsonl"), encoding="utf-8") as fh:
        events = [json.loads(line) for line in fh if line.strip()]
    c = contamination(events)
    print(f"[authcheck] {run}: {len(c['auth'])} auth failures {c['auth'][:10]}, {len(c['infra'])} infra errors, "
          f"{len(c['errors'])} is_error results", flush=True)
    return AUTH_FAILED if c["auth"] else 0


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--scan":
        sys.exit(scan(sys.argv[2]))
    sys.exit(asyncio.run(check()))
