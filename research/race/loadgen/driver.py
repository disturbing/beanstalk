"""The load generator's driver: workers, schedules, reactions, metrics. Forge-agnostic (``forges.py``)."""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import os
import shutil
import statistics
import subprocess
import time
from dataclasses import dataclass, field

from harness import suite as suite_mod
from harness.ci import CI
from harness.gitops import Git
from harness.procs import ProcRegistry, Runner, Sandbox

from .changes import ChangeBook
from .forges import Forge, Outcome
from .schedule import Schedule


BARRIER_ENV = "LOADGEN_BARRIER"


class machine_lock:
    """An exclusive ``flock`` on ``$TMPDIR/<name>.lock`` held across processes, taken without blocking the loop."""

    def __init__(self, name: str):
        import tempfile
        self.path = os.path.join(tempfile.gettempdir(), f"{name}.lock")
        self.fh = None

    async def __aenter__(self):
        import fcntl
        self.fh = open(self.path, "w")
        while True:
            try:
                fcntl.flock(self.fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return self
            except BlockingIOError:
                await asyncio.sleep(2)

    async def __aexit__(self, *exc):
        import fcntl
        fcntl.flock(self.fh, fcntl.LOCK_UN)
        self.fh.close()


async def barrier(name: str, timeout: float = 900.0) -> float:
    """A pair's start line: with ``$LOADGEN_BARRIER`` (a directory ``run.py --forge both`` sets), write
    ``<dir>/<name>.ready`` and wait until every arm named in ``<dir>/arms`` is ready, so both clocks start
    together after each forge's own setup. Returns the seconds waited."""
    d = os.environ.get(BARRIER_ENV)
    if not d:
        return 0.0
    t0 = time.time()
    with open(os.path.join(d, f"{name}.ready"), "w") as fh:
        fh.write(str(t0))
    with open(os.path.join(d, "arms"), encoding="utf-8") as fh:
        arms = fh.read().split()
    while time.time() - t0 < timeout and not all(os.path.exists(os.path.join(d, f"{a}.ready")) for a in arms):
        await asyncio.sleep(0.5)
    return round(time.time() - t0, 2)


def linux_deps(deps: str, image: str) -> str:
    """The arena's dependency snapshot for Linux: ``npm ci --ignore-scripts`` of its ``package-lock.json`` in the
    container image, once per lockfile and image (cached under ``~/.cache/beanstalk-loadgen``), as the GitHub arm's
    workflow installs it. The host snapshot may hold native bindings for this machine's platform only."""
    import hashlib
    src = os.path.dirname(os.path.realpath(deps)) if deps.rstrip("/").endswith("node_modules") else deps
    with open(os.path.join(src, "package-lock.json"), "rb") as fh:
        digest = hashlib.sha256(fh.read() + image.encode()).hexdigest()[:12]
    cache = os.path.join(os.path.expanduser("~"), ".cache", "beanstalk-loadgen", f"deps-{digest}")
    done = os.path.join(cache, ".installed")
    if os.path.exists(done):
        return os.path.join(cache, "node_modules")
    os.makedirs(cache, exist_ok=True)
    for name in ("package.json", "package-lock.json"):
        shutil.copy(os.path.join(src, name), os.path.join(cache, name))
    subprocess.run(["docker", "run", "--rm", "-v", f"{cache}:/d", "-w", "/d", image, "npm", "ci", "--ignore-scripts",
                    "--no-audit", "--no-fund"], check=True, capture_output=True, timeout=1200)
    open(done, "w").close()
    return os.path.join(cache, "node_modules")


async def docker_suite(git: Git, work: str, sha: str, suite: "suite_mod.SuiteConfig", files: dict | None):
    """The arena's suite on ``sha`` in a container (``node:<arena node>-slim``, network ``none``: loopback only),
    the tree exported with ``git archive`` and ``files`` written over it, the dependency snapshot mounted read-only
    beside it. Returns a ``CIResult``."""
    from harness.ci import CIResult, parse_junit
    import tarfile
    import io
    import uuid
    root = os.path.join(work, "final", uuid.uuid4().hex[:8])
    tree = os.path.join(root, "tree")
    os.makedirs(tree)
    data = await asyncio.to_thread(lambda: subprocess.run(["git", "archive", "--format=tar", sha], cwd=git.repo,
                                                          capture_output=True, env=git.env, check=True).stdout)
    with tarfile.open(fileobj=io.BytesIO(data)) as tf:
        tf.extractall(tree, filter="data")
    for path, content in (files or {}).items():
        full = os.path.join(tree, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as fh:
            fh.write(content)
    argv = suite.test_argv(test_timeout_ms=60000, reporters=[("dot", "stdout"), ("junit", "/w/out/junit.xml")])
    os.makedirs(os.path.join(root, "out"))
    mounts = ["-v", f"{tree}:/w/tree", "-v", f"{os.path.join(root, 'out')}:/w/out"]
    image = f"node:{(suite.node or '25').lstrip('v')}-slim"
    if suite.deps:
        deps = await asyncio.to_thread(linux_deps, suite.deps, image)
        mounts += ["-v", f"{deps}:/w/node_modules:ro"]
    t0 = time.monotonic()
    proc = await asyncio.to_thread(lambda: subprocess.run(
        ["docker", "run", "--rm", "--network", "none", *mounts, "-w", "/w/tree", "-e", "CI=1",
         *[x for k, v in suite.env.items() for x in ("-e", f"{k}={v}")], image, *argv],
        capture_output=True, text=True, timeout=900))
    out = CIResult(ci_id="final", sha=sha, purpose="final", green=False, failing_files=None)
    out.suite_seconds = out.ci_seconds = time.monotonic() - t0
    junit = os.path.join(root, "out", "junit.xml")
    if os.path.exists(junit):
        with open(junit, encoding="utf-8") as fh:
            text = fh.read().replace("/w/tree/", tree + "/")
        with open(junit, "w", encoding="utf-8") as fh:
            fh.write(text)
    parsed = parse_junit(junit, tree)
    if parsed is not None:
        failing, passing, count = parsed
        out.failing_tests, out.passing_files, out.tests, out.failures = failing, passing, count, len(failing)
        out.failing_files = sorted({f["file"] for f in failing if f["file"]})
    out.green = proc.returncode == 0 and parsed is not None and not out.failing_tests
    out.output = (proc.stdout + proc.stderr)[-4000:]
    shutil.rmtree(root, ignore_errors=True)
    return out


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
    final_in: str = "auto"           # auto (Docker when available) | docker | local
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
        waited = await barrier(os.environ.get("LOADGEN_ARM") or self.forge.name)
        self.ev.epoch0 = time.time()   # the clock starts once the forge is ready (both forges', in a pair)
        self.ev.write("race.start", forge=self.forge.name, line=self.forge.line, line_base=self.line_base,
                      workers=self.opts.workers, schedule=self.opts.schedule.describe(), barrier_wait_s=waited)

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
        extra = {}
        for ch in self.book.changes.values():
            extra.update(ch.task.acceptance_tests)
        # fastify's suite listens on fixed ports (3000): another suite on this machine at the same moment (the
        # other arm's final check, another agent's run) fails it with EADDRINUSE. With Docker the suite runs in a
        # container (its own loopback, the arena's Node, the dependency snapshot mounted read-only); without it,
        # locally under a machine-wide lock. A red final check is run again (up to 3 times); every attempt is kept.
        docker = self.opts.final_in == "docker" or (self.opts.final_in == "auto" and shutil.which("docker"))
        if docker:
            async def run(files: dict | None):
                return await docker_suite(self.git, self.work, sha, self.suite, files)
        else:
            ci = CI(self.git, self.runner, self.work, 1, 0.0, 600.0, suite=self.suite)
            await ci.setup(sha)

            async def run(files: dict | None):
                return await ci.run(sha, "final", extra_files=files)
        attempts: list[dict] = []
        async with machine_lock("loadgen-final-check"):
            for _ in range(3):
                suite = await run(None)
                acc = await run(extra)
                attempts.append({"suite_green": suite.green, "acceptance_green": acc.green,
                                 "failing": sorted(set(suite.failing_files or []) | set(acc.failing_files or []))})
                if suite.green and acc.green:
                    break
                await asyncio.sleep(20)
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
        if self.ev is not None:
            self.ev.write("final.check", sha=sha, suite_green=suite.green, acceptance_green=acc.green)
        return {"sha": sha, "suite_green": suite.green, "suite_tests": suite.tests, "suite_failures": suite.failures,
                "suite_failing_files": suite.failing_files, "acceptance_run_green": acc.green,
                "green_tasks": len(integ), "green_tasks_accepted": sum(per_task[t]["acceptance_pass"] for t in integ),
                "tasks_accepted": sum(v["acceptance_pass"] for v in per_task.values()),
                "correct": bool(suite.green and intact and all(per_task[t]["acceptance_pass"] for t in integ)),
                "all_tasks_accepted": bool(acc.green and all(v["acceptance_pass"] for v in per_task.values())),
                "matches_chain_build": not chain_diff, "diff_vs_chain": chain_diff[-1:] if chain_diff else [],
                "attempts": attempts, "where": "docker" if docker else "local",
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
