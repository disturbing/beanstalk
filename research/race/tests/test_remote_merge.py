"""The driver's merge of the line (driver contract step 2) against the runner's: when the gateway's merge was clean but
git's conflicts here, the driver retries it with Mergiraf on exactly the conflicted paths (the runner's structural
tier, packages/runner/src/resolve.rs), and tells the agent about any conflict that is left. Local git repos only.
Run from research/race: ``python3 -m unittest discover -s tests``.
"""
from __future__ import annotations

import asyncio
import contextlib
import io
import os
import shutil
import subprocess
import sys
import unittest

TESTS = os.path.dirname(os.path.abspath(__file__))
RACE = os.path.dirname(TESTS)
sys.path.insert(0, RACE)

from harness.core import RaceConfig  # noqa: E402
from harness.remote import (RemoteRace, conflict_note, is_structural, structural_attributes,  # noqa: E402
                            structural_pattern)

TMP = os.path.join(TESTS, "tmp")
HAS_MERGIRAF = shutil.which("mergiraf") is not None
BASE = 'import { a } from "./a";\n\nexport const all = { a };\n'
# Each side adds an import and a registration at the same place: git conflicts on both hunks, Mergiraf merges both
# (imports and object members commute).
OURS = 'import { a } from "./a";\nimport { b } from "./b";\n\nexport const all = { a, b };\n'
THEIRS = 'import { a } from "./a";\nimport { c } from "./c";\n\nexport const all = { a, c };\n'
# Two migrations registered in one array (t010 and t011 in cf-demo-sonnet-30-s7): Mergiraf merges the imports, but
# array elements are ordered, so a conflict is left.
MIG_BASE = 'import { m1 } from "./0001";\n\nexport const migrations = [\n  m1,\n];\n'
MIG_OURS = ('import { m1 } from "./0001";\nimport { m6 } from "./0006";\n\n'
            'export const migrations = [\n  m1,\n  m6,\n];\n')
MIG_THEIRS = ('import { m1 } from "./0001";\nimport { m7 } from "./0007";\n\n'
              'export const migrations = [\n  m1,\n  m7,\n];\n')


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


class StructuralRules(unittest.TestCase):
    """The runner's rules (git/rules.rs): which paths the tier takes, and the retry's attributes."""

    def test_paths_are_judged_by_extension(self) -> None:
        self.assertTrue(is_structural("src/billing/service.ts"))
        self.assertTrue(is_structural("package.json"))
        self.assertFalse(is_structural("CHANGELOG.md"))
        self.assertFalse(is_structural("Makefile"))
        self.assertFalse(is_structural("src/.ts"))
        self.assertFalse(is_structural("src.ts/readme"))

    def test_only_literal_paths_become_patterns(self) -> None:
        self.assertEqual(structural_pattern("src/a.ts"), "/src/a.ts")
        self.assertIsNone(structural_pattern("src/[x].ts"))
        self.assertIsNone(structural_pattern("src/a b.ts"))
        self.assertIsNone(structural_pattern("README.md"))
        self.assertIsNone(structural_pattern("x/" + "a" * 260 + ".ts"))

    def test_every_conflicted_path_must_be_structural_and_union_lines_come_last(self) -> None:
        self.assertEqual(structural_attributes(["src/a.ts", "b.json"], ["CHANGELOG.md"]),
                         "/src/a.ts merge=mergiraf\n/b.json merge=mergiraf\nCHANGELOG.md merge=union\n")
        self.assertIsNone(structural_attributes(["src/a.ts", "README.md"], []))
        self.assertIsNone(structural_attributes([], []))

    def test_the_note_lists_the_files_first(self) -> None:
        note = conflict_note(["src/db/migrations/index.ts"], "trunk")
        self.assertTrue(note.startswith("IMPORTANT, before anything else"))
        self.assertIn("- src/db/migrations/index.ts\n", note)
        self.assertIn("latest trunk", note)


class MergeLine(unittest.TestCase):
    """``merge_line`` and the prompt note on a bean worktree whose merge of the sprout conflicts here although the
    gateway's ``merge.conflicts`` is empty."""

    def setUp(self) -> None:
        out = os.path.join(TMP, "remote-merge")
        shutil.rmtree(out, ignore_errors=True)
        cfg = RaceConfig(policy="beanstalk-v2", agent="replay", out=out, force=True)
        self.race = RemoteRace(cfg, gateway="http://127.0.0.1:9", admin_token="x" * 16, policy="beanstalk-v2")
        with contextlib.redirect_stdout(io.StringIO()):  # "outside research/race/runs/" is expected here
            self.race.prepare_out()
        self.race.init_local()
        self.race.base_sha = "0" * 40
        self.race.tokens = {"a0": "slot-token-for-tests"}

    def tearDown(self) -> None:
        self.race.close_log()

    def bean(self, path: str, base: str, ours: str, theirs: str) -> tuple[str, str, dict]:
        """A bean worktree at its own commit on ``base``, and the sprout's commit (``theirs``) to merge."""
        wt = self.race.worktree("t010")
        git(TMP, "init", "-q", wt)
        for k, v in (("user.name", "t"), ("user.email", "t@x"), ("commit.gpgsign", "false")):
            git(wt, "config", k, v)
        write(wt, path, base)
        write(wt, "README.md", "readme\n")
        git(wt, "add", "-A")
        git(wt, "commit", "-q", "-m", "base")
        base_sha = git(wt, "rev-parse", "HEAD")
        git(wt, "checkout", "-q", "-b", "sprout")
        write(wt, path, theirs)
        git(wt, "commit", "-q", "-am", "landed")
        sprout = git(wt, "rev-parse", "HEAD")
        git(wt, "checkout", "-q", "-B", "task/t010", base_sha)
        write(wt, path, ours)
        git(wt, "commit", "-q", "-am", "mine")
        ws = {"bean": "race-x-t010", "bean_url": wt, "repo_url": wt, "branch": "task/t010", "base_sha": base_sha,
              "head_sha": git(wt, "rev-parse", "HEAD"), "union_paths": ["CHANGELOG.md"],
              "merge": {"sha": sprout, "ref": "refs/heads/sprout", "conflicts": []}}
        return wt, sprout, ws

    def merge(self, wt: str, ws: dict) -> list[str]:
        with contextlib.redirect_stderr(io.StringIO()):  # the mismatch's one-line notice
            return asyncio.run(self.race.merge_line("a0", wt, ws, ws["merge"]))

    def driver_log(self) -> list[dict]:
        return list(self.race.events.events)

    def note(self, wt: str, ws: dict, conflicts: list[str]) -> str:
        inv = {"inv": "inv0034-rework", "kind": "rework", "task": "t010", "prompt": "Rework.\n", "workspace": ws}
        return asyncio.run(self.race.with_conflict_note(inv, wt, conflicts))["prompt"]

    @unittest.skipUnless(HAS_MERGIRAF, "mergiraf is not on PATH")
    def test_a_conflict_the_runner_resolves_structurally_is_resolved_here_too(self) -> None:
        wt, sprout, ws = self.bean("src/registry.ts", BASE, OURS, THEIRS)
        conflicts = self.merge(wt, ws)
        self.assertEqual(conflicts, [])
        text = read(wt, "src/registry.ts")
        self.assertIn('import { b } from "./b";', text)
        self.assertIn('import { c } from "./c";', text)
        self.assertNotIn("<<<<<<<", text)
        self.assertEqual(git(wt, "rev-parse", "MERGE_HEAD"), sprout)  # still a merge to commit
        self.assertEqual(git(wt, "diff", "--name-only", "--diff-filter=U"), "")
        log = self.driver_log()
        self.assertEqual([e["outcome"] for e in log if e["type"] == "driver.merge_structural"], ["resolved"])
        self.assertFalse([e for e in log if e["type"] == "driver.merge_mismatch"])
        self.assertEqual(self.note(wt, ws, conflicts), "Rework.\n")

    @unittest.skipUnless(HAS_MERGIRAF, "mergiraf is not on PATH")
    def test_a_conflict_left_by_mergiraf_keeps_gits_markers_and_the_agent_is_told(self) -> None:
        path = "src/db/migrations/index.ts"
        wt, sprout, ws = self.bean(path, MIG_BASE, MIG_OURS, MIG_THEIRS)
        conflicts = self.merge(wt, ws)
        self.assertEqual(conflicts, [path])
        text = read(wt, path)
        self.assertIn("<<<<<<< HEAD", text)
        self.assertNotIn("|||||||", text)  # git's own merge again, not Mergiraf's partial one
        log = self.driver_log()
        self.assertEqual([e["outcome"] for e in log if e["type"] == "driver.merge_structural"], ["conflict left"])
        mismatch = [e for e in log if e["type"] == "driver.merge_mismatch"]
        self.assertEqual(len(mismatch), 1)
        self.assertEqual((mismatch[0]["unexpected"], mismatch[0]["gateway"], mismatch[0]["textual"]),
                         ([path], [], [path]))
        prompt = self.note(wt, ws, conflicts)
        self.assertTrue(prompt.startswith("IMPORTANT, before anything else"))
        self.assertIn(f"- {path}\n", prompt)
        self.assertTrue(prompt.endswith("Rework.\n"))
        self.assertIn("driver.conflict_note", [e["type"] for e in self.driver_log()])

    def test_a_path_outside_the_tier_keeps_gits_conflict(self) -> None:
        wt, sprout, ws = self.bean("docs/notes.md", "a\n", "a\nb\n", "a\nc\n")
        conflicts = self.merge(wt, ws)
        self.assertEqual(conflicts, ["docs/notes.md"])
        self.assertIn("<<<<<<<", read(wt, "docs/notes.md"))
        skipped = [e for e in self.driver_log() if e["type"] == "driver.merge_structural"]
        self.assertEqual([e["outcome"] for e in skipped], ["skipped"])
        self.assertIn("docs/notes.md", self.note(wt, ws, conflicts))

    def test_the_queue_and_runs_without_the_tier_keep_gits_merge(self) -> None:
        self.race.policy = "queue"
        self.assertFalse(self.race.structural_merge())
        self.race.policy = "beanstalk-v2"
        self.assertTrue(self.race.structural_merge())
        self.race.guards = {"preset": "v24"}
        self.assertFalse(self.race.structural_merge())
        self.race.guards, self.race.v2 = {}, {**self.race.v2, "structural_merge": False}
        self.assertFalse(self.race.structural_merge())
        wt, sprout, ws = self.bean("src/registry.ts", BASE, OURS, THEIRS)
        conflicts = self.merge(wt, ws)
        self.assertEqual(conflicts, ["src/registry.ts"])
        self.assertFalse([e for e in self.driver_log() if e["type"] == "driver.merge_structural"])
        self.assertIn("src/registry.ts", self.note(wt, ws, conflicts))

    def test_conflicts_the_gateway_reported_are_left_to_its_prompt(self) -> None:
        wt, sprout, ws = self.bean("docs/notes.md", "a\n", "a\nb\n", "a\nc\n")
        ws["merge"]["conflicts"] = ["docs/notes.md"]
        conflicts = self.merge(wt, ws)
        self.assertEqual(conflicts, ["docs/notes.md"])
        log = self.driver_log()
        self.assertFalse([e for e in log if e["type"] in ("driver.merge_structural", "driver.merge_mismatch")])
        self.assertEqual(self.note(wt, ws, conflicts), "Rework.\n")


if __name__ == "__main__":
    unittest.main()
