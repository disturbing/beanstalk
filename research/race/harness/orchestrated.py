"""Orchestrated races: one real coding-agent session per forge gets the whole backlog and its own subagents.

No driver, no slots, no start order from us. Our code only:

1. creates the repository on the forge from the arena's base (GitHub: a public repo in an org with the merge queue
   and the suite workflow, as ``forge_github``; Beanstalk: a repository engine with the arena's suite);
2. clones it as the orchestrator's working tree, writes ``BACKLOG.md`` there (every task's prompt and acceptance
   tests; kept out of git), and starts the orchestrator (Claude Code with a ``worker`` subagent type; same model, same
   N, same prompt except the forge section, same budget and wall caps, on the local CLI login);
3. records the session transcript, waits for the forge to settle, and measures from the forge side
   (``orch_measure``): ready -> integrated per change, integration rework, throughput, and green per task by replaying
   the integration line with the hidden acceptance tests. ``kth_green.py`` reads the output.

Credentials: GitHub through the gh CLI's own login (the driver never reads a token; the orchestrator's clone uses
``gh auth git-credential`` as its helper, and gh's admin commands are denied to it). Beanstalk: a git token for the one
repository in ``BEANSTALK_TOKEN`` of the orchestrator's environment, read by the clone's credential helper.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import os
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field

from . import orch_measure as M
from . import orch_prompt
from . import suite as suite_mod
from .agents import agent_env
from .arena import Task, load_tasks
from .core import resolve_out, snapshot_arena

CLAUDE_TOOLS = "Read,Edit,Write,Glob,Grep,Bash,Agent,TodoWrite"
DENIED = ["Bash(gh repo:*)", "Bash(gh api:*)", "Bash(gh auth:*)", "Bash(gh secret:*)", "Bash(gh ruleset:*)",
          "Bash(gh org:*)", "Bash(gh workflow:*)", "Bash(gh variable:*)", "Bash(git push origin main*)",
          "Bash(git push origin HEAD:main*)", "Bash(git config --global*)", "Bash(curl:*)", "Bash(wget:*)",
          "WebFetch", "WebSearch"]
PRS_QUERY = """
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: 100, orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes {
        number title body createdAt headRefName state merged mergedAt
        mergeCommit { oid }
        commits(first: 100) { nodes { commit { oid committedDate } } }
        timelineItems(last: 100, itemTypes: [ADDED_TO_MERGE_QUEUE_EVENT, REMOVED_FROM_MERGE_QUEUE_EVENT,
                                               HEAD_REF_FORCE_PUSHED_EVENT]) {
          nodes {
            __typename
            ... on AddedToMergeQueueEvent { createdAt }
            ... on RemovedFromMergeQueueEvent { createdAt reason }
            ... on HeadRefForcePushedEvent { createdAt }
          }
        }
      }
    }
  }
}"""


@dataclass
class OrchConfig:
    forge: str                       # github | beanstalk
    arena: str
    repo: str                        # the materialized arena repository (main = base)
    tasks: list[str] | None
    out: str
    seed: int = 7
    orchestrator: str = "claude"
    model: str = "sonnet"
    worker_model: str = "sonnet"
    subagents: int = 4
    max_usd: float = 20.0
    max_wall_minutes: float = 90.0
    drain_minutes: float = 15.0
    gh_owner: str | None = None
    gh_repo: str | None = None
    ci_slots: int = 2
    batch: int = 4
    gateway: str | None = None
    beanstalk_owner: str = "race"
    force: bool = False
    claude_bin: str = "claude"
    extra: dict = field(default_factory=dict)


def iso_epoch(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def run_git(cwd: str, *args: str, env: dict | None = None, check: bool = True) -> str:
    res = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True,
                         env={**os.environ, **(env or {}), "GIT_TERMINAL_PROMPT": "0"})
    if check and res.returncode != 0:
        raise RuntimeError(f"git {' '.join(args[:3])}: {res.stderr.strip()[:500]}")
    return res.stdout


IDENTITY = ["-c", "user.name=race-harness", "-c", "user.email=race@beanstalk.invalid", "-c", "commit.gpgsign=false"]


# ---- forges -------------------------------------------------------------------------------------------------------

class GitHubForge:
    """A public repo in ``gh_owner`` with the merge queue (K = ci_slots, batch) and the suite workflow."""

    name = "github"

    def __init__(self, cfg: OrchConfig, work: str):
        from .github import GhClient
        self.cfg, self.work = cfg, work
        arena_name = os.path.basename(os.path.normpath(cfg.arena))
        self.repo = cfg.gh_repo or f"beanstalk-orch-{arena_name}-{cfg.seed}"
        self.client = GhClient(cfg.gh_owner or "", self.repo)
        self.ignore: set[int] = set()
        self.line = "main"

    @property
    def url(self) -> str:
        return f"https://github.com/{self.client.full}"

    @property
    def clone_url(self) -> str:
        return self.client.push_url

    def clone_config(self) -> list[tuple[str, str]]:
        return [("credential.helper", ""), ("credential.helper", "!gh auth git-credential")]

    def agent_env(self) -> dict:
        return {}

    def setup(self, base_dir: str) -> str:
        """Push the GitHub base (arena base + workflow, upstream automation removed) and the ruleset; the base sha."""
        from .forge_github import REPO_MARKER, arena_ci
        from .github import WORKFLOW_PATH, ruleset_body, workflow_yaml
        removed = []
        gh_dir = os.path.join(base_dir, ".github")
        for root, _d, names in os.walk(os.path.join(gh_dir, "workflows")):
            removed += [os.path.relpath(os.path.join(root, n), base_dir) for n in names]
        removed += [f".github/{n}" for n in ("dependabot.yml", "dependabot.yaml") if os.path.exists(os.path.join(gh_dir, n))]
        if removed:
            run_git(base_dir, "rm", "-q", "--", *removed)
        cmd, node, install, extra = arena_ci(self.cfg.arena)
        for rel, content in extra.items():
            os.makedirs(os.path.dirname(os.path.join(base_dir, rel)), exist_ok=True)
            with open(os.path.join(base_dir, rel), "w", encoding="utf-8") as fh:
                fh.write(content)
        os.makedirs(os.path.join(base_dir, os.path.dirname(WORKFLOW_PATH)), exist_ok=True)
        with open(os.path.join(base_dir, WORKFLOW_PATH), "w", encoding="utf-8") as fh:
            fh.write(workflow_yaml(cmd, node, install))
        run_git(base_dir, "add", "-f", "-A", "--", ".github")
        run_git(base_dir, *IDENTITY, "commit", "-q", "-m", "ci: the arena suite on pull_request and merge_group")
        base = run_git(base_dir, "rev-parse", "HEAD").strip()

        async def prepare() -> None:
            c = self.client
            info = await c.repo_info()
            if info is None:
                await c.create_repo(f"{REPO_MARKER}: orchestrated race (arena {os.path.basename(self.cfg.arena)})")
            else:
                if not str(info.get("description") or "").startswith(REPO_MARKER):
                    raise SystemExit(f"{c.full} exists and was not created by the race harness")
                await c.disable_ruleset()
                for pr in await c.open_prs():
                    await c.close_pr(int(pr["number"]))
                await c.cancel_active_runs()
            await c.configure_repo()
            res = subprocess.run(["git", "push", "-q", "--no-verify", c.push_url, f"+{base}:refs/heads/main"],
                                 cwd=base_dir, capture_output=True, text=True,
                                 env={**os.environ, **c.git_env()})
            if res.returncode != 0:
                raise RuntimeError(f"base push: {res.stderr[-400:]}")
            # leftover branches from an earlier run would confuse the orchestrator
            heads = subprocess.run(["git", "ls-remote", "--heads", c.push_url], capture_output=True, text=True,
                                   env={**os.environ, **c.git_env()}).stdout.split()
            stale = [h for h in heads[1::2] if h != "refs/heads/main"]
            if stale:
                subprocess.run(["git", "push", "-q", c.push_url, *[f":{h}" for h in stale]], cwd=base_dir,
                               capture_output=True, env={**os.environ, **c.git_env()})
            await c.put_ruleset(ruleset_body(self.cfg.ci_slots, self.cfg.batch))
            await self.warm_up(base_dir, base)
            snap = await c.snapshot()
            self.ignore = set(snap.prs)
            c.since_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 5))

        asyncio.run(prepare())
        return base

    async def warm_up(self, base_dir: str, base: str) -> None:
        """Open a throwaway PR and wait until Actions runs its check: on a repository created a minute earlier,
        GitHub ran no workflow for the first PRs (2026-10-07: two PRs opened 53 s after the workflow was pushed got
        no check until they were reopened). Then close it and delete its branch."""
        c = self.client
        env = {**os.environ, **c.git_env()}
        # a PR with no diff gets no pull_request run, so the probe changes one file
        with open(os.path.join(base_dir, ".github", "race", "warm-up.txt"), "w", encoding="utf-8") as fh:
            fh.write(f"warm-up {time.time()}\n")
        run_git(base_dir, "add", "-f", ".github/race/warm-up.txt")
        run_git(base_dir, *IDENTITY, "commit", "-q", "-m", "harness: warm-up (not a task)")
        probe = run_git(base_dir, "rev-parse", "HEAD").strip()
        run_git(base_dir, "reset", "-q", "--hard", base)
        subprocess.run(["git", "push", "-q", "-f", c.push_url, f"{probe}:refs/heads/harness-warmup"], cwd=base_dir,
                       capture_output=True, env=env, check=True)
        number, _ = await c.create_pr("harness-warmup", "harness: warm-up (not a task)",
                                      "Opened by the race harness to check that Actions runs on this repository.")
        deadline = time.time() + 600
        saw = False
        reopened = False
        while time.time() < deadline:
            res = await c.request("GET", f"repos/{c.full}/actions/runs?branch=harness-warmup&per_page=5")
            if (res or {}).get("total_count"):
                saw = True
                break
            if not reopened and time.time() > deadline - 480:
                await c.request("PATCH", f"repos/{c.full}/pulls/{number}", {"state": "closed"}, mutation=True)
                await c.request("PATCH", f"repos/{c.full}/pulls/{number}", {"state": "open"}, mutation=True)
                reopened = True
            await asyncio.sleep(10)
        await c.cancel_active_runs()
        await c.close_pr(number)
        subprocess.run(["git", "push", "-q", c.push_url, ":refs/heads/harness-warmup"], cwd=base_dir,
                       capture_output=True, env=env)
        self.warmup = {"pr": number, "check_ran": saw, "reopened": reopened}
        if not saw:
            raise SystemExit(f"{c.full}: Actions never ran the suite on a warm-up PR")

    def busy(self) -> bool:
        """A PR still open with auto-merge or in the queue (the forge has not settled)."""
        async def check() -> bool:
            snap = await self.client.snapshot()
            return any(p.state == "OPEN" and (p.queue_state is not None or p.auto_merge)
                       for n, p in snap.prs.items() if n not in self.ignore)
        return asyncio.run(check())

    def fetch_line(self, repo: str) -> tuple[str, dict[str, float]]:
        """``main`` and, per merge commit, when its PR merged: the merge queue's squash commits carry an earlier
        committer date (seen 2026-10-07: up to 2 min before ``mergedAt``), so the commit date is not the merge."""
        run_git(repo, "fetch", "-q", "--no-tags", self.clone_url, "+refs/heads/main:refs/remotes/forge/main",
                env=self.client.git_env())
        data = asyncio.run(self.client.graphql(PRS_QUERY, {"owner": self.client.owner, "name": self.client.repo},
                                               what="prs"))
        nodes = (((data.get("data") or {}).get("repository") or {}).get("pullRequests") or {}).get("nodes") or []
        merged = {(n.get("mergeCommit") or {}).get("oid"): iso_epoch(n.get("mergedAt")) for n in nodes
                  if n.get("merged") and n.get("mergeCommit")}
        return "refs/remotes/forge/main", {sha: at for sha, at in merged.items() if sha and at}

    def collect(self, start: float) -> tuple[list[M.Change], list[dict]]:
        async def gather() -> tuple[dict, list]:
            c = self.client
            data = await c.graphql(PRS_QUERY, {"owner": c.owner, "name": c.repo}, what="prs")
            snap = await c.snapshot()
            jobs = {}
            for run in snap.runs:
                if run.status == "completed" and run.event in ("pull_request", "merge_group"):
                    jobs[run.id] = await c.run_job(run.id)
            return data, [(r, jobs.get(r.id)) for r in snap.runs]
        data, runs = asyncio.run(gather())
        changes: list[M.Change] = []
        nodes = (((data.get("data") or {}).get("repository") or {}).get("pullRequests") or {}).get("nodes") or []
        by_branch: dict[str, M.Change] = {}
        for n in nodes:
            if int(n["number"]) in self.ignore:
                continue
            events = (n.get("timelineItems") or {}).get("nodes") or []
            adds = [iso_epoch(e["createdAt"]) for e in events if e["__typename"] == "AddedToMergeQueueEvent"]
            removes = [(iso_epoch(e["createdAt"]), (e.get("reason") or "").lower()) for e in events
                       if e["__typename"] == "RemovedFromMergeQueueEvent"]
            task = task_of(f"{n.get('title', '')}\n{n.get('body', '')}")
            ch = M.Change(id=f"#{n['number']}", task=task, ready_at=min([a for a in adds if a] or [None]) if adds
                          else None, integrated_at=iso_epoch(n.get("mergedAt")),
                          created_at=iso_epoch(n.get("createdAt")),
                          kickouts=sum(1 for _, r in removes if r != "merged"),
                          conflicts=sum(1 for _, r in removes if "conflict" in r),
                          pushes=len((n.get("commits") or {}).get("nodes") or []) or 1,
                          state=n.get("state", ""),
                          extra={"branch": n.get("headRefName"), "enqueues": len(adds),
                                 "removals": [r for _, r in removes]})
            changes.append(ch)
            by_branch[n.get("headRefName") or ""] = ch
        ci: list[dict] = []
        for run, job in runs:
            if run.event not in ("pull_request", "merge_group"):
                continue
            started = iso_epoch((job or {}).get("started_at")) or run.started_at
            ended = iso_epoch((job or {}).get("completed_at")) or run.completed_at
            purpose = "precheck" if run.event == "pull_request" else "batch"
            ci.append({"purpose": purpose, "green": run.conclusion == "success" if run.conclusion else None,
                       "start": started, "end": ended, "conclusion": run.conclusion, "id": run.id})
            if run.event == "pull_request" and run.conclusion == "failure":
                ch = by_branch.get(run.head_branch)
                if ch:
                    ch.red_checks += 1
            if run.event == "merge_group" and run.conclusion == "failure":
                pr = run.group_pr
                ch = next((c for c in changes if c.id == f"#{pr}"), None)
                if ch:
                    ch.red_checks += 1
        return changes, ci


class BeanstalkForge:
    """A repository engine on a gateway (the git-native flow), seeded with the arena base."""

    name = "beanstalk"

    def __init__(self, cfg: OrchConfig, work: str):
        from .remote import load_admin_token
        self.cfg, self.work = cfg, work
        self.gateway = (cfg.gateway or os.environ.get("BEANSTALK_GATEWAY") or "").rstrip("/")
        if not self.gateway:
            raise SystemExit("--forge beanstalk needs --gateway")
        self.admin = load_admin_token()
        if not self.admin:
            raise SystemExit("no admin token ($BEANSTALK_ADMIN_TOKEN or packages/gateway/.dev.vars)")
        arena_name = os.path.basename(os.path.normpath(cfg.arena))
        self.repo = cfg.extra.get("bs_repo") or f"orch-{arena_name}-{cfg.seed}-{int(time.time()) % 100000}"
        self.engine = ""
        self.git_path = ""
        self.token = ""
        self.seed_run = ""
        self.line = "sprout"

    def call(self, method: str, path: str, body: dict | None = None, raw: bool = False):
        req = urllib.request.Request(f"{self.gateway}{path}", method=method,
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers={"authorization": f"Bearer {self.admin}",
                                              "content-type": "application/json",
                                              "user-agent": "beanstalk-orchestrated-race"})
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                data = res.read()
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{method} {path}: {e.code} {e.read()[:600].decode(errors='replace')}") from None
        return data.decode() if raw else json.loads(data or b"{}")

    @property
    def url(self) -> str:
        return f"{self.gateway}{self.git_path}"

    @property
    def clone_url(self) -> str:
        return self.url

    def clone_config(self) -> list[tuple[str, str]]:
        return [("credential.helper", ""),
                ("credential.helper", '!f() { echo username=x; echo "password=$BEANSTALK_TOKEN"; }; f')]

    def agent_env(self) -> dict:
        return {"BEANSTALK_TOKEN": self.token}

    def git_env(self) -> dict:
        helper = '!f() { echo username=x; echo "password=$BEANSTALK_TOKEN"; }; f'
        return {"BEANSTALK_TOKEN": self.token, "GIT_CONFIG_COUNT": "2", "GIT_CONFIG_KEY_0": "credential.helper",
                "GIT_CONFIG_VALUE_0": "", "GIT_CONFIG_KEY_1": "credential.helper", "GIT_CONFIG_VALUE_1": helper}

    def setup(self, base_dir: str) -> str:
        """Open a repository engine on the arena base with the arena's suite and mint a git token for the
        orchestrator. The base reaches the repository by import (default): it is pushed to a public GitHub repo
        (``<gh_owner>/beanstalk-race-<arena>-base``) and the gateway's admin route imports it (``import_url``,
        the repository side's "import a public git URL"). ``bs_seed=race-run`` instead seeds a race run's repo
        through its seed token (only where race and repository repos share a namespace: the local stack)."""
        base = run_git(base_dir, "rev-parse", "HEAD").strip()
        suite = suite_mod.gateway_suite(suite_mod.load_suite(self.cfg.arena))
        settings = {**({"suite": suite} if suite else {}), "base_branch": "sprout"}
        preland = self.cfg.extra.get("preland_concurrency")
        if preland:
            # Both arms' check concurrency set explicitly (doc 18 §7.1): pre-land checks at once (GitHub: PR check
            # jobs at once, the Actions limit) and validations at once (GitHub: the merge queue's builds).
            settings["engine"] = {"preland_sandboxes": int(preland), "ci_slots": self.cfg.ci_slots}
        owner = {"id": f"u-{self.cfg.beanstalk_owner}", "handle": self.cfg.beanstalk_owner}
        if self.cfg.extra.get("bs_seed", "import") == "import":
            url = self.publish_base(base_dir, base)
            opened = self.call("POST", "/v1/repos", {"repoName": self.repo, "artifactsRepo": f"repo-{self.repo}",
                                                     "owner": owner, "settings": settings, "import_url": url})
            self.adopt(opened)
            if opened.get("base_sha") != base:
                raise SystemExit(f"imported base {opened.get('base_sha')} is not the arena base {base}")
            return base
        return self.seed_through_race_run(base_dir, base, owner, settings)

    def adopt(self, opened: dict) -> None:
        self.engine, self.git_path = opened["engineId"], opened["git_path"]
        self.token = self.call("POST", f"/v1/repos/{self.engine}/git-token",
                               {"user": {"id": "u-orchestrator", "handle": "orchestrator"},
                                "ttl_seconds": int(self.cfg.max_wall_minutes * 60 + 3600)})["token"]

    def publish_base(self, base_dir: str, base: str) -> str:
        """The arena base as a public GitHub repo the gateway can import (created by the harness if missing)."""
        from .forge_github import REPO_MARKER
        from .github import GhClient
        owner = self.cfg.gh_owner or os.environ.get("BEANSTALK_GH_OWNER")
        if not owner:
            raise SystemExit("--forge beanstalk imports the base from GitHub: pass --gh-owner")
        name = f"beanstalk-race-{os.path.basename(os.path.normpath(self.cfg.arena))}-base"
        c = GhClient(owner, name)

        async def ensure() -> None:
            info = await c.repo_info()
            if info is None:
                await c.create_repo(f"{REPO_MARKER}: the arena base, imported by the Beanstalk arm")
            elif not str(info.get("description") or "").startswith(REPO_MARKER):
                raise SystemExit(f"{c.full} exists and was not created by the race harness")
        asyncio.run(ensure())
        env = {**os.environ, **c.git_env()}
        # the base repo may be archived (read-only, seen 2026-10-08) and already hold the base: push only when not
        head = subprocess.run(["git", "ls-remote", c.push_url, "refs/heads/main"], capture_output=True, text=True,
                              env=env).stdout.split()
        if head[:1] != [base]:
            subprocess.run(["git", "push", "-q", "-f", c.push_url, f"{base}:refs/heads/main"], cwd=base_dir,
                           check=True, capture_output=True, env=env)
        return f"https://github.com/{c.full}.git"

    def seed_through_race_run(self, base_dir: str, base: str, owner: dict, settings: dict) -> str:
        tasks = load_tasks(os.path.join(self.work, "arena"), self.cfg.tasks)
        run = self.call("POST", "/v1/runs", {
            "policy": "beanstalk-v2", "agent": "replay", "agents": 1, "ci_slots": 1, "seed": self.cfg.seed,
            "label": f"seed for {self.repo}", "keep_repo": True, "max_usd": 0.5,
            "tasks": [{"id": t.id, "title": t.title, "prompt": t.prompt, "acceptance_tests": t.acceptance_tests,
                       "oracle_paths": [], "oracle_modules": [], "kind": "", "difficulty": 1, "couplings": []}
                      for t in tasks[:1]]})
        self.seed_run = run.get("run") or run.get("id") or ""
        seed = self.call("POST", f"/v1/runs/{self.seed_run}/seed-token")
        url = seed.get("push_url") or (run.get("repo") or {}).get("url")
        artifacts_repo = (run.get("repo") or {}).get("name") or f"race-{self.seed_run}"
        env = {"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "http.extraHeader",
               "GIT_CONFIG_VALUE_0": f"Authorization: Bearer {seed['token']}"}
        refs = seed.get("refs") or ["refs/heads/sprout", "refs/heads/stalk"]   # the seed token's refs only
        run_git(base_dir, "push", "-q", "--no-verify", url, *[f"{base}:{r}" for r in refs], env=env)
        self.adopt(self.call("POST", "/v1/repos", {"repoName": self.repo, "artifactsRepo": artifacts_repo,
                                                   "owner": owner, "settings": settings}))
        return base

    def beans(self) -> list[dict]:
        res = self.call("GET", f"/v1/repos/{self.engine}/beans")
        return res if isinstance(res, list) else res.get("beans", [])

    def busy(self) -> bool:
        return any(b.get("phase") in ("checking", "waiting", "landed") for b in self.beans())

    def events(self) -> list[dict]:
        out, after = [], 0
        while True:
            text = self.call("GET", f"/v1/runs/{self.engine}/events?after={after}&limit=2000&format=jsonl", raw=True)
            page = [json.loads(line) for line in text.splitlines() if line.strip()]
            if not page:
                return out
            out += page
            after = page[-1].get("seq", after + len(page))
            if len(page) < 2000:
                return out

    def fetch_line(self, repo: str) -> tuple[str, dict[str, float]]:
        run_git(repo, "fetch", "-q", "--no-tags", self.clone_url, "+refs/heads/stalk:refs/remotes/forge/stalk",
                "+refs/heads/sprout:refs/remotes/forge/sprout", env=self.git_env())
        promoted: dict[str, float] = {}
        for e in self.events():
            if e.get("type") == "green.promote" and e.get("sha"):
                promoted.setdefault(e["sha"], iso_epoch(e.get("ts")) or 0.0)
        return "refs/remotes/forge/stalk", promoted

    def collect(self, start: float) -> tuple[list[M.Change], list[dict]]:
        beans = {b["bean"]: b for b in self.beans()}
        events = self.events()
        per: dict[str, M.Change] = {}

        def change(task_id: str) -> M.Change:
            b = beans.get(task_id) or next((x for x in beans.values() if x.get("bean") == task_id), {})
            if task_id not in per:
                per[task_id] = M.Change(id=task_id, task=b.get("task") or task_of(f"{task_id} {b.get('title', '')}"),
                                        ready_at=None, integrated_at=None,
                                        pushes=int(b.get("pushes") or 1), state=b.get("phase", ""))
            return per[task_id]

        ci: list[dict] = []
        for e in events:
            typ, task, at = e.get("type"), e.get("task"), iso_epoch(e.get("ts"))
            if typ == "task.start" and task:
                ch = change(task)
                ch.ready_at = ch.ready_at or at
                ch.created_at = ch.created_at or at   # a bean is submitted and ready at its first push
            elif typ == "land" and task and e.get("target") in (None, "sprout", "trunk"):
                ch = change(task)
                ch.integrated_at = ch.integrated_at or at
            elif typ == "green.promote":
                for t in e.get("tasks") or []:
                    ch = change(t)
                    ch.stable_at = ch.stable_at or at
            elif typ == "merge.conflict" and task:
                change(task).conflicts += 1
                change(task).kickouts += 1
            elif typ == "preland.check":
                if task and e.get("green") is False:
                    change(task).red_checks += 1
                    change(task).kickouts += 1
                secs = float(e.get("check_seconds") or e.get("suite_seconds") or 0)
                ci.append({"purpose": "preland", "green": e.get("green"), "start": (at or 0) - secs, "end": at,
                           "id": f"preland-{e.get('seq')}"})
            elif typ == "ci.end":
                end = at
                secs = float(e.get("ci_seconds") or e.get("suite_seconds") or 0)
                ci.append({"purpose": e.get("purpose"), "green": e.get("green"), "start": (end or 0) - secs,
                           "end": end, "id": e.get("ci")})
        return list(per.values()), ci


def locked_hint() -> str:
    """What workers are told about running tests (both arms): only through the machine-wide lock, because
    fastify's suite listens on fixed ports and parallel suites on one machine fail each other."""
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "locked_suite.py")
    return (f"Run the tests only with `python3 {script}` from the worktree: `cd <worktree> && python3 {script}` "
            f"runs the whole suite (about 15 s), `cd <worktree> && python3 {script} test/<file>.test.js` runs chosen "
            "files. It waits while another test run on this machine finishes (the suite listens on fixed ports, so "
            "two at once fail each other); never run `node --test` directly.")


def unintegrated_tasks(ids: list[str], log: str) -> set[str]:
    """Task ids no ``Task:`` trailer in ``log`` names. A Beanstalk squash's trailer may be the bean's name
    (``Task: t009-handler-timeout`` for a bean named after its task, seen 2026-10-08), so a trailer ``<id>-...``
    counts for ``<id>``."""
    import re
    named = re.findall(r"\bTask:\s*([A-Za-z0-9_.-]+)", log)
    return {i for i in ids if not any(n == i or n.startswith(f"{i}-") for n in named)}


def tests_not_on_line(repo: str, ref: str, tasks: list, base: str) -> set[str]:
    """Tasks whose acceptance tests are not on the line: a test file missing there, or (a file the base already had)
    unchanged since the base. A trailer alone is not delivery: on 2026-10-08 (plugin-v2, seed 7) a worker pushed t003's
    change to ``bean/t009-handler-timeout``; the squash carried ``Task: t009-handler-timeout``, so the lead and the
    trailer check counted t009 integrated while its tests and its feature were never added. Presence, not identical
    text: agents legitimately append tests to the file (t025) or drop an unused import (GitHub run, t027, t029), and
    no two tasks share a test path. Whether the tests pass is the replay's job."""
    out = set()
    for t in tasks:
        for path in t.acceptance_tests:
            on_line = _blob(repo, ref, path)
            if on_line is None or on_line == _blob(repo, base, path):
                out.add(t.id)
                break
    return out


def _blob(repo: str, ref: str, path: str) -> str | None:
    try:
        return run_git(repo, "rev-parse", f"{ref}:{path}").strip()
    except Exception:  # noqa: BLE001 - absent at that commit
        return None


def task_of(text: str) -> str | None:
    import re
    m = re.search(r"\bTask:\s*([A-Za-z0-9_.-]+)", text or "")
    if m:
        return m.group(1)
    m = re.search(r"\b(t\d{3})\b", text or "")
    return m.group(1) if m else None


# ---- the race -----------------------------------------------------------------------------------------------------

class OrchestratedRace:
    def __init__(self, cfg: OrchConfig):
        self.cfg = cfg
        self.out = resolve_out(cfg.out)
        self.work = os.path.join(self.out, "work")
        self.events: list[dict] = []
        self.t0 = 0.0
        # "prompt": the shared orchestrated prompt (baseline pairs); "plugin": the Beanstalk arm's lead and workers
        # get the Beanstalk plugin's skill in place of the prompt's forge section (orch_prompt.beanstalk_plugin_section)
        self.guidance = cfg.extra.get("guidance", "prompt")
        # The plugin guidance's version label (plugin-v1: plugin 0.5.0, plugin-v2: 0.6.0, orch_prompt), with the
        # plugin's own version, so runs of different skill texts are never compared unlabelled
        self.guidance_version = orch_prompt.PLUGIN_GUIDANCE_VERSION if self.guidance == "plugin" else None
        self.plugin_version = orch_prompt.plugin_version() if self.guidance == "plugin" else None

    def log(self, typ: str, at: float | None = None, **fields) -> None:
        at = time.time() if at is None else at
        self.events.append({"t": round(at - self.t0, 3), "ts": dt.datetime.fromtimestamp(
            at, dt.timezone.utc).isoformat(timespec="milliseconds"), "type": typ, **fields})

    def prepare(self) -> tuple[list[Task], object, str, str]:
        cfg = self.cfg
        if os.path.exists(self.out) and os.listdir(self.out) and not cfg.force:
            raise SystemExit(f"{self.out} exists; pass --force")
        shutil.rmtree(self.out, ignore_errors=True)
        os.makedirs(self.work)
        suite = suite_mod.load_suite(cfg.arena)
        suite_mod.activate(suite)
        snap, digest = snapshot_arena(cfg.arena, os.path.join(self.work, "arena"))
        tasks = load_tasks(snap, cfg.tasks)
        base_dir = os.path.join(self.work, "base")
        run_git(self.work, "clone", "-q", "--no-local", "--single-branch", "--branch", "main", "--no-tags",
                os.path.abspath(cfg.repo), base_dir)
        forge = GitHubForge(cfg, self.work) if cfg.forge == "github" else BeanstalkForge(cfg, self.work)
        base = forge.setup(base_dir)
        self.arena_base = run_git(base_dir, "rev-parse", "HEAD~1" if cfg.forge == "github" else "HEAD").strip()
        self.arena_digest = digest
        return tasks, forge, base, locked_hint()

    def checkout(self, forge, tasks: list[Task], hint: str) -> str:
        wt = os.path.join(self.work, "orchestrator")
        env = forge.git_env() if hasattr(forge, "git_env") else forge.client.git_env()
        run_git(self.work, "clone", "-q", forge.clone_url, wt, env=env)
        for key, value in forge.clone_config():
            run_git(wt, "config", "--add", key, value)
        for k, v in (("user.name", "orchestrator"), ("user.email", "orchestrator@beanstalk.invalid")):
            run_git(wt, "config", k, v)
        with open(os.path.join(wt, ".git", "info", "exclude"), "a", encoding="utf-8") as fh:
            fh.write(f"\nBACKLOG.md\n{orch_prompt.WORKTREES}/\nnode_modules\n")
        with open(os.path.join(wt, "BACKLOG.md"), "w", encoding="utf-8") as fh:
            fh.write(orch_prompt.backlog(tasks, hint))
        deps = suite_mod.ACTIVE.deps
        if deps and not os.path.isdir(deps):
            # a dangling link leaves the agents and the final check without dependencies: every suite file fails
            # (seen 2026-10-08: a whole race measured 0 of 38 green on a correct line)
            raise SystemExit(f"the arena's dependencies are not installed: {deps} (npm ci in its deps directory)")
        if deps:  # resolution walks up: one snapshot above the clone serves the clone and its worktrees
            link = os.path.join(self.work, "node_modules")
            if not os.path.lexists(link):
                os.symlink(deps, link)
        return wt

    def unintegrated(self, forge, tasks: list[Task]) -> set[str]:
        """Tasks not delivered on the forge's line: their acceptance tests are not there (``tests_not_on_line``,
        forge-agnostic). ``Task:`` trailers no longer decide it either way: a Beanstalk squash's trailer is the bean's
        name, so a bean not named after its task carries no task id (seed 11, 2026-10-08: 25 delivered tasks counted
        missing, the lead resumed at 31.5 min and re-pushed empty "record" commits for them), and a trailer can name
        a task whose change is not there (t009, seed 7). A forge error counts as all integrated: no resume."""
        repo = os.path.join(self.work, "base")
        try:
            ref, _ = forge.fetch_line(repo)
            if forge.name == "beanstalk":   # done = landed on the sprout (the prompt's definition), not yet the stalk
                ref = "refs/remotes/forge/sprout"
            return tests_not_on_line(repo, ref, tasks, self.base_sha)
        except Exception:  # noqa: BLE001 - the decision to resume must not end the race
            return set()

    def session_env(self) -> dict[str, str]:
        """plugin guidance: ``claude -p`` keeps waiting for background workers however long the lead's turn has been
        over. By default it stops them 10 minutes after the last turn ("Background tasks still running 10m after the
        last turn ...; stopping them"), which killed all 8 workers of the first plugin-v2 run at 11 minutes; a lead that
        sleeps (the baselines) never meets the ceiling, a lead that waits for notifications does."""
        return {"CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS": "0"} if self.guidance == "plugin" else {}

    def claude_argv(self, prompt: str, budget: float | None = None, resume: str | None = None) -> list[str]:
        cfg = self.cfg
        agents = {"worker": {"description": "An engineer who implements one change in its own git worktree, runs "
                                            "the tests and commits.",
                             "prompt": orch_prompt.worker_prompt(self.guidance), "model": cfg.worker_model,
                             "tools": ["Read", "Edit", "Write", "Glob", "Grep", "Bash"]}}
        return [cfg.claude_bin, "-p", prompt, "--model", cfg.model, "--output-format", "stream-json", "--verbose",
                "--tools", CLAUDE_TOOLS, "--agents", json.dumps(agents), "--permission-mode", "acceptEdits",
                "--permission-prompts", "none", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
                "--setting-sources", "", "--disable-slash-commands",
                "--max-budget-usd", f"{(cfg.max_usd if budget is None else budget):.2f}",
                *(["--resume", resume] if resume else []),
                "--allowedTools", "Bash(*)", "Read", "Edit", "Write", "Glob", "Grep", "Agent", "TodoWrite",
                "--disallowedTools", *DENIED]

    def run(self) -> int:
        cfg = self.cfg
        tasks, forge, base, hint = self.prepare()
        self.base_sha = base
        wt = self.checkout(forge, tasks, hint)
        prompt = orch_prompt.prompt(cfg.forge, repo_url=forge.url, n_tasks=len(tasks), subagents=cfg.subagents,
                                    test_hint=hint, wall_minutes=cfg.max_wall_minutes, guidance=self.guidance)
        with open(os.path.join(self.out, "prompt.txt"), "w", encoding="utf-8") as fh:
            fh.write(prompt)
        with open(os.path.join(self.out, "worker_prompt.txt"), "w", encoding="utf-8") as fh:
            fh.write(orch_prompt.worker_prompt(self.guidance))
        transcript = os.path.join(self.work, "transcript.jsonl")
        env = {**agent_env(), **forge.agent_env(), "ORCH_ARENA": os.path.abspath(cfg.arena), **self.session_env()}
        self.t0 = time.time()
        self.log("race.setup", at=self.t0, forge=cfg.forge, repo=forge.url, base=base, tasks=[t.id for t in tasks])
        self.log("race.start", at=self.t0, policy=f"orchestrated-{cfg.forge}", agent=cfg.orchestrator,
                 model=cfg.model, agents=cfg.subagents, tasks=[t.id for t in tasks])
        aborted = None
        deadline = self.t0 + cfg.max_wall_minutes * 60
        segments: list[str] = []
        resumes: list[dict] = []
        session_id = None
        left: set[str] = set()
        while True:
            segment = os.path.join(self.work, f"transcript.{len(segments)}.jsonl")
            segments.append(segment)
            spent = max([parse_transcript(s, [])["cost_usd"] for s in segments[:-1]] or [0.0])
            argv = self.claude_argv(prompt if session_id is None else orch_prompt.continuation(self.guidance, left),
                                    budget=max(0.5, cfg.max_usd - spent), resume=session_id)
            with open(segment, "w", encoding="utf-8") as out:
                proc = subprocess.Popen(argv, cwd=wt, stdout=out, stderr=subprocess.STDOUT, env=env,
                                        start_new_session=True)
                try:
                    proc.wait(timeout=max(1.0, deadline - time.time()))
                except subprocess.TimeoutExpired:
                    aborted = f"wall-clock limit of {cfg.max_wall_minutes} minutes"
                    os.killpg(proc.pid, 15)
                    try:
                        proc.wait(timeout=30)
                    except subprocess.TimeoutExpired:
                        os.killpg(proc.pid, 9)
            session_id = session_id or session_of(segment)
            if aborted or not session_id:
                break
            # ``claude -p`` exits when the lead ends its turn with no background worker running (it stays alive while
            # workers run and resumes the lead on their notifications, Claude Code 2.1.293); a lead that ended its turn
            # with work left gets one fixed continuation (the same on both arms; plugin-v2's names the notifications)
            spent = max(parse_transcript(s, [])["cost_usd"] for s in segments)
            left = self.unintegrated(forge, tasks)
            if (not left or len(resumes) >= MAX_RESUMES or spent >= cfg.max_usd - 0.5
                    or deadline - time.time() < 120):
                break
            resumes.append({"at": round(time.time() - self.t0, 1), "unintegrated": sorted(left)})
            self.log("orchestrator.resume", unintegrated=sorted(left), spent_usd=round(spent, 4))
        with open(transcript, "w", encoding="utf-8") as out:
            for segment in segments:
                with open(segment, encoding="utf-8", errors="replace") as fh:
                    out.write(fh.read())
        ended = time.time()
        session = merge_sessions([parse_transcript(s, secrets=[getattr(forge, "token", "")]) for s in segments])
        session["resumes"] = resumes
        self.log("invocation.end", at=ended, inv="orchestrator", kind="orchestrator", task=None, agent="lead",
                 cost_usd=session["cost_usd"], ok=session["ok"], subtype=session["subtype"], num_turns=session["turns"])
        self.log("race.end", at=ended, aborted=aborted, spent_usd=session["cost_usd"])
        drain_until = ended + cfg.drain_minutes * 60
        while time.time() < drain_until:
            try:
                if not forge.busy():
                    break
            except Exception:  # noqa: BLE001 - a transient forge error: look again
                pass
            time.sleep(20)
        settled = time.time()
        return self.measure(tasks, forge, base, session, ended, settled, aborted)

    def remeasure(self) -> int:
        """Measures a Beanstalk race whose session finished but whose measurement died (a network outage reaching
        the gateway, 2026-10-09), from what the run directory kept: the work tree, the transcript segments and the
        forge's repository (its engine id from the clone's URL; a fresh admin-minted git token). The race start
        is the first transcript timestamp minus 2.2 s and the session end the last plus 9 s (both offsets as
        measured on three complete runs: 2.0 to 2.4 s and 7.8 to 10.8 s). Resumes are not recorded by the
        transcript, so a run with more than one segment is refused."""
        cfg = self.cfg
        if cfg.forge != "beanstalk":
            raise SystemExit("--remeasure is for --forge beanstalk")
        segments = sorted(p for p in os.listdir(self.work) if p.startswith("transcript.") and p[11:-6].isdigit())
        if len(segments) != 1:
            raise SystemExit(f"--remeasure needs one transcript segment, found {segments}")
        segment = os.path.join(self.work, segments[0])
        stamps = []
        with open(segment, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                try:
                    stamp = iso_epoch(json.loads(line).get("timestamp"))
                except (json.JSONDecodeError, AttributeError):
                    continue
                if stamp:
                    stamps.append(stamp)
        self.t0, ended = stamps[0] - 2.2, stamps[-1] + 9.0
        suite_mod.activate(suite_mod.load_suite(cfg.arena))
        tasks = load_tasks(os.path.join(self.work, "arena"), cfg.tasks)
        _, self.arena_digest = snapshot_arena(cfg.arena, os.path.join(self.work, "arena-remeasure"))
        base_dir = os.path.join(self.work, "base")
        self.base_sha = base = run_git(base_dir, "rev-parse", "HEAD").strip()
        self.arena_base = base
        forge = BeanstalkForge(cfg, self.work)
        origin = run_git(os.path.join(self.work, "orchestrator"), "remote", "get-url", "origin").strip()
        forge.git_path = origin[len(forge.gateway):]
        owner, repo = forge.git_path.removeprefix("/git/").removesuffix(".git").split("/", 1)
        import hashlib
        forge.repo = repo
        forge.engine = "r" + hashlib.sha256(f"{owner.lower()}/{repo.lower()}".encode()).hexdigest()[:19]
        forge.token = forge.call("POST", f"/v1/repos/{forge.engine}/git-token",
                                 {"user": {"id": "u-orchestrator", "handle": "orchestrator"},
                                  "ttl_seconds": 3600})["token"]
        with open(os.path.join(self.work, "transcript.jsonl"), "w", encoding="utf-8") as out, \
                open(segment, encoding="utf-8", errors="replace") as fh:
            out.write(fh.read())
        session = merge_sessions([parse_transcript(segment, secrets=[forge.token])])
        session["resumes"] = []
        self.log("race.setup", at=self.t0, forge=cfg.forge, repo=forge.url, base=base, tasks=[t.id for t in tasks],
                 remeasured=True)
        self.log("race.start", at=self.t0, policy=f"orchestrated-{cfg.forge}", agent=cfg.orchestrator,
                 model=cfg.model, agents=cfg.subagents, tasks=[t.id for t in tasks])
        self.log("invocation.end", at=ended, inv="orchestrator", kind="orchestrator", task=None, agent="lead",
                 cost_usd=session["cost_usd"], ok=session["ok"], subtype=session["subtype"], num_turns=session["turns"])
        self.log("race.end", at=ended, aborted=None, spent_usd=session["cost_usd"])
        return self.measure(tasks, forge, base, session, ended, ended, None)

    def measure(self, tasks: list[Task], forge, base: str, session: dict, ended: float, settled: float,
                aborted: str | None) -> int:
        cfg = self.cfg
        repo = os.path.join(self.work, "base")
        ref, promoted = forge.fetch_line(repo)
        # everything from the forge first: the replay and the final check run for an hour or more on a busy machine,
        # and a network outage after them lost a whole measurement (2026-10-09)
        changes, ci = forge.collect(self.t0)
        suite = suite_mod.ACTIVE
        acceptance = {t.id: t.acceptance_tests for t in tasks}
        prefix = ["node", *suite.node_args, "--test", "--test-timeout=60000"]
        env = suite.run_env()
        greens, replay = M.replay_greens(repo, base, ref, acceptance, prefix, env, suite.deps, when=promoted)
        final = M.final_check(repo, ref, acceptance, suite.test_argv(test_timeout_ms=60000), prefix, env, suite.deps)
        for c in sorted(changes, key=lambda c: c.ready_at or c.created_at or 0):
            if c.ready_at:
                self.log("change.ready", at=c.ready_at, change=c.id, task=c.task)
            if c.integrated_at:
                self.log("change.integrated", at=c.integrated_at, change=c.id, task=c.task,
                         target="main" if cfg.forge == "github" else "sprout")
            if c.stable_at:
                self.log("change.stable", at=c.stable_at, change=c.id, task=c.task, target="stalk")
        for i, run in enumerate(sorted(ci, key=lambda r: r.get("end") or 0)):
            if run.get("end"):
                self.log("ci.end", at=run["end"], ci=f"c{i}", purpose=run["purpose"], green=run.get("green"),
                         ci_seconds=round(max(0.0, (run["end"] or 0) - (run["start"] or run["end"])), 3))
        for task, (sha, at) in sorted(greens.items(), key=lambda kv: kv[1][1]):
            self.log("task.green", at=at, task=task, sha=sha, target="main")
        self.log("final.check", at=settled, **{k: v for k, v in final.items() if k != "per_task"})
        self.events.sort(key=lambda e: (e["t"], 0 if e["type"] in ("race.setup", "race.start") else 1))
        for i, e in enumerate(self.events):
            e["seq"] = i + 1
        with open(os.path.join(self.out, "events.jsonl"), "w", encoding="utf-8") as fh:
            for e in self.events:
                fh.write(json.dumps({"seq": e["seq"], **{k: v for k, v in e.items() if k != "seq"}}) + "\n")
        integ = M.integration_metrics(changes, self.t0, max(settled, ended))
        ci_min: dict[str, float] = {}
        for run in ci:
            if run.get("end") and run.get("start"):
                ci_min[run["purpose"]] = ci_min.get(run["purpose"], 0.0) + (run["end"] - run["start"]) / 60
        green_tasks = [t.id for t in tasks if t.id in greens]
        correct = final["suite_green"] and all(final["per_task"].get(t) for t in green_tasks)
        summary = {
            "label": f"orchestrated race: arena={os.path.basename(os.path.normpath(cfg.arena))}, {len(tasks)} tasks, "
                     f"forge={cfg.forge}, {cfg.orchestrator} ({cfg.model}) with {cfg.subagents} {cfg.worker_model} "
                     "subagents" + (f", guidance={self.guidance_version} (the Beanstalk plugin {self.plugin_version}'s "
                                    "skill in the lead's and workers' prompts instead of the forge section)"
                                    if self.guidance == "plugin" else ""),
            "guidance": self.guidance,
            "guidance_version": self.guidance_version,
            "plugin_version": self.plugin_version,
            "policy": f"orchestrated-{cfg.forge}", "agent": cfg.orchestrator, "model": cfg.model,
            "forge": cfg.forge, "repo": forge.url, "arena_base": self.arena_base, "arena_digest": self.arena_digest,
            "config": {"agents": cfg.subagents, "tasks": len(tasks), "seed": cfg.seed, "max_usd": cfg.max_usd,
                       "max_wall_minutes": cfg.max_wall_minutes, "ci_slots": cfg.ci_slots, "batch": cfg.batch,
                       "worker_model": cfg.worker_model, "guidance": self.guidance,
                       "guidance_version": self.guidance_version,
                       "bg_wait_ceiling": "none" if self.session_env() else "claude-code default (10 min)"},
            "aborted": aborted,
            "wall_seconds": round(ended - self.t0, 2),
            "settled_seconds": round(settled - self.t0, 2),
            "tasks": len(tasks), "tasks_green": len(green_tasks),
            "cost_usd": session["cost_usd"],
            "red_validations": integ["red_checks"],
            "ci_minutes": {k: round(v, 2) for k, v in ci_min.items()},
            "ci_minutes_total": round(sum(ci_min.values()), 2),
            "ci_runs": {p: sum(1 for r in ci if r["purpose"] == p) for p in {r["purpose"] for r in ci}},
            "integration": integ,
            "changes": [c.__dict__ for c in changes],
            "orchestrator": {k: v for k, v in session.items() if k != "texts"},
            "greens": {t: {"sha": s, "seconds": round(a - self.t0, 2)} for t, (s, a) in greens.items()},
            "replay": replay,
            "final": {**{k: v for k, v in final.items() if k != "per_task"}, "correct": correct,
                      "per_task": final["per_task"]},
        }
        with open(os.path.join(self.out, "summary.json"), "w", encoding="utf-8") as fh:
            json.dump(summary, fh, indent=2, default=str)
        with open(os.path.join(self.out, "summary.md"), "w", encoding="utf-8") as fh:
            fh.write(to_markdown(summary))
        shutil.copy(os.path.join(self.work, "transcript.jsonl"), os.path.join(self.out, "transcript.jsonl"))
        scrub(os.path.join(self.out, "transcript.jsonl"), [getattr(forge, "token", "")])
        return 0 if not aborted else 3


MAX_RESUMES = 6


def session_of(path: str) -> str | None:
    """The session id a ``claude -p`` transcript reports (its init line)."""
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            if e.get("session_id"):
                return e["session_id"]
    return None


def merge_sessions(parts: list[dict]) -> dict:
    """One session's figures from its processes (resumes of one session)."""
    if not parts:
        return parse_transcript("/dev/null", [])
    commands: dict[str, int] = {}
    for p in parts:
        for k, v in p["commands"].items():
            commands[k] = commands.get(k, 0) + v
    # a resumed process reports the session's cumulative cost and usage (checked on the 38-task runs: each
    # segment's total_cost_usd and modelUsage continue from the previous one), so the session's figure is the last
    # segment's total, never the sum. A segment killed at the wall cap writes no result line; then the last figure a
    # segment reported is used and ``cost_partial`` says the killed segment's own spend is missing.
    # (--max-budget-usd, by contrast, is per process: a resumed process ran past a cap below the cumulative total,
    # checked 2026-10-08, so each resume gets max_usd minus the cumulative spend so far.)
    reported = [p for p in parts if p["subtype"] != "none"]
    last = reported[-1] if reported else parts[-1]
    return {"model_usage": last["model_usage"], "cost_usd": round(last["cost_usd"], 4),
            "cost_partial": parts[-1]["subtype"] == "none",
            "ok": parts[-1]["ok"], "subtype": parts[-1]["subtype"], "turns": max(p["turns"] for p in parts),
            "agent_calls": sum(p["agent_calls"] for p in parts),
            "max_agent_calls_in_one_message": max(p["max_agent_calls_in_one_message"] for p in parts),
            "background_agent_calls": sum(p["background_agent_calls"] for p in parts),
            "max_concurrent_subagents": max(p["max_concurrent_subagents"] for p in parts),
            "processes": len(parts), "commands": dict(sorted(commands.items(), key=lambda kv: -kv[1])[:25])}


def parse_transcript(path: str, secrets: list[str]) -> dict:
    """What the orchestrator did: cost, turns, subagent calls and how many ran at once, commands it ran."""
    cost, ok, subtype, turns = 0.0, False, "none", 0
    model_usage: dict = {}
    agent_calls, max_parallel, background = 0, 0, 0
    commands: dict[str, int] = {}
    spans: dict[str, list[int]] = {}   # subagent (its parent tool-use id) -> first and last transcript line
    with open(path, encoding="utf-8", errors="replace") as fh:
        for index, line in enumerate(fh):
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            parent = e.get("parent_tool_use_id")
            if parent:
                spans.setdefault(parent, [index, index])[1] = index
            if e.get("type") == "assistant" and not e.get("parent_tool_use_id"):
                uses = [c for c in (e.get("message") or {}).get("content") or [] if c.get("type") == "tool_use"]
                calls = [u for u in uses if u.get("name") in ("Agent", "Task")]
                agent_calls += len(calls)
                background += sum(1 for u in calls if (u.get("input") or {}).get("run_in_background"))
                max_parallel = max(max_parallel, len(calls))
            if e.get("type") == "assistant":
                for c in (e.get("message") or {}).get("content") or []:
                    if c.get("type") == "tool_use" and c.get("name") == "Bash":
                        cmd = str((c.get("input") or {}).get("command", "")).strip().split("&&")[-1].split()
                        key = " ".join(cmd[:2]) if cmd[:1] in (["git"], ["gh"]) else (cmd[0] if cmd else "")
                        commands[key] = commands.get(key, 0) + 1
            if e.get("type") == "result":
                cost = max(cost, float(e.get("total_cost_usd") or 0.0))  # one result per wake-up; cumulative
                ok = not e.get("is_error")
                subtype = e.get("subtype") or "?"
                turns += int(e.get("num_turns") or 0)
                model_usage = e.get("modelUsage") or model_usage
    top = dict(sorted(commands.items(), key=lambda kv: -kv[1])[:25])
    # subagents running at once: the most whose transcript lines interleave (their output streams overlap)
    marks = sorted([(a, 1) for a, _ in spans.values()] + [(b + 0.5, -1) for _, b in spans.values()])
    depth = concurrent = 0
    for _, step in marks:
        depth += step
        concurrent = max(concurrent, depth)
    # total_cost_usd covers the lead and every subagent: modelUsage's cache reads and writes equal the sum over the
    # lead's and the workers' assistant messages (checked on orch-fastify-sonnet-4-t10-github, 2026-10-07)
    return {"model_usage": model_usage, "cost_usd": round(cost, 4), "ok": ok, "subtype": subtype, "turns": turns, "agent_calls": agent_calls,
            "max_agent_calls_in_one_message": max_parallel, "background_agent_calls": background,
            "max_concurrent_subagents": concurrent, "commands": top}


def scrub(path: str, secrets: list[str]) -> None:
    secrets = [s for s in secrets if s and len(s) >= 8]
    if not secrets:
        return
    with open(path, encoding="utf-8", errors="replace") as fh:
        text = fh.read()
    for s in secrets:
        text = text.replace(s, "<redacted>")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def to_markdown(s: dict) -> str:
    i = s["integration"]
    r, st = i["ready_to_integrated_s"], i.get("ready_to_stable_s") or {}
    rows = [
        ("Forge / repo", f"{s['forge']} / {s['repo']}"),
        ("Orchestrator", s["label"]),
        ("Changes integrated / submitted", f"{i['integrated']} / {i['changes']}"),
        ("Submitted -> integrated, median / p90 (min) (GitHub: PR opened; Beanstalk: bean pushed)",
         f"{_m(i['submitted_to_integrated_s']['median'])} / {_m(i['submitted_to_integrated_s']['p90'])}"),
        ("Ready -> integrated, median / p90 (min) (GitHub: enqueued; Beanstalk: pushed)",
         f"{_m(r['median'])} / {_m(r['p90'])}"),
        ("Ready -> stable line, median / p90 (min)", f"{_m(st.get('median'))} / {_m(st.get('p90'))}"),
        ("Share of wall time with a change waiting", i["waiting_share_of_wall"]),
        ("Mean / max changes waiting at once", f"{i['mean_changes_waiting']} / {i['max_changes_waiting']}"),
        ("Integrated per 10 min", " ".join(map(str, i["integrated_per_10min"]))),
        ("Kick-outs / red checks / conflicts / re-pushes",
         f"{i['kickouts']} / {i['red_checks']} / {i['conflicts']} / {i['repushes']}"),
        ("Tasks green (acceptance tests on the line)", f"{s['tasks_green']} / {s['tasks']}"),
        ("Wall (orchestrator) / settled (min)", f"{_m(s['wall_seconds'])} / {_m(s['settled_seconds'])}"),
        ("Model spend (USD)", s["cost_usd"]),
        ("CI minutes", f"{s['ci_minutes_total']} ({', '.join(f'{k} {v}' for k, v in s['ci_minutes'].items())})"),
        ("Subagent calls / most running at once", f"{s['orchestrator']['agent_calls']} / "
                                                   f"{s['orchestrator'].get('max_concurrent_subagents')}"),
        ("Final: suite green / tasks accepted / correct",
         f"{s['final']['suite_green']} / {s['final']['tasks_accepted']} of {s['final']['tasks_total']} / "
         f"{s['final']['correct']}"),
    ]
    lines = [f"# Orchestrated race: {s['forge']}", "", f"_{s['label']}_", ""]
    if s.get("aborted"):
        lines += [f"**Aborted:** {s['aborted']}", ""]
    lines += ["| Metric | Value |", "|---|---|"] + [f"| {k} | {v} |" for k, v in rows]
    lines += ["", "## Changes", "", "| Change | Task | Ready -> integrated (min) | Kick-outs | Red | Conflicts | Pushes |",
              "|---|---|---|---|---|---|---|"]
    for c in s["changes"]:
        w = (c["integrated_at"] - c["ready_at"]) if c["integrated_at"] and c["ready_at"] else None
        lines.append(f"| {c['id']} | {c['task']} | {_m(w)} | {c['kickouts']} | {c['red_checks']} | "
                     f"{c['conflicts']} | {c['pushes']} |")
    return "\n".join(lines) + "\n"


def _m(seconds) -> str:
    return "-" if seconds is None else f"{seconds / 60:.1f}"
