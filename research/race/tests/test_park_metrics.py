"""Parked beans in the race metrics: kth_green.py's tail columns and summary.md's parked row."""
from __future__ import annotations

import os
import sys
import unittest

TESTS = os.path.dirname(os.path.abspath(__file__))
RACE = os.path.dirname(TESTS)
sys.path.insert(0, RACE)

import kth_green  # noqa: E402
from harness import remote  # noqa: E402
from harness.summary import to_markdown  # noqa: E402


def event(t: float, kind: str, **fields) -> dict:
    return {"t": t, "type": kind, **fields}


EVENTS = [
    event(0, "task.start", task="t001"),
    event(60, "task.start", task="t002"),
    event(120, "task.start", task="t003"),
    event(300, "green.promote", tasks=["t001"]),
    event(400, "task.start", task="t002"),  # a later start (a start card's) does not reset the clock
    event(660, "green.promote", tasks=["t002"]),
    event(700, "task.parked", task="t003", reason="needs a person: two specs disagree (t001)"),
]


class KthGreenTest(unittest.TestCase):
    def test_start_to_green_uses_each_shipped_task_first_start(self) -> None:
        greens = kth_green.green_times(EVENTS)
        median, p90 = kth_green.start_to_green(EVENTS, greens)
        self.assertEqual([task for _, task in greens], ["t001", "t002"])
        self.assertAlmostEqual(median, 7.5)  # 5 and 10 minutes
        self.assertAlmostEqual(p90, 9.5)

    def test_a_parked_bean_is_counted_but_not_shipped(self) -> None:
        self.assertEqual(kth_green.parked_count(EVENTS, {}), 1)
        self.assertEqual(kth_green.parked_count([], {"parked": [{"task": "t003", "reason": "x"}]}), 1)
        self.assertNotIn("t003", [task for _, task in kth_green.green_times(EVENTS)])

    def test_percentile_of_nothing_is_none(self) -> None:
        self.assertIsNone(kth_green.percentile([], 0.5))


class SummaryParkedRowTest(unittest.TestCase):
    def summary(self, **extra) -> dict:
        return {
            "policy": "beanstalk", "agent": "replay", "label": "x", "aborted": None, "config": {},
            "changes_green_per_hour": 1, "tasks_green": 2, "tasks_landed": 2, "tasks_dropped": 0, "tasks": 3,
            "drops_by_reason": {}, "wall_seconds": 720, "wall_to_all_green_seconds": None,
            "task_start_to_green_seconds": {"median": 450, "p90": 570},
            "agent_minutes": {"busy": 1, "blocked": 0, "idle": 0}, "invocations": {}, "cost_usd": 0,
            "cost_by_kind": {}, "ci_runs_total": 0, "ci_minutes_total": 0, "ci_runs": {}, "textual_conflicts": 0,
            "red_validations": 0, "final": {}, "acceptance_restored": {"own": 0, "other_tasks": 0},
            "footprint_quality": {}, "per_task": {}, **extra,
        }

    def test_lists_parked_beans_with_their_reasons(self) -> None:
        md = to_markdown(self.summary(parked=[{"task": "t003", "reason": "needs a person: two specs disagree (t001)"}]))
        self.assertIn("| Parked, needs a person | t003 (needs a person: two specs disagree (t001)) |", md)

    def test_runs_without_parking_have_no_row(self) -> None:
        self.assertNotIn("Parked", to_markdown(self.summary()))


class DriverKnobTest(unittest.TestCase):
    def test_park_is_passed_from_the_environment(self) -> None:
        self.assertEqual(remote.V22_ENV["park"], ("PARK", bool))
        self.assertEqual(remote.V22_ENV["red_reset"], ("RED_RESET", bool))
        self.assertEqual(remote.V22_ENV["episode_tickets"], ("EPISODE_TICKETS", bool))
        self.assertEqual(remote.V22_ENV["repair_landing"], ("REPAIR_LANDING", bool))


if __name__ == "__main__":
    unittest.main()
