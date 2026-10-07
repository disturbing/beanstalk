"""The git-native flow end to end on this machine, with a real git client and real checks.

The real gateway Worker and engine Durable Object run under ``wrangler dev``; Artifacts is ``fake-artifacts.js`` over
real bare repos served by ``git http-backend`` (``stream_e2e/remotes.py``), and the runner is ``remotes.py`` doing real
squashes and, with ``REMOTES_REAL_CHECKS=1``, running each ``*.test.js`` with ``node --test`` on the merged tree. It
opens a repository engine through the admin API, mints a git token and runs ``demo.sh`` (clone, ``git push -o wait``,
a red push, a refused push, status refs), writing the transcript.

    python3 research/race/git_native/local_e2e.py [transcript.txt]
"""
from __future__ import annotations

import json
import os
import secrets
import signal
import subprocess
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "stream_e2e"))
os.environ.setdefault("STREAM_E2E_PORTS", "8898,8897,5491")
os.environ.setdefault("STREAM_E2E_SUFFIX", "-gitnative")

import devstack  # noqa: E402


def admin(path: str, body: dict) -> dict:
    request = urllib.request.Request(
        f"http://127.0.0.1:{devstack.GATEWAY_PORT}{path}", data=json.dumps(body).encode(), method="POST",
        headers={"authorization": f"Bearer {devstack.tokens()['ADMIN_TOKEN']}", "content-type": "application/json"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read())


def main() -> None:
    transcript = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "local-transcript.txt")
    configs = devstack.configure()
    logs = os.path.join(devstack.LOCAL, "logs")
    os.makedirs(logs, exist_ok=True)
    procs = []

    def start(name: str, argv: list[str], cwd: str, env: dict | None = None) -> None:
        out = open(os.path.join(logs, f"{name}.log"), "w", encoding="utf-8")
        procs.append(subprocess.Popen(argv, cwd=cwd, stdout=out, stderr=subprocess.STDOUT, start_new_session=True,
                                      env={**os.environ, **(env or {})}))

    try:
        start("git", [sys.executable, os.path.join(devstack.HERE, "remotes.py"), "--root",
                      os.path.join(devstack.LOCAL, "repos"), "--port", str(devstack.GIT_PORT)], devstack.HERE,
              {"REMOTES_REAL_CHECKS": "1"})
        start("gateway", ["npx", "wrangler", "dev", *configs, "--port", str(devstack.GATEWAY_PORT), "--ip",
                          "127.0.0.1", "--persist-to", os.path.join(devstack.LOCAL, "state")], devstack.GATEWAY)
        devstack.wait_for(f"http://127.0.0.1:{devstack.GATEWAY_PORT}/healthz")
        repo = f"demo{secrets.token_hex(3)}"
        opened = admin("/v1/repos", {"repoName": repo, "artifactsRepo": f"repo-{repo}",
                                     "owner": {"id": "u-acme", "handle": "acme"}, "create_artifacts_repo": True,
                                     "settings": {"bean_url": f"http://127.0.0.1:{devstack.WEB_PORT}/beans/{{bean}}"}})
        token = admin(f"/v1/repos/{opened['engineId']}/git-token",
                      {"user": {"id": "u-demo", "handle": "demo"}, "ttl_seconds": 3600})["token"]
        url = f"http://127.0.0.1:{devstack.GATEWAY_PORT}{opened['git_path']}"
        with open(transcript, "w", encoding="utf-8") as out:
            out.write(f"# local stack: gateway under wrangler dev, git http-backend, real node --test checks\n"
                      f"# engine {opened['engineId']}, clone URL {url}\n")
            out.flush()
            result = subprocess.run([os.path.join(HERE, "demo.sh")], stdout=out, stderr=subprocess.STDOUT,
                                    env={**os.environ, "BEANSTALK_GIT": url, "BEANSTALK_TOKEN": token}, timeout=900)
        print(open(transcript, encoding="utf-8").read())
        print(f"demo exit {result.returncode}; transcript {transcript}")
        sys.exit(result.returncode)
    finally:
        for p in procs:
            try:
                os.killpg(p.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass


if __name__ == "__main__":
    main()
