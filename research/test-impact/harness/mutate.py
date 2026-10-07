"""Generates seeded breaking-mutation candidates for a project.

A mutation is a list of edits: {"op": "M"|"A"|"D", "path", "before", "after"} (before/after are whole
file contents; None for absent). Single-file kinds: code ops (number, string, comparison, arithmetic,
boolean, rename-at-definition, return-null), shared-helper edits, data/fixture edits, config edits,
test-file edits, file deletion, file addition. Multi-file: 2-3 singles on different files.
"""

from __future__ import annotations

import os
import random
import re

from langs import ROOT, Lang, files

NUM_RE = re.compile(r"(?<![\w.])(\d+)(?![\w.])")
DEC_RE = re.compile(r"(?<![\w.])(\d+\.\d+|\d+)(?![\w.])")
STR_RE = re.compile(r'"([^"\\\n{}$%]{1,40})"')
CMP = {" <= ": " < ", " >= ": " > ", " == ": " != ", " != ": " == ", " < ": " <= ", " > ": " >= ",
       " === ": " !== ", " !== ": " === "}
ARITH = {" + ": " - ", " - ": " + ", " * ": " + "}


def read(path: str) -> str:
    with open(os.path.join(ROOT, path)) as f:
        return f.read()


def _code_lines(lang: Lang, text: str):
    for i, line in enumerate(text.split("\n")):
        s = line.strip()
        if not s or s.startswith(lang.comment) or s.startswith(("*", "/*", '"""', "'''")):
            continue
        if lang.skip_line_re.match(line):
            continue
        yield i, line


def _candidates(lang: Lang, op: str, text: str, data: bool = False):
    """All (line_no, new_line, label) edits of this operator kind in text."""
    out = []
    lines = list(_code_lines(lang, text)) if not data else list(enumerate(text.split("\n")))
    for i, line in lines:
        if op == "num":
            rx = DEC_RE if data else NUM_RE
            for m in rx.finditer(line):
                v = m.group(1)
                nv = (v[:-1] + str((int(v[-1]) + 1) % 10)) if "." in v else str(int(v) + 1)
                out.append((i, line[:m.start()] + nv + line[m.end():], f"{v}->{nv}"))
        elif op == "str":
            for m in STR_RE.finditer(line):
                out.append((i, line[:m.start()] + f'"{m.group(1)}x"' + line[m.end():], f'"{m.group(1)}"+x'))
        elif op == "cmp":
            for a, b in CMP.items():
                k = line.find(a)
                if k >= 0 and not (a in (" < ", " > ") and ("<" in line[k + 3:k + 4])):
                    out.append((i, line[:k] + b + line[k + len(a):], f"{a.strip()}->{b.strip()}"))
        elif op == "arith":
            for a, b in ARITH.items():
                k = line.find(a)
                if k >= 0:
                    out.append((i, line[:k] + b + line[k + len(a):], f"{a.strip()}->{b.strip()}"))
        elif op == "bool":
            t, f_ = lang.bool_words
            for a, b in ((t, f_), (f_, t)):
                for m in re.finditer(rf"\b{a}\b", line):
                    out.append((i, line[:m.start()] + b + line[m.end():], f"{a}->{b}"))
        elif op == "retnull" and lang.retnull:
            m = re.search(lang.retnull[0], line)
            if m:
                out.append((i, line[:m.start()] + lang.retnull[1] + line[m.end():], "return->null"))
    if op == "rename":
        for i, line in _code_lines(lang, text):
            for rx in lang.rename_res:
                m = re.search(rx, line)
                if m and m.group(1) not in ("main", "constructor", "if", "for", "while", "switch", "catch",
                                             "return", "new", "init", "fmt", "default"):
                    out.append((i, line[:m.start(1)] + m.group(1) + "Renamed" + line[m.end(1):],
                                f"rename {m.group(1)}"))
                    break
    return out


def _single(lang: Lang, rng: random.Random, pool: list[str], ops: list[str], kind: str, data=False):
    for _ in range(200):
        path = rng.choice(pool)
        op = rng.choice(ops)
        text = read(path)
        cands = _candidates(lang, op, text, data)
        if not cands:
            continue
        i, new_line, label = rng.choice(cands)
        lines = text.split("\n")
        lines[i] = new_line
        after = "\n".join(lines)
        if after == text:
            continue
        return {"kind": kind, "desc": f"{path}:{i + 1} {op} {label}",
                "edits": [{"op": "M", "path": path, "before": text, "after": after}]}
    return None


def generate(lang: Lang, seed: int = 7) -> list[dict]:
    rng = random.Random(seed)
    src = lang.source_files() if hasattr(lang, "source_files") else files(*lang.source_globs)
    helpers = files(*lang.helper_globs)
    src = [s for s in src if s not in helpers]
    data = files(*lang.data_globs)
    config = files(*lang.config_globs)
    tests = lang.units()
    code_ops = ["num", "num", "str", "cmp", "cmp", "arith", "bool", "rename", "rename"]
    if lang.retnull:
        code_ops.append("retnull")
    muts: list[dict] = []
    seen = set()

    def add(m):
        if m and m["desc"] not in seen:
            seen.add(m["desc"])
            muts.append(m)
            return True
        return False

    plan = [("code", src, code_ops, False, 36), ("helper", helpers, code_ops, False, 5),
            ("data", data, ["num", "str"], True, 8), ("config", config, ["num", "str"], True, 5),
            ("test-edit", tests, ["num", "str"], False, 2)]
    singles = []
    for kind, pool, ops, is_data, n in plan:
        if not pool:
            continue
        got, tries = 0, 0
        while got < n and tries < n * 20:
            tries += 1
            m = _single(lang, rng, pool, ops, kind, is_data)
            if add(m):
                got += 1
                if kind in ("code", "helper", "data", "config"):
                    singles.append(m)
    for path in rng.sample(src, 2):
        add({"kind": "delete", "desc": f"delete {path}",
             "edits": [{"op": "D", "path": path, "before": read(path), "after": None}]})
    for desc, path, content in lang.add_specials():
        add({"kind": "add", "desc": desc, "edits": [{"op": "A", "path": path, "before": None, "after": content}]})
    multi = 0
    while multi < 12:
        k = rng.choice((2, 2, 3))
        parts = rng.sample(singles, k)
        paths = [p["edits"][0]["path"] for p in parts]
        if len(set(paths)) < k:
            continue
        edits = [p["edits"][0] for p in parts]
        if add({"kind": "multi", "desc": " + ".join(p["desc"] for p in parts), "edits": edits}):
            multi += 1
    return muts


def apply(m: dict) -> None:
    for e in m["edits"]:
        p = os.path.join(ROOT, e["path"])
        if e["after"] is None:
            os.remove(p)
        else:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w") as f:
                f.write(e["after"])


def revert(m: dict) -> None:
    for e in reversed(m["edits"]):
        p = os.path.join(ROOT, e["path"])
        if e["before"] is None:
            os.remove(p)
            d = os.path.dirname(p)
            while d != ROOT and not os.listdir(d):
                os.rmdir(d)
                d = os.path.dirname(d)
        else:
            with open(p, "w") as f:
                f.write(e["before"])
