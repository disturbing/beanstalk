"""Race harness tests: fixture arena, replay agents and a fake ``claude`` CLI (no network, no cost).

Run from research/race: ``python3 -m unittest discover -s tests``.
"""
from __future__ import annotations

import asyncio
import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import time
import unittest

TESTS = os.path.dirname(os.path.abspath(__file__))
RACE = os.path.dirname(TESTS)
sys.path.insert(0, RACE)

import race  # noqa: E402
from harness.agents import ClaudeAdapter, InvocationSpec, claude_price, usage_cost  # noqa: E402
from harness.arena import (import_closure, import_depths, list_files, load_tasks, module_of,  # noqa: E402
                           placement_modules, stack_files)
from harness.ci import parse_junit  # noqa: E402
from harness.footprint import ModuleCatalog, lexical_predict, select  # noqa: E402
from harness.gitops import union_resolve  # noqa: E402
from harness.procs import Runner, Sandbox, SandboxError  # noqa: E402

FIXTURE = os.path.join(TESTS, "fixtures", "arena")
TMP = os.path.join(TESTS, "tmp")
REPO = os.path.join(TMP, "fixture-arena.git")
FAKE = os.path.join(TESTS, "fake_claude.py")
FAST = ["--replay-median", "0.3", "--replay-sigma", "0.3", "--ci-seconds", "0.3"]
RUNS: list[str] = []  # every run directory produced here, for the event checks


def setUpModule() -> None:
    os.makedirs(TMP, exist_ok=True)
    subprocess.run([sys.executable, os.path.join(FIXTURE, "materialize.py"), "--out", REPO], check=True,
                   capture_output=True)


def run_race(name: str, *args: str, env: dict | None = None) -> tuple[int, dict, list[dict]]:
    out = os.path.join(RACE, "runs", f"_test-{name}")
    argv = ["--arena", FIXTURE, "--repo", REPO, "--out", out, "--force", *args]
    saved = dict(os.environ)
    if env:
        os.environ.update(env)
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


def assert_correct(tc: unittest.TestCase, code: int, s: dict) -> None:
    tc.assertEqual(code, 0, s.get("aborted"))
    tc.assertIsNone(s["aborted"])
    tc.assertEqual(s["tasks_green"], s["tasks"])
    tc.assertTrue(s["final"]["suite_green"])
    tc.assertTrue(s["final"]["correct"])
    tc.assertTrue(s["final"]["all_tasks_accepted"])
    for key in ("changes_green_per_hour", "wall_to_all_green_seconds", "agent_minutes", "invocations", "cost_usd",
                "ci_runs_total", "ci_minutes_total", "textual_conflicts", "red_validations", "footprint_quality",
                "tokens_by_kind", "cost_by_kind"):
        tc.assertIn(key, s)


class QueuePolicy(unittest.TestCase):
    def test_completes_correctly(self) -> None:
        code, s, ev = run_race("queue", "--policy", "queue", "--agents", "3", "--ci-slots", "2", "--batch", "3", *FAST)
        assert_correct(self, code, s)
        self.assertEqual(s["policy"], "queue")
        self.assertGreater(s["ci_runs"].get("batch", 0), 0)
        self.assertEqual(len(of(ev, "land")), 5)

    def test_textual_conflict_is_reworked_and_requeued(self) -> None:
        code, s, ev = run_race("queue-conflict", "--policy", "queue", "--tasks", "t001", "t002", "--agents", "2",
                               "--ci-slots", "1", "--batch", "2", *FAST)
        assert_correct(self, code, s)
        ejected = of(ev, "queue.eject", reason="conflict")
        self.assertTrue(ejected, "one of the two route tasks must conflict with main")
        tid = ejected[0]["task"]
        later = [e for e in ev if e["seq"] > ejected[0]["seq"] and e.get("task") == tid]
        kinds = [e["type"] for e in later]
        self.assertIn("rework.start", kinds)
        self.assertIn("queue.enqueue", kinds)
        self.assertLess(kinds.index("rework.start"), kinds.index("queue.enqueue"))
        self.assertIn("land", kinds)
        self.assertGreaterEqual(s["textual_conflicts"], 1)
        self.assertGreaterEqual(s["invocations"].get("rework", 0), 1)

    def test_red_batch_is_bisected(self) -> None:
        code, s, ev = run_race("queue-bisect", "--policy", "queue", "--tasks", "t003", "t004", "--agents", "2",
                               "--ci-slots", "1", "--batch", "2", "--batch-wait", "5", "--replay-median", "0.3",
                               "--replay-sigma", "0", "--ci-seconds", "0.3")
        assert_correct(self, code, s)
        red = of(ev, "batch.red")
        self.assertTrue(red)
        self.assertEqual(sorted(red[0]["tasks"]), ["t003", "t004"])
        start, end = of(ev, "bisect.start"), of(ev, "bisect.end")
        self.assertTrue(start and end)
        culprit = end[0]["culprit"]
        self.assertEqual(len(end[0]["landed"]), 1)  # the green prefix lands
        self.assertTrue(of(ev, "queue.eject", task=culprit, reason="red"))
        self.assertTrue(of(ev, "rework.start", task=culprit, reason="red"))
        self.assertGreaterEqual(s["ci_runs"].get("bisect", 0), 1)
        self.assertGreaterEqual(s["red_validations"], 1)

    def test_release_mode_frees_agents_while_queued(self) -> None:
        code, s, _ = run_race("queue-release", "--policy", "queue", "--no-queue-hold", "--agents", "2",
                              "--ci-slots", "1", "--batch", "2", *FAST)
        assert_correct(self, code, s)
        self.assertFalse(s["config"]["queue_hold"])


class BeanstalkPolicy(unittest.TestCase):
    def test_completes_correctly(self) -> None:
        code, s, ev = run_race("beanstalk", "--policy", "beanstalk", "--agents", "3", "--ci-slots", "2", *FAST)
        assert_correct(self, code, s)
        self.assertEqual(s["policy"], "beanstalk")
        self.assertEqual(len(of(ev, "placement.decision")), 5)
        self.assertTrue(of(ev, "green.promote"))
        self.assertIn("vs_actual", s["footprint_quality"])
        self.assertEqual(s["beanstalk"]["open_tickets_at_end"], 0)

    def test_textual_conflict_is_reexecuted_on_new_head(self) -> None:
        code, s, ev = run_race("bs-conflict", "--policy", "beanstalk", "--tasks", "t001", "t002", "--agents", "2",
                               *FAST)
        assert_correct(self, code, s)
        conflicts = [e for e in of(ev, "merge.conflict") if e.get("task")]
        self.assertTrue(conflicts)
        tid = conflicts[0]["task"]
        self.assertTrue(of(ev, "rework.start", task=tid, reason="conflict"))
        lands = of(ev, "land", task=tid)
        self.assertTrue(lands and lands[0]["seq"] > conflicts[0]["seq"])

    def test_union_driver_dissolves_changelog_conflicts(self) -> None:
        code, s, ev = run_race("bs-union", "--policy", "beanstalk", "--tasks", "t001", "t005", "--agents", "2", *FAST)
        assert_correct(self, code, s)
        self.assertEqual(s["textual_conflicts"], 0)
        code, s, ev = run_race("q-nounion", "--policy", "queue", "--tasks", "t001", "t005", "--agents", "2",
                               "--batch", "2", "--batch-wait", "5", "--replay-sigma", "0", "--replay-median", "0.3",
                               "--ci-seconds", "0.3")
        assert_correct(self, code, s)
        self.assertGreaterEqual(s["textual_conflicts"], 1)  # same pair, no union driver in the queue preset

    def test_red_trunk_dispatches_fixer(self) -> None:
        code, s, ev = run_race("bs-fixer", "--policy", "beanstalk", "--tasks", "t003", "t004", "--agents", "2",
                               *FAST)
        assert_correct(self, code, s)
        opened = of(ev, "ticket.open")
        self.assertTrue(opened)
        t = opened[0]
        self.assertIn("test/acceptance/t004.test.ts", t["failing"])
        involved = {x["task"] for x in t["suspects"]} | {x["task"] for x in t.get("concurrent", [])}
        self.assertTrue(involved & {"t003", "t004"})
        self.assertTrue(of(ev, "fixer.dispatch", ticket=t["ticket"]))
        self.assertTrue([e for e in of(ev, "invocation.end") if e["kind"] == "fixer"])
        self.assertTrue(of(ev, "land", kind="fixer"))
        self.assertTrue(of(ev, "ticket.close", ticket=t["ticket"]))
        self.assertGreaterEqual(s["invocations"].get("fixer", 0), 1)
        self.assertGreaterEqual(s["red_validations"], 1)

    def test_error_budget_pauses_new_starts(self) -> None:
        code, s, ev = run_race("bs-budget0", "--policy", "beanstalk", "--tasks", "t003", "t004", "t005",
                               "--agents", "2", "--error-budget", "0", *FAST)
        assert_correct(self, code, s)
        pauses = of(ev, "budget.pause")
        if pauses:  # t005 may already have started before the red appears; when paused, no start until resume
            p = pauses[0]
            resume = next(e for e in of(ev, "budget.resume") if e["seq"] > p["seq"])
            starts = [e for e in of(ev, "task.start") if p["seq"] < e["seq"] < resume["seq"]]
            self.assertEqual(starts, [])


class BudgetAndSafety(unittest.TestCase):
    def test_budget_abort_is_clean(self) -> None:
        code, s, ev = run_race("budget", "--policy", "beanstalk", "--agents", "2", "--replay-cost-usd", "1.0",
                               "--budget-usd", "2.5", *FAST)
        self.assertEqual(code, 2)
        self.assertTrue(s["aborted"].startswith("budget"))
        self.assertLess(s["tasks_green"], 5)
        starts = of(ev, "invocation.start")
        self.assertLessEqual(len(starts), 4)  # two in flight when the cap is crossed, nothing after
        spent = 0.0
        for e in ev:  # every start happened while the committed spend was under the cap
            if e["type"] == "invocation.end":
                spent = e["spent_usd"]
            if e["type"] == "invocation.start":
                self.assertLess(spent, 2.5)
        self.assertEqual(of(ev, "race.end")[0]["aborted"], s["aborted"])
        self.assertTrue(of(ev, "final.check"))
        self.assertTrue(os.path.exists(os.path.join(RACE, "runs", "_test-budget", "summary.md")))

    def test_inflight_cost_estimate_aborts_and_kills_agent(self) -> None:
        state = os.path.join(TMP, "fake-expensive")
        shutil.rmtree(state, ignore_errors=True)
        t0 = time.monotonic()
        code, s, ev = run_race("budget-inflight", "--policy", "beanstalk", "--agent", "claude", "--claude-bin", FAKE,
                               "--tasks", "t005", "--agents", "1", "--budget-usd", "1.0", "--agent-timeout", "60",
                               env={"FAKE_CLAUDE_MODE": "expensive", "FAKE_CLAUDE_STATE": state,
                                    "FAKE_CLAUDE_ARENA": FIXTURE})
        self.assertLess(time.monotonic() - t0, 45, "the hanging agent must be killed, not waited for")
        self.assertEqual(code, 2)
        self.assertIn("mid-invocation", s["aborted"])
        self.assertEqual(of(ev, "invocation.end")[0]["cost_source"], "estimated")
        for name in os.listdir(state):
            if name.startswith("pid-"):
                with self.assertRaises(ProcessLookupError):
                    os.kill(int(name[4:]), 0)

    def test_agent_timeout_kills_process_tree(self) -> None:
        state = os.path.join(TMP, "fake-hang")
        shutil.rmtree(state, ignore_errors=True)
        work = os.path.join(TMP, "adapter-work")
        os.makedirs(work, exist_ok=True)
        ad = ClaudeAdapter(Runner(Sandbox(work)), model="haiku", max_turns=3, timeout=1.5, binary=FAKE,
                           transcripts=os.path.join(work, "transcripts"))
        os.environ.update(FAKE_CLAUDE_MODE="hang", FAKE_CLAUDE_STATE=state)
        try:
            res = asyncio.run(ad.run(InvocationSpec(inv_id="hang", kind="initial", task_id="t001", agent_id="a0",
                                                    cwd=work, prompt="do something")))
        finally:
            os.environ.pop("FAKE_CLAUDE_MODE", None)
            os.environ.pop("FAKE_CLAUDE_STATE", None)
        self.assertTrue(res.timed_out)
        self.assertEqual(res.subtype, "timeout")
        pids = [int(n[4:]) for n in os.listdir(state) if n.startswith("pid-")]
        self.assertTrue(pids)
        for pid in pids:
            with self.assertRaises(ProcessLookupError):
                os.kill(pid, 0)

    def test_reap_kills_children_left_by_a_killed_orchestrator(self) -> None:
        out = os.path.join(RACE, "runs", "_test-reap")
        work = os.path.join(out, "work")
        os.makedirs(work, exist_ok=True)
        child = subprocess.Popen(["sleep", "120"], cwd=work, start_new_session=True)
        other = subprocess.Popen(["sleep", "120"], cwd=TMP, start_new_session=True)  # not ours: left alone
        try:
            with open(os.path.join(work, "live_pids.txt"), "w") as fh:
                fh.write(f"{child.pid}\n{other.pid}\n")
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(race.main(["--reap", "--out", out]), 0)
            self.assertIsNotNone(child.wait(timeout=10))
            self.assertIsNone(other.poll())
        finally:
            for p in (child, other):
                if p.poll() is None:
                    p.kill()
                    p.wait()

    def test_sandbox_refuses_outside_work(self) -> None:
        sb = Sandbox(os.path.join(TMP, "adapter-work"))
        with self.assertRaises(SandboxError):
            sb.check(TMP)
        with self.assertRaises(SandboxError):
            sb.check(os.path.join(TMP, "adapter-work", "..", "..", "fixtures"))


class ClaudeAdapterWithFakeCli(unittest.TestCase):
    def test_race_with_fake_claude(self) -> None:
        state = os.path.join(TMP, "fake-ok")
        shutil.rmtree(state, ignore_errors=True)
        code, s, ev = run_race("fake-claude", "--policy", "beanstalk", "--agent", "claude", "--claude-bin", FAKE,
                               "--agents", "3", "--ci-seconds", "0.3",
                               env={"FAKE_CLAUDE_STATE": state, "FAKE_CLAUDE_ARENA": FIXTURE, "FAKE_CLAUDE_COST": "0.01"})
        assert_correct(self, code, s)
        n = sum(s["invocations"].values())
        self.assertAlmostEqual(s["cost_usd"], 0.01 * n, places=6)  # resumed sessions are charged the delta
        resumed = [e for e in of(ev, "invocation.end") if e.get("cost_source") == "reported-delta"]
        if of(ev, "rework.start", resumed=True):
            self.assertTrue(resumed)
        init = of(ev, "invocation.init")
        self.assertTrue(init)
        self.assertEqual(init[0]["mcp_servers"], [])

    def test_resumed_session_cost_is_a_delta(self) -> None:
        state = os.path.join(TMP, "fake-resume")
        shutil.rmtree(state, ignore_errors=True)
        work = os.path.join(TMP, "adapter-work")
        os.makedirs(work, exist_ok=True)
        ad = ClaudeAdapter(Runner(Sandbox(work)), model="haiku", max_turns=3, timeout=30, binary=FAKE,
                           transcripts=os.path.join(work, "transcripts"))
        os.environ.update(FAKE_CLAUDE_STATE=state, FAKE_CLAUDE_COST="0.25")
        try:
            first = asyncio.run(ad.run(InvocationSpec(inv_id="r1", kind="initial", task_id="x", agent_id="a0",
                                                      cwd=work, prompt="first")))
            second = asyncio.run(ad.run(InvocationSpec(inv_id="r2", kind="rework", task_id="x", agent_id="a0",
                                                       cwd=work, prompt="again", resume_session=first.session_id)))
        finally:
            os.environ.pop("FAKE_CLAUDE_STATE", None)
            os.environ.pop("FAKE_CLAUDE_COST", None)
        self.assertAlmostEqual(first.cost_usd, 0.25)
        self.assertAlmostEqual(second.cost_usd, 0.25)
        self.assertEqual(second.cost_source, "reported-delta")
        self.assertEqual(second.duration_api_ms, 900)
        self.assertTrue(ad.resumable(first.session_id))

    def test_failed_resume_falls_back_to_a_fresh_session(self) -> None:
        state = os.path.join(TMP, "fake-noresume")
        shutil.rmtree(state, ignore_errors=True)
        code, s, ev = run_race("fake-noresume", "--policy", "queue", "--agent", "claude", "--claude-bin", FAKE,
                               "--tasks", "t001", "t002", "--agents", "2", "--ci-slots", "1", "--batch", "2",
                               "--ci-seconds", "0.2",
                               env={"FAKE_CLAUDE_MODE": "noresume", "FAKE_CLAUDE_STATE": state,
                                    "FAKE_CLAUDE_ARENA": FIXTURE})
        assert_correct(self, code, s)
        retries = [e for e in of(ev, "invocation.retry") if "resume failed" in e["reason"]]
        self.assertTrue(retries)  # the resumed rework failed, then a fresh session resolved the conflict
        self.assertTrue(of(ev, "rework.start", resumed=True))

    def test_crash_is_an_infra_error_and_task_is_dropped_after_retries(self) -> None:
        state = os.path.join(TMP, "fake-crash")
        shutil.rmtree(state, ignore_errors=True)
        code, s, ev = run_race("fake-crash", "--policy", "queue", "--agent", "claude", "--claude-bin", FAKE,
                               "--tasks", "t005", "--agents", "1", "--ci-seconds", "0", "--infra-retry-seconds", "0.1",
                               env={"FAKE_CLAUDE_MODE": "crash", "FAKE_CLAUDE_STATE": state,
                                    "FAKE_CLAUDE_ARENA": FIXTURE})
        self.assertEqual(code, 0)
        self.assertEqual(s["tasks_dropped"], 1)
        self.assertEqual(len(of(ev, "invocation.retry")), 2)
        self.assertTrue(all(e["infra_error"] for e in of(ev, "invocation.end")))

    def test_hard_rate_limit_stops_the_race(self) -> None:
        state = os.path.join(TMP, "fake-ratelimit")
        shutil.rmtree(state, ignore_errors=True)
        code, s, ev = run_race("fake-ratelimit", "--policy", "beanstalk", "--agent", "claude", "--claude-bin", FAKE,
                               "--tasks", "t005", "t003", "--agents", "1", "--infra-retry-seconds", "0.1",
                               env={"FAKE_CLAUDE_MODE": "ratelimit", "FAKE_CLAUDE_STATE": state,
                                    "FAKE_CLAUDE_ARENA": FIXTURE})
        self.assertEqual(code, 3)
        self.assertIn("rate limited", s["aborted"])
        self.assertEqual(s["tasks_dropped"], 0)  # stopped, not dropped
        self.assertEqual(len(of(ev, "invocation.start")), 1)

    def test_argv_isolates_the_agent(self) -> None:
        ad = ClaudeAdapter(Runner(Sandbox(TMP)), model="haiku", max_turns=7, timeout=10, transcripts=TMP)
        argv = ad.argv(InvocationSpec(inv_id="x", kind="initial", task_id="t", agent_id="a", cwd=TMP, prompt="P",
                                      budget_cap_usd=1.5), "sid")
        self.assertEqual(argv[:2], ["claude", "-p"])
        for flag in ("--restricted", "--safe-mode", "--strict-mcp-config", "--disable-slash-commands"):
            self.assertIn(flag, argv)
        self.assertEqual(argv[argv.index("--setting-sources") + 1], "")
        self.assertEqual(argv[argv.index("--mcp-config") + 1], '{"mcpServers":{}}')
        self.assertEqual(argv[argv.index("--tools") + 1], "Read,Edit,Write,Glob,Grep,Bash")
        self.assertEqual(argv[argv.index("--permission-mode") + 1], "acceptEdits")
        self.assertEqual(argv[argv.index("--max-turns") + 1], "7")
        self.assertEqual(argv[argv.index("--max-budget-usd") + 1], "1.50")
        self.assertLess(argv.index("--disallowedTools"), argv.index("--allowedTools"))
        allowed = argv[argv.index("--allowedTools") + 1:]
        self.assertIn("Bash(node --test *)", allowed)
        self.assertIn("Bash(git diff *)", allowed)
        self.assertFalse([a for a in allowed if a.startswith("Bash(git commit")])
        self.assertIn("Bash(git commit *)", argv[argv.index("--disallowedTools") + 1: argv.index("--allowedTools")])
        self.assertNotIn("P", argv)  # the prompt goes on stdin


class CodexAndDryRun(unittest.TestCase):
    def test_race_with_fake_codex(self) -> None:
        code, s, ev = run_race("fake-codex", "--policy", "queue", "--agent", "codex",
                               "--codex-bin", os.path.join(TESTS, "fake_codex.py"), "--tasks", "t003", "t005",
                               "--agents", "2", "--ci-seconds", "0.2", env={"FAKE_CLAUDE_ARENA": FIXTURE})
        assert_correct(self, code, s)
        ends = of(ev, "invocation.end")
        self.assertTrue(all(e["cost_source"] == "estimated" for e in ends))
        # 4,000 fresh + 16,000 cached input and 1,000 output tokens at the default codex price assumption
        self.assertAlmostEqual(ends[0]["cost_usd"], (4000 * 1.25 + 16000 * 0.125 + 1000 * 10) / 1e6, places=6)
        self.assertTrue(ends[0]["session_id"])

    def test_dry_run_checks_the_arena(self) -> None:
        out = os.path.join(RACE, "runs", "_test-dry")
        with contextlib.redirect_stdout(io.StringIO()) as buf:
            code = race.main(["--dry-run", "--policy", "beanstalk", "--agent", "replay", "--arena", FIXTURE,
                              "--repo", REPO, "--out", out])
        self.assertEqual(code, 0, buf.getvalue()[-2000:])
        with open(os.path.join(out, "dry_run.json")) as fh:
            rep = json.load(fh)
        self.assertTrue(rep["ok"], rep["problems"])
        self.assertTrue(rep["base_suite"]["green"])
        self.assertTrue(all(t["acceptance_fails_on_base"] and t["solution"] == "passes" for t in rep["tasks"].values()))
        pairs = {tuple(c["pair"]): c for c in rep["couplings"]}
        self.assertTrue(pairs[("t001", "t002")]["textual_conflict"])
        self.assertFalse(pairs[("t001", "t005")]["textual_conflict"])  # union driver (beanstalk preset)
        self.assertFalse(pairs[("t003", "t004")]["suite_green"])       # semantic coupling


class Helpers(unittest.TestCase):
    def test_union_resolve_keeps_both_sides(self) -> None:
        text = "a\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\nb\n"
        self.assertEqual(union_resolve(text), "a\nours\ntheirs\nb\n")
        diff3 = "<<<<<<< ours\nx\n||||||| base\nold\n=======\nx\n>>>>>>> theirs\n"
        self.assertEqual(union_resolve(diff3), "x\n")

    def test_import_closure_follows_relative_ts_imports(self) -> None:
        app = os.path.join(FIXTURE, "app")
        tmp = os.path.join(TMP, "closure")
        shutil.rmtree(tmp, ignore_errors=True)
        shutil.copytree(app, tmp)
        t004 = load_tasks(FIXTURE, ["t004"])[0]
        for path, content in t004.acceptance_tests.items():
            os.makedirs(os.path.dirname(os.path.join(tmp, path)), exist_ok=True)
            with open(os.path.join(tmp, path), "w") as fh:
                fh.write(content)
        closure = import_closure(tmp, ["test/acceptance/t004.test.ts"])
        self.assertIn("src/invoice/index.ts", closure)
        self.assertIn("src/cart/index.ts", closure)   # type-only import still read
        self.assertIn("src/money/index.ts", closure)
        self.assertNotIn("src/users/index.ts", closure)

    def test_import_depths_and_stack_files(self) -> None:
        root = os.path.join(FIXTURE, "app")
        d = import_depths(root, "test/cart.test.ts", set(list_files(root)))
        self.assertEqual(d, {"test/cart.test.ts": 0, "src/cart/index.ts": 1})
        d = import_depths(root, "test/invoice.test.ts", set(list_files(root)))
        self.assertEqual(d["src/invoice/index.ts"], 1)
        self.assertEqual(d["src/money/index.ts"], 2)
        trace = f"Error\n    at total (file://{root}/src/cart/index.ts:15:9)\n    at node:internal/x:1:1"
        self.assertEqual(stack_files(trace, root), ["src/cart/index.ts"])

    def test_modules_and_placement(self) -> None:
        self.assertEqual(module_of("src/cart/index.ts"), "src/cart")
        self.assertEqual(module_of("src/routes.ts"), "src")
        self.assertEqual(placement_modules(["src/cart/index.ts", "src/cart/cart.test.ts", "CHANGELOG.md",
                                            "test/acceptance/t1.test.ts"]), {"src/cart"})

    def test_junit_parse(self) -> None:
        xml = os.path.join(TMP, "j.xml")
        root = os.path.join(TMP, "jroot")
        with open(xml, "w") as fh:
            fh.write(f'<testsuites><testcase name="a" file="{root}/test/a.test.ts"/>'
                     f'<testcase name="b" file="{root}/test/b.test.ts"><failure message="boom"/></testcase>'
                     "</testsuites>")
        failing, passing, n = parse_junit(xml, root)
        self.assertEqual(n, 2)
        self.assertEqual(passing, ["test/a.test.ts"])
        self.assertEqual(failing[0]["file"], "test/b.test.ts")

    def test_cost_formula_matches_cli(self) -> None:
        # numbers reported by Claude Code 2.1.287 for claude-haiku-4-5 in the smoke tests
        u1 = {"input_tokens": 57, "output_tokens": 1334, "cache_creation_input_tokens": 12435,
              "cache_read_input_tokens": 66861, "cache_creation": {"ephemeral_1h_input_tokens": 10286}}
        self.assertAlmostEqual(usage_cost(u1, claude_price("claude-haiku-4-5-20251001")), 0.03667135, places=6)
        self.assertEqual(claude_price("claude-sonnet-5-5")[0], 2.0)
        self.assertEqual(claude_price("claude-opus-5-5")[0], 4.0)

    def test_lexical_footprints_on_fixture(self) -> None:
        tmp = os.path.join(TMP, "catalog")
        shutil.rmtree(tmp, ignore_errors=True)
        shutil.copytree(os.path.join(FIXTURE, "app"), tmp)
        cat = ModuleCatalog(tmp)
        tasks = {t.id: t for t in load_tasks(FIXTURE)}
        pred = {tid: select(lexical_predict(t.prompt, t.title, cat), 0.3) for tid, t in tasks.items()}
        self.assertIn("src/routes", pred["t001"])
        self.assertIn("src/cart", pred["t003"])
        self.assertIn("src/users", pred["t005"])


class ZEvents(unittest.TestCase):
    """Named to run last (unittest orders classes alphabetically): checks every events.jsonl produced here."""

    REQUIRED = {
        "race.start": ("policy", "agent", "tasks"), "task.start": ("task", "agent", "base"),
        "invocation.start": ("inv", "kind", "agent"), "invocation.end": ("inv", "kind", "cost_usd", "ok"),
        "ci.start": ("ci", "sha", "purpose", "slot"), "ci.end": ("ci", "sha", "purpose", "green"),
        "land": ("sha", "target"), "green.promote": ("sha", "tasks"), "merge.conflict": ("files",),
        "race.end": ("aborted", "spent_usd"), "final.check": ("sha", "suite_green"),
    }

    def test_events_are_well_formed(self) -> None:
        runs = sorted(set(RUNS)) or sorted(os.path.join(RACE, "runs", d) for d in os.listdir(os.path.join(RACE, "runs"))
                                           if d.startswith("_test-"))
        self.assertTrue(runs)
        for run in runs:
            with open(os.path.join(run, "events.jsonl")) as fh:
                lines = fh.read().splitlines()
            events = [json.loads(line) for line in lines]
            self.assertEqual([e["seq"] for e in events], list(range(1, len(events) + 1)), run)
            ts = [e["t"] for e in events]
            self.assertEqual(ts, sorted(ts), run)
            self.assertEqual(events[0]["type"], "race.setup", run)
            self.assertEqual(len(of(events, "race.start")), 1, run)
            self.assertEqual(events[-1]["type"], "final.check", run)
            for e in events:
                for key in ("seq", "t", "ts", "type"):
                    self.assertIn(key, e)
                for key in self.REQUIRED.get(e["type"], ()):
                    self.assertIn(key, e, f"{run}: {e['type']} lacks {key}")
            starts = {e["inv"] for e in events if e["type"] == "invocation.start"}
            ends = {e["inv"] for e in events if e["type"] == "invocation.end"}
            aborted = any(e["type"] == "abort" for e in events)
            if not aborted:
                self.assertEqual(starts, ends, run)
            else:
                self.assertTrue(ends <= starts, run)
            cis = {e["ci"] for e in events if e["type"] == "ci.start"}
            cie = {e["ci"] for e in events if e["type"] == "ci.end"}
            self.assertTrue(cie <= cis, run)
            if not aborted:
                self.assertEqual(cis, cie, run)


if __name__ == "__main__":
    unittest.main()
