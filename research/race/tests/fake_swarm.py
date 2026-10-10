"""A stdlib fake of beanstalk-swarm (research/swarm) for the driver tests: matches, the start barrier, and the two
virtual hosts a slot uses, with each "container" a local ``python3 -m harness.slot`` process.

Like the Worker's handlers, the fake adds the slot token to every gateway request (the slot sends a placeholder), takes
refreshed tokens out of ``next`` answers, and records spend from result and progress posts. One difference: the real
gateway builds workspace URLs from the request's origin (``http://bs.internal``); the fake gateway uses its own, so
the fake rewrites them to the slot's proxy prefix.
"""
from __future__ import annotations

import json
import os
import re
import secrets
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TESTS = os.path.dirname(os.path.abspath(__file__))
RACE = os.path.dirname(TESTS)


class FakeSwarm:
    def __init__(self, root: str, gateway_url: str, arena: str):
        self.root, self.gateway_url, self.arena = root, gateway_url.rstrip("/"), arena
        self.admin = "swarm-admin-" + secrets.token_hex(16)
        self.lock = threading.Lock()
        self.match: dict | None = None
        self.tokens: dict[str, str] = {}
        self.procs: dict[str, subprocess.Popen] = {}
        self.logs: list[str] = []
        self.files: dict[tuple[str, str], bytes] = {}
        self.spend: dict[str, float] = {}
        self.forwarded: list[tuple[str, str]] = []   # (slot, authorization header the slot sent)
        self.refreshed: list[str] = []
        self.server: ThreadingHTTPServer | None = None
        self.url = ""

    # ---- server ---------------------------------------------------------------------------------------

    def start(self) -> str:
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args) -> None:
                pass

            def do_GET(self) -> None:  # noqa: N802
                fake.dispatch(self)

            def do_POST(self) -> None:  # noqa: N802
                fake.dispatch(self)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        return self.url

    def stop(self) -> None:
        for proc in self.procs.values():
            if proc.poll() is None:
                proc.kill()
        if self.server:
            self.server.shutdown()
            self.server.server_close()

    def dispatch(self, h: BaseHTTPRequestHandler) -> None:
        url = urllib.parse.urlsplit(h.path)
        n = int(h.headers.get("Content-Length") or 0)
        body = h.rfile.read(n) if n else b""
        try:
            m = re.match(r"^/(c|bs)/([a-z]\d+)(/.*)$", url.path)
            if m and m.group(1) == "c":
                status, payload, ctype = self.control(m.group(2), h.command, m.group(3), body)
            elif m:
                status, payload, ctype = self.proxy(m.group(2), h, m.group(3), url.query, body)
            else:
                status, payload, ctype = self.admin_route(h, url, body)
        except Exception as e:  # noqa: BLE001
            status, payload, ctype = 500, json.dumps({"error": repr(e)}).encode(), "application/json"
        h.send_response(status)
        h.send_header("Content-Type", ctype)
        h.send_header("Content-Length", str(len(payload)))
        h.end_headers()
        h.wfile.write(payload)

    # ---- admin --------------------------------------------------------------------------------------

    def admin_route(self, h, url, body: bytes) -> tuple[int, bytes, str]:
        if h.headers.get("Authorization") != f"Bearer {self.admin}":
            return 401, b'{"error":"unauthorized"}', "application/json"
        if h.command == "POST" and url.path == "/v1/matches":
            return self.create(json.loads(body))
        m = re.match(r"^/v1/matches/([^/]+)(?:/(release|halt|log|files|file))?$", url.path)
        if not m or not self.match or m.group(1) != self.match["match"]:
            return 404, b"{}", "application/json"
        action = m.group(2)
        if action == "release":
            with self.lock:
                self.match["state"], self.match["released_at"] = "running", time.time()
            return self.view()
        if action == "halt":
            with self.lock:
                if self.match["state"] != "done":
                    self.match["state"] = "halted"
            for proc in self.procs.values():
                if proc.poll() is None:
                    proc.terminate()
            return self.view()
        if action == "log":
            return 200, "".join(self.logs).encode(), "application/x-ndjson"
        if action == "files":
            files = [{"slot": s, "name": n, "bytes": len(c)} for (s, n), c in sorted(self.files.items())]
            return 200, json.dumps({"files": files}).encode(), "application/json"
        if action == "file":
            q = dict(urllib.parse.parse_qsl(url.query))
            return 200, self.files.get((q["slot"], q["name"]), b""), "application/octet-stream"
        return self.view()

    def create(self, body: dict) -> tuple[int, bytes, str]:
        with self.lock:
            self.match = {"match": "m-fake-" + secrets.token_hex(4), "state": "starting", "body": body,
                          "agents": {s["slot"]: {"slot": s["slot"], "started_at": time.time(), "hello_at": None,
                                                 "exited_at": None, "exit_code": None} for s in body["slots"]}}
            self.tokens = {s["slot"]: s["token"] for s in body["slots"]}
        for s in body["slots"]:
            slot = s["slot"]
            env = {k: v for k, v in os.environ.items() if not k.startswith(("BEANSTALK_", "SWARM_"))}
            env.update({"SWARM_CONTROL_URL": f"{self.url}/c/{slot}", "SWARM_GATEWAY_URL": f"{self.url}/bs/{slot}",
                        "SWARM_ARENA_DIR": self.arena, "SWARM_OUT_DIR": os.path.join(self.root, slot, "out")})
            log = open(os.path.join(self.root, f"{slot}.stderr"), "w")
            self.procs[slot] = subprocess.Popen([sys.executable, "-m", "harness.slot"], cwd=RACE, env=env,
                                                stdout=log, stderr=subprocess.STDOUT)
        return self.view(201)

    def view(self, status: int = 200) -> tuple[int, bytes, str]:
        assert self.match
        agents = list(self.match["agents"].values())
        cold = [round((a["hello_at"] - a["started_at"]) * 1000) for a in agents if a["hello_at"]]
        out = {"match": self.match["match"], "state": self.match["state"], "agents": agents,
               "cold_start_ms": {"median": sorted(cold)[len(cold) // 2] if cold else None,
                                 "max": max(cold) if cold else None},
               "container_seconds": 0, "usd": {"agents": round(sum(self.spend.values()), 6), "containers": 0}}
        return status, json.dumps(out).encode(), "application/json"

    # ---- control.internal -----------------------------------------------------------------------------

    def control(self, slot: str, method: str, path: str, body: bytes) -> tuple[int, bytes, str]:
        assert self.match
        agent = self.match["agents"][slot]
        ok = (200, b'{"ok":true}', "application/json")
        if method == "POST" and path == "/v1/hello":
            with self.lock:
                agent["hello_at"] = agent["hello_at"] or time.time()
                if all(a["hello_at"] for a in self.match["agents"].values()) and self.match["state"] == "starting":
                    self.match["state"] = "ready"
            return ok
        if method == "GET" and path == "/v1/config":
            if self.match["state"] in ("halted", "done"):
                return 200, json.dumps({"released": False, "halted": True}).encode(), "application/json"
            if self.match["state"] != "running":
                return 200, b'{"released":false,"halted":false}', "application/json"
            driver = self.match["body"]["driver"]
            config = {**driver, "slot": slot, "run": self.match["body"]["gateway_run"],
                      "codex": {"config_overrides": [], "placeholder_auth": False}}
            return 200, json.dumps({"released": True, "config": config}).encode(), "application/json"
        if method == "POST" and path == "/v1/log":
            with self.lock:
                self.logs.append(body.decode("utf-8"))
            return ok
        m = re.match(r"^/v1/files/([A-Za-z0-9._-]+)$", path)
        if method == "POST" and m:
            self.files[(slot, m.group(1))] = body
            return ok
        if method == "POST" and path == "/v1/exit":
            with self.lock:
                agent["exited_at"] = time.time()
                agent["exit_code"] = json.loads(body or b"{}").get("code")
                if all(a["exited_at"] for a in self.match["agents"].values()):
                    self.match["state"] = "done"
            return ok
        return 404, b"{}", "application/json"

    # ---- bs.internal ----------------------------------------------------------------------------------

    def proxy(self, slot: str, h, path: str, query: str, body: bytes) -> tuple[int, bytes, str]:
        self.forwarded.append((slot, h.headers.get("Authorization") or ""))
        inv = re.match(r"^/v1/runs/[^/]+/invocations/([^/]+)/(result|progress)$", path)
        if inv and body:
            cost = json.loads(body).get("cost_usd")
            if isinstance(cost, (int, float)):
                with self.lock:
                    self.spend[inv.group(1)] = max(self.spend.get(inv.group(1), 0.0), float(cost))
        req = urllib.request.Request(self.gateway_url + path + (f"?{query}" if query else ""),
                                     data=body if h.command == "POST" else None, method=h.command)
        for name in ("Content-Type", "Accept", "Git-Protocol"):
            if h.headers.get(name):
                req.add_header(name, h.headers[name])
        req.add_header("Authorization", f"Bearer {self.tokens[slot]}")
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                status, payload, ctype = resp.status, resp.read(), resp.headers.get("Content-Type", "")
        except urllib.error.HTTPError as e:
            status, payload, ctype = e.code, e.read(), e.headers.get("Content-Type", "")
        if path.endswith("/next") and status == 200:
            reply = json.loads(payload)
            token = (reply.pop("token", None) or {}).get("token")
            if token:
                self.tokens[slot] = token
                self.refreshed.append(token)
            payload = json.dumps(reply).replace(self.gateway_url, f"{self.url}/bs/{slot}").encode()
        return status, payload, ctype
