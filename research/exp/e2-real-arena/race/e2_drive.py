#!/usr/bin/env python3
"""e2 race driver: races one after another, each in its own place in the machine-wide FIFO race slot.

Usage: python3 e2_drive.py <policy:seed[:mode[:budget[:arena]]]> ...
  policy  queue | v2 | v2nr (diagnostic: v2 without the file-overlap re-check)
  mode    real (default: Sonnet, 12 agents, CI 60 s) | replay (free: 8 agents, 1/12 time scale)
  budget  USD for a real race (default 25; never more than what keeps all e2 spend under $60)
  arena   real (default: ../real-arena) | chain (../real-arena/chain, E2b)

For a real race, inside the slot: a 1-turn Haiku authentication check first (e2_authcheck.py; on a 403 / login
failure the race does not start, the driver leaves the slot, waits 10 minutes and queues again, up to 18 times).
After it: a contamination scan (invocations that failed on authentication) and a rate-limit check; either keeps the
run as <name>-aborted<n> (its spend still counts) and runs the race again (rate limit: after the reset).
A replay race gates the real races after it in the same call (e2_gate.py). Every race records `uptime` at its start
and end in runs/<name>.uptime. (run-e2.sh is the earlier shell version of this driver, used for seeds 7 and 11.)
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SLOT = "/Users/coop/Workspace/beanstalk/research/tools/race-slot.sh"
LOG = os.path.join(HERE, "runs", "e2-races.log")
AUTH_FAILED = 76
INNER = r'''
name=$1; real=$2; shift 2
if [ -n "$E2_REQUIRE_GATE" ]; then  # pipelined: the replay gate must have passed before this race may use the slot
  [ -f "$E2_REQUIRE_GATE/summary.json" ] || exit 75
  python3 e2_gate.py "$E2_REQUIRE_GATE" >> runs/e2-races.log 2>&1 || exit 74
fi
[ -e "runs/$name/events.jsonl" ] && exit 73
if [ "$real" = 1 ]; then python3 e2_authcheck.py >> runs/e2-races.log 2>&1 || exit $?; fi
{ echo "start $(date "+%F %T")"; uptime; } > "runs/$name.uptime"
echo "$(date "+%F %T") start $name" >> runs/e2-races.log
python3 race.py "$@" --out "runs/$name" > "runs/$name.log" 2>&1
rc=$?
{ echo "end $(date "+%F %T") exit $rc"; uptime; } >> "runs/$name.uptime"
echo "$(date "+%F %T") end $name exit $rc" >> runs/e2-races.log
exit $rc
'''


def log(msg: str) -> None:
    with open(LOG, "a", encoding="utf-8") as fh:
        fh.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n")


def spent_cap(req: float) -> tuple[float, float]:
    out = subprocess.run([sys.executable, os.path.join(HERE, "e2_spent.py"), str(req), "59"], capture_output=True,
                         text=True, check=True).stdout.split()
    return float(out[0]), float(out[1])


def aside(name: str) -> str:
    n = 1
    while os.path.exists(os.path.join(HERE, "runs", f"{name}-aborted{n}")):
        n += 1
    for ext in ("", ".log", ".uptime"):
        src = os.path.join(HERE, "runs", name + ext)
        if os.path.exists(src):
            os.rename(src, os.path.join(HERE, "runs", f"{name}-aborted{n}{ext}"))
    return f"{name}-aborted{n}"


def rate_limit_reset(run: str) -> float | None:
    try:
        s = json.load(open(os.path.join(run, "summary.json"), encoding="utf-8"))
    except (OSError, ValueError):
        return None
    reason = str(s.get("aborted") or "")
    if not reason.startswith("rate limited"):
        return None
    m = re.search(r"resets at (\d+)", reason)
    return float(m.group(1)) if m else time.time() + 3600


def main() -> int:
    specs = sys.argv[1:]
    if specs[:1] == ["--require-gate"]:  # e2_drive.py --require-gate runs/<replay> <real spec> ...
        os.environ["E2_REQUIRE_GATE"] = specs[1]
        specs = specs[2:]
    if not specs:
        print(__doc__)
        return 2
    log(f"queued (e2_drive) {' '.join(specs)}")
    gate_failed = False
    for spec in specs:
        policy, seed, mode, budget, arena = (spec.split(":") + ["", "", "", ""])[:5]
        mode, arena = mode or "real", arena or "real"
        arena_dir, prefix, repo = {"real": ("../real-arena", "e2", "../real-arena.git"),
                                   "chain": ("../real-arena/chain", "e2b", "../real-arena.git"),
                                   "designed": ("../../../arena", "e2d", "../../../corpora/arena.git")}[arena]
        common = ["--arena", arena_dir, "--repo", repo, "--protect-tests", "landed", "--ci-slots", "2",
                  "--seed", seed]
        args = {"queue": ["--policy", "queue", "--batch", "4", "--no-queue-hold"],
                "v2": ["--policy", "beanstalk-v2", "--snapshot", "head", "--error-budget", "999"],
                "v2nr": ["--policy", "beanstalk-v2", "--snapshot", "head", "--error-budget", "999"],
                "v2h": ["--policy", "beanstalk-v2", "--snapshot", "head", "--error-budget", "999"],
                "v2a": ["--policy", "beanstalk-v2", "--snapshot", "head", "--error-budget", "999"]}[policy]
        env = dict(os.environ, PRELAND_MODE="optimistic", PRELAND_RECHECK={"v2nr": "never", "v2h": "hunk", "v2a": "adaptive"}.get(policy, "file"),
                   DECISION_SECONDS="30", DECISION_ORACLE="landed")
        if mode == "replay":
            name = f"{prefix}-replay-{policy}-8-s{seed}"
            env["PRELAND_SECONDS"] = "5"
            argv = args + common + ["--agent", "replay", "--agents", "8", "--ci-seconds", "5", "--replay-median", "8",
                                    "--max-wall-minutes", "30"]
            subprocess.run([SLOT, "bash", "-c", INNER, "_", name, "0", *argv], cwd=HERE, env=env)
            g = subprocess.run([sys.executable, "e2_gate.py", f"runs/{name}"], cwd=HERE, capture_output=True, text=True)
            log(g.stdout.strip())
            if g.returncode != 0:
                gate_failed = True
                log(f"gate FAILED on {name}")
            continue
        if gate_failed:
            log(f"skip {spec}: a replay race in this call failed its gate")
            continue
        name = f"{prefix}-{policy}-sonnet-12-s{seed}"
        env["PRELAND_SECONDS"] = "60"
        auth_tries = reruns = 0
        while True:
            cap, spent = spent_cap(float(budget or 25))
            if cap < 3:
                log(f"skip {spec}: only ${cap:.2f} left under the $60 total (spent ${spent:.2f})")
                break
            log(f"{name} budget ${cap:.2f} (spent so far ${spent:.2f})")
            argv = args + common + ["--agent", "claude", "--model", "sonnet", "--agents", "12", "--ci-seconds", "60",
                                    "--max-wall-minutes", "45", "--budget-usd", f"{cap:.2f}"]
            rc = subprocess.run([SLOT, "bash", "-c", INNER, "_", name, "1", *argv], cwd=HERE, env=env).returncode
            run = os.path.join(HERE, "runs", name)
            if rc == 73:
                log(f"skip {spec}: runs/{name} already exists")
                break
            if rc == 74:
                log(f"skip {spec}: the required replay gate {os.environ.get('E2_REQUIRE_GATE')} failed")
                break
            if rc == 75:
                log(f"{name}: the required replay has not run yet; queueing again in 5 minutes")
                time.sleep(300)
                continue
            if rc == AUTH_FAILED or not os.path.exists(os.path.join(run, "events.jsonl")):
                auth_tries += 1
                log(f"{name}: did not start (exit {rc}: {'authentication check failed' if rc == AUTH_FAILED else 'no run'}"
                    f", {auth_tries}); waiting 10 minutes")
                if auth_tries >= 18:
                    break
                time.sleep(600)
                continue
            scan = subprocess.run([sys.executable, "e2_authcheck.py", run], cwd=HERE, capture_output=True, text=True)
            reset = rate_limit_reset(run)
            if scan.returncode == AUTH_FAILED or reset is not None:
                kept = aside(name)
                reruns += 1
                why = "authentication failures" if scan.returncode == AUTH_FAILED else "rate limited"
                log(f"{name}: {why}; kept as {kept}; re-running ({reruns})")
                if reruns > 2:
                    break
                time.sleep(max(600.0, (reset or 0) - time.time() + 60))
                continue
            break
    return 0


if __name__ == "__main__":
    sys.exit(main())
