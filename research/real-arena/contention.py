#!/usr/bin/env python3
"""Contention profile of a real-task arena, next to the designed (synthetic) arena's, measured the same way.

For every task: the files it touches (solution + acceptance tests) and its source files. Then, over all pairs:

  * share a source file      both reference changes edit the same source file
  * line overlap             the reference changes touch the same lines (each changed or deleted base line, and
                             for a pure insertion the lines on either side of it, +-1). A real arena is measured on
                             its chain: task j's lines in S_{j-1} are blamed, and a line last written by task i's
                             chain commit makes (i, j) a pair. The designed arena's tasks all start from the base, so
                             there the old-side line ranges of both patches are intersected
  * textual conflict         ``git merge-tree`` of the two tasks' changes, each re-based onto the common base (a
                             real task that does not re-base because it builds on an earlier task is "dependent"
                             and counted with its prerequisite through line overlap instead)

The headline is the share of tasks that touch lines another task writes (doc 17's "line overlap"), and the pairs.
Writes <arena>/profile.json and adds a ``contention`` block to every tasks/<id>.json (expected overlap).

Usage:
  python3 contention.py fastify                  # real arena (needs upstream/fastify)
  python3 contention.py --synthetic              # research/arena (materializes it in a temp repo)
"""
from __future__ import annotations

import argparse
import itertools
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter, defaultdict

import realarena as R

HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")
SYNTH = os.path.normpath(os.path.join(R.HERE, "..", "arena"))


def touched_old_lines(patch: str) -> dict[str, set[int]]:
    """Old-side lines a patch changes: removed lines, and both neighbours of every insertion point (+-1)."""
    out: dict[str, set[int]] = defaultdict(set)
    path = None
    old = 0
    for line in patch.splitlines():
        if line.startswith("diff --git "):
            path = None
        elif line.startswith("--- "):
            p = line[4:].strip()
            path = None if p == "/dev/null" else re.sub(r"^a/", "", p)
        elif line.startswith("+++ ") and path is None:
            path = None  # an added file has no old lines
        elif (m := HUNK.match(line)) and path:
            old = int(m.group(1))
            if m.group(2) == "0":  # pure insertion after line `old`
                out[path].update({old, old + 1})
        elif path and line.startswith("-") and not line.startswith("---"):
            out[path].update({old - 1, old, old + 1})
            old += 1
        elif path and line.startswith("+") and not line.startswith("+++"):
            out[path].update({old - 1, old})
        elif path and line.startswith(" "):
            old += 1
    return {p: {x for x in s if x > 0} for p, s in out.items()}


def diff_paths(patch: str) -> list[str]:
    return sorted(set(re.findall(r"^diff --git a/(\S+) b/", patch, re.M)))


class Repo:
    def __init__(self, path: str):
        self.path = path

    def git(self, *args: str, check: bool = True, input_text: str | None = None) -> subprocess.CompletedProcess:
        return R.git(*args, cwd=self.path, check=check, input_text=input_text, fixed=True)


def load_tasks(arena_dir: str) -> list[dict]:
    out = []
    for name in sorted(os.listdir(os.path.join(arena_dir, "tasks"))):
        if name.endswith(".json"):
            with open(os.path.join(arena_dir, "tasks", name), encoding="utf-8") as fh:
                t = json.load(fh)
            with open(os.path.join(arena_dir, "solutions", f"{t['id']}.patch"), encoding="utf-8") as fh:
                t["_patch"] = fh.read()
            t["_own"], t["_background"] = t["_patch"], ""
            own = os.path.join(arena_dir, "solutions", f"{t['id']}.own.diff")
            if os.path.exists(own):  # a task whose reference carries folded background commits
                with open(own, encoding="utf-8") as fh:
                    t["_own"] = fh.read()
                with open(os.path.join(arena_dir, "solutions", f"{t['id']}.background.diff"), encoding="utf-8") as fh:
                    t["_background"] = fh.read()
            out.append(t)
    return out


def commit_task(repo: Repo, wt: str, parent: str, task: dict, strip: int, prefix: str = "",
                patch: str | None = None, acceptance: bool = True) -> str:
    """parent + the task's solution patch (or ``patch``) + its acceptance tests, one commit."""
    repo.git("checkout", "-q", "-f", "--detach", parent) if wt == repo.path else R.git(
        "checkout", "-q", "-f", "--detach", parent, cwd=wt)
    R.git("clean", "-q", "-fdx", cwd=wt)
    with tempfile.NamedTemporaryFile("w", suffix=".patch", delete=False) as fh:
        fh.write(task["_patch"] if patch is None else patch)
    try:
        R.git("apply", "--whitespace=nowarn", f"-p{strip}", fh.name, cwd=wt)
    finally:
        os.remove(fh.name)
    for path, content in (task["acceptance_tests"] if acceptance else {}).items():
        full = os.path.join(wt, prefix + path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as f2:
            f2.write(content)
    R.git("add", "-A", cwd=wt)
    R.git("commit", "-q", "--allow-empty", "--no-verify", "-m", task["id"], cwd=wt, fixed=True)
    return R.git("rev-parse", "HEAD", cwd=wt).stdout.strip()


def merge_tree(repo: Repo, base: str, x: str, y: str) -> tuple[str | None, list[str]]:
    p = repo.git("merge-tree", "--write-tree", "--name-only", "--no-messages", f"--merge-base={base}", x, y,
                 check=False)
    lines = p.stdout.splitlines()
    if p.returncode == 0:
        return lines[0].strip(), []
    if p.returncode == 1:
        return None, sorted({ln.strip() for ln in lines[1:] if ln.strip()})
    raise RuntimeError(p.stderr)


def blame_owners(repo: Repo, rev: str, path: str, lines: set[int], owner_of: dict[str, str]) -> set[str]:
    p = repo.git("blame", "--porcelain", rev, "--", path, check=False)
    if p.returncode != 0:
        return set()
    owners, lineno = set(), 0
    for ln in p.stdout.splitlines():
        parts = ln.split()
        if len(parts) >= 3 and re.fullmatch(r"[0-9a-f]{40}", parts[0]):
            lineno = int(parts[2])
            if lineno in lines and parts[0] in owner_of:
                owners.add(owner_of[parts[0]])
    return owners


def profile(tasks: list[dict], files: dict[str, set[str]], src: dict[str, set[str]],
            line_pairs: set[tuple[str, str]], conflicts: list, dependent: dict[str, list[str]],
            standalone: list[str]) -> dict:
    ids = [t["id"] for t in tasks]
    n = len(ids)
    pairs = list(itertools.combinations(ids, 2))
    share_src = [(x, y) for x, y in pairs if src[x] & src[y]]
    in_line = {t for p in line_pairs for t in p}
    in_src = {t for p in share_src for t in p}
    in_conf = {t for (p, _) in conflicts for t in p}
    touch = Counter(f for s in src.values() for f in s)
    conf_files = Counter(f for _, cf in conflicts for f in cf)
    sa_pairs = len(list(itertools.combinations(standalone, 2)))
    return {
        "tasks": n, "pairs": len(pairs),
        "avg_files": round(sum(map(len, files.values())) / n, 2) if n else 0,
        "avg_source_files": round(sum(map(len, src.values())) / n, 2) if n else 0,
        "tasks_touching_lines_another_task_writes": {"tasks": len(in_line), "share": round(len(in_line) / n, 3)},
        "tasks_sharing_a_source_file": {"tasks": len(in_src), "share": round(len(in_src) / n, 3)},
        "line_overlap_pairs": sorted([list(p) for p in line_pairs]),
        "pairs_sharing_a_source_file": {"pairs": len(share_src), "share": round(len(share_src) / len(pairs), 3)},
        "dependent_tasks": {k: v for k, v in sorted(dependent.items())},
        "textual_conflicts": {
            "standalone_tasks": len(standalone), "standalone_pairs": sa_pairs, "conflicting_pairs": len(conflicts),
            "rate": round(len(conflicts) / sa_pairs, 3) if sa_pairs else 0,
            "tasks_in_a_conflict": len(in_conf),
            "most_conflicted_files": conf_files.most_common(8),
            "pairs": [[p[0], p[1], cf] for p, cf in conflicts]},
        "source_touch": {f: c for f, c in touch.most_common()},
    }


# ---- the real arena (chain) ----------------------------------------------------------------------------------

def real(arena_dir: str) -> dict:
    a = R.load(arena_dir)
    tasks = load_tasks(a.dir)
    base = a.raw["base"]
    repo = Repo(a.upstream_dir)
    work = os.path.join(R.HERE, ".work", a.name)
    os.makedirs(work, exist_ok=True)
    wt = os.path.join(work, "profile")
    if os.path.exists(wt):
        repo.git("worktree", "remove", "--force", wt, check=False)
    repo.git("worktree", "prune")
    repo.git("worktree", "add", "-q", "--detach", wt, base)
    try:
        # the build's chain, reproduced: background folds (owned by no task), then the task's own change and
        # its acceptance tests (owned by the task)
        chain, pre, prev, owner_of = {}, {}, base, {}
        for t in tasks:
            if t["_background"]:
                prev = commit_task(repo, wt, prev, t, 1, patch=t["_background"], acceptance=False)
            pre[t["id"]] = prev
            prev = chain[t["id"]] = commit_task(repo, wt, prev, t, 1, patch=t["_own"])
            owner_of[prev] = t["id"]
        line_pairs: set[tuple[str, str]] = set()
        for t in tasks:
            for path, lines in touched_old_lines(t["_own"]).items():
                if not a.is_source(path):
                    continue
                for owner in blame_owners(repo, pre[t["id"]], path, lines, owner_of):
                    line_pairs.add((owner, t["id"]))
        refs, dependent = {}, {}
        for t in tasks:
            tree, cf = merge_tree(repo, pre[t["id"]], base, chain[t["id"]])
            if tree is None:
                dependent[t["id"]] = sorted({o for o, j in line_pairs if j == t["id"]}) or ["(conflict: " +
                                                                                           ", ".join(cf) + ")"]
                continue
            refs[t["id"]] = repo.git("commit-tree", tree, "-p", base, input_text=t["id"]).stdout.strip()
        conflicts = []
        for x, y in itertools.combinations(sorted(refs), 2):
            tree, cf = merge_tree(repo, base, refs[x], refs[y])
            if tree is None:
                conflicts.append(((x, y), cf))
    finally:
        repo.git("worktree", "remove", "--force", wt, check=False)
    files = {t["id"]: set(diff_paths(t["_own"])) | set(t["acceptance_tests"]) for t in tasks}
    src = {t["id"]: {p for p in diff_paths(t["_own"]) if a.is_source(p)} for t in tasks}
    out = profile(tasks, files, src, line_pairs, conflicts, dependent, sorted(refs))
    out["arena"] = a.name
    out["method"] = ("chain: line overlap by blame on the state before each task's own change (background folds "
                     "belong to no task); conflicts between tasks' own changes re-based onto the base")
    # per-task expected overlap, written into the task files
    for t in tasks:
        tid = t["id"]
        others_src = sorted(o["id"] for o in tasks if o["id"] != tid and src[tid] & src[o["id"]])
        block = {"source_files": sorted(src[tid]),
                 "shares_a_source_file_with": others_src,
                 "writes_lines_written_by": sorted(i for i, j in line_pairs if j == tid),
                 "lines_rewritten_by": sorted(j for i, j in line_pairs if i == tid),
                 "textual_conflicts_with": sorted({p[1] if p[0] == tid else p[0] for p, _ in conflicts if tid in p}),
                 "depends_on_window": tid in dependent}
        path = os.path.join(a.dir, "tasks", f"{tid}.json")
        with open(path, encoding="utf-8") as fh:
            raw = json.load(fh)
        raw["contention"] = block
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(raw, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
    return out


# ---- the designed arena ---------------------------------------------------------------------------------------

def synth_source(path: str) -> bool:
    """Source lines only, as for a real arena (CHANGELOG.md and README.md lines are not contention)."""
    return path.startswith("src/") and not path.endswith(".test.ts")


def synthetic() -> dict:
    tasks = load_tasks(SYNTH)
    tmp = tempfile.mkdtemp(prefix="synth-profile-")
    try:
        shutil.copytree(os.path.join(SYNTH, "app"), tmp, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns("node_modules"))
        repo = Repo(tmp)
        repo.git("init", "-q", "-b", "main")
        repo.git("add", "-A")
        repo.git("commit", "-q", "-m", "base")
        base = repo.git("rev-parse", "HEAD").stdout.strip()
        refs = {t["id"]: commit_task(repo, tmp, base, t, 1, prefix="") for t in tasks}
        conflicts = []
        for x, y in itertools.combinations(sorted(refs), 2):
            tree, cf = merge_tree(repo, base, refs[x], refs[y])
            if tree is None:
                conflicts.append(((x, y), cf))
        lines = {t["id"]: {p: ls for p, ls in touched_old_lines(t["_patch"]).items() if synth_source(p)}
                 for t in tasks}
        line_pairs = set()
        for x, y in itertools.combinations(sorted(lines), 2):
            if any(lines[x][p] & lines[y].get(p, set()) for p in lines[x]):
                line_pairs.add((x, y))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    files = {t["id"]: set(t.get("oracle_paths") or diff_paths(t["_patch"])) for t in tasks}
    src = {t["id"]: {p for p in diff_paths(t["_patch"]) if synth_source(p)} for t in tasks}
    out = profile(tasks, files, src, line_pairs, conflicts, {}, sorted(refs))
    out["arena"] = "designed (research/arena)"
    out["method"] = "every task from the base: line overlap by intersecting old-side line ranges; merge-tree of all pairs"
    return out


def summary(p: dict) -> str:
    tc = p["textual_conflicts"]
    lo, ss = p["tasks_touching_lines_another_task_writes"], p["tasks_sharing_a_source_file"]
    return (f"{p['arena']}: {p['tasks']} tasks; touch lines another task writes {lo['tasks']} "
            f"({100 * lo['share']:.0f}%), line-overlap pairs {len(p['line_overlap_pairs'])}; share a source file "
            f"{ss['tasks']} tasks ({100 * ss['share']:.0f}%), {p['pairs_sharing_a_source_file']['pairs']} pairs; "
            f"textual conflicts {tc['conflicting_pairs']} of {tc['standalone_pairs']} pairs "
            f"({100 * tc['rate']:.1f}%) among {tc['standalone_tasks']} standalone tasks; dependent tasks "
            f"{len(p['dependent_tasks'])}; files/task {p['avg_files']} (source {p['avg_source_files']})")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], epilog=__doc__.split("\n\n", 1)[1],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("arena", nargs="?", help="real arena name or path")
    ap.add_argument("--synthetic", action="store_true", help="profile research/arena too (or only)")
    ns = ap.parse_args()
    out = {}
    if ns.synthetic:
        out["designed"] = synthetic()
        print(summary(out["designed"]))
    if ns.arena:
        path = ns.arena if os.sep in ns.arena else os.path.join(R.HERE, ns.arena)
        prof = real(path)
        print(summary(prof))
        if "designed" in out:
            prof["designed_arena_for_comparison"] = {k: v for k, v in out["designed"].items()
                                                     if k not in ("line_overlap_pairs", "source_touch")}
            prof["designed_arena_for_comparison"]["textual_conflicts"] = {
                k: v for k, v in out["designed"]["textual_conflicts"].items() if k != "pairs"}
        with open(os.path.join(path, "profile.json"), "w", encoding="utf-8") as fh:
            json.dump(prof, fh, indent=1)
            fh.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
