"""The git-native demo against a deployed gateway (staging), with a real git client and the real runner.

Opens a repository engine on a fresh Artifacts repo through the admin API, mints a git token, runs ``demo.sh`` (clone,
``git push -o wait`` that lands, a red push with the remote's verdict, a refused push to the sprout, status refs, the
fix that lands), then closes the engine and deletes the repo. The admin token is read from a ``.dev.vars`` file and
never printed; the git token reaches git only through its credential helper.

    python3 research/race/git_native/staging_e2e.py --gateway https://<staging gateway> \\
        --dev-vars <path>/packages/gateway/.dev.vars --web https://<staging web> --out transcript.txt

``--demo wait_demo.sh`` runs the waiting demo instead (two plain pushes, ``refs/wait/any`` woken by the first
verdict, a refused new commit to a bean in check, ``refs/wait/all`` re-attached to it).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))


def admin_token(dev_vars: str) -> str:
    for line in open(dev_vars, encoding="utf-8"):
        key, _, value = line.strip().partition("=")
        if key == "ADMIN_TOKEN":
            return value.strip().strip('"')
    raise SystemExit(f"no ADMIN_TOKEN in {dev_vars}")


def call(gateway: str, token: str, path: str, body: dict) -> dict:
    request = urllib.request.Request(f"{gateway}{path}", data=json.dumps(body).encode(), method="POST",
                                     headers={"authorization": f"Bearer {token}", "content-type": "application/json",
                                              "user-agent": "beanstalk-git-native-e2e"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read())


def engine_id(owner: str, repo: str) -> str:
    return "r" + hashlib.sha256(f"{owner.lower()}/{repo.lower()}".encode()).hexdigest()[:19]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gateway", required=True)
    ap.add_argument("--dev-vars", required=True)
    ap.add_argument("--web", default="")
    ap.add_argument("--out", required=True)
    ap.add_argument("--keep", action="store_true", help="keep the engine and its repo")
    ap.add_argument("--demo", default="demo.sh", help="the script to run in this directory (demo.sh, wait_demo.sh)")
    ns = ap.parse_args()
    token = admin_token(ns.dev_vars)
    owner, repo = "acme", f"gitnative-{secrets.token_hex(3)}"
    engine = engine_id(owner, repo)
    settings = {"bean_url": f"{ns.web}/runs/{engine}?bean={{bean}}"} if ns.web else {}
    opened = call(ns.gateway, token, "/v1/repos", {"repoName": repo, "artifactsRepo": f"repo-{repo}",
                                                   "owner": {"id": "u-acme", "handle": owner},
                                                   "create_artifacts_repo": True, "settings": settings})
    assert opened["engineId"] == engine, opened
    git_token = call(ns.gateway, token, f"/v1/repos/{engine}/git-token",
                     {"user": {"id": "u-demo", "handle": "demo"}, "ttl_seconds": 3600})["token"]
    url = f"{ns.gateway}{opened['git_path']}"
    started = time.time()
    try:
        with open(ns.out, "w", encoding="utf-8") as out:
            out.write(f"# staging: {ns.gateway} (real Artifacts, real runner containers)\n"
                      f"# {time.strftime('%Y-%m-%d %H:%M:%S %Z')}, engine {engine}, clone URL {url}\n")
            out.flush()
            result = subprocess.run([os.path.join(HERE, ns.demo)], stdout=out, stderr=subprocess.STDOUT,
                                    env={**os.environ, "BEANSTALK_GIT": url, "BEANSTALK_TOKEN": git_token},
                                    timeout=1800)
            out.write(f"\n# demo exit {result.returncode} after {time.time() - started:.0f} s\n")
    finally:
        if not ns.keep:
            closed = call(ns.gateway, token, f"/v1/repos/{engine}/close", {"delete_repo": True})
            with open(ns.out, "a", encoding="utf-8") as out:
                out.write(f"# engine closed and repo deleted: {json.dumps(closed)}\n")
    print(open(ns.out, encoding="utf-8").read())
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
