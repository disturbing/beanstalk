"""Git over SSH on a separate Cloudflare staging stack (suffix ``-staging-ssh``), without Spectrum.

``setup`` creates or reuses the stack: D1 ``beanstalk-identity-staging-ssh`` and ``beanstalk-forge-staging-ssh``
(migrated), the gateway ``beanstalk-gateway-staging-ssh`` (Artifacts namespaces ``beanstalk-race-staging-ssh`` and
``beanstalk-repos-staging-ssh``, its runner container), and ``beanstalk-ssh-staging-ssh`` (the SSH server container,
GATEWAY bound to that gateway, the WebSocket test tunnel on). It generates the gateway's secrets and the host key,
stores them as Wrangler secrets and keeps only the host key's public half (all under ``stream_e2e/.local``, which
git ignores). Nothing is printed but fingerprints.

``e2e`` registers a throwaway client key to a test account in the stack's identity database, opens a repository
engine through the admin API and runs ``demo.sh`` with real git and OpenSSH, reaching the SSH server through
``GET /tunnel`` (``ssh_tunnel_client.mjs`` as the ProxyCommand): every byte after the tunnel is the connection
Spectrum would hand to the Worker's ``connect``. Then it closes the engine and deletes its repository.

    CLOUDFLARE_ACCOUNT_ID=<account> python3 research/race/git_native/ssh_staging.py setup
    CLOUDFLARE_ACCOUNT_ID=<account> python3 research/race/git_native/ssh_staging.py e2e transcript.txt
"""
from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "stream_e2e"))
import devstack  # noqa: E402

SUFFIX = "-staging-ssh"
LOCAL = os.path.join(devstack.LOCAL, "staging-ssh")
GATEWAY_NAME = f"beanstalk-gateway{SUFFIX}"
SSH_NAME = f"beanstalk-ssh{SUFFIX}"
IDENTITY_DB = f"beanstalk-identity{SUFFIX}"
FORGE_DB = f"beanstalk-forge{SUFFIX}"
SSH_PACKAGE = os.path.join(devstack.REPO, "packages", "ssh")
TEST_USER = {"id": "u_sshstage", "handle": "ssh-stage"}


def wrangler(args: list[str], cwd: str, *, stdin: str | None = None, env: dict | None = None) -> str:
    done = subprocess.run(["npx", "wrangler", *args], cwd=cwd, input=stdin, text=True, capture_output=True,
                          env={**os.environ, **(env or {})})
    if done.returncode != 0:
        raise SystemExit(f"wrangler {' '.join(args[:3])} failed:\n{done.stdout[-3000:]}\n{done.stderr[-3000:]}")
    return done.stdout


def database_id(name: str) -> str:
    listing = json.loads(wrangler(["d1", "list", "--json"], devstack.GATEWAY))
    found = next((db["uuid"] for db in listing if db["name"] == name), None)
    if found is not None:
        return found
    out = wrangler(["d1", "create", name], devstack.GATEWAY)
    match = re.search(r'"database_id":\s*"([0-9a-f-]+)"', out)
    if match is None:
        raise SystemExit(f"no database id in: {out}")
    return match.group(1)


def secret(name: str) -> str:
    path = os.path.join(LOCAL, "secrets.json")
    values = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {}
    if name not in values:
        values[name] = secrets.token_urlsafe(36)
        devstack.write(path, values)
        os.chmod(path, 0o600)
    return values[name]


def gateway_config() -> str:
    config = devstack.jsonc(os.path.join(devstack.GATEWAY, "wrangler.jsonc"))
    config.pop("$schema", None)
    config["name"] = GATEWAY_NAME
    config["main"] = os.path.join(devstack.GATEWAY, "src", "index.ts")
    config["vars"] = {**config["vars"], "ARTIFACTS_NAMESPACE": f"beanstalk-race{SUFFIX}", "WEB_URL": ""}
    config["artifacts"] = [{"binding": "ARTIFACTS", "namespace": f"beanstalk-race{SUFFIX}", "remote": True},
                           {"binding": "REPOS", "namespace": f"beanstalk-repos{SUFFIX}", "remote": True}]
    ids = {"FORGE": (FORGE_DB, "migrations"), "IDENTITY_DB": (IDENTITY_DB, "../shared-identity/migrations")}
    for database in config["d1_databases"]:
        name, migrations = ids[database["binding"]]
        database.update({"database_name": name, "database_id": database_id(name),
                         "migrations_dir": os.path.normpath(os.path.join(devstack.GATEWAY, migrations))})
    for container in config["containers"]:
        container["image"] = os.path.join(devstack.REPO, "packages", "runner", "Dockerfile")
        container["image_build_context"] = devstack.REPO
        container["max_instances"] = 4
    path = os.path.join(LOCAL, "gateway", "wrangler.json")
    devstack.write(path, config)
    return path


def ssh_config(fingerprint: str) -> str:
    config = devstack.jsonc(os.path.join(SSH_PACKAGE, "wrangler.jsonc"))
    config.pop("$schema", None)
    config["name"] = SSH_NAME
    config["main"] = os.path.join(SSH_PACKAGE, "src", "index.ts")
    config["services"] = [{"binding": "GATEWAY", "service": GATEWAY_NAME}]
    config["vars"] = {**config["vars"], "SSH_TUNNEL": "on", "SSH_POOL_SIZE": "1", "SSH_HOST_KEY_FINGERPRINT": fingerprint}
    for container in config["containers"]:
        container["image"] = os.path.join(devstack.REPO, "packages", "ssh-server", "Dockerfile")
        container["image_build_context"] = devstack.REPO
        container["max_instances"] = 2
    path = os.path.join(LOCAL, "ssh", "wrangler.json")
    devstack.write(path, config)
    return path


def fingerprint(public_key: str) -> str:
    return subprocess.run(["ssh-keygen", "-lf", public_key], check=True, capture_output=True, text=True).stdout.split()[1]


def deploy_with_secrets(config: str, cwd: str, values: dict, env: dict | None = None) -> None:
    """`wrangler deploy` with secrets from a private file that is deleted right after."""
    scratch = os.path.join(LOCAL, "secrets-tmp")
    shutil.rmtree(scratch, ignore_errors=True)
    os.makedirs(scratch, mode=0o700)
    path = os.path.join(scratch, "secrets.json")
    try:
        with open(os.open(path, os.O_WRONLY | os.O_CREAT, 0o600), "w", encoding="utf-8") as fh:
            json.dump(values, fh)
        wrangler(["deploy", "-c", config, "--secrets-file", path], cwd, env=env)
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


def new_host_key() -> tuple[str, str]:
    """A fresh host key: its private text (for the secret only) and the kept public half's path."""
    scratch = os.path.join(LOCAL, "host-key-tmp")
    shutil.rmtree(scratch, ignore_errors=True)
    os.makedirs(scratch, mode=0o700)
    key = os.path.join(scratch, "host_ed25519")
    subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "", "-f", key], check=True)
    private = open(key, encoding="utf-8").read()
    public = os.path.join(LOCAL, "host_ed25519.pub")
    shutil.move(key + ".pub", public)
    shutil.rmtree(scratch)
    return private, public


def setup() -> None:
    gateway = gateway_config()
    for name in (IDENTITY_DB, FORGE_DB):
        wrangler(["d1", "migrations", "apply", name, "--remote", "-c", gateway], devstack.GATEWAY, stdin="y\n")
    deploy_env = {"WRANGLER_DOCKER_BIN": os.path.join(devstack.REPO, "packages", "runner", "docker-with-git-sha.sh")}
    deploy_with_secrets(gateway, devstack.GATEWAY,
                        {name: secret(name) for name in ("ADMIN_TOKEN", "RUN_TOKEN_SECRET")}, deploy_env)
    public = os.path.join(LOCAL, "host_ed25519.pub")
    if os.path.exists(public):
        wrangler(["deploy", "-c", ssh_config(fingerprint(public))], SSH_PACKAGE)
    else:
        private, public = new_host_key()
        deploy_with_secrets(ssh_config(fingerprint(public)), SSH_PACKAGE, {"SSH_HOST_KEY": private})
        del private
    print(f"stack up: {GATEWAY_NAME}, {SSH_NAME}; host key {fingerprint(public)}")


def workers_url(name: str) -> str:
    account = os.environ["CLOUDFLARE_ACCOUNT_ID"]
    request = urllib.request.Request(f"https://api.cloudflare.com/client/v4/accounts/{account}/workers/subdomain",
                                     headers={"authorization": f"Bearer {api_token()}"})
    with urllib.request.urlopen(request, timeout=30) as response:
        subdomain = json.loads(response.read())["result"]["subdomain"]
    return f"https://{name}.{subdomain}.workers.dev"


def api_token() -> str:
    config = os.path.expanduser("~/Library/Preferences/.wrangler/config/default.toml")
    for line in open(config, encoding="utf-8"):
        if line.startswith("oauth_token"):
            return line.split("=", 1)[1].strip().strip('"')
    raise SystemExit("no wrangler OAuth token")


def admin(gateway: str, path: str, body: dict) -> dict:
    request = urllib.request.Request(f"{gateway}{path}", data=json.dumps(body).encode(), method="POST",
                                     headers={"authorization": f"Bearer {secret('ADMIN_TOKEN')}",
                                              "content-type": "application/json", "user-agent": "beanstalk-ssh-e2e"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read())


def register_client_key(client_key: str) -> None:
    key_type, blob = open(client_key + ".pub", encoding="utf-8").read().split()[:2]
    now = int(time.time() * 1000)
    sql = (f"DELETE FROM ssh_keys WHERE user_id = '{TEST_USER['id']}'; DELETE FROM users WHERE id = '{TEST_USER['id']}'; "
           f"INSERT INTO users (id, handle, email, created_at) VALUES ('{TEST_USER['id']}', '{TEST_USER['handle']}', NULL, {now}); "
           "INSERT INTO ssh_keys (id, user_id, name, key_type, public_key, fingerprint, created_at) VALUES "
           f"('key_sshstage', '{TEST_USER['id']}', 'e2e', '{key_type}', '{blob}', '{fingerprint(client_key + '.pub')}', {now});")
    wrangler(["d1", "execute", IDENTITY_DB, "--remote", "-c", os.path.join(LOCAL, "gateway", "wrangler.json"),
              "--command", sql], devstack.GATEWAY)


def e2e(transcript: str) -> None:
    gateway, ssh = workers_url(GATEWAY_NAME), workers_url(SSH_NAME)
    keys = os.path.join(LOCAL, "client")
    os.makedirs(keys, exist_ok=True)
    client_key = os.path.join(keys, "client_ed25519")
    if not os.path.exists(client_key):
        subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "", "-f", client_key], check=True)
    register_client_key(client_key)
    repo = f"sshstage{secrets.token_hex(3)}"
    opened = admin(gateway, "/v1/repos", {"repoName": repo, "artifactsRepo": f"repo-{repo}",
                                          "owner": {"id": TEST_USER["id"], "handle": TEST_USER["handle"]},
                                          "create_artifacts_repo": True})
    home = os.path.join(LOCAL, "home")
    shutil.rmtree(home, ignore_errors=True)
    os.makedirs(home)
    host_alias = "ssh-staging.beanstalk.test"
    with open(os.path.join(home, "known_hosts"), "w", encoding="utf-8") as out, \
            open(os.path.join(LOCAL, "host_ed25519.pub"), encoding="utf-8") as public:
        out.write(f"{host_alias} {public.read().strip()}\n")
    tunnel = ssh.replace("https://", "wss://") + "/tunnel"
    proxy = f"node {os.path.join(HERE, 'ssh_tunnel_client.mjs')} {tunnel}"
    ssh_command = (f"ssh -F /dev/null -i {client_key} -o IdentitiesOnly=yes -o IdentityAgent=none -o BatchMode=yes "
                   f"-o UserKnownHostsFile={os.path.join(home, 'known_hosts')} -o StrictHostKeyChecking=yes "
                   f"-o ProxyCommand='{proxy}'")
    env = {k: v for k, v in os.environ.items() if k not in ("SSH_AUTH_SOCK", "GIT_SSH", "GIT_SSH_COMMAND")}
    env.update({"HOME": home, "XDG_CONFIG_HOME": home, "GIT_CONFIG_NOSYSTEM": "1", "GIT_SSH_COMMAND": ssh_command})
    url = f"ssh://git@{host_alias}/{TEST_USER['handle']}/{repo}.git"
    started = time.time()
    try:
        with open(transcript, "w", encoding="utf-8") as out:
            out.write(f"# staging: git + OpenSSH -> wss tunnel -> {SSH_NAME} -> SshServer DO -> SSH server container "
                      f"-> {GATEWAY_NAME} (service binding) -> Artifacts, real runner containers\n"
                      f"# {time.strftime('%Y-%m-%d %H:%M:%S %Z')}, engine {opened['engineId']}, clone URL {url}\n"
                      f"# host key {fingerprint(os.path.join(LOCAL, 'host_ed25519.pub'))}; client key "
                      f"{fingerprint(client_key + '.pub')} registered to @{TEST_USER['handle']}\n")
            out.flush()
            greeting = subprocess.run(["sh", "-c", f"{ssh_command} git@{host_alias}"], env=env, capture_output=True,
                                      text=True, timeout=300, stdin=subprocess.DEVNULL)
            out.write(f"\n$ ssh git@{host_alias}\n{greeting.stdout}{greeting.stderr}(exit {greeting.returncode})\n")
            out.flush()
            result = subprocess.run([os.path.join(HERE, "demo.sh")], stdout=out, stderr=subprocess.STDOUT,
                                    env={**env, "BEANSTALK_GIT": url, "BEANSTALK_TOKEN": "unused-over-ssh"},
                                    timeout=1800)
            out.write(f"\n# demo exit {result.returncode} after {time.time() - started:.0f} s\n")
    finally:
        closed = admin(gateway, f"/v1/repos/{opened['engineId']}/close", {"delete_repo": True})
        with open(transcript, "a", encoding="utf-8") as out:
            out.write(f"# engine closed and repo deleted: {json.dumps(closed)}\n")
    print(open(transcript, encoding="utf-8").read())
    sys.exit(result.returncode)


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else "setup"
    if command == "setup":
        setup()
    elif command == "e2e":
        e2e(sys.argv[2] if len(sys.argv) > 2 else os.path.join(LOCAL, "transcript.txt"))
    else:
        raise SystemExit("setup or e2e")
