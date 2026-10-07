"""Git over SSH end to end on this machine: a real ``git`` and OpenSSH client, the real SSH server container, the
real ``beanstalk-ssh`` Worker (its ``connect`` handler, the Durable Object forwarding to the container, the container's
outbound handler) and the real gateway Worker and engine, all under ``wrangler dev``.

The gateway runs on the git-native local stack (``local_e2e.py``: Artifacts as bare repos behind ``git http-backend``,
real squashes and ``node --test`` checks). Throwaway keys are generated under ``stream_e2e/.local/ssh`` (git-ignored):
a host key (passed to the container as SSH_HOST_KEY through the Worker's .dev.vars) and a client key registered to
``acme`` through the gateway's ``SSH_STAGING_KEYS``. git runs with an isolated HOME, ``IdentityAgent=none``,
``IdentitiesOnly`` and its own known_hosts, so no personal key, agent, ssh config or known_hosts is read or written.

    python3 research/race/git_native/ssh_local_e2e.py [transcript.txt]
"""
from __future__ import annotations

import json
import os
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "stream_e2e"))
os.environ.setdefault("STREAM_E2E_PORTS", "8868,8867,5461")
os.environ.setdefault("STREAM_E2E_SUFFIX", "-ssh")

import devstack  # noqa: E402

SSH_PORT = int(os.environ.get("SSH_E2E_PORT", "2232"))
SSH_HTTP_PORT = int(os.environ.get("SSH_E2E_HTTP_PORT", "8896"))
SSH_WORKER = f"beanstalk-ssh-e2e{devstack.SUFFIX}"
SSH_PACKAGE = os.path.join(devstack.REPO, "packages", "ssh")
KEYS = os.path.join(devstack.LOCAL, "ssh")


def keygen(name: str) -> str:
    path = os.path.join(KEYS, name)
    if not os.path.exists(path):
        os.makedirs(KEYS, exist_ok=True)
        subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "", "-f", path], check=True)
    return path


def fingerprint(public_key: str) -> str:
    out = subprocess.run(["ssh-keygen", "-lf", public_key], check=True, capture_output=True, text=True).stdout
    return out.split()[1]


def configure_ssh_worker(host_key: str) -> str:
    """The ssh Worker's config for this stack: its GATEWAY is the local gateway, its TCP listener SSH_PORT."""
    config = devstack.jsonc(os.path.join(SSH_PACKAGE, "wrangler.jsonc"))
    config.pop("$schema", None)
    config.pop("secrets", None)
    config["name"] = SSH_WORKER
    config["main"] = os.path.join(SSH_PACKAGE, "src", "index.ts")
    config["services"] = [{"binding": "GATEWAY", "service": devstack.E2E_GATEWAY}]
    config["connect"] = [{"protocol": "tcp", "port": SSH_PORT}]
    config["vars"] = {**config["vars"], "SSH_POOL_SIZE": "1", "SSH_HOST_KEY_FINGERPRINT": fingerprint(host_key + ".pub")}
    for container in config["containers"]:
        container["image"] = os.path.join(devstack.REPO, "packages", "ssh-server", "Dockerfile")
        container["image_build_context"] = devstack.REPO
    directory = os.path.join(devstack.LOCAL, "ssh-worker")
    devstack.write(os.path.join(directory, "wrangler.json"), config)
    with open(host_key, encoding="utf-8") as fh:
        escaped = fh.read().strip().replace("\n", "\\n")
    devstack.write(os.path.join(directory, ".dev.vars"), f'SSH_HOST_KEY="{escaped}"\n')
    return os.path.join(directory, "wrangler.json")


def admin(path: str, body: dict) -> dict:
    request = urllib.request.Request(
        f"http://127.0.0.1:{devstack.GATEWAY_PORT}{path}", data=json.dumps(body).encode(), method="POST",
        headers={"authorization": f"Bearer {devstack.tokens()['ADMIN_TOKEN']}", "content-type": "application/json"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read())


def wait_for_port(port: int, seconds: float = 300) -> None:
    end = time.time() + seconds
    while time.time() < end:
        with socket.socket() as probe:
            if probe.connect_ex(("127.0.0.1", port)) == 0:
                return
        time.sleep(0.5)
    raise SystemExit(f"port {port} did not open")


def isolated_git_env(client_key: str, host_key: str) -> dict:
    """An environment where git and ssh see only the throwaway key and this stack's host key."""
    home = os.path.join(devstack.LOCAL, "ssh-home")
    shutil.rmtree(home, ignore_errors=True)
    os.makedirs(home)
    known_hosts = os.path.join(home, "known_hosts")
    with open(host_key + ".pub", encoding="utf-8") as fh, open(known_hosts, "w", encoding="utf-8") as out:
        out.write(f"[127.0.0.1]:{SSH_PORT} {fh.read().strip()}\n")
    ssh = (f"ssh -F /dev/null -i {client_key} -o IdentitiesOnly=yes -o IdentityAgent=none "
           f"-o UserKnownHostsFile={known_hosts} -o StrictHostKeyChecking=yes -o BatchMode=yes")
    env = {key: value for key, value in os.environ.items() if key not in ("SSH_AUTH_SOCK", "GIT_SSH", "GIT_SSH_COMMAND")}
    return {**env, "HOME": home, "XDG_CONFIG_HOME": home, "GIT_CONFIG_NOSYSTEM": "1", "GIT_SSH_COMMAND": ssh}


def refusals(out, git_env: dict, url: str, stranger_key: str, client_key: str) -> None:
    """What is refused: an unregistered key, protocol v0 fetches, another owner's repository."""
    def run(note: str, argv: list[str], env: dict) -> None:
        out.write(f"\n# {note}\n$ {' '.join(argv)}\n")
        done = subprocess.run(argv, env=env, capture_output=True, text=True, timeout=120)
        out.write(done.stdout + done.stderr + f"(exit {done.returncode})\n")
        out.flush()
    stranger = {**git_env, "GIT_SSH_COMMAND": git_env["GIT_SSH_COMMAND"].replace(client_key, stranger_key)}
    run("a key nobody registered", ["git", "ls-remote", url, "sprout"], stranger)
    run("protocol v0 fetches are refused with the fix", ["git", "-c", "protocol.version=0", "ls-remote", url], git_env)
    other = url.replace("/acme/", "/dana/")
    run("another owner's (or a missing) repository reads as missing", ["git", "ls-remote", other], git_env)


def main() -> None:
    transcript = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "ssh-local-transcript.txt")
    host_key, client_key = keygen("host_ed25519"), keygen("client_ed25519")
    configs = devstack.configure()
    gateway_config = os.path.join(devstack.LOCAL, "gateway", "wrangler.json")
    gateway = devstack.jsonc(gateway_config)
    gateway["vars"]["SSH_STAGING_KEYS"] = json.dumps({fingerprint(client_key + ".pub"): {"id": "u-acme", "handle": "acme"}})
    for database in gateway.get("d1_databases", []):
        database["migrations_dir"] = os.path.normpath(os.path.join(devstack.GATEWAY, database["migrations_dir"]))
    devstack.write(gateway_config, gateway)
    for database in gateway.get("d1_databases", []):
        subprocess.run(["npx", "wrangler", "d1", "migrations", "apply", database["database_name"], "--local",
                        "-c", gateway_config, "--persist-to", os.path.join(devstack.LOCAL, "state")],
                       cwd=devstack.GATEWAY, check=True, capture_output=True, input=b"y\n")
    ssh_config = configure_ssh_worker(host_key)
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
        start("ssh", ["npx", "wrangler", "dev", "-c", ssh_config, "--port", str(SSH_HTTP_PORT), "--ip", "127.0.0.1",
                      "--persist-to", os.path.join(devstack.LOCAL, "ssh-state")], SSH_PACKAGE)
        devstack.wait_for(f"http://127.0.0.1:{SSH_HTTP_PORT}/healthz", 600)
        wait_for_port(SSH_PORT)
        repo = f"sshdemo{secrets.token_hex(3)}"
        opened = admin("/v1/repos", {"repoName": repo, "artifactsRepo": f"repo-{repo}",
                                     "owner": {"id": "u-acme", "handle": "acme"}, "create_artifacts_repo": True,
                                     "settings": {"bean_url": f"http://127.0.0.1:{devstack.WEB_PORT}/beans/{{bean}}"}})
        url = f"ssh://git@127.0.0.1:{SSH_PORT}/acme/{repo}.git"
        git_env = isolated_git_env(client_key, host_key)
        with open(transcript, "w", encoding="utf-8") as out:
            out.write("# local stack: git + OpenSSH -> beanstalk-ssh Worker connect() -> SshServer DO -> SSH server "
                      "container -> gateway (service binding) under wrangler dev; git http-backend; node --test checks\n"
                      f"# engine {opened['engineId']}, clone URL {url}\n"
                      f"# host key {fingerprint(host_key + '.pub')} (throwaway); client key "
                      f"{fingerprint(client_key + '.pub')} registered to @acme\n")
            out.write("\n$ ssh -p PORT git@127.0.0.1   (no shell: the greeting names the key's owner)\n")
            out.flush()
            greeting = subprocess.run(git_env["GIT_SSH_COMMAND"].split() + ["-p", str(SSH_PORT), "git@127.0.0.1"],
                                      env=git_env, capture_output=True, text=True, timeout=120, stdin=subprocess.DEVNULL)
            out.write(greeting.stdout + greeting.stderr + f"(exit {greeting.returncode})\n")
            out.flush()
            result = subprocess.run([os.path.join(HERE, "demo.sh")], stdout=out, stderr=subprocess.STDOUT,
                                    env={**git_env, "BEANSTALK_GIT": url, "BEANSTALK_TOKEN": "unused-over-ssh"},
                                    timeout=900)
            refusals(out, git_env, url, keygen("stranger_ed25519"), client_key)
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
