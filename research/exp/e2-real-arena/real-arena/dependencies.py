#!/usr/bin/env python3
"""For each window change that does not apply to the common base, find the earlier window change(s) it builds on:
the single earlier qualifying-or-not change E such that the change applies cleanly to base + E (merge-tree only).
Reads candidates/window.json, writes dependencies.json. Usage: python3 dependencies.py"""
import json, os, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
UP = os.path.join(HERE, "..", "upstream", "marked")
def git(*a):
    return subprocess.run(["git", "-C", UP, *a], capture_output=True, text=True)
def mt(base, ours, theirs):
    p = git("merge-tree", "--write-tree", "--name-only", "--no-messages", f"--merge-base={base}", ours, theirs)
    return p.stdout.splitlines()[0].strip() if p.returncode == 0 else None
win = json.load(open(os.path.join(HERE, "candidates", "window.json")))
base, end = win["base"], win["end"]
revs = git("rev-list", "--first-parent", "--reverse", f"{base}..{end}").stdout.split()
subj = {c: git("log", "-1", "--format=%s", c).stdout.strip() for c in revs}
applied = {}  # E -> tree of base + E
out = []
for row in win["excluded"]:
    if row.get("reason", "").startswith("depends"):
        c = row["sha"]
        earlier = revs[:revs.index(c)]
        deps = []
        for e in earlier:
            if e not in applied:
                t = mt(f"{e}^", base, e)
                applied[e] = git("commit-tree", t, "-p", base, "-m", "x").stdout.strip() if t else None
            if applied[e] and mt(f"{c}^", applied[e], c):
                deps.append({"sha": e[:10], "title": subj[e]})
        out.append({"pr": row["pr"], "title": row["title"], "conflict_files": row.get("conflict_files"),
                    "applies_after_any_single": deps})
        print(f"pr{row['pr']} ({', '.join(row.get('conflict_files') or [])}): " +
              ("; ".join(d["title"][:60] for d in deps) if deps else "needs several earlier changes"))
json.dump(out, open(os.path.join(HERE, "dependencies.json"), "w"), indent=1)
