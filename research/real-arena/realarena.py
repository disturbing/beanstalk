"""Shared pieces of the real-task arena builder: an arena's config, its upstream clone, git and the suite.

An arena lives in ``research/real-arena/<name>/`` and is described by its ``arena.json``: the upstream repository,
the base and end commits of the window, which paths are source and which are tests, and the suite settings the
race harness reads (``research/race/harness/suite.py``). The upstream clone is ``upstream/<name>`` (git-ignored;
``build.py clone`` makes it).
"""
from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import sys
import time
from dataclasses import dataclass

HERE = os.path.dirname(os.path.abspath(__file__))
RACE = os.path.normpath(os.path.join(HERE, "..", "race"))
sys.path.insert(0, RACE)
from harness import suite as suite_mod  # noqa: E402
from harness.ci import parse_junit  # noqa: E402

FIXED_ENV = {"GIT_AUTHOR_NAME": "arena", "GIT_AUTHOR_EMAIL": "arena@beanstalk.invalid",
             "GIT_COMMITTER_NAME": "arena", "GIT_COMMITTER_EMAIL": "arena@beanstalk.invalid",
             "GIT_AUTHOR_DATE": "2026-10-07T00:00:00Z", "GIT_COMMITTER_DATE": "2026-10-07T00:00:00Z"}


@dataclass
class Arena:
    dir: str
    raw: dict

    @property
    def name(self) -> str:
        return self.raw["name"]

    @property
    def upstream_dir(self) -> str:
        return os.path.join(HERE, "upstream", self.name)

    @property
    def suite(self) -> suite_mod.SuiteConfig:
        return suite_mod.load_suite(self.dir)

    def is_source(self, path: str) -> bool:
        return bool(re.search(self.raw["source_re"], path))

    def is_test(self, path: str) -> bool:
        return bool(re.search(self.raw["test_re"], path)) and not self.is_excluded_test(path)

    def is_excluded_test(self, path: str) -> bool:
        ex = self.raw.get("test_exclude_re")
        return bool(ex and re.search(ex, path))

    def path(self, *parts: str) -> str:
        return os.path.join(self.dir, *parts)

    def git(self, *args: str, cwd: str | None = None, check: bool = True, input_text: str | None = None,
            fixed: bool = False) -> subprocess.CompletedProcess:
        return git(*args, cwd=cwd or self.upstream_dir, check=check, input_text=input_text, fixed=fixed)


def load(arena_dir: str) -> Arena:
    arena_dir = os.path.abspath(arena_dir)
    with open(os.path.join(arena_dir, "arena.json"), encoding="utf-8") as fh:
        return Arena(arena_dir, json.load(fh))


def git(*args: str, cwd: str, check: bool = True, input_text: str | None = None,
        fixed: bool = False) -> subprocess.CompletedProcess:
    env = dict(os.environ, **FIXED_ENV) if fixed else None
    p = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, input=input_text, env=env)
    if check and p.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {p.stderr.strip()[:1500]}")
    return p


@dataclass
class SuiteRun:
    green: bool
    failing_files: list[str]
    failing_tests: list[dict]
    tests: int
    seconds: float
    output: str


def run_suite(cfg: suite_mod.SuiteConfig, wt: str, junit: str, *, wrapper: list[str] | None = None,
              timeout: float = 240) -> SuiteRun:
    """The arena's full suite in ``wt`` (``wrapper`` prefixes the argv, e.g. an offline sandbox)."""
    env = cfg.run_env()
    env.pop("NODE_OPTIONS", None)
    env["CI"] = "1"
    if os.path.exists(junit):
        os.remove(junit)
    t0 = time.monotonic()
    if cfg.build:
        b = subprocess.run(list(cfg.build), cwd=wt, capture_output=True, text=True, env=env, timeout=timeout)
        if b.returncode != 0:
            return SuiteRun(False, ["(build)"], [], 0, time.monotonic() - t0, b.stdout + b.stderr)
    argv = (wrapper or []) + cfg.test_argv(test_timeout_ms=60000, reporters=[("dot", "stdout"), ("junit", junit)])
    proc = subprocess.Popen(argv, cwd=wt, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env,
                            start_new_session=True)
    try:
        out, err = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:  # a hung test file: kill the whole tree, the run is red
        os.killpg(proc.pid, signal.SIGKILL)
        out, err = proc.communicate()
        return SuiteRun(False, ["(timeout)"], [], 0, time.monotonic() - t0, (out + err)[-4000:])
    p = subprocess.CompletedProcess(argv, proc.returncode, out, err)
    seconds = time.monotonic() - t0
    parsed = parse_junit(junit, wt)
    if parsed is None:
        return SuiteRun(False, ["(no junit)"], [], 0, seconds, (p.stdout + p.stderr)[-4000:])
    failing, _, count = parsed
    files = sorted({f["file"] for f in failing if f["file"]})
    for f in failing:
        f.pop("body", None)
    return SuiteRun(p.returncode == 0 and not failing, files, failing, count, seconds, (p.stdout + p.stderr)[-4000:])

