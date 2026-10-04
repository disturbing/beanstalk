#!/usr/bin/env python3
"""Race real headless coding agents on the arena under two integration policies.

  queue      a good batched merge queue: speculative batches of k PRs on K CI slots, bisection on red
  beanstalk  placement by predicted footprint + a non-blocking fast trunk + an asynchronous validator
             that opens causal repair tickets for fixer agents, with an error budget

Both policies share the tasks, N concurrent agent sessions, K CI slots and S seconds of emulated CI
latency per validation run. Agents: ``claude`` (headless Claude Code, ``claude -p``), ``codex``
(``codex exec``), or ``replay`` (applies the arena's reference patches after a seeded lognormal delay;
free, used for development and as a control).

--forge local (the default) makes every integration decision in this process. --forge cloudflare makes
them in beanstalk's gateway on Cloudflare (--gateway URL; admin token from $BEANSTALK_ADMIN_TOKEN or
packages/gateway/.dev.vars); agents still run here through the same adapters (see REMOTE.md).

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
  python3 race.py --forge cloudflare --gateway https://<gateway> --policy beanstalk-v2 --agent replay \\
      --agents 8 --ci-seconds 4.5 --ci-slots 2 --preland-mode optimistic --preland-seconds 4.5 --out runs/cf-v2
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
    return parse_cli(argv)[0]


def parse_cli(argv: list[str] | None = None) -> tuple[RaceConfig, argparse.Namespace]:
    """The race config plus the options that are not part of it (the forge, the gateway, v2 knobs)."""
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], epilog=__doc__.split("\n\n", 1)[1],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    f = ap.add_argument_group("forge")
    f.add_argument("--forge", choices=["local", "cloudflare"], default="local",
                   help="where integration decisions are made: this process (local, default) or beanstalk's "
                        "Cloudflare gateway (cloudflare; policies queue and beanstalk-v2)")
    f.add_argument("--gateway", help="--forge cloudflare: the gateway's base URL (default $BEANSTALK_GATEWAY)")
    f.add_argument("--live-url", action="store_true",
                   help="--forge cloudflare: print the live page link (it carries a view token) even when stderr "
                        "is not a terminal")
    f.add_argument("--stagger-start", type=float, default=0.0, metavar="SECONDS",
                   help="--forge cloudflare: slot i asks for its first task i x SECONDS after the start, so the gateway "
                        "forks the first beans one at a time instead of all at once (default 0: all at once, as "
                        "locally; staggering changes start times, so compare with care)")
    f.add_argument("--no-auth-probe", action="store_true",
                   help="--forge cloudflare: skip the one-turn Haiku call (about $0.004) a claude race makes before "
                        "it creates the run, to stop early on refused credentials or a rate limit")
    v = ap.add_argument_group("beanstalk-v2 (both forges; default: the env var, else the harness default)")
    v.add_argument("--preland-mode", choices=["optimistic", "locked"],
                   help="pre-land checks in parallel (optimistic) or inside the committer turn ($PRELAND_MODE, locked)")
    v.add_argument("--preland-seconds", type=float,
                   help="emulated latency of a pre-land check ($PRELAND_SECONDS, 0)")
    v.add_argument("--decision-seconds", type=float,
                   help="how long the oracle takes to answer a decision card ($DECISION_SECONDS, 30)")
    v.add_argument("--decision-oracle", choices=["landed", "arriving", "none"],
                   help="who wins a decision card ($DECISION_ORACLE, landed; none waits for the admin, cloud only)")
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
    return cfg, ns


V2_ENV = {"preland_mode": "PRELAND_MODE", "preland_seconds": "PRELAND_SECONDS", "decision_seconds": "DECISION_SECONDS",
          "decision_oracle": "DECISION_ORACLE"}


def v2_flags(ns: argparse.Namespace) -> dict:
    return {k: getattr(ns, k) for k in V2_ENV if getattr(ns, k) is not None}


def make_race(cfg: RaceConfig, v2: dict | None = None):
    """The local race. v2 flags given on the command line become the environment variables the harness reads
    while the race is constructed (unset flags leave the environment, and so the old behaviour, unchanged)."""
    saved = {env: os.environ.get(env) for env in V2_ENV.values()}
    for key, value in (v2 or {}).items():
        os.environ[V2_ENV[key]] = str(value)
    try:
        return _make_race(cfg)
    finally:
        for env, value in saved.items():
            if value is None:
                os.environ.pop(env, None)
            else:
                os.environ[env] = value


def _make_race(cfg: RaceConfig):
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


def make_remote_race(cfg: RaceConfig, ns: argparse.Namespace, argv: list[str]):
    """``--forge cloudflare``: the driver for beanstalk's gateway (harness/remote.py), or None after an error."""
    from harness.remote import POLICIES, RemoteRace, check_v2_flags, explicit_flags, load_admin_token, v2_settings
    gateway = ns.gateway or os.environ.get("BEANSTALK_GATEWAY")
    problem = None
    if not gateway:
        problem = "--forge cloudflare needs --gateway URL (or $BEANSTALK_GATEWAY)"
    elif cfg.policy not in POLICIES:
        problem = f"--forge cloudflare runs --policy {' or '.join(POLICIES)}"
    else:
        problem = check_v2_flags(cfg.policy, cfg, explicit_flags(argv))
    admin = None if problem else load_admin_token()  # removed from the environment so agents never inherit it
    if problem is None and not admin:
        problem = "no admin token: set $BEANSTALK_ADMIN_TOKEN or ADMIN_TOKEN in packages/gateway/.dev.vars"
    if problem:
        print(problem, file=sys.stderr)
        return None
    return RemoteRace(cfg, gateway=gateway, admin_token=admin, policy=cfg.policy, v2=v2_settings(v2_flags(ns)),
                      show_live_url=ns.live_url, auth_probe=not ns.no_auth_probe, stagger_start=ns.stagger_start)


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
    cfg, ns = parse_cli(argv)
    if cfg.agents < 1 or cfg.ci_slots < 1 or cfg.batch < 1:
        print("--agents, --ci-slots and --batch must be at least 1", file=sys.stderr)
        return 1
    if cfg.agent != "replay" and not shutil.which(cfg.claude_bin if cfg.agent == "claude" else cfg.codex_bin):
        print(f"{cfg.agent} CLI not found on PATH", file=sys.stderr)
        return 1
    if ns.forge == "cloudflare":
        race = make_remote_race(cfg, ns, argv)
        if race is None:
            return 1
        if cfg.dry_run:
            return asyncio.run(race.dry_run())
    elif cfg.dry_run:
        return dry_run(cfg)
    else:
        race = make_race(cfg, v2_flags(ns))

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
