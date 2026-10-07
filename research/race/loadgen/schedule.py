"""When workers push: the schedule sources.

* ``closed``: a worker takes the next task, thinks (``initial``), pushes, and waits for the forge's verdict; after a
  kick-out it fixes (``rework``) and pushes again; once the change is integrated it takes the next task. Think and
  fix times are lognormal, fitted to a real run's agent invocations (``fit``), and drawn from a seeded generator keyed
  by (seed, task, kind, attempt), so both forges see the same delays for the same change.
* ``open``: changes become ready at a fixed interval or as a Poisson process (``rate`` per minute), whatever the
  forge does; workers only react to kick-outs (with the fitted fix time).
* ``orchestrated``: the same from an orchestrated race (``harness/orchestrated.py``): each change's first push
  (PR opened / bean pushed), its task, its branch as the worker, compressed by ``speed``.
* ``recorded``: the push times of a real run (``events.jsonl``: each task's first commit, relative to
  ``race.start``), on the worker its agent was, compressed by ``speed``; reactions use the run's own rework
  durations for that task when it had any, else the fitted fix time. The source a real orchestrator's run plugs into.
"""
from __future__ import annotations

import json
import math
import os
import random
import statistics
from dataclasses import dataclass, field


@dataclass
class Lognormal:
    median: float
    sigma: float
    n: int = 0
    source: str = ""

    def draw(self, rng: random.Random) -> float:
        return max(0.0, self.median * math.exp(self.sigma * rng.gauss(0.0, 1.0)))

    def to_dict(self) -> dict:
        return {"median": round(self.median, 2), "sigma": round(self.sigma, 3), "n": self.n, "source": self.source}


def _lognormal(xs: list[float], source: str) -> Lognormal | None:
    xs = [x for x in xs if x > 0]
    if len(xs) < 2:
        return None
    logs = [math.log(x) for x in xs]
    return Lognormal(math.exp(statistics.mean(logs)), statistics.pstdev(logs), len(xs), source)


def invocation_durations(run: str) -> dict[str, list[float]]:
    """Wall seconds of each agent invocation of a run, by kind (``initial``, ``rework``, ...)."""
    starts: dict[str, dict] = {}
    out: dict[str, list[float]] = {}
    with open(os.path.join(run, "events.jsonl"), encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            e = json.loads(line)
            if e.get("type") == "invocation.start":
                starts[e["inv"]] = e
            elif e.get("type") == "invocation.end" and e.get("inv") in starts:
                s = starts[e["inv"]]
                out.setdefault(s.get("kind", "?"), []).append(float(e["t"]) - float(s["t"]))
    return out


DEFAULT_THINK = Lognormal(100.0, 0.4, 0, "brief: initial ~100 s on fastify")
DEFAULT_FIX = Lognormal(60.0, 0.3, 0, "brief: rework ~60 s on fastify")


def fit(runs: list[str]) -> tuple[Lognormal, Lognormal]:
    """(think, fix) fitted to the pooled invocations of ``runs``; the brief's defaults when a run is missing."""
    init: list[float] = []
    rework: list[float] = []
    used = []
    for r in runs:
        if not os.path.exists(os.path.join(r, "events.jsonl")):
            continue
        d = invocation_durations(r)
        init += d.get("initial", [])
        rework += d.get("rework", [])
        used.append(os.path.basename(r.rstrip("/")))
    src = "fitted: " + ", ".join(used)
    return (_lognormal(init, src) or DEFAULT_THINK, _lognormal(rework, src) or DEFAULT_FIX)


@dataclass
class RecordedPush:
    task: str
    at: float          # seconds since the recorded race.start, before compression
    agent: str | None


def recorded_pushes(run: str) -> tuple[list[RecordedPush], dict[str, list[float]]]:
    """Each task's first commit time and agent, and its rework invocation durations, from a run's events."""
    first: dict[str, RecordedPush] = {}
    starts: dict[str, dict] = {}
    reworks: dict[str, list[float]] = {}
    t0 = 0.0
    with open(os.path.join(run, "events.jsonl"), encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            e = json.loads(line)
            typ = e.get("type")
            if typ == "race.start":
                t0 = float(e["t"])
            elif typ == "task.commit" and e.get("task") and e["task"] not in first:
                first[e["task"]] = RecordedPush(e["task"], float(e["t"]), e.get("agent"))
            elif typ == "invocation.start":
                starts[e["inv"]] = e
            elif typ == "invocation.end" and e.get("inv") in starts and starts[e["inv"]].get("kind") == "rework":
                s = starts[e["inv"]]
                reworks.setdefault(s.get("task"), []).append(float(e["t"]) - float(s["t"]))
    pushes = sorted((RecordedPush(p.task, max(0.0, p.at - t0), p.agent) for p in first.values()),
                    key=lambda p: (p.at, p.task))
    return pushes, reworks


def orchestrated_pushes(run: str) -> tuple[list[RecordedPush], dict[str, list[float]]]:
    """What an orchestrated race's orchestrator did (``harness/orchestrated.py``, measured by ``orch_measure``): each
    change's first push (GitHub: PR opened; Beanstalk: bean pushed) relative to ``race.start``, its task, and its
    branch as the worker key (a subagent's branch). Its re-pushes carry no times there, so reactions use the fitted
    fix time."""
    import datetime as dt
    with open(os.path.join(run, "summary.json"), encoding="utf-8") as fh:
        s = json.load(fh)
    start = None
    with open(os.path.join(run, "events.jsonl"), encoding="utf-8") as fh:
        for line in fh:
            e = json.loads(line)
            if e.get("type") == "race.start":
                start = dt.datetime.fromisoformat(e["ts"].replace("Z", "+00:00")).timestamp()
                break
    changes = [c for c in s.get("changes") or [] if c.get("task") and (c.get("created_at") or c.get("ready_at"))]
    start = start if start is not None else min(c.get("created_at") or c["ready_at"] for c in changes)
    first: dict[str, RecordedPush] = {}
    for c in sorted(changes, key=lambda c: c.get("created_at") or c["ready_at"]):
        at = (c.get("created_at") or c["ready_at"]) - start
        first.setdefault(c["task"], RecordedPush(c["task"], max(0.0, at), (c.get("extra") or {}).get("branch")))
    return sorted(first.values(), key=lambda p: (p.at, p.task)), {}


@dataclass
class Schedule:
    kind: str                                  # closed | open | recorded
    seed: int
    think: Lognormal = field(default_factory=lambda: DEFAULT_THINK)
    fix: Lognormal = field(default_factory=lambda: DEFAULT_FIX)
    time_scale: float = 1.0                    # multiplies every think / fix / arrival time (tests, compression)
    rate_per_min: float = 0.0                  # open loop
    poisson: bool = True                       # open loop
    hold: str = "integrate"                    # closed loop: integrate (wait for the verdict) | push (go on)
    recorded: list[RecordedPush] = field(default_factory=list)
    recorded_reworks: dict[str, list[float]] = field(default_factory=dict)
    recorded_source: str | None = None
    speed: float = 1.0                         # recorded: compression factor (2 = twice as fast)

    def rng(self, *key: object) -> random.Random:
        return random.Random(":".join(str(k) for k in (self.seed, *key)))

    def think_seconds(self, task: str) -> float:
        return self.think.draw(self.rng(task, "initial")) * self.time_scale

    def fix_seconds(self, task: str, attempt: int) -> float:
        rec = self.recorded_reworks.get(task) or []
        if self.kind in ("recorded", "orchestrated") and attempt - 1 < len(rec):
            return rec[attempt - 1] / self.speed * self.time_scale
        return self.fix.draw(self.rng(task, "rework", attempt)) * self.time_scale

    def arrivals(self, tasks: list[str]) -> list[tuple[float, str, int | None]]:
        """(ready time, task, worker or None) for the open and recorded sources, in time order."""
        if self.kind == "open":
            if self.rate_per_min <= 0:
                raise ValueError("open loop needs --rate (changes per minute)")
            rng = self.rng("arrivals")
            gap = 60.0 / self.rate_per_min
            t, out = 0.0, []
            for tid in tasks:
                out.append((t * self.time_scale, tid, None))
                t += rng.expovariate(1.0 / gap) if self.poisson else gap
            return out
        if self.kind in ("recorded", "orchestrated"):
            agents = sorted({p.agent for p in self.recorded if p.agent})
            idx = {a: i for i, a in enumerate(agents)}
            wanted = set(tasks)
            return [(p.at / self.speed * self.time_scale, p.task, idx.get(p.agent)) for p in self.recorded
                    if p.task in wanted]
        raise ValueError(f"{self.kind} has no arrival list")

    def describe(self) -> dict:
        d = {"kind": self.kind, "seed": self.seed, "think": self.think.to_dict(), "fix": self.fix.to_dict(),
             "time_scale": self.time_scale, "hold": self.hold}
        if self.kind == "open":
            d.update(rate_per_min=self.rate_per_min, poisson=self.poisson)
        if self.kind in ("recorded", "orchestrated"):
            d.update(source=self.recorded_source, speed=self.speed, pushes=len(self.recorded))
        return d
