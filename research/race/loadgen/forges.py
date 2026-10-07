"""The two forges behind one interface, both driven with plain git plus the forge's own API.

``Forge.submit(tid, sha, attempt)`` pushes a change and returns when the forge has decided: ``integrated`` (GitHub:
merged to ``main`` by the merge queue; Beanstalk: landed on the sprout), ``red``, ``conflict`` or ``dropped``. The
stable line's time (Beanstalk's stalk; GitHub's ``main`` is both) comes from ``stable_at``.

GitHub reuses the race's GitHub plumbing (``harness/github.py`` client and limiter, ``harness/forge_github.py`` repo
setup, base commit and workflow); its outcome rules are the GitHub arm's (``GitHubRace.kickout``): merged, removed
from the queue (``merge_conflict`` / ``failed_checks``), a red PR check, or ``CONFLICTING`` on two polls in a row. A
PR is enqueued with ``enqueuePullRequest`` as soon as its own check is green (the arm's ``--gh-enqueue direct``).
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from dataclasses import dataclass, field

from harness.forge_github import GitHubOptions, github_base, prepare_github_repo, _span
from harness.github import GhClient, GitHubError, Limiter, ruleset_body
from harness.gitops import Git, GitError


@dataclass
class Outcome:
    kind: str                       # integrated | red | conflict | dropped
    at: float                       # epoch seconds: when the forge decided
    sha: str | None = None          # integrated: the commit on the line
    reason: str = ""
    failing: list[str] = field(default_factory=list)
    files: list[str] = field(default_factory=list)
    detail: dict = field(default_factory=dict)


class Forge:
    name = "?"
    policy = "?"
    line = "main"

    async def setup(self, base_sha: str) -> str: ...
    async def line_head(self, force: bool = False) -> str: ...
    async def submit(self, tid: str, sha: str, attempt: int, title: str) -> Outcome: ...
    def stable_at(self, tid: str) -> float | None: ...
    async def finish(self) -> dict: ...
    async def final_sha(self) -> str: ...


class LineCache:
    """One fetch of the line at a time; a fetch newer than ``fresh`` seconds is reused."""

    def __init__(self, fetch, fresh: float = 1.0):
        self.fetch, self.fresh = fetch, fresh
        self.lock = asyncio.Lock()
        self.at = 0.0
        self.sha = ""

    async def get(self, force: bool = False) -> str:
        async with self.lock:
            if force or not self.sha or time.monotonic() - self.at > self.fresh:
                self.sha = await self.fetch()
                self.at = time.monotonic()
            return self.sha


# ---- GitHub ------------------------------------------------------------------------------------------------------

@dataclass
class PR:
    task: str
    number: int
    node_id: str
    head: str = ""
    future: asyncio.Future | None = None
    added_at: float | None = None       # GitHub's epoch of the latest add to the queue
    first_added_at: float | None = None
    events_seen: int = 0
    enqueued_head: str | None = None
    enqueue_tries: int = 0
    red_head: str | None = None
    conflict_polls: int = 0
    merging: bool = False
    merged_at: float | None = None
    pushed_at: float = 0.0


@dataclass
class Run:
    id: int
    event: str
    head: str
    group_pr: int | None
    green: bool | None = None
    ended: bool = False
    seconds: float = 0.0
    suite_seconds: float | None = None
    pickup_s: float | None = None
    started_at: float | None = None
    completed_at: float | None = None


class GitHubForge(Forge):
    name = "github"
    policy = "github-queue"
    line = "main"

    def __init__(self, git: Git, work: str, arena: str, *, owner: str, repo: str, build_concurrency: int,
                 max_merge: int, poll: float = 3.0, push_interval: float = 2.0, reset: bool = True,
                 client=None, log=None):
        self.git, self.work, self.arena = git, work, arena
        self.opts = GitHubOptions(owner=owner, repo=repo, poll_seconds=poll, push_interval=push_interval,
                                  reset=reset)
        self.limiter = Limiter(push_interval=push_interval, mutation_interval=1.0)
        self.client = client or GhClient(owner, repo, limiter=self.limiter, on_event=self._gh_event)
        if getattr(self.client, "limiter", None) is not None:
            self.limiter = self.client.limiter
        if client is not None and hasattr(client, "on_event"):
            client.on_event = self._gh_event
        self.log = log or (lambda *a, **k: None)
        self.k, self.batch = build_concurrency, max_merge
        self.net = Git(git.runner, git.repo)
        self.net.env = {**git.env, **self.client.git_env()}
        self.prs: dict[str, PR] = {}
        self.by_number: dict[int, PR] = {}
        self.runs: dict[int, Run] = {}
        self.poller: asyncio.Task | None = None
        self.stopped = False
        self.base = ""
        self.lines = LineCache(self._fetch_main)
        self.stats = {"pushes": 0, "prs": 0, "enqueue_calls": 0, "polls": 0, "poll_errors": 0, "rate_limited": 0,
                      "kickouts_by_reason": {}}

    def _gh_event(self, typ: str, **fields) -> None:
        if typ == "gh.rate_limited":
            self.stats["rate_limited"] += 1
        self.log(typ, **fields)

    def ruleset(self) -> dict:
        return ruleset_body(self.k, self.batch)

    async def _push(self, refspec: str, what: str) -> None:
        wait = await self.limiter.push()
        t0 = time.monotonic()
        for attempt in range(3):
            res = await self.net.run("push", "-q", "--no-verify", self.client.push_url, refspec, check=False,
                                     timeout=300)
            if res.returncode == 0 or "rejected" in res.stderr:
                break
            await asyncio.sleep(3.0 * (attempt + 1))
        self.stats["pushes"] += 1
        self.log("gh.push", what=what, ref=refspec.split(":")[-1], wait_s=round(wait, 3),
                 push_s=round(time.monotonic() - t0, 3), ok=res.returncode == 0)
        if res.returncode != 0:
            raise GitError(res)

    async def setup(self, base_sha: str) -> str:
        self.base, _workflow, _removed = await github_base(self.git, self.work, base_sha, self.arena, self.opts)
        await prepare_github_repo(self.client, arena_name=os.path.basename(self.arena), reset=self.opts.reset,
                                  ruleset=self.ruleset(), push_base=lambda: self._push(f"+{self.base}:refs/heads/main",
                                                                                      "base"),
                                  say=lambda m: print(f"[github] {m}", flush=True),
                                  what="load generator, GitHub arm")
        await self.lines.get(force=True)
        self.poller = asyncio.ensure_future(self._poll_loop())
        return self.base

    async def _fetch_main(self) -> str:
        for attempt in range(4):
            res = await self.net.run("fetch", "-q", "--no-tags", self.client.push_url,
                                     "+refs/heads/main:refs/remotes/github/main", timeout=300, check=False)
            if res.returncode == 0:
                break
            if attempt == 3:
                raise GitError(res)
            await asyncio.sleep(2.0 * (attempt + 1))
        return await self.git.rev("refs/remotes/github/main")

    async def line_head(self, force: bool = False) -> str:
        return await self.lines.get(force)

    async def final_sha(self) -> str:
        return await self.lines.get(force=True)

    async def submit(self, tid: str, sha: str, attempt: int, title: str) -> Outcome:
        branch = f"lg/{tid}"
        await self._push(f"+{sha}:refs/heads/{branch}", "change")
        pr = self.prs.get(tid)
        if pr is None:
            number, node = await self.client.create_pr(branch, title, f"Task: {tid}\n\nPushed by the Beanstalk load "
                                                                      "generator (reference solution, no agent).\n")
            pr = PR(task=tid, number=number, node_id=node)
            self.prs[tid], self.by_number[number] = pr, pr
            self.stats["prs"] += 1
            self.log("pr.open", task=tid, pr=number, sha=sha)
        pr.head, pr.pushed_at = sha, time.time()
        pr.enqueued_head, pr.enqueue_tries, pr.red_head, pr.conflict_polls, pr.merging = None, 0, None, 0, False
        pr.future = asyncio.get_running_loop().create_future()
        return await pr.future

    def stable_at(self, tid: str) -> float | None:
        pr = self.prs.get(tid)
        return pr.merged_at if pr else None

    def enqueued_at(self, tid: str) -> float | None:
        pr = self.prs.get(tid)
        return pr.first_added_at if pr else None

    # -- observation --
    async def _poll_loop(self) -> None:
        while not self.stopped:
            try:
                snap = await self.client.snapshot()
                self.stats["polls"] += 1
            except GitHubError as e:
                self.stats["poll_errors"] += 1
                self.log("gh.error", where="poll", error=str(e)[:300])
                await asyncio.sleep(self.opts.poll_seconds * 2)
                continue
            try:
                await self._observe(snap)
            except Exception as e:  # noqa: BLE001 - one bad poll must not stop observation
                self.log("gh.error", where="observe", error=repr(e)[:300])
            await asyncio.sleep(self.opts.poll_seconds)

    async def _observe(self, snap) -> None:
        for r in sorted(snap.runs, key=lambda r: r.id):
            if r.event not in ("pull_request", "merge_group"):
                continue
            run = self.runs.get(r.id)
            if run is None:
                run = self.runs[r.id] = Run(id=r.id, event=r.event, head=r.head_sha, group_pr=r.group_pr)
            if not run.ended and r.status == "completed":
                run.ended = True
                cancelled = r.conclusion in ("cancelled", "skipped", "neutral", "stale")
                run.green = None if cancelled else r.conclusion == "success"
                job = None
                try:
                    job = await self.client.run_job(r.id)
                except GitHubError:
                    pass
                from harness.forge_github import _epoch
                started = _epoch(job, "started_at") or r.started_at
                completed = _epoch(job, "completed_at") or r.completed_at
                run.started_at, run.completed_at = started, completed
                run.seconds = _span(started, completed) or 0.0
                run.pickup_s = _span(r.created_at, started)
                step = next((s for s in (job or {}).get("steps") or [] if s.get("name") == "suite"), None)
                run.suite_seconds = _span(_epoch(step, "started_at"), _epoch(step, "completed_at")) if step else None
                tasks = [self.by_number[n].task for n in (r.pr_numbers or []) if n in self.by_number]
                if run.group_pr in self.by_number:
                    tasks = [self.by_number[run.group_pr].task]
                self.log("ci.end", ci=f"gh{r.id}", sha=r.head_sha, green=run.green, cancelled=cancelled,
                         purpose="precheck" if r.event == "pull_request" else "batch", tasks=tasks,
                         task=tasks[-1] if tasks else None, ci_seconds=round(run.seconds, 3),
                         suite_seconds=run.suite_seconds)
        for number, pr in list(self.by_number.items()):
            st = snap.prs.get(number)
            if st is None or pr.future is None or pr.future.done():
                continue
            new = st.queue_events[pr.events_seen:]
            pr.events_seen = len(st.queue_events)
            removed = None
            for ev in new:
                if ev.kind == "added":
                    pr.added_at = ev.at
                    pr.first_added_at = pr.first_added_at or ev.at
                    self.log("queue.enqueue", task=pr.task, pr=number, sha=st.head_oid, depth=st.queue_position)
                else:
                    removed = ev
                    self.log("gh.dequeued", task=pr.task, pr=number, reason=ev.reason, merged=st.merged)
            if st.merged:
                pr.merged_at = st.merged_at or time.time()
                pr.future.set_result(Outcome("integrated", pr.merged_at, st.merge_commit,
                                             detail={"pr": number, "poll_lag_s": round(snap.at - pr.merged_at, 2)}))
                continue
            if st.state == "CLOSED":
                pr.future.set_result(Outcome("dropped", time.time(), reason="PR closed"))
                continue
            if st.head_oid != pr.head:
                continue
            cause, why = self._kickout(pr, st, removed)
            if cause:
                key = why or cause
                self.stats["kickouts_by_reason"][key] = self.stats["kickouts_by_reason"].get(key, 0) + 1
                pr.future.set_result(Outcome(cause, snap.at, reason=why, detail={"pr": number}))
                continue
            if self._wants_enqueue(pr, st):
                pr.enqueued_head = pr.head
                pr.enqueue_tries += 1
                asyncio.ensure_future(self._enqueue(pr))

    def _wants_enqueue(self, pr: PR, st) -> bool:
        if st.queue_state is not None or st.mergeable == "CONFLICTING":
            return False
        if pr.enqueued_head == pr.head or pr.enqueue_tries >= 8:
            return False
        return any(r.event == "pull_request" and r.ended and r.green and r.head == pr.head
                   for r in self.runs.values())

    async def _enqueue(self, pr: PR) -> None:
        self.stats["enqueue_calls"] += 1
        refused = await self.client.enqueue(pr.node_id, pr.head)
        self.log("gh.enqueue_call", task=pr.task, pr=pr.number, ok=refused is None, refused=refused)
        if refused is not None and "already" not in refused.lower():
            pr.enqueued_head = None

    def _kickout(self, pr: PR, st, removed) -> tuple[str | None, str]:
        """The GitHub arm's rules (``GitHubRace.kickout``)."""
        if removed is not None and (removed.reason or "").lower() == "merged":
            pr.merging = True
            return None, ""
        if pr.merging:
            return None, ""
        if removed is not None and st.queue_state is None:
            reason = (removed.reason or "").upper()
            if "CONFLICT" in reason or st.mergeable == "CONFLICTING":
                return "conflict", removed.reason or "merge_conflict"
            return "red", removed.reason or "failed_checks"
        if st.queue_state is None:
            if pr.red_head != pr.head and any(r.event == "pull_request" and r.ended and r.green is False
                                              and r.head == pr.head for r in self.runs.values()):
                pr.red_head = pr.head
                return "red", "PR_CHECK_FAILED"
            if st.mergeable == "CONFLICTING":
                pr.conflict_polls += 1
                if pr.conflict_polls >= 2:
                    return "conflict", "CONFLICTING"
                return None, ""
        pr.conflict_polls = 0
        return None, ""

    async def finish(self) -> dict:
        self.stopped = True
        if self.poller:
            self.poller.cancel()
        for pr in self.prs.values():
            if pr.merged_at is None:
                try:
                    await self.client.close_pr(pr.number, "Closed by the load generator: the run ended.")
                except Exception:  # noqa: BLE001
                    pass
        runs = [r for r in self.runs.values() if r.ended]
        by_event: dict[str, dict] = {}
        for r in runs:
            d = by_event.setdefault(r.event, {"runs": 0, "minutes": 0.0, "suite_minutes": 0.0, "red": 0})
            d["runs"] += 1
            d["minutes"] = round(d["minutes"] + r.seconds / 60, 2)
            d["suite_minutes"] = round(d["suite_minutes"] + (r.suite_seconds or 0) / 60, 2)
            d["red"] += r.green is False
        spans = [(r.started_at, r.completed_at) for r in runs if r.started_at and r.completed_at]
        concurrency = {"max_concurrent_jobs": max_overlap(spans),
                       "max_concurrent_pr_checks": max_overlap([(r.started_at, r.completed_at) for r in runs
                                                                if r.event == "pull_request" and r.started_at
                                                                and r.completed_at]),
                       "max_concurrent_merge_groups": max_overlap([(r.started_at, r.completed_at) for r in runs
                                                                   if r.event == "merge_group" and r.started_at
                                                                   and r.completed_at]),
                       "org_job_cap": 20, "runner": "ubuntu-latest (4 vCPU, public repo)"}
        return {"concurrency": concurrency, "repo": getattr(self.client, "html_url", self.client.full), "ruleset": self.ruleset()["rules"][0]
                ["parameters"], "ci": by_event, "ci_minutes": round(sum(d["minutes"] for d in by_event.values()), 2),
                "suite_minutes": round(sum(d["suite_minutes"] for d in by_event.values()), 2),
                "red_validations": by_event.get("merge_group", {}).get("red", 0),
                "api": {k: (round(v, 2) if isinstance(v, float) else v) for k, v in self.limiter.stats.items()},
                **{k: v for k, v in self.stats.items()}}


# ---- Beanstalk -------------------------------------------------------------------------------------------------------

class BeanstalkForge(Forge):
    name = "beanstalk"
    policy = "beanstalk-git"
    line = "sprout"

    def __init__(self, git: Git, work: str, client, *, suite: dict | None, log=None, bean_poll: float = 3.0,
                 keep_repo: bool = False, wait_seconds: int = 1800):
        self.git, self.work, self.client = git, work, client
        self.suite = suite
        self.log = log or (lambda *a, **k: None)
        self.bean_poll, self.keep_repo, self.wait_seconds = bean_poll, keep_repo, wait_seconds
        self.lines = LineCache(self._fetch_sprout)
        self.green_at: dict[str, float] = {}
        self.phases: dict[str, str] = {}
        self.poller: asyncio.Task | None = None
        self.stopped = False
        self.base = ""
        self.engine_events: list[dict] = []
        self.stats = {"pushes": 0, "refused": 0, "timeouts": 0, "verdicts": {}}

    def bean(self, tid: str) -> str:
        return tid

    async def setup(self, base_sha: str) -> str:
        opened = await self.client.open(self.suite)
        self.log("bs.open", engine=self.client.engine, created=opened.get("created"))
        root = await self._fetch_sprout()
        tree = (await self.git.out("rev-parse", f"{base_sha}^{{tree}}")).strip()
        seed = await self.git.commit_tree(tree, [root], "Seed: the arena base\n\nThe load generator's starting tree.\n")
        v = await self.client.push(self.git.repo, seed, "seed", base_env=self.git.env, wait_seconds=self.wait_seconds)
        self.log("bs.seed", verdict=v.kind, check_seconds=v.check_seconds, seconds=round(time.time() - v.pushed_at, 1))
        if v.kind != "landed":
            raise RuntimeError(f"seeding the repository failed: {v.kind} {v.lines[-8:]}")
        for _ in range(240):  # the seed must be on the stalk too before the clock starts
            if any(b.get("bean") == "seed" and b.get("phase") == "green" for b in await self.client.beans()):
                break
            await asyncio.sleep(2.0)
        self.base = await self.lines.get(force=True)
        self.poller = asyncio.ensure_future(self._poll_beans())
        return self.base

    async def _fetch_sprout(self) -> str:
        await self.client.fetch(self.git, {"refs/heads/sprout": "refs/remotes/bs/sprout",
                                           "refs/heads/stalk": "refs/remotes/bs/stalk"})
        return await self.git.rev("refs/remotes/bs/sprout")

    async def line_head(self, force: bool = False) -> str:
        return await self.lines.get(force)

    async def final_sha(self) -> str:
        await self.lines.get(force=True)
        return await self.git.rev("refs/remotes/bs/stalk")

    async def submit(self, tid: str, sha: str, attempt: int, title: str) -> Outcome:
        bean = self.bean(tid)
        for tries in range(60):
            self.stats["pushes"] += 1
            v = await self.client.push(self.git.repo, sha, bean, base_env=self.git.env,
                                       wait_seconds=self.wait_seconds, force=attempt > 1)
            self.stats["verdicts"][v.kind] = self.stats["verdicts"].get(v.kind, 0) + 1
            self.log("bs.push", task=tid, bean=bean, sha=sha, verdict=v.kind, check_seconds=v.check_seconds,
                     push_s=round((v.verdict_at or time.time()) - v.pushed_at, 2), rc=v.returncode,
                     tail=v.lines[-3:] if v.kind in ("refused", "error", "timeout", "parked", "dropped") else None)
            if v.kind == "landed":
                if v.validated_at:
                    self.green_at.setdefault(tid, v.validated_at)
                return Outcome("integrated", v.verdict_at or time.time(), v.landed_sha,
                               detail={"check_seconds": v.check_seconds})
            if v.kind in ("red", "conflict"):
                return Outcome(v.kind, v.verdict_at or time.time(), reason=v.kind, failing=v.failing,
                               files=v.conflicts, detail={"check_seconds": v.check_seconds})
            if v.kind in ("parked", "dropped"):
                return Outcome("dropped", v.verdict_at or time.time(), reason=v.kind)
            # no verdict on the push (the wait timed out, the connection dropped, or a re-push of the same head
            # found nothing to send): when the engine has this head, its verdict comes from the beans list
            self.stats["timeouts" if v.kind == "timeout" else "no_verdict"] = \
                self.stats.get("timeouts" if v.kind == "timeout" else "no_verdict", 0) + 1
            out = await self._await_head(tid, sha)
            if out:
                return out
            await asyncio.sleep(min(30.0, 3.0 * (tries + 1)))  # the push never reached the engine: push again
        return Outcome("dropped", time.time(), reason="no verdict after 60 pushes")

    async def _await_head(self, tid: str, sha: str, grace: float = 20.0) -> Outcome | None:
        """The engine's verdict on ``sha`` for the bean, read from ``GET /v1/repos/:engine/beans``; None when the
        engine has not seen that head within ``grace`` seconds."""
        bean = self.bean(tid)
        seen_until = time.time() + grace
        while not self.stopped:
            try:
                rows = await self.client.beans()
            except Exception as e:  # noqa: BLE001
                self.log("bs.error", where="beans", error=str(e)[:300])
                rows = []
            row = next((b for b in rows if b.get("bean") == bean), None)
            if row and row.get("head") == sha:
                seen_until = float("inf")
                phase = row.get("phase")
                if phase in ("landed", "green"):
                    if phase == "green":
                        self.green_at.setdefault(tid, time.time())
                    return Outcome("integrated", time.time(), row.get("landed_sha"), reason="read from the engine")
                if phase in ("red", "conflict"):
                    return Outcome(phase, time.time(), reason="read from the engine")
                if phase in ("parked", "dropped"):
                    return Outcome("dropped", time.time(), reason=phase)
            elif time.time() > seen_until:
                return None
            await asyncio.sleep(self.bean_poll)
        return None

    async def _poll_beans(self) -> None:
        while not self.stopped:
            try:
                for b in await self.client.beans():
                    name, phase = b.get("bean"), b.get("phase")
                    if name != "seed" and phase != self.phases.get(name):
                        self.phases[name] = phase
                        self.log("bs.phase", task=name, phase=phase, landed_sha=b.get("landed_sha"))
                    if phase == "green" and name not in self.green_at:
                        self.green_at[name] = time.time()
            except Exception as e:  # noqa: BLE001
                self.log("bs.error", where="beans", error=str(e)[:300])
            await asyncio.sleep(self.bean_poll)

    def stable_at(self, tid: str) -> float | None:
        return self.green_at.get(self.bean(tid))

    async def wait_stable(self, tids: list[str], timeout: float) -> None:
        end = time.monotonic() + timeout
        while time.monotonic() < end and any(t not in self.green_at for t in tids):
            await asyncio.sleep(self.bean_poll)

    async def finish(self) -> dict:
        self.stopped = True
        if self.poller:
            self.poller.cancel()
        try:
            self.engine_events = await self.client.events()
            with open(os.path.join(os.path.dirname(self.work), "engine-events.jsonl"), "w", encoding="utf-8") as fh:
                for e in self.engine_events:
                    fh.write(json.dumps(e, default=str) + "\n")
        except Exception as e:  # noqa: BLE001
            self.log("bs.error", where="events", error=str(e)[:300])
        if not self.keep_repo:
            try:
                await self.client.close(True)
            except Exception as e:  # noqa: BLE001
                self.log("bs.error", where="close", error=str(e)[:300])
        return {"engine": self.client.engine, **engine_ci(self.engine_events), **self.stats,
                "git_calls": dict(getattr(self.client, "calls", {}))}


def max_overlap(intervals: list[tuple[float, float]]) -> int:
    """The most intervals open at one moment."""
    edges = sorted([(a, 1) for a, _ in intervals] + [(b, -1) for _, b in intervals], key=lambda x: (x[0], x[1]))
    cur = best = 0
    for _, d in edges:
        cur += d
        best = max(best, cur)
    return best


# A continuous engine's pre-land checks run on a pool of this many shared sandboxes (one standard-4 container
# each; slot i uses sandbox i % 2), whatever the number of beans checking at once: packages/gateway
# src/run/run-names.ts SHARED_SANDBOXES at the gateway versions measured (live before and at 48ed740e, staging-lg).
PRELAND_SANDBOXES = 2


def engine_ci(events: list[dict]) -> dict:
    """CI work from a Beanstalk engine's event log: pre-land checks (in the slots' sandboxes) and validations
    (CI slots), minutes and counts, reused checks, red validations; the seed bean's check is left out."""
    pre = [e for e in events if e.get("type") == "preland.check" and e.get("task") != "seed"]
    ci = [e for e in events if e.get("type") == "ci.end"]
    seed_shas = {e.get("sha") for e in events if e.get("type") == "preland.check" and e.get("task") == "seed"}
    ci = [e for e in ci if e.get("sha") not in seed_shas]
    audits = [e for e in ci if e.get("audit")]
    vals = [e for e in ci if not e.get("audit")]

    def minutes(es: list[dict], key: str = "ci_seconds") -> float:
        return round(sum(float(e.get(key) or e.get("suite_seconds") or 0) for e in es) / 60, 2)

    pre_min = minutes(pre, "suite_seconds")          # the sandbox ran the suite (a check's own busy time)
    pre_check_min = minutes(pre, "check_seconds")    # push of the check to its verdict, queueing for a sandbox too
    ci_min = minutes(ci)
    targeted = [e for e in vals if e.get("targeted")]
    affected = [e.get("affected_count", 0) / max(1, e.get("tests") or 1) for e in events
                if e.get("type") == "evidence.refused" and e.get("reason") == "affected"]
    # window waits: a green bean found the sprout window full; its wait ends when it lands
    waits, wait_s, open_wait = 0, 0.0, {}
    for e in events:
        if e.get("type") == "window.wait":
            waits += 1
            open_wait.setdefault(e.get("task"), float(e.get("t") or 0))
        elif e.get("type") == "land" and e.get("task") in open_wait:
            wait_s += float(e.get("t") or 0) - open_wait.pop(e.get("task"))
    refused: dict[str, int] = {}
    for e in events:
        if e.get("type") == "evidence.refused":
            refused[str(e.get("reason"))] = refused.get(str(e.get("reason")), 0) + 1
    return {"ci": {"preland": {"runs": len(pre), "minutes": pre_min, "check_minutes": pre_check_min,
                               "red": sum(1 for e in pre if e.get("green") is False)},
                   "validation": {"runs": len(vals), "minutes": minutes(vals),
                                  "red": sum(1 for e in vals if e.get("green") is False),
                                  "cancelled": sum(1 for e in vals if e.get("cancelled")),
                                  "targeted": len(targeted), "targeted_tests": sum(int(e.get("tests") or 0)
                                                                                   for e in targeted)},
                   "audit": {"runs": len(audits), "minutes": minutes(audits),
                             "red": sum(1 for e in audits if e.get("green") is False)}},
            "ci_minutes": round(pre_min + ci_min, 2),
            "ci_slot_minutes": ci_min,
            "red_validations": sum(1 for e in vals if e.get("green") is False),
            "checks_reused": sum(1 for e in events if e.get("type") == "check.reused"),
            "window_waits": waits, "window_wait_bean_min": round(wait_s / 60, 2),
            "evidence_promotions": sum(1 for e in events if e.get("type") == "promote.evidence"),
            "evidence_refusals": refused,
            "evidence_affected_share": round(sum(affected) / len(affected), 3) if affected else None,
            "demotions": sum(1 for e in events if e.get("type") == "green.demote"),
            "preland_capacity": {
                "sandboxes": PRELAND_SANDBOXES,
                "max_concurrent_checks": max_overlap([(float(e["t"]) - float(e.get("check_seconds") or 0),
                                                       float(e["t"])) for e in pre]),
                "max_concurrent_suites": max_overlap([(float(e["t"]) - float(e.get("suite_seconds") or 0),
                                                       float(e["t"])) for e in pre]),
                "suite_timeouts": sum(1 for e in pre if float(e.get("suite_seconds") or 0) >= 299),
                "ci_slots": 2, "max_concurrent_ci": max_overlap(
                    [(float(e["t"]) - float(e.get("ci_seconds") or 0), float(e["t"])) for e in ci])},
            "engine_event_types": sorted({e.get("type") for e in events if e.get("type")})}
