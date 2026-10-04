#!/usr/bin/env python3
"""One-session timing probe: run the race harness's own Claude adapter on tasks, one at a time, no integration.

Measures what a bean costs and how long it takes to write (wall, turns, tokens, tool calls), so that task
length can be calibrated before any race is paid for. Same flags, tools and prompt as a race's initial
invocation. One session at a time; not a race.

Usage: python3 probe_agent.py --arena arena-long --repo corpora/arena-long.git --tasks L01 L02 [--max-turns 80]
Output: a table on stdout and probe.json in --out (default: a scratch dir).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "race"))

from harness import prompts  # noqa: E402
from harness.agents import ClaudeAdapter, InvocationSpec  # noqa: E402
from harness.arena import load_tasks  # noqa: E402
from harness.procs import ProcRegistry, Runner, Sandbox  # noqa: E402


def sh(*argv: str, cwd: str) -> subprocess.CompletedProcess:
    return subprocess.run(argv, cwd=cwd, capture_output=True, text=True,
                          env=dict(os.environ, GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_SYSTEM=os.devnull))


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--arena", required=True)
    ap.add_argument("--repo", required=True)
    ap.add_argument("--tasks", nargs="+", required=True)
    ap.add_argument("--model", default="sonnet")
    ap.add_argument("--max-turns", type=int, default=80)
    ap.add_argument("--timeout", type=float, default=1200)
    ap.add_argument("--budget", type=float, default=1.5, help="per-session cap, USD")
    ap.add_argument("--out", default=os.path.join(HERE, "data", "probe"))
    a = ap.parse_args()
    out = os.path.abspath(a.out)
    os.makedirs(out, exist_ok=True)
    tasks = {t.id: t for t in load_tasks(os.path.abspath(a.arena), a.tasks, app_prefix=True)}
    reg = ProcRegistry()
    runner = Runner(Sandbox(out), reg)
    adapter = ClaudeAdapter(runner, model=a.model, max_turns=a.max_turns, timeout=a.timeout,
                            transcripts=os.path.join(out, "transcripts"), output_format="stream-json",
                            persist_sessions=False)
    rows = []
    for tid in a.tasks:
        t = tasks[tid]
        wt = os.path.join(out, "work", tid)
        shutil.rmtree(wt, ignore_errors=True)
        os.makedirs(os.path.dirname(wt), exist_ok=True)
        sh("git", "clone", "-q", "--no-local", "--single-branch", "--branch", "main", "--no-tags",
           os.path.abspath(a.repo), wt, cwd=out)
        sh("git", "remote", "remove", "origin", cwd=wt)
        for path, content in t.acceptance_tests.items():
            full = os.path.join(wt, path)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "w", encoding="utf-8") as fh:
                fh.write(content)
        spec = InvocationSpec(inv_id=f"probe-{tid}", kind="initial", task_id=tid, agent_id="p0", cwd=wt,
                              prompt=prompts.initial(t), budget_cap_usd=a.budget)
        t0 = time.monotonic()
        res = await adapter.run(spec, None)
        wall = time.monotonic() - t0
        suite = subprocess.run(["node", "--test", "--test-reporter=spec"], cwd=wt, capture_output=True, text=True,
                               env=dict(os.environ, NO_COLOR="1"))
        accept = subprocess.run(["node", "--test", *sorted(t.acceptance_tests)], cwd=wt, capture_output=True,
                                text=True, env=dict(os.environ, NO_COLOR="1"))
        status = sh("git", "status", "--porcelain", cwd=wt).stdout.split("\n")
        changed = [ln[3:] for ln in status if ln.strip()]
        row = {"task": tid, "members": len(t.id), "wall_s": round(wall, 1), "turns": res.num_turns,
               "cost_usd": round(res.cost_usd, 4), "output_tokens": res.usage.get("output_tokens"),
               "tools": res.tool_uses, "subtype": res.subtype, "acceptance_pass": accept.returncode == 0,
               "suite_pass": suite.returncode == 0, "files_changed": len(changed), "changed": changed,
               "infra_error": res.infra_error}
        rows.append(row)
        print(json.dumps({k: v for k, v in row.items() if k != "changed"}), flush=True)
    with open(os.path.join(out, "probe.json"), "w") as fh:
        json.dump(rows, fh, indent=1)
    await reg.kill_all()
    print(f"total cost ${sum(r['cost_usd'] for r in rows):.3f}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
