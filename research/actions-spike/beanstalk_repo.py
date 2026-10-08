#!/usr/bin/env python3
"""Throwaway Beanstalk repository for the actions spike, through the live gateway's admin API.

    python3 beanstalk_repo.py open  --import-url https://github.com/fastify/fastify
    python3 beanstalk_repo.py token --out <0600 secrets file>   # writes BEANSTALK_READ_TOKEN=…
    python3 beanstalk_repo.py close                             # closes the engine, deletes the repo

ADMIN_TOKEN is read from $ADMIN_DEV_VARS (the main checkout's packages/gateway/.dev.vars) and
never printed; the minted git token goes only into the --out file.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

GATEWAY = os.environ.get("GATEWAY", "https://beanstalk-gateway.devaccounts-1password.workers.dev")
NAME = "beanstalk-actions-spike-fastify"
OWNER = {"id": "beanstalk-actions-spike", "handle": "beanstalk-actions-spike"}


def admin_token() -> str:
    for line in open(os.environ["ADMIN_DEV_VARS"]):
        if line.startswith("ADMIN_TOKEN="):
            return line.split("=", 1)[1].strip().strip('"')
    raise SystemExit("no ADMIN_TOKEN")


def call(method: str, path: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(f"{GATEWAY}{path}", method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"authorization": f"Bearer {admin_token()}", "content-type": "application/json",
                                          "user-agent": "beanstalk-actions-spike/1"})
    try:
        with urllib.request.urlopen(req, timeout=600) as res:
            return json.load(res)
    except urllib.error.HTTPError as error:
        raise SystemExit(f"{method} {path}: {error.code} {error.read().decode()[:500]}")


def engine_id() -> str:
    return open(os.environ.get("ENGINE_FILE", "/tmp/beanstalk-actions-spike.engine")).read().strip()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["open", "token", "close"])
    ap.add_argument("--import-url")
    ap.add_argument("--out")
    ns = ap.parse_args()
    if ns.cmd == "open":
        body = {"repoName": NAME, "artifactsRepo": NAME, "owner": OWNER,
                "import_url": ns.import_url, "create_artifacts_repo": ns.import_url is None}
        opened = call("POST", "/v1/repos", body)
        engine = opened.get("engineId") or opened.get("engine") or opened.get("run")
        with open(os.environ.get("ENGINE_FILE", "/tmp/beanstalk-actions-spike.engine"), "w") as fh:
            fh.write(str(engine))
        print(json.dumps({k: v for k, v in opened.items() if "token" not in k.lower()}))
    elif ns.cmd == "token":
        minted = call("POST", f"/v1/repos/{engine_id()}/git-token",
                      {"user": OWNER, "ttl_seconds": 7200})
        secret = minted.get("token")
        fd = os.open(ns.out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as fh:
            fh.write(f"BEANSTALK_READ_TOKEN={secret}\n")
        print(json.dumps({k: v for k, v in minted.items() if k != "token"}))
    else:
        print(json.dumps(call("POST", f"/v1/repos/{engine_id()}/close", {"delete_repo": True})))


if __name__ == "__main__":
    sys.exit(main())
