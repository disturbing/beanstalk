#!/usr/bin/env python3
"""Compare race runs: one table (markdown + CSV) and a timeline CSV per run.

  python3 report.py runs/q-sonnet runs/bs-sonnet [--out runs/compare-sonnet]

The table's "x baseline" column divides each run's changes-reaching-green per hour by the first queue
run's (the step-4 kill condition is < 1.5x). Each run's timeline.csv (written next to its events.jsonl,
or into --out) has one row per event with running counters: landed, green, open reds, queue depth,
agents busy, CI runs in flight and cumulative cost.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

COLUMNS = [
    ("run", lambda s, r: os.path.basename(r)),
    ("policy", lambda s, r: s["policy"]),
    ("agent", lambda s, r: s["agent"] + (f" ({s['model']})" if s.get("model") and s["agent"] != "replay" else "")),
    ("N", lambda s, r: s["config"]["agents"]),
    ("K", lambda s, r: s["config"]["ci_slots"]),
    ("S", lambda s, r: s["config"]["ci_seconds"]),
    ("k", lambda s, r: s["config"].get("batch") or "-"),
    ("green/total", lambda s, r: f"{s['tasks_green']}/{s['tasks']}"),
    ("green per hour", lambda s, r: s["changes_green_per_hour"]),
    ("x baseline", None),
    ("all-green min", lambda s, r: _min(s["wall_to_all_green_seconds"])),
    ("start-to-green median min", lambda s, r: _min(s["task_start_to_green_seconds"]["median"])),
    ("agent busy/blocked/idle min", lambda s, r: "/".join(str(s["agent_minutes"][k]) for k in ("busy", "blocked", "idle"))),
    ("invocations i/r/f", lambda s, r: "/".join(str(s["invocations"].get(k, 0)) for k in ("initial", "rework", "fixer"))),
    ("cost USD", lambda s, r: s["cost_usd"]),
    ("repair cost USD", lambda s, r: round(s["cost_by_kind"].get("rework", 0) + s["cost_by_kind"].get("fixer", 0), 4)),
    ("CI runs", lambda s, r: s["ci_runs_total"]),
    ("CI min", lambda s, r: s["ci_minutes_total"]),
    ("textual conflicts", lambda s, r: s["textual_conflicts"]),
    ("red validations", lambda s, r: s["red_validations"]),
    ("final correct", lambda s, r: s["final"].get("correct")),
    ("footprint F1", lambda s, r: (s["footprint_quality"].get("vs_actual") or {}).get("f1", "-")),
    ("aborted", lambda s, r: s["aborted"] or "-"),
]


def _min(seconds) -> str:
    return "-" if seconds is None else f"{seconds / 60:.1f}"


def load(run: str) -> dict:
    with open(os.path.join(run, "summary.json")) as fh:
        return json.load(fh)


def table(runs: list[str]) -> tuple[list[str], list[list]]:
    summaries = [load(r) for r in runs]
    base = next((s["changes_green_per_hour"] for s in summaries if s["policy"] == "queue"), None)
    header = [c for c, _ in COLUMNS]
    rows = []
    for s, r in zip(summaries, runs):
        row = []
        for name, fn in COLUMNS:
            if name == "x baseline":
                gph = s["changes_green_per_hour"]
                row.append(f"{gph / base:.2f}" if base and gph is not None else "-")
            else:
                try:
                    row.append(fn(s, r))
                except (KeyError, TypeError):
                    row.append("-")
        rows.append(row)
    return header, rows


def timeline(run: str, dest: str) -> int:
    """One row per event with running counters."""
    landed = green = open_reds = depth = busy = ci = 0
    cost = 0.0
    n = 0
    with open(os.path.join(run, "events.jsonl")) as fh:
        lines = fh.read().splitlines()
    t_start = next((json.loads(x)["t"] for x in lines if '"race.start"' in x), 0.0)
    with open(dest, "w", newline="") as out:
        w = csv.writer(out)
        w.writerow(["t_seconds_since_start", "event", "task", "agent", "detail", "landed", "green", "open_reds", "queue_depth",
                    "agents_busy", "ci_running", "cost_usd"])
        for line in lines:
            e = json.loads(line)
            typ = e["type"]
            detail = ""
            if typ == "land":
                landed += 1 if e.get("kind", "task") == "task" else 0
                detail = e.get("target", "")
            elif typ == "green.promote":
                green += len(e.get("tasks") or [])
                detail = ",".join(e.get("tasks") or [])
            elif typ in ("ticket.open", "ticket.bisect"):
                open_reds += 1 if typ == "ticket.bisect" or not _bisected(e) else 0
                detail = ",".join(e.get("failing") or [])
            elif typ in ("ticket.close", "ticket.escalate"):
                open_reds = max(open_reds - 1, 0)
                detail = e.get("how") or e.get("why") or ""
            elif typ == "queue.enqueue":
                depth += 1
            elif typ == "batch.start":
                depth -= len(e.get("tasks") or [])
                detail = " ".join(e.get("tasks") or [])
            elif typ == "batch.cancel":
                depth += len(e.get("tasks") or [])
            elif typ == "bisect.end":
                depth += len(e.get("requeued") or [])
                detail = f"culprit {e.get('culprit')}"
            elif typ == "invocation.start" and e.get("kind") != "classifier":
                busy += 1
                detail = e.get("kind", "")
            elif typ == "invocation.end":
                if e.get("kind") != "classifier":
                    busy = max(busy - 1, 0)
                cost = e.get("spent_usd", cost)
                detail = f"{e.get('kind')} ${e.get('cost_usd', 0):.4f}"
            elif typ == "ci.start":
                ci += 1
                detail = e.get("purpose", "")
            elif typ == "ci.end":
                ci = max(ci - 1, 0)
                detail = f"{e.get('purpose')} {'green' if e.get('green') else 'cancelled' if e.get('cancelled') else 'red'}"
            elif typ == "merge.conflict":
                detail = ",".join(e.get("files") or [])
            agent = e.get("agent") if typ != "race.start" else ""
            w.writerow([round(e["t"] - t_start, 3), typ, e.get("task") or e.get("ticket") or "", agent or "", detail, landed,
                        green, open_reds, max(depth, 0), busy, ci, round(cost, 4)])
            n += 1
    return n


def _bisected(e: dict) -> bool:
    """A ticket that was bisected first was already counted at ticket.bisect."""
    return e.get("method") == "bisect"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], epilog=__doc__.split("\n\n", 1)[1],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("runs", nargs="+", help="run directories (relative paths resolve against research/race/)")
    ap.add_argument("--out", help="directory for compare.md, compare.csv and <run>-timeline.csv")
    a = ap.parse_args(argv)
    runs = [r if os.path.isabs(r) else os.path.join(HERE, r) if not os.path.exists(r) else os.path.abspath(r)
            for r in a.runs]
    missing = [r for r in runs if not os.path.exists(os.path.join(r, "summary.json"))]
    if missing:
        print(f"no summary.json in: {', '.join(missing)}", file=sys.stderr)
        return 1
    header, rows = table(runs)
    md = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    md += ["| " + " | ".join(str(c) for c in row) + " |" for row in rows]
    labels = [load(r)["label"] for r in runs]
    text = "\n".join(md) + "\n\n" + "\n".join(f"- {os.path.basename(r)}: {lab}" for r, lab in zip(runs, labels)) + "\n"
    print(text)
    out = None
    if a.out:
        out = a.out if os.path.isabs(a.out) else os.path.join(HERE, a.out)
        os.makedirs(out, exist_ok=True)
        with open(os.path.join(out, "compare.md"), "w") as fh:
            fh.write(text)
        with open(os.path.join(out, "compare.csv"), "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(header)
            w.writerows(rows)
    for r in runs:
        dest = os.path.join(out, f"{os.path.basename(r)}-timeline.csv") if out else os.path.join(r, "timeline.csv")
        n = timeline(r, dest)
        print(f"timeline: {dest} ({n} rows)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
