#!/usr/bin/env python3
"""E3: what the agent did when a flake sent its good bean back. Prints, for every needless rework in a run, the
prompt the agent got (head), the tools it used (shell commands, files edited) and its closing message.

Usage: python3 needless_transcripts.py runs/<run> [--prompt-chars 900] [--json out.json]
"""
from __future__ import annotations

import argparse
import json
import os


def inv_report(run: str, inv: str, prompt_chars: int) -> dict:
    tdir = os.path.join(run, "work", "transcripts")
    out: dict = {"inv": inv, "prompt": "", "commands": [], "edits": [], "final": "", "turns": 0}
    try:
        with open(os.path.join(tdir, f"{inv}.prompt.txt"), encoding="utf-8", errors="replace") as fh:
            out["prompt"] = fh.read()[:prompt_chars]
    except OSError:
        pass
    try:
        with open(os.path.join(tdir, f"{inv}.jsonl"), encoding="utf-8", errors="replace") as fh:
            lines = fh.readlines()
    except OSError:
        return out
    last_text = ""
    for line in lines:
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if not isinstance(d, dict):
            continue
        if d.get("type") == "assistant":
            out["turns"] += 1
            for block in (d.get("message") or {}).get("content") or []:
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "text" and block.get("text", "").strip():
                    last_text = block["text"].strip()
                elif block.get("type") == "tool_use":
                    inp = block.get("input") or {}
                    if block.get("name") == "Bash":
                        out["commands"].append(str(inp.get("command", ""))[:140])
                    elif block.get("name") in ("Edit", "Write"):
                        out["edits"].append(f"{block['name']} {inp.get('file_path', '')}")
        elif d.get("type") == "result":
            last_text = str(d.get("result") or last_text)
    out["final"] = last_text[:700]
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("run")
    ap.add_argument("--prompt-chars", type=int, default=900)
    ap.add_argument("--json")
    a = ap.parse_args()
    with open(os.path.join(a.run, "events.jsonl"), encoding="utf-8") as fh:
        ev = [json.loads(line) for line in fh if line.strip()]
    ends = {e["inv"]: e for e in ev if e["type"] == "invocation.end"}
    commits = [e for e in ev if e["type"] == "task.commit"]
    rows = []
    for e in ev:
        if e["type"] != "rework.start" or not e.get("needless"):
            continue
        rep = inv_report(a.run, e["inv"], a.prompt_chars)
        end = ends.get(e["inv"], {})
        nxt = next((c for c in commits if c["seq"] > e["seq"] and c.get("task") == e.get("task")
                    and c.get("kind") == "rework"), {})
        tools = end.get("tool_uses") or {}
        rep.update(task=e.get("task"), cost_usd=end.get("cost_usd"), wall_s=round((end.get("wall_ms") or 0) / 1000, 1),
                   edited=(tools.get("Edit", 0) + tools.get("Write", 0)) > 0, tools=tools,
                   files=nxt.get("files"), culprits=e.get("culprits"))
        rows.append(rep)
        print(f"=== {e['inv']} task {rep['task']}: {rep['turns']} turns, ${rep['cost_usd']}, {rep['wall_s']} s, "
              f"edited files: {rep['edited']} (tools {rep['tools']}); culprit changes shown: {rep['culprits']}")
        print("--- prompt (head)\n" + rep["prompt"])
        print("--- shell commands: " + "; ".join(rep["commands"]) if rep["commands"] else "--- no shell commands")
        print("--- edits: " + ("; ".join(rep["edits"]) or "none"))
        print("--- closing message\n" + rep["final"] + "\n")
    if not rows:
        print("no needless reworks in this run")
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(rows, fh, indent=2)


if __name__ == "__main__":
    main()
