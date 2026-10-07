"""A local stand-in for the Artifacts git remotes, for the streaming-diffs end-to-end loop (``devstack.py``).

Smart HTTP at ``/git/<namespace>/<repo>.git/*`` through ``git http-backend`` over bare repos under ``--root``
(any bearer token is accepted: the gateway in front of it is what checks tokens), plus a small JSON admin API that
``fake-artifacts.js`` calls to implement the Artifacts binding's repo reads (create, log, trees, blobs, commits).
Stdlib only. Never part of a deployment.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = ""
SHA = re.compile(r"^[0-9a-f]{40}$")


def git(repo: str, *args: str, data: bytes | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "--git-dir", repo, *args], input=data, capture_output=True)


def repo_dir(name: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9._-]+", name):
        raise ValueError(name)
    return os.path.join(ROOT, f"{name}.git")


def resolve(repo: str, ref: str) -> str | None:
    target = ref if SHA.match(ref) else (ref if ref.startswith("refs/") else f"refs/heads/{ref}")
    out = git(repo, "rev-parse", "--verify", "-q", f"{target}^{{commit}}")
    return out.stdout.decode().strip() or None


def commit_meta(repo: str, sha: str) -> dict | None:
    out = git(repo, "show", "-s", "--format=%H%x00%T%x00%P%x00%an%x00%ae%x00%cn%x00%ce%x00%at%x00%ct%x00%B", sha)
    if out.returncode != 0:
        return None
    h, t, p, an, ae, cn, ce, at, ct, body = out.stdout.decode().split("\0", 9)
    return {"hash": h, "treeHash": t, "parents": p.split(), "author": {"name": an, "email": ae},
            "committer": {"name": cn, "email": ce}, "authoredAt": int(at), "committedAt": int(ct),
            "message": body.rstrip("\n")}


def tree_entries(repo: str, sha: str) -> list[dict] | None:
    out = git(repo, "ls-tree", sha)
    if out.returncode != 0:
        return None
    entries = []
    for line in out.stdout.decode().splitlines():
        meta, name = line.split("\t", 1)
        mode, kind, h = meta.split()
        kind = {"100755": "exec", "120000": "symlink", "160000": "gitlink"}.get(mode, kind)
        entries.append({"name": name, "mode": mode.lstrip("0") if mode == "040000" else mode, "hash": h,
                        "type": kind})
    return entries


IDENTITY = {"GIT_AUTHOR_NAME": "beanstalk", "GIT_AUTHOR_EMAIL": "runner@beanstalk.invalid",
            "GIT_COMMITTER_NAME": "beanstalk", "GIT_COMMITTER_EMAIL": "runner@beanstalk.invalid"}


def rgit(repo: str, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "--git-dir", repo, *args], capture_output=True, text=True,
                          env={**os.environ, **IDENTITY})


def runner(call: str, body: dict) -> tuple[int, dict]:
    """The runner container's git endpoints done for real on the local repos (squash, revert, update-ref); every
    check is green, as the gateway's test runner answers. ``repo`` is the remote URL the gateway hands out."""
    repo = repo_dir(body["repo"].rstrip("/").rsplit("/", 1)[-1].removesuffix(".git"))
    if call == "squash":
        change = body["change"]
        head = resolve(repo, change["ref"]) or ""
        base = rgit(repo, "merge-base", body["onto"], head).stdout.strip()
        merged = rgit(repo, "merge-tree", "--write-tree", "--name-only", body["onto"], head)
        if merged.returncode == 1:
            files = [p for p in merged.stdout.split("\n\n")[0].splitlines()[1:] if p]
            return 200, {"result": "conflict", "files": files, "merge_base": base}
        tree = merged.stdout.split()[0]
        sha = rgit(repo, "commit-tree", tree, "-p", body["onto"], "-m", body.get("message") or "squash").stdout.strip()
        files = rgit(repo, "diff", "--name-only", body["onto"], sha).stdout.split()
        out = {"result": "clean", "sha": sha, "files": files, "merge_base": base}
        if change.get("base"):
            out["change_files"] = rgit(repo, "diff", "--name-only", change["base"], head).stdout.split()
        return 200, out
    if call == "revert":
        parent = f"{body['commit']}^"
        merged = rgit(repo, "merge-tree", "--write-tree", "--merge-base", body["commit"], body["onto"], parent)
        if merged.returncode != 0:
            return 200, {"result": "conflict", "files": []}
        sha = rgit(repo, "commit-tree", merged.stdout.split()[0], "-p", body["onto"], "-m",
                   body.get("message") or "revert").stdout.strip()
        return 200, {"result": "clean", "sha": sha,
                     "files": rgit(repo, "diff", "--name-only", body["onto"], sha).stdout.split()}
    if call == "update-ref":
        ok = rgit(repo, "update-ref", body["ref"], body["new"], *([body["old"]] if body.get("old") else []))
        actual = resolve(repo, body["ref"])
        return 200, {"ok": ok.returncode == 0, "actual": actual}
    if call == "check" and os.environ.get("REMOTES_REAL_CHECKS") == "1":
        return 200, real_check(repo, body)
    if call == "check":
        extra = list((body.get("extra_files") or {}).keys())
        return 200, {"sha": body["sha"], "green": True, "tests": 1 + len(extra), "failures": 0, "failing_tests": [],
                     "failing_files": [], "passing_files": extra, "read_set": [], "read_sets": {}, "read_depths": {},
                     "stack_files": [], "output_excerpt": "", "suite_seconds": 0.05, "ci_seconds": 0.05,
                     "timed_out": False}
    return 404, {"code": "not_found", "message": call}


IMPORT = re.compile(r"""(?:require\(|from\s+|import\s*\()\s*['"](\.{1,2}/[^'"]+)['"]""")


def read_set(root: str, test: str) -> list[str]:
    """The test's static import closure through relative imports (what the runner computes)."""
    seen, todo = set(), [test]
    while todo:
        path = todo.pop()
        if path in seen or not os.path.isfile(os.path.join(root, path)):
            continue
        seen.add(path)
        text = open(os.path.join(root, path), encoding="utf-8", errors="replace").read()
        for spec in IMPORT.findall(text):
            target = os.path.normpath(os.path.join(os.path.dirname(path), spec))
            todo.extend([target, f"{target}.js"])
    return sorted(seen)


def real_check(repo: str, body: dict) -> dict:
    """Runs the suite for real (``REMOTES_REAL_CHECKS=1``): each ``*.test.js`` file alone with ``node --test``, on
    the commit's tree plus the extra files, so the red path of the git-native e2e is real."""
    import tempfile
    import time

    with tempfile.TemporaryDirectory() as root:
        archive = git(repo, "archive", body["sha"])
        subprocess.run(["tar", "-x", "-C", root], input=archive.stdout, check=True)
        for path, content in (body.get("extra_files") or {}).items():
            os.makedirs(os.path.dirname(os.path.join(root, path)) or root, exist_ok=True)
            open(os.path.join(root, path), "w", encoding="utf-8").write(content)
        tests = sorted(os.path.relpath(os.path.join(d, f), root) for d, _, fs in os.walk(root) for f in fs
                       if f.endswith(".test.js") and "node_modules" not in d)
        start, failing, passing, output = time.time(), [], [], []
        for test in tests:
            run = subprocess.run(["node", "--test", test], cwd=root, capture_output=True, text=True, timeout=120)
            (passing if run.returncode == 0 else failing).append(test)
            if run.returncode != 0:
                output.extend(line for line in run.stdout.splitlines() if "not ok" in line or "Error" in line
                              or "expected" in line or "actual" in line)
        sets = {test: read_set(root, test) for test in failing}
    return {"sha": body["sha"], "green": not failing, "tests": len(tests), "failures": len(failing),
            "failing_tests": [{"file": t, "name": t} for t in failing], "failing_files": failing,
            "passing_files": passing, "read_set": sorted({p for v in sets.values() for p in v}), "read_sets": sets,
            "read_depths": {}, "stack_files": [], "output_excerpt": "\n".join(output[-20:]),
            "suite_seconds": round(time.time() - start, 3), "ci_seconds": round(time.time() - start, 3),
            "timed_out": False}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args) -> None:
        pass

    def body(self) -> bytes:
        if "chunked" in (self.headers.get("Transfer-Encoding") or "").lower():  # the gateway streams pushes
            chunks = []
            while True:
                size = int(self.rfile.readline().split(b";")[0].strip() or b"0", 16)
                if size == 0:
                    while self.rfile.readline() not in (b"\r\n", b"\n", b""):
                        pass
                    return b"".join(chunks)
                chunks.append(self.rfile.read(size))
                self.rfile.readline()
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def send(self, status: int, data: bytes, ctype: str = "application/json", headers: list | None = None) -> None:
        self.send_response(status)
        for k, v in headers or []:
            self.send_header(k, v)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def json(self, status: int, value: object) -> None:
        self.send(status, json.dumps(value).encode())

    def do_GET(self) -> None:  # noqa: N802
        self.route()

    def do_POST(self) -> None:  # noqa: N802
        self.route()

    def do_DELETE(self) -> None:  # noqa: N802
        self.route()

    def route(self) -> None:
        url = urllib.parse.urlparse(self.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(url.query).items()}
        try:
            if url.path.startswith("/git/"):
                return self.serve_git(url)
            if url.path.startswith("/__admin/"):
                return self.admin(url.path[len("/__admin/"):], q)
            if url.path.startswith("/__runner/v1/"):
                return self.json(*runner(url.path[len("/__runner/v1/"):], json.loads(self.body() or b"{}")))
            self.json(404, {"error": "not found"})
        except ValueError as e:
            self.json(400, {"error": str(e)})

    def admin(self, what: str, q: dict) -> None:
        if what == "list":
            names = sorted(n[:-4] for n in os.listdir(ROOT) if n.endswith(".git"))
            return self.json(200, names)
        repo = repo_dir(q.get("name", ""))
        if what == "create":
            if os.path.exists(repo):
                return self.json(409, {"error": "exists"})
            subprocess.run(["git", "init", "-q", "--bare", "-b", q.get("branch", "main"), repo], check=True)
            git(repo, "config", "http.receivepack", "true")
            return self.json(200, {"ok": True})
        if not os.path.exists(repo):
            return self.json(404, {"error": "no such repo"})
        if what == "delete":
            shutil.rmtree(repo)
            return self.json(200, {"ok": True})
        if what == "log":
            start = resolve(repo, q["ref"])
            if start is None:
                return self.json(200, [])
            limit, skip = int(q.get("limit", "50")), int(q.get("offset", "0"))
            shas = git(repo, "rev-list", f"--max-count={limit}", f"--skip={skip}", start).stdout.decode().split()
            return self.json(200, [commit_meta(repo, s) for s in shas])
        if what == "commit":
            return self.json(200, commit_meta(repo, q["hash"]))
        if what == "tree":
            return self.json(200, tree_entries(repo, q["hash"]))
        if what == "blob":
            out = git(repo, "cat-file", "blob", q["hash"])
            return self.send(200, out.stdout, "application/octet-stream") if out.returncode == 0 else \
                self.json(404, {"error": "no such blob"})
        if what == "file":
            sha = resolve(repo, q["ref"])
            out = git(repo, "show", f"{sha}:{q['path']}") if sha else None
            return self.send(200, out.stdout, "application/octet-stream") if out and out.returncode == 0 else \
                self.json(404, {"error": "no such file"})
        self.json(404, {"error": f"unknown admin call {what}"})

    def serve_git(self, url) -> None:
        m = re.fullmatch(r"/git/[^/]+/([^/]+)\.git/(.*)", url.path)
        if not m:
            return self.json(404, {"error": "not a git path"})
        body = self.body()
        env = dict(os.environ, GIT_PROJECT_ROOT=ROOT, GIT_HTTP_EXPORT_ALL="1", PATH_INFO=f"/{m.group(1)}.git/{m.group(2)}",
                   REQUEST_METHOD=self.command, QUERY_STRING=url.query, REMOTE_USER="gateway",
                   REMOTE_ADDR="127.0.0.1", CONTENT_TYPE=self.headers.get("Content-Type", ""),
                   CONTENT_LENGTH=str(len(body)))
        for header, var in (("Content-Encoding", "HTTP_CONTENT_ENCODING"), ("Git-Protocol", "GIT_PROTOCOL")):
            if self.headers.get(header):
                env[var] = self.headers[header]
        proc = subprocess.run(["git", "http-backend"], input=body, capture_output=True, env=env)
        head, sep, payload = proc.stdout.partition(b"\r\n\r\n")
        if not sep:
            head, _, payload = proc.stdout.partition(b"\n\n")
        status, headers = 200, []
        for line in head.decode(errors="replace").splitlines():
            k, _, v = line.partition(":")
            if k.lower() == "status":
                status = int(v.strip().split()[0])
            elif k and k.lower() != "content-type":
                headers.append((k.strip(), v.strip()))
        ctype = next((ln.partition(":")[2].strip() for ln in head.decode(errors="replace").splitlines()
                      if ln.lower().startswith("content-type")), "application/octet-stream")
        self.send(status, payload, ctype, headers)


def main() -> None:
    global ROOT
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--port", type=int, default=8790)
    ns = ap.parse_args()
    ROOT = os.path.abspath(ns.root)
    os.makedirs(ROOT, exist_ok=True)
    ThreadingHTTPServer(("127.0.0.1", ns.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
