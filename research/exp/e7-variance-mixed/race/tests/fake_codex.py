#!/usr/bin/env python3
"""Stand-in for ``codex exec --json`` in tests: thread.started / item.completed / turn.completed events.

Does the work like the replay agent (the worktree's directory name is the task; applies its patch).
Environment: FAKE_CLAUDE_ARENA (arena dir, shared with fake_claude.py).
"""
from __future__ import annotations

import json
import os
import sys
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fake_claude  # noqa: E402  (its ``work`` does what the replay agent does: patches, markers, repairs)


def emit(ev: dict) -> None:
    sys.stdout.write(json.dumps(ev) + "\n")
    sys.stdout.flush()


def main() -> int:
    argv = sys.argv[1:]
    if not argv or argv[0] != "exec" or "--json" not in argv:
        print("fake codex expects: exec --json ...", file=sys.stderr)
        return 2
    cwd = argv[argv.index("-C") + 1] if "-C" in argv else os.getcwd()
    prompt = sys.stdin.read() if argv[-1] == "-" else argv[-1]
    if not prompt.strip():
        return 1
    emit({"type": "thread.started", "thread_id": str(uuid.uuid4())})
    emit({"type": "turn.started"})
    mode = os.environ.get("FAKE_CODEX_MODE")
    if mode in ("routing", "reconnect"):  # 2026-10-03 outage: reconnect notices, then the turn fails or recovers
        for n in range(2, 6):
            emit({"type": "error", "message": f"Reconnecting... {n}/5 (workspace routing discovery failed)"})
        if mode == "routing":
            emit({"type": "error", "message": "workspace routing discovery failed"})
            emit({"type": "turn.failed", "error": {"message": "workspace routing discovery failed"}})
            return 1
    if mode == "limit":  # a spent ChatGPT-plan window: no turn completes
        emit({"type": "error", "message": "You've hit your usage limit. Try again in 3 hours."})
        emit({"type": "turn.failed", "error": {"message": "You've hit your usage limit. Try again in 3 hours."}})
        return 1
    os.chdir(cwd)
    fake_claude.work(prompt, os.environ.get("FAKE_CLAUDE_ARENA", ""))
    emit({"type": "item.completed", "item": {"id": "item_1", "type": "file_change", "status": "completed",
                                              "changes": [{"path": "x", "kind": "update"}]}})
    emit({"type": "item.completed", "item": {"id": "item_2", "type": "command_execution", "command": "node --test",
                                              "exit_code": 0, "status": "completed"}})
    emit({"type": "item.completed", "item": {"id": "item_3", "type": "agent_message", "text": "done"}})
    emit({"type": "turn.completed", "usage": {"input_tokens": 20000, "cached_input_tokens": 16000,
                                              "output_tokens": 1000}})
    return 0


if __name__ == "__main__":
    sys.exit(main())
