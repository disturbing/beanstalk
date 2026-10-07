"""The changes the load generator pushes: each task's reference solution as a ready commit, made by the race's replay
agent (``harness.agents.ReplayAdapter``: ``git apply --3way`` of the reference, the standalone reference when the
prerequisites are not on the head, conflicted hunks union-resolved), plus the task's acceptance tests.

Two modes for a dependent task (``upstream.prerequisites`` in its task file):

* ``standalone``: start it whenever a worker is free; the replay agent applies ``tNNN.standalone.patch`` (the change
  plus the prerequisites' parts it needs) when the reference does not apply to the head it starts from.
* ``chain``: start it only once every prerequisite is integrated, and apply its own reference on top.

Reactions to a kick-out (red or conflict) re-make the change on the latest line: reset to it and re-apply the
reference three-way. Files the replay agent had to union-resolve are replaced by their **upstream version**: the file
as the chain build has it (base + every reference in history order, which the arena's build checked green) right
after this task, or after the latest already-integrated task that touches the file when that one comes later in the
chain, so the integrated change to the file is kept. A second red re-make takes the upstream version of every file
the change touches. Every reaction is counted by the caller.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field

from harness.agents import InvocationSpec, ReplayAdapter
from harness.arena import Task, load_tasks, patch_strip_level
from harness.gitops import Git, GitError

UNION_NOTE = re.compile(r"union-resolved [^:]+: (.+)$")


@dataclass
class Change:
    task: Task
    prerequisites: list[str]
    patch: str | None
    standalone: str | None
    files: list[str] = field(default_factory=list)   # paths the reference (or standalone) touches, plus acceptance
    chain_sha: str | None = None                       # the chain build right after this task


@dataclass
class Made:
    sha: str
    base: str
    upstream_files: list[str] = field(default_factory=list)   # files taken from the chain build
    notes: list[str] = field(default_factory=list)
    used_standalone: bool = False


def patch_paths(path: str) -> list[str]:
    out = []
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            m = re.match(r"^diff --git a/(\S+) b/(\S+)", line)
            if m:
                out += [m.group(1), m.group(2)]
    return sorted(set(out))


class ChangeBook:
    def __init__(self, arena: str, git: Git, work: str, *, mode: str = "standalone", tasks: list[str] | None = None):
        if mode not in ("standalone", "chain"):
            raise ValueError("mode is standalone or chain")
        self.arena, self.git, self.work, self.mode = arena, git, work, mode
        self.tasks = load_tasks(arena, tasks)
        self.changes: dict[str, Change] = {}
        self.order = [t.id for t in self.tasks]
        self.replay = ReplayAdapter(git, seed=0, median=0.0, sigma=0.0)
        self.strip: dict[str, int] = {}
        for t in self.tasks:
            prereq = self._prerequisites(t.id)
            sol = t.solution
            standalone = sol[:-len(".patch")] + ".standalone.patch" if sol else None
            standalone = standalone if standalone and os.path.exists(standalone) else None
            files = set(t.acceptance_paths)
            for p in (sol, standalone):
                if p:
                    files |= set(patch_paths(p))
            self.changes[t.id] = Change(task=t, prerequisites=prereq, patch=sol, standalone=standalone,
                                        files=sorted(files))

    def _prerequisites(self, tid: str) -> list[str]:
        import json
        path = os.path.join(self.arena, "tasks", f"{tid}.json")
        with open(path, encoding="utf-8") as fh:
            raw = json.load(fh)
        return list((raw.get("upstream") or {}).get("prerequisites") or [])

    def startable(self, tid: str, integrated: set[str]) -> bool:
        if self.mode == "standalone":
            return True
        return all(p in integrated or p not in self.changes for p in self.changes[tid].prerequisites)

    async def _strip(self, path: str, files: set[str]) -> int:
        if path not in self.strip:
            with open(path, encoding="utf-8", errors="replace") as fh:
                self.strip[path] = patch_strip_level(fh.read(), files)
        return self.strip[path]

    async def _files(self, sha: str) -> set[str]:
        return set((await self.git.out("ls-tree", "-r", "--name-only", sha)).splitlines())

    def _write_acceptance(self, wt: str, task: Task) -> None:
        for path, content in task.acceptance_tests.items():
            full = os.path.join(wt, path)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "w", encoding="utf-8") as fh:
                fh.write(content)

    async def build_chain(self, base: str) -> str:
        """Base + every reference (and its acceptance tests) in task order, one commit each: the upstream versions
        the reactions fall back to, and the expected end state. Returns the last commit."""
        wt = os.path.join(self.work, "chain")
        await self.git.add_worktree(wt, base, None)
        files = await self._files(base)
        head = base
        for tid in self.order:
            ch = self.changes[tid]
            notes: list[str] = []
            if ch.patch:
                strip = await self._strip(ch.patch, files)
                await self.replay._apply(wt, {"path": ch.patch, "strip": strip}, notes)
            self._write_acceptance(wt, ch.task)
            head, _ = await self.git.commit_all(wt, f"chain: {tid}\n")
            ch.chain_sha = head
        await self.git.remove_worktree(wt)
        return head

    def upstream_sha(self, ch: Change, path: str, integrated: set[str]) -> str:
        """The chain commit whose version of ``path`` to take: right after ``ch``, or after the latest integrated
        task that also touches ``path`` when that comes later in the chain (so its change to the file stays)."""
        idx = self.order.index(ch.task.id)
        for tid in integrated:
            if tid in self.changes and path in self.changes[tid].files:
                idx = max(idx, self.order.index(tid))
        sha = self.changes[self.order[idx]].chain_sha
        assert sha
        return sha

    async def take_upstream(self, wt: str, ch: Change, paths: list[str], integrated: set[str]) -> list[str]:
        """Check out ``paths`` as the chain build has them (``upstream_sha``), deleting those it does not have."""
        taken = []
        for p in paths:
            sha = self.upstream_sha(ch, p, integrated)
            if p in await self._files(sha):
                await self.git.run("checkout", sha, "--", p, cwd=wt)
            else:
                await self.git.run("rm", "-q", "-f", "--ignore-unmatch", "--", p, cwd=wt)
            taken.append(p)
        return taken

    async def make(self, wt: str, tid: str, onto: str, *, all_upstream: bool = False, label: str = "",
                   integrated: set[str] | None = None, after_red: bool = False) -> Made:
        """The change ``tid`` as one commit on ``onto`` in worktree ``wt`` (created or reset)."""
        ch = self.changes[tid]
        if not os.path.exists(os.path.join(wt, ".git")):
            await self.git.add_worktree(wt, onto, None)
        else:
            await self.git.run("merge", "--abort", cwd=wt, check=False)
            await self.git.run("reset", "-q", "--hard", onto, cwd=wt)
            await self.git.run("clean", "-q", "-fdx", cwd=wt, check=False)
        made = Made(sha="", base=onto)
        integrated = integrated or set()
        if all_upstream:
            made.upstream_files = await self.take_upstream(wt, ch, ch.files, integrated)
            made.notes.append("took the upstream version of every file the change touches")
        elif ch.patch:
            files = await self._files(onto)
            ref = {"path": ch.patch, "strip": await self._strip(ch.patch, files)}
            if self.mode == "standalone" and ch.standalone:
                ref["fallback"] = ch.standalone
            fixes = []
            if after_red and ch.task.fix_patch:  # an arena's replay-only repair hint (the designed fixtures)
                fixes = [{"path": ch.task.fix_patch, "strip": await self._strip(ch.task.fix_patch, files)}]
            spec = InvocationSpec(inv_id=f"lg-{tid}-{label}", kind="initial", task_id=tid, agent_id=None, cwd=wt,
                                  prompt="", replay={"patches": [ref], "fixes": fixes})
            res = await self.replay.run(spec)
            made.notes += res.notes
            made.used_standalone = any("standalone" in n for n in res.notes)
            union = [p.strip() for n in res.notes for m in [UNION_NOTE.search(n)] if m for p in m.group(1).split(",")]
            failed = any(n.startswith("could not apply") for n in res.notes)
            if failed:
                made.upstream_files = await self.take_upstream(wt, ch, ch.files, integrated)
            elif union:
                made.upstream_files = await self.take_upstream(wt, ch, union, integrated)
        self._write_acceptance(wt, ch.task)
        message = f"{ch.task.title}\n\nTask: {tid}\n"
        try:
            sha, _ = await self.git.commit_all(wt, message)
        except GitError:
            await self.git.run("add", "-A", cwd=wt)
            await self.git.run("commit", "-q", "--no-verify", "--allow-empty", "-m", message, cwd=wt)
            sha = await self.git.rev("HEAD", cwd=wt)
        made.sha = sha
        return made
