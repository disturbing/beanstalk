"""E1 unit tests: the fail-first judge on real node output, junit parsing, and the self-tests prompt line.

Run: python3 -m unittest tests.test_e1 (from race/); node runs one file at a time.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from harness import prompts  # noqa: E402
from harness.arena import Task  # noqa: E402
from harness.e1_tests import is_test_file, judge_proof, junit_cases  # noqa: E402

ARENA_GIT = os.path.normpath(os.path.join(HERE, "..", "..", "corpora", "arena.git"))
HEAD = "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\n"
ISSUE = ("Split the per-line work out of buildInvoice\nPull the work into an exported "
         "`buildInvoiceLine(ctx, address, item, discount)`. Move them into a new billing/coupons.ts")


@unittest.skipUnless(os.path.isdir(ARENA_GIT) and shutil.which("node"), "needs the arena repository and node")
class JudgeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.root = tempfile.mkdtemp(prefix="e1-judge-")
        arch = subprocess.Popen(["git", f"--git-dir={ARENA_GIT}", "archive", "main"], stdout=subprocess.PIPE)
        subprocess.run(["tar", "-x", "-C", cls.root], stdin=arch.stdout, check=True)
        arch.wait()

    @classmethod
    def tearDownClass(cls) -> None:
        shutil.rmtree(cls.root, ignore_errors=True)

    def verdict(self, name: str, src: str) -> str:
        path = f"src/billing/j-{name}.test.ts"
        full = os.path.join(self.root, path)
        with open(full, "w", encoding="utf-8") as fh:
            fh.write(src)
        junit = os.path.join(tempfile.gettempdir(), f"{uuid.uuid4().hex}.xml")
        try:
            pr = subprocess.run(["node", "--test", "--test-reporter=spec", "--test-reporter-destination=stdout",
                                 "--test-reporter=junit", f"--test-reporter-destination={junit}", path],
                                cwd=self.root, capture_output=True, text=True, timeout=120)
            return judge_proof(path, junit_cases(junit, self.root), pr.stdout + pr.stderr, self.root, ISSUE, [])[0]
        finally:
            os.remove(full)
            if os.path.exists(junit):
                os.remove(junit)

    def test_verdicts(self) -> None:
        cases = {
            "fails-first": [HEAD + "import { buildInvoiceLine } from './invoice.ts';\ntest('x', () => { assert.ok(buildInvoiceLine); });\n",
                            HEAD + "import { validateCoupon } from './coupons.ts';\ntest('x', () => { assert.ok(validateCoupon); });\n",
                            HEAD + "test('a', () => { assert.equal(1, 2); });\ntest('b', () => { assert.ok(true); });\n"],
            "broken": [HEAD + "import { makeLine } from './invoice.ts';\ntest('x', () => { assert.ok(makeLine); });\n",
                       HEAD + "const a = ;\n",
                       "import { test } from 'vitest';\ntest('x', () => {});\n",
                       HEAD + "import { makeFixture } from '../lib/testing.ts';\ntest('x', () => { assert.ok(makeFixture); });\n",
                       HEAD + "import { x } from './lines.ts';\ntest('x', () => { assert.ok(x); });\n"],
            "vacuous": [HEAD + "test('x', () => { assert.ok(true); });\n"],
        }
        for want, srcs in cases.items():
            for i, src in enumerate(srcs):
                with self.subTest(want=want, i=i):
                    self.assertEqual(self.verdict(f"{want}-{i}", src), want)


class PromptAndPathTest(unittest.TestCase):
    def test_self_tests_line_replaces_empty_acceptance(self) -> None:
        t = Task(id="t999", title="Title", prompt="Do it.", acceptance_tests={})
        self.assertIn("Cover this change with tests", prompts.initial(t))
        self.assertNotIn("Acceptance tests are in", prompts.initial(t))
        t.acceptance_tests = {"src/a/x.test.ts": ""}
        self.assertIn("Acceptance tests are in src/a/x.test.ts", prompts.initial(t))

    def test_author_prompt_has_issue_and_rules(self) -> None:
        t = Task(id="t999", title="Title", prompt="Do it.", acceptance_tests={})
        p = prompts.test_author(t)
        self.assertIn("Issue: Title", p)
        self.assertIn("only new test files are kept", p)
        self.assertIn("the harness collects your file", p)
        self.assertIn("did not accept them", prompts.test_author_retry(t, ["x: proves nothing"], resumed=True))

    def test_test_file_patterns(self) -> None:
        for p in ("src/a/x.test.ts", "src/a/x-test.ts", "src/a/test-x.mjs", "test/x.js", "src/test/y.ts"):
            self.assertTrue(is_test_file(p), p)
        for p in ("src/a/x.ts", "src/lib/testing.ts", "src/a/x.spec.ts", "README.md"):
            self.assertFalse(is_test_file(p), p)


if __name__ == "__main__":
    unittest.main()
