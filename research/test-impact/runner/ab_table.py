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


def main(paths: list[str]) -> None:
    print("| Run | green | k10 | k20 | k25 | done (min) | window waits | validations (green/red) | "
          "CI runs / min | evidence promotions / affected / refusals / audits (red) | correct |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    for path in paths:
        summary = json.load(open(os.path.join(path, "summary.json")))
        md = open(os.path.join(path, "summary.md")).read()
        greens = sorted(t["green_at"] for t in summary["per_task"].values() if t.get("green_at") is not None)
        window = row(md, "Sprout window at the end").split("/")
        waits = window[1].strip() if len(window) > 1 else "-"
        print(f"| {os.path.basename(path)} | {summary['tasks_green']} | {kth(greens, 10)} | {kth(greens, 20)} | "
              f"{kth(greens, 25)} | {summary['wall_seconds'] / 60:.1f} | {waits} | {row(md, 'Validations (green / red)')} | "
              f"{summary['ci_runs_total']} / {summary['ci_minutes_total']:.1f} | "
              f"{row(md, 'Evidence promotions')} | {row(md, 'Final green correct')} |")


if __name__ == "__main__":
    main(sys.argv[1:])
