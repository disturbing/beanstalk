"""E1: beanstalk v2 when agents are not given acceptance tests (docs/claude-opus/exp/e1-tests-first.md).

Same policy as ``policy_beanstalk_v2`` (pre-land check on the merged tree, informed author repair, decision
cards, revert-first, optimistic landing). What changes is where each task's tests come from:

``--tests self``   The agent gets the issue prompt only and is asked to cover its change with its own tests.
                   The arena's acceptance tests are hidden: they are removed from the tasks before any agent
                   runs, stripped from the run's arena snapshot (with the reference solutions) and used only by
                   the final oracle. When a bean lands, the test files it added become its acceptance tests, so
                   ``--protect-tests landed`` protects them and v2's culprit search finds their owner, exactly as
                   for given tests.
``--tests first``  Tests-first. Before the implementer starts, a separate test-author session (fresh, on the
                   same agent slot, inside the race clock) writes tests from the issue text alone, in its own
                   worktree at the task's snapshot. The harness keeps only new test files (other edits are
                   reverted), runs each on that snapshot and accepts it only if it fails first: it loads, at
                   least one test fails, and a load failure is a missing module or export that the issue names
                   (not a syntax error, a missing package or a helper the author would have had to add). The
                   proof costs ``PROOF_SECONDS`` of emulated latency (default 10). A rejected proof goes back to
                   the same author session with the reasons, up to ``AUTHOR_ATTEMPTS`` sessions in all (default
                   2); after that the task is dropped (a human card, in a service). Accepted files are the
                   task's protected acceptance tests, written into the implementer's worktree as given tests are.
                   The pre-land check is green only when the suite is green AND each of the bean's acceptance
                   files ran with a passing test on the merged tree.

``E1_MERGED_CHECK=targeted`` (arm c′, with ``--tests first``): v2's optimistic landing lands a bean on a moved
                   trunk without re-checking when the commits that landed meanwhile share no file with it. Here
                   that shortcut instead re-runs the bean's own acceptance tests and every test file that landed
                   since its check on the exact tree that will land (``MERGED_SECONDS`` of emulated latency,
                   default 10, outside the committer lock); a red result is an ordinary red pre-land check.
                   Without it, "the bean's tests pass on the merged tree" holds only for the tree that was
                   checked (arm c), and in E1 that gap let three semantic breaks onto the sprout.

Replay agents (free, for checking the mechanics): the bean's or the author's tests are the hidden arena tests,
renamed (``.self.test.ts`` / ``.author.test.ts``); tasks listed in ``E1_REPLAY_VACUOUS`` get a test that proves
nothing instead, to exercise the vacuous paths.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import shutil
import uuid

from . import prompts
from .agents import InvocationSpec
from .ci import CIResult
from .core import AgentSlot, TaskState
from .e1_tests import VACUOUS_TEST, is_test_file, judge_proof, junit_cases
from .policy_beanstalk_v2 import BeanstalkV2Race


class BeanstalkE1Race(BeanstalkV2Race):
    policy = "beanstalk"
    variant = "v2-e1"

    def __init__(self, cfg):
        super().__init__(cfg)
        self.tests_mode = cfg.tests
        self.hidden_tests: dict[str, dict[str, str]] = {}   # hidden arena acceptance tests, in memory only
        # (named apart from v2's decision-oracle mode attribute, which a clash once overwrote)
        self.proof_seconds = float(os.environ.get("PROOF_SECONDS", "10") or 0)
        self.author_attempts = max(1, int(os.environ.get("AUTHOR_ATTEMPTS", "2") or 2))
        self.replay_vacuous = {x.strip() for x in os.environ.get("E1_REPLAY_VACUOUS", "").split(",") if x.strip()}
        self.testsfirst_dir = os.path.join(self.out, "testsfirst")
        self.merged_check = os.environ.get("E1_MERGED_CHECK", "") == "targeted"
        self.merged_seconds = float(os.environ.get("MERGED_SECONDS", "10") or 0)
        self.stats.update({"e1_tests": self.tests_mode, "e1_proof_seconds": self.proof_seconds,
                           "e1_author_attempts": self.author_attempts, "e1_author_sessions": 0, "e1_proofs": 0,
                           "e1_proofs_rejected": 0, "e1_author_drops": 0, "e1_files_accepted": 0,
                           "e1_files_vacuous": 0, "e1_files_broken": 0, "e1_author_edits_reverted": 0,
                           "e1_author_files_removed": 0, "e1_bean_tests_missing": 0, "e1_beans_with_new_tests": 0,
                           "e1_beans_without_new_tests": 0, "e1_proof_details": [],
                           "e1_merged_check": "targeted" if self.merged_check else "off",
                           "e1_merged_seconds_latency": self.merged_seconds if self.merged_check else None,
                           "e1_merged_checks": 0, "e1_merged_red": 0, "e1_merged_seconds": 0.0,
                           "e1_merged_landings": 0})

    # ---- hide the arena's acceptance tests ------------------------------------------------------------------

    async def setup(self) -> None:
        await super().setup()
        for ts in self.tasks:
            self.hidden_tests[ts.id] = dict(ts.task.acceptance_tests)
            ts.task.acceptance_tests = {}
            if self.cfg.agent != "replay":  # real agents never need the reference solutions
                ts.task.solution = ts.task.fix_patch = None
        self.strip_snapshot()
        if self.tests_mode == "first":
            os.makedirs(self.testsfirst_dir, exist_ok=True)
        self.log("e1.setup", tests=self.tests_mode, merged_check=self.stats["e1_merged_check"],
                 merged_seconds=self.merged_seconds, hidden_test_files=sum(len(v) for v in self.hidden_tests.values()),
                 proof_seconds=self.proof_seconds, author_attempts=self.author_attempts,
                 replay_vacuous=sorted(self.replay_vacuous))

    def strip_snapshot(self) -> None:
        """The run's frozen arena copy keeps titles and prompts only: no acceptance tests (and, for real
        agents, no reference solutions), so nothing under work/ can reveal the oracle."""
        tdir = os.path.join(self.arena_snapshot, "tasks")
        for name in sorted(os.listdir(tdir)):
            if not name.endswith(".json"):
                continue
            path = os.path.join(tdir, name)
            with open(path, encoding="utf-8") as fh:
                raw = json.load(fh)
            raw.pop("acceptance_tests", None)
            raw["oracle_paths"] = [p for p in raw.get("oracle_paths", []) if not is_test_file(p)]
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(raw, fh, indent=1)
        if self.cfg.agent != "replay":
            shutil.rmtree(os.path.join(self.arena_snapshot, "solutions"), ignore_errors=True)

    # ---- task start: tests-first author, or replay's own tests ---------------------------------------------

    async def run_initial(self, ts: TaskState, agent: AgentSlot, base: str) -> bool:
        if self.tests_mode == "first":
            ts.status, ts.agent, ts.base_sha = "running", agent.id, base
            ts.started_at = ts.started_at if ts.started_at is not None else self.now()
            if not await self.author_tests(ts, agent, base):
                return False
        return await super().run_initial(ts, agent, base)

    async def open_task_worktree(self, ts: TaskState, base: str) -> None:
        await super().open_task_worktree(ts, base)
        if self.tests_mode == "self" and self.cfg.agent == "replay":
            self.write_replay_tests(ts, ts.worktree or "", ".self")

    def write_replay_tests(self, ts: TaskState, wt: str, tag: str, vacuous: bool | None = None) -> list[str]:
        vacuous = ts.id in self.replay_vacuous if vacuous is None else vacuous
        written = []
        for path, content in sorted(self.hidden_tests.get(ts.id, {}).items()):
            exists = os.path.exists(os.path.join(wt, path))
            if vacuous and exists:
                continue
            target = path if exists else re.sub(r"\.test\.ts$", f"{tag}.test.ts", path)
            full = os.path.join(wt, target)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "w", encoding="utf-8") as fh:
                fh.write(VACUOUS_TEST if vacuous else content)
            written.append(target)
        return written

    async def author_tests(self, ts: TaskState, agent: AgentSlot, base: str) -> bool:
        """Tests-first: a separate session writes the task's acceptance tests; the harness proves they fail first."""
        assert self.git
        wt = os.path.join(self.work, "agents", f"{ts.id}-tests")
        await self.git.add_worktree(wt, base, f"tests/{ts.id}")
        self.log("testsfirst.start", task=ts.id, agent=agent.id, base=base)
        session: str | None = None
        problems: list[str] = []
        attempt = infra = 0
        while True:
            attempt += 1
            resumed = bool(session and self.adapter_resumable(session))
            prompt = prompts.test_author(ts.task) if attempt == 1 else \
                prompts.test_author_retry(ts.task, problems, resumed)
            spec = InvocationSpec(inv_id=self.new_inv_id("testauthor"), kind="testauthor", task_id=ts.id,
                                  agent_id=agent.id, cwd=wt, prompt=prompt, attempt=attempt,
                                  resume_session=session if resumed else None)
            res = await self.invoke(spec, agent)
            ts.invocations.append(spec.inv_id)
            self.stats["e1_author_sessions"] += 1
            if res.infra_error:
                infra += 1
                if infra > 2:
                    self.drop(ts, f"test author failed to run: {res.infra_error[:200]}")
                    return False
                self.log("invocation.retry", task=ts.id, reason=res.infra_error[:300])
                await asyncio.sleep(min(60.0, self.cfg.infra_retry_seconds * infra))
                attempt -= 1
                continue
            if res.session_id:
                session = res.session_id
            if self.cfg.agent == "replay":
                self.write_replay_tests(ts, wt, ".author", vacuous=ts.id in self.replay_vacuous)
            kept, created_other, reverted = await self.collect_new_tests(wt)
            proof = await self.prove(ts, wt, kept, created_other)
            self.stats["e1_proofs"] += 1
            self.stats["e1_author_edits_reverted"] += len(reverted)
            self.stats["e1_author_files_removed"] += len(created_other)
            saved = self.save_author_files(ts, wt, attempt, proof)
            self.log("testsfirst.proof", task=ts.id, attempt=attempt, ok=proof["ok"], accepted=proof["accepted"],
                     verdicts={p: {k: v for k, v in r.items() if k != "cases"} for p, r in proof["results"].items()},
                     reverted=reverted, removed=created_other, saved=saved, inv=spec.inv_id)
            self.stats["e1_proof_details"].append({"task": ts.id, "attempt": attempt, "ok": proof["ok"],
                                                   "verdicts": {p: r["status"] for p, r in proof["results"].items()},
                                                   "reverted": len(reverted), "removed": len(created_other)})
            if proof["ok"]:
                ts.task.acceptance_tests = await self.claim_paths(ts, {p: proof["content"][p] for p in proof["accepted"]})
                self.stats["e1_files_accepted"] += len(proof["accepted"])
                await self.git.remove_worktree(wt)
                return True
            self.stats["e1_proofs_rejected"] += 1
            problems = proof["problems"] + ([f"Edits to existing files were discarded: {', '.join(reverted)}."]
                                            if reverted else [])
            if attempt >= self.author_attempts:
                self.stats["e1_author_drops"] += 1
                await self.git.remove_worktree(wt)
                self.drop(ts, f"tests-first: no fail-first proof after {attempt} author sessions")
                return False

    async def claim_paths(self, ts: TaskState, files: dict[str, str]) -> dict[str, str]:
        """The forge owns accepted tests per task: a path another task's acceptance tests already use, or that the
        trunk now holds, is renamed within its directory (``x.test.ts`` -> ``x.<task>.test.ts``; relative imports
        stay valid), so two tasks never protect the same file. Saves the final files and logs the mapping."""
        assert self.git
        taken = {p for o in self.tasks if o is not ts for p in o.task.acceptance_tests}
        trunk_files = set((await self.git.out("ls-tree", "-r", "--name-only", self.trunk)).splitlines())
        out, renamed = {}, {}
        for path, text in sorted(files.items()):
            final = path
            if path in taken or path in trunk_files:
                final = re.sub(r"(\.|-|_)?test\.((c|m)?[jt]s)$", lambda m: f".{ts.id}.test.{m.group(2)}", path)
                renamed[path] = final
            out[final] = text
            dest = os.path.join(self.testsfirst_dir, ts.id, "accepted", final)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "w", encoding="utf-8") as fh:
                fh.write(text)
        self.stats["e1_paths_renamed"] = self.stats.get("e1_paths_renamed", 0) + len(renamed)
        self.log("testsfirst.accepted", task=ts.id, files=sorted(out), renamed=renamed)
        return out

    def adapter_resumable(self, session: str) -> bool:
        ad = self.adapter
        return bool(self.cfg.rework_resume and hasattr(ad, "resumable") and ad.resumable(session))  # type: ignore[attr-defined]

    async def collect_new_tests(self, wt: str) -> tuple[list[str], list[str], list[str]]:
        """Keep only new test files in the author's worktree: revert edits to tracked files and remove any
        other new file. Returns (kept test files, removed other files, reverted tracked files)."""
        assert self.git
        out = await self.git.out("status", "--porcelain", "-z", "--untracked-files=all", cwd=wt)
        parts = [p for p in out.split("\0") if p]
        entries, i = [], 0
        while i < len(parts):
            code, path = parts[i][:2], parts[i][3:]
            entries.append((code, path))
            i += 2 if code[0] in "RC" else 1
        kept, removed, reverted = [], [], []
        for code, path in entries:
            if code == "??":
                if is_test_file(path):
                    kept.append(path)
                else:
                    removed.append(path)
                    try:
                        os.remove(os.path.join(wt, path))
                    except OSError:
                        pass
            else:
                reverted.append(path)
        if reverted:
            await self.git.run("reset", "-q", cwd=wt, check=False)
            await self.git.run("checkout", "-q", "HEAD", "--", *reverted, cwd=wt, check=False)
        return sorted(kept), sorted(removed), sorted(reverted)

    async def run_test_file(self, root: str, path: str) -> dict:
        """``node --test <path>`` in ``root`` with the spec and junit reporters."""
        assert self.runner
        rdir = os.path.join(self.work, "proof")
        os.makedirs(rdir, exist_ok=True)
        junit = os.path.join(rdir, f"{uuid.uuid4().hex}.xml")
        env = {k: v for k, v in os.environ.items() if not k.startswith(("NODE_OPTIONS", "NODE_TEST"))}
        env["CI"] = "1"
        argv = ["node", "--test", "--test-timeout=60000", "--test-reporter=spec", "--test-reporter-destination=stdout",
                "--test-reporter=junit", f"--test-reporter-destination={junit}", path]
        pr = await self.runner.run(argv, root, env=env, timeout=120)
        cases = junit_cases(junit, root)
        try:
            os.remove(junit)
        except OSError:
            pass
        return {"cases": cases, "output": (pr.stdout + "\n" + pr.stderr)[-6000:], "timed_out": pr.timed_out,
                "seconds": pr.seconds}

    async def prove(self, ts: TaskState, wt: str, kept: list[str], created_other: list[str]) -> dict:
        """Run each kept file on the snapshot (the worktree now holds the snapshot plus the new test files)."""
        issue = f"{ts.task.title}\n{ts.task.prompt}"
        results: dict[str, dict] = {}
        content: dict[str, str] = {}
        for path in kept:
            with open(os.path.join(wt, path), encoding="utf-8", errors="replace") as fh:
                content[path] = fh.read()
            r = await self.run_test_file(wt, path)
            status, why = judge_proof(path, r["cases"], r["output"], wt, issue, created_other, r["timed_out"])
            cases = r["cases"] or []
            results[path] = {"status": status, "why": why, "tests": len(cases),
                             "failing": sum(1 for c in cases if c["status"] == "fail"),
                             "passing": sum(1 for c in cases if c["status"] == "pass"),
                             "skipped": sum(1 for c in cases if c["status"] == "skip"), "cases": cases}
            if status == "vacuous":
                self.stats["e1_files_vacuous"] += 1
            elif status == "broken":
                self.stats["e1_files_broken"] += 1
        if self.proof_seconds > 0:
            await asyncio.sleep(self.proof_seconds)
        self.stats["e1_proof_seconds_total"] = self.stats.get("e1_proof_seconds_total", 0.0) + self.proof_seconds
        accepted = [p for p, r in results.items() if r["status"] == "fails-first"]
        problems = [f"{p}: {r['why']}" for p, r in results.items() if r["status"] != "fails-first"]
        if not kept:
            problems.append("no new test file was found (only new `*.test.ts` files are kept)")
        return {"ok": bool(accepted), "accepted": accepted, "results": results, "problems": problems,
                "content": content}

    def save_author_files(self, ts: TaskState, wt: str, attempt: int, proof: dict) -> dict:
        """Keep every author file (accepted or not) under <out>/testsfirst/<task>/<attempt>/ for the analysis."""
        saved = {}
        for path, text in proof["content"].items():
            dest = os.path.join(self.testsfirst_dir, ts.id, str(attempt), path)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "w", encoding="utf-8") as fh:
                fh.write(text)
            saved[path] = hashlib.sha256(text.encode()).hexdigest()[:16]
        with open(os.path.join(self.testsfirst_dir, ts.id, f"proof-{attempt}.json"), "w", encoding="utf-8") as fh:
            json.dump({"task": ts.id, "attempt": attempt, "ok": proof["ok"], "accepted": proof["accepted"],
                       "results": proof["results"], "problems": proof["problems"]}, fh, indent=1)
        return saved

    # ---- pre-land: the bean's own acceptance tests must run and pass on the merged tree --------------------

    async def preland_check(self, sha: str, ts: TaskState) -> CIResult:
        res = await super().preland_check(sha, ts)
        if self.tests_mode == "first" and res.green and ts.task.acceptance_tests:
            passing = set(res.passing_files)
            missing = sorted(p for p in ts.task.acceptance_tests if p not in passing)
            if missing:
                res.green = False
                res.failing_files = missing
                res.failing_tests = [{"file": p, "name": "the acceptance test file ran no passing test", "message": ""}
                                     for p in missing]
                self.stats["preland_red"] += 1
                self.stats["e1_bean_tests_missing"] += 1
                self.log("preland.bean_tests", task=ts.id, sha=sha, missing=missing)
        return res

    # ---- E1_MERGED_CHECK=targeted: the bean's tests, and the tests that landed meanwhile, on the exact landing tree --

    async def try_optimistic(self, change_head: str, ts: TaskState, kind: str):
        """Like the parent, except that a moved trunk with no file overlap no longer lands unchecked: the bean's
        own acceptance tests and every test file that landed since its check run on the exact tree that will land
        (outside the committer lock, ``MERGED_SECONDS`` of emulated latency); the bean lands only if the trunk is
        still that head, otherwise the round repeats against the newer head (5 rounds, then a full re-check)."""
        if not self.merged_check:
            return await super().try_optimistic(change_head, ts, kind)
        assert self.git
        msg = self.land_message(kind, ts, None)
        rechecks = 0
        while True:
            head0 = self.trunk
            mb = await self.git.merge_base(change_head, head0)
            new0, conflicts = await self.git.squash_onto(head0, change_head, mb, msg)
            if new0 is None:
                return "conflict", head0, None, conflicts, None
            if rechecks >= 3:  # heavy churn: full check inside the lock, as the parent does
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
            mine = set(await self.git.changed_files(mb, change_head))
            checked_on, tree, overlap = head0, new0, False
            for _ in range(5):
                async with self.committer:
                    head = self.trunk
                    if head == checked_on:
                        if checked_on != head0:
                            self.stats["e1_merged_landings"] += 1
                        return "landed", head, await self.publish(tree, head, kind, ts), [], None
                    mb2 = await self.git.merge_base(change_head, head)
                    new, conflicts = await self.git.squash_onto(head, change_head, mb2, msg)
                    if new is None:
                        return "conflict", head, None, conflicts, None
                    delta = set(await self.git.changed_files(checked_on, head))
                if delta & mine:
                    overlap = True
                    break
                targets = sorted({p for p in delta if is_test_file(p)} | set(ts.task.acceptance_tests))
                tres = await self.merged_check_run(new, targets, ts, checked_on, head)
                if not tres.green:
                    return "red", head, new, [], tres
                checked_on, tree = head, new
            rechecks += 1
            self.stats["preland_rechecks"] += 1
            self.log("preland.recheck", task=ts.id, checked_on=checked_on, head=self.trunk, attempt=rechecks,
                     overlap=overlap)

    async def merged_check_run(self, sha: str, targets: list[str], ts: TaskState, checked_on: str,
                               head: str) -> CIResult:
        assert self.preland_ci
        if not targets:
            return CIResult(ci_id="-", sha=sha, purpose="merged", green=True, failing_files=[])
        res = await self.preland_ci.run(sha, "merged", only=targets, latency=self.merged_seconds)
        self.stats["e1_merged_checks"] += 1
        self.stats["e1_merged_seconds"] += res.ci_seconds
        if not res.green:
            self.stats["e1_merged_red"] += 1
        self.log("preland.merged", task=ts.id, sha=sha, checked_on=checked_on, head=head, targets=targets,
                 green=res.green, failing_files=res.failing_files,
                 failing_tests=[f"{t['file']} > {t['name']}" for t in res.failing_tests][:20],
                 suite_seconds=round(res.suite_seconds, 3), check_seconds=round(res.ci_seconds, 3))
        return res

    # ---- landing: in --tests self the bean's new test files become its acceptance tests --------------------

    async def publish(self, new: str, head: str, kind: str, ts: TaskState) -> int:
        idx = await super().publish(new, head, kind, ts)
        if self.tests_mode == "self":
            assert self.git
            out = await self.git.out("diff", "--name-status", "--no-renames", "-z", head, new)
            parts = [p for p in out.split("\0") if p]
            added, modified = [], []
            for i in range(0, len(parts) - 1, 2):
                status, path = parts[i], parts[i + 1]
                if is_test_file(path):
                    (added if status.startswith("A") else modified).append(path)
            ts.task.acceptance_tests = {p: await self.git.out("show", f"{new}:{p}") for p in sorted(added)}
            self.stats["e1_beans_with_new_tests" if added else "e1_beans_without_new_tests"] += 1
            self.log("e1.selftests", task=ts.id, sha=new, added=sorted(added), modified=sorted(modified))
        return idx

    # ---- the final oracle: the hidden arena acceptance tests --------------------------------------------------

    async def final_check(self) -> dict:
        """Full suite on the final green (it holds the beans' own tests), then every hidden arena acceptance
        test laid over it: a green task is correct only if its hidden tests pass there."""
        assert self.git and self.ci
        sha = self.final_green_sha()
        suite: CIResult = await self.run_ci(sha, "final", latency=0, meta={"check": "suite"})
        extra: dict[str, str] = {}
        for tid in sorted(self.hidden_tests):
            extra.update(self.hidden_tests[tid])
        acc: CIResult = await self.run_ci(sha, "final", latency=0, extra_files=extra, meta={"check": "oracle"})
        failing, passing = set(acc.failing_files or []), set(acc.passing_files)
        per_task = {}
        for ts in self.tasks:
            paths = set(self.hidden_tests.get(ts.id, {}))
            ok = bool(paths) and paths <= passing and not (paths & failing) and acc.failing_files is not None
            own_ok = True
            if ts.landed_sha and ts.status != "dropped":
                for p, content in ts.task.acceptance_tests.items():
                    r = await self.git.run("show", f"{sha}:{p}", check=False)
                    if r.returncode != 0 or r.stdout != content:
                        own_ok = False
            per_task[ts.id] = {"acceptance_pass": ok, "status": ts.status, "committed_tests_intact": own_ok,
                               "own_tests": sorted(ts.task.acceptance_tests)}
        green = [t for t in self.tasks if t.status == "green"]
        changed = await self.git.changed_files(self.base_sha, sha)
        hidden = {p for v in self.hidden_tests.values() for p in v}
        return {
            "oracle": "hidden arena acceptance tests", "sha": sha, "suite_green": suite.green,
            "suite_tests": suite.tests, "suite_failures": suite.failures, "acceptance_run_green": acc.green,
            "tasks_accepted": sum(1 for v in per_task.values() if v["acceptance_pass"]),
            "tasks_total": len(self.tasks),
            "green_tasks_accepted": sum(1 for t in green if per_task[t.id]["acceptance_pass"]),
            "green_tasks": len(green),
            "green_tasks_failing_oracle": sorted(t.id for t in green if not per_task[t.id]["acceptance_pass"]),
            "correct": suite.green and all(per_task[t.id]["acceptance_pass"] for t in green),
            "all_tasks_accepted": acc.green and all(v["acceptance_pass"] for v in per_task.values()),
            "failing_files": sorted(failing)[:60],
            "base_tests_changed": sorted(p for p in changed if p in self.repo_files and p not in hidden
                                         and is_test_file(p)),
            "per_task": per_task,
        }

    def policy_summary(self) -> dict:
        out = super().policy_summary()
        st = out["beanstalk"]
        st["variant"] = f"v2-e1-{self.tests_mode}"
        rows = [("Variant", f"v2, tests {self.tests_mode}: " + (
            "agents write their own tests; arena tests hidden (oracle only)" if self.tests_mode == "self" else
            "separate test author, fail-first proof, protected tests; arena tests hidden (oracle only)"))]
        if self.tests_mode == "self":
            rows.append(("Landed beans with / without new test files",
                         f"{st['e1_beans_with_new_tests']} / {st['e1_beans_without_new_tests']}"))
        else:
            rows += [("Test-author sessions / proofs (rejected) / author drops",
                      f"{st['e1_author_sessions']} / {st['e1_proofs']} ({st['e1_proofs_rejected']}) / "
                      f"{st['e1_author_drops']}"),
                     ("Author files accepted / vacuous / broken; edits reverted / files removed",
                      f"{st['e1_files_accepted']} / {st['e1_files_vacuous']} / {st['e1_files_broken']}; "
                      f"{st['e1_author_edits_reverted']} / {st['e1_author_files_removed']}"),
                     ("Pre-land reds for missing bean tests", st["e1_bean_tests_missing"]),
                     ("Merged-tree checks (E1_MERGED_CHECK): mode / checks (red) / landings after one / minutes",
                      f"{st['e1_merged_check']} / {st['e1_merged_checks']} ({st['e1_merged_red']}) / "
                      f"{st['e1_merged_landings']} / {round(st['e1_merged_seconds'] / 60, 2)}")]
        out["policy_rows"] = rows + [r for r in out["policy_rows"] if r[0] != "Variant"]
        return out
