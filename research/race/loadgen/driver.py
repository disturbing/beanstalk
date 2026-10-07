"""The load generator's driver: workers, schedules, reactions, metrics. Forge-agnostic (``forges.py``)."""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import os
import shutil
import statistics
import time
from dataclasses import dataclass, field

from harness import suite as suite_mod
from harness.ci import CI
from harness.gitops import Git
from harness.procs import ProcRegistry, Runner, Sandbox

from .changes import ChangeBook
from .forges import Forge, Outcome
from .schedule import Schedule


class Events:
    """``events.jsonl`` in the race's schema (``kth_green.py`` reads it). ``at`` (epoch) dates an event at the
    forge's own time instead of when the driver wrote it."""

    def __init__(self, path: str):
        self.fh = open(path, "w", encoding="utf-8")
        self.seq = 0
        self.epoch0 = time.time()
        self.events: list[dict] = []

    def rel(self, epoch: float | None) -> float | None:
        return None if epoch is None else round(epoch - self.epoch0, 3)

    def write(self, typ: str, at: float | None = None, **fields) -> dict:
        self.seq += 1
        when = at if at is not None else time.time()
        ev = {"seq": self.seq, "t": round(when - self.epoch0, 3),
              "ts": dt.datetime.fromtimestamp(when, dt.timezone.utc).isoformat(timespec="milliseconds"),
              "type": typ, **fields}
        self.fh.write(json.dumps(ev, default=str) + "\n")
        self.fh.flush()
        self.events.append(ev)
        return ev

    def close(self) -> None:
        self.fh.close()


@dataclass
class Push:
    attempt: int
    sha: str
    pushed_at: float
    verdict: str = ""
    verdict_at: float | None = None
    reason: str = ""


@dataclass
class ChangeRun:
    task: str
    worker: int
    status: str = "pending"          # pending | thinking | ready | waiting | fixing | integrated | dropped
    started_at: float | None = None  # the worker began (think time starts)
    ready_at: float | None = None    # the first commit exists
    integrated_at: float | None = None
    stable_at: float | None = None
    enqueued_at: float | None = None
    integrated_sha: str | None = None
    pushes: list[Push] = field(default_factory=list)
    reactions: dict = field(default_factory=dict)
    upstream_files: int = 0
    standalone: bool = False

    def count(self, key: str, n: int = 1) -> None:
        self.reactions[key] = self.reactions.get(key, 0) + n


@dataclass
class Options:
    arena: str
    repo: str
    out: str
    workers: int
    schedule: Schedule
    mode: str = "standalone"
    tasks: list[str] | None = None
    max_attempts: int = 8
    max_wall_minutes: float = 120.0
    stable_wait_minutes: float = 15.0
    final_check: bool = True
    ci_slots: int = 2
    batch: int = 4
    label: str = ""


class Driver:
    def __init__(self, opts: Options, forge_factory):
        self.opts = opts
        self.out = os.path.abspath(opts.out)
        self.work = os.path.join(self.out, "work")
        self.forge_factory = forge_factory
        self.forge: Forge | None = None
        self.changes: dict[str, ChangeRun] = {}
        self.integrated: set[str] = set()
        self.changed = asyncio.Event()
        self.aborted: str | None = None
        self.ev: Events | None = None
        self.waiting_now = 0
        self.waiting_max = 0
        self.wall_end: float | None = None
        self.jobs: list[asyncio.Future] = []

    # -- setup --
    async def setup(self) -> None:
        if os.path.exists(self.work):
            shutil.rmtree(self.work)
        os.makedirs(self.work, exist_ok=True)
        self.runner = Runner(Sandbox(self.out), ProcRegistry())
        self.suite = suite_mod.load_suite(self.opts.arena)
        suite_mod.activate(self.suite)
        if self.suite.deps:
            if not os.path.isdir(self.suite.deps):
                raise SystemExit(f"dependency snapshot not found: {self.suite.deps}")
            os.symlink(self.suite.deps, os.path.join(self.work, "node_modules"))
        repo = os.path.join(self.work, "repo")
        tmp = Git(self.runner, self.work)
        await tmp.run("clone", "-q", "--no-local", "--single-branch", "--branch", "main", "--no-tags",
                      os.path.abspath(self.opts.repo), repo, cwd=self.work, timeout=600)
        self.git = Git(self.runner, repo)
        await self.git.run("remote", "remove", "origin", check=False)
        for k, v in (("user.name", "loadgen"), ("user.email", "loadgen@beanstalk.invalid"),
                     ("commit.gpgsign", "false"), ("core.hooksPath", "/dev/null"), ("gc.auto", "0"),
                     ("advice.detachedHead", "false"), ("core.autocrlf", "false")):
            await self.git.run("config", k, v)
        self.git.env = {**self.git.env, "GIT_AUTHOR_NAME": "loadgen", "GIT_AUTHOR_EMAIL": "loadgen@beanstalk.invalid",
                        "GIT_COMMITTER_NAME": "loadgen", "GIT_COMMITTER_EMAIL": "loadgen@beanstalk.invalid"}
        self.base_sha = await self.git.rev("main")
        self.book = ChangeBook(self.opts.arena, self.git, self.work, mode=self.opts.mode, tasks=self.opts.tasks)
        self.chain_end = await self.book.build_chain(self.base_sha)
        self.ev = Events(os.path.join(self.out, "events.jsonl"))
        self.forge = self.forge_factory(self.git, self.work, self.log)
        self.ev.write("race.setup", forge=self.forge.name, base=self.base_sha, chain_end=self.chain_end)
        self.line_base = await self.forge.setup(self.base_sha)
        self.ev.epoch0 = time.time()   # the clock starts once the forge is ready
        self.ev.write("race.start", forge=self.forge.name, line=self.forge.line, line_base=self.line_base,
                      workers=self.opts.workers, schedule=self.opts.schedule.describe())

    def log(self, typ: str, **fields) -> None:
        if self.ev is not None:
            self.ev.write(typ, **fields)

    # -- the run --
    async def run(self) -> dict:
        await self.setup()
        self.wall_end = time.time() + self.opts.max_wall_minutes * 60
        sched = self.opts.schedule
        for tid in self.book.order:
            self.changes[tid] = ChangeRun(task=tid, worker=-1)
        try:
            if sched.kind == "closed":
                async def closed() -> None:
                    await asyncio.gather(*(self.closed_worker(w) for w in range(self.opts.workers)))
                    await asyncio.gather(*self.jobs)
                await asyncio.wait_for(closed(), timeout=self.opts.max_wall_minutes * 60)
            else:
                await asyncio.wait_for(self.arrivals(), timeout=self.opts.max_wall_minutes * 60)
        except asyncio.TimeoutError:
            self.aborted = f"wall-clock limit {self.opts.max_wall_minutes} min"
        end = time.time()
        stable_wait = getattr(self.forge, "wait_stable", None)
        if stable_wait and not self.aborted:
            await stable_wait([c.task for c in self.changes.values() if c.status == "integrated"],
                              self.opts.stable_wait_minutes * 60)
        for c in self.changes.values():
            if c.status == "integrated":
                c.stable_at = self.forge.stable_at(c.task) or (c.integrated_at if self.forge.line == "main" else None)
                if c.stable_at and self.forge.line != "main":
                    self.ev.write("green.promote", at=c.stable_at, tasks=[c.task], sha=None)
                enq = getattr(self.forge, "enqueued_at", None)
                c.enqueued_at = enq(c.task) if enq else None
        final_sha = await self.forge.final_sha()
        forge_summary = await self.forge.finish()
        final = await self.final_check(final_sha) if self.opts.final_check else {}
        self.ev.write("race.end", aborted=self.aborted)
        summary = self.summary(end, forge_summary, final)
        with open(os.path.join(self.out, "summary.json"), "w", encoding="utf-8") as fh:
            json.dump(summary, fh, indent=2, default=str)
        self.ev.close()
        return summary

    def next_task(self) -> str | None | bool:
        """The first pending task that may start (chain mode waits for prerequisites); False when some wait."""
        blocked = False
        for tid in self.book.order:
            c = self.changes[tid]
            if c.status != "pending":
                continue
            if self.book.startable(tid, self.integrated):
                return tid
            if any(self.changes[p].status == "dropped" for p in self.book.changes[tid].prerequisites
                   if p in self.changes):
                c.status = "dropped"
                c.count("prerequisite_dropped")
                continue
            blocked = True
        return False if blocked else None

    async def closed_worker(self, w: int) -> None:
        while not self.aborted:
            tid = self.next_task()
            if tid is None:
                return
            if tid is False:
                self.changed.clear()
                await self.changed.wait()
                continue
            c = self.changes[tid]
            c.worker, c.status = w, "thinking"
            if self.opts.schedule.hold == "push":
                self.jobs.append(asyncio.ensure_future(self.run_change(c, self.opts.schedule.think_seconds(tid))))
                await asyncio.sleep(self.opts.schedule.think_seconds(tid))
            else:
                await self.run_change(c, self.opts.schedule.think_seconds(tid))
        return

    async def arrivals(self) -> None:
        sched = self.opts.schedule
        plan = sched.arrivals(self.book.order)
        t0 = time.time()
        jobs = []
        for i, (at, tid, worker) in enumerate(plan):
            delay = t0 + at - time.time()
            if delay > 0:
                await asyncio.sleep(delay)
            c = self.changes[tid]
            c.worker = (worker if worker is not None else i) % self.opts.workers
            c.status = "thinking"
            jobs.append(asyncio.ensure_future(self.run_change(c, 0.0, wait_startable=True)))
        for tid, c in self.changes.items():
            if c.status == "pending":
                c.status = "dropped"
                c.count("not_scheduled")
        await asyncio.gather(*jobs)

    async def run_change(self, c: ChangeRun, think: float, wait_startable: bool = False) -> None:
        tid = c.task
        c.started_at = time.time()
        self.ev.write("task.start", task=tid, agent=f"w{c.worker}", think_s=round(think, 2))
        await asyncio.sleep(think)
        while wait_startable and not self.book.startable(tid, self.integrated):
            if any(self.changes[p].status == "dropped" for p in self.book.changes[tid].prerequisites
                   if p in self.changes):
                self.finish_change(c, "dropped", "prerequisite dropped")
                return
            self.changed.clear()
            await self.changed.wait()
        wt = os.path.join(self.work, f"w{c.worker:02d}", tid)
        os.makedirs(os.path.dirname(wt), exist_ok=True)
        base = await self.forge.line_head()
        made = await self.book.make(wt, tid, base, label="a1", integrated=set(self.integrated))
        c.ready_at = time.time()
        c.standalone = made.used_standalone
        if made.upstream_files:
            c.upstream_files += len(made.upstream_files)
            c.count("upstream_files_taken", len(made.upstream_files))
        self.ev.write("task.commit", task=tid, agent=f"w{c.worker}", sha=made.sha, base=base,
                      standalone=made.used_standalone, upstream_files=made.upstream_files, notes=made.notes[:5])
        sha, reds = made.sha, 0
        for attempt in range(1, self.opts.max_attempts + 1):
            if self.aborted:
                self.finish_change(c, "dropped", self.aborted)
                return
            push = Push(attempt=attempt, sha=sha, pushed_at=time.time())
            c.pushes.append(push)
            c.status = "waiting"
            self.waiting_now += 1
            self.waiting_max = max(self.waiting_max, self.waiting_now)
            self.ev.write("queue.submit", task=tid, sha=sha, attempt=attempt, agent=f"w{c.worker}")
            try:
                out: Outcome = await self.forge.submit(tid, sha, attempt, self.book.changes[tid].task.title)
            finally:
                self.waiting_now -= 1
            push.verdict, push.verdict_at, push.reason = out.kind, out.at, out.reason
            if out.kind == "integrated":
                c.integrated_at, c.integrated_sha = out.at, out.sha
                self.ev.write("land", at=out.at, task=tid, sha=out.sha,
                              target="main" if self.forge.line == "main" else "trunk", attempt=attempt)
                if self.forge.line == "main":
                    self.ev.write("task.green", at=out.at, task=tid, sha=out.sha, target="main")
                self.integrated.add(tid)
                self.finish_change(c, "integrated")
                return
            if out.kind == "dropped":
                self.finish_change(c, "dropped", out.reason)
                return
            c.count(out.kind)
            reds += out.kind == "red"
            self.ev.write("queue.eject", at=out.at, task=tid, reason=out.kind, gh_reason=out.reason,
                          failing=out.failing[:10], files=out.files[:10])
            if attempt == self.opts.max_attempts:
                break
            c.status = "fixing"
            fix = self.opts.schedule.fix_seconds(tid, attempt)
            self.ev.write("rework.start", task=tid, reason=out.kind, attempt=attempt, fix_s=round(fix, 2))
            await asyncio.sleep(fix)
            base = await self.forge.line_head(force=True)
            all_up = out.kind == "red" and reds >= 2
            made = await self.book.make(wt, tid, base, all_upstream=all_up, label=f"a{attempt + 1}",
                                        integrated=set(self.integrated), after_red=out.kind == "red")
            c.count("rebase")
            if all_up:
                c.count("upstream_after_red")
            if made.upstream_files:
                c.upstream_files += len(made.upstream_files)
                c.count("upstream_files_taken", len(made.upstream_files))
            self.ev.write("task.commit", task=tid, agent=f"w{c.worker}", sha=made.sha, base=base, attempt=attempt + 1,
                          upstream_files=made.upstream_files, notes=made.notes[:5])
            sha = made.sha
        self.finish_change(c, "dropped", f"still kicked out after {self.opts.max_attempts} pushes")

    def finish_change(self, c: ChangeRun, status: str, reason: str = "") -> None:
        c.status = status
        if status == "dropped":
            self.ev.write("task.drop", task=c.task, reason=reason)
        self.changed.set()

    # -- final correctness --
    async def final_check(self, sha: str) -> dict:
        """The whole suite, then every task's acceptance tests written in, on the final line (as the race's)."""
        ci = CI(self.git, self.runner, self.work, 1, 0.0, 600.0, suite=self.suite)
        await ci.setup(sha)
        suite = await ci.run(sha, "final")
        extra = {}
        for ch in self.book.changes.values():
            extra.update(ch.task.acceptance_tests)
        acc = await ci.run(sha, "final", extra_files=extra)
        failing, passing = set(acc.failing_files or []), set(acc.passing_files)
        per_task, intact = {}, True
        for tid, ch in self.book.changes.items():
            paths = set(ch.task.acceptance_tests)
            ok = bool(paths) and paths <= passing and not (paths & failing)
            committed = True
            if self.changes[tid].status == "integrated":
                for p, content in ch.task.acceptance_tests.items():
                    # intact: as the task wrote it, or as the chain build ends (a later task's reference may edit
                    # an earlier task's test file, as upstream did)
                    r = await self.git.run("show", f"{sha}:{p}", check=False)
                    c = await self.git.run("show", f"{self.chain_end}:{p}", check=False)
                    committed = committed and r.returncode == 0 and r.stdout in (content, c.stdout)
                intact = intact and committed
            per_task[tid] = {"acceptance_pass": ok, "status": self.changes[tid].status, "committed_tests": committed}
        integ = [t for t, c in self.changes.items() if c.status == "integrated"]
        chain_diff = (await self.git.out("diff", "--stat", sha, self.book.changes[self.book.order[-1]].chain_sha,
                                         "--", ".", ":!.github")).strip().splitlines()
        self.ev.write("final.check", sha=sha, suite_green=suite.green, acceptance_green=acc.green)
        return {"sha": sha, "suite_green": suite.green, "suite_tests": suite.tests, "suite_failures": suite.failures,
                "suite_failing_files": suite.failing_files, "acceptance_run_green": acc.green,
                "green_tasks": len(integ), "green_tasks_accepted": sum(per_task[t]["acceptance_pass"] for t in integ),
                "tasks_accepted": sum(v["acceptance_pass"] for v in per_task.values()),
                "correct": bool(suite.green and intact and all(per_task[t]["acceptance_pass"] for t in integ)),
                "all_tasks_accepted": bool(acc.green and all(v["acceptance_pass"] for v in per_task.values())),
                "matches_chain_build": not chain_diff, "diff_vs_chain": chain_diff[-1:] if chain_diff else [],
                "failing_files": sorted(failing)[:50], "per_task": per_task}

    # -- metrics --
    def summary(self, end: float, forge: dict, final: dict) -> dict:
        t0 = self.ev.epoch0
        cs = list(self.changes.values())
        integ = [c for c in cs if c.status == "integrated" and c.ready_at and c.integrated_at]
        r2i = [c.integrated_at - c.ready_at for c in integ]
        r2s = [c.stable_at - c.ready_at for c in integ if c.stable_at]
        e2i = [c.integrated_at - c.enqueued_at for c in integ if c.enqueued_at]
        wait = sum((p.verdict_at or end) - p.pushed_at for c in cs for p in c.pushes)
        life = sum(c.integrated_at - c.started_at for c in integ if c.started_at)
        life_wait = sum((p.verdict_at or end) - p.pushed_at for c in integ for p in c.pushes)
        last = max((c.integrated_at for c in integ), default=end)
        wall = max(1.0, (max(last, max((c.stable_at or 0) for c in integ) if integ else end)) - t0)
        times = sorted(c.integrated_at - t0 for c in integ)
        peak10 = max((sum(1 for u in times if t <= u < t + 600) for t in times), default=0)
        reactions: dict[str, int] = {}
        for c in cs:
            for k, v in c.reactions.items():
                reactions[k] = reactions.get(k, 0) + v
        sched = self.opts.schedule
        return {
            "policy": self.forge.policy, "forge": self.forge.name, "label": self.opts.label,
            "config": {"agents": self.opts.workers, "workers": self.opts.workers, "seed": sched.seed,
                       "mode": self.opts.mode, "ci_slots": self.opts.ci_slots, "batch": self.opts.batch,
                       "arena": os.path.basename(os.path.abspath(self.opts.arena)), "schedule": sched.describe(),
                       "max_attempts": self.opts.max_attempts},
            "model": "loadgen", "cost_usd": 0.0, "aborted": self.aborted,
            "tasks": len(cs), "tasks_green": len(integ),
            "dropped": sorted(c.task for c in cs if c.status == "dropped"),
            "wall_seconds": round(wall, 1),
            "ready_to_integrated_s": stats(r2i), "ready_to_stable_s": stats(r2s), "enqueue_to_merged_s": stats(e2i),
            "first_push_to_verdict_s": stats([p.verdict_at - p.pushed_at for c in cs for p in c.pushes[:1]
                                              if p.verdict_at]),
            "waiting_share_of_change_life": round(life_wait / life, 3) if life else None,
            "waiting_share_of_worker_time": round(wait / (self.opts.workers * wall), 3),
            "max_concurrently_waiting": self.waiting_max,
            "throughput_per_10min": round(len(integ) / wall * 600, 2), "peak_integrated_in_10min": peak10,
            "pushes": sum(len(c.pushes) for c in cs), "reactions": reactions,
            "kickouts": sum(reactions.get(k, 0) for k in ("red", "conflict")),
            "standalone_changes": sum(1 for c in cs if c.standalone),
            "ci_minutes": forge.get("ci_minutes"), "red_validations": forge.get("red_validations"),
            "forge_detail": forge, "final": final,
            "per_change": [{"task": c.task, "worker": c.worker, "status": c.status,
                            "ready_s": _rel(c.ready_at, t0), "integrated_s": _rel(c.integrated_at, t0),
                            "stable_s": _rel(c.stable_at, t0), "enqueued_s": _rel(c.enqueued_at, t0),
                            "pushes": [{"attempt": p.attempt, "pushed_s": _rel(p.pushed_at, t0),
                                        "verdict": p.verdict, "verdict_s": _rel(p.verdict_at, t0),
                                        "reason": p.reason} for p in c.pushes],
                            "reactions": c.reactions} for c in cs],
        }


def _rel(v: float | None, t0: float) -> float | None:
    return None if v is None else round(v - t0, 2)


def stats(xs: list[float]) -> dict:
    if not xs:
        return {"n": 0, "median": None, "p90": None, "mean": None}
    s = sorted(xs)
    k = (len(s) - 1) * 0.9
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return {"n": len(s), "median": round(statistics.median(s), 1), "p90": round(s[lo] + (s[hi] - s[lo]) * (k - lo), 1),
            "mean": round(statistics.fmean(s), 1)}
