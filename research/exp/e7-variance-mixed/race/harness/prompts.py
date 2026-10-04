"""Prompts the harness sends. Initial prompts follow the study spec verbatim; follow-ups add the cause."""
from __future__ import annotations

from .arena import Task

NO_COMMIT = "Don't stage or commit; the harness commits your changes."


def acceptance_line(paths: list[str]) -> str:
    return (f"Acceptance tests are in {', '.join(paths)}. Make them pass without breaking other tests. "
            "Run `node --test`. Don't edit the acceptance tests. Keep changes minimal.")


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
