"""Agent adapters (claude, codex, replay) and the prompts the harness sends them.

Every adapter takes an ``InvocationSpec`` and returns an ``InvocationResult``. The harness owns
the worktree before and after: it writes acceptance tests, then commits whatever the agent left.
"""
from __future__ import annotations

import asyncio
import json
import math
import os
import random
import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Callable

from .gitops import Git, union_resolve
from .procs import Runner

# USD per million tokens: (input, output, 5-minute cache write, cache read). Used only to estimate
# the cost of invocations still running (budget guard) or killed before reporting; the reported
# cost is the CLI's own total_cost_usd. First match on the model id wins.
CLAUDE_PRICES: list[tuple[str, tuple[float, float, float, float]]] = [
    ("haiku", (1.00, 5.00, 1.25, 0.10)),
    ("sonnet-4", (3.00, 15.00, 3.75, 0.30)),
    ("sonnet", (2.00, 10.00, 2.50, 0.20)),
    ("opus-5-5", (4.00, 20.00, 5.00, 0.20)),
    ("opus", (5.00, 25.00, 6.25, 0.50)),
    ("fable-5-1", (10.00, 50.00, 12.50, 0.25)),
    ("mythos-5-1", (10.00, 50.00, 12.50, 0.25)),
    ("fable", (10.00, 50.00, 12.50, 1.00)),
    ("mythos", (10.00, 50.00, 12.50, 1.00)),
]
DEFAULT_PRICE = (5.00, 25.00, 6.25, 0.50)


def claude_price(model: str) -> tuple[float, float, float, float]:
    m = (model or "").lower()
    for key, price in CLAUDE_PRICES:
        if key in m:
            return price
    return DEFAULT_PRICE


def usage_cost(usage: dict, price: tuple[float, float, float, float]) -> float:
    """Cost of one usage block; 1-hour cache writes (Claude Code uses them) cost 2x input, 5-minute 1.25x."""
    pin, pout, pcw, pcr = price
    created = usage.get("cache_creation_input_tokens", 0) or 0
    one_hour = min((usage.get("cache_creation") or {}).get("ephemeral_1h_input_tokens", 0) or 0, created)
    return (usage.get("input_tokens", 0) * pin + usage.get("output_tokens", 0) * pout
            + (created - one_hour) * pcw + one_hour * pin * 2.0
            + usage.get("cache_read_input_tokens", 0) * pcr) / 1e6


USAGE_KEYS = ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")


@dataclass
class InvocationSpec:
    inv_id: str
    kind: str                     # initial | rework | fixer | classifier
    task_id: str | None
    agent_id: str | None
    cwd: str
    prompt: str
    attempt: int = 1
    resume_session: str | None = None
    max_turns: int | None = None
    timeout: float | None = None
    budget_cap_usd: float | None = None
    replay: dict = field(default_factory=dict)   # replay agent instructions (patches, reset target)
    json_schema: dict | None = None               # classifier only
    no_tools: bool = False                        # classifier only


@dataclass
class InvocationResult:
    inv_id: str
    adapter: str
    model: str | None
    ok: bool = False              # the agent ran to a result (even an error subtype such as max turns)
    infra_error: str | None = None  # the CLI could not run / produced no result at all
    timed_out: bool = False
    exit_code: int | None = None
    subtype: str | None = None
    is_error: bool = False
    cost_usd: float = 0.0
    cost_source: str = "none"     # reported | estimated | none
    num_turns: int | None = None
    duration_ms: int | None = None
    duration_api_ms: int | None = None
    wall_ms: int = 0
    startup_ms: int | None = None  # spawn -> init event
    session_id: str | None = None
    usage: dict = field(default_factory=dict)
    model_usage: dict = field(default_factory=dict)
    permission_denials: list = field(default_factory=list)
    tool_uses: dict = field(default_factory=dict)
    result_text: str = ""
    structured_output: object = None
    init: dict = field(default_factory=dict)
    transcript: str | None = None
    notes: list = field(default_factory=list)
    rate_limit: dict | None = None   # last rate_limit_event (subscription window, overage use)
    rate_limited: bool = False       # a hard rejection: the race should stop, not drop tasks

    def to_event(self) -> dict:
        d = asdict(self)
        d.pop("init", None)
        d["result_text"] = (self.result_text or "")[:600]
        return d


class Adapter:
    name = "base"
    model: str | None = None

    async def run(self, spec: InvocationSpec, progress: Callable[[float], None] | None = None) -> InvocationResult:
        raise NotImplementedError


def agent_env() -> dict:
    """The user's environment minus anything that would tie a child to the parent Claude/Codex
    session (messaging sockets, session ids, effort overrides, nested-session guards)."""
    env = {}
    for k, v in os.environ.items():
        if k.startswith("CLAUDE") and k not in ("CLAUDE_CONFIG_DIR",):
            continue
        if k.startswith("CODEX_") and k != "CODEX_HOME":
            continue
        if k in ("MCP_CONFIG", "NODE_OPTIONS"):
            continue
        env[k] = v
    from . import suite as suite_mod
    env.update(suite_mod.ACTIVE.env)  # the arena's suite environment (e.g. marked's spec runner settings)
    env["GIT_OPTIONAL_LOCKS"] = "0"  # an agent's `git status` must not lock the index under the harness
    env["DISABLE_AUTOUPDATER"] = "1"
    env["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"] = "1"
    return env


# ---- Claude Code -----------------------------------------------------------------------------------

READ_ONLY_GIT = ["status", "diff", "log", "show", "ls-files", "blame", "grep", "rev-parse", "merge-base",
                 "cat-file", "ls-tree", "shortlog", "describe"]


# Defence in depth: Claude Code also auto-approves some read-only commands inside the working directory
# (smoke test: `node --version` ran, `ls -la ..` was denied). These deny rules win over any approval.
DENIED_PREFIXES = ["git commit", "git push", "git pull", "git fetch", "git reset", "git checkout", "git switch",
                   "git merge", "git rebase", "git stash", "git add", "git rm", "git mv", "git restore", "git clean",
                   "git worktree", "git tag", "git config", "git remote", "git cherry-pick", "git revert", "git am",
                   "git apply", "git update-ref", "git notes", "git gc", "git submodule", "npm", "npx", "pnpm", "yarn",
                   "bun", "curl", "wget", "ssh", "scp", "node -e", "node --eval", "node -p", "node --print", "rm", "sudo"]


def claude_denied_tools() -> list[str]:
    rules = []
    for p in DENIED_PREFIXES:
        rules += [f"Bash({p})", f"Bash({p} *)", f"Bash({p}:*)"]
    return rules


def claude_allowed_tools() -> list[str]:
    from . import suite as suite_mod
    rules = ["Read", "Edit", "Write", "Glob", "Grep",
             "Bash(node --test)", "Bash(node --test *)", "Bash(node --test:*)",
             "Bash(git branch --show-current)", "Bash(git branch)"]
    for cmd in suite_mod.ACTIVE.agent_allowed_bash:  # the arena's own test command (e.g. marked's run-tests)
        rules += [f"Bash({cmd})", f"Bash({cmd} *)", f"Bash({cmd}:*)"]
    for sub in READ_ONLY_GIT:
        rules += [f"Bash(git {sub})", f"Bash(git {sub} *)", f"Bash(git {sub}:*)"]
    return rules


class ClaudeAdapter(Adapter):
    name = "claude"

    def __init__(self, runner: Runner, *, model: str, max_turns: int, timeout: float, transcripts: str,
                 binary: str = "claude", output_format: str = "stream-json", effort: str | None = None,
                 safe_mode: bool = True, restricted: bool = True, persist_sessions: bool = True,
                 extra_args: list[str] | None = None):
        self.runner, self.model, self.max_turns, self.timeout = runner, model, max_turns, timeout
        self.transcripts, self.binary, self.output_format = transcripts, binary, output_format
        self.effort, self.safe_mode, self.restricted = effort, safe_mode, restricted
        self.persist_sessions = persist_sessions
        self.extra_args = list(extra_args or [])
        # total_cost_usd and duration_api_ms are cumulative over a resumed session: keep the last totals
        self.session_totals: dict[str, float | None] = {}
        self.session_api_ms: dict[str, int] = {}

    def argv(self, spec: InvocationSpec, session_id: str) -> list[str]:
        a = [self.binary, "-p", "--output-format", self.output_format]
        if self.output_format == "stream-json":
            a.append("--verbose")
        a += ["--model", self.model, "--max-turns", str(spec.max_turns or self.max_turns)]
        a += ["--tools", "" if spec.no_tools else "Read,Edit,Write,Glob,Grep,Bash"]
        a += ["--permission-mode", "acceptEdits", "--permission-prompts", "none"]
        a += ["--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}']
        a += ["--setting-sources", "", "--disable-slash-commands"]
        if self.safe_mode:
            a.append("--safe-mode")
        if self.restricted:
            a.append("--restricted")
        if self.effort:
            a += ["--effort", self.effort]
        if spec.budget_cap_usd is not None:
            a += ["--max-budget-usd", f"{max(spec.budget_cap_usd, 0.01):.2f}"]
        if spec.json_schema is not None:
            a += ["--json-schema", json.dumps(spec.json_schema, separators=(",", ":"))]
        if spec.resume_session:
            a += ["--resume", spec.resume_session]
        else:
            a += ["--session-id", session_id]
        if not self.persist_sessions and not spec.resume_session:
            a.append("--no-session-persistence")
        a += self.extra_args
        if not spec.no_tools:  # both flags are variadic: keep them last; the prompt goes on stdin
            a += ["--disallowedTools", *claude_denied_tools()]
            a += ["--allowedTools", *claude_allowed_tools()]
        return a

    def resumable(self, session_id: str | None) -> bool:
        """Only resume sessions whose last invocation reported a result (its cumulative cost is known)."""
        return bool(session_id) and self.session_totals.get(session_id) is not None

    async def run(self, spec: InvocationSpec, progress: Callable[[float], None] | None = None) -> InvocationResult:
        session_id = str(uuid.uuid4())
        res = InvocationResult(inv_id=spec.inv_id, adapter=self.name, model=self.model,
                               session_id=spec.resume_session or session_id)
        os.makedirs(self.transcripts, exist_ok=True)
        out_path = os.path.join(self.transcripts, f"{spec.inv_id}.jsonl")
        err_path = os.path.join(self.transcripts, f"{spec.inv_id}.stderr")
        with open(os.path.join(self.transcripts, f"{spec.inv_id}.prompt.txt"), "w", encoding="utf-8") as fh:
            fh.write(spec.prompt)
        argv = self.argv(spec, session_id)
        with open(os.path.join(self.transcripts, f"{spec.inv_id}.argv.json"), "w", encoding="utf-8") as fh:
            json.dump(argv, fh, indent=1)
        res.transcript = out_path
        t0 = time.monotonic()
        state = {"msgs": {}, "tools": {}, "init": None, "result": None, "rate": None}

        def on_line(line: str) -> None:
            line = line.strip()
            if not line.startswith("{"):
                return
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                return
            typ = ev.get("type")
            if typ == "system" and ev.get("subtype") == "init" and state["init"] is None:
                state["init"] = ev
                res.startup_ms = int((time.monotonic() - t0) * 1000)
            elif typ == "assistant":
                msg = ev.get("message") or {}
                mid = msg.get("id") or ev.get("uuid")
                prev = state["msgs"].get(mid)
                usage = dict(msg.get("usage") or (prev[1] if prev else {}))
                # streamed messages report output tokens at message start: estimate from content instead
                chars = (prev[2] if prev else 0) + len(json.dumps(msg.get("content") or []))
                usage["output_tokens"] = max(int(usage.get("output_tokens", 0) or 0), chars // 3)
                state["msgs"][mid] = (msg.get("model") or self.model, usage, chars)
                for block in msg.get("content") or []:
                    if isinstance(block, dict) and block.get("type") == "tool_use":
                        name = block.get("name", "?")
                        state["tools"][name] = state["tools"].get(name, 0) + 1
                if progress:
                    progress(self._estimate(state["msgs"]) * 1.3)  # conservative while running
            elif typ == "result":
                state["result"] = ev
            elif typ == "rate_limit_event":
                state["rate"] = ev.get("rate_limit_info")

        pr = await self.runner.run(argv, spec.cwd, env=agent_env(), timeout=spec.timeout or self.timeout,
                                   input_text=spec.prompt, on_line=on_line, stdout_path=out_path,
                                   stderr_path=err_path)
        res.wall_ms = int(pr.seconds * 1000)
        res.exit_code = pr.returncode
        res.timed_out = pr.timed_out
        res.tool_uses = state["tools"]
        if self.output_format == "json" and state["result"] is None:
            try:  # --output-format json prints one object, possibly pretty-printed
                obj = json.loads(pr.stdout.strip() or "{}")
                if obj.get("type") == "result":
                    state["result"] = obj
            except json.JSONDecodeError:
                pass
        rate = state["rate"] or {}
        if rate:
            res.rate_limit = {k: rate.get(k) for k in ("status", "rateLimitType", "resetsAt", "overageStatus",
                                                       "isUsingOverage")}
        hard = rate.get("status") == "rejected" and rate.get("overageStatus") not in ("allowed", None)
        api_status = (state["result"] or {}).get("api_error_status")
        res.rate_limited = bool(api_status in (429,) or (hard and not state["result"]))
        if state["init"]:
            ini = state["init"]
            res.init = {k: ini.get(k) for k in ("model", "permissionMode", "tools", "mcp_servers", "slash_commands",
                                                "apiKeySource", "claude_code_version", "plugins", "skills",
                                                "agents", "output_style", "cwd") if k in ini}
        r = state["result"]
        if r:
            res.ok = True
            res.subtype = r.get("subtype")
            res.is_error = bool(r.get("is_error"))
            res.num_turns = r.get("num_turns")
            res.duration_ms = r.get("duration_ms")
            res.duration_api_ms = r.get("duration_api_ms")
            res.session_id = r.get("session_id") or res.session_id
            res.usage = {k: (r.get("usage") or {}).get(k, 0) for k in USAGE_KEYS}
            res.model_usage = r.get("modelUsage") or {}
            res.permission_denials = r.get("permission_denials") or []
            res.result_text = r.get("result") or ""
            res.structured_output = r.get("structured_output")
            sid = res.session_id or ""
            if r.get("total_cost_usd") is not None:
                total = float(r["total_cost_usd"])
                prior = (self.session_totals.get(sid) or 0.0) if spec.resume_session else 0.0
                res.cost_usd = max(total - prior, 0.0)
                res.cost_source = "reported" if not spec.resume_session else "reported-delta"
                self.session_totals[sid] = total
            if res.duration_api_ms is not None and spec.resume_session:
                api_prior = self.session_api_ms.get(sid, 0)
                self.session_api_ms[sid] = res.duration_api_ms
                res.duration_api_ms = max(res.duration_api_ms - api_prior, 0)
            elif res.duration_api_ms is not None:
                self.session_api_ms[sid] = res.duration_api_ms
        if not res.cost_source.startswith("reported"):
            est = self._estimate(state["msgs"])
            if est > 0:
                res.cost_usd, res.cost_source = est, "estimated"
            if not res.usage:
                res.usage = self._sum_usage(state["msgs"])
        if not r:
            self.session_totals[res.session_id or ""] = None  # unknown cumulative cost: never resume it
            tail = (pr.stderr or pr.stdout or "").strip()[-1500:]
            res.infra_error = "timeout" if pr.timed_out else (tail or f"exit {pr.returncode} without a result")
            if pr.timed_out and state["msgs"]:
                res.infra_error = None  # it worked until we stopped it; the harness keeps the partial work
                res.ok = True
                res.subtype = "timeout"
                res.num_turns = len(state["msgs"])
        return res

    @staticmethod
    def _estimate(msgs: dict) -> float:
        return sum(usage_cost(u, claude_price(m)) for m, u, _ in msgs.values())

    @staticmethod
    def _sum_usage(msgs: dict) -> dict:
        tot = {k: 0 for k in USAGE_KEYS}
        for _, u, _ in msgs.values():
            for k in USAGE_KEYS:
                tot[k] += int(u.get(k, 0) or 0)
        return tot


# ---- Codex -------------------------------------------------------------------------------------------

class CodexAdapter(Adapter):
    """``codex exec --json``: OS sandbox (workspace-write, no network) instead of a command allowlist;
    user config (MCP servers, hooks, plugins) ignored; cost estimated from token usage."""
    name = "codex"

    def __init__(self, runner: Runner, *, model: str | None, timeout: float, transcripts: str,
                 binary: str = "codex", price: tuple[float, float, float] = (1.25, 0.125, 10.0),
                 effort: str | None = None):
        self.runner, self.model, self.timeout, self.transcripts = runner, model, timeout, transcripts
        self.binary, self.price, self.effort = binary, price, effort

    # features that widen the agent's surface beyond "edit files and run tests" (codex 0.159 names)
    DISABLED_FEATURES = ("plugins", "remote_plugin", "apps", "hooks", "browser_use", "browser_use_external",
                         "computer_use", "image_generation", "multi_agent", "goals", "skill_search", "memories",
                         "in_app_browser")

    def argv(self, spec: InvocationSpec) -> list[str]:
        a = [self.binary, "exec", "--json", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules",
             "-s", "workspace-write", "-C", spec.cwd, "-c", 'approval_policy="never"',
             "-c", "sandbox_workspace_write.network_access=false"]
        for feat in self.DISABLED_FEATURES:
            a += ["--disable", feat]
        if self.model:
            a += ["-m", self.model]
        if self.effort:
            a += ["-c", f'model_reasoning_effort="{self.effort}"']
        if spec.json_schema is not None:
            path = os.path.join(self.transcripts, f"{spec.inv_id}.schema.json")
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(spec.json_schema, fh)
            a += ["--output-schema", path]
        a.append("-")  # prompt from stdin
        return a

    async def run(self, spec: InvocationSpec, progress: Callable[[float], None] | None = None) -> InvocationResult:
        res = InvocationResult(inv_id=spec.inv_id, adapter=self.name, model=self.model)
        os.makedirs(self.transcripts, exist_ok=True)
        out_path = os.path.join(self.transcripts, f"{spec.inv_id}.jsonl")
        with open(os.path.join(self.transcripts, f"{spec.inv_id}.prompt.txt"), "w", encoding="utf-8") as fh:
            fh.write(spec.prompt)
        res.transcript = out_path
        usage = {"input_tokens": 0, "cached_input_tokens": 0, "output_tokens": 0}
        st = {"turns": 0, "items": 0, "done": False, "failed": None, "last_msg": "", "tools": {}}
        t0 = time.monotonic()

        def cost() -> float:
            pin, pcached, pout = self.price
            fresh = max(usage["input_tokens"] - usage["cached_input_tokens"], 0)
            return (fresh * pin + usage["cached_input_tokens"] * pcached + usage["output_tokens"] * pout) / 1e6

        def on_line(line: str) -> None:
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                return
            typ = ev.get("type", "")
            if typ == "thread.started":
                res.session_id = ev.get("thread_id")
                res.startup_ms = int((time.monotonic() - t0) * 1000)
            elif typ == "turn.completed":
                st["turns"] += 1
                st["done"] = True
                for k in usage:
                    usage[k] += int((ev.get("usage") or {}).get(k, 0) or 0)
                if progress:
                    progress(cost())
            elif typ in ("turn.failed", "error"):
                st["failed"] = json.dumps(ev)[:1500]
            elif typ == "item.completed":
                item = ev.get("item") or {}
                kind = item.get("type") or item.get("item_type") or "?"
                st["items"] += 1
                st["tools"][kind] = st["tools"].get(kind, 0) + 1
                if kind in ("agent_message", "assistant_message"):
                    st["last_msg"] = item.get("text", "")

        pr = await self.runner.run(self.argv(spec), spec.cwd, env=agent_env(), timeout=spec.timeout or self.timeout,
                                   input_text=spec.prompt, on_line=on_line, stdout_path=out_path,
                                   stderr_path=os.path.join(self.transcripts, f"{spec.inv_id}.stderr"))
        res.wall_ms = int(pr.seconds * 1000)
        res.duration_ms = res.wall_ms
        res.exit_code, res.timed_out = pr.returncode, pr.timed_out
        res.num_turns = st["items"]
        res.tool_uses = st["tools"]
        res.usage = {"input_tokens": usage["input_tokens"] - usage["cached_input_tokens"],
                     "cache_read_input_tokens": usage["cached_input_tokens"],
                     "cache_creation_input_tokens": 0, "output_tokens": usage["output_tokens"]}
        res.cost_usd, res.cost_source = cost(), "estimated"
        res.result_text = st["last_msg"]
        if spec.json_schema is not None and st["last_msg"]:
            try:
                res.structured_output = json.loads(st["last_msg"])
            except json.JSONDecodeError:
                pass
        if st["done"] or (pr.timed_out and st["items"]):
            res.ok = True
            res.subtype = "timeout" if pr.timed_out else ("error" if st["failed"] else "success")
            res.is_error = bool(st["failed"])
        else:
            res.infra_error = st["failed"] or ("timeout" if pr.timed_out else (pr.stderr or "").strip()[-1500:]
                                               or f"exit {pr.returncode}")
        return res


# ---- Replay ------------------------------------------------------------------------------------------

class ReplayAdapter(Adapter):
    """Applies reference patches after a seeded lognormal delay. Free and deterministic in content.

    ``spec.replay``: {"reset_to": sha | None, "patches": [{"path", "strip"}], "fixes": [...]}.
    Rework re-applies the reference patch on the new head with ``git apply --3way``; hunks that still
    conflict are resolved by keeping both sides. Semantic conflicts are repaired only when the arena
    ships a ``solutions/tNNN.fix.patch`` for an involved task (the fixture does; the contract does not).
    """
    name = "replay"

    def __init__(self, git: Git, *, seed: int, median: float, sigma: float, rework_factor: float = 0.5,
                 cost_usd: float = 0.0, turns: int = 1):
        self.git, self.seed, self.median, self.sigma = git, seed, median, sigma
        self.rework_factor, self.cost, self.turns = rework_factor, cost_usd, turns
        self.model = "replay"

    def delay(self, spec: InvocationSpec) -> float:
        rng = random.Random(f"{self.seed}:{spec.task_id}:{spec.kind}:{spec.attempt}")
        med = self.median * (1.0 if spec.kind == "initial" else self.rework_factor)
        return max(0.0, med * math.exp(self.sigma * rng.gauss(0.0, 1.0)))

    async def _apply(self, cwd: str, patch: dict, notes: list) -> bool:
        res = await self.git.run("apply", "--3way", "--whitespace=nowarn", f"-p{patch.get('strip', 1)}",
                                 patch["path"], cwd=cwd, check=False)
        if res.returncode == 0:
            return True
        conflicted = await self.git.unmerged_paths(cwd)
        if conflicted:
            for p in conflicted:
                full = os.path.join(cwd, p)
                if os.path.isfile(full):
                    with open(full, encoding="utf-8", errors="replace") as fh:
                        text = fh.read()
                    with open(full, "w", encoding="utf-8") as fh:
                        fh.write(union_resolve(text))
            await self.git.run("add", "--", *conflicted, cwd=cwd, check=False)
            notes.append(f"union-resolved {os.path.basename(patch['path'])}: {', '.join(conflicted)}")
            return True
        notes.append(f"could not apply {os.path.basename(patch['path'])}: {res.stderr.strip()[:300]}")
        return False

    async def _failing(self, cwd: str, tag: str) -> set[str] | None:
        """Test files failing in ``cwd`` (junit written beside the worktree, never inside it); None on a crash."""
        from . import suite as suite_mod
        suite = suite_mod.ACTIVE
        junit = os.path.join(os.path.dirname(cwd), f".replay-{tag}.xml")
        env = suite.run_env()
        if suite.build:
            b = await self.git.runner.run(list(suite.build), cwd, env=env, timeout=300)
            if b.returncode != 0:
                return None
        await self.git.runner.run(suite.test_argv(reporters=[("dot", "stdout"), ("junit", junit)]), cwd, env=env,
                                  timeout=300)
        parsed = suite.parse_junit(junit, cwd)
        try:
            os.remove(junit)
        except OSError:
            pass
        return None if parsed is None else set(suite.companions({f["file"] for f in parsed[0] if f["file"]}, cwd))

    async def run(self, spec: InvocationSpec, progress: Callable[[float], None] | None = None) -> InvocationResult:
        res = InvocationResult(inv_id=spec.inv_id, adapter=self.name, model="replay")
        t0 = time.monotonic()
        await asyncio.sleep(self.delay(spec))
        rp = spec.replay or {}
        notes: list[str] = []
        check = spec.kind == "rework" and rp.get("check")
        base_fail: set[str] | None = set()
        if rp.get("reset_to"):
            # resolve "on the new head": start from it (MERGE_HEAD survives), then re-apply the patch
            await self.git.run("read-tree", "--reset", "-u", rp["reset_to"], cwd=spec.cwd)
            await self.git.run("clean", "-q", "-fd", cwd=spec.cwd, check=False)
            if check:  # what already fails on the head we resolve onto (the fast-trunk head may be red)
                base_fail = await self._failing(spec.cwd, f"{spec.inv_id}-base")
        applied = 0
        for p in rp.get("patches", []):
            applied += await self._apply(spec.cwd, p, notes)
        for p in rp.get("fixes", []):
            applied += await self._apply(spec.cwd, p, notes)
        res.ok = True
        res.subtype = "success" if applied or not (rp.get("patches") or rp.get("fixes")) else "nothing_applied"
        if check:
            # like a real agent, run the suite: the mechanical resolution failed if it breaks a test that
            # passed on the head, or this task's own acceptance tests
            acceptance = rp.get("acceptance") or {}
            for path, content in acceptance.items():
                full = os.path.join(spec.cwd, path)
                os.makedirs(os.path.dirname(full), exist_ok=True)
                with open(full, "w", encoding="utf-8") as fh:
                    fh.write(content)
            after = await self._failing(spec.cwd, f"{spec.inv_id}-after")
            broken = None if after is None else sorted((after - (base_fail or set())) | (after & set(acceptance)))
            if after is None or broken:
                res.subtype = "unresolved"
                notes.append(f"suite after re-applying the reference patch breaks {broken or 'the run'}: "
                             "replay cannot resolve this")
        res.num_turns = self.turns
        res.cost_usd = self.cost
        res.cost_source = "reported" if self.cost else "none"
        res.wall_ms = int((time.monotonic() - t0) * 1000)
        res.duration_ms = res.wall_ms
        res.notes = notes
        res.result_text = "; ".join(notes)
        if progress and self.cost:
            progress(self.cost)
        return res
