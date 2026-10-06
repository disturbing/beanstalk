"""Cloud swarm races (``race.py --forge cloudflare --swarm URL``): the agents run in Cloudflare containers.

``SwarmRace`` is ``RemoteRace`` with the slot loops moved off this machine. It creates and seeds the gateway run as
``remote.py`` does, hands the run's slot tokens to a match on ``beanstalk-swarm`` (packages/swarm), which starts one
agent container per slot and waits until every container has said hello. Only then does it start the run and release
the match, so every slot begins at one shared instant and container cold starts stay out of race time. It then waits
for the gateway's end of the race, downloads the run as usual, and adds the slots' ``driver.jsonl`` lines
(``work/driver-swarm.jsonl``), their transcripts (``work/transcripts/<slot>/``) and the match's own record
(``swarm.json``: cold starts, container seconds, spend) to the run directory.

The swarm admin token comes from ``$SWARM_ADMIN_TOKEN`` or ``SWARM_ADMIN_TOKEN`` in packages/swarm/.dev.vars; like the
gateway admin token it is never printed.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

from .core import RaceConfig
from .remote import REPO_ROOT, GatewayError, RemoteRace, Secrets, _in_thread

SWARM_DEV_VARS = os.path.join(REPO_ROOT, "packages", "swarm", ".dev.vars")
READY_TIMEOUT = 600.0     # every container must say hello within this long
VIEW_INTERVAL = 5.0       # how often the gateway's phase is polled while the swarm runs the slots
CREDENTIAL_MODES = ("none", "api-key", "lease")


class SwarmError(RuntimeError):
    pass


def load_swarm_token(env: dict | None = None, dev_vars: str = SWARM_DEV_VARS) -> str | None:
    env = os.environ if env is None else env
    token = env.pop("SWARM_ADMIN_TOKEN", None)
    if token:
        return token.strip()
    try:
        with open(dev_vars, encoding="utf-8") as fh:
            for line in fh:
                key, sep, value = line.strip().partition("=")
                if sep and key.strip() == "SWARM_ADMIN_TOKEN":
                    return value.strip().strip("'\"") or None
    except OSError:
        return None
    return None


class SwarmClient:
    def __init__(self, base: str, token: str, secrets: Secrets):
        self.base, self.token, self.secrets = base.rstrip("/"), token, secrets
        secrets.add(token)

    def request(self, method: str, path: str, body: object = None, *, timeout: float = 60.0, raw: bool = False):
        data = None if body is None else json.dumps(body).encode("utf-8")
        req = urllib.request.Request(self.base + path, data=data, method=method)
        req.add_header("Authorization", f"Bearer {self.token}")
        req.add_header("User-Agent", "beanstalk-race-driver/1")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                payload = resp.read()
        except urllib.error.HTTPError as e:
            raise SwarmError(self.secrets.scrub(f"{method} {path}: {e.code} {e.read()[:600]!r}")) from None
        except (urllib.error.URLError, OSError) as e:
            raise SwarmError(self.secrets.scrub(f"{method} {path}: {e!r}")) from None
        if raw:
            return payload
        return json.loads(payload) if payload.strip() else {}


class SwarmRace(RemoteRace):
    def __init__(self, cfg: RaceConfig, *, swarm: str, swarm_token: str, credential: str = "none",
                 seat: str | None = None, swarm_max_usd: float | None = None, **kw):
        super().__init__(cfg, **kw)
        if credential not in CREDENTIAL_MODES:
            raise SystemExit(f"--swarm-credential is one of {', '.join(CREDENTIAL_MODES)}")
        if cfg.agent == "codex" and credential == "none":
            raise SystemExit("a codex swarm race needs --swarm-credential api-key or lease")
        if credential == "lease" and cfg.agents != 1:
            raise SystemExit("--swarm-credential lease runs one agent (one ChatGPT seat per serialised stream)")
        self.swarm = SwarmClient(swarm, swarm_token, self.secrets)
        self.swarm_url = swarm.rstrip("/")
        self.credential, self.seat, self.swarm_max_usd = credential, seat, swarm_max_usd
        self.match: str | None = None

    def match_body(self) -> dict:
        assert self.run_id
        race = {k: v for k, v in self.cfg.__dict__.items() if k not in ("arena", "repo", "out")}
        return {
            "gateway_run": self.run_id,
            "slots": [{"slot": s, "token": t} for s, t in sorted(self.tokens.items(), key=lambda x: int(x[0][1:]))],
            "credential": {"mode": self.credential, **({"seat": self.seat} if self.seat else {})},
            "max_usd": self.swarm_max_usd if self.swarm_max_usd is not None else self.guards.get("max_usd"),
            "driver": {"policy": self.policy, "v2": self.v2 if self.policy != "queue" else {}, "guards": self.guards,
                       "base_sha": self.base_sha, "repo_files": sorted(self.repo_files),
                       "app_prefix": not any(f.startswith("app/") for f in self.repo_files),
                       "arena_digest": self.arena_digest, "race": race,
                       "outage_seconds": self.outage_seconds, "infra_backoff": self.infra_backoff,
                       # SWARM_DIAGNOSE=1: each slot ships net-diag.txt (its network as seen from inside)
                       "diagnose": os.environ.get("SWARM_DIAGNOSE") == "1"},
        }

    async def drive(self) -> None:
        await self.seed_base()
        created = await _in_thread(self.swarm.request, "POST", "/v1/matches", self.match_body())
        self.match = created["match"]
        self.log("driver.swarm_match", match=self.match, agents=len(self.tokens), credential=self.credential)
        self.say(f"swarm match {self.match}: starting {len(self.tokens)} agent containers")
        view = await self.wait_ready()
        self.say(f"all {len(self.tokens)} containers ready; cold start median "
                 f"{view.get('cold_start_ms', {}).get('median')} ms, max {view.get('cold_start_ms', {}).get('max')} ms")
        await self.start_run()
        await _in_thread(self.swarm.request, "POST", f"/v1/matches/{self.match}/release", {})
        self.log("driver.swarm_released", match=self.match)
        if self.aborted:
            await self.send_stop(self.aborted)
        watchdog = asyncio.create_task(self.wall_watchdog(), name="wall-watchdog")
        try:
            await self.wait_done()
        finally:
            watchdog.cancel()

    async def wait_ready(self) -> dict:
        deadline = time.monotonic() + READY_TIMEOUT
        while time.monotonic() < deadline:
            view = await _in_thread(self.swarm.request, "GET", f"/v1/matches/{self.match}")
            if view.get("state") == "ready":
                return view
            if view.get("state") in ("halted", "failed"):
                raise SwarmError(f"match {self.match} {view.get('state')}: {view.get('reason')}")
            await asyncio.sleep(1.0)
        raise SwarmError(f"match {self.match}: containers not ready after {READY_TIMEOUT:.0f} s")

    async def wait_done(self) -> None:
        """Until the gateway says the run is done (or the driver gives up); the swarm's slots post every result."""
        assert self.run_over is not None and self.run_id
        while not self.run_over.is_set():
            try:
                view = await _in_thread(self.gw.view, self.run_id)
                if view.get("phase") == "done":
                    self.on_done(view.get("aborted"))
                    return
            except GatewayError as e:
                self.log("driver.error", where="view", error=str(e)[:300])
            try:
                match = await _in_thread(self.swarm.request, "GET", f"/v1/matches/{self.match}")
                if match.get("state") == "halted" and not self.aborted:
                    self.abort(f"swarm halted: {match.get('reason')}")
                elif match.get("state") == "done" and not self.aborted:
                    # every slot exited (each stops itself after a long agent-CLI outage) before the run ended
                    self.abort(f"swarm: every slot exited before the run ended ({match.get('reason')})")
                if self.aborted and self.stop_sent:
                    return  # finish() waits for the gateway's final check
            except SwarmError as e:
                self.log("driver.error", where="swarm view", error=str(e)[:300])
            try:
                await asyncio.wait_for(self.run_over.wait(), timeout=VIEW_INTERVAL)
            except asyncio.TimeoutError:
                pass

    def abort(self, reason: str) -> None:
        super().abort(reason)
        if self.match and reason.startswith("signal"):
            asyncio.ensure_future(_in_thread(self.swarm.request, "POST", f"/v1/matches/{self.match}/halt",
                                             {"reason": reason[:200]}))

    async def finish(self) -> None:
        await super().finish()
        if self.match:
            await self.collect()

    async def collect(self) -> None:
        """The slots' driver logs and transcripts, and the match record; then the containers are stopped."""
        assert self.match
        try:
            # let the slots ship their last lines (they exit right after the gateway's done)
            for _ in range(24):
                view = await _in_thread(self.swarm.request, "GET", f"/v1/matches/{self.match}")
                if all(a.get("exited_at") for a in view.get("agents", [])):
                    break
                await asyncio.sleep(5.0)
            log = await _in_thread(lambda: self.swarm.request("GET", f"/v1/matches/{self.match}/log", raw=True))
            with open(os.path.join(self.work, "driver-swarm.jsonl"), "wb") as fh:
                fh.write(log)
            files = await _in_thread(self.swarm.request, "GET", f"/v1/matches/{self.match}/files")
            for item in files.get("files", []):
                slot, name = item["slot"], item["name"]
                q = urllib.parse.urlencode({"slot": slot, "name": name})
                data = await _in_thread(lambda q=q: self.swarm.request("GET", f"/v1/matches/{self.match}/file?{q}",
                                                                       raw=True))
                dest = os.path.join(self.work, "transcripts", slot)
                os.makedirs(dest, exist_ok=True)
                with open(os.path.join(dest, os.path.basename(name)), "wb") as fh:
                    fh.write(data)
            view = await _in_thread(self.swarm.request, "POST", f"/v1/matches/{self.match}/halt",
                                    {"reason": "race over"})
            with open(os.path.join(self.out, "swarm.json"), "w", encoding="utf-8") as fh:
                json.dump({"swarm": self.swarm_url, **view}, fh, indent=2)
            cold = view.get("cold_start_ms") or {}
            self.say(f"swarm: cold start median {cold.get('median')} ms (max {cold.get('max')}), "
                     f"{view.get('container_seconds')} container-s, ~${(view.get('usd') or {}).get('containers', 0):.4f} "
                     f"containers, agent spend ${(view.get('usd') or {}).get('agents', 0):.4f}")
        except SwarmError as e:
            self.say(f"collecting the swarm's logs failed: {e}")
            self.log("driver.error", where="swarm collect", error=str(e)[:500])
