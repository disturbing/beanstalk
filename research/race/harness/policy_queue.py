"""Baseline: a good batched merge queue with speculative batches and K-ary bisection.

1. A task branches from the current green ``main`` when it starts; on finish its PR is enqueued.
   With ``--queue-hold`` (default) the author agent stays bound to the PR until it lands or bounces.
2. The integrator builds a batch of up to k PRs by squash-merging each onto the batch head in turn;
   with K CI slots, up to K batches are in flight, each stacked on the previous one (speculative).
3. A textual conflict with ``main`` ejects that PR to its author: the harness merges ``main`` into the
   PR worktree, leaving conflict markers; the agent resolves them; the PR re-enqueues. A PR that merges
   cleanly onto ``main`` but conflicts with a PR ahead of it (a batch-mate or an in-flight batch) is held
   at the front of the queue until the batches ahead resolve, then retried.
4. CI = full suite (every landed and batch acceptance test is committed) + S seconds.
5. Green: fast-forward main, in batch order.
6. Red: later speculative batches are cancelled and requeued; the batch is bisected over its prefixes
   (K probes per round) to the first failing PR; the green prefix lands, the culprit is ejected to its
   author with the failing output, and the PRs after it go back to the front of the queue.
k = 1 is a serial queue.
"""
from __future__ import annotations

import asyncio
from collections import deque
from dataclasses import dataclass, field

from . import prompts
from .agents import InvocationSpec
from .ci import CIResult
from .core import AgentSlot, Race, TaskState


@dataclass
class Batch:
    id: str
    base: str
    prs: list[TaskState]
    commits: list[str]
    head: str
    result: CIResult | None = None
    task: asyncio.Task | None = None
    cancelled: bool = False
    sizes: list[int] = field(default_factory=list)


class QueueRace(Race):
    policy = "queue"

    def __init__(self, cfg):
        super().__init__(cfg)
        self.main = ""
        self.pending: deque[TaskState] = deque()
        self.inflight: list[Batch] = []
        self.bisecting = False
        self.unstarted: list[TaskState] = []
        self.rework_jobs: deque = deque()
        self.batch_seq = 0
        self.hold_for_inflight = False   # a PR conflicts only with PRs ahead: wait for them to resolve
        self.enqueued_at: dict[str, float] = {}
        self.ejections_total: dict[str, int] = {}
        self.stats = {"batches": 0, "batches_green": 0, "batches_red": 0, "batches_cancelled": 0,
                      "bisections": 0, "bisect_runs": 0, "ejections_conflict": 0, "ejections_red": 0,
                      "requeued_without_agent": 0, "held_behind_inflight": 0, "batch_sizes": []}

    async def setup(self) -> None:
        await super().setup()
        self.main = self.base_sha
        self.unstarted = sorted(self.tasks, key=lambda t: t.task.order)

    def final_green_sha(self) -> str:
        return self.main

    def finished(self) -> bool:
        return (all(t.terminal for t in self.tasks) and not self.inflight and not self.bisecting
                and not self.rework_jobs)

    # ---- dispatch ------------------------------------------------------------------------------------------

    async def dispatch(self) -> None:
        while self.rework_jobs:
            a = self.free_agent()
            if not a:
                break
            ts, reason, info = self.rework_jobs.popleft()
            ts.agent = a.id
            self.hold(a, ts.id)
            self.spawn(self.rework_flow(ts, a, reason, info), f"rework-{ts.id}")
        while self.unstarted:
            a = self.free_agent()
            if not a:
                break
            ts = self.unstarted.pop(0)
            ts.status = "running"
            self.hold(a, ts.id)
            self.spawn(self.task_flow(ts, a), f"task-{ts.id}")
        await self.integrate()

    async def task_flow(self, ts: TaskState, agent: AgentSlot) -> None:
        if await self.run_initial(ts, agent, self.main):
            async with self.lock:
                self.enqueue(ts)

    def enqueue(self, ts: TaskState) -> None:
        ts.status = "queued"
        self.pending.append(ts)
        self.enqueued_at[ts.id] = self.now()
        self.log("queue.enqueue", task=ts.id, sha=ts.head_sha, depth=len(self.pending))
        if not self.cfg.queue_hold and ts.agent:
            self.release(ts.agent)
        self.poke()

    # ---- integrator ------------------------------------------------------------------------------------------

    def land_message(self, ts: TaskState) -> str:
        return f"{ts.task.title}\n\nTask: {ts.id}\nPolicy: queue\n"

    async def integrate(self) -> None:
        if self.bisecting:
            return
        if self.hold_for_inflight and not self.inflight:
            self.hold_for_inflight = False
        while (self.pending and not self.hold_for_inflight and len(self.inflight) < max(1, self.cfg.ci_slots)
               and self.ci_available() > 0 and self.batch_ready()):
            base = self.inflight[-1].head if self.inflight else self.main
            batch = await self.build_batch(base)
            if batch is None:
                continue
            self.inflight.append(batch)
            self.claim_ci()
            batch.task = self.spawn(self.batch_ci(batch), f"batch-{batch.id}")

    def batch_ready(self) -> bool:
        """Batching window: start once k PRs wait, the oldest waited --batch-wait seconds, or nothing else
        can arrive (no agent is still working on an unqueued task)."""
        if self.cfg.batch_wait <= 0 or len(self.pending) >= max(1, self.cfg.batch):
            return True
        oldest = min(self.enqueued_at.get(ts.id, self.now()) for ts in self.pending)
        if self.now() - oldest >= self.cfg.batch_wait:
            return True
        more_coming = any(t.status in ("running", "rework") for t in self.tasks) or self.unstarted
        return not more_coming

    async def build_batch(self, base: str) -> Batch | None:
        assert self.git
        cur, prs, commits = base, [], []
        while self.pending and len(prs) < max(1, self.cfg.batch):
            ts = self.pending.popleft()
            mb = await self.git.merge_base(ts.head_sha, cur)
            new, conflicts = await self.git.squash_onto(cur, ts.head_sha, mb, self.land_message(ts))
            if new is None and cur != self.main:
                mb_main = await self.git.merge_base(ts.head_sha, self.main)
                tree, _ = await self.git.merge_tree(mb_main, self.main, ts.head_sha)
                if tree is not None:
                    # only PRs ahead of it conflict: keep its place and wait for them to land or bounce
                    self.pending.appendleft(ts)
                    self.hold_for_inflight = True
                    self.stats["held_behind_inflight"] += 1
                    self.log("queue.hold", task=ts.id, files=conflicts, behind=[p.id for p in prs] +
                             [p.id for b in self.inflight for p in b.prs])
                    break
            if new is None:
                self.conflicts_met += 1
                ts.conflicts += 1
                self.conflict_events.append({"task": ts.id, "files": conflicts})
                self.log("merge.conflict", task=ts.id, onto=cur, onto_main=cur == self.main, files=conflicts,
                         batch_mates=[p.id for p in prs])
                self.eject(ts, "conflict", {"files": conflicts})
                continue
            prs.append(ts)
            commits.append(new)
            cur = new
        if not prs:
            return None
        self.batch_seq += 1
        b = Batch(id=f"b{self.batch_seq:03d}", base=base, prs=prs, commits=commits, head=cur)
        self.stats["batches"] += 1
        self.stats["batch_sizes"].append(len(prs))
        for ts in prs:
            ts.status = "testing"
        self.log("batch.start", batch=b.id, base=base, head=cur, tasks=[t.id for t in prs],
                 speculative=base != self.main)
        return b

    async def batch_ci(self, b: Batch) -> None:
        res = await self.run_ci(b.head, "batch", claimed=True, meta={"batch": b.id, "tasks": [t.id for t in b.prs]})
        async with self.lock:
            if b.cancelled:
                return
            b.result = res
            await self.resolve()

    async def resolve(self) -> None:
        while self.inflight and self.inflight[0].result is not None:
            b = self.inflight.pop(0)
            self.hold_for_inflight = False
            assert b.result is not None
            if b.result.green:
                self.stats["batches_green"] += 1
                await self.land(b.prs, b.commits)
                continue
            self.stats["batches_red"] += 1
            later, self.inflight = self.inflight, []
            requeue: list[TaskState] = []
            for lb in later:
                lb.cancelled = True
                if lb.task:
                    lb.task.cancel()
                self.stats["batches_cancelled"] += 1
                self.log("batch.cancel", batch=lb.id, tasks=[t.id for t in lb.prs], because=b.id)
                requeue += lb.prs
            for ts in reversed(requeue):
                ts.status = "queued"
                self.pending.appendleft(ts)
            self.log("batch.red", batch=b.id, tasks=[t.id for t in b.prs], failing=b.result.failing_files)
            if len(b.prs) == 1:
                self.eject_culprit(b, 0, b.result)
            else:
                self.bisecting = True
                self.spawn(self.bisect(b), f"bisect-{b.id}")
            break
        self.poke()

    async def land(self, prs: list[TaskState], commits: list[str]) -> None:
        assert self.git
        parent = self.main
        await self.git.update_ref("refs/heads/main", commits[-1])
        self.main = commits[-1]
        now = self.now()
        for ts, c in zip(prs, commits):
            await self.record_landing(ts, c, parent)
            parent = c
            ts.status = "green"
            ts.landed_at = ts.green_at = now
            self.log("land", task=ts.id, sha=c, target="main", files=ts.write_set)
            if ts.agent:
                a = self.agent(ts.agent)
                if a and a.holding == ts.id:
                    self.release(ts.agent)
        self.log("green.promote", sha=self.main, tasks=[t.id for t in prs])

    async def bisect(self, b: Batch) -> None:
        """K-ary search over batch prefixes for the first PR whose addition turns the suite red."""
        lo, hi = 0, len(b.prs)          # prefix lengths: lo known green (base), hi known red
        results: dict[int, CIResult] = {hi: b.result}  # type: ignore[dict-item]
        self.stats["bisections"] += 1
        self.log("bisect.start", batch=b.id, tasks=[t.id for t in b.prs])
        while hi - lo > 1:
            n = max(1, min(self.cfg.ci_slots, hi - lo - 1))
            points = sorted({lo + max(1, round((hi - lo) * (i + 1) / (n + 1))) for i in range(n)})
            points = [p for p in points if lo < p < hi] or [lo + 1]
            for _ in points:
                self.claim_ci()
            rs = await asyncio.gather(*(self.run_ci(b.commits[p - 1], "bisect", claimed=True,
                                                    meta={"batch": b.id, "prefix": p}) for p in points))
            self.stats["bisect_runs"] += len(points)
            for p, r in zip(points, rs):
                results[p] = r
            reds = [p for p, r in zip(points, rs) if not r.green]
            if reds:
                new_hi = min(reds)
                lo = max([lo] + [p for p, r in zip(points, rs) if r.green and p < new_hi])
                hi = new_hi
            else:
                lo = max(points)
        async with self.lock:
            culprit = b.prs[hi - 1]
            if hi - 1 > 0:
                await self.land(b.prs[: hi - 1], b.commits[: hi - 1])
            rest = b.prs[hi:]
            for ts in reversed(rest):
                ts.status = "queued"
                self.pending.appendleft(ts)
            self.log("bisect.end", batch=b.id, culprit=culprit.id, landed=[t.id for t in b.prs[: hi - 1]],
                     requeued=[t.id for t in rest])
            self.eject_culprit(b, hi - 1, results[hi])
            self.bisecting = False
        self.poke()

    def eject_culprit(self, b: Batch, idx: int, res: CIResult) -> None:
        ts = b.prs[idx]
        ts.reds += 1
        failing = [f"{t['file']} > {t['name']}" for t in res.failing_tests][:20]
        self.eject(ts, "red", {"failing": failing, "output": res.output, "files": res.failing_files,
                               "batch": b.id})

    def eject(self, ts: TaskState, reason: str, info: dict) -> None:
        self.stats[f"ejections_{reason}"] += 1
        n = self.ejections_total[ts.id] = self.ejections_total.get(ts.id, 0) + 1
        self.log("queue.eject", task=ts.id, reason=reason, files=info.get("files"), failing=info.get("failing"))
        if ts.reworks >= self.cfg.max_rework or n > 3 * max(1, self.cfg.max_rework):
            self.drop(ts, f"ejected ({reason}) after {ts.reworks} reworks")
            return
        ts.status = "rework"
        a = self.agent(ts.agent)
        if self.cfg.queue_hold and a and a.holding == ts.id:
            self.spawn(self.rework_flow(ts, a, reason, info), f"rework-{ts.id}")
        else:
            self.rework_jobs.append((ts, reason, info))
        self.poke()

    # ---- rework ------------------------------------------------------------------------------------------------

    async def rework_flow(self, ts: TaskState, agent: AgentSlot, reason: str, info: dict) -> None:
        assert self.git and ts.worktree
        target = self.main
        conflicts = await self.git.merge_into_worktree(ts.worktree, target)
        if reason == "conflict" and not conflicts:
            # conflicted with a batch-mate, not with main: refresh the branch and requeue, no agent needed
            await self.commit_task(ts, "harness", "merge-main")
            self.stats["requeued_without_agent"] += 1
            async with self.lock:
                self.enqueue(ts)
            return
        while True:
            ts.reworks += 1
            resumed = self.can_resume(ts)
            def build(resumed: bool) -> str:
                if conflicts and reason == "conflict":
                    return prompts.rework_conflict(ts.task, conflicts, "main", resumed)
                text = prompts.rework_red(ts.task, info.get("failing") or [], info.get("output") or "", "main",
                                          resumed)
                if conflicts:
                    text += (f"\nThe merge of main also left conflict markers in: {', '.join(conflicts)}. "
                             "Resolve them too.\n")
                return text

            prompt = build(resumed)
            fixes = self.involved_fixes([ts.id]) if reason == "red" else []
            spec = InvocationSpec(inv_id=self.new_inv_id("rework"), kind="rework", task_id=ts.id, agent_id=agent.id,
                                  cwd=ts.worktree, prompt=prompt, attempt=ts.reworks,
                                  resume_session=ts.session_id if resumed else None,
                                  replay={"reset_to": target, "patches": self.patch_ref(ts.task.solution),
                                          "fixes": fixes, "check": "suite", "acceptance": ts.task.acceptance_tests})
            self.log("rework.start", task=ts.id, reason=reason, conflicts=conflicts, attempt=ts.reworks,
                     resumed=resumed)
            res = await self.invoke_rework(spec, agent, ts, build(False))
            if res.subtype == "unresolved":  # replay only: never feed a known-broken tree to the queue
                await self.git.abort_merge(ts.worktree)
                async with self.lock:
                    self.drop(ts, "replay could not resolve the conflict or red (limitation of replay agents)")
                return
            left = await self.markers_left(ts.worktree)
            if not left:
                break
            self.log("rework.markers_left", task=ts.id, files=left)
            if ts.reworks >= self.cfg.max_rework:
                await self.git.abort_merge(ts.worktree)
                async with self.lock:
                    self.drop(ts, "conflict markers left after the last rework")
                return
            conflicts, reason = left, "conflict"
        await self.commit_task(ts, spec.inv_id, "rework")
        async with self.lock:
            self.enqueue(ts)

    def policy_summary(self) -> dict:
        st = dict(self.stats)
        sizes = st.pop("batch_sizes")
        st["mean_batch_size"] = round(sum(sizes) / len(sizes), 3) if sizes else None
        return {"queue": st, "policy_rows": [
            ("Batches (green / red / cancelled)", f"{st['batches_green']} / {st['batches_red']} / "
                                                  f"{st['batches_cancelled']}"),
            ("Bisections / bisect CI runs", f"{st['bisections']} / {st['bisect_runs']}"),
            ("Ejections (conflict / red)", f"{st['ejections_conflict']} / {st['ejections_red']}"),
            ("PRs held behind in-flight conflicts", st["held_behind_inflight"]),
            ("Mean batch size", st["mean_batch_size"])]}
