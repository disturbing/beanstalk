"""The driver's recovery from a gateway that answers late or not at all: a lost long-poll answer (the gateway delivers
the same invocation again), result posts that fail for a while, and a summary fetched while the repos are reaped.
The fake gateway (tests/fake_gateway.py) and stubs only; no network, no cost.
Run from research/race: ``python3 -m unittest discover -s tests``.
"""
from __future__ import annotations

import asyncio
import contextlib
import io
import json
import os
import shutil
import sys
import time
import unittest

TESTS = os.path.dirname(os.path.abspath(__file__))
RACE = os.path.dirname(TESTS)
sys.path.insert(0, RACE)
sys.path.insert(0, TESTS)

import race  # noqa: E402
from fake_gateway import FakeGateway  # noqa: E402
from harness import remote  # noqa: E402
from harness.agents import InvocationResult  # noqa: E402
from harness.core import RaceConfig  # noqa: E402
from harness.remote import GatewayError, RemoteRace  # noqa: E402
from test_remote import FIXTURE, REPO, TMP, cloud_race, setUpModule  # noqa: E402,F401 - materializes the arena


def driver_log(out: str) -> list[dict]:
    with open(os.path.join(out, "work", "driver.jsonl"), encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def patch(test: unittest.TestCase, **values) -> None:
    """Set module constants of harness.remote for one test."""
    for name, value in values.items():
        test.addCleanup(setattr, remote, name, getattr(remote, name))
        setattr(remote, name, value)


class FakeGatewayRecovery(unittest.TestCase):
    def fake(self, name: str, **kw) -> FakeGateway:
        fake = FakeGateway(os.path.join(TMP, f"fake-{name}"), **kw)
        shutil.rmtree(fake.root, ignore_errors=True)
        os.makedirs(fake.root)
        fake.start()
        self.addCleanup(fake.stop)
        return fake

    def test_a_lost_poll_answer_is_asked_again_at_once_and_the_redelivery_runs_once(self) -> None:
        patch(self, POLL_TIMEOUT=1.0)
        fake = self.fake("lost-poll", lose_first_delivery=True, lost_reply_seconds=2.0)
        code, out, err = cloud_race(fake, "remote-lost-poll", "--policy", "queue", "--agent", "replay", "--agents",
                                    "1", "--tasks", "t003", "--replay-median", "0.05", "--replay-sigma", "0")
        self.assertEqual(code, 0, err[-2000:])
        self.assertEqual(fake.failures, [])
        self.assertEqual(fake.lost, ["inv0001-initial"])
        self.assertEqual(fake.redelivered, ["inv0001-initial"])
        self.assertEqual(list(fake.results), ["inv0001-initial"])
        log = driver_log(out)
        timeout = next(e for e in log if e["type"] == "driver.poll_error")
        self.assertTrue(timeout["timed_out"])
        started = [e for e in log if e["type"] == "driver.invocation"]
        self.assertEqual([e["inv"] for e in started], ["inv0001-initial"])
        self.assertLess(started[0]["t"] - timeout["t"], 0.8, "a timed-out poll is retried at once, not after a backoff")

    def test_result_posts_are_retried_past_four_failures_and_a_reaping_summary_is_fetched_again(self) -> None:
        patch(self, RESULT_RETRY_FIRST=0.05, REAP_WAIT=0.05)
        fake = self.fake("result-503", fail_results=6, reaping_summaries=1)
        code, out, err = cloud_race(fake, "remote-result-503", "--policy", "queue", "--agent", "replay", "--agents",
                                    "1", "--tasks", "t003", "--replay-median", "0.05", "--replay-sigma", "0")
        self.assertEqual(code, 0, err[-2000:])
        self.assertEqual(fake.failures, [])
        self.assertEqual(len(fake.unavailable), 6)
        self.assertEqual(list(fake.results), ["inv0001-initial"])
        retries = [e for e in driver_log(out) if e["type"] == "driver.result_retry"]
        self.assertEqual([e["attempt"] for e in retries], [1, 2, 3, 4, 5, 6])
        self.assertTrue(all(e["inv"] == "inv0001-initial" and "503" in e["error"] for e in retries))
        self.assertEqual([round(e["wait_seconds"], 2) for e in retries], [0.05, 0.1, 0.2, 0.4, 0.8, 1.6])
        self.assertEqual(fake.summaries, 2)
        with open(os.path.join(out, "summary.json"), encoding="utf-8") as fh:
            self.assertEqual(json.load(fh)["repos"], {"status": "deleted"})


class StubbedDriver(unittest.TestCase):
    """The same rules against a stubbed ``call_slot``."""

    def setUp(self) -> None:
        out = os.path.join(TMP, "remote-recovery")
        shutil.rmtree(out, ignore_errors=True)
        cfg = RaceConfig(policy="queue", agent="replay", out=out, force=True)
        self.race = RemoteRace(cfg, gateway="http://127.0.0.1:9", admin_token="x" * 16, policy="queue")
        with contextlib.redirect_stdout(io.StringIO()):  # "outside research/race/runs/" is expected here
            self.race.prepare_out()
        self.race.init_local()
        self.race.run_id = "run1234567"
        self.race.tokens = {"a0": "slot-token-for-tests"}
        self.calls: list[tuple] = []
        self.addCleanup(self.race.close_log)

    def logged(self, typ: str) -> list[dict]:
        return [e for e in self.race.events.events if e["type"] == typ]

    def test_result_posts_stop_at_the_watchdog_deadline(self) -> None:
        patch(self, RESULT_RETRY_FIRST=0.05)

        async def down(slot, name, *args, **kw):
            self.calls.append((name, args[0]))
            raise GatewayError("POST", "/result", 503, "unavailable", "down")

        self.race.call_slot = down
        t0 = time.monotonic()
        with self.assertRaises(GatewayError):
            asyncio.run(self.race.post_until("a0", "inv0001-initial", {"ok": True}, time.monotonic() + 0.5))
        self.assertLess(time.monotonic() - t0, 1.5)
        self.assertGreaterEqual(len(self.calls), 4)
        retries = self.logged("driver.result_retry")
        self.assertEqual(len(retries), len(self.calls) - 1)
        self.assertLessEqual(max(e["wait_seconds"] for e in retries), 0.5)

    def test_a_refused_result_is_not_retried(self) -> None:
        async def refused(slot, name, *args, **kw):
            self.calls.append((name, args[0]))
            raise GatewayError("POST", "/result", 409, "closed_invocation", "already ended")

        self.race.call_slot = refused
        with self.assertRaises(GatewayError):
            asyncio.run(self.race.post_until("a0", "inv0001-initial", {"ok": True}, time.monotonic() + 60))
        self.assertEqual(len(self.calls), 1)

    def test_the_deadline_is_the_invocations_watchdog(self) -> None:
        seen: dict = {}

        async def post_until(slot, inv_id, body, deadline):
            seen["left"] = deadline - time.monotonic()

        self.race.post_until = post_until
        res = InvocationResult(inv_id="inv0001-initial", adapter="replay", model="replay", ok=True)
        inv = {"inv": "inv0001-initial", "task": "t003", "kind": "initial"}
        with contextlib.redirect_stderr(io.StringIO()):
            asyncio.run(self.race.post_result("a0", inv, res, {}, 1.0, deadline=time.monotonic() + 1200))
            self.assertAlmostEqual(seen["left"], 1200, delta=5)
            asyncio.run(self.race.post_result("a0", inv, res, {}, 1.0, deadline=time.monotonic() - 10))
            self.assertAlmostEqual(seen["left"], remote.RESULT_RETRY_MIN, delta=5)  # a late finish still retries

    def test_an_invocation_delivered_twice_runs_once(self) -> None:
        handled: list[str] = []
        replies = [{"invocation": {"inv": "inv0001-initial"}}, {"invocation": {"inv": "inv0001-initial"}},
                   {"done": True, "aborted": None}]

        async def call_slot(slot, name, *args, **kw):
            self.calls.append((name, *args[:1]))
            return replies.pop(0) if name == "next" else {"accepted": True}

        async def handle(slot, inv):  # what handle records around the real work
            self.race.running_invs[inv["inv"]] = slot
            handled.append(inv["inv"])
            self.race.last_result[slot] = (inv["inv"], {"ok": True})
            self.race.running_invs.pop(inv["inv"])
            self.race.handled_invs.add(inv["inv"])

        self.race.call_slot = call_slot
        self.race.handle = handle

        async def run() -> None:
            self.race.run_over = asyncio.Event()
            with contextlib.redirect_stderr(io.StringIO()):
                await self.race.slot_loop("a0")

        asyncio.run(run())
        self.assertEqual(handled, ["inv0001-initial"])
        self.assertEqual(self.calls, [("next",), ("next",), ("result", "inv0001-initial"), ("next",)])
        self.assertEqual([e["action"] for e in self.logged("driver.redelivered")], ["result posted again"])

    def test_a_redelivery_of_the_running_invocation_is_a_no_op(self) -> None:
        self.race.running_invs["inv0002-rework"] = "a0"
        again = asyncio.run(self.race.redelivered("a0", {"inv": "inv0002-rework"}))
        self.assertTrue(again)
        self.assertEqual(self.calls, [])
        self.assertEqual([e["action"] for e in self.logged("driver.redelivered")], ["kept running"])
        self.assertFalse(asyncio.run(self.race.redelivered("a0", {"inv": "inv0003-rework"})))


if __name__ == "__main__":
    unittest.main()
