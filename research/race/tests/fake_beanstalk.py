"""An in-process fake of a Beanstalk repository engine behind ``loadgen/beanstalk.py``'s ``BeanstalkClient`` methods.

A local bare repository stands in for the Artifacts repo. ``push`` really pushes ``bean/<name>`` to it with git, then
does what the engine's pre-land check does, synchronously: squash the bean (its diff from the fork point on the
sprout) onto the sprout, ``CONFLICT`` when that does not merge, run the suite (``node --test``) on the merged tree,
``RED`` when it fails, else land on the sprout and validate onto the stalk. The verdict comes back as the same
``Verdict`` the real client parses from ``remote: beanstalk:`` lines. Checks run one at a time (one sandbox).
"""
from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import sys
import time

TESTS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(TESTS))

from loadgen.beanstalk import Verdict, engine_id  # noqa: E402

GIT_ENV = {"GIT_AUTHOR_NAME": "fake-beanstalk", "GIT_AUTHOR_EMAIL": "engine@beanstalk.invalid",
           "GIT_COMMITTER_NAME": "fake-beanstalk", "GIT_COMMITTER_EMAIL": "engine@beanstalk.invalid",
           "GIT_CONFIG_NOSYSTEM": "1", "GIT_TERMINAL_PROMPT": "0"}


class FakeBeanstalk:
    def __init__(self, root: str, owner: str = "loadgen", repo: str = "lg-fixture", node: str = "node"):
        self.root, self.owner, self.repo, self.node = root, owner, repo, node
        self.bare = os.path.join(root, "engine.git")
        self.engine = engine_id(owner, repo)
        self.lock = asyncio.Lock()
        self.beans_state: dict[str, dict] = {}
        self.events_log: list[dict] = []
        self.calls = {"admin": 0, "pushes": 0, "fetches": 0}
        self.closed = None
        self.seq = 0

    @property
    def url(self) -> str:
        return self.bare

    def git(self, *args: str, check: bool = True, cwd: str | None = None) -> str:
        res = subprocess.run(["git", *args], cwd=cwd or self.bare, capture_output=True, text=True,
                             env={**os.environ, **GIT_ENV})
        if check and res.returncode != 0:
            raise RuntimeError(f"git {args}: {res.stderr}")
        return res.stdout.strip()

    def git_env(self) -> dict:
        return {}

    async def open(self, suite: dict | None) -> dict:
        self.calls["admin"] += 1
        if os.path.exists(self.root):
            shutil.rmtree(self.root)
        os.makedirs(self.root)
        subprocess.run(["git", "init", "-q", "--bare", self.bare], check=True)
        tree = self.git("hash-object", "-t", "tree", "-w", "/dev/null")  # the empty tree
        root = self.git("commit-tree", tree, "-m", "Start the repository")
        for ref in ("main", "sprout", "stalk"):
            self.git("update-ref", f"refs/heads/{ref}", root)
        return {"engineId": self.engine, "created": True, "base_sha": root, "git_path": "/git/fake"}

    def event(self, typ: str, **f) -> None:
        self.seq += 1
        self.events_log.append({"seq": self.seq, "t": time.time(), "type": typ, **f})

    def suite(self, sha: str) -> tuple[bool, list[str]]:
        wt = os.path.join(self.root, f"check-{self.seq}-{sha[:8]}")
        self.git("worktree", "add", "-q", "--detach", wt, sha)
        try:
            res = subprocess.run([self.node, "--test"], cwd=wt, capture_output=True, text=True, timeout=300,
                                 env={k: v for k, v in os.environ.items() if not k.startswith("NODE_")})
            failing = [ln.strip()[2:] for ln in res.stdout.splitlines() if ln.strip().startswith("✖")]
            return res.returncode == 0, failing[:10]
        finally:
            self.git("worktree", "remove", "--force", wt, check=False)

    async def push(self, repo_dir: str, sha: str, bean: str, *, base_env: dict, wait_seconds: int = 1800,
                   force: bool = False) -> Verdict:
        self.calls["pushes"] += 1
        pushed = time.time()
        state = self.beans_state.get(bean)
        if state and state["phase"] in ("landed", "green"):
            return Verdict("refused", pushed, verdict_at=time.time(), lines=["push refused: bean landed"])
        res = subprocess.run(["git", "push", "-q", self.bare, f"+{sha}:refs/heads/bean/{bean}"], cwd=repo_dir,
                             capture_output=True, text=True, env={**base_env, **GIT_ENV})
        if res.returncode != 0:
            return Verdict("error", pushed, returncode=res.returncode, lines=[res.stderr[-300:]])
        received = time.time()
        async with self.lock:
            sprout = self.git("rev-parse", "refs/heads/sprout")
            fork = self.git("merge-base", sha, sprout)
            mt = subprocess.run(["git", "merge-tree", "--write-tree", "--merge-base", fork, sprout, sha],
                                cwd=self.bare, capture_output=True, text=True, env={**os.environ, **GIT_ENV})
            phase = {"bean": bean, "title": bean, "task": bean, "actor": "loadgen", "head": sha,
                     "pushes": (state or {}).get("pushes", 0) + 1, "landed_sha": None, "verdict": []}
            if mt.returncode != 0:
                files = sorted({ln.split("\t")[-1] for ln in mt.stdout.splitlines()[1:] if "\t" in ln})
                phase.update(phase="conflict", reason="conflict")
                self.beans_state[bean] = phase
                self.event("merge.conflict", task=bean, files=files)
                return Verdict("conflict", pushed, received_at=received, verdict_at=time.time(), conflicts=files,
                               returncode=0)
            tree = mt.stdout.split("\n", 1)[0].strip()
            merged = self.git("commit-tree", tree, "-p", sprout, "-m", f"{bean}")
            t0 = time.time()
            green, failing = await asyncio.to_thread(self.suite, merged)
            check = round(time.time() - t0, 3)
            self.event("preland.check", task=bean, sha=merged, green=green, check_seconds=check,
                       suite_seconds=check, failing_tests=failing)
            if not green:
                phase.update(phase="red", reason="red")
                self.beans_state[bean] = phase
                return Verdict("red", pushed, received_at=received, verdict_at=time.time(), failing=failing,
                               check_seconds=check, returncode=0)
            self.git("update-ref", "refs/heads/sprout", merged)
            landed = time.time()
            self.event("land", task=bean, sha=merged, target="trunk")
            self.git("update-ref", "refs/heads/stalk", merged)
            self.event("check.reused", task=bean, sha=merged)
            phase.update(phase="green", reason="validated", landed_sha=merged)
            self.beans_state[bean] = phase
            return Verdict("landed", pushed, received_at=received, verdict_at=landed, validated_at=time.time(),
                           landed_sha=merged, check_seconds=check, returncode=0)

    async def beans(self) -> list[dict]:
        self.calls["admin"] += 1
        return list(self.beans_state.values())

    async def events(self) -> list[dict]:
        return list(self.events_log)

    async def close(self, delete_repo: bool) -> None:
        self.closed = delete_repo

    async def fetch(self, git, refs: dict[str, str]) -> None:
        self.calls["fetches"] += 1
        await git.run("fetch", "-q", "--no-tags", self.bare, *[f"+{r}:{l}" for r, l in refs.items()])
