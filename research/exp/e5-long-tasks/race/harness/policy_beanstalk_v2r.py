"""Beanstalk v2r (E5 extra): v2 with the agent released while its change is being checked.

v2 as harnessed binds an agent to its task until the task has landed: the agent sits idle through every 60 s pre-land
check, every recheck and every wait for the committer. That is a harness choice, not part of the design in
docs/claude-opus/10 §6, where checks run on runner instances and the driver slot is free to take other instructions
("start task", "rework") while a check runs. With seconds-long beans the binding hardly matters (the check dominates
the agent's day either way); with minutes-long beans it costs about as many agent-minutes as the agent spends writing
(E5: 72 blocked against 139 busy agent-minutes in the 2-minute-bean race).

v2r changes only that:
  * the agent is released as soon as the initial invocation has finished (the change is submitted);
  * a later rework invocation (textual conflict, red pre-land check) needs an agent again: the task waits for a free one,
    and while any rework is waiting, no new task is started (in-flight changes are finished before new ones are begun);
    merges, checks, decision cards and landings need no agent;
  * everything else is v2: optimistic landing, rechecks, informed repair, decision cards, revert-first.
Run with the same flags as v2 (``PRELAND_MODE=optimistic PRELAND_SECONDS=60 --snapshot head --error-budget 999``).
Events ``agent.acquired`` record how long each rework waited for an agent.
"""
from __future__ import annotations

import asyncio
import time

from .ci import CIResult
from .core import Aborted, AgentSlot, Race, TaskState
from .policy_beanstalk_v2 import BeanstalkV2Race


class BeanstalkV2ReleaseRace(BeanstalkV2Race):
    policy = "beanstalk"
    variant = "v2r"

    def __init__(self, cfg):
        super().__init__(cfg)
        self.rework_waiters = 0
        self.stats.update({"release_waits": 0, "release_wait_seconds": 0.0, "release_wait_max_seconds": 0.0})

    # ---- agent pool: reworks first ------------------------------------------------------------------------------

    def free_count(self) -> int:
        return sum(1 for a in self.agents if not a.holding and not a.running)

    def free_agent(self) -> AgentSlot | None:
        """Used by ``dispatch`` to start new tasks: leave idle agents to the reworks that are waiting for one."""
        if self.rework_waiters >= self.free_count():
            return None
        return Race.free_agent(self)

    async def acquire_agent(self, ts: TaskState) -> AgentSlot:
        t0 = time.monotonic()
        self.rework_waiters += 1
        try:
            while True:
                async with self.lock:
                    agent = Race.free_agent(self)
                    if agent is not None:
                        self.hold(agent, ts.id)
                        break
                if self.aborted:
                    raise Aborted(self.aborted)
                await asyncio.sleep(0.2)
        finally:
            self.rework_waiters -= 1
        waited = time.monotonic() - t0
        self.stats["release_waits"] += 1
        self.stats["release_wait_seconds"] += waited
        self.stats["release_wait_max_seconds"] = max(self.stats["release_wait_max_seconds"], waited)
        self.log("agent.acquired", task=ts.id, agent=agent.id, waited_seconds=round(waited, 2))
        return agent

    def release_held(self, agent: AgentSlot, ts: TaskState) -> None:
        """Release ``agent`` only if this task still holds it (it may have been given to another task meanwhile)."""
        if agent.holding == ts.id:
            self.release(agent.id)

    # ---- the task's life: the agent is free between submit and the next rework ---------------------------------------

    async def task_flow(self, ts: TaskState, agent: AgentSlot) -> None:
        try:
            if not await self.run_initial(ts, agent, self.snapshot_sha()):
                return
            self.release_held(agent, ts)   # submitted: the agent is free while the change is checked and waits to land
            idx = await self.land(ts.worktree, kind="task", ts=ts, agent=agent)
            if idx is None:
                if ts.status != "dropped":
                    self.drop(ts, "unresolved conflict after --max-rework attempts")
                return
            ts.status = "landed"
            ts.landed_at = self.now()
            await self.record_landing(ts, self.commits[idx].sha, self.commits[idx].parent)
        finally:
            self.flows -= 1

    async def invoke_rework(self, spec, agent: AgentSlot, ts: TaskState, fresh_prompt: str):
        """The only places v2 needs an agent after the initial invocation are rework invocations (conflict repair through
        ``reexecute``, informed repair through ``repair_before_landing``): acquire one just before, release it just after.
        Merges, checks, decision cards and landings need none."""
        if agent.holding == ts.id:
            return await super().invoke_rework(spec, agent, ts, fresh_prompt)
        held = await self.acquire_agent(ts)
        spec.agent_id = held.id
        try:
            return await super().invoke_rework(spec, held, ts, fresh_prompt)
        finally:
            self.release_held(held, ts)

    def policy_summary(self) -> dict:
        out = super().policy_summary()
        st = out["beanstalk"]
        st["variant"] = "v2r"
        st["release_wait_seconds"] = round(st["release_wait_seconds"], 1)
        st["release_wait_max_seconds"] = round(st["release_wait_max_seconds"], 1)
        rows = [("Variant", "v2r: v2 with the agent released while its change is checked (E5 extra)"),
                ("Reworks that waited for an agent / total wait s / longest s",
                 f"{st['release_waits']} / {st['release_wait_seconds']} / {st['release_wait_max_seconds']}")]
        out["policy_rows"] = rows + [r for r in out["policy_rows"] if r[0] != "Variant"]
        return out
