#!/usr/bin/env python3
"""Materialize a real-task arena's repository: the bare repo the race clones (arena.json ``repo``).

main = the base commit with the upstream's real history up to it (agents can read ``git log`` and ``blame``; no
later commit is reachable, so no reference solution is either). Nothing else is pushed: the reference solutions
stay in <arena>/solutions/ and the acceptance tests in <arena>/tasks/, as for the designed arena.

Usage: python3 materialize.py fastify [--out PATH]
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys

import realarena as R


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("arena")
    ap.add_argument("--out", help="bare repository path (default: arena.json repo)")
    ns = ap.parse_args()
    a = R.load(ns.arena if os.sep in ns.arena else os.path.join(R.HERE, ns.arena))
    out = os.path.abspath(ns.out or a.suite.repo)
    if not os.path.isdir(os.path.join(a.upstream_dir, ".git")):
        raise SystemExit(f"no upstream clone at {a.upstream_dir}; run build.py clone {a.name}")
    if os.path.exists(out):
        shutil.rmtree(out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    R.git("init", "-q", "--bare", "-b", "main", out, cwd=R.HERE)
    a.git("push", "-q", "--no-tags", out, f"{a.raw['base']}:refs/heads/main")
    tree = R.git("rev-parse", "main^{tree}", cwd=out).stdout.strip()
    print(f"{out}: main = {a.raw['base'][:10]} (tree {tree[:10]})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
