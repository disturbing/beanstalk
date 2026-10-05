"""Remote driver tests: harness/remote.py against a scripted fake gateway (tests/fake_gateway.py).

The fake serves the gateway's routes and its git proxy over local bare repositories (git http-backend), so the
driver's clone, fetch and push go over real smart HTTP with its run tokens. No network, no cost.
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
sys.path.insert(0, TESTS)

import race  # noqa: E402
from fake_gateway import FakeGateway  # noqa: E402
from harness.agents import InvocationResult  # noqa: E402
from harness.core import RaceConfig  # noqa: E402
from harness.remote import (RemoteRace, check_v2_flags, explicit_flags, infra_failure, load_admin_token,  # noqa: E402
                            v2_settings)

FIXTURE = os.path.join(TESTS, "fixtures", "arena")
TMP = os.path.join(TESTS, "tmp")
REPO = os.path.join(TMP, "remote-arena.git")


def setUpModule() -> None:
    os.makedirs(TMP, exist_ok=True)
    subprocess.run([sys.executable, os.path.join(FIXTURE, "materialize.py"), "--out", REPO], check=True,
                   capture_output=True)


def read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def git(cwd: str, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


def tree_text(root: str) -> str:
    """Every readable file under ``root`` (the token-leak scan)."""
    out = []
    for d, _, names in os.walk(root):
        for n in names:
            try:
                with open(os.path.join(d, n), encoding="utf-8", errors="replace") as fh:
                    out.append(fh.read())
            except OSError:
                pass
    return "\n".join(out)


class ScriptedCloudRace(unittest.TestCase):
    """One v2 race on the fake gateway: t001 and t002 start from the base; whichever reports second conflicts on
    the sprout and is reworked on a merge of it, with a protected test and a refreshed token."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.fake = FakeGateway(os.path.join(TMP, "fake-gateway"))
        shutil.rmtree(cls.fake.root, ignore_errors=True)
        os.makedirs(cls.fake.root)
        cls.fake.start()
        cls.out = os.path.join(RACE, "runs", "_test-remote-v2")
        argv = ["--forge", "cloudflare", "--gateway", cls.fake.url, "--policy", "beanstalk-v2", "--agent", "replay",
                "--agents", "2", "--tasks", "t001", "t002", "--replay-median", "0.05", "--replay-sigma", "0",
                "--replay-cost-usd", "0.01", "--ci-seconds", "0.3", "--seed", "3", "--preland-mode", "optimistic",
                "--preland-seconds", "0.5", "--decision-seconds", "1", "--snapshot", "head", "--error-budget", "999",
                "--protect-tests", "landed", "--stagger-start", "0.2", "--arena", FIXTURE, "--repo", REPO,
                "--out", cls.out, "--force"]
        saved = dict(os.environ)
        os.environ["BEANSTALK_ADMIN_TOKEN"] = cls.fake.admin
        cls.stderr = io.StringIO()
        try:
            with contextlib.redirect_stdout(io.StringIO()) as cls.stdout, contextlib.redirect_stderr(cls.stderr):
                cls.code = race.main(argv)
            cls.admin_left_in_env = "BEANSTALK_ADMIN_TOKEN" in os.environ
        finally:
            os.environ.clear()
            os.environ.update(saved)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.fake.stop()

    def test_run_completes_without_driver_mistakes(self) -> None:
        self.assertEqual(self.code, 0, self.stderr.getvalue()[-3000:])
        self.assertEqual(self.fake.failures, [], self.stderr.getvalue()[-3000:])
        self.assertEqual(self.fake.phase, "done")
        refused = [r for r in self.fake.requests if r[2] >= 400 and not r[1].startswith("/git/")]
        self.assertEqual(refused, [])

    def test_run_config_is_the_harness_config(self) -> None:
        cfg = self.fake.config
        self.assertEqual(cfg["policy"], "beanstalk-v2")
        self.assertEqual((cfg["agent"], cfg["model"], cfg["agents"], cfg["seed"]), ("replay", "replay", 2, 3))
        self.assertEqual((cfg["preland_mode"], cfg["preland_seconds"], cfg["decision_seconds"],
                          cfg["decision_oracle"]), ("optimistic", 0.5, 1.0, "landed"))
        for absent in ("snapshot", "error_budget", "protect_tests"):  # v2 implies them on the gateway
            self.assertNotIn(absent, cfg)
        self.assertEqual([t["id"] for t in cfg["tasks"]], ["t001", "t002"])
        self.assertEqual(list(cfg["tasks"][0]["acceptance_tests"]), ["test/acceptance/t001.test.ts"])  # no app/
        self.assertEqual(sorted(cfg["footprints"]), ["t001", "t002"])
        self.assertIn(cfg["footprint"], ("predictor", "lexical"))
        self.assertEqual(len(cfg["arena_digest"]), 16)

    def test_initial_invocations_commit_and_push_the_bean(self) -> None:
        initials = {k: v for k, v in self.fake.results.items() if k.endswith("-initial")}
        self.assertEqual(len(initials), 2)
        for body in initials.values():
            self.assertTrue(body["ok"])
            self.assertTrue(body["new_commit"])
            self.assertEqual(body["markers_left"], [])
            self.assertEqual(body["tamper"], [])
            self.assertIn("src/routes/index.ts", body["files"])
            self.assertEqual(body["cost_usd"], 0.01)
            self.assertIsNone(body["merge_conflicts"])
            self.assertTrue(body["pushed_ref"].startswith("refs/heads/task/t00"))

    def test_conflicting_bean_is_reworked_on_a_merge_of_the_sprout(self) -> None:
        reworks = {k: v for k, v in self.fake.results.items() if k.endswith("-rework")}
        self.assertEqual(len(reworks), 1)
        body = next(iter(reworks.values()))
        self.assertTrue(body["ok"])
        self.assertEqual(body["merge_conflicts"], ["src/routes/index.ts"])  # the driver's merge left markers
        self.assertEqual(body["markers_left"], [])  # the replay agent resolved them
        self.assertEqual(body["tamper"], [])
        task = [k for k, v in self.fake.task.items() if v["reworks"]][0]
        wt = os.path.join(self.out, "work", "agents", task)
        merged = git(wt, "rev-parse", "HEAD^2")
        self.assertEqual(git(wt, "rev-parse", "trunk"), merged)  # "the trunk" in the prompt is a branch
        self.assertEqual(git(wt, "branch", "--show-current"), f"task/{task}")
        routes = read(os.path.join(wt, "src", "routes", "index.ts"))
        self.assertIn("/health", routes)
        self.assertIn("/version", routes)

    def test_refreshed_token_is_used_and_progress_is_reported(self) -> None:
        self.assertTrue(self.fake.retired, "the scenario hands out a fresh token with the rework")
        self.assertFalse([g for g in self.fake.git_log if g["principal"] in ("retired", "anonymous") and g["ok"]])
        self.assertTrue(self.fake.progress)
        self.assertTrue(all(cost == 0.01 for _, cost in self.fake.progress))

    def test_outputs_are_the_gateways_and_readable_by_the_harness_tools(self) -> None:
        with open(os.path.join(self.out, "events.jsonl")) as fh:
            lines = fh.read().splitlines()
        self.assertEqual(lines, self.fake.events)  # every page, byte for byte
        with open(os.path.join(self.out, "summary.json")) as fh:
            summary = json.load(fh)
        self.assertEqual(summary["tasks_green"], 2)
        md = read(os.path.join(self.out, "summary.md"))
        self.assertIn("# Race: beanstalk / replay", md)
        self.assertIn("forge: cloudflare", md)
        conf = json.loads(read(os.path.join(self.out, "config.json")))
        self.assertEqual((conf["forge"], conf["run"], conf["policy"]), ("cloudflare", self.fake.run, "beanstalk-v2"))
        kth = subprocess.run([sys.executable, os.path.join(RACE, "kth_green.py"), self.out, "--k", "1", "2"],
                             capture_output=True, text=True)
        self.assertEqual(kth.returncode, 0, kth.stderr)
        self.assertIn("_test-remote-v2", kth.stdout)
        self.assertNotIn("not reached", kth.stdout)
        self.assertTrue(all("init" in body for body in self.fake.results.values()))

    def test_no_token_is_written_or_inherited(self) -> None:
        self.assertFalse(self.admin_left_in_env)
        secrets = [self.fake.admin, self.fake.seed, self.fake.view, *self.fake.tokens.values(), *self.fake.retired]
        text = tree_text(self.out) + self.stderr.getvalue() + self.stdout.getvalue()
        for secret in secrets:
            self.assertNotIn(secret, text)
        self.assertIn("live page link withheld", self.stderr.getvalue())


def cloud_race(fake: FakeGateway, name: str, *args: str, env: dict | None = None) -> tuple[int, str, str]:
    """``race.py --forge cloudflare`` against ``fake``; returns (exit code, run directory, stderr)."""
    out = os.path.join(RACE, "runs", f"_test-{name}")
    argv = ["--forge", "cloudflare", "--gateway", fake.url, "--arena", FIXTURE, "--repo", REPO, "--out", out,
            "--force", *args]
    saved = dict(os.environ)
    os.environ.update({"BEANSTALK_ADMIN_TOKEN": fake.admin, **(env or {})})
    err = io.StringIO()
    try:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
            code = race.main(argv)
    finally:
        os.environ.clear()
        os.environ.update(saved)
    return code, out, err.getvalue()


class GatewayRefusalsAndAborts(unittest.TestCase):
    def fake(self, name: str, **kw) -> FakeGateway:
        fake = FakeGateway(os.path.join(TMP, f"fake-{name}"), **kw)
        shutil.rmtree(fake.root, ignore_errors=True)
        os.makedirs(fake.root)
        fake.start()
        self.addCleanup(fake.stop)
        return fake

    def test_a_refused_result_is_posted_again_with_the_core_fields(self) -> None:
        fake = self.fake("reject", reject_first_result=True)
        code, out, err = cloud_race(fake, "remote-reject", "--policy", "queue", "--agent", "replay", "--agents", "1",
                                    "--tasks", "t003", "--replay-median", "0.05", "--replay-sigma", "0")
        self.assertEqual(code, 0, err[-2000:])
        self.assertEqual(fake.failures, [])
        self.assertEqual(len(fake.rejected), 1)
        body = fake.results[fake.rejected[0]]  # accepted on the second post, without the refused extras
        self.assertNotIn("init", body)
        self.assertTrue(body["head_sha"] and body["new_commit"])
        self.assertIn("posting the core fields", err)

    def test_beans_that_cannot_be_read_fall_back_to_the_run_repo(self) -> None:
        fake = self.fake("bean-500", broken_bean_reads=True)
        code, out, err = cloud_race(fake, "remote-bean-500", "--policy", "beanstalk-v2", "--agent", "replay",
                                    "--agents", "2", "--tasks", "t001", "t002", "--replay-median", "0.05",
                                    "--replay-sigma", "0")
        self.assertEqual(code, 0, err[-2000:])
        self.assertEqual(fake.failures, [])
        self.assertEqual(sorted(k.split("-")[1] for k in fake.results), ["initial", "initial", "rework"])
        log = read(os.path.join(out, "work", "driver.jsonl"))
        self.assertIn("driver.bean_fetch_failed", log)

    def test_an_abort_answer_to_progress_kills_the_agent(self) -> None:
        fake = self.fake("abort", abort_on_progress=True)
        state = os.path.join(TMP, "fake-claude-abort")
        shutil.rmtree(state, ignore_errors=True)
        t0 = time.monotonic()
        code, out, err = cloud_race(fake, "remote-abort", "--policy", "beanstalk-v2", "--agent", "claude",
                                    "--claude-bin", os.path.join(TESTS, "fake_claude.py"), "--agents", "1",
                                    "--tasks", "t005", "--agent-timeout", "60", "--no-auth-probe",
                                    env={"FAKE_CLAUDE_MODE": "expensive", "FAKE_CLAUDE_STATE": state,
                                         "FAKE_CLAUDE_ARENA": FIXTURE})
        self.assertLess(time.monotonic() - t0, 45, "the hanging agent must be killed, not waited for")
        self.assertEqual(code, 2, err[-2000:])  # aborted on budget
        self.assertEqual(fake.results, {})      # the gateway already ended the invocation
        self.assertTrue(fake.progress and fake.progress[0][1] > 1.0)
        pids = [int(n[4:]) for n in os.listdir(state) if n.startswith("pid-")]
        self.assertTrue(pids)
        for pid in pids:
            with self.assertRaises(ProcessLookupError):
                os.kill(pid, 0)


class AgentOutages(unittest.TestCase):
    """Refused credentials and rate limits are infra failures of the agent CLI, never posted as the agent's work."""

    OUTAGE = os.path.join(TESTS, "fake_claude_outage.py")

    def fake(self, name: str) -> FakeGateway:
        fake = FakeGateway(os.path.join(TMP, f"fake-{name}"))
        shutil.rmtree(fake.root, ignore_errors=True)
        os.makedirs(fake.root)
        fake.start()
        self.addCleanup(fake.stop)
        return fake

    def env(self, name: str, fails: int, kind: str = "auth", outage_seconds: float = 30) -> dict:
        state = os.path.join(TMP, f"fake-claude-{name}")
        shutil.rmtree(state, ignore_errors=True)
        return {"FAKE_OUTAGE_FAILS": str(fails), "FAKE_OUTAGE_KIND": kind, "FAKE_CLAUDE_STATE": state,
                "FAKE_CLAUDE_ARENA": FIXTURE, "BEANSTALK_INFRA_BACKOFF": "0.2",
                "BEANSTALK_OUTAGE_SECONDS": str(outage_seconds)}

    def test_classifier_reads_error_results_only(self) -> None:
        def res(**kw) -> InvocationResult:
            return InvocationResult(inv_id="i", adapter="claude", model="sonnet", **kw)
        self.assertEqual(infra_failure(res(is_error=True, result_text='API Error: 403 {"error":{"type":"forbidden",'
                                                                       '"message":"Request not allowed"}}'))[0], "auth")
        self.assertEqual(infra_failure(res(is_error=True, result_text="Invalid API key · Please run /login"))[0],
                         "auth")
        self.assertEqual(infra_failure(res(infra_error="Not logged in · Please run /login"))[0], "auth")
        self.assertEqual(infra_failure(res(is_error=True, result_text="API Error: 429 rate_limit_error"))[0],
                         "rate-limit")
        self.assertEqual(infra_failure(res(ok=True, rate_limited=True))[0], "rate-limit")
        self.assertEqual(infra_failure(res(is_error=True, result_text="API Error: 529 Overloaded"))[0],
                         "api-unavailable")
        self.assertIsNone(infra_failure(res(ok=True, result_text="Done: unauthorized users now get a 403.")))
        self.assertIsNone(infra_failure(res(ok=True, is_error=True, subtype="error_max_turns")))
        self.assertIsNone(infra_failure(res(infra_error="exit 1 without a result")))

    def test_a_short_auth_outage_is_retried_not_posted(self) -> None:
        fake = self.fake("outage-short")
        code, out, err = cloud_race(fake, "remote-outage-short", "--policy", "queue", "--agent", "claude",
                                    "--claude-bin", self.OUTAGE, "--agents", "1", "--tasks", "t005", "--no-auth-probe",
                                    env=self.env("outage-short", fails=2))
        self.assertEqual(code, 0, err[-2000:])
        self.assertEqual(fake.failures, [])
        self.assertEqual(list(fake.results), ["inv0001-initial"])  # one result: the attempt that worked
        body = fake.results["inv0001-initial"]
        self.assertTrue(body["ok"])
        self.assertFalse(body["is_error"])
        self.assertTrue(any("2 infra failure(s)" in n for n in body["notes"]))
        self.assertIn("not posted", err)
        self.assertIn("works again", err)

    def test_a_long_outage_stops_the_run_cleanly(self) -> None:
        fake = self.fake("outage-long")
        t0 = time.monotonic()
        code, out, err = cloud_race(fake, "remote-outage-long", "--policy", "queue", "--agent", "claude",
                                    "--claude-bin", self.OUTAGE, "--agents", "1", "--tasks", "t005", "--no-auth-probe",
                                    env=self.env("outage-long", fails=1000, kind="login", outage_seconds=1.5))
        self.assertLess(time.monotonic() - t0, 60)
        self.assertEqual(code, 3, err[-2000:])
        self.assertEqual(fake.results, {})  # nothing was posted as the agent's work
        self.assertIn("infra: auth failures", fake.aborted or "")
        summary = json.loads(read(os.path.join(out, "summary.json")))
        self.assertIn("infra: auth", summary["aborted"])

    def test_the_auth_probe_stops_a_claude_race_before_its_run_exists(self) -> None:
        fake = self.fake("probe")
        with self.assertRaises(SystemExit) as stop:
            cloud_race(fake, "remote-probe", "--policy", "queue", "--agent", "claude", "--claude-bin", self.OUTAGE,
                       "--agents", "1", "--tasks", "t005", env=self.env("probe", fails=1000, kind="ratelimit"))
        self.assertIn("auth probe failed (rate-limit", str(stop.exception))
        self.assertIsNone(fake.run)


def worktree_with_landed_test(race_: RemoteRace) -> tuple[str, str, dict]:
    """A bean worktree at a commit that carries a landed task's test, and a bare remote for it."""
    wt = race_.worktree("t009")
    os.makedirs(os.path.join(wt, "test", "acceptance"))
    git(wt, "init", "-q")
    for k, v in (("user.name", "t"), ("user.email", "t@x"), ("commit.gpgsign", "false")):
        git(wt, "config", k, v)
    files = {"src/a.ts": "export const a = 1;\n", "test/acceptance/t001.test.ts": "landed t001 test\n",
             "test/acceptance/t007.test.ts": "an older t007 test\n", "test/acceptance/t009.test.ts": "own test\n"}
    for path, content in files.items():
        os.makedirs(os.path.dirname(os.path.join(wt, path)), exist_ok=True)
        with open(os.path.join(wt, path), "w") as fh:
            fh.write(content)
    git(wt, "add", "-A")
    git(wt, "commit", "-q", "-m", "base")
    base = git(wt, "rev-parse", "HEAD")
    bare = os.path.join(race_.work, "bean-t009.git")
    git(race_.work, "init", "-q", "--bare", bare)
    ws = {"bean": "race-x-t009", "bean_url": bare, "repo_url": bare, "branch": "task/t009", "base_sha": base,
          "head_sha": base, "merge": None, "acceptance": {"test/acceptance/t009.test.ts": "own test\n"},
          "protect": [{"path": "test/acceptance/t001.test.ts", "content": "landed t001 test\n"},
                      {"path": "test/acceptance/t007.test.ts", "content": "the landed t007 test\n"}],
          "union_paths": [], "commit_message": "Task nine\n\nTask: t009\nKind: rework\nInvocation: inv0005-rework\n"}
    return wt, base, ws


class CommitPath(unittest.TestCase):
    """Steps 4-6 of the driver contract on a local worktree (no gateway)."""

    def setUp(self) -> None:
        cfg = RaceConfig(policy="beanstalk-v2", agent="replay", out=os.path.join(TMP, "remote-commit"), force=True)
        self.race = RemoteRace(cfg, gateway="http://127.0.0.1:9", admin_token="x" * 16, policy="beanstalk-v2")
        with contextlib.redirect_stdout(io.StringIO()):  # "outside research/race/runs/" is expected here
            self.race.prepare_out()
        self.race.init_local()
        self.race.tokens = {"a0": "slot-token-for-tests"}

    def tearDown(self) -> None:
        self.race.close_log()

    def run_commit(self, inv: dict, res: InvocationResult) -> dict:
        return asyncio.run(self.race.commit_and_push("a0", inv, self.race.worktree(inv["task"]), res))

    def test_restores_acceptance_and_protected_tests_in_lineage_only(self) -> None:
        wt, base, ws = worktree_with_landed_test(self.race)
        for path, text in (("test/acceptance/t009.test.ts", "weakened own test\n"),
                           ("test/acceptance/t001.test.ts", "weakened landed test\n"),
                           ("test/acceptance/t007.test.ts", "edited older t007 test\n"),
                           ("src/a.ts", "export const a = 2;\n")):
            with open(os.path.join(wt, path), "w") as fh:
                fh.write(text)
        inv = {"inv": "inv0005-rework", "kind": "rework", "task": "t009", "resume": None, "workspace": ws}
        res = InvocationResult(inv_id="inv0005-rework", adapter="replay", model="replay", ok=True, subtype="success")
        fields = self.run_commit(inv, res)
        self.assertEqual(sorted(fields["tamper"]), ["test/acceptance/t001.test.ts", "test/acceptance/t009.test.ts"])
        self.assertEqual(read(os.path.join(wt, "test/acceptance/t009.test.ts")), "own test\n")
        self.assertEqual(read(os.path.join(wt, "test/acceptance/t001.test.ts")), "landed t001 test\n")
        # the landed t007 version is not in this bean's lineage: an older base version is left alone
        self.assertEqual(read(os.path.join(wt, "test/acceptance/t007.test.ts")), "edited older t007 test\n")
        self.assertTrue(fields["new_commit"])
        self.assertEqual(fields["files"], ["src/a.ts", "test/acceptance/t007.test.ts"])
        self.assertEqual(git(ws["bean_url"], "rev-parse", "refs/heads/task/t009"), fields["head_sha"])
        self.assertEqual(git(wt, "log", "-1", "--format=%B").strip(), ws["commit_message"].strip())

    def test_a_test_author_commits_its_acceptance_files_and_nothing_else(self) -> None:
        wt, base, ws = worktree_with_landed_test(self.race)
        for path, text in (("test/acceptance/t009.test.ts", "own test, amended to the decision\n"),
                           ("src/a.ts", "export const a = 2;\n"), ("src/new.ts", "export {};\n")):
            with open(os.path.join(wt, path), "w") as fh:
                fh.write(text)
        ws = {**ws, "commit_message": "Task nine\n\nTask: t009\nKind: test-author\nInvocation: inv0008-test-author\n"}
        inv = {"inv": "inv0008-test-author", "kind": "test-author", "task": "t009", "resume": None, "workspace": ws}
        res = InvocationResult(inv_id="inv0008-test-author", adapter="replay", model="replay", ok=True,
                               subtype="success")
        fields = self.run_commit(inv, res)
        self.assertEqual(fields["files"], ["test/acceptance/t009.test.ts"])
        self.assertEqual(fields["tamper"], [])
        self.assertEqual(read(os.path.join(wt, "test/acceptance/t009.test.ts")), "own test, amended to the decision\n")
        self.assertEqual(read(os.path.join(wt, "src/a.ts")), "export const a = 1;\n")
        self.assertFalse(os.path.exists(os.path.join(wt, "src/new.ts")))
        self.assertEqual(git(ws["bean_url"], "rev-parse", "refs/heads/task/t009"), fields["head_sha"])

    def test_a_reconcile_commits_both_tasks_acceptance_files_and_nothing_else(self) -> None:
        wt, base, ws = worktree_with_landed_test(self.race)
        for path, text in (("test/acceptance/t009.test.ts", "own test, reconciled\n"),
                           ("test/acceptance/t001.test.ts", "landed t001 test, new total\n"),
                           ("src/a.ts", "export const a = 2;\n"), ("src/new.ts", "export {};\n")):
            with open(os.path.join(wt, path), "w") as fh:
                fh.write(text)
        # The gateway lists both tasks' tests as acceptance and no longer protects the landed one.
        ws = {**ws, "acceptance": {"test/acceptance/t009.test.ts": "own test\n",
                                   "test/acceptance/t001.test.ts": "landed t001 test\n"},
              "protect": [p for p in ws["protect"] if p["path"] != "test/acceptance/t001.test.ts"],
              "commit_message": "Task nine\n\nTask: t009\nKind: reconcile\nInvocation: inv0010-reconcile\n"}
        inv = {"inv": "inv0010-reconcile", "kind": "reconcile", "task": "t009", "resume": None, "workspace": ws}
        res = InvocationResult(inv_id="inv0010-reconcile", adapter="replay", model="replay", ok=True,
                               subtype="success")
        fields = self.run_commit(inv, res)
        self.assertEqual(fields["files"], ["test/acceptance/t001.test.ts", "test/acceptance/t009.test.ts"])
        self.assertEqual(read(os.path.join(wt, "test/acceptance/t001.test.ts")), "landed t001 test, new total\n")
        self.assertEqual(read(os.path.join(wt, "src/a.ts")), "export const a = 1;\n")
        self.assertFalse(os.path.exists(os.path.join(wt, "src/new.ts")))

    def test_markers_left_means_no_commit(self) -> None:
        wt, base, ws = worktree_with_landed_test(self.race)
        with open(os.path.join(wt, "src/a.ts"), "w") as fh:
            fh.write("<<<<<<< HEAD\nexport const a = 1;\n=======\nexport const a = 3;\n>>>>>>> other\n")
        inv = {"inv": "inv0006-rework", "kind": "rework", "task": "t009", "resume": None, "workspace": ws}
        res = InvocationResult(inv_id="inv0006-rework", adapter="replay", model="replay", ok=True, subtype="success")
        fields = self.run_commit(inv, res)
        self.assertEqual(fields, {"markers_left": ["src/a.ts"]})
        self.assertEqual(git(wt, "rev-parse", "HEAD"), base)

    def test_failed_initial_or_failed_resume_is_left_for_the_gateways_retry(self) -> None:
        wt, base, ws = worktree_with_landed_test(self.race)
        res = InvocationResult(inv_id="inv0001-initial", adapter="claude", model="sonnet", infra_error="exit 1")
        inv = {"inv": "inv0001-initial", "kind": "initial", "task": "t009", "resume": None, "workspace": ws}
        self.assertEqual(self.run_commit(inv, res), {})
        inv = {"inv": "inv0007-rework", "kind": "rework", "task": "t009", "resume": "sess", "workspace": ws}
        self.assertEqual(self.run_commit(inv, res), {})
        self.assertEqual(git(wt, "rev-parse", "HEAD"), base)

    def test_replay_hints_become_the_harness_replay_spec(self) -> None:
        self.race.repo_files = {"src/cart/index.ts"}
        asyncio.run(self.load_fixture_tasks())
        inv = {"inv": "inv0003-rework", "kind": "rework", "task": "t004",
               "replay": {"reset_to": "a" * 40, "check": "suite", "fixes": ["t004", "t003"]},
               "workspace": {"acceptance": {"test/acceptance/t004.test.ts": "x"}}}
        spec = self.race.replay_for(inv)
        self.assertEqual(spec["reset_to"], "a" * 40)
        self.assertEqual([os.path.basename(p["path"]) for p in spec["patches"]], ["t004.patch"])
        self.assertEqual([os.path.basename(p["path"]) for p in spec["fixes"]], ["t004.fix.patch"])  # t003 has none
        self.assertEqual((spec["check"], spec["acceptance"]), ("suite", {"test/acceptance/t004.test.ts": "x"}))
        initial = self.race.replay_for({"inv": "inv0001-initial", "kind": "initial", "task": "t004",
                                        "replay": {"reset_to": None, "check": None, "fixes": []},
                                        "workspace": {"acceptance": {}}})
        self.assertEqual((initial["reset_to"], initial["fixes"], "check" in initial), (None, [], False))

    async def load_fixture_tasks(self) -> None:
        from harness.arena import load_tasks
        from harness.core import TaskState
        self.race.tasks = [TaskState(task=t) for t in load_tasks(FIXTURE)]
        self.race.by_id = {t.id: t for t in self.race.tasks}


class CommandLine(unittest.TestCase):
    def test_local_forge_is_the_default_and_the_config_is_unchanged(self) -> None:
        cfg, ns = race.parse_cli(["--policy", "queue"])
        self.assertEqual(ns.forge, "local")
        self.assertEqual(race.parse_args(["--policy", "queue"]).__dict__, cfg.__dict__)
        self.assertNotIn("forge", cfg.__dict__)
        self.assertEqual(race.v2_flags(ns), {})

    def test_local_v2_flags_reach_the_harness_through_its_environment(self) -> None:
        cfg, ns = race.parse_cli(["--policy", "beanstalk-v2", "--preland-mode", "optimistic", "--preland-seconds",
                                  "4.5", "--decision-seconds", "1", "--out", "runs/_test-remote-flags"])
        r = race.make_race(cfg, race.v2_flags(ns))
        self.assertEqual((r.preland_mode, r.preland_latency, r.decision_seconds, r.oracle),
                         ("optimistic", 4.5, 1.0, "landed"))
        self.assertNotIn("PRELAND_MODE", os.environ)

    def test_cloud_forge_needs_a_gateway_and_rejects_conflicting_v2_flags(self) -> None:
        with contextlib.redirect_stderr(io.StringIO()) as err:
            self.assertEqual(race.main(["--forge", "cloudflare", "--policy", "queue"]), 1)
        self.assertIn("--gateway", err.getvalue())
        with contextlib.redirect_stderr(io.StringIO()) as err:
            self.assertEqual(race.main(["--forge", "cloudflare", "--gateway", "http://127.0.0.1:9",
                                        "--policy", "beanstalk"]), 1)
        self.assertIn("queue or beanstalk-v2", err.getvalue())
        cfg = RaceConfig(policy="beanstalk-v2", snapshot="green")
        self.assertIn("--snapshot head", check_v2_flags("beanstalk-v2", cfg, explicit_flags(["--snapshot", "green"])))
        self.assertIsNone(check_v2_flags("beanstalk-v2", cfg, set()))  # the local default is not a choice
        cfg = RaceConfig(policy="beanstalk-v2", protect_tests="own")
        self.assertIn("landed", check_v2_flags("beanstalk-v2", cfg, explicit_flags(["--protect-tests=own"])))

    def test_admin_token_comes_from_the_environment_or_dev_vars(self) -> None:
        path = os.path.join(TMP, "dev.vars")
        with open(path, "w") as fh:
            fh.write("# comment\nRUN_TOKEN_SECRET=abc\nADMIN_TOKEN='from-dev-vars'\n")
        env = {"BEANSTALK_ADMIN_TOKEN": "from-env"}
        self.assertEqual(load_admin_token(env, path), "from-env")
        self.assertNotIn("BEANSTALK_ADMIN_TOKEN", env)  # children never inherit it
        self.assertEqual(load_admin_token({}, path), "from-dev-vars")
        self.assertIsNone(load_admin_token({}, os.path.join(TMP, "missing.vars")))

    def test_v22_knobs_are_sent_only_when_set(self) -> None:
        self.assertNotIn("release_on_check", v2_settings({}, env={}))
        settings = v2_settings({}, env={"RELEASE_ON_CHECK": "0", "PRELAND_RECHECK": "file", "FLAKE_CONFIRM": "true",
                                        "INHERITED_REDS": "validation", "WINDOW": "off", "EARLY_TICKETS": "0",
                                        "DECISION_OUTCOME": "decline", "HUMAN_TIMEOUT_SECONDS": "90"})
        self.assertEqual({k: settings[k] for k in ("release_on_check", "recheck", "flake_confirm", "inherited_reds",
                                                   "window", "early_tickets", "decision_outcome",
                                                   "human_timeout_seconds")},
                         {"release_on_check": False, "recheck": "file", "flake_confirm": True,
                          "inherited_reds": "validation", "window": "off", "early_tickets": False,
                          "decision_outcome": "decline", "human_timeout_seconds": 90.0})

    def test_v25_knobs_are_sent_only_when_set(self) -> None:
        self.assertNotIn("window_start", v2_settings({}, env={}))
        settings = v2_settings({}, env={"SINGLE_SUSPECT_REVERT": "0", "VALIDATION_FIRST": "1", "BASE_CULPRITS": "no",
                                        "WINDOW_START": "8", "WINDOW_GROWTH": "4", "WINDOW_MAX": "24",
                                        "WINDOW_MIN": "4"})
        self.assertEqual({k: settings[k] for k in ("single_suspect_revert", "validation_first", "base_culprits",
                                                   "window_start", "window_growth", "window_max", "window_min")},
                         {"single_suspect_revert": False, "validation_first": True, "base_culprits": False,
                          "window_start": 8, "window_growth": 4, "window_max": 24, "window_min": 4})

    def test_v2_settings_resolve_flag_then_env_then_harness_default(self) -> None:
        self.assertEqual(v2_settings({}, {}), {"preland_mode": "locked", "preland_seconds": 0.0,
                                               "decision_seconds": 30.0, "decision_oracle": "landed"})
        got = v2_settings({"preland_seconds": 4.5}, {"PRELAND_MODE": "optimistic", "PRELAND_SECONDS": "60"})
        self.assertEqual((got["preland_mode"], got["preland_seconds"]), ("optimistic", 4.5))


if __name__ == "__main__":
    unittest.main()
