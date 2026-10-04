"""Beanstalk v2: fast trunk + repair economy + spec-decision cards (docs/claude-opus/09 ideas 1, 2, 6, 8).

Built on ``policy_beanstalk_preland`` (merged tree checked before it lands, repair by the author). Changes:

1. No predicted placement: tasks start in priority order (module-level placement had lift 1.0-1.5x in
   steps 2-3 and ``beanstalk-noplace`` scored the same as ``beanstalk``).
2. Informed repair before landing (ladder rung 2 with a small ticket): when the pre-land check is red, the
   author's resumed session gets the failing tests AND the intent and diff of at most two landed changes
   that caused them (owners of failing acceptance tests first, then landed commits since the task's snapshot
   whose writes intersect the failing tests' static read set).
3. Spec-decision cards (idea 8): after two informed attempts against the same landed change still fail, the
   pair is a specification question, not a coding one. A ``decision.request`` event carries both one-line
   specs; a scripted oracle answers after ``DECISION_SECONDS`` (emulated human latency, default 30) with
   ``DECISION_ORACLE`` = ``landed`` (keep the accepted spec; the arriving task is declined). No fixer is
   ever dispatched for it.
4. Revert-first on the trunk (idea 1): a red validation never gets a fix-forward fixer. Its ticket
   escalates at once: the culprit commit is reverted on the trunk (the parent's revert path) and its task
   dropped, so green advances past it.
Run with ``--snapshot head --error-budget 999`` (tasks fork from the trunk head; the error-budget
controller is off, as the simulations recommend).
"""
from __future__ import annotations

import asyncio
import os
from collections import Counter

from .agents import InvocationSpec
from .arena import Task
from .ci import CIResult
from .core import AgentSlot, TaskState
from .policy_beanstalk_preland import BeanstalkPrelandRace
from .prompts import NO_COMMIT, acceptance_line


def informed_red(task: Task, failing: list[str], output: str, culprits: list[dict], resumed: bool) -> str:
    head = "" if resumed else f"You are working on: {task.title}\n\n{task.prompt.strip()}\n\n"
    tests = "\n".join(f"- {t}" for t in failing) or "- (the suite failed; see the output)"
    lines = [f"{head}Your change was not landed. Merged onto the latest trunk, these tests failed:", tests, "",
             "Output:", "```", output.strip(), "```", ""]
    if culprits:
        lines.append("They involve changes that already landed and are accepted behaviour. Their intent and diffs:")
        for c in culprits:
            lines += [f"- {c['task']}: {c['title']}", f"  Intent: {c['intent'].strip()}", "  Diff:", "```diff",
                      c["diff"].strip(), "```"]
        lines += ["", "Adapt your change so that your acceptance tests AND theirs pass. Where the two behaviours "
                  "seem to contradict, keep both by scoping your change (a separate helper, an explicit option, "
                  "the new shape at the new call site) rather than changing their accepted behaviour."]
    protect = ("Acceptance tests (yours and other teams') are protected: edits to them are discarded before landing, "
               "so change the code, not the tests." if task.acceptance_tests else  # e1 --tests self: own tests
               "Tests that other changes landed with are protected: edits to them are discarded before landing, so "
               "change the code, not their tests.")
    lines += [f"The latest trunk has been merged into this worktree. {protect}",
              f"{acceptance_line(task.acceptance_paths)} {NO_COMMIT}"]
    return "\n".join(lines) + "\n"


class BeanstalkV2Race(BeanstalkPrelandRace):
    policy = "beanstalk"
    variant = "v2"

    def __init__(self, cfg):
        super().__init__(cfg)
        self.decision_seconds = float(os.environ.get("DECISION_SECONDS", "30") or 0)
        self.oracle = os.environ.get("DECISION_ORACLE", "landed")
        self.pair_reds: Counter[tuple[str, str]] = Counter()
        self.card_seq = 0
        self.stats.update({"informed_reworks": 0, "cards": 0, "card_details": [], "revert_first": 0})

    # 1. no predicted placement -----------------------------------------------------------------------------

    async def place(self) -> TaskState:
        best = min(self.unstarted, key=lambda t: t.task.order)
        self.stats["placements_disjoint"] += 1
        self.log("placement.decision", task=best.id, rule="fifo", predicted=best.selected, overlap=[],
                 occupied={}, skipped=[])
        return best

    # 4. revert-first ---------------------------------------------------------------------------------------

    def open_ticket(self, idx: int, res: CIResult, files: list[str]) -> None:
        before = set(self.tickets)
        super().open_ticket(idx, res, files)
        for tid in sorted(set(self.tickets) - before):
            t = self.tickets[tid]
            if t.status == "open":
                self.stats["revert_first"] += 1
                t.attempt = self.cfg.max_fix_attempts  # retry() escalates to revert_culprit at once
                self.retry(t, None, "revert-first: no fix-forward on the trunk")

    # 2-3. informed repair before landing, then a decision card ---------------------------------------------

    def acceptance_owners(self) -> dict[str, str]:
        return {p: ts.id for ts in self.tasks if ts.landed_sha and ts.status != "dropped"
                for p in ts.task.acceptance_tests}

    def culprit_tasks(self, red: CIResult, ts: TaskState) -> list[str]:
        owners = self.acceptance_owners()
        failing = list(red.failing_files or [])
        out = [owners[p] for p in failing if p in owners and owners[p] != ts.id]
        read = set(red.read_set or [])
        snap = self.sha_idx.get(ts.base_sha or "", -1)
        for c in reversed(self.commits[snap + 1:]):
            if c.kind == "task" and c.task_id and c.task_id != ts.id and not c.reverted and set(c.files) & read:
                out.append(c.task_id)
        seen: list[str] = []
        for tid in out:
            if tid not in seen:
                seen.append(tid)
        return seen[:2]

    async def culprit_context(self, tids: list[str]) -> list[dict]:
        assert self.git
        out = []
        for tid in tids:
            ts = self.by_id[tid]
            commit = next((c for c in reversed(self.commits) if c.task_id == tid and c.kind == "task"), None)
            diff = await self.git.diff_text(commit.parent, commit.sha, limit=5000) if commit else "(not on trunk)"
            out.append({"task": tid, "title": ts.task.title, "intent": ts.task.prompt, "diff": diff})
        return out

    async def repair_before_landing(self, wt: str, head: str, red: CIResult, agent: AgentSlot, ts: TaskState,
                                    rounds: int) -> bool:
        assert self.git
        culprits = self.culprit_tasks(red, ts)
        for o in culprits:
            self.pair_reds[(ts.id, o)] += 1
        stuck = [o for o in culprits if self.pair_reds[(ts.id, o)] >= 3]
        if stuck:
            return await self.decide(ts, stuck, red)
        if not await self.resolve_on(wt, head, [], agent, ts, rounds):
            return False
        failing = [f"{t['file']} > {t['name']}" for t in red.failing_tests][:20] or list(red.failing_files or [])
        context = await self.culprit_context(culprits)
        resumed = self.can_resume(ts)
        ts.reworks += 1
        ts.status = "rework"
        self.stats["preland_reworks"] += 1
        if culprits:
            self.stats["informed_reworks"] += 1
        spec = InvocationSpec(inv_id=self.new_inv_id("rework"), kind="rework", task_id=ts.id, agent_id=agent.id,
                              cwd=wt, prompt=informed_red(ts.task, failing, red.output, context, resumed),
                              attempt=rounds, resume_session=ts.session_id if resumed else None,
                              replay={"reset_to": head, "patches": self.patch_ref(ts.task.solution),
                                      "check": "acceptance", "acceptance": ts.task.acceptance_tests})
        self.log("rework.start", task=ts.id, ticket=None, reason="preland-red", failing=failing, attempt=rounds,
                 resumed=resumed, culprits=culprits)
        res = await self.invoke_rework(spec, agent, ts, informed_red(ts.task, failing, red.output, context, False))
        if self.aborted:
            return False
        if res.subtype == "unresolved":
            self.drop(ts, "replay could not repair the pre-land failure (limitation of replay agents)")
            return False
        await self.commit_task(ts, spec.inv_id, "rework")
        ts.status = "running"
        return True

    async def decide(self, ts: TaskState, against: list[str], red: CIResult) -> bool:
        self.card_seq += 1
        card = f"D{self.card_seq:03d}"
        specs = {t.id: t.task.title for t in [ts, *[self.by_id[o] for o in against]]}
        failing = [f"{t['file']} > {t['name']}" for t in red.failing_tests][:10]
        self.stats["cards"] += 1
        self.log("decision.request", card=card, task=ts.id, against=against, specs=specs, failing=failing,
                 attempts=max(self.pair_reds[(ts.id, o)] for o in against))
        if self.decision_seconds > 0:
            await asyncio.sleep(self.decision_seconds)
        winner = against[0] if self.oracle == "landed" else ts.id
        self.stats["card_details"].append({"card": card, "task": ts.id, "against": against, "winner": winner,
                                           "specs": specs})
        self.log("decision.made", card=card, winner=winner, loser=ts.id, oracle=self.oracle,
                 wait_seconds=self.decision_seconds)
        self.drop(ts, f"declined by decision {card}: the accepted spec of {winner} was kept")
        return False

    def policy_summary(self) -> dict:
        out = super().policy_summary()
        st = out["beanstalk"]
        st["variant"] = "v2"
        rows = [("Variant", "v2: pre-land check, informed author repair, decision cards, revert-first"),
                ("Informed reworks / decision cards / revert-first tickets",
                 f"{st['informed_reworks']} / {st['cards']} / {st['revert_first']}")]
        out["policy_rows"] = rows + [r for r in out["policy_rows"] if r[0] != "Variant"]
        return out
