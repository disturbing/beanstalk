"""python3 -m unittest discover -s research/test-impact/runner"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import spotcheck  # noqa: E402

FILES = {
    "src/lib/money.ts": "export function round(n: number): number {\n  return n < 0 ? 0 : Math.round(n * 100);\n}\n",
    "src/cart/service.ts": "export function label(): string {\n  return 'Cart total';\n}\nconst LIMIT = 50;\n",
    "src/lib/money.test.ts": "import { round } from './money.ts';\n",
}


class GenerateTest(unittest.TestCase):
    def test_is_seeded_and_never_mutates_tests(self) -> None:
        first = spotcheck.generate(FILES, 8, seed=3)
        second = spotcheck.generate(FILES, 8, seed=3)

        self.assertEqual([m.desc for m in first], [m.desc for m in second])
        for m in first:
            self.assertFalse(any(".test." in path for path in m.edits), m.desc)

    def test_ends_with_a_delete_a_shadowing_add_and_an_unrelated_add(self) -> None:
        kinds = [m.kind for m in spotcheck.generate(FILES, 8, seed=1)]

        self.assertEqual(kinds[-3:], ["delete", "add", "add"])

    def test_every_mutation_names_its_paths_and_ops(self) -> None:
        for m in spotcheck.generate(FILES, 8, seed=5):
            self.assertEqual(set(m.edits), set(m.ops), m.desc)
            for path, op in m.ops.items():
                self.assertEqual(op == "D", m.edits[path] is None)


if __name__ == "__main__":
    unittest.main()
