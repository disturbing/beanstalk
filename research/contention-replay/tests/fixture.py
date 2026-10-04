"""Tiny synthetic git repositories for the replay tests, built with programmatic commits.

Corpora are extracted with ../common/corpus.py itself, so the tests exercise the real
data contract."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ["GIT_CONFIG_GLOBAL"] = os.devnull  # corpus.py's git calls inherit this
os.environ["GIT_CONFIG_NOSYSTEM"] = "1"
import replay  # noqa: E402

corpuslib = replay.corpuslib
HUMAN = "Dev Human <dev@example.com>"
CLAUDE_TRAILER = "\n\nCo-authored-by: Claude <noreply@anthropic.com>"


def numbered(prefix: str, n: int) -> str:
    return "".join(f"{prefix}{k}\n" for k in range(1, n + 1))


BASE_FILES = {
    "pkg-a/package.json": '{"name": "a"}\n',
    "pkg-a/src/a.ts": numbered("a", 12),
    "pkg-b/package.json": '{"name": "b"}\n',
    "pkg-b/src/b.ts": numbered("b", 12),
    "CHANGELOG.md": "# Changelog\n\n- base\n",
    "pnpm-lock.yaml": numbered("l", 6),
    "README.md": "fixture\n",
}


class FixtureRepo:
    """A non-bare repository with a linear `main` (history mode) and optional
    `ref/*` branches cut from the base commit (branch mode)."""

    def __init__(self, root: Path, files: dict[str, str] | None = None):
        self.path = root / "repo"
        self.path.mkdir(parents=True)
        self.clock = 1_700_000_000
        self.files: dict[str, str] = {}
        self.git("init", "-q", "-b", "main")
        self.base = self.commit("base", dict(files if files is not None else BASE_FILES))

    def git(self, *args: str, env: dict | None = None) -> str:
        full = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
        full.update(GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1", LC_ALL="C")
        full.update(env or {})
        r = subprocess.run(["git", "-C", str(self.path), *args], capture_output=True, text=True, env=full)
        if r.returncode:
            raise RuntimeError(f"git {' '.join(args)}: {r.stderr}")
        return r.stdout.strip()

    def edit(self, path: str, changes: dict[int, str | None]) -> str:
        """Current content of ``path`` with 1-based line numbers replaced (None deletes)."""
        lines = self.files[path].splitlines()
        for k, v in changes.items():
            lines[k - 1] = v  # type: ignore[call-overload]
        return "".join(f"{x}\n" for x in lines if x is not None)

    def commit(self, message: str, files: dict[str, str | bytes | None], author: str = HUMAN) -> str:
        for rel, content in files.items():
            p = self.path / rel
            if content is None:
                p.unlink()
                self.files.pop(rel, None)
            else:
                p.parent.mkdir(parents=True, exist_ok=True)
                if isinstance(content, bytes):
                    p.write_bytes(content)
                else:
                    p.write_text(content)
                    self.files[rel] = content
        self.git("add", "-A")
        self.clock += 60
        name, email = author[:-1].split(" <")
        date = f"{self.clock} +0000"
        self.git("commit", "-q", "-m", message, env={
            "GIT_AUTHOR_NAME": name, "GIT_AUTHOR_EMAIL": email, "GIT_AUTHOR_DATE": date,
            "GIT_COMMITTER_NAME": name, "GIT_COMMITTER_EMAIL": email, "GIT_COMMITTER_DATE": date})
        return self.git("rev-parse", "HEAD")

    def branch(self, name: str, message: str, files: dict[str, str | None]) -> str:
        """Commit ``files`` on a new branch cut from the base commit; back to main afterwards."""
        saved = dict(self.files)
        self.git("checkout", "-q", "-b", name, self.base)
        self.files = {rel: (self.path / rel).read_text() for rel in saved if (self.path / rel).exists()}
        sha = self.commit(message, files)
        self.git("checkout", "-q", "main")
        self.files = saved
        return sha

    def pack(self) -> None:
        """Move every object into one pack (as in a fresh clone)."""
        self.git("repack", "-adq")
        self.git("prune-packed")

    def corpus(self, out_dir: Path, name: str = "fixture") -> Path:
        records = corpuslib.extract_history(str(self.path), "main", None, None)
        return self._write(out_dir, corpuslib.build(str(self.path), name, records, "main"))

    def branch_corpus(self, out_dir: Path, name: str = "arena") -> Path:
        records = corpuslib.extract_branches(str(self.path), "main", "refs/heads/ref/*")
        return self._write(out_dir, corpuslib.build(str(self.path), name, records, "main"))

    @staticmethod
    def _write(out_dir: Path, built: list[dict]) -> Path:
        kept = [c for c in built if c["files"]]
        for k, c in enumerate(kept):
            c["seq"] = k
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / "corpus.jsonl"
        path.write_text("".join(json.dumps(c) + "\n" for c in kept))
        return path


def run_replay(corpus: Path, repo: Path, out: Path, *extra: str) -> dict:
    """Run replay.main in-process; return parsed outputs."""
    rc = replay.main(["--corpus-file", str(corpus), "--repo", str(repo), "--out", str(out),
                      "--jobs", "1", "--quiet", *extra])
    assert rc == 0
    pairs = [json.loads(x) for x in (out / "pairs.jsonl").read_text().splitlines()]
    result = {
        "pairs": {(p["a_seq"], p["b_seq"]): p for p in pairs},
        "pair_list": pairs,
        "changes": [json.loads(x) for x in (out / "changes.jsonl").read_text().splitlines()],
        "summary": json.loads((out / "summary.json").read_text()),
    }
    if (out / "semantic.jsonl").exists():
        result["semantic"] = [json.loads(x) for x in (out / "semantic.jsonl").read_text().splitlines()]
    return result
