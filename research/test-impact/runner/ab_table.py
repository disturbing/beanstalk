"""The evidence A/B table from race run directories (research/race/runs/<name>/summary.{json,md}).

  python3 ab_table.py ../../race/runs/rm-evp-demo-8-s7 ../../race/runs/rm-evp-evidence-8-s7 ...
"""

import json
import os
import re
import sys


def row(md: str, label: str) -> str:
    for line in md.splitlines():
        if line.startswith(f"| {label}"):
            return line.split("|")[2].strip()
    return "-"


def kth(greens: list[float], k: int) -> str:
    return f"{greens[k - 1] / 60:.1f}" if len(greens) >= k else "-"


def affected_share(path: str) -> str:
    """Mean share of the tree's tests an affected validation ran (`evidence.refused`), and how many
    promotions needed no CI run at all."""
    shares, free = [], 0
    for line in open(os.path.join(path, "events.jsonl")):
        event = json.loads(line)
        if event["type"] == "evidence.refused" and event.get("tests"):
            shares.append(event.get("affected_count", 0) / event["tests"])
        if event["type"] == "promote.evidence" and not event.get("targeted"):
            free += 1
    if not shares and not free:
        return "-"
    mean = f"{100 * sum(shares) / len(shares):.0f}%" if shares else "-"
    return f"{mean} ({free} with no CI)"


def main(paths: list[str]) -> None:
    print("| Run | green | k10 | k20 | k25 | done (min) | window waits | validations (green/red) | "
          "CI runs / min | evidence promotions / affected / refusals / audits (red) | affected share | correct |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|")
    for path in paths:
        summary = json.load(open(os.path.join(path, "summary.json")))
        md = open(os.path.join(path, "summary.md")).read()
        greens = sorted(t["green_at"] for t in summary["per_task"].values() if t.get("green_at") is not None)
        window = row(md, "Sprout window at the end").split("/")
        waits = window[1].strip() if len(window) > 1 else "-"
        print(f"| {os.path.basename(path)} | {summary['tasks_green']} | {kth(greens, 10)} | {kth(greens, 20)} | "
              f"{kth(greens, 25)} | {summary['wall_seconds'] / 60:.1f} | {waits} | {row(md, 'Validations (green / red)')} | "
              f"{summary['ci_runs_total']} / {summary['ci_minutes_total']:.1f} | "
              f"{row(md, 'Evidence promotions')} | {affected_share(path)} | {row(md, 'Final green correct')} |")


if __name__ == "__main__":
    main(sys.argv[1:])
