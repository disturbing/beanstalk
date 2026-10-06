#!/usr/bin/env python3
"""Solo-solvability pilot (doc 17 §2.4 step 5): one Codex agent per task, alone on the base, one try.

Each task gets a fresh clone of the arena repository's main (no later upstream commit is reachable), its acceptance
tests written in, and the race's initial prompt (harness/prompts.py) through the race's Codex adapter
(harness/agents.py: ``codex exec``, user config ignored, loopback-only network for this arena). Afterwards the
acceptance tests are restored and the whole suite runs: the task is solved when it is green. At most --parallel
agents run at once. Results go to <arena>/solvability.json (merged with earlier runs; finished tasks are skipped
unless --redo). Rate-limit and usage-limit messages from the CLI are recorded per task.

Usage:
  python3 solvability.py fastify --model gpt-6.1-sol --effort medium --parallel 4 [--tasks t001,t002]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import shutil
import subprocess
import sys
import time

import realarena as R
from harness import prompts, suite as suite_mod  # noqa: E402 (realarena puts research/race on sys.path)
from harness.agents import CodexAdapter, InvocationSpec  # noqa: E402
from harness.arena import load_tasks  # noqa: E402
from harness.procs import ProcRegistry, Runner, Sandbox  # noqa: E402

LIMIT_RE = re.compile(r"rate.?limit|usage.?limit|too many requests|\b429\b|quota|try again (?:in|at)", re.I)


def limit_messages(*paths: str) -> list[str]:
    found = []
    for path in paths:
        try:
            with open(path, encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    if LIMIT_RE.search(line) and ('"type":"error"' in line or '"turn.failed"' in line
                                                  or not line.startswith("{")):
                        found.append(line.strip()[:400])
        except OSError:
            pass
    return found[:5]


async def solve(task, a: R.Arena, root: str, adapter: CodexAdapter, timeout: float, sem: asyncio.Semaphore) -> dict:
    async with sem:
        wt = os.path.join(root, "work", task.id)
        shutil.rmtree(wt, ignore_errors=True)
        R.git("clone", "-q", "--no-local", "--single-branch", "--branch", "main", "--no-tags", a.suite.repo, wt,
              cwd=root)
        R.git("remote", "remove", "origin", cwd=wt)
        for path, content in task.acceptance_tests.items():
            full = os.path.join(wt, path)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "w", encoding="utf-8") as fh:
                fh.write(content)
        spec = InvocationSpec(inv_id=f"solo-{task.id}", kind="initial", task_id=task.id, agent_id="solo", cwd=wt,
                              prompt=prompts.initial(task), timeout=timeout)
        t0 = time.monotonic()
        print(f"{time.strftime('%H:%M:%S')} {task.id} start: {task.title[:70]}", flush=True)
        res = await adapter.run(spec)
        agent_s = time.monotonic() - t0
        for path, content in task.acceptance_tests.items():  # protected, as in the race
            with open(os.path.join(wt, path), "w", encoding="utf-8") as fh:
                fh.write(content)
        changed = R.git("status", "--porcelain", cwd=wt).stdout.splitlines()
        run = await asyncio.to_thread(R.run_suite, a.suite, wt, os.path.join(root, "work", f"{task.id}.junit.xml"))
        if not run.green:  # one retry, as the build does, for a flaky red
            run = await asyncio.to_thread(R.run_suite, a.suite, wt, os.path.join(root, "work", f"{task.id}.junit.xml"))
        acc = {p for p in task.acceptance_tests}
        limits = limit_messages(res.transcript or "", os.path.join(adapter.transcripts, f"{spec.inv_id}.stderr"))
        row = {"task": task.id, "pr": None, "title": task.title, "solved": run.green,
               "acceptance_green": not (set(run.failing_files) & acc), "failing": run.failing_files[:10],
               "agent_seconds": round(agent_s, 1), "suite_seconds": round(run.seconds, 1),
               "exit_code": res.exit_code, "timed_out": res.timed_out, "infra_error": (res.infra_error or "")[:600],
               "items": res.num_turns, "tools": res.tool_uses, "usage": res.usage,
               "files_changed": [ln[3:] for ln in changed if ln[3:] not in acc],
               "limit_messages": limits, "finished": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
        print(f"{time.strftime('%H:%M:%S')} {task.id} {'SOLVED' if run.green else 'failed'} in {agent_s:.0f}s "
              f"(suite {run.seconds:.0f}s){' LIMIT: ' + limits[0][:120] if limits else ''}"
              f"{' infra: ' + row['infra_error'][:120] if row['infra_error'] else ''}", flush=True)
        shutil.rmtree(wt, ignore_errors=True)
        return row


async def main_async(ns) -> int:
    a = R.load(ns.arena if os.sep in ns.arena else os.path.join(R.HERE, ns.arena))
    cfg = a.suite
    suite_mod.activate(cfg)
    root = os.path.join(R.HERE, ".work", a.name, "solo")
    os.makedirs(os.path.join(root, "work"), exist_ok=True)
    link = os.path.join(root, "work", "node_modules")
    if not os.path.lexists(link):
        os.symlink(cfg.deps, link)
    out_path = a.path("solvability.json")
    done: dict = {}
    if os.path.exists(out_path):
        with open(out_path, encoding="utf-8") as fh:
            done = {r["upstream_pr"]: r for r in json.load(fh)["results"]}
    tasks = load_tasks(a.dir, [ns.tasks] if ns.tasks else None, app_prefix=False)
    prs = {}
    for t in tasks:
        with open(a.path("tasks", f"{t.id}.json"), encoding="utf-8") as fh:
            prs[t.id] = json.load(fh)["upstream"]["pr"]
    todo = [] if ns.report_only else [t for t in tasks if ns.redo or prs[t.id] not in done]
    runner = Runner(Sandbox(root), ProcRegistry())
    adapter = CodexAdapter(runner, model=ns.model, timeout=ns.timeout, transcripts=os.path.join(root, "transcripts"),
                           effort=ns.effort)
    sem = asyncio.Semaphore(ns.parallel)
    print(f"{len(todo)} of {len(tasks)} tasks to try, {ns.parallel} at a time, {ns.model} effort {ns.effort}",
          flush=True)
    version = subprocess.run(["codex", "--version"], capture_output=True, text=True).stdout.strip()

    current = {pr: (t.id, t.order) for t in tasks for pr in [prs[t.id]]}

    def save() -> None:
        # rows are keyed by upstream PR: after the arena is rebuilt (unsolved tasks dropped, ids renumbered) the
        # same PR keeps its result, under its current id; a PR no longer in the arena keeps its row, marked
        for r in done.values():
            r["task"], r["in_arena"] = (current[r["upstream_pr"]][0], True) if r["upstream_pr"] in current \
                else (None, False)
        rows = sorted(done.values(), key=lambda r: (r["merged_at"] or "", r["upstream_pr"]))
        solved = sum(1 for r in rows if r["solved"])
        times = sorted(r["agent_seconds"] for r in rows)
        rec = {"model": ns.model, "effort": ns.effort, "codex_cli": version, "parallel": ns.parallel,
               "tries_per_task": 1, "tasks_tried": len(rows), "solved": solved,
               "pass_rate": round(solved / len(rows), 3) if rows else 0,
               "agent_seconds_median": times[len(times) // 2] if times else None,
               "limit_messages": sorted({m for r in rows for m in r["limit_messages"]})[:10],
               "arena_tasks": len(current), "arena_tasks_solved": sum(1 for r in rows if r["in_arena"] and r["solved"]),
               "dropped_unsolved": [r["upstream_pr"] for r in rows if not r["solved"]],
               "results": rows}
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(rec, fh, indent=1)
            fh.write("\n")

    async def one(t):
        row = await solve(t, a, root, adapter, ns.timeout, sem)
        row["pr"] = row["upstream_pr"] = prs[t.id]
        with open(a.path("tasks", f"{t.id}.json"), encoding="utf-8") as fh:
            row["merged_at"] = json.load(fh)["upstream"].get("merged_at")
        row["model"], row["effort"] = ns.model, ns.effort
        done[prs[t.id]] = row
        save()

    await asyncio.gather(*(one(t) for t in todo))
    save()
    rows = list(done.values())
    print(f"solved {sum(r['solved'] for r in rows)} of {len(rows)}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], epilog=__doc__.split("\n\n", 1)[1],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("arena")
    ap.add_argument("--model", default="gpt-6.1-sol")
    ap.add_argument("--effort", default="medium")
    ap.add_argument("--parallel", type=int, default=4)
    ap.add_argument("--timeout", type=float, default=1800, help="seconds per agent")
    ap.add_argument("--tasks", help="comma-separated task ids (default: all)")
    ap.add_argument("--redo", action="store_true", help="retry tasks that already have a result")
    ap.add_argument("--report-only", action="store_true", help="no agents: relabel the results to the current ids")
    ns = ap.parse_args()
    if ns.parallel > 4:
        raise SystemExit("--parallel above 4 is refused: the Codex subscription's quota is shared")
    return asyncio.run(main_async(ns))


if __name__ == "__main__":
    sys.exit(main())
