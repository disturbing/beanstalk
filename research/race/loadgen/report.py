"""Tables from load-generator runs: one row per run (headline metrics), and a markdown summary per run."""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RACE = os.path.dirname(HERE)


def _min(s: float | None) -> str:
    return "-" if s is None else f"{s / 60:.1f}"


def _load(run: str) -> dict:
    path = run if os.path.isabs(run) else os.path.join(RACE, run)
    with open(os.path.join(path, "summary.json"), encoding="utf-8") as fh:
        return json.load(fh)


HEAD = ["run", "forge", "N", "integrated", "ready→integrated med / p90 min", "ready→stable med / p90 min",
        "enqueue→merged med / p90 min", "waiting share (change / worker)", "kick-outs (red / conflict)",
        "rebases", "upstream files", "per 10 min (peak)", "max waiting", "CI min", "red validations", "wall min",
        "correct"]


def row(name: str, s: dict) -> list[str]:
    r, st, eq = s["ready_to_integrated_s"], s["ready_to_stable_s"], s["enqueue_to_merged_s"]
    rx = s.get("reactions") or {}
    f = s.get("final") or {}
    return [name, s["forge"], str(s["config"]["workers"]), f"{s['tasks_green']}/{s['tasks']}",
            f"{_min(r['median'])} / {_min(r['p90'])}", f"{_min(st['median'])} / {_min(st['p90'])}",
            f"{_min(eq['median'])} / {_min(eq['p90'])}" if eq["n"] else "-",
            f"{s.get('waiting_share_of_change_life')} / {s.get('waiting_share_of_worker_time')}",
            f"{rx.get('red', 0)} / {rx.get('conflict', 0)}", str(rx.get("rebase", 0)),
            str(rx.get("upstream_files_taken", 0)),
            f"{s['throughput_per_10min']} ({s['peak_integrated_in_10min']})", str(s["max_concurrently_waiting"]),
            str(s.get("ci_minutes")), str(s.get("red_validations")), f"{s['wall_seconds'] / 60:.1f}",
            str(f.get("correct", "-"))]


def pair_table(runs: list[str]) -> str:
    rows = []
    for r in runs:
        try:
            rows.append(row(os.path.basename(r.rstrip("/")), _load(r)))
        except (OSError, KeyError, json.JSONDecodeError) as e:
            rows.append([os.path.basename(r), f"(no summary: {e})"] + [""] * (len(HEAD) - 2))
    lines = ["| " + " | ".join(HEAD) + " |", "|" + "---|" * len(HEAD)]
    return "\n".join(lines + ["| " + " | ".join(x) + " |" for x in rows])


def write_md(out: str, s: dict) -> None:
    fd = s.get("forge_detail") or {}
    lines = [f"# Load generator run: {os.path.basename(out)}", "", pair_table([out]), "",
             f"- schedule: `{json.dumps(s['config']['schedule'])}`", f"- mode: {s['config']['mode']}",
             f"- dropped: {', '.join(s['dropped']) or 'none'}", f"- reactions: `{json.dumps(s['reactions'])}`",
             f"- first push → verdict: `{json.dumps(s['first_push_to_verdict_s'])}`",
             f"- CI: `{json.dumps(fd.get('ci'))}`", f"- aborted: {s.get('aborted')}"]
    if s["forge"] == "github":
        lines += [f"- repo: {fd.get('repo')}", f"- ruleset: `{json.dumps(fd.get('ruleset'))}`",
                  f"- API: `{json.dumps(fd.get('api'))}`", f"- kick-outs by GitHub reason: "
                  f"`{json.dumps(fd.get('kickouts_by_reason'))}`"]
    else:
        lines += [f"- engine: {fd.get('engine')}", f"- verdicts: `{json.dumps(fd.get('verdicts'))}`",
                  f"- checks reused: {fd.get('checks_reused')}"]
    f = s.get("final") or {}
    lines += [f"- final: suite green {f.get('suite_green')}, acceptance {f.get('green_tasks_accepted')}/"
              f"{f.get('green_tasks')} of integrated, matches chain build {f.get('matches_chain_build')}"]
    with open(os.path.join(out, "summary.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    print(pair_table(sys.argv[1:]))
