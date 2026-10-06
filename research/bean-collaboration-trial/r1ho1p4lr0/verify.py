"""Check the captured three-agent trial and rerun its unchanged app tests."""

import hashlib
import json
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parent
RUN = "r1ho1p4lr0"


def read(name):
    return json.loads((ROOT / name).read_text())


before = read("restart-before.json")
after = read("restart-after.json")
final = read("final-consumer-state.json")
for role, original_event, accepted_event in [("checkout", 10, 16), ("returns", 11, 17)]:
    assert before[role]["inbox"] == after[role]["inbox"]
    assert before[role]["inbox"]["unread"] == 2
    assert before[role]["context"]["reliance"] == after[role]["context"]["reliance"]
    assert after[role]["context"]["reliance"][0]["revision"] == 1
    assert after[role]["context"]["referenced_promises"][0]["revision"] == 1
    provider = next(peer for peer in after[role]["context"]["related_context"]["related"]
                    if peer["bean"] == "t001")
    assert any(status["reference"]["revision"] == 1 and status["status"] == "superseded"
               and status["current_revision"] == 2 for status in provider["promise_statuses"])
    context = final[role]["context"]
    assert context["reliance"][0]["revision"] == 2
    assert context["reliance"][0]["accepted_event"] == accepted_event
    assert final[role]["inbox"]["unread"] == 0
    history = {event["event_id"]: event for event in context["history"]}
    assert history[original_event]["post"]["references"][0]["revision"] == 1
    assert history[accepted_event]["post"]["references"][0]["revision"] == 2

requests = []
acceptances = []
for role in ["shipping", "checkout", "returns"]:
    journal = [json.loads(line) for line in (ROOT / f"{role}.jsonl").read_text().splitlines()]
    assert all(record["run"] == RUN for record in journal)
    assert any(record["tool"] == "bean_update" and not record["is_error"] for record in journal)
    for record in journal:
        if record["tool"] != "bean_thread_post" or record["is_error"]:
            continue
        post = record["output"]["post"]
        assert post["actor"] == f"trial-{role}"
        if post["kind"] == "request":
            requests.append(post["event_id"])
        if post["kind"] == "accept":
            acceptances.append(post["event_id"])
assert sorted(requests) == [3, 6]
assert sorted(acceptances) == [10, 11, 16, 17]

access = read("access-and-retry-verification.json")
assert access["exact_retry_replays_original"]
assert access["contributor_git_refused"]["status"] == 403
assert access["view_http_mutation_refused"]["status"] == 403
assert "bean_update" not in access["view_tool_names"]
assert read("restart-verification.json")["passed"]
manifest = read("app-manifest.json")
for relative, expected in manifest["files"].items():
    assert hashlib.sha256((ROOT / "app" / relative).read_bytes()).hexdigest() == expected
subprocess.run(["npm", "test"], cwd=ROOT / "app", check=True)
print("Captured MCP negotiation, restart recovery, scope checks and app tests verified.")
