"""Emulated CI: K slots, each a detached worktree; a run = ``node --test`` on a commit, then S seconds."""
from __future__ import annotations

import asyncio
import os
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

from .arena import import_depths, list_files, stack_files
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


def parse_junit(path: str, root: str) -> tuple[list[dict], list[str], int] | None:
    """Parse node's junit reporter output into (failing tests, passing files, test count)."""
    try:
        tree = ET.parse(path)
    except (OSError, ET.ParseError):
        return None
    root_real = os.path.realpath(root)
    failing, passing, count = [], set(), 0
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
    return failing, sorted(passing), count


class CI:
    def __init__(self, git: Git, runner: Runner, work: str, slots: int, latency: float,
                 suite_timeout: float, test_timeout_ms: int = 60000, node: str = "node"):
        self.git, self.runner = git, runner
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
        self.ready = False
        self.gitdirs: dict[int, str] = {}

    async def setup(self, commit: str) -> None:
        os.makedirs(os.path.join(self.dir, "results"), exist_ok=True)
        for i in range(self.slots):
            wt = os.path.join(self.dir, f"slot-{i}")
            await self.git.add_worktree(wt, commit)
            # the slot's own admin dir: a second CI (v2's pre-land slots) also names its worktrees slot-N and git
            # de-duplicates admin names (slot-01, ...), so the lock path must not be guessed from N (fix from E2)
            self.gitdirs[i] = await self.git.git_dir(wt)
            self.free.put_nowait(i)
        self.ready = True

    def new_id(self) -> str:
        self.seq += 1
        return f"ci{self.seq:04d}"

    @property
    def idle_slots(self) -> int:
        return self.free.qsize()

    async def run(self, sha: str, purpose: str, *, ci_id: str | None = None, extra_files: dict[str, str] | None = None,
                  latency: float | None = None, on_start=None, only: list[str] | None = None) -> CIResult:
        """Run the suite on ``sha``. ``extra_files`` are written into the checkout first (final check).
        ``only`` (e1 targeted check): run just these test files, those present in the checkout."""
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
            argv = [self.node, "--test", f"--test-timeout={self.test_timeout_ms}",
                    "--test-reporter=spec", "--test-reporter-destination=stdout",
                    "--test-reporter=junit", f"--test-reporter-destination={junit}"]
            if only is not None:
                argv += [p for p in only if os.path.isfile(os.path.join(wt, p))]
            pr = await self.runner.run(argv, wt, env=env, timeout=self.suite_timeout,
                                       stdout_path=os.path.join(self.dir, "results", f"{ci_id}.log"))
            res.suite_seconds = pr.seconds
            res.timed_out = pr.timed_out
            res.output = _excerpt(pr.stdout + ("\n" + pr.stderr if pr.stderr.strip() else ""))
            parsed = parse_junit(junit, wt)
            if parsed is not None:
                failing, passing, count = parsed
                res.failing_tests, res.passing_files, res.tests = failing, passing, count
                res.failures = len(failing)
                res.failing_files = sorted({f["file"] for f in failing if f["file"]})
            res.green = (pr.returncode == 0 and not pr.timed_out and parsed is not None and not res.failing_tests)
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


def _excerpt(text: str, limit: int = 7000) -> str:
    """Keep the failure-relevant tail of a spec-reporter log."""
    marker = text.find("failing tests:")
    if marker >= 0:
        text = text[marker:]
    if len(text) > limit:
        text = text[:limit] + f"\n... [{len(text) - limit} more chars]"
    return text
