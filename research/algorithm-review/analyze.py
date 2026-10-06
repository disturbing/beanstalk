#!/usr/bin/env python3
"""Summarize existing Cloudflare runs without starting jobs or changing them."""

import json
from collections import Counter
from pathlib import Path


RUNS = Path(__file__).resolve().parents[1] / "race" / "runs"
SEEDS = (7, 11, 13)


def inspect_run(arm, seed, agents=12):
    name = f"cf-{arm}-sonnet-{agents}-s{seed}"
    if arm == "queue" and seed == 7 and agents == 12:
        name += "-landed"
    directory = RUNS / name
    summary = json.loads((directory / "summary.json").read_text())
    events = [json.loads(line) for line in (directory / "events.jsonl").read_text().splitlines()]
    starts = [event["t"] for event in events if event["type"] == "race.start"]
    ends = [event["t"] for event in events if event["type"] == "race.end"]
    greens = {}
    for event in events:
        if event["type"] == "green.promote":
            for task in event["tasks"]:
                greens.setdefault(task, event["t"])
    green_times = sorted(greens.values())
    preland = [event for event in events if event["type"] == "preland.check"]
    probes = [event for event in events if event["type"] == "culprit.dynamic"]
    checks = [event for event in events if event["type"] in ("preland.check", "ci.end")]
    shas = Counter(event["sha"] for event in checks)
    positive = [event for event in probes if event["confirmed"]]
    # These are repeated *SHAs*, not proven cache hits: the logs omit some check inputs.
    return {
        "run": name,
        "green": summary["tasks_green"],
        "dropped": summary["tasks_dropped"],
        "parked_events": sum(event["type"] == "task.parked" for event in events),
        "cost_usd": summary["cost_usd"],
        "cost_by_kind": summary["cost_by_kind"],
        "wall_minutes": round(summary["wall_seconds"] / 60, 3),
        "green35_event_minutes": round(green_times[34] / 60, 3),
        "green35_since_start_minutes": round((green_times[34] - starts[0]) / 60, 3),
        "last_green_event_minutes": round(green_times[-1] / 60, 3),
        "last_green_to_end_minutes": round((ends[-1] - green_times[-1]) / 60, 3),
        "final_correct": summary["final"]["correct"],
        "preland_checks": len(preland),
        "rechecks": sum(event["type"] == "preland.recheck" for event in events),
        "preland_suite_seconds": round(sum(event.get("suite_seconds", 0) for event in preland), 3),
        "preland_check_seconds": round(sum(event.get("check_seconds", 0) for event in preland), 3),
        "probe_searches": len(probes),
        "probes": sum(len(event["candidates"]) for event in probes),
        "positive_searches": len(positive),
        "confirmed_culprits": dict(Counter(task for event in positive for task in event["confirmed"])),
        "same_sha_check_excess": sum(count - 1 for count in shas.values()),
    }


def main():
    rows = [inspect_run(arm, seed) for arm in ("queue", "v25dep2") for seed in SEEDS]
    totals = {}
    for arm in ("queue", "v25dep2"):
        selected = [row for row in rows if row["run"].startswith(f"cf-{arm}-")]
        green = sum(row["green"] for row in selected)
        cost = sum(row["cost_usd"] for row in selected)
        totals[arm] = {
            "green": green,
            "cost_usd": round(cost, 4),
            "cost_per_green_usd": round(cost / green, 5),
            **{
                key: sum(row[key] for row in selected)
                for key in ("preland_checks", "rechecks", "probe_searches", "probes", "positive_searches", "same_sha_check_excess")
            },
        }
    scale = [inspect_run(arm, 7, 30) for arm in ("queue", "demo")]
    print(json.dumps({"runs": rows, "totals": totals, "thirty_agent_runs": scale}, indent=2))


if __name__ == "__main__":
    main()
