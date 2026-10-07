"""harness/start_order.py: the port of the engine's dependency-aware start order (v2-start-order.ts)."""
from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from harness.start_order import STALL_SECONDS, TaskView, age_bound, choose_start  # noqa: E402


def views(spec: dict[str, list[str]], partners: dict[str, list[str]] | None = None) -> dict[str, TaskView]:
    partners = partners or {}
    return {tid: TaskView(tid, mods, partners.get(tid, [])) for tid, mods in spec.items()}


class StartOrder(unittest.TestCase):
    def test_fifo_is_the_head(self) -> None:
        tv = views({"a": ["x"], "b": ["y"]})
        self.assertEqual(choose_start(["a", "b"], ["a", "b"], tv, 4, 0, "fifo").task, "a")

    def test_clear_task_skips_one_that_clashes_with_work_in_flight(self) -> None:
        tv = views({"a": ["m"], "b": ["m"], "c": ["n"], "d": ["o"], "e": ["p"], "f": ["q"], "g": ["r"]})
        tv["a"].status, tv["a"].started_at = "running", 0.0
        c = choose_start(list(tv), ["b", "c", "d", "e", "f", "g"], tv, 4, 10.0)
        self.assertEqual((c.kind, c.task, c.rule), ("start", "c", "critical-path"))
        self.assertEqual(c.skipped, ["b"])

    def test_waits_for_a_landing_then_stalls(self) -> None:
        fillers = [f"x{i}" for i in range(9)]  # m in 4 of 13 tasks: under a third, so not a hub
        tv = views({"a": ["m"], "b": ["m"], "c": ["m"], "d": ["m"], **{x: [f"u{x}"] for x in fillers}})
        for t, at in (("a", 0.0), ("b", 5.0), ("c", 10.0)):
            tv[t].status, tv[t].started_at = "running", at
        for t in fillers:
            tv[t].status, tv[t].started_at = "green", 0.0
        order = ["a", "b", "c", "d", *fillers]
        c = choose_start(order, ["d"], tv, 4, 20.0)
        self.assertEqual((c.kind, c.wake_at), ("wait", 10.0 + STALL_SECONDS))
        c = choose_start(order, ["d"], tv, 4, 10.0 + STALL_SECONDS)
        self.assertEqual((c.task, c.rule), ("d", "stalled"))

    def test_coupling_is_a_clash_and_hubs_are_ignored(self) -> None:
        tv = views({"a": ["src", "m"], "b": ["src", "n"], "c": ["src", "o"]}, partners={"c": ["a"]})
        tv["a"].status, tv["a"].started_at = "running", 0.0
        c = choose_start(["a", "b", "c"], ["b", "c"], tv, 4, 1.0)
        self.assertEqual(c.task, "b")          # src is in every task: a hub, not a clash
        c = choose_start(["a", "b", "c"], ["c"], tv, 4, 1.0)
        self.assertEqual(c.rule, "least-overlap")  # c is coupled to a (in flight): one clash, still startable

    def test_age_bound(self) -> None:
        self.assertEqual(age_bound(4, 38), 4)
        self.assertEqual(age_bound(30, 40), 10)
        self.assertEqual(age_bound(8, 3), 1)


if __name__ == "__main__":
    unittest.main()
