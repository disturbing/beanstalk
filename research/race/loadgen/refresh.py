#!/usr/bin/env python3
"""Recompute a finished run's derived numbers: Beanstalk engine statistics from ``engine-events.jsonl`` (fetched
with ``--fetch`` from the gateway when missing; an engine's log outlives its closing), and final correctness with
the chain-end rule for committed acceptance tests (needs the run's ``work/repo``). Rewrites summary.json and .md.

  python3 -m loadgen.refresh runs/lg-fastify-8-s7-beanstalk [--fetch --gateway URL --dev-vars PATH]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from loadgen.forges import engine_ci  # noqa: E402
from loadgen.report import write_md  # noqa: E402


def recheck_final(run: str, s: dict, arena: str) -> None:
    f = s.get("final") or {}
    repo = os.path.join(run, "work", "repo")
    if not f or not os.path.isdir(repo):
        return
    with open(os.path.join(run, "events.jsonl"), encoding="utf-8") as fh:
        chain_end = json.loads(fh.readline()).get("chain_end")
    intact = True
    for tid, v in f["per_task"].items():
        if v["status"] != "integrated":
            continue
        with open(os.path.join(arena, "tasks", f"{tid}.json"), encoding="utf-8") as fh:
            task = json.load(fh)
        ok = True
        for p, content in task["acceptance_tests"].items():
            r = subprocess.run(["git", "show", f"{f['sha']}:{p}"], cwd=repo, capture_output=True, text=True)
            c = subprocess.run(["git", "show", f"{chain_end}:{p}"], cwd=repo, capture_output=True, text=True)
            ok = ok and r.returncode == 0 and r.stdout in (content, c.stdout)
        v["committed_tests"] = ok
        intact = intact and ok
    integ = [t for t, v in f["per_task"].items() if v["status"] == "integrated"]
    f["correct"] = bool(f["suite_green"] and intact and all(f["per_task"][t]["acceptance_pass"] for t in integ))


def rerun_final(run: str, s: dict, arena: str) -> None:
    """Run the final check again on the run's final commit (``Driver.final_check``, with its lock and retries)."""
    from harness import suite as suite_mod
    from harness.gitops import Git
    from harness.procs import ProcRegistry, Runner, Sandbox
    from loadgen.changes import ChangeBook
    from loadgen.driver import ChangeRun, Driver, Options
    from loadgen.schedule import Schedule
    out = os.path.abspath(run)
    d = Driver(Options(arena=arena, repo="", out=out, workers=1, schedule=Schedule("closed", 0)), None)
    d.work = os.path.join(out, "work")
    d.runner = Runner(Sandbox(out), ProcRegistry())
    d.suite = suite_mod.load_suite(arena)
    suite_mod.activate(d.suite)
    d.git = Git(d.runner, os.path.join(d.work, "repo"))
    d.book = ChangeBook(arena, d.git, d.work, mode=s["config"].get("mode", "standalone"))
    with open(os.path.join(run, "events.jsonl"), encoding="utf-8") as fh:
        d.chain_end = json.loads(fh.readline()).get("chain_end")
    for c in s["per_change"]:
        d.changes[c["task"]] = ChangeRun(task=c["task"], worker=c["worker"], status=c["status"])
    # the chain build's per-task commits are not kept; the last one is the chain end
    d.book.changes[d.book.order[-1]].chain_sha = d.chain_end
    previous = s.get("final") or {}
    s["final"] = asyncio.run(d.final_check(previous["sha"]))
    s["final"]["rerun_of"] = {k: previous.get(k) for k in ("suite_green", "suite_failing_files", "correct")}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("runs", nargs="+")
    ap.add_argument("--fetch", action="store_true")
    ap.add_argument("--gateway")
    ap.add_argument("--dev-vars")
    ap.add_argument("--rerun-final", action="store_true", help="run the final check again (machine lock, retries)")
    ap.add_argument("--arena", default=os.path.normpath(os.path.join(HERE, "..", "..", "real-arena", "fastify")))
    a = ap.parse_args()
    for run in a.runs:
        path = os.path.join(run, "summary.json")
        with open(path, encoding="utf-8") as fh:
            s = json.load(fh)
        if s["forge"] == "beanstalk":
            ev_path = os.path.join(run, "engine-events.jsonl")
            if not os.path.exists(ev_path) and a.fetch:
                from loadgen.beanstalk import BeanstalkClient, admin_token
                c = BeanstalkClient(a.gateway, admin_token(a.dev_vars), "x", "y")
                c.engine = s["forge_detail"]["engine"]
                events = asyncio.run(c.events())
                with open(ev_path, "w", encoding="utf-8") as fh:
                    for e in events:
                        fh.write(json.dumps(e) + "\n")
            if os.path.exists(ev_path):
                with open(ev_path, encoding="utf-8") as fh:
                    events = [json.loads(line) for line in fh if line.strip()]
                s["forge_detail"].update(engine_ci(events))
                s["ci_minutes"] = s["forge_detail"]["ci_minutes"]
                s["red_validations"] = s["forge_detail"]["red_validations"]
        if a.rerun_final:
            rerun_final(run, s, a.arena)
        else:
            recheck_final(run, s, a.arena)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(s, fh, indent=2, default=str)
        write_md(run, s)
        print(run, "ci_minutes", s.get("ci_minutes"), "correct", (s.get("final") or {}).get("correct"))


if __name__ == "__main__":
    main()
