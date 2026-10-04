#!/usr/bin/env python3
"""E2b: the same window as build.py, in HISTORY ORDER, keeping the changes that build on earlier ones.

build.py re-bases every change onto the common base and drops the 15 that do not survive (they overlap an earlier
change). Those are where the window's contention lives, so this variant keeps them:

  S_0 = the base. For change i (merge order), with acceptance tests and residual edits derived exactly as build.py
  does but against the change's own upstream parent:
    1. its non-test change + residual test edits are merged onto S_{i-1} (3-way, merge base = upstream parent);
       a conflict means it needs a window change that is not a task (a non-qualifying commit): excluded;
    2. validation, sequentially: on S_{i-1} plus its acceptance tests the suite must fail in those tests, and on
       S_i (= S_{i-1} + solution + acceptance tests) the whole suite must pass;
    3. its reference solution is the patch S_{i-1} -> S_i (non-test files and residual edits).
  The common base stays the race's base: a task whose prerequisite has not landed yet must do that part too, or
  collide with it when it lands. That is the contention the common-base arena removes.

Writes chain/{tasks,solutions}/, chain/window.json and chain/arena.json (-> ../arena.json).
Usage: python3 build_chain.py [--base d2af54e] [--end c18a64f]
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
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.normpath(os.path.join(HERE, "..", "race")))
import build as B  # noqa: E402
from harness import suite as suite_mod  # noqa: E402

OUT = os.path.join(HERE, "chain")


def git(*args: str, cwd: str = B.UPSTREAM, check: bool = True, input_text: str | None = None, env=None):
    p = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, input=input_text, env=env)
    if check and p.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {p.stderr.strip()[:1500]}")
    return p


ENV = dict(os.environ, GIT_AUTHOR_NAME="chain", GIT_AUTHOR_EMAIL="chain@x", GIT_COMMITTER_NAME="chain",
           GIT_COMMITTER_EMAIL="chain@x", GIT_AUTHOR_DATE="2026-10-03T00:00:00Z",
           GIT_COMMITTER_DATE="2026-10-03T00:00:00Z")


def split_change(sha: str, pr: dict, wt: str) -> dict:
    """build.py's split of one upstream change, against its own parent: acceptance files, and a commit on the
    parent holding the non-test change + residual test edits (the solution side)."""
    parent = f"{sha}^"
    tag = f"pr{pr['number']}"
    changes = B.name_status(parent, sha)
    acceptance: dict[str, str] = {}
    residual: dict[str, str | None] = {}
    notes: list[str] = []
    for status, path in changes:
        if not B.is_test(path):
            continue
        post = B.show(sha, path) if status != "D" else None
        old = B.show(parent, path) if status != "A" else None
        if status == "D":
            residual[path] = None
        elif status == "A":
            acceptance[path] = post  # type: ignore[assignment]
        elif B.SPEC_JSON.match(path):
            got = B.extract_spec_json(path, old or "[]", post or "[]", tag)
            residual[path] = post
            if got:
                acceptance[got[0]] = got[1]
                notes.append(f"{path}: examples {got[2]} copied to {got[0]}")
        elif B.UNIT_TEST.match(path):
            stem = B.UNIT_TEST.match(path).group(1)
            content, info = B.extract_unit(old, post or "", residual=False)
            res_content, _ = B.extract_unit(old, post or "", residual=True)
            if info["kept"]:
                acceptance[f"test/unit/{stem}.{tag}.test.js"] = content
                notes.append(f"{path}: {len(info['kept'])} case(s) extracted")
            if res_content != old:
                residual[path] = res_content
        else:
            acceptance[path] = post  # type: ignore[assignment]
            notes.append(f"replaces existing test file {path}")
    git("checkout", "-q", "-f", "--detach", parent, cwd=wt)
    git("clean", "-q", "-fdx", cwd=wt)
    for status, path in changes:
        if B.is_test(path):
            continue
        full = os.path.join(wt, path)
        if status == "D":
            if os.path.exists(full):
                os.remove(full)
            continue
        os.makedirs(os.path.dirname(full) or wt, exist_ok=True)
        with open(full, "w", encoding="utf-8") as fh:
            fh.write(git("show", f"{sha}:{path}").stdout)
    for path, content in residual.items():
        full = os.path.join(wt, path)
        if content is None:
            if os.path.exists(full):
                os.remove(full)
        else:
            with open(full, "w", encoding="utf-8") as fh:
                fh.write(content)
    git("add", "-A", cwd=wt)
    git("commit", "-q", "--allow-empty", "--no-verify", "-m", f"solution side of {tag}", cwd=wt, env=ENV)
    sol_commit = git("rev-parse", "HEAD", cwd=wt).stdout.strip()
    return {"acceptance": acceptance, "sol_commit": sol_commit, "parent": git("rev-parse", parent).stdout.strip(),
            "notes": notes}


def commit_files(base_commit: str, files: dict[str, str], wt: str, msg: str) -> str:
    git("checkout", "-q", "-f", "--detach", base_commit, cwd=wt)
    git("clean", "-q", "-fdx", cwd=wt)
    for path, content in files.items():
        full = os.path.join(wt, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as fh:
            fh.write(content)
    git("add", "-A", cwd=wt)
    git("commit", "-q", "--allow-empty", "--no-verify", "-m", msg, cwd=wt, env=ENV)
    return git("rev-parse", "HEAD", cwd=wt).stdout.strip()


def run_suite(cfg, wt: str, junit: str) -> tuple[bool, list[str]]:
    env = cfg.run_env()
    env.pop("NODE_OPTIONS", None)
    env["CI"] = "1"
    if cfg.build:
        b = subprocess.run(list(cfg.build), cwd=wt, capture_output=True, text=True, env=env)
        if b.returncode != 0:
            return False, ["(build)"]
    p = subprocess.run(cfg.test_argv(reporters=[("dot", "stdout"), ("junit", junit)]), cwd=wt, capture_output=True,
                       text=True, env=env, timeout=600)
    parsed = cfg.parse_junit(junit, wt)
    if parsed is None:
        return False, ["(no junit)"]
    failing = cfg.companions({f["file"] for f in parsed[0] if f["file"]}, wt)
    return p.returncode == 0 and not parsed[0], failing


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], epilog=__doc__.split("\n\n", 1)[1],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default="d2af54e")
    ap.add_argument("--end", default="c18a64f")
    a = ap.parse_args()
    base = git("rev-parse", a.base).stdout.strip()
    end = git("rev-parse", a.end).stdout.strip()
    qual, other = B.window(base, end)
    cfg = suite_mod.load_suite(HERE)
    suite_mod.activate(cfg)
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    work = tempfile.mkdtemp(prefix="chain-", dir=os.path.join(HERE, ".."))
    os.symlink(cfg.deps, os.path.join(work, "node_modules"))
    wt, vt = os.path.join(work, "split"), os.path.join(work, "validate")
    git("worktree", "add", "-q", "--detach", wt, base)
    git("worktree", "add", "-q", "--detach", vt, base)
    rows, kept = [], []
    state = base                     # S_{i-1}: base + kept solutions + their acceptance tests
    acc_all: dict[str, str] = {}
    t0 = time.monotonic()
    try:
        for i, sha in enumerate(qual, 1):
            subj = git("log", "-1", "--format=%s", sha).stdout.strip()
            m = re.search(r"\(#(\d+)\)\s*$", subj)
            with open(os.path.join(HERE, "pr", f"{m.group(1)}.json"), encoding="utf-8") as fh:
                pr = json.load(fh)
            tag = f"pr{pr['number']}"
            row = {"seq": i, "pr": pr["number"], "sha": sha, "title": pr["title"]}
            sp = split_change(sha, pr, wt)
            clash = [p for p in sp["acceptance"] if p in acc_all]
            if clash:
                rows.append(row | {"status": "excluded", "reason": f"rewrites an earlier task's test file {clash}"})
                print(f"{i:3d} {tag} excluded: rewrites earlier acceptance {clash}")
                continue
            tree, conflicts = B.merge_tree(sp["parent"], state, sp["sol_commit"])
            if tree is None:
                rows.append(row | {"status": "excluded", "reason": "needs a window change that is not a task",
                                   "conflict_files": conflicts})
                print(f"{i:3d} {tag} excluded: conflict {conflicts}")
                continue
            new_state = git("commit-tree", tree, "-p", state, "-m", f"chain {tag}", env=ENV).stdout.strip()
            # (a) acceptance tests fail on S_{i-1}
            pre = commit_files(state, sp["acceptance"], vt, f"acceptance of {tag} on S_i-1")
            ok_pre, fail_pre = run_suite(cfg, vt, os.path.join(work, "j.xml"))
            fails_on_prev = bool(set(fail_pre) & set(sp["acceptance"]))
            # (b) S_i + acceptance passes the whole suite (all earlier acceptance tests are already in S)
            post = commit_files(new_state, sp["acceptance"], vt, f"S_i of {tag}")
            ok_post, fail_post = run_suite(cfg, vt, os.path.join(work, "j.xml"))
            if not fails_on_prev or not ok_post:
                why = []
                if not fails_on_prev:
                    why.append("acceptance tests pass before the change")
                if not ok_post:
                    why.append(f"suite red with the change: {fail_post[:6]}")
                rows.append(row | {"status": "excluded", "reason": "; ".join(why)})
                print(f"{i:3d} {tag} excluded: {'; '.join(why)}")
                continue
            patch = git("diff", "--binary", state, new_state).stdout
            sol_paths = git("diff", "--name-only", state, new_state).stdout.split()
            numstat = git("diff", "--numstat", state, new_state).stdout
            src_lines = sum(int(x) + int(y) for x, y, p in (ln.split("\t") for ln in numstat.splitlines())
                            if x.isdigit() and y.isdigit() and not B.is_test(p))
            prompt, source = B.make_prompt(pr)
            in_base = B.merge_tree(sp["parent"], base, sp["sol_commit"])[0] is not None
            oracle = sorted(set(sol_paths) | set(sp["acceptance"]))
            task = {"id": tag, "title": pr["title"], "prompt": prompt,
                    "acceptance_tests": dict(sorted(sp["acceptance"].items())), "oracle_paths": oracle,
                    "oracle_modules": sorted({B.module_of(p) for p in oracle}), "kind": B.kind_of(pr["title"]),
                    "difficulty": 1 if src_lines <= 6 else 2 if src_lines <= 30 else 3, "couplings": [],
                    "upstream": {"repo": B.REPO_URL, "pr": pr["number"], "sha": sha, "url": f"{B.REPO_URL}/pull/{pr['number']}",
                                 "author": pr.get("author"), "merged_at": pr.get("merged_at"), "prompt_source": source,
                                 "source_lines_changed": src_lines, "notes": sp["notes"],
                                 "applies_to_common_base": in_base}}
            kept.append((task, patch))
            state = git("commit-tree", git("rev-parse", f"{post}^{{tree}}").stdout.strip(), "-p", new_state,
                        "-m", f"chain {tag} + acceptance", env=ENV).stdout.strip()
            acc_all.update(sp["acceptance"])
            rows.append(row | {"status": "task", "applies_to_common_base": in_base})
            print(f"{i:3d} {tag} task ({'common-base' if in_base else 'DEPENDS on window'}) "
                  f"{time.monotonic() - t0:.0f}s: {pr['title'][:60]}")
    finally:
        git("worktree", "remove", "--force", wt, check=False)
        git("worktree", "remove", "--force", vt, check=False)
        shutil.rmtree(work, ignore_errors=True)
    for k, (task, patch) in enumerate(kept, 1):
        task["id"] = f"t{k:03d}"
        B.write_task(OUT, task, patch)
    with open(os.path.join(OUT, "window.json"), "w", encoding="utf-8") as fh:
        json.dump({"variant": "history order (E2b)", "base": base, "end": end, "qualifying": len(qual),
                   "tasks": [{"id": t["id"], "pr": t["upstream"]["pr"], "title": t["title"],
                              "applies_to_common_base": t["upstream"]["applies_to_common_base"]} for t, _ in kept],
                   "rows": rows}, fh, indent=1)
    os.symlink("../arena.json", os.path.join(OUT, "arena.json"))
    print(f"{len(kept)} tasks ({sum(1 for t, _ in kept if not t['upstream']['applies_to_common_base'])} depend on an "
          f"earlier window change); {len(rows) - len(kept)} excluded")


if __name__ == "__main__":
    main()
