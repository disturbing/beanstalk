#!/usr/bin/env python3
"""Build the real arena (marked) from upstream history: a window of merged changes becomes race tasks.

For every first-parent commit in (--base, --end] that changes source (src/, bin/) AND tests (test/):
  1. Re-base the change onto the common base with a 3-way merge (``git merge-tree``, merge base = its parent).
     A conflict means it depends on an earlier change in the window: excluded ("depends on window").
  2. Split the re-based change into
     - acceptance tests (task-owned files, written into the agent's workspace before it starts):
       * test files the change added, as they are (spec .md/.html pairs, ReDoS specs, unit fixtures);
       * test cases it added or modified in a shared node:test file, extracted into test/unit/<file>.pr<N>.test.js
         (extract_tests.mjs: imports, helpers and hooks kept);
       * CommonMark/GFM examples it changed in a shared spec JSON (usually a cleared ``shouldFail``), copied into
         test/specs/<dir>/pr<N>.json with the section renamed "<section> [pr<N> <dir>]" so results map to the file;
     - the reference solution (a ``git apply`` patch against the base): every non-test change, plus the residual
       edits of shared test files (cleared ``shouldFail`` flags, modified expectations); the cases it added live
       only in the task-owned file.
  3. Prompt = the PR's title (the harness prints it) and description, with the template's HTML comments and the
     Contributor/Committer checklists removed. A description with no content falls back to the linked issue.

Writes candidates/{tasks,solutions}/pr<N>.* and candidates/window.json. ``--finalize RUN`` reads a dry run of the
candidates (race.py --dry-run ... --out RUN), keeps the tasks that validated (acceptance tests fail on the base,
base + solution passes the suite), numbers them t001.. in merge order and writes tasks/ and solutions/.

Usage:
  python3 build.py --base d2af54e --end c18a64f
  python3 build.py --finalize ../race/runs/_dry-candidates
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

HERE = os.path.dirname(os.path.abspath(__file__))
UPSTREAM = os.path.normpath(os.path.join(HERE, "..", "upstream", "marked"))
DEPS = os.path.normpath(os.path.join(HERE, "..", "deps", "node_modules"))
REPO_URL = "https://github.com/markedjs/marked"
SPEC_JSON = re.compile(r"^test/specs/([^/]+)/([^/]+)\.json$")
UNIT_TEST = re.compile(r"^test/unit/([^/]+)\.test\.js$")


def git(*args: str, cwd: str = UPSTREAM, check: bool = True, input_text: str | None = None) -> subprocess.CompletedProcess:
    p = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, input=input_text)
    if check and p.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {p.stderr.strip()[:2000]}")
    return p


def show(rev: str, path: str) -> str | None:
    p = git("show", f"{rev}:{path}", check=False)
    return p.stdout if p.returncode == 0 else None


def is_source(path: str) -> bool:
    return path.startswith(("src/", "bin/"))


def is_test(path: str) -> bool:
    return path.startswith("test/")


# ---- prompts -----------------------------------------------------------------------------------------------

def clean_body(body: str) -> str:
    body = (body or "").replace("\r\n", "\n")
    body = re.sub(r"<!--.*?-->", "", body, flags=re.S)
    # the PR template's checklists: everything from a Contributor/Committer heading on
    body = re.split(r"\n#{1,6}\s*(?:Contributor|Committer)\b", "\n" + body)[0]
    body = re.sub(r"\n{3,}", "\n\n", body)
    return body.strip()


def make_prompt(pr: dict) -> tuple[str, str]:
    body = clean_body(pr.get("body") or "")
    words = re.sub(r"\*\*[^*]+:\*\*[^\n]*", "", body)  # "**Marked version:** ..." lines carry no task content
    if len(words.split()) >= 15:
        return body, "pr-description"
    for iss in pr.get("linked_issues") or []:
        ib = clean_body(iss.get("body") or "")
        if len(ib.split()) >= 15:
            text = (body + "\n\n" if body else "") + f"Issue #{iss['number']}: {iss.get('title')}\n\n{ib}"
            return text.strip(), "linked-issue"
    return body, "thin"


def kind_of(title: str) -> str:
    m = re.match(r"^(\w+)(?:\([^)]*\))?!?:", title or "")
    return {"fix": "bug", "feat": "feature", "perf": "perf", "refactor": "refactor", "docs": "docs",
            "chore": "chore", "test": "test"}.get((m.group(1) if m else "").lower(), "other")


def module_of(path: str) -> str:
    segs = path.split("/")[:-1]
    return "/".join(segs[:2]) if segs else "(root)"


# ---- acceptance-test extraction -----------------------------------------------------------------------------

def extract_unit(base: str | None, post: str, residual: bool) -> tuple[str, dict]:
    with tempfile.TemporaryDirectory() as d:
        bp, pp, op = os.path.join(d, "base.js"), os.path.join(d, "post.js"), os.path.join(d, "out.js")
        with open(bp, "w") as fh:
            fh.write(base or "")
        with open(pp, "w") as fh:
            fh.write(post)
        argv = ["node", os.path.join(HERE, "extract_tests.mjs")] + (["--residual"] if residual else []) + \
               [bp if base is not None else "-", pp, op]
        env = dict(os.environ, TS_PATH=os.path.join(DEPS, "typescript"))
        p = subprocess.run(argv, capture_output=True, text=True, env=env)
        if p.returncode != 0:
            raise RuntimeError(f"extract_tests.mjs failed: {p.stderr[:2000]}")
        with open(op) as fh:
            return fh.read(), json.loads(p.stdout)


def json_text(data) -> str:
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def extract_spec_json(path: str, base: str, post: str, tag: str) -> tuple[str, str, list] | None:
    """Examples the change added or changed in a shared spec JSON, as a task-owned file with unique sections."""
    m = SPEC_JSON.match(path)
    assert m
    d = m.group(1)
    b, a = json.loads(base), json.loads(post)
    if not isinstance(b, list) or not isinstance(a, list):
        return None
    key = lambda e, i: (e.get("example"), e.get("section")) if isinstance(e, dict) and e.get("example") is not None \
        else ("#", i)
    before = {key(e, i): e for i, e in enumerate(b)}
    changed = []
    for i, e in enumerate(a):
        if before.get(key(e, i)) != e:
            e = dict(e)
            e["section"] = f"{e.get('section') or 'spec'} [{tag} {d}]"
            changed.append(e)
    if not changed:
        return None
    return f"test/specs/{d}/{tag}.json", json_text(changed), [e.get("example") for e in changed]


# ---- one change -------------------------------------------------------------------------------------------

def merge_tree(base: str, ours: str, theirs: str) -> tuple[str | None, list[str]]:
    p = git("merge-tree", "--write-tree", "--name-only", "--no-messages", f"--merge-base={base}", ours, theirs,
            check=False)
    lines = p.stdout.splitlines()
    if p.returncode == 0:
        return lines[0].strip(), []
    if p.returncode == 1:
        return None, sorted({x.strip() for x in lines[1:] if x.strip()})
    raise RuntimeError(p.stderr)


def name_status(a: str, b: str) -> list[tuple[str, str]]:
    out = git("diff", "--name-status", "--no-renames", a, b).stdout
    rows = []
    for line in out.splitlines():
        parts = line.split("\t")
        rows.append((parts[0][0], parts[-1]))
    return rows


def build_change(base: str, sha: str, pr: dict, wt: str) -> dict:
    num = pr["number"]
    tag = f"pr{num}"
    tree, conflicts = merge_tree(f"{sha}^", base, sha)
    rec = {"pr": num, "sha": sha, "title": pr["title"], "author": pr.get("author"), "merged_at": pr.get("merged_at"),
           "url": f"{REPO_URL}/pull/{num}"}
    if tree is None:
        return rec | {"status": "excluded", "reason": "depends on an earlier change in the window",
                      "conflict_files": conflicts}
    changes = name_status(base, tree)
    acceptance: dict[str, str] = {}
    residual: dict[str, str | None] = {}
    notes: list[str] = []
    for status, path in changes:
        if not is_test(path):
            continue
        post = show(tree, path) if status != "D" else None
        old = show(base, path) if status != "A" else None
        if status == "D":
            residual[path] = None
            notes.append(f"deletes {path}")
        elif status == "A":
            acceptance[path] = post  # type: ignore[assignment]
        elif SPEC_JSON.match(path):
            got = extract_spec_json(path, old or "[]", post or "[]", tag)
            residual[path] = post
            if got:
                acc_path, content, examples = got
                acceptance[acc_path] = content
                notes.append(f"{path}: examples {examples} copied to {acc_path}; the shared file's edit is in the solution")
        elif UNIT_TEST.match(path):
            stem = UNIT_TEST.match(path).group(1)
            content, info = extract_unit(old, post or "", residual=False)
            res_content, _ = extract_unit(old, post or "", residual=True)
            if info["kept"]:
                acc_path = f"test/unit/{stem}.{tag}.test.js"
                acceptance[acc_path] = content
                notes.append(f"{path}: {len(info['kept'])} added/modified case(s) extracted to {acc_path}")
            if res_content != old:
                residual[path] = res_content
                notes.append(f"{path}: modified expectations stay in the solution")
        else:
            acceptance[path] = post  # type: ignore[assignment]  # replaces an existing test file
            notes.append(f"replaces existing test file {path}")
    # reference solution: base + non-test changes + residual test edits
    git("checkout", "-q", "-f", "--detach", base, cwd=wt)
    git("clean", "-q", "-fdx", cwd=wt)
    for status, path in changes:
        if is_test(path):
            continue
        full = os.path.join(wt, path)
        if status == "D":
            if os.path.exists(full):
                os.remove(full)
            continue
        os.makedirs(os.path.dirname(full) or wt, exist_ok=True)
        blob = git("show", f"{tree}:{path}").stdout
        with open(full, "w", encoding="utf-8") as fh:
            fh.write(blob)
    for path, content in residual.items():
        full = os.path.join(wt, path)
        if content is None:
            if os.path.exists(full):
                os.remove(full)
        else:
            with open(full, "w", encoding="utf-8") as fh:
                fh.write(content)
    git("add", "-A", cwd=wt)
    patch = git("diff", "--cached", "--binary", base, cwd=wt).stdout
    sol_paths = [line.split("\t")[-1] for line in git("diff", "--cached", "--name-only", base, cwd=wt).stdout.splitlines()]
    numstat = git("diff", "--cached", "--numstat", base, cwd=wt).stdout
    src_lines = sum(int(a) + int(d) for a, d, p in (ln.split("\t") for ln in numstat.splitlines())
                    if a.isdigit() and d.isdigit() and not is_test(p))
    git("reset", "-q", "--hard", cwd=wt)
    if not acceptance:
        return rec | {"status": "excluded", "reason": "no acceptance test (its test change only edits shared expectations)",
                      "notes": notes}
    if not any(is_source(p) for p in sol_paths):
        return rec | {"status": "excluded", "reason": "no source change after re-basing", "notes": notes}
    prompt, prompt_source = make_prompt(pr)
    oracle_paths = sorted(set(sol_paths) | set(acceptance))
    task = {
        "id": tag, "title": pr["title"], "prompt": prompt,
        "acceptance_tests": dict(sorted(acceptance.items())),
        "oracle_paths": oracle_paths,
        "oracle_modules": sorted({module_of(p) for p in oracle_paths}),
        "kind": kind_of(pr["title"]),
        "difficulty": 1 if src_lines <= 6 else 2 if src_lines <= 30 else 3,
        "couplings": [],
        "upstream": {"repo": REPO_URL, "pr": num, "sha": sha, "url": rec["url"], "author": pr.get("author"),
                     "merged_at": pr.get("merged_at"), "pr_base_sha": pr.get("pr_base_sha"),
                     "prompt_source": prompt_source, "source_lines_changed": src_lines, "notes": notes},
    }
    return rec | {"status": "candidate", "task": task, "patch": patch, "solution_paths": sol_paths, "notes": notes,
                  "prompt_source": prompt_source}


def window(base: str, end: str) -> tuple[list[str], list[str]]:
    revs = git("rev-list", "--first-parent", "--reverse", f"{base}..{end}").stdout.split()
    qual, other = [], []
    for c in revs:
        files = git("diff-tree", "--no-commit-id", "-r", "--name-only", c).stdout.split()
        (qual if any(is_source(f) for f in files) and any(is_test(f) for f in files) else other).append(c)
    return qual, other


def write_task(out: str, task: dict, patch: str) -> None:
    os.makedirs(os.path.join(out, "tasks"), exist_ok=True)
    os.makedirs(os.path.join(out, "solutions"), exist_ok=True)
    with open(os.path.join(out, "tasks", f"{task['id']}.json"), "w", encoding="utf-8") as fh:
        json.dump(task, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    with open(os.path.join(out, "solutions", f"{task['id']}.patch"), "w", encoding="utf-8") as fh:
        fh.write(patch)


def build(args) -> None:
    base = git("rev-parse", args.base).stdout.strip()
    end = git("rev-parse", args.end).stdout.strip()
    qual, other = window(base, end)
    out = os.path.join(HERE, "candidates")
    if os.path.exists(out):
        shutil.rmtree(out)
    os.makedirs(out)
    wt = tempfile.mkdtemp(prefix="arena-build-", dir=os.path.join(HERE, ".."))
    git("worktree", "add", "-q", "--detach", wt, base)
    rows = []
    try:
        for i, sha in enumerate(qual, 1):
            subj = git("log", "-1", "--format=%s", sha).stdout.strip()
            m = re.search(r"\(#(\d+)\)\s*$", subj)
            if not m:
                rows.append({"sha": sha, "title": subj, "status": "excluded", "reason": "no PR number"})
                continue
            with open(os.path.join(HERE, "pr", f"{m.group(1)}.json"), encoding="utf-8") as fh:
                pr = json.load(fh)
            r = build_change(base, sha, pr, wt)
            r["seq"] = i
            if r["status"] == "candidate":
                write_task(out, r.pop("task"), r.pop("patch"))
            rows.append(r)
            print(f"{i:3d} pr{pr['number']} {r['status']:9s} {r.get('reason') or r.get('prompt_source', '')}: "
                  f"{pr['title'][:70]}")
    finally:
        git("worktree", "remove", "--force", wt, check=False)
        shutil.rmtree(wt, ignore_errors=True)
    summary = {"upstream": REPO_URL, "base": base, "end": end,
               "base_date": git("log", "-1", "--format=%cI", base).stdout.strip(),
               "end_date": git("log", "-1", "--format=%cI", end).stdout.strip(),
               "window_commits": len(qual) + len(other), "qualifying": len(qual),
               "candidates": sum(1 for r in rows if r["status"] == "candidate"),
               "excluded": [r for r in rows if r["status"] != "candidate"],
               "rows": rows}
    with open(os.path.join(out, "window.json"), "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=1)
    print(f"{summary['qualifying']} qualifying changes, {summary['candidates']} candidates, "
          f"{len(summary['excluded'])} excluded")


def finalize(args) -> None:
    run = os.path.abspath(args.finalize)
    with open(os.path.join(run, "dry_run.json"), encoding="utf-8") as fh:
        dry = json.load(fh)
    cand = os.path.join(HERE, "candidates")
    with open(os.path.join(cand, "window.json"), encoding="utf-8") as fh:
        win = json.load(fh)
    for sub in ("tasks", "solutions"):
        shutil.rmtree(os.path.join(HERE, sub), ignore_errors=True)
    kept, dropped = [], []
    for row in win["rows"]:
        if row["status"] != "candidate":
            continue
        tag = f"pr{row['pr']}"
        res = dry["tasks"].get(tag)
        reasons = []
        if res is None:
            reasons.append("missing from the dry run")
        else:
            if not res.get("acceptance_fails_on_base"):
                reasons.append("acceptance tests pass on the base")
            if res.get("solution") != "passes":
                reasons.append(f"base + solution: {res.get('solution')}")
        if reasons:
            dropped.append({"pr": row["pr"], "title": row["title"], "reasons": reasons})
            continue
        kept.append(row)
    for i, row in enumerate(kept, 1):
        tag = f"pr{row['pr']}"
        with open(os.path.join(cand, "tasks", f"{tag}.json"), encoding="utf-8") as fh:
            task = json.load(fh)
        with open(os.path.join(cand, "solutions", f"{tag}.patch"), encoding="utf-8") as fh:
            patch = fh.read()
        task["id"] = f"t{i:03d}"
        write_task(HERE, task, patch)
    win["validation_run"] = os.path.relpath(run, HERE)
    win["validation_dropped"] = dropped
    win["tasks"] = [{"id": f"t{i:03d}", "pr": r["pr"], "title": r["title"]} for i, r in enumerate(kept, 1)]
    with open(os.path.join(HERE, "window.json"), "w", encoding="utf-8") as fh:
        json.dump(win, fh, indent=1)
    print(f"{len(kept)} tasks kept, {len(dropped)} dropped by validation")
    for d in dropped:
        print(f"  pr{d['pr']}: {'; '.join(d['reasons'])} ({d['title'][:60]})")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], epilog=__doc__.split("\n\n", 1)[1],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", help="common base commit (the window starts after it)")
    ap.add_argument("--end", default="origin/master", help="last commit of the window")
    ap.add_argument("--finalize", metavar="RUN", help="dry-run directory of the candidates: write the final arena")
    a = ap.parse_args()
    if a.finalize:
        finalize(a)
    elif a.base:
        build(a)
    else:
        ap.error("--base or --finalize is required")


if __name__ == "__main__":
    sys.exit(main())
