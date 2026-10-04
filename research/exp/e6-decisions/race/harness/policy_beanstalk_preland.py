"""Beanstalk with a pre-land check: repair before landing, while the author still has the context.

Same as ``policy_beanstalk`` (placement, single-writer committer, asynchronous validator, causal repair
tickets, error budget) with one change to the committer, motivated by the first real-agent races:

    On finish, the committer squash-merges the task onto the trunk head as before. Before publishing the
    merged commit it runs the suite on that exact tree (the agent-side check: real suite time only, no CI
    slot and no emulated CI latency, standing in for the agent's own sandbox). Green: land, unchanged.
    Red: do not land. The trunk head is merged into the author's worktree and the SAME agent (session
    resumed) gets the failing tests and output, then the committer retries. After ``--max-rework``
    rounds the task is dropped.

Why: in the first race (8 Haiku agents, 40 arena tasks) the unchecked fast trunk was red in 33 of 41
validations and fresh-session fixers cost $14.06 of $25.00, while the queue (which tests before landing
and sends reds back to the author) finished for $6.93. Landing without blocking only pays if what lands
is usually green; this variant keeps the non-blocking trunk for everyone else and moves the check into
the author's own loop. Residual reds (interactions the check could not see) still go to the validator.

Set ``PRELAND_SECONDS`` in the environment to add emulated latency to each pre-land check (default 0).

``PRELAND_MODE=optimistic`` (default ``locked``) runs checks in parallel outside the committer lock, one
slot per agent (the agent's own sandbox), on the trunk head seen when the check started. Under the lock:
if the trunk has not moved, land; if it moved, re-squash onto the new head and land without re-checking
when the commits that landed meanwhile share no file with the change (a semantic break across disjoint
files is left to the validator); otherwise check again. After 3 re-checks the attempt falls back to a
check inside the lock, so progress is guaranteed. Use it with ``PRELAND_SECONDS`` equal to the emulated CI
latency for a like-for-like comparison with the queue (the suite costs the same wherever it runs).
"""
from __future__ import annotations

import os

from .agents import InvocationSpec
from .arena import Task, placement_modules
from .ci import CI, CIResult
from .core import AgentSlot, TaskState
from .policy_beanstalk import BeanstalkRace, TrunkCommit
from .prompts import NO_COMMIT, acceptance_line


def preland_red(task: Task, failing: list[str], output: str, resumed: bool) -> str:
    head = "" if resumed else f"You are working on: {task.title}\n\n{task.prompt.strip()}\n\n"
    tests = "\n".join(f"- {t}" for t in failing) or "- (the suite failed; see the output)"
    return (f"{head}Your change was not landed. Merged onto the latest trunk, these tests failed:\n{tests}\n\n"
            f"Output:\n```\n{output.strip()}\n```\n\n"
            "The latest trunk has been merged into this worktree. Fix your change so the whole suite passes. "
            "Acceptance tests (yours and other teams') are protected: edits to them are discarded before landing, "
            "so change the code, not the tests. Other teams' acceptance tests describe behaviour that must keep "
            f"working. {acceptance_line(task.acceptance_paths)} {NO_COMMIT}\n")


class BeanstalkPrelandRace(BeanstalkRace):
    policy = "beanstalk"
    variant = "preland"

    def __init__(self, cfg):
        super().__init__(cfg)
        self.preland_ci: CI | None = None
        self.preland_latency = float(os.environ.get("PRELAND_SECONDS", "0") or 0)
        self.preland_mode = os.environ.get("PRELAND_MODE", "locked")
        self.stats.update({"preland_checks": 0, "preland_red": 0, "preland_seconds": 0.0,
                           "preland_reworks": 0, "preland_drops": 0, "preland_mode": self.preland_mode,
                           "preland_latency": self.preland_latency, "preland_optimistic_landings": 0,
                           "preland_rechecks": 0, "preland_locked_fallbacks": 0})

    async def setup(self) -> None:
        await super().setup()
        assert self.git
        # locked: checks run inside the committer lock, so one slot; optimistic: one slot per agent sandbox
        slots = max(1, self.cfg.agents) if self.preland_mode == "optimistic" else 1
        self.preland_ci = CI(self.git, self.runner, os.path.join(self.work, "preland"), slots, self.preland_latency,
                             self.cfg.suite_timeout)
        await self.preland_ci.setup(self.base_sha)

    async def preland_check(self, sha: str, ts: TaskState) -> CIResult:
        assert self.preland_ci
        res = await self.preland_ci.run(sha, "preland")
        self.stats["preland_checks"] += 1
        self.stats["preland_seconds"] += res.ci_seconds
        if not res.green:
            self.stats["preland_red"] += 1
        self.log("preland.check", task=ts.id, sha=sha, green=res.green, failing_files=res.failing_files,
                 failing_tests=[f"{t['file']} > {t['name']}" for t in res.failing_tests][:20],
                 suite_seconds=round(res.suite_seconds, 3), check_seconds=round(res.ci_seconds, 3))
        return res

    async def land(self, wt: str, *, kind: str, agent: AgentSlot, ts: TaskState | None = None,
                   ticket=None) -> int | None:
        if kind != "task" or ts is None:  # fixers keep the parent's behaviour
            return await super().land(wt, kind=kind, agent=agent, ts=ts, ticket=ticket)
        assert self.git
        rounds = 0
        while True:
            change_head = await self.git.rev("HEAD", cwd=wt)
            red: CIResult | None = None
            if self.preland_mode == "optimistic":
                outcome, head, new, conflicts, red = await self.try_optimistic(change_head, ts, kind)
                if outcome == "landed":
                    return new  # type: ignore[return-value]  # the trunk index
            else:
                async with self.committer:
                    head = self.trunk
                    mb = await self.git.merge_base(change_head, head)
                    new, conflicts = await self.git.squash_onto(head, change_head, mb,
                                                                self.land_message(kind, ts, None))
                    if new is not None:
                        res = await self.preland_check(new, ts)
                        if res.green:
                            return await self.publish(new, head, kind, ts)
                        red = res
            rounds += 1
            if rounds > self.cfg.max_rework:
                if red:
                    self.stats["preland_drops"] += 1
                    self.drop(ts, "pre-land check still red after --max-rework attempts")
                return None
            if red is None:  # textual conflict: same path as the parent (the author re-executes on the new head)
                self.conflicts_met += 1
                ts.conflicts += 1
                self.conflict_events.append({"task": ts.id, "files": conflicts})
                self.log("merge.conflict", task=ts.id, ticket=None, onto=head, files=conflicts)
                if not await self.resolve_on(wt, head, conflicts, agent, ts, rounds):
                    return None
                continue
            if not await self.repair_before_landing(wt, head, red, agent, ts, rounds):
                return None

    async def try_optimistic(self, change_head: str, ts: TaskState, kind: str):
        """Check outside the lock, land under it. Returns (outcome, head, new_or_idx, conflicts, red):
        ("landed", head, idx, [], None) | ("conflict", head, None, files, None) | ("red", head, sha, [], res)."""
        assert self.git
        msg = self.land_message(kind, ts, None)
        rechecks = 0
        while True:
            head0 = self.trunk
            mb = await self.git.merge_base(change_head, head0)
            new0, conflicts = await self.git.squash_onto(head0, change_head, mb, msg)
            if new0 is None:
                return "conflict", head0, None, conflicts, None
            if rechecks >= 3:  # heavy churn: check inside the lock so this attempt cannot starve
                self.stats["preland_locked_fallbacks"] += 1
                async with self.committer:
                    head = self.trunk
                    mb = await self.git.merge_base(change_head, head)
                    new, conflicts = await self.git.squash_onto(head, change_head, mb, msg)
                    if new is None:
                        return "conflict", head, None, conflicts, None
                    res = await self.preland_check(new, ts)
                    if not res.green:
                        return "red", head, new, [], res
                    return "landed", head, await self.publish(new, head, kind, ts), [], None
            res = await self.preland_check(new0, ts)
            if not res.green:
                return "red", head0, new0, [], res
            async with self.committer:
                head = self.trunk
                if head == head0:
                    return "landed", head, await self.publish(new0, head, kind, ts), [], None
                mb2 = await self.git.merge_base(change_head, head)
                new, conflicts = await self.git.squash_onto(head, change_head, mb2, msg)
                if new is None:
                    return "conflict", head, None, conflicts, None
                delta = set(await self.git.changed_files(head0, head))
                mine = set(await self.git.changed_files(mb, change_head))
                if not (delta & mine):
                    self.stats["preland_optimistic_landings"] += 1
                    self.log("preland.optimistic", task=ts.id, checked_on=head0, landed_on=head,
                             landed_meanwhile=len(delta))
                    return "landed", head, await self.publish(new, head, kind, ts), [], None
            rechecks += 1
            self.stats["preland_rechecks"] += 1
            self.log("preland.recheck", task=ts.id, checked_on=head0, head=self.trunk, attempt=rechecks)

    async def publish(self, new: str, head: str, kind: str, ts: TaskState) -> int:
        """Caller holds the committer lock. Identical bookkeeping to the parent's landing."""
        assert self.git
        await self.git.update_ref("refs/heads/trunk", new, head)
        self.trunk = new
        files = await self.git.changed_files(head, new)
        c = TrunkCommit(idx=len(self.commits), sha=new, parent=head, kind=kind, task_id=ts.id, ticket_id=None,
                        files=files, modules=sorted(placement_modules(files)), landed_at=self.now())
        self.commits.append(c)
        self.sha_idx[new] = c.idx
        self.stats["landings"] += 1
        self.log("land", task=c.task_id, ticket=None, kind=kind, sha=new, target="trunk", trunk_idx=c.idx,
                 files=files, unvalidated=len(self.commits) - 1 - self.green_idx, prelanded=True)
        self.poke()
        return c.idx

    async def resolve_on(self, wt: str, head: str, conflicts: list[str], agent: AgentSlot, ts: TaskState,
                         rounds: int) -> bool:
        """Merge ``head`` into the worktree and let the author resolve markers (parent's re-execution)."""
        assert self.git
        files = await self.git.merge_into_worktree(wt, head)
        if not files:
            await self.git.commit_all(wt, "Merge trunk into task\n")
            return True
        left = await self.reexecute(wt, files, head, kind="task", agent=agent, ts=ts, ticket=None, attempt=rounds)
        if not left:
            return True
        await self.git.abort_merge(wt)
        if left == ["(unresolved)"]:
            self.drop(ts, "replay could not resolve the conflict (limitation of replay agents)")
        return False

    async def repair_before_landing(self, wt: str, head: str, red: CIResult, agent: AgentSlot, ts: TaskState,
                                    rounds: int) -> bool:
        """Bring the trunk into the author's worktree and send the failures back to the same session."""
        assert self.git
        if not await self.resolve_on(wt, head, [], agent, ts, rounds):
            return False
        failing = [f"{t['file']} > {t['name']}" for t in red.failing_tests][:20] or list(red.failing_files or [])
        resumed = self.can_resume(ts)
        ts.reworks += 1
        ts.status = "rework"
        self.stats["preland_reworks"] += 1
        spec = InvocationSpec(inv_id=self.new_inv_id("rework"), kind="rework", task_id=ts.id, agent_id=agent.id,
                              cwd=wt, prompt=preland_red(ts.task, failing, red.output, resumed), attempt=rounds,
                              resume_session=ts.session_id if resumed else None,
                              replay={"reset_to": head, "patches": self.patch_ref(ts.task.solution),
                                      "check": "acceptance", "acceptance": ts.task.acceptance_tests})
        self.log("rework.start", task=ts.id, ticket=None, reason="preland-red", failing=failing, attempt=rounds,
                 resumed=resumed)
        res = await self.invoke_rework(spec, agent, ts, preland_red(ts.task, failing, red.output, False))
        if self.aborted:
            return False
        if res.subtype == "unresolved":
            self.drop(ts, "replay could not repair the pre-land failure (limitation of replay agents)")
            return False
        left = await self.markers_left(wt)
        if left:
            self.log("rework.markers_left", task=ts.id, ticket=None, files=left)
        await self.commit_task(ts, spec.inv_id, "rework")
        ts.status = "running"
        return True

    def policy_summary(self) -> dict:
        out = super().policy_summary()
        st = out["beanstalk"]
        st["variant"] = "preland"
        st["preland_seconds"] = round(st["preland_seconds"], 2)
        out["policy_rows"] = [("Variant", "pre-land check (repair before landing, same session)"),
                              ("Pre-land checks (red) / reworks / drops",
                               f"{st['preland_checks']} ({st['preland_red']}) / {st['preland_reworks']} / "
                               f"{st['preland_drops']}"),
                              ("Pre-land check minutes", f"{round(st['preland_seconds'] / 60, 2)}"),
                              ("Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks",
                               f"{st['preland_mode']} / {st['preland_latency']} / {st['preland_optimistic_landings']}"
                               f" / {st['preland_rechecks']} / {st['preland_locked_fallbacks']}"),
                              *out["policy_rows"]]
        return out

