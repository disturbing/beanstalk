"""Remote race driver: agents run here, every integration decision is made by beanstalk's gateway on Cloudflare.

``RemoteRace`` creates a run from the arena tasks and the race config (``POST /v1/runs``), pushes the arena base to
the sprout and the stalk through the gateway's git proxy, starts the run, then runs one loop per agent slot. A loop
long-polls ``next``; for each invocation it prepares the bean's workspace as the driver contract says
(packages/gateway/README.md), runs the harness's own adapter (``agents.py``: claude, codex, replay), commits
harness-style (``core.py`` ``restore_acceptance`` and ``protect_landed``, then the gateway's commit message), pushes
the bean branch and posts the result. When every slot is told ``done`` it downloads the gateway's ``events.jsonl``
and ``summary.json`` (the harness schema) and renders ``summary.md`` with ``summary.py``.

Secrets stay in memory. Git receives a slot or seed token through ``GIT_CONFIG_*`` environment variables (never
argv, never a config file), agents never see a token, and error text is scrubbed of every token before it is
logged or posted.
"""
from __future__ import annotations

import asyncio
import json
import os
import random
import re
import shutil
import sys
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field

from .agents import Adapter, ClaudeAdapter, InvocationResult, InvocationSpec
from .arena import load_tasks
from .core import EventLog, Race, RaceConfig, TaskState, snapshot_arena
from .footprint import ModuleCatalog, StepTwoPredictor
from .gitops import Git, GitError
from .procs import Runner, Sandbox

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
DEV_VARS = os.path.join(REPO_ROOT, "packages", "gateway", ".dev.vars")
USER_AGENT = "beanstalk-race-driver/1"
HTTP_TIMEOUT = 60.0         # every gateway route but the long poll
POLL_TIMEOUT = 60.0         # the gateway answers a long poll within 25 s
GIT_TIMEOUT = 300.0         # clone, fetch or push through the git proxy
PROGRESS_INTERVAL = 2.0     # at most one cost update per invocation every this many seconds
FINISH_TIMEOUT = 1800.0     # how long to wait for the final check after a stop
EVENTS_PAGE = 5000          # the gateway's largest events page
# What a tests-first author may add: the paths `node --test` picks up by default (E1's `e1_tests.TEST_FILE`)
TEST_FILE = re.compile(r"(^|/)([^/]*[._-]test|test[-_][^/]*|test)\.(c|m)?[jt]s$|(^|/)test/[^/]+\.(c|m)?[jt]s$")
WALL_GRACE = 900.0          # past --max-wall-minutes, how long to wait for the gateway's own end of the race
OUTAGE_SECONDS = 300.0      # an agent-CLI outage (auth, rate limit, API down) longer than this stops the run
INFRA_BACKOFF = 15.0        # first pause of a slot after such a failure; doubles per retry
INFRA_BACKOFF_CAP = 60.0
WATCHDOG_GRACE = 300.0      # the gateway's watchdog: agent_timeout + this after delivery (engine/invocations.ts)
PROBE_MODEL = "haiku"       # the one-turn auth probe a claude race makes before it creates the run
POLICIES = ("queue", "beanstalk-v2")
V2_DEFAULTS = {"preland_mode": "locked", "preland_seconds": 0.0, "decision_seconds": 30.0,
               "decision_oracle": "landed"}  # the local harness's defaults (policy_beanstalk_v2.py, _preland.py)
# v2.2/v2.3 knobs: sent only when set in the environment, so the gateway's defaults apply otherwise
# (sprout window, sampled re-check, the agent released during its check, flake-confirmed reverts,
# read-set inherited reds, early tickets, re-executed losers; v2.5: reconcile with every landed party,
# escalation after one repeated red, lone-suspect reverts, base culprits, window sizes, E6's start cards,
# rescue, dynamic culprits)
V22_ENV = {"recheck": ("PRELAND_RECHECK", str), "recheck_fallback": ("PRELAND_ADAPT_FALLBACK", str),
           "window": ("WINDOW", str), "release_on_check": ("RELEASE_ON_CHECK", bool),
           "flake_confirm": ("FLAKE_CONFIRM", bool), "inherited_reds": ("INHERITED_REDS", str),
           "early_tickets": ("EARLY_TICKETS", bool), "reconcile": ("RECONCILE", bool),
           "escalate_after": ("ESCALATE_AFTER", int), "reconcile_parties": ("RECONCILE_PARTIES", int),
           "tests_first": ("TESTS_FIRST", bool), "targeted_landing_check": ("TARGETED_LANDING_CHECK", bool),
           "decision_outcome": ("DECISION_OUTCOME", str), "decision_mode": ("DECISION_MODE", str),
           "human_timeout_seconds": ("HUMAN_TIMEOUT_SECONDS", float),
           "single_suspect_revert": ("SINGLE_SUSPECT_REVERT", bool), "validation_first": ("VALIDATION_FIRST", bool),
           "base_culprits": ("BASE_CULPRITS", bool), "window_start": ("WINDOW_START", int),
           "window_growth": ("WINDOW_GROWTH", int), "window_max": ("WINDOW_MAX", int), "window_min": ("WINDOW_MIN", int),
           "start_cards": ("START_CARDS", bool), "rescue": ("RESCUE", bool),
           "dynamic_culprits": ("DYNAMIC_CULPRITS", bool)}
NET_GIT_ENV_DROP = re.compile(r"^(GIT_TRACE.*|GIT_CURL_VERBOSE|GIT_ASKPASS|SSH_ASKPASS|"
                              r"GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+|PARAMETERS))$")


class DriverError(RuntimeError):
    """A failure of the driver's own work (git through the proxy, the workspace), reported as an infra error."""


# An agent CLI reports refused credentials, rate limits and API outages as an ``is_error`` result (or a crash with
# the message on stderr), not as the agent's work. Posting one would make the engine rework or drop the bean.
INFRA_PATTERNS = (
    ("auth", re.compile(r"request not allowed|/login\b|invalid api key|not logged in|oauth token (?:has )?"
                        r"(?:expired|been revoked)|authentication_error|permission_error|api error: 40[13]\b|"
                        r"credit balance is too low", re.I)),
    ("rate-limit", re.compile(r"api error: 429\b|rate_limit_error|rate.?limit|usage limit|hit your limit", re.I)),
    ("api-unavailable", re.compile(r"api error: 5\d\d\b|overloaded_error|\boverloaded\b", re.I)),
)


def infra_failure(res: InvocationResult) -> tuple[str, str] | None:
    """(kind, message) when an invocation failed for reasons outside the agent's work: refused credentials, a rate
    limit or an unavailable API. Only an error result, a crash or a rate-limit flag is inspected, never the text of
    a normal result (an agent may well write about HTTP 403s)."""
    if res.rate_limited:
        return "rate-limit", (res.result_text or res.infra_error or json.dumps(res.rate_limit or {}))[:400]
    if not (res.is_error or res.infra_error):
        return None
    text = " ".join(t for t in (res.result_text, res.infra_error) if t)
    for kind, pattern in INFRA_PATTERNS:
        if pattern.search(text):
            return kind, text.strip()[:400]
    return None


def load_admin_token(env: dict | None = None, dev_vars: str = DEV_VARS) -> str | None:
    """The gateway admin token: ``$BEANSTALK_ADMIN_TOKEN`` (removed from the environment so no child process
    inherits it), else ``ADMIN_TOKEN`` in packages/gateway/.dev.vars. Never printed."""
    env = os.environ if env is None else env
    token = env.pop("BEANSTALK_ADMIN_TOKEN", None)
    if token:
        return token.strip()
    try:
        with open(dev_vars, encoding="utf-8") as fh:
            for line in fh:
                key, sep, value = line.strip().partition("=")
                if sep and key.strip() == "ADMIN_TOKEN":
                    value = value.strip().strip("'\"")
                    return value or None
    except OSError:
        return None
    return None


def v2_settings(overrides: dict | None = None, env: dict | None = None) -> dict:
    """v2 knobs, resolved the same way for both forges: flag, else the harness's environment variable
    (PRELAND_MODE, PRELAND_SECONDS, DECISION_SECONDS, DECISION_ORACLE), else the local harness's default."""
    env = os.environ if env is None else env
    overrides = overrides or {}
    out = {}
    for key, default in V2_DEFAULTS.items():
        value = overrides.get(key)
        if value is None:
            value = env.get(key.upper()) or None
        if value is None:
            value = default
        out[key] = float(value) if isinstance(default, float) else str(value)
    for key, (name, kind) in V22_ENV.items():
        raw = env.get(name)
        if raw:
            out[key] = raw.strip().lower() in ("1", "true", "yes", "on") if kind is bool else kind(raw)
    return out


class Secrets:
    """Every token the driver holds, so no error message or log line can carry one."""

    def __init__(self) -> None:
        self.values: set[str] = set()

    def add(self, value: str | None) -> None:
        if value and len(value) >= 8:
            self.values.add(value)

    def scrub(self, text: object) -> str:
        out = str(text)
        for value in self.values:
            out = out.replace(value, "<redacted>")
        return out


# ---- gateway HTTP client ---------------------------------------------------------------------------

class GatewayError(RuntimeError):
    def __init__(self, method: str, path: str, status: int | None, code: str, message: str):
        self.method, self.path, self.status, self.code, self.message = method, path, status, code, message
        super().__init__(f"{method} {path}: {status if status is not None else 'network error'} {code}: {message}")

    @property
    def transient(self) -> bool:
        return self.status is None or self.status == 429 or self.status >= 500


class GatewayClient:
    """Blocking JSON client for the gateway (urllib, stdlib only). Callers run it off the event loop."""

    def __init__(self, base_url: str, admin_token: str | None, secrets: Secrets):
        self.base = base_url.rstrip("/")
        self.admin = admin_token
        self.secrets = secrets
        secrets.add(admin_token)

    def request(self, method: str, path: str, *, token: str | None = None, body: object = None,
                timeout: float = HTTP_TIMEOUT, as_json: bool = True) -> object:
        data = None if body is None else json.dumps(body, allow_nan=False).encode("utf-8")
        req = urllib.request.Request(self.base + path, data=data, method=method)
        req.add_header("User-Agent", USER_AGENT)
        req.add_header("Accept", "application/json")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as e:
            text = e.read().decode("utf-8", errors="replace")
            code, message = "http_error", text[:600]
            try:
                err = json.loads(text).get("error") or {}
                code, message = str(err.get("code") or code), str(err.get("message") or message)
                if err.get("issues"):
                    message += f" {json.dumps(err['issues'])[:1500]}"
            except (ValueError, AttributeError):
                pass
            raise GatewayError(method, path, e.code, code, self.secrets.scrub(message)) from None
        except (urllib.error.URLError, OSError, ValueError) as e:  # timeouts, resets, DNS, TLS
            raise GatewayError(method, path, None, "network", self.secrets.scrub(repr(e))[:600]) from None
        text = raw.decode("utf-8", errors="replace")
        if not as_json:
            return text
        try:
            return json.loads(text) if text.strip() else {}
        except ValueError:
            raise GatewayError(method, path, 200, "bad_json", self.secrets.scrub(text[:300])) from None

    # admin and read routes
    def healthz(self) -> dict:
        return self.request("GET", "/healthz", timeout=20)  # type: ignore[return-value]

    def create_run(self, config: dict) -> dict:
        return self.request("POST", "/v1/runs", token=self.admin, body=config, timeout=120)  # type: ignore

    def seed_token(self, run: str) -> dict:
        return self.request("POST", f"/v1/runs/{run}/seed-token", token=self.admin)  # type: ignore

    def start(self, run: str) -> dict:
        return self.request("POST", f"/v1/runs/{run}/start", token=self.admin, timeout=120)  # type: ignore

    def stop(self, run: str, reason: str) -> dict:
        return self.request("POST", f"/v1/runs/{run}/stop", token=self.admin, body={"reason": reason[:200]})  # type: ignore

    def reissue_tokens(self, run: str) -> dict:
        return self.request("POST", f"/v1/runs/{run}/tokens", token=self.admin)  # type: ignore

    def view(self, run: str) -> dict:
        return self.request("GET", f"/v1/runs/{run}", token=self.admin)  # type: ignore

    def summary(self, run: str) -> dict:
        return self.request("GET", f"/v1/runs/{run}/summary", token=self.admin, timeout=120)  # type: ignore

    def events_jsonl(self, run: str, after: int, limit: int) -> str:
        query = urllib.parse.urlencode({"after": after, "limit": limit, "format": "jsonl"})
        return self.request("GET", f"/v1/runs/{run}/events?{query}", token=self.admin, timeout=120,  # type: ignore
                            as_json=False)

    # driver routes (slot token)
    def next(self, run: str, slot: str, token: str) -> dict:
        return self.request("POST", f"/v1/runs/{run}/agents/{slot}/next", token=token, timeout=POLL_TIMEOUT)  # type: ignore

    def result(self, run: str, inv: str, token: str, body: dict) -> dict:
        return self.request("POST", f"/v1/runs/{run}/invocations/{inv}/result", token=token, body=body)  # type: ignore

    def progress(self, run: str, inv: str, token: str, cost: float) -> dict:
        return self.request("POST", f"/v1/runs/{run}/invocations/{inv}/progress", token=token,  # type: ignore
                            body={"cost_usd": round(max(0.0, cost), 6)}, timeout=30)


def _in_thread(fn, *args) -> asyncio.Future:
    """Run a blocking call on a daemon thread (a long poll in flight never delays interpreter exit)."""
    loop = asyncio.get_running_loop()
    fut = loop.create_future()

    def settle(ok: bool, value) -> None:
        if not fut.done():
            fut.set_result(value) if ok else fut.set_exception(value)

    def work() -> None:
        try:
            value, ok = fn(*args), True
        except BaseException as e:  # noqa: BLE001 - handed to the awaiting coroutine
            value, ok = e, False
        try:
            loop.call_soon_threadsafe(settle, ok, value)
        except RuntimeError:  # the loop closed while this call was in flight
            pass

    threading.Thread(target=work, daemon=True, name=f"gw-{getattr(fn, '__name__', 'call')}").start()
    return fut


# ---- per-invocation helpers -------------------------------------------------------------------------

@dataclass
class _Tests:
    """What ``Race.restore_acceptance`` reads from a task: its acceptance tests."""
    acceptance_tests: dict


@dataclass
class _ProtectView:
    """What ``Race.protect_landed`` reads: the config, git, and the landed tasks. The gateway's ``protect`` list
    already is the landed tasks' tests minus the task's own, in task order; the lineage rule is the harness's."""
    git: Git
    protect: list
    cfg: object = field(default_factory=lambda: RaceConfig(protect_tests="landed"))
    tasks: list = field(default_factory=list)

    def __post_init__(self) -> None:
        self.tasks = [TaskState(task=_LandedTest(item["path"], item["content"]), landed_sha="gateway",
                                status="landed") for item in self.protect]


@dataclass
class _LandedTest:
    path: str
    content: str

    @property
    def acceptance_tests(self) -> dict:
        return {self.path: self.content}


class ProgressReporter:
    """The adapter's ``progress`` callback: posts the running cost estimate (throttled) and kills the agent when
    the gateway answers that the run aborted."""

    def __init__(self, race: "RemoteRace", slot: str, inv: str):
        self.race, self.slot, self.inv = race, slot, inv
        self.latest: float | None = None
        self.sent: float | None = None
        self.wake = asyncio.Event()
        self.closed = False
        self.task = asyncio.create_task(self.loop(), name=f"progress-{inv}")

    def __call__(self, estimate: float) -> None:
        self.latest = float(estimate)
        self.wake.set()

    async def loop(self) -> None:
        while not self.closed:
            await self.wake.wait()
            self.wake.clear()
            if await self.post():
                return
            await asyncio.sleep(PROGRESS_INTERVAL)

    async def post(self) -> bool:
        """Send the latest estimate if it changed; True when the gateway says the run aborted."""
        value = self.latest
        if value is None or value == self.sent:
            return False
        try:
            reply = await self.race.call_slot(self.slot, "progress", self.inv, value)
        except GatewayError as e:
            self.race.log("driver.progress_error", inv=self.inv, error=str(e)[:300])
            return False
        self.sent = value
        if reply.get("abort"):
            self.race.log("driver.progress_abort", inv=self.inv, reason=reply.get("reason"))
            self.race.kill_agent(self.slot, f"gateway: {reply.get('reason')}")
            return True
        return False

    async def close(self, flush: bool) -> None:
        self.closed = True
        self.task.cancel()
        await asyncio.gather(self.task, return_exceptions=True)
        if flush:
            await self.post()


# ---- the driver -------------------------------------------------------------------------------------

class RemoteRace(Race):
    """Drives agent slots from the gateway's RunDO. Reuses the harness's adapters, prompts (sent by the gateway),
    acceptance restore and lineage rule, so a local/cloud difference is a forge difference, not a driver one."""

    def __init__(self, cfg: RaceConfig, *, gateway: str, admin_token: str | None, policy: str,
                 v2: dict | None = None, show_live_url: bool = False, auth_probe: bool = True,
                 stagger_start: float = 0.0):
        super().__init__(cfg)
        if policy not in POLICIES:
            raise SystemExit(f"--forge cloudflare runs {' and '.join(POLICIES)}, not {policy}")
        self.policy = policy
        self.v2 = v2 or v2_settings()
        self.gateway_url = gateway.rstrip("/")
        self.secrets = Secrets()
        self.gw = GatewayClient(gateway, admin_token, self.secrets)
        self.show_live_url = show_live_url
        self.run_id: str | None = None
        self.run_info: dict = {}
        self.tokens: dict[str, str] = {}
        self.seed_dir = os.path.join(self.work, "seed")
        self.agent_tasks: dict[str, asyncio.Task] = {}
        self.task_locks: dict[str, asyncio.Lock] = {}
        self.adapters: dict[str, Adapter] = {}
        self.run_over: asyncio.Event | None = None
        self.loops: list[asyncio.Task] = []
        self.gateway_aborted: str | None = None
        self.started = False
        self.stop_sent = False
        self.summary: dict | None = None
        self.counts = {"invocations": 0, "results_posted": 0, "driver_errors": 0, "infra_retries": 0}
        self.auth_probe = auth_probe
        self.stagger_start = max(0.0, stagger_start)
        self.signals = 0
        self.outage: dict | None = None  # a run-wide agent-CLI outage in progress: kind, since, message
        self.outage_seconds = float(os.environ.get("BEANSTALK_OUTAGE_SECONDS") or OUTAGE_SECONDS)
        self.infra_backoff = float(os.environ.get("BEANSTALK_INFRA_BACKOFF") or INFRA_BACKOFF)

    # ---- logging: driver-side events go to work/driver.jsonl, never the gateway's log ----------------

    def log(self, typ: str, **fields) -> dict:
        if self.events is None:
            return {}
        return self.events.write(typ, **{k: self.secrets.scrub(v) if isinstance(v, str) else v
                                         for k, v in fields.items()})

    def close_log(self) -> None:
        if self.events is not None:
            self.events.close()
            self.events = None

    def say(self, msg: str) -> None:
        print(f"[remote {time.strftime('%H:%M:%S')}] {self.secrets.scrub(msg)}", file=sys.stderr, flush=True)

    # ---- setup -----------------------------------------------------------------------------------------

    def init_local(self) -> None:
        """Sandbox, process registry, runner and the driver log (no network)."""
        os.makedirs(self.work, exist_ok=True)
        self.sandbox = Sandbox(self.work)
        self.registry.pidfile = os.path.join(self.work, "live_pids.txt")
        self.runner = Runner(self.sandbox, self.registry)
        self.events = EventLog(os.path.join(self.work, "driver.jsonl"), self.now)
        self.git = Git(self.runner, self.work)

    async def setup(self) -> None:
        """The local half of ``Race.setup``: a clean clone of the arena base, the frozen arena snapshot, the
        tasks, the agent adapter and the intake footprints. Nothing here talks to the gateway."""
        cfg = self.cfg
        self.prepare_out()
        self.init_local()
        assert self.git
        if not os.path.exists(cfg.repo):
            raise SystemExit(f"arena repository not found: {cfg.repo} (run the arena's materialize.py)")
        # main only, over the pack protocol, so the arena's reference solutions never reach the gateway
        await self.git.run("clone", "-q", "--no-local", "--single-branch", "--branch", "main", "--no-tags",
                           os.path.abspath(cfg.repo), self.seed_dir, cwd=self.work, timeout=600)
        await self.configure_clone(self.seed_dir)
        await self.git.run("remote", "remove", "origin", cwd=self.seed_dir, check=False)
        self.base_sha = await self.git.rev("main", cwd=self.seed_dir)
        await self.git.run("checkout", "-q", "--detach", self.base_sha, cwd=self.seed_dir)
        files = (await self.git.out("ls-tree", "-r", "--name-only", self.base_sha, cwd=self.seed_dir)).splitlines()
        self.repo_files = set(files)
        app_prefix = not any(f.startswith("app/") for f in files)
        self.arena_snapshot, self.arena_digest = snapshot_arena(cfg.arena, os.path.join(self.work, "arena"))
        tasks = load_tasks(self.arena_snapshot, cfg.tasks, app_prefix=app_prefix)
        if cfg.shuffle:  # the harness's own seeded order; the gateway keeps the order it is sent
            random.Random(f"{cfg.seed}:order").shuffle(tasks)
            for i, t in enumerate(tasks):
                t.order = i
        self.tasks = [TaskState(task=t) for t in tasks]
        self.by_id = {t.id: t for t in self.tasks}
        self.catalog = ModuleCatalog(self.seed_dir)
        self.adapter = self.make_adapter()
        self.adapters[str(getattr(self.adapter, "model", None))] = self.adapter
        if self.footprint_method == "haiku":
            raise SystemExit("--footprint haiku is not supported with --forge cloudflare (its classifier spend would "
                             "not be counted by the gateway, and neither queue nor v2 places by footprint); use auto")
        if self.footprint_method in ("auto", "predictor", "combined"):
            pred = StepTwoPredictor()
            if pred.fn is not None:
                self.predictor = pred
                self.footprint_method = "combined" if self.footprint_method == "combined" else "predictor"
            elif self.footprint_method in ("predictor", "combined"):
                raise SystemExit(f"--footprint {self.footprint_method}: {pred.error}")
            else:
                self.footprint_method = "lexical"
        await self.predict_footprints()
        if self.cfg.agent == "claude" and self.auth_probe:
            await self.probe_agent()

    async def probe_agent(self) -> None:
        """Before a paid race creates its run: one Haiku turn through the same CLI (about $0.004). Refused
        credentials or a rate limit stop here, before any bean exists."""
        assert self.runner
        cwd = os.path.join(self.work, "probe")
        os.makedirs(cwd, exist_ok=True)
        probe = ClaudeAdapter(self.runner, model=PROBE_MODEL, max_turns=1, timeout=180, transcripts=self.transcripts,
                              binary=self.cfg.claude_bin, persist_sessions=False)
        res = await probe.run(InvocationSpec(inv_id="auth-probe", kind="classifier", task_id=None, agent_id=None,
                                             cwd=cwd, prompt="Reply with the single word OK.", no_tools=True,
                                             max_turns=1, timeout=180))
        failure = infra_failure(res) or (("no result", res.infra_error) if res.infra_error else None)
        self.log("driver.auth_probe", ok=failure is None, cost_usd=res.cost_usd, subtype=res.subtype,
                 error=failure and failure[1][:300])
        if failure:
            raise SystemExit(f"the {PROBE_MODEL} auth probe failed ({failure[0]}: {failure[1][:300]}); "
                             "no run was created")
        self.say(f"auth probe ok ({PROBE_MODEL}, ${res.cost_usd:.4f})")

    async def configure_clone(self, repo: str) -> None:
        """The integration clone's settings from ``Race.setup``, for the seed clone and every bean, written in one
        go (nine ``git config`` processes per bean add up on a loaded machine)."""
        settings = {"user": {"name": "race-harness", "email": "race@beanstalk.invalid"},
                    "commit": {"gpgsign": "false"}, "core": {"hooksPath": "/dev/null", "autocrlf": "false"},
                    "gc": {"auto": "0"}, "merge": {"conflictstyle": "merge"}, "advice": {"detachedHead": "false"},
                    "rerere": {"enabled": "false"}}
        with open(os.path.join(repo, ".git", "config"), "a", encoding="utf-8") as fh:
            for section, values in settings.items():
                fh.write(f"[{section}]\n" + "".join(f"\t{k} = {v}\n" for k, v in values.items()))

    def run_config(self) -> dict:
        """``POST /v1/runs``: the harness's RaceConfig under the gateway's names, plus the tasks and footprints."""
        cfg = self.cfg
        body: dict = {
            "policy": self.policy, "agent": cfg.agent, "model": getattr(self.adapter, "model", None),
            "agents": cfg.agents, "ci_seconds": cfg.ci_seconds, "ci_slots": cfg.ci_slots, "batch": cfg.batch,
            "batch_wait": cfg.batch_wait, "budget_usd": cfg.budget_usd, "max_invocation_usd": cfg.max_invocation_usd,
            "max_turns": cfg.max_turns, "agent_timeout": cfg.agent_timeout, "seed": cfg.seed,
            "merge_drivers": cfg.merge_drivers, "queue_hold": cfg.queue_hold, "max_rework": cfg.max_rework,
            "max_fix_attempts": cfg.max_fix_attempts, "max_wall_minutes": cfg.max_wall_minutes,
            "infra_retry_seconds": cfg.infra_retry_seconds, "rework_resume": cfg.rework_resume,
            "shuffle": False, "label": os.path.basename(self.out)[:200], "arena": cfg.arena[-200:],
            "arena_digest": self.arena_digest, "footprint": self.footprint_method,
            "footprint_threshold": cfg.footprint_threshold,
            "footprints": {t.id: {"method": (t.footprint_method or self.footprint_method)[:40],
                                  "selected": list(t.selected)[:50],
                                  "probs": {m: min(1.0, max(0.0, float(p))) for m, p in t.predicted.items()}}
                           for t in self.tasks},
            "tasks": [{"id": t.id, "title": t.task.title, "prompt": t.task.prompt,
                       "acceptance_tests": t.task.acceptance_tests, "oracle_paths": t.task.oracle_paths,
                       "oracle_modules": t.task.oracle_modules, "kind": t.task.kind,
                       "difficulty": t.task.difficulty, "couplings": t.task.couplings} for t in self.tasks],
        }
        if self.policy == "queue":
            body.update(error_budget=cfg.error_budget, protect_tests=cfg.protect_tests)
        else:  # v2 implies --snapshot head --error-budget 999 --protect-tests landed (race.py checks the flags)
            body.update(self.v2)
        return body

    # ---- the race --------------------------------------------------------------------------------------

    async def setup_or_close(self) -> None:
        try:
            await self.setup()
        except BaseException:
            self.close_log()
            raise

    async def run(self) -> int:
        await self.setup_or_close()
        self.run_over = asyncio.Event()
        config = self.run_config()
        self.say(f"creating a {self.policy} run on {self.gateway_url}: {len(self.tasks)} tasks, "
                 f"{self.cfg.agents} {self.cfg.agent} agents" + (f", v2 {self.v2}" if self.policy != "queue" else ""))
        try:
            created = await _in_thread(self.gw.create_run, config)
        except GatewayError as e:
            self.say(f"could not create the run: {e}")
            self.log("driver.error", where="create", error=str(e))
            self.write_config(config)
            return 3
        self.run_id = created["run"]
        self.run_info = created
        for s in created.get("slots") or []:
            self.tokens[s["slot"]] = s["token"]
            self.secrets.add(s["token"])
        view = created.get("view") or {}
        self.secrets.add(view.get("token"))
        self.write_config(config)
        self.log("driver.created", run=self.run_id, repo=(created.get("repo") or {}).get("name"),
                 slots=sorted(self.tokens))
        self.say(f"run {self.run_id} created; repo {(created.get('repo') or {}).get('name')}")
        if view.get("live_url"):
            if self.show_live_url or sys.stderr.isatty():
                print(f"[remote] live page: {view['live_url']}", file=sys.stderr, flush=True)
            else:
                self.say("live page link withheld from redirected output (it carries a view token); "
                         "pass --live-url to print it")
        try:
            await self.seed_base()
            await self.start_run()
            if self.aborted:  # a signal arrived while seeding
                await self.send_stop(self.aborted)
            watchdog = asyncio.create_task(self.wall_watchdog(), name="wall-watchdog")
            self.loops = [asyncio.create_task(self.slot_loop(slot, i * self.stagger_start), name=f"slot-{slot}")
                          for i, slot in enumerate(sorted(self.tokens, key=lambda s: int(s[1:])))]
            try:
                await asyncio.gather(*self.loops)
            finally:
                watchdog.cancel()
        except asyncio.CancelledError:
            if not self.aborted:
                self.abort("driver cancelled")
        except Exception as e:  # noqa: BLE001 - a crash anywhere stops the run visibly, as in the harness
            self.say(f"driver error: {e!r}")
            self.log("driver.error", where="run", error=repr(e), traceback=traceback.format_exc()[-3000:])
            self.abort(f"driver error: {e!r}"[:200])
        finally:
            for t in self.loops:
                t.cancel()
            await asyncio.gather(*self.loops, return_exceptions=True)
            self.kill_agents("the driver is finishing")
            await self.registry.kill_all()
            await self.finish()
            self.close_log()
        aborted = (self.summary or {}).get("aborted") if self.summary is not None else (self.aborted or "no summary")
        return 0 if not aborted else 2 if str(aborted).startswith("budget") else 3

    def abort(self, reason: str) -> None:
        """A signal, an agent-CLI outage or a driver failure: ask the gateway to stop (it then runs the final
        check) and kill agents. A second signal stops waiting for the gateway."""
        first = not self.aborted
        self.aborted = self.aborted or reason
        if first:
            self.log("abort", reason=reason)
            self.say(f"aborting: {reason}")
        if self.run_id and not self.stop_sent:
            asyncio.ensure_future(self.send_stop(reason))
        self.kill_agents(reason)
        if reason.startswith("signal"):
            self.signals += 1
            if self.signals >= 2:
                self.stop_waiting()

    def stop_waiting(self) -> None:
        """Give up on the gateway's end of the run: leave the slot loops and download what there is."""
        if self.run_over:
            self.run_over.set()
        for t in self.loops:
            t.cancel()

    async def wall_watchdog(self) -> None:
        """The gateway ends the race at --max-wall-minutes. If it has not said ``done`` well after that, stop the
        run, then stop waiting, so a stuck run never holds this machine's race slot for hours."""
        await asyncio.sleep(self.cfg.max_wall_minutes * 60 + WALL_GRACE)
        assert self.run_over is not None
        if self.run_over.is_set():
            return
        self.abort(f"driver watchdog: no end of the race {WALL_GRACE / 60:.0f} min past --max-wall-minutes")
        await asyncio.sleep(WALL_GRACE / 2)
        if not self.run_over.is_set():
            self.say("driver watchdog: the gateway did not finish after the stop; downloading what there is")
            self.stop_waiting()

    async def send_stop(self, reason: str) -> None:
        if self.stop_sent or not self.run_id:
            return
        self.stop_sent = True
        try:
            await _in_thread(self.gw.stop, self.run_id, reason)
            self.log("driver.stop_sent", reason=reason)
        except GatewayError as e:
            self.log("driver.error", where="stop", error=str(e))
            if e.code != "invalid_state":
                self.say(f"could not stop run {self.run_id}: {e}")

    async def start_run(self) -> None:
        """``POST start``; a retry that finds the run already running (its first answer was lost) is a start."""
        assert self.run_id
        try:
            started = await self.call_admin("start", self.run_id)
        except GatewayError as e:
            if e.status != 409 or e.code == "repo_not_seeded":
                raise
            view = await self.call_admin("view", self.run_id)
            if view.get("phase") != "running":
                raise
            started = {"base_sha": self.base_sha}
        self.started = True
        if started.get("base_sha") and started["base_sha"] != self.base_sha:
            raise DriverError(f"the gateway started from {started['base_sha']}, not the arena base {self.base_sha}")
        self.say(f"run {self.run_id} started from {self.base_sha[:10]}")
        self.log("driver.started", run=self.run_id, base=self.base_sha)

    async def seed_base(self) -> None:
        """Push the arena base to the run repo's sprout and stalk with the 15-minute seed token."""
        assert self.run_id
        seed = await self.call_admin("seed_token", self.run_id)
        token = seed["token"]
        self.secrets.add(token)
        url = seed.get("push_url") or (self.run_info.get("repo") or {}).get("url")
        refs = seed.get("refs") or ["refs/heads/sprout", "refs/heads/stalk"]
        t0 = time.monotonic()
        await self.git_net(["push", "-q", "--no-verify", url, *[f"{self.base_sha}:{r}" for r in refs]],
                           cwd=self.seed_dir, token=token, what="seed push", retries=2)
        self.log("driver.seeded", refs=refs, base=self.base_sha, seconds=round(time.monotonic() - t0, 3))

    async def slot_loop(self, slot: str, start_delay: float = 0.0) -> None:
        """Long-poll for invocations until the run is done. ``start_delay`` holds back the first poll: the gateway
        hands a task (and forks its bean) only to a slot that is asking, so staggered slots fork one at a time."""
        backoff = 1.0
        assert self.run_over is not None
        if start_delay:
            await asyncio.sleep(start_delay)
        while not self.run_over.is_set():
            try:
                reply = await self.call_slot(slot, "next")
            except GatewayError as e:
                if e.status in (401, 403, 404):  # a 401 survived a re-issue of the slot tokens
                    raise DriverError(f"slot {slot}: {e}") from None
                self.log("driver.poll_error", slot=slot, error=str(e)[:500])
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30.0)
                continue
            backoff = 1.0
            if reply.get("done"):
                self.on_done(reply.get("aborted"))
                return
            inv = reply.get("invocation")
            if inv:
                await self.handle(slot, inv)

    def on_done(self, aborted: str | None) -> None:
        assert self.run_over is not None
        if not self.run_over.is_set():
            self.gateway_aborted = aborted
            self.log("driver.done", aborted=aborted)
            self.say(f"run {self.run_id} is done" + (f" (aborted: {aborted})" if aborted else ""))
            self.run_over.set()
            self.kill_agents("the run is over")

    def kill_agents(self, reason: str) -> None:
        for slot in list(self.agent_tasks):
            self.kill_agent(slot, reason)

    def kill_agent(self, slot: str, reason: str) -> None:
        task = self.agent_tasks.get(slot)
        if task and not task.done():
            self.log("driver.kill", slot=slot, reason=reason)
            task.cancel()

    # ---- gateway calls with token refresh and retries ---------------------------------------------------

    async def call_admin(self, name: str, *args, retries: int = 3):
        delay = 1.0
        for attempt in range(retries + 1):
            try:
                return await _in_thread(getattr(self.gw, name), *args)
            except GatewayError as e:
                if not e.transient or attempt == retries:
                    raise
                self.log("driver.retry", call=name, error=str(e)[:300])
                await asyncio.sleep(delay)
                delay = min(delay * 2, 20.0)

    async def call_slot(self, slot: str, name: str, *args, retries: int = 0):
        """A driver route with the slot's current token; a rejected token is re-issued once by the admin."""
        assert self.run_id
        delay, reissued = 1.0, False
        for attempt in range(retries + 2):
            try:
                if name == "next":
                    reply = await _in_thread(self.gw.next, self.run_id, slot, self.tokens[slot])
                    refresh = reply.get("token") if isinstance(reply, dict) else None
                    if refresh and refresh.get("token"):
                        self.secrets.add(refresh["token"])
                        self.tokens[slot] = refresh["token"]
                        self.log("driver.token_refreshed", slot=slot, expires_at=refresh.get("expires_at"))
                    return reply
                return await _in_thread(getattr(self.gw, name), self.run_id, args[0], self.tokens[slot], *args[1:])
            except GatewayError as e:
                if e.status == 401 and not reissued and self.gw.admin:
                    reissued = True
                    await self.reissue_tokens(f"{name} for {slot}: {e.message}")
                    continue
                if not e.transient or attempt >= retries:
                    raise
                self.log("driver.retry", call=name, slot=slot, error=str(e)[:300])
                await asyncio.sleep(delay)
                delay = min(delay * 2, 20.0)
        raise AssertionError("unreachable")

    async def reissue_tokens(self, why: str) -> None:
        assert self.run_id
        try:
            fresh = await _in_thread(self.gw.reissue_tokens, self.run_id)
        except GatewayError as e:
            self.log("driver.error", where="reissue_tokens", error=str(e))
            return
        for s in fresh.get("slots") or []:
            self.secrets.add(s["token"])
            self.tokens[s["slot"]] = s["token"]
        self.log("driver.tokens_reissued", why=why[:300])

    # ---- one invocation ---------------------------------------------------------------------------------

    def task_lock(self, task: str) -> asyncio.Lock:
        return self.task_locks.setdefault(task, asyncio.Lock())

    def worktree(self, task: str) -> str:
        return os.path.join(self.work, "agents", task)

    async def handle(self, slot: str, inv: dict) -> None:
        """Prepare the workspace, run the agent, commit and push, post the result (driver contract steps 1-7)."""
        self.counts["invocations"] += 1
        task, ws = inv["task"], inv["workspace"]
        merge = ws.get("merge") or {}
        self.log("driver.invocation", inv=inv["inv"], kind=inv["kind"], task=task, slot=slot,
                 attempt=inv.get("attempt"), resume=bool(inv.get("resume")), head=ws.get("head_sha"),
                 merge=merge.get("sha"), merge_ref=merge.get("ref"), protect=len(ws.get("protect") or []))
        t0 = time.monotonic()
        if self.aborted:  # stopping: the gateway ends this invocation with the run
            self.log("driver.skipped", inv=inv["inv"], reason=self.aborted)
            return
        async with self.task_lock(task):
            wt = self.worktree(task)
            fields: dict = {"pushed_ref": None, "head_sha": None, "new_commit": False, "files": [], "tamper": [],
                            "markers_left": [], "merge_conflicts": None}
            res: InvocationResult | None = None
            steps: dict[str, float] = {}
            mark = time.monotonic()
            try:
                fields["merge_conflicts"] = await self.prepare(slot, inv, wt)
            except (DriverError, GitError) as e:
                self.counts["driver_errors"] += 1
                res = self.driver_failure(inv, f"preparing the workspace failed: {e}")
            steps["prepare"], mark = round(time.monotonic() - mark, 3), time.monotonic()
            if res is None:
                res = await self.run_agent(slot, inv, wt)
                if res is None:  # killed: the gateway already ended this invocation
                    return
                steps["agent"], mark = round(time.monotonic() - mark, 3), time.monotonic()
                try:
                    fields.update(await self.commit_and_push(slot, inv, wt, res))
                except (DriverError, GitError) as e:
                    self.counts["driver_errors"] += 1
                    res.ok = False
                    res.infra_error = res.infra_error or self.secrets.scrub(f"driver: {e}")[:4000]
                steps["commit_push"] = round(time.monotonic() - mark, 3)
            await self.post_result(slot, inv, res, fields, time.monotonic() - t0, steps)

    def driver_failure(self, inv: dict, message: str) -> InvocationResult:
        self.log("driver.error", where="prepare", inv=inv["inv"], error=message[:2000])
        return InvocationResult(inv_id=inv["inv"], adapter=self.cfg.agent, model=inv.get("model"),
                                infra_error=self.secrets.scrub(f"driver: {message}")[:4000])

    def adapter_for(self, inv: dict) -> Adapter:
        """The run's adapter; a different model in the instruction gets its own (claude keeps per-session cost)."""
        assert self.adapter
        model = inv.get("model")
        if not isinstance(self.adapter, ClaudeAdapter) or not model or model == self.adapter.model:
            return self.adapter
        if model not in self.adapters:
            a = self.adapter
            self.adapters[model] = ClaudeAdapter(self.runner, model=model, max_turns=a.max_turns, timeout=a.timeout,
                                                 transcripts=a.transcripts, binary=a.binary,
                                                 output_format=a.output_format, effort=a.effort,
                                                 persist_sessions=a.persist_sessions)
        return self.adapters[model]

    def replay_for(self, inv: dict) -> dict:
        """The replay agent's instructions, as the harness builds them: the task's reference patch, the fix
        patches of the tasks the gateway names, the reset target, and the check with the task's tests."""
        hints = inv.get("replay") or {}
        ts = self.by_id.get(inv["task"])
        patches = self.patch_ref(ts.task.solution) if ts and inv["kind"] in ("initial", "rework") else []
        fixes: list[dict] = []
        for tid in hints.get("fixes") or []:
            other = self.by_id.get(tid)
            if other and other.task.fix_patch:
                fixes += self.patch_ref(other.task.fix_patch)
        out = {"reset_to": hints.get("reset_to"), "patches": patches, "fixes": fixes}
        if hints.get("check"):
            out["check"] = hints["check"]
            out["acceptance"] = dict(inv["workspace"].get("acceptance") or {})
        return out

    async def run_agent(self, slot: str, inv: dict, wt: str) -> InvocationResult | None:
        """Run the agent. A failure outside the agent's work (``infra_failure``) is never posted: the slot pauses
        with backoff and runs the invocation again, the cost of the failed attempts added to the one that counts.
        An outage longer than ``outage_seconds`` stops the run. None when the invocation was ended meanwhile."""
        delivered = time.monotonic()
        timeout = float(inv.get("timeout_seconds") or self.cfg.agent_timeout)
        spec = InvocationSpec(inv_id=inv["inv"], kind=inv["kind"], task_id=inv["task"], agent_id=slot, cwd=wt,
                              prompt=inv["prompt"], attempt=int(inv.get("attempt") or 1),
                              resume_session=inv.get("resume"), max_turns=inv.get("max_turns"), timeout=timeout,
                              budget_cap_usd=inv.get("budget_cap_usd"), replay=self.replay_for(inv))
        reporter = ProgressReporter(self, slot, inv["inv"])
        spent, failures, killed = 0.0, [], False
        try:
            while True:
                res = await self.attempt(slot, inv, spec, lambda estimate: reporter(spent + estimate))
                if res is None:
                    killed = True
                    return None
                failure = infra_failure(res)
                if failure is None:
                    self.outage_over()
                    if failures:
                        res.cost_usd += spent
                        res.notes.append(f"driver: ran again after {len(failures)} infra failure(s): "
                                         + "; ".join(failures)[:600])
                    return res
                spent += res.cost_usd
                failures.append(f"{failure[0]}: {failure[1][:160]}")
                self.counts["infra_retries"] += 1
                delay = self.outage_pause(slot, inv, failure, len(failures))
                if delay is None or not await self.pause(slot, delay):
                    killed = True
                    return None
                # the gateway's watchdog runs from delivery: keep time to commit, push and post after the retry
                left = timeout + WATCHDOG_GRACE - 120 - (time.monotonic() - delivered)
                spec.timeout = max(60.0, min(timeout, left))
        finally:
            self.agent_tasks.pop(slot, None)
            await reporter.close(flush=not killed)

    async def attempt(self, slot: str, inv: dict, spec: InvocationSpec, progress) -> InvocationResult | None:
        agent = asyncio.create_task(self.adapter_for(inv).run(spec, progress), name=f"agent-{inv['inv']}")
        self.agent_tasks[slot] = agent
        try:
            return await agent
        except asyncio.CancelledError:
            current = asyncio.current_task()
            if current is not None and current.cancelling():
                raise
            self.log("driver.killed", inv=inv["inv"], slot=slot)
            return None

    async def pause(self, slot: str, seconds: float) -> bool:
        """Back off; False when the slot's invocation was ended meanwhile (a kill cancels the pause)."""
        sleeper = asyncio.create_task(asyncio.sleep(seconds), name=f"pause-{slot}")
        self.agent_tasks[slot] = sleeper
        try:
            await sleeper
            return True
        except asyncio.CancelledError:
            current = asyncio.current_task()
            if current is not None and current.cancelling():
                raise
            return False

    def outage_pause(self, slot: str, inv: dict, failure: tuple[str, str], n: int) -> float | None:
        """Record an agent-CLI failure in the run-wide outage clock; the pause before the slot's next attempt,
        or None after stopping the run because the outage lasted longer than ``outage_seconds``."""
        kind, message = failure
        now = time.monotonic()
        if self.outage is None:
            self.outage = {"kind": kind, "since": now}
            self.say(f"{slot} {inv['inv']}: {kind} failure from the agent CLI ({message[:160]}); not posted, the "
                     f"slot retries with backoff; the run stops if this lasts {self.outage_seconds / 60:.1f} min")
        self.outage.update(kind=kind, message=message)
        age = now - self.outage["since"]
        self.log("driver.infra_retry", slot=slot, inv=inv["inv"], kind=kind, error=message, attempt=n,
                 outage_seconds=round(age, 1))
        if age >= self.outage_seconds:
            self.abort(f"infra: {kind} failures from the agent CLI for {age / 60:.1f} min ({message[:120]})")
            return None
        delay = min(self.infra_backoff * 2 ** (n - 1), INFRA_BACKOFF_CAP)
        return max(0.1, min(delay, self.outage_seconds - age + 0.1))

    def outage_over(self) -> None:
        if self.outage is not None:
            age = time.monotonic() - self.outage["since"]
            self.log("driver.infra_recovered", kind=self.outage["kind"], outage_seconds=round(age, 1))
            self.say(f"the agent CLI works again after {age:.0f} s of {self.outage['kind']} failures")
            self.outage = None

    async def post_result(self, slot: str, inv: dict, res: InvocationResult, fields: dict, seconds: float,
                          steps: dict | None = None) -> None:
        body = result_body(res, fields, self.secrets)
        posting = time.monotonic()
        closed = False
        try:
            try:
                await self.call_slot(slot, "result", inv["inv"], body, retries=4)
            except GatewayError as e:
                if e.status not in (400, 422):
                    raise
                # never leave the gateway waiting for its watchdog over a field it would not take
                self.log("driver.error", where="result", inv=inv["inv"], error=str(e)[:1500], fallback=True)
                self.say(f"{slot} {inv['inv']}: the gateway refused the result ({e}); posting the core fields")
                await self.call_slot(slot, "result", inv["inv"], {k: body[k] for k in CORE_RESULT_KEYS if k in body},
                                     retries=4)
            self.counts["results_posted"] += 1
        except GatewayError as e:
            if e.code != "closed_invocation":  # closed: a retry after a lost answer, or the run ended
                self.log("driver.error", where="result", inv=inv["inv"], error=str(e)[:1000])
                self.say(f"{slot} {inv['inv']}: posting the result failed: {e}")
                return
            closed = True
        head = (fields.get("head_sha") or "")[:10] or "-"
        status = "ok" if res.ok and not res.infra_error else f"infra: {(res.infra_error or '?')[:80]}"
        if closed:
            status = "closed by the gateway (already ended), " + status
        extra = f" markers {fields['markers_left']}" if fields.get("markers_left") else ""
        self.log("driver.result", inv=inv["inv"], task=inv["task"], slot=slot, ok=res.ok, subtype=res.subtype,
                 infra_error=(res.infra_error or None) and res.infra_error[:300], head=fields.get("head_sha"),
                 new_commit=fields.get("new_commit"), files=len(fields.get("files") or []),
                 tamper=fields.get("tamper"), markers_left=fields.get("markers_left"),
                 merge_conflicts=fields.get("merge_conflicts"), cost_usd=res.cost_usd,
                 seconds=round(seconds, 3), closed=closed,
                 steps={**(steps or {}), "post": round(time.monotonic() - posting, 3)})
        self.say(f"{slot} {inv['inv']} {inv['task']} {status} {res.subtype or ''} {seconds:.1f}s "
                 f"${res.cost_usd:.3f} -> {head}{extra}")

    # ---- the workspace (driver contract steps 1, 2, 4, 5, 6) ------------------------------------------------

    def net_env(self, token: str) -> dict:
        """git's environment for one request through the proxy: the token as an extra header, no credential
        helper and no tracing, so it never reaches argv, a config file or a log."""
        assert self.git
        env = {k: v for k, v in self.git.env.items() if not NET_GIT_ENV_DROP.match(k)}
        env.update({"GIT_CONFIG_COUNT": "2",
                    "GIT_CONFIG_KEY_0": "http.extraHeader", "GIT_CONFIG_VALUE_0": f"Authorization: Bearer {token}",
                    "GIT_CONFIG_KEY_1": "credential.helper", "GIT_CONFIG_VALUE_1": "",
                    "GIT_TERMINAL_PROMPT": "0"})
        return env

    async def git_net(self, args: list[str], *, cwd: str, token: str | None = None, slot: str | None = None,
                      what: str, retries: int = 3) -> None:
        """A fetch or push through the gateway's git proxy, retried on failure."""
        assert self.runner
        delay = 1.0
        for attempt in range(retries + 1):
            tok = token if token is not None else self.tokens[slot or ""]
            res = await self.runner.run(["git", *args], cwd, env=self.net_env(tok), timeout=GIT_TIMEOUT)
            if res.returncode == 0:
                return
            err = self.secrets.scrub((res.stderr or res.stdout or "").strip())[-800:]
            self.log("driver.git_error", what=what, attempt=attempt + 1, error=err, timed_out=res.timed_out)
            if attempt == retries:
                raise DriverError(f"{what} failed: {err or ('timeout' if res.timed_out else f'exit {res.returncode}')}")
            await asyncio.sleep(delay)
            delay = min(delay * 2, 15.0)

    async def has_commit(self, wt: str, sha: str | None) -> bool:
        assert self.git
        if not sha:
            return False
        res = await self.git.run("cat-file", "-e", f"{sha}^{{commit}}", cwd=wt, check=False)
        return res.returncode == 0

    def merge_head(self, wt: str) -> str | None:
        try:
            with open(os.path.join(wt, ".git", "MERGE_HEAD"), encoding="utf-8") as fh:
                return fh.read().split()[0].strip() or None
        except (OSError, IndexError):
            return None

    def line_branch(self, ref: str) -> str:
        """What the harness's prompts call a run-repo line: v2 says "trunk" for the sprout, the queue "main"."""
        if ref.endswith("/sprout"):
            return "trunk"
        return "main" if self.policy == "queue" else "green"

    async def reusable(self, wt: str, head: str, merge: dict | None) -> bool:
        """The worktree already holds this invocation's starting point: HEAD at the gateway's head, and either no
        merge in progress or the very merge this invocation asks for (markers left by the previous round, or a
        resumed session that failed and is retried fresh). Then the harness would keep it as it is."""
        assert self.git
        if not os.path.isdir(os.path.join(wt, ".git")):
            return False
        cur = await self.git.run("rev-parse", "--verify", "--quiet", "HEAD^{commit}", cwd=wt, check=False)
        if cur.returncode != 0 or cur.stdout.strip() != head:
            return False
        in_progress = self.merge_head(wt)
        return in_progress is None or bool(merge and in_progress == merge.get("sha"))

    async def prepare(self, slot: str, inv: dict, wt: str) -> list[str] | None:
        """Steps 1-2: the bean at ``head_sha`` (``base_sha`` before the first push), then the merge of
        ``merge.sha``; acceptance tests are written when the task's worktree opens. Returns the merge's conflicts."""
        assert self.git
        ws = inv["workspace"]
        head = ws.get("head_sha") or ws["base_sha"]
        merge = ws.get("merge")
        if not await self.reusable(wt, head, merge):
            await self.checkout(slot, wt, ws, head)
            if not ws.get("head_sha"):  # open_task_worktree: write_acceptance before the first run
                self.write_acceptance(wt, [_Tests(dict(ws.get("acceptance") or {}))])
        await self.write_attributes(wt, ws.get("union_paths") or [])
        if not merge:  # the line the task forked from, under the name the harness's repo gives it
            await self.set_line(wt, "refs/heads/stalk" if self.policy == "queue" else "refs/heads/sprout",
                                ws["base_sha"])
            return None
        return await self.merge_line(slot, wt, ws, merge)

    async def set_line(self, wt: str, ref: str, sha: str) -> None:
        """Local branches as in the harness's integration repo: the queue's ``main``; v2's ``trunk`` (and ``main``
        at the arena base), so "the latest trunk" or "main" in a prompt names a real branch."""
        assert self.git
        await self.git.run("branch", "-f", self.line_branch(ref), sha, cwd=wt)
        if self.policy != "queue":
            await self.git.run("branch", "-f", "main", self.base_sha, cwd=wt, check=False)

    async def checkout(self, slot: str, wt: str, ws: dict, head: str) -> None:
        """Clone or fetch the bean through the proxy, then check its branch out at ``head`` with a clean tree."""
        assert self.git
        fresh = not os.path.isdir(os.path.join(wt, ".git"))
        if fresh:
            if os.path.exists(wt):
                shutil.rmtree(wt)
            os.makedirs(wt)
            await self.git.run("init", "-q", cwd=wt)
            await self.configure_clone(wt)
        if not await self.has_commit(wt, head) or not await self.has_commit(wt, ws["base_sha"]):
            try:
                await self.git_net(["fetch", "-q", "--no-tags", "--no-write-fetch-head", ws["bean_url"],
                                    "+refs/heads/*:refs/remotes/bean/*"], cwd=wt, slot=slot,
                                   what=f"fetch {ws['bean']}", retries=1)
            except DriverError as e:  # the run repo below still has the base (seen: 500s from later forks)
                self.counts["bean_fetch_failures"] = self.counts.get("bean_fetch_failures", 0) + 1
                self.log("driver.bean_fetch_failed", bean=ws["bean"], error=str(e)[:500])
        if not await self.has_commit(wt, head) or not await self.has_commit(wt, ws["base_sha"]):
            await self.git_net(["fetch", "-q", "--no-tags", "--no-write-fetch-head", ws["repo_url"],
                                "+refs/heads/sprout:refs/remotes/run/sprout",
                                "+refs/heads/stalk:refs/remotes/run/stalk"],
                               cwd=wt, slot=slot, what="fetch the run repo")
        for sha in (head, ws["base_sha"]):
            if not await self.has_commit(wt, sha):
                raise DriverError(f"{sha} is in neither {ws['bean']} nor the run repo")
        if not fresh:
            await self.git.run("merge", "--abort", cwd=wt, check=False)
            await self.git.run("reset", "-q", "--hard", cwd=wt, check=False)
        await self.git.run("checkout", "-q", "-f", "-B", ws["branch"], head, cwd=wt)
        await self.git.run("clean", "-q", "-fdx", cwd=wt)
        for name in ("MERGE_HEAD", "MERGE_MSG", "MERGE_MODE"):
            try:
                os.remove(os.path.join(wt, ".git", name))
            except OSError:
                pass

    async def write_attributes(self, wt: str, union_paths: list[str]) -> None:
        info = os.path.join(wt, ".git", "info")
        os.makedirs(info, exist_ok=True)
        with open(os.path.join(info, "attributes"), "w", encoding="utf-8") as fh:
            fh.write("".join(f"{p} merge=union\n" for p in union_paths))

    async def merge_line(self, slot: str, wt: str, ws: dict, merge: dict) -> list[str]:
        """Step 2: fetch ``merge.ref`` into a branch named as the prompts name the line, then ``git merge
        --no-commit --no-ff`` it, leaving markers. Skipped when already merged or already in progress."""
        assert self.git
        sha, ref = merge["sha"], merge["ref"]
        if self.merge_head(wt) == sha:  # the previous round's merge is still in progress
            await self.set_line(wt, ref, sha)
            return await self.git.unmerged_paths(wt)
        if not await self.has_commit(wt, sha):
            short = ref.rsplit("/", 1)[-1]
            await self.git_net(["fetch", "-q", "--no-tags", "--no-write-fetch-head", ws["repo_url"],
                                f"+{ref}:refs/remotes/run/{short}"], cwd=wt, slot=slot, what=f"fetch {ref}")
        if not await self.has_commit(wt, sha):
            raise DriverError(f"{sha} is not on {ref} of the run repo")
        await self.set_line(wt, ref, sha)
        anc = await self.git.run("merge-base", "--is-ancestor", sha, "HEAD", cwd=wt, check=False)
        if anc.returncode == 0:
            return []
        conflicts = await self.git.merge_into_worktree(wt, sha)
        expected = sorted(merge.get("conflicts") or [])
        if sorted(conflicts) != expected:
            self.log("driver.merge_mismatch", task=os.path.basename(wt), merge=sha, local=conflicts,
                     gateway=expected)
        return conflicts

    async def commit_and_push(self, slot: str, inv: dict, wt: str, res: InvocationResult) -> dict:
        """Steps 4-6, harness-style: no commit when the gateway will retry the invocation or markers are left;
        otherwise restore the task's acceptance tests and the protected landed tests (``core.py``
        ``restore_acceptance`` and ``protect_landed``), commit with the gateway's message and push the bean."""
        assert self.git
        ws, kind = inv["workspace"], inv["kind"]
        if res.infra_error and (kind == "initial" or (inv.get("resume") and not res.rate_limited)):
            return {}  # run_initial retries before committing; invoke_rework retries a failed resume fresh
        if res.subtype == "unresolved":  # replay only: never hand a known-broken tree back
            await self.git.abort_merge(wt)
            return {}
        if kind != "initial":
            left = await self.markers_left(wt)
            if left:
                return {"markers_left": left}
        acceptance = dict(ws.get("acceptance") or {})
        # A test author (v2.2) or a reconciling one (v2.4; v2.5: every party's tests) amends the acceptance files:
        # they are kept, every other change is not.
        # A tests-first author (v2.5) writes a task's tests before its implementer: only the new test files it
        # created are kept (no edits to existing files, no source, no helpers outside the test file).
        if kind in ("test-author", "reconcile", "test-first"):
            dropped = await self.keep_only(wt, set(acceptance), new_tests=kind == "test-first")
            if dropped:
                self.log("driver.author_discarded", inv=inv["inv"], task=inv["task"], paths=dropped)
            tamper: list[str] = []
        else:
            tamper = self.restore_acceptance(wt, [_Tests(acceptance)])
        protect = list(ws.get("protect") or [])
        if protect:
            tamper += await Race.protect_landed(_ProtectView(git=self.git, protect=protect), wt, None)  # type: ignore[arg-type]
        head, created = await self.git.commit_all(wt, ws["commit_message"])
        files = await self.git.changed_files(ws["base_sha"], head, cwd=wt)
        ref = f"refs/heads/{ws['branch']}"
        if head != ws.get("head_sha"):
            await self.git_net(["push", "-q", "--no-verify", ws["bean_url"], f"+{head}:{ref}"], cwd=wt, slot=slot,
                               what=f"push {ws['bean']} {ws['branch']}")
        return {"pushed_ref": ref, "head_sha": head, "new_commit": created, "files": files, "tamper": tamper,
                "markers_left": []}

    async def keep_only(self, wt: str, keep: set[str], *, new_tests: bool = False) -> list[str]:
        """Discard every change in the worktree outside ``keep`` (a test author may only amend those files), and
        with ``new_tests`` also keep every new test file (``TEST_FILE``); returns the paths it discarded."""
        assert self.git
        out = await self.git.out("status", "--porcelain", "-z", "--untracked-files=all", cwd=wt)
        entries = [e for e in out.split("\0")]
        tracked, untracked, i = [], [], 0
        while i < len(entries):
            entry = entries[i]
            i += 1
            if len(entry) < 4:
                continue
            status, path = entry[:2], entry[3:]
            if status[0] in "RC":  # a rename or copy names its source next
                i += 1
            is_new = status in ("??", "A ")
            if path in keep or (new_tests and is_new and TEST_FILE.search(path) and "node_modules/" not in path):
                continue
            (untracked if is_new else tracked).append(path)
        if tracked:
            await self.git.run("checkout", "-q", "HEAD", "--", *tracked, cwd=wt)
        for path in untracked:
            await self.git.run("rm", "-q", "--cached", "--ignore-unmatch", "--", path, cwd=wt, check=False)
            full = os.path.join(wt, path)
            if os.path.lexists(full):
                os.remove(full)
        return sorted(tracked + untracked)

    # ---- the end ----------------------------------------------------------------------------------------

    async def finish(self) -> None:
        """Wait for the gateway's final check, then download events.jsonl and summary.json and render
        summary.md, the same three files a local run leaves."""
        if not self.run_id:
            return
        if not self.started and not self.stop_sent:
            await self.send_stop(self.aborted or "the driver stopped before the start")
        assert self.run_over is not None
        deadline = time.monotonic() + FINISH_TIMEOUT
        while not self.run_over.is_set() and time.monotonic() < deadline:
            try:
                view = await _in_thread(self.gw.view, self.run_id)
                if view.get("phase") == "done":
                    break
            except GatewayError as e:
                self.log("driver.error", where="view", error=str(e)[:300])
            try:
                await asyncio.wait_for(self.run_over.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                pass
        await self.download()

    async def download(self) -> None:
        assert self.run_id
        lines: list[str] = []
        after = 0
        try:
            while True:  # until an empty page: the server may cap a page below what was asked
                text = await self.call_admin("events_jsonl", self.run_id, after, EVENTS_PAGE)
                page = [ln for ln in text.splitlines() if ln.strip()]
                if not page:
                    break
                last = int(json.loads(page[-1])["seq"])
                if last <= after:
                    break
                lines += page
                after = last
        except (GatewayError, ValueError, KeyError) as e:
            self.say(f"downloading events failed: {e}")
            self.log("driver.error", where="events", error=str(e)[:500])
        with open(os.path.join(self.out, "events.jsonl"), "w", encoding="utf-8") as fh:
            fh.write("".join(ln + "\n" for ln in lines))
        seqs = [json.loads(ln).get("seq") for ln in lines]
        if seqs != list(range(1, len(seqs) + 1)):
            self.say(f"warning: events.jsonl has gaps ({len(seqs)} events, last seq {seqs[-1] if seqs else None})")
        try:
            self.summary = await self.call_admin("summary", self.run_id)
        except GatewayError as e:
            self.say(f"downloading the summary failed: {e}")
            self.log("driver.error", where="summary", error=str(e)[:500])
            return
        with open(os.path.join(self.out, "summary.json"), "w", encoding="utf-8") as fh:
            json.dump(self.summary, fh, indent=2, default=str)
        from .summary import to_markdown
        try:
            md = to_markdown(self.summary)
            md = md.replace("\n\n", f"\n\n_forge: cloudflare, run {self.run_id} on {self.gateway_url}_\n\n", 1)
        except (KeyError, TypeError, AttributeError) as e:
            md = f"# Race: {self.policy} (cloudflare run {self.run_id})\n\nsummary.md could not be rendered: {e!r}\n"
        with open(os.path.join(self.out, "summary.md"), "w", encoding="utf-8") as fh:
            fh.write(md)
        self.log("driver.downloaded", events=len(lines), counts=self.counts)

    async def dry_run(self) -> int:
        """No run is created: the local setup and run config, the gateway's health, and whether it accepts the
        admin token (``GET /v1/runs/x`` is 400 for the admin, 401 otherwise). Writes and prints dry_run.json."""
        await self.setup_or_close()
        config = self.run_config()
        self.write_config(config)
        report: dict = {"ok": False, "forge": "cloudflare", "gateway": self.gateway_url, "policy": self.policy,
                        "agent": self.cfg.agent, "model": config["model"], "agents": self.cfg.agents,
                        "tasks": len(self.tasks), "footprint": self.footprint_method, "base": self.base_sha,
                        "arena_digest": self.arena_digest, "run_config_bytes": len(json.dumps(config)),
                        "v2": self.v2 if self.policy != "queue" else None}
        try:
            report["health"] = await _in_thread(self.gw.healthz)
        except GatewayError as e:
            report["health"] = str(e)
        try:
            await _in_thread(lambda: self.gw.request("GET", "/v1/runs/x", token=self.gw.admin, timeout=20))
            report["admin"] = "unexpected 200 for an invalid run id"
        except GatewayError as e:
            report["admin"] = "accepted" if e.status in (400, 404) else f"rejected: {e.status} {e.code}"
        report["ok"] = report["health"] == {"ok": True} and report["admin"] == "accepted"
        with open(os.path.join(self.out, "dry_run.json"), "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=2, default=str)
        print(json.dumps(report, indent=2, default=str))
        self.close_log()
        return 0 if report["ok"] else 1

    def write_config(self, run_config: dict) -> None:
        conf = {k: v for k, v in self.cfg.__dict__.items()}
        conf.update({"forge": "cloudflare", "gateway": self.gateway_url, "run": self.run_id, "policy": self.policy,
                     "v2": self.v2 if self.policy != "queue" else None,
                     "run_config": {k: v for k, v in run_config.items() if k not in ("tasks", "footprints")}})
        with open(os.path.join(self.out, "config.json"), "w", encoding="utf-8") as fh:
            json.dump(conf, fh, indent=2, default=str)

    def policy_summary(self) -> dict:  # summaries come from the gateway
        return {}


CORE_RESULT_KEYS = ("ok", "infra_error", "timed_out", "exit_code", "subtype", "is_error", "cost_usd", "cost_source",
                    "num_turns", "duration_ms", "duration_api_ms", "wall_ms", "startup_ms", "session_id",
                    "rate_limited", "pushed_ref", "head_sha", "new_commit", "files", "tamper", "markers_left",
                    "merge_conflicts")


def _num(value, *, integer: bool = False, nullable: bool = True):
    """A non-negative number (or None when allowed): the result schema's bounds."""
    if value is None or isinstance(value, bool) or not isinstance(value, (int, float)) or value != value:
        return None if nullable else 0
    value = max(0, value)
    return int(value) if integer else value


def result_body(res: InvocationResult, fields: dict, secrets: Secrets) -> dict:
    """``POST result``: ``InvocationResult.to_event()`` (as the harness logs ``invocation.end``) plus ``init`` and the
    git fields, with every value inside the gateway's schema (shared-race ``InvocationResult``)."""
    body = res.to_event()
    for key in ("inv_id", "adapter", "model"):
        body.pop(key, None)
    body["init"] = res.init or {}
    body["cost_usd"] = min(_num(body.get("cost_usd"), nullable=False), 10_000)
    body["wall_ms"] = _num(body.get("wall_ms"), nullable=False)
    for key in ("duration_ms", "duration_api_ms", "startup_ms"):
        body[key] = _num(body.get(key))
    body["num_turns"] = _num(body.get("num_turns"), integer=True)
    if not isinstance(body.get("exit_code"), int) or isinstance(body.get("exit_code"), bool):
        body["exit_code"] = None
    body["usage"] = {str(k): _num(v, nullable=False) for k, v in (body.get("usage") or {}).items()}
    body["tool_uses"] = {str(k): _num(v, nullable=False) for k, v in (body.get("tool_uses") or {}).items()}
    body["notes"] = [str(n) for n in body.get("notes") or []]
    for key, limit in (("subtype", 100), ("session_id", 200), ("transcript", 1000), ("cost_source", 40)):
        if body.get(key) is not None:
            body[key] = str(body[key])[:limit]
    if body.get("infra_error"):
        body["infra_error"] = secrets.scrub(body["infra_error"])[:4000]
    body.update(fields)
    return body


def check_v2_flags(policy: str, cfg: RaceConfig, explicit: set[str]) -> str | None:
    """v2 on the gateway always forks from the sprout head, runs without the error budget and protects landed
    tests; an explicit flag that says otherwise is an error rather than a silently different race."""
    if policy != "beanstalk-v2":
        return None
    if "--snapshot" in explicit and cfg.snapshot != "head":
        return "beanstalk-v2 on the gateway starts tasks from the sprout head: use --snapshot head"
    if "--error-budget" in explicit and cfg.error_budget != 999:
        return "beanstalk-v2 on the gateway has no error-budget controller: use --error-budget 999 or leave it out"
    if "--protect-tests" in explicit and cfg.protect_tests != "landed":
        return "beanstalk-v2 on the gateway protects landed acceptance tests: use --protect-tests landed"
    return None


def explicit_flags(argv: list[str]) -> set[str]:
    return {a.split("=", 1)[0] for a in argv if re.match(r"^--[a-z]", a)}
