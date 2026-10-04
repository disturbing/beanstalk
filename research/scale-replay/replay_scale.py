#!/usr/bin/env python3
"""Scale replay: push real history through workspace -> staged -> stable with 100-1000 concurrent agents.

Answers "where does v2's integration path saturate?" without paying for agents. Each historical commit of a
corpus (default: codex, 6,777 real merged changes) is one agent's task, taken in history order (FIFO, as v2
does). Every merge outcome is real (``git merge-tree`` on the bare corpus repo); agent work time, the
pre-land check and the stable validation are simulated latencies on a discrete-event clock.

Lifecycle per task (v2, optimistic pre-land, see harness/policy_beanstalk_preland.py):
  start   snapshot S = staged head; the change (parent_i..sha_i) is applied onto S. A conflict here means
          the change depends on history that is not staged yet: requeued once at the back, then dropped.
  work    lognormal(median W, sigma 0.7)
  check   pre-land check on the merge onto the staged head seen at check start (latency C, in parallel,
          agent-side). Checks are assumed green: this measures mechanics, not test outcomes.
  land    the committer (single writer) takes queued landings in groups of up to G per push: unmoved head
          -> land; moved -> re-merge; a conflict -> re-execute (re-apply the original change on the new head,
          check again; drop if it no longer applies); an overlap between the change's files and what landed
          since its check -> re-check (latency C); otherwise land optimistically.
          Committer time = measured git time + P seconds per push (Artifacts push latency).
  stable  K validator slots; each validates the current staged head (latency V) and promotes stable to it.

Not modelled: semantic breaks (all checks and validations green), real test runtimes, agents adapting a
change that depends on unlanded history (they are dropped instead, which overstates drops).
"""
from __future__ import annotations

import argparse
import heapq
import json
import math
import os
import random
import statistics
import subprocess
import time
from dataclasses import dataclass, field

ENV = {**os.environ, "GIT_AUTHOR_NAME": "replay", "GIT_AUTHOR_EMAIL": "replay@beanstalk.invalid",
       "GIT_COMMITTER_NAME": "replay", "GIT_COMMITTER_EMAIL": "replay@beanstalk.invalid",
       "GIT_AUTHOR_DATE": "2026-10-03T00:00:00Z", "GIT_COMMITTER_DATE": "2026-10-03T00:00:00Z"}


class Git:
    def __init__(self, repo: str):
        self.repo, self.calls, self.seconds = repo, 0, 0.0

    def run(self, *args: str) -> subprocess.CompletedProcess:
        t0 = time.monotonic()
        r = subprocess.run(["git", "-C", self.repo, *args], capture_output=True, text=True, env=ENV)
        self.calls += 1
        self.seconds += time.monotonic() - t0
        return r

    def merge(self, base: str, ours: str, theirs: str) -> tuple[str | None, list[str], float]:
        """3-way merge without a worktree. Returns (tree or None, conflicted paths, seconds)."""
        t0 = time.monotonic()
        r = self.run("merge-tree", "--write-tree", "--name-only", "--no-messages", f"--merge-base={base}", ours, theirs)
        dt = time.monotonic() - t0
        lines = r.stdout.split("\n")
        if r.returncode == 0:
            return lines[0].strip(), [], dt
        if r.returncode == 1:
            return None, sorted({p for p in lines[1:] if p.strip()}), dt
        raise RuntimeError(f"merge-tree failed: {r.stderr.strip()[:300]}")

    def commit(self, tree: str, parent: str) -> tuple[str, float]:
        t0 = time.monotonic()
        r = self.run("commit-tree", tree, "-p", parent, "-m", "replay")
        if r.returncode != 0:
            raise RuntimeError(f"commit-tree failed: {r.stderr.strip()[:300]}")
        return r.stdout.strip(), time.monotonic() - t0


@dataclass
class Task:
    i: int
    sha: str
    parent: str
    files: set[str]
    requeued: bool = False
    dropped: bool = False
    tried_at_idx: int = -1
    retry: bool = False
    snapshot: str = ""          # staged commit it started from
    result: str = ""            # its change applied onto ``snapshot``
    done_at: float = 0.0
    check_head_idx: int = -1    # staged index the last check ran against
    candidate: str = ""         # merge of ``result`` onto that head
    staged_at: float | None = None
    staged_idx: int | None = None
    stable_at: float | None = None
    reexecs: int = 0
    rechecks: int = 0
    queued_at: float = 0.0


@dataclass
class Sim:
    git: Git
    tasks: list[Task]
    agents: int
    work_median: float
    check_s: float
    validate_s: float
    push_s: float
    group_max: int
    slots: int
    rng: random.Random
    op_s: float = 0.015
    now: float = 0.0
    heap: list = field(default_factory=list)
    seq: int = 0
    staged: list[tuple[str, set[str]]] = field(default_factory=list)   # (sha, files) per landing; [0] = base
    stable_idx: int = 0
    backlog: list[Task] = field(default_factory=list)
    backlog_ids: set[int] = field(default_factory=set)
    blocked_by_file: dict = field(default_factory=dict)
    free_agents: int = 0
    committer_busy_until: float = 0.0
    committer_busy: float = 0.0
    committer_queue: list[Task] = field(default_factory=list)
    validating: int = 0
    stats: dict = field(default_factory=dict)
    group_sizes: list[int] = field(default_factory=list)
    waits: list[float] = field(default_factory=list)
    promotions: list[int] = field(default_factory=list)

    def push(self, t: float, kind: str, obj=None) -> None:
        self.seq += 1
        heapq.heappush(self.heap, (t, self.seq, kind, obj))

    def head(self) -> tuple[int, str]:
        return len(self.staged) - 1, self.staged[-1][0]

    def work_time(self) -> float:
        return self.work_median * math.exp(self.rng.gauss(0, 0.7))

    # ---- agents ----------------------------------------------------------------------------------------------

    def start_tasks(self) -> None:
        """Start backlog tasks in history order. A change that does not apply to the sprout head depends on
        history not landed yet: it stays blocked on its conflicted files and is retried only when a later
        landing touches one of them; whatever is still blocked when nothing is in flight is dropped."""
        if self.free_agents <= 0 or not self.backlog:
            return
        idx, head = self.head()
        kept: list[Task] = []
        for t in self.backlog:
            if self.free_agents <= 0 or (t.tried_at_idx >= 0 and not t.retry):
                kept.append(t)
                continue
            tree, conflicts, _ = self.git.merge(t.parent, head, t.sha)
            t.tried_at_idx, t.retry = idx, False
            if tree is None:
                if not t.requeued:
                    t.requeued = True
                    self.stats["start_requeues"] += 1
                for f in conflicts or list(t.files):
                    self.blocked_by_file.setdefault(f, set()).add(t.i)
                kept.append(t)
                continue
            t.snapshot = head
            t.result, _ = self.git.commit(tree, head)
            self.free_agents -= 1
            self.push(self.now + self.work_time(), "done", t)
        self.backlog = kept

    def unblock(self, files: set[str]) -> None:
        by_i = {t.i: t for t in self.backlog}
        for f in files:
            for i in self.blocked_by_file.pop(f, set()):
                if i in by_i:
                    by_i[i].retry = True

    def begin_check(self, t: Task) -> None:
        idx, head = self.head()
        tree, conflicts, _ = self.git.merge(t.snapshot, head, t.result)
        if tree is None:
            self.reexecute(t)
            return
        t.candidate, _ = self.git.commit(tree, head)
        t.check_head_idx = idx
        self.push(self.now + self.check_s, "checked", t)

    def reexecute(self, t: Task) -> None:
        """Re-apply the original change on the current staged head (a replay stand-in for the author's rework)."""
        idx, head = self.head()
        t.reexecs += 1
        self.stats["reexecutions"] += 1
        tree, conflicts, _ = self.git.merge(t.parent, head, t.sha)
        if tree is None or t.reexecs > 2:
            self.stats["drop_land_conflict"] += 1
            t.dropped = True
            self.free_agents += 1
            return
        t.snapshot = head
        t.result, _ = self.git.commit(tree, head)
        self.begin_check(t)

    # ---- committer ------------------------------------------------------------------------------------------

    def run_committer(self) -> None:
        if self.now < self.committer_busy_until or not self.committer_queue:
            return
        group: list[Task] = []
        spent = 0.0
        while self.committer_queue and len(group) < self.group_max:
            t = self.committer_queue.pop(0)
            idx, head = self.head()
            if t.check_head_idx == idx:
                new = t.candidate
            else:
                tree, conflicts, _ = self.git.merge(t.snapshot, head, t.result)
                spent += self.op_s
                if tree is None:
                    self.reexecute(t)
                    continue
                delta: set[str] = set()
                for _, files in self.staged[t.check_head_idx + 1:]:
                    delta |= files
                if delta & t.files:
                    t.rechecks += 1
                    self.stats["rechecks"] += 1
                    t.candidate, _ = self.git.commit(tree, head)
                    spent += self.op_s
                    t.check_head_idx = idx
                    self.push(self.now + spent + self.check_s, "checked", t)
                    continue
                new, _ = self.git.commit(tree, head)
                spent += self.op_s
                self.stats["optimistic_landings"] += 1
            self.staged.append((new, set(t.files)))
            t.staged_idx = len(self.staged) - 1
            self.unblock(t.files)
            group.append(t)
            self.waits.append(self.now - t.queued_at)
        if group:
            spent += self.push_s
            self.group_sizes.append(len(group))
            for t in group:
                t.staged_at = self.now + spent
                self.free_agents += 1
            self.stats["landed"] += len(group)
        if spent > 0:
            self.committer_busy_until = self.now + spent
            self.committer_busy += spent
            self.push(self.committer_busy_until, "committer_free")

    # ---- stable ---------------------------------------------------------------------------------------------

    def run_validator(self) -> None:
        idx, _ = self.head()
        while self.validating < self.slots and idx > self.stable_idx and not self.stats.get("_validating_idx", -1) >= idx:
            self.validating += 1
            self.stats["_validating_idx"] = idx
            self.push(self.now + self.validate_s, "validated", idx)

    def promote(self, idx: int) -> None:
        if idx <= self.stable_idx:
            return
        self.promotions.append(idx - self.stable_idx)
        self.stable_idx = idx
        for t in self.tasks:
            if t.staged_idx is not None and t.stable_at is None and t.staged_idx <= idx:
                t.stable_at = self.now

    # ---- loop -----------------------------------------------------------------------------------------------

    def run(self) -> dict:
        for k in ("start_requeues", "drop_start_conflict", "drop_land_conflict", "reexecutions", "rechecks",
                  "optimistic_landings", "landed"):
            self.stats[k] = 0
        self.free_agents = self.agents
        self.backlog = list(self.tasks)
        self.backlog_ids = {t.i for t in self.tasks}
        self.start_tasks()
        while self.heap or self.backlog:
            if not self.heap:  # nothing in flight, only blocked tasks left: they can never apply
                for t in self.backlog:
                    t.dropped = True
                    self.stats["drop_start_conflict"] += 1
                self.backlog = []
                break
            t_ev, _, kind, obj = heapq.heappop(self.heap)
            self.now = t_ev
            if kind == "done":
                obj.done_at = self.now
                self.begin_check(obj)
            elif kind == "checked":
                obj.queued_at = self.now
                self.committer_queue.append(obj)
            elif kind == "validated":
                self.validating -= 1
                self.promote(obj)
            self.run_committer()
            self.run_validator()
            self.start_tasks()
        landed = [t for t in self.tasks if t.staged_at is not None]
        to_staged = [t.staged_at - t.done_at for t in landed]
        to_stable = [t.stable_at - t.done_at for t in landed if t.stable_at is not None]
        hours = max(self.now, 1e-9) / 3600

        def pct(xs: list[float], q: float) -> float:
            return round(sorted(xs)[min(len(xs) - 1, int(q * len(xs)))] / 60, 2) if xs else float("nan")

        return {
            "agents": self.agents, "tasks": len(self.tasks), "landed": len(landed),
            "drops_start_conflict": self.stats["drop_start_conflict"],
            "drops_land_conflict": self.stats["drop_land_conflict"],
            "start_requeues": self.stats["start_requeues"], "reexecutions": self.stats["reexecutions"],
            "rechecks": self.stats["rechecks"], "optimistic_landings": self.stats["optimistic_landings"],
            "sim_hours": round(hours, 2), "landings_per_hour": round(len(landed) / hours, 1),
            "groups": len(self.group_sizes),
            "mean_group": round(statistics.mean(self.group_sizes), 2) if self.group_sizes else 0,
            "max_group": max(self.group_sizes) if self.group_sizes else 0,
            "committer_utilisation": round(self.committer_busy / max(self.now, 1e-9), 3),
            "committer_wait_p50_min": pct(self.waits, 0.5), "committer_wait_p95_min": pct(self.waits, 0.95),
            "done_to_staged_p50_min": pct(to_staged, 0.5), "done_to_staged_p95_min": pct(to_staged, 0.95),
            "done_to_stable_p50_min": pct(to_stable, 0.5), "done_to_stable_p95_min": pct(to_stable, 0.95),
            "promotions": len(self.promotions),
            "mean_promotion_batch": round(statistics.mean(self.promotions), 1) if self.promotions else 0,
            "git_calls": self.git.calls, "git_seconds": round(self.git.seconds, 1),
        }


def load_tasks(corpus: str, start: int, count: int) -> list[Task]:
    with open(corpus, encoding="utf-8") as fh:
        rows = [json.loads(line) for line in fh if line.strip()]
    rows = rows[start:start + count]
    return [Task(i=r["seq"], sha=r["sha"], parent=r["parent"], files={f["path"] for f in r["files"]}) for r in rows]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--repo", default="../corpora/codex.git")
    ap.add_argument("--corpus", default="../data/codex/corpus.jsonl")
    ap.add_argument("--start", type=int, default=2000, help="first corpus change used as a task (its parent is the base)")
    ap.add_argument("--agents", type=int, nargs="+", default=[100, 300, 1000])
    ap.add_argument("--tasks-per-agent", type=float, default=3.0)
    ap.add_argument("--max-tasks", type=int, default=4500)
    ap.add_argument("--work-min", type=float, default=20.0, help="median agent work time, minutes")
    ap.add_argument("--check-s", type=float, default=60.0, help="pre-land check latency, seconds")
    ap.add_argument("--validate-s", type=float, default=600.0, help="stable validation latency, seconds")
    ap.add_argument("--push-s", type=float, default=1.0, help="committer push latency per group, seconds")
    ap.add_argument("--group", type=int, default=50, help="max landings per committer push (1 = no grouping)")
    ap.add_argument("--slots", type=int, default=2, help="stable validator slots")
    ap.add_argument("--op-ms", type=float, default=15.0, help="committer cost per git merge/commit, ms (unloaded measurement: 6-18 ms on codex)")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", default="out/results.jsonl")
    a = ap.parse_args()
    here = os.path.dirname(os.path.abspath(__file__))
    repo, corpus = os.path.join(here, a.repo), os.path.join(here, a.corpus)
    os.makedirs(os.path.dirname(os.path.join(here, a.out)), exist_ok=True)
    for n in a.agents:
        count = min(a.max_tasks, int(n * a.tasks_per_agent))
        tasks = load_tasks(corpus, a.start, count)
        base = tasks[0].parent
        git = Git(repo)
        sim = Sim(git=git, tasks=tasks, agents=n, work_median=a.work_min * 60, check_s=a.check_s,
                  validate_s=a.validate_s, push_s=a.push_s, group_max=a.group, slots=a.slots, op_s=a.op_ms / 1000,
                  rng=random.Random(f"{a.seed}:{n}"))
        sim.staged = [(base, set())]
        t0 = time.monotonic()
        res = sim.run()
        res.update({"corpus": os.path.basename(os.path.dirname(corpus)), "start": a.start, "work_min": a.work_min,
                    "check_s": a.check_s, "validate_s": a.validate_s, "push_s": a.push_s, "group": a.group, "op_ms": a.op_ms,
                    "wall_seconds": round(time.monotonic() - t0, 1)})
        print(json.dumps(res), flush=True)
        with open(os.path.join(here, a.out), "a", encoding="utf-8") as fh:
            fh.write(json.dumps(res) + "\n")


if __name__ == "__main__":
    main()
