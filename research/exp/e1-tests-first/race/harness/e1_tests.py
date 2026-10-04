"""E1 helpers shared by the race policy (policy_e1.py) and the offline analysis (e1_analyze.py).

- ``TEST_FILE``: the paths ``node --test`` picks up by default (what counts as a test file).
- ``junit_cases``: every test case from node's junit reporter, with its full name (suite path > case) and a
  status of pass, fail or skip (``harness.ci.parse_junit`` keeps only the leaf name and counts skips as passes).
- ``load_error``: why a test file could not load, from the spec reporter's output.
- ``judge_proof``: the fail-first verdict for one test-author file on the snapshot a task starts from.
"""
from __future__ import annotations

import os
import posixpath
import re
import xml.etree.ElementTree as ET

# node --test default patterns (Node 25, type stripping on): **/*.test.*, *-test.*, *_test.*, test-*.*, test.*, test/**
TEST_FILE = re.compile(r"(^|/)([^/]*[._-]test|test[-_][^/]*|test)\.(c|m)?[jt]s$|(^|/)test/[^/]+\.(c|m)?[jt]s$")
SUPPORT_FILE = re.compile(r"(^|/)(testing|test[-_]?utils?|fixtures?|helpers?)\.(c|m)?[jt]s$")

VACUOUS_TEST = ("import assert from 'node:assert/strict';\nimport { test } from 'node:test';\n\n"
                "test('a test that proves nothing (replay fixture)', () => {\n  assert.ok(true);\n});\n")


def is_test_file(path: str) -> bool:
    return bool(TEST_FILE.search(path)) and "node_modules/" not in path


def junit_cases(xml_path: str, root: str) -> list[dict] | None:
    """[{file, name, status, message}] for every test case; None when the report is missing or unreadable."""
    try:
        tree = ET.parse(xml_path)
    except (OSError, ET.ParseError):
        return None
    root_real = os.path.realpath(root)
    out: list[dict] = []

    def rel(f: str) -> str:
        if f.startswith("file://"):
            f = f[7:]
        return os.path.relpath(os.path.realpath(f), root_real).replace(os.sep, "/") if f else ""

    def walk(node: ET.Element, prefix: list[str]) -> None:
        for child in node:
            if child.tag == "testsuite":
                walk(child, prefix + [child.get("name", "")])
            elif child.tag == "testcase":
                fail = child.find("failure")
                if fail is None:
                    fail = child.find("error")
                status = "fail" if fail is not None else "skip" if child.find("skipped") is not None else "pass"
                msg = ""
                if fail is not None:
                    msg = (fail.get("message") or (fail.text or "")).strip()[:300]
                out.append({"file": rel(child.get("file") or ""), "name": " > ".join(prefix + [child.get("name", "")]),
                            "status": status, "message": msg})

    walk(tree.getroot(), [])
    return out


def is_load_failure(path: str, cases: list[dict]) -> bool:
    """node reports a file that cannot load as one failing case named after the file ("test failed")."""
    if len(cases) != 1 or cases[0]["status"] != "fail":
        return False
    name = cases[0]["name"].split(" > ")[-1]
    return name.endswith(os.path.basename(path)) and cases[0]["message"] == "test failed"


def load_error(output: str) -> tuple[str, dict]:
    """Classify a load failure from the spec reporter output: (kind, detail).
    kind: missing-module | missing-package | missing-export | syntax | runtime."""
    m = re.search(r"Cannot find package '([^']+)'", output)
    if m:
        return "missing-package", {"package": m.group(1)}
    m = re.search(r"Cannot find module '([^']+)' imported from (\S+)", output)
    if m:
        return "missing-module", {"module": m.group(1), "from": m.group(2)}
    m = re.search(r"The requested module '([^']+)' does not provide an export named '([^']+)'", output)
    if m:
        return "missing-export", {"module": m.group(1), "name": m.group(2)}
    if "ERR_INVALID_TYPESCRIPT_SYNTAX" in output or "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX" in output \
            or re.search(r"^SyntaxError", output, re.M):
        line = next((ln for ln in output.splitlines() if "SyntaxError" in ln), "SyntaxError")
        return "syntax", {"error": line.strip()[:300]}
    line = next((ln for ln in output.splitlines() if re.match(r"^\w*Error\b", ln.strip())), "")
    return "runtime", {"error": line.strip()[:300]}


def _resolve(test_path: str, spec: str, root: str) -> str:
    if spec.startswith("/"):
        try:
            return os.path.relpath(os.path.realpath(spec), os.path.realpath(root)).replace(os.sep, "/")
        except ValueError:
            return spec
    if spec.startswith("file://"):
        return _resolve(test_path, spec[7:], root)
    return posixpath.normpath(posixpath.join(posixpath.dirname(test_path), spec))


def _named(issue_text: str, ident: str) -> bool:
    ident = ident.strip()
    if not ident:
        return False
    return re.search(rf"(?<![A-Za-z0-9_]){re.escape(ident)}(?![A-Za-z0-9_])", issue_text) is not None


def judge_proof(path: str, cases: list[dict] | None, output: str, root: str, issue_text: str,
                created_other: list[str], timed_out: bool = False) -> tuple[str, str]:
    """Fail-first verdict for one new test file run on the task's snapshot: (status, why).

    status: fails-first (accepted) | vacuous (every test passes: proves nothing) | broken (cannot load, or
    depends on something the implementer cannot be asked to provide)."""
    if timed_out:
        return "broken", "the file timed out"
    if not cases:
        return "broken", "no test ran (no report)"
    if is_load_failure(path, cases):
        kind, d = load_error(output)
        if kind == "missing-package":
            return "broken", f"imports the package '{d['package']}', which the repo does not have (use node:test)"
        if kind == "syntax":
            return "broken", f"does not load: {d['error']}"
        if kind == "missing-module":
            target = _resolve(path, d["module"], root)
            if target in created_other:
                return "broken", f"imports {target}, a helper you created; only new test files are kept"
            if SUPPORT_FILE.search(target):
                return "broken", f"imports {target}, a test helper that does not exist"
            base = posixpath.basename(target)
            stem = re.sub(r"\.(c|m)?[jt]s$", "", base)
            if not (_named(issue_text, base) or _named(issue_text, stem)):
                return "broken", f"imports {target}, a module the issue does not name"
            return "fails-first", f"the module {target} named by the issue does not exist yet"
        if kind == "missing-export":
            target = _resolve(path, d["module"], root)
            if SUPPORT_FILE.search(target) or is_test_file(target):
                return "broken", (f"imports '{d['name']}' from the test helper {target}, which does not export it; "
                                  "existing files are not kept, so keep helpers inside the test file")
            if not _named(issue_text, d["name"]):
                return "broken", f"imports '{d['name']}' from {target}, a name the issue does not give"
            return "fails-first", f"the export '{d['name']}' named by the issue does not exist yet"
        return "fails-first", f"fails while loading: {d.get('error') or kind}"
    fails = [c for c in cases if c["status"] == "fail"]
    passes = [c for c in cases if c["status"] == "pass"]
    if fails:
        return "fails-first", f"{len(fails)} of {len(cases)} tests fail on the current code"
    if passes:
        return "vacuous", f"all {len(passes)} tests pass on the current code, so they prove nothing about the issue"
    return "broken", "every test is skipped"
