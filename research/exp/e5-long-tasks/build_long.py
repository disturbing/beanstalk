#!/usr/bin/env python3
"""Build compound ("long") tasks from the arena's single tasks, keeping the arena's ground truth.

A compound task bundles 2-4 related arena tasks into ONE ticket:
  * prompt            the member tickets, numbered, in one work item;
  * acceptance_tests  the UNION of the members' acceptance tests (unchanged files, same contents);
  * solution          the members' reference patches applied in order on the base app (3-way; textual
                      clashes only in CHANGELOG.md / README.md are resolved by union, anything else rejects
                      the group), i.e. a patch that makes every member's tests pass;
  * oracle fields     recomputed from the real diff;
  * couplings         the members' designed couplings, re-targeted at the compound that holds the partner.

Proven for every compound (validate_long.py repeats these from the materialized repository):
  1. every member's acceptance files FAIL on the base app;
  2. the compound patch applies to a pristine base with `git apply`, touches no test file;
  3. base + patch + the union of acceptance tests PASSES the full suite.

Usage:
  python3 build_long.py --groups groups/pilot.json --out arena-long [--jobs 2] [--check-only]

groups json: [{"id": "L01", "members": ["t001", "t016", "t026"], "theme": "billing"}, ...]
Python 3.11+, standard library only; needs git and node (25+) on PATH.
"""
from __future__ import annotations

import argparse
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
ARENA = HERE / "arena"
UNION_OK = {"CHANGELOG.md", "README.md"}


def git(cwd: Path, *args: str, check: bool = True, input_text: str | None = None) -> subprocess.CompletedProcess:
    env = dict(os.environ, GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_SYSTEM=os.devnull,
               GIT_AUTHOR_NAME="Arena Author", GIT_AUTHOR_EMAIL="arena@beanstalk.invalid",
               GIT_COMMITTER_NAME="Arena Author", GIT_COMMITTER_EMAIL="arena@beanstalk.invalid")
    res = subprocess.run(["git", "-C", str(cwd), "-c", "core.autocrlf=false", *args], capture_output=True, text=True,
                         env=env, input=input_text)
    if check and res.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed in {cwd}: {res.stderr.strip()[:800]}")
    return res


def union_resolve(text: str) -> str:
    """Keep both sides of every conflict hunk (ours, then theirs), like git's merge=union driver."""
    out, i = [], 0
    lines = text.splitlines(keepends=True)
    while i < len(lines):
        ln = lines[i]
        if ln.startswith("<<<<<<<"):
            ours, theirs, section = [], [], "ours"
            i += 1
            while i < len(lines) and not lines[i].startswith(">>>>>>>"):
                cur = lines[i]
                if cur.startswith("=======") and section == "ours":
                    section = "theirs"
                elif cur.startswith("|||||||") and section == "ours":
                    section = "base"
                elif section == "ours":
                    ours.append(cur)
                elif section == "theirs":
                    theirs.append(cur)
                i += 1
            out += ours if ours == theirs else ours + theirs
            i += 1
            continue
        out.append(ln)
        i += 1
    return "".join(out)


def run_node(root: Path, files: list[str] | None = None, timeout: int = 300) -> tuple[int, str]:
    res = subprocess.run(["node", "--test", "--test-reporter=spec", *(files or [])], cwd=root, capture_output=True,
                         text=True, timeout=timeout, env=dict(os.environ, NO_COLOR="1"))
    return res.returncode, res.stdout + res.stderr


def counts(out: str) -> dict[str, int]:
    return {k: int(v) for k, v in re.findall(r"^ℹ (tests|pass|fail) (\d+)\s*$", out, re.M)}


def load_tasks() -> dict[str, dict]:
    return {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in sorted((ARENA / "tasks").glob("t*.json"))}


def short(title: str) -> str:
    return title.rstrip(".")


def compound_prompt(group: dict, members: list[dict]) -> str:
    n = len(members)
    word = {2: "Two", 3: "Three", 4: "Four", 5: "Five"}.get(n, str(n))
    theme = group.get("theme") or "the same area"
    lines = [f"{word} related tickets in {theme} are being delivered together as one change. "
             "Implement all of them in this working tree.", ""]
    for i, m in enumerate(members, 1):
        lines += [f"### Ticket {i}: {short(m['title'])}", "", m["prompt"].strip(), ""]
    return "\n".join(lines).rstrip() + "\n"


def build_group(group: dict, tasks: dict[str, dict], repo: Path, tmp: Path) -> dict:
    gid, member_ids = group["id"], group["members"]
    members = [tasks[m] for m in member_ids]
    work = tmp / f"build-{gid}"
    clone = tmp / f"clone-{gid}"
    subprocess.run(["git", "clone", "-q", "--no-local", "--no-tags", "--single-branch", "--branch", "main", str(repo),
                    str(clone)], check=True, capture_output=True)
    git(clone, "worktree", "add", "--detach", "-q", str(work), "main")
    notes: list[str] = []
    patch_dir = ARENA / "solutions"
    # 1. apply the reference patches in order
    for tid in member_ids:
        patch = patch_dir / f"{tid}.patch"
        res = git(work, "apply", "--3way", "--whitespace=nowarn", str(patch), check=False)
        if res.returncode != 0:
            conflicted = sorted(p for p in git(work, "diff", "--name-only", "--diff-filter=U").stdout.split() if p)
            bad = [p for p in conflicted if p not in UNION_OK]
            if not conflicted or bad:
                raise RuntimeError(f"{gid}: {tid} does not combine with {member_ids[:member_ids.index(tid)]}: "
                                   f"{(bad or conflicted) or res.stderr.strip()[:300]}")
            for p in conflicted:
                full = work / p
                full.write_text(union_resolve(full.read_text(encoding="utf-8")), encoding="utf-8")
                git(work, "add", "--", p)
            notes.append(f"{tid}: union-resolved {', '.join(conflicted)}")
    git(work, "add", "-A")
    patch_text = git(work, "diff", "--cached", "--binary", "HEAD").stdout
    changed = sorted(p for p in git(work, "diff", "--cached", "--name-only", "HEAD").stdout.split() if p)
    if any(p.endswith(".test.ts") for p in changed):
        raise RuntimeError(f"{gid}: a member patch touches test files: {[p for p in changed if p.endswith('.test.ts')]}")
    # 2. union of acceptance tests
    acceptance: dict[str, str] = {}
    for m in members:
        for p, c in m["acceptance_tests"].items():
            if p in acceptance and acceptance[p] != c:
                raise RuntimeError(f"{gid}: members disagree on acceptance file {p}")
            acceptance[p] = c
    for p, c in acceptance.items():
        (work / p).parent.mkdir(parents=True, exist_ok=True)
        (work / p).write_text(c, encoding="utf-8")
    # 3. base + patch + union acceptance passes the full suite
    code, out = run_node(work)
    cnt = counts(out)
    if code != 0 or cnt.get("fail", 1) != 0:
        tail = "\n".join(out.splitlines()[-40:])
        raise RuntimeError(f"{gid}: base + combined patch does not pass the suite ({cnt}):\n{tail}")
    suite = {"tests": cnt.get("tests"), "pass": cnt.get("pass")}
    git(work, "worktree", "remove", "--force", str(work), check=False)
    # 4. every member's acceptance files fail on the base app (separately), the patch applies to a pristine base
    base = tmp / f"base-{gid}"
    git(clone, "worktree", "add", "--detach", "-q", str(base), "main")
    patch_file = tmp / f"{gid}.patch"
    patch_file.write_text(patch_text, encoding="utf-8")
    ap = git(base, "apply", "--check", str(patch_file), check=False)
    if ap.returncode != 0:
        raise RuntimeError(f"{gid}: patch does not apply to a pristine base: {ap.stderr.strip()[:300]}")
    fails_on_base: dict[str, bool] = {}
    for m in members:
        for p, c in m["acceptance_tests"].items():
            (base / p).parent.mkdir(parents=True, exist_ok=True)
            (base / p).write_text(c, encoding="utf-8")
        code_b, out_b = run_node(base, sorted(m["acceptance_tests"]))
        fails_on_base[m["id"]] = code_b != 0
        git(base, "checkout", "-q", "--", ".")
        git(base, "clean", "-q", "-fd")
    git(clone, "worktree", "remove", "--force", str(base), check=False)
    bad_members = [t for t, f in fails_on_base.items() if not f]
    if bad_members:
        raise RuntimeError(f"{gid}: acceptance tests of {bad_members} already pass on base")
    # 5. the task record
    prefix = "src/"
    oracle_paths = sorted(set(changed) | set(acceptance))
    def module_of(path: str) -> str:
        segs = path.split("/")[:-1]
        return "/".join(segs[:2]) if segs else "(root)"
    oracle_modules = sorted({module_of(p) for p in oracle_paths})
    kinds = [m["kind"] for m in members]
    kind = "feature" if "feature" in kinds else kinds[0]
    title = group.get("title") or " + ".join(short(m["title"]) for m in members)
    rec = {
        "id": gid, "title": title, "prompt": compound_prompt(group, members), "acceptance_tests": acceptance,
        "oracle_paths": oracle_paths, "oracle_modules": oracle_modules, "kind": kind,
        "difficulty": min(3, max(m["difficulty"] for m in members) + (1 if len(members) >= 3 else 0)),
        "members": member_ids, "couplings": [], "theme": group.get("theme"),
    }
    shutil.rmtree(clone, ignore_errors=True)
    return {"task": rec, "patch": patch_text, "suite": suite, "notes": notes, "files": changed}


def attach_couplings(built: dict[str, dict], tasks: dict[str, dict]) -> list[str]:
    owner = {m: gid for gid, b in built.items() for m in b["task"]["members"]}
    problems: list[str] = []
    for gid, b in built.items():
        seen: set[tuple[str, str, str]] = set()
        for m in b["task"]["members"]:
            for c in tasks[m]["couplings"]:
                other = c["with"]
                if other not in owner:
                    continue  # partner not in this task set
                og = owner[other]
                if og == gid:
                    problems.append(f"{gid}: members {m} and {other} are a designed {c['type']} coupling and share a compound")
                    continue
                key = (og, c["type"], f"{m}|{other}")
                if key in seen:
                    continue
                seen.add(key)
                b["task"]["couplings"].append({"with": og, "type": c["type"], "members": [m, other],
                                               "note": f"{m} x {other}: {c['note']}"})
    return problems


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--groups", type=Path, required=True)
    ap.add_argument("--out", type=Path, default=HERE / "arena-long")
    ap.add_argument("--repo", type=Path, default=HERE / "corpora" / "arena.git")
    ap.add_argument("--jobs", type=int, default=2)
    ap.add_argument("--check-only", action="store_true", help="build and prove, write nothing")
    args = ap.parse_args(argv)
    groups = json.loads(args.groups.read_text(encoding="utf-8"))
    tasks = load_tasks()
    used = [m for g in groups for m in g["members"]]
    dup = sorted({m for m in used if used.count(m) > 1})
    if dup:
        print(f"tasks in more than one group: {dup}", file=sys.stderr)
        return 2
    tmp = Path(tempfile.mkdtemp(prefix="e5-build-"))
    built: dict[str, dict] = {}
    errors: list[str] = []
    try:
        def one(g: dict):
            try:
                return g["id"], build_group(g, tasks, args.repo, tmp), None
            except Exception as e:  # noqa: BLE001
                return g["id"], None, str(e)
        with ThreadPoolExecutor(args.jobs) as ex:
            for gid, b, err in ex.map(one, groups):
                if err:
                    errors.append(err)
                    print(f"FAIL {gid}: {err.splitlines()[0]}")
                else:
                    built[gid] = b
                    print(f"ok   {gid} {b['task']['members']} files={len(b['files'])} suite={b['suite']} "
                          f"{'; '.join(b['notes'])}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    errors += attach_couplings(built, tasks)
    for e in errors:
        print("ERROR:", e, file=sys.stderr)
    if errors:
        return 1
    if args.check_only:
        return 0
    out = args.out
    (out / "tasks").mkdir(parents=True, exist_ok=True)
    (out / "solutions").mkdir(parents=True, exist_ok=True)
    if not (out / "app").exists():
        shutil.copytree(ARENA / "app", out / "app", ignore=shutil.ignore_patterns("node_modules", ".git"))
    for old in list((out / "tasks").glob("*.json")) + list((out / "solutions").glob("*.patch")):
        old.unlink()
    for gid, b in sorted(built.items()):
        (out / "tasks" / f"{gid}.json").write_text(json.dumps(b["task"], indent=2, ensure_ascii=False) + "\n",
                                                   encoding="utf-8")
        (out / "solutions" / f"{gid}.patch").write_text(b["patch"], encoding="utf-8")
    (out / "groups.json").write_text(json.dumps(groups, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {len(built)} compound tasks to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
