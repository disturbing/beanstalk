#!/usr/bin/env python3
"""Prove the arena's properties, for every task and every designed coupling.

Per task:
  1. the acceptance tests FAIL on base (base + the task's acceptance_tests);
  2. base + the reference solution PASSES the full suite (this is the ref/tNNN branch);
  plus consistency checks: the patch applies to a pristine base with `git apply`, contains no
  test files, the branch is one commit on main whose message is the task title, its diff matches
  oracle_paths / oracle_modules, and the acceptance files on the branch equal the task JSON.

Per designed coupling (declared in the task JSON, both directions):
  3. semantic: `git merge-tree` of ref/tA and ref/tB is clean, each passes alone (property 2),
     and the merged tree FAILS at least one test;
  4. textual: `git merge-tree` of ref/tA and ref/tB reports a conflict, in at least one source file.

All work happens in a temporary clone of the repository (temp worktrees, removed afterwards), so
the bare repo is never modified. Prints a table and exits non-zero on any failure.
Python 3.11+, standard library only; needs git and node (25+) on PATH.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.dont_write_bytecode = True  # importing common/corpus.py must not write a cache outside the arena
ARENA = Path(__file__).resolve().parent
RESEARCH = ARENA.parent
DEFAULT_REPO = RESEARCH / "corpora" / "arena.git"
sys.path.insert(0, str(RESEARCH / "common"))
from corpus import classify  # noqa: E402  (file categories, shared with the corpus tooling)

KINDS = {"feature", "bug", "refactor", "chore"}
SUITE_BUDGET_SECONDS = 5.0
_git_lock = threading.Lock()  # worktree add/remove touch shared git metadata


def module_of(path: str) -> str:
    segs = path.split("/")[:-1]
    return "/".join(segs[:2]) if segs else "(root)"


def git(repo: Path, *args: str, check: bool = True, text: bool = True) -> subprocess.CompletedProcess:
    env = dict(os.environ, GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_SYSTEM=os.devnull)
    res = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=text, env=env)
    if check and res.returncode != 0:
        err = res.stderr if text else res.stderr.decode(errors="replace")
        raise RuntimeError(f"git {' '.join(args)} failed: {err.strip()}")
    return res


class Suite:
    def __init__(self, code: int, out: str, seconds: float):
        nums = {k: int(v) for k, v in re.findall(r"^ℹ (tests|pass|fail) (\d+)\s*$", out, re.M)}
        self.code, self.seconds, self.output = code, seconds, out
        self.tests, self.passed, self.failed = nums.get("tests", 0), nums.get("pass", 0), nums.get("fail", 0)
        names = re.findall(r"^\s*✖ (.+?)(?: \(\d+(?:\.\d+)?ms\))?\s*$", out, re.M)
        self.failing = sorted({n for n in names if n != "failing tests:"})

    @property
    def ok(self) -> bool:
        return self.code == 0 and self.failed == 0 and self.tests > 0


def run_suite(root: Path, files: list[str] | None = None, timeout: int = 180) -> Suite:
    started = time.monotonic()
    res = subprocess.run(["node", "--test", "--test-reporter=spec", *(files or [])], cwd=root,
                         capture_output=True, text=True, timeout=timeout, env=dict(os.environ, NO_COLOR="1"))
    return Suite(res.returncode, res.stdout + res.stderr, time.monotonic() - started)


class Worktrees:
    """Temporary worktrees of a (cloned) repository."""

    def __init__(self, repo: Path, root: Path):
        self.repo, self.root, self.count = repo, root, 0

    def add(self, ref: str) -> Path:
        with _git_lock:
            self.count += 1
            path = self.root / f"wt{self.count}"
            git(self.repo, "worktree", "add", "--detach", "-q", str(path), ref)
        return path

    def remove(self, path: Path) -> None:
        with _git_lock:
            git(self.repo, "worktree", "remove", "--force", str(path), check=False)

    def export_tree(self, tree: str) -> Path:
        with _git_lock:
            self.count += 1
            path = self.root / f"tree{self.count}"
        data = git(self.repo, "archive", "--format=tar", tree, text=False).stdout
        path.mkdir()
        with tarfile.open(fileobj=io.BytesIO(data)) as tar:
            try:
                tar.extractall(path, filter="data")
            except TypeError:  # Python 3.11.0-3.11.3 have no extraction filters
                tar.extractall(path)
        return path


# --------------------------------------------------------------------------------------------
# task checks
# --------------------------------------------------------------------------------------------

def check_schema(tasks: list[dict]) -> list[str]:
    errors, ids = [], {t["id"] for t in tasks}
    for t in tasks:
        tid = t.get("id", "?")
        for key in ("id", "title", "prompt", "acceptance_tests", "oracle_paths", "oracle_modules", "kind", "difficulty", "couplings"):
            if key not in t:
                errors.append(f"{tid}: missing field {key}")
        if errors and errors[-1].startswith(f"{tid}: missing"):
            continue
        if not re.fullmatch(r"t\d{3}", t["id"]):
            errors.append(f"{tid}: id must look like t001")
        if "\n" in t["title"] or not t["title"].strip():
            errors.append(f"{tid}: title must be one non-empty line")
        if not t["prompt"].strip():
            errors.append(f"{tid}: empty prompt")
        if t["kind"] not in KINDS:
            errors.append(f"{tid}: kind {t['kind']!r} not in {sorted(KINDS)}")
        if t["difficulty"] not in (1, 2, 3):
            errors.append(f"{tid}: difficulty must be 1-3")
        if not t["acceptance_tests"] or not all(p.endswith(".test.ts") for p in t["acceptance_tests"]):
            errors.append(f"{tid}: acceptance_tests must be non-empty .test.ts files")
        if sorted(t["oracle_modules"]) != sorted({module_of(p) for p in t["oracle_paths"]}):
            errors.append(f"{tid}: oracle_modules do not match oracle_paths")
        for c in t["couplings"]:
            other = next((o for o in tasks if o["id"] == c["with"]), None)
            if c["with"] not in ids or c["type"] not in ("semantic", "textual") or not c.get("note"):
                errors.append(f"{tid}: bad coupling {c}")
            elif not any(b["with"] == t["id"] and b["type"] == c["type"] for b in other["couplings"]):
                errors.append(f"{tid}: coupling with {c['with']} is not declared on {c['with']}")
    return errors


def validate_task(task: dict, repo: Path, wts: Worktrees, sol_dir: Path) -> dict:
    tid, ref = task["id"], f"refs/heads/ref/{task['id']}"
    row: dict = {"id": tid, "kind": task["kind"], "difficulty": task["difficulty"], "title": task["title"], "notes": []}

    # static checks on the branch and the patch
    if git(repo, "rev-parse", "--verify", "-q", ref, check=False).returncode != 0:
        row.update(ok=False, notes=[f"branch {ref} is missing"])
        return row
    commits = git(repo, "rev-list", f"main..{ref}").stdout.split()
    if len(commits) != 1:
        row["notes"].append(f"branch has {len(commits)} commits on top of main, expected 1")
    elif git(repo, "log", "-1", "--format=%s", ref).stdout.strip() != task["title"]:
        row["notes"].append("commit message is not the task title")
    elif git(repo, "rev-parse", f"{ref}~1").stdout.strip() != git(repo, "rev-parse", "main").stdout.strip():
        row["notes"].append("branch is not based on main")
    changed = sorted(git(repo, "diff", "--name-only", "main", ref).stdout.split())
    if changed != sorted(task["oracle_paths"]):
        row["notes"].append(f"oracle_paths differ from the branch diff ({sorted(set(changed) ^ set(task['oracle_paths']))[:3]})")
    row["files"], row["modules"] = len(changed), len({module_of(p) for p in changed})
    for rel, content in task["acceptance_tests"].items():
        shown = git(repo, "show", f"{ref}:{rel}", check=False)
        if shown.returncode != 0 or shown.stdout != content:
            row["notes"].append(f"{rel} on the branch differs from the task JSON")

    patch = sol_dir / f"{tid}.patch"
    patch_files = re.findall(r"^diff --git a/(\S+) b/", patch.read_text(encoding="utf-8"), re.M) if patch.exists() else []
    if not patch_files:
        row["notes"].append("solution patch is missing or empty")
    elif any(p.endswith(".test.ts") for p in patch_files):
        row["notes"].append("solution patch touches test files (acceptance tests come from the task JSON)")

    # 1. acceptance tests fail on base; the patch applies to a pristine base
    base = wts.add("refs/heads/main")
    try:
        if patch.exists() and git(base, "apply", "--check", str(patch), check=False).returncode != 0:
            row["notes"].append("patch does not apply to base with git apply")
        for rel, content in task["acceptance_tests"].items():
            (base / rel).parent.mkdir(parents=True, exist_ok=True)
            (base / rel).write_text(content, encoding="utf-8")
        acc = run_suite(base, sorted(task["acceptance_tests"]))
    finally:
        wts.remove(base)
    row["acc_on_base"] = acc
    row["acc_ok"] = acc.code != 0 and (acc.failed > 0 or acc.tests == 0 or bool(acc.failing))

    # 2. base + solution passes the full suite
    sol = wts.add(ref)
    try:
        full = run_suite(sol)
    finally:
        wts.remove(sol)
    row["suite"] = full
    row["sol_ok"] = full.ok
    row["ok"] = row["acc_ok"] and row["sol_ok"] and not row["notes"]
    return row


# --------------------------------------------------------------------------------------------
# coupling checks
# --------------------------------------------------------------------------------------------

def merge_tree(repo: Path, a: str, b: str) -> tuple[bool, str, list[str]]:
    """(clean, tree id, conflicted paths) for merging two refs."""
    res = git(repo, "merge-tree", "--write-tree", "--name-only", "--no-messages", a, b, check=False)
    if res.returncode not in (0, 1):
        raise RuntimeError(f"git merge-tree failed: {res.stderr.strip()}")
    lines = res.stdout.splitlines()
    return res.returncode == 0, lines[0], [l for l in lines[1:] if l.strip()]


def validate_coupling(pair: tuple[str, str, str], note: str, repo: Path, wts: Worktrees, rows: dict[str, dict]) -> dict:
    a, b, kind = pair
    out = {"pair": f"{a}+{b}", "type": kind, "note": note, "ok": False}
    clean, tree, conflicts = merge_tree(repo, f"refs/heads/ref/{a}", f"refs/heads/ref/{b}")
    out["merge"] = "clean" if clean else "CONFLICT"
    out["alone"] = f"{'pass' if rows[a]['sol_ok'] else 'FAIL'}/{'pass' if rows[b]['sol_ok'] else 'FAIL'}"
    if kind == "textual":
        sources = [p for p in conflicts if classify(p) == "source"]
        out["detail"] = ", ".join(conflicts) if conflicts else "-"
        out["ok"] = (not clean) and bool(sources)
        if clean:
            out["why"] = "merged without a conflict"
        elif not sources:
            out["why"] = "conflicts only in non-source files"
        return out
    # semantic
    if not clean:
        out["detail"] = ", ".join(conflicts)
        out["why"] = "merge is not clean"
        return out
    tree_dir = wts.export_tree(tree)
    try:
        suite = run_suite(tree_dir)
    finally:
        shutil.rmtree(tree_dir, ignore_errors=True)
    out["merged"] = suite
    out["detail"] = f"{suite.failed} failing of {suite.tests}: " + "; ".join(suite.failing[:2])
    out["ok"] = suite.code != 0 and suite.failed > 0 and rows[a]["sol_ok"] and rows[b]["sol_ok"]
    if suite.ok:
        out["why"] = "merged tree passes every test"
    elif not (rows[a]["sol_ok"] and rows[b]["sol_ok"]):
        out["why"] = "a side does not pass on its own"
    return out


# --------------------------------------------------------------------------------------------
# reporting
# --------------------------------------------------------------------------------------------

def table(headers: list[str], rows: list[list[str]]) -> str:
    widths = [max(len(h), *(len(r[i]) for r in rows)) if rows else len(h) for i, h in enumerate(headers)]
    line = lambda cells: "  ".join(c.ljust(w) for c, w in zip(cells, widths)).rstrip()
    return "\n".join([line(headers), line(["-" * w for w in widths]), *(line(r) for r in rows)])


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__.split("\n\n", 1)[1])
    ap.add_argument("--repo", type=Path, default=DEFAULT_REPO, help=f"arena bare repository (default: {DEFAULT_REPO})")
    ap.add_argument("--jobs", type=int, default=min(8, os.cpu_count() or 4), help="parallel test runs")
    ap.add_argument("--only", help="comma-separated task ids to validate (couplings need both ends)")
    ap.add_argument("--no-couplings", action="store_true", help="skip the coupling checks")
    ap.add_argument("--verbose", action="store_true", help="print test output for failures")
    args = ap.parse_args(argv)

    tasks = [json.loads(p.read_text(encoding="utf-8")) for p in sorted((ARENA / "tasks").glob("t*.json"))]
    errors = check_schema(tasks)
    if args.only:
        wanted = set(args.only.split(","))
        tasks = [t for t in tasks if t["id"] in wanted]
    if not tasks:
        print("no tasks found", file=sys.stderr)
        return 2

    tmp = Path(tempfile.mkdtemp(prefix="arena-validate-"))
    try:
        clone = tmp / "clone.git"
        subprocess.run(["git", "clone", "-q", "--bare", str(args.repo), str(clone)], check=True)
        wts = Worktrees(clone, tmp)

        # the base app on its own: all tests green, inside the time budget
        base_dir = wts.add("refs/heads/main")
        try:
            base_suite = run_suite(base_dir)
        finally:
            wts.remove(base_dir)

        with ThreadPoolExecutor(max_workers=args.jobs) as pool:
            results = list(pool.map(lambda t: validate_task(t, clone, wts, ARENA / "solutions"), tasks))
        rows = {r["id"]: r for r in results}

        # The 5 s budget applies to a quiet machine: time the heaviest branch serially, after the parallel phase.
        heaviest = max((r for r in results if r.get("suite")), key=lambda r: r["suite"].tests)
        heavy_dir = wts.add(f"refs/heads/ref/{heaviest['id']}")
        try:
            heavy_suite = run_suite(heavy_dir)
        finally:
            wts.remove(heavy_dir)

        pairs: dict[tuple[str, str, str], str] = {}
        for t in tasks:
            for c in t["couplings"]:
                key = (min(t["id"], c["with"]), max(t["id"], c["with"]), c["type"])
                pairs.setdefault(key, c["note"])
        pairs = {k: v for k, v in pairs.items() if k[0] in rows and k[1] in rows}
        couplings: list[dict] = []
        if not args.no_couplings:
            with ThreadPoolExecutor(max_workers=args.jobs) as pool:
                couplings = list(pool.map(lambda kv: validate_coupling(kv[0], kv[1], clone, wts, rows), sorted(pairs.items())))
    finally:
        subprocess.run(["git", "-C", str(tmp / "clone.git"), "worktree", "prune"], capture_output=True)
        shutil.rmtree(tmp, ignore_errors=True)

    # ---- report
    print(f"BASE  main: {base_suite.passed}/{base_suite.tests} tests pass in {base_suite.seconds:.1f}s (serial)")
    print(f"      heaviest branch ref/{heaviest['id']}: {heavy_suite.passed}/{heavy_suite.tests} tests in {heavy_suite.seconds:.1f}s (serial); "
          f"budget {SUITE_BUDGET_SECONDS:.0f}s. Times in the table below are measured with {args.jobs} runs in parallel.")
    print()
    body = []
    for r in results:
        acc, suite = r.get("acc_on_base"), r.get("suite")
        body.append([
            r["id"], r.get("kind", "?"), str(r.get("difficulty", "?")), str(r.get("files", "?")), str(r.get("modules", "?")),
            ("FAIL " + f"{acc.failed}/{acc.tests}" if acc and r["acc_ok"] else "PASSES!" if acc else "-"),
            (f"PASS {suite.passed}/{suite.tests} {suite.seconds:.1f}s" if suite and r["sol_ok"] else "FAILS" if suite else "-"),
            "ok" if r["ok"] else "FAIL", r["title"][:58],
        ])
    print(table(["task", "kind", "d", "files", "mods", "acceptance@base", "base+solution", "result", "title"], body))
    if couplings:
        print()
        cb = [[c["pair"], c["type"], c["merge"], c["alone"], c["detail"][:70] if c.get("detail") else "-", "ok" if c["ok"] else "FAIL: " + c.get("why", "?")]
              for c in couplings]
        print(table(["pair", "type", "merge", "alone(A/B)", "merged result / conflicting files", "result"], cb))

    failures = [f"schema: {e}" for e in errors]
    failures += [f"{r['id']}: " + ("; ".join(r["notes"]) or ("acceptance tests do not fail on base" if not r.get("acc_ok") else "solution does not pass the suite"))
                 for r in results if not r["ok"]]
    failures += [f"coupling {c['pair']} ({c['type']}): {c.get('why', 'failed')}" for c in couplings if not c["ok"]]
    if not base_suite.ok:
        failures.append("base: the app's own tests do not all pass")
    for label, suite in (("base", base_suite), (f"ref/{heaviest['id']}", heavy_suite)):
        if suite.seconds >= SUITE_BUDGET_SECONDS:
            failures.append(f"{label}: suite took {suite.seconds:.1f}s (budget {SUITE_BUDGET_SECONDS:.0f}s)")
    if args.verbose:
        for r in results:
            if not r["ok"] and r.get("suite") and not r["sol_ok"]:
                print("\n" + r["suite"].output[-2500:])
    print()
    sem = sum(1 for c in couplings if c["type"] == "semantic" and c["ok"])
    txt = sum(1 for c in couplings if c["type"] == "textual" and c["ok"])
    if failures:
        print(f"FAILED ({len(failures)}):")
        for f in failures:
            print("  -", f)
        return 1
    print(f"ALL PASS: {len(results)} tasks (acceptance fails on base, base+solution passes the suite), "
          f"{sem} semantic couplings (clean merge, tests break), {txt} textual couplings (conflict)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
