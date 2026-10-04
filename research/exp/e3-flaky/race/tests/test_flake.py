"""Experiment E3 tests: flake injection, the flake history, and the mitigations (replay agents, no cost).

Run from this directory: ``python3 -m unittest tests.test_flake`` (or the whole suite with ``discover -s tests``).
"""
from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import shutil
import subprocess
import sys
import unittest
from contextlib import redirect_stdout

logging.getLogger("asyncio").setLevel(logging.ERROR)   # asyncio debug mode (IsolatedAsyncioTestCase) logs slow callbacks
TESTS = os.path.dirname(os.path.abspath(__file__))
RACE = os.path.dirname(TESTS)
sys.path.insert(0, RACE)
sys.path.insert(0, TESTS)

import test_race as base  # noqa: E402  (fixture arena, run_race helper)
from harness.ci import CI, SuiteGate, node_test_flags, parse_junit, parse_junit_full  # noqa: E402
from harness.flake import (FlakeBook, FlakeConfig, Flaker, _u, agree, locate_test, metrics,  # noqa: E402
                           test_id)
from harness.gitops import Git  # noqa: E402
from harness.procs import ProcRegistry, Runner, Sandbox  # noqa: E402

FIXTURE, REPO, TMP = base.FIXTURE, base.REPO, base.TMP
of, run_race, FAST = base.of, base.run_race, base.FAST
CI_WORK = os.path.join(TMP, "flake-ci")
BASE_CASES = [("test/cart.test.ts", "totals a cart"), ("test/cart.test.ts", "empty cart is zero"),
              ("test/invoice.test.ts", "invoices"), ("test/money.test.ts", "formats money"),
              ("test/routes.test.ts", "routes"), ("test/users.test.ts", "displayName uses the name"),
              ("test/acceptance/t001.test.ts", "health")]
BASE_FILES = sorted({f for f, _ in BASE_CASES if "acceptance" not in f})


def setUpModule() -> None:
    base.setUpModule()   # the fixture arena repository


def flaker(**kw) -> Flaker:
    f = Flaker(FlakeConfig(**kw))
    f.bind_base(BASE_FILES)
    return f


class Draws(unittest.TestCase):
    def test_deterministic_per_seed_sha_purpose_attempt(self) -> None:
        a, b = flaker(rate=0.3, seed=7), flaker(rate=0.3, seed=7)
        keys = [(f"sha{i}", p, n) for i in range(300) for p in ("preland", "validate", "batch") for n in (0, 1)]
        self.assertEqual([a.fires(*k) for k in keys], [b.fires(*k) for k in keys])
        other = flaker(rate=0.3, seed=8)
        self.assertNotEqual([a.fires(*k) for k in keys], [other.fires(*k) for k in keys])
        # the attempt number is part of the key: a re-run is an independent draw
        diff = [k for k in keys if k[2] == 0 and a.fires(*k) != a.fires(k[0], k[1], 1)]
        self.assertTrue(diff)

    def test_rate_is_calibrated_and_per_run(self) -> None:
        for rate in (0.02, 0.05, 0.2):
            f = flaker(rate=rate, seed=3)
            n = 20000
            hits = sum(f.fires(f"c{i}", "validate", 0) for i in range(n))
            self.assertAlmostEqual(hits / n, rate, delta=max(0.004, rate * 0.15))
        self.assertFalse(any(flaker(rate=0.0).fires(f"c{i}", "validate", 0) for i in range(500)))
        self.assertTrue(all(flaker(rate=1.0).fires(f"c{i}", "validate", 0) for i in range(500)))

    def test_final_never_flakes_and_purposes_can_be_restricted(self) -> None:
        f = flaker(rate=1.0)
        self.assertFalse(f.fires("x", "final", 0))
        for p in ("preland", "validate", "batch", "bisect"):
            self.assertTrue(f.fires("x", p, 0), p)
        only = flaker(rate=1.0, purposes=("validate",))
        self.assertTrue(only.fires("x", "validate", 0))
        self.assertFalse(only.fires("x", "preland", 0))

    def test_limit_stops_injection(self) -> None:
        f = flaker(rate=1.0, limit=2)
        self.assertTrue(f.should_flake("a", "validate", 0))
        f.injected = 2
        self.assertFalse(f.should_flake("a", "validate", 0))

    def test_attempts_count_per_sha_and_purpose(self) -> None:
        f = flaker(rate=0.5)
        self.assertEqual([f.next_attempt("s", "preland") for _ in range(3)], [0, 1, 2])
        self.assertEqual(f.next_attempt("s", "validate"), 0)
        self.assertEqual(f.next_attempt("t", "preland"), 0)

    def test_victims_come_from_a_fixed_pool_of_base_tests(self) -> None:
        f = flaker(rate=0.3, seed=11, pool=3)
        victims = {f.pick_victim(f"c{i}", "preland", 0, BASE_CASES) for i in range(400)}
        self.assertEqual(len(f.pool), 3)
        self.assertEqual(victims, set(f.pool))
        self.assertTrue(all("acceptance" not in v[0] for v in victims))
        # the pool depends on the seed and the test identities, not on the order the cases are listed
        g = flaker(rate=0.3, seed=11, pool=3)
        g.pick_victim("z", "preland", 0, list(reversed(BASE_CASES)))
        self.assertEqual(f.pool, g.pool)
        anywhere = flaker(rate=0.3, seed=11, pool=0)
        self.assertGreater(len({anywhere.pick_victim(f"c{i}", "preland", 0, BASE_CASES) for i in range(400)}), 3)
        self.assertIsNone(f.pick_victim("c", "preland", 0, []))

    def test_config_from_env(self) -> None:
        cfg = FlakeConfig.from_env({"FLAKE_RATE": "0.05", "FLAKE_POOL": "4", "FLAKE_PURPOSES": "preland, validate",
                                    "FLAKE_RERUN_PRELAND": "1"}, default_seed=9)
        self.assertEqual((cfg.rate, cfg.seed, cfg.pool, cfg.purposes), (0.05, 9, 4, ("preland", "validate")))
        self.assertTrue(cfg.rerun_preland)
        self.assertFalse(cfg.rerun_validate or cfg.retry_batch)
        every = FlakeConfig.from_env({"FLAKE_MITIGATE": "1"})
        self.assertTrue(every.rerun_preland and every.rerun_validate and every.retry_batch)
        self.assertIsNone(cfg.rerun_seconds)
        self.assertEqual(FlakeConfig.from_env({"FLAKE_RERUN_SECONDS": "5"}).rerun_seconds, 5.0)
        explicit = FlakeConfig.from_env({"FLAKE_MITIGATE": "1", "FLAKE_RERUN_VALIDATE": "0"})
        self.assertFalse(explicit.rerun_validate)
        self.assertEqual(FlakeConfig.from_env({"FLAKE_SEED": "5"}, default_seed=9).seed, 5)
        self.assertEqual(FlakeConfig.from_env({}).rate, 0.0)
        with self.assertRaises(SystemExit):
            FlakeConfig.from_env({"FLAKE_RATE": "1.5"})
        with self.assertRaises(SystemExit):
            FlakeConfig.from_env({"FLAKE_RATE": "lots"})

    def test_hash_is_platform_independent(self) -> None:
        self.assertEqual(_u("a", 1), _u("a", 1))
        self.assertNotEqual(_u("a", 1), _u("a", 2))
        self.assertAlmostEqual(_u("seed", "sha", "preland", 0), 0.6699641195741949, places=12)  # pinned: sha256-based


class History(unittest.TestCase):
    def test_a_test_that_flips_on_the_same_tree_is_flaky(self) -> None:
        book = FlakeBook()
        self.assertEqual(book.record("T1", "ci1", ["a", "b"], ["c"]), [])
        self.assertEqual(book.record("T1", "ci2", ["a", "b", "c"], []), ["c"])     # c failed, then passed: a flip
        self.assertEqual(book.flaky["c"]["flips"], 1)
        self.assertEqual(book.record("T1", "ci3", ["a", "b"], ["c"]), [])           # already counted on this tree
        self.assertEqual(book.flaky["c"]["flips"], 1)
        self.assertTrue(book.is_flaky("c") and not book.is_flaky("a"))

    def test_different_trees_are_not_evidence(self) -> None:
        book = FlakeBook()
        book.record("T1", "ci1", ["a"], ["c"])
        self.assertEqual(book.record("T2", "ci2", ["a", "c"], []), [])               # a fix, not a flake
        self.assertEqual(book.flaky, {})

    def test_a_consistent_failure_is_not_a_flake(self) -> None:
        book = FlakeBook()
        book.record("T1", "ci1", ["a"], ["c"])
        self.assertEqual(book.record("T1", "ci2", ["a"], ["c"]), [])
        self.assertEqual(book.flaky, {})

    def test_flips_accumulate_per_tree_and_quarantine_needs_enough(self) -> None:
        book = FlakeBook(quarantine_flips=2)
        for tree in ("T1", "T2"):
            book.record(tree, "x", [], ["c"])
            book.record(tree, "y", ["c"], [])
            self.assertEqual(book.is_quarantined("c"), tree == "T2")
        self.assertEqual(book.flaky["c"]["flips"], 2)
        self.assertEqual(book.summary()["tests"], {"c": 2})
        self.assertFalse(FlakeBook(0).is_quarantined("c"))


class ConfirmSame(unittest.TestCase):
    """The same-test confirmation (FLAKE_CONFIRM_SAME): a second red confirms the first only if a test fails in both."""

    def test_agree(self) -> None:
        self.assertTrue(agree(["a > x"], ["a > x"]))
        self.assertTrue(agree(["a > x", "b > y"], ["b > y"]))             # one common failing test is enough
        self.assertFalse(agree(["a > x"], ["b > y"]))                     # two different failures: two flakes
        self.assertTrue(agree([], ["b > y"]) and agree(["a > x"], []))    # unknown (nothing parsed): do not call it a flake
        self.assertTrue(agree(None, None))

    def test_config_flag_is_off_by_default_and_not_part_of_the_shorthand(self) -> None:
        self.assertFalse(FlakeConfig.from_env({}).confirm_same)
        self.assertFalse(FlakeConfig.from_env({"FLAKE_MITIGATE": "1"}).confirm_same)
        self.assertTrue(FlakeConfig.from_env({"FLAKE_CONFIRM_SAME": "1"}).confirm_same)
        self.assertTrue(FlakeConfig.from_env({"FLAKE_CONFIRM_SAME": "1"}).public()["confirm_same"])

    def test_metrics_count_inconsistent_reruns_and_survive_other_outcomes(self) -> None:
        ev = [{"seq": 1, "type": "flake.rerun", "purpose": "validate", "outcome": "absorbed", "first_flaked": True,
               "inconsistent": True},
              {"seq": 2, "type": "flake.rerun", "purpose": "validate", "outcome": "something-new", "first_flaked": False}]
        m = metrics(ev)["reruns"]["validate"]
        self.assertEqual((m["count"], m["absorbed"], m["inconsistent"], m["something-new"]), (2, 1, 1, 1))


class Gate(unittest.IsolatedAsyncioTestCase):
    """The coordinator's overload rules: validation runs cap the node processes (RACE_NODE_SUITES / _CONCURRENCY)."""

    async def peak(self, limit: int, jobs: int = 8) -> int:
        gate, running, peak = SuiteGate(limit), 0, 0

        async def job() -> None:
            nonlocal running, peak
            async with gate:
                running += 1
                peak = max(peak, running)
                await asyncio.sleep(0.02)
                running -= 1

        await asyncio.gather(*(job() for _ in range(jobs)))
        return peak

    async def test_gate_limits_concurrent_suites(self) -> None:
        self.assertEqual(await self.peak(1), 1)
        self.assertEqual(await self.peak(3), 3)
        self.assertEqual(await self.peak(0), 8)          # 0 = no limit (the default)

    def test_node_concurrency_flag_comes_from_the_environment(self) -> None:
        saved = os.environ.pop("RACE_NODE_CONCURRENCY", None)
        try:
            self.assertEqual(node_test_flags(), [])
            os.environ["RACE_NODE_CONCURRENCY"] = "3"
            self.assertEqual(node_test_flags(), ["--test-concurrency=3"])
            os.environ["RACE_NODE_CONCURRENCY"] = "junk"
            self.assertEqual(node_test_flags(), [])
        finally:
            os.environ.pop("RACE_NODE_CONCURRENCY", None)
            if saved is not None:
                os.environ["RACE_NODE_CONCURRENCY"] = saved


class Metrics(unittest.TestCase):
    def test_metrics_from_events(self) -> None:
        ev = [
            {"seq": 1, "type": "preland.check", "green": False, "flaked": True, "check_seconds": 60.0},
            {"seq": 2, "type": "flake.rerun", "purpose": "preland", "outcome": "absorbed", "first_flaked": True},
            {"seq": 3, "type": "preland.check", "green": True, "rerun": True, "check_seconds": 61.0},
            {"seq": 4, "type": "ci.end", "purpose": "validate", "green": False, "flaked": True, "ci_seconds": 70.0},
            {"seq": 5, "type": "ci.end", "purpose": "validate", "green": None, "cancelled": True},
            {"seq": 6, "type": "ci.end", "purpose": "final", "green": True},
            {"seq": 7, "type": "rework.start", "task": "t1", "needless": True, "inv": "i1"},
            {"seq": 8, "type": "invocation.end", "inv": "i1", "cost_usd": 0.25, "tool_uses": {"Bash": 3, "Read": 1}},
            {"seq": 9, "type": "task.commit", "task": "t1", "kind": "rework", "new_commit": False},
            {"seq": 10, "type": "revert", "task": "t2", "flake_only": True, "probe_flakes": 0},
            {"seq": 11, "type": "revert", "task": "t3", "flake_only": False},
            {"seq": 12, "type": "queue.eject", "reason": "red", "flake_only": True},
            {"seq": 13, "type": "flake.flip", "test": "a > b", "flips": 2},
            {"seq": 14, "type": "ci.end", "purpose": "validate", "green": False, "flaked": True, "sha": "S1", "ci_seconds": 60.0},
            {"seq": 15, "type": "ticket.open", "ticket": "R001", "red_sha": "S1"},
            {"seq": 16, "type": "ticket.close", "ticket": "R001", "how": "green at trunk #7"},
            {"seq": 17, "type": "ci.end", "purpose": "validate", "green": False, "flaked": True, "sha": "S2", "ci_seconds": 60.0},
            {"seq": 18, "type": "ticket.open", "ticket": "R002", "red_sha": "S2"},
            {"seq": 19, "type": "revert", "task": "t9", "ticket": "R002", "flake_only": True},
        ]
        m = metrics(ev)
        self.assertEqual(m["ci_runs"], {"preland": 2, "validate": 3})
        self.assertEqual(m["flaked_runs"], 4)
        self.assertEqual(m["flaked_runs_by_purpose"], {"preland": 1, "validate": 3})
        self.assertEqual((m["flaked_validations"], m["flake_tickets"], m["flake_tickets_exonerated"],
                          m["flake_tickets_reverted"]), (2, 2, 1, 1))
        self.assertEqual(m["reruns"], {"preland": {"count": 1, "absorbed": 1, "confirmed": 0, "on_flake": 1, "on_real": 0,
                                                    "inconsistent": 0}})
        self.assertEqual(m["rerun_minutes"], round(61.0 / 60, 2))
        self.assertEqual((m["needless_reworks"], m["needless_rework_cost_usd"]), (1, 0.25))
        self.assertEqual(m["needless_reworks_that_edited_files"], 0)
        self.assertEqual((m["reverts"], m["wrongful_reverts"], m["wrongful_revert_tasks"]), (3, 2, ["t2", "t9"]))
        self.assertEqual((m["queue_red_ejections"], m["queue_needless_ejections"]), (1, 1))
        self.assertEqual(m["flaky_tests"], {"a > b": 2})


class InjectedFailure(unittest.TestCase):
    def test_locate_test_finds_the_line(self) -> None:
        line, col = locate_test(os.path.join(FIXTURE, "app"), "test/cart.test.ts", "empty")
        self.assertGreaterEqual(line, 1)
        self.assertEqual(locate_test(os.path.join(FIXTURE, "app"), "test/missing.test.ts", "x"), (1, 1))

    def test_junit_full_matches_junit(self) -> None:
        xml = os.path.join(TMP, "j-full.xml")
        root = os.path.join(TMP, "jroot")
        with open(xml, "w") as fh:
            fh.write(f'<testsuites><testcase name="a" file="{root}/test/a.test.ts"/>'
                     f'<testcase name="s" file="{root}/test/a.test.ts"><skipped/></testcase>'
                     f'<testcase name="b" file="{root}/test/b.test.ts"><failure message="boom"/></testcase>'
                     "</testsuites>")
        failing, passing, n, cases = parse_junit_full(xml, root)
        self.assertEqual((n, passing, cases), (3, ["test/a.test.ts"], [("test/a.test.ts", "a")]))
        self.assertEqual(parse_junit(xml, root)[2], 3)
        self.assertEqual(failing[0]["file"], "test/b.test.ts")


class CIFlakes(unittest.IsolatedAsyncioTestCase):
    """The CI runner on the fixture arena's base commit (a real ``node --test``)."""

    async def asyncSetUp(self) -> None:
        shutil.rmtree(CI_WORK, ignore_errors=True)
        work = os.path.join(CI_WORK, "work")
        os.makedirs(work)
        self.runner = Runner(Sandbox(work), ProcRegistry())
        integration = os.path.join(work, "integration")
        subprocess.run(["git", "clone", "-q", "--no-local", REPO, integration], check=True, capture_output=True)
        self.git = Git(self.runner, integration)
        for k, v in (("user.name", "t"), ("user.email", "t@t.invalid"), ("commit.gpgsign", "false")):
            await self.git.run("config", k, v)
        self.sha = await self.git.rev("main")
        self.work = work

    async def make(self, **cfg) -> CI:
        ci = CI(self.git, self.runner, self.work, 1, 0.0, 120, flaker=Flaker(FlakeConfig(**cfg)))
        await ci.setup(self.sha)
        return ci

    async def test_clean_run_is_green_and_untouched(self) -> None:
        ci = await self.make(rate=0.0)
        res = await ci.run(self.sha, "validate")
        self.assertTrue(res.green)
        self.assertEqual((res.true_green, res.flaked, res.flake_test, res.attempt), (True, False, None, 0))
        self.assertFalse(res.flake_only)

    async def test_two_cis_naming_the_same_slot_keep_their_own_index_locks(self) -> None:
        """E2's bug: v2's pre-land CI and the validation CI both call a worktree slot-0; git names the admin dirs slot-0 and
        slot-01, and CI.run guessed the lock path from the slot number, so one CI could delete the other's index.lock."""
        a = await self.make(rate=0.0)
        b = CI(self.git, self.runner, os.path.join(self.work, "preland"), 1, 0.0, 120, flaker=Flaker(FlakeConfig()))
        await b.setup(self.sha)
        self.assertNotEqual(a.gitdirs[0], b.gitdirs[0])
        self.assertTrue(os.path.isdir(a.gitdirs[0]) and os.path.isdir(b.gitdirs[0]))
        lock_a = os.path.join(a.gitdirs[0], "index.lock")
        open(lock_a, "w").close()
        res = await b.run(self.sha, "preland")                  # b must leave a's lock alone ...
        self.assertTrue(res.green)
        self.assertTrue(os.path.exists(lock_a))
        lock_b = os.path.join(b.gitdirs[0], "index.lock")
        open(lock_b, "w").close()
        res = await b.run(self.sha, "preland")                  # ... and clear its own stale one
        self.assertTrue(res.green)
        self.assertFalse(os.path.exists(lock_b))
        os.remove(lock_a)

    async def test_a_flake_turns_a_green_run_red_with_a_named_test(self) -> None:
        ci = await self.make(rate=1.0, seed=5, pool=2)
        res = await ci.run(self.sha, "validate")
        self.assertFalse(res.green)
        self.assertTrue(res.true_green and res.flaked and res.flake_only)
        self.assertEqual(res.failing_files, [res.flake_test.split(" > ")[0]])
        self.assertEqual(res.failures, 1)
        self.assertTrue(res.output.startswith("failing tests:"))
        self.assertIn("test timed out after 5000ms", res.output)
        self.assertIn(res.flake_test, [test_id(t["file"], t["name"]) for t in res.failing_tests])
        self.assertNotIn("body", res.failing_tests[0])     # popped like a real failure's body
        self.assertTrue(res.read_set)                      # the usual read-set bookkeeping ran on the victim
        self.assertIn(res.flake_test, [test_id(f, n) for f, n in ci.flaker.pool])

    async def test_the_final_check_is_never_flaky(self) -> None:
        ci = await self.make(rate=1.0)
        res = await ci.run(self.sha, "final", latency=0)
        self.assertTrue(res.green and not res.flaked)

    async def test_same_seed_same_sha_same_victim_and_a_rerun_is_a_new_draw(self) -> None:
        a = await self.make(rate=1.0, seed=5, pool=0)
        b = await self.make(rate=1.0, seed=5, pool=0)
        first_a, first_b = await a.run(self.sha, "validate"), await b.run(self.sha, "validate")
        self.assertEqual(first_a.flake_test, first_b.flake_test)
        self.assertEqual((first_a.attempt, first_b.attempt), (0, 0))
        again = await a.run(self.sha, "validate")
        self.assertEqual(again.attempt, 1)
        explicit = await b.run(self.sha, "validate", attempt=0)
        self.assertEqual(explicit.flake_test, first_a.flake_test)   # attempt 0 again: the same draw

    async def test_a_rerun_that_passes_flags_the_test_flaky(self) -> None:
        ci = await self.make(rate=1.0, limit=1, pool=2)
        first = await ci.run(self.sha, "preland")
        self.assertTrue(first.flaked)
        second = await ci.run(self.sha, "preland")
        self.assertTrue(second.green and not second.flaked)
        self.assertEqual(second.flips, [first.flake_test])
        self.assertEqual(ci.flaker.book.flaky[first.flake_test]["flips"], 1)
        self.assertEqual(ci.flaker.injected, 1)

    async def test_two_flaked_runs_are_not_a_flip(self) -> None:
        ci = await self.make(rate=1.0, pool=1)                 # the same single victim fails every time
        first, second = await ci.run(self.sha, "preland"), await ci.run(self.sha, "preland")
        self.assertTrue(first.flaked and second.flaked)
        self.assertEqual(first.flake_test, second.flake_test)
        self.assertEqual((first.flips, second.flips, ci.flaker.book.flaky), ([], [], {}))   # it never passed

    async def test_quarantined_tests_stop_gating(self) -> None:
        ci = await self.make(rate=1.0, limit=2, pool=1, quarantine_flips=1, purposes=("validate",))
        first = await ci.run(self.sha, "validate")           # flakes
        self.assertFalse(first.green)
        await ci.run(self.sha, "bisect")                     # same tree, purpose not flaky: green -> a flip -> quarantined
        self.assertTrue(ci.flaker.book.is_quarantined(first.flake_test))
        third = await ci.run(self.sha, "validate")           # flakes on the same single pool test
        self.assertTrue(third.flaked)
        self.assertTrue(third.green)                          # ... but it no longer gates
        self.assertEqual(third.quarantined, [first.flake_test])
        self.assertEqual(third.quarantined_real, [])
        self.assertFalse(third.flake_only)


def summary_flake(s: dict) -> dict:
    return s["flake"]


V2 = ("--policy", "beanstalk-v2", "--agents", "3", "--ci-slots", "2", "--snapshot", "head", "--error-budget", "999",
      "--tasks", "t002", "t003", "t005", *FAST)
V2ENV = {"PRELAND_MODE": "optimistic", "PRELAND_SECONDS": "0.2", "DECISION_SECONDS": "0", "FLAKE_SEED": "1"}
# One bean, so no later head can exonerate a flaky red validation (a later green validation closes the ticket before the
# culprit search ends): the revert is then deterministic.
V2_ONE = ("--policy", "beanstalk-v2", "--agents", "1", "--ci-slots", "2", "--snapshot", "head", "--error-budget", "999",
          "--tasks", "t002", *FAST)


class RacesV2(unittest.TestCase):
    def test_a_clean_race_has_no_flake_events_and_the_config_event(self) -> None:
        code, s, ev = run_race("flake-clean", *V2, env=V2ENV)
        base.assert_correct(self, code, s)
        self.assertEqual(s["flake"]["flaked_runs"], 0)
        self.assertEqual(s["flake"]["needless_reworks"], 0)
        self.assertEqual(len(of(ev, "flake.config")), 1)
        self.assertEqual(of(ev, "flake.config")[0]["rate"], 0.0)
        self.assertGreaterEqual(len(of(ev, "machine.load")), 2)       # at the start and at the end
        self.assertIn("load1_mean", s["machine"])

    def test_a_flaky_preland_red_sends_a_good_bean_back_needlessly(self) -> None:
        env = {**V2ENV, "FLAKE_RATE": "1", "FLAKE_PURPOSES": "preland", "FLAKE_LIMIT": "1"}
        code, s, ev = run_race("flake-preland", *V2, env=env)
        base.assert_correct(self, code, s)
        fl = s["flake"]
        self.assertEqual((fl["flaked_runs"], fl["needless_reworks"]), (1, 1))
        flaked = [e for e in of(ev, "preland.check") if e.get("flaked")]
        self.assertEqual(len(flaked), 1)
        rework = [e for e in of(ev, "rework.start", reason="preland-red")]
        self.assertEqual(len(rework), 1)
        self.assertTrue(rework[0]["needless"])
        self.assertEqual(of(ev, "flake.rerun"), [])
        self.assertEqual(s["tasks_green"], s["tasks"])

    def test_rerunning_a_red_preland_check_absorbs_the_flake_and_records_the_flip(self) -> None:
        env = {**V2ENV, "FLAKE_RATE": "1", "FLAKE_PURPOSES": "preland", "FLAKE_LIMIT": "1", "FLAKE_RERUN_PRELAND": "1"}
        code, s, ev = run_race("flake-preland-rerun", *V2, env=env)
        base.assert_correct(self, code, s)
        fl = s["flake"]
        self.assertEqual((fl["flaked_runs"], fl["needless_reworks"]), (1, 0))
        self.assertEqual(of(ev, "rework.start", reason="preland-red"), [])
        rr = of(ev, "flake.rerun")
        self.assertEqual([(e["purpose"], e["outcome"]) for e in rr], [("preland", "absorbed")])
        self.assertEqual(len([e for e in of(ev, "preland.check") if e.get("rerun")]), 1)
        self.assertEqual(len(fl["flaky_tests"]), 1)                       # same tree, red then green
        self.assertEqual(len(of(ev, "flake.flip")), 1)
        self.assertEqual(s["tasks_green"], s["tasks"])

    def test_a_flaky_validation_reverts_and_drops_a_good_bean(self) -> None:
        env = {**V2ENV, "FLAKE_RATE": "1", "FLAKE_PURPOSES": "validate", "FLAKE_LIMIT": "1", "FLAKE_POOL": "0"}
        code, s, ev = run_race("flake-validate", *V2_ONE, env=env)
        self.assertEqual(code, 0, s.get("aborted"))
        self.assertTrue(s["final"]["correct"])
        fl = s["flake"]
        self.assertEqual((fl["flaked_runs"], fl["wrongful_reverts"], fl["reverts"]), (1, 1, 1))
        rev = of(ev, "revert")
        self.assertTrue(rev[0]["flake_only"])
        self.assertEqual((s["tasks_green"], s["tasks_dropped"]), (0, 1))
        self.assertEqual(of(ev, "fixer.dispatch"), [])        # revert-first, whichever way the ticket was localised
        self.assertEqual((fl["flaked_validations"], fl["flake_tickets"], fl["flake_tickets_reverted"]), (1, 1, 1))
        self.assertEqual(fl["wrongful_revert_tasks"], [rev[0]["task"]])

    def test_a_flaky_validation_with_no_suspect_is_reverted_not_fixed(self) -> None:
        """The harness change of section 1.5: a ticket whose failing test reads none of the unvalidated files
        (so it is localised by bisection) used to be handed to a fix-forward fixer; revert-first covers it."""
        import re
        cases = []
        for name in sorted(os.listdir(os.path.join(FIXTURE, "app", "test"))):
            if name.endswith(".test.ts"):
                text = open(os.path.join(FIXTURE, "app", "test", name)).read()
                cases += [(f"test/{name}", n) for n in re.findall(r'test\("([^"]+)"', text)]
        seed = next(sd for sd in range(1, 200)
                    if self.pool_of(sd, cases)[0] != "test/routes.test.ts")     # a victim that t002 (routes) cannot reach
        env = {**V2ENV, "FLAKE_RATE": "1", "FLAKE_PURPOSES": "validate", "FLAKE_LIMIT": "1", "FLAKE_POOL": "1",
               "FLAKE_SEED": str(seed)}
        args = ("--policy", "beanstalk-v2", "--agents", "1", "--ci-slots", "2", "--snapshot", "head",
                "--error-budget", "999", "--tasks", "t002", *FAST)
        code, s, ev = run_race("flake-validate-bisect-ticket", *args, env=env)
        self.assertEqual(code, 0, s.get("aborted"))
        self.assertTrue(of(ev, "ticket.bisect"), "the ticket must have been localised by bisection")
        self.assertEqual(of(ev, "fixer.dispatch"), [])
        self.assertEqual(s["invocations"].get("fixer", 0), 0)
        rev = of(ev, "revert")
        self.assertEqual([(e["task"], e["flake_only"]) for e in rev], [("t002", True)])
        self.assertEqual((s["tasks_green"], s["tasks_dropped"]), (0, 1))
        self.assertTrue(s["final"]["suite_green"])

    @staticmethod
    def pool_of(seed: int, cases: list) -> list:
        f = flaker(rate=1.0, seed=seed, pool=1)
        f.pick_victim("x", "validate", 0, cases)
        return [file for file, _ in f.pool]

    def test_rerunning_a_red_validation_before_reverting_keeps_the_bean(self) -> None:
        env = {**V2ENV, "FLAKE_RATE": "1", "FLAKE_PURPOSES": "validate", "FLAKE_LIMIT": "1", "FLAKE_POOL": "0",
               "FLAKE_RERUN_VALIDATE": "1"}
        code, s, ev = run_race("flake-validate-rerun", *V2, env=env)
        base.assert_correct(self, code, s)
        fl = s["flake"]
        self.assertEqual((fl["flaked_runs"], fl["wrongful_reverts"], fl["reverts"]), (1, 0, 0))
        self.assertEqual([(e["purpose"], e["outcome"]) for e in of(ev, "flake.rerun")], [("validate", "absorbed")])
        reruns = [e for e in of(ev, "ci.end", purpose="validate") if e.get("rerun")]
        self.assertEqual(len(reruns), 1)
        self.assertEqual(s["tasks_green"], s["tasks"])
        self.assertEqual(len(fl["flaky_tests"]), 1)

    def test_a_rerun_can_be_cheap(self) -> None:
        env = {**V2ENV, "FLAKE_RATE": "1", "FLAKE_PURPOSES": "preland", "FLAKE_LIMIT": "1", "FLAKE_RERUN_PRELAND": "1",
               "FLAKE_RERUN_SECONDS": "0.05", "PRELAND_SECONDS": "0.2"}
        code, s, ev = run_race("flake-rerun-cheap", *V2, env=env)
        base.assert_correct(self, code, s)
        reruns = [e for e in of(ev, "preland.check") if e.get("rerun")]
        self.assertEqual([e["latency_s"] for e in reruns], [0.05])   # the emulated latency of the re-run, not 0.2
        self.assertEqual(s["flake"]["config"]["rerun_seconds"], 0.05)

    def test_a_validation_red_twice_is_still_reverted(self) -> None:
        env = {**V2ENV, "FLAKE_RATE": "1", "FLAKE_PURPOSES": "validate", "FLAKE_LIMIT": "2", "FLAKE_POOL": "0",
               "FLAKE_RERUN_VALIDATE": "1"}
        code, s, ev = run_race("flake-validate-twice", *V2_ONE, env=env)
        self.assertEqual(code, 0, s.get("aborted"))
        self.assertEqual([e["outcome"] for e in of(ev, "flake.rerun")], ["confirmed"])
        self.assertEqual(s["flake"]["wrongful_reverts"], 1)        # two flakes in a row: the mitigation has limits


class RacesQueue(unittest.TestCase):
    Q = ("--policy", "queue", "--tasks", "t002", "t003", "t005", "--agents", "3", "--ci-slots", "1", "--batch", "2",
         "--no-queue-hold", *FAST)

    def test_a_flaky_batch_ejects_a_good_pr_needlessly(self) -> None:
        env = {"FLAKE_RATE": "1", "FLAKE_PURPOSES": "batch", "FLAKE_LIMIT": "1", "FLAKE_SEED": "1"}
        code, s, ev = run_race("flake-queue", *self.Q, env=env)
        base.assert_correct(self, code, s)
        fl = s["flake"]
        self.assertEqual((fl["flaked_runs"], fl["queue_needless_ejections"], fl["needless_reworks"]), (1, 1, 1))
        self.assertEqual(of(ev, "flake.rerun"), [])

    def test_retrying_a_red_batch_before_bisecting_absorbs_it(self) -> None:
        env = {"FLAKE_RATE": "1", "FLAKE_PURPOSES": "batch", "FLAKE_LIMIT": "1", "FLAKE_SEED": "1",
               "FLAKE_RETRY_BATCH": "1"}
        code, s, ev = run_race("flake-queue-retry", *self.Q, env=env)
        base.assert_correct(self, code, s)
        fl = s["flake"]
        self.assertEqual((fl["flaked_runs"], fl["needless_reworks"], fl["queue_red_ejections"]), (1, 0, 0))
        self.assertEqual([(e["purpose"], e["outcome"]) for e in of(ev, "flake.rerun")], [("batch", "absorbed")])
        self.assertEqual(s["ci_runs"].get("bisect", 0), 0)          # never bisected
        self.assertEqual(s["queue"]["batch_retries_absorbed"], 1)

    def test_a_real_red_batch_is_retried_then_bisected(self) -> None:
        env = {"FLAKE_RETRY_BATCH": "1", "FLAKE_SEED": "1"}         # no injected flakes: t003 + t004 really break
        code, s, ev = run_race("flake-queue-real", "--policy", "queue", "--tasks", "t003", "t004", "--agents", "2",
                               "--ci-slots", "1", "--batch", "2", "--batch-wait", "5", "--replay-median", "0.3",
                               "--replay-sigma", "0", "--ci-seconds", "0.3", env=env)
        base.assert_correct(self, code, s)
        rr = of(ev, "flake.rerun")
        self.assertEqual([e["outcome"] for e in rr], ["confirmed"])  # a deterministic failure fails again
        self.assertTrue(of(ev, "bisect.start"))


class Driver(unittest.TestCase):
    def test_arm_commands_match_the_brief(self) -> None:
        import drive
        args, env = drive.arm("r05-v2-mitigated")
        for flag in ("--protect-tests", "landed", "--ci-seconds", "60", "--ci-slots", "2", "--agent", "claude",
                     "--model", "sonnet", "--max-wall-minutes", "45", "--agents", "12", "--seed", "7", "--snapshot",
                     "head", "--error-budget", "999", "beanstalk-v2"):
            self.assertIn(flag, args)
        self.assertEqual((env["FLAKE_RATE"], env["PRELAND_MODE"], env["PRELAND_SECONDS"]), ("0.05", "optimistic", "60"))
        self.assertEqual((env["FLAKE_RERUN_PRELAND"], env["FLAKE_RERUN_VALIDATE"]), ("1", "1"))
        _, plain = drive.arm("r02-v2-plain")
        self.assertEqual(plain["FLAKE_RATE"], "0.02")
        self.assertNotIn("FLAKE_RERUN_PRELAND", plain)
        args, env = drive.arm("r05-queue-retry")
        for flag in ("queue", "--batch", "4", "--no-queue-hold", "--protect-tests", "landed"):
            self.assertIn(flag, args)
        self.assertEqual((env["FLAKE_RATE"], env["FLAKE_RETRY_BATCH"]), ("0.05", "1"))
        self.assertNotIn("PRELAND_MODE", env)
        _, targeted = drive.arm("r05-v2-targeted")
        self.assertEqual((targeted["FLAKE_RERUN_SECONDS"], targeted["FLAKE_RERUN_PRELAND"]), ("5", "1"))
        self.assertNotIn("FLAKE_RERUN_SECONDS", env)
        with self.assertRaises(SystemExit):
            drive.arm("r05-nonsense")

    def test_probe_checks(self) -> None:
        import drive
        out = os.path.join(TMP, "probe-out")
        shutil.rmtree(out, ignore_errors=True)
        os.makedirs(out)
        with open(os.path.join(out, "events.jsonl"), "w") as fh:
            fh.write(json.dumps({"type": "race.start"}) + "\n")
        good = {"final": {"correct": True}, "flake": {"flaked_runs": 1, "needless_reworks": 1}, "tasks_green": 1,
                "tasks": 1, "cost_usd": 0.4}
        self.assertTrue(drive.probe_ok(good, out))
        self.assertFalse(drive.probe_ok({**good, "flake": {"flaked_runs": 0, "needless_reworks": 0}}, out))
        self.assertFalse(drive.probe_ok({**good, "cost_usd": 4.0}, out))


class AuthContamination(unittest.TestCase):
    def test_auth_failure_patterns(self) -> None:
        import authcheck
        for text in ("API Error: 403 Request not allowed", "Invalid API key - Please run /login", "401 Unauthorized",
                     "OAuth token has expired", "authentication_error", "Credential rejected"):
            self.assertTrue(authcheck.auth_failure(text), text)
        for text in ("", None, "Reached max turns (40)", "rate limited (five_hour)", "timeout", "exit 1 without a result",
                     "Error: ENOENT: no such file", "node --test: 1 failing test in 4030 ms"):
            self.assertFalse(authcheck.auth_failure(text), text)

    def test_contamination_counts_only_auth_failures_as_fatal(self) -> None:
        import authcheck
        ev = [{"type": "invocation.end", "inv": "a", "is_error": True, "result_text": "API Error: 403 Request not allowed"},
              {"type": "invocation.end", "inv": "b", "infra_error": "Please run /login", "result_text": ""},
              {"type": "invocation.end", "inv": "c", "infra_error": "timeout"},
              {"type": "invocation.end", "inv": "d", "is_error": True, "result_text": "Reached max turns"},
              {"type": "invocation.end", "inv": "e", "is_error": False, "infra_error": None, "result_text": "Done: 403 lines"},
              {"type": "ci.end", "purpose": "validate"}]
        c = authcheck.contamination(ev)
        self.assertEqual((c["auth"], c["infra"], c["errors"]), (["a", "b"], ["c"], ["d"]))
        self.assertEqual(authcheck.contamination([{"type": "invocation.end", "inv": "x", "infra_error": None}]),
                         {"auth": [], "infra": [], "errors": []})        # a null infra_error field is not an error


class DriverFlow(unittest.TestCase):
    """The driver's ledger, spend cap, probe gate and rate-limit handling, with a stub race.py (no agents, no slot)."""

    STUB = r"""
import json, os, sys
args = sys.argv[1:]
out = args[args.index("--out") + 1]
name = os.path.basename(out)
os.makedirs(out, exist_ok=True)
mode = open("mode.txt").read().strip() if os.path.exists("mode.txt") else "ok"
cost = float(os.environ.get("STUB_COST", "1.0"))
events = [{"type": "race.start"}]
if mode == "contaminated":
    events.append({"type": "invocation.end", "inv": "inv0001-initial", "ok": True, "is_error": True, "cost_usd": 0.0,
                   "result_text": "API Error: 403 Request not allowed", "infra_error": None})
    open("mode.txt", "w").write("ok")
s = {"cost_usd": cost, "aborted": None, "tasks_green": 1, "tasks": 1, "final": {"correct": True},
     "flake": {"flaked_runs": 1, "needless_reworks": 1}}
if os.environ.get("STUB_PROBE_FAILS") and name == "e3-probe":
    s["flake"] = {"flaked_runs": 0, "needless_reworks": 0}
code = 0
if mode == "ratelimit" and "-again" not in name:
    s["aborted"] = "rate limited (five_hour, resets at 4102444800): stopping"
    code = 3
    open("mode.txt", "w").write("ok")
json.dump(s, open(os.path.join(out, "summary.json"), "w"))
open(os.path.join(out, "events.jsonl"), "w").write("".join(json.dumps(e) + "\n" for e in events))
sys.exit(code)
"""

    def setUp(self) -> None:
        import drive
        self.drive = drive
        self.dir = os.path.join(TMP, "drive-flow")
        shutil.rmtree(self.dir, ignore_errors=True)
        os.makedirs(os.path.join(self.dir, "runs"))
        with open(os.path.join(self.dir, "race.py"), "w") as fh:
            fh.write(self.STUB)
        for name in ("drive.py", "authcheck.py"):                                          # hold() runs it in the "slot"
            shutil.copy(os.path.join(RACE, name), os.path.join(self.dir, name))
        with open(os.path.join(self.dir, "race_with_uptime.sh"), "w") as fh:
            fh.write('#!/bin/bash\nshift\nif [ "$(cat mode.txt 2>/dev/null)" = auth ]; then echo ok > mode.txt; exit 76; fi\n"$@"\n')
        os.chmod(os.path.join(self.dir, "race_with_uptime.sh"), 0o755)
        self.saved = (drive.HERE, drive.SLOT, drive.LEDGER, drive.RATELIMIT, drive.time.sleep)
        drive.HERE = self.dir
        drive.SLOT = "/usr/bin/env"            # stands in for the slot wrapper: runs its arguments
        drive.LEDGER = os.path.join(self.dir, "runs", "e3-ledger.json")
        drive.RATELIMIT = os.path.join(self.dir, "runs", "e3-ratelimit.json")
        self.slept: list[float] = []
        drive.time.sleep = self.slept.append
        os.chdir(self.dir)

    def tearDown(self) -> None:
        d = self.drive
        d.HERE, d.SLOT, d.LEDGER, d.RATELIMIT, d.time.sleep = self.saved
        os.chdir(RACE)

    def test_arms_run_in_order_and_the_ledger_counts_the_spend(self) -> None:
        self.assertEqual(self.drive.run_arm("probe", 40.0, False, True), 0)       # probe_ok on the stub's summary
        self.assertEqual(self.drive.run_arm("r05-v2-plain", 40.0, False, True), 0)
        self.assertEqual(self.drive.spent(self.drive.ledger()), 2.0)
        self.assertTrue(os.path.isdir(os.path.join(self.dir, "runs", "e3-r05-v2-plain")))
        self.assertEqual(self.drive.run_arm("r05-v2-plain", 40.0, False, True), 0)  # already there: not overwritten
        self.assertEqual(len(self.drive.ledger()), 2)

    def test_the_cap_stops_the_next_race(self) -> None:
        os.environ["STUB_COST"] = "20"
        try:
            self.assertEqual(self.drive.run_arm("r05-v2-plain", 40.0, False, True), 0)
            self.assertEqual(self.drive.run_arm("r05-v2-mitigated", 40.0, False, True), 0)   # $20 left, race may cost 6.5
            self.assertEqual(self.drive.run_arm("r05-queue-retry", 40.0, False, True), 1)    # $0 left: refused
        finally:
            os.environ.pop("STUB_COST", None)
        self.assertFalse(os.path.exists(os.path.join(self.dir, "runs", "e3-r05-queue-retry")))

    def test_a_rate_limit_leaves_the_slot_keeps_the_aborted_run_and_reruns(self) -> None:
        with open("mode.txt", "w") as fh:
            fh.write("ratelimit")
        rc = self.drive.run_arm("r05-v2-plain", 40.0, False, True)
        self.assertEqual(rc, self.drive.RATE_LIMITED)
        self.assertTrue(os.path.isdir(os.path.join(self.dir, "runs", "e3-r05-v2-plain-aborted1")))
        self.assertFalse(os.path.exists(os.path.join(self.dir, "runs", "e3-r05-v2-plain")))
        self.assertEqual(self.drive.spent(self.drive.ledger()), 1.0)                # the partial run's spend counts
        self.assertEqual(self.drive.run_arm("r05-v2-plain", 40.0, False, True), 0)   # after the reset: runs again
        self.assertEqual(self.drive.spent(self.drive.ledger()), 2.0)

    def test_a_race_that_overlapped_an_auth_outage_is_kept_aside_and_rerun(self) -> None:
        with open("mode.txt", "w") as fh:
            fh.write("contaminated")
        rc = self.drive.run_arm("r05-v2-plain", 40.0, False, False)
        self.assertEqual(rc, 0)
        runs = os.path.join(self.dir, "runs")
        self.assertTrue(os.path.isdir(os.path.join(runs, "e3-r05-v2-plain-contaminated1")))
        self.assertTrue(os.path.isdir(os.path.join(runs, "e3-r05-v2-plain")))      # the clean re-run
        ledger = self.drive.ledger()
        self.assertEqual([e["auth_failures"] for e in ledger], [1, 0])
        self.assertEqual(self.drive.spent(ledger), 2.0)                             # both runs count
        self.assertEqual(self.slept, [self.drive.AUTH_WAIT])

    def test_an_unauthenticated_cli_waits_without_spending(self) -> None:
        with open("mode.txt", "w") as fh:
            fh.write("auth")
        rc = self.drive.run_arm("r05-v2-plain", 40.0, False, False)
        self.assertEqual(rc, 0)
        self.assertEqual(self.slept, [self.drive.AUTH_WAIT])                         # asked again after one wait
        self.assertEqual(self.drive.spent(self.drive.ledger()), 1.0)                 # only the real race was paid for
        self.assertEqual(len(self.drive.ledger()), 1)

    def test_in_a_slot_an_auth_failure_hands_the_slot_back(self) -> None:
        with open("mode.txt", "w") as fh:
            fh.write("auth")
        self.assertEqual(self.drive.run_arm("r05-v2-plain", 40.0, False, True), self.drive.AUTH_FAILED)
        self.assertEqual(self.drive.ledger(), [])

    def test_joined_arms_share_one_hold_and_the_probe_gates_the_race(self) -> None:
        import sys as _sys
        argv = _sys.argv
        _sys.argv = ["drive.py", "probe+r05-v2-plain", "r05-v2-mitigated"]
        try:
            self.assertEqual(self.drive.main(), 0)
        finally:
            _sys.argv = argv
        runs = os.path.join(self.dir, "runs")
        for name in ("e3-probe", "e3-r05-v2-plain", "e3-r05-v2-mitigated"):
            self.assertTrue(os.path.isdir(os.path.join(runs, name)), name)
        self.assertEqual([e["run"] for e in self.drive.ledger()], ["e3-probe", "e3-r05-v2-plain", "e3-r05-v2-mitigated"])

    def test_a_failed_probe_stops_its_group_before_the_race(self) -> None:
        import sys as _sys
        with open("probe-fails.txt", "w") as fh:
            fh.write("1")
        argv = _sys.argv
        _sys.argv = ["drive.py", "probe+r05-v2-plain"]
        os.environ["STUB_PROBE_FAILS"] = "1"
        try:
            self.assertNotEqual(self.drive.main(), 0)
        finally:
            _sys.argv = argv
            os.environ.pop("STUB_PROBE_FAILS", None)
        runs = os.path.join(self.dir, "runs")
        self.assertTrue(os.path.isdir(os.path.join(runs, "e3-probe")))
        self.assertFalse(os.path.exists(os.path.join(runs, "e3-r05-v2-plain")))      # never started

    def test_hold_waits_out_an_auth_failure_outside_the_slot_too(self) -> None:
        with open("mode.txt", "w") as fh:
            fh.write("auth")
        self.assertEqual(self.drive.hold(["r05-v2-plain"], 40.0), 0)
        self.assertEqual(self.slept, [self.drive.AUTH_WAIT])
        self.assertTrue(os.path.isdir(os.path.join(self.dir, "runs", "e3-r05-v2-plain")))

    def test_hold_waits_out_the_reset_outside_the_slot(self) -> None:
        with open("mode.txt", "w") as fh:
            fh.write("ratelimit")
        self.assertEqual(self.drive.hold(["r05-v2-plain", "r05-v2-mitigated"], 40.0), 0)
        self.assertTrue(self.slept and self.slept[0] >= 120)                           # slept after the rate limit
        for arm in ("r05-v2-plain", "r05-v2-mitigated"):
            self.assertTrue(os.path.isdir(os.path.join(self.dir, "runs", f"e3-{arm}")))


def two_flakes_on_different_tests(name: str, args: tuple, env: dict, kind: str):
    """Run a race until the first two flaked runs of ``kind`` fail different tests (victims depend on the commit, so try seeds)."""
    for seed in range(1, 9):
        code, s, ev = run_race(name, *args, env={**env, "FLAKE_SEED": str(seed)})
        flaked = [e for e in ev if e.get("flaked") and (e["type"] == "preland.check" if kind == "preland" else
                                                         e["type"] == "ci.end" and e.get("purpose") == kind)]
        if len(flaked) >= 2 and not set(flaked[0]["failing_files"]) & set(flaked[1]["failing_files"]):
            return code, s, ev
    raise AssertionError("no seed gave two flakes on different tests")


class RacesConfirmSame(unittest.TestCase):
    def test_validation_two_different_flakes_are_not_a_confirmation(self) -> None:
        env = {**V2ENV, "FLAKE_RATE": "1", "FLAKE_PURPOSES": "validate", "FLAKE_LIMIT": "2", "FLAKE_POOL": "0",
               "FLAKE_RERUN_VALIDATE": "1", "FLAKE_CONFIRM_SAME": "1"}
        code, s, ev = two_flakes_on_different_tests("flake-confirm-validate", V2_ONE, env, "validate")
        base.assert_correct(self, code, s)                       # the bean stays, the race is correct, nothing was reverted
        fl = s["flake"]
        self.assertEqual((fl["flaked_runs"], fl["wrongful_reverts"], fl["reverts"]), (2, 0, 0))
        rr = of(ev, "flake.rerun")
        self.assertEqual([(e["outcome"], e["inconsistent"]) for e in rr], [("absorbed", True)])
        self.assertEqual(len([e for e in of(ev, "ci.end", purpose="validate") if e.get("rerun")]), 2)   # re-run and third run
        self.assertEqual(s["tasks_green"], s["tasks"])

    def test_the_old_rule_reverts_in_the_same_situation(self) -> None:
        env = {**V2ENV, "FLAKE_RATE": "1", "FLAKE_PURPOSES": "validate", "FLAKE_LIMIT": "2", "FLAKE_POOL": "0",
               "FLAKE_RERUN_VALIDATE": "1"}
        code, s, ev = two_flakes_on_different_tests("flake-confirm-validate-old", V2_ONE, env, "validate")
        self.assertEqual(code, 0, s.get("aborted"))
        self.assertEqual([(e["outcome"], e["inconsistent"]) for e in of(ev, "flake.rerun")], [("confirmed", False)])
        self.assertEqual((s["flake"]["wrongful_reverts"], s["tasks_dropped"]), (1, 1))     # E3 race 2 in miniature

    def test_validation_the_same_test_twice_is_still_confirmed(self) -> None:
        env = {**V2ENV, "FLAKE_RATE": "1", "FLAKE_PURPOSES": "validate", "FLAKE_LIMIT": "2", "FLAKE_POOL": "1",
               "FLAKE_RERUN_VALIDATE": "1", "FLAKE_CONFIRM_SAME": "1"}
        code, s, ev = run_race("flake-confirm-validate-same", *V2_ONE, env=env)
        self.assertEqual(code, 0, s.get("aborted"))
        self.assertEqual([(e["outcome"], e["inconsistent"]) for e in of(ev, "flake.rerun")], [("confirmed", False)])
        self.assertEqual(s["flake"]["wrongful_reverts"], 1)       # one flaky test failing twice cannot be told from a real red

    def test_preland_two_different_flakes_do_not_send_the_bean_back(self) -> None:
        env = {**V2ENV, "FLAKE_RATE": "1", "FLAKE_PURPOSES": "preland", "FLAKE_LIMIT": "2", "FLAKE_POOL": "0",
               "FLAKE_RERUN_PRELAND": "1", "FLAKE_CONFIRM_SAME": "1"}
        code, s, ev = two_flakes_on_different_tests("flake-confirm-preland", V2_ONE, env, "preland")
        base.assert_correct(self, code, s)
        self.assertEqual((s["flake"]["flaked_runs"], s["flake"]["needless_reworks"]), (2, 0))
        self.assertEqual([(e["outcome"], e["inconsistent"]) for e in of(ev, "flake.rerun")], [("absorbed", True)])

    def test_queue_two_different_flakes_do_not_bisect(self) -> None:
        env = {"FLAKE_RATE": "1", "FLAKE_PURPOSES": "batch", "FLAKE_LIMIT": "2", "FLAKE_POOL": "0",
               "FLAKE_RETRY_BATCH": "1", "FLAKE_CONFIRM_SAME": "1"}
        args = ("--policy", "queue", "--tasks", "t002", "--agents", "1", "--ci-slots", "1", "--batch", "1", "--no-queue-hold", *FAST)
        code, s, ev = two_flakes_on_different_tests("flake-confirm-queue", args, env, "batch")
        base.assert_correct(self, code, s)
        self.assertEqual([(e["outcome"], e["inconsistent"]) for e in of(ev, "flake.rerun")], [("absorbed", True)])
        self.assertEqual(s["flake"]["queue_red_ejections"], 0)
        self.assertEqual(s["ci_runs"].get("bisect", 0), 0)


class ZKthGreen(unittest.TestCase):
    """Named to run after the races (unittest orders classes alphabetically)."""
    def test_table_has_the_flake_columns(self) -> None:
        run = os.path.join(RACE, "runs", "_test-flake-validate")
        if not os.path.exists(os.path.join(run, "events.jsonl")):
            self.skipTest("needs the flake-validate race from RacesV2")
        buf = io.StringIO()
        with redirect_stdout(buf):
            import kth_green
            old = sys.argv
            sys.argv = ["kth_green.py", run, "--k", "1", "2"]
            try:
                kth_green.main()
            finally:
                sys.argv = old
        out = buf.getvalue()
        self.assertIn("wrongful reverts", out)
        self.assertIn("1/1", out)           # one wrongful revert of one revert

    def test_flake_report_reads_the_ground_truth(self) -> None:
        run = os.path.join(RACE, "runs", "_test-flake-validate")
        if not os.path.exists(os.path.join(run, "events.jsonl")):
            self.skipTest("needs the flake-validate race from RacesV2")
        import flake_report
        a = flake_report.analyse(run)
        self.assertEqual((a["flaked_runs"], a["wrongful_reverts"], a["reverts"]), (1, 1, 1))
        self.assertEqual(a["flaked_by_purpose"], {"validate": 1})
        self.assertEqual(a["flake_reds"], {"validate": 1})
        self.assertEqual(a["real_reds"], {})
        self.assertIn("wrongful reverts/reverts", flake_report.md([a]))


if __name__ == "__main__":
    unittest.main()
