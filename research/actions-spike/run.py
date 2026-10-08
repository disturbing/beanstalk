#!/usr/bin/env python3
"""Drive the beanstalk-actions-spike Worker: send a workflow + event payload, stream act's output.

    SPIKE_URL=https://beanstalk-actions-spike.<sub>.workers.dev SPIKE_TOKEN_FILE=… \
      python3 run.py workflows/deploy-shape.yml --instance a --log out/deploy.log [--event-name push]
      [--extra .github/race/package.json=../real-arena/fastify/deps/package.json] [--arg=--foo]
      [--secret-file secrets.env] [--event-json '{"spike": {...}}']
    python3 run.py --exec 'df -h /' --instance a
    python3 run.py --health --instance a

Prints act's output as it arrives, then one JSON line: first-byte and total wall time seen by the
client. Secrets are read from a file and sent in the body only; they are never printed.
"""
import argparse
import json
import os
import sys
import time
import urllib.request

UA = "beanstalk-actions-spike/1"  # urllib's default UA is refused (403) by the edge


def token() -> str:
    path = os.environ.get("SPIKE_TOKEN_FILE")
    return open(path).read().strip() if path else os.environ["SPIKE_TOKEN"]


def post(path: str, instance: str, body: dict | None, log_path: str | None) -> dict:
    url = f"{os.environ['SPIKE_URL']}{path}?instance={instance}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if data else "GET",
                                 headers={"user-agent": UA, "authorization": f"Bearer {token()}", "content-type": "application/json"})
    t0 = time.time()
    first = None
    pending = ""
    out = open(log_path, "w") if log_path else None
    with urllib.request.urlopen(req, timeout=3600) as res:
        while True:
            chunk = res.read1(65536)
            if not chunk:
                break
            if first is None:
                first = time.time() - t0
            text = chunk.decode("utf-8", "replace")
            sys.stdout.write(text)
            sys.stdout.flush()
            if out:
                # The log file gets each line stamped with seconds since the request was sent.
                pending += text
                *lines, pending = pending.split("\n")
                for line in lines:
                    out.write(f"[{time.time() - t0:7.2f}] {line}\n")
    if out:
        out.write(pending)
        out.close()
    return {"first_byte_s": round(first or 0, 3), "total_s": round(time.time() - t0, 3)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("workflow", nargs="?")
    ap.add_argument("--instance", default="a")
    ap.add_argument("--event-name", default="push")
    ap.add_argument("--event-json", default=None)
    ap.add_argument("--job")
    ap.add_argument("--extra", action="append", default=[], help="repo-path=local-path")
    ap.add_argument("--arg", action="append", default=[], help="extra act argument")
    ap.add_argument("--env", action="append", default=[], help="NAME=value for act's process")
    ap.add_argument("--secret-file")
    ap.add_argument("--origin", help="origin remote of the job's repo (act's GITHUB_REPOSITORY)")
    ap.add_argument("--log")
    ap.add_argument("--exec")
    ap.add_argument("--exec-file", help="a local shell script to run in the container")
    ap.add_argument("--health", action="store_true")
    ap.add_argument("--timeout-s", type=int, default=1800)
    ns = ap.parse_args()
    if ns.health:
        t0 = time.time()
        req = urllib.request.Request(f"{os.environ['SPIKE_URL']}/health?instance={ns.instance}",
                                     headers={"user-agent": UA, "authorization": f"Bearer {token()}"})
        with urllib.request.urlopen(req, timeout=600) as res:
            inner = json.load(res)
        print(json.dumps({"instance": ns.instance, "client_s": round(time.time() - t0, 3), **inner}))
        return
    if ns.exec_file:
        ns.exec = open(ns.exec_file).read()
    if ns.exec:
        print(json.dumps(post("/exec", ns.instance, {"cmd": ns.exec, "timeout_s": ns.timeout_s}, ns.log)))
        return
    name = os.path.basename(ns.workflow)
    files = {f".github/workflows/{name}": open(ns.workflow).read()}
    for spec in ns.extra:
        dest, src = spec.split("=", 1)
        files[dest] = open(src).read()
    event = {
        "ref": "refs/heads/main",
        "repository": {"full_name": "spike/actions", "name": "actions", "owner": {"login": "spike"},
                       "default_branch": "main"},
        "head_commit": {"message": "spike run"},
        "pusher": {"name": "spike"},
    }
    if ns.event_json:
        event.update(json.loads(ns.event_json))
    secrets = {}
    if ns.secret_file:
        for line in open(ns.secret_file):
            if "=" in line:
                k, v = line.rstrip("\n").split("=", 1)
                secrets[k] = v
    body = {"files": files, "event": event, "event_name": ns.event_name, "job": ns.job, "args": ns.arg,
            "secrets": secrets, "origin": ns.origin, "env": dict(e.split("=", 1) for e in ns.env), "timeout_s": ns.timeout_s}
    print(json.dumps(post("/run", ns.instance, body, ns.log)))


if __name__ == "__main__":
    main()
