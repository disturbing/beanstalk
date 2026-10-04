"""Tests for the arena tooling: task files, helper functions, and a real materialize.py build.

    cd research/arena && python3 -m unittest discover -s tests

The build tests make two bare repositories in a temp dir (about 15 s each); the full
node-based proof of every task and coupling is validate.py, not this file.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
ARENA = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ARENA))

import contention  # noqa: E402
import materialize  # noqa: E402
import validate  # noqa: E402

TASKS = [json.loads(p.read_text(encoding="utf-8")) for p in sorted((ARENA / "tasks").glob("t*.json"))]


def declared_pairs(kind: str) -> set[tuple[str, str]]:
    return {(min(t["id"], c["with"]), max(t["id"], c["with"])) for t in TASKS for c in t["couplings"] if c["type"] == kind}


class TaskFiles(unittest.TestCase):
    def test_forty_tasks_with_matching_patches(self):
        self.assertEqual([t["id"] for t in TASKS], [f"t{i:03d}" for i in range(1, 41)])
        for t in TASKS:
            self.assertTrue((ARENA / "solutions" / f"{t['id']}.patch").is_file(), t["id"])

    def test_schema(self):
        self.assertEqual(validate.check_schema(TASKS), [])

    def test_titles_are_unique_issue_headlines(self):
        titles = [t["title"] for t in TASKS]
        self.assertEqual(len(titles), len(set(titles)))
        self.assertTrue(all(0 < len(t) <= 90 and "\n" not in t for t in titles))

    def test_patches_contain_source_only(self):
        for t in TASKS:
            patch = (ARENA / "solutions" / f"{t['id']}.patch").read_text(encoding="utf-8")
            paths = re.findall(r"^diff --git a/(\S+) b/", patch, re.M)
            self.assertTrue(paths, t["id"])
            self.assertFalse([p for p in paths if p.endswith(".test.ts")], t["id"])
            self.assertFalse(set(paths) & set(t["acceptance_tests"]) - {"src/lib/pagination.test.ts"}, t["id"])

    def test_designed_couplings(self):
        self.assertEqual(len(declared_pairs("semantic")), 5)
        self.assertEqual(len(declared_pairs("textual")), 5)

    def test_prompts_mostly_avoid_file_paths_and_never_name_companies(self):
        named = sum(1 for t in TASKS if re.search(r"\.(ts|md|json)\b", t["prompt"]))
        self.assertTrue(0.2 <= named / len(TASKS) <= 0.4, named)
        brands = re.compile(r"\b(stripe|paypal|shopify|amazon|fedex|ups|dhl|google|apple|microsoft|github|ebay|etsy|klarna)\b", re.I)
        self.assertFalse([t["id"] for t in TASKS if brands.search(t["title"] + t["prompt"])])

    def test_oracle_modules_follow_the_depth_two_rule(self):
        for t in TASKS:
            self.assertEqual(sorted(t["oracle_modules"]), sorted({validate.module_of(p) for p in t["oracle_paths"]}), t["id"])
            self.assertTrue(set(t["acceptance_tests"]) <= set(t["oracle_paths"]), t["id"])


class Helpers(unittest.TestCase):
    def test_module_of(self):
        self.assertEqual(validate.module_of("src/billing/tax.ts"), "src/billing")
        self.assertEqual(validate.module_of("src/routes.ts"), "src")
        self.assertEqual(validate.module_of("src/db/migrations/index.ts"), "src/db")
        self.assertEqual(validate.module_of("CHANGELOG.md"), "(root)")

    def test_suite_parses_node_test_output(self):
        out = "  ✔ fine (1.2ms)\n  ✖ breaks (2.0ms)\nℹ tests 5\nℹ pass 4\nℹ fail 1\n\n✖ failing tests:\n\ntest at x.ts:1:1\n✖ breaks (2.0ms)\n"
        suite = validate.Suite(1, out, 0.5)
        self.assertEqual((suite.tests, suite.passed, suite.failed), (5, 4, 1))
        self.assertEqual(suite.failing, ["breaks"])
        self.assertFalse(suite.ok)
        self.assertTrue(validate.Suite(0, "ℹ tests 3\nℹ pass 3\nℹ fail 0\n", 0.1).ok)
        self.assertFalse(validate.Suite(0, "", 0.1).ok, "no tests at all is not a pass")

    def test_table_aligns_columns(self):
        text = validate.table(["a", "bb"], [["1", "2"], ["333", "4"]])
        self.assertEqual(text.splitlines()[0], "a    bb")
        self.assertEqual(text.splitlines()[3], "333  4")

    def test_pct(self):
        self.assertEqual(contention.pct(1, 4), "1 (25.0%)")


class Materialized(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="arena-test-"))
        cls.repo = cls.tmp / "first.git"
        cls.shas = materialize.materialize(cls.repo, quiet=True)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def git(self, *args: str) -> str:
        return subprocess.run(["git", "-C", str(self.repo), *args], capture_output=True, text=True, check=True).stdout

    def test_branches_and_layout(self):
        refs = self.git("for-each-ref", "--format=%(refname)").split()
        self.assertEqual(sorted(refs), ["refs/heads/main"] + [f"refs/heads/ref/{t['id']}" for t in TASKS])
        files = self.git("ls-tree", "-r", "--name-only", "main").split()
        for expected in ("package.json", "CHANGELOG.md", "src/routes.ts", "src/billing/tax.ts", "src/db/migrations/index.ts"):
            self.assertIn(expected, files)
        self.assertFalse([f for f in files if f.startswith("app/")], "the app sits at the repository root")

    def test_each_branch_is_one_commit_titled_like_its_task(self):
        for t in TASKS:
            ref = f"refs/heads/ref/{t['id']}"
            self.assertEqual(self.git("rev-list", "--count", f"main..{ref}").strip(), "1")
            self.assertEqual(self.git("log", "-1", "--format=%s", ref).strip(), t["title"])
            self.assertEqual(sorted(self.git("diff", "--name-only", "main", ref).split()), sorted(t["oracle_paths"]), t["id"])

    def test_rebuilding_is_deterministic(self):
        again = materialize.materialize(self.tmp / "second.git", quiet=True)
        self.assertEqual(again, self.shas)

    def test_designed_pairs_merge_as_declared(self):
        def conflicts(a: str, b: str) -> list[str]:
            return contention.merge_conflicts(self.repo, f"refs/heads/ref/{a}", f"refs/heads/ref/{b}")
        for a, b in sorted(declared_pairs("semantic")):
            self.assertEqual(conflicts(a, b), [], f"{a}+{b} should merge cleanly")
        for a, b in sorted(declared_pairs("textual")):
            self.assertTrue([p for p in conflicts(a, b) if p.endswith(".ts")], f"{a}+{b} should conflict in a source file")


if __name__ == "__main__":
    unittest.main()
