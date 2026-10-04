"""Shared race machinery: workspace, agent pool, invocations, budget, events, final check, summary."""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import os
import shutil
import statistics
import time
import traceback
from dataclasses import dataclass, field

from . import prompts
from .agents import (Adapter, ClaudeAdapter, CodexAdapter, InvocationResult, InvocationSpec, ReplayAdapter)
from .arena import Task, classify, load_tasks, patch_strip_level, placement_modules
from .ci import CI, CIResult
from .footprint import ModuleCatalog, StepTwoPredictor, lexical_predict, normalise, prf, select
from .gitops import Git, GitError
from .procs import ProcRegistry, Runner, Sandbox
from . import suite as suite_mod


class Aborted(Exception):
    pass


@dataclass
class RaceConfig:
    policy: str = "beanstalk"
    agent: str = "replay"
    agents: int = 4
    model: str | None = None
    ci_seconds: float = 60.0
    ci_slots: int = 2
    batch: int = 4
    batch_wait: float = 0.0
    tasks: list[str] | None = None
    budget_usd: float = 25.0
    max_turns: int = 40
    agent_timeout: float = 900.0
    seed: int = 0
    out: str = "runs/dev"
    dry_run: bool = False
    arena: str = ""
    repo: str = ""
    footprint: str = "auto"
    footprint_threshold: float = 0.3
    classifier_model: str = "haiku"
    error_budget: int = 3
    snapshot: str = "green"
    merge_drivers: str = "auto"
    queue_hold: bool = True
    protect_tests: str = "own"          # own | landed: also restore landed tasks' acceptance tests (test-integrity rule)
    max_rework: int = 3
    max_fix_attempts: int = 2
    replay_median: float = 20.0
    replay_sigma: float = 0.5
    replay_cost_usd: float = 0.0
    suite_timeout: float = 300.0
    max_wall_minutes: float = 360.0
    max_invocation_usd: float = 3.0
    infra_retry_seconds: float = 10.0
    effort: str | None = None
    claude_bin: str = "claude"
    codex_bin: str = "codex"
    output_format: str = "stream-json"
    rework_resume: bool = True
    shuffle: bool = False
    force: bool = False
    codex_price: tuple = (1.25, 0.125, 10.0)

    def union(self) -> bool:
        if self.merge_drivers == "auto":
            return self.policy == "beanstalk"
        return self.merge_drivers == "union"


@dataclass
class TaskState:
    task: Task
    status: str = "pending"      # pending|running|queued|rework|landed|green|dropped
    agent: str | None = None
    base_sha: str | None = None
    head_sha: str | None = None
    worktree: str | None = None
    branch: str | None = None
    session_id: str | None = None
    predicted: dict = field(default_factory=dict)
    selected: list = field(default_factory=list)
    footprint_method: str | None = None
    started_at: float | None = None
    agent_done_at: float | None = None
    landed_at: float | None = None
    green_at: float | None = None
    landed_sha: str | None = None
    write_set: list = field(default_factory=list)
    actual_modules: list = field(default_factory=list)
    invocations: list = field(default_factory=list)
    conflicts: int = 0
    reds: int = 0
    reworks: int = 0
    infra_retries: int = 0
    drop_reason: str | None = None
    tamper: list = field(default_factory=list)

    @property
    def id(self) -> str:
        return self.task.id

    @property
    def terminal(self) -> bool:
        return self.status in ("green", "dropped")


@dataclass
class AgentSlot:
    id: str
    state: str = "idle"
    since: float = 0.0
    totals: dict = field(default_factory=lambda: {"busy": 0.0, "blocked": 0.0, "idle": 0.0})
    holding: str | None = None   # task (or ticket) bound to this agent
    running: str | None = None   # invocation in progress


class EventLog:
    def __init__(self, path: str, clock):
        self.path = path
        self.fh = open(path, "w", encoding="utf-8")
        self.seq = 0
        self.clock = clock
        self.events: list[dict] = []

    def write(self, typ: str, **fields) -> dict:
        self.seq += 1
        ev = {"seq": self.seq, "t": round(self.clock(), 3),
              "ts": dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds"), "type": typ}
        ev.update(fields)
        self.fh.write(json.dumps(ev, default=str) + "\n")
        self.fh.flush()
        self.events.append(ev)
        return ev

    def close(self) -> None:
        self.fh.close()


RACE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def snapshot_arena(arena: str, dest: str) -> tuple[str, str]:
    """Copy tasks/*.json and solutions/*.patch into the run; return (copy, sha256 of their contents)."""
    import hashlib
    h = hashlib.sha256()
    for sub, ext in (("tasks", ".json"), ("solutions", ".patch")):
        src = os.path.join(arena, sub)
        os.makedirs(os.path.join(dest, sub), exist_ok=True)
        if not os.path.isdir(src):
            continue
        for name in sorted(os.listdir(src)):
            if not name.endswith(ext):
                continue
            with open(os.path.join(src, name), "rb") as fh:
                data = fh.read()
            h.update(f"{sub}/{name}\0".encode() + data + b"\0")
            with open(os.path.join(dest, sub, name), "wb") as fh:
                fh.write(data)
    return dest, h.hexdigest()[:16]


def resolve_out(out: str) -> str:
    return os.path.abspath(out if os.path.isabs(out) else os.path.join(RACE_DIR, out))


class Race:
    """Base class. Subclasses implement ``dispatch`` (start work) and ``finished`` (stop condition)."""

    policy = "base"

    def __init__(self, cfg: RaceConfig):
        self.cfg = cfg
        self.out = resolve_out(cfg.out)
        self.work = os.path.join(self.out, "work")
        self.t0 = time.monotonic()
        self.wall_start = dt.datetime.now(dt.timezone.utc)
        self.sandbox: Sandbox | None = None
        self.registry = ProcRegistry()
        self.runner: Runner | None = None
        self.git: Git | None = None
        self.ci: CI | None = None
        self.adapter: Adapter | None = None
        self.classifier: ClaudeAdapter | None = None
        self.events: EventLog | None = None
        self.tasks: list[TaskState] = []
        self.by_id: dict[str, TaskState] = {}
        self.agents: list[AgentSlot] = []
        self.bg: set[asyncio.Task] = set()
        self.wake = asyncio.Event()
        self.lock = asyncio.Lock()
        self.aborted: str | None = None
        self.spent = 0.0
        self.inflight_cost: dict[str, float] = {}
        self.inv_seq = 0
        self.inv_stats: dict[str, dict] = {}
        self.invocations: list[dict] = []
        self.conflicts_met = 0
        self.conflict_events: list[dict] = []
        self.red_validations = 0
        self.ci_claimed = 0
        self.paused = False
        self.catalog: ModuleCatalog | None = None
        self.base_sha: str = ""
        self.repo_files: set[str] = set()
        self.ended_at: float | None = None
        self.final: dict = {}
        self.integration = os.path.join(self.work, "integration")
        self.transcripts = os.path.join(self.work, "transcripts")
        self.predictor = None
        self.footprint_method = cfg.footprint
        self.race_t0 = 0.0
        self.arena_snapshot = ""
        self.arena_digest = ""
        self.suite = suite_mod.SuiteConfig()

    # ---- clock, events, wake ----------------------------------------------------------------------

    def now(self) -> float:
        return time.monotonic() - self.t0

    def log(self, typ: str, **fields) -> dict:
        self.refresh_agents()
        assert self.events is not None
        return self.events.write(typ, **fields)

    def poke(self) -> None:
        self.wake.set()

    # ---- setup --------------------------------------------------------------------------------------

    def prepare_out(self) -> None:
        if os.path.exists(self.out):
            existing = os.listdir(self.out)
            if existing and not self.cfg.force:
                raise SystemExit(f"{self.out} exists; pass --force to replace it")
            if os.path.exists(self.work):
                shutil.rmtree(self.work)
            for name in ("events.jsonl", "summary.json", "summary.md", "config.json", "dry_run.json"):
                p = os.path.join(self.out, name)
                if os.path.exists(p):
                    os.remove(p)
        os.makedirs(self.work, exist_ok=True)
        if not self.work.startswith(os.path.join(RACE_DIR, "runs") + os.sep):
            print(f"warning: {self.work} is outside research/race/runs/, so research/.gitignore does not cover it")

    async def setup(self) -> None:
        cfg = self.cfg
        self.prepare_out()
        self.sandbox = Sandbox(self.work)
        self.registry.pidfile = os.path.join(self.work, "live_pids.txt")
        self.runner = Runner(self.sandbox, self.registry)
        self.events = EventLog(os.path.join(self.out, "events.jsonl"), self.now)
        with open(os.path.join(self.out, "config.json"), "w") as fh:
            json.dump({k: v for k, v in cfg.__dict__.items()}, fh, indent=2, default=str)
        if not os.path.exists(cfg.repo):
            raise SystemExit(f"arena repository not found: {cfg.repo} (run the arena's materialize.py)")
        # the arena's suite (default: node --test); a real repository brings its build, test files and dependency
        # snapshot (arena.json). node_modules is exposed one level above every worktree, so module resolution finds
        # it while git never sees it in a worktree
        self.suite = suite_mod.load_suite(cfg.arena)
        suite_mod.activate(self.suite)
        if self.suite.deps:
            if not os.path.isdir(self.suite.deps):
                raise SystemExit(f"dependency snapshot not found: {self.suite.deps}")
            link = os.path.join(self.work, "node_modules")
            if not os.path.lexists(link):
                os.symlink(self.suite.deps, link)
        tmp_git = Git(self.runner, self.work)
        # main only, over the pack protocol: the arena's refs/heads/ref/tNNN (reference solutions) and their
        # objects must not be reachable from agent worktrees; then drop origin so nothing can push back
        res = await tmp_git.run("clone", "-q", "--no-local", "--single-branch", "--branch", "main", "--no-tags",
                                os.path.abspath(cfg.repo), self.integration, cwd=self.work, timeout=600, check=False)
        if res.returncode != 0:
            shutil.rmtree(self.integration, ignore_errors=True)
            await tmp_git.run("clone", "-q", "--no-local", "--no-tags", os.path.abspath(cfg.repo), self.integration,
                              cwd=self.work, timeout=600)
        self.git = Git(self.runner, self.integration)
        g = self.git
        await g.run("remote", "remove", "origin", check=False)
        for k, v in (("user.name", "race-harness"), ("user.email", "race@beanstalk.invalid"),
                     ("commit.gpgsign", "false"), ("core.hooksPath", "/dev/null"), ("gc.auto", "0"),
                     ("merge.conflictstyle", "merge"), ("advice.detachedHead", "false"), ("core.autocrlf", "false"),
                     ("rerere.enabled", "false")):
            await g.run("config", k, v)
        main = await self.default_branch()
        self.base_sha = await g.rev(main)
        await g.run("checkout", "-q", "--detach", self.base_sha)
        await g.run("branch", "-f", "main", self.base_sha)
        info = os.path.join(self.integration, ".git", "info")
        os.makedirs(info, exist_ok=True)
        with open(os.path.join(info, "attributes"), "w") as fh:
            if cfg.union():
                fh.write("CHANGELOG.md merge=union\nCHANGELOG*.md merge=union\n**/CHANGELOG.md merge=union\n")
        files = (await g.out("ls-tree", "-r", "--name-only", self.base_sha)).splitlines()
        self.repo_files = set(files)
        app_prefix = not any(f.startswith("app/") for f in files)
        # race a frozen copy of tasks/ and solutions/: the arena may be edited while a race runs
        self.arena_snapshot, self.arena_digest = snapshot_arena(cfg.arena, os.path.join(self.work, "arena"))
        tasks = load_tasks(self.arena_snapshot, cfg.tasks, app_prefix=app_prefix)
        if cfg.shuffle:
            import random
            random.Random(f"{cfg.seed}:order").shuffle(tasks)
            for i, t in enumerate(tasks):
                t.order = i
        self.tasks = [TaskState(task=t) for t in tasks]
        self.by_id = {t.id: t for t in self.tasks}
        self.agents = [AgentSlot(id=f"a{i}") for i in range(max(1, cfg.agents))]
        self.ci = CI(g, self.runner, self.work, cfg.ci_slots, cfg.ci_seconds, cfg.suite_timeout)
        await self.ci.setup(self.base_sha)
        # module catalog from a checkout of base (the CI slot 0 worktree is at base right now)
        self.catalog = ModuleCatalog(os.path.join(self.ci.dir, "slot-0"))
        self.adapter = self.make_adapter()
        if self.footprint_method in ("auto", "predictor", "combined"):
            pred = StepTwoPredictor()
            if pred.fn is not None:
                self.predictor = pred
                self.footprint_method = "combined" if self.footprint_method == "combined" else "predictor"
            elif self.footprint_method in ("predictor", "combined"):
                raise SystemExit(f"--footprint predictor: {pred.error}")
            else:
                self.footprint_method = "lexical"
        if self.footprint_method == "haiku" and self.policy == "queue":
            # the queue never places by footprint: don't pay for predictions it would only report
            pred = StepTwoPredictor()
            self.predictor = pred if pred.fn is not None else None
            self.footprint_method = "predictor" if self.predictor else "lexical"
        if self.footprint_method == "haiku":
            self.classifier = ClaudeAdapter(self.runner, model=cfg.classifier_model, max_turns=3, timeout=180,
                                            transcripts=self.transcripts, binary=cfg.claude_bin,
                                            output_format="json", persist_sessions=False)

    async def default_branch(self) -> str:
        assert self.git
        for ref in ("main", "origin/main", "master", "origin/master", "HEAD"):
            res = await self.git.run("rev-parse", "--verify", "--quiet", ref + "^{commit}", check=False)
            if res.returncode == 0:
                return ref
        raise SystemExit("arena repository has no main branch")

    def make_adapter(self) -> Adapter:
        cfg = self.cfg
        assert self.runner and self.git
        if cfg.agent == "claude":
            return ClaudeAdapter(self.runner, model=cfg.model or "sonnet", max_turns=cfg.max_turns,
                                 timeout=cfg.agent_timeout, transcripts=self.transcripts, binary=cfg.claude_bin,
                                 output_format=cfg.output_format, effort=cfg.effort,
                                 persist_sessions=cfg.rework_resume)
        if cfg.agent == "codex":
            return CodexAdapter(self.runner, model=cfg.model, timeout=cfg.agent_timeout,
                                transcripts=self.transcripts, binary=cfg.codex_bin, price=cfg.codex_price,
                                effort=cfg.effort)
        return ReplayAdapter(self.git, seed=cfg.seed, median=cfg.replay_median, sigma=cfg.replay_sigma,
                             cost_usd=cfg.replay_cost_usd)

    # ---- agent pool -----------------------------------------------------------------------------------

    def refresh_agents(self) -> None:
        now = self.now()
        waiting_work = self.paused and any(t.status == "pending" for t in self.tasks)
        for a in self.agents:
            state = "busy" if a.running else "blocked" if (a.holding or waiting_work) else "idle"
            if state != a.state:
                a.totals[a.state] += now - a.since
                a.state, a.since = state, now

    def close_agent_clock(self) -> None:
        now = self.now()
        for a in self.agents:
            a.totals[a.state] += now - a.since
            a.since = now

    def free_agent(self) -> AgentSlot | None:
        for a in self.agents:
            if not a.holding and not a.running:
                return a
        return None

    def hold(self, agent: AgentSlot, what: str) -> None:
        agent.holding = what
        self.refresh_agents()

    def release(self, agent_id: str | None) -> None:
        for a in self.agents:
            if a.id == agent_id:
                a.holding = None
        self.refresh_agents()
        self.poke()

    def agent(self, agent_id: str | None) -> AgentSlot | None:
        return next((a for a in self.agents if a.id == agent_id), None)

    # ---- background work --------------------------------------------------------------------------------

    def spawn(self, coro, name: str) -> asyncio.Task:
        task = asyncio.create_task(self._guard(coro, name), name=name)
        self.bg.add(task)
        task.add_done_callback(self.bg.discard)
        return task

    async def _guard(self, coro, name: str) -> None:
        try:
            await coro
        except asyncio.CancelledError:
            raise
        except Aborted:
            pass
        except Exception as e:  # noqa: BLE001 - a crash anywhere must stop the race visibly
            self.log("error", where=name, error=repr(e), traceback=traceback.format_exc()[-4000:])
            self.abort(f"error in {name}: {e!r}")
        finally:
            self.poke()

    def abort(self, reason: str) -> None:
        if not self.aborted:
            self.aborted = reason
            if self.events:
                self.log("abort", reason=reason)
        self.poke()

    # ---- budget and invocations ---------------------------------------------------------------------------

    def committed_cost(self) -> float:
        return self.spent + sum(self.inflight_cost.values())

    def check_budget(self) -> None:
        if self.committed_cost() >= self.cfg.budget_usd:
            self.abort(f"budget: ${self.committed_cost():.2f} of ${self.cfg.budget_usd:.2f}")
        if self.aborted:
            raise Aborted(self.aborted)

    def new_inv_id(self, kind: str) -> str:
        self.inv_seq += 1
        return f"inv{self.inv_seq:04d}-{kind}"

    async def invoke(self, spec: InvocationSpec, agent: AgentSlot | None, adapter: Adapter | None = None
                     ) -> InvocationResult:
        """Run one agent invocation. The budget is checked before it starts and while it runs."""
        adapter = adapter or self.adapter
        assert adapter is not None
        self.check_budget()
        remaining = self.cfg.budget_usd - self.committed_cost()
        spec.budget_cap_usd = min(self.cfg.max_invocation_usd, remaining)
        if agent:
            agent.running = spec.inv_id
        self.inflight_cost[spec.inv_id] = 0.0
        self.log("invocation.start", inv=spec.inv_id, kind=spec.kind, task=spec.task_id, agent=spec.agent_id,
                 adapter=adapter.name, model=getattr(adapter, "model", None), attempt=spec.attempt,
                 resume=spec.resume_session, cwd=os.path.relpath(spec.cwd, self.out),
                 budget_cap_usd=round(spec.budget_cap_usd, 4))

        def progress(est: float) -> None:
            self.inflight_cost[spec.inv_id] = est
            if self.committed_cost() >= self.cfg.budget_usd:
                self.abort(f"budget: ${self.committed_cost():.2f} of ${self.cfg.budget_usd:.2f} (mid-invocation)")

        try:
            res = await adapter.run(spec, progress)
        except asyncio.CancelledError:
            # killed by an abort: charge what the stream showed so far (estimated, conservative)
            est = self.inflight_cost.get(spec.inv_id, 0.0)
            self.spent += est
            self.log("invocation.end", inv=spec.inv_id, kind=spec.kind, task=spec.task_id, agent=spec.agent_id,
                     ok=False, killed=True, cost_usd=round(est, 6), cost_source="estimated" if est else "none",
                     spent_usd=round(self.spent, 4))
            raise
        finally:
            if agent:
                agent.running = None
            self.inflight_cost.pop(spec.inv_id, None)
        self.spent += res.cost_usd
        st = self.inv_stats.setdefault(spec.kind, {"count": 0, "cost_usd": 0.0, "turns": 0, "wall_s": 0.0,
                                                    "input_tokens": 0, "output_tokens": 0,
                                                    "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0,
                                                    "infra_errors": 0, "timeouts": 0, "estimated_cost": 0})
        st["count"] += 1
        st["cost_usd"] += res.cost_usd
        st["turns"] += res.num_turns or 0
        st["wall_s"] += res.wall_ms / 1000
        for k in ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"):
            st[k] += int(res.usage.get(k, 0) or 0)
        st["infra_errors"] += 1 if res.infra_error else 0
        st["timeouts"] += 1 if res.timed_out else 0
        st["estimated_cost"] += 1 if res.cost_source == "estimated" else 0
        ev = res.to_event()
        ev.pop("inv_id", None)
        ev.pop("adapter", None)
        ev.pop("model", None)
        self.log("invocation.end", inv=spec.inv_id, kind=spec.kind, task=spec.task_id, agent=spec.agent_id,
                 spent_usd=round(self.spent, 4), **ev)
        if res.init:
            self.log("invocation.init", inv=spec.inv_id, **res.init)
        self.invocations.append({"inv": spec.inv_id, "kind": spec.kind, "task": spec.task_id,
                                 "cost_usd": res.cost_usd, "turns": res.num_turns, "wall_ms": res.wall_ms,
                                 "duration_api_ms": res.duration_api_ms, "startup_ms": res.startup_ms,
                                 "subtype": res.subtype, "infra_error": res.infra_error,
                                 "overage": bool((res.rate_limit or {}).get("isUsingOverage")),
                                 "rate_limit": res.rate_limit})
        if self.spent >= self.cfg.budget_usd:
            self.abort(f"budget: ${self.spent:.2f} of ${self.cfg.budget_usd:.2f}")
        if res.rate_limited:
            self.abort(f"rate limited ({(res.rate_limit or {}).get('rateLimitType')}, resets at "
                       f"{(res.rate_limit or {}).get('resetsAt')}): stopping rather than dropping tasks")
        return res

    # ---- CI -------------------------------------------------------------------------------------------------

    def claim_ci(self) -> None:
        """Reserve a CI slot synchronously when a CI job is spawned (released when it finishes)."""
        self.ci_claimed += 1

    def ci_available(self) -> int:
        return self.cfg.ci_slots - self.ci_claimed

    async def run_ci(self, sha: str, purpose: str, *, claimed: bool = False, meta: dict | None = None,
                     **kw) -> CIResult:
        assert self.ci
        if not claimed:
            self.claim_ci()
        ci_id = self.ci.new_id()
        meta = meta or {}
        started: dict = {}

        def on_start(slot: int) -> None:
            started.update(t=time.monotonic(), slot=slot)
            self.log("ci.start", ci=ci_id, sha=sha, purpose=purpose, slot=slot, **meta)

        try:
            res = await self.ci.run(sha, purpose, ci_id=ci_id, on_start=on_start, **kw)
        except asyncio.CancelledError:
            if started:  # a cancelled speculative run still used its slot
                self.log("ci.end", ci=ci_id, sha=sha, purpose=purpose, green=None, cancelled=True,
                         slot=started["slot"], ci_seconds=round(time.monotonic() - started["t"], 3), **meta)
            raise
        finally:
            self.ci_claimed -= 1
            self.poke()
        if not res.green and purpose in ("batch", "validate"):
            self.red_validations += 1
        self.log("ci.end", ci=ci_id, sha=sha, purpose=purpose, green=res.green, slot=res.slot,
                 failing_files=res.failing_files, failing_tests=[f"{t['file']} > {t['name']}"
                                                                 for t in res.failing_tests][:30],
                 tests=res.tests, failures=res.failures, suite_seconds=round(res.suite_seconds, 3),
                 ci_seconds=round(res.ci_seconds, 3), timed_out=res.timed_out, **meta)
        return res

    async def invoke_rework(self, spec: InvocationSpec, agent: AgentSlot, ts: TaskState,
                            fresh_prompt: str) -> InvocationResult:
        """A rework that resumes the author's session; if the resume itself fails, retry once as a fresh
        session with the full context instead of wasting the rework round."""
        res = await self.invoke(spec, agent)
        ts.invocations.append(spec.inv_id)
        if res.infra_error and spec.resume_session and not res.rate_limited and not self.aborted:
            ts.session_id = None
            self.log("invocation.retry", task=ts.id, reason=f"resume failed: {res.infra_error[:200]}")
            spec = InvocationSpec(**{**spec.__dict__, "inv_id": self.new_inv_id(spec.kind), "resume_session": None,
                                     "prompt": fresh_prompt})
            res = await self.invoke(spec, agent)
            ts.invocations.append(spec.inv_id)
        if res.session_id and not res.infra_error:
            ts.session_id = res.session_id
        return res

    # ---- footprints ----------------------------------------------------------------------------------------

    async def predict_footprints(self) -> None:
        """Predict every task's modules before the race starts (text only; classifier calls run 8 at a time)."""
        sem = asyncio.Semaphore(8)

        async def one(ts: TaskState) -> None:
            async with sem:
                await self.predict_one(ts)

        await asyncio.gather(*(one(ts) for ts in self.tasks))

    async def predict_one(self, ts: TaskState) -> None:
        assert self.catalog
        known = set(self.catalog.modules)
        text = f"{ts.task.title}\n\n{ts.task.prompt}"
        method = self.footprint_method
        probs: dict[str, float] = {}
        try:
            if method in ("predictor", "combined") and self.predictor:
                probs = normalise(self.predictor(text, self.catalog.context()), known)
                if method == "combined":  # recall-oriented: the higher of the two estimates per module
                    for m, p in lexical_predict(ts.task.prompt, ts.task.title, self.catalog).items():
                        probs[m] = max(probs.get(m, 0.0), p)
                    probs = dict(sorted(probs.items(), key=lambda kv: -kv[1]))
            elif method == "haiku":
                probs = await self.classify(ts, text)
        except Aborted:
            raise
        except Exception as e:  # noqa: BLE001 - fall back rather than lose the task's prediction
            self.log("footprint.error", task=ts.id, method=method, error=repr(e)[:500])
            method, probs = "lexical", {}
        if not probs and method != "lexical":
            method = "lexical+fallback"  # the primary method had no signal for this task
        if method.startswith("lexical"):
            probs = lexical_predict(ts.task.prompt, ts.task.title, self.catalog)
        ts.predicted = {m: round(p, 4) for m, p in probs.items()}
        ts.selected = select(probs, self.cfg.footprint_threshold)
        ts.footprint_method = method
        self.log("footprint.predicted", task=ts.id, method=method, selected=ts.selected,
                 probs=dict(list(ts.predicted.items())[:8]))

    async def classify(self, ts: TaskState, text: str) -> dict[str, float]:
        assert self.classifier and self.catalog
        cwd = os.path.join(self.work, "classifier")
        os.makedirs(cwd, exist_ok=True)
        spec = InvocationSpec(inv_id=self.new_inv_id("classifier"), kind="classifier", task_id=ts.id, agent_id=None,
                              cwd=cwd, prompt=prompts.classifier(text, self.catalog.describe()),
                              json_schema=prompts.CLASSIFIER_SCHEMA, no_tools=True, max_turns=3, timeout=180)
        res = await self.invoke(spec, None, self.classifier)
        data = res.structured_output
        if data is None and res.result_text:
            try:
                data = json.loads(res.result_text[res.result_text.find("{"): res.result_text.rfind("}") + 1])
            except (ValueError, json.JSONDecodeError):
                data = None
        out: dict[str, float] = {}
        for item in (data or {}).get("modules", []) if isinstance(data, dict) else []:
            try:
                out[str(item["module"])] = float(item["probability"])
            except (KeyError, TypeError, ValueError):
                continue
        return normalise(out, set(self.catalog.modules))

    # ---- task workspace ------------------------------------------------------------------------------------

    def write_acceptance(self, wt: str, tasks: list[Task]) -> None:
        for t in tasks:
            for path, content in t.acceptance_tests.items():
                full = os.path.join(wt, path)
                os.makedirs(os.path.dirname(full), exist_ok=True)
                with open(full, "w", encoding="utf-8") as fh:
                    fh.write(content)

    def restore_acceptance(self, wt: str, tasks: list[Task]) -> list[str]:
        """Put canonical acceptance tests back; returns the paths an agent had changed."""
        changed = []
        for t in tasks:
            for path, content in t.acceptance_tests.items():
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

    def patch_ref(self, path: str | None) -> list[dict]:
        if not path:
            return []
        with open(path, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
        return [{"path": path, "strip": patch_strip_level(text, self.repo_files)}]

    def involved_fixes(self, task_ids: list[str]) -> list[dict]:
        """Replay-only repair patches for tasks in a red: their own and their coupling partners'."""
        seen, out = set(), []
        for tid in task_ids:
            ts = self.by_id.get(tid)
            if not ts:
                continue
            for cand in [tid, *ts.task.partners("semantic")]:
                c = self.by_id.get(cand)
                if c and c.task.fix_patch and cand not in seen:
                    seen.add(cand)
                    out += self.patch_ref(c.task.fix_patch)
        return out

    def can_resume(self, ts: TaskState) -> bool:
        """Rework resumes the author's session when the CLI supports it and its last turn reported."""
        ad = self.adapter
        return bool(self.cfg.rework_resume and ts.session_id and isinstance(ad, ClaudeAdapter)
                    and ad.resumable(ts.session_id))

    async def open_task_worktree(self, ts: TaskState, base: str) -> None:
        assert self.git
        ts.worktree = os.path.join(self.work, "agents", ts.id)
        ts.branch = f"task/{ts.id}"
        await self.git.add_worktree(ts.worktree, base, ts.branch)
        self.write_acceptance(ts.worktree, [ts.task])

    async def run_initial(self, ts: TaskState, agent: AgentSlot, base: str) -> bool:
        """Start a task from ``base``: worktree, acceptance tests, initial invocation, harness commit."""
        ts.status, ts.agent, ts.base_sha = "running", agent.id, base
        ts.started_at = ts.started_at if ts.started_at is not None else self.now()
        await self.open_task_worktree(ts, base)
        self.log("task.start", task=ts.id, agent=agent.id, base=base, predicted=ts.selected)
        while True:
            spec = InvocationSpec(inv_id=self.new_inv_id("initial"), kind="initial", task_id=ts.id, agent_id=agent.id,
                                  cwd=ts.worktree, prompt=prompts.initial(ts.task), attempt=ts.infra_retries + 1,
                                  replay={"patches": self.patch_ref(ts.task.solution)})
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
        ts.session_id = res.session_id
        ts.agent_done_at = self.now()
        await self.commit_task(ts, spec.inv_id, "initial")
        return True

    async def protect_landed(self, wt: str, exclude: Task | None) -> list[str]:
        """``--protect-tests landed``: restore a landed task's acceptance test only when that task's exact
        version is in the worktree's lineage (HEAD or an in-progress MERGE_HEAD) and the working copy differs,
        i.e. this agent edited or deleted it. A path whose lineage still holds an older version (a base test
        the landed task overwrote, before that task reached this worktree) is not touched."""
        if self.cfg.protect_tests != "landed" or not self.git:
            return []
        refs = ["HEAD"]
        if os.path.exists(os.path.join(await self.git.git_dir(wt), "MERGE_HEAD")):
            refs.append("MERGE_HEAD")
        changed: list[str] = []
        for o in self.tasks:
            if o.task is exclude or not o.landed_sha or o.status == "dropped":
                continue
            for path, content in o.task.acceptance_tests.items():
                in_lineage = False
                for ref in refs:
                    res = await self.git.run("show", f"{ref}:{path}", cwd=wt, check=False)
                    if res.returncode == 0 and res.stdout == content:
                        in_lineage = True
                        break
                if not in_lineage:
                    continue
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
        assert self.git and ts.worktree
        tamper = self.restore_acceptance(ts.worktree, [ts.task]) + await self.protect_landed(ts.worktree, ts.task)
        if tamper:
            ts.tamper += tamper
            own = [p for p in tamper if p in ts.task.acceptance_tests]
            self.log("acceptance.restored", task=ts.id, paths=tamper, inv=inv_id,
                     others=[p for p in tamper if p not in own])
        msg = f"{ts.task.title}\n\nTask: {ts.id}\nKind: {kind}\nInvocation: {inv_id}\n"
        head, created = await self.git.commit_all(ts.worktree, msg)
        ts.head_sha = head
        files = await self.git.changed_files(ts.base_sha or self.base_sha, head)
        self.log("task.commit", task=ts.id, sha=head, kind=kind, new_commit=created,
                 files=[f for f in files if f not in ts.task.acceptance_tests])
        return head

    async def markers_left(self, wt: str) -> list[str]:
        assert self.git
        paths = await self.git.status_paths(wt)
        return await self.git.files_with_markers(wt, paths)

    def drop(self, ts: TaskState, reason: str) -> None:
        ts.status, ts.drop_reason = "dropped", reason
        self.log("task.drop", task=ts.id, reason=reason)
        if ts.agent:
            agent = self.agent(ts.agent)
            if agent and agent.holding == ts.id:
                self.release(ts.agent)

    async def actual_modules_so_far(self, ts: TaskState) -> set[str]:
        if not ts.worktree or not os.path.isdir(ts.worktree) or not self.git:
            return set()
        try:
            paths = await self.git.status_paths(ts.worktree)
        except GitError:
            return set()
        return placement_modules(p for p in paths if p not in ts.task.acceptance_tests)

    async def record_landing(self, ts: TaskState, sha: str, parent: str) -> None:
        assert self.git
        files = await self.git.changed_files(parent, sha)
        ts.landed_sha = sha
        ts.write_set = files
        ts.actual_modules = sorted(placement_modules(f for f in files if f not in ts.task.acceptance_tests))

    # ---- main loop ------------------------------------------------------------------------------------------

    async def dispatch(self) -> None:
        raise NotImplementedError

    def finished(self) -> bool:
        raise NotImplementedError

    def final_green_sha(self) -> str:
        raise NotImplementedError

    async def run(self) -> int:
        await self.setup()
        cfg = self.cfg
        self.log("race.setup", policy=self.policy, out=self.out, repo=cfg.repo, arena=cfg.arena,
                 arena_digest=self.arena_digest, setup_seconds=round(self.now(), 3),
                 suite={k: v for k, v in self.suite.__dict__.items()})
        try:  # intake: footprints are predicted when tasks are filed, before the race clock starts
            await self.predict_footprints()
        except Aborted:
            pass
        self.race_t0 = self.now()
        for a in self.agents:
            a.since, a.totals = self.race_t0, {"busy": 0.0, "blocked": 0.0, "idle": 0.0}
        self.log("race.start", policy=self.policy, agent=cfg.agent, model=getattr(self.adapter, "model", None),
                 agents=cfg.agents, ci_seconds=cfg.ci_seconds, ci_slots=cfg.ci_slots, batch=cfg.batch,
                 tasks=[t.id for t in self.tasks], budget_usd=cfg.budget_usd, seed=cfg.seed, base=self.base_sha,
                 union_merge=cfg.union(), snapshot=cfg.snapshot, queue_hold=cfg.queue_hold, protect_tests=cfg.protect_tests,
                 footprint=self.footprint_method, error_budget=cfg.error_budget,
                 intake_seconds=round(self.race_t0 - self.events.events[0]["t"], 3))
        deadline = self.race_t0 + cfg.max_wall_minutes * 60
        code = 0
        try:
            while not self.aborted:
                if self.now() > deadline:
                    self.abort(f"wall-clock limit of {cfg.max_wall_minutes} minutes")
                    break
                async with self.lock:
                    await self.dispatch()
                if self.finished():
                    break
                self.wake.clear()
                try:
                    await asyncio.wait_for(self.wake.wait(), timeout=0.5)
                except asyncio.TimeoutError:
                    pass
        except Aborted:
            pass
        finally:
            await self.shutdown()
        if self.aborted:
            code = 2 if self.aborted.startswith("budget") else 3
        return code

    async def shutdown(self) -> None:
        for t in list(self.bg):
            t.cancel()
        if self.bg:
            await asyncio.gather(*self.bg, return_exceptions=True)
        killed = await self.registry.kill_all()
        self.ended_at = self.now()
        self.close_agent_clock()
        self.log("race.end", aborted=self.aborted, killed_processes=killed, spent_usd=round(self.spent, 4))
        try:
            self.final = await self.final_check()
        except Exception as e:  # noqa: BLE001
            self.final = {"error": repr(e)}
        self.log("final.check", **{k: v for k, v in self.final.items() if k != "per_task"})
        from .summary import write_summary
        write_summary(self)
        assert self.events
        self.events.close()

    async def final_check(self) -> dict:
        """Full suite, then every task's acceptance tests, on the final green commit."""
        assert self.git and self.ci
        sha = self.final_green_sha()
        suite: CIResult = await self.run_ci(sha, "final", latency=0, meta={"check": "suite"})
        extra = {}
        for ts in self.tasks:
            extra.update(ts.task.acceptance_tests)
        acc: CIResult = await self.run_ci(sha, "final", latency=0, extra_files=extra, meta={"check": "acceptance"})
        failing = set(acc.failing_files or [])
        passing = set(acc.passing_files)
        per_task = {}
        for ts in self.tasks:
            # files the suite reports on (a fixture an acceptance test loads is judged through that test)
            paths = {p for p in ts.task.acceptance_tests if self.suite.reported(p)} or set(ts.task.acceptance_tests)
            ok = bool(paths) and paths <= passing and not (paths & failing) and acc.failing_files is not None
            committed_ok = True
            if ts.landed_sha:
                for p, content in ts.task.acceptance_tests.items():
                    r = await self.git.run("show", f"{sha}:{p}", check=False)
                    if r.returncode != 0 or r.stdout != content:
                        committed_ok = False
            per_task[ts.id] = {"acceptance_pass": ok, "status": ts.status, "committed_tests_intact": committed_ok}
        landed = [t for t in self.tasks if t.status in ("green",)]
        # base tests that landed changes edited or deleted (acceptance tests are restored by the harness)
        acceptance = {p for t in self.tasks for p in t.task.acceptance_tests}
        changed = await self.git.changed_files(self.base_sha, sha)
        base_tests_changed = sorted(p for p in changed if p in self.repo_files and p not in acceptance
                                    and classify(p) == "test")
        return {
            "sha": sha, "suite_green": suite.green, "suite_tests": suite.tests, "suite_failures": suite.failures,
            "acceptance_run_green": acc.green,
            "tasks_accepted": sum(1 for v in per_task.values() if v["acceptance_pass"]),
            "tasks_total": len(self.tasks),
            "green_tasks_accepted": sum(1 for t in landed if per_task[t.id]["acceptance_pass"]),
            "green_tasks": len(landed),
            "correct": suite.green and all(per_task[t.id]["acceptance_pass"] for t in landed),
            "all_tasks_accepted": acc.green and all(v["acceptance_pass"] for v in per_task.values()),
            "failing_files": sorted(failing)[:50],
            "base_tests_changed": base_tests_changed,
            "per_task": per_task,
        }

    # ---- shared metrics helpers -------------------------------------------------------------------------------

    def footprint_quality(self) -> dict:
        rows, vs_oracle = [], []
        for ts in self.tasks:
            if ts.landed_sha is None:
                continue
            pred, act = set(ts.selected), set(ts.actual_modules)
            rows.append(prf(pred, act))
            oracle = placement_modules(p for p in ts.task.oracle_paths if p not in ts.task.acceptance_tests) \
                if ts.task.oracle_paths else set(ts.task.oracle_modules)
            if oracle:
                vs_oracle.append(prf(pred, oracle))

        def avg(rs: list[dict]) -> dict:
            if not rs:
                return {}
            return {k: round(statistics.fmean(r[k] for r in rs), 4) for k in ("precision", "recall", "f1")} | {
                "tasks": len(rs),
                "micro_recall": round(sum(r["tp"] for r in rs) / max(sum(r["actual"] for r in rs), 1), 4),
                "micro_precision": round(sum(r["tp"] for r in rs) / max(sum(r["pred"] for r in rs), 1), 4)}

        return {"method": self.footprint_method, "threshold": self.cfg.footprint_threshold,
                "vs_actual": avg(rows), "vs_oracle": avg(vs_oracle)}
