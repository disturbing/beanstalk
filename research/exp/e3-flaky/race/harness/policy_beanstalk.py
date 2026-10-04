"""Beanstalk: placement + a non-blocking fast trunk + an asynchronous validator with causal repair.

1. Placement. Each task's modules are predicted from its title and prompt only. A free agent gets the
   highest-priority task whose predicted modules don't overlap the occupied set: predicted plus
   actual-so-far modules of running tasks (and, with ``--snapshot green``, the modules of landed but
   unvalidated commits, which a green snapshot cannot see). Fallback: least overlap.
2. Fast trunk. On finish the committer (single writer) squash-merges the task onto the trunk head,
   3-way, with ``merge=union`` for CHANGELOG.md. A textual conflict sends the task back to its agent to
   resolve on the new head; otherwise it lands without tests and the agent is released.
3. Validator. While unvalidated commits exist and a CI slot is free, run the suite on the trunk head
   (+ S seconds). Green promotes ``green``. Red opens a causal repair ticket naming the failing tests and
   the suspects: unvalidated commits whose write sets intersect the failing tests' read sets (static TS
   import closure). No suspect: bisect the unvalidated range. A fixer (fresh session) works on a
   worktree of the trunk head; its commit lands on the trunk like any other.
4. Error budget: while open reds exceed B, no new task starts (agents go to fixers first).
   A ticket that fails ``--max-fix-attempts`` times escalates: the newest suspect task is reverted and
   dropped (the stand-in for a human decision card).
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from . import prompts
from .agents import InvocationSpec
from .arena import placement_modules
from .ci import CIResult
from .core import AgentSlot, Race, TaskState

ACTIVE = ("bisecting", "open", "fixing", "landed", "reverting")  # open reds; also cover their failing tests


@dataclass
class TrunkCommit:
    idx: int
    sha: str
    parent: str
    kind: str                 # task | fixer | revert
    task_id: str | None
    ticket_id: str | None
    files: list[str]
    modules: list[str]
    landed_at: float
    reverted: bool = False


@dataclass
class Ticket:
    id: str
    opened_at: float
    red_sha: str
    red_idx: int
    failing_files: list[str]
    failing_tests: list[str]
    output: str
    suspects: list[int] = field(default_factory=list)
    concurrent: list[int] = field(default_factory=list)   # landed after a suspect's snapshot, same reads
    method: str = "read-set"
    attempt: int = 1
    status: str = "open"
    fix_idx: int | None = None
    revert_idx: int | None = None
    closed_at: float | None = None
    closed_how: str | None = None
    fixer_invs: list = field(default_factory=list)
    flake_only: bool = False     # E3 ground truth: the red that opened this ticket was a flake on a green tree
    probe_flakes: int = 0        # E3: culprit-search probes that flaked while handling this ticket


class BeanstalkRace(Race):
    policy = "beanstalk"

    def __init__(self, cfg):
        super().__init__(cfg)
        self.trunk = ""
        self.green = ""
        self.commits: list[TrunkCommit] = []
        self.green_idx = -1
        self.validating: set[int] = set()
        self.validated: dict[int, bool] = {}
        self.tickets: dict[str, Ticket] = {}
        self.unstarted: list[TaskState] = []
        self.committer = asyncio.Lock()
        self.sha_idx: dict[str, int] = {}
        self.ticket_seq = 0
        self.flows = 0
        self.stats = {"placements_disjoint": 0, "placements_overlap": 0, "placement_overlap_modules": 0,
                      "landings": 0, "fixer_landings": 0, "reverts": 0, "validations": 0, "validations_green": 0,
                      "validations_red": 0, "stale_reds": 0, "tickets": 0, "tickets_closed": 0,
                      "tickets_escalated": 0, "tickets_by_method": {}, "suspects_per_ticket": [],
                      "trunk_bisect_runs": 0, "pauses": 0, "paused_seconds": 0.0, "fixers_without_change": 0,
                      "wrongful_reverts": 0}
        self.paused_since: float | None = None
        self.stuck_logged = False

    async def setup(self) -> None:
        await super().setup()
        assert self.git
        self.trunk = self.green = self.base_sha
        self.sha_idx[self.base_sha] = -1
        await self.git.run("branch", "-f", "trunk", self.base_sha)
        await self.git.run("branch", "-f", "green", self.base_sha)
        self.unstarted = sorted(self.tasks, key=lambda t: t.task.order)

    def final_green_sha(self) -> str:
        return self.green

    def active_tickets(self) -> list[Ticket]:
        return [t for t in self.tickets.values() if t.status in ACTIVE]

    def finished(self) -> bool:
        quiet = not self.active_tickets() and self.flows == 0 and not self.validating
        if quiet and not self.unstarted and self.green_idx < len(self.commits) - 1 \
                and self.validated.get(len(self.commits) - 1) is False:
            # red head, nothing open, nothing running (e.g. an escalation's revert conflicted): stop
            if not self.stuck_logged:
                self.stuck_logged = True
                self.log("race.stuck", trunk_idx=len(self.commits) - 1, green_idx=self.green_idx)
            return True
        return all(t.terminal for t in self.tasks) and quiet and self.green_idx == len(self.commits) - 1

    # ---- dispatch ----------------------------------------------------------------------------------------------

    async def dispatch(self) -> None:
        open_reds = len(self.active_tickets())
        paused = open_reds > self.cfg.error_budget
        if paused != self.paused:
            self.paused = paused
            if paused:
                self.stats["pauses"] += 1
                self.paused_since = self.now()
            elif self.paused_since is not None:
                self.stats["paused_seconds"] += self.now() - self.paused_since
                self.paused_since = None
            self.log("budget.pause" if paused else "budget.resume", open_reds=open_reds, budget=self.cfg.error_budget)
        for t in sorted(self.tickets.values(), key=lambda x: x.id):
            if t.status != "open":
                continue
            a = self.free_agent()
            if not a:
                break
            t.status = "fixing"
            self.hold(a, t.id)
            self.flows += 1
            self.spawn(self.fixer_flow(t, a), f"fixer-{t.id}-{t.attempt}")
        if not self.paused:
            while self.unstarted:
                a = self.free_agent()
                if not a:
                    break
                ts = await self.place()
                self.unstarted.remove(ts)
                ts.status = "running"
                ts.agent = a.id
                self.hold(a, ts.id)
                self.flows += 1
                self.spawn(self.task_flow(ts, a), f"task-{ts.id}")
        self.maybe_validate()

    async def place(self) -> TaskState:
        occupied: dict[str, list[str]] = {}
        for ts in self.tasks:
            if ts.status in ("running", "rework"):
                mods = set(ts.selected) | await self.actual_modules_so_far(ts)
                for m in mods:
                    occupied.setdefault(m, []).append(ts.id)
        if self.cfg.snapshot == "green":
            for c in self.commits[self.green_idx + 1:]:
                for m in c.modules:
                    occupied.setdefault(m, []).append(c.task_id or c.kind)
        best, best_overlap = None, None
        for ts in self.unstarted:
            overlap = sorted(set(ts.selected) & set(occupied))
            if not overlap:
                best, best_overlap = ts, []
                break
            if best_overlap is None or len(overlap) < len(best_overlap):
                best, best_overlap = ts, overlap
        assert best is not None
        rule = "disjoint" if not best_overlap else "least-overlap"
        skipped = [t.id for t in self.unstarted if t.task.order < best.task.order]
        self.stats["placements_disjoint" if rule == "disjoint" else "placements_overlap"] += 1
        self.stats["placement_overlap_modules"] += len(best_overlap or [])
        self.log("placement.decision", task=best.id, rule=rule, predicted=best.selected, overlap=best_overlap,
                 occupied={m: v for m, v in sorted(occupied.items())}, skipped=skipped)
        return best

    # ---- tasks and the committer -----------------------------------------------------------------------------

    def snapshot_sha(self) -> str:
        return self.green if self.cfg.snapshot == "green" else self.trunk

    async def task_flow(self, ts: TaskState, agent: AgentSlot) -> None:
        try:
            if not await self.run_initial(ts, agent, self.snapshot_sha()):
                return
            idx = await self.land(ts.worktree, kind="task", ts=ts, agent=agent)
            if idx is None:
                if ts.status != "dropped":
                    self.drop(ts, "unresolved conflict after --max-rework attempts")
                return
            ts.status = "landed"
            ts.landed_at = self.now()
            await self.record_landing(ts, self.commits[idx].sha, self.commits[idx].parent)
            self.release(agent.id)
        finally:
            self.flows -= 1

    def land_message(self, kind: str, ts: TaskState | None, ticket: Ticket | None) -> str:
        if kind == "task" and ts:
            return f"{ts.task.title}\n\nTask: {ts.id}\nPolicy: beanstalk\n"
        assert ticket
        return f"Fix {ticket.id}: {', '.join(ticket.failing_files) or 'red trunk'}\n\nTicket: {ticket.id}\n"

    async def land(self, wt: str, *, kind: str, agent: AgentSlot, ts: TaskState | None = None,
                   ticket: Ticket | None = None) -> int | None:
        """Committer: squash-merge the worktree's branch onto the trunk head; on a textual conflict the
        same agent re-executes on the new head (resolving the markers), then the committer retries."""
        assert self.git
        rounds = 0
        while True:
            change_head = await self.git.rev("HEAD", cwd=wt)
            async with self.committer:
                head = self.trunk
                mb = await self.git.merge_base(change_head, head)
                new, conflicts = await self.git.squash_onto(head, change_head, mb, self.land_message(kind, ts, ticket))
                if new is not None:
                    await self.git.update_ref("refs/heads/trunk", new, head)
                    self.trunk = new
                    files = await self.git.changed_files(head, new)
                    c = TrunkCommit(idx=len(self.commits), sha=new, parent=head, kind=kind,
                                    task_id=ts.id if ts else None, ticket_id=ticket.id if ticket else None,
                                    files=files, modules=sorted(placement_modules(files)), landed_at=self.now())
                    self.commits.append(c)
                    self.sha_idx[new] = c.idx
                    self.stats["landings" if kind == "task" else "fixer_landings"] += 1
                    self.log("land", task=c.task_id, ticket=c.ticket_id, kind=kind, sha=new, target="trunk",
                             trunk_idx=c.idx, files=files, unvalidated=len(self.commits) - 1 - self.green_idx)
                    self.poke()
                    return c.idx
            self.conflicts_met += 1
            if ts:
                ts.conflicts += 1
            self.conflict_events.append({"task": ts.id if ts else ticket.id if ticket else None, "files": conflicts})
            self.log("merge.conflict", task=ts.id if ts else None, ticket=ticket.id if ticket else None,
                     onto=head, files=conflicts)
            rounds += 1
            if rounds > self.cfg.max_rework:
                return None
            files = await self.git.merge_into_worktree(wt, head)
            if not files:
                await self.git.commit_all(wt, f"Merge trunk into {kind}\n")
                continue
            while True:
                left = await self.reexecute(wt, files, head, kind=kind, agent=agent, ts=ts, ticket=ticket,
                                            attempt=rounds)
                if not left:
                    break
                if left == ["(unresolved)"]:
                    await self.git.abort_merge(wt)
                    if ts:
                        self.drop(ts, "replay could not resolve the conflict (limitation of replay agents)")
                    return None
                rounds += 1  # the committer never lands conflict markers: back to the agent
                if rounds > self.cfg.max_rework:
                    await self.git.abort_merge(wt)
                    return None
                files = left

    async def reexecute(self, wt: str, files: list[str], head: str, *, kind: str, agent: AgentSlot,
                        ts: TaskState | None, ticket: Ticket | None, attempt: int) -> list[str]:
        """One resolution round on the new head. Returns files that still hold conflict markers."""
        assert self.git
        resumed = bool(ts and self.can_resume(ts))
        if ts:
            ts.reworks += 1
            ts.status = "rework"
            prompt = prompts.rework_conflict(ts.task, files, "the trunk", resumed)
            replay = {"reset_to": head, "patches": self.patch_ref(ts.task.solution), "check": "acceptance",
                      "acceptance": ts.task.acceptance_tests}
        else:
            assert ticket
            prompt = (f"Your fix for repair ticket {ticket.id} conflicts with commits that landed on the trunk "
                      f"meanwhile. The merge is in progress here; conflict markers are in: {', '.join(files)}. "
                      "Resolve them, keep both sides' intent, and make sure `node --test` passes. "
                      f"{prompts.NO_COMMIT}\n")
            replay = {"reset_to": head, "fixes": self.ticket_fixes(ticket)}
        spec = InvocationSpec(inv_id=self.new_inv_id("rework"), kind="rework", task_id=ts.id if ts else ticket.id,
                              agent_id=agent.id, cwd=wt, prompt=prompt, attempt=attempt,
                              resume_session=ts.session_id if (ts and resumed) else None, replay=replay)
        self.log("rework.start", task=ts.id if ts else None, ticket=ticket.id if ticket else None, reason="conflict",
                 conflicts=files, attempt=attempt, resumed=resumed)
        if ts:
            res = await self.invoke_rework(spec, agent, ts, prompts.rework_conflict(ts.task, files, "the trunk", False))
        else:
            res = await self.invoke(spec, agent)
        if res.subtype == "unresolved":  # replay only: the committer must not land a known-broken resolution
            return ["(unresolved)"]
        left = await self.markers_left(wt)
        if left:
            self.log("rework.markers_left", task=ts.id if ts else None, ticket=ticket.id if ticket else None,
                     files=left)
            return left
        if ts:
            await self.commit_task(ts, spec.inv_id, "rework")
            ts.status = "running"
        else:
            self.restore_acceptance(wt, [t.task for t in self.tasks if t.landed_sha])
            await self.git.commit_all(wt, f"Resolve trunk conflict for {ticket.id}\n")
        return []

    # ---- validator ----------------------------------------------------------------------------------------------

    def maybe_validate(self) -> None:
        head_idx = len(self.commits) - 1
        if head_idx <= self.green_idx or head_idx in self.validating or head_idx in self.validated:
            return
        if self.ci_available() <= 0:
            return
        self.validating.add(head_idx)
        self.claim_ci()
        self.spawn(self.validate(head_idx), f"validate-{head_idx}")

    async def validation_result(self, idx: int) -> CIResult:
        """The CI verdict for trunk commit ``idx`` (a hook: v2 re-runs a red one before believing it)."""
        c = self.commits[idx]
        return await self.run_ci(c.sha, "validate", claimed=True,
                                 meta={"trunk_idx": idx, "unvalidated": idx - self.green_idx})

    async def validate(self, idx: int) -> None:
        res = await self.validation_result(idx)
        async with self.lock:
            self.validating.discard(idx)
            self.validated[idx] = res.green
            self.stats["validations"] += 1
            self.stats["validations_green" if res.green else "validations_red"] += 1
            await self.on_validation(idx, res)
        self.poke()

    async def on_validation(self, idx: int, res: CIResult) -> None:
        if res.green:
            if idx > self.green_idx:
                await self.promote(idx)
            for t in self.active_tickets():
                if t.red_idx <= idx and t.status != "bisecting":
                    self.close(t, f"green at trunk #{idx}")
            return
        if idx <= self.green_idx:
            self.stats["stale_reds"] += 1
            return
        failing = set(res.failing_files or [])
        for t in self.active_tickets():
            if t.status == "landed" and t.fix_idx is not None and t.fix_idx <= idx:
                if res.failing_files is not None and not (set(t.failing_files) & failing):
                    self.close(t, f"its tests pass at trunk #{idx}")
                else:
                    self.retry(t, res, "fix landed but its tests still fail")
        covered = set()
        for t in self.active_tickets():
            covered |= set(t.failing_files)
        for t in self.tickets.values():  # a fix or revert that landed after this head is still pending
            remedy = t.fix_idx if t.status == "landed" else t.revert_idx if t.status == "reverted" else None
            if remedy is not None and remedy > idx:
                covered |= set(t.failing_files)
        if res.failing_files is None:
            new = [] if self.active_tickets() else ["(suite crashed)"]
        else:
            new = sorted(failing - covered)
        if new:
            self.open_ticket(idx, res, new)

    async def promote(self, idx: int) -> None:
        assert self.git
        c = self.commits[idx]
        await self.git.update_ref("refs/heads/green", c.sha)
        old, self.green_idx, self.green = self.green_idx, idx, c.sha
        newly, now = [], self.now()
        for cc in self.commits[old + 1: idx + 1]:
            if cc.kind == "task" and cc.task_id and not cc.reverted:
                ts = self.by_id[cc.task_id]
                if ts.status == "landed":
                    ts.status, ts.green_at = "green", now
                    newly.append(ts.id)
        self.log("green.promote", sha=c.sha, trunk_idx=idx, tasks=newly)

    # ---- repair tickets ------------------------------------------------------------------------------------------

    def read_set(self, res: CIResult, files: list[str]) -> set[str]:
        read: set[str] = set()
        for f in files:
            read |= set(res.read_sets.get(f, [f]))
        return read

    def suspects_for(self, idx: int, res: CIResult, files: list[str]) -> list[int]:
        """Unvalidated commits whose write sets intersect the failing tests' read sets, most likely first:
        a write named in a failure stack trace, then the fewest import hops from a failing test, then newest."""
        read = self.read_set(res, files)
        stack = set(res.stack_files)
        ranked = []
        for c in self.commits[self.green_idx + 1: idx + 1]:
            hit = set(c.files) & read
            if c.reverted or c.kind == "revert" or not hit:
                continue
            hops = min((res.read_depths.get(f, {}).get(w, 99) for f in files for w in hit), default=99)
            ranked.append(((0 if hit & stack else 1), hops, -c.idx, c.idx))
        return [r[-1] for r in sorted(ranked)]

    def concurrent_for(self, suspects: list[int], read: set[str]) -> list[int]:
        """SSI-style antidependencies: commits that landed after a suspect task's snapshot (so the suspect
        never saw them) and wrote something the failing tests read. Context for the fixer, not suspects."""
        out: set[int] = set()
        for i in suspects:
            c = self.commits[i]
            ts = self.by_id.get(c.task_id) if c.task_id else None
            if not ts or not ts.base_sha:
                continue
            snap = self.sha_idx.get(ts.base_sha, -1)
            for o in self.commits[snap + 1: i]:
                if o.idx not in suspects and not o.reverted and o.kind != "revert" and set(o.files) & read:
                    out.add(o.idx)
        return sorted(out)

    def open_ticket(self, idx: int, res: CIResult, files: list[str]) -> None:
        self.ticket_seq += 1
        tests = [f"{t['file']} > {t['name']}" for t in res.failing_tests if t["file"] in files][:20]
        t = Ticket(id=f"R{self.ticket_seq:03d}", opened_at=self.now(), red_sha=res.sha, red_idx=idx,
                   failing_files=[f for f in files if not f.startswith("(")], failing_tests=tests or files,
                   output=res.output, flake_only=res.flake_only)
        self.tickets[t.id] = t
        self.stats["tickets"] += 1
        suspects = self.suspects_for(idx, res, t.failing_files) if t.failing_files else []
        if suspects:
            t.suspects, t.method, t.status = suspects, "read-set", "open"
            t.concurrent = self.concurrent_for(suspects, self.read_set(res, t.failing_files))
            self.ticket_opened(t)
        else:
            t.method, t.status = "bisect", "bisecting"
            self.log("ticket.bisect", ticket=t.id, red_idx=idx, failing=t.failing_files)
            self.flows += 1
            self.spawn(self.bisect_trunk(t), f"bisect-{t.id}")
        self.poke()

    def ticket_opened(self, t: Ticket) -> None:
        self.stats["tickets_by_method"][t.method] = self.stats["tickets_by_method"].get(t.method, 0) + 1
        self.stats["suspects_per_ticket"].append(len(t.suspects))
        self.log("ticket.open", ticket=t.id, red_sha=t.red_sha, red_idx=t.red_idx, failing=t.failing_files,
                 method=t.method, suspects=[{"idx": i, "sha": self.commits[i].sha, "task": self.commits[i].task_id,
                                            "kind": self.commits[i].kind} for i in t.suspects],
                 concurrent=[{"idx": i, "task": self.commits[i].task_id} for i in t.concurrent])

    async def first_bad(self, lo: int, hi: int, files: list[str], ticket: str) -> int:
        """K-ary search over trunk commits (lo good, hi bad) for the first commit where ``files`` fail
        (any failure when ``files`` is empty): K probes per round, S seconds each."""
        def bad(r: CIResult) -> bool:
            if not files or r.failing_files is None:
                return not r.green
            return bool(set(r.failing_files) & set(files))

        while hi - lo > 1:
            n = max(1, min(self.cfg.ci_slots, hi - lo - 1))
            points = sorted({lo + max(1, round((hi - lo) * (i + 1) / (n + 1))) for i in range(n)})
            points = [p for p in points if lo < p < hi] or [lo + 1]
            for _ in points:
                self.claim_ci()
            rs = await asyncio.gather(*(self.run_ci(self.commits[p].sha, "bisect", claimed=True,
                                                    meta={"ticket": ticket, "trunk_idx": p}) for p in points))
            self.stats["trunk_bisect_runs"] += len(points)
            self.note_probe_flakes(ticket, rs)
            reds = [p for p, r in zip(points, rs) if bad(r)]
            if reds:
                new_hi = min(reds)
                lo = max([lo] + [p for p, r in zip(points, rs) if not bad(r) and p < new_hi])
                hi = new_hi
            else:
                lo = max(points)
        return hi

    def note_probe_flakes(self, ticket: str, results) -> None:
        t = self.tickets.get(ticket)
        if t is not None:
            t.probe_flakes += sum(1 for r in results if r.flaked)

    async def bisect_trunk(self, t: Ticket) -> None:
        """No read-set suspect: the first commit in (green, red] where the ticket's tests fail."""
        try:
            hi = await self.first_bad(self.green_idx, t.red_idx, t.failing_files, t.id)
            async with self.lock:
                if t.status != "bisecting":
                    return
                t.suspects = [hi] if hi > self.green_idx else []
                t.status = "open"
                self.ticket_opened(t)
                if self.green_idx >= t.red_idx:  # a later head validated green while we bisected
                    self.close(t, f"green at trunk #{self.green_idx} during bisection")
        finally:
            self.flows -= 1
            self.poke()

    def ticket_fixes(self, t: Ticket) -> list[dict]:
        return self.involved_fixes([self.commits[i].task_id for i in t.suspects + t.concurrent
                                    if self.commits[i].task_id])

    async def fixer_flow(self, t: Ticket, agent: AgentSlot) -> None:
        assert self.git
        try:
            head = self.trunk
            wt = f"{self.work}/agents/fix-{t.id}-{t.attempt}"
            await self.git.add_worktree(wt, head, f"fix/{t.id}-{t.attempt}")
            suspects = []
            for rank, i in enumerate(t.suspects + t.concurrent):
                c = self.commits[i]
                ts = self.by_id.get(c.task_id) if c.task_id else None
                label = c.task_id or c.ticket_id or c.kind
                if i in t.concurrent:
                    label += " (landed after the suspect's snapshot; the suspect never saw it)"
                top = rank < 3 or i in t.concurrent  # full diffs for the likeliest causes only
                suspects.append({"sha": c.sha, "label": label,
                                 "title": ts.task.title if ts else f"{c.kind} commit",
                                 "intent": ts.task.prompt if ts else "(repair commit)",
                                 "diff": await self.git.diff_text(c.parent, c.sha, limit=6000) if top else
                                 "(diff omitted: lower-ranked suspect; `git show " + c.sha[:10] + "`)"})
            landed = [ts.task for ts in self.tasks if ts.landed_sha and ts.status != "dropped"]
            acceptance = sorted({p for task in landed for p in task.acceptance_tests})
            ticket = {"id": t.id, "attempt": t.attempt, "failing_tests": t.failing_tests, "output": t.output}
            spec = InvocationSpec(inv_id=self.new_inv_id("fixer"), kind="fixer", task_id=t.id, agent_id=agent.id,
                                  cwd=wt, prompt=prompts.fixer(ticket, suspects, acceptance), attempt=t.attempt,
                                  replay={"fixes": self.ticket_fixes(t)})
            self.log("fixer.dispatch", ticket=t.id, agent=agent.id, attempt=t.attempt, base=head,
                     suspects=[s["label"] for s in suspects])
            res = await self.invoke(spec, agent)
            t.fixer_invs.append(spec.inv_id)
            tamper = self.restore_acceptance(wt, landed)
            if tamper:
                self.log("acceptance.restored", ticket=t.id, paths=tamper, inv=spec.inv_id)
            _, created = await self.git.commit_all(wt, f"Fix {t.id}\n\nTicket: {t.id}\nInvocation: {spec.inv_id}\n")
            if not created or res.infra_error:
                async with self.lock:
                    self.stats["fixers_without_change"] += 1
                    if t.status == "fixing":
                        self.retry(t, None, "fixer produced no change" if not res.infra_error else res.infra_error)
                return
            idx = await self.land(wt, kind="fixer", agent=agent, ticket=t)
            async with self.lock:
                if idx is None:
                    if t.status == "fixing":
                        self.retry(t, None, "fix could not be landed")
                elif t.status == "fixing":
                    t.status, t.fix_idx = "landed", idx
                    self.log("ticket.fix_landed", ticket=t.id, trunk_idx=idx)
        finally:
            self.release(agent.id)
            self.flows -= 1

    def close(self, t: Ticket, how: str) -> None:
        t.status, t.closed_at, t.closed_how = "closed", self.now(), how
        self.stats["tickets_closed"] += 1
        self.log("ticket.close", ticket=t.id, how=how, attempts=t.attempt, open_seconds=round(t.closed_at - t.opened_at, 2))
        self.poke()

    def retry(self, t: Ticket, res: CIResult | None, why: str) -> None:
        t.attempt += 1
        if res is not None:
            t.output = res.output
            t.red_sha = res.sha
        if t.attempt > self.cfg.max_fix_attempts:
            t.status = "reverting"
            self.stats["tickets_escalated"] += 1
            self.log("ticket.escalate", ticket=t.id, why=why, attempts=t.attempt - 1)
            self.flows += 1
            self.spawn(self.revert_culprit(t), f"revert-{t.id}")
        else:
            t.status = "open"
            self.log("ticket.retry", ticket=t.id, why=why, attempt=t.attempt)
        self.poke()

    async def leave_one_out(self, t: Ticket) -> TrunkCommit | None:
        """Revert each live unvalidated commit from the current head (newest first, K at a time) and return
        the first whose removal makes the ticket's failing tests pass."""
        assert self.git
        head = self.trunk
        cands = [c for c in reversed(self.commits[self.green_idx + 1:]) if c.kind != "revert" and not c.reverted]
        k = max(1, self.cfg.ci_slots)
        for i in range(0, len(cands), k):
            probes = []
            for c in cands[i:i + k]:
                tree, _ = await self.git.merge_tree(c.sha, head, c.parent)
                if tree is not None:
                    probes.append((c, await self.git.commit_tree(tree, [head], f"probe: without {c.sha[:10]}\n")))
            for _ in probes:
                self.claim_ci()
            rs = await asyncio.gather(*(self.run_ci(sha, "bisect", claimed=True,
                                                    meta={"ticket": t.id, "without": c.task_id or c.kind})
                                        for c, sha in probes))
            self.stats["trunk_bisect_runs"] += len(probes)
            self.note_probe_flakes(t.id, rs)
            for (c, _), r in zip(probes, rs):
                if r.failing_files is not None and not (set(r.failing_files) & set(t.failing_files or [])) \
                        and (t.failing_files or r.green):
                    return c
        return None

    async def revert_culprit(self, t: Ticket) -> None:
        """Escalation stand-in for a human decision card: bisect the unvalidated range for the commit that
        turned the ticket's tests red (read sets can't single it out when every test imports the app),
        revert it on the trunk and drop its task."""
        assert self.git
        try:
            if t.method == "bisect" and t.suspects:
                idx = t.suspects[0]    # bisect_trunk already localised it: don't pay (or flake) twice
            else:
                idx = await self.first_bad(self.green_idx, t.red_idx, t.failing_files, t.id) \
                    if t.red_idx > self.green_idx else -1
            target = self.commits[idx] if idx > self.green_idx else None
            if target is None or target.reverted or target.kind == "revert":
                # linear history misleads once reverts exist: try removing each live suspect from the head
                target = await self.leave_one_out(t)
            if t.status != "reverting":  # closed meanwhile (a later head validated green)
                return
            if target is None or target.reverted or target.kind == "revert":
                t.status = "escalated"
                self.log("ticket.stuck", ticket=t.id, culprit_idx=idx)
                return
            self.log("ticket.culprit", ticket=t.id, trunk_idx=idx, task=target.task_id, kind=target.kind)
            async with self.committer:
                if t.status != "reverting":
                    return
                head = self.trunk
                tree, conflicts = await self.git.merge_tree(target.sha, head, target.parent)
                if tree is None:
                    t.status = "escalated"
                    self.log("revert.conflict", ticket=t.id, task=target.task_id, files=conflicts)
                    return
                ts = self.by_id[target.task_id] if target.task_id else None
                new = await self.git.commit_tree(tree, [head], f"Revert {ts.task.title if ts else target.sha}\n\n"
                                                               f"Reverts: {target.sha}\nTicket: {t.id}\n")
                await self.git.update_ref("refs/heads/trunk", new, head)
                self.trunk = new
                files = await self.git.changed_files(head, new)
                c = TrunkCommit(idx=len(self.commits), sha=new, parent=head, kind="revert", task_id=None,
                                ticket_id=t.id, files=files, modules=sorted(placement_modules(files)),
                                landed_at=self.now())
                self.commits.append(c)
                self.sha_idx[new] = c.idx
                target.reverted = True
                t.status, t.revert_idx = "reverted", c.idx
                self.stats["reverts"] += 1
                self.stats["wrongful_reverts"] += 1 if t.flake_only else 0
                self.log("revert", ticket=t.id, task=target.task_id, reverted=target.sha, sha=new, trunk_idx=c.idx,
                         flake_only=t.flake_only, probe_flakes=t.probe_flakes)
            if ts:
                async with self.lock:
                    self.drop(ts, f"reverted: repair ticket {t.id} escalated")
        finally:
            self.flows -= 1
            self.poke()

    def policy_summary(self) -> dict:
        st = dict(self.stats)
        if self.paused_since is not None:
            st["paused_seconds"] += (self.ended_at or self.now()) - self.paused_since
        sus = st.pop("suspects_per_ticket")
        st["mean_suspects_per_ticket"] = round(sum(sus) / len(sus), 3) if sus else None
        st["paused_seconds"] = round(st["paused_seconds"], 2)
        st["final_trunk_idx"] = len(self.commits) - 1
        st["final_green_idx"] = self.green_idx
        st["open_tickets_at_end"] = len(self.active_tickets())
        st["ticket_details"] = [{"id": t.id, "method": t.method, "status": t.status, "attempts": t.attempt,
                                 "failing": t.failing_files,
                                 "suspects": [self.commits[i].task_id or self.commits[i].kind for i in t.suspects],
                                 "concurrent": [self.commits[i].task_id or self.commits[i].kind for i in t.concurrent],
                                 "open_seconds": round((t.closed_at or self.now()) - t.opened_at, 2)}
                                for t in self.tickets.values()]
        return {"beanstalk": st, "policy_rows": [
            ("Placements disjoint / overlapping", f"{st['placements_disjoint']} / {st['placements_overlap']}"),
            ("Fast-trunk landings (task / fixer / revert)", f"{st['landings']} / {st['fixer_landings']} / "
                                                            f"{st['reverts']}"),
            ("Validations (green / red)", f"{st['validations_green']} / {st['validations_red']}"),
            ("Repair tickets (closed / escalated / by method)",
             f"{st['tickets_closed']} / {st['tickets_escalated']} / {st['tickets_by_method']}"),
            ("Error-budget pauses / paused minutes", f"{st['pauses']} / {round(st['paused_seconds'] / 60, 2)}")]}
