#!/usr/bin/env python3
"""E1 analysis: correctness against the hidden arena acceptance tests, and the quality of agent-written tests.

Usage: python3 e1_analyze.py RUN [RUN ...] --scratch DIR [--jobs 2] [--json out.json] [--md out.md]

For each run (a race directory with events.jsonl, summary.json, config.json and work/integration):
  oracle at landing   each landed bean's hidden arena tests on its own landing commit (the bean merged onto the sprout)
  oracle on stalk     every green task's hidden arena tests on the final green commit (the stalk)
  regressions         green tasks whose hidden tests pass at landing and fail on the stalk, with the landing that broke them
  bean-written tests  the test files each bean added or changed, minus its given or test-author acceptance tests, run on
                      the landing parent (the code just before the change): new test cases that already pass there
                      prove nothing about the change; a bean "proves nothing" when none of its new cases fails there
  test-author tests   (--tests first) the accepted files on the task's start snapshot and on the arena's reference solution
  canonical baseline  the arena's own acceptance tests on the arena base and on each reference solution

Runs are only read: the integration repo is mirrored into --scratch, trees are materialised with `git archive`, and at
most --jobs test jobs run at once (each is one `node --test --test-concurrency=1`, i.e. two node processes).
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from harness.e1_tests import is_load_failure, is_test_file, junit_cases  # noqa: E402

ARENA = os.path.normpath(os.path.join(HERE, "..", "arena"))
ARENA_GIT = os.path.normpath(os.path.join(HERE, "..", "corpora", "arena.git"))


# ---- git and trees --------------------------------------------------------------------------------------------

def git(gitdir: str, *args: str) -> str:
    return subprocess.run(["git", f"--git-dir={gitdir}", *args], capture_output=True, text=True, check=True).stdout


def mirror(run_dir: str, scratch: str) -> str:
    src = os.path.join(run_dir, "work", "integration")
    dst = os.path.join(scratch, "mirrors", os.path.basename(os.path.normpath(run_dir)) + ".git")
    if not os.path.exists(dst):
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        subprocess.run(["git", "clone", "-q", "--mirror", "--no-local", src, dst], check=True)
    return dst


def materialize(gitdir: str, rev: str, dest: str) -> None:
    os.makedirs(dest, exist_ok=True)
    arch = subprocess.Popen(["git", f"--git-dir={gitdir}", "archive", rev], stdout=subprocess.PIPE)
    subprocess.run(["tar", "-x", "-C", dest], stdin=arch.stdout, check=True)
    arch.stdout.close()  # type: ignore[union-attr]
    if arch.wait() != 0:
        raise RuntimeError(f"git archive {rev} failed in {gitdir}")


class Runner:
    def __init__(self, scratch: str, jobs: int):
        self.trees = os.path.join(scratch, "trees")
        os.makedirs(self.trees, exist_ok=True)
        self.pool = cf.ThreadPoolExecutor(max_workers=max(1, jobs))
        self.env = {k: v for k, v in os.environ.items() if not k.startswith(("NODE_OPTIONS", "NODE_TEST"))}
        self.env["CI"] = "1"
        self.count = 0

    def submit(self, gitdir: str, rev: str, files: dict[str, str], run: list[str]) -> cf.Future:
        return self.pool.submit(self.run, gitdir, rev, files, run)

    def run(self, gitdir: str, rev: str, files: dict[str, str], run: list[str]) -> dict:
        """Materialise ``rev``, write ``files`` over it, run ``run`` with node --test. {path: {cases, load_failure,
        missing}} plus "_output"."""
        d = tempfile.mkdtemp(dir=self.trees)
        junit = d + ".xml"
        try:
            materialize(gitdir, rev, d)
            for p, c in files.items():
                full = os.path.join(d, p)
                os.makedirs(os.path.dirname(full), exist_ok=True)
                with open(full, "w", encoding="utf-8") as fh:
                    fh.write(c)
            present = [p for p in run if os.path.exists(os.path.join(d, p))]
            out = ""
            cases: list[dict] = []
            if present:
                pr = subprocess.run(["node", "--test", "--test-concurrency=1", "--test-timeout=60000",
                                     "--test-reporter=spec", "--test-reporter-destination=stdout",
                                     "--test-reporter=junit", f"--test-reporter-destination={junit}", *present],
                                    cwd=d, capture_output=True, text=True, timeout=900, env=self.env)
                out = (pr.stdout + "\n" + pr.stderr)[-20000:]
                cases = junit_cases(junit, d) or []
            self.count += 1
            res: dict = {"_output": out}
            for p in run:
                cs = [c for c in cases if c["file"] == p]
                res[p] = {"cases": cs, "load_failure": is_load_failure(p, cs), "missing": p not in present}
            return res
        finally:
            shutil.rmtree(d, ignore_errors=True)
            try:
                os.remove(junit)
            except OSError:
                pass


def all_pass(res: dict, paths: list[str]) -> bool:
    """Every file ran, had at least one case, and every case passed (a skip is not a pass)."""
    for p in paths:
        r = res.get(p) or {}
        if r.get("missing") or not r.get("cases") or any(c["status"] != "pass" for c in r["cases"]):
            return False
    return bool(paths)


def first_failure(res: dict, paths: list[str]) -> str:
    for p in paths:
        r = res.get(p) or {}
        if r.get("missing"):
            return f"{p}: missing"
        for c in r.get("cases", []):
            if c["status"] != "pass":
                return f"{p} > {c['name'].split(' > ')[-1]}: {c['message'][:160]}"
    return ""


# ---- inputs ---------------------------------------------------------------------------------------------------

def load_canonical(arena: str) -> dict[str, dict[str, str]]:
    out = {}
    tdir = os.path.join(arena, "tasks")
    for name in sorted(os.listdir(tdir)):
        if name.endswith(".json"):
            with open(os.path.join(tdir, name), encoding="utf-8") as fh:
                raw = json.load(fh)
            out[raw["id"]] = {(p[4:] if p.startswith("app/") else p): c
                              for p, c in (raw.get("acceptance_tests") or {}).items()}
    return out


def arena_digest(arena: str) -> str:
    """Same hash as harness.core.snapshot_arena, without copying."""
    h = hashlib.sha256()
    for sub, ext in (("tasks", ".json"), ("solutions", ".patch")):
        src = os.path.join(arena, sub)
        for name in sorted(os.listdir(src)) if os.path.isdir(src) else []:
            if name.endswith(ext):
                with open(os.path.join(src, name), "rb") as fh:
                    h.update(f"{sub}/{name}\0".encode() + fh.read() + b"\0")
    return h.hexdigest()[:16]


def read_run(run: str) -> tuple[dict, list[dict], dict]:
    with open(os.path.join(run, "config.json"), encoding="utf-8") as fh:
        cfg = json.load(fh)
    with open(os.path.join(run, "events.jsonl"), encoding="utf-8") as fh:
        ev = [json.loads(line) for line in fh if line.strip()]
    with open(os.path.join(run, "summary.json"), encoding="utf-8") as fh:
        summary = json.load(fh)
    return cfg, ev, summary


def author_files(run: str, ev: list[dict]) -> dict[str, dict[str, str]]:
    """Accepted test-author files per task (--tests first), from <run>/testsfirst/<task>/<attempt>/."""
    out: dict[str, dict[str, str]] = {}
    for e in ev:  # final paths after the forge's per-task renaming (testsfirst/<task>/accepted/)
        if e["type"] == "testsfirst.accepted":
            files = {}
            for p in e.get("files") or []:
                with open(os.path.join(run, "testsfirst", e["task"], "accepted", p), encoding="utf-8") as fh:
                    files[p] = fh.read()
            out[e["task"]] = files
    if out:
        return out
    for e in ev:  # runs from before the renaming step
        if e["type"] == "testsfirst.proof" and e.get("ok"):
            base = os.path.join(run, "testsfirst", e["task"], str(e["attempt"]))
            files = {}
            for p in e.get("accepted") or []:
                with open(os.path.join(base, p), encoding="utf-8") as fh:
                    files[p] = fh.read()
            out[e["task"]] = files
    return out


# ---- per-run analysis -----------------------------------------------------------------------------------------

def case_names(res: dict, p: str) -> list[str]:
    return [c["name"] for c in (res.get(p) or {}).get("cases", [])]


def new_case_statuses(landed: dict, parent: dict, old: dict | None, p: str) -> list[str]:
    """Status on the pre-change tree of each test case the bean added to file ``p``."""
    names = case_names(landed, p)
    if (landed.get(p) or {}).get("load_failure"):
        names = []
    if old is not None and not (old.get(p) or {}).get("load_failure"):
        prev = set(case_names(old, p))
        names = [n for n in names if n not in prev]
    pr = parent.get(p) or {}
    if pr.get("missing") or pr.get("load_failure"):
        return ["fail"] * len(names)  # the file cannot even load without the change
    by = {c["name"]: c["status"] for c in pr.get("cases", [])}
    return [by.get(n, "fail") for n in names]


def load_couplings(arena: str) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    tdir = os.path.join(arena, "tasks")
    for name in sorted(os.listdir(tdir)):
        if name.endswith(".json"):
            with open(os.path.join(tdir, name), encoding="utf-8") as fh:
                raw = json.load(fh)
            out[raw["id"]] = {c["with"]: c.get("type", "") for c in raw.get("couplings") or [] if c.get("with")}
    return out


def analyze_run(run: str, scratch: str, runner: Runner, canonical: dict, digest: str,
                couplings: dict | None = None) -> dict:
    couplings = couplings or {}
    cfg, ev, summary = read_run(run)
    mode = cfg.get("tests", "given")
    gitdir = mirror(run, scratch)
    setup = next(e for e in ev if e["type"] == "race.setup")
    starts: dict[str, str] = {}
    for e in ev:
        if e["type"] in ("testsfirst.start", "task.start"):
            starts.setdefault(e["task"], e["base"])
    trunk: list[dict] = []
    lands: dict[str, dict] = {}
    for e in ev:
        if e["type"] == "land" and e.get("kind") == "task":
            lands[e["task"]] = {"sha": e["sha"], "idx": e["trunk_idx"], "t": e["t"]}
            trunk.append({"idx": e["trunk_idx"], "sha": e["sha"], "task": e["task"], "kind": "task"})
        elif e["type"] == "revert":
            trunk.append({"idx": e["trunk_idx"], "sha": e["sha"], "task": e.get("task"), "kind": "revert"})
    trunk.sort(key=lambda c: c["idx"])
    reverted = {e.get("task") for e in ev if e["type"] == "revert"}
    final_ev = next((e for e in ev if e["type"] == "final.check"), {})
    final_sha = final_ev.get("sha") or (summary.get("final") or {}).get("sha")
    per_task_summary = summary.get("per_task", {})
    authors = author_files(run, ev) if mode == "first" else {}
    tids = sorted(per_task_summary)

    # 1. hidden arena tests at each landing, and on the stalk
    fut_land = {t: runner.submit(gitdir, lands[t]["sha"], canonical[t], sorted(canonical[t])) for t in lands}
    all_files: dict[str, str] = {}
    for t in tids:
        all_files.update(canonical[t])
    fut_final = runner.submit(gitdir, final_sha, all_files, sorted(all_files)) if final_sha else None

    # 2. bean-written test files per landed bean
    beans: dict[str, dict] = {}
    for t, info in lands.items():
        parent = git(gitdir, "rev-parse", f"{info['sha']}^").strip()
        info["parent"] = parent
        diff = git(gitdir, "diff", "--name-status", "--no-renames", parent, info["sha"]).splitlines()
        exclude = set(canonical[t]) if mode == "given" else set(authors.get(t, {})) if mode == "first" else set()
        files = []
        for line in diff:
            st, path = line.split("\t", 1)
            if is_test_file(path) and path not in exclude and st[0] in "AM":
                files.append((path, st[0]))
        paths = [p for p, _ in files]
        content = {p: git(gitdir, "show", f"{info['sha']}:{p}") for p in paths}
        mod = [p for p, s in files if s == "M"]
        b = {"files": files}
        if paths:
            b["f_landed"] = runner.submit(gitdir, info["sha"], {}, paths)
            b["f_parent"] = runner.submit(gitdir, parent, content, paths)
            b["f_old"] = runner.submit(gitdir, parent, {}, mod) if mod else None
            if starts.get(t) and starts[t] != parent:
                b["f_start"] = runner.submit(gitdir, starts[t], content, paths)
        beans[t] = b

    # 2b. erosion: which bean-written cases still exist on the stalk (same file, same full name)
    bean_paths = sorted({p for b in beans.values() for p, _ in b["files"]})
    f_stalk_tests = runner.submit(gitdir, final_sha, {}, bean_paths) if (final_sha and bean_paths) else None

    # 3. test-author files: on the start snapshot and on the reference solution
    auth: dict[str, dict] = {}
    for t, files in authors.items():
        paths = sorted(files)
        auth[t] = {"paths": paths, "f_start": runner.submit(gitdir, starts[t], files, paths),
                   "f_ref": runner.submit(ARENA_GIT, f"refs/heads/ref/{t}", files, paths)}

    # collect
    rows: dict[str, dict] = {}
    oracle_final = fut_final.result() if fut_final else {}
    stalk_tests = f_stalk_tests.result() if f_stalk_tests else {}
    for t in tids:
        st = per_task_summary[t]
        row = {"task": t, "status": st["status"], "landed": t in lands, "reverted": t in reverted,
               "drop_reason": st.get("drop_reason")}
        if t in lands:
            r = fut_land[t].result()
            row["oracle_landing"] = all_pass(r, sorted(canonical[t]))
            if not row["oracle_landing"]:
                row["oracle_landing_failure"] = first_failure(r, sorted(canonical[t]))
        if oracle_final:
            row["oracle_stalk"] = all_pass(oracle_final, sorted(canonical[t]))
            if st["status"] == "green" and not row["oracle_stalk"]:
                row["oracle_stalk_failure"] = first_failure(oracle_final, sorted(canonical[t]))
        b = beans.get(t)
        if b is not None:
            row["bean_test_files"] = [f"{p} ({s})" for p, s in b["files"]]
            statuses: list[str] = []
            statuses_start: list[str] = []
            files_vacuous = 0
            if b["files"]:
                landed = b["f_landed"].result()
                parent = b["f_parent"].result()
                old = b["f_old"].result() if b.get("f_old") else None
                start = b["f_start"].result() if b.get("f_start") else None
                lost = 0
                detects = False
                changed_detecting = 0
                for p, s in b["files"]:
                    ss = new_case_statuses(landed, parent, old if s == "M" else None, p)
                    statuses += ss
                    pr = parent.get(p) or {}
                    if pr.get("missing") or pr.get("load_failure") or any(c["status"] == "fail" for c in pr.get("cases", [])):
                        detects = True  # the bean's tests, as landed, fail without its change
                    if s == "M" and old is not None and not (old.get(p) or {}).get("load_failure") \
                            and not pr.get("load_failure"):
                        prev = set(case_names(old, p))
                        changed_detecting += sum(1 for c in pr.get("cases", []) if c["name"] in prev and c["status"] == "fail")
                    names = case_names(landed, p)
                    if s == "M" and old is not None and not (old.get(p) or {}).get("load_failure"):
                        prev = set(case_names(old, p))
                        names = [n for n in names if n not in prev]
                    on_stalk = set(case_names(stalk_tests, p)) if row["status"] == "green" else None
                    if on_stalk is not None:
                        lost += sum(1 for n in names if n not in on_stalk)
                if row["status"] == "green":
                    row["new_cases_lost_on_stalk"] = lost
                    if ss and not any(x == "fail" for x in ss):
                        files_vacuous += 1
                    if start is not None:
                        statuses_start += new_case_statuses(landed, start, old if s == "M" else None, p)
                    else:
                        statuses_start += ss
                row["bean_tests_pass_landed"] = all(c["status"] == "pass" for p, _ in b["files"]
                                                    for c in (landed.get(p) or {}).get("cases", []))
            row["new_cases"] = len(statuses)
            row["new_pass_on_parent"] = statuses.count("pass")
            row["new_fail_on_parent"] = statuses.count("fail")
            row["new_skip"] = statuses.count("skip")
            row["new_pass_on_start"] = statuses_start.count("pass")
            row["files_vacuous"] = files_vacuous
            row["changed_cases_detecting"] = changed_detecting if b["files"] else 0
            row["has_test_changes"] = bool(b["files"])
            row["detects_change"] = detects if b["files"] else False
            row["proves_nothing"] = bool(b["files"]) and not detects
        a = auth.get(t)
        if a is not None:
            s_res, r_res = a["f_start"].result(), a["f_ref"].result()
            cs = [c for p in a["paths"] for c in (s_res.get(p) or {}).get("cases", [])]
            loadf = sum(1 for p in a["paths"] if (s_res.get(p) or {}).get("load_failure"))
            row["author_files"] = a["paths"]
            row["author_load_fail_on_start"] = loadf
            row["author_cases_on_start"] = len(cs)
            row["author_pass_on_start"] = sum(1 for c in cs if c["status"] == "pass")
            row["author_pass_on_reference"] = all_pass(r_res, a["paths"])
            if not row["author_pass_on_reference"]:
                row["author_reference_failure"] = first_failure(r_res, a["paths"])
            rcs = [c for p in a["paths"] for c in (r_res.get(p) or {}).get("cases", [])]
            row["author_cases_on_reference"] = len(rcs)
            row["author_cases_pass_on_reference"] = sum(1 for c in rcs if c["status"] == "pass")
        rows[t] = row

    # 4. regressions: green, correct at landing, wrong on the stalk -> first trunk commit where it fails
    final_idx = next((c["idx"] for c in trunk if c["sha"] == final_sha), None)
    for t, row in rows.items():
        if row["status"] == "green" and row.get("oracle_landing") and row.get("oracle_stalk") is False:
            seq = [c for c in trunk if lands[t]["idx"] < c["idx"] <= (final_idx if final_idx is not None else 10 ** 9)]
            lo, hi = -1, len(seq) - 1  # seq[hi] fails (the stalk); find the first failing position
            while hi - lo > 1:
                mid = (lo + hi) // 2
                r = runner.run(gitdir, seq[mid]["sha"], canonical[t], sorted(canonical[t]))
                if all_pass(r, sorted(canonical[t])):
                    lo = mid
                else:
                    hi = mid
            row["regressed_by"] = seq[hi]["task"] if seq else None
            row["regressed_at_idx"] = seq[hi]["idx"] if seq else None
            row["regressed_by_designed_partner"] = row["regressed_by"] in couplings.get(t, {})
    for t, row in rows.items():  # why a green task is wrong on the stalk
        if row["status"] == "green" and row.get("oracle_stalk") is False:
            before = [o for o in couplings.get(t, {}) if o in lands and lands[o]["idx"] < lands[t]["idx"]
                      and o not in reverted]
            row["partners_landed_before"] = before
            if row.get("oracle_landing") is False:
                row["wrong_cause"] = ("wrong at landing, designed partner landed first" if before else
                                      "wrong at landing (own spec)")
            else:
                row["wrong_cause"] = ("broken later by its designed partner" if row.get("regressed_by_designed_partner")
                                      else "broken later by another change")

    agg = aggregate(rows, mode)
    agg.update(run_facts(run, ev, summary, mode))
    agg["kth_correct_green"] = kth_correct(ev, rows)
    agg["leak_check"] = leak_check(run, ev)
    agg["auth_check"] = auth_check(ev)
    agg.update({"run": os.path.basename(os.path.normpath(run)), "tests": mode, "final_sha": final_sha,
                "arena_digest_ok": setup.get("arena_digest") == digest, "cost_usd": summary.get("cost_usd"),
                "cost_by_kind": summary.get("cost_by_kind"), "red_validations": summary.get("red_validations"),
                "tasks_green": summary.get("tasks_green"), "drops_by_reason": summary.get("drops_by_reason"),
                "harness_final_correct": (summary.get("final") or {}).get("correct"),
                "harness_final_green_accepted": (summary.get("final") or {}).get("green_tasks_accepted")})
    return {"aggregate": agg, "tasks": rows}


LEAK_PATTERNS = ("arena/tasks", "acceptance_tests", "solutions/t0", ".patch", "arena.git", "refs/heads/ref", "ref/t0",
                 "/research/arena", "testsfirst/")


def leak_check(run: str, ev: list[dict]) -> dict:
    """Every tool call in the agents' transcripts whose input mentions where the hidden tests or the reference
    solutions live, plus the permission denials the CLI reported (attempts outside what the agent may do)."""
    tdir = os.path.join(run, "work", "transcripts")
    hits, calls = [], 0
    for name in sorted(os.listdir(tdir)) if os.path.isdir(tdir) else []:
        if not name.endswith(".jsonl"):
            continue
        with open(os.path.join(tdir, name), encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if '"tool_use"' not in line:
                    continue
                try:
                    msg = json.loads(line).get("message") or {}
                except json.JSONDecodeError:
                    continue
                for block in msg.get("content") or []:
                    if isinstance(block, dict) and block.get("type") == "tool_use":
                        calls += 1
                        text = json.dumps(block.get("input"))
                        if any(p in text for p in LEAK_PATTERNS):
                            hits.append(f"{name[:-6]}: {block.get('name')} {text[:200]}")
    denials = [f"{e.get('inv')}: {json.dumps(d)[:200]}" for e in ev if e["type"] == "invocation.end"
               for d in (e.get("permission_denials") or [])]
    return {"tool_calls": calls, "suspicious_calls": hits[:20], "suspicious_count": len(hits),
            "permission_denials": len(denials), "denial_examples": denials[:8]}


AUTH = re.compile(r"403|not allowed|log ?in", re.I)


def auth_check(ev: list[dict]) -> dict:
    """Contamination by the 2026-10-03 auth outage: auth failures arrive as is_error results whose text mentions
    403, "not allowed" or login (not as crashes). Counts non-success invocations and those auth-shaped ones."""
    ends = [e for e in ev if e["type"] == "invocation.end"]
    bad = [e for e in ends if e.get("is_error") or e.get("infra_error") or e.get("subtype") not in ("success", None)]
    auth = [e["inv"] for e in bad if AUTH.search(f"{e.get('result_text') or ''} {e.get('infra_error') or ''}")]
    return {"invocations": len(ends), "non_success": [f"{e['inv']}:{e.get('subtype')}" for e in bad],
            "auth_failures": auth, "contaminated": bool(auth)}


def kth_correct(ev: list[dict], rows: dict[str, dict], ks=(10, 20, 25, 30, 33, 35)) -> dict:
    """Minutes and $ to the k-th green task that is also correct on the final stalk (kth_green.py's clock and cost)."""
    from kth_green import cost_at, green_times
    good = [(t, task) for t, task in green_times(ev) if rows.get(task, {}).get("oracle_stalk")]
    out = {}
    for k in ks:
        if len(good) >= k:
            t = good[k - 1][0]
            out[str(k)] = f"{t / 60:.1f} / {cost_at(ev, t):.2f}"  # same clock as kth_green.py (event t)
        else:
            out[str(k)] = "not reached"
    out["correct_greens"] = len(good)
    return out


def median(xs: list[float]) -> float | None:
    xs = sorted(xs)
    if not xs:
        return None
    m = len(xs) // 2
    return round(xs[m] if len(xs) % 2 else (xs[m - 1] + xs[m]) / 2, 3)


def run_facts(run: str, ev: list[dict], summary: dict, mode: str) -> dict:
    """Load proxy (real suite seconds of the pre-land checks), recorded uptime, and tests-first proof outcomes."""
    out: dict = {"preland_suite_seconds_median": median([e["suite_seconds"] for e in ev if e["type"] == "preland.check"
                                                         and e.get("suite_seconds") is not None]),
                 "preland_checks": sum(1 for e in ev if e["type"] == "preland.check"),
                 "preland_red": sum(1 for e in ev if e["type"] == "preland.check" and not e.get("green")),
                 "decision_cards": sum(1 for e in ev if e["type"] == "decision.request"),
                 "reworks": summary.get("invocations", {}).get("rework", 0),
                 "acceptance_restored": summary.get("acceptance_restored"),
                 "wall_minutes": round((summary.get("wall_seconds") or 0) / 60, 2)}
    up = os.path.join(os.path.dirname(os.path.normpath(run)), os.path.basename(os.path.normpath(run)) + ".uptime")
    if os.path.exists(up):
        with open(up, encoding="utf-8") as fh:
            out["uptime"] = [ln.strip() for ln in fh if ln.strip()]
    if mode == "first":
        proofs = [e for e in ev if e["type"] == "testsfirst.proof"]
        by_task: dict[str, list[dict]] = {}
        for e in proofs:
            by_task.setdefault(e["task"], []).append(e)
        verdicts: dict[str, int] = {}
        for e in proofs:
            for v in (e.get("verdicts") or {}).values():
                verdicts[v["status"]] = verdicts.get(v["status"], 0) + 1
        starts = {e["task"]: e["t"] for e in ev if e["type"] == "testsfirst.start"}
        impl = {}
        for e in ev:
            if e["type"] == "task.start" and e["task"] in starts:
                impl.setdefault(e["task"], e["t"] - starts[e["task"]])
        out.update({
            "author_accepted_first_session": sum(1 for v in by_task.values() if v[0].get("ok")),
            "author_accepted_after_retry": sum(1 for v in by_task.values() if not v[0].get("ok") and v[-1].get("ok")),
            "author_rejected_dropped": sorted(t for t, v in by_task.items() if not v[-1].get("ok")),
            "author_file_verdicts": verdicts,
            "author_reasons_rejected": [f"{e['task']}#{e['attempt']}: " + "; ".join(
                f"{p}: {v['why']}" for p, v in (e.get("verdicts") or {}).items() if v["status"] != "fails-first")
                + (" (no new test file)" if not e.get("verdicts") else "") for e in proofs if not e.get("ok")],
            "author_phase_seconds_median": median(list(impl.values())),
            "author_edits_reverted": sum(len(e.get("reverted") or []) for e in proofs),
            "author_files_removed": sum(len(e.get("removed") or []) for e in proofs),
            "testauthor_cost_usd": round((summary.get("cost_by_kind") or {}).get("testauthor", 0.0), 4),
            "testauthor_sessions": (summary.get("invocations") or {}).get("testauthor", 0),
        })
    return out


def aggregate(rows: dict[str, dict], mode: str) -> dict:
    landed = [r for r in rows.values() if r["landed"]]
    green = [r for r in rows.values() if r["status"] == "green"]
    beans = [r for r in landed if "new_cases" in r]
    with_tests = [r for r in beans if r.get("has_test_changes")]
    cases = sum(r["new_cases"] for r in beans)
    out = {
        "landed": len(landed), "green": len(green),
        "oracle_landing_pass": sum(1 for r in landed if r.get("oracle_landing")),
        "green_oracle_stalk_pass": sum(1 for r in green if r.get("oracle_stalk")),
        "stalk_correct_by_oracle": all(r.get("oracle_stalk") for r in green) if green else None,
        "green_wrong_at_landing": sorted(r["task"] for r in green if r.get("oracle_landing") is False),
        "green_regressed": sorted(f"{r['task']}<-{r.get('regressed_by')}" for r in green
                                  if r.get("oracle_landing") and r.get("oracle_stalk") is False),
        "green_wrong_causes": {c: sorted(r["task"] for r in green if r.get("wrong_cause") == c)
                               for c in sorted({r["wrong_cause"] for r in green if r.get("wrong_cause")})},
        "all_tasks_oracle_stalk_pass": sum(1 for r in rows.values() if r.get("oracle_stalk")),
        "beans_measured": len(beans), "beans_with_new_tests": len(with_tests),
        "beans_without_new_tests": len(beans) - len(with_tests),
        "beans_without_test_changes": sorted(r["task"] for r in beans if not r.get("has_test_changes")),
        "changed_cases_detecting": sum(r.get("changed_cases_detecting", 0) for r in beans),
        "new_cases": cases,
        "new_cases_pass_on_parent": sum(r["new_pass_on_parent"] for r in beans),
        "new_cases_skipped": sum(r["new_skip"] for r in beans),
        "share_new_cases_pass_on_parent": round(sum(r["new_pass_on_parent"] for r in beans) / cases, 3) if cases else None,
        "share_new_cases_pass_on_start": round(sum(r["new_pass_on_start"] for r in beans) / cases, 3) if cases else None,
        "beans_proving_nothing": sorted(r["task"] for r in with_tests if r["proves_nothing"]),
        "share_beans_with_tests_proving_nothing": round(sum(1 for r in with_tests if r["proves_nothing"]) /
                                                        len(with_tests), 3) if with_tests else None,
        "files_vacuous": sum(r.get("files_vacuous", 0) for r in beans),
        "green_new_cases": sum(r["new_cases"] for r in beans if "new_cases_lost_on_stalk" in r),
        "green_new_cases_lost_on_stalk": sum(r.get("new_cases_lost_on_stalk", 0) for r in beans),
        "beans_new_test_files_added": sum(1 for r in beans if any(f.endswith("(A)") for f in r.get("bean_test_files", []))),
    }
    if mode == "first":
        au = [r for r in rows.values() if "author_files" in r]
        ac = sum(r["author_cases_on_start"] for r in au)
        out.update({
            "author_tasks": len(au),
            "author_cases_on_start": ac,
            "author_cases_pass_on_start": sum(r["author_pass_on_start"] for r in au),
            "author_files_load_fail_on_start": sum(r["author_load_fail_on_start"] for r in au),
            "author_tasks_pass_on_reference": sum(1 for r in au if r["author_pass_on_reference"]),
            "author_tasks_fail_on_reference": sorted(r["task"] for r in au if not r["author_pass_on_reference"]),
            "author_cases_on_reference": sum(r["author_cases_on_reference"] for r in au),
            "author_cases_pass_on_reference": sum(r["author_cases_pass_on_reference"] for r in au),
        })
    return out


def canonical_baseline(runner: Runner, canonical: dict) -> dict:
    """The arena's own acceptance tests: per-case pass share on the base, and on each task's reference solution."""
    base = runner.run(ARENA_GIT, "refs/heads/main", {p: c for v in canonical.values() for p, c in v.items()},
                      sorted({p for v in canonical.values() for p in v}))
    loaded = [c for t in canonical for p in canonical[t] if not (base.get(p) or {}).get("load_failure")
              for c in (base.get(p) or {}).get("cases", [])]
    load_fail = sum(1 for t in canonical for p in canonical[t] if (base.get(p) or {}).get("load_failure"))
    futs = {t: runner.submit(ARENA_GIT, f"refs/heads/ref/{t}", {}, sorted(canonical[t])) for t in canonical}
    ref_ok = sum(1 for t, f in futs.items() if all_pass(f.result(), sorted(canonical[t])))
    return {"files": sum(len(v) for v in canonical.values()), "files_load_fail_on_base": load_fail,
            "cases_in_loading_files": len(loaded), "cases_pass_on_base": sum(1 for c in loaded if c["status"] == "pass"),
            "tasks_pass_on_reference": ref_ok, "tasks": len(canonical)}


def to_markdown(results: list[dict], baseline: dict | None) -> str:
    keys = [("tests", "tests"), ("green", "greens"), ("landed", "landed"),
            ("oracle_landing_pass", "landed beans correct at landing (hidden tests)"),
            ("green_oracle_stalk_pass", "green tasks correct on the stalk"),
            ("stalk_correct_by_oracle", "stalk correct (every green task)"),
            ("green_wrong_at_landing", "green but wrong at landing"), ("green_regressed", "green, broken later (by)"),
            ("beans_with_new_tests", "beans with bean-written test changes"),
            ("beans_without_test_changes", "beans without any test change"),
            ("new_cases", "bean-written test cases"), ("share_new_cases_pass_on_parent", "share passing before the change"),
            ("beans_proving_nothing", "beans whose tests prove nothing (all pass without the change)"),
            ("changed_cases_detecting", "changed existing cases that detect the change"),
            ("beans_new_test_files_added", "beans that added a test file of their own"),
            ("green_new_cases_lost_on_stalk", "bean-written cases (green tasks) gone from the stalk"),
            ("green_new_cases", "bean-written cases of green tasks"),
            ("share_beans_with_tests_proving_nothing", "share of beans with tests"),
            ("author_tasks", "test-author tasks"), ("author_cases_pass_on_start", "author cases passing on snapshot"),
            ("author_cases_on_start", "author cases"),
            ("author_tasks_pass_on_reference", "author tests pass the reference solution (tasks)"),
            ("author_tasks_fail_on_reference", "author tests reject the reference solution"),
            ("author_accepted_first_session", "author proofs accepted, first session"),
            ("author_accepted_after_retry", "author proofs accepted after one retry"),
            ("author_rejected_dropped", "tasks dropped without a proof"),
            ("author_phase_seconds_median", "author phase median s (start to implementer)"),
            ("testauthor_sessions", "test-author sessions"), ("testauthor_cost_usd", "test-author cost $"),
            ("cost_usd", "cost $"), ("red_validations", "red validations"), ("preland_checks", "pre-land checks"),
            ("preland_red", "pre-land reds"), ("reworks", "reworks"), ("decision_cards", "decision cards"),
            ("wall_minutes", "wall min"), ("preland_suite_seconds_median", "median real suite s (load proxy)"),
            ("arena_digest_ok", "arena digest ok")]
    head = ["metric"] + [r["aggregate"]["run"] for r in results]
    lines = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    for k, label in keys:
        vals = [r["aggregate"].get(k, "-") for r in results]
        if all(v in ("-", None) for v in vals):
            continue
        lines.append(f"| {label} | " + " | ".join(
            (", ".join(v) if isinstance(v, list) else str(v)) if v not in (None,) else "-" for v in vals) + " |")
    if baseline:
        lines += ["", f"Canonical baseline: {baseline}"]
    return "\n".join(lines) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("runs", nargs="+")
    ap.add_argument("--scratch", required=True, help="scratch directory for repo mirrors and trees")
    ap.add_argument("--arena", default=ARENA)
    ap.add_argument("--jobs", type=int, default=2, help="parallel test jobs (each = 2 node processes); default 2")
    ap.add_argument("--json", help="write the full results here")
    ap.add_argument("--md", help="write the summary table here")
    ap.add_argument("--baseline", action="store_true", help="also measure the arena's own acceptance tests")
    a = ap.parse_args()
    os.makedirs(a.scratch, exist_ok=True)
    canonical = load_canonical(a.arena)
    digest = arena_digest(a.arena)
    runner = Runner(a.scratch, a.jobs)
    results = []
    for run in a.runs:
        print(f"analysing {run} ...", file=sys.stderr)
        results.append(analyze_run(os.path.abspath(run), a.scratch, runner, canonical, digest,
                                   load_couplings(a.arena)))
        print(json.dumps(results[-1]["aggregate"], indent=1), file=sys.stderr)
    baseline = canonical_baseline(runner, canonical) if a.baseline else None
    out = {"label": "measured: hidden arena acceptance tests as oracle; node test runs on materialised trees",
           "runs": results, "canonical_baseline": baseline, "node_jobs": runner.count}
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(out, fh, indent=1, default=str)
    md = to_markdown(results, baseline)
    if a.md:
        with open(a.md, "w", encoding="utf-8") as fh:
            fh.write(md)
    print(md)


if __name__ == "__main__":
    main()
