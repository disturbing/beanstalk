"""Arena contract: tasks, reference patches, modules, and static TS import closures."""
from __future__ import annotations

import json
import os
import posixpath
import re
import sys
from dataclasses import dataclass, field

HERE = os.path.dirname(os.path.abspath(__file__))
COMMON = os.path.normpath(os.path.join(HERE, "..", "..", "common"))

try:  # one definition of "module" and "category" for the whole study
    sys.path.insert(0, COMMON)
    from corpus import classify, module_of as _corpus_module_of  # type: ignore
except Exception:  # pragma: no cover - fallback if common/ moves
    def classify(path: str) -> str:
        if re.search(r"(^|/)(CHANGELOG[^/]*|CHANGES[^/]*)$", path, re.I):
            return "changelog"
        if re.search(r"\.(md|mdx|rst|txt)$|(^|/)docs?/", path, re.I):
            return "docs"
        if re.search(r"(^|/)(tests?|__tests__|spec|e2e|fixtures?)/|[._-](test|spec)\.[a-z]+$", path, re.I):
            return "test"
        if re.search(r"(^|/)package\.json$|(^|/)tsconfig[^/]*\.json$", path):
            return "manifest"
        return "source"

    def _corpus_module_of(path: str, roots: list[str], depth: int | None = None) -> str:
        segs = path.split("/")[:-1]
        return "/".join(segs[:depth]) if segs else "(root)"
finally:
    if sys.path and sys.path[0] == COMMON:
        sys.path.pop(0)

MODULE_DEPTH = 2
DISSOLVABLE = {"lockfile", "changelog", "snapshot", "generated"}


def module_of(path: str) -> str:
    """``src/cart/index.ts`` -> ``src/cart`` (the arena's ``--module-depth 2``)."""
    return _corpus_module_of(path, [], MODULE_DEPTH)


def placement_modules(paths) -> set[str]:
    """Modules that matter for placement and footprint scoring: source-like files only
    (tests, docs and commutative files such as CHANGELOG.md don't make two tasks collide)."""
    mods = set()
    for p in paths:
        cat = classify(p)
        if cat in DISSOLVABLE or cat in ("test", "docs"):
            continue
        mods.add(module_of(p))
    return mods


@dataclass
class Task:
    id: str
    title: str
    prompt: str
    acceptance_tests: dict[str, str]
    oracle_paths: list[str] = field(default_factory=list)
    oracle_modules: list[str] = field(default_factory=list)
    kind: str = ""
    difficulty: int = 1
    couplings: list[dict] = field(default_factory=list)
    solution: str | None = None      # path to solutions/tNNN.patch
    fix_patch: str | None = None     # optional solutions/tNNN.fix.patch (replay-only repair hint)
    order: int = 0                   # priority: lower starts first

    @property
    def acceptance_paths(self) -> list[str]:
        return sorted(self.acceptance_tests)

    def partners(self, kind: str | None = None) -> list[str]:
        return [c.get("with") for c in self.couplings if c.get("with") and (kind is None or c.get("type") == kind)]


def _strip_app(path: str, app_prefix: bool) -> str:
    path = path.lstrip("./") if path.startswith("./") else path
    if app_prefix and path.startswith("app/"):
        return path[4:]
    return path


def load_tasks(arena_dir: str, subset: list[str] | None = None, app_prefix: bool = True) -> list[Task]:
    """Load ``tasks/*.json``. ``app_prefix`` strips a leading ``app/`` from acceptance-test paths
    (the materialized repo has the app at its root)."""
    tdir = os.path.join(arena_dir, "tasks")
    if not os.path.isdir(tdir):
        raise FileNotFoundError(f"no tasks/ directory in {arena_dir}")
    names = sorted(n for n in os.listdir(tdir) if n.endswith(".json"))
    tasks: list[Task] = []
    for i, name in enumerate(names):
        with open(os.path.join(tdir, name), encoding="utf-8") as fh:
            raw = json.load(fh)
        tid = raw.get("id") or name[:-5]
        sol = os.path.join(arena_dir, "solutions", f"{tid}.patch")
        fix = os.path.join(arena_dir, "solutions", f"{tid}.fix.patch")
        acc = {_strip_app(p, app_prefix): c for p, c in (raw.get("acceptance_tests") or {}).items()}
        tasks.append(Task(
            id=tid, title=raw.get("title", tid), prompt=raw.get("prompt", ""), acceptance_tests=acc,
            oracle_paths=[_strip_app(p, app_prefix) for p in raw.get("oracle_paths", [])],
            oracle_modules=[_strip_app(m, app_prefix) for m in raw.get("oracle_modules", [])],
            kind=raw.get("kind", ""), difficulty=int(raw.get("difficulty", 1) or 1),
            couplings=list(raw.get("couplings", []) or []),
            solution=sol if os.path.exists(sol) else None,
            fix_patch=fix if os.path.exists(fix) else None, order=i))
    if subset:
        wanted = []
        for s in subset:
            wanted += [x.strip() for x in s.split(",") if x.strip()]
        if len(wanted) == 1 and re.fullmatch(r"\d+", wanted[0]):  # --tasks 10 = the first ten
            tasks = tasks[: int(wanted[0])]
        else:
            ids = {t.id for t in tasks}
            missing = [w for w in wanted if w not in ids]
            if missing:
                raise ValueError(f"unknown task ids: {', '.join(missing)}")
            tasks = [t for t in tasks if t.id in set(wanted)]
    for i, t in enumerate(tasks):
        t.order = i
    return tasks


def patch_strip_level(patch_text: str, repo_files: set[str]) -> int:
    """1 for patches relative to the repo root, 2 when they carry an extra ``app/`` prefix."""
    paths = re.findall(r"^diff --git a/(\S+) b/", patch_text, re.M)
    if paths and all(p.startswith("app/") for p in paths) and not any(f.startswith("app/") for f in repo_files):
        return 2
    return 1


# ---- static TypeScript import closure ------------------------------------------------------------

IMPORT_RE = re.compile(r"""(?:\bfrom|\bimport|\brequire\s*\(|\bimport\s*\()\s*["']([^"'\n]+)["']""")
RESOLVE_SUFFIXES = ("", ".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", "/index.ts", "/index.tsx", "/index.js")


def resolve_import(from_file: str, spec: str, files: set[str]) -> str | None:
    if not spec.startswith("."):
        return None
    base = posixpath.normpath(posixpath.join(posixpath.dirname(from_file), spec))
    cands = [base + s for s in RESOLVE_SUFFIXES]
    if base.endswith(".js"):  # TS convention: import "./x.js" means ./x.ts
        cands.insert(0, base[:-3] + ".ts")
    for c in cands:
        if c in files:
            return c
    return None


def import_closure(root: str, start: list[str], files: set[str] | None = None, limit: int = 5000) -> set[str]:
    """Files reachable from ``start`` through relative static imports (the tests' read sets)."""
    if files is None:
        files = set(list_files(root))
    seen: set[str] = set()
    stack = [s for s in start if s in files]
    while stack and len(seen) < limit:
        f = stack.pop()
        if f in seen:
            continue
        seen.add(f)
        try:
            with open(os.path.join(root, f), encoding="utf-8", errors="replace") as fh:
                text = fh.read()
        except OSError:
            continue
        for spec in IMPORT_RE.findall(text):
            r = resolve_import(f, spec, files)
            if r and r not in seen:
                stack.append(r)
    return seen


def import_depths(root: str, start: str, files: set[str], limit: int = 5000) -> dict[str, int]:
    """BFS distance (in import hops) from ``start`` to every file in its static import closure."""
    depth = {start: 0} if start in files else {}
    frontier = list(depth)
    while frontier and len(depth) < limit:
        nxt = []
        for f in frontier:
            try:
                with open(os.path.join(root, f), encoding="utf-8", errors="replace") as fh:
                    text = fh.read()
            except OSError:
                continue
            for spec in IMPORT_RE.findall(text):
                r = resolve_import(f, spec, files)
                if r and r not in depth:
                    depth[r] = depth[f] + 1
                    nxt.append(r)
        frontier = nxt
    return depth


STACK_PATH = re.compile(r"(?:file://)?(/[^\s:'\"()]+?\.(?:ts|tsx|mts|js|mjs)):\d+")


def stack_files(text: str, root: str) -> list[str]:
    """Repo files named in stack traces (``/abs/path/src/x.ts:12:3``), relative to ``root``."""
    root_real = os.path.realpath(root)
    out = []
    for p in STACK_PATH.findall(text or ""):
        real = os.path.realpath(p)
        if real.startswith(root_real + os.sep):
            rel = os.path.relpath(real, root_real).replace(os.sep, "/")
            if rel not in out and "node_modules" not in rel:
                out.append(rel)
    return out


def list_files(root: str) -> list[str]:
    out = []
    for d, dirs, names in os.walk(root):
        dirs[:] = [x for x in dirs if x not in (".git", "node_modules")]
        for n in names:
            if n == ".git":  # a worktree's .git pointer file
                continue
            out.append(os.path.relpath(os.path.join(d, n), root).replace(os.sep, "/"))
    return sorted(out)
