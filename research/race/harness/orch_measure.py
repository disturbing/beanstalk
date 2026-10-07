"""Measuring an orchestrated race from the forge side, after the fact (forge-agnostic).

* **Green per task** (secondary metric): replay the integration line's first-parent history from the base; on each
  commit, overlay the acceptance tests of every task not yet green (the arena's canonical files, whatever the agent
  committed) and run them; a task is green at the first commit where all its files pass. Its time is when that commit
  was integrated (GitHub: the merge; Beanstalk: the stalk promotion, else the landing).
* **Integration** (headline): per change (a PR or a bean), ready (pushed/enqueued) to integrated (merged / landed on
  the sprout / on the stalk), the rework integration caused (kick-outs, red checks, conflicts, re-pushes), throughput
  per 10 minutes and the most changes waiting at once, and the share of the wall time with a change waiting.

``events.jsonl`` and ``summary.json`` use the harness schema, so ``kth_green.py`` reads the run unchanged.
"""
from __future__ import annotations

import os
import shutil
import statistics
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field


@dataclass
class Change:
    """One unit the forge integrates: a pull request or a bean."""
    id: str
    task: str | None
    ready_at: float | None             # epoch: PR first enqueued / bean first pushed
    integrated_at: float | None        # epoch: merged to main / landed on the sprout
    stable_at: float | None = None     # Beanstalk: on the stalk
    created_at: float | None = None    # PR opened / first push
    kickouts: int = 0                  # removed from the queue without merging / red or conflict verdicts
    red_checks: int = 0
    conflicts: int = 0
    pushes: int = 1
    state: str = ""
    extra: dict = field(default_factory=dict)


def git(repo: str, *args: str, check: bool = True) -> str:
    res = subprocess.run(["git", *args], cwd=repo, capture_output=True, text=True)
    if check and res.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {res.stderr.strip()[:500]}")
    return res.stdout


def line_commits(repo: str, base: str, ref: str) -> list[tuple[str, float]]:
    """(sha, committer epoch) of the line's first-parent commits after ``base``, oldest first."""
    out = git(repo, "log", "--first-parent", "--reverse", "--format=%H %ct", f"{base}..{ref}")
    return [(sha, float(ts)) for sha, ts in (line.split() for line in out.splitlines() if line.strip())]


def run_files(checkout: str, argv_prefix: list[str], files: list[str], env: dict, timeout: float = 600
              ) -> tuple[set[str], set[str]]:
    """Run ``files`` with node's test runner; (passing files, failing files) from its junit report."""
    if not files:
        return set(), set()
    junit = os.path.join(os.path.dirname(checkout), f".{os.path.basename(checkout)}.xml")
    argv = argv_prefix + [f"--test-reporter=junit", f"--test-reporter-destination={junit}",
                          "--test-reporter=dot", "--test-reporter-destination=stdout", *files]
    try:
        subprocess.run(argv, cwd=checkout, capture_output=True, text=True, timeout=timeout, env=env)
    except subprocess.TimeoutExpired:
        return set(), set(files)
    passing, failing = set(), set()
    try:
        tree = ET.parse(junit)
    except (OSError, ET.ParseError):
        return set(), set(files)
    root = os.path.realpath(checkout)
    for case in tree.iter("testcase"):
        f = (case.get("file") or "").removeprefix("file://")
        rel = os.path.relpath(os.path.realpath(f), root) if f else ""
        bad = case.find("failure") is not None or case.find("error") is not None
        (failing if bad else passing).add(rel)
    passing -= failing
    seen = passing | failing
    failing |= {f for f in files if f not in seen}   # a file that never reported (crash, syntax error) is red
    return passing, failing


def replay_greens(repo: str, base: str, ref: str, tasks: dict[str, dict[str, str]], argv_prefix: list[str],
                  env: dict, deps: str | None, when: dict[str, float] | None = None
                  ) -> tuple[dict[str, tuple[str, float]], list[dict]]:
    """task -> (sha, epoch) of the first line commit where all its acceptance files pass; plus a log per commit."""
    when = when or {}
    green: dict[str, tuple[str, float]] = {}
    log: list[dict] = []
    scratch = tempfile.mkdtemp(prefix="orch-replay-", dir=os.path.dirname(os.path.abspath(repo)))
    if deps:
        os.symlink(deps, os.path.join(scratch, "node_modules"))
    wt = os.path.join(scratch, "wt")
    try:
        git(repo, "worktree", "add", "-q", "--detach", wt, base)
        for sha, ts in line_commits(repo, base, ref):
            pending = {t: files for t, files in tasks.items() if t not in green}
            if not pending:
                break
            git(wt, "checkout", "-q", "--force", "--detach", sha)
            git(wt, "clean", "-q", "-fdx", "-e", "node_modules")
            for files in pending.values():
                for path, content in files.items():
                    full = os.path.join(wt, path)
                    os.makedirs(os.path.dirname(full), exist_ok=True)
                    with open(full, "w", encoding="utf-8") as fh:
                        fh.write(content)
            all_files = sorted({p for files in pending.values() for p in files})
            passing, failing = run_files(wt, argv_prefix, all_files, env)
            now_green = [t for t, files in pending.items() if set(files) <= passing]
            at = when.get(sha, ts)
            for t in now_green:
                green[t] = (sha, at)
            log.append({"sha": sha, "at": at, "green": sorted(now_green), "failing_files": sorted(failing)})
    finally:
        git(repo, "worktree", "remove", "--force", wt, check=False)
        shutil.rmtree(scratch, ignore_errors=True)
    return green, log


def final_check(repo: str, ref: str, tasks: dict[str, dict[str, str]], suite_argv: list[str], argv_prefix: list[str],
                env: dict, deps: str | None) -> dict:
    """The whole suite, then every task's acceptance tests, on the line's final head (as the race's final check)."""
    scratch = tempfile.mkdtemp(prefix="orch-final-", dir=os.path.dirname(os.path.abspath(repo)))
    if deps:
        os.symlink(deps, os.path.join(scratch, "node_modules"))
    wt = os.path.join(scratch, "wt")
    sha = git(repo, "rev-parse", ref).strip()
    try:
        git(repo, "worktree", "add", "-q", "--detach", wt, sha)
        res = subprocess.run(suite_argv, cwd=wt, capture_output=True, text=True, timeout=1200, env=env)
        suite_green = res.returncode == 0
        if not suite_green:  # one retry, as the chain build allows a flaky red (the arena's suite has some)
            res = subprocess.run(suite_argv, cwd=wt, capture_output=True, text=True, timeout=1200, env=env)
            retried = True
        else:
            retried = False
        suite_green = res.returncode == 0
        failed_lines = [ln for ln in (res.stdout + res.stderr).splitlines() if ln.lstrip().startswith(("✖", "not ok"))]
        for files in tasks.values():
            for path, content in files.items():
                full = os.path.join(wt, path)
                os.makedirs(os.path.dirname(full), exist_ok=True)
                with open(full, "w", encoding="utf-8") as fh:
                    fh.write(content)
        passing, failing = run_files(wt, argv_prefix, sorted({p for f in tasks.values() for p in f}), env)
    finally:
        git(repo, "worktree", "remove", "--force", wt, check=False)
        shutil.rmtree(scratch, ignore_errors=True)
    accepted = {t: set(files) <= passing for t, files in tasks.items()}
    return {"sha": sha, "suite_green": suite_green, "suite_retried": retried, "suite_failed": failed_lines[:20],
            "tasks_accepted": sum(accepted.values()),
            "tasks_total": len(tasks), "per_task": accepted, "failing_files": sorted(failing)[:50]}


def _pct(xs: list[float], q: float) -> float | None:
    if not xs:
        return None
    s = sorted(xs)
    k = (len(s) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return round(s[lo] + (s[hi] - s[lo]) * (k - lo), 2)


def dist(xs: list[float]) -> dict:
    return {"n": len(xs), "median": _pct(xs, 0.5), "p90": _pct(xs, 0.9), "max": round(max(xs), 2) if xs else None}


def integration_metrics(changes: list[Change], start: float, end: float) -> dict:
    """Ready -> integrated per change, rework caused by integration, throughput and waiting share."""
    done = [c for c in changes if c.ready_at is not None and c.integrated_at is not None]
    waits = [c.integrated_at - c.ready_at for c in done]
    stable = [c.stable_at - c.ready_at for c in done if c.stable_at is not None]
    wall = max(1e-9, end - start)
    # intervals with at least one change waiting (ready, not yet integrated; unintegrated ones wait until the end)
    spans = sorted((max(start, c.ready_at), min(end, c.integrated_at if c.integrated_at is not None else end))
                   for c in changes if c.ready_at is not None)
    covered, cur_lo, cur_hi = 0.0, None, None
    for lo, hi in spans:
        if hi <= lo:
            continue
        if cur_hi is None or lo > cur_hi:
            if cur_hi is not None:
                covered += cur_hi - cur_lo
            cur_lo, cur_hi = lo, hi
        else:
            cur_hi = max(cur_hi, hi)
    if cur_hi is not None:
        covered += cur_hi - cur_lo
    points = sorted([(lo, 1) for lo, hi in spans if hi > lo] + [(hi, -1) for lo, hi in spans if hi > lo])
    depth = most = 0
    for _, step in points:
        depth += step
        most = max(most, depth)
    bins: dict[int, int] = {}
    for c in done:
        b = int((c.integrated_at - start) // 600)
        bins[b] = bins.get(b, 0) + 1
    per10 = [bins.get(i, 0) for i in range(int(wall // 600) + 1)]
    submitted = [c.integrated_at - (c.created_at or c.ready_at) for c in changes
                 if c.integrated_at is not None and (c.created_at or c.ready_at) is not None]
    return {
        "changes": len(changes), "integrated": len(done),
        "submitted_to_integrated_s": dist(submitted),
        "ready_to_integrated_s": dist(waits),
        "ready_to_stable_s": dist(stable) if stable else None,
        "waiting_share_of_wall": round(covered / wall, 4),
        "mean_changes_waiting": round(sum(waits) / wall, 3),
        "max_changes_waiting": most,
        "integrated_per_10min": per10,
        "kickouts": sum(c.kickouts for c in changes),
        "red_checks": sum(c.red_checks for c in changes),
        "conflicts": sum(c.conflicts for c in changes),
        "repushes": sum(max(0, c.pushes - 1) for c in changes),
    }


def mean(xs: list[float]) -> float | None:
    return round(statistics.fmean(xs), 2) if xs else None
