"""Mid-run live sprout sync (``live_sync_midrun``): the agent-side half.

The gateway's progress replies offer the beans that landed while an invocation runs and meet its bean. The driver
fetches the offered sprout into the bean's worktree and writes the offer to ``pending.json`` in the invocation's
sync directory (``work/midrun/<inv>/``). This module is also the hook the agent's CLI runs after every tool call
(Claude Code ``PostToolUse`` through ``--settings``; Codex the same through ``-c hooks...``):

- no offer, or one already handled: exit at once, no output;
- a safe point (the tool call was not an Edit/Write of a landed file, no merge in progress) and a clean merge: the
  sprout is merged under the agent's uncommitted work (HEAD becomes a merge commit, the work stays uncommitted on
  top) and the agent is told to re-read the landed files;
- anything else (a conflict, a merge in progress, mid-edit, git trouble, a note-only adapter): the agent is only
  told, and nothing in the worktree changes.

Each offer is handled once. What the hook did goes to ``hook.jsonl``, which the driver copies into ``driver.jsonl``
and reports to the gateway (``midrun_syncs``). Stdlib only and quick: the hook runs between every two tool calls.
"""
from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
import time

PENDING, DONE, LOG = "pending.json", "done.json", "hook.jsonl"
EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
GIT_TIMEOUT = 10
IDENTITY = {"GIT_AUTHOR_NAME": "race-harness", "GIT_AUTHOR_EMAIL": "race@beanstalk.invalid",
            "GIT_COMMITTER_NAME": "race-harness", "GIT_COMMITTER_EMAIL": "race@beanstalk.invalid"}


# ---- the driver's side ----------------------------------------------------------------------------------

def hook_command(sync_dir: str, worktree: str, mode: str) -> str:
    """The shell command the agent's CLI runs after each tool call; ``mode`` is ``merge`` or ``note``."""
    return " ".join(shlex.quote(a) for a in (sys.executable, os.path.abspath(__file__), sync_dir, worktree, mode))


def claude_settings(command: str) -> dict:
    """A ``--settings`` file with only the hook (``--setting-sources ""`` keeps every other settings file out)."""
    return {"hooks": {"PostToolUse": [{"matcher": "*", "hooks": [{"type": "command", "command": command,
                                                                     "timeout": 10}]}]}}


def codex_hooks_config(command: str) -> str:
    """The same hook as a ``codex -c`` override (TOML inline table; a JSON string is a valid TOML string)."""
    return ('hooks.PostToolUse=[{matcher="*",hooks=[{type="command",command=%s,timeout=10}]}]'
            % json.dumps(command))


def write_offer(sync_dir: str, offer: dict) -> None:
    """Leave an offer for the hook (atomically: the hook may read at any moment). A newer offer replaces an older
    one the hook has not taken up yet; merging the newer sprout brings both."""
    os.makedirs(sync_dir, exist_ok=True)
    pending = read_json(os.path.join(sync_dir, PENDING))
    done = set(read_json(os.path.join(sync_dir, DONE)) or [])
    if pending and pending.get("sprout") not in done:
        seen = {b.get("task") for b in offer.get("landed") or []}
        offer = {**offer, "landed": [*(b for b in pending.get("landed") or [] if b.get("task") not in seen),
                                     *(offer.get("landed") or [])]}
    tmp = os.path.join(sync_dir, PENDING + ".tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(offer, fh)
    os.replace(tmp, os.path.join(sync_dir, PENDING))


def outcomes(sync_dir: str) -> list[dict]:
    """What the hook did, one entry per offer it took up (the ``hook.jsonl`` lines that carry an outcome)."""
    out = []
    try:
        with open(os.path.join(sync_dir, LOG), encoding="utf-8") as fh:
            for line in fh:
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if entry.get("outcome") in ("applied", "noted"):
                    out.append(entry)
    except OSError:
        pass
    return out


def read_json(path: str):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None


# ---- the hook ---------------------------------------------------------------------------------------------

def run_hook(sync_dir: str, worktree: str, mode: str, payload: dict) -> dict | None:
    """One PostToolUse call: the hook's JSON output for the CLI, or None (nothing to say)."""
    offer = read_json(os.path.join(sync_dir, PENDING))
    if not offer or not offer.get("sprout"):
        return None
    done_path = os.path.join(sync_dir, DONE)
    done = read_json(done_path) or []
    sprout = offer["sprout"]
    if sprout in done:
        return None
    t0 = time.monotonic()
    landed = offer.get("landed") or []
    files = sorted({f for bean in landed for f in bean.get("files") or []})
    tool = payload.get("tool_name") or "?"
    if mode != "merge":
        outcome, reason, merged = "noted", "this agent's hook only notes", []
    elif tool in EDIT_TOOLS and edited_path(payload, worktree) in files:
        outcome, reason, merged = "noted", f"the agent was editing {edited_path(payload, worktree)}", []
    else:
        outcome, reason, merged = merge_sprout(worktree, sprout)
    with open(done_path, "w", encoding="utf-8") as fh:
        json.dump([*done, sprout], fh)
    entry = {"t": round(time.time(), 3), "sprout": sprout, "landed": [b.get("task") for b in landed],
             "outcome": outcome, "reason": reason, "files": merged or files, "tool": tool,
             "ms": round((time.monotonic() - t0) * 1000, 1)}
    log_entry(sync_dir, entry)
    if outcome == "skipped":  # already in the worktree: nothing to tell
        return None
    event = payload.get("hook_event_name") or "PostToolUse"
    return {"hookSpecificOutput": {"hookEventName": event, "additionalContext": note(landed, outcome, reason)}}


def note(landed: list[dict], outcome: str, reason: str | None) -> str:
    lines = "".join(f'\n- {b.get("task")} "{b.get("title", "")}"'
                    + (f" ({', '.join(b.get('files') or [])})" if b.get("files") else "") for b in landed)
    head = f"Beanstalk live sync: while you worked, these changes landed on the trunk and meet your work:{lines}\n"
    if outcome == "applied":
        return (head + "They were merged into your workspace just now (a merge commit under your uncommitted "
                "changes, which are kept as they were). Re-read those files before you edit them again, and run "
                "`node --test` before you finish.")
    return (head + f"They were not merged into your workspace ({reason}). Your change will be merged with them "
            "before it lands, so keep them in mind; do not try to merge them yourself.")


def edited_path(payload: dict, worktree: str) -> str | None:
    tool_input = payload.get("tool_input") or {}
    path = tool_input.get("file_path") or tool_input.get("notebook_path")
    if not isinstance(path, str):
        return None
    full = os.path.realpath(path if os.path.isabs(path) else os.path.join(worktree, path))
    return os.path.relpath(full, os.path.realpath(worktree))


def merge_sprout(wt: str, sprout: str) -> tuple[str, str | None, list[str]]:
    """Merge ``sprout`` into the worktree under its uncommitted changes, or change nothing. Returns (outcome,
    reason, files the merge brought in). Every tree is computed before the worktree is touched: the uncommitted
    work is snapshotted as a commit in a private index, merged with the sprout in memory (``merge-tree``), and only
    a clean result is checked out; HEAD becomes the merge of HEAD and the sprout, the work stays uncommitted."""
    git_dir = git(wt, "rev-parse", "--absolute-git-dir")
    if git_dir.returncode != 0:
        return "noted", "not a git worktree", []
    gd = git_dir.stdout.strip()
    if os.path.exists(os.path.join(gd, "MERGE_HEAD")) or git(wt, "ls-files", "-u").stdout.strip():
        return "noted", "a merge with conflicts is in progress in the worktree", []
    if git(wt, "cat-file", "-e", f"{sprout}^{{commit}}").returncode != 0:
        return "noted", "the sprout was not fetched", []
    if git(wt, "merge-base", "--is-ancestor", sprout, "HEAD").returncode == 0:
        return "skipped", "already merged", []
    head = git(wt, "rev-parse", "HEAD").stdout.strip()
    index = os.path.join(gd, "beanstalk-midrun.index")
    private = {"GIT_INDEX_FILE": index}
    try:
        steps = [git(wt, "read-tree", head, env=private), git(wt, "add", "-A", env=private)]
        work_tree = git(wt, "write-tree", env=private)
        if any(s.returncode != 0 for s in [*steps, work_tree]):
            return "noted", "could not snapshot the worktree", []
        work_tree_sha = work_tree.stdout.strip()
        work = git(wt, "commit-tree", work_tree_sha, "-p", head, "-m", "live sync: uncommitted work")
        target = git(wt, "merge-tree", "--write-tree", "--name-only", work.stdout.strip(), sprout)
        if work.returncode != 0 or target.returncode not in (0, 1):
            return "noted", "git merge-tree failed", []
        if target.returncode == 1:
            conflicted = [p for p in target.stdout.split("\n\n")[0].splitlines()[1:] if p]
            return "noted", f"the merge would conflict in {', '.join(conflicted) or 'some files'}", []
        merged_tree = git(wt, "merge-tree", "--write-tree", head, sprout)
        if merged_tree.returncode != 0:
            return "noted", "the sprout does not merge cleanly with the bean's last commit", []
        merge = git(wt, "commit-tree", merged_tree.stdout.split()[0], "-p", head, "-p", sprout,
                    "-m", f"Merge trunk {sprout[:12]} (live sync)")
        if merge.returncode != 0:
            return "noted", "git commit-tree failed", []
        checkout = git(wt, "read-tree", "-m", "-u", work_tree_sha, target.stdout.split()[0], env=private)
        if checkout.returncode != 0:
            git(wt, "read-tree", "--reset", "-u", work_tree_sha, env=private)
            return "noted", "could not update the worktree", []
        m = merge.stdout.strip()
        git(wt, "update-ref", "-m", "live sync", "HEAD", m, head)
        git(wt, "read-tree", m)
        files = [p for p in git(wt, "diff", "--name-only", head, m).stdout.splitlines() if p]
        return "applied", None, files
    finally:
        try:
            os.remove(index)
        except OSError:
            pass


def git(wt: str, *args: str, env: dict | None = None) -> subprocess.CompletedProcess:
    full = {**os.environ, **{k: os.environ.get(k, v) for k, v in IDENTITY.items()}, "GIT_TERMINAL_PROMPT": "0",
            **(env or {})}
    try:
        return subprocess.run(["git", *args], cwd=wt, env=full, capture_output=True, text=True, timeout=GIT_TIMEOUT)
    except (OSError, subprocess.TimeoutExpired) as e:
        return subprocess.CompletedProcess(["git", *args], 1, "", str(e))


def log_entry(sync_dir: str, entry: dict) -> None:
    with open(os.path.join(sync_dir, LOG), "a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry) + "\n")


def main(argv: list[str]) -> int:
    """``midrun.py <sync dir> <worktree> <merge|note>``, the hook payload on stdin. Never fails the tool call."""
    sync_dir, worktree, mode = argv[1], argv[2], argv[3]
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError:
        payload = {}
    try:
        out = run_hook(sync_dir, worktree, mode, payload)
    except Exception as e:  # a broken hook must never break the agent's tool call
        log_entry(sync_dir, {"t": round(time.time(), 3), "outcome": "error", "reason": repr(e)[:300]})
        return 0
    if out is not None:
        sys.stdout.write(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
