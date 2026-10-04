#!/usr/bin/env python3
"""Everything that happens inside ONE machine-wide race slot for one E5 condition (a pair of races: v2 and the queue, back
to back, so both see the same machine). Run it through the slot:

    research/tools/race-slot.sh python3 scripts/hold.py A          # or B

Per race: spend guard, pre-flight auth check (waits up to 10 minutes for an outage to clear), the race
(scripts/_race_inner.sh: Sonnet, 12 agents, seed 7, the brief's flags; uptime printed at start and end), then the verdict
(scripts/check_run.py). A contaminated run (infrastructure errors such as the 403 "Request not allowed" outage) is kept
as race/runs/<name>-void-<k> and re-run; a rate-limited run waits for the reset when it is near and re-runs.
State is kept in race/runs/e5-state.json so that a later hold resumes where this one stopped.

Exit codes: 0 all races of the condition final; 75 auth still failing (re-queue later); 76 rate limit far from its reset
(re-queue after it); 78 hold time budget used (re-queue for the rest); 90 spend guard; 91 anything else that needs a look.
The hold stays under HOLD_MINUTES (default 80, the coordinator's limit is about 90) by not starting a race after that.
"""
from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RUNS = os.environ.get("E5_RUNS") or os.path.join(ROOT, "race", "runs")      # E5_* overrides: tests only
STATE = os.environ.get("E5_STATE") or os.path.join(RUNS, "e5-state.json")      # one state file per concurrently queued condition
INNER = os.environ.get("E5_INNER") or os.path.join(HERE, "_race_inner.sh")
TEST = bool(os.environ.get("E5_TEST"))
sys.path.insert(0, HERE)
from check_run import check  # noqa: E402

HOLD_MINUTES = float(os.environ.get("HOLD_MINUTES", "80"))
MAX_ATTEMPTS = 3
FINAL = ("CLEAN", "BUDGET", "WALL")

CONDITIONS = {
    # name, policy, task set, emulated-drift factor, expected cost USD (for the spend guard; the real costs were 3.5-4.0 for the
    # compound races without drift). The order inside a condition alternates to cancel order effects.
    "A": [("e5-long-v2", "v2", "long", 1, 5.5), ("e5-long-queue", "queue", "long", 1, 5.5)],
    "B": [("e5-short-d7-queue", "queue", "short", 7, 7.5), ("e5-short-d7-v2", "v2", "short", 7, 7.5)],
    # C: the 16 compounds with every agent invocation held to 4 x its real wall time (a ~30 s compound session becomes ~2 min,
    # the same in-race bean length as B's 7 x 17 s), so that {native, compound} x {short, long} is a full 2 x 2 with A and B
    "C": [("e5-long-d4-v2", "v2", "long", 4, 5.5), ("e5-long-d4-queue", "queue", "long", 4, 5.5)],
    # R (extra): v2 with the agent released while its change is checked (policy_beanstalk_v2r.py) on B's task set and drift, one
    # race; preceded inside the same hold by a free replay smoke test (scripts/replay_v2r.sh)
    "R": [("e5-short-d7-v2r", "v2r", "short", 7, 5.5)],
    # A2: a repeat of A (a second sample of the compound race pair; real agents are not seeded, so --seed only labels it)
    "A2": [("e5-long-r2-queue", "queue", "long", 1, 5.5), ("e5-long-r2-v2", "v2", "long", 1, 5.5)],
}


def load_state() -> dict:
    try:
        return json.load(open(STATE, encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_state(st: dict) -> None:
    tmp = STATE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(st, fh, indent=1)
    os.replace(tmp, STATE)


def log(msg: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} [hold] {msg}", flush=True)


def keep_contaminated(name: str, st: dict) -> None:
    k = st[name].get("contaminated", 0) + 1
    st[name]["contaminated"] = k
    for suffix in ("", ".log"):
        src, dst = os.path.join(RUNS, name + suffix), os.path.join(RUNS, f"{name}-void-{k}{suffix}")
        if os.path.exists(src):
            os.replace(src, dst)


PRE = {"R": "replay_v2r.sh"}      # free smoke test run once inside the hold, before the first race of the condition
SEEDS = {"A2": "11"}      # real agents are not seeded: the seed only labels the repeat (as the short pair's seed 11)


def run_race(name: str, policy: str, arena: str, drift: int, child: dict, cond: str = "") -> None:
    env = dict(os.environ, SEED=SEEDS.get(cond, "7"))
    p = subprocess.Popen(["bash", INNER, name, policy, arena, str(drift)], start_new_session=True, env=env)
    child["p"] = p
    p.wait()


def main() -> int:
    cond = sys.argv[1]
    races = CONDITIONS[cond]
    t_start = time.time()
    st = load_state()
    child: dict = {}

    def on_term(sig, frame):  # race-slot.sh sends SIGTERM: stop the race cleanly (its own handler aborts it)
        p = child.get("p")
        if p and p.poll() is None:
            os.killpg(p.pid, signal.SIGTERM)
        log("terminated by signal")
        sys.exit(79)

    signal.signal(signal.SIGTERM, on_term)
    signal.signal(signal.SIGINT, on_term)
    log(f"condition {cond}: {[r[0] for r in races]}; uptime: {subprocess.run(['uptime'], capture_output=True, text=True).stdout.strip()}")
    pre = PRE.get(cond)
    if pre and not TEST and any(st.get(r[0], {}).get("verdict") not in FINAL for r in races):
        log(f"smoke test {pre}")
        if subprocess.run(["bash", os.path.join(HERE, pre)]).returncode != 0:
            log(f"smoke test {pre} FAILED: no paid race started")
            return 91
    for idx, (name, policy, arena, drift, expect) in enumerate(races):
        entry = st.setdefault(name, {"attempts": 0, "verdict": None})
        if entry.get("verdict") in FINAL:
            log(f"{name}: already {entry['verdict']}")
            continue
        while entry["attempts"] < MAX_ATTEMPTS:
            if (time.time() - t_start) / 60 > HOLD_MINUTES:
                log(f"hold time used ({HOLD_MINUTES:.0f} min); {name} waits for the next hold")
                save_state(st)
                return 78
            # spend guard: the races still to run in this condition must fit under the cap together (no half pairs)
            need = sum(r[4] for r in races[idx:] if st.get(r[0], {}).get("verdict") not in FINAL)
            if not TEST and subprocess.run([sys.executable, os.path.join(HERE, "spend.py"), "--need", f"{need:g}"]).returncode != 0:
                save_state(st)
                return 90
            if not TEST and subprocess.run([sys.executable, os.path.join(HERE, "preflight.py"), "--wait-minutes", "10"]).returncode != 0:
                log("auth / API still failing after 10 minutes: releasing the slot")
                save_state(st)
                return 75
            entry["attempts"] += 1
            entry["last_start"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
            save_state(st)
            log(f"{name}: attempt {entry['attempts']}")
            run_race(name, policy, arena, drift, child, cond)
            v = check(os.path.join(RUNS, name))
            entry.update(verdict=v["verdict"], cost_usd=v.get("cost_usd"), aborted=v.get("aborted"),
                         infra=len(v["infra"]), last_end=time.strftime("%Y-%m-%dT%H:%M:%S%z"))
            save_state(st)
            log(f"{name}: {v['verdict']} cost ${v.get('cost_usd')} green {v.get('tasks_green')}/{v.get('tasks')} "
                f"infra {len(v['infra'])} aborted={v.get('aborted')} final_correct={v.get('final_correct')}")
            if v["verdict"] in FINAL:
                break
            if v["verdict"] == "CONTAMINATED":
                keep_contaminated(name, st)
                entry["verdict"] = None
                save_state(st)
                continue
            if v["verdict"] == "RATE_LIMITED":
                reset = v.get("resets_at") or 0
                wait = reset - time.time() + 30
                if wait > 20 * 60:
                    log(f"rate limit resets in {wait / 60:.0f} min: releasing the slot")
                    keep_contaminated(name, st)
                    entry["verdict"] = None
                    save_state(st)
                    return 76
                log(f"rate limited: waiting {max(wait, 30) / 60:.1f} min for the reset")
                keep_contaminated(name, st)
                entry["verdict"] = None
                save_state(st)
                time.sleep(max(wait, 30))
                continue
            save_state(st)
            return 91
        else:
            log(f"{name}: {MAX_ATTEMPTS} attempts without a usable run")
            save_state(st)
            return 91
    log(f"condition {cond} final: " + ", ".join(f"{r[0]}={st[r[0]]['verdict']}" for r in races))
    return 0


if __name__ == "__main__":
    sys.exit(main())
