#!/usr/bin/env python3
"""Verdict on a finished or aborted race run directory.

  python3 scripts/check_run.py RUN_DIR [--json]

Verdicts (exit code):
  CLEAN         0   the race ended normally, no infrastructure errors
  CONTAMINATED 10   at least one agent invocation died of an infrastructure error: an invocation.end with is_error or
                    infra_error (the 403 "Failed to authenticate. API Error: 403 Request not allowed" outage shows up as a
                    result event with is_error true, num_turns 1, ~0 s and $0, which the harness counts as a finished,
                    empty invocation), an invocation.retry, or a task dropped with "agent failed to run". Re-run the race.
  RATE_LIMITED 11   the harness stopped on a hard rate limit (summary.aborted "rate limited ... resets at <epoch>"): wait, re-run
  BUDGET       12   stopped at --budget-usd (a result about cost, not an infrastructure fault)
  WALL         13   stopped at --max-wall-minutes (a result)
  INCOMPLETE   14   no race.end event or no summary.json: the process was killed (waiter killed, machine restart)
  ABORTED      15   any other abort (signal, error in the harness)
CONTAMINATED wins over the abort kinds: a run with infra errors is never a result.

Only a NON-null infra_error counts (every invocation.end carries the key). Auth failures arrive as an is_error result, not as
a crash, so the check reads both the harness events (invocation.end is_error / result_text) and the stream-json transcripts
(work/transcripts/*.jsonl): a result event with api_error_status or terminal_reason "api_error", or an assistant message
flagged is_api_error_message / error "authentication_failed" or reading "Failed to authenticate" / "Request not allowed" /
"/login". Runs that only used replay agents have no transcripts and cannot be affected.
"""
from __future__ import annotations

import json
import os
import re
import sys

API_ERR = re.compile(r"Failed to authenticate|API Error|Request not allowed|Please run /login|Invalid API key|rate.?limit|overloaded|"
                     r"credit balance|usage limit", re.I)
CODES = {"CLEAN": 0, "CONTAMINATED": 10, "RATE_LIMITED": 11, "BUDGET": 12, "WALL": 13, "INCOMPLETE": 14, "ABORTED": 15}


TRANSCRIPT_MARK = re.compile(r'"is_api_error_message":\s*true|"error":\s*"authentication_failed"|Failed to authenticate|'
                             r'Request not allowed|Please run /login|"terminal_reason":\s*"api_error"')


def scan_transcripts(run: str) -> list[dict]:
    """Invocations whose stream-json transcript carries an API error marker (cheap text scan, structured markers only)."""
    d = os.path.join(run, "work", "transcripts")
    hits: list[dict] = []
    if not os.path.isdir(d):
        return hits
    for name in sorted(os.listdir(d)):
        if not name.endswith(".jsonl"):
            continue
        status = None
        marked = False
        try:
            with open(os.path.join(d, name), encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    if TRANSCRIPT_MARK.search(line):
                        marked = True
                    if '"type":"result"' in line.replace(" ", "") and '"api_error_status"' in line:
                        try:
                            status = json.loads(line).get("api_error_status")
                        except ValueError:
                            pass
        except OSError:
            continue
        if marked or status:
            hits.append({"inv": name[:-6], "api_error_status": status})
    return hits


def check(run: str) -> dict:
    ev_path = os.path.join(run, "events.jsonl")
    out: dict = {"run": run, "verdict": "INCOMPLETE", "infra": [], "retries": 0, "failed_to_run_drops": 0}
    if not os.path.exists(ev_path):
        out["note"] = "no events.jsonl"
        return out
    ev = []
    with open(ev_path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                try:
                    ev.append(json.loads(line))
                except ValueError:
                    pass
    summ = {}
    sp = os.path.join(run, "summary.json")
    if os.path.exists(sp):
        try:
            with open(sp, encoding="utf-8") as fh:
                summ = json.load(fh)
        except ValueError:
            pass
    ended = any(e["type"] == "race.end" for e in ev)
    for e in ev:
        t = e["type"]
        if t == "invocation.end" and not e.get("killed"):
            text = (e.get("result_text") or "")
            bad = bool(e.get("is_error")) or bool(e.get("infra_error")) or bool(text and API_ERR.match(text))
            if bad:
                out["infra"].append({"inv": e.get("inv"), "task": e.get("task"), "kind": e.get("kind"), "t": e.get("t"),
                                     "ts": e.get("ts"), "is_error": e.get("is_error"), "infra_error": (e.get("infra_error") or "")[:120],
                                     "text": text[:120]})
        elif t == "invocation.retry":
            out["retries"] += 1
        elif t == "task.drop" and str(e.get("reason", "")).startswith("agent failed to run"):
            out["failed_to_run_drops"] += 1
    out["transcript_api_errors"] = scan_transcripts(run)
    abort = summ.get("aborted") or next((e.get("reason") for e in ev if e["type"] == "abort"), None)
    out["aborted"] = abort
    out["race_end"] = ended
    out["cost_usd"] = summ.get("cost_usd")
    out["wall_seconds"] = summ.get("wall_seconds")
    out["tasks_green"] = summ.get("tasks_green")
    out["tasks"] = summ.get("tasks")
    out["final_correct"] = (summ.get("final") or {}).get("correct")
    if out["infra"] or out["retries"] or out["failed_to_run_drops"] or out["transcript_api_errors"]:
        out["verdict"] = "CONTAMINATED"
    elif not ended or not summ:
        out["verdict"] = "INCOMPLETE"
    elif abort:
        a = str(abort)
        if a.startswith("rate limited"):
            out["verdict"] = "RATE_LIMITED"
            m = re.search(r"resets at (\d+)", a)
            out["resets_at"] = int(m.group(1)) if m else (summ.get("subscription", {}).get("last_rate_limit") or {}).get("resetsAt")
        elif a.startswith("budget"):
            out["verdict"] = "BUDGET"
        elif a.startswith("wall-clock"):
            out["verdict"] = "WALL"
        else:
            out["verdict"] = "ABORTED"
    else:
        out["verdict"] = "CLEAN"
    return out


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    r = check(sys.argv[1])
    if "--json" in sys.argv:
        print(json.dumps(r))
    else:
        bits = [f"{r['verdict']}", f"cost ${r.get('cost_usd')}", f"green {r.get('tasks_green')}/{r.get('tasks')}",
                f"infra {len(r['infra'])}", f"transcript api errors {len(r['transcript_api_errors'])}", f"retries {r['retries']}", f"aborted={r.get('aborted')}", f"final_correct={r.get('final_correct')}"]
        print(f"{sys.argv[1]}: " + ", ".join(bits))
        for i in r["infra"][:5]:
            print("   ", i)
    return CODES.get(r["verdict"], 15)


if __name__ == "__main__":
    sys.exit(main())
