#!/usr/bin/env python3
"""E3: re-derive every flake of a finished race from (seed, sha, purpose, attempt) and compare with what was injected.

Usage: python3 verify_draws.py runs/<race> [...]

Reads the race's events and its flake.config (rate, seed), recomputes the draw of every pre-land check, validation, culprit
probe and batch, and checks that exactly the runs whose draw fired on a really green tree are the ones that flaked. A draw
that fires on a tree that was really red changes nothing (only green runs are flipped) and is reported separately.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness.flake import Flaker, FlakeConfig  # noqa: E402


def verify(run: str) -> dict:
    with open(os.path.join(run, "events.jsonl"), encoding="utf-8") as fh:
        ev = [json.loads(line) for line in fh if line.strip()]
    cfg = next(e for e in ev if e["type"] == "flake.config")
    f = Flaker(FlakeConfig(rate=cfg["rate"], seed=cfg["seed"], purposes=tuple(
        cfg["purposes"]) if isinstance(cfg.get("purposes"), list) else ()))
    limit = int(cfg.get("limit") or 0)           # FLAKE_LIMIT (tests and probes): injection stops after this many flakes
    runs = fired = injected = missed = spurious = fired_on_red = 0
    for e in ev:
        if e["type"] == "preland.check":
            purpose = "preland"
        elif e["type"] == "ci.end" and e.get("green") is not None and e.get("purpose") != "final":
            purpose = e["purpose"]
        else:
            continue
        runs += 1
        draw = f.fires(e["sha"], purpose, e.get("attempt", 0))
        fired += draw
        if e.get("flaked"):
            injected += 1
            spurious += 0 if draw else 1        # injected although the draw did not fire
        elif draw:
            if e.get("green") and not (limit and injected >= limit):
                missed += 1                      # fired on a green tree but nothing was injected
            else:
                fired_on_red += 1                # fired on a really red tree: nothing to flip
    return {"run": os.path.basename(run.rstrip("/")), "rate": cfg["rate"], "seed": cfg["seed"], "runs": runs, "draws_fired": fired,
            "injected": injected, "fired_on_real_red": fired_on_red, "mismatches": missed + spurious}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("runs", nargs="+")
    a = ap.parse_args()
    bad = 0
    for r in a.runs:
        v = verify(r)
        bad += v["mismatches"]
        print(v)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
