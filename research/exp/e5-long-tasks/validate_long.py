#!/usr/bin/env python3
"""Prove that the compound arena keeps the arena's ground truth, from the materialized repository.

Per compound (branch ref/<id> = base + union of acceptance tests + the compound solution):
  1. every member's acceptance files FAIL on the base app;
  2. the solution patch applies to a pristine base with `git apply` and touches no test file;
  3. the branch is one commit on main, its diff equals oracle_paths, its acceptance files equal the task JSON;
  4. the branch passes the FULL suite.
Per designed coupling (re-targeted from the members, declared on both compounds):
  5. semantic: the two compounds merge cleanly (CHANGELOG/README by union, as the beanstalk merge driver does)
     and the merged tree FAILS at least one test, while each compound passes alone;
  6. textual: a plain `git merge-tree` of the two branches conflicts in a source file.
Plus the compound contention profile over ALL pairs: conflicts (plain / union) and clean-but-red pairs.
At most --jobs (default 4) node processes run at once. Output: data/long-profile.json and a table.

Usage: python3 validate_long.py [--repo corpora/arena-long.git] [--arena arena-long] [--jobs 4]
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
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
UNION_FILES = ("CHANGELOG.md", "README.md")


def git(repo: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    env = dict(os.environ, GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_SYSTEM=os.devnull,
               GIT_AUTHOR_NAME="v", GIT_AUTHOR_EMAIL="v@v.invalid", GIT_COMMITTER_NAME="v", GIT_COMMITTER_EMAIL="v@v.invalid")
    res = subprocess.run(["git", "-C", str(repo), "-c", "core.autocrlf=false", *args], capture_output=True, text=True, env=env)
    if check and res.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {res.stderr.strip()[:500]}")
    return res


def suite(root: Path, files: list[str] | None = None, timeout: int = 300) -> tuple[bool, int, int, list[str]]:
    t0 = time.monotonic()
    res = subprocess.run(["node", "--test", "--test-reporter=spec", *(files or [])], cwd=root, capture_output=True, text=True,
                         env=dict(os.environ, NO_COLOR="1"), timeout=timeout)
    out = res.stdout + res.stderr
    n = {k: int(v) for k, v in re.findall(r"^ℹ (tests|pass|fail) (\d+)\s*$", out, re.M)}
    failing = sorted({x for x in re.findall(r"^\s*✖ (.+?)(?: \(\d+(?:\.\d+)?ms\))?\s*$", out, re.M) if x != "failing tests:"})
    return res.returncode == 0 and n.get("fail", 1) == 0 and n.get("tests", 0) > 0, n.get("tests", 0), n.get("fail", 0), failing


class Trees:
    def __init__(self, clone: Path, root: Path):
        self.clone, self.root, self.n = clone, root, 0
        import threading
        self.lock = threading.Lock()

    def add(self, ref: str) -> Path:
        with self.lock:
            self.n += 1
            p = self.root / f"wt{self.n}"
            git(self.clone, "worktree", "add", "--detach", "-q", str(p), ref)
        return p

    def drop(self, p: Path) -> None:
        with self.lock:
            git(self.clone, "worktree", "remove", "--force", str(p), check=False)

    def merged(self, a: str, b: str, union: bool) -> tuple[Path | None, list[str]]:
        """Worktree with a merged with b (union driver for CHANGELOG/README when ``union``); (None, conflicts) on conflict."""
        wt = self.add(a)
        if union:
            info = Path(git(wt, "rev-parse", "--git-common-dir").stdout.strip())
            if not info.is_absolute():
                info = wt / info
            (info / "info").mkdir(exist_ok=True)
            (info / "info" / "attributes").write_text("".join(f"{f} merge=union\n" for f in UNION_FILES))
        res = git(wt, "merge", "--no-commit", "--no-ff", "--no-edit", b, check=False)
        if res.returncode != 0:
            conflicts = sorted(x for x in git(wt, "diff", "--name-only", "--diff-filter=U").stdout.split() if x)
            git(wt, "merge", "--abort", check=False)
            self.drop(wt)
            return None, conflicts
        return wt, []


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--repo", type=Path, default=HERE / "corpora" / "arena-long.git")
    ap.add_argument("--arena", type=Path, default=HERE / "arena-long")
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--out", type=Path, default=HERE / "data" / "long-profile.json")
    ap.add_argument("--no-pairs", action="store_true", help="skip the all-pairs semantic scan")
    a = ap.parse_args()
    jobs = max(1, min(a.jobs, 4))
    tasks = {p.stem: json.loads(p.read_text()) for p in sorted((a.arena / "tasks").glob("*.json"))}
    ids = sorted(tasks)
    tmp = Path(tempfile.mkdtemp(prefix="e5-validate-"))
    failures: list[str] = []
    try:
        clone = tmp / "clone.git"
        subprocess.run(["git", "clone", "-q", "--bare", str(a.repo), str(clone)], check=True)
        trees = Trees(clone, tmp)
        main_sha = git(clone, "rev-parse", "main").stdout.strip()

        base = trees.add("main")
        ok, n, nf, _ = suite(base)
        trees.drop(base)
        print(f"BASE main: {n - nf}/{n} tests pass")
        if not ok:
            failures.append("base suite is not green")

        def per_task(tid: str) -> dict:
            t = tasks[tid]
            row = {"id": tid, "members": t["members"], "notes": []}
            ref = f"refs/heads/ref/{tid}"
            commits = git(clone, "rev-list", f"main..{ref}").stdout.split()
            if len(commits) != 1:
                row["notes"].append(f"{len(commits)} commits on top of main")
            changed = sorted(git(clone, "diff", "--name-only", "main", ref).stdout.split())
            if changed != sorted(t["oracle_paths"]):
                row["notes"].append("oracle_paths differ from the branch diff")
            for p, c in t["acceptance_tests"].items():
                shown = git(clone, "show", f"{ref}:{p}", check=False)
                if shown.returncode != 0 or shown.stdout != c:
                    row["notes"].append(f"{p} differs from the task JSON")
            patch = a.arena / "solutions" / f"{tid}.patch"
            pfiles = re.findall(r"^diff --git a/(\S+) b/", patch.read_text(), re.M)
            if not pfiles or any(f.endswith(".test.ts") for f in pfiles):
                row["notes"].append("patch is empty or touches test files")
            base = trees.add("main")
            try:
                if git(base, "apply", "--check", str(patch), check=False).returncode != 0:
                    row["notes"].append("patch does not apply to a pristine base")
                fails = {}
                for mid in t["members"]:
                    mt = json.loads((HERE / "arena" / "tasks" / f"{mid}.json").read_text())
                    for p, c in mt["acceptance_tests"].items():
                        (base / p).parent.mkdir(parents=True, exist_ok=True)
                        (base / p).write_text(c)
                    okm, _, _, _ = suite(base, sorted(mt["acceptance_tests"]))
                    fails[mid] = not okm
                    git(base, "checkout", "-q", "--", ".")
                    git(base, "clean", "-q", "-fd")
                row["acceptance_fails_on_base"] = fails
                if not all(fails.values()):
                    row["notes"].append(f"acceptance passes on base for {[m for m, f in fails.items() if not f]}")
            finally:
                trees.drop(base)
            sol = trees.add(ref)
            try:
                row["suite_ok"], row["tests"], _, _ = suite(sol)
            finally:
                trees.drop(sol)
            if not row["suite_ok"]:
                row["notes"].append("branch does not pass the full suite")
            row["files"] = len(changed)
            row["ok"] = not row["notes"]
            return row

        with ThreadPoolExecutor(jobs) as ex:
            rows = list(ex.map(per_task, ids))
        for r in rows:
            print(f"{'ok  ' if r['ok'] else 'FAIL'} {r['id']} {r['members']} files={r['files']} tests={r.get('tests')} {'; '.join(r['notes'])}")
            if not r["ok"]:
                failures.append(f"{r['id']}: {'; '.join(r['notes'])}")

        # ---- all pairs: textual (plain / union) and semantic scan
        def pair_probe(xy: tuple[str, str]) -> dict:
            x, y = xy
            rx, ry = f"refs/heads/ref/{x}", f"refs/heads/ref/{y}"
            plain = git(clone, "merge-tree", "--write-tree", "--name-only", "--no-messages", rx, ry, check=False)
            plain_files = [] if plain.returncode == 0 else sorted(l for l in plain.stdout.splitlines()[1:] if l.strip())
            row = {"pair": f"{x}+{y}", "plain_conflict": plain.returncode != 0, "plain_files": plain_files}
            fx = set(git(clone, "diff", "--name-only", "main", rx).stdout.split())
            fy = set(git(clone, "diff", "--name-only", "main", ry).stdout.split())
            row["shared_files"] = sorted(f for f in fx & fy if not f.endswith(".test.ts"))
            wt, conflicts = trees.merged(rx, ry, union=True)
            row["union_conflict"] = wt is None
            row["union_files"] = conflicts
            if wt is not None:
                okp, n, nf, failing = suite(wt)
                row["suite_green"], row["failing"] = okp, failing[:4]
                trees.drop(wt)
            return row

        probes: dict[str, dict] = {}
        want = set()
        for t in tasks.values():
            for c in t["couplings"]:
                want.add(tuple(sorted((t["id"], c["with"]))))
        todo = list(itertools.combinations(ids, 2)) if not a.no_pairs else sorted(want)
        with ThreadPoolExecutor(jobs) as ex:
            for r in ex.map(pair_probe, todo):
                probes[r["pair"]] = r
        # ---- designed couplings
        print()
        coup_rows = []
        by_id = {r["id"]: r for r in rows}
        for x, y in sorted(want):
            p = probes[f"{x}+{y}"]
            kinds = sorted({c["type"] for c in tasks[x]["couplings"] if c["with"] == y})
            for kind in kinds:
                members = [c["members"] for c in tasks[x]["couplings"] if c["with"] == y and c["type"] == kind]
                if kind == "textual":
                    srcs = [f for f in p["plain_files"] if f not in UNION_FILES]
                    ok = p["plain_conflict"] and bool(srcs)
                    detail = ", ".join(p["plain_files"]) or "clean"
                else:
                    ok = (not p["union_conflict"]) and p.get("suite_green") is False and by_id[x]["suite_ok"] and by_id[y]["suite_ok"]
                    detail = "union-merge conflict: " + ", ".join(p["union_files"]) if p["union_conflict"] else \
                        f"clean merge, red: {'; '.join(p.get('failing', [])[:2]) or 'suite green!'}"
                coup_rows.append({"pair": f"{x}+{y}", "type": kind, "members": members, "ok": ok, "detail": detail})
                print(f"{'ok  ' if ok else 'FAIL'} coupling {x}+{y} {kind} {members}: {detail}")
                if not ok:
                    failures.append(f"coupling {x}+{y} {kind}: {detail}")
        # ---- profile
        pairs = list(probes.values())
        prof = {"compounds": len(ids), "pairs": len(pairs)}
        if not a.no_pairs:
            plain_c = sum(p["plain_conflict"] for p in pairs)
            union_c = sum(p["union_conflict"] for p in pairs)
            sem = [p for p in pairs if not p["union_conflict"] and p.get("suite_green") is False]
            prof.update({"plain_conflicts": plain_c, "union_conflicts": union_c,
                         "share_a_file": sum(1 for p in pairs if p["shared_files"]),
                         "clean_but_red": [{"pair": p["pair"], "failing": p["failing"]} for p in sem]})
            print(f"\nall {len(pairs)} compound pairs: {plain_c} plain conflicts ({100 * plain_c / len(pairs):.0f}%), "
                  f"{union_c} after union merge of CHANGELOG/README ({100 * union_c / len(pairs):.0f}%), "
                  f"{prof['share_a_file']} share a file, {len(sem)} merge cleanly but fail the suite")
            for p in sem:
                print("   clean-but-red:", p["pair"], p["failing"][:2])
        out = {"profile": prof, "tasks": rows, "couplings": coup_rows, "pairs": probes}
        a.out.parent.mkdir(parents=True, exist_ok=True)
        a.out.write_text(json.dumps(out, indent=1, default=str))
    finally:
        subprocess.run(["git", "-C", str(tmp / "clone.git"), "worktree", "prune"], capture_output=True)
        shutil.rmtree(tmp, ignore_errors=True)
    if failures:
        print(f"\nFAILED ({len(failures)}):")
        for f in failures:
            print("  -", f)
        return 1
    print(f"\nALL PASS: {len(rows)} compounds prove the arena properties; {len(coup_rows)} re-targeted couplings hold")
    return 0


if __name__ == "__main__":
    sys.exit(main())
