"""Emulated CI: K slots, each a detached worktree; a run = ``node --test`` on a commit, then S seconds."""
from __future__ import annotations

import asyncio
import os
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

from .arena import import_depths, list_files, stack_files
from .flake import EXEMPT_PURPOSES, Flaker, test_id
from .gitops import Git
from .procs import Runner


@dataclass
class CIResult:
    ci_id: str
    sha: str
    purpose: str
    green: bool
    failing_files: list[str] | None        # None: the run crashed or timed out before reporting
    failing_tests: list[dict] = field(default_factory=list)   # {file, name, message}
    passing_files: list[str] = field(default_factory=list)
    tests: int = 0
    failures: int = 0
    output: str = ""                       # human-readable excerpt (spec reporter)
    suite_seconds: float = 0.0
    ci_seconds: float = 0.0                # suite + emulated latency (what the slot was busy for)
    read_set: list[str] = field(default_factory=list)  # static import closure of the failing test files
    read_sets: dict = field(default_factory=dict)       # failing test file -> its own import closure
    read_depths: dict = field(default_factory=dict)     # failing test file -> {file: import hops}
    stack_files: list[str] = field(default_factory=list)  # repo files named in failure stack traces
    slot: int = -1
    cancelled: bool = False
    timed_out: bool = False
    # experiment E3 (flaky tests): ground truth the policies never read, for counting wrongful reverts etc.
    attempt: int = 0                       # 0 = first run of this sha for this purpose, 1 = the re-run, ...
    true_green: bool | None = None         # the real outcome, before any injection or quarantine
    flaked: bool = False                   # a flake was injected: red although the tree is green
    flake_test: str | None = None          # "file > name" of the injected failure
    quarantined: list[str] = field(default_factory=list)       # failing tests ignored because quarantined
    quarantined_real: list[str] = field(default_factory=list)  # ... of which really failed (masked reds)
    flips: list[str] = field(default_factory=list)             # tests this run showed flaky (same tree, both outcomes)

    @property
    def flake_only(self) -> bool:
        """Red although the tree is really green: a flake, nothing else."""
        return (not self.green) and self.true_green is True


def parse_junit_full(path: str, root: str) -> tuple[list[dict], list[str], int, list[tuple[str, str]]] | None:
    """Parse node's junit reporter output: (failing tests, passing files, test count, passing (file, name) cases)."""
    try:
        tree = ET.parse(path)
    except (OSError, ET.ParseError):
        return None
    root_real = os.path.realpath(root)
    failing, passing, cases, count = [], set(), [], 0
    for case in tree.iter("testcase"):
        count += 1
        f = case.get("file") or ""
        if f.startswith("file://"):
            f = f[7:]
        rel = os.path.relpath(os.path.realpath(f), root_real).replace(os.sep, "/") if f else ""
        fail = case.find("failure")
        if fail is None:
            fail = case.find("error")
        if fail is not None:
            failing.append({"file": rel, "name": case.get("name", ""),
                            "message": (fail.get("message") or (fail.text or "")).strip()[:800],
                            "body": (fail.text or "")[:6000]})
        elif rel:
            passing.add(rel)
            if case.find("skipped") is None:
                cases.append((rel, case.get("name", "")))
    return failing, sorted(passing), count, cases


def parse_junit(path: str, root: str) -> tuple[list[dict], list[str], int] | None:
    """Parse node's junit reporter output into (failing tests, passing files, test count)."""
    full = parse_junit_full(path, root)
    return None if full is None else full[:3]


def node_test_flags() -> list[str]:
    """``RACE_NODE_CONCURRENCY=N`` caps the test files one suite runs in parallel (node's default: all cores)."""
    try:
        n = int(os.environ.get("RACE_NODE_CONCURRENCY") or 0)
    except ValueError:
        n = 0
    return [f"--test-concurrency={n}"] if n > 0 else []


class SuiteGate:
    """``RACE_NODE_SUITES=N`` lets at most N test suites run at once in this race (0 = no limit). With
    ``RACE_NODE_CONCURRENCY=C`` the race never has more than N*(C+1) node processes: validation runs on an
    overloaded machine use N=1, C=3. The wait happens before a suite starts, so it is not part of its timeout."""

    def __init__(self, limit: int | None = None):
        if limit is None:
            try:
                limit = int(os.environ.get("RACE_NODE_SUITES") or 0)
            except ValueError:
                limit = 0
        self.limit = max(0, limit)
        self.sem = asyncio.Semaphore(self.limit) if self.limit else None

    async def __aenter__(self) -> "SuiteGate":
        if self.sem:
            await self.sem.acquire()
        return self

    async def __aexit__(self, *exc) -> None:
        if self.sem:
            self.sem.release()


class CI:
    def __init__(self, git: Git, runner: Runner, work: str, slots: int, latency: float,
                 suite_timeout: float, test_timeout_ms: int = 60000, node: str = "node",
                 flaker: Flaker | None = None, gate: SuiteGate | None = None):
        self.git, self.runner = git, runner
        self.gate = gate or SuiteGate()
        self.flaker = flaker or Flaker.from_env()   # FLAKE_* environment variables; inert unless FLAKE_RATE > 0
        self.dir = os.path.join(work, "ci")
        self.slots = max(1, slots)
        self.latency = max(0.0, latency)
        self.suite_timeout = suite_timeout
        self.test_timeout_ms = test_timeout_ms
        self.node = node
        self.free: asyncio.Queue[int] = asyncio.Queue()
        self.running = 0
        self.runs = 0
        self.seq = 0
        self.total_seconds = 0.0
        self.busy_by_purpose: dict[str, float] = {}
        self.gitdirs: dict[int, str] = {}
        self.ready = False

    async def setup(self, commit: str) -> None:
        os.makedirs(os.path.join(self.dir, "results"), exist_ok=True)
        for i in range(self.slots):
            wt = os.path.join(self.dir, f"slot-{i}")
            await self.git.add_worktree(wt, commit)
            # the slot's own admin dir: a second CI (v2's pre-land slots) also names its worktrees slot-N and git
            # de-duplicates admin names (slot-01, ...), so the lock path must not be guessed from N (fix from E2)
            self.gitdirs[i] = await self.git.git_dir(wt)
            self.free.put_nowait(i)
        self.flaker.bind_base(list_files(os.path.join(self.dir, "slot-0")))   # the flaky tests come from the base suite
        self.ready = True

    def new_id(self) -> str:
        self.seq += 1
        return f"ci{self.seq:04d}"

    @property
    def idle_slots(self) -> int:
        return self.free.qsize()

    async def tree_id(self, sha: str) -> str:
        """The git tree of ``sha``: the flake history compares outcomes per tree, not per commit."""
        res = await self.git.run("rev-parse", "--verify", f"{sha}^{{tree}}", check=False)
        return res.stdout.strip() if res.returncode == 0 and res.stdout.strip() else sha

    async def run(self, sha: str, purpose: str, *, ci_id: str | None = None, extra_files: dict[str, str] | None = None,
                  latency: float | None = None, on_start=None, attempt: int | None = None) -> CIResult:
        """Run the suite on ``sha``. ``extra_files`` are written into the checkout first (final check).
        ``attempt`` numbers repeated runs of one (sha, purpose) for the flake draw; None counts them itself."""
        ci_id = ci_id or self.new_id()
        slot = await self.free.get()
        self.running += 1
        t0 = time.monotonic()
        wt = os.path.join(self.dir, f"slot-{slot}")
        res = CIResult(ci_id=ci_id, sha=sha, purpose=purpose, green=False, failing_files=None, slot=slot)
        try:
            if on_start:
                on_start(slot)
            # a slot belongs to one run at a time: any index.lock now is left by a cancelled run's git
            lock = os.path.join(self.gitdirs.get(slot) or os.path.join(self.git.repo, ".git", "worktrees",
                                                                       f"slot-{slot}"), "index.lock")
            if os.path.exists(lock):
                os.remove(lock)
            await self.git.checkout_detached(wt, sha)
            for path, content in (extra_files or {}).items():
                full = os.path.join(wt, path)
                os.makedirs(os.path.dirname(full), exist_ok=True)
                with open(full, "w", encoding="utf-8") as fh:
                    fh.write(content)
            junit = os.path.join(self.dir, "results", f"{ci_id}.xml")
            if os.path.exists(junit):
                os.remove(junit)
            env = {k: v for k, v in os.environ.items() if not k.startswith(("NODE_OPTIONS", "NODE_TEST"))}
            env["CI"] = "1"
            argv = [self.node, "--test", *node_test_flags(), f"--test-timeout={self.test_timeout_ms}",
                    "--test-reporter=spec", "--test-reporter-destination=stdout",
                    "--test-reporter=junit", f"--test-reporter-destination={junit}"]
            async with self.gate:
                pr = await self.runner.run(argv, wt, env=env, timeout=self.suite_timeout,
                                           stdout_path=os.path.join(self.dir, "results", f"{ci_id}.log"))
            res.suite_seconds = pr.seconds
            res.timed_out = pr.timed_out
            res.output = _excerpt(pr.stdout + ("\n" + pr.stderr if pr.stderr.strip() else ""))
            parsed = parse_junit_full(junit, wt)
            cases: list[tuple[str, str]] = []
            if parsed is not None:
                failing, passing, count, cases = parsed
                res.failing_tests, res.passing_files, res.tests = failing, passing, count
                res.failures = len(failing)
                res.failing_files = sorted({f["file"] for f in failing if f["file"]})
            res.green = (pr.returncode == 0 and not pr.timed_out and parsed is not None and not res.failing_tests)
            await self.observe(res, wt, sha, purpose, attempt, cases, bool(extra_files))
            if not res.green and res.failing_files:
                files = set(list_files(wt))
                union: set[str] = set()
                for f in res.failing_files:
                    depths = import_depths(wt, f, files)
                    res.read_depths[f] = depths
                    res.read_sets[f] = sorted(depths)
                    union |= set(depths)
                res.read_set = sorted(union)
                for t in res.failing_tests:
                    for p in stack_files(t.get("body", ""), wt):
                        if p not in res.stack_files:
                            res.stack_files.append(p)
                    t.pop("body", None)
            # emulated CI latency: the slot stays busy, as a real runner would
            wait = self.latency if latency is None else latency
            if wait > 0:
                await asyncio.sleep(wait)
        except asyncio.CancelledError:
            res.cancelled = True
            raise
        finally:
            res.ci_seconds = time.monotonic() - t0
            self.total_seconds += res.ci_seconds
            self.busy_by_purpose[purpose] = self.busy_by_purpose.get(purpose, 0.0) + res.ci_seconds
            self.runs += 1
            self.running -= 1
            self.free.put_nowait(slot)
        return res


    async def observe(self, res: CIResult, wt: str, sha: str, purpose: str, attempt: int | None,
                      cases: list[tuple[str, str]], extra: bool) -> None:
        """E3: number the attempt, inject a flake into a green run, apply the quarantine, update the history."""
        fl = self.flaker
        res.attempt = fl.next_attempt(sha, purpose) if attempt is None else attempt
        res.true_green = res.green
        if purpose in EXEMPT_PURPOSES or extra:
            return  # the final check (clean tree + every acceptance test) is the instrument, not the system
        if res.green and fl.should_flake(sha, purpose, res.attempt):
            victim = fl.pick_victim(sha, purpose, res.attempt, cases)
            if victim:
                fl.inject(res, wt, victim)
        if res.failing_files is None:
            return  # crashed or timed out before reporting: nothing to learn about individual tests
        failed = [test_id(t["file"], t["name"]) for t in res.failing_tests]
        passed = [i for i in (test_id(f, n) for f, n in cases) if i not in set(failed)]   # an injected victim did not pass
        res.quarantined = fl.apply_quarantine(res)
        res.flips = fl.book.record(await self.tree_id(sha), res.ci_id, passed, failed)


def _excerpt(text: str, limit: int = 7000) -> str:
    """Keep the failure-relevant tail of a spec-reporter log."""
    marker = text.find("failing tests:")
    if marker >= 0:
        text = text[marker:]
    if len(text) > limit:
        text = text[:limit] + f"\n... [{len(text) - limit} more chars]"
    return text
