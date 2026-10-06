"""Mid-run live sprout sync (``live_sync_midrun``): the hook (harness/midrun.py) on throwaway worktrees, its wiring
into the Claude Code and Codex command lines, and the driver's offer/collect path. No network, no cost.
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
import unittest

TESTS = os.path.dirname(os.path.abspath(__file__))
RACE = os.path.dirname(TESTS)
sys.path.insert(0, RACE)

from harness import midrun  # noqa: E402
from harness.agents import ClaudeAdapter, CodexAdapter, InvocationSpec  # noqa: E402
from harness.core import RaceConfig  # noqa: E402
from harness.remote import MidrunSync, RemoteRace, v2_settings  # noqa: E402

TMP = os.path.join(TESTS, "tmp", "midrun")


def git(cwd: str, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


def write(root: str, path: str, text: str) -> None:
    full = os.path.join(root, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as fh:
        fh.write(text)


def read(root: str, path: str) -> str:
    with open(os.path.join(root, path), encoding="utf-8") as fh:
        return fh.read()


class Worktree:
    """A bean worktree at the base, and a sprout commit where t001 landed (src/shared.ts, src/t001.ts)."""

    def __init__(self, name: str, under: str = TMP):
        self.root = os.path.join(under, name)
        shutil.rmtree(self.root, ignore_errors=True)
        self.wt = os.path.join(self.root, "wt")
        self.sync_dir = os.path.join(self.root, "sync")
        os.makedirs(self.wt)
        git(self.wt, "init", "-q", "-b", "task/t002")
        for k, v in (("user.name", "t"), ("user.email", "t@x"), ("commit.gpgsign", "false")):
            git(self.wt, "config", k, v)
        write(self.wt, "src/shared.ts", "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n")
        git(self.wt, "add", "-A")
        git(self.wt, "commit", "-q", "-m", "base")
        self.base = git(self.wt, "rev-parse", "HEAD")
        git(self.wt, "checkout", "-q", "-b", "sprout")
        write(self.wt, "src/shared.ts", "export const a = 10;\nexport const b = 2;\nexport const c = 3;\n")
        write(self.wt, "src/t001.ts", "export const t001 = 1;\n")
        git(self.wt, "add", "-A")
        git(self.wt, "commit", "-q", "-m", "t001 landed")
        self.sprout = git(self.wt, "rev-parse", "HEAD")
        git(self.wt, "checkout", "-q", "task/t002")

    def offer(self) -> None:
        midrun.write_offer(self.sync_dir, {"sprout": self.sprout, "landed": [
            {"task": "t001", "title": "Raise a", "files": ["src/shared.ts"]}]})

    def hook(self, tool: str = "Read", tool_input: dict | None = None, mode: str = "merge") -> dict | None:
        payload = {"hook_event_name": "PostToolUse", "tool_name": tool, "tool_input": tool_input or {}}
        return midrun.run_hook(self.sync_dir, self.wt, mode, payload)

    def status(self) -> str:
        return git(self.wt, "status", "--porcelain")


def context(out: dict | None) -> str:
    assert out is not None
    return out["hookSpecificOutput"]["additionalContext"]


class Hook(unittest.TestCase):
    def test_without_an_offer_it_says_nothing(self) -> None:
        w = Worktree("none")
        self.assertIsNone(w.hook())
        self.assertEqual(midrun.outcomes(w.sync_dir), [])

    def test_a_clean_merge_lands_under_the_uncommitted_work(self) -> None:
        w = Worktree("clean")
        write(w.wt, "src/shared.ts", "export const a = 1;\nexport const b = 2;\nexport const c = 30;\n")
        write(w.wt, "src/t002.ts", "export const t002 = 1;\n")
        w.offer()
        note = context(w.hook())
        self.assertIn('t001 "Raise a" (src/shared.ts)', note)
        self.assertIn("merged into your workspace", note)
        self.assertEqual(read(w.wt, "src/shared.ts"), "export const a = 10;\nexport const b = 2;\nexport const c = 30;\n")
        self.assertEqual(read(w.wt, "src/t001.ts"), "export const t001 = 1;\n")
        self.assertEqual(git(w.wt, "rev-parse", "HEAD^1", "HEAD^2").split(), [w.base, w.sprout])
        self.assertEqual(w.status(), "M src/shared.ts\n?? src/t002.ts")  # the agent's work, still uncommitted
        self.assertEqual(git(w.wt, "branch", "--show-current"), "task/t002")
        [entry] = midrun.outcomes(w.sync_dir)
        self.assertEqual((entry["outcome"], entry["landed"]), ("applied", ["t001"]))
        self.assertEqual(entry["files"], ["src/shared.ts", "src/t001.ts"])
        self.assertLess(entry["ms"], 1000)

    def test_it_handles_each_offer_once(self) -> None:
        w = Worktree("once")
        w.offer()
        self.assertIsNotNone(w.hook())
        self.assertIsNone(w.hook())
        self.assertEqual(len(midrun.outcomes(w.sync_dir)), 1)

    def test_a_conflicting_merge_only_notes_and_changes_nothing(self) -> None:
        w = Worktree("conflict")
        mine = "export const a = 2;\nexport const b = 2;\nexport const c = 3;\n"
        write(w.wt, "src/shared.ts", mine)
        w.offer()
        note = context(w.hook())
        self.assertIn("not merged into your workspace (the merge would conflict in src/shared.ts)", note)
        self.assertEqual(read(w.wt, "src/shared.ts"), mine)
        self.assertEqual(git(w.wt, "rev-parse", "HEAD"), w.base)
        self.assertFalse(os.path.exists(os.path.join(w.wt, "src/t001.ts")))
        self.assertEqual(w.status(), "M src/shared.ts")
        self.assertEqual(midrun.outcomes(w.sync_dir)[0]["outcome"], "noted")

    def test_an_edit_of_a_landed_file_is_not_a_safe_point(self) -> None:
        w = Worktree("mid-edit")
        w.offer()
        note = context(w.hook("Edit", {"file_path": os.path.join(w.wt, "src/shared.ts")}))
        self.assertIn("the agent was editing src/shared.ts", note)
        self.assertEqual(git(w.wt, "rev-parse", "HEAD"), w.base)

    def test_an_edit_of_another_file_is_a_safe_point(self) -> None:
        w = Worktree("other-edit")
        w.offer()
        self.assertIn("merged into your workspace", context(w.hook("Write", {"file_path": "src/t002.ts"})))

    def test_a_merge_in_progress_is_never_merged_over(self) -> None:
        w = Worktree("in-progress")
        with open(os.path.join(w.wt, ".git", "MERGE_HEAD"), "w") as fh:
            fh.write(w.sprout + "\n")
        w.offer()
        self.assertIn("a merge with conflicts is in progress", context(w.hook()))
        self.assertEqual(git(w.wt, "rev-parse", "HEAD"), w.base)

    def test_a_sprout_already_merged_is_skipped_silently(self) -> None:
        w = Worktree("already")
        git(w.wt, "merge", "-q", "--no-edit", w.sprout)
        w.offer()
        self.assertIsNone(w.hook())

    def test_the_note_mode_never_merges(self) -> None:
        w = Worktree("note-mode")
        w.offer()
        self.assertIn("only notes", context(w.hook(mode="note")))
        self.assertEqual(git(w.wt, "rev-parse", "HEAD"), w.base)

    def test_the_command_line_hook_reads_stdin_and_prints_json(self) -> None:
        w = Worktree("cli")
        w.offer()
        cmd = midrun.hook_command(w.sync_dir, w.wt, "merge")
        out = subprocess.run(cmd, shell=True, input=json.dumps({"tool_name": "Read"}), capture_output=True,
                             text=True, check=True)
        self.assertIn("merged into your workspace", json.loads(out.stdout)["hookSpecificOutput"]["additionalContext"])

    def test_a_newer_offer_keeps_the_beans_of_one_not_yet_taken_up(self) -> None:
        w = Worktree("two-offers")
        w.offer()
        midrun.write_offer(w.sync_dir, {"sprout": "f" * 40, "landed": [{"task": "t003", "title": "x", "files": []}]})
        pending = midrun.read_json(os.path.join(w.sync_dir, midrun.PENDING))
        self.assertEqual([b["task"] for b in pending["landed"]], ["t001", "t003"])


class CommandLines(unittest.TestCase):
    def spec(self, hook: str | None) -> InvocationSpec:
        return InvocationSpec(inv_id="inv0002-initial", kind="initial", task_id="t002", agent_id="a0", cwd=TMP,
                              prompt="p", post_tool_hook=hook)

    def test_claude_gets_the_hook_through_settings_instead_of_safe_mode(self) -> None:
        adapter = ClaudeAdapter(None, model="haiku", max_turns=5, timeout=60, transcripts=TMP)  # type: ignore
        plain = adapter.argv(self.spec(None), "s")
        self.assertIn("--safe-mode", plain)
        self.assertNotIn("--settings", plain)
        argv = adapter.argv(self.spec("python3 hook.py"), "s")
        self.assertNotIn("--safe-mode", argv)
        self.assertIn("--restricted", argv)
        self.assertEqual(argv[argv.index("--setting-sources") + 1], "")
        with open(argv[argv.index("--settings") + 1], encoding="utf-8") as fh:
            hooks = json.load(fh)["hooks"]["PostToolUse"]
        self.assertEqual(hooks[0]["hooks"][0]["command"], "python3 hook.py")

    def test_codex_enables_only_the_hook(self) -> None:
        adapter = CodexAdapter(None, model=None, timeout=60, transcripts=TMP)  # type: ignore
        self.assertIn("hooks", adapter.argv(self.spec(None)))
        argv = adapter.argv(self.spec("python3 hook.py"))
        self.assertNotIn("hooks", [argv[i + 1] for i, a in enumerate(argv) if a == "--disable"])
        self.assertIn("--dangerously-bypass-hook-trust", argv)
        self.assertIn('hooks.PostToolUse=[{matcher="*",hooks=[{type="command",command="python3 hook.py",timeout=10}]}]',
                      argv)
        self.assertIn("--ignore-user-config", argv)

    def test_the_knob_is_sent_only_when_set(self) -> None:
        self.assertNotIn("live_sync_midrun", v2_settings({}, env={}))
        self.assertIs(v2_settings({}, env={"LIVE_SYNC_MIDRUN": "1"})["live_sync_midrun"], True)


class DriverSide(unittest.TestCase):
    def setUp(self) -> None:
        cfg = RaceConfig(policy="beanstalk-v2", agent="claude", out=os.path.join(TMP, "driver"), force=True)
        self.race = RemoteRace(cfg, gateway="http://127.0.0.1:9", admin_token="x" * 16, policy="beanstalk-v2",
                               v2={**v2_settings({}, env={}), "live_sync_midrun": True}, auth_probe=False)
        with contextlib.redirect_stdout(io.StringIO()):
            self.race.prepare_out()
        self.race.init_local()

    def tearDown(self) -> None:
        self.race.close_log()

    def test_offers_reach_the_hook_and_outcomes_reach_the_result_and_the_log(self) -> None:
        w = Worktree("t002", under=os.path.join(self.race.work, "agents"))
        inv = {"inv": "inv0002-initial", "kind": "initial", "task": "t002",
               "workspace": {"base_sha": w.base, "repo_url": "unused"}}
        sync = MidrunSync(self.race, "a0", inv, w.wt)
        write(w.wt, "src/t002.ts", "x\n")
        self.assertEqual(asyncio.run(sync.changed_files()), ["src/t002.ts"])
        asyncio.run(sync.offer({"sprout": w.sprout, "landed": [{"task": "t001", "title": "Raise a",
                                                               "files": ["src/shared.ts"]}]}))
        out = subprocess.run(sync.hook(ClaudeAdapter(None, model="m", max_turns=1, timeout=1,  # type: ignore
                                                     transcripts=TMP)),
                             shell=True, input="{}", capture_output=True, text=True, check=True)
        self.assertIn("merged into your workspace", out.stdout)
        [result] = sync.collect()
        self.assertEqual((result["sprout"], result["outcome"], result["landed"]), (w.sprout, "applied", ["t001"]))
        with open(os.path.join(self.race.work, "driver.jsonl"), encoding="utf-8") as fh:
            types = [json.loads(line).get("type") for line in fh]
        self.assertIn("driver.midrun_offered", types)
        self.assertIn("driver.midrun_hook", types)

    def test_only_implementer_invocations_of_real_agents_get_the_hook(self) -> None:
        self.race.adapter = ClaudeAdapter(None, model="m", max_turns=1, timeout=1, transcripts=TMP)  # type: ignore
        inv = {"inv": "inv0003-sync", "kind": "sync", "task": "t002", "workspace": {}}
        self.assertIsNone(self.race.midrun_sync("a0", inv, TMP))
        self.assertIsNotNone(self.race.midrun_sync("a0", {**inv, "inv": "inv0004-rework", "kind": "rework"}, TMP))


if __name__ == "__main__":
    unittest.main()
