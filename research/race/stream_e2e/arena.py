"""A throwaway arena for the streaming-diffs loop: the 5-task fixture app with two of its tasks (t001, t003) and one
task that makes an agent write a few dozen lines over several edits (t101), so a stream has something to show.

    python3 stream_e2e/arena.py      # writes stream_e2e/.local/arena/ (tasks/) and .local/arena.git (main + ref/*)
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(HERE, "..", "tests", "fixtures", "arena")
ARENA = os.path.join(HERE, ".local", "arena")
REPO = os.path.join(HERE, ".local", "arena.git")

REPORT_TEST = """import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, formatReport } from "../../src/report/index.ts";

const orders = [
  { id: "o1", lines: [{ sku: "lamp", priceCents: 5000, qty: 2 }, { sku: "mug", priceCents: 1250, qty: 4 }] },
  { id: "o2", lines: [{ sku: "lamp", priceCents: 5000, qty: 1 }] },
  { id: "o3", lines: [{ sku: "rug", priceCents: 12000, qty: 1 }] },
];

test("summarize counts orders, revenue, the average order and the best-selling sku by revenue", () => {
  assert.deepEqual(summarize(orders), {
    orders: 3, revenueCents: 32000, averageCents: 10667, topSku: "lamp", units: 8,
  });
});

test("an empty week reports zeros and no top sku", () => {
  assert.deepEqual(summarize([]), { orders: 0, revenueCents: 0, averageCents: 0, topSku: null, units: 0 });
});

test("formatReport prints one labelled line per figure, money in dollars", () => {
  assert.equal(formatReport(summarize(orders)),
    "Orders: 3\\nUnits: 8\\nRevenue: $320.00\\nAverage order: $106.67\\nTop sku: lamp");
});
"""

T101 = {
    "id": "t101",
    "title": "Weekly sales report",
    "prompt": ("Finance wants a weekly sales report. Add a module src/report/index.ts that exports "
               "summarize(orders) and formatReport(summary). An order is { id, lines: [{ sku, priceCents, qty }] }. "
               "summarize returns { orders, units, revenueCents, averageCents (rounded to the nearest cent), topSku "
               "(the sku with the most revenue, null when there are no orders) }. formatReport prints one labelled "
               "line per figure (Orders, Units, Revenue, Average order, Top sku), money as dollars with two "
               "decimals. Write it in small, documented functions (a JSDoc comment on each), put the money "
               "formatting in its own helper, and add a line about the report to CHANGELOG.md."),
    "acceptance_tests": {"test/acceptance/t101.test.ts": REPORT_TEST},
    "oracle_paths": ["src/report/index.ts", "CHANGELOG.md"],
    "oracle_modules": ["src/report"],
    "kind": "feature",
    "difficulty": 2,
    "couplings": [],
}


GUARD_TEST = """import { test } from "node:test";
import assert from "node:assert/strict";
import { total } from "../../src/cart/index.ts";

test("cart totals refuse lines with a negative quantity or a fractional price", () => {
  assert.throws(() => total([{ sku: "mug", priceCents: 250, qty: -1 }]), TypeError);
  assert.throws(() => total([{ sku: "mug", priceCents: 2.5, qty: 1 }]), TypeError);
});
"""

T102 = {
    "id": "t102",
    "title": "Validate inputs across the shop modules",
    "prompt": ("Bad input reaches our modules silently. Go through every module under src/ (cart, invoice, money, "
               "users, routes) and make each exported function validate its arguments: throw a TypeError with a "
               "message naming the argument and what was expected (for example negative quantities, prices that are "
               "not whole cents, empty ids). Change one module at a time with small focused edits, add a short "
               "JSDoc line to each function you touch, and run the tests as you go. Add a CHANGELOG.md line."),
    "acceptance_tests": {"test/acceptance/t102.test.ts": GUARD_TEST},
    "oracle_paths": ["src/cart/index.ts", "src/invoice/index.ts", "src/money/index.ts", "src/users/index.ts",
                     "src/routes/index.ts", "CHANGELOG.md"],
    "oracle_modules": ["src/cart", "src/invoice", "src/money", "src/users", "src/routes"],
    "kind": "feature",
    "difficulty": 3,
    "couplings": [],
}


def git(cwd: str, *args: str) -> None:
    env = dict(os.environ, GIT_AUTHOR_NAME="arena", GIT_AUTHOR_EMAIL="arena@beanstalk.invalid",
               GIT_COMMITTER_NAME="arena", GIT_COMMITTER_EMAIL="arena@beanstalk.invalid")
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, env=env)


def main() -> None:
    shutil.rmtree(ARENA, ignore_errors=True)
    os.makedirs(os.path.join(ARENA, "tasks"))
    os.makedirs(os.path.join(ARENA, "solutions"))
    tasks = [json.load(open(os.path.join(FIXTURE, "tasks", f"{t}.json"))) for t in ("t001", "t003")] + [T101, T102]
    for t in tasks:
        with open(os.path.join(ARENA, "tasks", f"{t['id']}.json"), "w") as fh:
            json.dump(t, fh, indent=2)
    shutil.rmtree(REPO, ignore_errors=True)
    with tempfile.TemporaryDirectory() as tmp:
        work = os.path.join(tmp, "w")
        shutil.copytree(os.path.join(FIXTURE, "app"), work)
        git(work, "init", "-q", "-b", "main")
        git(work, "config", "commit.gpgsign", "false")
        git(work, "add", "-A")
        git(work, "commit", "-q", "-m", "Base shop service")
        for t in tasks:  # ref/<id>: the acceptance tests only (real agents need no reference solution)
            git(work, "checkout", "-q", "-b", f"ref/{t['id']}", "main")
            for path, content in t["acceptance_tests"].items():
                os.makedirs(os.path.dirname(os.path.join(work, path)), exist_ok=True)
                with open(os.path.join(work, path), "w") as fh:
                    fh.write(content)
            git(work, "add", "-A")
            git(work, "commit", "-q", "-m", t["title"])
        git(work, "checkout", "-q", "main")
        git(tmp, "clone", "-q", "--bare", work, REPO)
    print(f"arena: {ARENA}\nrepo: {REPO}")


if __name__ == "__main__":
    main()
