"""The fastify prompts fixture the gateway's prompt tests compare against (``packages/gateway/test/fixtures/
fastify-prompts.json``): the run config's ``suite`` as ``remote.py`` sends it, three fastify tasks as they are loaded
(task note appended), and the prompts this harness renders for them with the arena's suite active. The gateway must
render byte-identical prompts from the same suite, so both forges' agents read the same words.

    python3 gateway_fixture.py           # rewrite the fixture
    python3 gateway_fixture.py --check   # exit 1 when it is out of date (tests/test_suite.py runs this check)
"""
from __future__ import annotations

import json
import os
import sys

RACE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, RACE)

from harness import prompts, suite as suite_mod  # noqa: E402
from harness.arena import load_tasks  # noqa: E402
from harness.policy_beanstalk_preland import preland_red  # noqa: E402

ARENA = os.path.normpath(os.path.join(RACE, "..", "real-arena", "fastify"))
FIXTURE = os.path.normpath(os.path.join(RACE, "..", "..", "packages", "gateway", "test", "fixtures",
                                        "fastify-prompts.json"))
TASKS = ["t001", "t002", "t003"]
FAILING = ["test/route.6.pr6372.test.js > keeps working"]
OUTPUT = "not ok 1 - keeps working\n"


def build() -> dict:
    cfg = suite_mod.load_suite(ARENA)
    previous = suite_mod.ACTIVE
    suite_mod.activate(cfg)
    try:
        tasks = load_tasks(ARENA, TASKS, task_note=cfg.task_note)
        return {
            "generated_by": "research/race/gateway_fixture.py",
            "suite": suite_mod.gateway_suite(cfg),
            "suite_command": prompts.SUITE_COMMAND,
            "tasks": [{"id": t.id, "title": t.title, "prompt": t.prompt,
                       "acceptance_tests": {path: "" for path in t.acceptance_tests}} for t in tasks],
            "prompts": {t.id: {
                "initial": prompts.initial(t),
                "rework_conflict": prompts.rework_conflict(t, ["lib/route.js"], "main", False),
                "rework_red": prompts.rework_red(t, FAILING, OUTPUT, "main", True),
                "preland_red": preland_red(t, FAILING, OUTPUT, False),
            } for t in tasks},
            "failing": FAILING,
            "output": OUTPUT,
        }
    finally:
        suite_mod.activate(previous)


def main() -> int:
    fixture = build()
    if "--check" in sys.argv[1:]:
        with open(FIXTURE, encoding="utf-8") as fh:
            return 0 if json.load(fh) == fixture else 1
    os.makedirs(os.path.dirname(FIXTURE), exist_ok=True)
    with open(FIXTURE, "w", encoding="utf-8") as fh:
        json.dump(fixture, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"wrote {FIXTURE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
