"""Shared loaders for the E5 analysis: race events, agent transcripts (stream-json), bean timelines.

Everything here is read-only on run directories (the baseline runs in research/race/runs are only read).
Times: events carry ``t`` (seconds since the harness clock started) and ``ts`` (UTC wall clock); transcripts carry
UTC ``timestamp`` on assistant and tool-result events. Wall-clock UTC is the common axis; ``t0`` is the race.start
event's ``ts`` so reported minutes are "since the race started".
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
from dataclasses import dataclass, field


def parse_ts(s: str) -> float:
    """ISO-8601 UTC ('...Z' or '+00:00') to epoch seconds."""
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    return dt.datetime.fromisoformat(s).timestamp()


def load_events(run: str) -> list[dict]:
    with open(os.path.join(run, "events.jsonl"), encoding="utf-8") as fh:
        ev = [json.loads(line) for line in fh if line.strip()]
    for e in ev:
        e["_epoch"] = parse_ts(e["ts"])
    return ev


def load_summary(run: str) -> dict:
    p = os.path.join(run, "summary.json")
    if not os.path.exists(p):
        return {}
    with open(p, encoding="utf-8") as fh:
        return json.load(fh)


@dataclass
class ToolCall:
    epoch: float
    tool: str
    path: str | None          # repo-relative file path for Read / Edit / Write, else None
    kind: str                 # read | write | search | bash | other
    pattern: str | None = None


@dataclass
class Invocation:
    inv: str
    kind: str                 # initial | rework | fixer
    task: str | None
    agent: str | None
    start: float              # epoch, invocation.start event
    real_end: float           # epoch, start + wall_ms
    end: float                # epoch, invocation.end event (includes emulated drift)
    wall: float               # real seconds
    drift: float              # emulated seconds held after the work finished
    cost: float = 0.0
    turns: int | None = None
    resumed: bool = False
    calls: list[ToolCall] = field(default_factory=list)

    @property
    def stretch(self) -> float:
        """How much longer than the real session the invocation lasted in the race (1 = no emulated drift)."""
        return (self.wall + self.drift) / self.wall if self.wall > 0 else 1.0


def _rel_path(path: str, cwd: str | None, task: str | None) -> str | None:
    if not path:
        return None
    if cwd and path.startswith(cwd.rstrip("/") + "/"):
        return path[len(cwd.rstrip("/")) + 1:]
    m = re.search(r"/work/agents/[^/]+/(.*)$", path)
    if m:
        return m.group(1)
    if not path.startswith("/"):
        return path
    return None


def read_transcript(path: str, task: str | None) -> list[ToolCall]:
    calls: list[ToolCall] = []
    cwd = None
    try:
        fh = open(path, encoding="utf-8", errors="replace")
    except OSError:
        return calls
    with fh:
        for line in fh:
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            if ev.get("type") == "system" and ev.get("subtype") == "init":
                cwd = ev.get("cwd")
            if ev.get("type") != "assistant" or not ev.get("timestamp"):
                continue
            epoch = parse_ts(ev["timestamp"])
            for block in (ev.get("message") or {}).get("content") or []:
                if not isinstance(block, dict) or block.get("type") != "tool_use":
                    continue
                name, inp = block.get("name", "?"), block.get("input") or {}
                if name == "Read":
                    calls.append(ToolCall(epoch, name, _rel_path(inp.get("file_path", ""), cwd, task), "read"))
                elif name in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
                    calls.append(ToolCall(epoch, name, _rel_path(inp.get("file_path", ""), cwd, task), "write"))
                elif name in ("Grep", "Glob"):
                    calls.append(ToolCall(epoch, name, None, "search", pattern=str(inp.get("pattern", ""))[:80]))
                elif name == "Bash":
                    calls.append(ToolCall(epoch, name, None, "bash", pattern=str(inp.get("command", ""))[:80]))
                else:
                    calls.append(ToolCall(epoch, name, None, "other"))
    return calls


@dataclass
class Run:
    path: str
    name: str
    events: list[dict]
    summary: dict
    t0: float                         # epoch of race.start
    n_tasks: int
    invocations: list[Invocation]
    landings: list[dict]              # {task, epoch, t, files, target}
    starts: dict[str, float]          # task -> epoch of task.start
    drift_factor: float = 1.0

    def minutes(self, epoch: float) -> float:
        return (epoch - self.t0) / 60.0


def load_run(path: str, transcripts: bool = True) -> Run:
    path = os.path.abspath(path.rstrip("/"))
    ev = load_events(path)
    summ = load_summary(path)
    start = next(e for e in ev if e["type"] == "race.start")
    t0 = start["_epoch"]
    inv_start: dict[str, dict] = {}
    invs: list[Invocation] = []
    for e in ev:
        if e["type"] == "invocation.start":
            inv_start[e["inv"]] = e
        elif e["type"] == "invocation.end" and e["inv"] in inv_start and not e.get("killed"):
            s = inv_start[e["inv"]]
            if s["kind"] not in ("initial", "rework", "fixer"):
                continue
            wall = (e.get("wall_ms") or 0) / 1000.0
            drift = float(e.get("drift_seconds") or 0.0)
            i = Invocation(inv=e["inv"], kind=s["kind"], task=s.get("task"), agent=s.get("agent"), start=s["_epoch"],
                           real_end=s["_epoch"] + wall, end=e["_epoch"], wall=wall, drift=drift,
                           cost=float(e.get("cost_usd") or 0.0), turns=e.get("num_turns"), resumed=bool(s.get("resume")))
            if transcripts:
                tp = os.path.join(path, "work", "transcripts", f"{e['inv']}.jsonl")
                i.calls = read_transcript(tp, i.task)
            invs.append(i)
    landings = []
    for e in ev:
        if e["type"] == "land" and e.get("task"):
            landings.append({"task": e["task"], "epoch": e["_epoch"], "t": e["t"], "files": e.get("files") or [],
                             "target": e.get("target"), "kind": e.get("kind") or "task", "sha": e.get("sha")})
    starts = {e["task"]: e["_epoch"] for e in ev if e["type"] == "task.start"}
    n_tasks = len(start.get("tasks") or []) or summ.get("tasks", 0)
    return Run(path=path, name=os.path.basename(path), events=ev, summary=summ, t0=t0, n_tasks=n_tasks,
               invocations=invs, landings=landings, starts=starts, drift_factor=float(start.get("drift_factor") or 1.0))


def green_times(ev: list[dict]) -> list[tuple[float, str]]:
    """(t, task) of each task's first green (race clock), as in race/kth_green.py."""
    seen: dict[str, float] = {}
    for e in ev:
        tasks: list[str] = []
        if e["type"] == "green.promote":
            tasks = list(e.get("tasks") or [])
        elif e["type"] in ("task.green", "land") and e.get("target") in ("main",) and e.get("task"):
            tasks = [e["task"]]
        for t in tasks:
            seen.setdefault(t, e["t"])
    return sorted((t, task) for task, t in seen.items())


def cost_at(ev: list[dict], t: float) -> float:
    return sum((e.get("cost_usd") or 0.0) for e in ev if e["type"] == "invocation.end" and e["t"] <= t)
