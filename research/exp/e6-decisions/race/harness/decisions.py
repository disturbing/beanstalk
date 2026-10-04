"""E6 decision cards: the decision record, the per-coupling table, the oracles and the prompts.

A card is raised when two beans' specs meet and (probably) contradict: a known coupling partner has already landed
when a bean starts, or a pre-land check stays red against the same landed bean after informed reworks, or a trunk
validation goes red on a known coupling. The human (or an oracle) decides whose spec wins, and the LOSING bean is
re-executed under the winning spec instead of being declined:

  keep-landed     the landed bean's spec stands. The arriving bean is re-executed (a fresh session on a fresh fork
                  of the sprout) with the decision text and the winner's intent and diff.
  adopt-arriving  the arriving bean's spec wins. The landed bean is reverted from the sprout, the arriving bean lands,
                  and the reverted bean is re-executed against the new contract.

Before a loser is re-executed, a separate test-author session amends the loser's acceptance tests where they encode
the losing semantics (a spec amendment), with fail-first proof on the snapshot the loser re-executes from; the amended
tests become the loser's protected acceptance tests.

Oracles (who wins):
  landed    keep-landed, always (the "keep-landed-adapt" race).
  contract  the bean that changes the shared contract wins: documented per coupling in the table (from the arena's
            coupling notes), else inferred from the red (if the landed bean's acceptance tests fail, the arriving bean
            changed the behaviour they rely on; if only the arriving bean's own tests fail, the landed bean did).
  table     the documented per-coupling choice (a product owner's call, with its decision text), else ``contract``.
  decline   v2's behaviour: keep-landed and drop the arriving bean (no re-execution); for regression tests only.
"""
from __future__ import annotations

import difflib
import json
import os
from dataclasses import asdict, dataclass, field

from .arena import Task
from .prompts import NO_COMMIT, acceptance_line

ORACLES = ("landed", "contract", "table", "decline")
OUTCOMES = ("keep-landed", "adopt-arriving")


def pair_key(a: str, b: str) -> tuple[str, str]:
    return (a, b) if a <= b else (b, a)


@dataclass
class TableEntry:
    tasks: tuple[str, str]
    source: str = "designed"            # designed | natural
    contract: str | None = None         # the bean that changes the shared contract
    contradiction: bool = True          # False: both canonical suites can hold (the arriving bean just adapts)
    contract_note: str = ""
    specs: dict = field(default_factory=dict)      # task -> one-line spec
    winner: str | None = None           # the documented per-coupling choice (table oracle)
    rationale: str = ""
    texts: dict = field(default_factory=dict)      # winner -> decision text
    adapt: list = field(default_factory=list)      # winners whose decision keeps both contracts: no revert


class DecisionTable:
    """``decisions/table.json``: per-coupling documentation for oracles and cards (never shown to agents)."""

    def __init__(self, entries: list[TableEntry] | None = None, path: str | None = None):
        self.path = path
        self.entries = {pair_key(*e.tasks): e for e in (entries or [])}

    @classmethod
    def load(cls, path: str | None) -> "DecisionTable":
        if not path or not os.path.exists(path):
            return cls([], path)
        with open(path, encoding="utf-8") as fh:
            raw = json.load(fh)
        entries = []
        for e in raw.get("pairs", []):
            a, b = e["tasks"]
            entries.append(TableEntry(tasks=(a, b), source=e.get("source", "designed"), contract=e.get("contract"),
                                      contradiction=bool(e.get("contradiction", True)),
                                      contract_note=e.get("contract_note", ""), specs=dict(e.get("specs", {})),
                                      winner=e.get("winner"), rationale=e.get("rationale", ""),
                                      texts=dict(e.get("texts", {})), adapt=list(e.get("adapt", []))))
        return cls(entries, path)

    def get(self, a: str, b: str) -> TableEntry | None:
        return self.entries.get(pair_key(a, b))


@dataclass
class Decision:
    card: str
    pair: tuple[str, str]
    trigger: str                  # start | preland | validation
    landed: str                   # the bean already on the sprout when the card was raised
    arriving: str                 # the bean that met it
    known: bool                   # a declared coupling (the prior)
    source: str                   # designed | natural | unknown (from the table)
    specs: dict
    failing: list
    requested_at: float
    url: str | None = None
    mode: str = ""                # oracle | human | human-timeout
    oracle: str = ""
    recommended: str = ""         # what the oracle would pick (shown on the card)
    winner: str = ""
    loser: str = ""
    outcome: str = ""             # keep-landed | adopt-arriving
    text: str = ""
    custom_text: bool = False
    contract_changer: str | None = None
    decided_at: float | None = None
    wait_seconds: float = 0.0
    status: str = "open"          # open | decided | applied | moot
    applied: list = field(default_factory=list)       # [{t, at, how}]
    amendments: list = field(default_factory=list)    # [{task, status, paths, inv, cost_usd}]
    reexecutions: list = field(default_factory=list)  # [{task, inv, kind, cost_usd}]

    def record(self) -> dict:
        return asdict(self)


def heuristic_changer(landed: Task, arriving: Task, failing_files: list[str] | None) -> str | None:
    """Who changed the contract, judged from a red: failing tests of the landed bean mean the arriving bean changed
    behaviour they rely on; failing tests of the arriving bean only mean the landed bean did."""
    failing = set(failing_files or [])
    if failing & set(landed.acceptance_tests):
        return arriving.id
    if failing & set(arriving.acceptance_tests):
        return landed.id
    return None


def oracle_choice(oracle: str, *, landed: Task, arriving: Task, entry: TableEntry | None,
                  failing_files: list[str] | None) -> tuple[str, str | None]:
    """(winner, contract changer) for one card."""
    changer = (entry.contract if entry and entry.contract else None) or heuristic_changer(landed, arriving,
                                                                                       failing_files)
    if oracle in ("landed", "decline"):
        return landed.id, changer
    if oracle == "table" and entry and entry.winner in (landed.id, arriving.id):
        return entry.winner, changer
    if oracle in ("contract", "table") and changer in (landed.id, arriving.id):
        return changer, changer
    return landed.id, changer


def outcome_for(winner: str, landed: str, entry: TableEntry | None) -> str:
    """keep-landed unless the arriving bean wins a real contradiction (then the landed bean is reverted)."""
    if winner == landed:
        return "keep-landed"
    if entry and (not entry.contradiction or winner in entry.adapt):
        return "keep-landed"   # both contracts hold: the arriving bean adapts, nothing is reverted
    return "adopt-arriving"


def one_line(task: Task, entry: TableEntry | None) -> str:
    if entry and entry.specs.get(task.id):
        return entry.specs[task.id]
    return task.title


def decision_text(winner: Task, loser: Task, entry: TableEntry | None, specs: dict) -> str:
    if entry and entry.texts.get(winner.id):
        return entry.texts[winner.id]
    return (f"Where the two specs disagree, {winner.id}'s behaviour stands: {specs.get(winner.id, winner.title)}. "
            f"{loser.id} ({loser.title}) must work with it; its acceptance tests are amended where they encode "
            "the other behaviour.")


# ---- prompts ------------------------------------------------------------------------------------------------------

def decision_block(d: Decision, winner_ctx: dict | None, me: str) -> list[str]:
    who = {"oracle": "decided by the product owner", "human": "decided by a human",
           "human-timeout": "decided by the product owner (default)"}.get(d.mode, "decided")
    lines = [f"Product decision {d.card} ({who}): {d.text}"]
    if winner_ctx and d.winner != me:
        lines += ["", f"{winner_ctx['task']} \"{winner_ctx['title']}\" is accepted behaviour on the trunk that your "
                      "change must work with.", f"Its intent: {winner_ctx['intent'].strip()}", "Its diff:", "```diff",
                  winner_ctx["diff"].strip(), "```"]
    return lines


REASONS = {
    "keep-landed": "Your earlier attempt was discarded because it contradicted that accepted behaviour. Implement your "
                   "task again on the current trunk, within the decision.",
    "adopt-arriving": "Your earlier change was reverted from the trunk so that {winner} could land with its spec. "
                      "Implement your task again on the current trunk, against the new contract.",
    "start": "This decision was made before you started; implement your task within it.",
    "adapt": "Under this decision both behaviours hold. Implement your task again on the current trunk so that your "
             "acceptance tests and the other task's pass.",
    "winner": "Where the other task's accepted behaviour contradicts your spec, your spec wins: you do not need to keep "
              "its tests that encode the old behaviour passing (they will be amended and that task re-executed after "
              "you land). Keep every other test passing.",
    "revert": "Your earlier change was reverted from the trunk because the trunk's tests failed with it (see below). "
              "Implement your task again on the current trunk so that every test passes.",
    "repair": "Your change is on the trunk, but the trunk's tests fail with it (see below) and it could not be reverted "
              "cleanly. Starting from the current trunk, change the code so that your acceptance tests and everyone "
              "else's pass.",
    "rescue": "Your earlier attempts could not be landed: the trunk kept moving and the merged tree failed or "
              "conflicted. They were discarded. Implement your task again on the current trunk.",
    "winner-dropped": "A decision had made your task wait for another task, which was dropped. Implement your task "
                      "again on the current trunk under your original spec.",
}


def amended_line(amended: list[str]) -> list[str]:
    if not amended:
        return []
    return [f"Your acceptance tests were amended by the test author to match the decision ({', '.join(amended)}). "
            "They are your spec now.", ""]


def reexec_prompt(task: Task, d: Decision | None, winner_ctx: dict | None, reason: str, amended: list[str],
                  extra: list[str] | None = None) -> str:
    """Prompt for a re-execution (fresh session, fresh fork of the sprout): a decision's loser, a reverted bean, or
    a rescue after the rework budget ran out."""
    lines = [task.title, "", task.prompt.strip(), ""]
    if d is not None:
        lines += decision_block(d, winner_ctx, task.id) + [""]
    why = REASONS.get(reason, "").format(winner=d.winner if d else "another task")
    if why:
        lines += [why, ""]
    if extra:
        lines += extra + [""]
    lines += amended_line(amended) + [f"{acceptance_line(task.acceptance_paths)} {NO_COMMIT}"]
    return "\n".join(lines) + "\n"


def start_context(task: Task, d: Decision, winner_ctx: dict | None, amended: list[str]) -> str:
    """Initial prompt of a bean whose card was decided before it started."""
    lines = [task.title, "", task.prompt.strip(), ""] + decision_block(d, winner_ctx, task.id) + [""]
    lines += [REASONS["winner" if d.winner == task.id and d.outcome == "adopt-arriving" else "start"], ""]
    lines += amended_line(amended) + [f"{acceptance_line(task.acceptance_paths)} {NO_COMMIT}"]
    return "\n".join(lines) + "\n"


def author_prompt(loser: Task, d: Decision, winner_ctx: dict, failing: list[str], output: str,
                  in_force: list[str] | None = None) -> str:
    paths = ", ".join(loser.acceptance_paths)
    lines = [f"You are the test author for task {loser.id}. You write and amend acceptance tests; you never implement "
             "features.", "", f"A product decision was made ({d.card}): {d.text}", ""]
    if in_force:
        lines += [f"Earlier decisions about {loser.id} are still in force; the tests must stay consistent with them "
                  "too (keep what they decided, change only what this new decision changes):"] + \
                 [f"- {x}" for x in in_force] + [""]
    lines += [
             f"Task {loser.id} (\"{loser.title}\") was specified as:", loser.prompt.strip(), "",
             f"Its acceptance tests are in: {paths}. They were written before this decision.", "",
             f"The winning change, {winner_ctx['task']} (\"{winner_ctx['title']}\"), is already in this tree.",
             f"Its intent: {winner_ctx['intent'].strip()}", "Its diff:", "```diff", winner_ctx["diff"].strip(), "```"]
    if failing:
        lines += ["", f"When {loser.id}'s implementation met it, these tests failed:"] + [f"- {f}" for f in failing[:12]]
        if output.strip():
            lines += ["Output:", "```", output.strip()[:3000], "```"]
    lines += ["", f"Amend {loser.id}'s acceptance tests so that they encode the decided behaviour: change only the "
                  "assertions (and the setup they need) that contradict the decision, keep every other assertion and "
                  "the file structure, and do not edit any other file. Work out expected values from the code in this "
                  f"tree. {loser.id} is not implemented in this tree, so its tests must still fail here because the "
                  f"feature is missing: run `node --test {' '.join(loser.acceptance_paths)}` to check that they fail "
                  "for that reason and not because of a syntax error. If the tests encode nothing that contradicts "
                  "the decision, change nothing and reply NO AMENDMENT. Don't stage or commit."]
    return "\n".join(lines) + "\n"


def unified(before: str, after: str, path: str) -> str:
    return "".join(difflib.unified_diff(before.splitlines(keepends=True), after.splitlines(keepends=True),
                                        fromfile=f"a/{path}", tofile=f"b/{path}"))
