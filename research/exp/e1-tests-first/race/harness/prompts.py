"""Prompts the harness sends. Initial prompts follow the study spec verbatim; follow-ups add the cause."""
from __future__ import annotations

from .arena import Task

NO_COMMIT = "Don't stage or commit; the harness commits your changes."


# e1 --tests self: no acceptance tests are given; the agent covers its change with its own tests
SELF_TESTS_LINE = ("Cover this change with tests next to the code it touches (node:test, `*.test.ts`, like the existing "
                   "tests). Make the whole suite pass. Run `node --test`. Keep changes minimal.")


def acceptance_line(paths: list[str]) -> str:
    if not paths:
        return SELF_TESTS_LINE
    return (f"Acceptance tests are in {', '.join(paths)}. Make them pass without breaking other tests. "
            "Run `node --test`. Don't edit the acceptance tests. Keep changes minimal.")


def test_author(task: Task) -> str:
    """e1 --tests first: a separate session writes the acceptance tests from the issue text alone."""
    return (
        "You write the acceptance tests for an issue before anyone implements it. Another engineer will implement "
        "the issue later, in a separate session, against your tests: they will not see your reasoning and cannot "
        "change your tests.\n\n"
        f"Issue: {task.title}\n\n{task.prompt.strip()}\n\n"
        "Add one new test file (node:test, `*.test.ts`) next to the code the issue is about, in the style of the "
        "existing tests and using their helpers (for example src/lib/testing.ts). Test the behaviour the issue asks "
        "for through the names it gives (functions, fields, routes, messages, statuses); don't assume other names or "
        "internal details. The tests must fail on the current code because the behaviour is missing, and pass once "
        "the issue is implemented correctly. Run `node --test <your file>` to check that the file loads and fails "
        "for that reason (a failed assertion or the missing export, not a mistake in the test).\n\n"
        "Don't implement the issue and don't change existing files: only new test files are kept, so any helper "
        f"must live inside your test file. {NO_COMMIT.replace('the harness commits your changes', 'the harness collects your file')}\n")


def test_author_retry(task: Task, problems: list[str], resumed: bool) -> str:
    head = "" if resumed else test_author(task) + "\n"
    lines = "\n".join(f"- {p}" for p in problems)
    return (f"{head}The harness ran your tests on the current code and did not accept them:\n{lines}\n\n"
            "Tests that pass before the issue is implemented prove nothing, and tests that cannot load, or that "
            "depend on a change outside the test file, cannot be met by the implementer. Revise your test file so "
            "that it loads, fails on the current code because the behaviour is missing, and will pass once the issue "
            "is implemented correctly. Same rules: only new test files are kept, helpers live inside the test file, "
            f"and don't implement the issue. {NO_COMMIT.replace('the harness commits your changes', 'the harness collects your file')}\n")


def initial(task: Task) -> str:
    return f"{task.title}\n\n{task.prompt.strip()}\n\n{acceptance_line(task.acceptance_paths)} {NO_COMMIT}\n"


def rework_conflict(task: Task, files: list[str], target: str, resumed: bool) -> str:
    head = "" if resumed else f"You are working on: {task.title}\n\n{task.prompt.strip()}\n\n"
    return (f"{head}Your change could not be merged: {target} moved on and conflicts with it. "
            f"The merge of {target} into your branch is in progress in this worktree; conflict markers are in: "
            f"{', '.join(files)}.\n\nResolve every conflict so that your change and the changes already on {target} "
            "both keep working, and remove all conflict markers. "
            f"{acceptance_line(task.acceptance_paths)} {NO_COMMIT}\n")


def rework_red(task: Task, failing: list[str], output: str, target: str, resumed: bool) -> str:
    head = "" if resumed else f"You are working on: {task.title}\n\n{task.prompt.strip()}\n\n"
    tests = "\n".join(f"- {t}" for t in failing) or "- (the suite failed; see the output)"
    return (f"{head}The merge queue rejected your change: merged with the latest {target} and the other queued "
            f"changes, these tests failed:\n{tests}\n\nOutput:\n```\n{output.strip()}\n```\n\n"
            f"The latest {target} has been merged into this worktree. Fix your change so the whole suite passes "
            "(your acceptance tests and everyone else's). Other teams' acceptance tests describe behaviour that "
            f"must keep working. {acceptance_line(task.acceptance_paths)} {NO_COMMIT}\n")


def fixer(ticket: dict, suspects: list[dict], acceptance: list[str]) -> str:
    lines = [f"The fast trunk is red. Repair ticket {ticket['id']} (attempt {ticket['attempt']}).", "",
             "Failing tests:"]
    lines += [f"- {t}" for t in ticket["failing_tests"]] or ["- (see output)"]
    lines += ["", "Output:", "```", ticket["output"].strip(), "```", ""]
    if suspects:
        lines.append("Suspect commits: unvalidated changes whose writes intersect what the failing tests read, plus any "
                     "change that landed after a suspect's snapshot and wrote the same code (marked):")
        for s in suspects:
            lines += [f"- {s['sha'][:10]} {s['label']}: {s['title']}", f"  Intent: {s['intent'].strip()}",
                      "  Diff:", "```diff", s["diff"].strip(), "```"]
    else:
        lines.append("No suspect could be isolated; the failure appeared between the last green commit and the head.")
    lines += ["", "Make the whole suite pass (`node --test`) with a minimal change that preserves the intent of "
              "every suspect change: don't revert features. Don't edit acceptance tests "
              f"({', '.join(acceptance) if acceptance else 'test files named in the tickets'}). {NO_COMMIT}"]
    return "\n".join(lines) + "\n"


CLASSIFIER_SCHEMA = {
    "type": "object",
    "properties": {"modules": {"type": "array", "items": {
        "type": "object",
        "properties": {"module": {"type": "string"}, "probability": {"type": "number"}},
        "required": ["module", "probability"]}}},
    "required": ["modules"],
}


def classifier(task_text: str, catalog: list[tuple[str, str]]) -> str:
    mods = "\n".join(f"- {m}: {desc}" for m, desc in catalog)
    return ("You predict which source modules a coding task will modify, before any code is written.\n\n"
            f"Modules (name: files and exported identifiers):\n{mods}\n\nTask:\n{task_text.strip()}\n\n"
            "Return every module from the list with the probability (0 to 1) that completing the task "
            "requires modifying a file in it. Use only module names from the list.\n")
