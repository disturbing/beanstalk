#!/usr/bin/env python3
"""Pairwise contention table for the 40 arena tasks: textual conflict (git merge-tree) and, for clean pairs,
whether the merged tree passes the full suite. Output: data/pairs.json  (input to build_long.py).

Usage: python3 pairs.py [--repo corpora/arena.git] [--jobs 8]
Works on a temporary clone; the bare repo is never modified.
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
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent


def git(repo: Path, *args: str, check: bool = True, text: bool = True) -> subprocess.CompletedProcess:
    env = dict(os.environ, GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_SYSTEM=os.devnull)
    res = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=text, env=env)
    if check and res.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {res.stderr}")
    return res


def suite(root: Path) -> tuple[bool, list[str]]:
    res = subprocess.run(["node", "--test", "--test-reporter=spec"], cwd=root, capture_output=True, text=True,
                         env=dict(os.environ, NO_COLOR="1"), timeout=180)
    out = res.stdout + res.stderr
    names = re.findall(r"^\s*✖ (.+?)(?: \(\d+(?:\.\d+)?ms\))?\s*$", out, re.M)
    failing = sorted({n for n in names if n != "failing tests:"})
    return res.returncode == 0, failing


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=str(HERE / "corpora" / "arena.git"))
    ap.add_argument("--jobs", type=int, default=8)
    ap.add_argument("--out", default=str(HERE / "data" / "pairs.json"))
    ap.add_argument("--no-suite", action="store_true", help="textual conflicts only (no suite runs on clean pairs)")
    a = ap.parse_args()
    repo = Path(a.repo)
    tmp = Path(tempfile.mkdtemp(prefix="e5-pairs-"))
    try:
        clone = tmp / "clone.git"
        subprocess.run(["git", "clone", "-q", "--bare", str(repo), str(clone)], check=True)
        refs = sorted(r.strip() for r in git(clone, "for-each-ref", "--format=%(refname:short)", "refs/heads/ref/").stdout.split())
        ids = [r.split("/")[-1] for r in refs]
        main = git(clone, "rev-parse", "main").stdout.strip()
        tip = {i: git(clone, "rev-parse", f"refs/heads/ref/{i}").stdout.strip() for i in ids}
        files = {i: sorted(git(clone, "diff", "--name-only", main, tip[i]).stdout.split()) for i in ids}
        pairs: dict[str, dict] = {}
        clean: list[tuple[str, str, str]] = []
        for x, y in itertools.combinations(ids, 2):
            res = git(clone, "merge-tree", "--write-tree", "--name-only", "--no-messages", tip[x], tip[y], check=False)
            lines = res.stdout.splitlines()
            key = f"{x}+{y}"
            if res.returncode == 0:
                pairs[key] = {"conflict": False, "files": [], "shared": sorted(set(files[x]) & set(files[y]))}
                clean.append((x, y, lines[0].strip()))
            else:
                pairs[key] = {"conflict": True, "files": sorted(set(ln.strip() for ln in lines[1:] if ln.strip())),
                              "shared": sorted(set(files[x]) & set(files[y]))}

        def run(item: tuple[str, str, str]) -> tuple[str, bool, list[str]]:
            x, y, tree = item
            d = tmp / f"w-{x}-{y}"
            d.mkdir()
            data = subprocess.run(["git", "-C", str(clone), "archive", "--format=tar", tree], capture_output=True, check=True).stdout
            subprocess.run(["tar", "-x", "-C", str(d)], input=data, check=True)
            ok, failing = suite(d)
            shutil.rmtree(d, ignore_errors=True)
            return f"{x}+{y}", ok, failing

        if not a.no_suite:
            with ThreadPoolExecutor(a.jobs) as ex:
                for key, ok, failing in ex.map(run, clean):
                    pairs[key]["suite_green"] = ok
                    pairs[key]["failing"] = failing
        out = {"base": main, "ids": ids, "files": files, "pairs": pairs}
        Path(a.out).parent.mkdir(parents=True, exist_ok=True)
        Path(a.out).write_text(json.dumps(out, indent=1))
        n_conf = sum(1 for p in pairs.values() if p["conflict"])
        n_sem = sum(1 for p in pairs.values() if not p["conflict"] and not p.get("suite_green", True))
        print(f"{len(pairs)} pairs: {n_conf} textual conflicts, {n_sem} clean-but-red")
        for k, p in pairs.items():
            if not p["conflict"] and not p.get("suite_green", True):
                print("  semantic:", k, p["failing"][:3])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
