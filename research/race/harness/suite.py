"""How an arena's test suite is run and read: the designed arena's bare ``node --test`` by default, or whatever a
real-task arena's ``arena.json`` declares (``research/real-arena/<name>/arena.json``; e.g. fastify's test globs).

``arena.json`` keys read here (all optional; other keys belong to the arena builder):

  test_args        files/globs for ``node --test`` (empty: node's own discovery, the designed arena)
  node_args        node options before ``--test`` (fastify: ``--no-use-env-proxy``; inside Codex's network proxy,
                   Node's env-proxy support hangs some of fastify's 431/early-close tests)
  test_concurrency ``--test-concurrency`` (test files run in parallel per suite run)
  build            argv run in the checkout before the tests (none for fastify)
  deps             node_modules to expose at <run>/work/node_modules (resolution walks up from every worktree)
  repo             the materialized bare repository (main = base), relative to arena.json; race.py's --repo default
  node             the Node version the arena was validated with (a mismatch is warned about, not refused)
  agent_test_hint  the sentence agents are told about running the tests
  agent_allowed_bash  extra Claude Code Bash allow rules (prefixes), e.g. ["npx borp"]
  agent_network    "none" (default: Codex sandbox without network) or "loopback" (the suite listens on
                   127.0.0.1, so Codex runs with a permissions profile that allows local binding and loopback
                   connections while its network proxy refuses every domain)
  env              extra environment for every suite run and agent
  task_note        a sentence appended to every task's prompt when the tasks are loaded (both forges send the task
                   prompt as loaded, so every arm gets it byte for byte)
  skipped_tests    {path: reason}: test files the suite leaves out (a record; ``test_args`` does the excluding)
"""
from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass, field

DEFAULT_HINT = "Run `node --test`."


@dataclass
class SuiteConfig:
    test_args: list[str] = field(default_factory=list)
    node_args: list[str] = field(default_factory=list)
    test_concurrency: int | None = None
    build: list[str] = field(default_factory=list)
    deps: str | None = None
    repo: str | None = None
    node: str | None = None
    agent_test_hint: str = DEFAULT_HINT
    agent_allowed_bash: list[str] = field(default_factory=list)
    agent_network: str = "none"
    env: dict[str, str] = field(default_factory=dict)
    task_note: str = ""
    skipped_tests: dict[str, str] = field(default_factory=dict)
    source: str = "default"           # where the config came from (arena.json path or "default")

    @property
    def command(self) -> str:
        """Human-readable test command, for prompts about the suite."""
        if not self.test_args and not self.test_concurrency and not self.node_args:
            return "node --test"
        parts = ["node", *self.node_args, "--test"]
        if self.test_concurrency:
            parts.append(f"--test-concurrency={self.test_concurrency}")
        return " ".join(parts + [f"'{a}'" if "*" in a else a for a in self.test_args])

    def test_argv(self, *, node: str = "node", test_timeout_ms: int | None = None,
                  reporters: list[tuple[str, str]] = ()) -> list[str]:
        argv = [node, *self.node_args, "--test"]
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


def load_suite(arena_dir: str) -> SuiteConfig:
    path = os.path.join(arena_dir, "arena.json")
    if not os.path.exists(path):
        return SuiteConfig()
    with open(path, encoding="utf-8") as fh:
        raw = json.load(fh)
    cfg = SuiteConfig(**{k: v for k, v in raw.items() if k in SuiteConfig.__dataclass_fields__ and k != "source"})
    cfg.source = path
    base = os.path.dirname(os.path.realpath(path))
    for attr in ("deps", "repo"):
        val = getattr(cfg, attr)
        if val and not os.path.isabs(val):
            setattr(cfg, attr, os.path.normpath(os.path.join(base, val)))
    if cfg.agent_network not in ("none", "loopback"):
        raise ValueError(f"{path}: agent_network must be 'none' or 'loopback', not {cfg.agent_network!r}")
    return cfg


def node_mismatch(cfg: SuiteConfig, node: str = "node") -> str | None:
    """A warning when the local Node differs from the version the arena was validated with."""
    if not cfg.node:
        return None
    try:
        got = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=30).stdout.strip()
    except OSError:
        return f"node not found (the arena was validated with {cfg.node})"
    return None if got.lstrip("v") == cfg.node.lstrip("v") else \
        f"node {got} differs from the arena's validated v{cfg.node.lstrip('v')} ({cfg.source})"


ACTIVE: SuiteConfig = SuiteConfig()   # the running race's suite (one race per process)


def activate(cfg: SuiteConfig) -> None:
    """Make ``cfg`` the process-wide suite: prompts and agents follow it."""
    global ACTIVE
    ACTIVE = cfg
    from . import prompts
    prompts.TEST_HINT = cfg.agent_test_hint or DEFAULT_HINT
    prompts.SUITE_COMMAND = cfg.command
