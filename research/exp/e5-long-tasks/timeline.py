#!/usr/bin/env python3
"""Text Gantt chart of a race: one row per bean, one column per time step.

  python3 timeline.py RUN_DIR [--cols 110] [--out file.txt]

Symbols (later symbols overwrite earlier ones in the same column):
  a  an agent invocation is running (initial authoring; with emulated drift this includes the hold)
  w  rework invocation (conflict repair, informed repair, queue ejection)
  c  pre-land check running (v2) / queued behind a batch or waiting in the batch CI (queue: from enqueue to land)
  .  finished writing, waiting (no check running yet / between steps)
  L  landed on the sprout (v2) or the stalk (queue)
  G  promoted to green
  X  dropped
Events come from events.jsonl only (no transcripts needed). Time axis: minutes since race.start.
"""
from __future__ import annotations

import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from e5lib import green_times, load_run  # noqa: E402


def chart(run_dir: str, cols: int = 110) -> str:
    run = load_run(run_dir, transcripts=False)
    ev = run.events
    t0 = run.t0
    end = max(e["_epoch"] for e in ev) - t0
    step = max(end / cols, 1.0)
    ncol = int(end / step) + 1
    rows: dict[str, list[str]] = {}
    order = [e["task"] for e in ev if e["type"] == "task.start"]
    for t in order:
        rows[t] = [" "] * ncol

    def paint(task: str, a: float, b: float, ch: str) -> None:
        if task not in rows:
            return
        for c in range(max(0, int(a / step)), min(ncol, int(b / step) + 1)):
            rows[task][c] = ch

    for i in run.invocations:
        if i.task in rows:
            paint(i.task, i.start - t0, i.end - t0, "a" if i.kind == "initial" else "w")
    # waits: from the end of an invocation to the next thing
    last_end: dict[str, float] = {}
    for i in sorted(run.invocations, key=lambda i: i.start):
        if i.task in rows:
            last_end[i.task] = max(last_end.get(i.task, 0.0), i.end - t0)
    for e in ev:
        t = e["type"]
        if t == "preland.check" and e.get("task") in rows:
            paint(e["task"], e["_epoch"] - t0 - float(e.get("check_seconds") or 0), e["_epoch"] - t0, "c")
        elif t == "queue.enqueue" and e.get("task") in rows:
            rows[e["task"]][min(ncol - 1, int((e["_epoch"] - t0) / step))] = "c"
    for e in ev:
        t = e["type"]
        task = e.get("task")
        if t == "land" and task in rows:
            col = min(ncol - 1, int((e["_epoch"] - t0) / step))
            rows[task][col] = "L"
        elif t == "task.drop" and task in rows:
            rows[task][min(ncol - 1, int((e["_epoch"] - t0) / step))] = "X"
    for tt, task in green_times(ev):
        if task in rows:
            col = min(ncol - 1, int((run.t0 + tt - t0) / step))
            rows[task][col] = "G"
    # fill idle gaps between the first start and the last symbol with '.', so waiting is visible
    for task, r in rows.items():
        marks = [i for i, ch in enumerate(r) if ch != " "]
        if not marks:
            continue
        for i in range(marks[0], marks[-1]):
            if r[i] == " ":
                r[i] = "."
    ticks = [" "] * ncol
    m = 0
    while m * 60 / step < ncol:
        col = int(m * 60 / step)
        label = str(m)
        for k, chh in enumerate(label):
            if col + k < ncol:
                ticks[col + k] = chh
        m += max(1, int(round(ncol * step / 60 / 12)))
    out = [f"{run.name}: {len(rows)} beans, {step:.0f} s per column, minutes since race start on the axis",
           "     " + "".join(ticks)]
    for task in order:
        out.append(f"{task:>4} " + "".join(rows[task]))
    out.append("      a authoring  w rework  c pre-land check / in queue  . waiting  L landed  G green  X dropped")
    return "\n".join(out)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("run")
    ap.add_argument("--cols", type=int, default=110)
    ap.add_argument("--out")
    a = ap.parse_args()
    text = chart(a.run, a.cols)
    print(text)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")


if __name__ == "__main__":
    main()
