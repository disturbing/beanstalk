"""Streaming diffs (``stream_diffs``): the snapshot (harness/streamdiff.py) on throwaway worktrees, the edit hook on the
Claude Code command line, and the driver's reporter posting to a stub gateway. No network, no cost.
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

from harness import remote, streamdiff  # noqa: E402
from harness.agents import ClaudeAdapter, InvocationSpec  # noqa: E402
from harness.core import RaceConfig  # noqa: E402
from harness.remote import RemoteRace, StreamReporter, v2_settings  # noqa: E402

TMP = os.path.join(TESTS, "tmp", "streamdiff")


def git(cwd: str, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


def write(root: str, path: str, text: str | bytes) -> None:
    full = os.path.join(root, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "wb") as fh:
        fh.write(text.encode() if isinstance(text, str) else text)


def worktree(name: str, under: str = TMP) -> tuple[str, str]:
    wt = os.path.join(under, name)
    shutil.rmtree(wt, ignore_errors=True)
    os.makedirs(wt)
    git(wt, "init", "-q", "-b", "task/t001")
    for k, v in (("user.name", "t"), ("user.email", "t@x"), ("commit.gpgsign", "false")):
        git(wt, "config", k, v)
    write(wt, "src/cart.ts", "export const a = 1;\nexport const b = 2;\n")
    write(wt, "src/old.ts", "gone\n")
    write(wt, ".gitignore", "node_modules/\n")
    git(wt, "add", "-A")
    git(wt, "commit", "-q", "-m", "base")
    return wt, git(wt, "rev-parse", "HEAD")


class Snapshot(unittest.TestCase):
    def test_tracked_untracked_deleted_and_binary_files_without_touching_the_index(self) -> None:
        wt, base = worktree("kinds")
        write(wt, "src/cart.ts", "export const a = 1;\nexport const b = 3;\n")
        write(wt, "src/new.ts", "export const n = 1;\n")
        write(wt, "logo.png", b"\x89PNG\x00\x01\x02")
        write(wt, "node_modules/x.js", "ignored\n")
        os.remove(os.path.join(wt, "src/old.ts"))
        before = git(wt, "status", "--porcelain")
        snap = streamdiff.snapshot(wt, base)
        assert snap is not None
        by = {f["path"]: f for f in snap.files}
        self.assertEqual(sorted(by), ["logo.png", "src/cart.ts", "src/new.ts", "src/old.ts"])
        self.assertEqual((by["src/cart.ts"]["status"], by["src/cart.ts"]["additions"], by["src/cart.ts"]["deletions"]),
                         ("modified", 1, 1))
        self.assertTrue(by["src/cart.ts"]["patch"].startswith("@@ "))
        self.assertIn("+export const b = 3;", by["src/cart.ts"]["patch"])
        self.assertEqual(by["src/new.ts"]["status"], "added")
        self.assertEqual(by["src/old.ts"]["status"], "deleted")
        self.assertEqual((by["logo.png"]["binary"], by["logo.png"]["patch"]), (True, None))
        self.assertEqual(git(wt, "status", "--porcelain"), before)  # the agent's index is untouched

    def test_an_unchanged_tree_is_not_diffed_again(self) -> None:
        wt, base = worktree("same")
        write(wt, "src/cart.ts", "changed\n")
        first = streamdiff.snapshot(wt, base)
        assert first is not None
        again = streamdiff.snapshot(wt, base, previous_tree=first.tree)
        assert again is not None
        self.assertEqual((again.tree, again.files), (first.tree, []))

    def test_secrets_are_redacted_and_patch_text_is_capped(self) -> None:
        wt, base = worktree("caps")
        write(wt, "src/key.ts", 'export const key = "sk-ant-api03-abcdefghijk";\nexport const ok = 1;\n')
        write(wt, "src/big.ts", "x\n" * 5000)
        snap = streamdiff.snapshot(wt, base, max_bytes=2000)
        assert snap is not None
        by = {f["path"]: f for f in snap.files}
        self.assertNotIn("sk-ant-", json.dumps(snap.files))
        self.assertIn("export const ok = 1;", by["src/key.ts"]["patch"])
        self.assertEqual(snap.redacted, 1)
        self.assertIsNone(by["src/big.ts"]["patch"])
        self.assertEqual(by["src/big.ts"]["additions"], 5000)
        self.assertTrue(snap.truncated)


class EditHook(unittest.TestCase):
    def test_claude_gets_a_touch_after_edit_tools_only(self) -> None:
        adapter = ClaudeAdapter(None, model="haiku", max_turns=5, timeout=60, transcripts=TMP)  # type: ignore
        spec = InvocationSpec(inv_id="inv0001-initial", kind="initial", task_id="t001", agent_id="a0", cwd=TMP,
                              prompt="p", edit_hook=streamdiff.edit_hook_command("/tmp/x y/edited"))
        argv = adapter.argv(spec, "s")
        self.assertNotIn("--safe-mode", argv)
        with open(argv[argv.index("--settings") + 1], encoding="utf-8") as fh:
            [entry] = json.load(fh)["hooks"]["PostToolUse"]
        self.assertEqual(entry["matcher"], "Edit|Write|MultiEdit|NotebookEdit")
        self.assertEqual(entry["hooks"][0]["command"], "touch '/tmp/x y/edited'")


class Reporter(unittest.TestCase):
    def setUp(self) -> None:
        cfg = RaceConfig(policy="beanstalk-v2", agent="claude", out=os.path.join(TMP, "driver"), force=True)
        self.race = RemoteRace(cfg, gateway="http://127.0.0.1:9", admin_token="x" * 16, policy="beanstalk-v2",
                               v2=v2_settings({}, env={}), auth_probe=False, guards={"stream_diffs": True})
        with contextlib.redirect_stdout(io.StringIO()):
            self.race.prepare_out()
        self.race.init_local()
        self.posts: list[dict] = []

        async def call_slot(slot: str, name: str, inv: str, body: dict, **_: object) -> dict:
            self.posts.append(body)
            return {"accepted": True, "seq": body["seq"]}

        self.race.call_slot = call_slot  # type: ignore[method-assign]
        self.timing = (remote.STREAM_POLL, remote.STREAM_SETTLE, remote.STREAM_MIN_INTERVAL, remote.STREAM_TIMER)
        remote.STREAM_POLL, remote.STREAM_SETTLE, remote.STREAM_MIN_INTERVAL, remote.STREAM_TIMER = 0.01, 0, 0, 60

    def tearDown(self) -> None:
        remote.STREAM_POLL, remote.STREAM_SETTLE, remote.STREAM_MIN_INTERVAL, remote.STREAM_TIMER = self.timing
        self.race.close_log()

    def test_an_edit_mark_posts_a_snapshot_with_a_growing_seq_and_logs_it(self) -> None:
        wt, base = worktree("t001", under=os.path.join(self.race.work, "agents"))
        inv = {"inv": "inv0001-initial", "kind": "initial", "task": "t001", "workspace": {"base_sha": base}}

        async def scenario() -> None:
            reporter = StreamReporter(self.race, "a0", inv, wt)
            while reporter.tree is None:  # the baseline: what was there before the agent started
                await asyncio.sleep(0.01)
            for text in ("export const a = 2;\n", "export const a = 3;\n"):
                write(wt, "src/cart.ts", text)
                subprocess.run(reporter.hook(), shell=True, check=True)
                for _ in range(500):
                    await asyncio.sleep(0.01)
                    if self.posts and text.strip() in json.dumps(self.posts[-1]):
                        break
                os.utime(reporter.marker, (0, 0))  # the next touch is always newer
                reporter.handled_mark = 0.0
            await reporter.close()

        asyncio.run(scenario())
        self.assertEqual([p["seq"] for p in self.posts], [1, 2])
        self.assertEqual(self.posts[0]["trigger"], "edit")
        self.assertIn("+export const a = 3;", self.posts[1]["files"][0]["patch"])
        with open(os.path.join(self.race.work, "driver.jsonl"), encoding="utf-8") as fh:
            logged = [json.loads(line) for line in fh if '"driver.stream"' in line]
        self.assertEqual([e["seq"] for e in logged], [1, 2])
        self.assertTrue(all(e["bytes"] > 0 and e["edit_to_post_ms"] is not None for e in logged))

    def test_only_implementer_invocations_stream_and_only_when_the_run_does(self) -> None:
        self.assertTrue(self.race.streams({"kind": "rework"}))
        self.assertFalse(self.race.streams({"kind": "reconcile"}))
        self.race.guards = {}
        self.assertFalse(self.race.streams({"kind": "initial"}))


if __name__ == "__main__":
    unittest.main()
