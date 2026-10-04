#!/usr/bin/env python3
"""Extract a change corpus from a git repository.

One record per change. A "change" is either:
  * a first-parent commit on a branch (a merged PR in squash- or merge-based repos), or
  * a branch tip measured against a fixed base (``--branches`` mode, used for the arena's
    reference solutions, where every change is developed concurrently from one base).

Output: JSON Lines, one record per change, ordered by merge order (oldest first):

    {
      "corpus": "workers-sdk",
      "seq": 17,                       # 0-based position in merge order
      "id": "workers-sdk#10432",       # corpus + PR number when known, else corpus@shortsha
      "pr": 10432,                     # int or null
      "sha": "<change commit>",
      "parent": "<base commit the change applies onto>",
      "title": "...", "body": "...",
      "author": "...", "date": "2026-05-02T10:11:12+00:00",
      "agent": "claude" | "codex" | "cursor" | "copilot" | "devin" | "bot" | "human",
      "files": [{"path": "...", "old_path": null, "status": "M", "add": 3, "del": 1,
                 "module": "packages/wrangler", "category": "source"}],
      "modules": ["packages/wrangler"],
      "categories": ["source"]
    }

Module = the nearest enclosing package root (a directory holding package.json, Cargo.toml,
pyproject.toml, go.mod, ...) at the newest commit of the corpus, else the top-level directory,
else "(root)" for top-level files.

Category = a coarse file class used to estimate how many conflicts commutative merge drivers
could dissolve (lockfile, changelog, migration, snapshot, manifest, generated, docs, ci, test, source).

Standard library only. Python 3.11+.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from typing import Iterable

MANIFESTS = {
    "package.json", "Cargo.toml", "pyproject.toml", "setup.py", "go.mod",
    "pom.xml", "build.gradle", "build.gradle.kts", "deno.json", "composer.json", "Gemfile",
}

# Matched against author *names* and trailer values only, never email domains
# (every OpenAI employee's address would otherwise read as "codex").
AGENT_PATTERNS = [
    ("claude", re.compile(r"\bclaude\b", re.I)),
    ("codex", re.compile(r"\bcodex\b", re.I)),
    ("cursor", re.compile(r"\bcursor(-agent)?\b", re.I)),
    ("copilot", re.compile(r"\bcopilot\b", re.I)),
    ("devin", re.compile(r"\bdevin\b", re.I)),
    ("jules", re.compile(r"\bgoogle-labs-jules\b|\bjules\b", re.I)),
]
BOT_AUTHOR = re.compile(r"\[bot\]|dependabot|renovate|github-actions|changeset-release|\bbot\b|automated", re.I)
PR_NUMBER = re.compile(r"\(#(\d+)\)\s*$|Merge pull request #(\d+)")
TRAILER = re.compile(r"^(co-authored-by|generated-by|assisted-by|signed-off-by):\s*(.+)$", re.I | re.M)

_CATEGORY_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("lockfile", re.compile(r"(^|/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|"
                            r"poetry\.lock|uv\.lock|Pipfile\.lock|go\.sum|Gemfile\.lock|composer\.lock|flake\.lock)$")),
    ("changelog", re.compile(r"(^|/)(CHANGELOG[^/]*|CHANGES[^/]*|HISTORY[^/]*|RELEASE[_-]?NOTES[^/]*)$|(^|/)\.changeset/", re.I)),
    ("migration", re.compile(r"(^|/)migrations?/|(^|/)[^/]*migration[^/]*\.(sql|ts|js|py|rb)$", re.I)),
    ("snapshot", re.compile(r"(^|/)__snapshots__/|\.snap$|(^|/)snapshots/", re.I)),
    ("manifest", re.compile(r"(^|/)(package\.json|Cargo\.toml|pyproject\.toml|go\.mod|deno\.json|tsconfig[^/]*\.json)$")),
    ("generated", re.compile(r"(^|/)(dist|build|gen|generated|__generated__|precomputed)/|\.gen\.[a-z]+$|"
                             r"\.generated\.[a-z]+$|(^|/)schema\.(json|graphql)$|\.(zst|gz|br)$", re.I)),
    ("binary", re.compile(r"\.(png|jpe?g|gif|webp|ico|svg|pdf|wasm|bin|woff2?|ttf|otf|mp4|mp3|zip|tar)$", re.I)),
    ("ci", re.compile(r"(^|/)\.github/|(^|/)\.circleci/|(^|/)\.buildkite/")),
    ("docs", re.compile(r"\.(md|mdx|rst|txt)$|(^|/)docs?/", re.I)),
    ("test", re.compile(r"(^|/)(tests?|__tests__|spec|e2e|fixtures?)/|[._-](test|spec)\.[a-z]+$|_test\.(go|rs|py)$", re.I)),
]


def classify(path: str) -> str:
    for name, rx in _CATEGORY_RULES:
        if rx.search(path):
            return name
    return "source"


def git(repo: str, *args: str) -> str:
    # core.quotePath=false: keep non-ASCII paths verbatim instead of C-quoted ("\342\231\253")
    res = subprocess.run(["git", "-c", "core.quotePath=false", "-C", repo, *args], capture_output=True, text=True,
                         encoding="utf-8", errors="replace")
    if res.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {res.stderr.strip()}")
    return res.stdout


def package_roots(repo: str, ref: str) -> list[str]:
    """Directories (relative, no trailing slash) holding a manifest at ``ref``. Deepest first."""
    names = git(repo, "ls-tree", "-r", "--name-only", ref).splitlines()
    roots = {os.path.dirname(p) for p in names if os.path.basename(p) in MANIFESTS}
    roots.discard("")  # the repo root is not a module boundary
    return sorted(roots, key=lambda d: (-d.count("/"), d))


def module_of(path: str, roots: list[str], depth: int | None = None) -> str:
    """Nearest package root; or, with ``depth``, the first ``depth`` directory segments."""
    if depth:
        segs = path.split("/")[:-1]
        return "/".join(segs[:depth]) if segs else "(root)"
    for r in roots:  # deepest first
        if path == r or path.startswith(r + "/"):
            return r
    return path.split("/", 1)[0] if "/" in path else "(root)"


def detect_agent(author: str, body: str) -> str:
    """'bot' for automation accounts, an agent name when the author or a co-author trailer
    names a coding agent, else 'human' (which includes unattributed agent work)."""
    name = author.split("<", 1)[0].strip()
    if BOT_AUTHOR.search(name):
        # devin-ai-integration[bot] and similar are agents, not dependency bots
        for agent, rx in AGENT_PATTERNS:
            if rx.search(name):
                return agent
        return "bot"
    trailers = [re.sub(r"<[^>]*>", "", v) for k, v in TRAILER.findall(body)
                if k.lower() != "signed-off-by"]
    hay = name + "\n" + "\n".join(trailers)
    for agent, rx in AGENT_PATTERNS:
        if rx.search(hay):
            return agent
    return "human"


def _parse_numstat(text: str) -> dict[str, list[dict]]:
    """Parse `git log --numstat -z`-free output into {sha: [file dicts]}; renames as 'a => b'."""
    out: dict[str, list[dict]] = {}
    cur = None
    for line in text.splitlines():
        if line.startswith("\x1fC "):
            cur = line[3:].strip()
            out[cur] = []
            continue
        if not line.strip() or cur is None:
            continue
        parts = line.split("\t")
        if len(parts) != 3:
            continue
        a, d, p = parts
        old = None
        if " => " in p:  # rename: either "a => b" or "dir/{a => b}/x"
            m = re.match(r"^(.*)\{(.*) => (.*)\}(.*)$", p)
            if m:
                pre, o, n, post = m.groups()
                old = re.sub(r"//+", "/", pre + o + post)
                p = re.sub(r"//+", "/", pre + n + post)
            else:
                old, p = p.split(" => ", 1)
        out[cur].append({"path": p, "old_path": old,
                         "add": int(a) if a.isdigit() else 0, "del": int(d) if d.isdigit() else 0})
    return out


def _parse_status(text: str) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    cur = None
    for line in text.splitlines():
        if line.startswith("\x1fC "):
            cur = line[3:].strip()
            out[cur] = {}
            continue
        if not line.strip() or cur is None:
            continue
        parts = line.split("\t")
        st = parts[0][:1]
        path = parts[-1]
        out[cur][path] = st
    return out


def _records_from_log(repo: str, rev_args: list[str]) -> list[dict]:
    meta_fmt = "%x1eC %H%x1f%P%x1f%an <%ae>%x1f%aI%x1f%s%x1f%b"
    raw = git(repo, "log", *rev_args, f"--format={meta_fmt}")
    recs = []
    for chunk in raw.split("\x1eC ")[1:]:
        fields = chunk.split("\x1f")
        if len(fields) < 6:
            continue
        sha, parents, author, date, subject, body = fields[0], fields[1], fields[2], fields[3], fields[4], "\x1f".join(fields[5:])
        recs.append({"sha": sha.strip(), "parents": parents.split(), "author": author, "date": date,
                     "title": subject.strip(), "body": body.strip()})
    return recs


def extract_history(repo: str, ref: str, since: str | None, until: str | None) -> list[dict]:
    """First-parent changes on ``ref`` (oldest first), each diffed against its first parent."""
    rev = ["--first-parent", "--reverse", ref]
    if since:
        rev.append(f"--since={since}")
    if until:
        rev.append(f"--until={until}")
    recs = [r for r in _records_from_log(repo, rev) if r["parents"]]  # skip roots / shallow boundary
    diff_args = ["--first-parent", "--diff-merges=first-parent", "-M", "--reverse", ref]
    if since:
        diff_args.append(f"--since={since}")
    if until:
        diff_args.append(f"--until={until}")
    numstat = _parse_numstat(git(repo, "log", *diff_args, "--numstat", "--format=%x1fC %H"))
    status = _parse_status(git(repo, "log", *diff_args, "--name-status", "--format=%x1fC %H"))
    for r in recs:
        r["parent"] = r["parents"][0]
        files = numstat.get(r["sha"], [])
        st = status.get(r["sha"], {})
        for f in files:
            f["status"] = st.get(f["path"], "M")
        r["files"] = files
    return recs


def extract_branches(repo: str, base: str, pattern: str) -> list[dict]:
    """Each branch matching ``pattern`` (e.g. 'refs/heads/ref/*') is one change against ``base``."""
    refs = git(repo, "for-each-ref", "--format=%(refname)", pattern).split()
    base_sha = git(repo, "rev-parse", base).strip()
    recs = []
    for ref in sorted(refs):
        tip = git(repo, "rev-parse", ref).strip()
        meta = _records_from_log(repo, ["-1", tip])[0]
        num = _parse_numstat("\x1fC X\n" + git(repo, "diff", "-M", "--numstat", base_sha, tip))["X"]
        st = _parse_status("\x1fC X\n" + git(repo, "diff", "-M", "--name-status", base_sha, tip))["X"]
        for f in num:
            f["status"] = st.get(f["path"], "M")
        meta.update({"parent": base_sha, "files": num, "branch": ref})
        recs.append(meta)
    return recs


def build(repo: str, corpus: str, records: Iterable[dict], roots_ref: str,
          module_depth: int | None = None) -> list[dict]:
    roots = [] if module_depth else package_roots(repo, roots_ref)
    out = []
    for seq, r in enumerate(records):
        m = PR_NUMBER.search(r["title"]) or PR_NUMBER.search(r["body"][:200])
        pr = int(next(g for g in m.groups() if g)) if m else None
        files = []
        for f in r["files"]:
            files.append({"path": f["path"], "old_path": f.get("old_path"), "status": f["status"],
                          "add": f["add"], "del": f["del"],
                          "module": module_of(f["path"], roots, module_depth),
                          "category": classify(f["path"])})
        rec = {
            "corpus": corpus, "seq": seq,
            "id": f"{corpus}#{pr}" if pr else f"{corpus}@{r['sha'][:10]}",
            "pr": pr, "sha": r["sha"], "parent": r["parent"],
            "title": r["title"], "body": r["body"], "author": r["author"], "date": r["date"],
            "agent": detect_agent(r["author"], r["body"]),
            "files": files,
            "modules": sorted({f["module"] for f in files}),
            "categories": sorted({f["category"] for f in files}),
        }
        if "branch" in r:
            rec["branch"] = r["branch"]
        out.append(rec)
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("repo", help="path to a git repository (bare is fine)")
    ap.add_argument("--corpus", required=True, help="short corpus name used in ids and output paths")
    ap.add_argument("--ref", default="main", help="branch whose first-parent history is the corpus")
    ap.add_argument("--since")
    ap.add_argument("--until")
    ap.add_argument("--branches", help="branch-mode: refname pattern, e.g. 'refs/heads/ref/*'")
    ap.add_argument("--base", default="main", help="branch-mode base")
    ap.add_argument("--drop-bots", action="store_true", help="exclude dependabot/renovate-style changes")
    ap.add_argument("--max-files", type=int, default=400,
                    help="drop changes touching more files than this (vendoring, mass renames)")
    ap.add_argument("--module-depth", type=int, default=None,
                    help="module = first N directory segments instead of nearest package root")
    ap.add_argument("-o", "--out", default="-")
    a = ap.parse_args(argv)

    if a.branches:
        records = extract_branches(a.repo, a.base, a.branches)
        roots_ref = a.base
    else:
        records = extract_history(a.repo, a.ref, a.since, a.until)
        roots_ref = a.ref
    corpus = build(a.repo, a.corpus, records, roots_ref, a.module_depth)
    kept = [c for c in corpus if c["files"] and len(c["files"]) <= a.max_files
            and not (a.drop_bots and c["agent"] == "bot")]
    for i, c in enumerate(kept):
        c["seq"] = i
    fh = sys.stdout if a.out == "-" else open(a.out, "w")
    for c in kept:
        fh.write(json.dumps(c) + "\n")
    if fh is not sys.stdout:
        fh.close()
    print(f"{a.corpus}: {len(kept)} changes kept of {len(corpus)} "
          f"({sum(1 for c in kept if c['agent'] not in ('human', 'bot'))} with agent attribution)",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
