"""The streaming-diffs end-to-end loop on this machine, without Cloudflare: the real gateway Worker and RunDO
(``wrangler dev``), the real web app (``vite dev``), the real driver (``race.py --forge cloudflare``) and a real
``claude -p`` agent. Two bindings have no local simulator and are replaced, as the gateway's tests replace them:
Artifacts by ``fake-artifacts.js`` over real bare repos served by ``remotes.py``, and the runner container by
``local-runner.js``, which has ``remotes.py`` squash, revert and move refs for real (every check is green). The
driver -> gateway -> web streaming path is the production code.

    python3 stream_e2e/devstack.py up      # repos :8798, gateway :8797, web :5391; Ctrl-C stops all
    python3 stream_e2e/devstack.py env     # the variables a race against it needs

Generated configs, secrets and repos live in stream_e2e/.local/ (git-ignored) and packages/web/.wrangler/e2e/.
"""
from __future__ import annotations

import json
import os
import re
import secrets
import signal
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
GATEWAY = os.path.join(REPO, "packages", "gateway")
WEB = os.path.join(REPO, "packages", "web")
LOCAL = os.path.join(HERE, ".local")
WEB_LOCAL = os.path.join(WEB, ".wrangler", "e2e")
GIT_PORT, GATEWAY_PORT, WEB_PORT = 8798, 8797, 5391
E2E_GATEWAY = "beanstalk-gateway-e2e"


def jsonc(path: str) -> dict:
    text = open(path, encoding="utf-8").read()
    out, i = [], 0
    while i < len(text):
        c = text[i]
        if c == '"':
            j = i + 1
            while text[j] != '"':
                j += 2 if text[j] == "\\" else 1
            out.append(text[i:j + 1])
            i = j + 1
        elif text.startswith("//", i):
            i = text.find("\n", i)
        else:
            out.append(c)
            i += 1
    return json.loads(re.sub(r",(\s*[}\]])", r"\1", "".join(out)))


def write(path: str, value: object) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(value if isinstance(value, str) else json.dumps(value, indent=1))


def tokens() -> dict:
    path = os.path.join(LOCAL, "tokens.json")
    if not os.path.exists(path):
        write(path, {"ADMIN_TOKEN": secrets.token_urlsafe(24), "RUN_TOKEN_SECRET": secrets.token_urlsafe(32),
                     "DEMO_PASSWORD": secrets.token_urlsafe(12)})
    return json.load(open(path, encoding="utf-8"))


def configure() -> list[str]:
    """Writes the three Worker configs (gateway, local Artifacts, local runner) and the web app's; returns
    ``wrangler dev``'s -c arguments."""
    t = tokens()
    gw = jsonc(os.path.join(GATEWAY, "wrangler.jsonc"))
    for key in ("containers", "artifacts", "secrets", "$schema"):
        gw.pop(key, None)
    gw["main"] = os.path.join(GATEWAY, "src", "index.ts")
    gw["services"] = [{"binding": "ARTIFACTS", "service": "beanstalk-local-artifacts", "entrypoint": "LocalArtifacts"}]
    gw["durable_objects"]["bindings"] = [
        b if b["name"] != "RUNNER" else {"name": "RUNNER", "class_name": "LocalRunner",
                                         "script_name": "beanstalk-local-runner"}
        for b in gw["durable_objects"]["bindings"]]
    gw["vars"] = {**gw["vars"], "LOG_LEVEL": "warn"}
    gw["name"] = E2E_GATEWAY  # the local dev registry is machine-wide: never answer for another dev gateway
    write(os.path.join(LOCAL, "gateway", "wrangler.json"), gw)
    write(os.path.join(LOCAL, "gateway", ".dev.vars"),
          f"ADMIN_TOKEN={t['ADMIN_TOKEN']}\nRUN_TOKEN_SECRET={t['RUN_TOKEN_SECRET']}\n")
    write(os.path.join(LOCAL, "artifacts", "wrangler.json"), {
        "name": "beanstalk-local-artifacts", "main": os.path.join(HERE, "fake-artifacts.js"),
        "compatibility_date": gw["compatibility_date"], "vars": {"GIT_SERVER": f"http://127.0.0.1:{GIT_PORT}"}})
    write(os.path.join(LOCAL, "runner", "wrangler.json"), {
        "name": "beanstalk-local-runner", "main": os.path.join(HERE, "local-runner.js"),
        "compatibility_date": gw["compatibility_date"], "vars": {"GIT_SERVER": f"http://127.0.0.1:{GIT_PORT}"},
        "durable_objects": {"bindings": [{"name": "LOCAL_RUNNER", "class_name": "LocalRunner"}]},
        "migrations": [{"tag": "v1", "new_sqlite_classes": ["LocalRunner"]}]})
    web = jsonc(os.path.join(WEB, "wrangler.jsonc"))
    for key in ("ai", "secrets", "$schema"):
        web.pop(key, None)
    web["assets"]["directory"] = os.path.join(WEB, "dist", "client")
    web["vars"] = {**web["vars"], "PICKER": "rules", "ASK_CLASSIFIER": "keywords"}
    web["name"] = "beanstalk-web-e2e"
    web["services"] = [{"binding": "GATEWAY", "service": E2E_GATEWAY}]
    write(os.path.join(WEB_LOCAL, "wrangler.json"), web)
    write(os.path.join(WEB_LOCAL, ".dev.vars"), f"DEMO_PASSWORD={t['DEMO_PASSWORD']}\n")
    write(os.path.join(WEB_LOCAL, "vite.config.mjs"), f"""import {{ cloudflare }} from '@cloudflare/vite-plugin';
import vinext from 'vinext';
import {{ defineConfig }} from 'vite';

export default defineConfig({{
  root: {json.dumps(WEB)},
  server: {{ host: '127.0.0.1', port: {WEB_PORT}, strictPort: true }},
  plugins: [
    vinext(),
    cloudflare({{
      configPath: {json.dumps(os.path.join(WEB_LOCAL, "wrangler.json"))},
      remoteBindings: false,
      viteEnvironment: {{ name: 'rsc', childEnvironments: ['ssr'] }},
    }}),
  ],
}});
""")
    return ["-c", os.path.join(LOCAL, "gateway", "wrangler.json"), "-c", os.path.join(LOCAL, "artifacts", "wrangler.json"),
            "-c", os.path.join(LOCAL, "runner", "wrangler.json")]


def wait_for(url: str, seconds: float = 120) -> None:
    end = time.time() + seconds
    while time.time() < end:
        try:
            urllib.request.urlopen(url, timeout=2).read()
            return
        except Exception:  # noqa: BLE001 - not up yet
            time.sleep(0.5)
    raise SystemExit(f"{url} did not come up")


def up() -> None:
    configs = configure()
    logs = os.path.join(LOCAL, "logs")
    os.makedirs(logs, exist_ok=True)
    procs = []

    def start(name: str, argv: list[str], cwd: str) -> None:
        out = open(os.path.join(logs, f"{name}.log"), "w", encoding="utf-8")
        procs.append(subprocess.Popen(argv, cwd=cwd, stdout=out, stderr=subprocess.STDOUT, start_new_session=True))

    try:
        start("git", [sys.executable, os.path.join(HERE, "remotes.py"), "--root", os.path.join(LOCAL, "repos"),
                      "--port", str(GIT_PORT)], HERE)
        start("gateway", ["npx", "wrangler", "dev", *configs, "--port", str(GATEWAY_PORT), "--ip", "127.0.0.1",
                          "--persist-to", os.path.join(LOCAL, "state")], GATEWAY)
        wait_for(f"http://127.0.0.1:{GATEWAY_PORT}/healthz")
        start("web", ["npx", "vite", "dev", "--config", os.path.join(WEB_LOCAL, "vite.config.mjs")], WEB)
        wait_for(f"http://127.0.0.1:{WEB_PORT}/", 300)
        print(f"up: gateway http://127.0.0.1:{GATEWAY_PORT}, web http://127.0.0.1:{WEB_PORT}; logs in {logs}",
              flush=True)
        signal.pause()
    except KeyboardInterrupt:
        pass
    finally:
        for p in procs:
            try:
                os.killpg(p.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass


def env() -> None:
    print(f"export BEANSTALK_GATEWAY=http://127.0.0.1:{GATEWAY_PORT}")
    print(f"export BEANSTALK_ADMIN_TOKEN={tokens()['ADMIN_TOKEN']}")


if __name__ == "__main__":
    {"up": up, "env": env, "configure": lambda: print(configure())}[sys.argv[1] if len(sys.argv) > 1 else "up"]()
