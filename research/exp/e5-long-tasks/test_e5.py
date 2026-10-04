#!/usr/bin/env python3
"""Fast checks for the E5 code (no agents, no network): python3 test_e5.py  (about 2 s).

  * overlap.py: interval arithmetic, pair overlap, flagging statistics, on hand-made beans;
  * the emulated-drift rule in race/harness/core.py;
  * scripts/check_run.py: CLEAN / CONTAMINATED (the 403 outage shape) / RATE_LIMITED / BUDGET on synthetic runs;
  * the compound arena: every task once, members union = acceptance union, no designed coupling inside a compound,
    every compound has a patch, couplings are re-targeted at compounds.
The expensive proofs (acceptance fails on base, solution passes the suite, designed couplings hold between compounds)
are validate_long.py's job.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "race"))
sys.path.insert(0, os.path.join(HERE, "scripts"))

import overlap as o  # noqa: E402
from check_run import check  # noqa: E402


def bean(task, start, first_end, author_end, land, hold, write=None):
    b = o.Bean(task=task, start=start, first_end=first_end, author_end=author_end, land=land)
    b.active = [(start, author_end)]
    b.hold = {f: [(t, author_end)] for f, t in hold.items()}
    b.write = {f: [(t, author_end)] for f, t in (write or {}).items()}
    return b


class OverlapMath(unittest.TestCase):
    def test_sweep(self):
        multi, peak, any_ = o.sweep([(2, 10), (5, 12), (31, 36)])
        self.assertEqual((multi, peak, any_), (5.0, 2, 15.0))

    def test_pair_overlap_hold_and_write(self):
        a = bean("A", 0, 8, 10, 20, {"src/x.ts": 2.0, "src/a.ts": 1.0}, {"src/x.ts": 6.0})
        b = bean("B", 4, 10, 12, 25, {"src/x.ts": 5.0}, {"src/x.ts": 9.0})
        self.assertEqual(o.pair_overlap(a, b), (5.0, ["src/x.ts"]))
        self.assertEqual(o.pair_overlap(a, b, writes=True), (1.0, ["src/x.ts"]))
        c = bean("C", 30, 35, 36, 40, {"src/x.ts": 31.0})
        self.assertEqual(o.pair_overlap(a, c), (0.0, []))
        self.assertEqual(o.active_overlap(a, b), 6.0)

    def test_tests_and_changelog_do_not_count_as_source(self):
        self.assertEqual(o.src(["CHANGELOG.md", "src/a.test.ts", "src/a.ts", "README.md"]), ["src/a.ts", "README.md"])

    def test_flagging_statistics(self):
        a = bean("A", 0, 8, 10, 20, {"src/x.ts": 2.0})
        b = bean("B", 4, 10, 12, 25, {"src/x.ts": 5.0})
        c = bean("C", 30, 35, 36, 40, {"src/y.ts": 31.0})
        st = o.flag_stats({"A": a, "B": b, "C": c}, [{"kind": "conflict", "task": "B", "other": "A"}])
        self.assertEqual(st["hold_overlap"]["flagged"], 1)
        self.assertEqual(st["hold_overlap"]["precision"], 1.0)
        self.assertEqual(st["hold_overlap"]["recall"], 1.0)
        self.assertEqual(st["hold_overlap"]["clean_pairs_flagged"], 0.0)


class DriftRule(unittest.TestCase):
    def test_drift_delay(self):
        import harness.core as core
        from harness.agents import InvocationResult, InvocationSpec

        class R(core.Race):  # only drift_delay is exercised
            def __init__(self, cfg):
                self.cfg = cfg

        def spec(kind):
            return InvocationSpec(inv_id="i", kind=kind, task_id="t", agent_id="a", cwd="/", prompt="")

        res = InvocationResult(inv_id="i", adapter="claude", model="sonnet", wall_ms=20000)
        r = R(core.RaceConfig(drift_factor=7.0, agent="claude"))
        self.assertAlmostEqual(r.drift_delay(spec("initial"), res), 120.0)
        self.assertAlmostEqual(r.drift_delay(spec("rework"), res), 120.0)
        self.assertEqual(r.drift_delay(spec("classifier"), res), 0.0)
        bad = InvocationResult(inv_id="i", adapter="claude", model="sonnet", wall_ms=20000, infra_error="x")
        self.assertEqual(r.drift_delay(spec("initial"), bad), 0.0)
        self.assertEqual(R(core.RaceConfig(agent="claude")).drift_delay(spec("initial"), res), 0.0)       # off by default
        both = R(core.RaceConfig(drift_factor=2.0, drift_seconds=5.0, agent="claude"))
        self.assertAlmostEqual(both.drift_delay(spec("initial"), res), 25.0)


class RunVerdicts(unittest.TestCase):
    def run_dir(self, events, summary, transcripts=None):
        d = tempfile.mkdtemp(prefix="e5-test-")
        base = [{"seq": 1, "t": 0, "ts": "2026-10-03T07:00:00+00:00", "type": "race.start"}]
        end = [{"seq": 99, "t": 20, "ts": "2026-10-03T07:00:20+00:00", "type": "race.end"}]
        with open(os.path.join(d, "events.jsonl"), "w") as fh:
            fh.write("\n".join(json.dumps(e) for e in base + events + end) + "\n")
        with open(os.path.join(d, "summary.json"), "w") as fh:
            json.dump(summary, fh)
        if transcripts:
            os.makedirs(os.path.join(d, "work", "transcripts"))
            for name, lines in transcripts.items():
                with open(os.path.join(d, "work", "transcripts", name), "w") as fh:
                    fh.write("\n".join(json.dumps(x) for x in lines) + "\n")
        return d

    def test_clean_ignores_null_infra_error_and_agent_text(self):
        ev = [{"seq": 2, "t": 5, "ts": "2026-10-03T07:00:05+00:00", "type": "invocation.end", "inv": "i1", "kind": "initial",
               "task": "L01", "is_error": False, "infra_error": None, "result_text": "handled the 403 case"}]
        tr = {"i1.jsonl": [{"type": "assistant", "message": {"content": [{"type": "text", "text": "returns 403 when not allowed"}]}},
                           {"type": "result", "is_error": False, "api_error_status": None}]}
        self.assertEqual(check(self.run_dir(ev, {"cost_usd": 1.0, "tasks": 16}, tr))["verdict"], "CLEAN")

    def test_outage_shapes(self):
        ev = [{"seq": 2, "t": 5, "ts": "2026-10-03T07:00:05+00:00", "type": "invocation.end", "inv": "i1", "kind": "initial",
               "task": "L01", "is_error": True, "infra_error": None,
               "result_text": "Failed to authenticate. API Error: 403 Request not allowed"}]
        self.assertEqual(check(self.run_dir(ev, {"cost_usd": 0.1, "tasks": 16}))["verdict"], "CONTAMINATED")
        tr = {"i1.jsonl": [{"type": "assistant", "error": "authentication_failed", "is_api_error_message": True,
                            "message": {"content": [{"type": "text", "text": "Failed to authenticate"}]}},
                           {"type": "result", "is_error": True, "api_error_status": 403}]}
        self.assertEqual(check(self.run_dir([], {"cost_usd": 0.1, "tasks": 16}, tr))["verdict"], "CONTAMINATED")

    def test_aborts(self):
        r = check(self.run_dir([], {"aborted": "rate limited (five_hour, resets at 1791020400): stopping", "tasks": 16}))
        self.assertEqual((r["verdict"], r["resets_at"]), ("RATE_LIMITED", 1791020400))
        self.assertEqual(check(self.run_dir([], {"aborted": "budget: $20.01 of $20.00", "tasks": 16}))["verdict"], "BUDGET")
        self.assertEqual(check(self.run_dir([], {"aborted": "wall-clock limit of 60 minutes", "tasks": 16}))["verdict"], "WALL")


class ReleaseVariant(unittest.TestCase):
    """v2r (E5 extra): agents are released while a change is checked; reworks get agents first."""

    def make(self, n):
        import harness.core as core
        from harness.policy_beanstalk_v2r import BeanstalkV2ReleaseRace
        r = BeanstalkV2ReleaseRace(core.RaceConfig(policy="beanstalk", agent="replay", agents=n))
        r.agents = [core.AgentSlot(id=f"a{i}") for i in range(n)]
        r.log = lambda *a, **k: {}
        return r

    def test_gate_reserves_free_agents_for_waiting_reworks(self):
        r = self.make(2)
        self.assertIsNotNone(r.free_agent())
        r.rework_waiters = 2
        self.assertIsNone(r.free_agent())
        r.rework_waiters = 1
        self.assertIsNotNone(r.free_agent())          # 2 free > 1 waiting: a new task may start
        r.hold(r.agents[0], "L01")
        self.assertIsNone(r.free_agent())             # 1 free, 1 waiting: keep it for the rework

    def test_acquire_waits_for_a_release_and_release_is_owner_checked(self):
        import asyncio
        import types
        r = self.make(1)
        ts = types.SimpleNamespace(id="L02")
        r.hold(r.agents[0], "L01")

        async def go():
            t = asyncio.create_task(r.acquire_agent(ts))
            await asyncio.sleep(0.5)
            assert not t.done() and r.rework_waiters == 1
            r.release("a0")
            return await asyncio.wait_for(t, 3)

        a = asyncio.run(go())
        self.assertEqual((a.id, a.holding, r.rework_waiters), ("a0", "L02", 0))
        r.release_held(a, types.SimpleNamespace(id="L01"))    # not the holder: must not clear L02's hold
        self.assertEqual(a.holding, "L02")
        r.release_held(a, ts)
        self.assertIsNone(a.holding)


class CompoundArena(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.long = {os.path.splitext(n)[0]: json.load(open(os.path.join(HERE, "arena-long", "tasks", n)))
                    for n in sorted(os.listdir(os.path.join(HERE, "arena-long", "tasks"))) if n.endswith(".json")}
        cls.single = {os.path.splitext(n)[0]: json.load(open(os.path.join(HERE, "arena", "tasks", n)))
                      for n in sorted(os.listdir(os.path.join(HERE, "arena", "tasks"))) if n.endswith(".json")}

    def test_every_task_exactly_once(self):
        members = [m for t in self.long.values() for m in t["members"]]
        self.assertEqual(sorted(members), sorted(self.single))

    def test_acceptance_is_the_union_of_unchanged_member_tests(self):
        for gid, t in self.long.items():
            union = {}
            for m in t["members"]:
                union.update(self.single[m]["acceptance_tests"])
            self.assertEqual(t["acceptance_tests"], union, gid)

    def test_no_designed_coupling_inside_a_compound_and_all_retargeted(self):
        owner = {m: gid for gid, t in self.long.items() for m in t["members"]}
        want = set()
        for tid, t in self.single.items():
            for c in t["couplings"]:
                self.assertNotEqual(owner[tid], owner[c["with"]], f"{tid}/{c['with']} share a compound")
                want.add((owner[tid], owner[c["with"]], c["type"]))
        got = {(gid, c["with"], c["type"]) for gid, t in self.long.items() for c in t["couplings"]}
        self.assertEqual(want, got)

    def test_patches_exist_and_touch_no_tests(self):
        for gid in self.long:
            text = open(os.path.join(HERE, "arena-long", "solutions", f"{gid}.patch")).read()
            self.assertIn("diff --git", text)
            self.assertNotIn(".test.ts", "".join(l for l in text.splitlines() if l.startswith("diff --git")))


if __name__ == "__main__":
    unittest.main(verbosity=1)
