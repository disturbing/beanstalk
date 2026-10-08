#!/usr/bin/env python3
"""Who submitted the changes in an orchestrated run, and how: per run, the forge submissions found in the session
transcript (Beanstalk: ``git push ... refs/heads/bean/...``; GitHub: ``gh pr create`` / ``gh pr merge``), split by
the lead and its workers, blocking (``-o wait`` in a foreground command), plain (returns once the bean is received)
or in the background, and how many were in flight at once as the transcript shows them (a blocking push by the lead
serialises integration).

It also measures the time spent waiting on checks, from the transcript's timestamps (tool call to its result):

- ``blocking_push_s``: foreground bean pushes with ``-o wait`` (the agent sits through its own pre-land check);
- ``poll_wait_s``: foreground commands that sleep while following the forge (``sleep`` with a status ref, a bean,
  the sprout or ``gh pr``; a plain push followed by a sleep counts here), the other way an agent can sit idle on a
  verdict. A command that also runs the tests counts only its stated sleeps (at most its duration);
- ``wait_any_s``, ``wait_all_s``, ``reattach_s``: event-driven waits (plugin-v2), pushes to ``refs/wait/any`` or
  ``refs/wait/all`` that the forge wakes at a verdict, counted apart from sleeps (``wait_any`` / ``wait_all`` calls; a
  wait naming exactly one bean with ``-o bean=`` is a ``reattach`` to that bean's check), and MCP ``bean_wait`` calls;
- ``sleep_s``: every foreground ``sleep`` (forge-related or not, so a lead's blind ``sleep 420`` counts), its stated
  seconds at most the command's duration, with ``sleep_calls``; ``background_sleeps`` counts sleeps run in the
  background (they do not hold the agent);
- ``active_s``: the summed span of each agent (lead: the session; worker: first to last message), so
  ``check_wait_share`` = (blocking_push_s + poll_wait_s + event_wait_s) / active_s for the workers, where
  ``event_wait_s`` = wait_any_s + wait_all_s + reattach_s + bean_wait_s.

    python3 orch_pushes.py runs/orch-fastify-sonnet-4-t38-beanstalk [...]
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys

BEAN_PUSH = re.compile(r"git\b.*\bpush\b.*bean/")
WAIT_PUSH = re.compile(r"git\b.*\bpush\b.*refs/wait/(any|all)\b")
WAIT_BEANS = re.compile(r"(?:-o\s*|--push-option[= ])bean=(\S+)")
BLOCKING = re.compile(r"(?:-o\s*|--push-option[= ])wait\b")
SEGMENTS = re.compile(r"&&|\|\||[;\n|]")
PR_CREATE = re.compile(r"\bgh pr create\b")
PR_ENQUEUE = re.compile(r"\bgh pr merge\b")
POLL = re.compile(r"\bsleep\s+(\d+)")
TESTS = re.compile(r"locked_suite|node --test|npm test")
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
            "wait_any": 0, "wait_all": 0, "reattach": 0, "bean_wait": 0, "background_waits": 0,
            "sleep_calls": 0, "background_sleeps": 0,
            "blocking_push_s": 0.0, "poll_wait_s": 0.0, "wait_any_s": 0.0, "wait_all_s": 0.0, "reattach_s": 0.0,
            "bean_wait_s": 0.0, "sleep_s": 0.0, "active_s": 0.0}


def waits_in(cmd: str) -> list[str]:
    """The wait pushes of a command, in order: ``reattach`` (one bean named), else ``wait_any`` / ``wait_all``."""
    out = []
    for seg in SEGMENTS.split(cmd):
        m = WAIT_PUSH.search(seg)
        if m:
            beans = [b for v in WAIT_BEANS.findall(seg) for b in v.strip("'\"").split(",") if b]
            out.append("reattach" if len(beans) == 1 else f"wait_{m.group(1)}")
    return out


def bean_pushes_in(cmd: str) -> tuple[int, bool]:
    """Bean submissions in a command (wait pushes left out) and whether one blocks (``-o wait`` on a bean push)."""
    rest = "\n".join(seg for seg in SEGMENTS.split(cmd) if not WAIT_PUSH.search(seg))
    n = len(BEAN_PUSH.findall(rest)) or (1 if BEAN_PUSH.search(rest) else 0)
    if "for " in rest and BEAN_PUSH.search(rest):
        n = max(n, rest.count("bean/"))
    blocking = any(BEAN_PUSH.search(seg) and BLOCKING.search(seg) for seg in SEGMENTS.split(rest))
    return n, blocking


def analyse(run: str) -> dict:
    path = os.path.join(run, "transcript.jsonl")
    out = {"lead": blank(), "workers": blank()}
    pending: dict[str, int] = {}
    # tool-use id -> (who, kind, started, cap, stated sleep seconds)
    timed: dict[str, tuple[str, str | None, float, float | None, float | None]] = {}
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
                if c.get("type") != "tool_use":
                    continue
                if str(c.get("name", "")).endswith("bean_wait"):     # MCP: the same wait, for one bean
                    out[who]["bean_wait"] += 1
                    if at is not None:
                        timed[c["id"]] = (who, "bean_wait_s", at, None, None)
                    continue
                if c.get("name") != "Bash":
                    continue
                cmd = str((c.get("input") or {}).get("command", ""))
                bg = bool((c.get("input") or {}).get("run_in_background")) or cmd.rstrip().endswith("&")
                n, blocking = bean_pushes_in(cmd)
                waits = waits_in(cmd)
                sleeps = [int(x) for x in POLL.findall(cmd)]
                kind, cap = None, None
                if n:
                    out[who]["bean_pushes"] += n
                    if bg:
                        out[who]["background"] += n
                    elif blocking:
                        out[who]["blocking_wait"] += n
                        kind = "blocking_push_s"
                    else:
                        out[who]["plain"] += n
                    pending[c["id"]] = n
                    most = max(most, sum(pending.values()))
                for w in waits:
                    out[who][w] += 1
                if waits and bg:
                    out[who]["background_waits"] += len(waits)
                elif waits:
                    kind = f"{waits[-1]}_s"       # the command's time is the wait's (it holds until a verdict)
                if kind is None and not bg and sleeps and FORGE.search(cmd):
                    kind = "poll_wait_s"
                    if TESTS.search(cmd):
                        cap = float(sum(sleeps))
                if sleeps:
                    out[who]["background_sleeps" if bg else "sleep_calls"] += len(sleeps)
                slept = float(sum(sleeps)) if sleeps and not bg else None
                if at is not None and (kind or slept is not None):
                    timed[c["id"]] = (who, kind, at, cap, slept)
                out[who]["pr_create"] += len(PR_CREATE.findall(cmd))
                out[who]["pr_enqueue"] += len(PR_ENQUEUE.findall(cmd))
        if e.get("type") == "user":
            for c in (e.get("message") or {}).get("content") or []:
                if isinstance(c, dict) and c.get("type") == "tool_result":
                    pending.pop(c.get("tool_use_id"), None)
                    started = timed.pop(c.get("tool_use_id"), None)
                    if started and at is not None:
                        w, kind, t0, cap, slept = started
                        spent = max(0.0, at - t0)
                        if kind:
                            out[w][kind] += spent if cap is None else min(spent, cap)
                        if slept is not None:
                            out[w]["sleep_s"] += min(spent, slept)
    for agent, (first, last) in spans.items():
        out["lead" if agent == "lead" else "workers"]["active_s"] += last - first
    for side in out.values():
        for k in ("blocking_push_s", "poll_wait_s", "wait_any_s", "wait_all_s", "reattach_s", "bean_wait_s",
                  "sleep_s", "active_s"):
            side[k] = round(side[k], 1)
        side["event_wait_s"] = round(side["wait_any_s"] + side["wait_all_s"] + side["reattach_s"]
                                     + side["bean_wait_s"], 1)
        side["check_wait_s"] = round(side["blocking_push_s"] + side["poll_wait_s"] + side["event_wait_s"], 1)
        side["check_wait_share"] = round(side["check_wait_s"] / side["active_s"], 3) if side["active_s"] else None
    out["most_bean_pushes_in_flight"] = most
    out["workers_seen"] = sum(1 for a in spans if a != "lead")
    return out


def main() -> None:
    for run in sys.argv[1:]:
        print(os.path.basename(run.rstrip("/")), json.dumps(analyse(run)))


if __name__ == "__main__":
    main()
