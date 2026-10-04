#!/usr/bin/env python3
"""E7 race driver: real-agent races strictly one at a time, each through race-slot.sh.

Usage: python3 e7_driver.py [--wait-pid PID ...] policy:fleet:seed:shuffle ... [cmd:/path/to/script ...]
Job spec: <policy>:<fleet>:<seed>:<shuffle 0|1>[:rerun]   policy = queue | v2, fleet = claude | mixed;
          ``rerun`` first moves an existing run of that name aside as flagged-highload-<name>;
          cmd:<script> runs the script in one slot (free tests, smoke races).

* One driver, one race at a time (the coordinator's machine-wide limit is one race, free replay races
  included; seed runs are the most timing-sensitive comparisons). ``--wait-pid`` holds the first job back until
  those processes (races already in flight) have exited.
* ``runs/e7.hold`` (any content) pauses the driver before the next job, so a free test can take the slot.
* Settings fixed by the brief: --protect-tests landed --ci-seconds 60 --ci-slots 2 --max-wall-minutes 45
  --budget-usd 15 --agents 12 --model sonnet; queue: --batch 4 --no-queue-hold;
  v2: PRELAND_MODE=optimistic PRELAND_SECONDS=60 --snapshot head --error-budget 999.
* ``uptime`` is recorded when the race actually starts (the slot is acquired) and when it ends, plus a load
  sample every 30 s, in runs/<name>.uptime.json (beside the run directory: the race refuses a non-empty one).
* A race aborted by a rate limit is moved to runs/aborted-<name>-aN, the driver waits for the reset and
  re-runs it. No new race starts when the spend so far plus the per-run cap would pass the experiment cap.
* Nothing here touches git.
"""
from __future__ import annotations

import argparse
import datetime as dt
import glob
import hashlib
import json
import os
import re
import subprocess
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
RUNS = os.path.join(HERE, "runs")
SLOT = "/Users/coop/Workspace/beanstalk/research/tools/race-slot.sh"
HOLD = os.path.join(RUNS, "e7.hold")
RUN_CAP_USD = 15.0
TOTAL_CAP_USD = 70.0
MAX_RATE_RETRIES = 4
MAX_CRASH_RETRIES = 1
MAX_OUTAGE_RETRIES = 4
PREFLIGHT_WAIT = 300.0      # seconds outside the slot after a failed pre-flight, then queue again
MAX_PREFLIGHT_WAITS = 24    # two hours of outage at most
# What an API/auth/network outage looks like. Auth failures arrive as an ``is_error`` RESULT (subtype or result
# text with 403, "Request not allowed", "/login"), not as a crash, so the harness books them as completed (empty)
# agent work. Only error results and infra errors are searched, never an agent's normal answer (the arena's
# tasks talk about logins and sessions all the time).
OUTAGE_RESULT = re.compile(r"403|401|Request not allowed|/login|Failed to authenticate|authentication_error|"
                           r"Invalid API key|OAuth token has expired|Unauthorized|Forbidden", re.I)
OUTAGE_INFRA = re.compile(r"workspace routing discovery failed|403|401|Forbidden|Unauthorized|not logged in|"
                          r"Request not allowed|/login|Failed to authenticate", re.I)
SAMPLE_SECONDS = 30.0
YIELD_SECONDS = 0.0       # race-slot.sh now queues FIFO (a re-queued job goes to the back): no manual yield
MIXED_WAIT_MAX = 900.0    # in-slot: give up waiting for --agent mixed to be promoted after this long
STATE = {"yield_first": False, "hold": True, "in_slot": False}


class ChainStop(Exception):
    """In-slot chains do not sleep through a rate limit while holding the machine's only race slot: they stop,
    release it, and the remaining jobs are written to runs/e7-remaining-jobs.txt for a later chain."""


def now() -> str:
    return dt.datetime.now().strftime("%H:%M:%S")


def uptime() -> str:
    return subprocess.run(["uptime"], capture_output=True, text=True).stdout.strip()


def races_running() -> int:
    out = subprocess.run(["pgrep", "-f", "race.py"], capture_output=True, text=True).stdout.split()
    return len(out)


def harness_hash() -> str:
    h = hashlib.sha256()
    for rel in ["race.py"] + sorted(f"harness/{n}" for n in os.listdir(os.path.join(HERE, "harness")) if n.endswith(".py")):
        with open(os.path.join(HERE, rel), "rb") as fh:
            h.update(rel.encode() + b"\0" + fh.read() + b"\0")
    return h.hexdigest()[:12]


def run_name(policy: str, fleet: str, seed: int, shuffle: bool) -> str:
    return f"e7-{policy}-{fleet}-12-s{seed}" + ("-shuf" if shuffle else "")


def race_command(policy: str, fleet: str, seed: int, shuffle: bool, name: str) -> tuple[list[str], dict]:
    cmd = ([] if STATE["in_slot"] else [SLOT]) + [
           "./e7_race.sh", "claude" if fleet == "claude" else "mixed",
           "--agent", "claude" if fleet == "claude" else "mixed", "--model", "sonnet",
           "--agents", "12", "--budget-usd", str(RUN_CAP_USD), "--ci-seconds", "60", "--ci-slots", "2",
           "--protect-tests", "landed", "--max-wall-minutes", "45", "--seed", str(seed)]
    if shuffle:
        cmd.append("--shuffle")
    env = dict(os.environ)
    if policy == "queue":
        cmd += ["--policy", "queue", "--batch", "4", "--no-queue-hold"]
    elif policy == "v2":
        cmd += ["--policy", "beanstalk-v2", "--snapshot", "head", "--error-budget", "999"]
        env.update(PRELAND_MODE="optimistic", PRELAND_SECONDS="60", DECISION_SECONDS="30", DECISION_ORACLE="landed")
    else:
        raise SystemExit(f"unknown policy {policy}")
    cmd += ["--out", f"runs/{name}"]
    return cmd, env


def run_cost(run_dir: str) -> float:
    """Spend of one run: summary.json when the race finished, else the sum of its invocation.end events."""
    try:
        with open(os.path.join(run_dir, "summary.json"), encoding="utf-8") as fh:
            return float(json.load(fh).get("cost_usd") or 0.0)
    except (OSError, json.JSONDecodeError, ValueError):
        pass
    total = 0.0
    try:
        with open(os.path.join(run_dir, "events.jsonl"), encoding="utf-8") as fh:
            for line in fh:
                if '"invocation.end"' in line:
                    total += float(json.loads(line).get("cost_usd") or 0.0)
    except (OSError, json.JSONDecodeError, ValueError):
        pass
    return total


def spent_total() -> float:
    dirs = glob.glob(os.path.join(RUNS, "e7-*")) + glob.glob(os.path.join(RUNS, "aborted-e7-*")) \
        + glob.glob(os.path.join(RUNS, "flagged-highload-e7-*"))
    return sum(run_cost(d) for d in dirs if os.path.isdir(d) and not os.path.basename(d).startswith("e7-zz-"))


def reset_epoch(aborted: str) -> float | None:
    m = re.search(r"resets at ([^)]*)\)", aborted)
    if not m or m.group(1).strip() in ("None", ""):
        return None
    raw = m.group(1).strip()
    try:
        v = float(raw)
        return v / 1000.0 if v > 1e12 else v
    except ValueError:
        try:
            return dt.datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return None


def outage_hits(run_dir: str) -> list[str]:
    """Invocations of a finished (or stopped) race that failed like an outage: error results and infra errors."""
    hits: list[str] = []
    try:
        with open(os.path.join(run_dir, "events.jsonl"), encoding="utf-8") as fh:
            for line in fh:
                if '"invocation.end"' not in line:
                    continue
                e = json.loads(line)
                text = f"{e.get('subtype') or ''} {e.get('result_text') or ''}" if e.get("is_error") else ""
                infra = e.get("infra_error") or ""    # null in a healthy run: counting the key proves nothing
                if (text and OUTAGE_RESULT.search(text)) or (infra and OUTAGE_INFRA.search(infra)):
                    hits.append(f"{e.get('inv')}: {(text or infra).strip()[:80]}")
    except (OSError, json.JSONDecodeError):
        pass
    return hits


def load_summary(out: str) -> dict | None:
    try:
        with open(os.path.join(out, "summary.json"), encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None


class LoadRecorder(threading.Thread):
    """Watches the run log for the slot being acquired (= the race starting), records uptime then and at the
    end, and samples the load average and the number of race.py processes machine-wide in between."""

    def __init__(self, log_path: str, immediate: bool = False):
        super().__init__(daemon=True)
        self.log_path, self.stop, self.immediate = log_path, threading.Event(), immediate
        self.rec: dict = {"start_uptime": None, "start_at": None, "end_uptime": None, "end_at": None, "samples": []}

    def started(self) -> bool:
        if self.immediate:
            return True
        try:
            with open(self.log_path, encoding="utf-8", errors="replace") as fh:
                return "[race-slot] slot" in fh.read()
        except OSError:
            return False

    def sample(self) -> None:
        l1, l5, l15 = os.getloadavg()
        self.rec["samples"].append({"at": now(), "load1": round(l1, 1), "load5": round(l5, 1),
                                    "load15": round(l15, 1), "race_py_procs": races_running()})

    def run(self) -> None:
        while not self.stop.is_set() and not self.started():
            self.stop.wait(2.0)
        if self.stop.is_set():
            return
        self.rec["start_uptime"], self.rec["start_at"] = uptime(), now()
        self.sample()
        while not self.stop.wait(SAMPLE_SECONDS):
            self.sample()

    def finish(self) -> dict:
        self.stop.set()
        self.join(timeout=5)
        self.rec["end_uptime"], self.rec["end_at"] = uptime(), now()
        self.sample()
        loads = [s["load1"] for s in self.rec["samples"]]
        self.rec["load1_mean"] = round(sum(loads) / len(loads), 1) if loads else None
        self.rec["load1_max"] = max(loads) if loads else None
        return self.rec


def yield_slot(log) -> None:
    """Do not re-grab the slot the instant a job ends: other experiments queue for it too."""
    if STATE["yield_first"] and not STATE["in_slot"]:
        log(f"{now()} yielding the slot for {YIELD_SECONDS:.0f} s")
        time.sleep(YIELD_SECONDS)
    STATE["yield_first"] = True


def wait_for_hold(log) -> None:
    announced = False
    while STATE["hold"] and os.path.exists(HOLD):
        if not announced:
            log(f"{now()} HOLD file present: paused")
            announced = True
        time.sleep(10)


def mixed_ready() -> bool:
    """race.py in this directory knows --agent mixed (the dev copy has been promoted here)."""
    out = subprocess.run([sys.executable, "race.py", "--help"], cwd=HERE, capture_output=True, text=True).stdout
    return "mixed" in out


def run_job(spec: str, log) -> None:
    parts = spec.split(":")
    policy, fleet, seed_s, shuf_s = parts[:4]
    rerun = len(parts) > 4 and parts[4] == "rerun"
    seed, shuffle = int(seed_s), shuf_s == "1"
    name = run_name(policy, fleet, seed, shuffle)
    out = os.path.join(RUNS, name)
    rate_retries = crash_retries = outage_retries = preflight_waits = attempt = 0
    waited = 0.0
    while fleet == "mixed" and not mixed_ready():
        if waited == 0.0:
            log(f"{now()} {name}: waiting for --agent mixed to be promoted into race/")
        if STATE["in_slot"] and waited >= MIXED_WAIT_MAX:
            log(f"{now()} SKIP {name}: --agent mixed was not promoted within {MIXED_WAIT_MAX / 60:.0f} min "
                "(the slot is not held for it)")
            return
        time.sleep(30)
        waited += 30
    if rerun and os.path.isdir(out):   # keep the flagged first run beside the clean re-run
        flagged = os.path.join(RUNS, f"flagged-highload-{name}")
        for ext in ("", ".log", ".uptime.json"):
            if os.path.exists(out + ext) and not os.path.exists(flagged + ext):
                os.rename(out + ext, flagged + ext)
        log(f"{now()} moved the flagged first run of {name} to {os.path.basename(flagged)}")
    while True:
        attempt += 1
        wait_for_hold(log)
        yield_slot(log)
        spent = spent_total()
        if spent + RUN_CAP_USD > TOTAL_CAP_USD:
            log(f"{now()} SKIP {name}: spent ${spent:.2f} + cap ${RUN_CAP_USD:.0f} would pass ${TOTAL_CAP_USD:.0f}")
            return
        if os.path.exists(out):
            log(f"{now()} SKIP {name}: {out} already exists")
            return
        cmd, env = race_command(policy, fleet, seed, shuffle, name)
        log_path = os.path.join(RUNS, f"{name}.log")
        log(f"{now()} QUEUED {name} attempt {attempt} harness {harness_hash()} spent ${spent:.2f}")
        rec = LoadRecorder(log_path, immediate=STATE["in_slot"])
        rec.start()
        with open(log_path, "a", encoding="utf-8") as fh:
            rc = subprocess.call(cmd, cwd=HERE, env=env, stdout=fh, stderr=subprocess.STDOUT)
        load = rec.finish()
        if rc == 75 and not os.path.exists(out):   # pre-flight failed inside the slot: nothing ran, nothing spent
            preflight_waits += 1
            log(f"{now()} PRE-FLIGHT FAILED for {name} (wait {preflight_waits}/{MAX_PREFLIGHT_WAITS}): the API is "
                f"not usable; releasing the slot, retrying in {PREFLIGHT_WAIT / 60:.0f} min")
            if preflight_waits > MAX_PREFLIGHT_WAITS:
                log(f"{now()} GIVING UP on {name}: pre-flight kept failing")
                return
            time.sleep(PREFLIGHT_WAIT)
            attempt -= 1
            continue
        with open(os.path.join(RUNS, f"{name}.uptime.json" if attempt == 1 else f"{name}.a{attempt}.uptime.json"),
                  "w", encoding="utf-8") as fh:
            json.dump(load, fh, indent=1)
        s = load_summary(out)
        cost = float((s or {}).get("cost_usd") or 0.0)
        aborted = (s or {}).get("aborted")
        log(f"{now()} END {name} attempt {attempt} exit {rc} cost ${cost:.2f} aborted={aborted}\n"
            f"         start: {load['start_uptime']}\n         end:   {load['end_uptime']}")
        hits = outage_hits(out)
        if hits and outage_retries < MAX_OUTAGE_RETRIES:
            outage_retries += 1
            tag = f"aborted-{name}-a{attempt}-outage"
            for ext in ("", ".log", ".uptime.json"):
                src = out + ext if ext == "" else os.path.join(RUNS, f"{name}{ext}")
                if os.path.exists(src):
                    os.rename(src, os.path.join(RUNS, tag + ext))
            log(f"{now()} OUTAGE CONTAMINATION in {name}: {len(hits)} failed invocations, e.g. {hits[:2]}; run kept "
                f"as {tag} (spend counted), re-running after the pre-flight passes")
            time.sleep(60)
            attempt -= 0
            continue
        if aborted and aborted.startswith("rate limited") and rate_retries < MAX_RATE_RETRIES:
            rate_retries += 1
            os.rename(out, os.path.join(RUNS, f"aborted-{name}-a{attempt}"))
            reset = reset_epoch(aborted)
            if STATE["in_slot"]:
                log(f"{now()} RATE LIMITED {name} (reset {reset}): leaving the slot; the job and the rest of the "
                    "chain go to runs/e7-remaining-jobs.txt")
                raise ChainStop(spec)
            wait = max(120.0, (reset - time.time() + 90.0) if reset else (300.0 if "(auth" in aborted else 1800.0))
            wait = min(wait, 6 * 3600.0)
            log(f"{now()} RATE LIMITED {name}: waiting {wait / 60:.0f} min (reset {reset}) then re-running")
            time.sleep(wait)
            continue
        if s is None and crash_retries < MAX_CRASH_RETRIES:
            crash_retries += 1
            if os.path.exists(out):
                os.rename(out, os.path.join(RUNS, f"aborted-{name}-a{attempt}"))
            log(f"{now()} NO SUMMARY for {name} (exit {rc}): retrying once in 60 s")
            time.sleep(60)
            continue
        return


def run_cmd(script: str, log) -> None:
    """A free or small job (unit tests, a smoke race) in one slot: ``race-slot.sh <script>``."""
    name = os.path.basename(script)
    wait_for_hold(log)
    yield_slot(log)
    log_path = os.path.join(RUNS, f"{name}.slot.log")
    log(f"{now()} QUEUED cmd {name}")
    rec = LoadRecorder(log_path, immediate=STATE["in_slot"])
    rec.start()
    with open(log_path, "a", encoding="utf-8") as fh:
        rc = subprocess.call(([] if STATE["in_slot"] else [SLOT]) + [script], cwd=os.path.dirname(script),
                             stdout=fh, stderr=subprocess.STDOUT)
    load = rec.finish()
    with open(os.path.join(RUNS, f"{name}.uptime.json"), "w", encoding="utf-8") as fh:
        json.dump(load, fh, indent=1)
    log(f"{now()} END cmd {name} exit {rc}\n         start: {load['start_uptime']}\n         end:   {load['end_uptime']}")


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--wait-pid", type=int, action="append", default=[], help="start only after these exit")
    ap.add_argument("--label", default="serial", help="label for the log file")
    ap.add_argument("--no-hold", action="store_true", help="ignore runs/e7.hold")
    ap.add_argument("--in-slot", action="store_true",
                    help="this driver was itself started under race-slot.sh (one slot for the whole chain): "
                         "run races and scripts directly")
    ap.add_argument("jobs", nargs="+", help="policy:fleet:seed:shuffle (e.g. queue:claude:5:1) or cmd:/path/script")
    a = ap.parse_args()
    os.makedirs(RUNS, exist_ok=True)
    path = os.path.join(RUNS, f"e7-driver-{a.label}.log")

    def log(msg: str) -> None:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(msg + "\n")
        print(msg, flush=True)

    STATE["hold"] = not a.no_hold
    STATE["in_slot"] = a.in_slot
    STATE["yield_first"] = bool(a.wait_pid)   # the slot we wait for was one of ours: yield it once
    log(f"{now()} driver {a.label}: {' '.join(a.jobs)}; waiting for pids {a.wait_pid}")
    while any(pid_alive(p) for p in a.wait_pid):
        time.sleep(2)
    for i, spec in enumerate(a.jobs):
        try:
            if spec.startswith("cmd:"):
                run_cmd(spec[4:], log)
            else:
                run_job(spec, log)
        except ChainStop:
            with open(os.path.join(RUNS, "e7-remaining-jobs.txt"), "w", encoding="utf-8") as fh:
                fh.write(" ".join(a.jobs[i:]) + "\n")
            log(f"{now()} driver {a.label} stopped at job {i}: {' '.join(a.jobs[i:])}")
            return 75
    log(f"{now()} driver {a.label} done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
