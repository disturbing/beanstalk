#!/usr/bin/env python3
"""Capacity arithmetic, not a simulation or a measured Beanstalk benchmark.

Prints JSON only; never starts agents, CI, deployments, or network requests.
The defaults are hypothetical. Run --help to vary the assumptions.
"""

import argparse
import json
import math


def positive(text):
    value = float(text)
    if not math.isfinite(value) or value <= 0:
        raise argparse.ArgumentTypeError("must be finite and greater than zero")
    return value


def fraction(text):
    value = positive(text)
    if value > 1:
        raise argparse.ArgumentTypeError("must be at most one")
    return value


def whole(text):
    value = positive(text)
    if not value.is_integer():
        raise argparse.ArgumentTypeError("must be a whole number")
    return int(value)


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--writers", nargs="+", type=whole, default=[30, 100, 300, 1000])
    parser.add_argument("--ready-width", type=whole, default=1000)
    parser.add_argument("--mean-work-minutes", type=positive, default=20)
    parser.add_argument("--validation-seconds", type=positive, default=75)
    parser.add_argument("--beans-per-validation", type=whole, default=25)
    parser.add_argument("--validation-rounds", type=positive, default=1.2)
    parser.add_argument("--target-utilization", type=fraction, default=0.75)
    parser.add_argument("--push-seconds", type=positive, default=1)
    parser.add_argument("--other-commit-seconds-per-bean", type=positive, default=0.03)
    parser.add_argument("--beans-per-push", type=whole, default=1)
    parser.add_argument("--decision-share", type=fraction, default=0.05)
    parser.add_argument("--decision-minutes", type=positive, default=3)
    parser.add_argument("--beans-resolved-per-decision", type=whole, default=1)
    parser.add_argument("--human-minutes-per-hour", type=positive, default=48)
    return parser.parse_args()


def capacity(writers, args):
    active = min(writers, args.ready_width)
    beans_per_minute = active / args.mean_work_minutes
    validation_slot_minutes_per_minute = (
        beans_per_minute
        * args.validation_rounds
        * args.validation_seconds
        / (60 * args.beans_per_validation)
    )
    commit_seconds_per_minute = beans_per_minute * (
        args.push_seconds / args.beans_per_push + args.other_commit_seconds_per_bean
    )
    human_minutes_per_hour = (
        beans_per_minute
        * 60
        * args.decision_share
        * args.decision_minutes
        / args.beans_resolved_per_decision
    )
    return {
        "writer_slots": writers,
        "writers_limited_by_ready_width": active,
        "candidate_beans_per_hour": round(beans_per_minute * 60, 3),
        "validation_slots_needed_at_target_utilization": math.ceil(
            validation_slot_minutes_per_minute / args.target_utilization
        ),
        "committer_utilization_demand": round(commit_seconds_per_minute / 60, 4),
        "committer_above_target": commit_seconds_per_minute / 60 > args.target_utilization,
        "human_minutes_per_hour": round(human_minutes_per_hour, 3),
        "humans_needed_at_stated_budget": math.ceil(
            human_minutes_per_hour / args.human_minutes_per_hour
        ),
        "beans_produced_during_one_validation": round(
            beans_per_minute * args.validation_seconds / 60, 3
        ),
    }


def main():
    args = parse_args()
    output = {
        "kind": "hypothetical capacity arithmetic; not observed throughput",
        "assumptions": vars(args),
        "caveats": [
            "Mean work duration, not median; one candidate bean per completed writing task.",
            "Ready width is assumed fixed; true dependencies and model failures are not simulated.",
            "Validation batches count distinct newly evidenced beans, not repeat head coverage.",
            "Validation duration is assumed constant at the selected batch size.",
            "Rounds price repeat validation; pre-land checks and separate repair jobs are excluded.",
            "Push grouping assumes full groups without batch-fill delays.",
            "A human answer settles multiple beans only when they share the same scoped question.",
            "Queueing tails, context cost, runner startup, and end-to-end acceptance are not modeled.",
        ],
        "rows": [capacity(writers, args) for writers in args.writers],
    }
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
