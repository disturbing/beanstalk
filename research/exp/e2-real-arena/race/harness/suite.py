"""How a repository's test suite is built, run and read: the designed arena's ``node --test`` by default, or
whatever an arena's ``arena.json`` declares (e2-real-arena: marked's esbuild build + spec runner + unit tests).

``arena.json`` (all keys optional):

  build            argv run in the checkout before the tests, e.g. ["node", "esbuild.config.js"]
  test_args        files/globs for ``node --test`` (empty: node's own discovery, the designed arena)
  test_concurrency ``--test-concurrency`` (test files run in parallel per suite run)
  junit_mapper     "marked-specs": spec tests (data files run by one runner) are attributed to their spec file
  spec_reader      the runner every spec data file is read through (its import closure is the spec's read set)
  import_aliases   {untracked build output: tracked source entry}, e.g. lib/marked.esm.js -> src/marked.ts
  deps             node_modules to expose at <run>/work/node_modules (resolution walks up from every worktree)
  path_prepend     directories put first on PATH for the harness, CI and agents (wrapper scripts)
  agent_test_hint  the sentence agents are told about running the tests
  agent_allowed_bash  extra Claude Code Bash allow rules (prefixes), e.g. ["run-tests", "node esbuild.config.js"]
  env              extra environment for every suite run and agent
"""
from __future__ import annotations

import fnmatch
import json
import os
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

DEFAULT_HINT = "Run `node --test`."


@dataclass
class SuiteConfig:
    build: list[str] = field(default_factory=list)
    test_args: list[str] = field(default_factory=list)
    test_concurrency: int | None = None
    junit_mapper: str | None = None
    spec_reader: str | None = None
    import_aliases: dict[str, str] = field(default_factory=dict)
    deps: str | None = None
    path_prepend: list[str] = field(default_factory=list)
    agent_test_hint: str = DEFAULT_HINT
    agent_allowed_bash: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)
    source: str = "default"           # where the config came from (arena.json path or "default")

    @property
    def node_command(self) -> str:
        """Human-readable test command, for prompts about the suite."""
        return "run-tests" if "run-tests" in self.agent_allowed_bash else "node --test"

    def test_argv(self, *, node: str = "node", test_timeout_ms: int | None = None, reporters: list[tuple[str, str]]
                  ) -> list[str]:
        argv = [node, "--test"]
        if self.test_concurrency:
            argv.append(f"--test-concurrency={self.test_concurrency}")
        if test_timeout_ms:
            argv.append(f"--test-timeout={test_timeout_ms}")
        for rep, dest in reporters:
            argv += [f"--test-reporter={rep}", f"--test-reporter-destination={dest}"]
        return argv + list(self.test_args)

    def run_env(self, base: dict | None = None) -> dict:
        env = dict(os.environ if base is None else base)
        env.update(self.env)
        return env

    # ---- reading results ------------------------------------------------------------------------------

    def parse_junit(self, path: str, root: str) -> tuple[list[dict], list[str], int] | None:
        if self.junit_mapper == "marked-specs":
            return parse_junit_marked(path, root)
        from .ci import parse_junit
        return parse_junit(path, root)

    def companions(self, paths, root: str) -> list[str]:
        """Spec ``x.md`` files stand for the ``x.md``/``x.html`` pair."""
        out = set(paths)
        if self.junit_mapper == "marked-specs":
            for p in list(out):
                if p.startswith("test/specs/") and p.endswith(".md"):
                    out.add(p[:-3] + ".html")
        return sorted(out)

    def is_spec_data(self, path: str) -> bool:
        return bool(self.spec_reader) and path.startswith("test/specs/")

    def reported(self, path: str) -> bool:
        """Whether the suite reports results for ``path`` (a test file or spec data), as opposed to a helper or
        fixture an acceptance test needs (marked's test/unit/fixtures/*.mjs). Default arena: every file."""
        if not self.test_args:
            return True
        if self.is_spec_data(path):
            return True
        return any(fnmatch.fnmatch(path, pat) for pat in self.test_args)


def load_suite(arena_dir: str) -> SuiteConfig:
    path = os.path.join(arena_dir, "arena.json")
    if not os.path.exists(path):
        return SuiteConfig()
    with open(path, encoding="utf-8") as fh:
        raw = json.load(fh)
    cfg = SuiteConfig(**{k: v for k, v in raw.items() if k in SuiteConfig.__dataclass_fields__ and k != "source"})
    cfg.source = path
    base = os.path.dirname(os.path.realpath(path))  # arena.json may be a symlink (candidates/)
    if cfg.deps and not os.path.isabs(cfg.deps):
        cfg.deps = os.path.normpath(os.path.join(base, cfg.deps))
    cfg.path_prepend = [p if os.path.isabs(p) else os.path.normpath(os.path.join(base, p)) for p in cfg.path_prepend]
    return cfg


ACTIVE: SuiteConfig = SuiteConfig()   # the running race's suite (one race per process)


def activate(cfg: SuiteConfig) -> None:
    """Make ``cfg`` the process-wide suite: PATH, prompts and read-set aliases follow it."""
    global ACTIVE
    ACTIVE = cfg
    if cfg.path_prepend:
        parts = os.environ.get("PATH", "").split(os.pathsep)
        os.environ["PATH"] = os.pathsep.join(list(cfg.path_prepend) + [p for p in parts if p not in cfg.path_prepend])
    from . import arena, prompts
    arena.IMPORT_ALIASES.clear()
    arena.IMPORT_ALIASES.update(cfg.import_aliases)
    prompts.TEST_HINT = cfg.agent_test_hint or DEFAULT_HINT
    prompts.SUITE_COMMAND = cfg.node_command


# ---- marked: spec tests are data files run by one runner -----------------------------------------------

SPEC_DIRS = ("commonmark", "gfm", "new", "original", "redos")   # test/run-spec-tests.js order


def marked_spec_index(root: str) -> tuple[dict[str, list[str]], dict[str, str]]:
    """section name -> spec files defining it (run order), and script-spec stems -> file (``stem[i]`` sections)."""
    sections: dict[str, list[str]] = {}
    scripts: dict[str, str] = {}
    for d in SPEC_DIRS:
        full = os.path.join(root, "test", "specs", d)
        if not os.path.isdir(full):
            continue
        for name in sorted(os.listdir(full)):
            stem, ext = os.path.splitext(name)
            rel = f"test/specs/{d}/{name}"
            if ext == ".md":
                sections.setdefault(stem, []).append(rel)
            elif ext == ".json":
                try:
                    with open(os.path.join(full, name), encoding="utf-8") as fh:
                        data = json.load(fh)
                except (OSError, ValueError):
                    continue
                items = data if isinstance(data, list) else [data]
                for i, spec in enumerate(items):
                    sec = (spec.get("section") if isinstance(spec, dict) else None) or f"{stem}[{i}]"
                    lst = sections.setdefault(sec, [])
                    if rel not in lst:
                        lst.append(rel)
            elif ext in (".js", ".cjs", ".mjs"):
                scripts.setdefault(stem, rel)
    return sections, scripts


INDEXED = re.compile(r"^(.*)\[\d+\]$")


def parse_junit_marked(path: str, root: str) -> tuple[list[dict], list[str], int] | None:
    """node's junit output, with every spec testcase (reported at the testutils call site) attributed to the spec
    file that defines its section: ``x.md`` for a markdown pair, the JSON/CJS file otherwise. A section defined by
    several files (CommonMark sections exist in commonmark/ and gfm/) maps its k-th suite to the k-th file."""
    try:
        tree = ET.parse(path)
    except (OSError, ET.ParseError):
        return None
    root_real = os.path.realpath(root)
    sections, scripts = marked_spec_index(root)
    seen: dict[str, int] = {}
    failing, passing, count = [], set(), 0

    def rel_of(f: str) -> str:
        if f.startswith("file://"):
            f = f[7:]
        if not f:
            return ""
        real = os.path.realpath(f)
        if real == root_real or not real.startswith(root_real + os.sep):
            return ""
        return os.path.relpath(real, root_real).replace(os.sep, "/")

    def spec_file(section: str) -> str:
        cands = sections.get(section)
        if not cands:
            m = INDEXED.match(section)
            if m and m.group(1) in scripts:
                return scripts[m.group(1)]
            return ""
        return cands[min(seen.get(section, 1) - 1, len(cands) - 1)]

    def visit(el, top: str | None) -> None:
        nonlocal count
        for child in el:
            if child.tag == "testsuite":
                name = child.get("name", "")
                if top is None:
                    seen[name] = seen.get(name, 0) + 1
                visit(child, name if top is None else top)
            elif child.tag == "testcase":
                count += 1
                rel = rel_of(child.get("file") or "")
                if (not rel or rel.startswith("node_modules/")) and top is not None:
                    rel = spec_file(top) or rel
                fail = child.find("failure")
                if fail is None:
                    fail = child.find("error")
                if fail is not None:
                    failing.append({"file": rel, "name": child.get("name", ""),
                                    "message": (fail.get("message") or (fail.text or "")).strip()[:800],
                                    "body": (fail.text or "")[:6000]})
                elif rel and child.find("skipped") is None:
                    passing.add(rel)

    visit(tree.getroot(), None)
    passing_all = set()
    for p in passing:
        passing_all.add(p)
        if p.startswith("test/specs/") and p.endswith(".md"):
            passing_all.add(p[:-3] + ".html")
    return failing, sorted(passing_all), count
