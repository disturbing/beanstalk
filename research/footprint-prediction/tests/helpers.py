"""Shared test helpers: import paths and a small synthetic git repository + corpus (no network, no real data)."""
from __future__ import annotations

import json
import os
import random
import subprocess
import sys

sys.dont_write_bytecode = True  # never write .pyc files next to ../common/corpus.py
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                      # research/footprint-prediction
RESEARCH = os.path.dirname(ROOT)                  # research
for p in (ROOT, os.path.join(RESEARCH, "common")):
    if p not in sys.path:
        sys.path.insert(0, p)

import corpus as corpuslib  # noqa: E402  (research/common/corpus.py)

MODULES = {
    "pkg/auth": ["src/login.ts", "src/session.ts", "src/password.ts", "test/login.test.ts"],
    "pkg/billing": ["src/invoice.ts", "src/stripe.ts", "src/tax.ts"],
    "pkg/ui": ["src/button.ts", "src/modal.ts", "src/theme.ts"],
    "pkg/api": ["src/routes.ts", "src/middleware.ts"],
}
TITLES = {
    "pkg/auth": ["rate limit the login endpoint", "fix session expiry bug", "hash passwords with argon2", "refresh token rotation"],
    "pkg/billing": ["round invoice totals", "handle stripe webhook retries", "add vat to tax calculation"],
    "pkg/ui": ["button focus ring", "modal close on escape", "dark theme colours"],
    "pkg/api": ["add request logging middleware", "route versioning"],
}


def git(repo: str, *args: str, author: str = "Dev One <dev@example.com>") -> str:
    name, _, email = author.partition(" <")
    env = {**os.environ, "GIT_AUTHOR_NAME": name, "GIT_AUTHOR_EMAIL": email.rstrip(">"), "GIT_COMMITTER_NAME": name,
           "GIT_COMMITTER_EMAIL": email.rstrip(">"), "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}
    res = subprocess.run(["git", "-C", repo, *args], check=True, capture_output=True, text=True, env=env)
    return res.stdout


def write(repo: str, rel: str, text: str) -> None:
    path = os.path.join(repo, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        fh.write(text)


def make_repo(path: str, n_commits: int = 90, seed: int = 3) -> str:
    """A repo with four packages. Commits touch one to three modules in bursts; some add or delete files; every 13th is a
    bot commit (dropped from the corpus but still part of the first-parent chain the tree tracker must replay)."""
    os.makedirs(path, exist_ok=True)
    git(path, "init", "-q", "-b", "main")
    for module, files in MODULES.items():
        write(path, f"{module}/package.json", json.dumps({"name": module}))
        for f in files:
            write(path, f"{module}/{f}", "export {};\n")
    write(path, "docs/readme.md", "# toy\n")
    git(path, "add", "-A")
    git(path, "commit", "-q", "-m", "init")
    rng = random.Random(seed)
    mods = list(MODULES)
    focus = mods[0]
    for i in range(n_commits):
        if i % 12 == 0:
            focus = rng.choice(mods)
        touched = {focus}
        if rng.random() < 0.35:
            touched.add(rng.choice(mods))
        if rng.random() < 0.1:
            touched.add("docs")
        for m in sorted(touched):
            if m == "docs":
                write(path, "docs/readme.md", f"# toy {i}\n")
                continue
            files = MODULES[m]
            f = rng.choice(files)
            write(path, f"{m}/{f}", f"export const v = {i};\n")
            if i % 7 == 3:
                write(path, f"{m}/src/extra{i}.ts", f"export const extra{i} = 1;\n")
        if i % 11 == 5:
            extra = [p for p in git(path, "ls-files").splitlines() if "/extra" in p]
            if extra:
                git(path, "rm", "-q", extra[0])
        scope = focus.split("/")[1]
        desc = rng.choice(TITLES[focus])
        title = f"fix({scope}): {desc}" if rng.random() < 0.6 else f"{desc} ({i})"
        git(path, "add", "-A")
        author = "dependabot[bot] <bot@example.com>" if i % 13 == 7 else "Dev One <dev@example.com>"
        git(path, "commit", "-q", "-m", title, author=author)
    return path


def make_corpus(repo: str, out_path: str) -> list[dict]:
    assert corpuslib.main([repo, "--corpus", "toy", "--ref", "main", "--drop-bots", "-o", out_path]) == 0
    with open(out_path) as fh:
        return [json.loads(line) for line in fh if line.strip()]
