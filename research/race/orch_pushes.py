#!/usr/bin/env python3
"""Who submitted the changes in an orchestrated run, and how: per run, the forge submissions found in the session
transcript (Beanstalk: ``git push ... refs/heads/bean/...``; GitHub: ``gh pr create`` / ``gh pr merge``), split by
the lead and its workers, blocking (``-o wait`` in a foreground command) or in the background, and how many were
in flight at once as the transcript shows them (a blocking push by the lead serialises integration).

    python3 orch_pushes.py runs/orch-fastify-sonnet-4-t38-beanstalk [...]
"""
from __future__ import annotations

import json
import os
import re
import sys

BEAN_PUSH = re.compile(r"git\b.*\bpush\b.*bean/")
PR_CREATE = re.compile(r"\bgh pr create\b")
PR_ENQUEUE = re.compile(r"\bgh pr merge\b")


def analyse(run: str) -> dict:
    path = os.path.join(run, "transcript.jsonl")
    out = {"lead": {"bean_pushes": 0, "blocking_wait": 0, "background": 0, "pr_create": 0, "pr_enqueue": 0},
           "workers": {"bean_pushes": 0, "blocking_wait": 0, "background": 0, "pr_create": 0, "pr_enqueue": 0}}
    pending: dict[str, int] = {}
    most = 0
    for line in open(path, encoding="utf-8", errors="replace"):
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        who = "workers" if e.get("parent_tool_use_id") else "lead"
        if e.get("type") == "assistant":
            for c in (e.get("message") or {}).get("content") or []:
                if c.get("type") != "tool_use" or c.get("name") != "Bash":
                    continue
                cmd = str((c.get("input") or {}).get("command", ""))
                bg = bool((c.get("input") or {}).get("run_in_background")) or cmd.rstrip().endswith("&")
                n = len(BEAN_PUSH.findall(cmd)) or (1 if BEAN_PUSH.search(cmd) else 0)
                if "for " in cmd and BEAN_PUSH.search(cmd):
                    n = max(n, cmd.count("bean/"))
                if n:
                    out[who]["bean_pushes"] += n
                    if "-o wait" in cmd and not bg:
                        out[who]["blocking_wait"] += n
                    if bg:
                        out[who]["background"] += n
                    pending[c["id"]] = n
                    most = max(most, sum(pending.values()))
                out[who]["pr_create"] += len(PR_CREATE.findall(cmd))
                out[who]["pr_enqueue"] += len(PR_ENQUEUE.findall(cmd))
        if e.get("type") == "user":
            for c in (e.get("message") or {}).get("content") or []:
                if isinstance(c, dict) and c.get("type") == "tool_result":
                    pending.pop(c.get("tool_use_id"), None)
    out["most_bean_pushes_in_flight"] = most
    return out


def main() -> None:
    for run in sys.argv[1:]:
        print(os.path.basename(run.rstrip("/")), json.dumps(analyse(run)))


if __name__ == "__main__":
    main()
