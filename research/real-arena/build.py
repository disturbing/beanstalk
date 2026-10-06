#!/usr/bin/env python3
"""Build a real-task arena from an upstream repository's merged pull requests (chain build).

Steps (each a subcommand; ``all`` runs clone, deps, fetch, chain, standalone, credits in order):

  clone    full clone of the upstream into upstream/<name>/ (git-ignored; history is needed for blame)
  deps     install the pinned dependency snapshot: npm ci from <arena>/deps/package-lock.json into
           <arena>/deps/node_modules (git-ignored). ``deps --lock`` regenerates the lockfile from the base's
           package.json with ``npm install --before=<base commit date>`` (registry state as of the base)
  fetch    PR metadata (title, body, author, merge time, linked issues) for the window's candidates into
           <arena>/pr/<n>.json, through read-only ``gh api`` calls
  chain    the chain build (below); writes <arena>/tasks/, solutions/ and window.json
  standalone  solutions/tNNN.standalone.patch for dependent tasks (the change plus the prerequisites' parts, against
           the base), which replay agents apply when the prerequisites have not landed
  credits  CREDITS.md: upstream, licence notice, every task's pull request and author
  offline  times the base suite (3 runs) and runs it once inside Codex's sandbox with no network except loopback,
           the same profile the race gives Codex agents; writes <arena>/suite.json

Candidates: first-parent commits in (base, end] whose subject ends in ``(#N)``, that change source (``source_re``)
and tests (``test_re`` minus ``test_exclude_re``), are not merges and not by a bot.

Chain build (doc 17 §2.1; generalised from E2's build_chain.py): S_0 = base. For candidate i in history order,
split against its own upstream parent:
  * acceptance tests (task-owned files the agent gets and may not edit): test files the change added, as they are;
    test cases it added or modified in an existing ``*.test.js``/``*.test.mjs``, extracted into
    ``<dir>/<stem>.pr<N>.test.<ext>`` next to it (extract_tests.mjs keeps imports, helpers and hooks); an existing
    helper it modified, replaced whole;
  * the solution side: every other change, plus the residual edits of shared test files (modified expectations).
The solution side is merged onto S_{i-1} (3-way, merge base = the upstream parent). A conflict means it needs a
window change that is not a task: the earlier non-task commits that wrote the conflicting files are folded in first,
as background of this task's reference solution (no dependency changes, at most 400 source lines each; a few rounds
deep). If only non-source files still conflict, the chain's version of them is kept. Otherwise it is excluded.
Then, sequentially: the acceptance tests must fail on S_{i-1} (+ background) and the whole suite must pass on
S_i = S_{i-1} + background + solution + acceptance (one retry for a flaky red). The reference solution is the patch
S_{i-1} -> S_i without the acceptance files. The race still starts every agent from the base:
a task whose prerequisite has not landed must do that part too, or meet it when it lands. Base + every solution in
order + every acceptance test is green by construction (the last task's validation is that state).

Usage:
  python3 build.py all fastify
  python3 build.py chain fastify [--skip-pr 6580,6831] [--limit 40]
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

import realarena as R

BOT = re.compile(r"\[bot\]$|^dependabot|^renovate|^github-actions", re.I)
PR_SUBJECT = re.compile(r"\(#(\d+)\)\s*$")
TEST_FILE = re.compile(r"^(.*/)?([^/]+)\.test\.(js|mjs|cjs)$")


# ---- clone, deps -------------------------------------------------------------------------------------------

def cmd_clone(a: R.Arena) -> None:
    if os.path.isdir(os.path.join(a.upstream_dir, ".git")):
        R.git("fetch", "-q", "origin", cwd=a.upstream_dir)
    else:
        os.makedirs(os.path.dirname(a.upstream_dir), exist_ok=True)
        R.git("clone", "-q", a.raw["upstream"] + ".git", a.upstream_dir, cwd=R.HERE)
    for key in ("base", "end"):
        a.git("cat-file", "-e", a.raw[key] + "^{commit}")
    print(f"{a.upstream_dir}: base {a.raw['base'][:10]} and end {a.raw['end'][:10]} present")


def cmd_deps(a: R.Arena, lock: bool) -> None:
    deps = a.path("deps")
    os.makedirs(deps, exist_ok=True)
    pkg = a.git("show", f"{a.raw['base']}:package.json").stdout
    if lock:
        with open(os.path.join(deps, "package.json"), "w", encoding="utf-8") as fh:
            fh.write(pkg)
        for stale in ("package-lock.json", "node_modules"):  # an existing lock would win over --before
            path = os.path.join(deps, stale)
            if os.path.isdir(path):
                shutil.rmtree(path)
            elif os.path.exists(path):
                os.remove(path)
        date = a.git("log", "-1", "--format=%cI", a.raw["base"]).stdout.strip()
        subprocess.run(["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=true",
                        f"--before={date}"], cwd=deps, check=True)
        return
    with open(os.path.join(deps, "package.json"), encoding="utf-8") as fh:
        if fh.read() != pkg:
            raise SystemExit("deps/package.json differs from the base's package.json; run `deps --lock`")
    subprocess.run(["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"], cwd=deps, check=True)


# ---- fetch -------------------------------------------------------------------------------------------------

def gh(path: str):
    out = subprocess.run(["gh", "api", path], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def candidates(a: R.Arena) -> tuple[list[dict], list[dict]]:
    """Window commits that qualify as tasks (with PR numbers) and the others (with the reason)."""
    revs = a.git("rev-list", "--first-parent", "--reverse", f"{a.raw['base']}..{a.raw['end']}").stdout.split()
    skip_authors = set(a.raw.get("skip_authors", []))
    qual, other = [], []
    for sha in revs:
        subj, author, parents = a.git("log", "-1", "--format=%s%x00%an%x00%P", sha).stdout.strip().split("\x00")
        row = {"sha": sha, "subject": subj, "author_name": author}
        files = a.git("diff-tree", "--no-commit-id", "-r", "--name-only", sha).stdout.split()
        m = PR_SUBJECT.search(subj)
        reason = None
        if len(parents.split()) > 1:
            reason = "merge commit"
        elif BOT.search(author) or author in skip_authors:
            reason = "bot"
        elif not any(a.is_source(f) for f in files):
            reason = "no source change"
        elif not any(a.is_test(f) for f in files):
            reason = "no test change"
        elif not m:
            reason = "no PR number (direct push or security advisory merge)"
        if reason:
            other.append(row | {"reason": reason, "touches_source": any(a.is_source(f) for f in files)})
        else:
            qual.append(row | {"pr": int(m.group(1))})
    return qual, other


def cmd_fetch(a: R.Arena) -> None:
    out = a.path("pr")
    os.makedirs(out, exist_ok=True)
    qual, _ = candidates(a)
    for c in qual:
        path = os.path.join(out, f"{c['pr']}.json")
        if os.path.exists(path):
            continue
        pr = gh(f"repos/{a.raw['slug']}/pulls/{c['pr']}")
        body = pr.get("body") or ""
        issues = []
        for n in sorted({int(x) for x in re.findall(r"(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s*:?\s+#(\d+)",
                                                     body, re.I)}):
            try:
                iss = gh(f"repos/{a.raw['slug']}/issues/{n}")
                issues.append({"number": n, "title": iss.get("title"), "body": iss.get("body") or "",
                               "is_pr": "pull_request" in iss})
            except subprocess.CalledProcessError:
                issues.append({"number": n, "error": "not found"})
        rec = {"number": c["pr"], "sha": c["sha"], "title": pr.get("title"), "body": body,
               "author": (pr.get("user") or {}).get("login"), "created_at": pr.get("created_at"),
               "merged_at": pr.get("merged_at"), "pr_base_sha": (pr.get("base") or {}).get("sha"),
               "linked_issues": issues}
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(rec, fh, indent=1, ensure_ascii=False)
            fh.write("\n")
        print(c["pr"], rec["title"])


# ---- prompts -----------------------------------------------------------------------------------------------

def clean_body(body: str, slug: str) -> str:
    body = (body or "").replace("\r\n", "\n")
    body = re.sub(r"<!--.*?-->", "", body, flags=re.S)
    # the PR template's checklist and anything after it
    body = re.split(r"\n#{1,6}\s*Checklist\b", "\n" + body, flags=re.I)[0]
    # links to the answer: the PR itself, commits, compares, branches and files of the upstream or a fork
    answer = r"https?://github\.com/[^\s)\]]+/(?:pull|commit|commits|compare|blob|tree|files)/[^\s)\]]*"
    body = re.sub(r"\[([^\]]*)\]\(" + answer + r"\)", r"\1", body)
    body = re.sub(answer, "", body)
    body = re.sub(r"^\s*(?:Co-authored-by|Signed-off-by):.*$", "", body, flags=re.M | re.I)
    body = re.sub(r"\n{3,}", "\n\n", body)
    return body.strip()


def make_prompt(pr: dict, slug: str) -> tuple[str, str]:
    body = clean_body(pr.get("body") or "", slug)
    if len(body.split()) >= 15:
        return body, "pr-description"
    for iss in pr.get("linked_issues") or []:
        ib = clean_body(iss.get("body") or "", slug)
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


# ---- splitting one change -------------------------------------------------------------------------------------

def extract_cases(a: R.Arena, base_text: str | None, post: str, residual: bool, ext: str) -> tuple[str, dict]:
    with tempfile.TemporaryDirectory() as d:
        bp, pp, op = (os.path.join(d, f"{n}.{ext}") for n in ("base", "post", "out"))
        with open(bp, "w", encoding="utf-8") as fh:
            fh.write(base_text or "")
        with open(pp, "w", encoding="utf-8") as fh:
            fh.write(post)
        argv = ["node", os.path.join(R.HERE, "extract_tests.mjs")] + (["--residual"] if residual else []) + \
               [bp if base_text is not None else "-", pp, op]
        env = dict(os.environ, TS_PATH=os.path.join(a.suite.deps or "", "typescript"))
        p = subprocess.run(argv, capture_output=True, text=True, env=env)
        if p.returncode != 0:
            raise RuntimeError(f"extract_tests.mjs failed: {p.stderr[:2000]}")
        with open(op, encoding="utf-8") as fh:
            return fh.read(), json.loads(p.stdout)


def show(a: R.Arena, rev: str, path: str) -> str | None:
    p = a.git("show", f"{rev}:{path}", check=False)
    return p.stdout if p.returncode == 0 else None


def name_status(a: R.Arena, x: str, y: str) -> list[tuple[str, str]]:
    rows = []
    for line in a.git("diff", "--name-status", "--no-renames", x, y).stdout.splitlines():
        parts = line.split("\t")
        rows.append((parts[0][0], parts[-1]))
    return rows


def split_change(a: R.Arena, sha: str, num: int, wt: str) -> dict:
    parent = a.git("rev-parse", f"{sha}^").stdout.strip()
    tag = f"pr{num}"
    changes = name_status(a, parent, sha)
    acceptance: dict[str, str] = {}
    residual: dict[str, str | None] = {}
    notes: list[str] = []
    for status, path in changes:
        if not a.is_test(path):
            continue
        post = show(a, sha, path) if status != "D" else None
        old = show(a, parent, path) if status != "A" else None
        m = TEST_FILE.match(path)
        if status == "D":
            residual[path] = None
            notes.append(f"deletes {path}")
        elif status == "A":
            acceptance[path] = post  # type: ignore[assignment]
        elif m:
            content, info = extract_cases(a, old, post or "", False, m.group(3))
            res_content, _ = extract_cases(a, old, post or "", True, m.group(3))
            if info["kept"]:
                acc = f"{m.group(1) or ''}{m.group(2)}.{tag}.test.{m.group(3)}"
                acceptance[acc] = content
                notes.append(f"{path}: {len(info['kept'])} added/modified case(s) extracted to {acc}")
            if res_content != old:
                residual[path] = res_content
                notes.append(f"{path}: modified expectations stay in the solution")
        else:
            acceptance[path] = post  # type: ignore[assignment]
            notes.append(f"replaces existing test helper {path}")
    R.git("checkout", "-q", "-f", "--detach", parent, cwd=wt)
    R.git("clean", "-q", "-fdx", cwd=wt)
    for status, path in changes:
        if a.is_test(path):
            continue
        full = os.path.join(wt, path)
        if status == "D":
            if os.path.exists(full):
                os.remove(full)
            continue
        os.makedirs(os.path.dirname(full) or wt, exist_ok=True)
        blob = subprocess.run(["git", "show", f"{sha}:{path}"], cwd=a.upstream_dir, capture_output=True,
                              check=True).stdout
        with open(full, "wb") as fh:
            fh.write(blob)
    for path, content in residual.items():
        full = os.path.join(wt, path)
        if content is None:
            if os.path.exists(full):
                os.remove(full)
        else:
            with open(full, "w", encoding="utf-8") as fh:
                fh.write(content)
    R.git("add", "-A", cwd=wt)
    R.git("commit", "-q", "--allow-empty", "--no-verify", "-m", f"solution side of {tag}", cwd=wt, fixed=True)
    return {"acceptance": acceptance, "sol_commit": R.git("rev-parse", "HEAD", cwd=wt).stdout.strip(),
            "parent": parent, "notes": notes}


def merge_tree(a: R.Arena, base: str, ours: str, theirs: str) -> tuple[str | None, list[str]]:
    p = a.git("merge-tree", "--write-tree", "--name-only", "--no-messages", f"--merge-base={base}", ours, theirs,
              check=False)
    lines = p.stdout.splitlines()
    if p.returncode == 0:
        return lines[0].strip(), []
    if p.returncode == 1:
        return None, sorted({x.strip() for x in lines[1:] if x.strip()})
    raise RuntimeError(p.stderr)


def commit_files(a: R.Arena, base_commit: str, files: dict[str, str], wt: str, msg: str) -> str:
    R.git("checkout", "-q", "-f", "--detach", base_commit, cwd=wt)
    R.git("clean", "-q", "-fdx", cwd=wt)
    for path, content in files.items():
        full = os.path.join(wt, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as fh:
            fh.write(content)
    R.git("add", "-A", cwd=wt)
    R.git("commit", "-q", "--allow-empty", "--no-verify", "-m", msg, cwd=wt, fixed=True)
    return R.git("rev-parse", "HEAD", cwd=wt).stdout.strip()


def reported_tests(paths) -> list[str]:
    return sorted(p for p in paths if TEST_FILE.match(p))


def acceptance_fails(a: R.Arena, wt: str, acceptance: dict, junit: str) -> tuple[bool, list[str]]:
    """Run only the acceptance test files on the checked-out commit: some must fail."""
    files = reported_tests(acceptance)
    if not files:
        return False, []
    cfg = a.suite
    cfg.test_args = files
    run = R.run_suite(cfg, wt, junit, timeout=300)
    return bool(set(run.failing_files) & set(files)) or not run.green, run.failing_files


# ---- chain -------------------------------------------------------------------------------------------------

def workdir(a: R.Arena) -> str:
    """Scratch space with the dependency snapshot one level above every worktree."""
    work = os.path.join(R.HERE, ".work", a.name)
    os.makedirs(work, exist_ok=True)
    link = os.path.join(work, "node_modules")
    if not os.path.lexists(link):
        os.symlink(a.suite.deps, link)
    return work


def write_task(out: str, task: dict, patch: str) -> None:
    with open(os.path.join(out, "tasks", f"{task['id']}.json"), "w", encoding="utf-8") as fh:
        json.dump(task, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    with open(os.path.join(out, "solutions", f"{task['id']}.patch"), "w", encoding="utf-8") as fh:
        fh.write(patch)


def window_commits(a: R.Arena) -> list[dict]:
    """Every first-parent commit of the window, oldest first, with the files it changes against its first parent."""
    revs = a.git("rev-list", "--first-parent", "--reverse", f"{a.raw['base']}..{a.raw['end']}").stdout.split()
    out = []
    for sha in revs:
        subj = a.git("log", "-1", "--format=%s", sha).stdout.strip()
        files = a.git("diff", "--name-only", "--no-renames", f"{sha}^1", sha).stdout.split()
        num = a.git("diff", "--numstat", f"{sha}^1", sha).stdout
        src_lines = sum(int(x) + int(y) for x, y, p in (ln.split("\t") for ln in num.splitlines())
                        if x.isdigit() and y.isdigit() and a.is_source(p))
        out.append({"sha": sha, "subject": subj, "files": files, "source_lines": src_lines})
    return out


MAX_FOLD_SOURCE_LINES = 400


def foldable(a: R.Arena, c: dict) -> bool:
    """A window commit that may be folded into a later task's reference solution as background: anything but a
    dependency change or a large merge (the v6 'next' merge: 59 files, a new undici major)."""
    if c["source_lines"] > MAX_FOLD_SOURCE_LINES:
        return False
    if "package.json" not in c["files"]:
        return True
    # a release commit ("Bumped v5.9.0") changes only the version, which fastify.js repeats; that is foldable
    diff = a.git("diff", "-U0", f"{c['sha']}^1", c["sha"], "--", "package.json").stdout
    changed = [ln for ln in diff.splitlines() if ln[:1] in "+-" and not ln.startswith(("+++", "---"))]
    return all(re.match(r'^[+-]\s*"version":', ln) for ln in changed)


def fold(a: R.Arena, state: str, c: dict) -> tuple[str | None, list[str]]:
    """Merge one upstream commit (its first-parent change) onto ``state``."""
    tree, conflicts = merge_tree(a, f"{c['sha']}^1", state, c["sha"])
    if tree is None:
        return None, conflicts
    return a.git("commit-tree", tree, "-p", state, "-m", f"background {c['sha'][:10]} {c['subject']}",
                 fixed=True).stdout.strip(), []


def cmd_chain(a: R.Arena, skip: set[int], limit: int | None, fold_on: bool = True) -> None:
    base, end = a.raw["base"], a.raw["end"]
    qual, other = candidates(a)
    allc = window_commits(a)
    pos = {c["sha"]: k for k, c in enumerate(allc)}
    work = workdir(a)
    wt, vt = os.path.join(work, "split"), os.path.join(work, "validate")
    for p in (wt, vt):
        if os.path.exists(p):
            a.git("worktree", "remove", "--force", p, check=False)
            shutil.rmtree(p, ignore_errors=True)
    a.git("worktree", "prune")
    a.git("worktree", "add", "-q", "--detach", wt, base)
    a.git("worktree", "add", "-q", "--detach", vt, base)
    junit = os.path.join(work, "junit.xml")
    rows, kept = [], []
    state = base
    in_state: set[str] = set()       # upstream commits whose change is in the chain (tasks and folds)
    acc_all: dict[str, str] = {}
    t0 = time.monotonic()
    try:
        for i, c in enumerate(qual, 1):
            if limit and len(kept) >= limit:
                rows.append({"seq": i, "pr": c["pr"], "sha": c["sha"], "status": "not reached (limit)"})
                continue
            with open(a.path("pr", f"{c['pr']}.json"), encoding="utf-8") as fh:
                pr = json.load(fh)
            tag = f"pr{pr['number']}"
            row = {"seq": i, "pr": pr["number"], "sha": c["sha"], "title": pr["title"], "author": pr.get("author")}

            def exclude(reason: str, **extra) -> None:
                rows.append(row | {"status": "excluded", "reason": reason, **extra})
                print(f"{i:3d} {tag:8s} excluded: {reason}", flush=True)

            if pr["number"] in skip:
                exclude("skipped (--skip-pr)")
                continue
            sp = split_change(a, c["sha"], pr["number"], wt)
            if not reported_tests(sp["acceptance"]):
                exclude("no acceptance test file (its test change only edits shared expectations)")
                continue
            clash = [p for p in sp["acceptance"] if p in acc_all]
            if clash:
                exclude(f"rewrites an earlier task's acceptance file {clash}")
                continue
            # the change onto the chain; on a conflict, fold in the earlier non-task window commits that wrote the
            # conflicting files (background of this task's reference solution), a few rounds deep
            pre, folded, dropped = state, [], []

            def keep_chain_version(paths: list[str]) -> None:
                """Leave ``paths`` out of the change, so the chain's version of them stands."""
                R.git("checkout", "-q", "-f", "--detach", sp["sol_commit"], cwd=wt)
                present = [p for p in paths if show(a, sp["parent"], p) is not None]
                if present:
                    R.git("checkout", sp["parent"], "--", *present, cwd=wt)
                for p in paths:
                    if p not in present and os.path.exists(os.path.join(wt, p)):
                        R.git("rm", "-q", "-f", "--", p, cwd=wt)
                R.git("commit", "-q", "--allow-empty", "--no-verify", "-m", f"{tag} without {paths}", cwd=wt,
                      fixed=True)
                sp["sol_commit"] = R.git("rev-parse", "HEAD", cwd=wt).stdout.strip()
                dropped.extend(paths)

            tree, conflicts = merge_tree(a, sp["parent"], pre, sp["sol_commit"])
            # docs, type declarations and type tests: no test reads them, so a conflict there keeps the chain's
            # version rather than folding in the docs commits that wrote it
            inessential = [p for p in conflicts if not a.is_source(p) and not a.is_test(p)]
            if tree is None and inessential:
                keep_chain_version(inessential)
                tree, conflicts = merge_tree(a, sp["parent"], pre, sp["sol_commit"])
            # source and tests: fold in the earlier non-task commits that wrote the conflicting files (background of
            # this task's reference solution), a few rounds deep
            want = set(conflicts)
            rounds = 0
            while tree is None and fold_on and rounds < 6:
                rounds += 1
                pending = [x for x in allc[:pos[c["sha"]]] if x["sha"] not in in_state
                           and x["sha"] not in {f["sha"] for f in folded} and set(x["files"]) & want
                           and foldable(a, x)]
                if not pending:
                    break
                for x in pending:
                    nxt, cf = fold(a, pre, x)
                    if nxt is None:
                        want |= set(cf)
                        continue
                    pre = nxt
                    folded.append(x)
                tree, conflicts = merge_tree(a, sp["parent"], pre, sp["sol_commit"])
                want |= set(conflicts)
            if tree is None and conflicts and all(not a.is_source(p) for p in conflicts):
                # only test files still conflict (a shared test file's residual edits next to an earlier task's
                # extracted cases): keep the chain's version and let validation decide whether the change holds
                keep_chain_version(list(conflicts))
                tree, conflicts = merge_tree(a, sp["parent"], pre, sp["sol_commit"])
            if tree is None:
                exclude("needs a window change that is not a task and cannot be folded", conflict_files=conflicts)
                continue
            new_state = a.git("commit-tree", tree, "-p", pre, "-m", f"chain {tag}", fixed=True).stdout.strip()
            commit_files(a, pre, sp["acceptance"], vt, f"acceptance of {tag} before it")
            fails, fail_pre = acceptance_fails(a, vt, sp["acceptance"], junit)
            if not fails:
                exclude("acceptance tests pass before the change")
                continue
            post = commit_files(a, new_state, sp["acceptance"], vt, f"S_i of {tag}")
            run = R.run_suite(a.suite, vt, junit)
            retried = False
            if not run.green:
                retried = True
                run = R.run_suite(a.suite, vt, junit)
            if not run.green:
                exclude(f"suite red with the change: {run.failing_files[:6]}",
                        failing=[f"{t['file']}: {t['name']}" for t in run.failing_tests[:6]],
                        folded=[x["sha"][:10] for x in folded])
                continue
            patch = a.git("diff", "--binary", state, new_state).stdout
            own = a.git("diff", "--binary", pre, new_state).stdout
            background = a.git("diff", "--binary", state, pre).stdout if folded else ""
            own_paths = a.git("diff", "--name-only", pre, new_state).stdout.split()
            sol_paths = a.git("diff", "--name-only", state, new_state).stdout.split()
            numstat = a.git("diff", "--numstat", pre, new_state).stdout
            src_lines = sum(int(x) + int(y) for x, y, p in (ln.split("\t") for ln in numstat.splitlines())
                            if x.isdigit() and y.isdigit() and a.is_source(p))
            prompt, source = make_prompt(pr, a.raw["slug"])
            in_base = merge_tree(a, sp["parent"], base, sp["sol_commit"])[0] is not None
            oracle = sorted(set(sol_paths) | set(sp["acceptance"]))
            task = {"id": tag, "title": pr["title"], "prompt": prompt,
                    "acceptance_tests": dict(sorted(sp["acceptance"].items())), "oracle_paths": oracle,
                    "oracle_modules": sorted({module_of(p) for p in oracle}), "kind": kind_of(pr["title"]),
                    "difficulty": 1 if src_lines <= 6 else 2 if src_lines <= 30 else 3, "couplings": [],
                    "upstream": {"repo": a.raw["upstream"], "pr": pr["number"], "sha": c["sha"],
                                 "url": f"{a.raw['upstream']}/pull/{pr['number']}", "author": pr.get("author"),
                                 "merged_at": pr.get("merged_at"), "prompt_source": source,
                                 "files_touched": sorted(own_paths),
                                 "source_files": sorted(p for p in own_paths if a.is_source(p)),
                                 "test_files": reported_tests(sp["acceptance"]),
                                 "source_lines_changed": src_lines, "notes": sp["notes"],
                                 "applies_to_common_base": in_base,
                                 "background": [{"sha": x["sha"], "subject": x["subject"],
                                                 "files": x["files"]} for x in folded],
                                 "kept_chain_version_of": dropped,
                                 "acceptance_failing_before": fail_pre,
                                 "suite_seconds": round(run.seconds, 1), "suite_retried": retried}}
            kept.append((task, patch, own, background))
            state = a.git("commit-tree", a.git("rev-parse", f"{post}^{{tree}}").stdout.strip(), "-p", new_state,
                          "-m", f"chain {tag} + acceptance", fixed=True).stdout.strip()
            in_state.add(c["sha"])
            in_state.update(x["sha"] for x in folded)
            acc_all.update(sp["acceptance"])
            rows.append(row | {"status": "task", "applies_to_common_base": in_base,
                               "background": [x["sha"][:10] for x in folded]})
            print(f"{i:3d} {tag:8s} task ({'common-base' if in_base else 'DEPENDS on window'}"
                  f"{', +' + str(len(folded)) + ' background' if folded else ''}) "
                  f"{time.monotonic() - t0:.0f}s: {pr['title'][:60]}", flush=True)
    finally:
        for p in (wt, vt):
            a.git("worktree", "remove", "--force", p, check=False)
    for sub in ("tasks", "solutions"):
        shutil.rmtree(a.path(sub), ignore_errors=True)
        os.makedirs(a.path(sub))
    for k, (task, patch, own, background) in enumerate(kept, 1):
        task["id"] = f"t{k:03d}"
        write_task(a.dir, task, patch)
        if background:  # the split, for the contention profile (the race uses tNNN.patch)
            for suffix, text in (("own", own), ("background", background)):
                with open(a.path("solutions", f"{task['id']}.{suffix}.diff"), "w", encoding="utf-8") as fh:
                    fh.write(text)
    window = {"variant": "chain build (history order, background folds)", "upstream": a.raw["upstream"],
              "base": base, "end": end,
              "base_date": a.git("log", "-1", "--format=%cI", base).stdout.strip(),
              "end_date": a.git("log", "-1", "--format=%cI", end).stdout.strip(),
              "window_commits": len(allc), "candidates": len(qual), "chain_state": state,
              "tasks": [{"id": t["id"], "pr": t["upstream"]["pr"], "title": t["title"],
                         "author": t["upstream"]["author"],
                         "applies_to_common_base": t["upstream"]["applies_to_common_base"],
                         "background": len(t["upstream"]["background"])} for t, *_ in kept],
              "rows": rows,
              "not_candidates": [{"sha": o["sha"][:10], "subject": o["subject"], "reason": o["reason"]}
                                 for o in other if o["touches_source"]]}
    with open(a.path("window.json"), "w", encoding="utf-8") as fh:
        json.dump(window, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    dep = sum(1 for t, *_ in kept if not t["upstream"]["applies_to_common_base"])
    bg = sum(1 for t, *_ in kept if t["upstream"]["background"])
    print(f"{len(kept)} tasks ({dep} depend on an earlier window change, {bg} carry background folds); "
          f"{len(rows) - len(kept)} excluded; {time.monotonic() - t0:.0f}s")


# ---- standalone references for dependent tasks -------------------------------------------------------------

def apply_commit(a: R.Arena, wt: str, parent: str, patch: str, files: dict[str, str], msg: str) -> str:
    R.git("checkout", "-q", "-f", "--detach", parent, cwd=wt)
    R.git("clean", "-q", "-fdx", cwd=wt)
    if patch.strip():
        with tempfile.NamedTemporaryFile("w", suffix=".patch", delete=False) as fh:
            fh.write(patch)
        try:
            R.git("apply", "--whitespace=nowarn", fh.name, cwd=wt)
        finally:
            os.remove(fh.name)
    for path, content in files.items():
        full = os.path.join(wt, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as f2:
            f2.write(content)
    R.git("add", "-A", cwd=wt)
    R.git("commit", "-q", "--allow-empty", "--no-verify", "-m", msg, cwd=wt, fixed=True)
    return R.git("rev-parse", "HEAD", cwd=wt).stdout.strip()


def cmd_standalone(a: R.Arena) -> None:
    """solutions/tNNN.standalone.patch for every task whose reference does not apply to the base: the task's change
    plus the earlier tasks' changes it builds on (transitively), against the base, without any acceptance file.
    Replay agents fall back to it when the prerequisites have not landed yet (harness/agents.py); real agents get
    nothing from it. Checked: base + standalone + the task's acceptance tests passes those tests."""
    names = sorted(n for n in os.listdir(a.path("tasks")) if n.endswith(".json"))
    tasks = []
    for n in names:
        with open(a.path("tasks", n), encoding="utf-8") as fh:
            tasks.append(json.load(fh))
    base = a.raw["base"]
    work = workdir(a)
    wt = os.path.join(work, "standalone")
    if os.path.exists(wt):
        a.git("worktree", "remove", "--force", wt, check=False)
    a.git("worktree", "prune")
    a.git("worktree", "add", "-q", "--detach", wt, base)
    acc_paths = sorted({p for t in tasks for p in t["acceptance_tests"]})
    junit = os.path.join(work, "junit-standalone.xml")
    prev, before, after = base, {}, {}
    try:
        for t in tasks:  # the chain, reproduced: C_{j-1} -> C_j is task j's reference + acceptance
            with open(a.path("solutions", f"{t['id']}.patch"), encoding="utf-8") as fh:
                patch = fh.read()
            before[t["id"]] = prev
            prev = after[t["id"]] = apply_commit(a, wt, prev, patch, t["acceptance_tests"], t["id"])
        prereqs: dict[str, list[str]] = {}
        order = {t["id"]: n for n, t in enumerate(tasks)}
        made = 0
        for k, t in enumerate(tasks):
            tid = t["id"]
            path = a.path("solutions", f"{tid}.standalone.patch")
            if os.path.exists(path):
                os.remove(path)
            need: list[str] = []
            for _ in range(12):
                state = base
                ok = True
                for i in [x["id"] for x in tasks[:k] if x["id"] in need] + [tid]:
                    tree, conflicts = merge_tree(a, before[i], state, after[i])
                    if tree is None:
                        ok = False
                        # the closest earlier tasks that wrote the conflicting files, with their own prerequisites
                        upto = [x for x in tasks[:order[i]] if x["id"] not in need]
                        writers = [x["id"] for x in upto if set(x["oracle_paths"]) & set(conflicts)]
                        for w in writers:
                            need += [w] + [p for p in prereqs.get(w, []) if p not in need]
                        if not writers:
                            need = None  # type: ignore[assignment]
                        break
                    state = a.git("commit-tree", tree, "-p", state, "-m", i, fixed=True).stdout.strip()
                if ok or need is None:
                    break
            if need is None or not ok:
                print(f"{tid}: no standalone reference (conflicts not explained by earlier tasks)")
                t["upstream"]["prerequisites"] = None
                continue
            def build_on_base(ids: list[str]) -> str | None:
                st = base
                for i in [x["id"] for x in tasks[:k] if x["id"] in ids] + [tid]:
                    tr, _ = merge_tree(a, before[i], st, after[i])
                    if tr is None:
                        return None
                    st = a.git("commit-tree", tr, "-p", st, "-m", i, fixed=True).stdout.strip()
                return st

            need = sorted(set(need))
            for p in sorted(need, reverse=True):  # minimise: drop every prerequisite the change applies without
                trial = [x for x in need if x != p]
                got = build_on_base(trial)
                if got is not None:
                    need, state = trial, got
            prereqs[tid] = need
            t["upstream"]["prerequisites"] = prereqs[tid]
            if not need:
                continue
            patch = a.git("diff", "--binary", base, state, "--", ".", *[f":(exclude){p}" for p in acc_paths]).stdout
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(patch)
            # check: base + standalone + this task's acceptance tests passes them
            apply_commit(a, wt, base, patch, t["acceptance_tests"], f"{tid} standalone check")
            cfg = a.suite
            cfg.test_args = reported_tests(t["acceptance_tests"])
            run = R.run_suite(cfg, wt, junit, timeout=300)
            t["upstream"]["standalone_acceptance_green"] = run.green
            made += 1
            print(f"{tid}: standalone with {prereqs[tid]} -> acceptance {'green' if run.green else 'RED ' + str(run.failing_files[:3])}",
                  flush=True)
        for t in tasks:
            with open(a.path("tasks", f"{t['id']}.json"), "w", encoding="utf-8") as fh:
                json.dump(t, fh, indent=2, ensure_ascii=False)
                fh.write("\n")
        print(f"{made} standalone references")
    finally:
        a.git("worktree", "remove", "--force", wt, check=False)


# ---- credits -----------------------------------------------------------------------------------------------

def cmd_credits(a: R.Arena) -> None:
    """CREDITS.md: the upstream project, its licence notice, and every task's pull request and author."""
    licence = a.git("show", f"{a.raw['base']}:LICENSE").stdout.strip()
    rows = []
    for name in sorted(os.listdir(a.path("tasks"))):
        with open(a.path("tasks", name), encoding="utf-8") as fh:
            t = json.load(fh)
        u = t["upstream"]
        rows.append(f"| {t['id']} | [#{u['pr']}]({u['url']}) | {t['title'].replace('|', '/')} | "
                    f"[@{u['author']}](https://github.com/{u['author']}) | {(u.get('merged_at') or '')[:10]} |")
    authors = sorted({r.split("[@")[1].split("]")[0] for r in rows}, key=str.lower)
    text = f"""# Credits: {a.name}

This arena is built from [{a.raw['slug']}]({a.raw['upstream']}) ({a.raw['licence']}). Its base is upstream commit
`{a.raw['base']}`; every task is one pull request merged upstream after it. A task's prompt is the pull request's
title and description, its acceptance tests are the tests the pull request added or changed, and its reference
solution (`solutions/`) is the pull request's own change, re-based in history order (the chain build). All of that
work is the upstream authors'; this directory only rearranges it into race tasks. Thank you.

## Pull requests and their authors

| task | pull request | title | author | merged |
|---|---|---|---|---|
{chr(10).join(rows)}

{len(rows)} tasks by {len(authors)} authors: {', '.join('@' + x for x in authors)}.

## Upstream licence

The upstream's licence at the base commit, which covers the tests and patches copied here:

```
{licence}
```
"""
    with open(a.path("CREDITS.md"), "w", encoding="utf-8") as fh:
        fh.write(text)
    print(f"{a.path('CREDITS.md')}: {len(rows)} tasks, {len(authors)} authors")


# ---- offline suite check -------------------------------------------------------------------------------------

def codex_offline_wrapper(cwd: str) -> list[str]:
    """``codex sandbox`` with the race's loopback-only profile for Codex agents (harness/agents.py)."""
    sys.path.insert(0, R.RACE)
    from harness.agents import CodexAdapter
    return ["codex", "sandbox", *CodexAdapter.loopback_profile(cwd), "--"]


def cmd_offline(a: R.Arena, runs: int) -> None:
    work = workdir(a)
    vt = os.path.join(work, "offline")
    if os.path.exists(vt):
        a.git("worktree", "remove", "--force", vt, check=False)
    a.git("worktree", "prune")
    a.git("worktree", "add", "-q", "--detach", vt, a.raw["base"])
    junit = os.path.join(vt, ".junit-offline.xml")  # inside the worktree: the sandbox writes only there
    node = subprocess.run(["node", "--version"], capture_output=True, text=True).stdout.strip()
    cpus = os.cpu_count()
    try:
        timings = []
        for _ in range(runs):
            r = R.run_suite(a.suite, vt, junit)
            timings.append({"seconds": round(r.seconds, 2), "green": r.green, "tests": r.tests,
                            "failing": r.failing_files})
            print(f"base suite: {r.seconds:.1f}s, {r.tests} tests, green={r.green} {r.failing_files[:5]}", flush=True)
        r = R.run_suite(a.suite, vt, junit, wrapper=codex_offline_wrapper(vt))
        offline = {"seconds": round(r.seconds, 2), "green": r.green, "tests": r.tests, "failing": r.failing_files,
                   "how": "codex sandbox with the race's loopback-only permissions profile (no internet)"}
        print(f"offline (codex sandbox): {r.seconds:.1f}s, {r.tests} tests, green={r.green} {r.failing_files[:5]}")
    finally:
        a.git("worktree", "remove", "--force", vt, check=False)
    rec = {"base": a.raw["base"], "node": node, "cpus": cpus, "machine": os.uname().machine,
           "command": a.suite.command, "runs": timings, "offline": offline,
           "measured": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
    with open(a.path("suite.json"), "w", encoding="utf-8") as fh:
        json.dump(rec, fh, indent=1)
        fh.write("\n")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], epilog=__doc__.split("\n\n", 1)[1],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("step", choices=["all", "clone", "deps", "fetch", "chain", "standalone", "offline", "credits"])
    ap.add_argument("arena", help="arena name (a directory next to this script) or path")
    ap.add_argument("--lock", action="store_true", help="deps: regenerate the lockfile from the base")
    ap.add_argument("--skip-pr", default="", help="chain: comma-separated PR numbers to leave out")
    ap.add_argument("--limit", type=int, help="chain: stop after this many tasks")
    ap.add_argument("--no-fold", action="store_true", help="chain: exclude, rather than fold, a change that needs a "
                                                          "non-task window commit (E2's behaviour)")
    ap.add_argument("--runs", type=int, default=3, help="offline: timed base-suite runs")
    ns = ap.parse_args()
    path = ns.arena if os.sep in ns.arena else os.path.join(R.HERE, ns.arena)
    a = R.load(path)
    skip = {int(x) for x in ns.skip_pr.split(",") if x.strip()}
    if ns.step in ("all", "clone"):
        cmd_clone(a)
    if ns.step in ("all", "deps"):
        cmd_deps(a, ns.lock)
    if ns.step in ("all", "fetch"):
        cmd_fetch(a)
    if ns.step in ("all", "chain"):
        cmd_chain(a, skip, ns.limit, fold_on=not ns.no_fold)
    if ns.step in ("all", "standalone"):
        cmd_standalone(a)
    if ns.step in ("all", "credits"):
        cmd_credits(a)
    if ns.step == "offline":
        cmd_offline(a, ns.runs)
    return 0


if __name__ == "__main__":
    sys.exit(main())
