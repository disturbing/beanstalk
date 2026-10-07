"""Real-task arena support (harness/suite.py): arena.json loading, the suite command CI and agents use, Codex's
loopback-only network profile, and a replay race over an arena that brings its own arena.json and repository.
No network, no cost. Run from research/race: ``python3 -m unittest discover -s tests``.
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import unittest

TESTS = os.path.dirname(os.path.abspath(__file__))
RACE = os.path.dirname(TESTS)
sys.path.insert(0, RACE)

import gateway_fixture  # noqa: E402
import race  # noqa: E402
from harness import prompts, suite as suite_mod  # noqa: E402
from harness.agents import CodexAdapter, InvocationSpec, claude_allowed_tools  # noqa: E402

FIXTURE = os.path.join(TESTS, "fixtures", "arena")
TMP = os.path.join(TESTS, "tmp", "suite")
REPO = os.path.join(TMP, "fixture-arena.git")
ARENA_JSON = {"name": "fixture", "test_args": ["test/**/*.test.ts"], "node_args": ["--no-warnings"],
              "repo": "fixture-arena.git", "deps": None, "node": "0.0.0",
              "agent_test_hint": "Run `node --no-warnings --test 'test/**/*.test.ts'`.",
              "agent_allowed_bash": ["node --no-warnings --test"], "agent_network": "loopback",
              "env": {"ARENA_SUITE_PROBE": "1"}, "source_re": "^src/"}


def make_arena() -> str:
    """The fixture arena's tasks and solutions plus an arena.json, beside a materialized repository."""
    arena = os.path.join(TMP, "arena")
    shutil.rmtree(arena, ignore_errors=True)
    for sub in ("tasks", "solutions"):
        shutil.copytree(os.path.join(FIXTURE, sub), os.path.join(arena, sub))
    with open(os.path.join(arena, "arena.json"), "w", encoding="utf-8") as fh:
        json.dump(ARENA_JSON | {"repo": "../fixture-arena.git"}, fh)
    return arena


def setUpModule() -> None:
    os.makedirs(TMP, exist_ok=True)
    subprocess.run([sys.executable, os.path.join(FIXTURE, "materialize.py"), "--out", REPO], check=True,
                   capture_output=True)


class Loading(unittest.TestCase):
    def tearDown(self) -> None:
        suite_mod.activate(suite_mod.SuiteConfig())

    def test_no_arena_json_is_the_designed_arena(self) -> None:
        cfg = suite_mod.load_suite(FIXTURE)
        self.assertEqual(cfg.command, "node --test")
        self.assertEqual(cfg.test_argv(reporters=[]), ["node", "--test"])
        self.assertEqual(cfg.agent_network, "none")

    def test_arena_json_drives_the_command_and_paths(self) -> None:
        arena = make_arena()
        cfg = suite_mod.load_suite(arena)
        self.assertEqual(cfg.repo, REPO)
        self.assertEqual(cfg.test_argv(test_timeout_ms=5, reporters=[("dot", "stdout")]),
                         ["node", "--no-warnings", "--test", "--test-timeout=5", "--test-reporter=dot",
                          "--test-reporter-destination=stdout", "test/**/*.test.ts"])
        self.assertEqual(cfg.command, "node --no-warnings --test 'test/**/*.test.ts'")
        self.assertIn("differs", suite_mod.node_mismatch(cfg) or "")
        self.assertEqual(race.default_repo(arena), REPO)
        self.assertTrue(race.default_repo(FIXTURE).endswith(os.path.join("corpora", "arena.git")))

    def test_a_bad_network_mode_is_refused(self) -> None:
        arena = make_arena()
        with open(os.path.join(arena, "arena.json"), "w", encoding="utf-8") as fh:
            json.dump(ARENA_JSON | {"agent_network": "full"}, fh)
        with self.assertRaises(ValueError):
            suite_mod.load_suite(arena)

    def test_activation_reaches_prompts_and_agents(self) -> None:
        suite_mod.activate(suite_mod.load_suite(make_arena()))
        self.assertIn("node --no-warnings --test 'test/**/*.test.ts'", prompts.acceptance_line(["test/x.test.ts"]))
        self.assertIn("Bash(node --no-warnings --test *)", claude_allowed_tools())
        spec = InvocationSpec(inv_id="i", kind="initial", task_id="t", agent_id="a", cwd=TMP, prompt="p")
        argv = CodexAdapter(None, model=None, timeout=60, transcripts=TMP).argv(spec)  # type: ignore[arg-type]
        self.assertNotIn("-s", argv)
        self.assertIn('default_permissions="arena"', argv)
        self.assertIn("permissions.arena.network.allow_local_binding=true", argv)
        self.assertIn("network_proxy", argv)
        suite_mod.activate(suite_mod.SuiteConfig())
        argv = CodexAdapter(None, model=None, timeout=60, transcripts=TMP).argv(spec)  # type: ignore[arg-type]
        self.assertEqual(argv[argv.index("-s") + 1], "workspace-write")
        self.assertIn("sandbox_workspace_write.network_access=false", argv)
        self.assertIn("Run `node --test`.", prompts.acceptance_line(["x"]))


class GatewaySuite(unittest.TestCase):
    """The run config's ``suite`` for the Cloudflare gateway (``packages/shared-race/src/suite.ts``)."""

    def test_the_designed_arena_sends_none(self) -> None:
        self.assertIsNone(suite_mod.gateway_suite(suite_mod.load_suite(FIXTURE)))

    def test_an_arena_json_sends_its_argv_env_snapshot_and_hint(self) -> None:
        arena = make_arena()
        with open(os.path.join(arena, "arena.json"), "w", encoding="utf-8") as fh:
            json.dump(ARENA_JSON | {"deps": "deps/node_modules"}, fh)
        sent = suite_mod.gateway_suite(suite_mod.load_suite(arena), 120.0)
        self.assertEqual(sent, {
            "argv": ["node", "--no-warnings", "--test", "test/**/*.test.ts"],
            "files_argv": ["node", "--no-warnings", "--test"],
            "env": {"ARENA_SUITE_PROBE": "1"}, "deps": "arena", "timeout_seconds": 120.0,
            "test_hint": "Run `node --no-warnings --test 'test/**/*.test.ts'`."})

    def test_fastify_is_sent_with_its_globs_and_snapshot(self) -> None:
        sent = suite_mod.gateway_suite(suite_mod.load_suite(gateway_fixture.ARENA))
        assert sent is not None
        self.assertEqual(sent["argv"][:3], ["node", "--no-use-env-proxy", "--test"])
        self.assertIn("test/!(listen.5).test.js", sent["argv"])
        self.assertEqual(sent["deps"], "fastify")

    def test_the_gateways_prompt_fixture_is_current(self) -> None:
        """packages/gateway/test/fixtures/fastify-prompts.json: regenerate with ``python3 gateway_fixture.py``."""
        with open(gateway_fixture.FIXTURE, encoding="utf-8") as fh:
            self.assertEqual(json.load(fh), gateway_fixture.build())

    def test_red_reworks_protect_only_the_restored_acceptance_tests(self) -> None:
        from harness.arena import Task
        from harness.policy_beanstalk_preland import preland_red
        from harness.policy_beanstalk_v2 import informed_red
        task = Task(id="t1", title="T", prompt="P", acceptance_tests={"test/a.test.js": "x"})
        for text in (preland_red(task, [], "", True), informed_red(task, [], "", [], True)):
            self.assertIn(prompts.PROTECTED_TESTS, text)
            self.assertNotIn("change the code, not the tests.", text)


class StandaloneFallback(unittest.TestCase):
    """A dependent real task's reference is written on top of an earlier task; replay falls back to its standalone
    patch (the change plus the prerequisite's part) when the prerequisite is not on the head."""

    def test_fallback_applies_when_the_reference_does_not(self) -> None:
        import asyncio
        from harness.agents import ReplayAdapter
        from harness.gitops import Git
        from harness.procs import Runner, Sandbox
        root = os.path.join(TMP, "fallback")
        shutil.rmtree(root, ignore_errors=True)
        repo = os.path.join(root, "repo")
        os.makedirs(repo)

        def g(*args: str) -> str:
            return subprocess.run(["git", *args], cwd=repo, capture_output=True, text=True, check=True).stdout

        g("init", "-q", "-b", "main")
        g("config", "user.email", "t@x")
        g("config", "user.name", "t")
        with open(os.path.join(repo, "a.js"), "w") as fh:
            fh.write("one\ntwo\nthree\n")
        g("add", "-A")
        g("commit", "-q", "-m", "base")
        with open(os.path.join(repo, "a.js"), "w") as fh:
            fh.write("one\ntwo (prerequisite)\nthree\n")
        g("commit", "-qam", "prerequisite")
        with open(os.path.join(repo, "a.js"), "w") as fh:
            fh.write("one\ntwo (prerequisite)\nthree (task)\n")
        reference = os.path.join(root, "t002.patch")
        with open(reference, "w") as fh:
            fh.write(g("diff", "HEAD"))
        standalone = os.path.join(root, "t002.standalone.patch")
        with open(standalone, "w") as fh:
            fh.write(g("diff", "HEAD~1"))
        g("checkout", "-q", "-f", "HEAD~1")  # the head the agent starts from: no prerequisite
        adapter = ReplayAdapter(Git(Runner(Sandbox(root)), repo), seed=1, median=0, sigma=0)
        notes: list = []
        ok = asyncio.run(adapter._apply(repo, {"path": reference, "strip": 1, "fallback": standalone}, notes))
        self.assertTrue(ok)
        with open(os.path.join(repo, "a.js")) as fh:
            self.assertEqual(fh.read(), "one\ntwo (prerequisite)\nthree (task)\n")
        self.assertIn("prerequisites not on the head", notes[0])


class ReplayRace(unittest.TestCase):
    def test_replay_race_on_an_arena_with_its_own_arena_json(self) -> None:
        arena = make_arena()
        out = os.path.join(RACE, "runs", "_test-suite-arena")
        argv = ["--arena", arena, "--out", out, "--force", "--policy", "queue", "--agent", "replay", "--agents", "3",
                "--ci-slots", "2", "--batch", "2", "--replay-median", "0.3", "--replay-sigma", "0.3",
                "--ci-seconds", "0.2"]
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                code = race.main(argv)
        finally:
            suite_mod.activate(suite_mod.SuiteConfig())
        with open(os.path.join(out, "summary.json")) as fh:
            s = json.load(fh)
        with open(os.path.join(out, "events.jsonl")) as fh:
            setup = next(json.loads(line) for line in fh if '"race.setup"' in line)
        self.assertEqual(code, 0, s.get("aborted"))
        self.assertEqual(s["tasks_green"], s["tasks"])
        self.assertTrue(s["final"]["suite_green"])
        self.assertEqual(setup["suite"]["test_args"], ["test/**/*.test.ts"])
        self.assertEqual(setup["repo"], REPO)
        with open(os.path.join(out, "config.json")) as fh:
            self.assertEqual(json.load(fh)["repo"], REPO)


if __name__ == "__main__":
    unittest.main()
