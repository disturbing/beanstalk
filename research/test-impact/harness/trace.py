"""Run a command under strace and turn the per-process logs into a file-access record.

The record has, per phase ("build" or "run"), three sets of absolute paths:
  reads  - files opened for reading, stat'ed, access()'ed, readlink'ed or exec'ed successfully
  probes - paths that were looked up but did not exist (ENOENT/ENOTDIR): negative dependencies,
           so that *adding* a file there later selects the test
  dirs   - directories that were opened (listed): adding or deleting a file inside selects the test
Phases come from the executable each process was running (language-specific classifier).
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass, field

STRACE = [
    "strace", "-f", "-ff", "--seccomp-bpf", "-qq", "-y", "-s", "256",
    "-e", "trace=%file,%process,chdir,fchdir",
]

LINE_RE = re.compile(r"^(\w+)\((.*)\)\s+=\s+(-?\d+|\?)(?:<[^>]*>)?(?:\s+(\w+))?")
STR_RE = re.compile(r'"((?:[^"\\]|\\.)*)"')
DIRFD_RE = re.compile(r"^(AT_FDCWD|\d+)<([^>]*)>,\s*")
CWD_RE = re.compile(r"AT_FDCWD<([^>]*)>")

READ_CALLS = {
    "openat", "open", "openat2", "newfstatat", "fstatat64", "stat", "lstat", "stat64", "lstat64",
    "statx", "access", "faccessat", "faccessat2", "readlink", "readlinkat", "execve", "execveat",
    "chdir", "statfs", "getxattr", "lgetxattr",
}
FORK_CALLS = {"clone", "clone3", "fork", "vfork"}
NEGATIVE = {"ENOENT", "ENOTDIR"}


@dataclass
class Phase:
    reads: set[str] = field(default_factory=set)
    probes: set[str] = field(default_factory=set)
    dirs: set[str] = field(default_factory=set)


@dataclass
class Trace:
    phases: dict[str, Phase]
    exit_code: int
    seconds: float
    processes: int


def _unescape(s: str) -> str:
    if "\\" not in s:
        return s
    return s.encode("latin-1", "backslashreplace").decode("unicode_escape").encode("latin-1").decode(
        "utf-8", "replace")


def _is_write_open(args: str) -> bool:
    return ("O_WRONLY" in args) or ("O_CREAT" in args and "O_RDWR" not in args) or "O_TRUNC" in args


def run_traced(cmd: list[str], cwd: str, env: dict, classify, workdir: str, timeout: float = 300) -> Trace:
    """Runs cmd under strace; classify(exe_path) -> 'build' | 'run'."""
    shutil.rmtree(workdir, ignore_errors=True)
    os.makedirs(workdir)
    prefix = os.path.join(workdir, "t")
    t0 = time.perf_counter()
    try:
        proc = subprocess.run(STRACE + ["-o", prefix, "--"] + cmd, cwd=cwd, env=env,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=timeout)
        code = proc.returncode
    except subprocess.TimeoutExpired:
        code = 124
    seconds = time.perf_counter() - t0
    phases, nproc = parse_dir(workdir, cwd, classify)
    shutil.rmtree(workdir, ignore_errors=True)
    return Trace(phases, code, seconds, nproc)


def parse_dir(workdir: str, root_cwd: str, classify):
    files = {}
    for name in os.listdir(workdir):
        if name.startswith("t."):
            files[int(name[2:])] = os.path.join(workdir, name)
    # Pass 1: process tree (parent of each child pid).
    parent: dict[int, int] = {}
    for pid, path in files.items():
        with open(path, errors="replace") as f:
            for line in f:
                m = LINE_RE.match(line)
                if m and m.group(1) in FORK_CALLS and m.group(3).isdigit() and int(m.group(3)) > 0:
                    parent[int(m.group(3))] = pid
    # Pass 2: events, in an order where parents come before children so exe/cwd inherit.
    exe_end: dict[int, str] = {}
    cwd_end: dict[int, str] = {}
    order = sorted(files, key=lambda p: _depth(p, parent))
    phases: dict[str, Phase] = {}
    for pid in order:
        par = parent.get(pid)
        exe = exe_end.get(par, "") if par else ""
        cwd = cwd_end.get(par, root_cwd) if par else root_cwd
        with open(files[pid], errors="replace") as f:
            for line in f:
                m = LINE_RE.match(line)
                if not m or m.group(1) not in READ_CALLS:
                    continue
                call, args, ret, err = m.groups()
                c = CWD_RE.search(args)
                if c:
                    cwd = c.group(1)
                d = DIRFD_RE.match(args)
                rest = args[d.end():] if d else args
                s = STR_RE.match(rest)
                if not s:
                    continue
                raw = _unescape(s.group(1))
                if raw == "" :
                    continue
                base = d.group(2) if d else cwd
                path = os.path.normpath(raw if raw.startswith("/") else os.path.join(base, raw))
                ok = ret != "-1"
                if call in ("execve", "execveat") and ok:
                    exe = path
                if call == "chdir" and ok:
                    cwd = path
                if call.startswith("open") and _is_write_open(args):
                    continue
                ph = phases.setdefault(classify(exe), Phase())
                if ok:
                    if call.startswith("open") and "O_DIRECTORY" in args:
                        ph.dirs.add(path)
                    else:
                        ph.reads.add(path)
                elif err in NEGATIVE:
                    ph.probes.add(path)
        exe_end[pid] = exe
        cwd_end[pid] = cwd
    return phases, len(files)


def _depth(pid: int, parent: dict[int, int]) -> int:
    d = 0
    while pid in parent and d < 10000:
        pid = parent[pid]
        d += 1
    return d
