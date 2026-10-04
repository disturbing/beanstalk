#!/usr/bin/env python3
"""Contention profile of the real arena: how the window's tasks overlap, measured like arena/contention.py.

Over every pair of ref/<id> branches in the bare repository (base + acceptance tests + reference solution):
  * files per change, source-file touch distribution, pairs sharing a source file;
  * textual conflicts (``git merge-tree --write-tree``) by overlap class (share a source file / share only
    test-side files / disjoint) and the most conflicted files;
  * with --semantic: every pair that merges cleanly is checked out and the full suite is run on it (the arena's
    build + node --test, at most --concurrency test files at a time, one pair at a time); a red suite is a
    semantic break ("merges cleanly, fails tests").

Writes profile.json next to this script. Usage: python3 contention.py [--semantic]
"""
from __future__ import annotations

import argparse
import itertools
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", "real-arena.git"))
sys.path.insert(0, os.path.normpath(os.path.join(HERE, "..", "race")))
from harness import suite as suite_mod  # noqa: E402


def git(*args: str, cwd: str = REPO, check: bool = True, input_text: str | None = None) -> subprocess.CompletedProcess:
    p = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, input=input_text,
                       env=dict(os.environ, GIT_AUTHOR_NAME="p", GIT_AUTHOR_EMAIL="p@x", GIT_COMMITTER_NAME="p",
                                GIT_COMMITTER_EMAIL="p@x"))
    if check and p.returncode not in (0, 1):
        raise RuntimeError(p.stderr)
    return p


def pct(n: int, d: int) -> str:
    return f"{n} ({100 * n / d:.1f}%)" if d else "0"


def run_suite(cfg: suite_mod.SuiteConfig, wt: str, junit: str) -> tuple[bool, list[str]]:
    env = cfg.run_env()
    env.pop("NODE_OPTIONS", None)
    env["CI"] = "1"
    b = subprocess.run(list(cfg.build), cwd=wt, capture_output=True, text=True, env=env) if cfg.build else None
    if b is not None and b.returncode != 0:
        return False, ["(build)"]
    p = subprocess.run(cfg.test_argv(reporters=[("dot", "stdout"), ("junit", junit)]), cwd=wt, capture_output=True,
                       text=True, env=env, timeout=600)
    parsed = cfg.parse_junit(junit, wt)
    failing = sorted({f["file"] for f in parsed[0]}) if parsed else ["(no junit)"]
    return p.returncode == 0 and parsed is not None and not parsed[0], failing


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--repo", default=REPO)
    ap.add_argument("--semantic", action="store_true", help="run the suite on every cleanly merging pair")
    a = ap.parse_args()
    with open(os.path.join(HERE, "window.json"), encoding="utf-8") as fh:
        win = json.load(fh)
    base = win["base"]
    tasks = {}
    for t in win["tasks"]:
        with open(os.path.join(HERE, "tasks", f"{t['id']}.json"), encoding="utf-8") as fh:
            tasks[t["id"]] = json.load(fh)
    ids = sorted(tasks)
    n = len(ids)
    files = {i: set(git("diff", "--name-only", base, f"refs/heads/ref/{i}", cwd=a.repo).stdout.split()) for i in ids}
    src = {i: {f for f in fs if f.startswith(("src/", "bin/"))} for i, fs in files.items()}
    out: dict = {"tasks": n, "base": base, "avg_files": round(sum(map(len, files.values())) / n, 2),
                 "avg_source_files": round(sum(map(len, src.values())) / n, 2)}
    touch = Counter(f for s in src.values() for f in s)
    out["source_touch"] = {f: {"tasks": c, "share": round(c / n, 3)} for f, c in touch.most_common()}
    pairs = list(itertools.combinations(ids, 2))
    classes, class_conf, conflicting, conf_files = Counter(), Counter(), [], Counter()
    clean = []
    for x, y in pairs:
        r = git("merge-tree", "--write-tree", "--name-only", "--no-messages", f"refs/heads/ref/{x}",
                f"refs/heads/ref/{y}", cwd=a.repo)
        cls = "source-file" if src[x] & src[y] else "test-side-file" if files[x] & files[y] else "disjoint"
        classes[cls] += 1
        if r.returncode == 1:
            cf = [ln for ln in r.stdout.splitlines()[1:] if ln.strip()]
            class_conf[cls] += 1
            conflicting.append(((x, y), cf))
            conf_files.update(cf)
        else:
            clean.append(((x, y), r.stdout.splitlines()[0].strip()))
    out["pairs"] = {"total": len(pairs), "share_source_file": sum(1 for x, y in pairs if src[x] & src[y]),
                    "share_any_file": sum(1 for x, y in pairs if files[x] & files[y])}
    in_conflict = {t for (p, _) in conflicting for t in p}
    out["textual_conflicts"] = {
        "conflicting": len(conflicting), "rate": round(len(conflicting) / len(pairs), 3),
        "by_overlap_class": {k: {"pairs": classes[k], "conflicts": class_conf[k],
                                 "rate": round(class_conf[k] / classes[k], 3) if classes[k] else 0}
                             for k in ("source-file", "test-side-file", "disjoint")},
        "most_conflicted_files": conf_files.most_common(8),
        "tasks_never_in_a_textual_conflict": sum(1 for i in ids if i not in in_conflict),
        "pairs_list": [[p[0], p[1], cf] for p, cf in conflicting]}
    if a.semantic:
        cfg = suite_mod.load_suite(HERE)
        suite_mod.activate(cfg)
        work = tempfile.mkdtemp(prefix="semantic-", dir=os.path.join(HERE, ".."))
        if cfg.deps:
            os.symlink(cfg.deps, os.path.join(work, "node_modules"))
        wt = os.path.join(work, "wt")
        git("worktree", "add", "-q", "--detach", wt, base, cwd=a.repo)
        broken, t0 = [], time.monotonic()
        try:
            for k, ((x, y), tree) in enumerate(clean, 1):
                commit = git("commit-tree", tree, "-p", f"refs/heads/ref/{x}", "-p", f"refs/heads/ref/{y}",
                             cwd=a.repo, input_text=f"pair {x} {y}\n").stdout.strip()
                git("checkout", "-q", "-f", "--detach", commit, cwd=wt)
                git("clean", "-q", "-fdx", cwd=wt)
                green, failing = run_suite(cfg, wt, os.path.join(work, "junit.xml"))
                if not green:
                    broken.append([x, y, failing])
                if k % 25 == 0:
                    print(f"  semantic: {k}/{len(clean)} pairs, {len(broken)} broken, {time.monotonic() - t0:.0f}s",
                          flush=True)
        finally:
            git("worktree", "remove", "--force", wt, cwd=a.repo, check=False)
            shutil.rmtree(work, ignore_errors=True)
        out["semantic"] = {"pairs_checked": len(clean), "clean_but_broken": len(broken),
                           "rate": round(len(broken) / len(clean), 3) if clean else 0,
                           "share_source_file": sum(1 for x, y, _ in broken if src[x] & src[y]), "pairs": broken}
    with open(os.path.join(HERE, "profile.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    # ---- report
    print(f"Real arena contention profile: {n} tasks, {len(pairs)} pairs; {out['avg_files']} files "
          f"({out['avg_source_files']} source) per change")
    print("Source touch: " + ", ".join(f"{f} {v['tasks']} ({100 * v['share']:.0f}%)" for f, v in out['source_touch'].items()))
    print(f"Pairs sharing a source file: {pct(out['pairs']['share_source_file'], len(pairs))}; any file: "
          f"{pct(out['pairs']['share_any_file'], len(pairs))}")
    tc = out["textual_conflicts"]
    print(f"Textual conflicts: {pct(tc['conflicting'], len(pairs))}")
    for k, v in tc["by_overlap_class"].items():
        print(f"  {k:15s} {v['pairs']:4d} pairs {v['conflicts']:4d} conflict  rate {100 * v['rate']:.1f}%")
    print("  most conflicted files: " + ", ".join(f"{p} ({c})" for p, c in tc["most_conflicted_files"]))
    print(f"  tasks never in a textual conflict: {tc['tasks_never_in_a_textual_conflict']} of {n}")
    if "semantic" in out:
        s = out["semantic"]
        print(f"Semantic: {s['clean_but_broken']} of {s['pairs_checked']} clean pairs fail the suite "
              f"({100 * s['rate']:.1f}%), {s['share_source_file']} of them share a source file")
    return 0


if __name__ == "__main__":
    sys.exit(main())
