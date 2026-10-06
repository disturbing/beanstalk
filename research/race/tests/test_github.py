"""The GitHub arm (``--forge github``) against ``tests/fake_github.py`` and recorded GitHub responses.

Run from research/race: ``python3 -m unittest tests.test_github`` (no network, no cost).
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
import unittest

TESTS = os.path.dirname(os.path.abspath(__file__))
RACE = os.path.dirname(TESTS)
sys.path.insert(0, RACE)
sys.path.insert(0, TESTS)

import race  # noqa: E402
from fake_github import FakeGitHub  # noqa: E402
from harness import github as ghmod  # noqa: E402
from harness.github import (GhClient, Limiter, failures_from_log, parse_include, parse_snapshot,  # noqa: E402
                            ruleset_body, workflow_yaml)

FIXTURE = os.path.join(TESTS, "fixtures", "arena")
RECORDED = os.path.join(TESTS, "fixtures", "github")
TMP = os.path.join(TESTS, "tmp")
REPO = os.path.join(TMP, "fixture-arena-gh.git")
FAST = ["--replay-median", "0.3", "--replay-sigma", "0.3", "--ci-seconds", "0", "--gh-poll", "0.2",
        "--gh-push-interval", "0"]


def setUpModule() -> None:
    os.makedirs(TMP, exist_ok=True)
    subprocess.run([sys.executable, os.path.join(FIXTURE, "materialize.py"), "--out", REPO], check=True,
                   capture_output=True)


def run_gh(name: str, *args: str, fake: FakeGitHub | None = None) -> tuple[int, dict, list[dict], FakeGitHub]:
    out = os.path.join(RACE, "runs", f"_test-gh-{name}")
    fake = fake or FakeGitHub(os.path.join(TMP, f"gh-{name}"))
    if fake.exists is False and os.path.exists(fake.root):
        shutil.rmtree(fake.root)
    argv = ["--forge", "github", "--policy", "queue", "--arena", FIXTURE, "--repo", REPO, "--out", out, "--force",
            *args]
    race.GITHUB_CLIENT_FACTORY = lambda: fake
    try:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            code = race.main(argv)
    finally:
        race.GITHUB_CLIENT_FACTORY = None
    with open(os.path.join(out, "summary.json")) as fh:
        summary = json.load(fh)
    with open(os.path.join(out, "events.jsonl")) as fh:
        events = [json.loads(line) for line in fh]
    return code, summary, events, fake


def of(events: list[dict], typ: str, **match) -> list[dict]:
    return [e for e in events if e["type"] == typ and all(e.get(k) == v for k, v in match.items())]


class GitHubArmRace(unittest.TestCase):
    def assert_done(self, code: int, s: dict, ev: list[dict]) -> None:
        self.assertEqual(code, 0, s.get("aborted"))
        self.assertEqual(s["tasks_green"], s["tasks"])
        self.assertTrue(s["final"]["suite_green"])
        self.assertTrue(s["final"]["correct"])
        self.assertEqual(s["policy"], "github-queue")
        self.assertIn("github", s)
        seqs = [e["seq"] for e in ev]
        self.assertEqual(seqs, list(range(1, len(ev) + 1)))
        ts = [e["t"] for e in ev]
        self.assertEqual(ts, sorted(ts))
        merged = {e["task"] for e in of(ev, "gh.dequeued", reason="merged")}
        for e in of(ev, "queue.eject"):  # a PR removed as merged is never handed back (the fake lags like GitHub)
            later = [x for x in ev if x["seq"] > e["seq"] and x.get("task") == e["task"]]
            self.assertFalse(e["task"] in merged and later and later[0]["type"] == "land", e)
        self.assertEqual(len(of(ev, "land")), len({e["task"] for e in of(ev, "land")}))
        self.assertEqual(ev[-1]["type"], "final.check")
        cis = {e["ci"] for e in ev if e["type"] == "ci.start"}
        self.assertEqual(cis, {e["ci"] for e in ev if e["type"] == "ci.end"})

    def test_all_tasks_land_through_the_queue(self) -> None:
        code, s, ev, fake = run_gh("all", "--agents", "3", "--ci-slots", "2", "--batch", "3",
                                   "--tasks", "t001", "t003", "t005", *FAST)
        self.assert_done(code, s, ev)
        self.assertEqual(len(of(ev, "land", target="main")), 3)
        self.assertEqual(len(of(ev, "pr.open")), 3)
        self.assertTrue(of(ev, "queue.enqueue"))
        self.assertGreater(s["ci_runs"].get("precheck", 0), 0)
        self.assertGreater(s["ci_runs"].get("batch", 0), 0)
        gh = s["github"]
        self.assertEqual(gh["merges"]["prs"], 3)
        self.assertEqual(gh["actions"]["runs"].get("merge_group"), s["ci_runs"]["batch"])
        self.assertIsNotNone(gh["queue_wait_to_merge_s"]["median"])
        self.assertEqual(fake.ruleset["rules"][0]["parameters"]["max_entries_to_build"], 2)
        self.assertEqual(fake.ruleset["rules"][0]["parameters"]["max_entries_to_merge"], 3)
        with open(os.path.join(RACE, "runs", "_test-gh-all", "config.json")) as fh:
            self.assertEqual(json.load(fh)["forge"], "github")
        # kth_green reads the run unchanged
        res = subprocess.run([sys.executable, os.path.join(RACE, "kth_green.py"),
                              os.path.join(RACE, "runs", "_test-gh-all"), "--k", "1", "3"],
                             capture_output=True, text=True, check=True)
        row = res.stdout.splitlines()[-1]
        self.assertIn("github-queue", row)
        self.assertNotIn("not reached", row)
        # agents never get a remote: the worktrees and the integration clone have none
        remotes = subprocess.run(["git", "remote"], cwd=os.path.join(RACE, "runs", "_test-gh-all", "work",
                                                                       "integration"), capture_output=True, text=True)
        self.assertEqual(remotes.stdout.strip(), "")

    def test_conflict_with_main_goes_back_to_the_agent(self) -> None:
        code, s, ev, _ = run_gh("conflict", "--agents", "2", "--ci-slots", "1", "--batch", "2",
                                "--tasks", "t001", "t002", *FAST)
        self.assert_done(code, s, ev)
        ejected = of(ev, "queue.eject", reason="conflict")
        self.assertTrue(ejected, "one of the two route tasks conflicts once the other merged")
        tid = ejected[0]["task"]
        later = [e["type"] for e in ev if e["seq"] > ejected[0]["seq"] and e.get("task") == tid]
        self.assertIn("rework.start", later)
        self.assertIn("queue.submit", later)
        self.assertIn("land", later)
        self.assertGreaterEqual(s["github"]["kickouts"], 1)
        self.assertGreaterEqual(s["github"]["rebases_with_agent"], 1)

    def test_red_merge_group_goes_back_with_the_failure(self) -> None:
        fake = FakeGitHub(os.path.join(TMP, "gh-red"))
        fake.min_group = 2  # both PRs reach the queue before it builds: a red merge group, not a red PR check
        code, s, ev, _ = run_gh("red", "--agents", "2", "--ci-slots", "1", "--batch", "2",
                                "--tasks", "t003", "t004", "--replay-sigma", "0", *FAST, fake=fake)
        self.assert_done(code, s, ev)
        red = of(ev, "queue.eject", reason="red")
        self.assertTrue(red)
        tid = red[0]["task"]
        self.assertTrue(red[0]["failing"], "the failing tests come from the job log")
        self.assertTrue(of(ev, "rework.start", task=tid, reason="red"))
        self.assertGreaterEqual(s["red_validations"], 1)
        removed = of(ev, "gh.dequeued", reason="failed_checks")
        self.assertTrue(removed)

    def test_auto_merge_mode_and_reset_of_an_existing_repo(self) -> None:
        fake = FakeGitHub(os.path.join(TMP, "gh-reset"))
        if os.path.exists(fake.root):
            shutil.rmtree(fake.root)
        code, s, ev, fake = run_gh("reset1", "--agents", "1", "--tasks", "t005", "--gh-enqueue", "auto", *FAST,
                                   fake=fake)
        self.assert_done(code, s, ev)
        self.assertNotIn("enqueue", fake.calls)
        code, s, ev, fake = run_gh("reset2", "--agents", "1", "--tasks", "t005", *FAST, fake=fake)
        self.assert_done(code, s, ev)
        self.assertIn("disable_ruleset", fake.calls)
        self.assertEqual(fake.calls.count("create_repo"), 1)
        self.assertEqual(of(ev, "gh.setup")[0]["ignored_prs"], 1)

    def test_refuses_a_repo_it_did_not_create(self) -> None:
        fake = FakeGitHub(os.path.join(TMP, "gh-foreign"))
        fake.exists, fake.description = True, "someone else's repo"
        out = os.path.join(RACE, "runs", "_test-gh-foreign")
        race.GITHUB_CLIENT_FACTORY = lambda: fake
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    race.main(["--forge", "github", "--policy", "queue", "--arena", FIXTURE, "--repo", REPO,
                               "--out", out, "--force", "--tasks", "t005", *FAST])
        finally:
            race.GITHUB_CLIENT_FACTORY = None

    def test_cli_needs_an_owner_and_the_queue_policy(self) -> None:
        with contextlib.redirect_stderr(io.StringIO()) as err:
            self.assertEqual(race.main(["--forge", "github", "--policy", "beanstalk-v2", "--gh-owner", "o",
                                        "--out", "runs/_test-gh-cli"]), 1)
        self.assertIn("policy queue", err.getvalue())
        saved = os.environ.pop("BEANSTALK_GH_OWNER", None)
        try:
            with contextlib.redirect_stderr(io.StringIO()) as err:
                self.assertEqual(race.main(["--forge", "github", "--policy", "queue", "--out", "runs/_test-gh-cli"]),
                                 1)
            self.assertIn("--gh-owner", err.getvalue())
        finally:
            if saved is not None:
                os.environ["BEANSTALK_GH_OWNER"] = saved

    def test_repo_name(self) -> None:
        cfg, ns = race.parse_cli(["--forge", "github", "--policy", "queue", "--seed", "11"])
        self.assertEqual(race.gh_repo_name(cfg, ns), "beanstalk-race-shop-11")
        cfg, ns = race.parse_cli(["--forge", "github", "--policy", "queue", "--seed", "7", "--arena",
                                  "../real-arena/fastify"])
        self.assertEqual(race.gh_repo_name(cfg, ns), "beanstalk-race-fastify-7")


class GitHubClientParsing(unittest.TestCase):
    """Recorded responses from the 2026-10-07 probe on kintohubtest/beanstalk-race-shop-0."""

    def load(self, name: str):
        with open(os.path.join(RECORDED, name), encoding="utf-8") as fh:
            return fh.read() if name.endswith(".log") else json.load(fh)

    def test_snapshot_from_recorded_graphql_and_runs(self) -> None:
        snap = parse_snapshot(self.load("poll.json"), self.load("runs.json")["workflow_runs"], 0.0)
        merged = [p for p in snap.prs.values() if p.merged]
        self.assertTrue(merged)
        for p in merged:
            self.assertTrue(p.merge_commit)
            self.assertEqual(p.queue_events[-1].kind, "removed")
            self.assertEqual(p.queue_events[-1].reason, "merged")
        kinds = {r.event for r in snap.runs}
        self.assertEqual(kinds, {"pull_request", "merge_group"})
        group = next(r for r in snap.runs if r.event == "merge_group")
        self.assertIsNotNone(group.group_pr)
        self.assertTrue(snap.main_sha)

    def test_failures_from_a_recorded_job_log(self) -> None:
        failing, excerpt = failures_from_log(self.load("red_job.log"))
        self.assertEqual(failing, ["src/probe-red.test.ts > probe red"])
        self.assertIn("1 !== 2", excerpt)
        self.assertNotIn("##[error]", excerpt)

    def test_parse_include_and_rate_limit_retry(self) -> None:
        status, headers, body = parse_include("HTTP/2.0 403 Forbidden\r\nRetry-After: 0.01\r\n\r\n"
                                              '{"message": "You have exceeded a secondary rate limit"}')
        self.assertEqual(status, 403)
        self.assertEqual(headers["retry-after"], "0.01")
        self.assertIn("secondary", body["message"])
        events: list = []
        c = GhClient("o", "r", limiter=Limiter(push_interval=0, mutation_interval=0),
                     on_event=lambda typ, **f: events.append((typ, f)))
        answers = [(403, {"retry-after": "0.01"}, {"message": "You have exceeded a secondary rate limit"}),
                   (201, {}, {"number": 3, "node_id": "PR_x"})]
        c._call = lambda args, body, what: answers.pop(0)  # type: ignore[method-assign]
        number, node = asyncio.run(c.create_pr("task/t001", "t", "b"))
        self.assertEqual((number, node), (3, "PR_x"))
        self.assertEqual(events[0][0], "gh.rate_limited")
        self.assertEqual(c.limiter.stats["rate_limited"], 1)
        self.assertEqual(c.limiter.stats["mutations"], 2)

    def test_limiter_spaces_pushes(self) -> None:
        clock = [0.0]
        lim = Limiter(push_interval=10, clock=lambda: clock[0])
        slept: list[float] = []
        real = asyncio.sleep

        async def fake_sleep(s: float) -> None:
            slept.append(s)
            clock[0] += s
            await real(0)

        ghmod.asyncio.sleep = fake_sleep  # type: ignore[assignment]
        try:
            asyncio.run(lim.push())
            asyncio.run(lim.push())
            clock[0] += 3
            asyncio.run(lim.push())
        finally:
            ghmod.asyncio.sleep = real  # type: ignore[assignment]
        self.assertEqual(slept, [10.0, 7.0])
        self.assertEqual(lim.stats["pushes"], 3)

    def test_ruleset_and_workflow(self) -> None:
        body = ruleset_body(4, 4)
        mq = body["rules"][0]
        self.assertEqual(mq["type"], "merge_queue")
        self.assertEqual(mq["parameters"]["max_entries_to_build"], 4)
        self.assertEqual(mq["parameters"]["grouping_strategy"], "ALLGREEN")
        self.assertEqual(body["bypass_actors"], [])
        wf = workflow_yaml()
        self.assertIn("merge_group:", wf)
        self.assertIn("pull_request:", wf)
        self.assertIn("node --test", wf)

    def test_arena_ci_from_arena_json(self) -> None:
        from harness.forge_github import arena_ci
        cmd, node, install, extra = arena_ci(FIXTURE)
        self.assertEqual((cmd, node, install, extra), (ghmod.DEFAULT_TEST_CMD, "25", None, {}))
        arena = os.path.join(TMP, "arena-json")
        shutil.rmtree(arena, ignore_errors=True)
        os.makedirs(os.path.join(arena, "deps", "node_modules"))
        for name in ("package.json", "package-lock.json"):
            with open(os.path.join(arena, "deps", name), "w") as fh:
                fh.write("{}\n")
        with open(os.path.join(arena, "arena.json"), "w") as fh:
            json.dump({"node": "25.8.1", "test_args": ["test/!(listen.5).test.js"], "node_args": ["--no-use-env-proxy"],
                       "deps": "deps/node_modules"}, fh)
        cmd, node, install, extra = arena_ci(arena)
        self.assertEqual(cmd, "node --no-use-env-proxy --test --test-timeout=60000 --test-reporter=spec "
                              "--test-reporter-destination=stdout 'test/!(listen.5).test.js'")
        self.assertEqual(node, "25.8.1")
        self.assertIn("npm ci", install)
        self.assertEqual(sorted(extra), [".github/race/package-lock.json", ".github/race/package.json"])
        self.assertIn("install", workflow_yaml(cmd, node, install))

    def test_task_note_is_appended_to_every_prompt(self) -> None:
        from harness.arena import load_tasks
        plain = load_tasks(FIXTURE, task_note="")
        noted = load_tasks(FIXTURE, task_note="You may update existing tests.")
        self.assertEqual(noted[0].prompt, plain[0].prompt.rstrip() + "\n\nYou may update existing tests.")

    def test_git_env_never_carries_a_token(self) -> None:
        env = GhClient.git_env()
        self.assertEqual(env["GIT_CONFIG_VALUE_1"], "!gh auth git-credential")
        self.assertNotIn("token", json.dumps(env).lower().replace("git-credential", ""))
        from harness.agents import agent_env
        saved = os.environ.get("GH_TOKEN")
        os.environ["GH_TOKEN"] = "not-a-real-token"
        try:
            self.assertNotIn("GH_TOKEN", agent_env())
        finally:
            if saved is None:
                os.environ.pop("GH_TOKEN")
            else:
                os.environ["GH_TOKEN"] = saved


if __name__ == "__main__":
    unittest.main()
