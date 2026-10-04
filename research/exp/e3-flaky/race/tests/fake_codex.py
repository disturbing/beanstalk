#!/usr/bin/env python3
"""Stand-in for ``codex exec --json`` in tests: thread.started / item.completed / turn.completed events.

Does the work like the replay agent (the worktree's directory name is the task; applies its patch).
Environment: FAKE_CLAUDE_ARENA (arena dir, shared with fake_claude.py).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import uuid


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
    task = os.path.basename(cwd)
    patch = os.path.join(os.environ.get("FAKE_CLAUDE_ARENA", ""), "solutions", f"{task}.patch")
    if os.path.exists(patch):
        subprocess.run(["git", "apply", "--3way", patch], cwd=cwd, capture_output=True)
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
