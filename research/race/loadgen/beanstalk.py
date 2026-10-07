"""Beanstalk as a forge for the load generator: plain git against a repository engine (doc 18, the git-native flow).

Everything a worker does is git: ``git push -o wait=<s> <url> <sha>:refs/heads/bean/<name>``, whose ``remote:
beanstalk:`` lines carry the verdict (LANDED, RED, CONFLICT, parked, dropped), and ``git fetch`` of ``sprout`` and
``stalk``. The operator side (open an engine on a fresh Artifacts repo with the arena's suite, mint a git token, read
the pushed beans and the engine's event log, close it) is the gateway's admin API (doc 18 §8.2). The admin token
and the git token never reach argv, a file or the output: the admin token is sent as a header from this process, the
git token reaches git through a credential helper that reads an environment variable of the git process only.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field

TOKEN_ENV = "LOADGEN_BEANSTALK_TOKEN"
HELPER = f'!f() {{ echo username=x; echo "password=${TOKEN_ENV}"; }}; f'
LINE = re.compile(r"remote:\s*beanstalk:\s?(.*?)\s*$")


def engine_id(owner: str, repo: str) -> str:
    """The engine id the gateway derives from ``<owner>/<repo>`` (``push/repo-engine.ts``)."""
    return "r" + hashlib.sha256(f"{owner.lower()}/{repo.lower()}".encode()).hexdigest()[:19]


def admin_token(dev_vars: str | None) -> str:
    tok = os.environ.get("BEANSTALK_ADMIN_TOKEN")
    if tok:
        return tok
    if dev_vars and os.path.exists(dev_vars):
        for line in open(dev_vars, encoding="utf-8"):
            key, _, value = line.strip().partition("=")
            if key == "ADMIN_TOKEN":
                return value.strip().strip('"')
    raise SystemExit("no admin token: set BEANSTALK_ADMIN_TOKEN or pass --dev-vars <gateway .dev.vars>")


@dataclass
class Verdict:
    """What one ``git push -o wait`` said. ``kind``: landed | red | conflict | parked | dropped | refused |
    timeout | error. Times are epoch seconds when the line arrived."""
    kind: str
    pushed_at: float
    received_at: float | None = None
    verdict_at: float | None = None
    validated_at: float | None = None      # the push saw "validated: on the stalk" before it returned
    landed_sha: str | None = None
    failing: list[str] = field(default_factory=list)
    conflicts: list[str] = field(default_factory=list)
    check_seconds: float | None = None
    lines: list[str] = field(default_factory=list)
    returncode: int | None = None


def parse_push(lines: list[tuple[float, str]], pushed_at: float, returncode: int | None) -> Verdict:
    """The verdict of a push from its stderr lines (each with its arrival time)."""
    v = Verdict(kind="error", pushed_at=pushed_at, returncode=returncode)
    section = None
    for at, raw in lines:
        if "[remote rejected]" in raw:
            v.kind, v.verdict_at = "refused", at
            v.lines.append(raw.strip())
            continue
        m = LINE.search(raw)
        if not m:
            continue
        text = m.group(1)
        v.lines.append(text)
        body = text.strip()
        if re.search(r"bean \S+ received at", body):
            v.received_at = v.received_at or at
        elif m2 := re.match(r"pre-land check (?:green|red)[^(]*\(([^)]*?)([\d.]+) s\)", body):
            v.check_seconds = float(m2.group(2))
        elif body.startswith("LANDED:"):
            v.kind, v.verdict_at = "landed", at
            m3 = re.search(r"on the sprout as ([0-9a-f]{7,40})", body)
            v.landed_sha = m3.group(1) if m3 else None
        elif body.startswith("RED:"):
            v.kind, v.verdict_at, section = "red", at, "failing"
        elif body.startswith("CONFLICT:"):
            v.kind, v.verdict_at, section = "conflict", at, None
            m4 = re.search(r"Conflicts in: (.+)$", body)
            if m4:
                v.conflicts = [p.strip() for p in m4.group(1).split(",") if p.strip()]
        elif body.startswith("validated:"):
            v.validated_at = at
        elif re.match(r"(PARKED|parked)\b", body) or " parked" in body.lower()[:60] and v.kind == "error":
            v.kind, v.verdict_at = "parked", at
        elif re.match(r"(DROPPED|dropped)\b", body) or body.lower().startswith("dropped"):
            v.kind, v.verdict_at = "dropped", at
        elif body.startswith("push refused"):
            v.kind, v.verdict_at = "refused", at
        elif "timed out" in body.lower() and "verdict" in body.lower() and v.kind == "error":
            v.kind = "timeout"
        elif section == "failing" and body.startswith("- ") and text.startswith("  "):
            v.failing.append(body[2:])
        elif section == "failing" and not text.startswith("  "):
            section = None
    if v.kind == "error" and returncode == 0 and v.received_at:
        v.kind = "timeout"   # accepted, but the wait ended without a verdict line
    return v


class BeanstalkClient:
    """The admin API of a gateway plus git against one repository engine."""

    def __init__(self, gateway: str, token: str, owner: str, repo: str, *, artifacts_repo: str | None = None,
                 engine_settings: dict | None = None):
        self.gateway = gateway.rstrip("/")
        self._admin = token
        self.owner, self.repo = owner, repo
        self.artifacts_repo = artifacts_repo or f"lg-{repo}"[:100]
        self.engine = engine_id(owner, repo)
        self.engine_settings = dict(engine_settings or {})   # settings.engine: overrides of the continuous defaults
        self._git_token: str | None = None
        self.calls = {"admin": 0, "pushes": 0, "fetches": 0}

    @property
    def url(self) -> str:
        return f"{self.gateway}/git/{self.owner}/{self.repo}.git"

    # -- admin API --
    def _call(self, method: str, path: str, body: dict | None = None, *, text: bool = False) -> object:
        self.calls["admin"] += 1
        req = urllib.request.Request(f"{self.gateway}{path}", method=method,
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers={"authorization": f"Bearer {self._admin}",
                                              "content-type": "application/json",
                                              "user-agent": "beanstalk-loadgen"})
        for attempt in range(5):
            try:
                with urllib.request.urlopen(req, timeout=120) as res:
                    raw = res.read().decode("utf-8", errors="replace")
                    return raw if text else (json.loads(raw) if raw.strip() else {})
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", errors="replace")[:500]
                if e.code >= 500 and attempt < 4:
                    time.sleep(2 * (attempt + 1))
                    continue
                raise RuntimeError(f"{method} {path}: {e.code} {detail}") from None
            except (urllib.error.URLError, TimeoutError) as e:
                if attempt < 4:
                    time.sleep(2 * (attempt + 1))
                    continue
                raise RuntimeError(f"{method} {path}: {e}") from None
        raise RuntimeError(f"{method} {path}: retries exhausted")

    async def call(self, method: str, path: str, body: dict | None = None, *, text: bool = False) -> object:
        return await asyncio.to_thread(self._call, method, path, body, text=text)

    async def open(self, suite: dict | None) -> dict:
        settings: dict = {}
        if suite:
            settings["suite"] = suite
        if self.engine_settings:
            settings["engine"] = self.engine_settings
        body = {"repoName": self.repo, "artifactsRepo": self.artifacts_repo,
                "owner": {"id": f"u-{self.owner}", "handle": self.owner}, "create_artifacts_repo": True,
                "settings": settings}
        res = await self.call("POST", "/v1/repos", body)
        assert isinstance(res, dict)
        if res.get("engineId") != self.engine:
            raise RuntimeError(f"engine id mismatch: {res.get('engineId')} != {self.engine}")
        tok = await self.call("POST", f"/v1/repos/{self.engine}/git-token",
                              {"user": {"id": "u-loadgen", "handle": "loadgen"}, "ttl_seconds": 6 * 3600})
        self._git_token = str((tok or {}).get("token"))  # type: ignore[union-attr]
        return {k: v for k, v in res.items() if k != "token"}

    async def beans(self) -> list[dict]:
        res = await self.call("GET", f"/v1/repos/{self.engine}/beans")
        return res if isinstance(res, list) else []

    async def events(self) -> list[dict]:
        out, after = [], 0
        while True:
            res = await self.call("GET", f"/v1/runs/{self.engine}/events?after={after}&limit=1000")
            evs = (res or {}).get("events") or [] if isinstance(res, dict) else []
            out += evs
            nxt = (res or {}).get("next_after") if isinstance(res, dict) else None
            if not evs or nxt is None or nxt == after:
                break
            after = nxt
        return out

    async def close(self, delete_repo: bool) -> None:
        await self.call("POST", f"/v1/repos/{self.engine}/close", {"delete_repo": delete_repo})

    # -- git --
    def git_env(self) -> dict:
        """Environment for the driver's own git processes: the token as an env var a credential helper reads."""
        if not self._git_token:
            raise RuntimeError("engine not opened")
        return {TOKEN_ENV: self._git_token, "GIT_TERMINAL_PROMPT": "0", "GIT_CONFIG_COUNT": "2",
                "GIT_CONFIG_KEY_0": "credential.helper", "GIT_CONFIG_VALUE_0": "",
                "GIT_CONFIG_KEY_1": "credential.helper", "GIT_CONFIG_VALUE_1": HELPER}

    async def push(self, repo_dir: str, sha: str, bean: str, *, base_env: dict, wait_seconds: int = 1800,
                   force: bool = False) -> Verdict:
        self.calls["pushes"] += 1
        argv = ["git", "push", "--progress", "-o", f"wait={wait_seconds}", self.url,
                f"{'+' if force else ''}{sha}:refs/heads/bean/{bean}"]
        env = {**base_env, **self.git_env()}
        pushed_at = time.time()
        proc = await asyncio.create_subprocess_exec(*argv, cwd=repo_dir, env=env, stdout=asyncio.subprocess.PIPE,
                                                    stderr=asyncio.subprocess.PIPE)
        lines: list[tuple[float, str]] = []
        buf = b""
        assert proc.stderr is not None
        while True:
            chunk = await proc.stderr.read(4096)
            if not chunk:
                break
            buf += chunk
            parts = re.split(rb"[\r\n]", buf)
            buf = parts.pop()
            now = time.time()
            lines += [(now, p.decode("utf-8", errors="replace")) for p in parts if p.strip()]
        if buf.strip():
            lines.append((time.time(), buf.decode("utf-8", errors="replace")))
        await proc.wait()
        return parse_push(lines, pushed_at, proc.returncode)

    async def fetch(self, git, refs: dict[str, str]) -> None:
        """``git fetch`` of ``{remote ref: local ref}`` into the driver's repository."""
        self.calls["fetches"] += 1
        old = git.env
        git.env = {**git.env, **self.git_env()}
        try:
            for attempt in range(4):
                res = await git.run("fetch", "-q", "--no-tags", self.url,
                                    *[f"+{r}:{l}" for r, l in refs.items()], check=False, timeout=300)
                if res.returncode == 0:
                    return
                await asyncio.sleep(2.0 * (attempt + 1))
            raise RuntimeError(f"fetch {list(refs)} failed: {res.stderr.strip()[:300]}")
        finally:
            git.env = old
