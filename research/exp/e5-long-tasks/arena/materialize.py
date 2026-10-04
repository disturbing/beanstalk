#!/usr/bin/env python3
"""Build the arena's bare git repository from app/, tasks/ and solutions/.

    main            the base app, at the repository root (src/billing/tax.ts, package.json, CHANGELOG.md, ...)
    ref/tNNN        base + the task's acceptance tests + its reference solution, one commit each;
                    the commit message is the task title

Everything is deterministic (fixed author, committer and dates), so rebuilding gives identical
commit ids. The output directory is deleted and rebuilt from scratch on every run.

Python 3.11+, standard library only; needs git on PATH.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

ARENA = Path(__file__).resolve().parent
RESEARCH = ARENA.parent
DEFAULT_OUT = RESEARCH / "corpora" / "arena.git"

AUTHOR_NAME = "Arena Author"
AUTHOR_EMAIL = "arena@beanstalk.invalid"
BASE_DATE = datetime(2026, 9, 14, 9, 0, 0, tzinfo=timezone.utc)
SKIP_DIRS = {"node_modules", ".git"}


def git(cwd: Path, *args: str, date: datetime | None = None, input_text: str | None = None) -> str:
    env = dict(os.environ)
    env.update({
        "GIT_AUTHOR_NAME": AUTHOR_NAME, "GIT_AUTHOR_EMAIL": AUTHOR_EMAIL,
        "GIT_COMMITTER_NAME": AUTHOR_NAME, "GIT_COMMITTER_EMAIL": AUTHOR_EMAIL,
        "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull,
    })
    if date is not None:
        stamp = date.strftime("%Y-%m-%dT%H:%M:%S +0000")
        env["GIT_AUTHOR_DATE"] = env["GIT_COMMITTER_DATE"] = stamp
    res = subprocess.run(["git", "-C", str(cwd), "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", *args],
                         capture_output=True, text=True, env=env, input=input_text)
    if res.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed in {cwd}: {res.stderr.strip()}")
    return res.stdout


def copy_app(src: Path, dst: Path) -> None:
    for path in sorted(src.rglob("*")):
        rel = path.relative_to(src)
        if any(part in SKIP_DIRS for part in rel.parts):
            continue
        target = dst / rel
        if path.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)


def load_tasks(tasks_dir: Path) -> list[dict]:
    tasks = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(tasks_dir.glob("t*.json"))]
    if not tasks:
        raise SystemExit(f"no tasks found in {tasks_dir}")
    return tasks


def materialize(out: Path, keep_work: bool = False, quiet: bool = False) -> dict[str, str]:
    app, tasks_dir, sol_dir = ARENA / "app", ARENA / "tasks", ARENA / "solutions"
    tasks = load_tasks(tasks_dir)
    work_root = Path(tempfile.mkdtemp(prefix="arena-materialize-"))
    try:
        work = work_root / "work"
        work.mkdir()
        git(work, "init", "-q", "-b", "main")
        copy_app(app, work)
        git(work, "add", "-A")
        git(work, "commit", "-q", "-m", "Beanstalk Shop: base application", date=BASE_DATE)
        shas = {"main": git(work, "rev-parse", "HEAD").strip()}

        for index, task in enumerate(tasks, start=1):
            tid = task["id"]
            patch = sol_dir / f"{tid}.patch"
            if not patch.exists():
                raise SystemExit(f"missing solution patch: {patch}")
            git(work, "checkout", "-q", "-b", f"ref/{tid}", "main")
            git(work, "apply", "--index", "--whitespace=nowarn", str(patch))
            for rel, content in task["acceptance_tests"].items():
                target = work / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content, encoding="utf-8")
            git(work, "add", "-A")
            git(work, "commit", "-q", "-m", task["title"], date=BASE_DATE + timedelta(minutes=index))
            shas[f"ref/{tid}"] = git(work, "rev-parse", "HEAD").strip()
            git(work, "checkout", "-q", "main")

        if out.exists():
            shutil.rmtree(out)
        out.parent.mkdir(parents=True, exist_ok=True)
        git(out.parent, "init", "-q", "--bare", "-b", "main", str(out))
        refspecs = ["refs/heads/main:refs/heads/main", "refs/heads/ref/*:refs/heads/ref/*"]
        git(work, "push", "-q", str(out), *refspecs)
        git(out, "symbolic-ref", "HEAD", "refs/heads/main")
        if not quiet:
            print(f"{out}: main={shas['main'][:10]} + {len(tasks)} branches ref/{tasks[0]['id']} .. ref/{tasks[-1]['id']}")
        return shas
    finally:
        if keep_work:
            print(f"work tree kept at {work_root}", file=sys.stderr)
        else:
            shutil.rmtree(work_root, ignore_errors=True)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter,
                                 epilog="Rebuilds from scratch on every run; the result is deterministic.")
    ap.add_argument("-o", "--out", type=Path, default=DEFAULT_OUT, help=f"bare repository to (re)create (default: {DEFAULT_OUT})")
    ap.add_argument("--keep-work", action="store_true", help="keep the temporary working repository for inspection")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)
    materialize(args.out.resolve(), keep_work=args.keep_work, quiet=args.quiet)
    return 0


if __name__ == "__main__":
    sys.exit(main())
