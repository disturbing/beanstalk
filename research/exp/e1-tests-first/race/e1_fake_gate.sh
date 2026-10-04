#!/bin/bash
# Free check of the e1 code paths with the fake Claude CLI (tests/fake_claude.py: no network, no cost), run inside
# the race slot right before a paid race: tests-first (t012's first author session writes a vacuous test, so one
# proof is rejected and the resumed retry is accepted) and self-tests, 3 tasks, 2 agents. Exit 0 only if both match.
cd "$(dirname "$0")"
STATE=${TMPDIR:-/tmp}/e1-fake-state
export FAKE_CLAUDE_ARENA=$(cd ../arena && pwd -P) FAKE_CLAUDE_VACUOUS=t012
export PRELAND_MODE=optimistic PRELAND_SECONDS=1 DECISION_SECONDS=1 DECISION_ORACLE=landed PROOF_SECONDS=0 AUTHOR_ATTEMPTS=2
for arm in first self; do
  export FAKE_CLAUDE_STATE=$STATE-$arm
  rm -rf "$FAKE_CLAUDE_STATE"
  python3 race.py --policy beanstalk-v2 --tests $arm --agent claude --claude-bin tests/fake_claude.py --agents 2 \
    --tasks t001 t012 t017 --ci-seconds 1 --ci-slots 1 --seed 7 --protect-tests landed --snapshot head \
    --error-budget 999 --budget-usd 1 --max-wall-minutes 10 --out runs/_test-e1-$arm-fake --force \
    > runs/_test-e1-$arm-fake.log 2>&1 || { echo "gate: fake $arm race exited non-zero"; exit 1; }
done
python3 - <<'PY'
import json, sys
f = json.load(open("runs/_test-e1-first-fake/summary.json"))
s = json.load(open("runs/_test-e1-self-fake/summary.json"))
b = f["beanstalk"]
checks = {
    "first not aborted": not f["aborted"], "self not aborted": not s["aborted"],
    "first 3 green": f["tasks_green"] == 3, "first 1 proof rejected": b["e1_proofs_rejected"] == 1,
    "first no author drop": b["e1_author_drops"] == 0, "first 4 author sessions": f["invocations"].get("testauthor") == 4,
    "first oracle correct": f["final"].get("correct") is True, "self 3 green": s["tasks_green"] == 3,
    "self oracle correct": s["final"].get("correct") is True,
}
bad = [k for k, v in checks.items() if not v]
print("gate:", "ok" if not bad else "FAILED " + ", ".join(bad))
sys.exit(1 if bad else 0)
PY
