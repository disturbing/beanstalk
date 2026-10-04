#!/usr/bin/env python3
"""E1, order-independent: do a task's tests see the arena's designed contract clashes?

Usage: python3 e1_couplings.py RUN [RUN ...] --scratch DIR [--jobs 2] [--json out.json]

For each designed semantic coupling (A changes a contract, B relies on the old one; arena README "Designed couplings"),
the arena's two reference branches are merged (`git merge-tree`, both on the base), and each test set is run on:
  - its own task's reference solution (ref/A or ref/B): it must pass there to say anything;
  - the merged tree: if it now fails, a gate running it would have seen the clash (whichever bean lands second).
Test sets: the arena's canonical acceptance tests, and the accepted test-author files of each --tests first RUN
(<run>/testsfirst/<task>/accepted/). Self-written tests (--tests self) are not used: they are written against the
agent's own implementation and often name things the reference does not have.
At most --jobs test jobs at once (each `node --test --test-concurrency=1`, two node processes).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from e1_analyze import ARENA, ARENA_GIT, Runner, all_pass, author_files, first_failure, load_canonical, read_run  # noqa: E402


def designed_pairs(arena: str) -> list[tuple[str, str]]:
    """(A, B) per designed semantic coupling: A is the contract changer (the README's left column)."""
    a_side = {"t023", "t032", "t011", "t002", "t005"}
    pairs = set()
    for name in sorted(os.listdir(os.path.join(arena, "tasks"))):
        with open(os.path.join(arena, "tasks", name), encoding="utf-8") as fh:
            raw = json.load(fh)
        for c in raw.get("couplings") or []:
            if c.get("type") == "semantic":
                x, y = raw["id"], c["with"]
                pairs.add((x, y) if x in a_side else (y, x))
    return sorted(pairs)


def merged_tree(a: str, b: str) -> str:
    out = subprocess.run(["git", f"--git-dir={ARENA_GIT}", "merge-tree", "--write-tree", "--merge-base=refs/heads/main",
                          f"refs/heads/ref/{a}", f"refs/heads/ref/{b}"], capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(f"ref/{a} and ref/{b} do not merge cleanly: {out.stdout[:300]}")
    return out.stdout.splitlines()[0].strip()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("runs", nargs="*")
    ap.add_argument("--scratch", required=True)
    ap.add_argument("--jobs", type=int, default=2)
    ap.add_argument("--json")
    a = ap.parse_args()
    runner = Runner(a.scratch, a.jobs)
    canonical = load_canonical(ARENA)
    sources: dict[str, dict[str, dict[str, str]]] = {"canonical": canonical}
    for run in a.runs:
        _, ev, _ = read_run(run)
        sources[os.path.basename(os.path.normpath(run))] = author_files(os.path.abspath(run), ev)
    rows = []
    for A, B in designed_pairs(ARENA):
        tree = merged_tree(A, B)
        for src, files in sources.items():
            row = {"pair": f"{A}->{B}", "source": src}
            for side in (A, B):
                fs = files.get(side)
                if not fs:
                    row[side] = "no tests"
                    continue
                paths = sorted(fs)
                own = runner.submit(ARENA_GIT, f"refs/heads/ref/{side}", fs, paths)
                mer = runner.submit(ARENA_GIT, tree, fs, paths)
                own_r, mer_r = own.result(), mer.result()
                if not all_pass(own_r, paths):
                    row[side] = "fails on its own reference"
                elif all_pass(mer_r, paths):
                    row[side] = "passes merged (clash unseen)"
                else:
                    row[side] = "FAILS merged (clash seen): " + first_failure(mer_r, paths)[:140]
            row["seen"] = any(str(row.get(s, "")).startswith("FAILS") for s in (A, B))
            rows.append(row)
            print(json.dumps(row), flush=True)
    summary = {src: f"{sum(1 for r in rows if r['source'] == src and r['seen'])} of "
                    f"{sum(1 for r in rows if r['source'] == src)}" for src in sources}
    print("clashes seen per test source:", summary)
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump({"label": "measured: arena reference solutions merged pairwise; tests run with node --test",
                       "pairs": rows, "seen": summary}, fh, indent=1)


if __name__ == "__main__":
    main()
