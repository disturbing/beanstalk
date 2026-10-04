"""E6 decision cards: oracles, the card board, and replay races on the real arena's coupled tasks (free).

Run from exp/e6-decisions/race through the machine-wide race slot (the replay races run node):
  ../../../tools/race-slot.sh python3 -m unittest tests.test_decisions -v
``E6_FAST=1`` runs only the tests that start no race.
"""
from __future__ import annotations

import asyncio
import contextlib
import io
import json
import os
import socket
import sys
import threading
import time
import unittest
import urllib.request

TESTS = os.path.dirname(os.path.abspath(__file__))
RACE = os.path.dirname(TESTS)
sys.path.insert(0, RACE)

import race  # noqa: E402
from harness.arena import load_tasks  # noqa: E402
from harness.cards import CardBoard, render_card  # noqa: E402
from harness.decisions import (Decision, DecisionTable, heuristic_changer, oracle_choice, outcome_for,  # noqa: E402
                               reexec_prompt, start_context)

ARENA = os.path.normpath(os.path.join(RACE, "..", "arena"))
REPO = os.path.normpath(os.path.join(RACE, "..", "corpora", "arena.git"))
TABLE = os.path.normpath(os.path.join(RACE, "..", "decisions", "table.json"))
BASE_ENV = {"PRELAND_MODE": "optimistic", "PRELAND_SECONDS": "0.2", "DECISION_SECONDS": "0.1",
            "DECISION_MODE": "oracle", "COUPLING_PRIOR": "arena", "SPEC_AMEND": "1", "RESCUE": "1",
            "CARD_AFTER": "1", "CARD_AFTER_KNOWN": "0", "DECISION_ORACLE": "landed"}
COMMON = ["--policy", "beanstalk-e6", "--agent", "replay", "--ci-seconds", "0.2", "--ci-slots", "1",
          "--replay-median", "0.3", "--replay-sigma", "0", "--snapshot", "head", "--error-budget", "999",
          "--protect-tests", "landed"]
RUNS: list[str] = []
FAST = os.environ.get("E6_FAST") == "1"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def run_race(name: str, *args: str, env: dict | None = None) -> tuple[int, dict, list[dict]]:
    out = os.path.join(RACE, "runs", f"_test-e6-{name}")
    argv = ["--arena", ARENA, "--repo", REPO, "--out", out, "--force", *COMMON, *args]
    saved = dict(os.environ)
    os.environ.update(BASE_ENV)
    os.environ.update(env or {})
    try:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            code = race.main(argv)
    finally:
        os.environ.clear()
        os.environ.update(saved)
    RUNS.append(out)
    with open(os.path.join(out, "summary.json")) as fh:
        summary = json.load(fh)
    with open(os.path.join(out, "events.jsonl")) as fh:
        events = [json.loads(line) for line in fh]
    return code, summary, events


def of(events: list[dict], typ: str, **match) -> list[dict]:
    return [e for e in events if e["type"] == typ and all(e.get(k) == v for k, v in match.items())]


def tasks(*ids: str):
    return {t.id: t for t in load_tasks(ARENA, list(ids), app_prefix=True)}


class Oracles(unittest.TestCase):
    def setUp(self) -> None:
        self.table = DecisionTable.load(TABLE)
        self.t = tasks("t005", "t023", "t028", "t032", "t033", "t036", "t011", "t018")

    def test_table_documents_every_designed_coupling_with_its_contract_side(self) -> None:
        designed = {}
        for t in load_tasks(ARENA, None, app_prefix=True):
            for c in t.couplings:
                if c.get("type") == "semantic":
                    designed[tuple(sorted((t.id, c["with"])))] = True
        self.assertEqual(len(designed), 5)
        contracts = {("t002", "t022"): "t002", ("t005", "t031"): "t005", ("t011", "t018"): "t011",
                     ("t023", "t036"): "t023", ("t028", "t032"): "t032"}
        for pair in designed:
            e = self.table.get(*pair)
            self.assertIsNotNone(e, pair)
            self.assertEqual(e.source, "designed")
            self.assertEqual(e.contract, contracts[pair])
            for tid in pair:
                self.assertTrue(e.specs.get(tid), (pair, tid))
                self.assertTrue(e.texts.get(tid), (pair, tid))

    def test_landed_oracle_always_keeps_the_landed_bean(self) -> None:
        w, changer = oracle_choice("landed", landed=self.t["t036"], arriving=self.t["t023"],
                                   entry=self.table.get("t023", "t036"), failing_files=[])
        self.assertEqual((w, changer), ("t036", "t023"))

    def test_contract_oracle_picks_the_contract_changer(self) -> None:
        e = self.table.get("t028", "t032")
        w, _ = oracle_choice("contract", landed=self.t["t028"], arriving=self.t["t032"], entry=e, failing_files=[])
        self.assertEqual(w, "t032")
        self.assertEqual(outcome_for(w, "t028", e), "adopt-arriving")
        w, _ = oracle_choice("contract", landed=self.t["t023"], arriving=self.t["t036"],
                             entry=self.table.get("t023", "t036"), failing_files=[])
        self.assertEqual(w, "t023")
        self.assertEqual(outcome_for(w, "t023", self.table.get("t023", "t036")), "keep-landed")

    def test_contract_heuristic_for_unknown_pairs(self) -> None:
        landed, arriving = self.t["t005"], self.t["t032"]
        self.assertEqual(heuristic_changer(landed, arriving, ["src/orders/confirmation-grouping.test.ts"]), "t032")
        self.assertEqual(heuristic_changer(landed, arriving, ["src/orders/total-with-shipping.test.ts"]), "t005")
        self.assertIsNone(heuristic_changer(landed, arriving, ["src/other.test.ts"]))
        w, changer = oracle_choice("contract", landed=landed, arriving=arriving, entry=None,
                                   failing_files=["src/orders/confirmation-grouping.test.ts"])
        self.assertEqual((w, changer), ("t032", "t032"))
        self.assertEqual(outcome_for(w, "t005", None), "adopt-arriving")

    def test_table_oracle_can_keep_both_contracts(self) -> None:
        e = self.table.get("t028", "t032")
        w, _ = oracle_choice("table", landed=self.t["t028"], arriving=self.t["t032"], entry=e, failing_files=[])
        self.assertEqual(w, "t028")
        self.assertEqual(outcome_for(w, "t032", e), "keep-landed")  # t028 wins, nothing is reverted
        # adaptable couplings never revert, whoever wins
        self.assertEqual(outcome_for("t011", "t018", self.table.get("t011", "t018")), "keep-landed")

    def test_prompts_carry_the_decision_and_the_winner(self) -> None:
        d = Decision(card="D001", pair=("t023", "t036"), trigger="preland", landed="t023", arriving="t036", known=True,
                     source="designed", specs={}, failing=[], requested_at=0.0, mode="oracle", winner="t023",
                     loser="t036", outcome="keep-landed", text="Refund the tax charged on the line.")
        ctx = {"task": "t023", "title": "Tax", "intent": "Round once per rate.", "diff": "+applyRateToTotal"}
        p = reexec_prompt(self.t["t036"], d, ctx, "keep-landed", ["src/billing/line-refunds.test.ts"])
        for needle in ("D001", "Refund the tax charged on the line.", "+applyRateToTotal", "earlier attempt was "
                       "discarded", "amended by the test author", self.t["t036"].prompt.strip()[:40]):
            self.assertIn(needle, p)
        d2 = Decision(**{**d.__dict__, "winner": "t036", "loser": "t023", "outcome": "adopt-arriving"})
        self.assertIn("your spec wins", start_context(self.t["t036"], d2, None, []))


class Carried(unittest.TestCase):
    def test_in_place_amendments_ride_with_the_winner_and_roll_back_if_it_drops(self) -> None:
        import tempfile
        from harness.core import RaceConfig, TaskState
        from harness.policy_beanstalk_e6 import BeanstalkE6Race
        race = BeanstalkE6Race(RaceConfig(out=os.path.join(tempfile.mkdtemp(), "run")))
        t = tasks("t028", "t032")
        loser, winner = TaskState(task=t["t028"]), TaskState(task=t["t032"])
        race.by_id = {"t028": loser, "t032": winner}
        path = "src/shipping/signature.test.ts"
        old = loser.task.acceptance_tests[path]
        loser.task.acceptance_tests[path] = "amended"
        race.carried["t032"] = {path: ("t028", "amended", old)}
        wt = tempfile.mkdtemp()
        self.assertEqual(race.write_carried(winner, wt), [path])   # a fresh fork gets the carried test
        with open(os.path.join(wt, path)) as fh:
            self.assertEqual(fh.read(), "amended")
        self.assertEqual(race.write_carried(winner, wt), [])       # unchanged: nothing to restore
        race.log = lambda *a, **k: None
        race.release = lambda *a, **k: None
        race.drop(winner, "test")
        self.assertEqual(loser.task.acceptance_tests[path], old)  # the winner never landed: amendment undone
        self.assertNotIn("t032", race.carried)


class Board(unittest.TestCase):
    def test_click_resolves_the_card_and_timeout_falls_back(self) -> None:
        async def scenario() -> tuple[dict | None, dict | None, str, str]:
            board = CardBoard(free_port())
            board.start()
            view = {"card": "D001", "landed": "t023", "arriving": "t036", "trigger": "preland", "known": True,
                    "source": "designed", "specs": {"t023": "spread tax", "t036": "identical refunds"},
                    "titles": {}, "diffs": {"t023": "+a", "t036": "+b"}, "failing": ["x > y"], "output": "",
                    "recommended": "t023", "oracle": "table", "note": ""}

            def click() -> None:
                for _ in range(100):
                    cards = json.load(urllib.request.urlopen(board.index_url() + "api/cards"))
                    if cards and cards[0]["status"] == "open":
                        break
                    time.sleep(0.05)
                req = urllib.request.Request(board.url("D001"), data=b"choice=adopt-arriving&text=third+line",
                                             headers={"Content-Type": "application/x-www-form-urlencoded"})
                urllib.request.urlopen(req).read()
            th = threading.Thread(target=click)
            th.start()
            ans = await board.ask(view, timeout=10)
            th.join()
            html_page = urllib.request.urlopen(board.url("D001")).read().decode()
            index = urllib.request.urlopen(board.index_url()).read().decode()
            late = await board.ask({**view, "card": "D002"}, timeout=0.3)
            board.stop()
            return ans, late, html_page, index
        ans, late, html_page, index = asyncio.run(scenario())
        self.assertEqual(ans["choice"], "adopt-arriving")
        self.assertEqual(ans["text"], "third line")
        self.assertIsNone(late)
        self.assertIn("identical refunds", html_page)
        self.assertIn("D001", index)

    def test_card_page_shows_both_specs_failing_tests_and_both_diffs(self) -> None:
        c = {"card": "D007", "landed": "t005", "arriving": "t032", "trigger": "preland", "known": False,
             "source": "natural", "specs": {"t005": "grouped amounts", "t032": "total with shipping"},
             "titles": {"t005": "A", "t032": "B"}, "diffs": {"t005": "+group", "t032": "+shipping"},
             "failing": ["src/orders/confirmation-grouping.test.ts > leaves small orders unchanged"],
             "output": "", "recommended": "t032", "oracle": "contract", "status": "open", "seconds_left": 30}
        page = render_card(c).decode()
        for needle in ("grouped amounts", "total with shipping", "leaves small orders unchanged", "+group",
                       "+shipping", "Keep landed", "Adopt arriving"):
            self.assertIn(needle, page)


@unittest.skipIf(FAST, "E6_FAST=1")
class ReplayRaces(unittest.TestCase):
    def assert_shipped(self, code: int, s: dict, ids: list[str]) -> None:
        self.assertEqual(code, 0, s.get("aborted"))
        for tid in ids:
            self.assertEqual(s["per_task"][tid]["status"], "green", (tid, s["per_task"][tid]))
        self.assertTrue(s["final"]["suite_green"])
        self.assertTrue(s["final"]["correct"])
        self.assertEqual(s["final"]["canonical_failures_unexplained"], [])

    def test_keep_landed_amends_and_reexecutes_the_arriving_bean(self) -> None:
        code, s, ev = run_race("keep", "--tasks", "t023", "t036", "--agents", "2",
                               env={"REPLAY_DELAYS": "t023=0.2,t036=3"})
        self.assert_shipped(code, s, ["t023", "t036"])
        req = of(ev, "decision.request")
        self.assertEqual(len(req), 1)
        self.assertEqual((req[0]["arriving"], req[0]["landed"], req[0]["trigger"]), ("t036", "t023", "preland"))
        made = of(ev, "decision.made")[0]
        self.assertEqual((made["winner"], made["loser"], made["outcome"]), ("t023", "t036", "keep-landed"))
        amend = of(ev, "spec.amend", task="t036")
        self.assertTrue(amend)
        self.assertEqual(amend[0]["fail_first"]["failing_files"], ["src/billing/line-refunds.test.ts"])
        self.assertTrue(of(ev, "reexec.start", task="t036", reason="keep-landed"))
        self.assertFalse(s["final"]["correct_canonical"])
        self.assertEqual(s["final"]["canonical_failures_explained"], ["t036"])
        self.assertEqual(s["beanstalk"]["losers_shipped"], 1)
        with open(os.path.join(RACE, "runs", "_test-e6-keep", "decisions.jsonl")) as fh:
            rec = [json.loads(line) for line in fh]
        self.assertEqual(rec[0]["amendments"][0]["status"], "amended")
        self.assertTrue(rec[0]["reexecutions"])

    def test_contract_wins_reverts_the_landed_bean_and_reexecutes_it(self) -> None:
        code, s, ev = run_race("adopt", "--tasks", "t028", "t032", "--agents", "2",
                               env={"REPLAY_DELAYS": "t028=0.2,t032=1.5", "DECISION_ORACLE": "contract"})
        self.assert_shipped(code, s, ["t028", "t032"])
        made = of(ev, "decision.made")[0]
        self.assertEqual((made["winner"], made["loser"], made["outcome"]), ("t032", "t028", "adopt-arriving"))
        rev = of(ev, "revert", task="t028")
        self.assertTrue(rev)
        land32 = [e for e in of(ev, "land", task="t032")]
        self.assertTrue(land32 and land32[0]["seq"] > rev[0]["seq"])
        requeue = of(ev, "task.requeue", task="t028")
        self.assertTrue(requeue and requeue[0]["seq"] > land32[0]["seq"])  # the loser waits for the winner
        self.assertTrue(of(ev, "spec.amend", task="t028"))
        self.assertTrue(of(ev, "reexec.start", task="t028", reason="adopt-arriving"))
        self.assertEqual(s["final"]["canonical_failures_explained"], ["t028"])

    def test_start_card_decides_before_the_bean_runs(self) -> None:
        code, s, ev = run_race("start", "--tasks", "t023", "t036", "--agents", "1",
                               env={"CARD_AFTER_KNOWN": "-1"})
        self.assert_shipped(code, s, ["t023", "t036"])
        req = of(ev, "decision.request")[0]
        self.assertEqual(req["trigger"], "start")
        amend = of(ev, "spec.amend", task="t036")[0]
        start = of(ev, "task.start", task="t036")[0]
        self.assertLess(amend["seq"], start["seq"])
        self.assertFalse(of(ev, "rework.start", task="t036"))
        self.assertFalse([e for e in of(ev, "preland.check", task="t036") if not e["green"]])

    def test_table_oracle_keeps_both_contracts_without_amendments(self) -> None:
        code, s, ev = run_race("table", "--tasks", "t028", "t032", "--agents", "2",
                               env={"REPLAY_DELAYS": "t028=0.2,t032=1.5", "DECISION_ORACLE": "table"})
        self.assert_shipped(code, s, ["t028", "t032"])
        made = of(ev, "decision.made")[0]
        self.assertEqual((made["winner"], made["outcome"]), ("t028", "keep-landed"))
        self.assertTrue(of(ev, "spec.amend.none", task="t032"))
        self.assertFalse(of(ev, "revert"))
        self.assertTrue(s["final"]["correct_canonical"])

    def test_human_click_decides_the_card(self) -> None:
        port = free_port()
        clicked: dict = {}

        def click() -> None:
            deadline = time.time() + 120
            while time.time() < deadline:
                try:
                    cards = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/api/cards", timeout=2))
                except OSError:
                    time.sleep(0.2)
                    continue
                open_ = [c for c in cards if c["status"] == "open"]
                if open_:
                    req = urllib.request.Request(f"http://127.0.0.1:{port}/card/{open_[0]['card']}",
                                                 data=json.dumps({"choice": "keep-landed",
                                                                  "text": "Refund the tax charged on the line."}
                                                                 ).encode(),
                                                 headers={"Content-Type": "application/json",
                                                          "Accept": "application/json"})
                    clicked.update(json.load(urllib.request.urlopen(req, timeout=5)))
                    return
                time.sleep(0.2)
        th = threading.Thread(target=click, daemon=True)
        th.start()
        code, s, ev = run_race("human", "--tasks", "t023", "t036", "--agents", "1",
                               env={"CARD_AFTER_KNOWN": "-1", "DECISION_MODE": "human", "HUMAN_PORT": str(port),
                                    "HUMAN_TIMEOUT": "90", "HUMAN_FALLBACK": "contract"})
        th.join(timeout=5)
        self.assertEqual(clicked.get("result"), "decided")
        self.assert_shipped(code, s, ["t023", "t036"])
        made = of(ev, "decision.made")[0]
        self.assertEqual(made["mode"], "human")
        self.assertTrue(made["custom_text"])
        self.assertEqual(made["text"], "Refund the tax charged on the line.")
        self.assertTrue(of(ev, "decision.request")[0]["url"].startswith(f"http://127.0.0.1:{port}/card/"))

    def test_human_timeout_falls_back_to_the_oracle(self) -> None:
        code, s, ev = run_race("human-timeout", "--tasks", "t023", "t036", "--agents", "1",
                               env={"CARD_AFTER_KNOWN": "-1", "DECISION_MODE": "human",
                                    "HUMAN_PORT": str(free_port()), "HUMAN_TIMEOUT": "0.5",
                                    "HUMAN_FALLBACK": "contract"})
        self.assert_shipped(code, s, ["t023", "t036"])
        made = of(ev, "decision.made")[0]
        self.assertEqual((made["mode"], made["winner"], made["oracle"]), ("human-timeout", "t023", "contract"))

    def test_red_validation_reverts_and_reexecutes_instead_of_dropping(self) -> None:
        # t032 and t033 touch disjoint files and are not a declared pair: the optimistic landing lets the second
        # land unchecked, the validator goes red, revert-first reverts the culprit, which is re-executed; its
        # pre-land check then meets t032 and the contract oracle decides (t033 changes the shipping contract)
        code, s, ev = run_race("validation", "--tasks", "t032", "t033", "--agents", "2",
                               env={"REPLAY_DELAYS": "t032=0.2,t033=1.0", "PRELAND_SECONDS": "2.5",
                                    "DECISION_ORACLE": "contract"})
        self.assert_shipped(code, s, ["t032", "t033"])
        self.assertGreaterEqual(s["red_validations"], 1)
        self.assertTrue(of(ev, "revert"))
        self.assertFalse(of(ev, "task.drop"))
        self.assertTrue(of(ev, "task.requeue"))
        made = of(ev, "decision.made")
        self.assertTrue(made)
        self.assertEqual(made[0]["winner"], "t033")

    def test_revert_cascade_is_detected_and_adopted_in_place(self) -> None:
        # t031 is decided at start against t005 (grouped amounts, amended); t032 then meets t005 on the email total
        # (a natural pair) and wins under the contract oracle. The candidate "sprout minus t005, plus t032" fails
        # t031's amended tests, so nothing is reverted: t005's tests are amended in place and land with t032.
        code, s, ev = run_race("cascade", "--tasks", "t005", "t031", "t032", "--agents", "1",
                               env={"CARD_AFTER_KNOWN": "-1", "DECISION_ORACLE": "contract"})
        self.assert_shipped(code, s, ["t005", "t031", "t032"])
        start = of(ev, "decision.request", trigger="start")
        self.assertEqual([(e["arriving"], e["landed"]) for e in start], [("t031", "t005")])
        self.assertTrue(of(ev, "decision.made", winner="t032"))
        cascade = of(ev, "decision.cascade", loser="t005")
        self.assertTrue(cascade)
        self.assertEqual(cascade[0]["broken"], ["t031"])
        self.assertFalse(of(ev, "revert"))          # the sprout never held the revert
        self.assertEqual(s["red_validations"], 0)
        inplace = [e for e in of(ev, "spec.amend", task="t005") if e.get("in_place")]
        self.assertTrue(inplace)
        self.assertEqual(sorted(s["final"]["canonical_failures_explained"]), ["t005", "t031"])

    def test_dynamic_culprit_finds_the_contract_change_without_the_prior(self) -> None:
        # no declared couplings: t036's own test fails because t023 landed before t036's check; v2's static guess
        # cannot name it, coverage + blame + a leave-one-out probe does, and the card follows
        code, s, ev = run_race("dynamic", "--tasks", "t023", "t036", "--agents", "2",
                               env={"REPLAY_DELAYS": "t023=0.2,t036=3", "COUPLING_PRIOR": "none"})
        self.assert_shipped(code, s, ["t023", "t036"])
        dyn = of(ev, "culprit.dynamic", task="t036")
        self.assertTrue(dyn)
        self.assertEqual([c["task"] for c in dyn[0]["confirmed"]], ["t023"])
        reworks = of(ev, "rework.start", task="t036")
        self.assertTrue(reworks and reworks[0]["culprits"] == ["t023"])
        req = of(ev, "decision.request")[0]
        self.assertFalse(req["known"])
        self.assertEqual((req["arriving"], req["landed"]), ("t036", "t023"))

    def test_decline_oracle_reproduces_v2(self) -> None:
        code, s, ev = run_race("decline", "--tasks", "t023", "t036", "--agents", "2",
                               env={"REPLAY_DELAYS": "t023=0.2,t036=1.5", "DECISION_ORACLE": "decline"})
        self.assertEqual(code, 0)
        self.assertEqual(s["per_task"]["t036"]["status"], "dropped")
        self.assertIn("declined by decision", s["per_task"]["t036"]["drop_reason"])
        self.assertFalse(of(ev, "reexec.start"))

    def test_rescue_reexecutes_once_when_the_rework_budget_runs_out(self) -> None:
        code, s, ev = run_race("rescue", "--tasks", "t009", "t030", "--agents", "2", "--max-rework", "0",
                               env={"REPLAY_DELAYS": "t009=0.2,t030=0.3"})
        self.assert_shipped(code, s, ["t009", "t030"])
        self.assertTrue(of(ev, "rescue.start"))
        self.assertTrue(of(ev, "reexec.start", reason="rescue"))

    @classmethod
    def tearDownClass(cls) -> None:
        for run in RUNS:  # every events.jsonl produced here is well formed
            with open(os.path.join(run, "events.jsonl")) as fh:
                events = [json.loads(line) for line in fh]
            assert [e["seq"] for e in events] == list(range(1, len(events) + 1)), run
            assert events[0]["type"] == "race.setup", run
            assert events[-1]["type"] == "final.check", run
            starts = {e["inv"] for e in events if e["type"] == "invocation.start"}
            ends = {e["inv"] for e in events if e["type"] == "invocation.end"}
            assert starts == ends, run


if __name__ == "__main__":
    unittest.main()
