#!/usr/bin/env python3
"""Who submitted the changes in an orchestrated run, and how: per run, the forge submissions found in the session
transcript (Beanstalk: ``git push ... refs/heads/bean/...``; GitHub: ``gh pr create`` / ``gh pr merge``), split by
the lead and its workers, blocking (``-o wait`` in a foreground command), plain (returns once the bean is received)
or in the background, and how many were in flight at once as the transcript shows them (a blocking push by the lead
serialises integration).

It also measures the time spent waiting on checks, from the transcript's timestamps (tool call to its result):

- ``blocking_push_s``: foreground bean pushes with ``-o wait`` (the agent sits through its own pre-land check);
- ``poll_wait_s``: foreground commands that sleep while following the forge (``sleep`` with a status ref, a bean,
  the sprout or ``gh pr``), the other way an agent can sit idle on a verdict;
- ``plain_push_s``: plain bean pushes (the transfer itself; not waiting);
- ``active_s``: the summed span of each agent (lead: the session; worker: first to last message), so
  ``check_wait_share`` = (blocking_push_s + poll_wait_s) / active_s for the workers.

    python3 orch_pushes.py runs/orch-fastify-sonnet-4-t38-beanstalk [...]
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys

BEAN_PUSH = re.compile(r"git\b.*\bpush\b.*bean/")
PR_CREATE = re.compile(r"\bgh pr create\b")
PR_ENQUEUE = re.compile(r"\bgh pr merge\b")
POLL = re.compile(r"\bsleep\s+\d")
FORGE = re.compile(r"refs/beans|bean/|sprout|gh pr|for-each-ref")


def ts(e: dict) -> float | None:
    v = e.get("timestamp")
    if not v:
        return None
    try:
        return dt.datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def blank() -> dict:
    return {"bean_pushes": 0, "blocking_wait": 0, "plain": 0, "background": 0, "pr_create": 0, "pr_enqueue": 0,
            "blocking_push_s": 0.0, "poll_wait_s": 0.0, "plain_push_s": 0.0, "active_s": 0.0}


def analyse(run: str) -> dict:
    path = os.path.join(run, "transcript.jsonl")
    out = {"lead": blank(), "workers": blank()}
    pending: dict[str, int] = {}
    timed: dict[str, tuple[str, str, float]] = {}   # tool-use id -> (who, kind, started)
    spans: dict[str, list[float]] = {}               # agent (lead or parent tool-use id) -> first, last timestamp
    most = 0
    with open(path, encoding="utf-8", errors="replace") as fh:
        lines = fh.readlines()
    for line in lines:
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        who = "workers" if e.get("parent_tool_use_id") else "lead"
        at = ts(e)
        if at is not None and e.get("type") in ("assistant", "user"):
            span = spans.setdefault(e.get("parent_tool_use_id") or "lead", [at, at])
            span[0], span[1] = min(span[0], at), max(span[1], at)
        if e.get("type") == "assistant":
            for c in (e.get("message") or {}).get("content") or []:
                if c.get("type") != "tool_use" or c.get("name") != "Bash":
                    continue
                cmd = str((c.get("input") or {}).get("command", ""))
                bg = bool((c.get("input") or {}).get("run_in_background")) or cmd.rstrip().endswith("&")
                n = len(BEAN_PUSH.findall(cmd)) or (1 if BEAN_PUSH.search(cmd) else 0)
                if "for " in cmd and BEAN_PUSH.search(cmd):
                    n = max(n, cmd.count("bean/"))
                kind = None
                if n:
                    out[who]["bean_pushes"] += n
                    if bg:
                        out[who]["background"] += n
                    elif "-o wait" in cmd:
                        out[who]["blocking_wait"] += n
                        kind = "blocking_push_s"
                    else:
                        out[who]["plain"] += n
                        kind = "plain_push_s"
                    pending[c["id"]] = n
                    most = max(most, sum(pending.values()))
                elif not bg and POLL.search(cmd) and FORGE.search(cmd):
                    kind = "poll_wait_s"
                if kind and at is not None:
                    timed[c["id"]] = (who, kind, at)
                out[who]["pr_create"] += len(PR_CREATE.findall(cmd))
                out[who]["pr_enqueue"] += len(PR_ENQUEUE.findall(cmd))
        if e.get("type") == "user":
            for c in (e.get("message") or {}).get("content") or []:
                if isinstance(c, dict) and c.get("type") == "tool_result":
                    pending.pop(c.get("tool_use_id"), None)
                    started = timed.pop(c.get("tool_use_id"), None)
                    if started and at is not None:
                        w, kind, t0 = started
                        out[w][kind] += max(0.0, at - t0)
    for agent, (first, last) in spans.items():
        out["lead" if agent == "lead" else "workers"]["active_s"] += last - first
    for side in out.values():
        for k in ("blocking_push_s", "poll_wait_s", "plain_push_s", "active_s"):
            side[k] = round(side[k], 1)
        side["check_wait_s"] = round(side["blocking_push_s"] + side["poll_wait_s"], 1)
        side["check_wait_share"] = round(side["check_wait_s"] / side["active_s"], 3) if side["active_s"] else None
    out["most_bean_pushes_in_flight"] = most
    out["workers_seen"] = sum(1 for a in spans if a != "lead")
    return out


def main() -> None:
    for run in sys.argv[1:]:
        print(os.path.basename(run.rstrip("/")), json.dumps(analyse(run)))


if __name__ == "__main__":
    main()
