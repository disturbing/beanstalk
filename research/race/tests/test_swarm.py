"""Swarm races: ``race.py --forge cloudflare --swarm`` against the fake gateway and a fake swarm whose "containers" are
local ``python3 -m harness.slot`` processes (tests/fake_swarm.py). No network, no cost.
Run from research/race: ``python3 -m unittest tests.test_swarm``.
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
sys.path.insert(0, TESTS)

import race  # noqa: E402
from fake_gateway import FakeGateway  # noqa: E402
from fake_swarm import FakeSwarm  # noqa: E402
from harness.agents import CodexAdapter, InvocationResult  # noqa: E402
from harness.core import RaceConfig  # noqa: E402
from harness.remote import infra_failure  # noqa: E402
from harness.slot import LOCAL_FIELDS, placeholder_auth, race_config  # noqa: E402
from harness.swarm import SwarmRace, load_swarm_token  # noqa: E402
from test_remote import FIXTURE, REPO, TMP, tree_text  # noqa: E402


def setUpModule() -> None:
    os.makedirs(TMP, exist_ok=True)
    subprocess.run([sys.executable, os.path.join(FIXTURE, "materialize.py"), "--out", REPO], check=True,
                   capture_output=True)


class SwarmReplayRace(unittest.TestCase):
    """Two replay slots run as separate processes behind the fake swarm; the race must match a laptop race's
    outcome (both tasks green, one rework) and no slot ever holds a token."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.fake = FakeGateway(os.path.join(TMP, "fake-gateway-swarm"))
        shutil.rmtree(cls.fake.root, ignore_errors=True)
        os.makedirs(cls.fake.root)
        cls.fake.start()
        root = os.path.join(TMP, "fake-swarm")
        shutil.rmtree(root, ignore_errors=True)
        os.makedirs(root)
        cls.swarm = FakeSwarm(root, cls.fake.url, FIXTURE)
        cls.swarm.start()
        cls.out = os.path.join(RACE, "runs", "_test-swarm-v2")
        argv = ["--forge", "cloudflare", "--gateway", cls.fake.url, "--swarm", cls.swarm.url,
                "--policy", "beanstalk-v2", "--agent", "replay", "--agents", "2", "--tasks", "t001", "t002",
                "--replay-median", "0.05", "--replay-sigma", "0", "--replay-cost-usd", "0.01", "--ci-seconds", "0.3",
                "--seed", "3", "--preland-mode", "optimistic", "--preland-seconds", "0.5", "--decision-seconds", "1",
                "--arena", FIXTURE, "--repo", REPO, "--out", cls.out, "--force"]
        saved = dict(os.environ)
        os.environ["BEANSTALK_ADMIN_TOKEN"] = cls.fake.admin
        os.environ["SWARM_ADMIN_TOKEN"] = cls.swarm.admin
        cls.stderr = io.StringIO()
        try:
            with contextlib.redirect_stdout(io.StringIO()) as cls.stdout, contextlib.redirect_stderr(cls.stderr):
                cls.code = race.main(argv)
        finally:
            os.environ.clear()
            os.environ.update(saved)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.swarm.stop()
        cls.fake.stop()

    def slot_stderr(self) -> str:
        out = ""
        for slot in sorted(self.swarm.tokens):
            with open(os.path.join(self.swarm.root, f"{slot}.stderr")) as fh:
                out += fh.read()[-2000:]
        return out

    def test_the_race_completes_from_the_slots(self) -> None:
        self.assertEqual(self.code, 0, self.stderr.getvalue()[-3000:] + self.slot_stderr())
        self.assertEqual(self.fake.failures, [], self.slot_stderr())
        self.assertEqual(self.fake.phase, "done")
        with open(os.path.join(self.out, "summary.json")) as fh:
            self.assertEqual(json.load(fh)["tasks_green"], 2)
        reworks = [k for k in self.fake.results if k.endswith("-rework")]
        self.assertEqual(len(reworks), 1)

    def test_slots_never_hold_a_token(self) -> None:
        sent = {auth for _, auth in self.swarm.forwarded}
        self.assertEqual(sent - {"Bearer swarm-slot-placeholder", ""}, set())
        self.assertTrue(self.swarm.refreshed, "the scenario hands out a fresh token with the rework")
        secrets = [self.fake.admin, self.swarm.admin, *self.fake.tokens.values(), *self.fake.retired]
        text = tree_text(self.swarm.root) + tree_text(self.out) + self.stderr.getvalue()
        for secret in secrets:
            self.assertNotIn(secret, text)

    def test_slot_logs_spend_and_the_match_record_come_back(self) -> None:
        with open(os.path.join(self.out, "work", "driver-swarm.jsonl")) as fh:
            lines = [json.loads(ln) for ln in fh]
        self.assertEqual({ln["slot"] for ln in lines if ln["type"] == "driver.slot_start"}, set(self.swarm.tokens))
        self.assertTrue(any(ln["type"] == "driver.result" for ln in lines))
        with open(os.path.join(self.out, "swarm.json")) as fh:
            record = json.load(fh)
        self.assertGreater(record["usd"]["agents"], 0)
        self.assertTrue(all(a["exit_code"] == 0 for a in record["agents"]), record)


class SwarmPieces(unittest.TestCase):
    def test_codex_overrides_reach_argv_and_carry_no_key(self) -> None:
        adapter = CodexAdapter(None, model=None, timeout=60, transcripts=TMP,  # type: ignore[arg-type]
                               config_overrides=('model_provider="swarm"',))
        argv = adapter.argv(type("Spec", (), {"cwd": "/w", "post_tool_hook": None, "json_schema": None})())
        self.assertIn('model_provider="swarm"', argv)
        self.assertEqual(argv[-1], "-")
        self.assertNotIn('model_provider="swarm"', CodexAdapter(None, model=None, timeout=60,  # type: ignore[arg-type]
                                                                transcripts=TMP).argv(
            type("Spec", (), {"cwd": "/w", "post_tool_hook": None, "json_schema": None})()))

    def test_codex_http_errors_are_infra_failures(self) -> None:
        for message, kind in (("unexpected status 401 Unauthorized: Incorrect API key provided, url: x", "auth"),
                              ("unexpected status 429 Too Many Requests: swarm usage limit", "rate-limit"),
                              ("unexpected status 503 Service Unavailable", "api-unavailable"),
                              ("error sending request for url (https://auth.openai.com/oauth/token)", "auth"),
                              ("stream disconnected before completion: error sending request", "api-unavailable")):
            res = InvocationResult(inv_id="i", adapter="codex", model=None, infra_error=message)
            self.assertEqual(infra_failure(res)[0], kind)

    def test_placeholder_auth_is_not_a_credential(self) -> None:
        auth = placeholder_auth()
        self.assertEqual(auth["auth_mode"], "chatgpt")
        self.assertEqual(auth["tokens"]["refresh_token"], "swarm-placeholder")
        self.assertIn("swarm-placeholder", json.dumps(auth))

    def test_slot_config_keeps_its_own_paths(self) -> None:
        cfg = race_config({"agent": "codex", "agents": 4, "arena": "/laptop/arena", "repo": "/laptop/repo",
                           "out": "/laptop/out", "codex_price": [1, 2, 3], "unknown": 1})
        self.assertEqual((cfg.agent, cfg.agents, cfg.codex_price), ("codex", 4, (1, 2, 3)))
        self.assertNotIn("/laptop", cfg.arena + cfg.repo + cfg.out)
        self.assertIn("arena", LOCAL_FIELDS)

    def test_swarm_token_and_mode_checks(self) -> None:
        path = os.path.join(TMP, "swarm.dev.vars")
        with open(path, "w") as fh:
            fh.write("SEAT_KEY=x\nSWARM_ADMIN_TOKEN=from-file\n")
        env = {"SWARM_ADMIN_TOKEN": "from-env"}
        self.assertEqual(load_swarm_token(env, path), "from-env")
        self.assertNotIn("SWARM_ADMIN_TOKEN", env)
        self.assertEqual(load_swarm_token({}, path), "from-file")
        kw = dict(gateway="http://127.0.0.1:9", admin_token="a" * 20, policy="beanstalk-v2", swarm="http://s",
                  swarm_token="t" * 20)
        with self.assertRaises(SystemExit):
            SwarmRace(RaceConfig(agent="codex", out="runs/_test-swarm-x"), **kw)
        with self.assertRaises(SystemExit):
            SwarmRace(RaceConfig(agent="codex", agents=2, out="runs/_test-swarm-x"), credential="lease", **kw)


if __name__ == "__main__":
    unittest.main()
