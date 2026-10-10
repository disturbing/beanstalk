#!/usr/bin/env python3
"""Build data.js for the repository-experience prototype from one recorded run.

Reads fixtures/<run>/{repo.json,events.jsonl,tasks.json,summary.json} (copied from
packages/web/fixtures) and writes data.js: tasks, trimmed events, the line of landings with
per-file unified diffs, each bean's latest head diff, the final tree's file contents, and
line-level "blame by bean" for every file at the end of the run.

    python3 build_data.py            # default run 7z4j84eqvl
"""
import difflib
import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
RUN = sys.argv[1] if len(sys.argv) > 1 else "7z4j84eqvl"
SRC = HERE / "fixtures" / RUN
MAX_DIFF_LINES = 160

repo = json.loads((SRC / "repo.json").read_text())
tasks = json.loads((SRC / "tasks.json").read_text())
summary = json.loads((SRC / "summary.json").read_text())
events = [json.loads(l) for l in (SRC / "events.jsonl").read_text().splitlines() if l.strip()]

paths, blobs, trees = repo["paths"], repo["blobs"], repo["trees"]


def tree(sha):
    flat = trees.get(sha)
    if flat is None:
        return None
    return {paths[flat[i]]: flat[i + 1] for i in range(0, len(flat), 2)}


def text(tree_map, path):
    idx = tree_map.get(path) if tree_map else None
    return blobs[idx] if idx is not None else ""


def udiff(a, b, path):
    lines = list(
        difflib.unified_diff(a.splitlines(), b.splitlines(), f"a/{path}", f"b/{path}", n=2, lineterm="")
    )[2:]
    cut = len(lines) > MAX_DIFF_LINES
    return {"lines": lines[:MAX_DIFF_LINES], "cut": cut}


def file_diffs(parent_sha, sha, files):
    a, b = tree(parent_sha), tree(sha)
    out = []
    for f in files:
        d = udiff(text(a, f["path"]), text(b, f["path"]), f["path"])
        out.append({**f, **d})
    return out


line = []
for c in repo["line"]:
    line.append({
        "sha": c["sha"], "task": c["task"], "idx": c["idx"], "t": c["t"], "rebuilt": c["rebuilt"],
        "parent": c["parent"], "files": file_diffs(c["parent"], c["sha"], c["files"]),
    })

# Latest head per bean (covers beans that never landed, like the declined t032).
heads = {}
for h in repo["beanHeads"]:
    heads.setdefault(h["task"], []).append(h)
bean_heads = {}
for task, hs in heads.items():
    last = hs[-1]
    bean_heads[task] = {
        "attempts": [{"sha": h["sha"][:7], "kind": h["kind"], "t": h["t"], "files": [f["path"] for f in h["files"]]} for h in hs],
        "files": file_diffs(last["mergeBase"], last["sha"], last["files"]),
    }

# Blame by bean across the line: who last wrote each line of each file at the end.
blame = {}
base = tree(repo["base"])
for p in base:
    blame[p] = [None] * len(text(base, p).splitlines())
prev = base
for c in repo["line"]:
    cur = tree(c["sha"])
    for f in c["files"]:
        p = f["path"]
        old, new = text(prev, p).splitlines(), text(cur, p).splitlines()
        owners = blame.get(p, [None] * len(old))
        nxt = []
        for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, old, new, autojunk=False).get_opcodes():
            if op == "equal":
                nxt.extend(owners[i1:i2])
            else:
                nxt.extend([c["task"]] * (j2 - j1))
        blame[p] = nxt
    prev = cur
final_tree = prev
files = {}
for p in sorted(final_tree):
    content = text(final_tree, p)
    owners = blame.get(p, [None] * len(content.splitlines()))
    # run-length encode owners: [[task|null, count], ...]
    rle = []
    for o in owners:
        if rle and rle[-1][0] == o:
            rle[-1][1] += 1
        else:
            rle.append([o, 1])
    files[p] = {"content": content, "blame": rle}

slim_events = []
for e in events:
    e = {k: v for k, v in e.items() if k not in ("ts",)}
    if "result_text" in e and e["result_text"]:
        e["result_text"] = e["result_text"][:420]
    slim_events.append(e)

meta = {k: summary[k] for k in (
    "label", "policy", "agent", "model", "config", "wall_seconds", "tasks", "tasks_green",
    "tasks_landed", "tasks_dropped", "drops_by_reason", "changes_green_per_hour",
    "task_start_to_green_seconds", "agent_minutes", "cost_usd", "red_validations", "final",
)}
meta["per_task"] = summary["per_task"]
meta["run"] = RUN
meta["base"] = repo["base"]

data = {"meta": meta, "tasks": tasks, "events": slim_events, "line": line,
        "beanHeads": bean_heads, "files": files}
out = HERE / "data.js"
out.write_text("window.BEANSTALK_RUN = " + json.dumps(data, separators=(",", ":")) + ";\n")
print(f"wrote {out} ({out.stat().st_size // 1024} KB): {len(line)} landings, {len(files)} files")
