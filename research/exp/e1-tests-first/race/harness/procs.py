"""Child-process management: every subprocess the race starts goes through ``run``.

* The working directory must sit inside the run's ``work/`` directory (``Sandbox``).
* Each child starts in its own session (process group); on timeout, cancellation or abort
  the whole process tree is terminated (SIGTERM, then SIGKILL after a grace period),
  including grandchildren that moved to another process group.
"""
from __future__ import annotations

import asyncio
import os
import signal
import subprocess
import time
from dataclasses import dataclass, field
from typing import Callable


class SandboxError(RuntimeError):
    pass


class Sandbox:
    """Confines subprocess working directories to one root."""

    def __init__(self, root: str):
        self.root = os.path.realpath(root)

    def check(self, path: str) -> str:
        real = os.path.realpath(path)
        if real != self.root and not real.startswith(self.root + os.sep):
            raise SandboxError(f"refusing to run outside {self.root}: {path}")
        return real


@dataclass
class ProcResult:
    argv: list[str]
    returncode: int | None
    stdout: str
    stderr: str
    timed_out: bool
    killed: bool
    seconds: float


def _descendants(root_pid: int) -> list[int]:
    """All live descendants of ``root_pid`` (via ps), deepest last."""
    try:
        out = subprocess.run(["ps", "-A", "-o", "pid=,ppid="], capture_output=True, text=True, timeout=5).stdout
    except Exception:
        return []
    children: dict[int, list[int]] = {}
    for line in out.splitlines():
        parts = line.split()
        if len(parts) != 2:
            continue
        try:
            pid, ppid = int(parts[0]), int(parts[1])
        except ValueError:
            continue
        children.setdefault(ppid, []).append(pid)
    found, frontier = [], [root_pid]
    while frontier:
        nxt = []
        for p in frontier:
            for c in children.get(p, []):
                if c not in found:
                    found.append(c)
                    nxt.append(c)
        frontier = nxt
    return found


def reap(pidfile: str, work: str) -> list[int]:
    """Kill leftover children of a dead orchestrator: pids in ``pidfile`` whose cwd is still inside ``work``."""
    killed = []
    try:
        pids = [int(x) for x in open(pidfile).read().split()]
    except (OSError, ValueError):
        return killed
    work = os.path.realpath(work)
    for pid in pids:
        try:
            cwd = subprocess.run(["lsof", "-a", "-p", str(pid), "-d", "cwd", "-Fn"], capture_output=True,
                                 text=True, timeout=10).stdout
        except Exception:
            continue
        paths = [ln[1:] for ln in cwd.splitlines() if ln.startswith("n")]
        if not paths or not os.path.realpath(paths[0]).startswith(work):
            continue  # gone, or a reused pid that isn't ours
        _signal_tree(pid, signal.SIGTERM, _descendants(pid))
        time.sleep(2)
        _signal_tree(pid, signal.SIGKILL, _descendants(pid))
        killed.append(pid)
    return killed


def _signal_tree(pid: int, sig: int, tree: list[int]) -> None:
    try:
        os.killpg(pid, sig)  # the child is a session leader: pgid == pid
    except (ProcessLookupError, PermissionError, OSError):
        pass
    for p in [pid, *tree]:
        try:
            os.kill(p, sig)
        except (ProcessLookupError, PermissionError, OSError):
            pass
        try:
            os.killpg(p, sig)  # grandchildren that became group leaders themselves
        except (ProcessLookupError, PermissionError, OSError):
            pass


class ProcRegistry:
    """Tracks live children so an abort can kill all of them. With ``pidfile`` the live set is mirrored to
    disk, so ``race.py --reap`` can clean up after an orchestrator that was SIGKILLed."""

    def __init__(self, grace: float = 3.0, pidfile: str | None = None):
        self.live: dict[int, asyncio.subprocess.Process] = {}
        self.grace = grace
        self.pidfile = pidfile

    def changed(self) -> None:
        if not self.pidfile:
            return
        try:
            with open(self.pidfile, "w") as fh:
                fh.write("".join(f"{pid}\n" for pid in self.live))
        except OSError:
            pass

    async def kill(self, proc: asyncio.subprocess.Process) -> None:
        if proc.returncode is not None:
            # the leader is gone; still reap stragglers left in its process group
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError, OSError):
                pass
            return
        tree = _descendants(proc.pid)
        _signal_tree(proc.pid, signal.SIGTERM, tree)
        try:
            await asyncio.wait_for(proc.wait(), timeout=self.grace)
        except (asyncio.TimeoutError, ProcessLookupError):
            pass
        tree = list(dict.fromkeys(tree + _descendants(proc.pid)))
        _signal_tree(proc.pid, signal.SIGKILL, tree)
        try:
            await asyncio.wait_for(proc.wait(), timeout=self.grace)
        except (asyncio.TimeoutError, ProcessLookupError):
            pass

    async def kill_all(self) -> int:
        procs = list(self.live.values())
        await asyncio.gather(*(self.kill(p) for p in procs), return_exceptions=True)
        self.live.clear()
        return len(procs)

    def kill_all_sync(self) -> None:
        """Last-resort cleanup from atexit / signal context (no event loop needed)."""
        for proc in list(self.live.values()):
            if proc.returncode is None:
                _signal_tree(proc.pid, signal.SIGKILL, _descendants(proc.pid))
        self.live.clear()


@dataclass
class Runner:
    sandbox: Sandbox
    registry: ProcRegistry = field(default_factory=ProcRegistry)

    async def run(self, argv: list[str], cwd: str, *, env: dict | None = None, timeout: float | None = None,
                  input_text: str | None = None, on_line: Callable[[str], None] | None = None,
                  stdout_path: str | None = None, stderr_path: str | None = None,
                  max_capture: int = 4_000_000) -> ProcResult:
        """Run ``argv`` with cwd inside the sandbox. ``on_line`` streams stdout lines as they arrive."""
        cwd = self.sandbox.check(cwd)
        t0 = time.monotonic()
        proc = await asyncio.create_subprocess_exec(
            *argv, cwd=cwd, env=env,
            stdin=asyncio.subprocess.PIPE if input_text is not None else asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            start_new_session=True, limit=64 * 1024 * 1024)
        self.registry.live[proc.pid] = proc
        self.registry.changed()
        out_chunks: list[str] = []
        err_chunks: list[str] = []
        out_fh = open(stdout_path, "w", encoding="utf-8") if stdout_path else None
        err_fh = open(stderr_path, "w", encoding="utf-8") if stderr_path else None
        captured = [0, 0]

        async def pump_out() -> None:
            assert proc.stdout is not None
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace")
                if out_fh:
                    out_fh.write(text)
                    out_fh.flush()
                if captured[0] < max_capture:
                    out_chunks.append(text)
                    captured[0] += len(text)
                if on_line:
                    try:
                        on_line(text)
                    except Exception:  # a broken progress callback must not kill the run
                        pass

        async def pump_err() -> None:
            assert proc.stderr is not None
            while True:
                chunk = await proc.stderr.read(65536)
                if not chunk:
                    break
                text = chunk.decode("utf-8", errors="replace")
                if err_fh:
                    err_fh.write(text)
                if captured[1] < max_capture:
                    err_chunks.append(text)
                    captured[1] += len(text)

        async def feed() -> None:
            if input_text is not None and proc.stdin is not None:
                try:
                    proc.stdin.write(input_text.encode("utf-8"))
                    await proc.stdin.drain()
                except (BrokenPipeError, ConnectionResetError):
                    pass
                finally:
                    proc.stdin.close()

        timed_out = killed = False
        work = asyncio.gather(feed(), pump_out(), pump_err(), proc.wait())
        try:
            if timeout is not None:
                await asyncio.wait_for(asyncio.shield(work), timeout=timeout)
            else:
                await work
        except asyncio.TimeoutError:
            timed_out = killed = True
            await self.registry.kill(proc)
            try:
                await asyncio.wait_for(work, timeout=5)
            except Exception:
                pass
        except asyncio.CancelledError:
            await self.registry.kill(proc)
            work.cancel()
            raise
        finally:
            self.registry.live.pop(proc.pid, None)
            self.registry.changed()
            if out_fh:
                out_fh.close()
            if err_fh:
                err_fh.close()
        if proc.returncode is not None and proc.returncode < 0:
            killed = True
        return ProcResult(argv=list(argv), returncode=None if timed_out else proc.returncode,
                          stdout="".join(out_chunks), stderr="".join(err_chunks),
                          timed_out=timed_out, killed=killed, seconds=time.monotonic() - t0)
