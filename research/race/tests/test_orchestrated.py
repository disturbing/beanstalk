"""Orchestrated races: the prompt (identical but for the forge section), the backlog, and the forge-side measurement
(replay of the integration line with the hidden acceptance tests, integration metrics, transcript parsing)."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import unittest

TESTS = os.path.dirname(os.path.abspath(__file__))
RACE = os.path.dirname(TESTS)
sys.path.insert(0, RACE)

from harness import orch_measure as M  # noqa: E402
from harness import orch_prompt  # noqa: E402
from harness.arena import load_tasks  # noqa: E402
from harness.orchestrated import parse_transcript, task_of  # noqa: E402

FIXTURE = os.path.join(TESTS, "fixtures", "arena")
TMP = os.path.join(TESTS, "tmp", "orch")


def git(cwd: str, *args: str) -> str:
    return subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *args], cwd=cwd, check=True,
                          capture_output=True, text=True).stdout


class Prompt(unittest.TestCase):
    def test_arms_differ_only_in_the_forge_section(self) -> None:
        kw = dict(repo_url="https://x/y", n_tasks=10, subagents=4, test_hint="Run `node --test`.", wall_minutes=90)
        gh, bs = orch_prompt.prompt("github", **kw), orch_prompt.prompt("beanstalk", **kw)
        shared_gh = gh.split("The forge:")[0].replace("origin/main", "origin/<line>").replace("`main`", "`<line>`")
        shared_bs = bs.split("The forge:")[0].replace("origin/sprout", "origin/<line>").replace("`sprout`",
                                                                                                "`<line>`")
        self.assertEqual(shared_gh, shared_bs)
        self.assertIn("git worktree", gh)
        self.assertIn("gh pr merge", gh)
        self.assertIn("git push -o wait", bs)

    def test_backlog_has_every_task_and_its_tests(self) -> None:
        tasks = load_tasks(FIXTURE, task_note="")
        text = orch_prompt.backlog(tasks, "Run `node --test`.")
        for t in tasks:
            self.assertIn(f"## {t.id}: {t.title}", text)
            for path, content in t.acceptance_tests.items():
                self.assertIn(path, text)
                self.assertIn(content.strip().splitlines()[0], text)

    def test_task_of(self) -> None:
        self.assertEqual(task_of("Add x\n\nTask: t004"), "t004")
        self.assertEqual(task_of("fix: (t012) thing"), "t012")
        self.assertIsNone(task_of("nothing"))


class Measure(unittest.TestCase):
    def setUp(self) -> None:
        shutil.rmtree(TMP, ignore_errors=True)
        os.makedirs(TMP)
        self.repo = os.path.join(TMP, "repo")
        shutil.copytree(os.path.join(FIXTURE, "app"), self.repo)
        git(self.repo, "init", "-q", "-b", "main")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", "base")
        self.base = git(self.repo, "rev-parse", "HEAD").strip()
        self.tasks = {t.id: t for t in load_tasks(FIXTURE, task_note="")}

    def land(self, tid: str) -> str:
        t = self.tasks[tid]
        subprocess.run(["git", "apply", "-p2", t.solution], cwd=self.repo, check=False, capture_output=True)
        if git(self.repo, "status", "--porcelain").strip() == "":
            subprocess.run(["git", "apply", "-p1", t.solution], cwd=self.repo, check=True, capture_output=True)
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", f"{t.title}\n\nTask: {tid}")
        return git(self.repo, "rev-parse", "HEAD").strip()

    def test_replay_finds_the_first_commit_where_each_task_passes(self) -> None:
        first = self.land("t001")
        second = self.land("t003")
        acc = {tid: self.tasks[tid].acceptance_tests for tid in ("t001", "t003", "t002")}
        greens, log = M.replay_greens(self.repo, self.base, "main", acc, ["node", "--test"], dict(os.environ), None,
                                      when={second: 123.0})
        self.assertEqual(greens["t001"][0], first)
        self.assertEqual(greens["t003"], (second, 123.0))
        self.assertNotIn("t002", greens)      # never landed: its tests never pass
        self.assertEqual(len(log), 2)
        final = M.final_check(self.repo, "main", acc, ["node", "--test"], ["node", "--test"], dict(os.environ), None)
        self.assertTrue(final["suite_green"])
        self.assertEqual(final["per_task"], {"t001": True, "t003": True, "t002": False})

    def test_integration_metrics(self) -> None:
        ch = [M.Change("a", "t1", ready_at=100, integrated_at=160, created_at=90, kickouts=1, pushes=2),
              M.Change("b", "t2", ready_at=120, integrated_at=700, created_at=110, conflicts=1),
              M.Change("c", "t3", ready_at=800, integrated_at=None)]
        m = M.integration_metrics(ch, 0, 1000)
        self.assertEqual(m["integrated"], 2)
        self.assertEqual(m["ready_to_integrated_s"]["median"], 320.0)
        self.assertEqual(m["submitted_to_integrated_s"]["median"], 330.0)
        self.assertEqual(m["max_changes_waiting"], 2)
        self.assertAlmostEqual(m["waiting_share_of_wall"], (700 - 100 + 1000 - 800) / 1000)
        self.assertEqual(m["integrated_per_10min"], [1, 1])
        self.assertEqual((m["kickouts"], m["conflicts"], m["repushes"]), (1, 1, 1))


class Transcript(unittest.TestCase):
    def test_parallel_subagents_and_cost(self) -> None:
        path = os.path.join(TESTS, "tmp", "orch-transcript.jsonl")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        lines = [
            {"type": "assistant", "message": {"content": [
                {"type": "tool_use", "name": "Agent", "input": {"subagent_type": "worker"}},
                {"type": "tool_use", "name": "Agent", "input": {"subagent_type": "worker", "run_in_background": True}},
                {"type": "tool_use", "name": "Bash", "input": {"command": "git worktree add .worktrees/a -b a"}}]}},
            {"type": "assistant", "parent_tool_use_id": "x", "message": {"content": [
                {"type": "tool_use", "name": "Bash", "input": {"command": "gh pr create --base main"}}]}},
            {"type": "result", "total_cost_usd": 1.25, "subtype": "success", "num_turns": 9, "is_error": False}]
        with open(path, "w") as fh:
            fh.write("\n".join(json.dumps(x) for x in lines) + "\n")
        s = parse_transcript(path, [])
        self.assertEqual((s["agent_calls"], s["max_agent_calls_in_one_message"], s["background_agent_calls"]),
                         (2, 2, 1))
        self.assertEqual(s["cost_usd"], 1.25)
        self.assertEqual(s["commands"], {"git worktree": 1, "gh pr": 1})


if __name__ == "__main__":
    unittest.main()
