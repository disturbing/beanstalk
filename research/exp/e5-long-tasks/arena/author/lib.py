"""Authoring helper for the arena tasks.

A task is a list of edit operations against app/ plus acceptance-test files.
build() applies them in a temp git repo, so patches come from real `git diff`
output and every task is checked as it is built (acceptance tests fail on base,
base + solution passes the whole suite).

tasks/*.json and solutions/*.patch are generated from the tasks_*.py files next
to this one (python3 author/build_all.py); edit the tasks here, then rebuild.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True

ARENA = Path(__file__).resolve().parent.parent
APP = ARENA / 'app'
TASKS_DIR = ARENA / 'tasks'
SOL_DIR = ARENA / 'solutions'

REGISTRY: dict[str, 'Task'] = {}
HOT_FILES = {'src/routes.ts', 'src/types.ts', 'src/db/migrations/index.ts', 'CHANGELOG.md', 'src/lib/money.ts'}


def git(cwd, *args, check=True, env=None):
    e = dict(os.environ)
    e.update({'GIT_AUTHOR_NAME': 'a', 'GIT_AUTHOR_EMAIL': 'a@a', 'GIT_COMMITTER_NAME': 'a', 'GIT_COMMITTER_EMAIL': 'a@a'})
    if env:
        e.update(env)
    r = subprocess.run(['git', '-C', str(cwd), *args], capture_output=True, text=True, env=e)
    if check and r.returncode != 0:
        raise RuntimeError(f'git {args} failed: {r.stderr}')
    return r.stdout


def module_of(path: str) -> str:
    segs = path.split('/')[:-1]
    return '/'.join(segs[:2]) if segs else '(root)'


class Task:
    def __init__(self, slug, title, kind, difficulty, prompt):
        assert slug not in REGISTRY, slug
        self.slug, self.title, self.kind, self.difficulty = slug, title, kind, difficulty
        self.prompt = prompt.strip()
        self.ops: list[tuple] = []
        self.tests: dict[str, str] = {}
        self.couplings: list[tuple[str, str, str]] = []
        REGISTRY[slug] = self

    # ---- edit operations (applied in order)
    def rep(self, path, old, new):
        self.ops.append(('rep', path, old, new)); return self

    def new(self, path, content):
        self.ops.append(('new', path, content)); return self

    def ins_after(self, path, anchor, text):
        self.ops.append(('after', path, anchor, text)); return self

    def ins_before(self, path, anchor, text):
        self.ops.append(('before', path, anchor, text)); return self

    def append(self, path, text):
        self.ops.append(('append', path, text)); return self

    def test(self, path, content):
        self.tests[path] = content.lstrip('\n'); return self

    def couples(self, other, kind, note):
        self.couplings.append((other, kind, note)); return self

    # ---- application
    def apply(self, root: Path):
        for op in self.ops:
            kind, path = op[0], root / op[1]
            if kind == 'new':
                assert not path.exists(), f'{self.slug}: {op[1]} already exists'
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(op[2].lstrip('\n'))
                continue
            text = path.read_text()
            if kind == 'append':
                path.write_text(text + op[2]); continue
            anchor = op[2]
            n = text.count(anchor)
            assert n == 1, f'{self.slug}: anchor in {op[1]} matches {n} times: {anchor[:70]!r}'
            if kind == 'rep':
                text = text.replace(anchor, op[3])
            elif kind == 'after':
                text = text.replace(anchor, anchor + op[3])
            elif kind == 'before':
                text = text.replace(anchor, op[3] + anchor)
            path.write_text(text)


def make_repo(dst: Path):
    shutil.copytree(APP, dst)
    git(dst, 'init', '-q', '-b', 'main')
    git(dst, 'add', '-A')
    git(dst, 'commit', '-q', '-m', 'base')


def run_node_tests(root: Path, files=None, timeout=60):
    cmd = ['node', '--test'] + (list(files) if files else [])
    r = subprocess.run(cmd, cwd=root, capture_output=True, text=True, timeout=timeout)
    out = r.stdout + r.stderr
    m = {k: int(v) for k, v in re.findall(r'^ℹ (tests|pass|fail) (\d+)', out, re.M)}
    return r.returncode, m, out


def build(task: Task, check=True, write_as: str | None = None, verbose=False):
    """Apply a task in a temp repo; return a result dict. Writes patch+json when write_as is set."""
    res = {'slug': task.slug}
    with tempfile.TemporaryDirectory() as td:
        repo = Path(td) / 'repo'
        make_repo(repo)
        task.apply(repo)
        git(repo, 'add', '-A')
        patch = git(repo, 'diff', '--cached', '--no-color', '--no-ext-diff')
        changed = git(repo, 'diff', '--cached', '--name-only').split()
        res['patch'] = patch
        res['src_files'] = changed
        paths = sorted(set(changed) | set(task.tests))
        res['paths'] = paths
        res['modules'] = sorted({module_of(p) for p in paths})
        res['hot'] = sorted(set(paths) & HOT_FILES)
        res['patch_lines'] = patch.count('\n')
        if check:
            # 1. acceptance tests fail on base
            base = Path(td) / 'base'
            make_repo(base)
            for p, c in task.tests.items():
                (base / p).parent.mkdir(parents=True, exist_ok=True)
                (base / p).write_text(c)
            code, m, out = run_node_tests(base, list(task.tests))
            res['base_fails'] = code != 0
            res['base_summary'] = m
            if verbose and code == 0:
                print(out[-2000:])
            # 2. base + solution passes full suite
            for p, c in task.tests.items():
                (repo / p).parent.mkdir(parents=True, exist_ok=True)
                (repo / p).write_text(c)
            code, m, out = run_node_tests(repo)
            res['sol_passes'] = code == 0
            res['sol_summary'] = m
            if code != 0:
                res['sol_output'] = out[-3500:]
    if write_as:
        (SOL_DIR / f'{write_as}.patch').write_text(res['patch'])
    return res


def oracle_json(task: Task, tid: str, res: dict, id_of: dict[str, str]):
    return {
        'id': tid,
        'title': task.title,
        'prompt': task.prompt,
        'acceptance_tests': dict(sorted(task.tests.items())),
        'oracle_paths': res['paths'],
        'oracle_modules': res['modules'],
        'kind': task.kind,
        'difficulty': task.difficulty,
        'couplings': [{'with': id_of[o], 'type': k, 'note': n} for o, k, n in task.couplings],
    }
