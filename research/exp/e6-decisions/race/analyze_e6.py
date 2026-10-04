#!/usr/bin/env python3
"""E6 comparison tables: greens, k-th green, cost by kind, decisions, coupling detection, correctness.

Usage: python3 analyze_e6.py runs/<a> runs/<b> ... [--k 20 30 35 38 40] [--md out.md]

Works on v2 runs (events only) and E6 runs (events, summary.json, decisions.jsonl). Reads ``uptime.txt`` in a run
directory when present (the machine load recorded at the start and end of the race).
"""
from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from kth_green import cost_at, green_times, load  # noqa: E402

DESIGNED = [("t002", "t022"), ("t005", "t031"), ("t011", "t018"), ("t023", "t036"), ("t028", "t032")]
NATURAL = [("t005", "t032"), ("t032", "t033"), ("t003", "t023")]
KINDS = ("initial", "rework", "reexec", "rescue", "author", "fixer")


def final_green_times(ev: list[dict], summary: dict) -> list[tuple[float, str]]:
    """(t, task) of the LAST time each finally-green task became green (a reverted green does not count)."""
    last: dict[str, float] = {}
    for e in ev:
        if e["type"] == "green.promote":
            for t in e.get("tasks") or []:
                last[t] = e["t"]
        elif e["type"] in ("task.green", "land") and e.get("target") == "main" and e.get("task"):
            last[e["task"]] = e["t"]
    final = {tid for tid, v in (summary.get("per_task") or {}).items() if v.get("status") == "green"}
    return sorted((t, tid) for tid, t in last.items() if not final or tid in final)


def race_start(ev: list[dict]) -> float:
    return next((e["t"] for e in ev if e["type"] == "race.start"), 0.0)


def cards(ev: list[dict]) -> list[dict]:
    out = []
    made = {e.get("card"): e for e in ev if e["type"] == "decision.made"}
    for e in ev:
        if e["type"] != "decision.request":
            continue
        m = made.get(e.get("card"), {})
        landed = e.get("landed") or (e.get("against") or [None])[0]
        arriving = e.get("arriving") or e.get("task")
        out.append({"card": e.get("card"), "t": e["t"], "pair": tuple(sorted((landed, arriving))), "landed": landed,
                    "arriving": arriving, "trigger": e.get("trigger", "preland"), "winner": m.get("winner"),
                    "loser": m.get("loser"), "outcome": m.get("outcome") or ("declined" if m else None),
                    "mode": m.get("mode", "oracle"), "wait": m.get("wait_seconds")})
    return out


def interactions(ev: list[dict], a: str, b: str) -> dict:
    """How a coupled pair met in the run: pre-land reds naming the other, validation reds, informed reworks."""
    reds = [e for e in ev if e["type"] == "rework.start" and e.get("reason") == "preland-red"
            and ((e.get("task") == a and b in (e.get("culprits") or [])) or
                 (e.get("task") == b and a in (e.get("culprits") or [])))]
    return {"informed_reworks_naming_partner": len(reds)}


def status_of(summary: dict, tid: str) -> str:
    return ((summary.get("per_task") or {}).get(tid) or {}).get("status", "?")


def cost_by_kind(ev: list[dict]) -> dict[str, float]:
    out: dict[str, float] = {}
    for e in ev:
        if e["type"] == "invocation.end":
            out[e.get("kind", "?")] = out.get(e.get("kind", "?"), 0.0) + (e.get("cost_usd") or 0.0)
    return out


def count_by_kind(ev: list[dict]) -> dict[str, int]:
    out: dict[str, int] = {}
    for e in ev:
        if e["type"] == "invocation.end":
            out[e.get("kind", "?")] = out.get(e.get("kind", "?"), 0) + 1
    return out


def uptime(run: str) -> str:
    p = os.path.join(run, "uptime.txt")
    if not os.path.exists(p):
        return "-"
    with open(p) as fh:
        lines = [ln.strip() for ln in fh if "load average" in ln]
    loads = [ln.split("load averages:")[-1].strip().split()[0] if "load averages:" in ln else ln for ln in lines]
    return " → ".join(loads) or "-"


def kth(ev: list[dict], times: list[tuple[float, str]], k: int) -> str:
    if len(times) < k:
        return "not reached"
    t = times[k - 1][0]
    return f"{(t - race_start(ev)) / 60:.1f} / {cost_at(ev, t):.2f}"


def table(head: list[str], rows: list[list[str]]) -> str:
    return "\n".join(["| " + " | ".join(head) + " |", "|" + "---|" * len(head)] +
                     ["| " + " | ".join(r) + " |" for r in rows])


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("runs", nargs="+")
    ap.add_argument("--k", nargs="+", type=int, default=[20, 30, 35, 38, 40])
    ap.add_argument("--md")
    a = ap.parse_args()
    names, data = [], []
    for run in a.runs:
        ev, s = load(run)
        names.append(os.path.basename(run.rstrip("/")))
        data.append((run, ev, s))
    parts = []

    # 1. headline
    rows = []
    for name, (run, ev, s) in zip(names, data):
        fc = s.get("final") or {}
        st = s.get("beanstalk") or {}
        first = green_times(ev)
        final = final_green_times(ev, s)
        rows.append([name, str(st.get("variant", s.get("policy"))), str(s.get("tasks_green")),
                     str(s.get("tasks_dropped")), "; ".join(f"{k} {v}" for k, v in (s.get("drops_by_reason") or {}).items()) or "-",
                     f"{(s.get('wall_seconds') or 0) / 60:.1f}", f"{s.get('cost_usd', 0):.2f}",
                     str(len(cards(ev))), str(s.get("red_validations")), str(fc.get("correct")),
                     str(fc.get("correct_canonical", fc.get("correct"))), uptime(run)])
    parts.append("### Headline\n\n" + table(
        ["run", "variant", "greens", "dropped", "drops", "wall min", "cost $", "cards", "red validations",
         "correct (effective)", "correct (canonical)", "load avg start → end"], rows))

    # 2. k-th green, first-green and final-green clocks
    rows = []
    for name, (run, ev, s) in zip(names, data):
        first, final = green_times(ev), final_green_times(ev, s)
        rows.append([name] + [kth(ev, first, k) for k in a.k] + [kth(ev, final, k) for k in a.k if k >= 35])
    parts.append("### Minutes / $ to the k-th green\n\nFirst-green clock (`kth_green.py`), then the final-green clock "
                 "(a task's last promotion, only tasks green at the end) for the tail.\n\n" + table(
                     ["run"] + [f"{k}th" for k in a.k] + [f"{k}th (final clock)" for k in a.k if k >= 35], rows))

    # 3. cost by kind
    rows = []
    for name, (run, ev, s) in zip(names, data):
        c, n = cost_by_kind(ev), count_by_kind(ev)
        rows.append([name] + [f"{n.get(k, 0)} / {c.get(k, 0.0):.2f}" for k in KINDS] + [f"{sum(c.values()):.2f}"])
    parts.append("### Invocations / cost by kind\n\n" + table(["run"] + list(KINDS) + ["total $"], rows))

    # 4. decisions
    for name, (run, ev, s) in zip(names, data):
        cs = cards(ev)
        if not cs:
            continue
        amend = {(e.get("task"), e.get("card")): e for e in ev if e["type"] == "spec.amend"}
        none_ = {(e.get("task"), e.get("card")) for e in ev if e["type"] == "spec.amend.none"}
        rej = {(e.get("task"), e.get("card")) for e in ev if e["type"] == "spec.amend.rejected"}
        rows = []
        for c in cs:
            loser = c["loser"]
            am = "amended" if (loser, c["card"]) in amend else "none needed" if (loser, c["card"]) in none_ else \
                "rejected" if (loser, c["card"]) in rej else "-"
            reex = [e for e in ev if e["type"] == "reexec.start" and e.get("card") == c["card"]]
            rows.append([c["card"], f"{c['t'] / 60:.1f}", f"{c['arriving']} meets {c['landed']}", c["trigger"],
                         str(c["mode"]), str(c["winner"]), str(c["outcome"]), am, str(len(reex)),
                         f"{status_of(s, c['arriving'])} / {status_of(s, c['landed'])}"])
        parts.append(f"### Decisions in {name}\n\n" + table(
            ["card", "min", "pair", "trigger", "mode", "winner", "outcome", "loser's tests", "re-executions",
             "final status arriving / landed"], rows))

    # 5. couplings: detected vs designed
    for name, (run, ev, s) in zip(names, data):
        cs = {c["pair"]: c for c in cards(ev)}
        rows = []
        for pair, label in [(p, "designed") for p in DESIGNED] + [(p, "natural") for p in NATURAL]:
            c = cs.get(tuple(sorted(pair)))
            it = interactions(ev, *pair)
            rows.append([f"{pair[0]}/{pair[1]}", label, f"{c['card']} ({c['trigger']}, {c['outcome']})" if c else "no card",
                         str(it["informed_reworks_naming_partner"]),
                         f"{status_of(s, pair[0])} / {status_of(s, pair[1])}"])
        other = [c for p, c in cs.items() if p not in {tuple(sorted(x)) for x in DESIGNED + NATURAL}]
        for c in other:
            rows.append([f"{c['pair'][0]}/{c['pair'][1]}", "other", f"{c['card']} ({c['trigger']}, {c['outcome']})",
                         "-", f"{status_of(s, c['pair'][0])} / {status_of(s, c['pair'][1])}"])
        detected = sum(1 for p in DESIGNED if tuple(sorted(p)) in cs)
        parts.append(f"### Couplings in {name}: {detected} of 5 designed detected\n\n" + table(
            ["pair", "kind", "card", "informed reworks naming the partner", "final status"], rows))

    # 6. correctness detail
    rows = []
    for name, (run, ev, s) in zip(names, data):
        fc = s.get("final") or {}
        rows.append([name, str(fc.get("suite_green")), f"{fc.get('green_tasks_accepted')} / {fc.get('green_tasks')}",
                     f"{fc.get('green_tasks_accepted_canonical', fc.get('green_tasks_accepted'))} / {fc.get('green_tasks')}",
                     ", ".join(fc.get("amended_tasks") or []) or "-",
                     ", ".join(fc.get("canonical_failures_unexplained") or []) or "none",
                     str(fc.get("committed_tests_intact", "-"))])
    parts.append("### Final correctness\n\n" + table(
        ["run", "suite green", "green tasks passing effective tests", "green tasks passing canonical tests",
         "amended tasks", "unexplained canonical failures", "committed tests intact"], rows))

    out = "\n\n".join(parts) + "\n"
    print(out)
    if a.md:
        with open(a.md, "w", encoding="utf-8") as fh:
            fh.write(out)


if __name__ == "__main__":
    main()
