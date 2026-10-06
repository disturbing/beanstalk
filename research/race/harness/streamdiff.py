"""Streaming diffs (``stream_diffs``): the driver's snapshot of a bean's working change while its agent writes.

``snapshot`` diffs the worktree (untracked files included, ignored ones not) against the bean's base through a
private index, so neither the agent's index nor HEAD is touched. The tree id of that index is the snapshot's
fingerprint: an unchanged tree is not diffed again. Binary files are listed without a patch, patch text is capped
(64 KB per snapshot, 200 files), and lines that look like secrets are replaced before anything leaves the machine
(the gateway scans again: ``packages/gateway/src/run/bean-streams.ts``).

The agent's CLI marks edits through a tiny hook (``touch`` of a marker file after Edit/Write/MultiEdit/NotebookEdit,
``edit_hook_command``); the driver polls the marker and also checks on a timer for edits made through Bash.
"""
from __future__ import annotations

import os
import re
import shlex
import subprocess
import time
from dataclasses import dataclass, field

MAX_PATCH_BYTES = 64 * 1024
MAX_FILES = 200
GIT_TIMEOUT = 20
EDIT_TOOLS_MATCHER = "Edit|Write|MultiEdit|NotebookEdit"
REDACTED = "[redacted by beanstalk: looks like a secret]"
# The gateway's list (bean-streams.ts), itself the recorded fixtures' list less the 32-hex id.
SECRET_PATTERNS = [re.compile(p, f) for p, f in (
    (r"sk-ant-[a-z0-9-]{8,}", re.I),
    (r"\bbst1\.[A-Za-z0-9_-]{8,}", 0),
    (r"\bBearer\s+[A-Za-z0-9._-]{12,}", 0),
    (r"\bgh[pousr]_[A-Za-z0-9]{20,}", 0),
    (r"\bAKIA[0-9A-Z]{16}\b", 0),
    (r"-----BEGIN [A-Z ]*PRIVATE KEY-----", 0),
    (r"\bart_v1_[A-Za-z0-9_]{8,}", 0),
    (r"/Users/[A-Za-z0-9._-]+/", 0),
    (r"/home/[A-Za-z0-9._-]+/", 0),
    (r"\b[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev\b", re.I),
)]


def edit_hook_command(marker: str) -> str:
    """What the agent's CLI runs after an edit tool: mark the time, nothing else (a few ms, no Python start-up)."""
    return f"touch {shlex.quote(marker)}"


@dataclass
class Snapshot:
    tree: str
    files: list[dict] = field(default_factory=list)
    truncated: bool = False
    redacted: int = 0
    ms: float = 0.0

    def body(self, seq: int, trigger: str) -> dict:
        return {"seq": seq, "files": self.files, "truncated": self.truncated, "trigger": trigger[:40]}


def tree_of(wt: str, index: str) -> str | None:
    """The worktree as a tree (a private index read from HEAD, then every change added): the fingerprint."""
    env = {"GIT_INDEX_FILE": index}
    for args in (("read-tree", "HEAD"), ("add", "-A")):
        if git(wt, *args, env=env).returncode != 0:
            return None
    tree = git(wt, "write-tree", env=env)
    return tree.stdout.strip() if tree.returncode == 0 else None


def fingerprint(wt: str) -> str | None:
    """The worktree's tree id now (the baseline: what the driver wrote before the agent started is not news)."""
    gd = git(wt, "rev-parse", "--absolute-git-dir")
    if gd.returncode != 0:
        return None
    index = os.path.join(gd.stdout.strip(), "beanstalk-stream.index")
    try:
        return tree_of(wt, index)
    finally:
        try:
            os.remove(index)
        except OSError:
            pass


def snapshot(wt: str, base: str, *, previous_tree: str | None = None, max_bytes: int = MAX_PATCH_BYTES,
             max_files: int = MAX_FILES) -> Snapshot | None:
    """The worktree's change against ``base``; None when git fails, a Snapshot with no files when the tree is
    ``previous_tree`` (unchanged: the caller sends nothing)."""
    t0 = time.monotonic()
    gd = git(wt, "rev-parse", "--absolute-git-dir")
    if gd.returncode != 0:
        return None
    index = os.path.join(gd.stdout.strip(), "beanstalk-stream.index")
    try:
        tree = tree_of(wt, index)
        if tree is None:
            return None
        if tree == previous_tree:
            return Snapshot(tree=tree, ms=_ms(t0))
        stats = git(wt, "diff", "--numstat", "-z", "--no-renames", base, tree)
        patch = git(wt, "diff", "--no-color", "--no-ext-diff", "--no-renames", "-U3", base, tree)
        if stats.returncode != 0 or patch.returncode != 0:
            return None
    finally:
        try:
            os.remove(index)
        except OSError:
            pass
    snap = Snapshot(tree=tree)
    chunks = split_patch(patch.stdout)
    budget = max_bytes
    for path, added, deleted in parse_numstat(stats.stdout):
        if len(snap.files) >= max_files:
            snap.truncated = True
            break
        chunk = chunks.get(path, "")
        binary = added is None
        hunks, n = redact(hunks_of(chunk)) if not binary else (None, 0)
        snap.redacted += n
        if hunks is not None and len(hunks.encode()) > budget:
            hunks, snap.truncated = None, True
        if hunks is not None:
            budget -= len(hunks.encode())
        snap.files.append({"path": path, "status": status_of(chunk), "additions": added or 0,
                           "deletions": deleted or 0, "binary": binary, "patch": hunks})
    snap.ms = _ms(t0)
    return snap


def parse_numstat(text: str) -> list[tuple[str, int | None, int | None]]:
    """``--numstat -z`` (no renames): ``added\\tdeleted\\tpath\\0``; ``-`` counts mean a binary file."""
    out = []
    for entry in text.split("\0"):
        if not entry:
            continue
        added, deleted, path = entry.split("\t", 2)
        out.append((path, None if added == "-" else int(added), None if deleted == "-" else int(deleted)))
    return out


def split_patch(text: str) -> dict[str, str]:
    """One chunk per file of a ``git diff`` (headers included), by its path on the ``b/`` side (``a/`` if deleted)."""
    out: dict[str, str] = {}
    for chunk in re.split(r"^(?=diff --git )", text, flags=re.M):
        if not chunk.startswith("diff --git "):
            continue
        minus = re.search(r"^--- (?:a/(.*)|/dev/null)$", chunk, re.M)
        plus = re.search(r"^\+\+\+ (?:b/(.*)|/dev/null)$", chunk, re.M)
        path = (plus and plus.group(1)) or (minus and minus.group(1))
        if not path:  # binary or mode-only: the header names it
            head = re.match(r"diff --git a/(.*) b/(.*)$", chunk.splitlines()[0])
            path = head.group(2) if head else None
        if path:
            out[path] = chunk
    return out


def hunks_of(chunk: str) -> str:
    at = chunk.find("\n@@")
    return chunk[at + 1:] if at >= 0 else ""


def status_of(chunk: str) -> str:
    if re.search(r"^new file mode", chunk, re.M):
        return "added"
    if re.search(r"^deleted file mode", chunk, re.M):
        return "deleted"
    return "modified"


def redact(text: str) -> tuple[str, int]:
    n = 0
    lines = text.split("\n")
    for i, line in enumerate(lines):
        if any(p.search(line) for p in SECRET_PATTERNS):
            n += 1
            lines[i] = (line[:1] if line[:1] in "+- " else "") + REDACTED
    return "\n".join(lines), n


def git(wt: str, *args: str, env: dict | None = None) -> subprocess.CompletedProcess:
    full = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_OPTIONAL_LOCKS": "0", **(env or {})}
    try:
        return subprocess.run(["git", *args], cwd=wt, env=full, capture_output=True, text=True,
                              timeout=GIT_TIMEOUT, errors="replace")
    except (OSError, subprocess.TimeoutExpired) as e:
        return subprocess.CompletedProcess(["git", *args], 1, "", str(e))


def _ms(t0: float) -> float:
    return round((time.monotonic() - t0) * 1000, 1)
