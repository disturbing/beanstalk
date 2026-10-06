"""An in-process fake of the GitHub the race's GitHub arm uses (``harness/github.py`` ``GhClient``'s methods).

A local bare repository stands in for the repo; pushes are plain git pushes to it. Each ``snapshot()`` is one tick:

1. every open PR whose head changed gets its PR check: the suite (``node --test``, spec reporter) on the PR merged
   into ``main``, as a completed ``pull_request`` run; a PR that does not merge into ``main`` is ``CONFLICTING`` and
   gets no run (Actions does not run on a conflicted merge ref);
2. auto-merge PRs whose check is green join the queue;
3. the queue takes up to ``max_entries_to_merge`` entries and builds their merge groups in order (each entry squashed
   onto the previous one; ALLGREEN: every group's suite must pass). An entry that does not squash is removed with
   reason ``merge_conflict``; a red group removes its entry with reason ``failed_checks`` and stops the tick; the
   green prefix merges (one squash commit per PR on ``main``, removal reason ``merged``, the strings the 2026-10-07
   probe and GitHub's docs show).

Timing is compressed (everything completes in the tick), which the race does not depend on.
"""
from __future__ import annotations

import datetime as dt
import os
import shutil
import subprocess
import sys
import time

TESTS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(TESTS))

from harness.github import Limiter, PRState, QueueEvent, RunState, Snapshot  # noqa: E402

GIT_ENV = {"GIT_AUTHOR_NAME": "fake-github", "GIT_AUTHOR_EMAIL": "noreply@github.invalid",
           "GIT_COMMITTER_NAME": "fake-github", "GIT_COMMITTER_EMAIL": "noreply@github.invalid",
           "GIT_CONFIG_NOSYSTEM": "1", "GIT_TERMINAL_PROMPT": "0"}


def iso(t: float) -> str:
    return dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class FakePR:
    def __init__(self, number: int, branch: str, head: str):
        self.number, self.branch, self.head = number, branch, head
        self.node_id = f"PR_fake{number}"
        self.state = "OPEN"
        self.merged_at: float | None = None
        self.merge_commit: str | None = None
        self.mergeable = "UNKNOWN"
        self.auto = False
        self.checked_head: str | None = None
        self.check_green: dict[str, bool] = {}
        self.queued = False
        self.events: list[QueueEvent] = []


class FakeGitHub:
    name = "github"

    def __init__(self, root: str, owner: str = "fake-org", repo: str = "beanstalk-race-fixture-0", *,
                 node: str = "node"):
        self.root, self.owner, self.repo, self.node = root, owner, repo, node
        self.bare = os.path.join(root, f"{repo}.git")
        self.limiter = Limiter(push_interval=0, mutation_interval=0)
        self.on_event = lambda *a, **k: None
        self.since_iso: str | None = None
        self.exists = False
        self.description = ""
        self.ruleset: dict | None = None
        self.prs: dict[int, FakePR] = {}
        self.queue: list[int] = []
        self.runs: list[RunState] = []
        self.logs: dict[int, str] = {}
        self.run_seq = 1000
        self.calls: list[str] = []
        self.refuse_auto_merge = False
        self.min_group = 1   # tests: hold the queue until this many entries wait (at most 100 ticks)
        self.held = 0
        self.merge_lag = True   # GitHub (2026-10-07): "removed: merged" one poll before the PR reads MERGED
        self.merging: list = []

    # -- identity --
    @property
    def full(self) -> str:
        return f"{self.owner}/{self.repo}"

    @property
    def push_url(self) -> str:
        return self.bare

    @property
    def html_url(self) -> str:
        return f"https://github.invalid/{self.full}"

    @staticmethod
    def git_env() -> dict:
        return {}

    # -- git --
    def git(self, *args: str, cwd: str | None = None, check: bool = True) -> str:
        res = subprocess.run(["git", *args], cwd=cwd or self.bare, capture_output=True, text=True,
                             env={**os.environ, **GIT_ENV})
        if check and res.returncode != 0:
            raise RuntimeError(f"git {args}: {res.stderr}")
        return res.stdout.strip()

    def main(self) -> str | None:
        out = subprocess.run(["git", "rev-parse", "--verify", "-q", "refs/heads/main"], cwd=self.bare,
                             capture_output=True, text=True)
        return out.stdout.strip() or None

    def ref(self, branch: str) -> str:
        return self.git("rev-parse", f"refs/heads/{branch}")

    def merge_tree(self, base: str | None, ours: str, theirs: str) -> str | None:
        args = ["merge-tree", "--write-tree"]
        if base:
            args += ["--merge-base", base]
        res = subprocess.run(["git", *args, ours, theirs], cwd=self.bare, capture_output=True, text=True,
                             env={**os.environ, **GIT_ENV})
        return res.stdout.split("\n", 1)[0].strip() if res.returncode == 0 else None

    def suite(self, sha: str) -> tuple[bool, str]:
        wt = os.path.join(self.root, f"ci-{sha[:10]}-{self.run_seq}")
        self.git("worktree", "add", "-q", "--detach", wt, sha)
        try:
            res = subprocess.run([self.node, "--test", "--test-reporter=spec"], cwd=wt, capture_output=True,
                                 text=True, timeout=300, env={k: v for k, v in os.environ.items()
                                                              if not k.startswith("NODE_")})
            log = (res.stdout + res.stderr).replace(f"file://{wt}/", "file:///home/runner/work/r/r/")
            log = log.replace(wt + "/", "")
            return res.returncode == 0, log + ("\n##[error]Process completed with exit code 1.\n"
                                               if res.returncode else "")
        finally:
            self.git("worktree", "remove", "--force", wt, check=False)

    def add_run(self, event: str, sha: str, branch: str, prs: list[int], suite_sha: str | None = None) -> RunState:
        self.run_seq += 1
        now = time.time()
        green, log = self.suite(suite_sha or sha)
        run = RunState(id=self.run_seq, event=event, head_sha=sha, head_branch=branch, status="completed",
                       conclusion="success" if green else "failure", created_at=now, started_at=now,
                       completed_at=time.time(), pr_numbers=prs, job_id=self.run_seq)
        self.runs.append(run)
        self.logs[run.id] = log
        return run

    # -- repository setup --
    async def viewer(self) -> str:
        return "fake-user"

    async def repo_info(self) -> dict | None:
        return {"description": self.description, "private": False} if self.exists else None

    async def create_repo(self, description: str) -> dict:
        self.calls.append("create_repo")
        os.makedirs(self.root, exist_ok=True)
        if os.path.exists(self.bare):
            shutil.rmtree(self.bare)
        subprocess.run(["git", "init", "-q", "--bare", self.bare], check=True)
        self.exists, self.description = True, description
        return {"html_url": self.html_url}

    async def configure_repo(self) -> None:
        self.calls.append("configure_repo")

    async def rulesets(self) -> list[dict]:
        return [self.ruleset] if self.ruleset else []

    async def put_ruleset(self, body: dict) -> dict:
        self.calls.append("put_ruleset")
        self.ruleset = dict(body)
        return self.ruleset

    async def disable_ruleset(self) -> None:
        self.calls.append("disable_ruleset")
        if self.ruleset:
            self.ruleset["enforcement"] = "disabled"

    async def open_prs(self) -> list[dict]:
        return [{"number": n} for n, p in self.prs.items() if p.state == "OPEN"]

    # -- per-task --
    async def create_pr(self, head: str, title: str, body: str) -> tuple[int, str]:
        self.calls.append("create_pr")
        number = max(self.prs, default=0) + 1
        self.prs[number] = FakePR(number, head, self.ref(head))
        return number, self.prs[number].node_id

    def by_node(self, node_id: str) -> FakePR:
        return next(p for p in self.prs.values() if p.node_id == node_id)

    async def enable_auto_merge(self, node_id: str) -> str | None:
        self.calls.append("enable_auto_merge")
        if self.refuse_auto_merge:
            return "Auto-merge is not allowed for this repository"
        pr = self.by_node(node_id)
        if pr.queued:
            return "Pull request is already queued"
        pr.auto = True
        return None

    async def enqueue(self, node_id: str, head_oid: str) -> str | None:
        self.calls.append("enqueue")
        pr = self.by_node(node_id)
        if pr.queued:
            return "Pull request is already in the merge queue"
        if pr.head != head_oid:
            return "Head sha didn't match expected head oid"
        if pr.mergeable == "CONFLICTING":
            return "Pull request has merge conflicts and Pull request not in mergeable state"
        if not pr.check_green.get(pr.head):
            return "Pull request has failing required statuses"
        self.add_to_queue(pr)
        return None

    async def close_pr(self, number: int, comment: str | None = None) -> None:
        self.calls.append("close_pr")
        pr = self.prs[number]
        if pr.queued:
            self.remove(pr, "dequeued")
        pr.state = "CLOSED"

    # -- the tick --
    def add_to_queue(self, pr: FakePR) -> None:
        pr.queued, pr.auto = True, False
        self.queue.append(pr.number)
        pr.events.append(QueueEvent("added", time.time()))

    def remove(self, pr: FakePR, reason: str) -> None:
        pr.queued = False
        if pr.number in self.queue:
            self.queue.remove(pr.number)
        pr.events.append(QueueEvent("removed", time.time(), reason))

    def tick(self) -> None:
        main = self.main()
        if not main:
            return
        for pr, commit in self.merging:
            pr.state, pr.merged_at, pr.merge_commit = "MERGED", time.time(), commit
        self.merging = []
        for pr in self.prs.values():
            if pr.state != "OPEN":
                continue
            pr.head = self.ref(pr.branch)
            tree = self.merge_tree(None, main, pr.head)
            pr.mergeable = "MERGEABLE" if tree else "CONFLICTING"
            if pr.queued and pr.head != pr.checked_head:  # a push removes the PR from the queue
                self.remove(pr, "dequeued")
            if tree and pr.head != pr.checked_head:
                pr.checked_head = pr.head
                merge = self.git("commit-tree", tree, "-p", main, "-p", pr.head, "-m", f"Merge {pr.head} into main")
                run = self.add_run("pull_request", pr.head, pr.branch, [pr.number], suite_sha=merge)
                pr.check_green[pr.head] = run.conclusion == "success"
            if pr.auto and not pr.queued and pr.check_green.get(pr.head) and pr.mergeable == "MERGEABLE":
                self.add_to_queue(pr)
        self.process_queue(main)

    def process_queue(self, main: str) -> None:
        if not self.queue:
            return
        if len(self.queue) < self.min_group and self.held < 100:
            self.held += 1
            return
        self.held = 0
        k = int(((self.ruleset or {}).get("rules") or [{}])[0].get("parameters", {}).get("max_entries_to_merge", 4))
        cur, green = main, []
        for number in list(self.queue[:k]):
            pr = self.prs[number]
            base = self.git("merge-base", pr.head, cur)
            tree = self.merge_tree(base, cur, pr.head)
            if tree is None:
                self.remove(pr, "merge_conflict")
                continue
            commit = self.git("commit-tree", tree, "-p", cur, "-m", f"Probe squash of #{number} (#{number})")
            run = self.add_run("merge_group", commit, f"gh-readonly-queue/main/pr-{number}-{cur}", [])
            if run.conclusion != "success":
                self.remove(pr, "failed_checks")
                break
            green.append((pr, commit))
            cur = commit
        if green:
            self.git("update-ref", "refs/heads/main", cur)
            for pr, commit in green:
                self.remove(pr, "merged")
                if self.merge_lag:  # as GitHub: the removal shows a poll before the PR reads MERGED
                    pr.mergeable, pr.checked_head = "CONFLICTING", pr.head
                    self.merging.append((pr, commit))
                else:
                    pr.state, pr.merged_at, pr.merge_commit = "MERGED", time.time(), commit

    async def snapshot(self) -> Snapshot:
        self.tick()
        prs = {}
        for n, p in self.prs.items():
            pos = self.queue.index(n) + 1 if n in self.queue else None
            prs[n] = PRState(number=n, node_id=p.node_id, head_oid=p.head, state=p.state,
                             merged=p.state == "MERGED", merged_at=p.merged_at, merge_commit=p.merge_commit,
                             mergeable="UNKNOWN" if p.state == "MERGED" else p.mergeable, auto_merge=p.auto,
                             queue_state="QUEUED" if pos else None, queue_position=pos,
                             queue_events=list(p.events))
        return Snapshot(prs=prs, runs=list(self.runs), main_sha=self.main(), at=time.time())

    async def run_job(self, run_id: int) -> dict | None:
        run = next(r for r in self.runs if r.id == run_id)
        return {"id": run_id, "started_at": iso(run.started_at or 0), "completed_at": iso(run.completed_at or 0)}

    async def job_log(self, job_id: int) -> str:
        return self.logs.get(job_id, "")
