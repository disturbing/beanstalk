"""Async git helpers for the integration clone and its worktrees."""
from __future__ import annotations

import asyncio
import os
import re
import shutil

from .procs import ProcResult, Runner

GIT_ENV_DROP = ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_COMMON_DIR")
CONFLICT_MARKER = re.compile(r"^(<{7}|>{7})( |$)", re.M)


class GitError(RuntimeError):
    def __init__(self, res: ProcResult):
        self.res = res
        super().__init__(f"git {' '.join(res.argv[1:])} failed ({res.returncode}): {res.stderr.strip()[:2000]}")


def git_env() -> dict:
    env = {k: v for k, v in os.environ.items() if k not in GIT_ENV_DROP}
    env.update({
        "GIT_AUTHOR_NAME": "race-harness", "GIT_AUTHOR_EMAIL": "race@beanstalk.invalid",
        "GIT_COMMITTER_NAME": "race-harness", "GIT_COMMITTER_EMAIL": "race@beanstalk.invalid",
        "GIT_TERMINAL_PROMPT": "0", "GIT_EDITOR": "true", "GIT_MERGE_AUTOEDIT": "no",
        "GIT_CONFIG_NOSYSTEM": "1", "LC_ALL": "C",
        # status polls of agent worktrees must not take index.lock (agents run git there too)
        "GIT_OPTIONAL_LOCKS": "0",
    })
    return env


class Git:
    """Runs git through the sandboxed runner. ``lock`` serialises repo-mutating admin operations."""

    def __init__(self, runner: Runner, repo: str):
        self.runner = runner
        self.repo = repo
        self.lock = asyncio.Lock()
        self.env = git_env()

    async def run(self, *args: str, cwd: str | None = None, check: bool = True, input_text: str | None = None,
                  timeout: float = 120) -> ProcResult:
        for attempt in range(6):
            res = await self.runner.run(["git", *args], cwd or self.repo, env=self.env, timeout=timeout,
                                        input_text=input_text)
            if res.returncode == 0 or ".lock': File exists" not in res.stderr:
                break
            await asyncio.sleep(0.2 * (attempt + 1))  # transient lock held by a concurrent read-only git
        if check and res.returncode != 0:
            raise GitError(res)
        return res

    async def out(self, *args: str, cwd: str | None = None, **kw) -> str:
        return (await self.run(*args, cwd=cwd, **kw)).stdout

    async def rev(self, ref: str, cwd: str | None = None) -> str:
        return (await self.out("rev-parse", "--verify", ref + "^{commit}", cwd=cwd)).strip()

    # ---- worktrees -------------------------------------------------------------------------------

    async def add_worktree(self, path: str, commit: str, branch: str | None = None) -> None:
        async with self.lock:
            if os.path.exists(path):
                await self.run("worktree", "remove", "--force", path, check=False)
                if os.path.exists(path):
                    shutil.rmtree(path)
                await self.run("worktree", "prune", check=False)
            if branch:
                await self.run("worktree", "add", "-q", "-B", branch, path, commit)
            else:
                await self.run("worktree", "add", "-q", "--detach", path, commit)

    async def remove_worktree(self, path: str) -> None:
        async with self.lock:
            await self.run("worktree", "remove", "--force", path, check=False)
            if os.path.exists(path):
                shutil.rmtree(path, ignore_errors=True)
            await self.run("worktree", "prune", check=False)

    async def checkout_detached(self, wt: str, commit: str) -> None:
        await self.run("checkout", "-q", "-f", "--detach", commit, cwd=wt)
        await self.run("clean", "-q", "-fdx", cwd=wt)

    # ---- refs and commits ------------------------------------------------------------------------

    async def update_ref(self, ref: str, new: str, old: str | None = None) -> None:
        async with self.lock:
            args = ["update-ref", ref, new] + ([old] if old else [])
            await self.run(*args)

    async def changed_files(self, a: str, b: str, cwd: str | None = None) -> list[str]:
        """Paths changed between two commits (renames reported as both paths)."""
        out = await self.out("diff", "--name-status", "--no-renames", "-z", a, b, cwd=cwd)
        parts = [p for p in out.split("\0") if p]
        paths, i = [], 0
        while i < len(parts):
            status = parts[i]
            if status[:1] in "RC" and i + 2 < len(parts):
                paths += [parts[i + 1], parts[i + 2]]
                i += 3
            else:
                if i + 1 < len(parts):
                    paths.append(parts[i + 1])
                i += 2
        return sorted(set(paths))

    async def diff_text(self, a: str, b: str, cwd: str | None = None, limit: int = 12000) -> str:
        out = await self.out("diff", "--no-color", "--stat", "-p", a, b, cwd=cwd)
        return out if len(out) <= limit else out[:limit] + f"\n... [diff truncated, {len(out) - limit} more chars]\n"

    async def merge_tree(self, base: str, ours: str, theirs: str) -> tuple[str | None, list[str]]:
        """3-way merge without a worktree. Returns (tree, []) when clean or (None, conflicted paths)."""
        res = await self.run("merge-tree", "--write-tree", "--name-only", "--no-messages",
                             f"--merge-base={base}", ours, theirs, check=False)
        lines = res.stdout.splitlines()
        if res.returncode == 0 and lines:
            return lines[0].strip(), []
        if res.returncode == 1 and lines:
            return None, sorted({ln.strip() for ln in lines[1:] if ln.strip()})
        raise GitError(res)

    async def commit_tree(self, tree: str, parents: list[str], message: str) -> str:
        args = ["commit-tree", tree]
        for p in parents:
            args += ["-p", p]
        return (await self.out(*args, input_text=message)).strip()

    async def merge_base(self, a: str, b: str) -> str:
        return (await self.out("merge-base", a, b)).strip()

    async def is_ancestor(self, a: str, b: str) -> bool:
        res = await self.run("merge-base", "--is-ancestor", a, b, check=False)
        return res.returncode == 0

    async def squash_onto(self, target: str, change_head: str, change_base: str, message: str
                          ) -> tuple[str | None, list[str]]:
        """Land ``change_base..change_head`` on ``target`` as one commit (parent = target)."""
        tree, conflicts = await self.merge_tree(change_base, target, change_head)
        if tree is None:
            return None, conflicts
        return await self.commit_tree(tree, [target], message), []

    # ---- worktree content --------------------------------------------------------------------------

    async def status_paths(self, wt: str) -> list[str]:
        """Modified, added, deleted and untracked paths in a worktree (relative to its root)."""
        out = await self.out("status", "--porcelain", "-z", "--untracked-files=all", cwd=wt)
        parts = [p for p in out.split("\0") if p]
        paths, i = [], 0
        while i < len(parts):
            entry = parts[i]
            code, path = entry[:2], entry[3:]
            paths.append(path)
            if code[0] in "RC":  # the next part is the original path
                i += 1
                if i < len(parts):
                    paths.append(parts[i])
            i += 1
        return sorted(set(paths))

    async def unmerged_paths(self, wt: str) -> list[str]:
        out = await self.out("diff", "--name-only", "--diff-filter=U", cwd=wt)
        return sorted({p for p in out.splitlines() if p})

    async def commit_all(self, wt: str, message: str) -> tuple[str, bool]:
        """Stage everything and commit. Returns (head, created_new_commit). Commits even if empty
        when a merge is in progress (to record the merge parents)."""
        await self.run("add", "-A", cwd=wt)
        merging = os.path.exists(os.path.join(await self.git_dir(wt), "MERGE_HEAD"))
        st = await self.out("status", "--porcelain", cwd=wt)
        if not st.strip() and not merging:
            return await self.rev("HEAD", cwd=wt), False
        await self.run("commit", "-q", "--no-verify", "--allow-empty", "-m", message, cwd=wt)
        return await self.rev("HEAD", cwd=wt), True

    async def git_dir(self, wt: str) -> str:
        return (await self.out("rev-parse", "--absolute-git-dir", cwd=wt)).strip()

    async def merge_into_worktree(self, wt: str, commit: str) -> list[str]:
        """``git merge --no-commit`` in a worktree, leaving conflict markers. Returns conflicted paths."""
        res = await self.run("merge", "--no-commit", "--no-ff", "--no-edit", commit, cwd=wt, check=False)
        conflicts = await self.unmerged_paths(wt)
        if res.returncode != 0 and not conflicts:
            msg = (res.stdout + res.stderr).lower()
            if "already up to date" in msg or "already up-to-date" in msg:
                return []
            raise GitError(res)
        return conflicts

    async def abort_merge(self, wt: str) -> None:
        await self.run("merge", "--abort", cwd=wt, check=False)

    async def files_with_markers(self, wt: str, paths: list[str]) -> list[str]:
        bad = []
        for p in paths:
            full = os.path.join(wt, p)
            if not os.path.isfile(full):
                continue
            try:
                with open(full, encoding="utf-8", errors="replace") as fh:
                    if CONFLICT_MARKER.search(fh.read()):
                        bad.append(p)
            except OSError:
                pass
        return bad


def union_resolve(text: str) -> str:
    """Resolve conflict hunks by keeping both sides (ours, then theirs); drops a diff3 base section."""
    out, i = [], 0
    lines = text.splitlines(keepends=True)
    while i < len(lines):
        ln = lines[i]
        if ln.startswith("<<<<<<<"):
            ours, base, theirs, section = [], [], [], "ours"
            i += 1
            while i < len(lines) and not lines[i].startswith(">>>>>>>"):
                cur = lines[i]
                if cur.startswith("|||||||") and section == "ours":
                    section = "base"
                elif cur.startswith("=======") and section in ("ours", "base"):
                    section = "theirs"
                else:
                    {"ours": ours, "base": base, "theirs": theirs}[section].append(cur)
                i += 1
            out += ours if ours == theirs else ours + theirs
            i += 1  # skip >>>>>>>
            continue
        out.append(ln)
        i += 1
    return "".join(out)
