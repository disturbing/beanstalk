#!/usr/bin/env python3
"""Stand-in for ``claude -p --output-format stream-json`` in tests (no network, no cost).

Emits the event schema observed from Claude Code 2.1.287: a ``system/init`` event, assistant messages
with ``usage``, and a ``result`` event whose ``total_cost_usd``, ``duration_api_ms`` and ``modelUsage`` are
cumulative over a resumed session while ``usage`` and ``num_turns`` are per invocation.

It does the work the way the replay agent does: the task is the worktree's directory name; an initial
prompt applies solutions/<task>.patch, a conflict prompt resolves markers by keeping both sides, a red or
repair prompt applies the fix patches of the tasks it names.

Environment: FAKE_CLAUDE_ARENA (arena dir), FAKE_CLAUDE_STATE (dir for session totals and pid files),
FAKE_CLAUDE_MODE (ok | hang | crash | expensive | ratelimit | noresume | authfail), FAKE_CLAUDE_COST (USD per invocation, default 0.01).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from harness.gitops import union_resolve  # noqa: E402


def emit(ev: dict) -> None:
    sys.stdout.write(json.dumps(ev) + "\n")
    sys.stdout.flush()


def opt(argv: list[str], name: str) -> str | None:
    if name in argv:
        i = argv.index(name)
        return argv[i + 1] if i + 1 < len(argv) else None
    return None


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], capture_output=True, text=True)


def apply_patch(path: str) -> None:
    if not os.path.exists(path):
        return
    res = git("apply", "--3way", "--whitespace=nowarn", path)
    if res.returncode != 0:
        for p in git("diff", "--name-only", "--diff-filter=U").stdout.split():
            resolve(p)


def resolve(path: str) -> None:
    if os.path.isfile(path):
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(union_resolve(text))
        git("add", "--", path)


def work(prompt: str, arena: str) -> None:
    task = os.path.basename(os.getcwd())
    sol = os.path.join(arena, "solutions")
    if "conflict markers are in:" in prompt:
        files = prompt.split("conflict markers are in:", 1)[1].split("\n", 1)[0].strip().rstrip(".")
        for f in [x.strip() for x in files.split(",") if x.strip()]:
            resolve(f)
    if "Repair ticket" in prompt or "rejected your change" in prompt or "Your change was not landed" in prompt:
        ids = set(re.findall(r"\bt\d{3}\b", prompt)) | ({task} if re.fullmatch(r"t\d{3}", task) else set())
        for tid in sorted(ids):
            apply_patch(os.path.join(sol, f"{tid}.fix.patch"))
    elif "conflict markers are in:" not in prompt and re.fullmatch(r"t\d{3}", task):
        apply_patch(os.path.join(sol, f"{task}.patch"))


def main() -> int:
    argv = sys.argv[1:]
    prompt = sys.stdin.read()
    if not prompt.strip():
        print("Error: Input must be provided either through stdin or as a prompt argument when using --print",
              file=sys.stderr)
        return 1
    mode = os.environ.get("FAKE_CLAUDE_MODE", "ok")
    state = os.environ.get("FAKE_CLAUDE_STATE") or os.getcwd()
    os.makedirs(state, exist_ok=True)
    with open(os.path.join(state, f"pid-{os.getpid()}"), "w") as fh:
        fh.write(os.getcwd())
    session = opt(argv, "--resume") or opt(argv, "--session-id") or str(uuid.uuid4())
    model = f"claude-{opt(argv, '--model') or 'haiku'}-fake"
    tools = (opt(argv, "--tools") or "").split(",") if opt(argv, "--tools") else []
    emit({"type": "system", "subtype": "init", "cwd": os.getcwd(), "session_id": session, "tools": tools,
          "mcp_servers": [], "model": model, "permissionMode": opt(argv, "--permission-mode"),
          "slash_commands": [], "apiKeySource": "none", "claude_code_version": "fake", "plugins": [], "skills": []})
    if mode == "crash":
        print("fake claude: simulated crash before any result", file=sys.stderr)
        return 1
    if mode == "noresume" and opt(argv, "--resume"):
        print(f"No conversation found with session ID: {opt(argv, '--resume')}", file=sys.stderr)
        return 1
    if mode == "ratelimit":  # plan window exhausted and no overage: the CLI stops without a result
        emit({"type": "rate_limit_event", "rate_limit_info": {
            "status": "rejected", "rateLimitType": "five_hour", "resetsAt": 1790977200,
            "overageStatus": "rejected", "isUsingOverage": False}})
        print("fake claude: usage limit reached", file=sys.stderr)
        return 1
    if mode == "authfail":  # an outage arrives as an error RESULT with exit 1, not as a crash (Claude Code 2.1.288)
        emit({"type": "result", "subtype": "success", "is_error": True, "duration_ms": 391, "duration_api_ms": 0,
              "num_turns": 1, "result": "Failed to authenticate. API Error: 403 Request not allowed",
              "session_id": session, "total_cost_usd": 0.0, "permission_denials": [], "modelUsage": {},
              "usage": {"input_tokens": 0, "output_tokens": 0, "cache_creation_input_tokens": 0,
                        "cache_read_input_tokens": 0}})
        return 1
    big = {"input_tokens": 10, "output_tokens": 50, "cache_creation_input_tokens": 2_000_000,
           "cache_read_input_tokens": 0}
    small = {"input_tokens": 12, "output_tokens": 40, "cache_creation_input_tokens": 1000,
             "cache_read_input_tokens": 9000}
    emit({"type": "assistant", "message": {"id": f"msg_{uuid.uuid4().hex[:8]}", "model": model,
                                           "content": [{"type": "text", "text": "working"}],
                                           "usage": big if mode == "expensive" else small}})
    if mode in ("hang", "expensive"):
        time.sleep(600)
        return 0
    t0 = time.monotonic()
    work(prompt, os.environ.get("FAKE_CLAUDE_ARENA", ""))
    cost = float(os.environ.get("FAKE_CLAUDE_COST", "0.01"))
    tot_path = os.path.join(state, f"session-{session}.json")
    prior = json.load(open(tot_path)) if os.path.exists(tot_path) else {"cost": 0.0, "api_ms": 0}
    total = {"cost": prior["cost"] + cost, "api_ms": prior["api_ms"] + 900}
    with open(tot_path, "w") as fh:
        json.dump(total, fh)
    emit({"type": "result", "subtype": "success", "is_error": False,
          "duration_ms": int((time.monotonic() - t0) * 1000) + 1000, "duration_api_ms": total["api_ms"],
          "num_turns": 3, "result": "done", "session_id": session, "total_cost_usd": total["cost"],
          "usage": dict(small), "permission_denials": [], "stop_reason": "end_turn",
          "modelUsage": {model: {"inputTokens": 12, "outputTokens": 40, "costUSD": total["cost"]}}})
    return 0


if __name__ == "__main__":
    sys.exit(main())
