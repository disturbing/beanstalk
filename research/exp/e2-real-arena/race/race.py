#!/usr/bin/env python3
"""Race real headless coding agents on the arena under two integration policies.

  queue      a good batched merge queue: speculative batches of k PRs on K CI slots, bisection on red
  beanstalk  placement by predicted footprint + a non-blocking fast trunk + an asynchronous validator
             that opens causal repair tickets for fixer agents, with an error budget

Both policies share the tasks, N concurrent agent sessions, K CI slots and S seconds of emulated CI
latency per validation run. Agents: ``claude`` (headless Claude Code, ``claude -p``), ``codex``
(``codex exec``), or ``replay`` (applies the arena's reference patches after a seeded lognormal delay;
free, used for development and as a control).

Outputs in --out (relative paths resolve against research/race/): events.jsonl, summary.json,
summary.md, config.json; agent worktrees, CI checkouts and transcripts in work/ (git-ignored).
Exit status: 0 done, 2 aborted on budget, 3 aborted otherwise (error, signal, wall-clock limit).

Examples:
  python3 race.py --dry-run --policy beanstalk --agent claude --model sonnet --out runs/check
  python3 race.py --policy queue --agent replay --agents 8 --ci-slots 4 --batch 4 --ci-seconds 4.5 \\
      --replay-median 6 --seed 1 --out runs/replay-q          # free control, 1/40 time scale
  python3 race.py --policy beanstalk --agent claude --model sonnet --agents 8 --ci-slots 4 \\
      --ci-seconds 180 --seed 1 --budget-usd 40 --max-turns 50 --agent-timeout 1200 --out runs/bs-sonnet-8
  python3 race.py --reap --out runs/bs-sonnet-8               # only after a SIGKILLed race
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import signal
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from harness.core import RaceConfig, resolve_out  # noqa: E402

DEFAULT_ARENA = os.path.normpath(os.path.join(HERE, "..", "arena"))
DEFAULT_REPO = os.path.normpath(os.path.join(HERE, "..", "corpora", "arena.git"))


def parse_args(argv: list[str] | None = None) -> RaceConfig:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], epilog=__doc__.split("\n\n", 1)[1],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_argument_group("race")
    g.add_argument("--policy", choices=["queue", "beanstalk", "beanstalk-preland", "beanstalk-v2"], required=True)
    g.add_argument("--agent", choices=["claude", "codex", "replay"], default="replay")
    g.add_argument("--agents", type=int, default=4, help="concurrent agent sessions N (default 4)")
    g.add_argument("--model", help="agent model (claude default: sonnet; codex default: its own default)")
    g.add_argument("--ci-seconds", type=float, default=60.0, help="emulated CI latency S added to every run (60)")
    g.add_argument("--ci-slots", type=int, default=2, help="concurrent CI runs K (2)")
    g.add_argument("--batch", type=int, default=4, help="queue batch size k (4; 1 = serial queue)")
    g.add_argument("--batch-wait", type=float, default=0.0,
                   help="queue: wait up to this many seconds for k PRs before starting a partial batch (0)")
    g.add_argument("--tasks", nargs="+", help="task ids (t001 t002 or t001,t002) or a count (first N)")
    g.add_argument("--budget-usd", type=float, default=25.0, help="abort cleanly at this total agent cost (25)")
    g.add_argument("--max-turns", type=int, default=40, help="per-invocation turn cap (40)")
    g.add_argument("--agent-timeout", type=float, default=900.0, help="per-invocation timeout seconds (900)")
    g.add_argument("--seed", type=int, default=0, help="seeds replay delays and --shuffle (0)")
    g.add_argument("--out", default="runs/dev", help="run directory (default runs/dev)")
    g.add_argument("--force", action="store_true", help="replace an existing run directory")
    g.add_argument("--dry-run", action="store_true",
                   help="check the arena, the agent CLI and the plan without invoking agents")
    g.add_argument("--reap", action="store_true",
                   help="kill processes left by a SIGKILLed race in --out (Ctrl-C/SIGTERM clean up themselves)")
    a = ap.add_argument_group("arena")
    a.add_argument("--arena", default=DEFAULT_ARENA, help="arena directory with tasks/ and solutions/")
    a.add_argument("--repo", default=DEFAULT_REPO, help="materialized arena repository (main = base)")
    a.add_argument("--shuffle", action="store_true", help="seeded shuffle of task priority (default: id order)")
    b = ap.add_argument_group("beanstalk")
    b.add_argument("--footprint", choices=["auto", "predictor", "lexical", "combined", "haiku"], default="auto",
                   help="auto = footprint-prediction/predictor.py if present, else lexical; combined = per-module "
                        "max of both; haiku = claude -p classifier (costs money)")
    b.add_argument("--footprint-threshold", type=float, default=0.3,
                   help="select modules with p >= this (top-1 if none); default 0.3")
    b.add_argument("--classifier-model", default="haiku", help="model for --footprint haiku (haiku)")
    b.add_argument("--error-budget", type=int, default=3, help="pause new starts while open reds exceed B (3)")
    b.add_argument("--snapshot", choices=["green", "head"], default="green",
                   help="tasks fork from the newest validated commit (green) or the fast-trunk head")
    b.add_argument("--max-fix-attempts", type=int, default=2, help="fixer attempts per ticket before escalation")
    q = ap.add_argument_group("queue")
    q.add_argument("--queue-hold", action=argparse.BooleanOptionalAction, default=True,
                   help="author agent waits for its PR to land (default) instead of taking new work")
    s = ap.add_argument_group("shared")
    s.add_argument("--merge-drivers", choices=["auto", "union", "none"], default="auto",
                   help="CHANGELOG merge=union: auto = beanstalk only")
    s.add_argument("--protect-tests", choices=["own", "landed"], default="own",
                   help="restore only the task's own acceptance tests before committing agent work (own), or also "
                        "every landed task's (landed: a test-integrity rule applied to both policies)")
    s.add_argument("--max-rework", type=int, default=3, help="rework rounds per task before it is dropped")
    s.add_argument("--suite-timeout", type=float, default=300.0, help="kill a CI suite run after this (300 s)")
    s.add_argument("--max-wall-minutes", type=float, default=360.0, help="abort the race after this (360)")
    s.add_argument("--max-invocation-usd", type=float, default=3.0, help="per-invocation cap (claude --max-budget-usd)")
    s.add_argument("--infra-retry-seconds", type=float, default=10.0,
                   help="backoff before re-running an invocation that produced no result (x attempt; 2 retries)")
    c = ap.add_argument_group("agents")
    c.add_argument("--effort", help="claude --effort / codex model_reasoning_effort")
    c.add_argument("--claude-bin", default="claude", help="Claude Code CLI (tests use tests/fake_claude.py)")
    c.add_argument("--codex-bin", default="codex", help="Codex CLI")
    c.add_argument("--output-format", choices=["stream-json", "json"], default="stream-json",
                   help="claude output; stream-json keeps transcripts and running cost (same final result object)")
    c.add_argument("--rework-resume", action=argparse.BooleanOptionalAction, default=True,
                   help="claude rework resumes the author's session (--resume) with the follow-up prompt")
    c.add_argument("--codex-price", default="1.25,0.125,10",
                   help="codex cost estimate, USD per MTok: input,cached_input,output")
    r = ap.add_argument_group("replay")
    r.add_argument("--replay-median", type=float, default=20.0, help="median seconds per initial invocation")
    r.add_argument("--replay-sigma", type=float, default=0.5, help="lognormal sigma")
    r.add_argument("--replay-cost-usd", type=float, default=0.0, help="synthetic cost per invocation (budget tests)")
    ns = ap.parse_args(argv)
    cfg = RaceConfig(**{k: v for k, v in vars(ns).items() if k in RaceConfig.__dataclass_fields__ and k != "codex_price"})
    cfg.codex_price = tuple(float(x) for x in ns.codex_price.split(","))
    cfg.arena = os.path.abspath(ns.arena)
    cfg.repo = os.path.abspath(ns.repo)
    for attr in ("claude_bin", "codex_bin"):  # agents run with cwd = their worktree
        if os.sep in getattr(cfg, attr):
            setattr(cfg, attr, os.path.abspath(getattr(cfg, attr)))
    return cfg


def make_race(cfg: RaceConfig):
    if cfg.policy == "queue":
        from harness.policy_queue import QueueRace
        return QueueRace(cfg)
    if cfg.policy == "beanstalk-v2":  # pre-land + informed repair + decision cards + revert-first (policy_beanstalk_v2.py)
        from harness.policy_beanstalk_v2 import BeanstalkV2Race
        cfg.policy = "beanstalk"
        return BeanstalkV2Race(cfg)
    if cfg.policy == "beanstalk-preland":  # beanstalk + pre-land check (harness/policy_beanstalk_preland.py)
        from harness.policy_beanstalk_preland import BeanstalkPrelandRace
        cfg.policy = "beanstalk"
        return BeanstalkPrelandRace(cfg)
    from harness.policy_beanstalk import BeanstalkRace
    return BeanstalkRace(cfg)


def dry_run(cfg: RaceConfig) -> int:
    """No agents: check the arena (patches apply, acceptance tests fail on base and pass with the
    reference solution), the agent CLI, footprints and placement order; print the agent command."""
    from harness.dryrun import run_dry
    report = asyncio.run(run_dry(cfg))
    print(json.dumps({k: v for k, v in report.items() if k not in ("tasks",)}, indent=2, default=str))
    return 0 if report.get("ok") else 1


def main(argv: list[str] | None = None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    if "--reap" in argv:
        ns = argparse.ArgumentParser(add_help=False)
        ns.add_argument("--out", default="runs/dev")
        out = resolve_out(ns.parse_known_args(argv)[0].out)
        from harness.procs import reap
        killed = reap(os.path.join(out, "work", "live_pids.txt"), os.path.join(out, "work"))
        print(f"reaped {len(killed)} process(es) under {out}/work: {killed}")
        return 0
    cfg = parse_args(argv)
    if cfg.agents < 1 or cfg.ci_slots < 1 or cfg.batch < 1:
        print("--agents, --ci-slots and --batch must be at least 1", file=sys.stderr)
        return 1
    if cfg.agent != "replay" and not shutil.which(cfg.claude_bin if cfg.agent == "claude" else cfg.codex_bin):
        print(f"{cfg.agent} CLI not found on PATH", file=sys.stderr)
        return 1
    if cfg.dry_run:
        return dry_run(cfg)
    race = make_race(cfg)

    async def go() -> int:
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, lambda s=sig: race.abort(f"signal {signal.Signals(s).name}"))
            except (NotImplementedError, RuntimeError):
                pass
        return await race.run()

    try:
        code = asyncio.run(go())
    finally:
        race.registry.kill_all_sync()
    out = resolve_out(cfg.out)
    try:
        with open(os.path.join(out, "summary.md")) as fh:
            print(fh.read())
    except OSError:
        pass
    return code


if __name__ == "__main__":
    sys.exit(main())
