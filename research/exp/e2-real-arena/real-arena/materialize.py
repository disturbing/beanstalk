#!/usr/bin/env python3
"""Build the arena's bare repository (default ../real-arena.git) from the upstream clone.

main          = the window's base commit, with marked's real history up to it (agents can read git log/blame)
ref/<task id> = base + the task's acceptance tests + its reference solution, one commit titled like the task
                (fixed author and date, so rebuilding gives identical ids); used for contention profiling only.
                The race clones main alone (--single-branch, pack protocol), so no solution object reaches agents.

Usage: python3 materialize.py [--arena DIR] [--out PATH]
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import shutil
import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
UPSTREAM = os.path.normpath(os.path.join(HERE, "..", "upstream", "marked"))
ENV = dict(os.environ, GIT_AUTHOR_NAME="arena", GIT_AUTHOR_EMAIL="arena@beanstalk.invalid",
           GIT_COMMITTER_NAME="arena", GIT_COMMITTER_EMAIL="arena@beanstalk.invalid",
           GIT_AUTHOR_DATE="2026-10-03T00:00:00Z", GIT_COMMITTER_DATE="2026-10-03T00:00:00Z")


def git(*args: str, cwd: str | None = None) -> str:
    p = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, env=ENV)
    if p.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {p.stderr.strip()[:2000]}")
    return p.stdout


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--arena", default=HERE, help="directory with tasks/, solutions/ and window.json")
    ap.add_argument("--out", default=os.path.join(HERE, "..", "real-arena.git"))
    ap.add_argument("--no-refs", action="store_true", help="main only (validation of candidates)")
    a = ap.parse_args()
    arena, out = os.path.abspath(a.arena), os.path.abspath(a.out)
    with open(os.path.join(arena, "window.json"), encoding="utf-8") as fh:
        base = json.load(fh)["base"]
    if os.path.exists(out):
        shutil.rmtree(out)
    git("init", "-q", "--bare", "-b", "main", out)
    git("push", "-q", out, f"{base}:refs/heads/main", cwd=UPSTREAM)
    if a.no_refs:
        print(f"{out}: main = {base[:10]}")
        return
    wt = tempfile.mkdtemp(prefix="materialize-", dir=os.path.dirname(out))
    try:
        git("clone", "-q", out, wt)
        tasks = sorted(glob.glob(os.path.join(arena, "tasks", "*.json")))
        for path in tasks:
            with open(path, encoding="utf-8") as fh:
                task = json.load(fh)
            git("checkout", "-q", "-f", "--detach", base, cwd=wt)
            git("clean", "-q", "-fdx", cwd=wt)
            for rel, content in task["acceptance_tests"].items():
                full = os.path.join(wt, rel)
                os.makedirs(os.path.dirname(full), exist_ok=True)
                with open(full, "w", encoding="utf-8") as fh:
                    fh.write(content)
            git("apply", "--whitespace=nowarn", os.path.join(arena, "solutions", f"{task['id']}.patch"), cwd=wt)
            git("add", "-A", cwd=wt)
            git("commit", "-q", "--no-verify", "-m", task["title"], cwd=wt)
            git("push", "-q", "origin", f"HEAD:refs/heads/ref/{task['id']}", cwd=wt)
        print(f"{out}: main = {base[:10]}, {len(tasks)} ref/* branches")
    finally:
        shutil.rmtree(wt, ignore_errors=True)


if __name__ == "__main__":
    main()
