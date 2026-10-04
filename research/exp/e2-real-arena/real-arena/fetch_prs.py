#!/usr/bin/env python3
"""Fetch PR metadata (title, body, author, merge time, linked issues) for the window's commits into pr/<n>.json.

Read-only GitHub API calls through the `gh` CLI; run once, the JSON files are the cached input of build.py.
Usage: python3 fetch_prs.py --upstream ../upstream/marked --base <sha> [--end origin/master]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))


def git(repo: str, *args: str) -> str:
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, check=True).stdout


def gh(path: str) -> dict | list:
    out = subprocess.run(["gh", "api", path], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--upstream", default=os.path.join(HERE, "..", "upstream", "marked"))
    ap.add_argument("--repo", default="markedjs/marked")
    ap.add_argument("--base", required=True)
    ap.add_argument("--end", default="origin/master")
    a = ap.parse_args()
    out_dir = os.path.join(HERE, "pr")
    os.makedirs(out_dir, exist_ok=True)
    revs = git(a.upstream, "rev-list", "--first-parent", "--reverse", f"{a.base}..{a.end}").split()
    for sha in revs:
        subj = git(a.upstream, "log", "-1", "--format=%s", sha).strip()
        m = re.search(r"\(#(\d+)\)\s*$", subj)
        if not m:
            continue
        num = int(m.group(1))
        path = os.path.join(out_dir, f"{num}.json")
        if os.path.exists(path):
            continue
        pr = gh(f"repos/{a.repo}/pulls/{num}")
        body = pr.get("body") or ""
        issues = []
        for n in sorted({int(x) for x in re.findall(r"(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s+#(\d+)", body, re.I)}):
            try:
                iss = gh(f"repos/{a.repo}/issues/{n}")
                issues.append({"number": n, "title": iss.get("title"), "body": iss.get("body") or "",
                               "is_pr": "pull_request" in iss})
            except subprocess.CalledProcessError:
                issues.append({"number": n, "error": "not found"})
        rec = {"number": num, "sha": sha, "title": pr.get("title"), "body": body,
               "author": (pr.get("user") or {}).get("login"), "created_at": pr.get("created_at"),
               "merged_at": pr.get("merged_at"), "pr_base_sha": (pr.get("base") or {}).get("sha"),
               "pr_head_sha": (pr.get("head") or {}).get("sha"), "commits": pr.get("commits"),
               "linked_issues": issues}
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(rec, fh, indent=1)
        print(num, rec["title"])


if __name__ == "__main__":
    main()
