#!/usr/bin/env python3
"""Token-free push replay: how fast a forge integrates parallel work. GitHub's merge queue vs Beanstalk, plain git.

  python3 -m loadgen.run --forge github    --workers 8 --seed 7 --out runs/lg-fastify-8-s7-github
  python3 -m loadgen.run --forge beanstalk --workers 8 --seed 7 --out runs/lg-fastify-8-s7-beanstalk
  python3 -m loadgen.run --forge both      --workers 8 --seed 7 --out runs/lg-fastify-8-s7   # both at once

Run from research/race. See loadgen/README.md.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RACE = os.path.dirname(HERE)
sys.path.insert(0, RACE)

from loadgen.driver import Driver, Options  # noqa: E402
from loadgen.schedule import Schedule, fit, orchestrated_pushes, recorded_pushes  # noqa: E402

DEFAULT_ARENA = os.path.normpath(os.path.join(RACE, "..", "real-arena", "fastify"))
DEFAULT_FIT = ["runs/pair-fastify-codex-4-s7-github", "runs/pair-fastify-codex-4-s7-beanstalk"]
DEFAULT_GATEWAY = os.environ.get("BEANSTALK_GATEWAY", "")
DEFAULT_DEV_VARS = os.path.normpath(os.path.join(RACE, "..", "..", "packages", "gateway", ".dev.vars"))

# test hooks: factories returning fake clients
GITHUB_CLIENT_FACTORY = None
BEANSTALK_CLIENT_FACTORY = None


def parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--forge", choices=["github", "beanstalk", "both"], required=True)
    ap.add_argument("--out", required=True, help="output directory (both: <out>-github and <out>-beanstalk)")
    ap.add_argument("--arena", default=DEFAULT_ARENA)
    ap.add_argument("--repo", help="the arena's materialized repo (default: arena.json repo)")
    ap.add_argument("--tasks", nargs="*", help="a subset: ids, or one number for the first n")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--mode", choices=["standalone", "chain"], default="standalone",
                    help="dependent tasks: standalone patch whenever started, or wait for prerequisites")
    ap.add_argument("--schedule", choices=["closed", "open", "recorded", "orchestrated"], default="closed")
    ap.add_argument("--hold", choices=["integrate", "push"], default="integrate",
                    help="closed loop: a worker waits for its change's verdict (integrate) or moves on (push)")
    ap.add_argument("--fit-runs", nargs="*", default=DEFAULT_FIT, help="runs whose agent invocations fit the "
                    "think (initial) and fix (rework) lognormals")
    ap.add_argument("--think-median", type=float, help="override the fitted think median (s)")
    ap.add_argument("--fix-median", type=float, help="override the fitted fix median (s)")
    ap.add_argument("--time-scale", type=float, default=1.0, help="multiply every think/fix/arrival time")
    ap.add_argument("--rate", type=float, default=0.0, help="open loop: changes per minute")
    ap.add_argument("--fixed", action="store_true", help="open loop: fixed spacing instead of Poisson")
    ap.add_argument("--record", help="recorded: the run whose push times to replay")
    ap.add_argument("--speed", type=float, default=1.0, help="recorded: compression (2 = twice as fast)")
    ap.add_argument("--max-attempts", type=int, default=8)
    ap.add_argument("--max-wall-minutes", type=float, default=120.0)
    ap.add_argument("--ci-slots", type=int, default=2, help="GitHub max_entries_to_build (= Beanstalk CI slots, "
                    "fixed at 2 on a continuous engine)")
    ap.add_argument("--batch", type=int, default=4, help="GitHub max_entries_to_merge")
    ap.add_argument("--no-final-check", action="store_true")
    ap.add_argument("--final-in", choices=["auto", "docker", "local"], default="auto",
                    help="where the final check runs: a container (own loopback; auto = when Docker is there)")
    ap.add_argument("--label", default="")
    g = ap.add_argument_group("GitHub")
    g.add_argument("--gh-owner", default="kintohubtest")
    g.add_argument("--gh-repo", help="default beanstalk-loadgen-<arena>-<workers>-<seed>")
    g.add_argument("--gh-poll", type=float, default=3.0)
    g.add_argument("--gh-push-interval", type=float, default=2.0)
    b = ap.add_argument_group("Beanstalk")
    b.add_argument("--gateway", default=DEFAULT_GATEWAY)
    b.add_argument("--dev-vars", default=DEFAULT_DEV_VARS, help="the gateway's .dev.vars (ADMIN_TOKEN)")
    b.add_argument("--bs-owner", default="loadgen")
    b.add_argument("--bs-repo", help="default lg-<arena>-<workers>-<seed>-<random>")
    b.add_argument("--keep-repo", action="store_true")
    b.add_argument("--bs-engine", action="append", default=[], metavar="KEY=VALUE",
                   help="an engine setting over the continuous defaults (settings.engine: ci_slots, read_maps, "
                        "evidence_promotion, evidence_read_sets, affected_validation, audit_every); repeatable")
    b.add_argument("--bs-evidence", action="store_true", help="shorthand: read_maps=preland evidence_promotion=true "
                   "affected_validation=true audit_every=4 evidence_read_sets=complete")
    return ap


def schedule_of(a: argparse.Namespace) -> Schedule:
    runs = [p if os.path.isabs(p) else os.path.join(RACE, p) for p in a.fit_runs or []]
    think, fix = fit(runs)
    if a.think_median:
        think.median, think.source = a.think_median, think.source + " (median overridden)"
    if a.fix_median:
        fix.median, fix.source = a.fix_median, fix.source + " (median overridden)"
    s = Schedule(kind=a.schedule, seed=a.seed, think=think, fix=fix, time_scale=a.time_scale, rate_per_min=a.rate,
                 poisson=not a.fixed, hold=a.hold, speed=a.speed)
    if a.schedule in ("recorded", "orchestrated"):
        if not a.record:
            raise SystemExit(f"--schedule {a.schedule} needs --record <run>")
        rec = a.record if os.path.isabs(a.record) else os.path.join(RACE, a.record)
        s.recorded, s.recorded_reworks = (recorded_pushes if a.schedule == "recorded" else orchestrated_pushes)(rec)
        s.recorded_source = os.path.basename(rec.rstrip("/"))
    return s


EVIDENCE = {"read_maps": "preland", "evidence_promotion": True, "affected_validation": True, "audit_every": 4,
            "evidence_read_sets": "complete"}


def engine_settings(a: argparse.Namespace) -> dict:
    out: dict = dict(EVIDENCE) if a.bs_evidence else {}
    for kv in a.bs_engine or []:
        k, _, v = kv.partition("=")
        out[k] = True if v == "true" else False if v == "false" else int(v) if v.isdigit() else v
    return out


ACCOUNT_HOST = re.compile(r"\b[0-9a-f]{32}(?=\.(?:artifacts|r2|workers)\b)")


def mask(path: str, gateway: str | None) -> None:
    """Mask the gateway's workers.dev subdomain and Cloudflare account ids (as in ``<id>.artifacts…`` hosts the
    engine's errors quote) in every output file: committed runs carry no account names."""
    m = re.match(r"https?://[^.]+\.([^.]+)\.workers\.dev", gateway or "")
    sub = m.group(1) if m else None
    for name in ("events.jsonl", "summary.json", "config.json", "summary.md", "engine-events.jsonl"):
        p = os.path.join(path, name)
        if not os.path.exists(p):
            continue
        with open(p, encoding="utf-8") as fh:
            text = fh.read()
        new = ACCOUNT_HOST.sub("<account-id>", text.replace(sub, "<account>") if sub else text)
        if new != text:
            with open(p, "w", encoding="utf-8") as fh:
                fh.write(new)


def run_one(a: argparse.Namespace) -> dict:
    from harness.suite import gateway_suite, load_suite
    arena = os.path.abspath(a.arena)
    repo = a.repo or load_suite(arena).repo
    if not repo:
        raise SystemExit("no --repo and the arena names none")
    out = a.out if os.path.isabs(a.out) else os.path.join(RACE, a.out)
    os.makedirs(out, exist_ok=True)
    name = os.path.basename(arena)
    sched = schedule_of(a)
    opts = Options(arena=arena, repo=repo, out=out, workers=a.workers, schedule=sched, mode=a.mode,
                   tasks=a.tasks or None, max_attempts=a.max_attempts, max_wall_minutes=a.max_wall_minutes,
                   final_check=not a.no_final_check, final_in=a.final_in, ci_slots=a.ci_slots, batch=a.batch, label=a.label)
    config = {k: v for k, v in vars(a).items() if k not in ("dev_vars",)}
    config["schedule_resolved"] = sched.describe()

    if a.forge == "github":
        from loadgen.forges import GitHubForge
        gh_repo = a.gh_repo or f"beanstalk-loadgen-{name}-{a.workers}-{a.seed}"
        config["github_repo"] = f"{a.gh_owner}/{gh_repo}"

        def factory(git, work, log):
            client = GITHUB_CLIENT_FACTORY() if GITHUB_CLIENT_FACTORY else None
            return GitHubForge(git, work, arena, owner=a.gh_owner, repo=gh_repo, build_concurrency=a.ci_slots,
                               max_merge=a.batch, poll=a.gh_poll, push_interval=a.gh_push_interval, client=client,
                               log=log)
    else:
        from loadgen.beanstalk import BeanstalkClient, admin_token
        from loadgen.forges import BeanstalkForge
        import secrets
        bs_repo = a.bs_repo or f"lg-{name}-{a.workers}-{a.seed}-{secrets.token_hex(2)}"
        suite = gateway_suite(load_suite(arena))
        config["beanstalk_repo"] = f"{a.bs_owner}/{bs_repo}"
        config["beanstalk_engine_settings"] = engine_settings(a)

        def factory(git, work, log):
            if BEANSTALK_CLIENT_FACTORY:
                client = BEANSTALK_CLIENT_FACTORY()
            else:
                if not a.gateway:
                    raise SystemExit("--gateway (or $BEANSTALK_GATEWAY) is required")
                client = BeanstalkClient(a.gateway, admin_token(a.dev_vars), a.bs_owner, bs_repo,
                                         engine_settings=engine_settings(a))
            config["beanstalk_engine"] = client.engine
            return BeanstalkForge(git, work, client, suite=suite, log=log, keep_repo=a.keep_repo)

    driver = Driver(opts, factory)
    summary = asyncio.run(driver.run())
    with open(os.path.join(out, "config.json"), "w", encoding="utf-8") as fh:
        json.dump(config, fh, indent=2, default=str)
    from loadgen.report import write_md
    write_md(out, summary)
    mask(out, a.gateway)
    return summary


def strip_options(args: list[str], valued: tuple, flags: tuple) -> list[str]:
    out, skip = [], False
    for x in args:
        if skip:
            skip = False
            continue
        if x in valued:
            skip = True
            continue
        if x in flags or any(x.startswith(v + "=") for v in valued):
            continue
        out.append(x)
    return out


def run_both(a: argparse.Namespace, argv: list[str]) -> int:
    """Both forges at once (no model quota is involved): two processes, same arguments."""
    base = [x for x in argv]
    i = base.index("--forge")
    procs = {}
    import tempfile
    from loadgen.driver import BARRIER_ENV
    gate = tempfile.mkdtemp(prefix="loadgen-barrier-")
    with open(os.path.join(gate, "arms"), "w") as fh:
        fh.write("github beanstalk\n")
    for forge in ("github", "beanstalk"):
        args = base[:i] + ["--forge", forge] + base[i + 2:]
        if forge == "github":  # the GitHub arm gets no Beanstalk arguments (a live-gateway URL in its argv would
            args = strip_options(args, ("--gateway", "--dev-vars", "--bs-owner", "--bs-repo", "--bs-engine"),
                                 ("--keep-repo", "--bs-evidence"))  # make it look like a live run to watchers
        j = args.index("--out")
        args[j + 1] = f"{a.out}-{forge}"
        log = open(os.path.join(RACE, f"{a.out}-{forge}.log") if not os.path.isabs(a.out) else f"{a.out}-{forge}.log",
                   "w")
        procs[forge] = (subprocess.Popen([sys.executable, "-m", "loadgen.run", *args], cwd=RACE, stdout=log,
                                         env={**os.environ, BARRIER_ENV: gate},
                                         stderr=subprocess.STDOUT), log)
    codes = {f: p.wait() for f, (p, _log) in procs.items()}
    for _p, log in procs.values():
        log.close()
    from loadgen.report import pair_table
    print(pair_table([f"{a.out}-github", f"{a.out}-beanstalk"]))
    return max(codes.values())


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    a = parser().parse_args(argv)
    if a.forge == "both":
        return run_both(a, argv)
    s = run_one(a)
    from loadgen.report import pair_table
    print(pair_table([a.out]))
    return 0 if not s.get("aborted") else 3


if __name__ == "__main__":
    sys.exit(main())
