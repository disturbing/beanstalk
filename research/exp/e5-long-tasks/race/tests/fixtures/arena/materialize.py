#!/usr/bin/env python3
"""Build the fixture arena repository (a 5-task stand-in for research/arena/).

Same contract as research/arena/materialize.py:
  * ``main`` is the base app, with app/ at the repository root;
  * ``refs/heads/ref/tNNN`` is base + the task's acceptance tests + its reference solution,
    one commit per task whose message is the task title.

Designed interactions: t001/t002 conflict textually (same spot in the routes table);
t001/t005 both append to CHANGELOG.md (a conflict unless merge=union); t003/t004 merge
cleanly but break t004's acceptance test (semantic). ``solutions/t004.fix.patch`` is a
harness-only extra that the replay agent uses to repair the t003/t004 interaction.

Usage: python3 materialize.py --out PATH/arena.git
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))


def git(cwd: str, *args: str, check: bool = True, env: dict | None = None) -> subprocess.CompletedProcess:
    res = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, env=env)
    if check and res.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {res.stderr.strip()}")
    return res


def load_tasks() -> list[dict]:
    tdir = os.path.join(HERE, "tasks")
    return [json.load(open(os.path.join(tdir, n))) for n in sorted(os.listdir(tdir)) if n.endswith(".json")]


def materialize(out: str) -> None:
    out = os.path.abspath(out)
    if os.path.exists(out):
        shutil.rmtree(out)
    env = dict(os.environ, GIT_AUTHOR_DATE="2026-10-01T00:00:00+00:00", GIT_COMMITTER_DATE="2026-10-01T00:00:00+00:00",
               GIT_AUTHOR_NAME="arena", GIT_AUTHOR_EMAIL="arena@beanstalk.invalid",
               GIT_COMMITTER_NAME="arena", GIT_COMMITTER_EMAIL="arena@beanstalk.invalid")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with tempfile.TemporaryDirectory(dir=os.path.dirname(out)) as tmp:  # scratch stays beside the output
        work = os.path.join(tmp, "w")
        shutil.copytree(os.path.join(HERE, "app"), work)
        git(work, "init", "-q", "-b", "main")
        git(work, "config", "commit.gpgsign", "false")
        git(work, "add", "-A")
        git(work, "commit", "-q", "-m", "Base shop service", env=env)
        for t in load_tasks():
            git(work, "checkout", "-q", "-b", f"ref/{t['id']}", "main")
            for path, content in t["acceptance_tests"].items():
                os.makedirs(os.path.dirname(os.path.join(work, path)), exist_ok=True)
                with open(os.path.join(work, path), "w") as fh:
                    fh.write(content)
            git(work, "apply", os.path.join(HERE, "solutions", f"{t['id']}.patch"))
            git(work, "add", "-A")
            git(work, "commit", "-q", "-m", t["title"], env=env)
        git(work, "checkout", "-q", "main")
        git(tmp, "clone", "-q", "--bare", work, out)
        # a bare clone maps branches 1:1, so ref/tNNN survive as refs/heads/ref/tNNN
    print(f"fixture arena: {out}", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", required=True, help="bare repository to (re)create")
    a = ap.parse_args(argv)
    materialize(a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
