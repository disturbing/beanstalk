"""The load generator (``loadgen/``) against fakes: ``tests/fake_github.py`` and ``tests/fake_beanstalk.py``.

Run from research/race: ``python3 -m unittest tests.test_loadgen`` (no network, no cost).
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

from fake_beanstalk import FakeBeanstalk  # noqa: E402
from fake_github import FakeGitHub  # noqa: E402
from loadgen import run as lg  # noqa: E402
from loadgen.beanstalk import HELPER, TOKEN_ENV, BeanstalkClient, parse_push  # noqa: E402
from loadgen.schedule import Schedule, fit, recorded_pushes  # noqa: E402

FIXTURE = os.path.join(TESTS, "fixtures", "arena")
TMP = os.path.join(TESTS, "tmp")
REPO = os.path.join(TMP, "fixture-arena-lg.git")
TRANSCRIPT = os.path.join(RACE, "..", "..", "docs", "claude-opus", "exp", "git-native", "staging-transcript.txt")
FAST = ["--arena", FIXTURE, "--repo", REPO, "--time-scale", "0.002", "--fit-runs", "--gh-poll", "0.1",
        "--gh-push-interval", "0", "--final-in", "local"]


def setUpModule() -> None:
    os.makedirs(TMP, exist_ok=True)
    subprocess.run([sys.executable, os.path.join(FIXTURE, "materialize.py"), "--out", REPO], check=True,
                   capture_output=True)


def run_lg(name: str, forge: str, *args: str, fake=None) -> tuple[int, dict, list[dict], object]:
    out = os.path.join(RACE, "runs", f"_test-lg-{name}")
    if os.path.exists(out):
        shutil.rmtree(out)
    if forge == "github":
        fake = fake or FakeGitHub(os.path.join(TMP, f"lg-gh-{name}"))
        if os.path.exists(fake.root) and not fake.exists:
            shutil.rmtree(fake.root)
        lg.GITHUB_CLIENT_FACTORY = lambda: fake
    else:
        fake = fake or FakeBeanstalk(os.path.join(TMP, f"lg-bs-{name}"))
        lg.BEANSTALK_CLIENT_FACTORY = lambda: fake
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            code = lg.main(["--forge", forge, "--out", out, *FAST, *args])
    finally:
        lg.GITHUB_CLIENT_FACTORY = lg.BEANSTALK_CLIENT_FACTORY = None
    with open(os.path.join(out, "summary.json")) as fh:
        summary = json.load(fh)
    with open(os.path.join(out, "events.jsonl")) as fh:
        events = [json.loads(line) for line in fh]
    return code, summary, events, fake


def of(events: list[dict], typ: str, **match) -> list[dict]:
    return [e for e in events if e["type"] == typ and all(e.get(k) == v for k, v in match.items())]


class LoadgenRuns(unittest.TestCase):
    def check_common(self, s: dict, ev: list[dict]) -> None:
        self.assertIsNone(s["aborted"])
        self.assertEqual(s["tasks"], 5)
        self.assertGreaterEqual(s["tasks_green"], 4)
        self.assertTrue(of(ev, "race.start"))
        for c in s["per_change"]:
            if c["status"] == "integrated":
                self.assertIsNotNone(c["ready_s"])
                self.assertGreaterEqual(c["integrated_s"], c["ready_s"])
        self.assertEqual(s["ready_to_integrated_s"]["n"], s["tasks_green"])
        # kth_green reads the run
        sys.path.insert(0, RACE)
        import kth_green
        greens = kth_green.green_times(ev)
        self.assertEqual(len(greens), s["tasks_green"])
        self.assertIn("correct", s["final"])

    def test_beanstalk_closed_loop(self) -> None:
        code, s, ev, fake = run_lg("bs-closed", "beanstalk", "--workers", "3", "--seed", "7")
        self.assertEqual(code, 0)
        self.check_common(s, ev)
        self.assertEqual(s["policy"], "beanstalk-git")
        self.assertEqual(s["ready_to_stable_s"]["n"], s["tasks_green"])
        # the seed bean landed first, every change was pushed as bean/<task>
        refs = fake.git("for-each-ref", "--format=%(refname)", "refs/heads/bean/")
        self.assertIn("refs/heads/bean/seed", refs)
        self.assertIn("refs/heads/bean/t001", refs)
        # the conflicting pair (t001/t002, CHANGELOG with t005) was reacted to: re-made on the new sprout
        rx = s["reactions"]
        self.assertGreaterEqual(rx.get("conflict", 0) + rx.get("red", 0), 1)
        self.assertGreaterEqual(rx.get("rebase", 0), 1)
        self.assertTrue(fake.closed)
        self.assertGreater(s["ci_minutes"], 0)

    def test_github_closed_loop(self) -> None:
        code, s, ev, fake = run_lg("gh-closed", "github", "--workers", "3", "--seed", "7")
        self.assertEqual(code, 0)
        self.check_common(s, ev)
        self.assertEqual(s["policy"], "github-queue")
        self.assertIn("put_ruleset", fake.calls)
        self.assertIn("enqueue", fake.calls)
        self.assertEqual(s["enqueue_to_merged_s"]["n"], s["tasks_green"])
        self.assertEqual(fake.ruleset["rules"][0]["parameters"]["max_entries_to_build"], 2)
        merged = of(ev, "land", target="main")
        self.assertEqual(len(merged), s["tasks_green"])

    def test_open_loop_chain_mode(self) -> None:
        code, s, ev, _ = run_lg("bs-open", "beanstalk", "--workers", "2", "--schedule", "open", "--rate", "600",
                                "--mode", "chain")
        self.assertEqual(code, 0)
        self.check_common(s, ev)
        self.assertEqual(s["config"]["schedule"]["kind"], "open")

    def test_recorded_schedule(self) -> None:
        rec = os.path.join(TMP, "recorded-run")
        os.makedirs(rec, exist_ok=True)
        with open(os.path.join(rec, "events.jsonl"), "w") as fh:
            for i, (task, t, agent) in enumerate([("t001", 10, "a0"), ("t002", 12, "a1"), ("t003", 30, "a0"),
                                                  ("t004", 31, "a1"), ("t005", 50, "a0")]):
                fh.write(json.dumps({"seq": i, "t": t + 5, "type": "task.commit", "task": task, "agent": agent}) + "\n")
            fh.write(json.dumps({"seq": 99, "t": 5, "type": "race.start"}) + "\n")
        pushes, _ = recorded_pushes(rec)
        self.assertEqual([p.task for p in pushes], ["t001", "t002", "t003", "t004", "t005"])
        self.assertEqual(pushes[0].at, 10)
        code, s, ev, _ = run_lg("gh-rec", "github", "--workers", "2", "--schedule", "recorded", "--record", rec)
        self.assertEqual(code, 0)
        self.check_common(s, ev)
        workers = {c["task"]: c["worker"] for c in s["per_change"]}
        self.assertEqual(workers["t001"], workers["t003"])


class LoadgenUnits(unittest.TestCase):
    def test_orchestrated_source(self) -> None:
        run = os.path.join(TMP, "orch-run")
        os.makedirs(run, exist_ok=True)
        with open(os.path.join(run, "events.jsonl"), "w") as fh:
            fh.write(json.dumps({"seq": 1, "t": 0, "type": "race.start", "ts": "2026-10-07T10:48:38.805+00:00"}) + "\n")
        t0 = 1791370118.805
        changes = [{"id": "#2", "task": "t002", "created_at": t0 + 62, "ready_at": t0 + 120, "extra": {"branch": "b"}},
                   {"id": "#1", "task": "t001", "created_at": t0 + 51, "ready_at": t0 + 100, "extra": {"branch": "a"}},
                   {"id": "#3", "task": "t001", "created_at": t0 + 400, "ready_at": t0 + 420, "extra": {"branch": "a"}}]
        with open(os.path.join(run, "summary.json"), "w") as fh:
            json.dump({"changes": changes}, fh)
        from loadgen.schedule import orchestrated_pushes
        pushes, _ = orchestrated_pushes(run)
        self.assertEqual([(p.task, round(p.at), p.agent) for p in pushes], [("t001", 51, "a"), ("t002", 62, "b")])
        s = Schedule("orchestrated", 7, recorded=pushes, speed=2.0)
        self.assertEqual([(round(at, 1), t, w) for at, t, w in s.arrivals(["t001", "t002"])],
                         [(25.5, "t001", 0), (31.0, "t002", 1)])

    def test_parse_staging_transcript(self) -> None:
        with open(TRANSCRIPT, encoding="utf-8") as fh:
            text = fh.read()
        blocks = text.split("\n$ ")
        verdicts = []
        for b in blocks:
            if b.startswith("git push"):
                lines = [(float(i), ln) for i, ln in enumerate(b.splitlines())]
                verdicts.append(parse_push(lines, 0.0, 0))
        kinds = [v.kind for v in verdicts]
        self.assertEqual(kinds, ["landed", "landed", "red", "refused", "landed"])
        self.assertEqual(verdicts[0].landed_sha, "182d6c1")
        self.assertEqual(verdicts[0].check_seconds, 5.1)
        self.assertIsNotNone(verdicts[0].validated_at)
        self.assertEqual(verdicts[2].failing, ["test/discount.test.js > a 10% discount on 100 is 90"])

    def test_parse_conflict_and_timeout(self) -> None:
        v = parse_push([(1.0, "remote: beanstalk: CONFLICT: x does not merge onto the sprout. Conflicts in: "
                              "lib/a.js, lib/b.js        ")], 0.0, 0)
        self.assertEqual((v.kind, v.conflicts), ("conflict", ["lib/a.js", "lib/b.js"]))
        v = parse_push([(1.0, "remote: beanstalk: new bean x received at abc: \"t\"")], 0.0, 0)
        self.assertEqual(v.kind, "timeout")

    def test_token_never_in_argv(self) -> None:
        c = BeanstalkClient("https://gw.invalid", "admin-secret", "loadgen", "r1")
        c._git_token = "git-secret"
        env = c.git_env()
        self.assertEqual(env[TOKEN_ENV], "git-secret")
        self.assertNotIn("git-secret", HELPER)
        self.assertNotIn("git-secret", c.url)
        self.assertNotIn("admin-secret", json.dumps(env))

    def test_fit_and_draws_are_seeded(self) -> None:
        think, fix = fit([os.path.join(RACE, "runs", "pair-fastify-codex-4-s7-github"),
                          os.path.join(RACE, "runs", "pair-fastify-codex-4-s7-beanstalk")])
        self.assertGreater(think.n, 50)
        self.assertTrue(60 < think.median < 140, think)
        self.assertTrue(40 < fix.median < 100, fix)
        a, b = Schedule("closed", 7, think, fix), Schedule("closed", 7, think, fix)
        self.assertEqual(a.think_seconds("t001"), b.think_seconds("t001"))
        self.assertNotEqual(a.think_seconds("t001"), Schedule("closed", 11, think, fix).think_seconds("t001"))
        arr = Schedule("open", 7, rate_per_min=6, poisson=False).arrivals(["t1", "t2", "t3"])
        self.assertEqual([round(x[0]) for x in arr], [0, 10, 20])


if __name__ == "__main__":
    unittest.main()
