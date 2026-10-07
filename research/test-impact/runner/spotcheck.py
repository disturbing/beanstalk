"""Mutation spot-check of the read maps a race stored in its RunDO (`packages/gateway/src/read-maps`).

Picks a traced tree of a finished run whose files can be rebuilt locally (its manifest's blobs are
all in the local arena repository), seeds mutations into it, asks the gateway's store which test
files may observe each one (`POST /v1/runs/<run>/read-maps/affected`, maps and base = that tree),
and runs every test file on its own against the mutated tree as ground truth. Safe means every
failing test file was selected.

  BEANSTALK_GATEWAY=... BEANSTALK_ADMIN_TOKEN=... \
    python3 spotcheck.py --run <run> --repo ../../corpora/arena.git --out results/runner-spotcheck.json
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from dataclasses import dataclass, field

NUMBER = re.compile(r"(?<![\w.])(\d+)(?![\w.])")
COMPARISON = re.compile(r" (<=|>=|<|>) ")
STRING = re.compile(r"'([A-Za-z][A-Za-z ]{2,30})'")
EXPORT_FN = re.compile(r"^export function (\w+)\(", re.M)


@dataclass
class Mutation:
    kind: str
    desc: str
    edits: dict[str, str | None] = field(default_factory=dict)  # path -> new content (None: delete)
    ops: dict[str, str] = field(default_factory=dict)            # path -> M | A | D


def generate(files: dict[str, str], count: int, seed: int) -> list[Mutation]:
    """Seeded mutations over source files (not tests): numbers, comparisons, strings, renamed exports,
    deleted modules, and added files that shadow (a nearer package.json). Each changes one file."""
    rng = random.Random(seed)
    sources = sorted(p for p in files if p.startswith("src/") and p.endswith(".ts") and ".test." not in p)
    makers = [_number, _comparison, _string, _rename]
    out: list[Mutation] = []
    attempts = 0
    while len(out) < count - 3 and attempts < 2000:
        attempts += 1
        path = rng.choice(sources)
        m = rng.choice(makers)(path, files[path], rng)
        if m is not None and m.desc not in {x.desc for x in out}:
            out.append(m)
    victim = rng.choice([p for p in sources if not p.endswith("index.ts")])
    out.append(Mutation("delete", f"delete {victim}", {victim: None}, {victim: "D"}))
    pkg_dir = os.path.dirname(rng.choice(sources))
    shadow = f"{pkg_dir}/package.json"
    out.append(Mutation("add", f"add {shadow} (type: commonjs)", {shadow: '{"type": "commonjs"}\n'}, {shadow: "A"}))
    out.append(Mutation("add", "add an unrelated doc", {"docs/notes.md": "# notes\n"}, {"docs/notes.md": "A"}))
    return out[:count]


def _replace_nth(text: str, regex: re.Pattern, rng: random.Random, make) -> tuple[str, str] | None:
    hits = list(regex.finditer(text))
    if not hits:
        return None
    hit = rng.choice(hits)
    new = make(hit)
    return text[:hit.start()] + new + text[hit.end():], f"{hit.group(0)!r} -> {new!r}"


def _number(path, text, rng):
    done = _replace_nth(text, NUMBER, rng, lambda h: str(int(h.group(1)) + 1))
    return done and Mutation("number", f"{path}: {done[1]}", {path: done[0]}, {path: "M"})


def _comparison(path, text, rng):
    flip = {"<": ">=", ">": "<=", "<=": ">", ">=": "<"}
    done = _replace_nth(text, COMPARISON, rng, lambda h: f" {flip[h.group(1)]} ")
    return done and Mutation("comparison", f"{path}: {done[1]}", {path: done[0]}, {path: "M"})


def _string(path, text, rng):
    done = _replace_nth(text, STRING, rng, lambda h: f"'{h.group(1)}!'")
    return done and Mutation("string", f"{path}: {done[1]}", {path: done[0]}, {path: "M"})


def _rename(path, text, rng):
    done = _replace_nth(text, EXPORT_FN, rng, lambda h: f"export function {h.group(1)}Renamed(")
    return done and Mutation("rename", f"{path}: {done[1]}", {path: done[0]}, {path: "M"})


def api(gateway: str, token: str, path: str, body: dict | None = None) -> dict:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(f"{gateway}{path}", data=data, method="GET" if body is None else "POST",
                                 headers={"authorization": f"Bearer {token}", "content-type": "application/json",
                                          "user-agent": "beanstalk-spotcheck/1"})  # the edge refuses urllib's
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


def git(repo: str, *args: str, cwd: str | None = None) -> str:
    return subprocess.run(["git", f"--git-dir={repo}", *args], cwd=cwd, check=True,
                          capture_output=True, text=True).stdout


def rebuild(repo: str, blobs: dict[str, str], dest: str) -> bool:
    """Writes the tree's files from local blobs; False when a blob is missing locally."""
    for path, blob in blobs.items():
        r = subprocess.run(["git", f"--git-dir={repo}", "cat-file", "blob", blob], capture_output=True)
        if r.returncode != 0:
            return False
        full = os.path.join(dest, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "wb") as f:
            f.write(r.stdout)
    return True


def run_file(cwd: str, test: str) -> bool:
    r = subprocess.run(["node", "--test", "--test-reporter=dot", "--", test], cwd=cwd,
                       capture_output=True, timeout=120, env=dict(os.environ, CI="1"))
    return r.returncode == 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--repo", required=True, help="local arena repository holding the tree's blobs")
    ap.add_argument("--count", type=int, default=20)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    gateway, token = os.environ["BEANSTALK_GATEWAY"].rstrip("/"), os.environ["BEANSTALK_ADMIN_TOKEN"]
    base = f"/v1/runs/{args.run}/read-maps"
    summary = api(gateway, token, base)
    work = tempfile.mkdtemp(prefix="spotcheck-")
    chosen = None
    for entry in sorted(summary["trees"], key=lambda t: -t["files"]):
        view = api(gateway, token, f"{base}/trees/{entry['tree']}")
        shutil.rmtree(work, ignore_errors=True)
        os.makedirs(work)
        if view.get("blobs") and rebuild(args.repo, view["blobs"], work):
            chosen = view
            break
    if chosen is None:
        print("no traced tree can be rebuilt from local blobs", file=sys.stderr)
        return 1
    tree = chosen["tree"]
    tests = sorted(m["test"] for m in chosen["maps"])
    files = {p: open(os.path.join(work, p), encoding="utf-8").read() for p in chosen["blobs"]
             if p.endswith(".ts")}
    pristine = os.path.join(work, ".pristine")
    shutil.copytree(work, pristine)
    results = []
    for m in generate(files, args.count, args.seed):
        changes = [{"path": p, "op": op} for p, op in m.ops.items()]
        answer = api(gateway, token, f"{base}/affected", {"base": tree, "mapsFrom": tree, "changes": changes,
                                                          "tests": tests})
        for path, content in m.edits.items():
            full = os.path.join(work, path)
            if content is None:
                os.remove(full)
            else:
                os.makedirs(os.path.dirname(full), exist_ok=True)
                with open(full, "w", encoding="utf-8") as f:
                    f.write(content)
        failing = sorted(t for t in tests if not run_file(work, t))
        for path in m.edits:  # revert
            src, dst = os.path.join(pristine, path), os.path.join(work, path)
            if os.path.exists(src):
                shutil.copy2(src, dst)
            elif os.path.exists(dst):
                os.remove(dst)
        selected = answer["affected"]
        missed = sorted(set(failing) - set(selected))
        results.append({"kind": m.kind, "desc": m.desc, "selected": selected, "failing": failing,
                        "missed": missed, "safe": not missed, "reasons": answer["reasons"]})
        print(f"{m.kind:10} sel={len(selected):2}/{len(tests)} fail={len(failing):2} missed={missed or '-'}  {m.desc[:80]}")
    breaking = [r for r in results if r["failing"]]
    report = {
        "run": args.run, "tree": tree, "test_files": len(tests), "mutations": len(results),
        "breaking": len(breaking), "safe_breaking": sum(r["safe"] for r in breaking),
        "mean_selected": sum(len(r["selected"]) for r in results) / len(results) / len(tests),
        "mean_selected_breaking": (sum(len(r["selected"]) for r in breaking) / len(breaking) / len(tests))
        if breaking else None,
        "mean_failing_breaking": (sum(len(r["failing"]) for r in breaking) / len(breaking) / len(tests))
        if breaking else None,
        "results": results,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    json.dump(report, open(args.out, "w"), indent=1)
    print(json.dumps({k: v for k, v in report.items() if k != "results"}, indent=1))
    shutil.rmtree(work, ignore_errors=True)
    return 0 if report["safe_breaking"] == report["breaking"] else 2


if __name__ == "__main__":
    sys.exit(main())
