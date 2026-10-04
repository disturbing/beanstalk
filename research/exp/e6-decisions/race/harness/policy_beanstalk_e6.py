"""Beanstalk E6: decision cards whose LOSER is re-executed under the winning spec (docs/claude-opus/09 ideas 7-8).

Built on ``policy_beanstalk_v2`` (pre-land check, informed author repair, revert-first). v2 declined the arriving bean
after a card; E6 makes both intents ship where possible:

1. Outcomes (``harness/decisions.py``):
   keep-landed     the arriving bean is re-executed (fresh session, fresh fork of the sprout) with the decision text
                   and the winner's intent and diff.
   adopt-arriving  the landed bean is reverted from the sprout, the arriving bean lands, and the reverted bean is
                   re-executed against the new contract. If the revert conflicts, the loser's amended tests travel
                   with the winner, which adapts the loser's code in place (recorded as such).
   Spec amendment  before a loser is re-executed, a separate test-author session amends the loser's acceptance tests
                   where they encode the losing semantics; the harness checks they parse and fail on the snapshot the
                   loser re-executes from (fail-first). The amended tests become the loser's protected tests
                   (``spec.amend`` event).
2. Modes: ``DECISION_MODE=oracle`` with ``DECISION_ORACLE=landed|contract|table`` (``decline`` reproduces v2), or
   ``DECISION_MODE=human``: a local page (``harness/cards.py``) blocks the card until someone clicks, falling back to
   ``HUMAN_FALLBACK`` after ``HUMAN_TIMEOUT`` seconds.
3. Earlier, more frequent cards: ``CARD_AFTER`` failed informed reworks against the same landed bean raise a card
   (v2 waited for 2); ``CARD_AFTER_KNOWN`` applies to declared coupling pairs (``COUPLING_PRIOR=arena``: the semantic
   couplings in tasks/*.json), where -1 raises the card when the bean starts and its partner has already landed.
   Known partners are named first as culprits even when they landed before the bean's snapshot (v2 only looked at
   commits after it), and an optimistic landing re-checks when a known partner landed meanwhile.
4. Nothing is dropped silently: a revert-first culprit is re-executed instead of dropped (in place when its revert
   conflicts), and ``RESCUE=1`` re-executes a bean once from scratch when its rework budget runs out.

Final correctness (``final.check``): the suite is green on the final stalk, and every green bean passes its EFFECTIVE
acceptance tests (canonical, or amended by a recorded decision). Canonical results are reported beside it, and every
canonical failure of a green bean must be covered by a recorded amendment.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import webbrowser
from collections import Counter

from .agents import InvocationSpec
from .arena import placement_modules
from .cards import CardBoard
from .ci import CIResult
from .core import RACE_DIR, AgentSlot, TaskState
from .decisions import (ORACLES, Decision, DecisionTable, author_prompt, decision_text, one_line, oracle_choice,
                        outcome_for, pair_key, reexec_prompt, start_context, unified)
from .policy_beanstalk import TrunkCommit
from .policy_beanstalk_v2 import BeanstalkV2Race, informed_red

STOP, CONTINUE, REEXECUTED, RETRY = "stop", "continue", "reexecuted", "retry"


class Landed:
    """A repair step that landed the bean (the atomic adopt-arriving): the land loop returns its trunk index."""

    def __init__(self, idx: int):
        self.idx = idx

PARSE_CHECK = """import { stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
process.removeAllListeners('warning');
const bad = [];
for (const f of process.argv.slice(2)) {
  try { stripTypeScriptTypes(readFileSync(f, 'utf8')); } catch (e) { bad.push(`${f}: ${e.message}`); }
}
process.stdout.write(JSON.stringify(bad));
"""


class BeanstalkE6Race(BeanstalkV2Race):
    policy = "beanstalk"
    variant = "e6"

    def __init__(self, cfg):
        super().__init__(cfg)
        env = os.environ
        self.mode = env.get("DECISION_MODE", "oracle")
        if self.mode not in ("oracle", "human"):
            raise SystemExit(f"DECISION_MODE must be oracle or human, not {self.mode!r}")
        if self.oracle not in ORACLES:
            raise SystemExit(f"DECISION_ORACLE must be one of {ORACLES}, not {self.oracle!r}")
        self.card_after = int(env.get("CARD_AFTER", "1"))
        self.card_after_known = int(env.get("CARD_AFTER_KNOWN", "0"))
        self.prior = env.get("COUPLING_PRIOR", "arena")
        self.spec_amend = env.get("SPEC_AMEND", "1") != "0"
        self.rescue = env.get("RESCUE", "1") != "0"
        self.reexec_max = int(env.get("REEXEC_MAX", "1"))
        self.human_timeout = float(env.get("HUMAN_TIMEOUT", "300"))
        self.human_port = int(env.get("HUMAN_PORT", "8765"))
        self.human_fallback = env.get("HUMAN_FALLBACK", "table")
        self.human_open = env.get("HUMAN_OPEN", "0") == "1"
        self.decisions_dir = os.path.abspath(env.get("DECISIONS_DIR") or os.path.join(RACE_DIR, "..", "decisions"))
        self.table = DecisionTable.load(os.path.join(self.decisions_dir, "table.json"))
        self.decisions: dict[tuple[str, str], Decision] = {}
        self.by_card: dict[str, Decision] = {}
        self.pending: dict[tuple[str, str], asyncio.Future] = {}
        self.ctx: dict[str, dict] = {}                 # task -> how its next execution runs (decision, reason)
        self.parked_behind: dict[str, list[str]] = {}  # winner -> losers waiting for it to land
        self.canonical: dict[str, dict] = {}
        self.amended: dict[str, dict] = {}             # task -> {card, paths}
        self.rescued: set[str] = set()
        self.board: CardBoard | None = None
        self.config_logged = False
        self.parse_script = ""
        self.stats.update({"cards_by_trigger": Counter(), "cards_by_outcome": Counter(), "amendments": 0,
                           "amendments_none": 0, "amendments_rejected": 0, "decision_reverts": 0,
                           "revert_conflicts": 0, "requeued": 0, "reexec": Counter(), "reexec_cost": Counter(),
                           "author_cost": 0.0, "failfirst_runs": 0, "failfirst_seconds": 0.0, "partner_rechecks": 0,
                           "card_wait_seconds": 0.0, "inherited_reds": 0, "inherited_wait_seconds": 0.0,
                           "adopt_in_place": 0, "revert_cascades": 0,
                           "dynamic_culprit_runs": 0, "dynamic_culprit_seconds": 0.0})
        self.trunk_red: dict[str, set] = {}             # trunk sha validated red -> failing test files
        self.inherited_count: Counter[str] = Counter()
        self.adopt_mode = env.get("ADOPT_MODE", "revert")   # revert (as specified) | in-place
        self.dynamic = env.get("DYNAMIC_CULPRITS", "1") != "0"   # coverage + blame + leave-one-out
        # winner -> {path: (loser, amended content, previous content)}: in-place amendments that land with the winner
        self.carried: dict[str, dict[str, tuple[str, str, str]]] = {}

    # ---- setup ------------------------------------------------------------------------------------------------

    async def setup(self) -> None:
        await super().setup()
        for ts in self.tasks:
            self.canonical[ts.id] = dict(ts.task.acceptance_tests)
        self.parse_script = os.path.join(self.work, "parsecheck.mjs")
        with open(self.parse_script, "w", encoding="utf-8") as fh:
            fh.write(PARSE_CHECK)
        if self.mode == "human":
            self.board = CardBoard(self.human_port)
            url = self.board.start()
            print(f"[cards] decision cards: {url}", file=sys.stderr, flush=True)
            if self.human_open:
                webbrowser.open(url)

    def e6_config(self) -> dict:
        return {"mode": self.mode, "oracle": self.oracle, "card_after": self.card_after,
                "card_after_known": self.card_after_known, "coupling_prior": self.prior, "spec_amend": self.spec_amend,
                "rescue": self.rescue, "reexec_max": self.reexec_max, "adopt_mode": self.adopt_mode,
                "dynamic_culprits": self.dynamic, "decision_seconds": self.decision_seconds,
                "human_timeout": self.human_timeout if self.mode == "human" else None,
                "human_fallback": self.human_fallback if self.mode == "human" else None,
                "board": self.board.index_url() if self.board else None, "table": self.table.path,
                "table_pairs": len(self.table.entries)}

    async def shutdown(self) -> None:
        try:
            await super().shutdown()
        finally:
            self.write_decisions()
            if self.board:
                self.board.stop()

    # ---- the coupling prior and trunk lookups ----------------------------------------------------------------

    def known_partners(self, tid: str) -> list[str]:
        if self.prior != "arena":
            return []
        ts = self.by_id.get(tid)
        return [p for p in ts.task.partners("semantic") if p in self.by_id] if ts else []

    def live_commit(self, tid: str) -> TrunkCommit | None:
        return next((c for c in reversed(self.commits) if c.task_id == tid and c.kind == "task" and not c.reverted),
                    None)

    def decision_for(self, a: str, b: str) -> Decision | None:
        return self.decisions.get(pair_key(a, b))

    async def task_context(self, tid: str) -> dict:
        """Intent and diff of a bean: its live trunk commit, else its fork's own change (an arriving winner)."""
        assert self.git
        ts = self.by_id[tid]
        c = self.live_commit(tid)
        if c is not None:
            diff = await self.git.diff_text(c.parent, c.sha, limit=5000)
        elif ts.worktree and os.path.isdir(ts.worktree):
            try:
                head = await self.git.rev("HEAD", cwd=ts.worktree)
                diff = await self.git.diff_text(await self.git.merge_base(self.trunk, head), head, limit=5000)
            except Exception:  # noqa: BLE001 - context is best effort
                diff = "(diff unavailable)"
        else:
            diff = "(not started)"
        return {"task": tid, "title": ts.task.title, "intent": ts.task.prompt, "diff": diff}

    def replay_patches(self, ts: TaskState, d: Decision | None) -> list[dict]:
        """Replay agents: the reference patch, plus a fixture adapting it to the decision when the arena has one."""
        out = self.patch_ref(ts.task.solution)
        if d is not None and d.winner and d.winner != ts.id:
            fix = os.path.join(self.decisions_dir, "replay", "patch", f"{ts.id}@{d.winner}.patch")
            if os.path.exists(fix):
                out += self.patch_ref(fix)
        return out

    # ---- dispatch and the task flow ----------------------------------------------------------------------------

    async def dispatch(self) -> None:
        if not self.config_logged:
            self.config_logged = True
            self.log("decision.config", **self.e6_config())
        for winner, losers in list(self.parked_behind.items()):  # safety: a winner that will never land
            w = self.by_id[winner]
            if w.status in ("dropped",) or (w.status in ("landed", "green") and self.live_commit(winner)):
                for lid in self.parked_behind.pop(winner, []):
                    self.requeue(self.by_id[lid])
        await super().dispatch()

    async def task_flow(self, ts: TaskState, agent: AgentSlot) -> None:
        try:
            if ts.id not in self.ctx:
                await self.start_cards(ts, agent)
            if self.aborted:
                return
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
            self.ctx.pop(ts.id, None)
            self.carried.pop(ts.id, None)  # the in-place amendments are on the sprout now
            self.on_landed(ts)
            self.release(agent.id)
        finally:
            self.flows -= 1

    async def start_cards(self, ts: TaskState, agent: AgentSlot) -> None:
        """CARD_AFTER_KNOWN=-1: a declared partner is already on the sprout when this bean starts, so its spec is
        decided before any work (and amended if it loses)."""
        if self.card_after_known >= 0:
            return
        for p in self.known_partners(ts.id):
            if self.live_commit(p) is None or self.decision_for(ts.id, p):
                continue
            d = await self.raise_card(arriving=ts, landed=self.by_id[p], trigger="start", red=None)
            d.applied.append({"task": ts.id, "at": "start", "how": "context", "t": round(self.now(), 3)})
            self.ctx[ts.id] = {"reason": "start", "card": d.card}
            if self.oracle == "decline" and self.mode == "oracle" and d.loser == ts.id:
                self.drop(ts, f"declined by decision {d.card}: the accepted spec of {d.winner} was kept")
                return
            if d.loser == ts.id:
                await self.amend_tests(ts, d, agent, snapshot=self.trunk, failing=[], output="")
            return

    async def run_initial(self, ts: TaskState, agent: AgentSlot, base: str) -> bool:
        ctx = self.ctx.get(ts.id)
        if ts.status == "dropped":
            return False
        if not ctx:
            return await super().run_initial(ts, agent, base)
        d = self.by_card.get(ctx.get("card") or "")
        reason = ctx["reason"]
        kind = "initial" if reason == "start" else ("rescue" if reason == "rescue" else "reexec")
        ts.status, ts.agent, ts.base_sha = "running", agent.id, base
        ts.started_at = ts.started_at if ts.started_at is not None else self.now()
        if reason in ("adopt-arriving", "keep-landed") and d is not None and d.loser == ts.id:
            await self.amend_tests(ts, d, agent, snapshot=base, failing=ctx.get("failing", []),
                                   output=ctx.get("output", ""))
        await self.open_task_worktree(ts, base)
        self.write_carried(ts, ts.worktree)
        ts.session_id = None
        self.log("task.start", task=ts.id, agent=agent.id, base=base, predicted=ts.selected,
                 reexec=None if kind == "initial" else reason, card=d.card if d else None)
        winner_ctx = await self.task_context(d.winner) if d and d.winner != ts.id and self.live_commit(d.winner) \
            else None
        amended = (self.amended.get(ts.id) or {}).get("paths", [])
        others = self.decisions_in_force(ts.id, exclude=d)
        extra = list(ctx.get("extra") or []) + (["Other decisions in force for this task:"] + [f"- {o}" for o in others]
                                                if others else [])
        if reason == "start" and d is not None:
            prompt = start_context(ts.task, d, winner_ctx, amended)
        else:
            prompt = reexec_prompt(ts.task, d, winner_ctx, reason, amended, extra=extra)
        while True:
            spec = InvocationSpec(inv_id=self.new_inv_id(kind), kind=kind, task_id=ts.id, agent_id=agent.id,
                                  cwd=ts.worktree, prompt=prompt, attempt=ts.infra_retries + 1,
                                  replay={"patches": self.replay_patches(ts, d)})
            if kind != "initial":
                self.log("reexec.start", task=ts.id, reason=reason, card=d.card if d else None, base=base,
                         inv=spec.inv_id)
            res = await self.invoke(spec, agent)
            ts.invocations.append(spec.inv_id)
            if not res.infra_error:
                break
            ts.infra_retries += 1
            if ts.infra_retries > 2:
                self.drop(ts, f"agent failed to run: {res.infra_error[:200]}")
                return False
            self.log("invocation.retry", task=ts.id, reason=res.infra_error[:300])
            await asyncio.sleep(min(60.0, self.cfg.infra_retry_seconds * ts.infra_retries))
        if kind != "initial":
            self.count_reexec(ts, d, kind, reason, spec.inv_id, res.cost_usd)
        ts.session_id = res.session_id
        ts.agent_done_at = self.now()
        await self.commit_task(ts, spec.inv_id, kind)
        return True

    def count_reexec(self, ts: TaskState, d: Decision | None, kind: str, reason: str, inv: str, cost: float) -> None:
        self.stats["reexec"][reason] += 1
        self.stats["reexec_cost"][reason] += cost
        if d is not None:
            d.reexecutions.append({"task": ts.id, "inv": inv, "kind": kind, "reason": reason,
                                   "cost_usd": round(cost, 6)})

    # ---- the committer: pre-land loop with decisions, rescue and partner-aware re-checks ------------------------

    async def land(self, wt: str, *, kind: str, agent: AgentSlot, ts: TaskState | None = None,
                   ticket=None) -> int | None:
        if kind != "task" or ts is None:
            return await super().land(wt, kind=kind, agent=agent, ts=ts, ticket=ticket)
        assert self.git
        rounds = 0
        while True:
            change_head = await self.git.rev("HEAD", cwd=wt)
            red: CIResult | None = None
            if self.preland_mode == "optimistic":
                outcome, head, new, conflicts, red = await self.try_optimistic(change_head, ts, kind)
                if outcome == "landed":
                    return new  # type: ignore[return-value]
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
                if self.rescue and ts.id not in self.rescued and not self.aborted:
                    self.rescued.add(ts.id)
                    why = "pre-land check still red" if red else "unresolved conflict"
                    self.log("rescue.start", task=ts.id, why=why, rounds=rounds - 1)
                    await self.reexecute_in_place(ts, agent, reason="rescue", d=None, red=red)
                    rounds = 0
                    continue
                if red:
                    self.stats["preland_drops"] += 1
                    self.drop(ts, "pre-land check still red after --max-rework attempts")
                return None
            if red is None:  # textual conflict: the author resolves it on the new head
                self.conflicts_met += 1
                ts.conflicts += 1
                self.conflict_events.append({"task": ts.id, "files": conflicts})
                self.log("merge.conflict", task=ts.id, ticket=None, onto=head, files=conflicts)
                if not await self.resolve_on(wt, head, conflicts, agent, ts, rounds):
                    if ts.status == "dropped" or self.aborted:
                        return None
                continue  # an unresolved round counts; the rescue takes over when the budget runs out
            step = await self.repair_before_landing(wt, head, red, agent, ts, rounds)
            if isinstance(step, Landed):
                return step.idx
            if step == REEXECUTED:
                rounds = 0
            elif step == RETRY:
                rounds -= 1  # the red was the trunk's, not this bean's
            elif step == STOP or not step:
                return None

    def partners_landed_between(self, ts: TaskState, head0: str, head: str) -> list[str]:
        partners = set(self.known_partners(ts.id))
        if not partners:
            return []
        i0 = self.sha_idx.get(head0, -1)
        i1 = self.sha_idx.get(head, len(self.commits) - 1)
        out = []
        for c in self.commits[i0 + 1: i1 + 1]:
            tid = c.task_id if c.kind == "task" else getattr(c, "reverts", None)
            if tid in partners:
                out.append(tid)
        return out

    async def try_optimistic(self, change_head: str, ts: TaskState, kind: str):
        """Parent's optimistic check, plus: re-check when a declared coupling partner landed (or was reverted)
        meanwhile, even if the files are disjoint (the mutual-acceptance pre-check for known pairs)."""
        assert self.git
        msg = self.land_message(kind, ts, None)
        rechecks = 0
        while True:
            head0 = self.trunk
            mb = await self.git.merge_base(change_head, head0)
            new0, conflicts = await self.git.squash_onto(head0, change_head, mb, msg)
            if new0 is None:
                return "conflict", head0, None, conflicts, None
            if rechecks >= 3:
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
                partners = self.partners_landed_between(ts, head0, head)
                if not (delta & mine) and not partners:
                    self.stats["preland_optimistic_landings"] += 1
                    self.log("preland.optimistic", task=ts.id, checked_on=head0, landed_on=head,
                             landed_meanwhile=len(delta))
                    return "landed", head, await self.publish(new, head, kind, ts), [], None
                if partners and not (delta & mine):
                    self.stats["partner_rechecks"] += 1
            rechecks += 1
            self.stats["preland_rechecks"] += 1
            self.log("preland.recheck", task=ts.id, checked_on=head0, head=self.trunk, attempt=rechecks,
                     partners=partners or None)

    # ---- a red pre-land check: apply a decision, raise a card, or an informed rework -------------------------------

    async def resolve_on(self, wt: str, head: str, conflicts: list[str], agent: AgentSlot, ts: TaskState,
                         rounds: int) -> bool:
        """Parent's resolution round, except that a failure never drops the bean (the round counts instead)."""
        assert self.git
        files = await self.git.merge_into_worktree(wt, head)
        if not files:
            await self.git.commit_all(wt, "Merge trunk into task\n")
            return True
        left = await self.reexecute(wt, files, head, kind="task", agent=agent, ts=ts, ticket=None, attempt=rounds)
        if not left:
            return True
        await self.reset_worktree(wt)
        return False

    async def reset_worktree(self, wt: str) -> None:
        """Back to the worktree's last commit, merge state included. ``git merge --abort`` alone can leave MERGE_HEAD
        behind (an index rewritten mid-merge); v2 then dropped the bean, E6 keeps it going, so make sure."""
        assert self.git
        await self.git.abort_merge(wt)
        if os.path.exists(os.path.join(await self.git.git_dir(wt), "MERGE_HEAD")):
            await self.git.run("reset", "-q", "--hard", "HEAD", cwd=wt, check=False)
        await self.git.run("clean", "-q", "-fd", cwd=wt, check=False)

    def inherited(self, red: CIResult, checked_on: str) -> bool:
        """Every failing test of this pre-land check already failed in a validation of the trunk commit the check
        was based on (or an ancestor still unhealed): the red belongs to the trunk, not to this bean."""
        failing = set(red.failing_files or [])
        if not failing:
            return False
        idx = self.sha_idx.get(checked_on, -1)
        known: set[str] = set()
        for c in reversed(self.commits[self.green_idx + 1: idx + 1]):
            if c.kind == "revert":  # a revert landed after the red: assume it healed it
                break
            known |= self.trunk_red.get(c.sha, set())
        return failing <= known

    async def on_validation(self, idx: int, res: CIResult) -> None:
        if not res.green and res.failing_files:
            self.trunk_red[self.commits[idx].sha] = set(res.failing_files)
        await super().on_validation(idx, res)

    async def wait_for_trunk(self, head: str, timeout: float = 300.0) -> float:
        t0 = self.now()
        while self.trunk == head and self.now() - t0 < timeout and not self.aborted:
            await asyncio.sleep(1.0)
        return self.now() - t0

    def culprit_tasks(self, red: CIResult, ts: TaskState, dynamic: list[str] | None = None) -> list[str]:
        """Most likely first: declared coupling partners on the sprout whose tests fail; owners of failing acceptance
        tests; beans the dynamic read set confirmed for this bean's own failing tests (``dynamic_culprits``, which
        probes declared partners first, wherever they landed); and only without dynamic evidence, v2's static guess
        (landed after the snapshot, writes meeting the failing tests' import closure)."""
        failing = set(red.failing_files or [])
        out = [p for p in self.known_partners(ts.id)  # its tests fail: direct evidence
               if self.live_commit(p) and failing & set(self.by_id[p].task.acceptance_tests)]
        owners = self.acceptance_owners()
        out += [owners[f] for f in (red.failing_files or []) if f in owners and owners[f] != ts.id]
        out += list(dynamic or [])
        if dynamic is None:  # no dynamic evidence was gathered: fall back to v2's static guess
            out += super().culprit_tasks(red, ts)
        seen: list[str] = []
        for tid in out:
            if tid not in seen and tid != ts.id:
                seen.append(tid)
        return seen[:2]

    async def dynamic_culprits(self, ts: TaskState, red: CIResult, priority: list[str] | None = None) -> list[str]:
        """Who broke this bean's OWN acceptance tests? Run the failing test files with coverage on the tree the
        pre-land check ran on, ``git blame`` the executed lines, and confirm each landed bean found that way by a
        leave-one-out probe: the bean is a culprit if reverting it from that tree makes a failing test pass.
        Declared partners (``priority``) are probed first; then up to 24 beans by executed lines, 4 at a time. No
        agent cost; a few seconds of local test runs (it reads what the check already paid for)."""
        assert self.git and self.runner
        own = sorted(set(red.failing_files or []) & set(ts.task.acceptance_tests))
        if not own or not red.sha:
            return []
        t0 = self.now()
        base = os.path.join(self.work, "probes", f"{ts.id}-{red.ci_id}")
        os.makedirs(base, exist_ok=True)
        wt = os.path.join(base, "tree")
        candidates: list[tuple[str, int]] = []
        confirmed: list[tuple[str, int]] = []
        try:
            await self.git.add_worktree(wt, red.sha)
            lcov = os.path.join(base, "cov.lcov")
            await self.runner.run(["node", "--test", "--experimental-test-coverage", "--test-reporter=lcov",
                                   f"--test-reporter-destination={lcov}", *own], wt, timeout=120)
            hits: dict[str, set[int]] = {}
            cur = None
            root = os.path.realpath(wt)
            if os.path.exists(lcov):
                with open(lcov, encoding="utf-8", errors="replace") as fh:
                    for line in fh:
                        if line.startswith("SF:"):  # node writes paths relative to the run's cwd
                            sf = line[3:].strip()
                            path = os.path.realpath(sf if os.path.isabs(sf) else os.path.join(wt, sf))
                            cur = os.path.relpath(path, root) if path.startswith(root + os.sep) else None
                        elif line.startswith("DA:") and cur:
                            n, h = line[3:].strip().split(",")[:2]
                            if int(h) > 0:
                                hits.setdefault(cur, set()).add(int(n))
            changed = set(await self.git.changed_files(self.base_sha, red.sha))
            lines: Counter[str] = Counter()
            for path, executed in hits.items():
                if path not in changed or path.endswith(".test.ts") or path.endswith("lib/testing.ts"):
                    continue
                out = (await self.git.run("blame", "-l", "-s", red.sha, "--", path, check=False)).stdout
                for i, row in enumerate(out.splitlines(), 1):
                    if i in executed and row:
                        lines[row.split()[0].lstrip("^")] += 1
            by_task: Counter[str] = Counter()
            for sha, n in lines.most_common():
                idx = self.sha_idx.get(sha, -1)
                c = self.commits[idx] if idx >= 0 else None
                if c is not None and c.kind == "task" and c.task_id and c.task_id != ts.id and not c.reverted:
                    by_task[c.task_id] += n
            first = [(p, by_task.get(p, 0)) for p in (priority or []) if p != ts.id and self.live_commit(p)]
            candidates = (first + [(t, n) for t, n in by_task.most_common() if t not in dict(first)])[:24]
            fails0 = await self.failing_in(wt, own)
            sem = asyncio.Semaphore(4)

            async def probe(tid: str) -> tuple[str, int]:
                c = self.live_commit(tid)
                if c is None:
                    return tid, 0
                async with sem:
                    tree, _ = await self.git.merge_tree(c.sha, red.sha, c.parent)
                    if tree is None:
                        return tid, 0
                    sha = await self.git.commit_tree(tree, [red.sha], f"probe: without {tid}\n")
                    pwt = os.path.join(base, f"without-{tid}")
                    await self.git.add_worktree(pwt, sha)
                    try:
                        fails = await self.failing_in(pwt, own)
                    finally:
                        await self.git.remove_worktree(pwt)
                    return tid, len(fails0 - fails) if fails is not None and fails0 is not None else 0
            results = await asyncio.gather(*(probe(tid) for tid, _ in candidates))
            confirmed = sorted([(tid, fixed) for tid, fixed in results if fixed > 0], key=lambda x: -x[1])
        except Exception as e:  # noqa: BLE001 - a diagnostic must never break the landing loop
            self.log("culprit.dynamic.error", task=ts.id, error=repr(e)[:300])
        finally:
            await self.git.remove_worktree(wt)
        self.stats["dynamic_culprit_runs"] += 1
        self.stats["dynamic_culprit_seconds"] += self.now() - t0
        self.log("culprit.dynamic", task=ts.id, own_failing=own, candidates=[{"task": t, "lines": n} for t, n in candidates],
                 confirmed=[{"task": t, "fixed_tests": n} for t, n in confirmed], seconds=round(self.now() - t0, 2))
        return [t for t, _ in confirmed]

    async def failing_in(self, wt: str, files: list[str]) -> set[str] | None:
        """Names of the failing tests among ``files`` in a checkout (junit), or None if the run crashed."""
        from .ci import parse_junit
        assert self.runner
        junit = wt.rstrip("/") + ".junit.xml"
        await self.runner.run(["node", "--test", "--test-reporter=junit", f"--test-reporter-destination={junit}",
                               *files], wt, timeout=120)
        parsed = parse_junit(junit, wt)
        if parsed is None:
            return None
        return {f"{t['file']} > {t['name']}" for t in parsed[0]}

    def owner_of(self, path: str) -> str | None:
        """The landed bean whose acceptance test this is."""
        for ts in self.tasks:
            if path in ts.task.acceptance_tests and self.live_commit(ts.id):
                return ts.id
        return None

    def threshold(self, tid: str, other: str) -> int:
        if other in self.known_partners(tid):
            return max(0, self.card_after_known)
        return self.card_after

    def applicable(self, d: Decision, tid: str) -> bool:
        return sum(1 for a in d.applied if a.get("task") == tid and a.get("at") != "start") < self.reexec_max

    async def repair_before_landing(self, wt: str, head: str, red: CIResult, agent: AgentSlot, ts: TaskState,
                                    rounds: int):
        if self.inherited(red, head) and self.inherited_count[ts.id] < 3:
            self.inherited_count[ts.id] += 1
            self.stats["inherited_reds"] += 1
            self.log("preland.inherited", task=ts.id, checked_on=head, failing=sorted(red.failing_files or []))
            self.stats["inherited_wait_seconds"] += await self.wait_for_trunk(head)
            return RETRY
        failing = set(red.failing_files or [])
        own = set(ts.task.acceptance_tests)
        partners = [p for p in self.known_partners(ts.id) if self.live_commit(p)]
        partner_tests_fail = [p for p in partners if failing & set(self.by_id[p].task.acceptance_tests)]
        dynamic = None  # None: not gathered; []: gathered, and no landed bean explains the red
        if self.dynamic and not partner_tests_fail and failing & own:
            dynamic = await self.dynamic_culprits(ts, red, priority=partners)
        culprits = self.culprit_tasks(red, ts, dynamic)
        decided = [(c, self.decision_for(ts.id, c)) for c in culprits]
        for c, d in decided:
            if d is not None and d.status != "moot" and self.applicable(d, ts.id) and self.live_commit(c):
                return await self.apply_decision(d, ts, c, wt, red, agent)
        undecided = [c for c, d in decided if d is None]
        for c in undecided:
            self.pair_reds[(ts.id, c)] += 1
        stuck = [c for c in undecided if self.pair_reds[(ts.id, c)] > self.threshold(ts.id, c)]
        if stuck:
            d = await self.raise_card(arriving=ts, landed=self.by_id[stuck[0]], trigger="preland", red=red)
            return await self.apply_decision(d, ts, stuck[0], wt, red, agent)
        return await self.informed_rework(wt, head, red, agent, ts, rounds, culprits)

    async def informed_rework(self, wt: str, head: str, red: CIResult, agent: AgentSlot, ts: TaskState, rounds: int,
                              culprits: list[str]):
        """v2's rung: the author's session, resumed, with the failing tests and the culprits' intent and diff (and
        any decision already made for the pair)."""
        assert self.git
        if not await self.resolve_on(wt, head, [], agent, ts, rounds):
            return STOP if ts.status == "dropped" or self.aborted else CONTINUE
        failing = [f"{t['file']} > {t['name']}" for t in red.failing_tests][:20] or list(red.failing_files or [])
        context = await self.culprit_context(culprits)
        notes = [f"Decision {d.card} on {ts.id} and {c}: {d.text}" for c in culprits
                 if (d := self.decision_for(ts.id, c)) is not None]
        resumed = self.can_resume(ts)

        def prompt(resumed_: bool) -> str:
            text = informed_red(ts.task, failing, red.output, context, resumed_)
            if notes:
                text = text.replace("The latest trunk has been merged",
                                    "Decisions in force:\n" + "\n".join(f"- {n}" for n in notes) +
                                    "\n\nThe latest trunk has been merged", 1)
            return text
        ts.reworks += 1
        ts.status = "rework"
        self.stats["preland_reworks"] += 1
        if culprits:
            self.stats["informed_reworks"] += 1
        spec = InvocationSpec(inv_id=self.new_inv_id("rework"), kind="rework", task_id=ts.id, agent_id=agent.id,
                              cwd=wt, prompt=prompt(resumed), attempt=rounds,
                              resume_session=ts.session_id if resumed else None,
                              replay={"reset_to": head, "patches": self.patch_ref(ts.task.solution),
                                      "check": "acceptance", "acceptance": ts.task.acceptance_tests})
        self.log("rework.start", task=ts.id, ticket=None, reason="preland-red", failing=failing, attempt=rounds,
                 resumed=resumed, culprits=culprits)
        res = await self.invoke_rework(spec, agent, ts, prompt(False))
        if self.aborted:
            return STOP
        if res.subtype == "unresolved":  # replay cannot adapt: count it as a failed attempt, not a drop
            self.log("rework.unresolved", task=ts.id, culprits=culprits)
            await self.git.run("read-tree", "--reset", "-u", "HEAD", cwd=wt, check=False)
            await self.reset_worktree(wt)
            return CONTINUE
        await self.commit_task(ts, spec.inv_id, "rework")
        ts.status = "running"
        return CONTINUE

    # ---- cards ------------------------------------------------------------------------------------------------

    async def raise_card(self, *, arriving: TaskState, landed: TaskState, trigger: str,
                         red: CIResult | None) -> Decision:
        key = pair_key(arriving.id, landed.id)
        if key in self.decisions:
            return self.decisions[key]
        if key in self.pending:
            return await asyncio.shield(self.pending[key])
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self.pending[key] = fut
        try:
            self.card_seq += 1
            card = f"D{self.card_seq:03d}"
            entry = self.table.get(*key)
            specs = {tid: one_line(self.by_id[tid].task, entry) for tid in (landed.id, arriving.id)}
            failing = [f"{t['file']} > {t['name']}" for t in red.failing_tests][:12] if red else []
            d = Decision(card=card, pair=key, trigger=trigger, landed=landed.id, arriving=arriving.id,
                         known=landed.id in self.known_partners(arriving.id),
                         source=entry.source if entry else "unknown", specs=specs, failing=failing,
                         requested_at=round(self.now(), 3))
            rec_oracle = self.oracle if self.mode == "oracle" else self.human_fallback
            rec, changer = oracle_choice(rec_oracle, landed=landed.task, arriving=arriving.task, entry=entry,
                                         failing_files=red.failing_files if red else None)
            d.recommended, d.contract_changer, d.oracle = rec, changer, rec_oracle
            if self.board:
                d.url = self.board.url(card)
            self.stats["cards"] += 1
            self.stats["cards_by_trigger"][trigger] += 1
            self.log("decision.request", card=card, task=arriving.id, against=[landed.id], landed=landed.id,
                     arriving=arriving.id, trigger=trigger, known=d.known, source=d.source, specs=specs,
                     failing=failing[:10], url=d.url, recommended=rec,
                     attempts=self.pair_reds.get((arriving.id, landed.id), 0))
            winner, text, mode, wait = rec, "", "oracle", self.decision_seconds
            t0 = self.now()
            if self.mode == "human" and self.board:
                view = await self.card_view(d, landed, arriving, red, entry)
                print(f"[cards] {card}: {arriving.id} meets {landed.id} ({trigger}) -> {d.url}", file=sys.stderr,
                      flush=True)
                if self.human_open:
                    webbrowser.open(d.url)
                ans = await self.board.ask(view, self.human_timeout)
                if ans:
                    winner = landed.id if ans["choice"] == "keep-landed" else arriving.id
                    text, mode = ans.get("text") or "", "human"
                else:
                    mode = "human-timeout"
                wait = self.now() - t0
            elif self.decision_seconds > 0:
                await asyncio.sleep(self.decision_seconds)
            loser = arriving.id if winner == landed.id else landed.id
            d.winner, d.loser, d.mode = winner, loser, mode
            if mode == "human":
                d.outcome = "keep-landed" if winner == landed.id else "adopt-arriving"
            else:
                d.outcome = outcome_for(winner, landed.id, entry)
            d.text = text or decision_text(self.by_id[winner].task, self.by_id[loser].task, entry, specs)
            d.custom_text = bool(text)
            d.decided_at, d.wait_seconds, d.status = round(self.now(), 3), round(wait, 2), "decided"
            self.stats["cards_by_outcome"][d.outcome] += 1
            self.stats["card_wait_seconds"] += wait
            self.stats["card_details"].append({"card": card, "task": arriving.id, "against": [landed.id],
                                               "winner": winner, "outcome": d.outcome, "trigger": trigger,
                                               "specs": specs})
            self.log("decision.made", card=card, winner=winner, loser=loser, outcome=d.outcome, text=d.text,
                     mode=mode, oracle=rec_oracle, wait_seconds=round(wait, 2), contract_changer=changer,
                     custom_text=d.custom_text)
            if self.board:
                self.board.note(card, decided=f"{winner} wins; {loser} {'re-executes' if self.oracle != 'decline' else 'is declined'}",
                                outcome=d.outcome, text=d.text, mode=mode)
            self.decisions[key] = d
            self.by_card[card] = d
            self.write_decisions()
            fut.set_result(d)
            return d
        except BaseException as e:
            if not fut.done():
                if isinstance(e, asyncio.CancelledError):
                    fut.cancel()
                else:
                    fut.set_exception(e)
                    fut.exception()  # mark retrieved
            raise
        finally:
            self.pending.pop(key, None)

    async def card_view(self, d: Decision, landed: TaskState, arriving: TaskState, red: CIResult | None,
                        entry) -> dict:
        assert self.git
        lc = self.live_commit(landed.id)
        diffs = {landed.id: await self.git.diff_text(lc.parent, lc.sha, limit=6000) if lc else "(not on the trunk)"}
        if arriving.worktree and arriving.base_sha and os.path.isdir(arriving.worktree) and red is not None:
            try:
                ahead = await self.git.rev("HEAD", cwd=arriving.worktree)
                mb = await self.git.merge_base(self.trunk, ahead)
                diffs[arriving.id] = await self.git.diff_text(mb, ahead, limit=6000)
            except Exception:  # noqa: BLE001 - a card without the second diff is still a card
                diffs[arriving.id] = "(diff unavailable)"
        else:
            tests = "\n\n".join(f"// {p}\n{c}" for p, c in arriving.task.acceptance_tests.items())
            diffs[arriving.id] = f"(not started yet: its spec and acceptance tests)\n\n{arriving.task.prompt}\n\n{tests}"
        return {"card": d.card, "landed": landed.id, "arriving": arriving.id, "trigger": d.trigger, "known": d.known,
                "source": d.source, "specs": d.specs, "diffs": diffs, "failing": d.failing,
                "titles": {landed.id: landed.task.title, arriving.id: arriving.task.title},
                "output": (red.output or "")[:3000] if red else "", "recommended": d.recommended,
                "oracle": d.oracle, "note": entry.contract_note if entry else ""}

    # ---- outcomes ------------------------------------------------------------------------------------------------

    async def apply_decision(self, d: Decision, ts: TaskState, other: str, wt: str, red: CIResult | None,
                             agent: AgentSlot):
        """``ts`` is the arriving bean whose pre-land check is red against the landed bean ``other``."""
        now = round(self.now(), 3)
        if self.oracle == "decline" and self.mode == "oracle":  # v2: the arriving bean is declined
            d.applied.append({"task": ts.id, "at": "preland", "how": "declined", "t": now})
            self.drop(ts, f"declined by decision {d.card}: the accepted spec of {d.winner} was kept")
            return STOP
        if self.current_outcome(d, landed=other) == "keep-landed":
            d.applied.append({"task": ts.id, "at": "preland", "how": "keep-landed", "t": now})
            d.status = "applied"
            self.log("decision.apply", card=d.card, task=ts.id, outcome="keep-landed", reexecute=ts.id)
            await self.reexecute_in_place(ts, agent, reason="keep-landed" if d.loser == ts.id else "adapt", d=d,
                                          red=red)
            return REEXECUTED
        # adopt-arriving: revert the landed loser, land this bean, re-execute the loser against the new contract
        loser = self.by_id[other]
        if self.adopt_mode == "in-place":
            return await self.adopt_in_place(d, ts, loser, wt, red, agent, why="ADOPT_MODE=in-place")
        outcome, idx, info = await self.try_adopt(ts, loser, d, wt)
        if outcome != "landed":
            if outcome == "cascade":
                self.stats["revert_cascades"] += 1
                self.log("decision.cascade", card=d.card, task=ts.id, loser=other, broken=info)
            return await self.adopt_in_place(d, ts, loser, wt, red, agent,
                                             why={"cascade": f"reverting {other} would break {', '.join(info)}",
                                                  "revert-conflict": "revert conflicted",
                                                  "conflict": f"{ts.id} conflicts with the sprout without {other}",
                                                  "red": f"{ts.id} fails without {other}"}[outcome])
        d.applied.append({"task": ts.id, "at": "preland", "how": "adopt-arriving", "reverted": other,
                          "t": round(self.now(), 3)})
        d.status = "applied"
        self.stats["decision_reverts"] += 1
        self.log("decision.apply", card=d.card, task=ts.id, outcome="adopt-arriving", reverted=other, revert_idx=info,
                 landed_idx=idx)
        self.park(loser, behind=ts.id, ctx={"reason": "adopt-arriving", "card": d.card, "failing": d.failing,
                                            "output": (red.output if red else "")[:3000]})
        return Landed(idx)

    async def try_adopt(self, ts: TaskState, loser: TaskState, d: Decision, wt: str):
        """Revert the loser and land the winner in one committer turn, after one pre-land check of the candidate
        (sprout minus the loser, plus the winner): the sprout never holds the revert alone. Returns
        ("landed", idx, None) | ("cascade", None, beans the revert would break) | ("revert-conflict" | "conflict" |
        "red", None, detail). Same optimism as ``try_optimistic``: a re-check only when the sprout moved and the
        commits that landed meanwhile touch the winner's or the loser's files (or a declared partner)."""
        assert self.git
        target = self.live_commit(loser.id)
        if target is None:
            return "revert-conflict", None, "loser not on the sprout"
        change_head = await self.git.rev("HEAD", cwd=wt)
        msg = self.land_message("task", ts, None)
        rmsg = f"Revert {loser.task.title}\n\nReverts: {target.sha}\nDecision: {d.card}\n"
        for attempt in range(4):
            locked = attempt == 3  # heavy churn: check inside the committer turn so this cannot starve
            held = False
            if locked:
                await self.committer.acquire()
                held = True
            try:
                head0 = self.trunk
                tree, conflicts = await self.git.merge_tree(target.sha, head0, target.parent)
                if tree is None:
                    self.stats["revert_conflicts"] += 1
                    self.log("revert.conflict", ticket=None, card=d.card, task=loser.id, files=conflicts)
                    return "revert-conflict", None, conflicts
                rev0 = await self.git.commit_tree(tree, [head0], rmsg)
                mb = await self.git.merge_base(change_head, rev0)
                new0, conflicts = await self.git.squash_onto(rev0, change_head, mb, msg)
                if new0 is None:
                    return "conflict", None, conflicts
                res = await self.preland_check(new0, ts)
                if not res.green:
                    own = set(ts.task.acceptance_tests)
                    third = sorted({o for f in res.failing_files or [] if f not in own
                                    and (o := self.owner_of(f)) and o not in (ts.id, loser.id)})
                    return ("cascade", None, third) if third else ("red", None, res.failing_files)
                if not held:
                    await self.committer.acquire()
                    held = True
                head = self.trunk
                if head != head0:
                    delta = set(await self.git.changed_files(head0, head))
                    mine = set(await self.git.changed_files(mb, change_head)) | set(target.files)
                    partners = self.partners_landed_between(ts, head0, head) + \
                        self.partners_landed_between(loser, head0, head)
                    if (delta & mine) or partners:
                        self.stats["preland_rechecks"] += 1
                        self.log("preland.recheck", task=ts.id, checked_on=head0, head=head, attempt=attempt + 1,
                                 adopting=loser.id)
                        continue
                    tree, _ = await self.git.merge_tree(target.sha, head, target.parent)
                    if tree is None:
                        continue
                    rev0 = await self.git.commit_tree(tree, [head], rmsg)
                    mb = await self.git.merge_base(change_head, rev0)
                    new0, _ = await self.git.squash_onto(rev0, change_head, mb, msg)
                    if new0 is None:
                        continue
                ridx = await self.publish_revert(rev0, head, loser, target, card=d.card,
                                                 why=f"decision {d.card}: {ts.id}'s spec wins")
                idx = await self.publish(new0, rev0, "task", ts)
                return "landed", idx, ridx
            finally:
                if held:
                    self.committer.release()
        return "red", None, "the sprout kept moving"

    async def publish_revert(self, sha: str, head: str, loser: TaskState, target: TrunkCommit, *, card: str | None,
                             why: str, ticket=None) -> int:
        """Caller holds the committer turn. Moves the sprout to a prepared revert commit of ``target``."""
        assert self.git
        await self.git.update_ref("refs/heads/trunk", sha, head)
        self.trunk = sha
        files = await self.git.changed_files(head, sha)
        c = TrunkCommit(idx=len(self.commits), sha=sha, parent=head, kind="revert", task_id=None,
                        ticket_id=ticket.id if ticket else None, files=files,
                        modules=sorted(placement_modules(files)), landed_at=self.now())
        c.reverts = loser.id  # type: ignore[attr-defined]
        self.commits.append(c)
        self.sha_idx[sha] = c.idx
        target.reverted = True
        self.stats["reverts"] += 1
        self.log("revert", ticket=ticket.id if ticket else None, card=card, task=loser.id, reverted=target.sha,
                 sha=sha, trunk_idx=c.idx, why=why)
        loser.landed_sha, loser.landed_at, loser.green_at, loser.write_set = None, None, None, []
        self.poke()
        return c.idx

    async def adopt_in_place(self, d: Decision, ts: TaskState, loser: TaskState, wt: str, red: CIResult | None,
                             agent: AgentSlot, *, why: str):
        """Adopt the arriving spec without a revert: the loser's code stays on the sprout, its acceptance tests are
        amended to the decision (test author, in place), and the amended tests travel with the winner's landing,
        which must make them pass (adapting the loser's code where needed)."""
        self.stats["adopt_in_place"] += 1
        d.applied.append({"task": ts.id, "at": "preland", "how": f"adopt-arriving in place ({why})",
                          "t": round(self.now(), 3)})
        d.status = "applied"
        self.log("decision.apply", card=d.card, task=ts.id, outcome="adopt-arriving", in_place=True, loser=loser.id,
                 why=why)
        amend = await self.amend_tests(loser, d, agent, snapshot=self.trunk, failing=d.failing,
                                       output=red.output if red else "", in_place=True)
        if amend:
            assert self.git
            for path in amend.get("paths", []):
                self.carried.setdefault(ts.id, {})[path] = (loser.id, loser.task.acceptance_tests[path],
                                                            amend["before"][path])
            self.write_carried(ts, wt)
            await self.git.commit_all(wt, f"Amend {loser.id}'s acceptance tests (decision {d.card})\n")
        return CONTINUE

    def write_carried(self, ts: TaskState, wt: str) -> list[str]:
        """Write the in-place amendments ``ts`` carries into its worktree; returns the paths that differed."""
        changed = []
        for path, (_, content, _) in (self.carried.get(ts.id) or {}).items():
            full = os.path.join(wt, path)
            cur = None
            if os.path.exists(full):
                with open(full, encoding="utf-8", errors="replace") as fh:
                    cur = fh.read()
            if cur != content:
                changed.append(path)
                os.makedirs(os.path.dirname(full), exist_ok=True)
                with open(full, "w", encoding="utf-8") as fh:
                    fh.write(content)
        return changed

    async def commit_task(self, ts: TaskState, inv_id: str, kind: str) -> str:
        """Parent's commit, after putting back any carried amendment the agent changed (they are protected too)."""
        if ts.worktree and self.carried.get(ts.id):
            changed = self.write_carried(ts, ts.worktree)
            if changed and kind != "initial":
                ts.tamper += changed
                self.log("acceptance.restored", task=ts.id, paths=changed, inv=inv_id, others=changed, carried=True)
        return await super().commit_task(ts, inv_id, kind)

    def decisions_in_force(self, tid: str, exclude: Decision | None = None) -> list[str]:
        """Earlier decisions on this bean's pairs: a later amendment or re-execution must stay consistent with them."""
        return [f"{x.card} ({x.pair[0]} and {x.pair[1]}): {x.text}" for x in sorted(self.by_card.values(),
                                                                                   key=lambda y: y.card)
                if tid in x.pair and x is not exclude and x.status != "moot" and x.text]

    def current_outcome(self, d: Decision, *, landed: str) -> str:
        """The decision's outcome for the roles as they are now (the pair may meet again the other way round)."""
        if d.winner == landed:
            return "keep-landed"
        if d.mode == "human":
            return "adopt-arriving"
        return outcome_for(d.winner, landed, self.table.get(*d.pair))

    async def reexecute_in_place(self, ts: TaskState, agent: AgentSlot, *, reason: str, d: Decision | None,
                                 red: CIResult | None, extra_files: dict | None = None,
                                 extra: list[str] | None = None) -> None:
        """Disposable patch: discard the bean's fork, fork the sprout head again and run a fresh session."""
        assert self.git and ts.worktree
        head = self.trunk
        if d is not None and d.loser == ts.id:
            await self.amend_tests(ts, d, agent, snapshot=head, failing=d.failing,
                                   output=(red.output if red else ""))
        await self.reset_worktree(ts.worktree)
        await self.git.add_worktree(ts.worktree, head, ts.branch)
        self.write_acceptance(ts.worktree, [ts.task])
        self.write_carried(ts, ts.worktree)
        for path, content in (extra_files or {}).items():
            full = os.path.join(ts.worktree, path)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "w", encoding="utf-8") as fh:
                fh.write(content)
        ts.base_sha, ts.session_id, ts.status = head, None, "rework"
        winner_ctx = await self.task_context(d.winner) if d and d.winner != ts.id and self.live_commit(d.winner) \
            else None
        failing_lines = []
        if red is not None and reason in ("rescue", "adapt", "winner"):
            failing_lines = ["The last merged tree failed these tests:"] + [
                f"- {t['file']} > {t['name']}" for t in red.failing_tests[:12]]
        others = self.decisions_in_force(ts.id, exclude=d)
        prompt = reexec_prompt(ts.task, d, winner_ctx, reason, (self.amended.get(ts.id) or {}).get("paths", []),
                               extra=(extra or []) + failing_lines +
                               (["Other decisions in force for this task:"] + [f"- {o}" for o in others] if others else []))
        kind = "rescue" if reason == "rescue" else "reexec"
        for attempt in range(3):
            spec = InvocationSpec(inv_id=self.new_inv_id(kind), kind=kind, task_id=ts.id, agent_id=agent.id,
                                  cwd=ts.worktree, prompt=prompt, attempt=attempt + 1,
                                  replay={"patches": self.replay_patches(ts, d)})
            self.log("reexec.start", task=ts.id, reason=reason, card=d.card if d else None, base=head, inv=spec.inv_id)
            res = await self.invoke(spec, agent)
            ts.invocations.append(spec.inv_id)
            self.count_reexec(ts, d, kind, reason, spec.inv_id, res.cost_usd)
            if not res.infra_error:
                ts.session_id = res.session_id
                break
            self.log("invocation.retry", task=ts.id, reason=res.infra_error[:300])
            await asyncio.sleep(min(60.0, self.cfg.infra_retry_seconds * (attempt + 1)))
        ts.reworks += 1
        await self.commit_task(ts, spec.inv_id, kind)
        ts.status = "running"

    # ---- spec amendment -----------------------------------------------------------------------------------------

    async def amend_tests(self, ts: TaskState, d: Decision, agent: AgentSlot | None, *, snapshot: str,
                          failing: list[str], output: str, in_place: bool = False) -> dict | None:
        """A separate test-author session amends ``ts``'s acceptance tests to the decided semantics. Accepted only
        if they parse and (unless in place) fail on ``snapshot``, where ``ts`` is not implemented."""
        if not self.spec_amend or any(a.get("task") == ts.id for a in d.amendments):
            return None
        assert self.git and self.preland_ci
        winner = self.by_id[d.winner]
        wt = os.path.join(self.work, "authors", f"{ts.id}-{d.card}")
        await self.git.add_worktree(wt, snapshot)
        self.write_acceptance(wt, [ts.task])
        before = dict(ts.task.acceptance_tests)
        winner_ctx = await self.task_context(winner.id)
        spec = InvocationSpec(inv_id=self.new_inv_id("author"), kind="author", task_id=ts.id,
                              agent_id=agent.id if agent else None, cwd=wt,
                              prompt=author_prompt(ts.task, d, winner_ctx, failing, output,
                                                   in_force=self.decisions_in_force(ts.id, exclude=d)), replay={})
        self.log("spec.author", task=ts.id, card=d.card, inv=spec.inv_id, snapshot=snapshot, in_place=in_place)
        res = await self.invoke(spec, agent)
        self.stats["author_cost"] += res.cost_usd
        if self.cfg.agent == "replay":  # replay: the arena's fixture stands in for the test author
            fixture = os.path.join(self.decisions_dir, "replay", "amend", f"{ts.id}@{d.winner}.json")
            if os.path.exists(fixture):
                with open(fixture, encoding="utf-8") as fh:
                    for path, content in json.load(fh).items():
                        with open(os.path.join(wt, path), "w", encoding="utf-8") as out:
                            out.write(content)
        after = {}
        for path in before:
            full = os.path.join(wt, path)
            after[path] = ""
            if os.path.exists(full):
                with open(full, encoding="utf-8", errors="replace") as fh:
                    after[path] = fh.read()
        changed = {p: c for p, c in after.items() if c != before[p]}
        rec = {"task": ts.id, "card": d.card, "inv": spec.inv_id, "cost_usd": round(res.cost_usd, 6),
               "in_place": in_place}
        if res.infra_error or not changed:
            rec["status"] = "none" if not res.infra_error else "author-failed"
            d.amendments.append(rec)
            self.stats["amendments_none"] += 1
            self.log("spec.amend.none", task=ts.id, card=d.card, inv=spec.inv_id,
                     reply=(res.result_text or "")[:300], infra_error=res.infra_error)
            await self.git.remove_worktree(wt)
            return None
        problems = []
        bad = await self.parse_check(wt, sorted(changed))
        if bad:
            problems.append(f"does not parse: {'; '.join(bad)[:500]}")
        proof = None
        if not problems and not in_place:
            proof = await self.preland_ci.run(snapshot, "failfirst", extra_files=after)
            self.stats["failfirst_runs"] += 1
            self.stats["failfirst_seconds"] += proof.ci_seconds
            failing_amended = sorted({t["file"] for t in proof.failing_tests if t["file"] in before})
            if not set(failing_amended) & set(changed):
                problems.append("fail-first: the amended test files pass on the snapshot, where the task is not "
                                "implemented")
            rec["fail_first"] = {"snapshot": snapshot, "failing_files": failing_amended,
                                 "failing_tests": [f"{t['file']} > {t['name']}" for t in proof.failing_tests
                                                   if t["file"] in before][:12],
                                 "check_seconds": round(proof.ci_seconds, 2)}
        if problems:
            rec["status"], rec["problems"] = "rejected", problems
            d.amendments.append(rec)
            self.stats["amendments_rejected"] += 1
            self.log("spec.amend.rejected", task=ts.id, card=d.card, inv=spec.inv_id, problems=problems,
                     paths=sorted(changed))
            await self.git.remove_worktree(wt)
            return None
        ts.task.acceptance_tests.update(changed)
        prev = self.amended.get(ts.id, {"paths": []})
        self.amended[ts.id] = {"card": d.card, "paths": sorted(set(prev["paths"]) | set(changed))}
        rec.update(status="amended", paths=sorted(changed),
                   diff="".join(unified(before[p], changed[p], p) for p in sorted(changed))[:8000])
        rec_before = {p: before[p] for p in changed}
        d.amendments.append(rec)
        self.stats["amendments"] += 1
        self.log("spec.amend", task=ts.id, card=d.card, inv=spec.inv_id, paths=sorted(changed), winner=d.winner,
                 text=d.text, diff=rec["diff"], fail_first=rec.get("fail_first"), in_place=in_place,
                 cost_usd=round(res.cost_usd, 6))
        await self.git.remove_worktree(wt)
        return {**rec, "before": rec_before}

    async def parse_check(self, wt: str, paths: list[str]) -> list[str]:
        assert self.runner
        res = await self.runner.run(["node", self.parse_script, *paths], wt, timeout=60)
        try:
            return list(json.loads(res.stdout or "[]"))
        except json.JSONDecodeError:
            return [f"parse check crashed: {(res.stderr or res.stdout)[:300]}"]

    # ---- reverts, parking and re-queueing ---------------------------------------------------------------------

    async def revert_task(self, ts: TaskState, *, why: str, card: str | None = None, ticket=None) -> int | None:
        """Revert the bean's live commit from the sprout. Returns the revert's trunk index, or None if it conflicts."""
        assert self.git
        target = self.live_commit(ts.id)
        if target is None:
            return None
        async with self.committer:
            head = self.trunk
            tree, conflicts = await self.git.merge_tree(target.sha, head, target.parent)
            if tree is None:
                self.stats["revert_conflicts"] += 1
                self.log("revert.conflict", ticket=ticket.id if ticket else None, card=card, task=ts.id,
                         files=conflicts)
                return None
            msg = f"Revert {ts.task.title}\n\nReverts: {target.sha}\n" + (f"Decision: {card}\n" if card else "") + \
                  (f"Ticket: {ticket.id}\n" if ticket else "")
            new = await self.git.commit_tree(tree, [head], msg)
            return await self.publish_revert(new, head, ts, target, card=card, why=why, ticket=ticket)

    def park(self, ts: TaskState, *, behind: str, ctx: dict) -> None:
        ts.status, ts.agent = "parked", None
        self.ctx[ts.id] = ctx
        self.parked_behind.setdefault(behind, []).append(ts.id)
        self.log("task.park", task=ts.id, behind=behind, card=ctx.get("card"), reason=ctx["reason"])

    def requeue(self, ts: TaskState, ctx: dict | None = None) -> None:
        if ctx is not None:
            self.ctx[ts.id] = ctx
        if ts in self.unstarted or ts.status in ("running", "rework", "dropped"):
            return
        ts.status, ts.agent = "pending", None
        self.unstarted.append(ts)
        self.stats["requeued"] += 1
        c = self.ctx.get(ts.id, {})
        self.log("task.requeue", task=ts.id, reason=c.get("reason"), card=c.get("card"))
        self.poke()

    def on_landed(self, ts: TaskState) -> None:
        for lid in self.parked_behind.pop(ts.id, []):
            self.requeue(self.by_id[lid])

    def drop(self, ts: TaskState, reason: str) -> None:
        super().drop(ts, reason)
        for path, (loser, _, previous) in (self.carried.pop(ts.id, None) or {}).items():
            self.by_id[loser].task.acceptance_tests[path] = previous  # the winner never landed: undo the amendment
            self.log("spec.amend.rollback", task=loser, path=path, winner=ts.id)
        for lid in self.parked_behind.pop(ts.id, []):
            loser = self.by_id[lid]
            d = self.by_card.get(self.ctx.get(lid, {}).get("card") or "")
            if d is not None:
                d.status = "moot"
            self.requeue(loser, {"reason": "winner-dropped", "card": None})

    # ---- a red validation: revert-first, then re-execute (never drop) --------------------------------------------

    async def revert_culprit(self, t) -> None:
        assert self.git
        try:
            idx = await self.first_bad(self.green_idx, t.red_idx, t.failing_files, t.id) \
                if t.red_idx > self.green_idx else -1
            target = self.commits[idx] if idx > self.green_idx else None
            if target is None or target.reverted or target.kind == "revert":
                target = await self.leave_one_out(t)
            if t.status != "reverting":
                return
            if target is None or target.reverted or target.kind != "task" or not target.task_id:
                t.status = "escalated"
                self.log("ticket.stuck", ticket=t.id, culprit_idx=idx)
                return
            culprit = self.by_id[target.task_id]
            self.log("ticket.culprit", ticket=t.id, trunk_idx=target.idx, task=culprit.id, kind=target.kind)
            failing = set(t.failing_files)
            partner = next((p for p in self.known_partners(culprit.id) if self.live_commit(p) and failing &
                            (set(self.by_id[p].task.acceptance_tests) | set(culprit.task.acceptance_tests))), None)
            d, loser = None, culprit
            if partner:
                d = self.decision_for(culprit.id, partner)
                if d is None:
                    a, b = sorted((culprit.id, partner), key=lambda x: self.live_commit(x).idx)  # type: ignore[union-attr]
                    red = CIResult(ci_id=t.id, sha=t.red_sha, purpose="validate", green=False,
                                   failing_files=list(t.failing_files),
                                   failing_tests=[{"file": f.split(" > ")[0], "name": f.split(" > ")[-1]}
                                                  for f in t.failing_tests], output=t.output)
                    d = await self.raise_card(arriving=self.by_id[b], landed=self.by_id[a], trigger="validation",
                                              red=red)
                if self.live_commit(d.loser):
                    loser = self.by_id[d.loser]
            if t.status != "reverting":
                return
            ridx = await self.revert_task(loser, why=f"red validation {t.id}", card=d.card if d else None, ticket=t)
            if ridx is None and loser is not culprit:
                loser = culprit
                ridx = await self.revert_task(loser, why=f"red validation {t.id}", card=d.card if d else None,
                                              ticket=t)
            extra = [f"Failing tests on the trunk: {', '.join(t.failing_tests[:10])}"]
            if ridx is None:  # cannot revert: the culprit's own task repairs in place, on the red head
                t.status = "escalated"
                if loser.status in ("landed", "green"):
                    self.stats["reexec_requested_repair"] = self.stats.get("reexec_requested_repair", 0) + 1
                    loser.status = "parked"
                    if d is not None:
                        d.applied.append({"task": loser.id, "at": "validation", "how": "repair in place",
                                          "t": round(self.now(), 3)})
                    self.requeue(loser, {"reason": "repair", "card": d.card if d else None, "extra": extra})
                return
            t.status, t.revert_idx = "reverted", ridx
            if d is not None:
                d.applied.append({"task": loser.id, "at": "validation", "how": "revert", "t": round(self.now(), 3)})
                d.status = "applied"
            reason = ("keep-landed" if d.loser == loser.id and d.outcome == "keep-landed" else "adopt-arriving") \
                if d is not None and d.loser == loser.id else "revert"
            self.requeue(loser, {"reason": reason, "card": d.card if d else None, "extra": extra,
                                 "failing": list(t.failing_tests), "output": t.output[:3000]})
        finally:
            self.flows -= 1
            self.poke()

    # ---- final check: effective (amended) and canonical acceptance ---------------------------------------------

    async def final_check(self) -> dict:
        assert self.git and self.ci
        sha = self.final_green_sha()
        suite: CIResult = await self.run_ci(sha, "final", latency=0, meta={"check": "suite"})
        eff, can = {}, {}
        for ts in self.tasks:
            eff.update(ts.task.acceptance_tests)
            can.update(self.canonical[ts.id])
        acc = await self.run_ci(sha, "final", latency=0, extra_files=eff, meta={"check": "acceptance"})
        acc_can = await self.run_ci(sha, "final", latency=0, extra_files=can, meta={"check": "acceptance-canonical"})

        def passes(paths: set[str], r: CIResult) -> bool:
            return bool(paths) and r.failing_files is not None and paths <= set(r.passing_files) \
                and not (paths & set(r.failing_files))
        per_task = {}
        for ts in self.tasks:
            committed_ok = True
            if ts.landed_sha:
                for p, content in ts.task.acceptance_tests.items():
                    r = await self.git.run("show", f"{sha}:{p}", check=False)
                    if r.returncode != 0 or r.stdout != content:
                        committed_ok = False
            per_task[ts.id] = {"acceptance_pass": passes(set(ts.task.acceptance_tests), acc),
                               "canonical_pass": passes(set(self.canonical[ts.id]), acc_can),
                               "amended": ts.id in self.amended, "status": ts.status,
                               "committed_tests_intact": committed_ok}
        green = [t for t in self.tasks if t.status == "green"]
        canon_fail = [t.id for t in green if not per_task[t.id]["canonical_pass"]]
        explained = [x for x in canon_fail if x in self.amended]
        acceptance = {p for t in self.tasks for p in self.canonical[t.id]}
        from .arena import classify
        changed = await self.git.changed_files(self.base_sha, sha)
        base_tests_changed = sorted(p for p in changed if p in self.repo_files and p not in acceptance
                                    and classify(p) == "test")
        return {
            "sha": sha, "suite_green": suite.green, "suite_tests": suite.tests, "suite_failures": suite.failures,
            "acceptance_run_green": acc.green,
            "tasks_accepted": sum(1 for v in per_task.values() if v["acceptance_pass"]),
            "tasks_accepted_canonical": sum(1 for v in per_task.values() if v["canonical_pass"]),
            "tasks_total": len(self.tasks),
            "green_tasks_accepted": sum(1 for t in green if per_task[t.id]["acceptance_pass"]),
            "green_tasks_accepted_canonical": sum(1 for t in green if per_task[t.id]["canonical_pass"]),
            "green_tasks": len(green),
            "correct": suite.green and all(per_task[t.id]["acceptance_pass"] for t in green),
            "correct_canonical": suite.green and all(per_task[t.id]["canonical_pass"] for t in green),
            "canonical_failures": canon_fail, "canonical_failures_explained": explained,
            "canonical_failures_unexplained": [x for x in canon_fail if x not in explained],
            "amended_tasks": sorted(self.amended),
            "committed_tests_intact": all(v["committed_tests_intact"] for v in per_task.values()),
            "all_tasks_accepted": acc.green and all(v["acceptance_pass"] for v in per_task.values()),
            "failing_files": sorted(set(acc.failing_files or []))[:50],
            "base_tests_changed": base_tests_changed,
            "per_task": per_task,
        }

    # ---- records and summary -------------------------------------------------------------------------------------

    def write_decisions(self) -> None:
        try:
            with open(os.path.join(self.out, "decisions.jsonl"), "w", encoding="utf-8") as fh:
                for d in sorted(self.by_card.values(), key=lambda x: x.card):
                    fh.write(json.dumps(d.record(), default=str) + "\n")
        except OSError:
            pass

    def policy_summary(self) -> dict:
        out = super().policy_summary()
        st = out["beanstalk"]
        st["variant"] = "e6"
        for k in ("cards_by_trigger", "cards_by_outcome", "reexec", "reexec_cost"):
            st[k] = {kk: (round(v, 4) if isinstance(v, float) else v) for kk, v in dict(st[k]).items()}
        st["author_cost"] = round(st["author_cost"], 4)
        st["card_wait_seconds"] = round(st["card_wait_seconds"], 2)
        losers = sorted({d.loser for d in self.by_card.values() if d.loser})
        st["losers"] = {tid: self.by_id[tid].status for tid in losers}
        st["losers_shipped"] = sum(1 for tid in losers if self.by_id[tid].status == "green")
        st["amended_tasks"] = {tid: v for tid, v in sorted(self.amended.items())}
        st["rescued"] = sorted(self.rescued)
        st["e6_config"] = self.e6_config()
        out["decisions"] = [d.record() for d in sorted(self.by_card.values(), key=lambda x: x.card)]
        rows = [("Variant", "e6: v2 + decision outcomes (loser re-executed), spec amendments, earlier cards, rescue"),
                ("Decision mode / oracle / CARD_AFTER / CARD_AFTER_KNOWN / prior",
                 f"{self.mode} / {self.oracle} / {self.card_after} / {self.card_after_known} / {self.prior}"),
                ("Decision cards (by trigger / by outcome)",
                 f"{st['cards']} ({st['cards_by_trigger']} / {st['cards_by_outcome']})"),
                ("Losers shipped / losers", f"{st['losers_shipped']} / {len(losers)} {st['losers']}"),
                ("Spec amendments (accepted / none needed / rejected)",
                 f"{st['amendments']} / {st['amendments_none']} / {st['amendments_rejected']}"),
                ("Re-executions by reason (cost USD)", f"{st['reexec']} ({st['reexec_cost']})"),
                ("Test-author cost USD / fail-first runs", f"{st['author_cost']} / {st['failfirst_runs']}"),
                ("Decision reverts / revert conflicts / requeued / partner re-checks",
                 f"{st['decision_reverts']} / {st['revert_conflicts']} / {st['requeued']} / {st['partner_rechecks']}")]
        out["policy_rows"] = rows + [r for r in out["policy_rows"] if r[0] != "Variant"]
        return out
