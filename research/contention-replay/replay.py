#!/usr/bin/env python3
"""Contention replay (Beanstalk research, step 1): do concurrent changes textually conflict,
and do the conflicts cluster?

Input is a corpus written by ../common/corpus.py (one change per line, in merge order) and
the git repository it came from. Two measurements:

Pair test (leave-one-out revert), for every pair i < j with j - i < W ("sliding predecessors"):
    X  = parent_j with i reverted:   merge-tree --merge-base=sha_i  parent_j parent_i
         conflict -> "entangled": a change between i and j built on i's lines, so the pair
         cannot be isolated.
    X' = commit-tree X -p parent_j
    Y  = j re-applied onto X':       merge-tree --merge-base=parent_j  X' sha_j
         conflict -> "conflict": j overlaps i textually; clean -> "clean".
  Conflicted paths come from the second merge. In branch mode (every record has the same
  parent, e.g. the arena) the test is direct: merge-tree --merge-base=base tip_i tip_j.

Window-base pass: fixed windows of W changes (stride W). B = parent of the window's first
change. Every change is re-applied onto B (merge-tree --merge-base=parent_j B sha_j); a
conflict means it collides with at least one earlier change of its window
("depends_on_window"). per_change_collision_rate excludes each window's first change.

Semantic check (--check-cmd): for sampled clean pairs, materialise the tree with i only, the
tree with j only and the merged tree (git archive | tar -x), run --check-setup then
--check-cmd in each. clean_but_broken = both alone pass and the merged tree fails.

Outputs in --out: pairs.jsonl, changes.jsonl, summary.json (+ semantic.jsonl). Every git
command runs in a scratch repository whose packs are copy-on-write clones of the source
repository's packs; the source repository is only read. Standard library only.
"""
from __future__ import annotations

import argparse
import json
import math
import multiprocessing as mp
import os
import random
import shutil
import subprocess
import sys
import tempfile
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

sys.dont_write_bytecode = True  # never write .pyc files next to ../common/corpus.py
_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent / "common"))
import corpus as corpuslib  # noqa: E402  classify(), module_of(), package_roots()

DISSOLVABLE = frozenset({"lockfile", "changelog", "snapshot", "generated"})
# Conflict types a merge driver (union / regenerate, set through .gitattributes) gets to resolve:
# content-level merges, binary ones included (git hands binary content to a configured driver
# too). modify/delete, rename/delete, file/directory and similar are tree-level: no driver runs.
DRIVER_TYPES = frozenset({"CONFLICT (contents)", "CONFLICT (add/add)", "CONFLICT (binary)"})
NON_AGENT = frozenset({"human", "bot"})
IMPLIED_N = (5, 20, 100, 1000)
DEFAULT_WINDOW = 20
DEFAULT_COLLISION_WINDOWS = "10,20,50"
IDENTITY = {  # fixed identity and date: replayed commits are deterministic
    "GIT_AUTHOR_NAME": "beanstalk-replay", "GIT_AUTHOR_EMAIL": "replay@beanstalk.invalid",
    "GIT_AUTHOR_DATE": "946684800 +0000",
    "GIT_COMMITTER_NAME": "beanstalk-replay", "GIT_COMMITTER_EMAIL": "replay@beanstalk.invalid",
    "GIT_COMMITTER_DATE": "946684800 +0000",
}
# Scratch objects are throwaway: no fsync, no automatic gc or maintenance.
GIT_OPTS = ("-c", "core.fsync=none", "-c", "gc.auto=0", "-c", "maintenance.auto=false")
MERGE_TREE = ("merge-tree", "--write-tree", "--stdin", "--name-only", "--messages")


# ----------------------------------------------------------------------------- git plumbing

def git_env(**extra: str) -> dict[str, str]:
    """Environment for every git call: user/system config ignored (merge settings are git's
    defaults: rename detection on, merge.directoryRenames=conflict), fixed identity."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update(GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1", GIT_TERMINAL_PROMPT="0",
               GIT_NO_REPLACE_OBJECTS="1", LC_ALL="C")
    env.update(IDENTITY)
    env.update(extra)
    return env


def run_git(env: dict, args: list[str], input: bytes | None = None,
            check: bool = True) -> subprocess.CompletedProcess:
    proc = subprocess.run(["git", *GIT_OPTS, *args], input=input, capture_output=True, env=env)
    if check and proc.returncode != 0:
        err = proc.stderr.decode("utf-8", "replace").strip()[-500:]
        raise RuntimeError(f"git {args[0]} failed ({proc.returncode}): {err}")
    return proc


@dataclass(frozen=True)
class Merge:
    status: str                    # "clean" | "conflict" | "error"
    tree: str | None = None
    paths: tuple[str, ...] = ()    # conflicted paths (--name-only)
    types: tuple[str, ...] = ()    # <conflict-type> strings of the informational messages
    error: str | None = None


def parse_merge_stream(data: bytes) -> list[Merge]:
    """Parse `git merge-tree --write-tree --stdin --name-only --messages` output.

    --stdin implies -z. Each merge is a sequence of NUL-terminated fields:
        <status> <tree> {<conflicted path>} "" {<n> <path>*n <type> <message>} ""
    status "1" = clean, "0" = conflicted. --messages is forced so that clean merges carry the
    (possibly empty) messages section too and every record has the same shape. Only complete
    records are returned: a truncated tail (git died part-way through a batch) is dropped.
    """
    toks = data.split(b"\0")[:-1]  # drop the remainder after the last NUL
    out: list[Merge] = []
    p, n = 0, len(toks)
    while p < n:
        try:
            status = toks[p]
            if status not in (b"0", b"1"):
                break
            tree = toks[p + 1].decode("ascii")
            p += 2
            paths = []
            while toks[p]:
                paths.append(toks[p].decode("utf-8", "replace"))
                p += 1
            p += 1
            types = []
            while toks[p]:
                k = int(toks[p])
                p += 1 + k
                types.append(toks[p].decode("utf-8", "replace"))
                p += 2  # <type> and <message>
            p += 1  # end of this merge
        except (IndexError, ValueError):
            break
        out.append(Merge("clean" if status == b"1" else "conflict", tree, tuple(paths), tuple(types)))
    return out


def run_merge_batch(env: dict, lines: list[str]) -> list[Merge]:
    """Run merges ("<base> -- <side1> <side2>") through one `git merge-tree --stdin` process.

    git stops at the first merge it cannot perform (exit status > 1) after flushing the
    merges before it; that line is recorded as an error and the batch resumes after it."""
    results: list[Merge] = []
    start = 0
    while start < len(lines):
        payload = "".join(line + "\n" for line in lines[start:]).encode()
        proc = subprocess.run(["git", *GIT_OPTS, *MERGE_TREE], input=payload,
                              capture_output=True, env=env)
        got = parse_merge_stream(proc.stdout)[: len(lines) - start]
        results.extend(got)
        start += len(got)
        if start < len(lines):
            err = proc.stderr.decode("utf-8", "replace").strip().splitlines()
            results.append(Merge("error", error=(err[-1] if err else f"exit {proc.returncode}")[:300]))
            start += 1
    return results


def commit_tree(env: dict, tree: str, parent: str, message: str) -> str | None:
    proc = run_git(env, ["commit-tree", tree, "-p", parent, "-m", message], check=False)
    return proc.stdout.decode().strip() if proc.returncode == 0 else None


def resolve_revs(env: dict, revs: list[str]) -> dict[str, str | None]:
    """rev -> object id (None when missing), through one `git cat-file --batch-check`."""
    revs = list(dict.fromkeys(revs))
    if not revs:
        return {}
    proc = run_git(env, ["cat-file", "--batch-check=%(objectname) %(objecttype)"],
                   input="".join(r + "\n" for r in revs).encode())
    out: dict[str, str | None] = {}
    for rev, line in zip(revs, proc.stdout.decode().splitlines()):
        parts = line.split()
        out[rev] = parts[0] if len(parts) == 2 and not line.endswith(" missing") else None
    return out


def conflict_types(types: tuple[str, ...]) -> tuple[str, ...]:
    return tuple(sorted({t for t in types if t.startswith("CONFLICT")}))


# ------------------------------------------------------------------ the three kinds of task

def window_base(env: dict, items: list[tuple]) -> list[tuple]:
    """items: (key, parent_j, base, sha_j, base_tree) -> (key, reason)."""
    merges = run_merge_batch(env, [f"{pj} -- {b} {sj}" for _, pj, b, sj, _ in items])
    out = []
    for (key, pj, b, _sj, base_tree), m in zip(items, merges):
        if m.status == "error":
            reason = "error"
        elif m.status == "conflict":
            reason = "depends_on_window"
        elif pj != b and m.tree == base_tree:
            reason = "empty"  # re-applied cleanly but changes nothing on the window base
        else:
            reason = "applies"
        out.append((key, reason))
    return out


def pair_history(env: dict, items: list[tuple]) -> list[tuple]:
    """Leave-one-out revert test. items: (key, sha_i, parent_i, sha_j, parent_j).

    Returns (key, result, conflict_paths, conflict_types, info) with result in clean |
    conflict | entangled | error; info = {"y": tree of j re-applied, "x": tree of X,
    "j_empty": j changes nothing once i is removed} or {"stage", "error"} for errors."""
    step1 = run_merge_batch(env, [f"{si} -- {pj} {pi}" for _, si, pi, _, pj in items])
    out: list[tuple | None] = [None] * len(items)
    commits: dict[tuple[str, str], str | None] = {}
    stage2: list[tuple[int, str]] = []
    for idx, ((key, si, _pi, _sj, pj), m) in enumerate(zip(items, step1)):
        if m.status == "error":
            out[idx] = (key, "error", (), (), {"stage": "revert", "error": m.error})
        elif m.status == "conflict":
            out[idx] = (key, "entangled", (), conflict_types(m.types), {})
        else:
            ck = (m.tree, pj)
            if ck not in commits:
                commits[ck] = commit_tree(env, m.tree, pj, f"beanstalk-replay: {pj[:12]} without {si[:12]}")
            if commits[ck] is None:
                out[idx] = (key, "error", (), (), {"stage": "commit-tree", "error": "commit-tree failed"})
            else:
                stage2.append((idx, commits[ck]))
    step2 = run_merge_batch(env, [f"{items[idx][4]} -- {c} {items[idx][3]}" for idx, c in stage2])
    for (idx, _c), m in zip(stage2, step2):
        key = items[idx][0]
        if m.status == "error":
            out[idx] = (key, "error", (), (), {"stage": "reapply", "error": m.error})
        else:
            x_tree = step1[idx].tree
            out[idx] = (key, m.status, m.paths if m.status == "conflict" else (),
                        conflict_types(m.types), {"x": x_tree, "y": m.tree, "j_empty": m.tree == x_tree})
    return out  # type: ignore[return-value]


def pair_branch(env: dict, items: list[tuple]) -> list[tuple]:
    """Direct test for branch mode. items: (key, base, sha_i, sha_j)."""
    merges = run_merge_batch(env, [f"{b} -- {si} {sj}" for _, b, si, sj in items])
    out = []
    for (key, *_rest), m in zip(items, merges):
        if m.status == "error":
            out.append((key, "error", (), (), {"stage": "merge", "error": m.error}))
        else:
            out.append((key, m.status, m.paths if m.status == "conflict" else (),
                        conflict_types(m.types), {"merged": m.tree}))
    return out


_CTX: dict = {}


def _worker_init(ctx: dict) -> None:
    _CTX.clear()
    _CTX.update(ctx)


def task_env(ctx: dict) -> tuple[str, dict]:
    """A fresh object directory for one task: new objects land there and are deleted with it."""
    objdir = tempfile.mkdtemp(prefix="objects-", dir=ctx["scratch"])
    env = git_env(GIT_DIR=ctx["repo"], GIT_OBJECT_DIRECTORY=objdir,
                  GIT_ALTERNATE_OBJECT_DIRECTORIES=os.pathsep.join(ctx["alternates"]))
    return objdir, env


def _run_task(task: tuple) -> tuple:
    kind, items = task
    objdir, env = task_env(_CTX)
    try:
        if kind == "window":
            return kind, window_base(env, items)
        if kind == "history":
            return kind, pair_history(env, items)
        if kind == "branch":
            return kind, pair_branch(env, items)
        raise ValueError(f"unknown task kind {kind!r}")
    finally:
        shutil.rmtree(objdir, ignore_errors=True)


def run_tasks(tasks: list[tuple], ctx: dict, jobs: int, label: str, total: int, log) -> list[tuple]:
    """Run tasks on a process pool; returns the flattened per-item results."""
    out: list[tuple] = []
    done, t0, last = 0, time.time(), 0.0
    if jobs <= 1 or len(tasks) <= 1:
        _worker_init(ctx)
        results = map(_run_task, tasks)
        pool = None
    else:
        pool = mp.get_context("spawn").Pool(min(jobs, len(tasks)), initializer=_worker_init, initargs=(ctx,))
        results = pool.imap_unordered(_run_task, tasks)
    try:
        for _kind, items in results:
            out.extend(items)
            done += len(items)
            if time.time() - last > 15 or done == total:
                last = time.time()
                log(f"{label}: {done}/{total} ({100 * done / max(1, total):.0f}%), {time.time() - t0:.0f}s")
    finally:
        if pool is not None:
            pool.close()
            pool.join()
    return out


# ---------------------------------------------------------------------- scratch repository

def prepare_scratch_repo(src: str, scratch: Path, revs: list[str]) -> dict:
    """Bare scratch repo whose packs are copy-on-write clones (cp -c, APFS) or copies of the
    source packs. The source is only read. Writing an object that already exists in an
    *alternate* refreshes that alternate's mtime, so when the cloned packs miss corpus
    objects (a repository of loose objects) git pack-objects packs them from the source into
    the scratch repo instead; the source becomes an alternate only as a last resort."""
    env0 = git_env()
    gitdir = Path(run_git(env0, ["-C", src, "rev-parse", "--absolute-git-dir"]).stdout.decode().strip())
    src_objects = gitdir / "objects"
    repo = scratch / "repo.git"
    run_git(env0, ["init", "-q", "--bare", "--template=", str(repo)])
    pack_dst = repo / "objects" / "pack"
    pack_dst.mkdir(parents=True, exist_ok=True)
    method = "none"
    packs = sorted((src_objects / "pack").glob("pack-*")) if (src_objects / "pack").is_dir() else []
    for f in packs:
        dst = pack_dst / f.name
        if subprocess.run(["cp", "-c", str(f), str(dst)], capture_output=True).returncode == 0:
            method = "clone" if method in ("none", "clone") else method
        else:
            shutil.copyfile(f, dst)
            method = "copy"
    if (gitdir / "shallow").exists():
        shutil.copyfile(gitdir / "shallow", repo / "shallow")
    ctx = {"repo": str(repo), "alternates": [str(repo / "objects")], "scratch": str(scratch),
           "objects": method, "source_objects": str(src_objects)}
    env = git_env(GIT_DIR=ctx["repo"])
    if [r for r, oid in resolve_revs(env, revs).items() if oid is None]:
        run_git(env0, ["-C", src, "pack-objects", "-q", "--revs", str(pack_dst / "pack")],
                input="".join(r + "\n" for r in revs).encode())
        method = ctx["objects"] = f"{method}+pack-objects"
    missing = [r for r, oid in resolve_revs(env, revs).items() if oid is None]
    if missing:
        ctx["alternates"].append(str(src_objects))
        ctx["objects"] = f"{method}+alternates"
        env = git_env(GIT_DIR=ctx["repo"], GIT_ALTERNATE_OBJECT_DIRECTORIES=os.pathsep.join(ctx["alternates"][1:]))
        still = [r for r, oid in resolve_revs(env, missing).items() if oid is None]
        if still:
            raise SystemExit(f"{len(still)} corpus commits are missing from {src} (e.g. {still[0]})")
    return ctx


# ------------------------------------------------------------------------- corpus handling

_ESCAPES = {"a": 7, "b": 8, "t": 9, "n": 10, "v": 11, "f": 12, "r": 13, '"': 34, "\\": 92}


def unquote_git_path(p: str) -> str:
    """Undo git's C-style path quoting ("caf\\303\\251.md" -> café.md); others unchanged."""
    if len(p) < 2 or p[0] != '"' or p[-1] != '"':
        return p
    body, out, i = p[1:-1], bytearray(), 0
    while i < len(body):
        c = body[i]
        if c == "\\" and i + 1 < len(body):
            nxt, octal = body[i + 1], body[i + 1:i + 4]
            if len(octal) == 3 and all(ch in "01234567" for ch in octal):
                out.append(int(octal, 8))
                i += 4
                continue
            if nxt in _ESCAPES:
                out.append(_ESCAPES[nxt])
                i += 2
                continue
        out += c.encode("utf-8")
        i += 1
    return out.decode("utf-8", "replace")


class ModuleMap:
    """Module of a path: the corpus's own assignment when the path appears in it, else
    corpus.py's module_of() with the package roots at --roots-ref (or --module-depth)."""

    def __init__(self, repo: str, ref: str, depth: int | None):
        self.repo, self.ref, self.depth = repo, ref, depth
        self._roots: list[str] | None = None
        self.known: dict[str, str] = {}

    def compute(self, path: str) -> str:
        if self._roots is None:
            self._roots = [] if self.depth else corpuslib.package_roots(self.repo, self.ref)
        return corpuslib.module_of(path, self._roots, self.depth)

    def index(self, recs: list[dict]) -> None:
        for r in recs:
            for f in r["files"]:
                self.known.setdefault(f["path"], f["module"])

    def __call__(self, path: str) -> str:
        m = self.known.get(path)
        if m is None:
            m = self.known[path] = self.compute(path)
        return m


def load_corpus(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as fh:
        recs = [json.loads(line) for line in fh if line.strip()]
    recs.sort(key=lambda r: r["seq"])
    if any(r["seq"] != k for k, r in enumerate(recs)):
        raise SystemExit(f"{path}: seq must run 0..N-1")
    return recs


def normalize_quoted_paths(recs: list[dict], modules: ModuleMap) -> int:
    """corpus.py keeps git's quoted form for non-ASCII paths (and derives a bogus module from
    it); unquote them so they match merge-tree's raw paths, and recompute their modules."""
    fixed = 0
    for r in recs:
        touched = False
        for f in r["files"]:
            for key in ("path", "old_path"):
                v = f.get(key)
                if v and v.startswith('"') and v.endswith('"'):
                    f[key] = unquote_git_path(v)
                    touched = True
                    if key == "path":
                        f["module"] = modules.compute(f["path"])
        if touched:
            r["modules"] = sorted({f["module"] for f in r["files"]})
            fixed += 1
    return fixed


def file_set(r: dict) -> frozenset[str]:
    s = {f["path"] for f in r["files"]}
    s.update(f["old_path"] for f in r["files"] if f.get("old_path"))
    return frozenset(s)


def code_footprint(r: dict) -> tuple[frozenset[str], frozenset[str]]:
    """Files (with old paths) and modules of a change, without dissolvable-category files
    (lockfiles, changelogs/.changeset, snapshots, generated): the footprint a scheduler
    would have to respect once merge drivers handle the rest."""
    files: set[str] = set()
    mods: set[str] = set()
    for f in r["files"]:
        for p in (f["path"], f.get("old_path")):
            if p and corpuslib.classify(p) not in DISSOLVABLE:
                files.add(p)
                if p == f["path"]:
                    mods.add(f["module"])
    return frozenset(files), frozenset(mods)


def detect_mode(recs: list[dict], requested: str) -> str:
    if requested != "auto":
        return requested
    parents = {r["parent"] for r in recs}
    return "branch" if len(recs) > 1 and len(parents) == 1 else "history"


def is_agent(r: dict) -> bool:
    return r.get("agent", "human") not in NON_AGENT


def authorship(ri: dict, rj: dict) -> str:
    n = is_agent(ri) + is_agent(rj)
    return ("human-human", "agent-human", "agent-agent")[n]


def select_windows(candidates: list[int], k: int, method: str, seed: int) -> list[int]:
    """k of the candidate window indices: evenly spaced with a seeded offset ("even"), or a
    seeded simple random sample ("random")."""
    if k >= len(candidates):
        return list(candidates)
    rng = random.Random(seed)
    if method == "random":
        return sorted(rng.sample(candidates, k))
    step = len(candidates) / k
    offset = rng.random() * step
    return [candidates[min(len(candidates) - 1, int(offset + t * step))] for t in range(k)]


# ------------------------------------------------------------------------------ statistics

def rate(num: float, den: float) -> float | None:
    return num / den if den else None


def pctl(sorted_vals: list[float], q: float) -> float | None:
    if not sorted_vals:
        return None
    return sorted_vals[min(len(sorted_vals) - 1, max(0, math.ceil(q * len(sorted_vals)) - 1))]


def dist(values: list[float], hist: bool = False) -> dict:
    v = sorted(values)
    d = {"n": len(v), "mean": (sum(v) / len(v)) if v else None, "p50": pctl(v, 0.5),
         "p90": pctl(v, 0.9), "p99": pctl(v, 0.99), "max": v[-1] if v else None}
    if hist:
        d["hist"] = {str(k): c for k, c in sorted(Counter(v).items())}
    return d


def implied_collision(p: float | None) -> dict | None:
    """P(at least one collision among n concurrent changes) = 1 - (1 - p_pair)^(n - 1)."""
    if p is None:
        return None
    return {"p_pair": p, "n": {str(n): 1 - (1 - p) ** (n - 1) for n in IMPLIED_N}}


def greedy_batch(nodes: list[int], edges: list[tuple[int, int]]) -> int:
    """Greedy largest conflict-free subset: repeatedly take the node with the fewest
    conflicts among the remaining nodes (ties: lowest seq), drop its neighbours."""
    adj: dict[int, set[int]] = {n: set() for n in nodes}
    for a, b in edges:
        adj[a].add(b)
        adj[b].add(a)
    remaining, size = set(nodes), 0
    while remaining:
        n = min(remaining, key=lambda x: (len(adj[x] & remaining), x))
        size += 1
        remaining -= adj[n] | {n}
    return size


def concentration(pair_units: list[set[str]], unit: str = "module") -> dict:
    """How concentrated conflicts are across modules (or files). Each conflicting pair carries
    weight 1, split evenly over the distinct modules of its conflicted files; modules are
    ranked by weight. top1_share / top3_share = share of conflicting pairs whose conflicted
    files all sit in the top-1 / top-3 modules; hhi = sum of squared module weight shares."""
    sets = [s for s in pair_units if s]
    w: Counter = Counter()
    for s in sets:
        for m in s:
            w[m] += 1 / len(s)
    ranked = sorted(w.items(), key=lambda kv: (-kv[1], kv[0]))
    total = sum(w.values())
    shares = [v / total for _, v in ranked] if total else []
    top1 = {m for m, _ in ranked[:1]}
    top3 = {m for m, _ in ranked[:3]}
    n = len(sets)
    return {
        "pairs": n,
        f"{unit}s": len(ranked),
        "top1_share": rate(sum(1 for s in sets if s <= top1), n),
        "top3_share": rate(sum(1 for s in sets if s <= top3), n),
        "hhi": sum(s * s for s in shares) if shares else None,
        "top1_weight": shares[0] if shares else None,
        "top3_weight": sum(shares[:3]) if shares else None,
        f"top_{unit}s": [{unit: m, "share": v / total} for m, v in ranked[:10]],
    }


def activity_concentration(footprints: list[set[str]], unit: str = "module") -> dict:
    """Baseline for concentration(): the same weights for change activity (each change's
    weight split evenly over the modules, or files, it touches)."""
    w: Counter = Counter()
    for fp in footprints:
        for m in fp:
            w[m] += 1 / len(fp)
    total = sum(w.values())
    shares = sorted((v / total for v in w.values()), reverse=True) if total else []
    return {"changes": len(footprints), f"{unit}s": len(w), "top1_weight": shares[0] if shares else None,
            "top3_weight": sum(shares[:3]) if shares else None,
            "hhi": sum(s * s for s in shares) if shares else None}


# ------------------------------------------------------------------------------- the run

def log_fn(quiet: bool):
    t0 = time.time()

    def log(msg: str) -> None:
        if not quiet:
            print(f"[replay {time.time() - t0:7.1f}s] {msg}", file=sys.stderr, flush=True)
    return log


def build_pair_record(corpus: str, W: int, ri: dict, rj: dict, fi: frozenset, fj: frozenset,
                      result: str, paths: tuple[str, ...], modules: ModuleMap) -> dict:
    shared_files = sorted(fi & fj)
    shared_modules = sorted(set(ri["modules"]) & set(rj["modules"]))
    overlap = "file" if shared_files else ("module" if shared_modules else "disjoint")
    cfiles = [{"path": p, "module": modules(p), "category": corpuslib.classify(p)} for p in sorted(set(paths))]
    return {
        "corpus": corpus, "window": rj["seq"] // W, "a": ri["id"], "b": rj["id"],
        "a_seq": ri["seq"], "b_seq": rj["seq"], "result": result, "overlap_class": overlap,
        "shared_files": shared_files, "shared_modules": shared_modules, "conflict_files": cfiles,
        "dissolvable_only": bool(cfiles) and all(c["category"] in DISSOLVABLE for c in cfiles),
    }


def summarize_window_base(W: int, reasons: dict[int, str], n_eff: int) -> dict:
    windows = math.ceil(n_eff / W) if n_eff else 0
    by_pos = [[0, 0] for _ in range(W)]  # position -> [tested, collisions]
    c = Counter(reasons.values())
    tested = collisions = 0
    for seq, reason in reasons.items():
        pos = seq % W
        if pos == 0 or reason == "error":
            continue
        tested += 1
        by_pos[pos][0] += 1
        if reason == "depends_on_window":
            collisions += 1
            by_pos[pos][1] += 1
    return {
        "window_size": W, "windows": windows, "changes": len(reasons),
        "reasons": {k: c.get(k, 0) for k in ("applies", "depends_on_window", "empty", "error")},
        "tested": tested, "collisions": collisions,
        "per_change_collision_rate": rate(collisions, tested),
        "dependency_rate": rate(c.get("depends_on_window", 0), len(reasons)),
        "by_position": [{"position": p, "predecessors": p, "tested": t, "collisions": k, "rate": rate(k, t)}
                        for p, (t, k) in enumerate(by_pos) if p > 0],
    }


def summarize(corpus: str, W: int, mode: str, recs: list[dict], codes: list[tuple[frozenset, frozenset]],
              pairs: list[dict], extra: dict[tuple[int, int], dict], wb_main: dict[int, str],
              pair_windows: list[int], targets: list[int]) -> dict:
    """Pair-test metrics. pairs: contract records; extra: (a_seq, b_seq) -> internal info;
    codes: per change, its files and modules without dissolvable-category files."""
    res = Counter(p["result"] for p in pairs)
    valid = [p for p in pairs if p["result"] != "error"]
    tested = [p for p in valid if p["result"] in ("clean", "conflict")]
    conflicts = [p for p in tested if p["result"] == "conflict"]
    entangled = [p for p in valid if p["result"] == "entangled"]
    ent_file = [p for p in entangled if p["shared_files"]]
    ent_file_nd = [p for p in ent_file if not all(corpuslib.classify(f) in DISSOLVABLE for f in p["shared_files"])]
    diss = [p for p in conflicts if p["dissolvable_only"]]
    n_t, n_c, n_v = len(tested), len(conflicts), len(valid)

    def types_of(p: dict) -> tuple[str, ...]:
        return extra.get((p["a_seq"], p["b_seq"]), {}).get("types", ())

    # strict: dissolvable by category AND every conflict is a content conflict a driver sees
    diss_strict = [p for p in diss if types_of(p) and set(types_of(p)) <= DRIVER_TYPES]
    diss_types: Counter = Counter()
    for p in diss:
        diss_types.update(types_of(p))

    def code_overlap(p: dict) -> str:
        (fa, ma), (fb, mb) = codes[p["a_seq"]], codes[p["b_seq"]]
        return "file" if fa & fb else ("module" if ma & mb else "disjoint")

    def cls_stats(rows_all: list[dict]) -> dict:
        t = [p for p in rows_all if p["result"] in ("clean", "conflict")]
        k = sum(1 for p in t if p["result"] == "conflict")
        kd = sum(1 for p in t if p["result"] == "conflict" and not p["dissolvable_only"])
        e = sum(1 for p in rows_all if p["result"] == "entangled")
        return {"pairs": len(t), "conflicts": k, "rate": rate(k, len(t)), "entangled": e,
                "all_pairs": len(rows_all), "conflicts_after_drivers": kd,
                "rate_after_drivers": rate(kd, len(t))}

    by_class = {c: cls_stats([p for p in valid if p["overlap_class"] == c]) for c in ("file", "module", "disjoint")}
    code_cls = [code_overlap(p) for p in valid]
    by_class_code = {c: cls_stats([p for p, k in zip(valid, code_cls) if k == c]) for c in ("file", "module", "disjoint")}
    by_author = {}
    for label in ("agent-agent", "agent-human", "human-human"):
        rows = [p for p in valid if authorship(recs[p["a_seq"]], recs[p["b_seq"]]) == label]
        by_author[label] = cls_stats(rows)
    by_dist = {}
    for p in valid:
        by_dist.setdefault(p["b_seq"] - p["a_seq"], []).append(p)
    by_distance = [{"distance": d, **cls_stats(rows)} for d, rows in sorted(by_dist.items())]

    cat_files: Counter = Counter()
    cat_pairs: Counter = Counter()
    for p in conflicts:
        cats = [c["category"] for c in p["conflict_files"]]
        cat_files.update(cats)
        cat_pairs.update(set(cats))
    n_cf = sum(cat_files.values())
    ctypes: Counter = Counter()
    for p in conflicts:
        ctypes.update(extra.get((p["a_seq"], p["b_seq"]), {}).get("types", ()))

    mods_all = [{c["module"] for c in p["conflict_files"]} for p in conflicts]
    mods_after = [{c["module"] for c in p["conflict_files"] if c["category"] not in DISSOLVABLE}
                  for p in conflicts if not p["dissolvable_only"]]

    # per-window structure over full fixed windows of the pair test
    by_key = {(p["a_seq"], p["b_seq"]): p for p in valid}
    per_window = []
    contingency = Counter()
    for k in pair_windows:
        lo, hi = k * W, k * W + W
        nodes = list(range(lo, hi))
        inside = [by_key[(a, b)] for b in nodes for a in range(lo, b) if (a, b) in by_key]
        e_conf = [(p["a_seq"], p["b_seq"]) for p in inside if p["result"] == "conflict"]
        e_after = [(p["a_seq"], p["b_seq"]) for p in inside if p["result"] == "conflict" and not p["dissolvable_only"]]
        e_bound = e_conf + [(p["a_seq"], p["b_seq"]) for p in inside if p["result"] == "entangled" and p["shared_files"]]
        per_window.append({
            "window": k, "first_seq": lo, "changes": W, "pairs": len(inside),
            "tested": sum(1 for p in inside if p["result"] in ("clean", "conflict")),
            "conflicts": len(e_conf), "conflicts_after_drivers": len(e_after),
            "entangled": sum(1 for p in inside if p["result"] == "entangled"),
            "max_batch": greedy_batch(nodes, e_conf), "max_batch_after_drivers": greedy_batch(nodes, e_after),
            "max_batch_bound": greedy_batch(nodes, e_bound),
            "window_base_collisions": sum(1 for s in nodes[1:] if wb_main.get(s) == "depends_on_window"),
        })
        # does "collides on the window base" agree with "some pair inside the window conflicts"?
        for b in nodes[1:]:
            wb = wb_main.get(b)
            if wb is None or wb == "error":
                continue
            rows = [by_key[(a, b)] for a in range(lo, b) if (a, b) in by_key]
            pc = any(p["result"] == "conflict" for p in rows)
            pe = pc or any(p["result"] == "entangled" for p in rows)
            w_c = wb == "depends_on_window"
            contingency["changes"] += 1
            contingency["window_base"] += w_c
            contingency["pair_conflict"] += pc
            contingency["pair_conflict_or_entangled"] += pe
            contingency[("both" if w_c and pe else "window_base_only" if w_c else "pair_only" if pe else "neither")] += 1

    def batch_stats(key: str) -> dict:
        v = sorted(w[key] for w in per_window)
        return {"windows": len(v), "mean": (sum(v) / len(v)) if v else None, "p50": pctl(v, 0.5),
                "min": v[0] if v else None, "max": v[-1] if v else None,
                "mean_fraction": (sum(v) / len(v) / W) if v else None}

    pw_conf = sorted(w["conflicts"] for w in per_window)
    n_ch = contingency["changes"]
    target_recs = [recs[s] for s in targets]
    errors = [p for p in pairs if p["result"] == "error"]
    j_empty = sum(1 for p in tested if p["result"] == "clean" and extra.get((p["a_seq"], p["b_seq"]), {}).get("j_empty"))
    return {
        "pairs": len(pairs),
        "results": {k: res.get(k, 0) for k in ("clean", "conflict", "entangled", "error")},
        "result_shares": {k: rate(res.get(k, 0), n_v) for k in ("clean", "conflict", "entangled")},
        "pairs_tested": n_t,
        "conflicts": n_c,
        "conflict_rate": rate(n_c, n_t),
        "entangled_share": rate(len(entangled), n_v),
        "entangled_sharing_file": len(ent_file),
        "conflict_rate_bound": rate(n_c + len(ent_file), n_v),
        "conflict_rate_given_shared_file": by_class["file"]["rate"],
        "by_overlap_class": by_class,
        "by_overlap_class_code": by_class_code,
        "dissolvable_conflicts": len(diss),
        "dissolvable_share": rate(len(diss), n_c),
        "conflict_rate_after_drivers": rate(n_c - len(diss), n_t),
        "conflict_rate_bound_after_drivers": rate(n_c - len(diss) + len(ent_file_nd), n_v),
        "dissolvable_conflict_types": dict(diss_types.most_common()),
        "dissolvable_strict_conflicts": len(diss_strict),
        "dissolvable_share_strict": rate(len(diss_strict), n_c),
        "conflict_rate_after_drivers_strict": rate(n_c - len(diss_strict), n_t),
        "category_share": {k: v / n_cf for k, v in sorted(cat_files.items(), key=lambda kv: -kv[1])} if n_cf else {},
        "category_pair_share": {k: v / n_c for k, v in sorted(cat_pairs.items(), key=lambda kv: -kv[1])} if n_c else {},
        "conflicts_without_paths": sum(1 for p in conflicts if not p["conflict_files"]),
        "conflict_types": dict(ctypes.most_common()),
        "clean_with_j_empty": j_empty,
        "module_concentration": concentration(mods_all),
        "module_concentration_after_drivers": concentration(mods_after),
        "activity_concentration": activity_concentration([set(r["modules"]) for r in target_recs]),
        "file_concentration": concentration([{c["path"] for c in p["conflict_files"]} for p in conflicts], "file"),
        "file_concentration_after_drivers": concentration(
            [{c["path"] for c in p["conflict_files"] if c["category"] not in DISSOLVABLE}
             for p in conflicts if not p["dissolvable_only"]], "file"),
        "activity_file_concentration": activity_concentration([{f["path"] for f in r["files"]} for r in target_recs], "file"),
        "max_compatible_batch": batch_stats("max_batch"),
        "max_compatible_batch_after_drivers": batch_stats("max_batch_after_drivers"),
        "max_compatible_batch_bound": batch_stats("max_batch_bound"),
        "per_window_conflicts": {
            "windows": len(pw_conf), "mean": (sum(pw_conf) / len(pw_conf)) if pw_conf else None,
            "p50": pctl(pw_conf, 0.5), "p90": pctl(pw_conf, 0.9), "max": pw_conf[-1] if pw_conf else None,
            "share_with_conflict": rate(sum(1 for c in pw_conf if c), len(pw_conf)),
        },
        "by_authorship": by_author,
        "by_distance": by_distance,
        "p_share_module": rate(sum(1 for p in valid if p["shared_modules"]), n_v),
        "p_share_file": rate(sum(1 for p in valid if p["shared_files"]), n_v),
        "p_share_module_code": rate(sum(1 for p in valid if codes[p["a_seq"]][1] & codes[p["b_seq"]][1]), n_v),
        "p_share_file_code": rate(sum(1 for p, k in zip(valid, code_cls) if k == "file"), n_v),
        "footprint": {
            "changes": len(target_recs),
            "modules_per_change": dist([len(r["modules"]) for r in target_recs], hist=True),
            "files_per_change": dist([len(r["files"]) for r in target_recs], hist=True),
            "code_modules_per_change": dist([len(codes[r["seq"]][1]) for r in target_recs], hist=True),
            "code_files_per_change": dist([len(codes[r["seq"]][0]) for r in target_recs], hist=True),
        },
        "implied_collision_prob": implied_collision(rate(n_c, n_t)),
        "implied_collision_prob_after_drivers": implied_collision(rate(n_c - len(diss), n_t)),
        "implied_collision_prob_after_drivers_strict": implied_collision(rate(n_c - len(diss_strict), n_t)),
        "implied_collision_prob_bound": implied_collision(rate(n_c + len(ent_file), n_v)),
        "window_consistency": {
            "changes": n_ch,
            "window_base_collision_rate": rate(contingency["window_base"], n_ch),
            "pair_any_conflict_rate": rate(contingency["pair_conflict"], n_ch),
            "pair_any_conflict_or_entangled_rate": rate(contingency["pair_conflict_or_entangled"], n_ch),
            "contingency": {k: contingency[k] for k in ("both", "window_base_only", "pair_only", "neither")},
        },
        "per_window": per_window,
        "error_samples": [{"a_seq": p["a_seq"], "b_seq": p["b_seq"], **extra.get((p["a_seq"], p["b_seq"]), {})}
                          for p in errors[:10]],
    }


# -------------------------------------------------------------------------- semantic check

def materialize(env: dict, tree: str, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    archive = subprocess.Popen(["git", *GIT_OPTS, "archive", "--format=tar", tree],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    tar = subprocess.run(["tar", "-x", "-C", str(dest)], stdin=archive.stdout, capture_output=True)
    archive.stdout.close()
    err = archive.stderr.read()
    archive.stderr.close()
    if archive.wait() != 0 or tar.returncode != 0:
        raise RuntimeError(f"materialising {tree} failed: {err.decode('utf-8', 'replace')[-300:]}"
                           f"{tar.stderr.decode('utf-8', 'replace')[-300:]}")


def run_shell(cmd: str, cwd: Path, timeout: float, log) -> int | str:
    try:
        return subprocess.run(cmd, shell=True, cwd=cwd, stdout=log, stderr=subprocess.STDOUT,
                              stdin=subprocess.DEVNULL, timeout=timeout).returncode
    except subprocess.TimeoutExpired:
        log.write(f"\n[replay] timed out after {timeout}s\n".encode())
        return "timeout"


def check_tree(env: dict, tree: str, root: Path, logs: Path, setup: str | None, cmd: str,
               timeout: float) -> dict:
    t0 = time.time()
    dest = root / tree
    info: dict = {"tree": tree, "setup_rc": None, "check_rc": None}
    try:
        materialize(env, tree, dest)
    except RuntimeError as e:
        return {**info, "passed": None, "error": str(e)[:300], "seconds": time.time() - t0}
    with open(logs / f"{tree}.log", "wb") as log:
        if setup:
            log.write(f"$ {setup}\n".encode())
            log.flush()
            info["setup_rc"] = run_shell(setup, dest, timeout, log)
        if info["setup_rc"] in (None, 0):
            log.write(f"$ {cmd}\n".encode())
            log.flush()
            info["check_rc"] = run_shell(cmd, dest, timeout, log)
    shutil.rmtree(dest, ignore_errors=True)
    info["passed"] = info["setup_rc"] in (None, 0) and info["check_rc"] == 0
    info["seconds"] = time.time() - t0
    return info


def semantic_check(args, ctx: dict, mode: str, recs: list[dict], pairs: list[dict],
                   out: Path, log) -> tuple[dict, list[dict]]:
    """Run --check-setup/--check-cmd on the 'i only', 'j only' and merged trees of sampled
    clean pairs. Branch mode: tip_i, tip_j, merge-tree(base; tip_i, tip_j). History mode:
    parent_j (has i, not j), Y = j re-applied without i, and commit j itself (has both)."""
    t0 = time.time()
    clean = [p for p in pairs if p["result"] == "clean"]
    rng = random.Random(args.seed)
    sample = [clean[k] for k in sorted(rng.sample(range(len(clean)), min(args.check_sample, len(clean))))]
    log(f"semantic check: {len(sample)} of {len(clean)} clean pairs")
    objdir, env = task_env(ctx)
    rows: list[dict] = []
    try:
        triples: dict[tuple[int, int], tuple[str, str, str]] = {}
        if mode == "branch":
            base = recs[0]["parent"]
            redo = pair_branch(env, [((p["a_seq"], p["b_seq"]), base, recs[p["a_seq"]]["sha"],
                                      recs[p["b_seq"]]["sha"]) for p in sample])
            for key, result, _paths, _types, info in redo:
                if result == "clean":
                    triples[key] = (f"{recs[key[0]]['sha']}^{{tree}}", f"{recs[key[1]]['sha']}^{{tree}}", info["merged"])
        else:
            redo = pair_history(env, [((p["a_seq"], p["b_seq"]), recs[p["a_seq"]]["sha"], recs[p["a_seq"]]["parent"],
                                       recs[p["b_seq"]]["sha"], recs[p["b_seq"]]["parent"]) for p in sample])
            for key, result, _paths, _types, info in redo:
                if result == "clean":
                    triples[key] = (f"{recs[key[1]]['parent']}^{{tree}}", info["y"], f"{recs[key[1]]['sha']}^{{tree}}")
        trees = resolve_revs(env, [t for tr in triples.values() for t in tr])
        unique = sorted({oid for oid in trees.values() if oid})
        root = Path(tempfile.mkdtemp(prefix="check-", dir=ctx["scratch"]))
        logs = out / "semantic_logs"
        logs.mkdir(parents=True, exist_ok=True)
        with ThreadPoolExecutor(max_workers=max(1, args.jobs)) as ex:
            checked = dict(zip(unique, ex.map(lambda t: check_tree(env, t, root, logs, args.check_setup,
                                                                   args.check_cmd, args.check_timeout), unique)))
        for p in sample:
            key = (p["a_seq"], p["b_seq"])
            row = {"window": p["window"], "a": p["a"], "b": p["b"], "a_seq": key[0], "b_seq": key[1]}
            if key not in triples:
                rows.append({**row, "error": "pair did not re-run clean"})
                continue
            ta, tb, tm = (trees.get(t) for t in triples[key])
            ra, rb, rm = (checked.get(t, {}).get("passed") if t else None for t in (ta, tb, tm))
            row.update(a_tree=ta, b_tree=tb, merged_tree=tm, a_pass=ra, b_pass=rb, merged_pass=rm)
            if None in (ra, rb, rm):
                row["error"] = "could not materialise or check a tree"
            else:
                row["clean_but_broken"] = bool(ra and rb and not rm)
            rows.append(row)
    finally:
        shutil.rmtree(objdir, ignore_errors=True)
    ok = [r for r in rows if "clean_but_broken" in r]
    broken = sum(1 for r in ok if r["clean_but_broken"])
    both = sum(1 for r in ok if r["a_pass"] and r["b_pass"])
    results = list(checked.values()) if rows else []
    summary = {
        "pairs_checked": len(ok), "clean_but_broken": broken, "rate": rate(broken, len(ok)),
        "both_pass": both, "rate_given_both_pass": rate(broken, both),
        "clean_pairs_available": len(clean), "sample": args.check_sample, "seed": args.seed,
        "errors": len(rows) - len(ok), "trees_checked": len(results),
        "trees_failed": sum(1 for r in results if r.get("passed") is False),
        "setup_failures": sum(1 for r in results if r.get("setup_rc") not in (None, 0)),
        "check_cmd": args.check_cmd, "check_setup": args.check_setup,
        "merged_tree": "merge-tree(base; tip_i, tip_j)" if mode == "branch" else "commit j (contains i and j)",
        "seconds": time.time() - t0,
    }
    return summary, rows


# ---------------------------------------------------------------------------------- driver

class _HelpFormatter(argparse.ArgumentDefaultsHelpFormatter):
    def _get_help_string(self, action):
        if action.default in (None, False):
            return action.help
        return super()._get_help_string(action)


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(
        description="Counterfactual replay of a change corpus: pairwise textual conflicts "
                    "(leave-one-out revert test) and per-change collisions on a window base.",
        formatter_class=_HelpFormatter)
    ap.add_argument("--corpus-file", required=True, help="corpus.jsonl from common/corpus.py")
    ap.add_argument("--repo", required=True, help="git repository of the corpus (bare is fine); only read")
    ap.add_argument("--out", required=True, help="output directory (private corpora: under out/private/)")
    ap.add_argument("--window", type=int, default=None,
                    help=f"W: pairs with seq distance < W; fixed windows of W for per-window metrics "
                         f"(default {DEFAULT_WINDOW}; branch mode: all changes)")
    ap.add_argument("--collision-windows", default=DEFAULT_COLLISION_WINDOWS,
                    help="window sizes for the window-base per-change collision rate (--window is always added)")
    ap.add_argument("--max-windows", type=int, default=None, help="only the first N windows of W changes")
    ap.add_argument("--sample-windows", type=int, default=None,
                    help="pair-test only N full windows (the window-base pass still covers all)")
    ap.add_argument("--sample-method", choices=("even", "random"), default="even",
                    help="even = evenly spaced with a seeded offset; random = seeded simple random sample")
    ap.add_argument("--seed", type=int, default=0, help="seed for window and check sampling")
    ap.add_argument("--jobs", type=int, default=os.cpu_count() or 4, help="parallel worker processes")
    ap.add_argument("--chunk", type=int, default=256, help="pairs (or changes) per worker task")
    ap.add_argument("--mode", choices=("auto", "history", "branch"), default="auto",
                    help="branch = every change developed from one base (detected when all parents match)")
    ap.add_argument("--corpus", default=None, help="corpus name (default: the records' 'corpus' field)")
    ap.add_argument("--module-depth", type=int, default=None,
                    help="as corpus.py --module-depth, for conflicted paths the corpus does not list")
    ap.add_argument("--roots-ref", default="main", help="ref whose package roots define modules (as corpus.py)")
    ap.add_argument("--scratch", default=None, help="scratch directory (default: <out>/.scratch-<pid>)")
    ap.add_argument("--keep-scratch", action="store_true", help="keep the scratch repository afterwards")
    ap.add_argument("--check-cmd", default=None, help="semantic check command, run in each materialised tree")
    ap.add_argument("--check-setup", default=None, help="command run before --check-cmd in each tree")
    ap.add_argument("--check-sample", type=int, default=50, help="clean pairs to check")
    ap.add_argument("--check-timeout", type=float, default=600.0, help="seconds per setup/check command")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args(argv)
    if a.window is not None and a.window < 2:
        ap.error("--window must be at least 2")
    return a


def _under_private(path: str | Path) -> bool:
    parts = Path(os.path.abspath(path)).parts
    if len(parts) > 1 and parts[1] == "private":  # macOS /private/tmp, /private/var: not a marker
        parts = parts[2:]
    return "private" in parts


def guard_privacy(corpus_file: str, out: Path, scratch: Path) -> None:
    """Anything derived from a corpus under a private/ directory stays under a private/ directory."""
    if _under_private(corpus_file):
        for p in (out, scratch):
            if not _under_private(p):
                raise SystemExit(f"refusing: private corpus but {p} is not under a private/ directory")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    t_start = time.time()
    log = log_fn(args.quiet)
    recs = load_corpus(args.corpus_file)
    if not recs:
        raise SystemExit("empty corpus")
    name = args.corpus or recs[0].get("corpus") or Path(args.corpus_file).parent.name
    mode = detect_mode(recs, args.mode)
    N = len(recs)
    W = args.window or (N if mode == "branch" else DEFAULT_WINDOW)
    out = Path(args.out)
    scratch = Path(args.scratch) if args.scratch else out / f".scratch-{os.getpid()}"
    guard_privacy(args.corpus_file, out, scratch)
    out.mkdir(parents=True, exist_ok=True)
    scratch.mkdir(parents=True, exist_ok=True)
    scratch = scratch.resolve()

    modules = ModuleMap(args.repo, args.roots_ref, args.module_depth)
    fixed_paths = normalize_quoted_paths(recs, modules)
    modules.index(recs)
    fsets = [file_set(r) for r in recs]
    codes = [code_footprint(r) for r in recs]

    n_eff = min(N, args.max_windows * W) if args.max_windows else N
    full = [k for k in range(n_eff // W)]
    if args.sample_windows:
        pair_windows = select_windows(full, args.sample_windows, args.sample_method, args.seed)
        targets = [s for k in pair_windows for s in range(k * W, k * W + W)]
    else:
        pair_windows = full
        targets = list(range(n_eff))
    col_ws = sorted({W, *(int(x) for x in args.collision_windows.split(",") if x.strip())})
    log(f"{name}: {N} changes, mode={mode}, W={W}, pair-test targets={len(targets)}, "
        f"windows={len(pair_windows)}, collision windows={col_ws}, jobs={args.jobs}")

    try:
        revs = sorted({r["sha"] for r in recs} | {r["parent"] for r in recs})
        ctx = prepare_scratch_repo(args.repo, scratch, revs)
        log(f"scratch repo ready ({ctx['objects']})")
        env = git_env(GIT_DIR=ctx["repo"], GIT_ALTERNATE_OBJECT_DIRECTORIES=os.pathsep.join(ctx["alternates"]))

        # window-base pass, for every collision window size
        t_wb = time.time()
        base_of = {}
        items = []
        for w in col_ws:
            for k in range(math.ceil(n_eff / w)):
                b = recs[k * w]["parent"]
                base_of[b] = None
                for s in range(k * w, min(n_eff, k * w + w)):
                    items.append(((w, s), recs[s]["parent"], b, recs[s]["sha"], b))
        trees = resolve_revs(env, [f"{b}^{{tree}}" for b in base_of])
        items = [(key, pj, b, sj, trees.get(f"{b}^{{tree}}")) for key, pj, b, sj, _ in items]
        tasks = [("window", items[i:i + args.chunk * 2]) for i in range(0, len(items), args.chunk * 2)]
        wb_results = run_tasks(tasks, ctx, args.jobs, "window-base", len(items), log)
        wb: dict[int, dict[int, str]] = defaultdict(dict)
        for (w, s), reason in wb_results:
            wb[w][s] = reason
        t_wb = time.time() - t_wb

        # pair test
        t_pairs = time.time()
        keys = [(a, b) for b in targets for a in range(max(0, b - W + 1), b)]
        if mode == "branch":
            base = recs[0]["parent"]
            pitems = [((a, b), base, recs[a]["sha"], recs[b]["sha"]) for a, b in keys]
        else:
            pitems = [((a, b), recs[a]["sha"], recs[a]["parent"], recs[b]["sha"], recs[b]["parent"]) for a, b in keys]
        tasks = [(mode, pitems[i:i + args.chunk]) for i in range(0, len(pitems), args.chunk)]
        outcomes = run_tasks(tasks, ctx, args.jobs, "pair test", len(pitems), log)
        t_pairs = time.time() - t_pairs

        pairs, extra = [], {}
        for (a, b), result, paths, types, info in sorted(outcomes, key=lambda o: (o[0][1], o[0][0])):
            pairs.append(build_pair_record(name, W, recs[a], recs[b], fsets[a], fsets[b], result, paths, modules))
            extra[(a, b)] = {"types": types, **({k: v for k, v in info.items() if k in ("j_empty", "stage", "error")})}

        semantic = sem_rows = None
        if args.check_cmd:
            semantic, sem_rows = semantic_check(args, ctx, mode, recs, pairs, out, log)
    finally:
        if not args.keep_scratch:
            shutil.rmtree(scratch, ignore_errors=True)

    # outputs
    wb_main = wb[W]
    with open(out / "changes.jsonl", "w", encoding="utf-8") as fh:
        for s in sorted(wb_main):
            reason = wb_main[s]
            fh.write(json.dumps({"id": recs[s]["id"], "seq": s, "window": s // W,
                                 "eligible": reason == "applies", "reason": reason}) + "\n")
    with open(out / "pairs.jsonl", "w", encoding="utf-8") as fh:
        for p in pairs:
            fh.write(json.dumps(p, separators=(",", ":")) + "\n")
    if sem_rows is not None:
        with open(out / "semantic.jsonl", "w", encoding="utf-8") as fh:
            for r in sem_rows:
                fh.write(json.dumps(r) + "\n")

    wb_summary = {str(w): summarize_window_base(w, wb[w], n_eff) for w in col_ws}
    main_wb = wb_summary[str(W)]
    ps = summarize(name, W, mode, recs, codes, pairs, extra, wb_main, pair_windows, targets)
    git_version = subprocess.run(["git", "--version"], capture_output=True, text=True).stdout.strip()
    summary = {
        "corpus": name,
        "mode": mode,
        "window_size": W,
        "windows": main_wb["windows"],
        "changes": main_wb["changes"],
        "eligible": main_wb["reasons"]["applies"],
        "dependency_rate": main_wb["dependency_rate"],
        "per_change_collision_rate": main_wb["per_change_collision_rate"],
        "pair_method": ("direct: merge-tree --merge-base=<common base> tip_i tip_j" if mode == "branch" else
                        "leave-one-out revert: X = merge-tree --merge-base=sha_i parent_j parent_i "
                        "(conflict = entangled); j re-applied: merge-tree --merge-base=parent_j X' sha_j"),
        **ps,
        "window_base": wb_summary,
        "semantic": semantic,
        "sampling": {
            "corpus_changes": N, "changes_considered": n_eff, "max_windows": args.max_windows,
            "sample_windows": args.sample_windows, "method": args.sample_method if args.sample_windows else "all",
            "seed": args.seed, "full_windows": len(full), "pair_windows": len(pair_windows),
            "pair_window_indices": pair_windows if args.sample_windows else None,
            "pair_targets": len(targets),
        },
        "params": {
            "git": git_version, "jobs": args.jobs, "chunk": args.chunk, "scratch_objects": ctx["objects"],
            "merge_options": "git defaults (rename detection on, merge.directoryRenames=conflict); "
                             "user and system git config ignored",
            "identity": IDENTITY, "quoted_paths_normalized": fixed_paths,
            "categories": "corpus.py classify() at runtime", "module_depth": args.module_depth,
            "roots_ref": args.roots_ref,
        },
        "runtime_seconds": {"window_base": round(t_wb, 1), "pair_test": round(t_pairs, 1),
                            "semantic": round(semantic["seconds"], 1) if semantic else None,
                            "total": round(time.time() - t_start, 1)},
    }
    if semantic is None:
        del summary["semantic"]
    with open(out / "summary.json", "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=1)
        fh.write("\n")
    r = summary["results"]
    log(f"done: pairs={summary['pairs']} clean={r['clean']} conflict={r['conflict']} entangled={r['entangled']} "
        f"error={r['error']} conflict_rate={summary['conflict_rate']} "
        f"per_change_collision_rate={summary['per_change_collision_rate']} in {time.time() - t_start:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
