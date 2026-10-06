"""What streaming costs the agent and the driver (stream_e2e): the edit hook's own run time (the only part the
agent waits for; Claude Code runs PostToolUse hooks synchronously), and per run the edit tool calls, the
snapshots posted and the driver's diff + post time (spent beside the agent, never in its way).

    python3 stream_e2e/overhead.py <run out dir>...
"""
from __future__ import annotations

import glob
import json
import os
import statistics
import subprocess
import sys
import tempfile
import time

from_here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(from_here))
from harness import streamdiff  # noqa: E402


def hook_cost(n: int = 300) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        cmd = streamdiff.edit_hook_command(os.path.join(tmp, "edited"))
        payload = json.dumps({"tool_name": "Edit", "tool_input": {"file_path": "x", "old_string": "a" * 2000}})
        times = []
        for _ in range(n):
            t = time.perf_counter()
            subprocess.run(cmd, shell=True, input=payload, text=True, check=True)
            times.append((time.perf_counter() - t) * 1000)
    times.sort()
    print(f"edit hook ({cmd.split()[0]}): median {statistics.median(times):.1f} ms, "
          f"p95 {times[int(0.95 * n)]:.1f} ms, max {times[-1]:.1f} ms over {n} runs")


def run_cost(out: str) -> None:
    posts, edits, wall = [], 0, 0.0
    with open(os.path.join(out, "work", "driver.jsonl"), encoding="utf-8") as fh:
        for line in fh:
            e = json.loads(line)
            if e.get("type") == "driver.stream":
                posts.append(e["diff_ms"] + e["post_ms"])
            if e.get("type") == "driver.result":
                wall += (e.get("steps") or {}).get("agent", 0.0)
    for path in glob.glob(os.path.join(out, "work", "transcripts", "*.jsonl")):
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                if '"tool_use"' not in line:
                    continue
                msg = json.loads(line).get("message") or {}
                edits += sum(1 for b in msg.get("content") or [] if isinstance(b, dict) and b.get("type") == "tool_use"
                             and b.get("name") in ("Edit", "Write", "MultiEdit", "NotebookEdit"))
    print(f"{os.path.basename(out)}: agent wall {wall:.0f} s, {edits} edit tool calls, {len(posts)} snapshots, "
          f"driver diff+post {sum(posts):.0f} ms in all ({statistics.median(posts) if posts else 0:.0f} ms each)")


if __name__ == "__main__":
    hook_cost()
    for run in sys.argv[1:]:
        run_cost(run)
