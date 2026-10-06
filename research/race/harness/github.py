"""GitHub as a forge for the race (``--forge github``): the client the GitHub arm drives.

Everything GitHub does for the arm goes through one of two clients with the same methods:

* ``GhClient``: the real github.com, through the ``gh`` CLI (Coop's login). The driver never reads the token: REST and
  GraphQL calls are ``gh api`` subprocesses, and git pushes use ``gh auth git-credential`` as the credential helper,
  set through ``GIT_CONFIG_*`` environment variables on the driver's own git processes only. Agents work in local
  worktrees with no remote configured and never see either.
* ``tests/fake_github.py``: an in-process fake with a local bare repo, a merge queue and a suite runner, for tests.

The race reads GitHub's state by polling (``snapshot``), not webhooks: a laptop has no public endpoint. One poll is one
GraphQL query (our PRs, their merge-queue entries and add/remove timeline events) plus one REST page of Actions runs.

Rate limits (GitHub docs, 2026-10-06): about 6 pushes per minute per repo recommended, 80 content-creating requests per
minute and 500 per hour (secondary), 5,000 REST requests and 5,000 GraphQL points per hour. ``Limiter`` spaces pushes
(``push_interval``) and mutations (``mutation_interval``), counts them per hour, and every 403/429 that GitHub marks as
a rate limit is retried after its ``retry-after`` (or 60 s) and reported through ``on_event('gh.rate_limited', ...)``.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import os
import re
import subprocess
import time
from dataclasses import dataclass, field
from typing import Callable

RULESET_NAME = "beanstalk-race-queue"
WORKFLOW_PATH = ".github/workflows/suite.yml"
CHECK_NAME = "suite"
DEFAULT_TEST_CMD = "node --test --test-timeout=60000 --test-reporter=spec"


def workflow_yaml(test_cmd: str = DEFAULT_TEST_CMD, node_version: str = "25", install: str | None = None) -> str:
    """The arena's suite as an Actions workflow on ``pull_request`` and ``merge_group``: one job, one required check
    name for both events. ``concurrency`` cancels a PR's superseded run when it is pushed again (merge-group refs are
    unique, so group runs never cancel each other)."""
    steps = ["      - uses: actions/checkout@v4",
             "      - uses: actions/setup-node@v4",
             "        with:",
             f'          node-version: "{node_version}"']
    if install:
        steps += ["      - name: install", f"        run: {install}"]
    steps += [f"      - name: {CHECK_NAME}", f"        run: {test_cmd}", "        env:", '          CI: "1"']
    return "\n".join([
        "name: suite",
        "on:",
        "  pull_request:",
        "  merge_group:",
        "concurrency:",
        "  group: suite-${{ github.ref }}",
        "  cancel-in-progress: true",
        "permissions:",
        "  contents: read",
        "jobs:",
        f"  {CHECK_NAME}:",
        "    runs-on: ubuntu-latest",
        "    timeout-minutes: 20",
        "    steps:",
        *steps, ""])


def ruleset_body(build_concurrency: int, max_merge: int, *, check_timeout_minutes: int = 30,
                 grouping: str = "ALLGREEN", merge_method: str = "SQUASH", enforcement: str = "active") -> dict:
    """The repository ruleset on ``main``: a merge queue (K = ``build_concurrency`` groups built at once, the Beanstalk
    arm's CI slots; up to ``max_merge`` PRs merged per group, the queue's batch k), the suite as a required check, PRs
    required with no approvals (no human review in either arm), and no force pushes or deletion of main."""
    return {
        "name": RULESET_NAME, "target": "branch", "enforcement": enforcement,
        "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
        "bypass_actors": [],
        "rules": [
            {"type": "merge_queue", "parameters": {
                "check_response_timeout_minutes": check_timeout_minutes, "grouping_strategy": grouping,
                "max_entries_to_build": max(1, build_concurrency), "max_entries_to_merge": max(1, max_merge),
                "merge_method": merge_method, "min_entries_to_merge": 1, "min_entries_to_merge_wait_minutes": 0}},
            {"type": "required_status_checks", "parameters": {
                "strict_required_status_checks_policy": False, "do_not_enforce_on_create": False,
                "required_status_checks": [{"context": CHECK_NAME}]}},
            {"type": "pull_request", "parameters": {
                "required_approving_review_count": 0, "dismiss_stale_reviews_on_push": False,
                "require_code_owner_review": False, "require_last_push_approval": False,
                "required_review_thread_resolution": False, "allowed_merge_methods": ["squash"]}},
            {"type": "non_fast_forward"},
            {"type": "deletion"},
        ],
    }


def parse_time(value: str | None) -> float | None:
    """GitHub's ISO timestamp as epoch seconds."""
    if not value:
        return None
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


# ---- state the race reads ---------------------------------------------------------------------------------------

@dataclass
class QueueEvent:
    kind: str                 # added | removed
    at: float | None          # epoch seconds (GitHub's clock)
    reason: str | None = None  # removed: GitHub's raw reason (undocumented values, logged as they come)


@dataclass
class PRState:
    number: int
    node_id: str
    head_oid: str
    state: str                # OPEN | CLOSED | MERGED
    merged: bool = False
    merged_at: float | None = None
    merge_commit: str | None = None
    mergeable: str = "UNKNOWN"   # MERGEABLE | CONFLICTING | UNKNOWN
    auto_merge: bool = False
    queue_state: str | None = None    # MergeQueueEntryState while queued: QUEUED, AWAITING_CHECKS, MERGEABLE, ...
    queue_position: int | None = None
    queue_events: list[QueueEvent] = field(default_factory=list)


@dataclass
class RunState:
    id: int
    event: str                # pull_request | merge_group | ...
    head_sha: str
    head_branch: str
    status: str               # queued | in_progress | completed | ...
    conclusion: str | None    # success | failure | cancelled | timed_out | ...
    created_at: float | None
    started_at: float | None = None
    completed_at: float | None = None
    pr_numbers: list[int] = field(default_factory=list)
    job_id: int | None = None

    @property
    def group_pr(self) -> int | None:
        """The PR whose queue entry a merge-group run tests (``gh-readonly-queue/main/pr-12-<sha>``)."""
        m = re.search(r"/pr-(\d+)-", self.head_branch or "")
        return int(m.group(1)) if m else None


@dataclass
class Snapshot:
    prs: dict[int, PRState]
    runs: list[RunState]
    main_sha: str | None = None
    at: float = 0.0


class GitHubError(RuntimeError):
    def __init__(self, what: str, status: int | None, message: str):
        self.what, self.status, self.message = what, status, message
        super().__init__(f"{what}: {status if status is not None else 'error'} {message[:600]}")


# ---- rate limiting ------------------------------------------------------------------------------------------------

class Limiter:
    """Spaces pushes and mutations and counts calls; every wait is reported, so throttling is measured."""

    def __init__(self, push_interval: float = 10.0, mutation_interval: float = 1.0, mutations_per_hour: int = 450,
                 clock: Callable[[], float] = time.monotonic):
        self.push_interval, self.mutation_interval = push_interval, mutation_interval
        self.mutations_per_hour = mutations_per_hour
        self.clock = clock
        self.push_lock = asyncio.Lock()
        self.mutation_lock = asyncio.Lock()
        self.last_push = -1e9
        self.last_mutation = -1e9
        self.mutation_times: list[float] = []
        self.stats = {"pushes": 0, "push_wait_s": 0.0, "mutations": 0, "mutation_wait_s": 0.0, "queries": 0,
                      "rest": 0, "rate_limited": 0, "retry_after_s": 0.0, "hourly_cap_waits": 0}

    async def push(self) -> float:
        async with self.push_lock:
            wait = max(0.0, self.last_push + self.push_interval - self.clock())
            if wait:
                await asyncio.sleep(wait)
            self.last_push = self.clock()
            self.stats["pushes"] += 1
            self.stats["push_wait_s"] += wait
            return wait

    async def mutation(self) -> float:
        async with self.mutation_lock:
            now = self.clock()
            wait = max(0.0, self.last_mutation + self.mutation_interval - now)
            self.mutation_times = [t for t in self.mutation_times if t > now - 3600]
            if len(self.mutation_times) >= self.mutations_per_hour:
                wait = max(wait, self.mutation_times[0] + 3600 - now)
                self.stats["hourly_cap_waits"] += 1
            if wait:
                await asyncio.sleep(wait)
            self.last_mutation = self.clock()
            self.mutation_times.append(self.last_mutation)
            self.stats["mutations"] += 1
            self.stats["mutation_wait_s"] += wait
            return wait


# ---- the real client: gh CLI ----------------------------------------------------------------------------------------

POLL_QUERY = """
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef { target { oid } }
    pullRequests(first: 100, orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes {
        number id headRefOid state merged mergedAt mergeable
        mergeCommit { oid }
        autoMergeRequest { enabledAt }
        mergeQueueEntry { state position enqueuedAt }
        timelineItems(last: 50, itemTypes: [ADDED_TO_MERGE_QUEUE_EVENT, REMOVED_FROM_MERGE_QUEUE_EVENT]) {
          nodes {
            __typename
            ... on AddedToMergeQueueEvent { createdAt }
            ... on RemovedFromMergeQueueEvent { createdAt reason }
          }
        }
      }
    }
  }
}"""

RATE_LIMIT_TEXT = re.compile(r"secondary rate limit|rate limit exceeded|abuse detection|was submitted too quickly",
                             re.I)


def parse_pr(node: dict) -> PRState:
    events = []
    for item in ((node.get("timelineItems") or {}).get("nodes") or []):
        typ = item.get("__typename")
        if typ == "AddedToMergeQueueEvent":
            events.append(QueueEvent("added", parse_time(item.get("createdAt"))))
        elif typ == "RemovedFromMergeQueueEvent":
            events.append(QueueEvent("removed", parse_time(item.get("createdAt")), item.get("reason")))
    entry = node.get("mergeQueueEntry") or {}
    return PRState(number=int(node["number"]), node_id=node["id"], head_oid=node.get("headRefOid") or "",
                   state=node.get("state") or "OPEN", merged=bool(node.get("merged")),
                   merged_at=parse_time(node.get("mergedAt")), merge_commit=(node.get("mergeCommit") or {}).get("oid"),
                   mergeable=node.get("mergeable") or "UNKNOWN", auto_merge=bool(node.get("autoMergeRequest")),
                   queue_state=entry.get("state"), queue_position=entry.get("position"), queue_events=events)


def parse_run(raw: dict) -> RunState:
    return RunState(id=int(raw["id"]), event=raw.get("event") or "", head_sha=raw.get("head_sha") or "",
                    head_branch=raw.get("head_branch") or "", status=raw.get("status") or "",
                    conclusion=raw.get("conclusion"), created_at=parse_time(raw.get("created_at")),
                    started_at=parse_time(raw.get("run_started_at")),
                    completed_at=parse_time(raw.get("updated_at")) if raw.get("status") == "completed" else None,
                    pr_numbers=[int(p["number"]) for p in raw.get("pull_requests") or [] if p.get("number")])


def parse_snapshot(data: dict, runs: list[dict], at: float) -> Snapshot:
    repo = (data.get("data") or data).get("repository") or {}
    prs = {}
    for node in (repo.get("pullRequests") or {}).get("nodes") or []:
        pr = parse_pr(node)
        prs[pr.number] = pr
    main = ((repo.get("defaultBranchRef") or {}).get("target") or {}).get("oid")
    return Snapshot(prs=prs, runs=[parse_run(r) for r in runs], main_sha=main, at=at)


ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
LOG_STAMP = re.compile(r"^\d{4}-\d\d-\d\dT[\d:.]+Z ?")


def failures_from_log(text: str) -> tuple[list[str], str]:
    """Failing tests and an output excerpt from an Actions job log of ``node --test --test-reporter=spec``.

    The spec reporter repeats every failure after a ``failing tests:`` line as ``✖ name (ms)`` with the file above it
    (``test at src/x.test.ts:3:1``). Names are returned as ``file > name`` like the harness's CI, when a file is
    found."""
    lines = [LOG_STAMP.sub("", ANSI.sub("", ln)) for ln in text.splitlines()]
    start = next((i for i, ln in enumerate(lines) if "failing tests:" in ln), None)
    body = lines[start:] if start is not None else lines[-200:]
    end = next((i for i, ln in enumerate(body) if ln.startswith(("##[error]", "Post job cleanup"))), len(body))
    body = body[:end]
    failing: list[str] = []
    file = None
    for ln in body:
        fm = re.match(r"\s*test at (?:file://)?(?:/home/runner/work/[^/]+/[^/]+/)?([^\s:]+\.\w+):\d+", ln)
        if fm:
            file = fm.group(1)
            continue
        m = re.match(r"\s*✖ (.+?)(?: \([\d.]+m?s\))?$", ln)
        if not m or m.group(1).strip() == "failing tests:":
            continue
        name = m.group(1).strip()
        item = f"{file} > {name}" if file else name
        file = None
        if item not in failing:
            failing.append(item)
    excerpt = "\n".join(body).strip()
    if len(excerpt) > 7000:
        excerpt = excerpt[:7000] + f"\n... [{len(excerpt) - 7000} more chars]"
    return failing[:30], excerpt


class GhClient:
    """github.com through the ``gh`` CLI. Synchronous calls run in a thread; ``on_event`` receives ``gh.*`` events."""

    name = "github"

    def __init__(self, owner: str, repo: str, *, limiter: Limiter | None = None, gh: str = "gh",
                 on_event: Callable[..., None] | None = None):
        self.owner, self.repo, self.gh = owner, repo, gh
        self.limiter = limiter or Limiter()
        self.on_event = on_event or (lambda *a, **k: None)
        self.since_iso: str | None = None

    @property
    def full(self) -> str:
        return f"{self.owner}/{self.repo}"

    @property
    def push_url(self) -> str:
        return f"https://github.com/{self.full}.git"

    @property
    def html_url(self) -> str:
        return f"https://github.com/{self.full}"

    @staticmethod
    def git_env() -> dict:
        """Driver-only git environment: the gh CLI as the only credential helper (the token never enters this
        process's memory, a config file or argv)."""
        return {"GIT_CONFIG_COUNT": "2", "GIT_CONFIG_KEY_0": "credential.helper", "GIT_CONFIG_VALUE_0": "",
                "GIT_CONFIG_KEY_1": "credential.helper", "GIT_CONFIG_VALUE_1": "!gh auth git-credential",
                "GIT_TERMINAL_PROMPT": "0"}

    # -- transport --

    def _call(self, args: list[str], body: object | None, what: str) -> tuple[int, dict, object]:
        argv = [self.gh, "api", "--include", *args]
        if body is not None:
            argv += ["--input", "-"]
        try:
            proc = subprocess.run(argv, input=json.dumps(body) if body is not None else None, capture_output=True,
                                  text=True, timeout=120)
        except subprocess.TimeoutExpired:
            raise GitHubError(what, None, "gh api timed out after 120 s") from None
        status, headers, payload = parse_include(proc.stdout)
        if status is None:
            status = 0 if proc.returncode == 0 else None
        if proc.returncode != 0 and status in (None, 0):
            raise GitHubError(what, None, (proc.stderr or proc.stdout).strip())
        return status or 200, headers, payload

    async def request(self, method: str, path: str, body: object | None = None, *, mutation: bool = False,
                      what: str | None = None, ok: tuple[int, ...] = ()) -> object:
        what = what or f"{method} {path}"
        for attempt in range(6):
            if mutation:
                await self.limiter.mutation()
            self.limiter.stats["rest" if path != "graphql" else "queries"] += 1
            try:
                status, headers, payload = await asyncio.to_thread(self._call, ["-X", method, path], body, what)
            except GitHubError as e:  # no HTTP answer (network, timeout): retry a few times
                if e.status is not None or attempt >= 3:
                    raise
                await asyncio.sleep(3.0 * (attempt + 1))
                continue
            text = json.dumps(payload)[:2000] if not isinstance(payload, str) else payload[:2000]
            if status in (403, 429) and (RATE_LIMIT_TEXT.search(text) or "retry-after" in headers
                                         or headers.get("x-ratelimit-remaining") == "0"):
                retry = float(headers.get("retry-after") or 0) or (
                    max(1.0, float(headers.get("x-ratelimit-reset", 0)) - time.time())
                    if headers.get("x-ratelimit-remaining") == "0" else 60.0)
                retry = min(retry, 900.0)
                self.limiter.stats["rate_limited"] += 1
                self.limiter.stats["retry_after_s"] += retry
                self.on_event("gh.rate_limited", what=what, status=status, retry_after=retry, attempt=attempt + 1,
                              message=text[:300])
                await asyncio.sleep(retry)
                continue
            if status >= 500 and attempt < 3:
                await asyncio.sleep(2.0 * (attempt + 1))
                continue
            if status >= 400 and status not in ok:
                raise GitHubError(what, status, text)
            if path == "graphql" and isinstance(payload, dict) and payload.get("errors"):
                msg = json.dumps(payload["errors"])[:1500]
                if RATE_LIMIT_TEXT.search(msg) and attempt < 5:
                    self.limiter.stats["rate_limited"] += 1
                    self.limiter.stats["retry_after_s"] += 60
                    self.on_event("gh.rate_limited", what=what, status=status, retry_after=60, attempt=attempt + 1,
                                  message=msg[:300])
                    await asyncio.sleep(60)
                    continue
                raise GitHubError(what, status, msg)
            return payload
        raise GitHubError(what, 429, "still rate limited after retries")

    async def graphql(self, query: str, variables: dict, *, mutation: bool = False, what: str = "graphql") -> dict:
        res = await self.request("POST", "graphql", {"query": query, "variables": variables}, mutation=mutation,
                                 what=what)
        return res if isinstance(res, dict) else {}

    # -- repository setup --

    async def viewer(self) -> str:
        res = await self.request("GET", "user")
        return str((res or {}).get("login"))  # type: ignore[union-attr]

    async def repo_info(self) -> dict | None:
        try:
            res = await self.request("GET", f"repos/{self.full}")
        except GitHubError as e:
            if e.status == 404:
                return None
            raise
        return res if isinstance(res, dict) else None

    async def create_repo(self, description: str) -> dict:
        res = await self.request("POST", f"orgs/{self.owner}/repos", {
            "name": self.repo, "description": description, "visibility": "public", "has_issues": False,
            "has_projects": False, "has_wiki": False, "auto_init": False, "allow_squash_merge": True,
            "allow_merge_commit": False, "allow_rebase_merge": False, "allow_auto_merge": True,
            "delete_branch_on_merge": False}, mutation=True)
        return res if isinstance(res, dict) else {}

    async def configure_repo(self) -> None:
        await self.request("PATCH", f"repos/{self.full}", {
            "allow_squash_merge": True, "allow_merge_commit": False, "allow_rebase_merge": False,
            "allow_auto_merge": True, "delete_branch_on_merge": False, "has_issues": False, "has_wiki": False},
            mutation=True)

    async def rulesets(self) -> list[dict]:
        res = await self.request("GET", f"repos/{self.full}/rulesets")
        return res if isinstance(res, list) else []

    async def put_ruleset(self, body: dict) -> dict:
        existing = [r for r in await self.rulesets() if r.get("name") == body["name"]]
        if existing:
            res = await self.request("PUT", f"repos/{self.full}/rulesets/{existing[0]['id']}", body, mutation=True)
        else:
            res = await self.request("POST", f"repos/{self.full}/rulesets", body, mutation=True)
        return res if isinstance(res, dict) else {}

    async def disable_ruleset(self) -> None:
        for r in await self.rulesets():
            if r.get("name") == RULESET_NAME:
                await self.request("PUT", f"repos/{self.full}/rulesets/{r['id']}", {"enforcement": "disabled"},
                                   mutation=True)

    async def open_prs(self) -> list[dict]:
        res = await self.request("GET", f"repos/{self.full}/pulls?state=open&per_page=100")
        return res if isinstance(res, list) else []

    # -- per-task operations --

    async def create_pr(self, head: str, title: str, body: str) -> tuple[int, str]:
        res = await self.request("POST", f"repos/{self.full}/pulls", {
            "title": title, "head": head, "base": "main", "body": body, "maintainer_can_modify": False},
            mutation=True)
        assert isinstance(res, dict)
        return int(res["number"]), str(res["node_id"])

    async def enable_auto_merge(self, node_id: str) -> str | None:
        """``gh pr merge --auto``: the PR joins the merge queue as soon as its own check is green. Returns None, or
        GitHub's message when it refused (already queued, already enabled, not mergeable)."""
        q = ("mutation($id: ID!) { enablePullRequestAutoMerge(input: {pullRequestId: $id, mergeMethod: SQUASH}) "
             "{ pullRequest { number } } }")
        try:
            await self.graphql(q, {"id": node_id}, mutation=True, what="enablePullRequestAutoMerge")
        except GitHubError as e:
            return e.message[:500]
        return None

    async def enqueue(self, node_id: str, head_oid: str) -> str | None:
        q = ("mutation($id: ID!, $oid: GitObjectID) { enqueuePullRequest(input: {pullRequestId: $id, "
             "expectedHeadOid: $oid}) { mergeQueueEntry { position } } }")
        try:
            await self.graphql(q, {"id": node_id, "oid": head_oid}, mutation=True, what="enqueuePullRequest")
        except GitHubError as e:
            return e.message[:500]
        return None

    async def close_pr(self, number: int, comment: str | None = None) -> None:
        if comment:
            await self.request("POST", f"repos/{self.full}/issues/{number}/comments", {"body": comment},
                               mutation=True)
        await self.request("PATCH", f"repos/{self.full}/pulls/{number}", {"state": "closed"}, mutation=True)

    # -- observation --

    async def snapshot(self) -> Snapshot:
        data = await self.graphql(POLL_QUERY, {"owner": self.owner, "name": self.repo}, what="poll")
        path = f"repos/{self.full}/actions/runs?per_page=100"
        if self.since_iso:
            path += f"&created=%3E%3D{self.since_iso}"
        runs = await self.request("GET", path, what="runs")
        raw = (runs or {}).get("workflow_runs") or [] if isinstance(runs, dict) else []
        return parse_snapshot(data, raw, time.time())

    async def run_job(self, run_id: int) -> dict | None:
        res = await self.request("GET", f"repos/{self.full}/actions/runs/{run_id}/jobs")
        jobs = (res or {}).get("jobs") or [] if isinstance(res, dict) else []
        return jobs[0] if jobs else None

    async def job_log(self, job_id: int) -> str:
        res = await self.request("GET", f"repos/{self.full}/actions/jobs/{job_id}/logs", what="job log")
        return res if isinstance(res, str) else json.dumps(res)


def parse_include(out: str) -> tuple[int | None, dict, object]:
    """Split ``gh api --include`` output into (status, lower-case headers, JSON body or text). A redirect followed by
    gh shows several header blocks; the last one wins."""
    status, headers = None, {}
    rest = out
    while rest.startswith("HTTP/"):
        head, sep, body = rest.partition("\r\n\r\n")
        if not sep:
            head, sep, body = rest.partition("\n\n")
        lines = head.splitlines()
        m = re.match(r"HTTP/[\d.]+ (\d+)", lines[0])
        status = int(m.group(1)) if m else None
        headers = {}
        for ln in lines[1:]:
            k, _, v = ln.partition(":")
            headers[k.strip().lower()] = v.strip()
        rest = body
    text = rest.strip()
    if not text:
        return status, headers, {}
    try:
        return status, headers, json.loads(text)
    except json.JSONDecodeError:
        return status, headers, rest
