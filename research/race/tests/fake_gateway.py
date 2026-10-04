"""A scripted stand-in for beanstalk's gateway (packages/gateway) to test the remote driver (harness/remote.py).

stdlib only. ``http.server`` serves the admin, read and driver routes with the gateway's JSON shapes;
``git http-backend`` serves ``/git/<namespace>/<repo>.git/*`` over local bare repositories (the run repo and one
bean per task), so the driver's fetches and pushes go over real smart HTTP and must carry the right run token.
Access follows the gateway's rules: the seed token pushes the sprout and the stalk before the start; a slot reads
the run repo, and reads and pushes ``task/<id>`` of the bean it is working on; every other request is refused.

The scenario is a small v2 race on the fixture arena with one slot per task, every task starting from the base:
a task's first result lands on the sprout; a later one that conflicts gets a rework that merges the sprout (with
the landed tasks' tests to protect, and a refreshed slot token); the rework lands; when every task has landed the
run ends and every poll is answered ``done``. ``failures`` collects whatever the driver did wrong.
"""
from __future__ import annotations

import base64
import datetime as dt
import json
import os
import re
import secrets
import subprocess
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

NS = "beanstalk-race"
SPROUT, STALK = "refs/heads/sprout", "refs/heads/stalk"
RUN_CONFIG_KEYS = {
    "policy", "agent", "model", "agents", "ci_seconds", "ci_slots", "batch", "batch_wait", "budget_usd",
    "max_invocation_usd", "max_turns", "agent_timeout", "seed", "error_budget", "snapshot", "merge_drivers",
    "queue_hold", "protect_tests", "preland_mode", "preland_seconds", "decision_seconds", "decision_oracle",
    "max_rework", "max_fix_attempts", "max_wall_minutes", "infra_retry_seconds", "rework_resume", "shuffle", "label",
    "arena", "arena_digest", "footprint", "footprint_threshold", "footprints", "tasks"}
RESULT_KEYS = {"ok", "infra_error", "timed_out", "exit_code", "subtype", "is_error", "cost_usd", "cost_source",
               "num_turns", "duration_ms", "duration_api_ms", "wall_ms", "startup_ms", "session_id", "usage",
               "model_usage", "permission_denials", "tool_uses", "result_text", "structured_output", "transcript",
               "notes", "rate_limit", "rate_limited", "init", "pushed_ref", "head_sha", "new_commit", "files",
               "tamper", "markers_left", "merge_conflicts"}
SHA = re.compile(r"^[0-9a-f]{40}$")


def git(cwd: str, *args: str, check: bool = True, input_text: str | None = None) -> subprocess.CompletedProcess:
    env = dict(os.environ, GIT_AUTHOR_NAME="gateway", GIT_AUTHOR_EMAIL="gw@beanstalk.invalid",
               GIT_COMMITTER_NAME="gateway", GIT_COMMITTER_EMAIL="gw@beanstalk.invalid", GIT_CONFIG_NOSYSTEM="1")
    res = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, env=env, input=input_text)
    if check and res.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {res.stderr.strip()}")
    return res


def push_refs(body: bytes) -> list[str]:
    """The refs of a receive-pack request's command list (pkt-lines up to the flush packet)."""
    refs, off = [], 0
    while off + 4 <= len(body):
        size = int(body[off:off + 4], 16)
        if size == 0:
            break
        line = body[off + 4:off + size].split(b"\0")[0].rstrip(b"\n")
        off += size
        parts = line.split(b" ")
        if not line.startswith(b"shallow ") and len(parts) >= 3:
            refs.append(parts[2].decode())
    return refs


class FakeGateway:
    def __init__(self, root: str, *, page_limit: int = 3, poll_seconds: float = 0.4,
                 reject_first_result: bool = False, abort_on_progress: bool = False,
                 broken_bean_reads: bool = False):
        self.root = os.path.abspath(root)
        os.makedirs(self.root, exist_ok=True)
        self.page_limit, self.poll_seconds = page_limit, poll_seconds
        self.reject_first_result, self.abort_on_progress = reject_first_result, abort_on_progress
        self.broken_bean_reads = broken_bean_reads  # beans answer upload-pack with a 500, as later forks did live
        self.admin = "admin-" + secrets.token_hex(16)
        self.cv = threading.Condition()
        self.server: ThreadingHTTPServer | None = None
        self.url = ""
        self.reset()

    def reset(self) -> None:
        self.run: str | None = None
        self.phase = "none"
        self.config: dict = {}
        self.tokens: dict[str, str] = {}       # slot -> the token it must use now
        self.retired: set[str] = set()         # replaced tokens, refused from then on
        self.refresh: dict[str, str] = {}      # slot -> token to hand out with its next reply
        self.seed = ""
        self.view = ""
        self.outbox: dict[str, dict] = {}
        self.open: dict[str, dict] = {}        # inv -> delivered instruction
        self.holding: dict[str, str] = {}      # slot -> task
        self.results: dict[str, dict] = {}
        self.progress: list[tuple[str, float]] = []
        self.failures: list[str] = []
        self.git_log: list[dict] = []
        self.requests: list[tuple[str, str, int]] = []
        self.events: list[str] = []
        self.inv_seq = 0
        self.base = self.sprout = ""
        self.task: dict[str, dict] = {}
        self.t0 = time.monotonic()
        self.conflicts = 0
        self.aborted: str | None = None
        self.rejected: list[str] = []

    # ---- server ---------------------------------------------------------------------------------------

    def start(self) -> str:
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args) -> None:  # quiet
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
        if self.server:
            self.server.shutdown()
            self.server.server_close()

    def fail(self, msg: str) -> None:
        with self.cv:
            self.failures.append(msg)

    def dispatch(self, h: BaseHTTPRequestHandler) -> None:
        url = urllib.parse.urlsplit(h.path)
        body = self.read_body(h)
        try:
            if url.path.startswith("/git/"):
                status = self.serve_git(h, url, body)
            else:
                status, payload = self.route(h, url, body)
                self.send_json(h, status, payload)
        except Exception as e:  # noqa: BLE001 - a fake bug must show up in the test, not hang it
            self.fail(f"fake gateway crashed on {h.command} {url.path}: {e!r}")
            status = 500
            self.send_json(h, 500, {"error": {"code": "fake_crash", "message": repr(e)}})
        with self.cv:
            self.requests.append((h.command, url.path, status))

    @staticmethod
    def read_body(h: BaseHTTPRequestHandler) -> bytes:
        if h.headers.get("Transfer-Encoding", "").lower() == "chunked":
            out = b""
            while True:
                size = int(h.rfile.readline().strip().split(b";")[0], 16)
                if size == 0:
                    h.rfile.readline()
                    return out
                out += h.rfile.read(size)
                h.rfile.readline()
        n = int(h.headers.get("Content-Length") or 0)
        return h.rfile.read(n) if n else b""

    @staticmethod
    def bearer(h: BaseHTTPRequestHandler) -> str | None:
        auth = h.headers.get("Authorization") or ""
        scheme, _, value = auth.partition(" ")
        if scheme.lower() == "bearer":
            return value.strip() or None
        if scheme.lower() == "basic":
            try:
                return base64.b64decode(value).decode().partition(":")[2] or None
            except ValueError:
                return None
        return None

    @staticmethod
    def err(status: int, code: str, message: str) -> tuple[int, dict]:
        return status, {"error": {"code": code, "message": message}}

    # ---- routes ---------------------------------------------------------------------------------------

    def route(self, h: BaseHTTPRequestHandler, url, body: bytes) -> tuple[int, object]:
        path, token = url.path, self.bearer(h)
        if path == "/healthz":
            return 200, {"ok": True}
        m = re.fullmatch(r"/v1/runs(?:/([^/]+))?(/.*)?", path)
        if not m:
            return self.err(404, "not_found", path)
        run, rest = m.group(1), m.group(2) or ""
        if run is None:
            if token != self.admin:
                return self.err(401, "unauthorized", "missing or invalid credentials")
            return self.create(json.loads(body or b"{}"))
        if not re.fullmatch(r"[a-z0-9]{6,24}", run):
            if token != self.admin:
                return self.err(401, "unauthorized", "missing or invalid credentials")
            return self.err(400, "invalid_request", "invalid run id")
        if run != self.run:
            return self.err(404, "not_found", f"no run {run}")
        driver = re.fullmatch(r"/agents/(a\d+)/next|/invocations/([^/]+)/(result|progress)", rest)
        if driver:
            return self.driver(h, token, driver, json.loads(body or b"{}"))
        if rest in ("", "/summary", "/events"):
            if token not in (self.admin, self.view):
                return self.err(401, "unauthorized", "missing or invalid credentials")
            if rest == "/summary":
                return 200, self.summary()
            if rest == "/events":
                q = urllib.parse.parse_qs(url.query)
                after, limit = int(q.get("after", ["0"])[0]), int(q.get("limit", ["5000"])[0])
                with self.cv:
                    page = [e for e in self.events if json.loads(e)["seq"] > after][:min(limit, self.page_limit)]
                if q.get("format", ["json"])[0] == "jsonl":
                    return 200, {"__raw__": "".join(p + "\n" for p in page)}
                return 200, {"events": [json.loads(p) for p in page], "done": self.phase == "done"}
            return 200, {"run": self.run, "phase": self.phase}
        if token != self.admin:
            return self.err(401, "unauthorized", "missing or invalid credentials")
        if rest == "/seed-token":
            self.seed = "bst1.seed." + secrets.token_hex(12)
            return 200, {"repo": f"race-{run}", "push_url": f"{self.url}/git/{NS}/race-{run}.git",
                         "token": self.seed, "expires_at": "2099-01-01T00:00:00Z", "refs": [SPROUT, STALK]}
        if rest == "/start":
            return self.start_run()
        if rest == "/stop":
            with self.cv:
                self.finish(json.loads(body or b"{}").get("reason") or "stopped by admin")
            return 200, {"run": run, "phase": self.phase}
        if rest == "/tokens":
            with self.cv:
                for slot in self.tokens:
                    self.rotate(slot)
                    self.tokens[slot] = self.refresh.pop(slot)
                return 200, {"run": run, "slots": [{"slot": s, "token": t, "expires_at": "2099-01-01T00:00:00Z"}
                                                   for s, t in self.tokens.items()]}
        return self.err(404, "not_found", rest)

    def send_json(self, h: BaseHTTPRequestHandler, status: int, payload: object) -> None:
        if isinstance(payload, dict) and "__raw__" in payload:
            return FakeGateway._send(h, status, payload["__raw__"], "application/x-ndjson")
        return FakeGateway._send(h, status, json.dumps(payload), "application/json")

    @staticmethod
    def _send(h, status: int, text: str, ctype: str) -> None:
        data = text.encode()
        h.send_response(status)
        h.send_header("Content-Type", ctype)
        h.send_header("Content-Length", str(len(data)))
        h.end_headers()
        h.wfile.write(data)

    # ---- admin --------------------------------------------------------------------------------------------

    def create(self, config: dict) -> tuple[int, dict]:
        unknown = sorted(set(config) - RUN_CONFIG_KEYS)
        if unknown:
            return self.err(400, "invalid_request", f"unknown keys {unknown}")
        if config.get("policy") not in ("queue", "beanstalk-v2") or not config.get("tasks"):
            return self.err(400, "invalid_request", "policy and tasks are required")
        with self.cv:
            self.reset()
            self.config = config
            self.run = "fk" + secrets.token_hex(4)
            self.phase = "created"
            git(self.root, "init", "-q", "--bare", self.repo_path(f"race-{self.run}"))
            for i in range(int(config.get("agents", 4))):
                self.tokens[f"a{i}"] = f"bst1.slot-a{i}." + secrets.token_hex(12)
            self.view = "bst1.view." + secrets.token_hex(12)
        repo = f"race-{self.run}"
        return 201, {"run": self.run, "policy": config["policy"], "agents": len(self.tokens),
                     "repo": {"name": repo, "url": f"{self.url}/git/{NS}/{repo}.git", "sprout": SPROUT, "stalk": STALK},
                     "slots": [{"slot": s, "token": t, "expires_at": "2099-01-01T00:00:00Z"}
                               for s, t in self.tokens.items()],
                     "view": {"token": self.view, "expires_at": "2099-01-01T00:00:00Z",
                              "live_url": f"{self.url}/runs/{self.run}?key={self.view}",
                              "events_url": f"{self.url}/v1/runs/{self.run}/events?key={self.view}"}}

    def start_run(self) -> tuple[int, dict]:
        repo = self.repo_path(f"race-{self.run}")
        refs = {ref: git(repo, "rev-parse", "--verify", "--quiet", ref, check=False).stdout.strip()
                for ref in (SPROUT, STALK)}
        if not all(refs.values()) or len(set(refs.values())) != 1:
            return self.err(409, "repo_not_seeded", f"refs {refs}")
        with self.cv:
            if self.phase != "created":
                return self.err(409, "invalid_state", f"run is {self.phase}")
            self.phase = "running"
            self.base = self.sprout = refs[SPROUT]
            cfg = self.config
            self.emit("race.setup", policy="beanstalk", out=f"cloud:{self.run}", repo=f"race-{self.run}",
                      arena=cfg.get("arena"), arena_digest=cfg.get("arena_digest"), setup_seconds=self.now())
            for t in cfg["tasks"]:
                fp = (cfg.get("footprints") or {}).get(t["id"]) or {}
                self.emit("footprint.predicted", task=t["id"], method=fp.get("method"), selected=fp.get("selected"),
                          probs=fp.get("probs"))
            self.emit("race.start", policy="beanstalk", agent=cfg["agent"], model=cfg.get("model"),
                      agents=cfg["agents"], ci_seconds=cfg.get("ci_seconds"), ci_slots=cfg.get("ci_slots"),
                      batch=cfg.get("batch"), tasks=[t["id"] for t in cfg["tasks"]], budget_usd=cfg.get("budget_usd"),
                      seed=cfg.get("seed"), base=self.base, union_merge=True, snapshot="head", queue_hold=True,
                      protect_tests="landed", footprint=cfg.get("footprint"), error_budget=999, intake_seconds=0.0)
            for i, t in enumerate(cfg["tasks"]):
                self.start_task(f"a{i}", t)
            self.cv.notify_all()
        return 200, {"run": self.run, "phase": "running", "base_sha": self.base}

    def start_task(self, slot: str, t: dict) -> None:
        tid = t["id"]
        bean = self.repo_path(f"race-{self.run}-{tid}")
        git(self.root, "init", "-q", "--bare", bean)  # the fork: the run repo's lines, as the runner's fork job
        git(bean, "fetch", "-q", self.repo_path(f"race-{self.run}"), f"+{SPROUT}:{SPROUT}", f"+{STALK}:{STALK}")
        self.task[tid] = {"def": t, "slot": slot, "base": self.sprout, "head": None, "merged": self.sprout,
                          "status": "running", "reworks": 0, "conflicts": 0, "invs": [], "started": self.now()}
        self.holding[slot] = tid
        self.emit("task.start", task=tid, agent=slot, base=self.sprout, predicted=[])
        self.issue(slot, tid, "initial", prompt=f"{t['title']}\n\n{t['prompt']}\n", merge=None,
                   replay={"reset_to": None, "check": None, "fixes": []}, protect=[])

    def issue(self, slot: str, tid: str, kind: str, *, prompt: str, merge: dict | None, replay: dict,
              protect: list) -> None:
        self.inv_seq += 1
        inv = f"inv{self.inv_seq:04d}-{kind}"
        st = self.task[tid]
        t = st["def"]
        self.outbox[slot] = {
            "inv": inv, "kind": kind, "task": tid, "slot": slot, "attempt": max(1, st["reworks"]),
            "prompt": prompt, "resume": None, "adapter": self.config["agent"], "model": self.config.get("model"),
            "max_turns": self.config.get("max_turns", 40), "timeout_seconds": self.config.get("agent_timeout", 900),
            "budget_cap_usd": 3, "replay": replay,
            "workspace": {"bean": f"race-{self.run}-{tid}", "bean_url": f"{self.url}/git/{NS}/race-{self.run}-{tid}.git",
                          "repo_url": f"{self.url}/git/{NS}/race-{self.run}.git", "branch": f"task/{tid}",
                          "base_sha": st["base"], "head_sha": st["head"], "merge": merge,
                          "acceptance": t["acceptance_tests"], "protect": protect,
                          "union_paths": ["CHANGELOG.md", "CHANGELOG*.md", "**/CHANGELOG.md"],
                          "commit_message": f"{t['title']}\n\nTask: {tid}\nKind: {kind}\nInvocation: {inv}\n"}}

    def rotate(self, slot: str) -> None:
        """Hand the slot a fresh token with its next reply; the old one is refused from then on."""
        self.refresh[slot] = f"bst1.slot-{slot}-r." + secrets.token_hex(12)

    # ---- driver routes --------------------------------------------------------------------------------------

    def slot_of(self, token: str | None) -> str | None:
        return next((s for s, t in self.tokens.items() if t == token), None)

    def driver(self, h, token: str | None, m, body: dict) -> tuple[int, object]:
        slot = self.slot_of(token)
        if slot is None:
            if token in self.retired:
                self.fail(f"{h.command} {h.path} used a retired token")
            return self.err(401, "unauthorized", "run token invalid")
        if m.group(1):
            if m.group(1) != slot:
                return self.err(403, "forbidden", f"this token belongs to slot {slot}")
            return self.poll(slot)
        inv, what = m.group(2), m.group(3)
        if what == "progress":
            with self.cv:
                self.progress.append((inv, float(body.get("cost_usd", -1))))
                if self.abort_on_progress and self.phase == "running":  # the budget is spent mid-invocation
                    self.finish(f"budget: ${body.get('cost_usd'):.2f} of $0.01 (mid-invocation)")
                return 200, ({"abort": True, "reason": self.aborted} if self.aborted else {"abort": False})
        return self.result(slot, inv, body)

    def poll(self, slot: str) -> tuple[int, dict]:
        deadline = time.monotonic() + self.poll_seconds
        with self.cv:
            while True:
                if self.phase == "done":
                    return 200, {"done": True, "aborted": None}
                inv = self.outbox.pop(slot, None) if self.phase == "running" else None
                if inv:
                    self.open[inv["inv"]] = inv
                    self.emit("invocation.start", inv=inv["inv"], kind=inv["kind"], task=inv["task"], agent=slot,
                              adapter=inv["adapter"], model=inv["model"], attempt=inv["attempt"], resume=None,
                              cwd=f"work/agents/{inv['task']}", budget_cap_usd=3)
                    reply: dict = {"invocation": inv}
                    if slot in self.refresh:
                        self.retired.add(self.tokens[slot])
                        self.tokens[slot] = self.refresh.pop(slot)
                        reply["token"] = {"token": self.tokens[slot], "expires_at": "2099-01-01T00:00:00Z"}
                    return 200, reply
                left = deadline - time.monotonic()
                if left <= 0:
                    return 200, {"wait": True}
                self.cv.wait(left)

    def result(self, slot: str, inv_id: str, body: dict) -> tuple[int, dict]:
        with self.cv:
            if self.reject_first_result and not self.rejected and inv_id in self.open:
                self.rejected.append(inv_id)  # a field the gateway's schema refuses
                return self.err(422, "invalid_request", "init: expected record")
            inv = self.open.pop(inv_id, None)
            if inv is None:
                return self.err(409, "closed_invocation", f"{inv_id} already ended")
            if inv["slot"] != slot:
                self.fail(f"{inv_id} posted by {slot}")
            self.results[inv_id] = body
            self.check_result(inv, body)
            tid, st = inv["task"], self.task[inv["task"]]
            st["invs"].append(inv_id)
            ev = {k: body.get(k) for k in ("ok", "infra_error", "timed_out", "exit_code", "subtype", "is_error",
                                           "cost_usd", "cost_source", "num_turns", "wall_ms", "session_id")}
            self.emit("invocation.end", inv=inv_id, kind=inv["kind"], task=tid, agent=slot,
                      spent_usd=round(sum(r.get("cost_usd", 0) for r in self.results.values()), 4), **ev)
            if body.get("head_sha") and not body.get("markers_left"):
                st["head"] = body["head_sha"]
                if inv["workspace"]["merge"]:
                    st["merged"] = inv["workspace"]["merge"]["sha"]
                self.emit("task.commit", task=tid, sha=body["head_sha"], kind=inv["kind"],
                          new_commit=body.get("new_commit"), files=body.get("files"))
                self.land(slot, tid, inv)
            else:
                self.fail(f"{inv_id}: no commit (head {body.get('head_sha')}, markers {body.get('markers_left')}, "
                          f"infra {body.get('infra_error')})")
                self.finish("the scripted run expected a commit")
            self.cv.notify_all()
        return 200, {"accepted": True}

    def check_result(self, inv: dict, body: dict) -> None:
        name, ws = inv["inv"], inv["workspace"]
        unknown = sorted(set(body) - RESULT_KEYS)
        if unknown:
            self.fail(f"{name}: unknown result keys {unknown}")
        for key in ("ok", "cost_usd", "subtype", "wall_ms", "files", "tamper", "markers_left"):
            if key not in body:
                self.fail(f"{name}: result lacks {key}")
        head = body.get("head_sha")
        if head is None:
            return
        if not SHA.match(head):
            self.fail(f"{name}: head_sha {head!r} is not a sha")
            return
        bean = self.repo_path(ws["bean"])
        pushed = git(bean, "rev-parse", "--verify", "--quiet", f"refs/heads/{ws['branch']}", check=False).stdout.strip()
        if pushed != head:
            self.fail(f"{name}: {ws['branch']} on the bean is {pushed or 'missing'}, the result says {head}")
            return
        if body.get("pushed_ref") != f"refs/heads/{ws['branch']}":
            self.fail(f"{name}: pushed_ref {body.get('pushed_ref')}")
        msg = git(bean, "log", "-1", "--format=%B", head).stdout.strip()
        if msg != ws["commit_message"].strip():
            self.fail(f"{name}: commit message {msg!r}")
        parents = git(bean, "rev-list", "--parents", "-n", "1", head).stdout.split()[1:]
        want = [ws["head_sha"] or ws["base_sha"]] + ([ws["merge"]["sha"]] if ws["merge"] else [])
        if parents != want:
            self.fail(f"{name}: parents {parents}, expected {want}")
        changed = sorted(git(bean, "diff", "--name-only", ws["base_sha"], head).stdout.split())
        if sorted(body.get("files") or []) != changed:
            self.fail(f"{name}: files {body.get('files')} != {changed}")
        for path, content in ws["acceptance"].items():
            got = git(bean, "show", f"{head}:{path}", check=False).stdout
            if got != content:
                self.fail(f"{name}: acceptance test {path} not committed intact")

    def land(self, slot: str, tid: str, inv: dict) -> None:
        """Squash the bean onto the sprout (and promote it); a conflict sends a rework that merges the sprout."""
        st, run_repo = self.task[tid], self.repo_path(f"race-{self.run}")
        git(run_repo, "fetch", "-q", self.repo_path(inv["workspace"]["bean"]),
            f"+refs/heads/task/{tid}:refs/beanstalk/changes/{tid}")
        res = git(run_repo, "merge-tree", "--write-tree", "--name-only", "--no-messages",
                  f"--merge-base={st['merged']}", self.sprout, st["head"], check=False)
        lines = res.stdout.splitlines()
        if res.returncode == 0:
            new = git(run_repo, "commit-tree", lines[0], "-p", self.sprout,
                      input_text=f"{st['def']['title']}\n\nTask: {tid}\nPolicy: beanstalk\n").stdout.strip()
            git(run_repo, "update-ref", SPROUT, new, self.sprout)
            git(run_repo, "update-ref", STALK, new)
            files = sorted(git(run_repo, "diff", "--name-only", self.sprout, new).stdout.split())
            self.sprout = new
            st["status"], st["landed"] = "green", self.now()
            self.emit("land", task=tid, ticket=None, kind="task", sha=new, target="trunk",
                      trunk_idx=len([s for s in self.task.values() if s.get("landed")]) - 1, files=files,
                      unvalidated=0, prelanded=True)
            self.emit("green.promote", sha=new, trunk_idx=0, tasks=[tid])
            self.holding.pop(slot, None)
            if all(s["status"] == "green" for s in self.task.values()):
                self.finish(None)
            return
        if res.returncode != 1 or st["reworks"] >= 2:
            self.fail(f"{tid}: landing failed: {res.stderr.strip() or lines}")
            self.finish("landing failed")
            return
        files = sorted({ln.strip() for ln in lines[1:] if ln.strip()})
        st["reworks"] += 1
        st["conflicts"] += 1
        self.conflicts += 1
        self.emit("merge.conflict", task=tid, ticket=None, onto=self.sprout, files=files)
        self.emit("rework.start", task=tid, ticket=None, reason="conflict", conflicts=files, attempt=st["reworks"],
                  resumed=False)
        landed = [s["def"] for s in self.task.values() if s["status"] == "green"]
        protect = [{"path": p, "content": c} for t in landed for p, c in t["acceptance_tests"].items()]
        self.rotate(slot)
        self.issue(slot, tid, "rework", prompt=f"Your change could not be merged: the trunk moved on ({files}).\n",
                   merge={"sha": self.sprout, "ref": SPROUT, "conflicts": files},
                   replay={"reset_to": self.sprout, "check": "acceptance", "fixes": []}, protect=protect)

    def finish(self, aborted: str | None) -> None:
        if self.phase == "done":
            return
        self.aborted = aborted
        for inv in sorted(self.open):  # killed, as the gateway's shutdown does
            self.emit("invocation.end", inv=inv, kind=self.open[inv]["kind"], task=self.open[inv]["task"],
                      agent=self.open[inv]["slot"], ok=False, killed=True, cost_usd=0, cost_source="none")
        self.open.clear()
        self.emit("race.end", aborted=aborted, killed_processes=0,
                  spent_usd=round(sum(r.get("cost_usd", 0) for r in self.results.values()), 4))
        self.emit("final.check", sha=self.sprout, suite_green=True, suite_tests=0, suite_failures=0,
                  acceptance_run_green=True, tasks_accepted=len(self.task), tasks_total=len(self.task),
                  green_tasks_accepted=len(self.task), green_tasks=len(self.task), correct=aborted is None,
                  all_tasks_accepted=aborted is None, failing_files=[], base_tests_changed=[])
        self.phase = "done"
        self.cv.notify_all()

    # ---- git proxy --------------------------------------------------------------------------------------------

    def repo_path(self, name: str) -> str:
        return os.path.join(self.root, f"{name}.git")

    def serve_git(self, h, url, body: bytes) -> int:
        m = re.fullmatch(rf"/git/{NS}/([^/]+)\.git/(.*)", url.path)
        token = self.bearer(h)
        if not m:
            return self.git_refuse(h, 404, "not a git path")
        repo, rest = m.group(1), m.group(2)
        service = (urllib.parse.parse_qs(url.query).get("service", [""])[0] or rest)
        write = service == "git-receive-pack"
        principal, refs = self.git_access(token, repo, write)
        with self.cv:
            self.git_log.append({"repo": repo, "service": service, "principal": principal, "ok": refs is not None})
        if refs is None:
            if token is None:
                return self.git_refuse(h, 401, "a run token is required", challenge=True)
            self.fail(f"git {service} on {repo} refused for {principal}")
            return self.git_refuse(h, 403, f"{principal} may not {'push' if write else 'read'} {repo}")
        if self.broken_bean_reads and rest == "git-upload-pack" and repo != f"race-{self.run}":
            data = b"Internal Server Error"
            h.send_response(500)
            h.send_header("Content-Type", "text/plain; charset=UTF-8")
            h.send_header("Content-Length", str(len(data)))
            h.end_headers()
            h.wfile.write(data)
            return 500
        if rest == "git-receive-pack" and refs:
            for ref in push_refs(body):
                if ref not in refs:
                    self.fail(f"push of {ref} to {repo} by {principal}")
                    return self.git_refuse(h, 403, f"pushing {ref} is not allowed")
        env = dict(os.environ, GIT_PROJECT_ROOT=self.root, GIT_HTTP_EXPORT_ALL="1", PATH_INFO=f"/{repo}.git/{rest}",
                   REQUEST_METHOD=h.command, QUERY_STRING=url.query, REMOTE_USER=principal, REMOTE_ADDR="127.0.0.1",
                   CONTENT_TYPE=h.headers.get("Content-Type", ""), CONTENT_LENGTH=str(len(body)))
        if h.headers.get("Content-Encoding"):
            env["HTTP_CONTENT_ENCODING"] = h.headers["Content-Encoding"]
        if h.headers.get("Git-Protocol"):
            env["GIT_PROTOCOL"] = h.headers["Git-Protocol"]
        proc = subprocess.run(["git", "http-backend"], input=body, capture_output=True, env=env)
        head, _, payload = proc.stdout.partition(b"\r\n\r\n")
        if not _:
            head, _, payload = proc.stdout.partition(b"\n\n")
        status, headers = 200, []
        for line in head.decode(errors="replace").splitlines():
            k, _, v = line.partition(":")
            if k.lower() == "status":
                status = int(v.strip().split()[0])
            elif k:
                headers.append((k.strip(), v.strip()))
        h.send_response(status)
        for k, v in headers:
            h.send_header(k, v)
        h.send_header("Content-Length", str(len(payload)))
        h.end_headers()
        h.wfile.write(payload)
        return status

    def git_access(self, token: str | None, repo: str, write: bool) -> tuple[str, list[str] | None]:
        """(principal, refs a push may update, [] for a read) or (principal, None) when refused."""
        with self.cv:
            run_repo = f"race-{self.run}"
            if token is not None and token == self.seed:
                ok = repo == run_repo and (not write or self.phase == "created")
                return "seed", ([SPROUT, STALK] if write else []) if ok else None
            slot = self.slot_of(token)
            if slot is None:
                return ("retired" if token in self.retired else "anonymous"), None
            if repo == run_repo:
                return slot, None if write else []
            tid = repo[len(run_repo) + 1:] if repo.startswith(run_repo + "-") else None
            if tid is None or self.holding.get(slot) != tid:
                return slot, None
            return slot, [f"refs/heads/task/{tid}"] if write else []

    @staticmethod
    def git_refuse(h, status: int, text: str, challenge: bool = False) -> int:
        data = text.encode()
        h.send_response(status)
        if challenge:
            h.send_header("WWW-Authenticate", 'Basic realm="beanstalk"')
        h.send_header("Content-Type", "text/plain")
        h.send_header("Content-Length", str(len(data)))
        h.end_headers()
        h.wfile.write(data)
        return status

    # ---- events and summary -----------------------------------------------------------------------------------

    def now(self) -> float:
        return round(time.monotonic() - self.t0, 3)

    def emit(self, typ: str, **fields) -> None:
        ev = {"seq": len(self.events) + 1, "t": self.now(),
              "ts": dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds"), "type": typ, **fields}
        self.events.append(json.dumps(ev))

    def summary(self) -> dict:
        with self.cv:
            cfg, tasks = self.config, self.task
            green = [t for t in tasks.values() if t["status"] == "green"]
            kinds: dict[str, int] = {}
            for inv in self.results:
                kind = inv.split("-", 1)[1]
                kinds[kind] = kinds.get(kind, 0) + 1
            cost = round(sum(r.get("cost_usd", 0) for r in self.results.values()), 4)
            wall = self.now()
            return {
                "label": f"measured: arena=arena@{self.base[:8]}/{str(cfg.get('arena_digest'))[:8]}, {len(tasks)} tasks, "
                         "policy=beanstalk, agent=replay (replay control: reference patches, synthetic timings)",
                "policy": "beanstalk", "agent": cfg.get("agent"), "model": cfg.get("model"), "arena_base": self.base,
                "arena_digest": cfg.get("arena_digest"),
                "config": {"agents": cfg.get("agents"), "ci_seconds": cfg.get("ci_seconds"),
                           "ci_slots": cfg.get("ci_slots"), "batch": None, "seed": cfg.get("seed"),
                           "budget_usd": cfg.get("budget_usd"), "max_turns": cfg.get("max_turns"),
                           "agent_timeout": cfg.get("agent_timeout"), "union_merge": True, "snapshot": "head",
                           "queue_hold": None, "error_budget": 999, "footprint": cfg.get("footprint"),
                           "tasks": len(tasks), "protect_tests": "landed"},
                "aborted": self.aborted, "wall_seconds": wall, "tasks": len(tasks),
                "tasks_green": len(green), "tasks_landed": len(green), "tasks_dropped": 0,
                "acceptance_restored": {"own": 0, "other_tasks": 0}, "drops_by_reason": {},
                "changes_green_per_hour": round(len(green) / (wall / 3600), 3) if wall else None,
                "wall_to_all_green_seconds": wall if len(green) == len(tasks) else None,
                "task_start_to_green_seconds": {"median": 1.0, "p90": 1.0, "mean": 1.0},
                "agent_minutes": {"busy": 0.1, "blocked": 0.0, "idle": 0.0},
                "agent_minutes_per_agent": {}, "invocations": kinds, "invocation_stats": {}, "cost_usd": cost,
                "cost_by_kind": {k: 0.0 for k in kinds}, "tokens_by_kind": {}, "invocation_overhead": {},
                "subscription": {}, "ci_runs": {}, "ci_runs_total": 0, "ci_minutes": {}, "ci_minutes_total": 0,
                "textual_conflicts": self.conflicts, "red_validations": 0,
                "final": {"sha": self.sprout, "suite_green": True, "tasks_accepted": len(tasks),
                          "tasks_total": len(tasks), "correct": True, "all_tasks_accepted": True,
                          "base_tests_changed": []},
                "footprint_quality": {"method": cfg.get("footprint"), "threshold": cfg.get("footprint_threshold"),
                                      "vs_actual": {}, "vs_oracle": {}},
                "per_task": {tid: {"status": st["status"], "agent": st["slot"], "started_at": st["started"],
                                   "landed_at": st.get("landed"), "green_at": st.get("landed"),
                                   "reworks": st["reworks"], "conflicts": st["conflicts"], "reds": 0,
                                   "predicted": [], "actual_modules": [], "oracle_modules": [],
                                   "invocations": len(st["invs"]), "drop_reason": None, "tamper": [],
                                   "final_acceptance": True} for tid, st in tasks.items()},
                "beanstalk": {"variant": "v2"}, "policy_rows": [["Variant", "v2 (fake gateway)"]],
            }
