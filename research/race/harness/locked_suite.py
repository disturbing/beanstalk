#!/usr/bin/env python3
"""Run the arena's test suite (or chosen test files) under a machine-wide lock.

fastify's suite listens on fixed ports (3000 and others), so two suites on one machine at the same moment fail each
other with EADDRINUSE: parallel subagents, the other arm, the harness's own replay. Every local suite run of an
orchestrated race goes through this script (workers are told to use it, identically on both arms), which takes an
exclusive ``flock`` on one file for the whole machine, then runs ``node <node args> --test <globs or files>`` in the
current directory and exits with node's status.

    python3 locked_suite.py                      # the whole suite
    python3 locked_suite.py test/foo.test.js     # chosen files

The arena comes from ``$ORCH_ARENA`` (an arena directory with ``arena.json``); without it, a bare ``node --test``.
"""
from __future__ import annotations

import fcntl
import os
import subprocess
import sys
import time

LOCK = os.path.expanduser("~/Library/Caches/beanstalk-race/local-suite.lock")


class SuiteLock:
    """The machine-wide lock (blocking); ``waited`` is how long it took to get."""

    def __init__(self, path: str = LOCK):
        self.path, self.fh, self.waited = path, None, 0.0

    def __enter__(self) -> "SuiteLock":
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        self.fh = open(self.path, "w")
        t0 = time.monotonic()
        fcntl.flock(self.fh, fcntl.LOCK_EX)
        self.waited = time.monotonic() - t0
        return self

    def __exit__(self, *exc) -> None:
        if self.fh:
            fcntl.flock(self.fh, fcntl.LOCK_UN)
            self.fh.close()


def argv(files: list[str]) -> list[str]:
    arena = os.environ.get("ORCH_ARENA")
    node_args: list[str] = []
    test_args: list[str] = []
    if arena:
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from harness.suite import load_suite
        suite = load_suite(arena)
        node_args, test_args = list(suite.node_args), list(suite.test_args)
    return ["node", *node_args, "--test", *(files or test_args)]


def main() -> int:
    cmd = argv(sys.argv[1:])
    with SuiteLock() as lock:
        if lock.waited > 1:
            print(f"(waited {lock.waited:.0f} s for another test run on this machine)", file=sys.stderr, flush=True)
        return subprocess.run(cmd).returncode


if __name__ == "__main__":
    sys.exit(main())
