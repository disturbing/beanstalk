"""``--forge github``: the GitHub arm. Local agents, a real GitHub repository, GitHub's merge queue and Actions.

The race is the queue race (``policy_queue.QueueRace``) with GitHub as the integrator. The harness keeps everything
an author would do: start a task from the current ``main``, run the agent, restore the acceptance tests, commit; on a
kick-out merge ``main`` into the branch, hand the conflict or the red check back to the agent (or re-queue without
the agent when ``main`` merges cleanly), commit again. Everything integration does is GitHub's:

1. **Repository** ``<owner>/beanstalk-race-<arena>-<seed>`` (public, org-owned: the merge queue needs both). Created
   with the arena's base plus one commit adding ``.github/workflows/suite.yml`` (the suite on ``pull_request`` and
   ``merge_group``), or reset to it: the ruleset is disabled, open PRs are closed, ``main`` is force-pushed.
2. **Ruleset** on ``main``: merge queue with ``max_entries_to_build`` = ``--ci-slots`` (the Beanstalk arm's CI slots),
   ``max_entries_to_merge`` = ``--batch``, ALLGREEN, squash; the suite as the required check; PRs with 0 approvals.
3. **Per bean:** the driver pushes ``task/<id>`` (pushes spaced by ``--gh-push-interval``), opens a PR, and enables
   auto-merge (``gh pr merge --auto``): GitHub enqueues it when its own check is green.
4. **Outcomes,** from polling every ``--gh-poll`` seconds: merged (``land`` + ``task.green``), removed from the queue
   (GitHub's reason logged raw as ``gh.dequeued``), a red PR check, or ``mergeable: CONFLICTING``. Each becomes the
   queue's ``queue.eject`` with cause ``conflict`` or ``red``, and the queue's rework flow runs against GitHub's
   ``main``.
5. **CI events** come from Actions: ``ci.start`` / ``ci.end`` per workflow run (purpose ``precheck`` for a PR's own
   check, ``batch`` for a merge-group run), with the job's real start/end times and duration.

Timestamps: every event's ``t`` is when the driver observed it (poll lag is at most ``--gh-poll`` seconds and is
reported); GitHub's own times are kept in ``gh_at`` fields and drive the ``github`` block of the summary.

Agents never hold a GitHub credential: worktrees have no remote, and only the driver's git processes get the gh CLI
as credential helper (``GhClient.git_env``).
"""
from __future__ import annotations

import asyncio
import json
import os
import statistics
import time
from dataclasses import dataclass, field

from .agents import InvocationResult, InvocationSpec
from .core import AgentSlot, RaceConfig, TaskState
from .github import (CHECK_NAME, DEFAULT_TEST_CMD, WORKFLOW_PATH, GhClient, GitHubError, Limiter, PRState, RunState, Snapshot, failures_from_log,
                     ruleset_body, workflow_yaml)
from .gitops import Git, GitError
from .policy_queue import QueueRace

REPO_MARKER = "Beanstalk race"   # repo description prefix: a repo without it was not created by this harness
INFRA_BACKOFF = 15.0
INFRA_BACKOFF_CAP = 60.0


@dataclass
class GitHubOptions:
    owner: str
    repo: str
    poll_seconds: float = 2.0
    push_interval: float = 10.0
    mutation_interval: float = 1.0
    node_version: str | None = None
    test_cmd: str | None = None
    install: str | None = None
    check_timeout_minutes: int = 30
    reset: bool = True
    enqueue: str = "direct"         # direct: enqueuePullRequest once the PR check is green; auto: auto-merge only
    close_on_end: bool = True
    outage_seconds: float = 300.0


@dataclass
class PRTrack:
    task: str
    number: int
    node_id: str
    head: str = ""                  # the head the driver last pushed
    submitted_at: float = 0.0       # race clock
    events_seen: int = 0            # queue timeline events already handled
    added_at: float | None = None   # epoch (GitHub) of the latest AddedToMergeQueue
    handled_head_red: str | None = None
    handled_conflict_head: str | None = None
    merging: bool = False           # removed from the queue as merged; the PR has not read MERGED yet
    conflict_polls: int = 0         # consecutive polls reading CONFLICTING outside the queue
    enqueue_head: str | None = None  # the head the driver last asked GitHub to enqueue
    enqueue_tries: int = 0
    waiting: bool = False           # the driver waits for GitHub's outcome on this PR
    merged: bool = False


@dataclass
class RunTrack:
    id: int
    ci: str
    purpose: str
    head: str = ""
    started: bool = False
    ended: bool = False
    tasks: list = field(default_factory=list)
    failing: list = field(default_factory=list)
    output: str = ""
    green: bool | None = None


class GitHubRace(QueueRace):
    policy = "github-queue"

    def __init__(self, cfg: RaceConfig, gh: GitHubOptions, client=None):
        super().__init__(cfg)
        self.gh = gh
        self.limiter = Limiter(push_interval=gh.push_interval, mutation_interval=gh.mutation_interval)
        self.client = client or GhClient(gh.owner, gh.repo, limiter=self.limiter, on_event=self.gh_event)
        if getattr(self.client, "limiter", None) is not None:
            self.limiter = self.client.limiter
        if client is not None and hasattr(client, "on_event"):
            client.on_event = self.gh_event
        self.net_git: Git | None = None
        self.prs: dict[str, PRTrack] = {}
        self.by_pr: dict[int, PRTrack] = {}
        self.runs: dict[int, RunTrack] = {}
        self.ignore_prs: set[int] = set()
        self.submitting: set[str] = set()
        self.epoch0 = 0.0
        self.gh_base = ""
        self.poller: asyncio.Task | None = None
        self.workflow = ""
        self.upstream_automation_removed: list[str] = []
        self.fetch_lock = asyncio.Lock()
        self.last_snapshot: Snapshot | None = None
        self.outage: dict | None = None
        self.records: dict[str, list] = {"merges": [], "removals": [], "adds": [], "jobs": []}
        self.gh_stats = {"prs_opened": 0, "auto_merge_enabled": 0, "auto_merge_refused": 0, "pushes": 0,
                         "kickouts": 0, "kickouts_by_gh_reason": {}, "kickouts_by_cause": {}, "red_prechecks": 0,
                         "conflicting_prs": 0, "polls": 0, "poll_errors": 0}

    # ---- logging helpers -------------------------------------------------------------------------------------

    def gh_event(self, typ: str, **fields) -> None:
        if self.events is not None:
            self.log(typ, **fields)

    def gh_rel(self, epoch: float | None) -> float | None:
        """GitHub's epoch time on the race clock (seconds since the run's event clock zero)."""
        return None if epoch is None else round(epoch - self.epoch0, 3)

    def say(self, msg: str) -> None:
        print(f"[github] {msg}", flush=True)

    # ---- setup -------------------------------------------------------------------------------------------------

    async def setup(self) -> None:
        await super().setup()
        assert self.git and self.runner
        self.epoch0 = time.time() - self.now()
        self.net_git = Git(self.runner, self.integration)
        self.net_git.env = {**self.net_git.env, **self.client.git_env()}
        self.gh_base, self.workflow, self.upstream_automation_removed = await github_base(
            self.git, self.work, self.base_sha, self.cfg.arena, self.gh)
        self.main = self.gh_base
        await self.prepare_repo()
        cfg_path = os.path.join(self.out, "config.json")
        with open(cfg_path, encoding="utf-8") as fh:
            conf = json.load(fh)
        conf.update(forge="github", github={"repo": self.client.full, "url": getattr(self.client, "html_url", None),
                                            "base": self.gh_base, "ruleset": self.ruleset()["rules"][0]["parameters"],
                                            "poll_seconds": self.gh.poll_seconds, "enqueue": self.gh.enqueue,
                                            "push_interval": self.gh.push_interval})
        with open(cfg_path, "w", encoding="utf-8") as fh:
            json.dump(conf, fh, indent=2, default=str)
        self.log("gh.setup", repo=self.client.full, url=getattr(self.client, "html_url", None), base=self.gh_base,
                 arena_base=self.base_sha, ruleset=self.ruleset(), push_interval=self.gh.push_interval,
                 poll_seconds=self.gh.poll_seconds, ignored_prs=len(self.ignore_prs),
                 upstream_automation_removed=self.upstream_automation_removed)

    def ruleset(self) -> dict:
        return ruleset_body(self.cfg.ci_slots, self.cfg.batch, check_timeout_minutes=self.gh.check_timeout_minutes)

    async def prepare_repo(self) -> None:
        self.ignore_prs = await prepare_github_repo(
            self.client, arena_name=os.path.basename(self.cfg.arena), reset=self.gh.reset, ruleset=self.ruleset(),
            push_base=lambda: self.push([f"+{self.gh_base}:refs/heads/main"], what="base"), say=self.say)

    async def push(self, refspecs: list[str], *, what: str, task: str | None = None) -> None:
        assert self.net_git
        wait = await self.limiter.push()
        t0 = time.monotonic()
        for attempt in range(3):  # a transient network error; a rejected push fails the same way again
            res = await self.net_git.run("push", "-q", "--no-verify", self.client.push_url, *refspecs, check=False,
                                         timeout=300)
            if res.returncode == 0 or "rejected" in res.stderr:
                break
            await asyncio.sleep(3.0 * (attempt + 1))
        self.gh_stats["pushes"] += 1
        self.log("gh.push", what=what, task=task, refs=[r.split(":")[-1] for r in refspecs], wait_s=round(wait, 3),
                 push_s=round(time.monotonic() - t0, 3), ok=res.returncode == 0)
        if res.returncode != 0:
            raise GitError(res)

    async def sync_main(self) -> str:
        """Fetch GitHub's ``main`` into the integration repo; ``self.main`` follows it."""
        assert self.net_git
        async with self.fetch_lock:
            for attempt in range(4):
                res = await self.net_git.run("fetch", "-q", "--no-tags", self.client.push_url,
                                             "+refs/heads/main:refs/remotes/github/main", timeout=300, check=False)
                if res.returncode == 0:
                    break
                self.log("gh.error", where="fetch main", attempt=attempt + 1, error=res.stderr.strip()[:300])
                if attempt == 3:
                    raise GitError(res)
                await asyncio.sleep(2.0 * (attempt + 1))
            self.main = await self.net_git.rev("refs/remotes/github/main")
        return self.main

    # ---- race loop ----------------------------------------------------------------------------------------------

    async def dispatch(self) -> None:
        if self.poller is None:
            self.poller = self.spawn(self.poll_loop(), "github-poll")
        await super().dispatch()

    async def integrate(self) -> None:  # GitHub's merge queue integrates
        return

    def finished(self) -> bool:
        return all(t.terminal for t in self.tasks) and not self.rework_jobs and not self.submitting

    def final_green_sha(self) -> str:
        return self.main

    async def final_check(self) -> dict:
        try:
            await self.sync_main()
        except GitError as e:
            self.log("gh.error", where="final sync", error=str(e)[:500])
        return await super().final_check()

    async def shutdown(self) -> None:
        if self.gh.close_on_end:
            await self.close_open_prs()
        await super().shutdown()

    async def close_open_prs(self) -> None:
        for tr in self.prs.values():
            if tr.merged:
                continue
            ts = self.by_id.get(tr.task)
            if ts and ts.status == "green":
                continue
            try:
                await self.client.close_pr(tr.number, "Closed by the race harness: the race ended "
                                                      f"({self.aborted or 'done'}).")
                self.log("gh.pr_closed", task=tr.task, pr=tr.number, why="race end")
            except Exception as e:  # noqa: BLE001 - best effort, the next reset closes it too
                self.log("gh.error", where="close", pr=tr.number, error=str(e)[:300])

    # ---- submitting a bean: push, PR, auto-merge -------------------------------------------------------------------

    def enqueue(self, ts: TaskState) -> None:
        ts.status = "queued"
        self.submitting.add(ts.id)
        if not self.cfg.queue_hold and ts.agent:
            self.release(ts.agent)
        self.spawn(self.submit(ts), f"submit-{ts.id}")

    async def submit(self, ts: TaskState) -> None:
        try:
            assert ts.head_sha and ts.branch
            await self.push([f"+{ts.head_sha}:refs/heads/{ts.branch}"], what="bean", task=ts.id)
            tr = self.prs.get(ts.id)
            if tr is None:
                number, node = await self.client.create_pr(ts.branch, ts.task.title, self.pr_body(ts))
                tr = PRTrack(task=ts.id, number=number, node_id=node)
                self.prs[ts.id], self.by_pr[number] = tr, tr
                self.gh_stats["prs_opened"] += 1
                self.log("pr.open", task=ts.id, pr=number, sha=ts.head_sha)
            tr.head, tr.submitted_at, tr.waiting = ts.head_sha, self.now(), True
            tr.enqueue_head, tr.enqueue_tries, tr.merging, tr.conflict_polls = None, 0, False, 0
            refused = await self.client.enable_auto_merge(tr.node_id)
            self.gh_stats["auto_merge_refused" if refused else "auto_merge_enabled"] += 1
            self.log("queue.submit", task=ts.id, pr=tr.number, sha=ts.head_sha, auto_merge=refused is None,
                     refused=refused)
        finally:
            self.submitting.discard(ts.id)
            self.poke()

    def pr_body(self, ts: TaskState) -> str:
        return (f"Task: {ts.id}\n\n{ts.task.prompt.strip()}\n\n---\nOpened by the Beanstalk race harness (GitHub arm); "
                "the change was written by a coding agent.\n")

    def drop(self, ts: TaskState, reason: str) -> None:
        super().drop(ts, reason)
        tr = self.prs.get(ts.id)
        if tr and not tr.merged:
            tr.waiting = False
            self.spawn(self.close_quietly(tr, reason), f"close-{ts.id}")

    async def close_quietly(self, tr: PRTrack, reason: str) -> None:
        try:
            await self.client.close_pr(tr.number, f"Dropped by the race harness: {reason}")
            self.log("gh.pr_closed", task=tr.task, pr=tr.number, why=reason[:200])
        except GitHubError as e:
            self.log("gh.error", where="close", pr=tr.number, error=str(e)[:300])

    # ---- rework: GitHub's main, then the queue's own rework flow ----------------------------------------------------

    async def rework_flow(self, ts: TaskState, agent: AgentSlot, reason: str, info: dict) -> None:
        await self.sync_main()
        await super().rework_flow(ts, agent, reason, info)

    # ---- agent outages (same rule as the Cloudflare driver: back off, never count it as the agent's work) -----------

    async def invoke(self, spec: InvocationSpec, agent: AgentSlot | None, adapter=None) -> InvocationResult:
        from .remote import infra_failure
        n = 0
        while True:
            res = await super().invoke(spec, agent, adapter)
            failure = infra_failure(res) if not self.aborted else None
            if failure is None:
                if self.outage is not None:
                    self.log("driver.infra_recovered", kind=self.outage["kind"],
                             outage_seconds=round(time.monotonic() - self.outage["since"], 1))
                    self.outage = None
                return res
            n += 1
            kind, message = failure
            if self.outage is None:
                self.outage = {"kind": kind, "since": time.monotonic()}
            age = time.monotonic() - self.outage["since"]
            self.log("driver.infra_retry", inv=spec.inv_id, kind=kind, error=message[:400], attempt=n,
                     outage_seconds=round(age, 1))
            if age >= self.gh.outage_seconds:
                self.abort(f"infra: {kind} failures from the agent CLI for {age / 60:.1f} min ({message[:120]})")
                return res
            await asyncio.sleep(min(INFRA_BACKOFF * 2 ** (n - 1), INFRA_BACKOFF_CAP))
            self.check_budget()
            spec = InvocationSpec(**{**spec.__dict__, "inv_id": self.new_inv_id(spec.kind)})

    # ---- observing GitHub ------------------------------------------------------------------------------------------

    async def poll_loop(self) -> None:
        while not self.aborted:
            try:
                snap = await self.client.snapshot()
                self.gh_stats["polls"] += 1
            except GitHubError as e:
                self.gh_stats["poll_errors"] += 1
                self.log("gh.error", where="poll", error=str(e)[:500])
                await asyncio.sleep(self.gh.poll_seconds * 2)
                continue
            await self.observe_runs(snap)
            async with self.lock:
                await self.observe_prs(snap)
            self.last_snapshot = snap
            self.poke()
            await asyncio.sleep(self.gh.poll_seconds)

    def task_of_pr(self, number: int | None) -> str | None:
        tr = self.by_pr.get(number) if number is not None else None
        return tr.task if tr else None

    async def observe_runs(self, snap: Snapshot) -> None:
        heads = {tr.head: tr for tr in self.prs.values()}
        for run in sorted(snap.runs, key=lambda r: r.id):
            if run.event not in ("pull_request", "merge_group"):
                continue
            rt = self.runs.get(run.id)
            if rt is None:
                if run.event == "pull_request":
                    tr = heads.get(run.head_sha) or next((self.by_pr[n] for n in run.pr_numbers if n in self.by_pr),
                                                         None)
                    if tr is None:
                        continue
                    tasks = [tr.task]
                else:
                    pr = run.group_pr
                    if pr is None or pr not in self.by_pr:
                        continue
                    tasks = self.group_tasks(snap, pr)
                rt = RunTrack(id=run.id, ci=f"gh{run.id}", purpose="precheck" if run.event == "pull_request"
                              else "batch", tasks=tasks, head=run.head_sha)
                self.runs[run.id] = rt
            if not rt.started and run.status in ("in_progress", "completed"):
                rt.started = True
                self.log("ci.start", ci=rt.ci, sha=run.head_sha, purpose=rt.purpose, slot=-1, tasks=rt.tasks,
                         task=rt.tasks[-1] if rt.tasks else None, gh_run=run.id, gh_event=run.event,
                         gh_at=self.gh_rel(run.started_at), queued_s=_span(run.created_at, run.started_at))
            if not rt.ended and run.status == "completed":
                await self.end_run(run, rt)

    def group_tasks(self, snap: Snapshot, pr: int) -> list[str]:
        """The tasks a merge group for ``pr`` contains: the entries ahead of it in the queue, then itself."""
        me = snap.prs.get(pr)
        pos = me.queue_position if me else None
        ahead = sorted((p.queue_position, p.number) for p in snap.prs.values()
                       if p.queue_position is not None and pos is not None and p.queue_position < pos)
        return [t for t in (self.task_of_pr(n) for _, n in ahead) if t] + [self.task_of_pr(pr) or f"pr{pr}"]

    async def end_run(self, run: RunState, rt: RunTrack) -> None:
        rt.ended = True
        if not rt.started:
            rt.started = True
            self.log("ci.start", ci=rt.ci, sha=run.head_sha, purpose=rt.purpose, slot=-1, tasks=rt.tasks,
                     task=rt.tasks[-1] if rt.tasks else None, gh_run=run.id, gh_event=run.event,
                     gh_at=self.gh_rel(run.started_at))
        job = None
        try:
            job = await self.client.run_job(run.id)
        except GitHubError as e:
            self.log("gh.error", where="jobs", run=run.id, error=str(e)[:300])
        started = _epoch(job, "started_at") or run.started_at
        completed = _epoch(job, "completed_at") or run.completed_at
        seconds = _span(started, completed) or 0.0
        step = next((st for st in (job or {}).get("steps") or [] if st.get("name") == CHECK_NAME), None)
        suite_seconds = _span(_epoch(step, "started_at"), _epoch(step, "completed_at")) if step else None
        cancelled = run.conclusion in ("cancelled", "skipped", "neutral", "stale")
        rt.green = None if cancelled else run.conclusion == "success"
        if run.conclusion in ("failure", "timed_out") and job and job.get("id"):
            try:
                rt.failing, rt.output = failures_from_log(await self.client.job_log(int(job["id"])))
            except GitHubError as e:
                self.log("gh.error", where="job log", run=run.id, error=str(e)[:300])
        if rt.green is False and rt.purpose == "batch":
            self.red_validations += 1
        self.records["jobs"].append({"event": run.event, "seconds": seconds, "conclusion": run.conclusion,
                                     "pickup_s": _span(run.created_at, started), "suite_s": suite_seconds})
        self.log("ci.end", ci=rt.ci, sha=run.head_sha, purpose=rt.purpose, green=None if cancelled else rt.green,
                 cancelled=cancelled, slot=-1, tasks=rt.tasks, task=rt.tasks[-1] if rt.tasks else None,
                 failing_tests=rt.failing[:30], ci_seconds=round(seconds, 3),
                 suite_seconds=round(suite_seconds if suite_seconds is not None else seconds, 3),
                 gh_run=run.id, gh_event=run.event, gh_conclusion=run.conclusion, gh_at=self.gh_rel(completed))

    async def observe_prs(self, snap: Snapshot) -> None:
        merged_now: list[tuple[PRTrack, PRState]] = []
        for number, tr in list(self.by_pr.items()):
            pr = snap.prs.get(number)
            if pr is None or tr.merged:
                continue
            ts = self.by_id[tr.task]
            new = pr.queue_events[tr.events_seen:]
            tr.events_seen = len(pr.queue_events)
            removed = None
            for ev in new:
                if ev.kind == "added":
                    tr.added_at = ev.at
                    self.records["adds"].append({"task": tr.task, "at": ev.at, "submitted": tr.submitted_at})
                    self.enqueued_at[tr.task] = self.now()
                    self.log("queue.enqueue", task=tr.task, sha=pr.head_oid, pr=number, gh_at=self.gh_rel(ev.at),
                             depth=pr.queue_position)
                else:
                    removed = ev
                    self.records["removals"].append({"task": tr.task, "at": ev.at, "reason": ev.reason,
                                                     "added": tr.added_at, "merged": pr.merged})
                    self.log("gh.dequeued", task=tr.task, pr=number, reason=ev.reason, gh_at=self.gh_rel(ev.at),
                             merged=pr.merged)
            if pr.merged:
                tr.merged, tr.waiting = True, False
                merged_now.append((tr, pr))
                continue
            if pr.state == "CLOSED":
                if ts.status != "dropped" and tr.waiting:
                    tr.waiting = False
                    self.drop(ts, "PR closed on GitHub")
                continue
            if not tr.waiting or ts.status != "queued" or pr.head_oid != tr.head:
                continue
            cause, info = self.kickout(tr, pr, removed)
            if not cause and self.wants_enqueue(tr, pr):
                tr.enqueue_head = tr.head
                tr.enqueue_tries += 1
                self.spawn(self.enqueue_direct(tr), f"enqueue-{tr.task}")
            if cause:
                tr.waiting = False
                self.gh_stats["kickouts"] += 1
                gr = (removed.reason if removed else None) or ("PR_CHECK_FAILED" if cause == "red" else "CONFLICTING")
                self.gh_stats["kickouts_by_gh_reason"][gr] = self.gh_stats["kickouts_by_gh_reason"].get(gr, 0) + 1
                self.gh_stats["kickouts_by_cause"][cause] = self.gh_stats["kickouts_by_cause"].get(cause, 0) + 1
                if cause == "conflict":
                    self.conflicts_met += 1
                    ts.conflicts += 1
                    self.log("merge.conflict", task=ts.id, onto=snap.main_sha, onto_main=True, files=[],
                             pr=number, gh_reason=gr)
                else:
                    ts.reds += 1
                self.eject(ts, cause, info)
        if merged_now:
            await self.land_merged(merged_now, snap)

    def wants_enqueue(self, tr: PRTrack, pr: PRState) -> bool:
        """Direct mode: enqueue as soon as the PR's own check is green on its head, as a bot would (GitHub's
        auto-merge took 20-130 s to enqueue a green PR in the 2026-10-07 probe)."""
        if self.gh.enqueue != "direct" or pr.queue_state is not None or pr.mergeable == "CONFLICTING":
            return False
        if tr.enqueue_head == tr.head or tr.enqueue_tries >= 6:
            return False
        return any(rt.purpose == "precheck" and rt.ended and rt.green and rt.head == tr.head
                   for rt in self.runs.values())

    async def enqueue_direct(self, tr: PRTrack) -> None:
        refused = await self.client.enqueue(tr.node_id, tr.head)
        self.log("gh.enqueue_call", task=tr.task, pr=tr.number, sha=tr.head, ok=refused is None, refused=refused,
                 attempt=tr.enqueue_tries)
        if refused is not None and "already" not in refused.lower():
            tr.enqueue_head = None  # ask again on a later poll (GitHub may still be computing mergeability)

    def kickout(self, tr: PRTrack, pr: PRState, removed) -> tuple[str | None, dict]:
        """The cause of a kick-out, or None while GitHub is still working on the PR."""
        if removed is not None and (removed.reason or "").lower() == "merged":
            # GitHub logs the removal a poll or two before the PR reads MERGED (and CONFLICTING against the new
            # main meanwhile): wait for the merge, never hand it back
            tr.merging = True
            return None, {}
        if tr.merging:
            return None, {}
        if removed is not None and pr.queue_state is None:
            reason = (removed.reason or "").upper()
            red_run = self.latest_red_group(tr.number)
            if "CONFLICT" in reason or pr.mergeable == "CONFLICTING":
                return "conflict", {"files": []}
            if red_run is not None or "CHECK" in reason or "FAIL" in reason:
                return "red", self.red_info(red_run, "merge group")
            return "red" if red_run else "conflict", self.red_info(red_run, "merge group") if red_run else {}
        if pr.queue_state is None:
            red = self.red_precheck(tr)
            if red is not None:
                self.gh_stats["red_prechecks"] += 1
                return "red", self.red_info(red, "PR check")
            if pr.mergeable == "CONFLICTING":
                tr.conflict_polls += 1
                if tr.conflict_polls >= 2:  # GitHub's mergeability flickers while main moves: two polls in a row
                    self.gh_stats["conflicting_prs"] += 1
                    return "conflict", {"files": []}
                return None, {}
        tr.conflict_polls = 0
        return None, {}

    def latest_red_group(self, number: int) -> RunTrack | None:
        task = self.task_of_pr(number)
        reds = [rt for rt in self.runs.values() if rt.purpose == "batch" and rt.ended and rt.green is False
                and rt.tasks and rt.tasks[-1] == task]
        return max(reds, key=lambda r: r.id) if reds else None

    def red_precheck(self, tr: PRTrack) -> RunTrack | None:
        """A failed PR check on the PR's current head (each head is handed back once)."""
        if tr.handled_head_red == tr.head:
            return None
        reds = [rt for rt in self.runs.values() if rt.purpose == "precheck" and rt.ended and rt.green is False
                and rt.head == tr.head]
        if not reds:
            return None
        tr.handled_head_red = tr.head
        return max(reds, key=lambda r: r.id)

    def red_info(self, rt: RunTrack | None, where: str) -> dict:
        if rt is None:
            return {"failing": [], "output": f"The {where} failed on GitHub Actions (no log could be read).",
                    "files": None}
        return {"failing": rt.failing, "output": rt.output, "files": sorted({f.split(" > ")[0] for f in rt.failing
                                                                              if " > " in f}), "gh_run": rt.id}

    async def land_merged(self, merged: list[tuple[PRTrack, PRState]], snap: Snapshot) -> None:
        await self.sync_main()
        assert self.git
        merged.sort(key=lambda m: (m[1].merged_at or 0, m[1].number))
        tasks = []
        for tr, pr in merged:
            ts = self.by_id[tr.task]
            sha = pr.merge_commit or self.main
            try:
                parent = (await self.git.out("rev-parse", f"{sha}^")).strip()
            except GitError:
                parent = self.base_sha
            await self.record_landing(ts, sha, parent)
            ts.status = "green"
            ts.landed_at = ts.green_at = self.now()
            lag = round(snap.at - pr.merged_at, 3) if pr.merged_at else None
            self.records["merges"].append({"task": tr.task, "at": pr.merged_at, "added": tr.added_at,
                                           "sha": sha, "lag": lag})
            self.log("land", task=ts.id, sha=sha, target="main", files=ts.write_set, pr=tr.number,
                     gh_at=self.gh_rel(pr.merged_at), poll_lag_s=lag)
            self.log("task.green", task=ts.id, sha=sha, target="main")
            tasks.append(ts.id)
            if ts.agent:
                a = self.agent(ts.agent)
                if a and a.holding == ts.id:
                    self.release(ts.agent)
        self.log("green.promote", sha=self.main, tasks=tasks)

    # ---- summary ----------------------------------------------------------------------------------------------------

    def policy_summary(self) -> dict:
        base = super().policy_summary()
        gh = self.github_summary()
        base["github"] = gh
        rows = [r for r in base["policy_rows"] if not r[0].startswith(("Batches", "Bisections", "PRs held",
                                                                         "Mean batch"))]
        qw, qr = gh["queue_wait_to_merge_s"], gh["queue_wait_to_removal_s"]
        rows += [
            ("GitHub repo", gh["repo"]),
            ("Queue wait to merge, median / p90 (min)", f"{_min(qw['median'])} / {_min(qw['p90'])}"),
            ("Queue wait to removal, median / p90 (min)", f"{_min(qr['median'])} / {_min(qr['p90'])}"),
            ("Push to enqueued (PR check + enqueue), median (min)", _min(gh["submit_to_enqueue_s"]["median"])),
            ("Kick-outs (by cause)", f"{gh['kickouts']} ({_fmt(gh['kickouts_by_cause']) or 'none'})"),
            ("Kick-outs by GitHub reason", _fmt(gh["kickouts_by_gh_reason"]) or "none"),
            ("Rebases: with agent / without agent", f"{gh['rebases_with_agent']} / {gh['rebases_without_agent']}"),
            ("Actions runs: PR checks / merge groups", f"{gh['actions']['runs'].get('pull_request', 0)} / "
                                                       f"{gh['actions']['runs'].get('merge_group', 0)}"),
            ("Actions minutes (PR / group / total)", f"{gh['actions']['minutes'].get('pull_request', 0)} / "
                                                     f"{gh['actions']['minutes'].get('merge_group', 0)} / "
                                                     f"{gh['actions']['minutes_total']}"),
            ("Runner pickup, median (s)", gh["actions"]["pickup_s_median"]),
            ("Actions job / suite step, median (s)", f"{gh['actions']['job_s']['median']} / "
                                                     f"{gh['actions']['suite_s']['median']}"),
            ("Merges: PRs / merge operations / max PRs in 60 s", f"{gh['merges']['prs']} / "
                                                                 f"{gh['merges']['operations']} / "
                                                                 f"{gh['merges']['max_prs_in_60s']}"),
            ("GitHub API: mutations / pushes / rate-limited", f"{gh['api']['mutations']} / {gh['api']['pushes']} / "
                                                              f"{gh['api']['rate_limited']}"),
            ("Push wait in rate limiter (s)", gh["api"]["push_wait_s"]),
        ]
        base["policy_rows"] = rows
        return base

    def github_summary(self) -> dict:
        merges = [m for m in self.records["merges"] if m["at"]]
        to_merge = [m["at"] - m["added"] for m in merges if m["added"]]
        removals = [r for r in self.records["removals"] if not r["merged"] and r["at"] and r["added"]]
        to_removal = [r["at"] - r["added"] for r in removals]
        submit = [a["at"] - (self.epoch0 + a["submitted"]) for a in self.records["adds"] if a["at"]]
        jobs = self.records["jobs"]
        runs: dict[str, int] = {}
        minutes: dict[str, float] = {}
        for j in jobs:
            runs[j["event"]] = runs.get(j["event"], 0) + 1
            minutes[j["event"]] = round(minutes.get(j["event"], 0.0) + j["seconds"] / 60, 2)
        pickups = [j["pickup_s"] for j in jobs if j["pickup_s"] is not None]
        times = sorted(m["at"] for m in merges)
        ops: list[list[float]] = []
        for t in times:  # PRs merged within 2 s of each other came from one merge group
            if ops and t - ops[-1][-1] <= 2.0:
                ops[-1].append(t)
            else:
                ops.append([t])
        max60 = max((sum(1 for u in times if t <= u < t + 60) for t in times), default=0)
        ops60 = max((sum(1 for o in ops if t <= o[0] < t + 60) for t in (o[0] for o in ops)), default=0)
        lags = [m["lag"] for m in merges if m["lag"] is not None]
        lim = dict(self.limiter.stats)
        return {
            "repo": getattr(self.client, "html_url", self.client.full),
            "ruleset": self.ruleset()["rules"][0]["parameters"],
            "queue_wait_to_merge_s": _stats(to_merge),
            "queue_wait_to_removal_s": _stats(to_removal),
            "submit_to_enqueue_s": _stats(submit),
            "kickouts": self.gh_stats["kickouts"],
            "kickouts_by_cause": self.gh_stats["kickouts_by_cause"],
            "kickouts_by_gh_reason": self.gh_stats["kickouts_by_gh_reason"],
            "red_prechecks": self.gh_stats["red_prechecks"],
            "rebases_with_agent": self.inv_stats.get("rework", {}).get("count", 0),
            "rebases_without_agent": self.stats["requeued_without_agent"],
            "prs_opened": self.gh_stats["prs_opened"],
            "actions": {"runs": runs, "minutes": minutes, "minutes_total": round(sum(minutes.values()), 2),
                        "suite_s": _stats([j["suite_s"] for j in jobs if j.get("suite_s") is not None]),
                        "job_s": _stats([j["seconds"] for j in jobs]),
                        "pickup_s_median": _r(statistics.median(pickups)) if pickups else None,
                        "billable_minutes": 0, "note": "public repo: Actions minutes are free; measured anyway"},
            "merges": {"prs": len(times), "operations": len(ops), "max_prs_in_60s": max60,
                       "max_operations_in_60s": ops60, "group_sizes": [len(o) for o in ops]},
            "poll_lag_s": _stats(lags),
            "api": {k: (round(v, 2) if isinstance(v, float) else v) for k, v in lim.items()},
            "polls": self.gh_stats["polls"], "poll_errors": self.gh_stats["poll_errors"],
        }



async def github_base(git: Git, work: str, base_sha: str, arena: str, gh: GitHubOptions) -> tuple[str, str, list[str]]:
    """The GitHub base: the arena's base plus the suite workflow (and, for an arena with dependencies, its lockfile
    under ``.github/race/``), the only files the Beanstalk arm's base lacks. Returns (commit, workflow, removed)."""
    wt = os.path.join(work, "gh-base")
    await git.add_worktree(wt, base_sha, "gh-base")
    # an upstream repo's own automation must not run in the race repo: its workflows would compete for the
    # Actions job cap (fastify's CI matrix queued the race's suite for minutes) and dependabot opens PRs that
    # the merge queue would see. Only these files go; agents' code and tests are untouched.
    removed = []
    gh_dir = os.path.join(wt, ".github")
    for root, _dirs, names in os.walk(os.path.join(gh_dir, "workflows")):
        removed += [os.path.relpath(os.path.join(root, n), wt) for n in names]
    removed += [os.path.relpath(os.path.join(gh_dir, n), wt) for n in ("dependabot.yml", "dependabot.yaml")
                if os.path.exists(os.path.join(gh_dir, n))]
    if removed:
        await git.run("rm", "-q", "--", *removed, cwd=wt)
    test_cmd, node, install, extra = arena_ci(arena)
    for rel, content in extra.items():
        full = os.path.join(wt, rel)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as fh:
            fh.write(content)
    if extra:  # an upstream .gitignore may list package-lock.json (fastify's does)
        await git.run("add", "-f", "--", *extra, cwd=wt)
    path = os.path.join(wt, WORKFLOW_PATH)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    workflow = workflow_yaml(gh.test_cmd or test_cmd, gh.node_version or node,
                             gh.install if gh.install is not None else install)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(workflow)
    sha, _ = await git.commit_all(wt, "ci: the arena suite on pull_request and merge_group\n")
    await git.remove_worktree(wt)
    return sha, workflow, sorted(removed)


async def prepare_github_repo(client, *, arena_name: str, reset: bool, ruleset: dict, push_base, say,
                              what: str = "GitHub arm of the Beanstalk race harness") -> set[int]:
    """Create the org repo (public: the merge queue on GitHub Free needs it) or reset one this harness created
    (ruleset disabled, open PRs closed, active runs cancelled), push the base to ``main`` (``push_base``), put the
    merge-queue ruleset. Returns the PR numbers already there (to ignore)."""
    c = client
    info = await c.repo_info()
    description = f"{REPO_MARKER}: {what} (arena {arena_name})"
    if info is None:
        await c.create_repo(description)
        say(f"created {c.full}")
    else:
        if not str(info.get("description") or "").startswith(REPO_MARKER):
            raise SystemExit(f"{c.full} exists and was not created by the race harness (description lacks "
                             f"'{REPO_MARKER}'); pick another repo name")
        if info.get("private"):
            raise SystemExit(f"{c.full} is private; the merge queue on GitHub Free needs a public repo")
        if not reset:
            raise SystemExit(f"{c.full} exists; pass --gh-reset to reset it to the arena base")
        await c.disable_ruleset()
        for pr in await c.open_prs():
            await c.close_pr(int(pr["number"]))
        if hasattr(c, "cancel_active_runs"):
            await c.cancel_active_runs()
        say(f"reset {c.full}: ruleset disabled, open PRs closed")
    await c.configure_repo()
    await push_base()
    await c.put_ruleset(ruleset)
    snap = await c.snapshot()
    c.since_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 5))
    return set(snap.prs)


def arena_ci(arena: str) -> tuple[str, str, str | None, dict[str, str]]:
    """(suite command, Node version, install step, extra base files) for the arena's workflow.

    The synthetic arena has no ``arena.json``: ``node --test`` at the root, Node 25, no dependencies. A real arena's
    ``arena.json`` (``research/real-arena/<name>/``) gives ``node``, ``test_args`` and ``deps`` (the dependency
    snapshot's ``node_modules``, next to its ``package.json`` and ``package-lock.json``): the lockfile goes into
    ``.github/race/`` and the workflow installs it with ``npm ci`` outside the checkout and links ``node_modules``,
    as the harness links its snapshot locally. The suite step is timed on its own, so install time stays out of
    ``suite_seconds``."""
    import shlex
    meta_path = os.path.join(arena, "arena.json")
    if not os.path.exists(meta_path):
        return DEFAULT_TEST_CMD, "25", None, {}
    with open(meta_path, encoding="utf-8") as fh:
        meta = json.load(fh)
    from .suite import load_suite
    suite = load_suite(arena)
    # the harness CI's argv (suite.test_argv: node options, --test, globs) with a spec reporter for the job log
    argv = suite.test_argv(test_timeout_ms=60000, reporters=[("spec", "stdout")])
    cmd = " ".join(shlex.quote(a) for a in argv)
    node = str(meta.get("node") or "25").lstrip("v")
    extra: dict[str, str] = {}
    install = None
    deps = os.path.join(arena, meta["deps"]).rstrip("/") if meta.get("deps") else None
    deps_dir = os.path.dirname(deps) if deps and deps.endswith("node_modules") else deps
    if deps_dir and os.path.exists(os.path.join(deps_dir, "package-lock.json")):
        for name in ("package.json", "package-lock.json"):
            with open(os.path.join(deps_dir, name), encoding="utf-8") as fh:
                extra[f".github/race/{name}"] = fh.read()
        install = ('mkdir -p "$RUNNER_TEMP/deps" && cp .github/race/package.json .github/race/package-lock.json '
                   '"$RUNNER_TEMP/deps/" && (cd "$RUNNER_TEMP/deps" && npm ci --no-audit --no-fund --ignore-scripts) '
                   '&& ln -sfn "$RUNNER_TEMP/deps/node_modules" node_modules')
    return cmd, node, install, extra


def _epoch(job: dict | None, key: str) -> float | None:
    from .github import parse_time
    return parse_time(job.get(key)) if job else None


def _span(a: float | None, b: float | None) -> float | None:
    return None if a is None or b is None else round(max(0.0, b - a), 3)


def _r(v: float | None) -> float | None:
    return None if v is None else round(v, 2)


def _stats(xs: list[float]) -> dict:
    if not xs:
        return {"n": 0, "median": None, "p90": None}
    s = sorted(xs)
    k = (len(s) - 1) * 0.9
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return {"n": len(s), "median": _r(statistics.median(s)), "p90": _r(s[lo] + (s[hi] - s[lo]) * (k - lo))}


def _min(seconds: float | None) -> str:
    return "-" if seconds is None else f"{seconds / 60:.2f}"


def _fmt(d: dict) -> str:
    return ", ".join(f"{k} {v}" for k, v in sorted(d.items()))
