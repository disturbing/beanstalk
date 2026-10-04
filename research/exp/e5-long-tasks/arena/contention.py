#!/usr/bin/env python3
"""Contention profile of the arena: how the 40 designed tasks overlap.

Reads the corpus written by common/corpus.py (branch mode) and runs `git merge-tree --write-tree`
on every pair of ref/* branches, then reports:

  * module touch distribution (module = first two directory segments, as in the corpus),
  * hot-file shares (any of routes.ts, types.ts, migrations/index.ts, CHANGELOG.md, lib/money.ts),
  * the average number of modules and files per change,
  * cold tasks (no hot file, no billing/orders/shared-infrastructure module),
  * the share of task pairs that share a module, and that share a file,
  * the pairwise textual conflict count, split by overlap class and by what conflicts.

    python3 common/corpus.py corpora/arena.git --corpus arena --branches 'refs/heads/ref/*' \\
        --base main --module-depth 2 -o data/arena/corpus.jsonl
    python3 arena/contention.py

Python 3.11+, standard library only.
"""
from __future__ import annotations

import argparse
import itertools
import json
import os
import subprocess
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ARENA = Path(__file__).resolve().parent
RESEARCH = ARENA.parent
HOT_FILES = ["src/routes.ts", "src/types.ts", "src/db/migrations/index.ts", "CHANGELOG.md", "src/lib/money.ts"]
INFRA_MODULES = {"src", "src/lib", "src/db", "(root)"}
DISSOLVABLE = {"lockfile", "changelog", "snapshot", "generated"}


def git(repo: Path, *args: str) -> subprocess.CompletedProcess:
    env = dict(os.environ, GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_SYSTEM=os.devnull)
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, env=env)


def merge_conflicts(repo: Path, a: str, b: str) -> list[str]:
    res = git(repo, "merge-tree", "--write-tree", "--name-only", "--no-messages", a, b)
    if res.returncode not in (0, 1):
        raise RuntimeError(res.stderr.strip())
    return [] if res.returncode == 0 else [l for l in res.stdout.splitlines()[1:] if l.strip()]


def pct(n: int, d: int) -> str:
    return f"{n} ({100 * n / d:.1f}%)" if d else "0"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter,
                                 epilog=__doc__.split("\n\n", 1)[1])
    ap.add_argument("--repo", type=Path, default=RESEARCH / "corpora" / "arena.git")
    ap.add_argument("--corpus", type=Path, default=RESEARCH / "data" / "arena" / "corpus.jsonl")
    ap.add_argument("--json", type=Path, default=RESEARCH / "data" / "arena" / "profile.json", help="where to write the numbers")
    ap.add_argument("--jobs", type=int, default=min(8, os.cpu_count() or 4))
    args = ap.parse_args(argv)

    changes = [json.loads(l) for l in args.corpus.read_text(encoding="utf-8").splitlines() if l.strip()]
    n = len(changes)
    by_id = {c["branch"].rsplit("/", 1)[-1]: c for c in changes}
    mods = {i: set(c["modules"]) for i, c in by_id.items()}
    files = {i: {f["path"] for f in c["files"]} for i, c in by_id.items()}
    cats = {f["path"]: f["category"] for c in changes for f in c["files"]}
    ids = sorted(by_id)

    out: dict = {"changes": n}
    out["avg_modules"] = round(sum(len(m) for m in mods.values()) / n, 2)
    out["avg_files"] = round(sum(len(f) for f in files.values()) / n, 2)

    module_counts = Counter(m for s in mods.values() for m in s)
    out["module_touch"] = {m: {"tasks": c, "share": round(c / n, 3)} for m, c in module_counts.most_common()}

    hot_tasks = {i for i in ids if files[i] & set(HOT_FILES)}
    out["hot_file_share"] = {"any": round(len(hot_tasks) / n, 3), "tasks": len(hot_tasks),
                             "by_file": {h: round(sum(1 for i in ids if h in files[i]) / n, 3) for h in HOT_FILES}}
    cold = [i for i in ids if i not in hot_tasks and not (mods[i] & {"src/billing", "src/orders"}) and not (mods[i] & (INFRA_MODULES - {"(root)"}))]
    out["cold_tasks"] = {"count": len(cold), "share": round(len(cold) / n, 3)}

    pairs = list(itertools.combinations(ids, 2))
    share_mod = sum(1 for a, b in pairs if mods[a] & mods[b])
    share_domain = sum(1 for a, b in pairs if (mods[a] & mods[b]) - INFRA_MODULES)
    share_file = sum(1 for a, b in pairs if files[a] & files[b])
    out["pairs"] = {"total": len(pairs), "share_module": share_mod, "share_domain_module": share_domain, "share_file": share_file}

    def conflicts(pair: tuple[str, str]) -> list[str]:
        return merge_conflicts(args.repo, f"refs/heads/ref/{pair[0]}", f"refs/heads/ref/{pair[1]}")

    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        results = list(pool.map(conflicts, pairs))
    conflicting = [(p, c) for p, c in zip(pairs, results) if c]
    classes = Counter()
    class_conflicts = Counter()
    for (a, b), c in zip(pairs, results):
        cls = "file" if files[a] & files[b] else "module" if mods[a] & mods[b] else "disjoint"
        classes[cls] += 1
        class_conflicts[cls] += bool(c)
    dissolvable_only = sum(1 for _, c in conflicting if all(cats.get(p, "source") in DISSOLVABLE for p in c))
    file_counter = Counter(p for _, c in conflicting for p in c)
    out["textual_conflicts"] = {
        "pairs": len(pairs), "conflicting": len(conflicting), "rate": round(len(conflicting) / len(pairs), 3),
        "dissolvable_only": dissolvable_only,
        "rate_after_dissolving_changelog": round((len(conflicting) - dissolvable_only) / len(pairs), 3),
        "by_overlap_class": {k: {"pairs": classes[k], "conflicts": class_conflicts[k],
                                 "rate": round(class_conflicts[k] / classes[k], 3) if classes[k] else 0} for k in ("file", "module", "disjoint")},
        "most_conflicted_files": file_counter.most_common(8),
    }
    # tasks that never conflict textually with anything
    conflicted_ids = {x for (a, b), _ in conflicting for x in (a, b)}
    out["tasks_never_in_a_textual_conflict"] = len([i for i in ids if i not in conflicted_ids])
    declared = set()
    for p in sorted((ARENA / "tasks").glob("t*.json")):
        t = json.loads(p.read_text(encoding="utf-8"))
        for c in t["couplings"]:
            declared.add((min(t["id"], c["with"]), max(t["id"], c["with"]), c["type"]))
    out["designed_couplings"] = {"semantic": sum(1 for d in declared if d[2] == "semantic"),
                                 "textual": sum(1 for d in declared if d[2] == "textual")}

    args.json.parent.mkdir(parents=True, exist_ok=True)
    args.json.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")

    # ---- report
    print(f"Arena contention profile: {n} changes, {len(pairs)} pairs")
    print(f"  average per change: {out['avg_modules']} modules, {out['avg_files']} files")
    print("\nModule touch distribution (module = first two directory segments):")
    for m, v in out["module_touch"].items():
        print(f"  {m:20s} {v['tasks']:3d} tasks  {100 * v['share']:5.1f}%")
    h = out["hot_file_share"]
    print(f"\nHot files: {h['tasks']} of {n} tasks ({100 * h['any']:.1f}%) touch at least one of the five; per file:")
    for f, v in h["by_file"].items():
        print(f"  {f:30s} {100 * v:5.1f}%")
    print(f"\nCold tasks (no hot file, no billing/orders, no shared-infrastructure module): {pct(len(cold), n)}")
    print(f"\nPairs sharing a module: {pct(share_mod, len(pairs))}; a domain module (excl. src, src/lib, src/db, root): "
          f"{pct(share_domain, len(pairs))}; a file: {pct(share_file, len(pairs))}")
    tc = out["textual_conflicts"]
    print(f"\ngit merge-tree --write-tree over all ref/* pairs: {tc['conflicting']} of {tc['pairs']} conflict ({100 * tc['rate']:.1f}%)")
    print(f"  conflicts only in dissolvable files (changelog): {tc['dissolvable_only']}; "
          f"after dissolving them: {tc['conflicting'] - tc['dissolvable_only']} ({100 * tc['rate_after_dissolving_changelog']:.1f}%)")
    for k, v in tc["by_overlap_class"].items():
        print(f"  overlap class {k:9s} {v['pairs']:4d} pairs  {v['conflicts']:4d} conflict  rate {100 * v['rate']:.1f}%")
    print("  most conflicted files: " + ", ".join(f"{p} ({c})" for p, c in tc["most_conflicted_files"]))
    print(f"  tasks that never conflict textually with any other: {out['tasks_never_in_a_textual_conflict']} of {n}")
    print(f"\nDesigned couplings: {out['designed_couplings']['semantic']} semantic, {out['designed_couplings']['textual']} textual")
    print(f"\nWrote {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
