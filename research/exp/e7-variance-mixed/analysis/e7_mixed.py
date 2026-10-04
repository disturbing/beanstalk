#!/usr/bin/env python3
"""E7 part B: per-vendor outcomes and cross-vendor collisions in mixed-fleet races.

Reads race run directories (events.jsonl, summary.json and the retained work/integration repository).

Per run it reports
  * per vendor (the vendor of the agent that authored the task): tasks, greens, accepted, first-pass share,
    conflicts, reds, reworks, drops, cost, time and turns of first attempts, protected-test edits;
  * pairwise collisions over *concurrent* landed pairs, measured the way the history study measured them
    (leave-one-out revert): for landed changes i (earlier) and j (later) with j started before i landed, revert i
    from j's parent, then re-apply j; a conflict means j's landed change cannot exist without i. Pairs where
    reverting i alone already conflicts (a change between them built on i) are "entangled" and excluded.
    Rates are split same-vendor / cross-vendor;
  * the share of logged conflict events whose colliding landed change came from the other vendor, against
    the share of concurrent pairs that are cross-vendor (what a vendor-blind process would give).

Usage: python3 e7_mixed.py RUN [RUN ...] [--baseline RUN ...] [--json out.json] [--md out.md]
A run without a fleet map (Claude-only) labels every agent "claude"; --baseline runs supply, per task pair,
the Claude-only conflict propensity used to adjust for which task pairs happened to be concurrent.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import statistics
import subprocess
import sys
import tempfile
from collections import Counter, defaultdict

HOT = ("CHANGELOG.md", "README.md", "src/routes.ts", "src/types.ts", "src/config.ts", "src/lib/money.ts",
       "src/db/migrations/index.ts")


def events_of(run: str) -> list[dict]:
    with open(os.path.join(run, "events.jsonl"), encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def summary_of(run: str) -> dict:
    with open(os.path.join(run, "summary.json"), encoding="utf-8") as fh:
        return json.load(fh)


def median(xs: list[float]) -> float | None:
    return statistics.median(xs) if xs else None


def mean(xs: list[float]) -> float | None:
    return sum(xs) / len(xs) if xs else None


class Run:
    def __init__(self, path: str):
        self.path = os.path.abspath(path)
        self.name = os.path.basename(self.path)
        self.ev = events_of(path)
        self.summary = summary_of(path)
        start = next(e for e in self.ev if e["type"] == "race.start")
        self.fleet: dict[str, str] = start.get("fleet") or {}
        self.policy = self.summary.get("policy")
        self.variant = (self.summary.get("beanstalk") or {}).get("variant") or self.policy
        self.task_ids = start["tasks"]
        self.tasks: dict[str, dict] = {t: {"id": t, "reworks": [], "conflicts": [], "reds": [], "invs": [],
                                           "ejects": []} for t in self.task_ids}
        self.acceptance = self.load_acceptance()
        self.inv_meta: dict[str, dict] = {}
        self.reverted: set[str] = set()
        self.build()

    def load_acceptance(self) -> dict[str, set[str]]:
        """task -> its acceptance test paths as they appear in failing-test lists (app/ prefix stripped)."""
        out: dict[str, set[str]] = {}
        tdir = os.path.join(self.path, "work", "arena", "tasks")
        for tid in self.task_ids:
            try:
                with open(os.path.join(tdir, f"{tid}.json"), encoding="utf-8") as fh:
                    raw = json.load(fh)
            except OSError:
                continue
            out[tid] = {(p[4:] if p.startswith("app/") else p) for p in (raw.get("acceptance_tests") or {})}
        return out

    def red_kind(self, tid: str, failing_files: list[str] | None) -> str:
        """own = the task's own acceptance tests fail; other = only other tasks' (or base) tests fail."""
        own = self.acceptance.get(tid, set())
        files = set(failing_files or [])
        if not files:
            return "unknown"
        return "own" if files & own else "other"

    def vendor(self, agent: str | None) -> str:
        return self.fleet.get(agent or "", "claude")

    def build(self) -> None:
        ev = self.ev
        for e in ev:
            typ, task = e["type"], e.get("task")
            if typ == "task.start" and task in self.tasks:
                t = self.tasks[task]
                t.setdefault("start_t", e["t"])
                t.setdefault("base", e.get("base"))
                t.setdefault("author_agent", e.get("agent"))
            elif typ == "invocation.start":
                self.inv_meta[e["inv"]] = {"agent": e.get("agent"), "adapter": e.get("adapter"),
                                           "kind": e["kind"], "task": task, "model": e.get("model")}
            elif typ == "invocation.end" and task in self.tasks:
                meta = self.inv_meta.get(e["inv"], {})
                self.tasks[task]["invs"].append({
                    "inv": e["inv"], "kind": e["kind"], "agent": meta.get("agent") or e.get("agent"),
                    "vendor": meta.get("adapter") or self.vendor(e.get("agent")), "cost": e.get("cost_usd") or 0.0,
                    "wall": (e.get("wall_ms") or 0) / 1000.0, "turns": e.get("num_turns"), "ok": e.get("ok"),
                    "subtype": e.get("subtype"), "infra": e.get("infra_error"), "timed_out": e.get("timed_out"),
                    "usage": e.get("usage") or {}, "t": e["t"], "cost_source": e.get("cost_source")})
            elif typ == "task.commit" and task in self.tasks and e.get("kind") == "initial":
                self.tasks[task].setdefault("initial_files", e.get("files") or [])
                self.tasks[task].setdefault("initial_sha", e.get("sha"))
            elif typ == "land" and task in self.tasks and (e.get("kind") in (None, "task")) and not e.get("ticket"):
                t = self.tasks[task]
                if "land_sha" not in t:
                    t.update(land_sha=e["sha"], land_t=e["t"], land_files=e.get("files") or [],
                             land_seq=e["seq"])
            elif typ == "merge.conflict" and task in self.tasks:
                self.tasks[task]["conflicts"].append(e)
            elif typ == "rework.start" and task in self.tasks:
                self.tasks[task]["reworks"].append(e)
            elif typ == "preland.check" and task in self.tasks and not e.get("green"):
                self.tasks[task]["reds"].append(e)
            elif typ == "queue.eject" and task in self.tasks:
                self.tasks[task]["ejects"].append(e)
            elif typ == "revert":
                if e.get("task"):
                    self.reverted.add(e["task"])
        per_task = self.summary.get("per_task") or {}
        for tid, t in self.tasks.items():
            pt = per_task.get(tid, {})
            t["status"] = pt.get("status")
            t["accepted"] = bool(pt.get("final_acceptance"))
            t["tamper"] = pt.get("tamper") or []
            t["vendor"] = self.vendor(t.get("author_agent"))
            t["drop_reason"] = pt.get("drop_reason")

    # ---- per vendor ------------------------------------------------------------------------------------

    def per_vendor(self) -> dict[str, dict]:
        out: dict[str, dict] = {}
        for v in sorted({t["vendor"] for t in self.tasks.values()} | {i["vendor"] for t in self.tasks.values()
                                                                      for i in t["invs"]}):
            mine = [t for t in self.tasks.values() if t["vendor"] == v and t.get("start_t") is not None]
            invs = [i for t in self.tasks.values() for i in t["invs"] if i["vendor"] == v]
            first = [i for i in invs if i["kind"] == "initial"]
            rework = [i for i in invs if i["kind"] == "rework"]
            hot = [sum(1 for f in (t.get("initial_files") or []) if f in HOT) for t in mine]
            nfiles = [len([f for f in (t.get("initial_files") or [])]) for t in mine]
            tok = Counter()
            for i in invs:
                for k, val in i["usage"].items():
                    tok[k] += val or 0
            d = {
                "tasks_authored": len(mine),
                "green": sum(1 for t in mine if t["status"] == "green"),
                "accepted": sum(1 for t in mine if t["accepted"] and t["status"] == "green"),
                "dropped": sum(1 for t in mine if t["status"] == "dropped"),
                "no_rework": sum(1 for t in mine if not t["reworks"] and not t["conflicts"] and not t["reds"]
                                 and not t["ejects"]),
                "conflict_events": sum(len(t["conflicts"]) for t in mine),
                "tasks_with_conflict": sum(1 for t in mine if t["conflicts"]),
                "red_events": sum(len(t["reds"]) + sum(1 for x in t["ejects"] if x.get("reason") == "red")
                                  for t in mine),
                "tasks_with_red": sum(1 for t in mine if t["reds"] or any(x.get("reason") == "red"
                                                                          for x in t["ejects"])),
                "reds_own_tests": sum(1 for t in mine for x in t["reds"]
                                      if self.red_kind(t["id"], x.get("failing_files")) == "own")
                + sum(1 for t in mine for x in t["ejects"] if x.get("reason") == "red"
                      and self.red_kind(t["id"], x.get("files")) == "own"),
                "reds_other_tests": sum(1 for t in mine for x in t["reds"]
                                        if self.red_kind(t["id"], x.get("failing_files")) == "other")
                + sum(1 for t in mine for x in t["ejects"] if x.get("reason") == "red"
                      and self.red_kind(t["id"], x.get("files")) == "other"),
                "reworks_of_authored": sum(len(t["reworks"]) for t in mine),
                "tasks_reworked": sum(1 for t in mine if t["reworks"]),
                "invocations": len(invs), "initial_invocations": len(first), "rework_invocations": len(rework),
                "cost_usd": sum(i["cost"] for i in invs),
                "cost_per_initial": mean([i["cost"] for i in first]),
                "cost_per_rework": mean([i["cost"] for i in rework]),
                "initial_wall_median_s": median([i["wall"] for i in first]),
                "initial_turns_median": median([i["turns"] for i in first if i["turns"] is not None]),
                "rework_wall_median_s": median([i["wall"] for i in rework]),
                "non_success_invocations": sum(1 for i in invs if i["subtype"] not in ("success", None) or i["infra"]),
                "timeouts": sum(1 for i in invs if i["timed_out"]),
                "tests_edited_by_agent": sum(1 for t in mine if t["tamper"]),
                "hot_files_per_change": mean(hot),
                "files_per_change": mean(nfiles),
                "tokens": dict(tok),
                "cost_source": sorted({i["cost_source"] for i in invs if i["cost_source"]}),
            }
            out[v] = d
        return out

    # ---- pairs -------------------------------------------------------------------------------------------

    def rework_outcomes(self) -> dict[str, dict]:
        """For every rework invocation: did the very next integration outcome for that task succeed (a landing),
        or did the task collide again (another conflict, a red check or ejection, a drop)? Grouped by the vendor
        that executed the rework (under --no-queue-hold a rework can run on the other vendor's slot)."""
        by_task: dict[str, list[dict]] = defaultdict(list)
        for e in self.ev:
            t = e.get("task")
            if t in self.tasks:
                by_task[t].append(e)
        out: dict[str, Counter] = defaultdict(Counter)
        for tid, evs in by_task.items():
            for i, e in enumerate(evs):
                if e["type"] != "invocation.end" or e.get("kind") != "rework":
                    continue
                meta = self.inv_meta.get(e["inv"], {})
                vendor = meta.get("adapter") or self.vendor(e.get("agent"))
                author = self.tasks[tid]["vendor"]
                nxt = "none"
                for f in evs[i + 1:]:
                    if f["type"] == "land":
                        nxt = "landed"
                        break
                    if f["type"] in ("merge.conflict", "queue.eject", "task.drop") or (
                            f["type"] == "preland.check" and not f.get("green")):
                        nxt = "collided again" if f["type"] != "task.drop" else "dropped"
                        break
                out[vendor][nxt] += 1
                out[vendor]["cross-vendor rework" if vendor != author else "same-vendor rework"] += 1
        return {v: dict(c) for v, c in out.items()}

    def landed(self) -> list[dict]:
        rows = [t for t in self.tasks.values() if t.get("land_sha") and t["id"] not in self.reverted
                and t["status"] != "dropped" and t.get("start_t") is not None]
        return sorted(rows, key=lambda t: t["land_seq"])


def git(gitdir: str, *args: str, check: bool = False) -> subprocess.CompletedProcess:
    env = dict(os.environ, GIT_DIR=gitdir, GIT_OPTIONAL_LOCKS="0")
    return subprocess.run(["git", *args], env=env, capture_output=True, text=True, check=check)


def scratch_repo(run: Run) -> str:
    """A throwaway bare repository that reads the run's objects through alternates: merge probes write their
    trees and commits here, never into the retained run."""
    integ = os.path.join(run.path, "work", "integration", ".git")
    if not os.path.isdir(os.path.join(integ, "objects")):
        raise SystemExit(f"{run.path}: work/integration is gone; cannot probe pairs")
    tmp = tempfile.mkdtemp(prefix="e7pairs-")
    subprocess.run(["git", "init", "--bare", "-q", tmp], check=True)
    with open(os.path.join(tmp, "objects", "info", "alternates"), "w", encoding="utf-8") as fh:
        fh.write(os.path.join(integ, "objects") + "\n")
    attrs = os.path.join(integ, "info", "attributes")
    os.makedirs(os.path.join(tmp, "info"), exist_ok=True)
    if os.path.exists(attrs):
        shutil.copy(attrs, os.path.join(tmp, "info", "attributes"))
    for k, v in (("user.name", "e7"), ("user.email", "e7@invalid"), ("commit.gpgsign", "false")):
        git(tmp, "config", k, v)
    return tmp


def probe_pairs(run: Run) -> list[dict]:
    """Leave-one-out pair probes over concurrent landed pairs (see the module docstring)."""
    rows = run.landed()
    repo = scratch_repo(run)
    try:
        parent = {}
        for t in rows:
            p = git(repo, "rev-parse", f"{t['land_sha']}^").stdout.strip()
            parent[t["id"]] = p
        out = []
        for jx, tj in enumerate(rows):
            for ti in rows[:jx]:
                if tj["start_t"] >= ti["land_t"]:  # j started after i landed: j saw i, not concurrent
                    continue
                ci, pi, cj, pj = ti["land_sha"], parent[ti["id"]], tj["land_sha"], parent[tj["id"]]
                shared = set(ti.get("initial_files") or []) & set(tj.get("initial_files") or [])
                rec = {"i": ti["id"], "j": tj["id"], "vi": ti["vendor"], "vj": tj["vendor"], "status": None,
                       "shared_files": sorted(shared)}
                r1 = git(repo, "merge-tree", "--write-tree", f"--merge-base={ci}", pj, pi)
                if r1.returncode != 0:
                    rec["status"] = "entangled" if r1.returncode == 1 else f"error:{r1.stderr.strip()[:80]}"
                    out.append(rec)
                    continue
                tree = r1.stdout.split()[0]
                probe = git(repo, "commit-tree", tree, "-p", pj, "-m", "probe").stdout.strip()
                r2 = git(repo, "merge-tree", "--write-tree", f"--merge-base={pj}", probe, cj)
                rec["status"] = "clean" if r2.returncode == 0 else ("conflict" if r2.returncode == 1
                                                                     else f"error:{r2.stderr.strip()[:80]}")
                out.append(rec)
        return out
    finally:
        shutil.rmtree(repo, ignore_errors=True)


def first_attempts(run: Run) -> dict[str, dict]:
    """Does each task's FIRST committed attempt pass its own acceptance tests (and the whole suite of its
    snapshot)? Checked out from the retained integration repo into a scratch directory, `node --test`."""
    repo = scratch_repo(run)
    out: dict[str, dict] = {}
    try:
        for tid, t in run.tasks.items():
            sha = t.get("initial_sha")
            if not sha:
                continue
            tmp = tempfile.mkdtemp(prefix="e7first-")
            try:
                tar = subprocess.run(["git", "archive", sha], env=dict(os.environ, GIT_DIR=repo),
                                     capture_output=True)
                if tar.returncode != 0:
                    continue
                subprocess.run(["tar", "-x", "-C", tmp], input=tar.stdout, check=True)
                acc = sorted(run.acceptance.get(tid, set()))
                # one test process at a time and lowest priority: this must not disturb a race running beside it
                quiet = ["nice", "-n", "19", "node", "--test", "--test-concurrency=1"]
                own = subprocess.run([*quiet, *acc], cwd=tmp, capture_output=True, text=True,
                                     timeout=300) if acc else None
                suite = subprocess.run(quiet, cwd=tmp, capture_output=True, text=True, timeout=300)
                out[tid] = {"own_pass": own is not None and own.returncode == 0, "suite_pass": suite.returncode == 0}
            except (subprocess.SubprocessError, OSError):
                out[tid] = {"own_pass": None, "suite_pass": None}
            finally:
                shutil.rmtree(tmp, ignore_errors=True)
    finally:
        shutil.rmtree(repo, ignore_errors=True)
    return out


def codex_models(run: Run) -> dict:
    """Which model and reasoning effort each Codex invocation really used, from Codex's own session rollouts
    (~/.codex/sessions/YYYY/MM/DD/rollout-*-<thread id>.jsonl); the CLI's --json stream does not name the model."""
    import glob
    seen: Counter = Counter()
    missing = 0
    for t in run.tasks.values():
        for i in t["invs"]:
            if i["vendor"] != "codex":
                continue
            sid = next((e.get("session_id") for e in run.ev if e["type"] == "invocation.end" and e["inv"] == i["inv"]),
                       None)
            files = glob.glob(os.path.expanduser(f"~/.codex/sessions/*/*/*/rollout-*-{sid}.jsonl")) if sid else []
            if not files:
                missing += 1
                continue
            model = effort = None
            with open(files[0], encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    try:
                        ev = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if ev.get("type") == "turn_context":
                        pl = ev.get("payload") or {}
                        model = pl.get("model")
                        effort = pl.get("effort") or (pl.get("collaboration_mode") or {}).get("settings", {}).get(
                            "reasoning_effort")
                        break
            seen[f"{model} (effort {effort or 'model default'})"] += 1
    return {"models": dict(seen), "rollouts_missing": missing}


def pair_type(vi: str, vj: str) -> str:
    return "cross" if vi != vj else f"same-{vi}"


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (float("nan"), float("nan"))
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)


def fisher_two_sided(a: int, b: int, c: int, d: int) -> float:
    """Exact two-sided Fisher p for the table [[a, b], [c, d]]."""
    def logc(n: int, k: int) -> float:
        return math.lgamma(n + 1) - math.lgamma(k + 1) - math.lgamma(n - k + 1)
    r1, r2, c1, n = a + b, c + d, a + c, a + b + c + d
    if n == 0:
        return float("nan")
    lo, hi = max(0, c1 - r2), min(r1, c1)
    denom = logc(n, c1)
    probs = {x: math.exp(logc(r1, x) + logc(r2, c1 - x) - denom) for x in range(lo, hi + 1)}
    p_obs = probs[a]
    return min(1.0, sum(p for p in probs.values() if p <= p_obs * (1 + 1e-9)))


def pair_summary(pairs: list[dict]) -> dict:
    by = defaultdict(lambda: Counter())
    for p in pairs:
        typ = pair_type(p["vi"], p["vj"])
        by[typ][p["status"]] += 1
        if p["status"] in ("clean", "conflict") and p.get("shared_files"):
            by[typ]["overlap"] += 1
            by[typ]["overlap_conflict"] += p["status"] == "conflict"
    out = {}
    for typ, c in by.items():
        n = c["clean"] + c["conflict"]
        lo, hi = wilson(c["conflict"], n)
        olo, ohi = wilson(c["overlap"], n)
        out[typ] = {"conflict": c["conflict"], "clean": c["clean"], "entangled": c["entangled"], "n": n,
                    "rate": (c["conflict"] / n) if n else None, "lo": lo, "hi": hi,
                    "overlap": c["overlap"], "overlap_rate": (c["overlap"] / n) if n else None,
                    "overlap_lo": olo, "overlap_hi": ohi, "overlap_conflict": c["overlap_conflict"]}
    same = {k: v for k, v in out.items() if k != "cross"}
    sc, sn = sum(v["conflict"] for v in same.values()), sum(v["n"] for v in same.values())
    cx = out.get("cross")
    if cx is not None:
        lo, hi = wilson(sc, sn)
        so = sum(v["overlap"] for v in same.values())
        soc = sum(v["overlap_conflict"] for v in same.values())
        olo, ohi = wilson(so, sn)
        out["same (all)"] = {"conflict": sc, "clean": sn - sc, "n": sn, "rate": (sc / sn) if sn else None,
                             "lo": lo, "hi": hi, "overlap": so, "overlap_rate": (so / sn) if sn else None,
                             "overlap_lo": olo, "overlap_hi": ohi, "overlap_conflict": soc}
        out["fisher_p_cross_vs_same"] = fisher_two_sided(cx["conflict"], cx["clean"], sc, sn - sc)
        out["fisher_p_overlap_cross_vs_same"] = fisher_two_sided(cx["overlap"], cx["n"] - cx["overlap"], so, sn - so)
    return out


def adjusted(pairs: list[dict], baselines: list[list[dict]]) -> dict:
    """Observed vs expected conflicts if vendors did not matter: expectation for each pair = its conflict
    frequency in the Claude-only baseline runs where that task pair was probed (pairs never probed there are
    left out of both sides)."""
    freq: dict[frozenset, list[int]] = defaultdict(list)
    for probes in baselines:
        for p in probes:
            if p["status"] in ("clean", "conflict"):
                freq[frozenset((p["i"], p["j"]))].append(1 if p["status"] == "conflict" else 0)
    out: dict[str, dict] = {}
    for p in pairs:
        key = frozenset((p["i"], p["j"]))
        if p["status"] not in ("clean", "conflict") or key not in freq:
            continue
        typ = "cross" if p["vi"] != p["vj"] else "same"
        o = out.setdefault(typ, {"pairs": 0, "observed": 0, "expected": 0.0})
        o["pairs"] += 1
        o["observed"] += 1 if p["status"] == "conflict" else 0
        o["expected"] += sum(freq[key]) / len(freq[key])
    for o in out.values():
        o["ratio"] = (o["observed"] / o["expected"]) if o["expected"] else None
    return out


def collision_share(run: Run, pairs: list[dict]) -> dict:
    """Of the logged conflict events (textual conflicts met by the harness), how many collided with a landed
    change of the other vendor, against how many concurrent pairs are cross-vendor."""
    landed = {t["id"]: t for t in run.landed()}
    cross = same = 0.0
    unattributed = 0
    for tid, t in run.tasks.items():
        for c in t["conflicts"]:
            files = set(c.get("files") or [])
            culprits = [o for o in landed.values() if o["id"] != tid and o["land_t"] <= c["t"]
                        and t.get("start_t", 0) < o["land_t"] and files & set(o["land_files"])]
            if not culprits:
                unattributed += 1
                continue
            for o in culprits:
                if o["vendor"] != t["vendor"]:
                    cross += 1 / len(culprits)
                else:
                    same += 1 / len(culprits)
    exposure = Counter(pair_type(p["vi"], p["vj"]) == "cross" for p in pairs)
    n = sum(exposure.values())
    return {"events_cross": cross, "events_same": same, "unattributed": unattributed,
            "share_cross": cross / (cross + same) if cross + same else None,
            "exposure_share_cross": exposure[True] / n if n else None, "exposure_pairs": n}


# ---- output --------------------------------------------------------------------------------------------------

def f(x, d: int = 2) -> str:
    return "n/a" if x is None else (f"{x:.{d}f}" if isinstance(x, float) else str(x))


def task_rows(run: Run, fa: dict[str, dict]) -> dict[str, dict]:
    """One row per task for matched comparisons across runs (same task, different fleet or policy)."""
    rows = {}
    for tid, t in run.tasks.items():
        invs = t["invs"]
        first = next((i for i in invs if i["kind"] == "initial"), None)
        rows[tid] = {
            "vendor": t["vendor"], "status": t["status"], "accepted": t["accepted"],
            "first_own_pass": (fa.get(tid) or {}).get("own_pass"), "first_suite_pass": (fa.get(tid) or {}).get("suite_pass"),
            "conflicts": len(t["conflicts"]), "reworks": len(t["reworks"]),
            "reds": len(t["reds"]) + sum(1 for x in t["ejects"] if x.get("reason") == "red"),
            "first_cost": first["cost"] if first else None, "first_wall": first["wall"] if first else None,
            "first_turns": first["turns"] if first else None,
            "rework_cost": sum(i["cost"] for i in invs if i["kind"] == "rework"),
            "files": len(t.get("initial_files") or []), "initial_files": t.get("initial_files") or [],
            "start_t": t.get("start_t"), "land_t": t.get("land_t"),
        }
    return rows


def add_first_attempts(run: Run, pv: dict[str, dict], fa: dict[str, dict]) -> None:
    for v, d in pv.items():
        mine = [fa[t["id"]] for t in run.tasks.values() if t["vendor"] == v and t["id"] in fa
                and fa[t["id"]]["own_pass"] is not None]
        d["first_try_checked"] = len(mine)
        d["first_try_own_pass"] = sum(1 for x in mine if x["own_pass"])
        d["first_try_suite_pass"] = sum(1 for x in mine if x["suite_pass"])


def vendor_table(pv: dict[str, dict]) -> str:
    vs = list(pv)
    rows = [("tasks authored", "tasks_authored", 0),
            ("first attempt passes its own acceptance tests (pass of checked)", "first_try", 0),
            ("first attempt passes the whole suite of its snapshot (pass of checked)", "first_try_suite_pass", 0),
            ("reached green", "green", 0),
            ("green and accepted", "accepted", 0), ("dropped", "dropped", 0),
            ("landed with no conflict, red or rework", "no_rework", 0),
            ("textual conflicts met", "conflict_events", 0), ("tasks with a conflict", "tasks_with_conflict", 0),
            ("red pre-land checks / red batches", "red_events", 0), ("tasks with a red", "tasks_with_red", 0),
            ("  of which its own acceptance tests failed", "reds_own_tests", 0),
            ("  of which only other tasks' tests failed", "reds_other_tests", 0),
            ("rework rounds on its tasks", "reworks_of_authored", 0),
            ("tasks needing at least one rework", "tasks_reworked", 0),
            ("invocations run (initial / rework)", None, 0),
            ("agent cost, USD (all its invocations)", "cost_usd", 2),
            ("tokens, thousands: fresh input / cache read + write / output", "tokens", 0),
            ("cost per initial invocation, USD", "cost_per_initial", 3),
            ("cost per rework invocation, USD", "cost_per_rework", 3),
            ("initial invocation wall time, median s", "initial_wall_median_s", 1),
            ("initial invocation turns/items, median", "initial_turns_median", 1),
            ("rework wall time, median s", "rework_wall_median_s", 1),
            ("non-success invocations", "non_success_invocations", 0), ("timeouts", "timeouts", 0),
            ("tasks where the agent edited a protected test", "tests_edited_by_agent", 0),
            ("hot files touched per change", "hot_files_per_change", 2), ("files per change", "files_per_change", 2)]
    L = ["| | " + " | ".join(vs) + " |", "|---|" + "---|" * len(vs)]
    for label, key, d in rows:
        if key is None:
            cells = [f"{pv[v]['initial_invocations']} / {pv[v]['rework_invocations']}" for v in vs]
        elif key == "tokens":
            def k(v, name):
                return round(pv[v]["tokens"].get(name, 0) / 1000)
            cells = [f"{k(v, 'input_tokens')} / {k(v, 'cache_read_input_tokens') + k(v, 'cache_creation_input_tokens')}"
                     f" / {k(v, 'output_tokens')}" for v in vs]
        elif key == "first_try":
            cells = [f"{pv[v].get('first_try_own_pass', 'n/a')} of {pv[v].get('first_try_checked', 'n/a')}"
                     for v in vs]
        elif key == "first_try_suite_pass":
            cells = [f"{pv[v].get('first_try_suite_pass', 'n/a')} of {pv[v].get('first_try_checked', 'n/a')}"
                     for v in vs]
        else:
            cells = [f(pv[v][key], d) if isinstance(pv[v][key], float) else str(pv[v][key]) for v in vs]
        L.append(f"| {label} | " + " | ".join(cells) + " |")
    return "\n".join(L) + "\n"


def pair_table(ps: dict, adj: dict | None = None) -> str:
    L = ["| Pair type | concurrent pairs probed | conflicting | conflict rate [Wilson 95%] | entangled (excluded) | "
         "pairs sharing a file | share-a-file rate [Wilson 95%] | conflicts among sharing pairs |",
         "|---|---|---|---|---|---|---|---|"]
    for typ in ("cross", "same-claude", "same-codex", "same (all)"):
        v = ps.get(typ)
        if not v:
            continue
        if v["rate"] is None:
            L.append(f"| {typ} | 0 | 0 | n/a | | | | |")
            continue
        L.append(f"| {typ} | {v['n']} | {v['conflict']} | {v['rate']:.1%} [{v['lo']:.1%}, {v['hi']:.1%}] | "
                 f"{v.get('entangled', '')} | {v['overlap']} | {v['overlap_rate']:.1%} "
                 f"[{v['overlap_lo']:.1%}, {v['overlap_hi']:.1%}] | {v['overlap_conflict']} of {v['overlap']} |")
    if "fisher_p_cross_vs_same" in ps:
        L.append(f"\nFisher exact, cross vs same: conflict rate p = {ps['fisher_p_cross_vs_same']:.3f}; "
                 f"share-a-file rate p = {ps['fisher_p_overlap_cross_vs_same']:.3f}")
    if adj:
        L += ["", "| Baseline-adjusted | pairs with Claude-only baseline | observed conflicts | expected if vendor-blind |"
                  " observed / expected |", "|---|---|---|---|---|"]
        for typ, o in adj.items():
            L.append(f"| {typ} | {o['pairs']} | {o['observed']} | {o['expected']:.1f} | {f(o['ratio'])} |")
    return "\n".join(L) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("runs", nargs="+")
    ap.add_argument("--baseline", nargs="*", default=[], help="Claude-only runs of the same policy and tasks")
    ap.add_argument("--json")
    ap.add_argument("--md")
    ap.add_argument("--no-pairs", action="store_true", help="skip the git pair probes")
    ap.add_argument("--no-first", action="store_true", help="skip the first-attempt acceptance probes")
    a = ap.parse_args()
    base_probes = []
    if not a.no_pairs:
        for b in a.baseline:
            base_probes.append(probe_pairs(Run(b)))
    result, md = {}, []
    for path in a.runs:
        run = Run(path)
        pv = run.per_vendor()
        fa = first_attempts(run) if not a.no_first else {}
        if fa:
            add_first_attempts(run, pv, fa)
        md += [f"## {run.name} ({run.variant}, fleet: {dict(Counter(run.fleet.values())) or 'claude only'})", "",
               vendor_table(pv)]
        entry: dict = {"per_vendor": pv, "rework_outcomes": run.rework_outcomes(), "tasks": task_rows(run, fa),
                       "fleet": run.fleet, "policy": run.variant}
        ro = entry["rework_outcomes"]
        if ro:
            md.append("Rework rounds by the vendor that ran them, and what happened next for that task:\n")
            md += ["| Executing vendor | rework rounds | next: landed | next: collided again | next: dropped | "
                   "on the other vendor's task |", "|---|---|---|---|---|---|"]
            for v, c in sorted(ro.items()):
                n = c.get("landed", 0) + c.get("collided again", 0) + c.get("dropped", 0) + c.get("none", 0)
                md.append(f"| {v} | {n} | {c.get('landed', 0)} | {c.get('collided again', 0)} | "
                          f"{c.get('dropped', 0)} | {c.get('cross-vendor rework', 0)} |")
            md.append("")
        if run.fleet and any(v == "codex" for v in run.fleet.values()):
            cm = codex_models(run)
            entry["codex_models"] = cm
            md.append(f"Codex models observed (from Codex session rollouts): {cm['models']}"
                      f" ({cm['rollouts_missing']} rollouts not found)\n")
        if not a.no_pairs:
            pairs = probe_pairs(run)
            ps = pair_summary(pairs)
            adj = adjusted(pairs, base_probes) if base_probes and run.fleet else None
            share = collision_share(run, pairs)
            md += ["### Concurrent landed pairs (leave-one-out revert)", "", pair_table(ps, adj),
                   f"Logged conflict events by collider vendor: {share['events_cross']:.1f} cross, "
                   f"{share['events_same']:.1f} same ({share['unattributed']} unattributed); cross share of events "
                   f"{f(share['share_cross'])} against {f(share['exposure_share_cross'])} of "
                   f"{share['exposure_pairs']} concurrent pairs.\n"]
            entry.update(pairs=ps, adjusted=adj, collision_share=share, pair_rows=pairs)
        result[run.name] = entry
    out = "\n".join(md)
    print(out)
    if a.md:
        with open(a.md, "w", encoding="utf-8") as fh:
            fh.write(out)
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(result, fh, indent=1, default=str)
    return 0


if __name__ == "__main__":
    sys.exit(main())
