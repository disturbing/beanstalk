#!/usr/bin/env python3
"""E3 driver: real-agent races one after another through the machine-wide race slot.

  python3 drive.py probe+r05-v2-plain r05-v2-mitigated r05-queue-retry [--chain 3] [--cap 40] [--dry-run]

An arm is ``r<rate>-<kind>``: rate 05 = FLAKE_RATE 0.05, 02 = 0.02; kind is ``queue-retry`` (queue + retry a red
batch once), ``queue-plain``, ``v2-plain`` (no mitigation) or ``v2-mitigated`` (re-run a red pre-land check once;
re-run a red validation before reverting); ``v2-targeted`` and ``queue-targeted`` are the same mitigations with a
5-second re-run (only the failing tests, on a warm runner) instead of a whole 60-second pipeline. ``probe`` is
one task and one forced flake, to see how the agent reacts.

Every race starts only when the race slot is free, with the uptime recorded at its start and end
(runs/<name>.uptime.txt). Arms joined with ``+`` (``probe+r05-v2-plain``) share ONE slot hold and run in that order, and
the later ones are skipped if an earlier one fails: the probe gates the first race without a second wait in the queue.
With ``--chain n`` the driver takes the slot once for n consecutive arms (a shortcut for joining them with ``+``). On a "rate limited" abort the driver
leaves the slot, waits for the reset, and runs the arm again; the aborted run is kept as <name>-aborted<n> and its
spend counts. It refuses to start a race that could take the total agent spend over --cap (USD), and passes
min(20, what is left) as that race's --budget-usd.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from authcheck import AUTH_FAILED, contamination  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SLOT = os.path.normpath(os.path.join(HERE, "..", "..", "..", "tools", "race-slot.sh"))
LEDGER = os.path.join(HERE, "runs", "e3-ledger.json")
RATELIMIT = os.path.join(HERE, "runs", "e3-ratelimit.json")
COMMON = ["--agent", "claude", "--model", "sonnet", "--agents", "12", "--ci-seconds", "60", "--ci-slots", "2",
          "--protect-tests", "landed", "--max-wall-minutes", "45", "--seed", "7"]
V2 = ["--policy", "beanstalk-v2", "--snapshot", "head", "--error-budget", "999"]
QUEUE = ["--policy", "queue", "--batch", "4", "--no-queue-hold"]
V2_ENV = {"PRELAND_MODE": "optimistic", "PRELAND_SECONDS": "60", "DECISION_SECONDS": "30", "DECISION_ORACLE": "landed"}
EXPECTED_USD = 6.5   # what one 40-task race costs at most, from the earlier fair runs ($4-6)
RATE_LIMITED = 75    # exit status of an in-slot driver that stopped on a rate limit (the caller waits outside the slot)
SELFTESTS = ["tests.test_flake.RacesConfirmSame", "tests.test_flake.RacesV2", "tests.test_flake.RacesQueue"]
AUTH_WAIT = 600.0    # seconds to wait after an authentication failure before asking again
AUTH_TRIES = 18      # ... for up to three hours


def arm(name: str) -> tuple[list[str], dict]:
    """(race.py arguments, environment) for an arm name."""
    if name == "probe":     # one task, one forced flaky pre-land red: how does the agent react? (about $0.3)
        return (["--policy", "beanstalk-v2", "--agent", "claude", "--model", "sonnet", "--agents", "1",
                 "--ci-seconds", "20", "--ci-slots", "2", "--protect-tests", "landed", "--max-wall-minutes", "15",
                 "--seed", "7", "--snapshot", "head", "--error-budget", "999", "--tasks", "t012"],
                {**V2_ENV, "PRELAND_SECONDS": "20", "FLAKE_RATE": "1", "FLAKE_PURPOSES": "preland", "FLAKE_LIMIT": "1"})
    m = re.fullmatch(r"r(\d+)-(queue-retry|queue-plain|queue-targeted|v2-plain|v2-mitigated|v2-targeted)", name)
    if not m:
        raise SystemExit(f"unknown arm {name!r}")
    rate = int(m.group(1)) / 100
    kind = m.group(2)
    env = {"FLAKE_RATE": str(rate)}
    if kind.startswith("queue"):
        args = COMMON + QUEUE
        env["FLAKE_RETRY_BATCH"] = "0" if kind == "queue-plain" else "1"
        if kind == "queue-targeted":
            env["FLAKE_RERUN_SECONDS"] = "5"
    else:
        args = COMMON + V2
        env.update(V2_ENV)
        if kind in ("v2-mitigated", "v2-targeted"):
            env.update(FLAKE_RERUN_PRELAND="1", FLAKE_RERUN_VALIDATE="1")
        if kind == "v2-targeted":
            env["FLAKE_RERUN_SECONDS"] = "5"
    return args, env


def probe_ok(summary: dict, out: str) -> bool:
    """The probe forces one flaky pre-land red: it must show up as one needless rework and the race must end correct."""
    fl = summary.get("flake") or {}
    errors = 0
    try:
        with open(os.path.join(out, "events.jsonl")) as fh:
            errors = sum(1 for line in fh if '"type": "error"' in line)
    except OSError:
        pass
    checks = {"final correct": (summary.get("final") or {}).get("correct") is True,
              "one flaked run": fl.get("flaked_runs") == 1, "one needless rework": fl.get("needless_reworks") == 1,
              "task green": summary.get("tasks_green") == summary.get("tasks") == 1, "no error events": errors == 0,
              "cost under $3": (summary.get("cost_usd") or 99) < 3.0}
    for k, v in checks.items():
        print(f"[drive] probe check {k}: {'ok' if v else 'FAILED'}", flush=True)
    return all(checks.values())


def ledger() -> list[dict]:
    try:
        with open(LEDGER) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return []


def save(entries: list[dict]) -> None:
    os.makedirs(os.path.dirname(LEDGER), exist_ok=True)
    with open(LEDGER, "w") as fh:
        json.dump(entries, fh, indent=2)


def spent(entries: list[dict]) -> float:
    return round(sum(e.get("cost_usd") or 0.0 for e in entries), 4)


def reset_wait(aborted: str) -> float:
    """Seconds to wait for a rate limit to reset, from the abort message ('... resets at <epoch>')."""
    m = re.search(r"resets at (\d{9,})", aborted or "")
    return max(120.0, (int(m.group(1)) - time.time() + 60) if m else 1800.0)


def selftest(dry: bool) -> int:
    """The replay race tests (no agents, no cost) after a code change, inside the slot and under the node cap: gates the
    arms joined after it with ``+`` (``selftest+r05-queue-plain``)."""
    cmd = [sys.executable, "-m", "unittest", "-v", *SELFTESTS]
    print(f"[drive] {time.strftime('%H:%M:%S')} selftest: {' '.join(SELFTESTS)}", flush=True)
    if dry:
        return 0
    env = {**os.environ, "RACE_NODE_SUITES": "1", "RACE_NODE_CONCURRENCY": "3"}
    with open(os.path.join(HERE, "runs", "e3-selftest.log"), "w") as log:
        rc = subprocess.run(cmd, cwd=HERE, env=env, stdout=log, stderr=subprocess.STDOUT).returncode
    print(f"[drive] {time.strftime('%H:%M:%S')} selftest: exit {rc} (runs/e3-selftest.log)", flush=True)
    return 0 if rc == 0 else 1


def run_arm(name: str, cap: float, dry: bool, inslot: bool) -> int:
    """Run one arm. 0 = done (or already there), 1 = failed, RATE_LIMITED = stopped on a rate limit (inslot only)."""
    if name == "selftest":
        return selftest(dry)
    args, env = arm(name)
    entries = ledger()
    for attempt in range(1, 4):
        left = cap - spent(entries)
        if (left < EXPECTED_USD and name != "probe") or left < 1.0:
            print(f"[drive] not starting {name}: ${left:.2f} left under the ${cap:.0f} cap", flush=True)
            return 1
        budget = round(min(3.0 if name == "probe" else 20.0, left - 0.25), 2)
        out = f"runs/e3-{name}"
        if os.path.exists(os.path.join(HERE, out)):
            print(f"[drive] {out} exists already; not overwriting it", flush=True)
            return 0
        cmd = [SLOT, "./race_with_uptime.sh", f"e3-{name}", "python3", "race.py", *args,
               "--budget-usd", str(budget), "--out", out]
        if inslot:   # the caller holds the race slot already
            cmd = cmd[1:]
        full_env = {**os.environ, **env, "E3_AUTHCHECK": "1"}
        print(f"[drive] {time.strftime('%H:%M:%S')} {name}: starting (attempt {attempt}, budget ${budget}"
              f"{', in the slot' if inslot else ', waiting for the race slot'})", flush=True)
        print("[drive] " + " ".join(f"{k}={v}" for k, v in env.items()) + " " + " ".join(cmd), flush=True)
        if dry:
            return 0
        for waits in range(AUTH_TRIES + 1):
            with open(os.path.join(HERE, "runs", f"e3-{name}.log"), "w") as log:
                rc = subprocess.run(cmd, cwd=HERE, env=full_env, stdout=log, stderr=subprocess.STDOUT).returncode
            if rc != AUTH_FAILED:
                break
            print(f"[drive] {time.strftime('%H:%M:%S')} {name}: the Claude CLI is not authenticated (403 / login); "
                  f"nothing was spent; asking again in {AUTH_WAIT / 60:.0f} min ({waits + 1}/{AUTH_TRIES})", flush=True)
            if inslot:   # let the others have the slot meanwhile
                return AUTH_FAILED
            time.sleep(AUTH_WAIT)
        else:
            print(f"[drive] {name}: still not authenticated after {AUTH_TRIES} tries; stopping", flush=True)
            return 1
        if rc == AUTH_FAILED:
            return 1
        summary = {}
        try:
            with open(os.path.join(HERE, out, "summary.json")) as fh:
                summary = json.load(fh)
        except (OSError, ValueError):
            pass
        cost = float(summary.get("cost_usd") or 0.0)
        aborted = summary.get("aborted")
        bad = {"auth": [], "infra": [], "errors": []}
        try:
            with open(os.path.join(HERE, out, "events.jsonl"), encoding="utf-8") as fh:
                bad = contamination([json.loads(line) for line in fh if line.strip()])
        except OSError:
            pass
        entries.append({"run": f"e3-{name}", "attempt": attempt, "exit": rc, "cost_usd": cost, "aborted": aborted,
                        "ended": time.strftime("%F %T"), "auth_failures": len(bad["auth"]),
                        "infra_errors": len(bad["infra"]), "is_error_results": len(bad["errors"])})
        save(entries)
        print(f"[drive] {time.strftime('%H:%M:%S')} {name}: exit {rc}, ${cost:.2f}, aborted={aborted}; infra errors "
              f"{len(bad['infra'])}, is_error results {len(bad['errors'])}, auth failures {len(bad['auth'])}; "
              f"total spend ${spent(entries):.2f}", flush=True)
        if bad["auth"]:   # the race overlapped an authentication outage: its numbers are not the policy's
            keep = f"{out}-contaminated{attempt}"
            os.rename(os.path.join(HERE, out), os.path.join(HERE, keep))
            for ext in (".log", ".uptime.txt"):
                src = os.path.join(HERE, "runs", f"e3-{name}{ext}")
                if os.path.exists(src):
                    os.rename(src, os.path.join(HERE, "runs", f"e3-{name}-contaminated{attempt}{ext}"))
            print(f"[drive] {name}: {len(bad['auth'])} invocations failed on authentication ({bad['auth'][:5]}): the race is "
                  f"contaminated, kept as {keep}; re-running after {AUTH_WAIT / 60:.0f} min", flush=True)
            if inslot:
                return AUTH_FAILED
            time.sleep(AUTH_WAIT)
            continue
        if rc == 0:
            if name == "probe" and not probe_ok(summary, os.path.join(HERE, out)):
                print("[drive] the probe did not behave as expected (see above); stopping before the main races", flush=True)
                return 1
            return 0
        if aborted and aborted.startswith("rate limited"):
            os.rename(os.path.join(HERE, out), os.path.join(HERE, f"{out}-aborted{attempt}"))
            for ext in (".log", ".uptime.txt"):
                src = os.path.join(HERE, "runs", f"e3-{name}{ext}")
                if os.path.exists(src):
                    os.rename(src, os.path.join(HERE, "runs", f"e3-{name}-aborted{attempt}{ext}"))
            wait = reset_wait(aborted)
            with open(RATELIMIT, "w") as fh:
                json.dump({"arm": name, "wait_seconds": wait, "at": time.time()}, fh)
            if inslot:
                print(f"[drive] rate limited: leaving the slot; {name} will be re-run after the reset", flush=True)
                return RATE_LIMITED
            print(f"[drive] rate limited: waiting {wait / 60:.0f} min for the reset, then re-running {name}", flush=True)
            time.sleep(wait)
            continue
        print(f"[drive] {name} did not finish cleanly (exit {rc}); stopping", flush=True)
        return 1
    return 1


def hold(chunk: list[str], cap: float) -> int:
    """Take the race slot once and run the arms of ``chunk`` in it, in order, stopping at the first failure; wait out
    rate limits and authentication outages outside the slot and take it again for what is left."""
    auth_tries = 0
    while True:
        todo = [a for a in chunk if not os.path.exists(os.path.join(HERE, "runs", f"e3-{a}"))]
        if not todo:
            return 0
        cmd = [SLOT, sys.executable, os.path.join(HERE, "drive.py"), "--inslot", "--cap", str(cap), *todo]
        print(f"[drive] {time.strftime('%H:%M:%S')} waiting for the race slot for: {' '.join(todo)}", flush=True)
        rc = subprocess.run(cmd, cwd=HERE).returncode
        if rc == RATE_LIMITED:
            try:
                with open(RATELIMIT) as fh:
                    wait = float(json.load(fh)["wait_seconds"])
            except (OSError, ValueError, KeyError):
                wait = 1800.0
            print(f"[drive] rate limited: waiting {wait / 60:.0f} min outside the slot", flush=True)
            time.sleep(wait)
            continue
        if rc == AUTH_FAILED:
            auth_tries += 1
            if auth_tries > AUTH_TRIES:
                print(f"[drive] still not authenticated after {AUTH_TRIES} tries; stopping", flush=True)
                return 1
            print(f"[drive] not authenticated: waiting {AUTH_WAIT / 60:.0f} min outside the slot ({auth_tries}/{AUTH_TRIES})",
                  flush=True)
            time.sleep(AUTH_WAIT)
            continue
        return rc


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("arms", nargs="+")
    ap.add_argument("--cap", type=float, default=40.0, help="total agent spend cap in USD (40)")
    ap.add_argument("--chain", type=int, default=1, help="arms per slot hold (1: take the slot for every race)")
    ap.add_argument("--inslot", action="store_true", help="internal: the caller holds the race slot already")
    ap.add_argument("--dry-run", action="store_true", help="print the commands only")
    a = ap.parse_args()
    inslot = a.inslot or bool(os.environ.get("DRIVE_NO_SLOT"))
    arms = [x for arg in a.arms for x in arg.split("+")] if (inslot or a.dry_run) else a.arms
    if inslot or a.dry_run or a.chain < 1:
        for name in arms:
            rc = run_arm(name, a.cap, a.dry_run, inslot)
            if rc != 0:
                return rc
        return 0
    groups: list[tuple[list[str], bool]] = []   # (arms in one slot hold, joined explicitly with "+")
    for arg in a.arms:
        parts = arg.split("+")
        loose = len(parts) == 1 and a.chain > 1 and groups and not groups[-1][1] and len(groups[-1][0]) < a.chain
        if loose:
            groups[-1][0].extend(parts)
        else:
            groups.append((parts, len(parts) > 1))
    for group, _ in groups:
        if len(group) == 1:   # one slot hold per race, rate limits and auth outages waited out inside run_arm
            if run_arm(group[0], a.cap, False, False) != 0:
                return 1
            continue
        rc = hold(group, a.cap)
        if rc != 0:
            return rc
    return 0


if __name__ == "__main__":
    sys.exit(main())
