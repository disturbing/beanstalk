"""Which unstarted task a free agent takes: a port of the gateway's ``start_order``
(``packages/gateway/src/engine/v2/v2-start-order.ts``), so a harness-driven race (the GitHub arm) starts tasks with
exactly the rule the Beanstalk arm's engine uses. Keep the two in step; ``tests/test_start_order.py`` pins the
behaviour.

* Two tasks depend on each other when their predicted footprints share a module (modules more than a third of the
  tasks predict are hubs and ignored) or the arena declares a coupling; the earlier task in priority order goes first.
* A task is clear when it clashes with no task in flight (started, not landed/green/dropped/parked) and with no
  earlier unstarted task. Clear tasks start longest dependent chain first, then in priority order.
* With nothing clear, the task with the fewest clashes starts if it clashes with at most two tasks in flight;
  otherwise the agent waits for a landing.
* Age bound: a task that clashes with nothing in flight starts once ``age_bound`` later tasks started ahead of it.
* Stall bound: the wait lasts at most ``STALL_SECONDS`` after the newest start among the in-flight tasks a task
  clashes with; then it starts anyway (``stalled``).

``fifo`` is the head of the list.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

AGE_BOUND_PER_AGENT = 1 / 2
MIN_AGE_BOUND = 4
AGE_BOUND_TASK_SHARE = 1 / 4
STALL_SECONDS = 180.0
MAX_IN_FLIGHT_CLASHES = 2
HUB_SHARE = 1 / 3
DONE = ("landed", "green", "dropped", "parked")


@dataclass
class TaskView:
    id: str
    selected: list[str]
    partners: list[str]
    status: str = "pending"
    started_at: float | None = None


@dataclass
class StartChoice:
    kind: str                       # start | wait
    task: str | None = None
    rule: str | None = None
    overlap: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    wake_at: float | None = None


def age_bound(agents: int, tasks: int) -> int:
    by_agents = max(MIN_AGE_BOUND, math.ceil(AGE_BOUND_PER_AGENT * agents))
    return min(by_agents, max(1, math.floor(AGE_BOUND_TASK_SHARE * tasks)))


def choose_start(order: list[str], unstarted: list[str], tasks: dict[str, TaskView], agents: int, now: float,
                 rule: str = "dependency") -> StartChoice:
    if not unstarted:
        raise ValueError("no unstarted task to choose")
    if rule == "fifo":
        return StartChoice("start", unstarted[0], "fifo")
    positions = {tid: i for i, tid in enumerate(order)}
    waiting = set(unstarted)
    started = [tid for tid in order if tid not in waiting]
    in_flight = [tid for tid in started if tasks[tid].status not in DONE]
    counts: dict[str, int] = {}
    for tid in order:
        for m in tasks[tid].selected:
            counts[m] = counts.get(m, 0) + 1
    hubs = {m for m, n in counts.items() if n > HUB_SHARE * len(order)}
    modules = {tid: {m for m in tasks[tid].selected if m not in hubs} for tid in order}
    partners = {tid: set(tasks[tid].partners) for tid in order}

    def clash(a: str, b: str) -> bool:
        return b in partners[a] or a in partners[b] or bool(modules[a] & modules[b])

    heights = [1] * len(unstarted)
    for i in range(len(unstarted) - 1, -1, -1):
        for j in range(i + 1, len(unstarted)):
            if heights[j] + 1 > heights[i] and clash(unstarted[i], unstarted[j]):
                heights[i] = heights[j] + 1
    cands = []
    for i, tid in enumerate(unstarted):
        clashing = [o for o in in_flight if clash(tid, o)]
        pos = positions.get(tid, -1)
        cands.append({
            "id": tid, "in_flight": len(clashing),
            "clashes": len(clashing) + sum(1 for o in unstarted[:i] if clash(tid, o)),
            "height": heights[i], "position": pos,
            "overtaken": sum(1 for o in started if positions.get(o, -1) > pos),
            "newest": max([float("-inf")] + [_start_of(tasks[o], now) for o in clashing])})
    picked = _pick(cands, age_bound(agents, len(order))) or _pick_stalled(cands, now)
    if picked is None:
        return StartChoice("wait", wake_at=min(c["newest"] + STALL_SECONDS for c in cands))
    cand, why = picked
    occupied = {m for o in in_flight for m in tasks[o].selected}
    return StartChoice("start", cand["id"], why,
                       overlap=sorted(m for m in tasks[cand["id"]].selected if m in occupied),
                       skipped=[t for t in unstarted if positions.get(t, -1) < cand["position"]])


def _start_of(task: TaskView, now: float) -> float:
    return task.started_at if task.started_at is not None else now


def _pick(cands: list[dict], bound: int):
    aged = next((c for c in cands if c["in_flight"] == 0 and c["overtaken"] >= bound), None)
    if aged is not None:
        return aged, "aged"
    clear = [c for c in cands if c["clashes"] == 0]
    if clear:
        best = clear[0]
        for c in clear[1:]:
            if c["height"] > best["height"]:
                best = c
        return best, "disjoint" if best is cands[0] else "critical-path"
    startable = [c for c in cands if c["in_flight"] <= MAX_IN_FLIGHT_CLASHES]
    if not startable:
        return None
    best = startable[0]
    for c in startable[1:]:
        if c["clashes"] < best["clashes"] or (c["clashes"] == best["clashes"] and c["height"] > best["height"]):
            best = c
    return best, "least-overlap"


def _pick_stalled(cands: list[dict], now: float):
    stalled = [c for c in cands if c["newest"] + STALL_SECONDS <= now]
    if not stalled:
        return None
    best = stalled[0]
    for c in stalled[1:]:
        if c["clashes"] < best["clashes"]:
            best = c
    return best, "stalled"
