"""The race metrics' clocks and counters: kth_green.py's milestones on the race.start clock, and report.py's open reds
(a ticket is open from ticket.open until ticket.close, through escalations and an unrevertable culprit)."""
from __future__ import annotations

import csv
import json
import os
import shutil
import subprocess
import sys
import unittest

TESTS = os.path.dirname(os.path.abspath(__file__))
RACE = os.path.dirname(TESTS)
sys.path.insert(0, RACE)

import kth_green  # noqa: E402
import report  # noqa: E402

TMP = os.path.join(TESTS, "tmp", "race-metrics")


def event(t: float, kind: str, **fields) -> dict:
    return {"t": t, "type": kind, **fields}


def write_run(name: str, events: list[dict], summary: dict | None = None) -> str:
    run = os.path.join(TMP, name)
    shutil.rmtree(run, ignore_errors=True)
    os.makedirs(run)
    with open(os.path.join(run, "events.jsonl"), "w", encoding="utf-8") as fh:
        fh.write("".join(json.dumps({"seq": i + 1, **e}) + "\n" for i, e in enumerate(events)))
    if summary is not None:
        with open(os.path.join(run, "summary.json"), "w", encoding="utf-8") as fh:
            json.dump(summary, fh)
    return run


class KthGreenClock(unittest.TestCase):
    EVENTS = [event(0, "race.setup"), event(12, "race.start"), event(30, "task.start", task="t001"),
              event(72, "green.promote", tasks=["t001"]), event(132, "green.promote", tasks=["t002"])]

    def test_race_start_is_the_zero_and_defaults_to_the_log_start(self) -> None:
        self.assertEqual(kth_green.race_start(self.EVENTS), 12.0)
        self.assertEqual(kth_green.race_start([event(5, "task.start", task="t001")]), 0.0)

    def test_milestones_count_from_race_start_unless_the_raw_clock_is_asked(self) -> None:
        run = write_run("kth-clock", self.EVENTS, {"policy": "beanstalk", "wall_seconds": 150,
                                                   "config": {"agents": 2}})

        def row(*flags: str) -> list[str]:
            out = subprocess.run([sys.executable, "-I", os.path.join(RACE, "kth_green.py"), run, "--k", "1", "2",
                                  *flags], capture_output=True, text=True, check=True).stdout
            return [c.strip() for c in out.splitlines()[2].strip("|").split("|")]

        self.assertEqual(row()[4:7], ["1.0 / 0.00", "2.0 / 0.00", "0.7 / 0.7"])
        self.assertEqual(row("--raw-clock")[4:7], ["1.2 / 0.00", "2.2 / 0.00", "0.7 / 0.7"])
        self.assertEqual(row()[7], "2.0")  # last green, on the race.start clock (start to green is clock-free)


class OpenReds(unittest.TestCase):
    def open_reds(self, events: list[dict]) -> list[tuple[str, int]]:
        run = write_run("open-reds", [event(0, "race.start"), *events])
        dest = os.path.join(run, "timeline.csv")
        report.timeline(run, dest)
        with open(dest, encoding="utf-8") as fh:
            rows = list(csv.DictReader(fh))
        return [(r["event"], int(r["open_reds"])) for r in rows[1:]]

    def test_an_escalated_or_stuck_ticket_stays_open_until_it_closes(self) -> None:
        got = self.open_reds([
            event(1, "ticket.open", ticket="R001", failing=["a.test.ts"], method="read-set"),
            event(2, "ticket.escalate", ticket="R001", why="revert-first", attempts=0),
            event(3, "ticket.bisect", ticket="R002", failing=["b.test.ts"]),
            event(4, "ticket.open", ticket="R002", failing=["b.test.ts"], method="bisect"),
            event(5, "ticket.escalate", ticket="R002", why="revert-first", attempts=0),
            event(6, "ticket.stuck", ticket="R001", culprit_idx=7),
            event(7, "ticket.close", ticket="R002", how="reverted"),
            event(8, "ticket.close", ticket="R001", how="green"),
            event(9, "ticket.close", ticket="R001", how="green"),
        ])
        self.assertEqual(got, [("ticket.open", 1), ("ticket.escalate", 1), ("ticket.bisect", 2), ("ticket.open", 2),
                               ("ticket.escalate", 2), ("ticket.stuck", 2), ("ticket.close", 1), ("ticket.close", 0),
                               ("ticket.close", 0)])


if __name__ == "__main__":
    unittest.main()
