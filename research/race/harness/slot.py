"""Single-slot driver: one agent slot of a remote race, run inside a cloud swarm container (``python3 -m harness.slot``).

The container holds no secret. It asks the swarm for its slot's config through ``http://control.internal``, waits for
the match's shared start, then runs exactly the slot loop that ``remote.py`` runs on a laptop (prepare, merge, agent,
restore tests, commit, push, post) against ``http://bs.internal``, the gateway as the swarm's outbound handler serves
it. The handler adds the slot token to every request and takes refreshed tokens out of ``next`` answers, so the token
this driver sends (``SLOT_PLACEHOLDER``) is a placeholder. Codex talks to ``http://model.internal`` the same way
(``CodexAdapter.config_overrides``); the handler adds the API key or the leased ChatGPT seat's token.

The driver's own log (``driver.jsonl``) and agent transcripts are shipped to the swarm while the slot runs and at the
end, so the operator downloads them with the run.
"""
from __future__ import annotations

import asyncio
import base64
import datetime as dt
import json
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request

from .arena import load_tasks
from .core import RaceConfig, TaskState, snapshot_arena
from .remote import RemoteRace

CONTROL = os.environ.get("SWARM_CONTROL_URL", "http://control.internal")
GATEWAY = os.environ.get("SWARM_GATEWAY_URL", "http://bs.internal")  # overridden only by tests/fake_swarm.py
SLOT_PLACEHOLDER = "swarm-slot-placeholder"  # replaced by the outbound handler; never a real token
HERE = os.path.dirname(os.path.abspath(__file__))
ARENA_DIR = os.environ.get("SWARM_ARENA_DIR", os.path.normpath(os.path.join(HERE, "..", "..", "arena")))
OUT_DIR = os.environ.get("SWARM_OUT_DIR", "/work/out")
CONFIG_WAIT = 900.0            # how long a slot waits for the match's start before it gives up
LOG_SHIP_INTERVAL = 15.0       # driver.jsonl lines go to the swarm at least this often
TRANSCRIPT_LIMIT = 512 * 1024  # the tail of each transcript file shipped at the end
# RaceConfig fields the laptop owns as paths; the slot sets its own
LOCAL_FIELDS = ("arena", "repo", "out", "claude_bin", "codex_bin", "force", "dry_run")


class ControlError(RuntimeError):
    pass


class Control:
    """The swarm's control routes, seen from the container (plain HTTP to the outbound handler)."""

    def __init__(self, base: str = CONTROL):
        self.base = base.rstrip("/")

    def call(self, method: str, path: str, body: object = None, *, raw: bytes | None = None,
             content_type: str = "application/json", timeout: float = 30.0) -> dict:
        data = raw if raw is not None else (None if body is None else json.dumps(body).encode("utf-8"))
        req = urllib.request.Request(self.base + path, data=data, method=method)
        if data is not None:
            req.add_header("Content-Type", content_type)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                text = resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            raise ControlError(f"{method} {path}: {e.code} {e.read().decode('utf-8', 'replace')[:300]}") from None
        except (urllib.error.URLError, OSError) as e:
            raise ControlError(f"{method} {path}: {e!r}"[:300]) from None
        return json.loads(text) if text.strip() else {}

    def retry(self, method: str, path: str, body: object = None, attempts: int = 8, **kw) -> dict:
        delay = 0.5
        for attempt in range(attempts):
            try:
                return self.call(method, path, body, **kw)
            except ControlError:
                if attempt == attempts - 1:
                    raise
                time.sleep(delay)
                delay = min(delay * 2, 10.0)
        raise AssertionError("unreachable")


def codex_version() -> str | None:
    try:
        out = subprocess.run(["codex", "--version"], capture_output=True, text=True, timeout=30)
        return (out.stdout or out.stderr).strip()[:100] or None
    except (OSError, subprocess.SubprocessError):
        return None


def placeholder_auth() -> dict:
    """A ChatGPT-mode ``auth.json`` with made-up, unsigned tokens. With ``requires_openai_auth`` Codex sends them to
    ``model.internal``, whose handler replaces them with the leased seat's real token; this file is not a credential."""
    def b64(value: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b"=").decode()
    claims = {"email": "swarm-agent@beanstalk.invalid", "exp": 4102444800,  # 2100-01-01: Codex never refreshes it
              "https://api.openai.com/auth": {"chatgpt_plan_type": "pro", "chatgpt_account_id": "swarm-placeholder"}}
    jwt = f"{b64({'alg': 'none', 'typ': 'JWT'})}.{b64(claims)}.cGxhY2Vob2xkZXI"
    now = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
    return {"OPENAI_API_KEY": None, "auth_mode": "chatgpt", "last_refresh": now,
            "tokens": {"id_token": jwt, "access_token": jwt, "refresh_token": "swarm-placeholder",
                       "account_id": "swarm-placeholder"}}


def race_config(raw: dict) -> RaceConfig:
    cfg = RaceConfig(**{k: v for k, v in raw.items() if k in RaceConfig.__dataclass_fields__ and k not in LOCAL_FIELDS})
    if isinstance(cfg.codex_price, list):
        cfg.codex_price = tuple(cfg.codex_price)
    cfg.arena, cfg.repo, cfg.out, cfg.force = ARENA_DIR, "", OUT_DIR, True
    return cfg


class SlotRace(RemoteRace):
    """``RemoteRace`` with one slot, no run creation, seeding or download: the laptop (``swarm.py``) does those."""

    def __init__(self, cfg: RaceConfig, conf: dict, control: Control):
        super().__init__(cfg, gateway=GATEWAY, admin_token=None, policy=conf["policy"], v2=conf.get("v2") or {},
                         auth_probe=False, guards=conf.get("guards") or {})
        self.conf, self.control = conf, control
        self.slot = conf["slot"]
        self.run_id = conf["run"]
        self.tokens = {self.slot: SLOT_PLACEHOLDER}
        self.log_offset = 0
        # the laptop's BEANSTALK_OUTAGE_SECONDS / BEANSTALK_INFRA_BACKOFF, so a slot pauses and gives up as it would there
        self.outage_seconds = float(conf.get("outage_seconds") or self.outage_seconds)
        self.infra_backoff = float(conf.get("infra_backoff") or self.infra_backoff)

    def make_adapter(self):
        adapter = super().make_adapter()
        overrides = (self.conf.get("codex") or {}).get("config_overrides") or []
        if overrides and hasattr(adapter, "config_overrides"):
            adapter.config_overrides = tuple(overrides)
        return adapter

    async def setup(self) -> None:
        """The arena baked into the image (checked against the laptop's digest), the tasks, the adapter."""
        self.prepare_out()
        self.init_local()
        self.base_sha = self.conf["base_sha"]
        self.repo_files = set(self.conf.get("repo_files") or [])
        self.arena_snapshot, self.arena_digest = snapshot_arena(self.cfg.arena, os.path.join(self.work, "arena"))
        if self.arena_digest != self.conf.get("arena_digest"):
            raise SystemExit(f"arena digest {self.arena_digest} in the image, {self.conf.get('arena_digest')} in the "
                             "match: rebuild the agent image from the race's commit")
        tasks = load_tasks(self.arena_snapshot, self.cfg.tasks, app_prefix=bool(self.conf.get("app_prefix", True)))
        self.tasks = [TaskState(task=t) for t in tasks]
        self.by_id = {t.id: t for t in self.tasks}
        self.adapter = self.make_adapter()
        self.adapters[str(getattr(self.adapter, "model", None))] = self.adapter

    async def drive(self) -> None:
        shipper = asyncio.create_task(self.ship_logs_forever(), name="ship-logs")
        try:
            await self.slot_loop(self.slot)
        finally:
            shipper.cancel()
            await asyncio.gather(shipper, return_exceptions=True)

    async def run(self) -> int:
        await self.setup_or_close()
        self.run_over = asyncio.Event()
        self.started = True
        self.log("driver.slot_start", run=self.run_id, slot=self.slot, base=self.base_sha, agent=self.cfg.agent,
                 model=getattr(self.adapter, "model", None))
        code = 0
        try:
            await self.drive()
        except Exception as e:  # noqa: BLE001 - reported to the swarm, the container exits non-zero
            self.log("driver.error", where="slot", error=repr(e)[:2000])
            self.say(f"slot error: {e!r}")
            code = 3
        finally:
            self.kill_agents("the slot is finishing")
            await self.registry.kill_all()
            self.close_log()
            await asyncio.to_thread(self.ship_logs)
            await asyncio.to_thread(self.ship_transcripts)
        return code

    def abort(self, reason: str) -> None:
        """A slot never stops the run (the laptop and the swarm do); it stops its own agent and loop."""
        if not self.aborted:
            self.aborted = reason
            self.say(f"slot aborting: {reason}")
        self.kill_agents(reason)
        if self.run_over is not None:
            self.run_over.set()
        for t in self.loops:
            t.cancel()

    async def send_stop(self, reason: str) -> None:  # the slot holds no admin token
        self.stop_sent = True

    async def finish(self) -> None:  # the laptop downloads the run
        return

    # ---- shipping logs and transcripts --------------------------------------------------------------

    async def ship_logs_forever(self) -> None:
        while True:
            await asyncio.sleep(LOG_SHIP_INTERVAL)
            await asyncio.to_thread(self.ship_logs)

    def ship_logs(self) -> None:
        path = os.path.join(self.work, "driver.jsonl")
        try:
            with open(path, "rb") as fh:
                fh.seek(self.log_offset)
                chunk = fh.read(4 * 1024 * 1024)
        except OSError:
            return
        cut = chunk.rfind(b"\n") + 1
        if cut <= 0:
            return
        try:
            self.control.retry("POST", "/v1/log", raw=chunk[:cut], content_type="application/x-ndjson", attempts=3)
            self.log_offset += cut
        except Exception as e:  # noqa: BLE001 - logs are best effort; the next ship retries the same lines
            print(f"[slot] shipping driver.jsonl failed: {e}", file=sys.stderr, flush=True)

    def ship_transcripts(self) -> None:
        if not os.path.isdir(self.transcripts):
            return
        for name in sorted(os.listdir(self.transcripts)):
            full = os.path.join(self.transcripts, name)
            if not os.path.isfile(full):
                continue
            with open(full, "rb") as fh:
                fh.seek(max(0, os.path.getsize(full) - TRANSCRIPT_LIMIT))
                data = fh.read()
            try:
                self.control.retry("POST", f"/v1/files/{name}", raw=data, content_type="application/octet-stream",
                                   attempts=3)
            except Exception as e:  # noqa: BLE001
                print(f"[slot] shipping {name} failed: {e}", file=sys.stderr, flush=True)


def harness_digest() -> str:
    """The driver code this image runs (sha256 of harness/*.py, 12 hex), reported in the hello."""
    import hashlib
    h = hashlib.sha256()
    for name in sorted(os.listdir(HERE)):
        if name.endswith(".py"):
            with open(os.path.join(HERE, name), "rb") as fh:
                h.update(name.encode() + b"\0" + fh.read())
    return h.hexdigest()[:12]


class _Tee:
    """stderr to the container's own stderr and to a file shipped at the end (``slot-stderr.txt``)."""

    def __init__(self, *streams):
        self.streams = streams

    def write(self, text: str) -> int:
        for stream in self.streams:
            stream.write(text)
            stream.flush()
        return len(text)

    def flush(self) -> None:
        for stream in self.streams:
            stream.flush()


def wait_for_start(control: Control) -> dict:
    """Hello (the cold-start mark), then wait for the match's shared start; returns the slot config."""
    control.retry("POST", "/v1/hello", {"codex_version": codex_version(), "harness": harness_digest(),
                                        "python": sys.version.split()[0], "pid": os.getpid()}, attempts=20)
    deadline = time.monotonic() + CONFIG_WAIT
    while time.monotonic() < deadline:
        reply = control.retry("GET", "/v1/config")
        if reply.get("halted"):
            raise SystemExit(f"the match was halted before the start: {reply.get('reason')}")
        if reply.get("released"):
            return reply["config"]
        time.sleep(0.5)
    raise SystemExit("the match never started")


def network_report(conf: dict) -> str:
    """What this container's network looks like from the inside (``SWARM_DIAGNOSE=1`` on the laptop): resolver files,
    proxy variables, name lookups of the virtual hosts, a plain request to ``model.internal``, and with a model
    credential one short ``codex exec`` with transport logging. Shipped as ``net-diag.txt``; no credential is in it
    (the container has none)."""
    import socket
    out = []
    for path in ("/etc/hosts", "/etc/resolv.conf", "/etc/nsswitch.conf"):
        try:
            with open(path, encoding="utf-8") as fh:
                out.append(f"== {path}\n{fh.read()}")
        except OSError as e:
            out.append(f"== {path}: {e}")
    out.append("== proxy env\n" + "\n".join(f"{k}={v}" for k, v in os.environ.items() if "proxy" in k.lower()))
    for host in ("control.internal", "bs.internal", "model.internal"):
        try:
            out.append(f"== getaddrinfo {host}: {sorted({a[4][0] for a in socket.getaddrinfo(host, 80)})}")
        except OSError as e:
            out.append(f"== getaddrinfo {host}: {e!r}")
    for path in ("/v1/models", "/backend-api/codex/models"):
        try:
            with urllib.request.urlopen(f"http://model.internal{path}", timeout=20) as resp:
                out.append(f"== GET model.internal{path}: {resp.status}")
        except urllib.error.HTTPError as e:
            out.append(f"== GET model.internal{path}: {e.code} {e.read()[:200]!r}")
        except (urllib.error.URLError, OSError) as e:
            out.append(f"== GET model.internal{path}: {e!r}")
    # Codex's own sandbox for agent commands (bubblewrap on Linux: needs unprivileged user namespaces)
    try:
        res = subprocess.run(["codex", "sandbox", "-c", 'sandbox_mode="workspace-write"', "--", "sh", "-c",
                              "echo sandbox-ok; id -u"], capture_output=True, text=True, timeout=60, cwd="/tmp")
        out.append(f"== codex sandbox exit {res.returncode}: {res.stdout.strip()[:300]} {res.stderr.strip()[:600]}")
    except (OSError, subprocess.SubprocessError) as e:
        out.append(f"== codex sandbox: {e!r}")
    try:
        with open("/proc/sys/kernel/unprivileged_userns_clone", encoding="utf-8") as fh:
            out.append(f"== unprivileged_userns_clone: {fh.read().strip()}")
    except OSError as e:
        out.append(f"== unprivileged_userns_clone: {e.strerror}")
    overrides = (conf.get("codex") or {}).get("config_overrides") or []
    if overrides:
        argv = ["codex", "exec", "--json", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules",
                "-s", "read-only", "-C", "/tmp"]
        for o in overrides:
            argv += ["-c", o]
        env = {**os.environ, "RUST_LOG": "info,reqwest=trace,hyper_util=debug,codex_client=debug"}
        try:
            res = subprocess.run([*argv, "-"], input="Reply with the single word OK.", capture_output=True, text=True,
                                 timeout=90, env=env)
            out.append(f"== codex exit {res.returncode}\n-- stdout\n{res.stdout[-4000:]}\n-- stderr\n{res.stderr[-12000:]}")
        except (OSError, subprocess.SubprocessError) as e:
            out.append(f"== codex: {e!r}")
    return "\n".join(out) + "\n"


def prepare_codex_home(conf: dict) -> None:
    codex = conf.get("codex") or {}
    home = os.environ.get("CODEX_HOME")
    if not home:
        return
    os.makedirs(home, exist_ok=True)
    if codex.get("placeholder_auth"):
        with open(os.path.join(home, "auth.json"), "w", encoding="utf-8") as fh:
            json.dump(placeholder_auth(), fh)


STDERR_FILE = os.path.join(os.path.dirname(OUT_DIR.rstrip("/")) or "/work", "slot-stderr.txt")


def ship_stderr(control: Control) -> None:
    try:
        with open(STDERR_FILE, "rb") as fh:
            data = fh.read()[-TRANSCRIPT_LIMIT:]
        control.retry("POST", "/v1/files/slot-stderr.txt", raw=data, content_type="text/plain", attempts=3)
    except (OSError, ControlError):
        pass


def main() -> int:
    control = Control()
    try:
        sys.stderr = _Tee(sys.__stderr__, open(STDERR_FILE, "a", encoding="utf-8"))
    except OSError:
        pass
    try:
        conf = wait_for_start(control)
    except (SystemExit, ControlError) as e:
        print(f"[slot] {e}", file=sys.stderr, flush=True)
        try:
            control.call("POST", "/v1/exit", {"code": 3, "reason": str(e)[:300]})
        except ControlError:
            pass
        return 3
    prepare_codex_home(conf)
    if conf.get("diagnose"):
        try:
            control.retry("POST", "/v1/files/net-diag.txt", raw=network_report(conf).encode("utf-8"),
                          content_type="text/plain", attempts=3)
        except ControlError as e:
            print(f"[slot] shipping net-diag.txt failed: {e}", file=sys.stderr, flush=True)
    shutil.rmtree(OUT_DIR, ignore_errors=True)
    race = SlotRace(race_config(conf["race"]), conf, control)

    async def go() -> int:
        loop = asyncio.get_running_loop()

        def on_signal(sig: int) -> None:
            print(f"[slot] {signal.Signals(sig).name} received at {time.strftime('%H:%M:%S')}", file=sys.stderr)
            race.abort(f"signal {signal.Signals(sig).name}")

        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, on_signal, sig)
        return await race.run()

    try:
        code = asyncio.run(go())
    finally:
        race.registry.kill_all_sync()
    ship_stderr(control)
    try:
        control.retry("POST", "/v1/exit", {"code": code, "counts": race.counts}, attempts=3)
    except ControlError as e:
        print(f"[slot] exit report failed: {e}", file=sys.stderr, flush=True)
    return code


if __name__ == "__main__":
    sys.exit(main())
