#!/usr/bin/env python3
"""Survey of candidate repositories (how the real arena's repo was chosen).

For a clone (treeless is enough): first-parent commits of the default branch, the ones that change source AND tests
("qualifying"), and for sliding windows of 40 qualifying changes: the share of pairs sharing a source file
(srcpair), sharing a test file (testpair), and of changes colliding on a source file with an earlier one (collide).

Usage: python3 survey.py <clone> [N=800]     (candidates were cloned into ../survey-clones/ with --filter=blob:none)
"""
import collections
import itertools
import re
import subprocess
import sys

TEST = re.compile(r"(^|/)(test|tests|__tests__|spec|specs)/|\.(test|spec|test-d)\.[cm]?[jt]sx?$")
CODE = re.compile(r"\.([cm]?[jt]sx?)$")


def git(repo, *a):
    return subprocess.run(["git", "-C", repo, *a], capture_output=True, text=True).stdout


def cls(p):
    if TEST.search(p):
        return "test"
    if p.endswith((".md", ".mdx")) or "/docs/" in p or p.startswith("docs/"):
        return "docs"
    if CODE.search(p) and not re.search(r"(^|/)(bench|benchmarks?|scripts|examples?|playground|website|site|\.github)/", p) \
            and not p.endswith((".config.js", ".config.ts", ".config.mjs")):
        return "src"
    return "other"


def main():
    repo = sys.argv[1]
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 800
    ref = git(repo, "symbolic-ref", "refs/remotes/origin/HEAD").strip() or "HEAD"
    log = git(repo, "log", "--first-parent", "-n", str(n), "--format=@@%H%x09%ad%x09%s", "--date=short", "--name-only", ref)
    commits, cur = [], None
    for line in log.splitlines():
        if line.startswith("@@"):
            h, d, s = line[2:].split("\t", 2)
            cur = {"sha": h, "date": d, "subj": s, "files": []}
            commits.append(cur)
        elif line.strip() and cur:
            cur["files"].append(line.strip())
    commits.reverse()
    q = []
    for c in commits:
        c["src"] = [f for f in c["files"] if cls(f) == "src"]
        c["test"] = [f for f in c["files"] if cls(f) == "test"]
        if c["src"] and c["test"] and len(c["files"]) <= 40:
            q.append(c)
    print(f"{repo}: ref={ref} commits={len(commits)} qualifying={len(q)} span {commits[0]['date']}..{commits[-1]['date']}")
    w = 40
    for end in range(len(q), w - 1, -10):
        win = q[end - w:end]
        pairs = list(itertools.combinations(range(w), 2))
        sp = sum(1 for i, j in pairs if set(win[i]["src"]) & set(win[j]["src"]))
        tp = sum(1 for i, j in pairs if set(win[i]["test"]) & set(win[j]["test"]))
        coll = sum(1 for j in range(w) if any(set(win[i]["src"]) & set(win[j]["src"]) for i in range(j)))
        hot = collections.Counter(f for c in win for f in c["src"]).most_common(3)
        print(f"  window {win[0]['date']}..{win[-1]['date']}: srcpair {sp / len(pairs):.2f} testpair {tp / len(pairs):.2f} "
              f"collide {coll / w:.2f} hot {hot}")
        if end < len(q) - 30:
            break


if __name__ == "__main__":
    main()
