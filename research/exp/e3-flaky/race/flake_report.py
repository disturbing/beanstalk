#!/usr/bin/env python3
"""E3: what flakes did to each race. Reads runs/<name>/events.jsonl and summary.json (ground truth is in the events).

Usage: python3 flake_report.py runs/<a> runs/<b> ... [--md out.md] [--json out.json]

Per run: CI runs and how many flaked (by purpose), real reds, re-runs (absorbed / confirmed) and their cost, needless
reworks (a rework or queue ejection whose red was a flake) with their agent cost and the delay they caused, wrongful
reverts (a revert-first whose red was a flake) and the tasks they lost, decision cards that flakes fed, the flake
history (tests that flipped on one tree), a what-if for quarantining a test after its 1st or 2nd flip, and how well
"the bean cannot reach the failing test" separates flake reds from real ones (the smart-retry rule).
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness.flake import metrics  # noqa: E402


def load(run: str) -> tuple[list[dict], dict]:
    with open(os.path.join(run, "events.jsonl"), encoding="utf-8") as fh:
        ev = [json.loads(line) for line in fh if line.strip()]
    summary = {}
    sp = os.path.join(run, "summary.json")
    if os.path.exists(sp):
        with open(sp, encoding="utf-8") as fh:
            summary = json.load(fh)
    return ev, summary


def run_kind(e: dict) -> str | None:
    if e["type"] == "preland.check":
        return "preland"
    if e["type"] == "ci.end" and e.get("green") is not None and e.get("purpose") != "final":
        return e.get("purpose")
    return None


def quarantine_whatif(ev: list[dict], flips_needed: int) -> tuple[int, int]:
    """(flake reds that a quarantine after ``flips_needed`` flips would have absorbed, all flake reds)."""
    flips: dict[str, int] = {}
    absorbed = total = 0
    for e in ev:
        if e["type"] == "flake.flip":
            flips[e["test"]] = e.get("flips", flips.get(e["test"], 0) + 1)
        elif run_kind(e) and e.get("flaked"):
            total += 1
            if flips.get(e.get("flake_test", ""), 0) >= flips_needed:
                absorbed += 1
    return absorbed, total


def delays(ev: list[dict]) -> dict:
    """Seconds from the red that sent a bean back (flake only) to the bean's landing; and a normal bean's check-to-land."""
    land = {}
    for e in ev:
        if e["type"] == "land" and e.get("task"):
            land.setdefault(e["task"], e["t"])
    out, normal = [], []
    first_check: dict[str, float] = {}
    for e in ev:
        if e["type"] == "preland.check":
            first_check.setdefault(e["task"], e["t"])
        if e["type"] in ("rework.start", "queue.eject") and (e.get("needless") or (e["type"] == "queue.eject" and e.get("flake_only"))):
            tid = e.get("task")
            if tid in land:
                out.append(land[tid] - e["t"])
    needless_tasks = {e.get("task") for e in ev if e["type"] == "rework.start" and e.get("needless")}
    for tid, t0 in first_check.items():
        if tid in land and tid not in needless_tasks:
            normal.append(land[tid] - t0)
    return {"needless_to_land_s": round(statistics.fmean(out), 1) if out else None,
            "normal_check_to_land_s": round(statistics.fmean(normal), 1) if normal else None}


def reach_table(ev: list[dict]) -> dict:
    """Red pre-land checks by (flake | real) and whether the bean's change can reach a failing test."""
    t = {"flake": {"reach": 0, "no_reach": 0}, "real": {"reach": 0, "no_reach": 0}}
    for e in ev:
        if e["type"] == "preland.check" and e.get("green") is False and "touches_bean" in e:
            t["flake" if e.get("flaked") else "real"]["reach" if e["touches_bean"] else "no_reach"] += 1
    return t


def rerun_consistency(ev: list[dict]) -> dict:
    """For each confirmed re-run (red twice): did the second run fail the SAME test files as the first?

    A real red fails the same tests again; two different failures in a row are two flakes. Joins each ``flake.rerun`` to the
    re-run result event (``rerun`` flag, same commit) that precedes it."""
    out = {"confirmed": 0, "same_tests": 0, "disjoint": 0, "disjoint_both_flaked": 0, "disjoint_events": []}
    for i, e in enumerate(ev):
        if e["type"] != "flake.rerun" or e.get("outcome") != "confirmed":
            continue
        second = next((x for x in reversed(ev[:i]) if x.get("rerun") and x["type"] in ("preland.check", "ci.end")
                       and x.get("sha") == e.get("sha")), None)
        first = set(e.get("first_failing") or [])
        later = set((second or {}).get("failing_files") or [])
        out["confirmed"] += 1
        if first & later or not first or not later:
            out["same_tests"] += 1
        else:
            out["disjoint"] += 1
            out["disjoint_both_flaked"] += 1 if (e.get("first_flaked") and e.get("second_flaked")) else 0
            out["disjoint_events"].append({"t": e["t"], "purpose": e["purpose"], "task": e.get("task"), "first": sorted(first),
                                           "second": sorted(later), "both_flakes": bool(e.get("first_flaked") and e.get("second_flaked"))})
    return out


def timeline(run: str) -> list[str]:
    """One line per flaked run and what followed it (the consequence chain), for reading a race."""
    ev, _ = load(run)
    lines = []
    for i, e in enumerate(ev):
        if not (run_kind(e) and e.get("flaked")):
            continue
        k = run_kind(e)
        who = e.get("task") or (f"batch {e.get('batch')}" if e.get("batch") else f"sprout #{e.get('trunk_idx')}")
        head = f"t={e['t']:7.1f}s  {k:8s} {who}  flaked: {e.get('flake_test')}"
        follow = []
        for x in ev[i + 1:]:
            if x["t"] - e["t"] > 600:
                break
            t = x["type"]
            if k == "preland" and x.get("task") == e.get("task"):
                if t == "flake.rerun":
                    follow.append(f"re-run {x['outcome']}")
                elif t == "rework.start":
                    follow.append(f"rework ({x.get('reason')}{', needless' if x.get('needless') else ''})")
                elif t == "land":
                    follow.append(f"landed at +{x['t'] - e['t']:.0f}s")
                    break
            elif k == "validate":
                if t == "flake.rerun" and x.get("trunk_idx") == e.get("trunk_idx"):
                    follow.append(f"re-run {x['outcome']}")
                elif t == "ticket.open":
                    follow.append(f"ticket {x.get('ticket')} ({x.get('method')})")
                elif t == "ticket.bisect":
                    follow.append("ticket via bisect")
                elif t == "revert":
                    follow.append(f"REVERT of {x.get('task')} (flake_only={x.get('flake_only')}) at +{x['t'] - e['t']:.0f}s")
                elif t == "green.promote" and (x.get("trunk_idx") or 0) >= (e.get("trunk_idx") or 0):
                    follow.append(f"stalk promoted at +{x['t'] - e['t']:.0f}s")
                    break
            elif k in ("batch", "bisect") and (x.get("batch") == e.get("batch") or t in ("queue.eject", "green.promote")):
                if t == "flake.rerun":
                    follow.append(f"retry {x['outcome']}")
                elif t == "batch.red":
                    follow.append("batch.red")
                elif t == "bisect.end":
                    follow.append(f"bisect culprit {x.get('culprit')}")
                elif t == "queue.eject":
                    follow.append(f"eject {x.get('task')} flake_only={x.get('flake_only')}")
                    break
                elif t == "green.promote" and x.get("tasks"):
                    follow.append(f"landed at +{x['t'] - e['t']:.0f}s")
                    break
        lines.append(head + ("  ->  " + "; ".join(follow) if follow else ""))
    return lines


def analyse(run: str) -> dict:
    ev, s = load(run)
    m = metrics(ev)
    reds = {"real": {}, "flake": {}}
    for e in ev:
        k = run_kind(e)
        if k and e.get("green") is False:
            reds["flake" if e.get("flaked") else "real"][k] = reds["flake" if e.get("flaked") else "real"].get(k, 0) + 1
    cfg = next((e for e in ev if e["type"] == "flake.config"), {})
    cards = [e for e in ev if e["type"] == "decision.request"]
    f = s.get("final") or {}
    inv_cost = {}
    for e in ev:
        if e["type"] == "invocation.end":
            inv_cost[e.get("kind")] = inv_cost.get(e.get("kind"), 0.0) + (e.get("cost_usd") or 0.0)
    lost = set(m["wrongful_revert_tasks"])
    lost_usd = round(sum((e.get("cost_usd") or 0.0) for e in ev if e["type"] == "invocation.end" and e.get("task") in lost), 4)
    out = {
        "lost_work_usd": lost_usd,
        "run": os.path.basename(run.rstrip("/")), "policy": s.get("policy"), "variant": (s.get("beanstalk") or {}).get("variant"),
        "rate": cfg.get("rate"), "mitigations": {k: cfg.get(k) for k in ("rerun_preland", "rerun_validate", "retry_batch", "quarantine_flips")},
        "greens": s.get("tasks_green"), "dropped": s.get("tasks_dropped"), "cost_usd": s.get("cost_usd"),
        "wall_min": round((s.get("wall_seconds") or 0) / 60, 1), "correct": f.get("correct"),
        "aborted": s.get("aborted"), "invocations": s.get("invocations"), "cost_by_kind": {k: round(v, 3) for k, v in inv_cost.items()},
        "ci_runs": m["ci_runs"], "ci_runs_total": m["ci_runs_total"], "flaked_runs": m["flaked_runs"],
        "flaked_by_purpose": m["flaked_runs_by_purpose"], "real_reds": reds["real"], "flake_reds": reds["flake"],
        "reruns": m["reruns"], "rerun_minutes": m["rerun_minutes"],
        "needless_reworks": m["needless_reworks"], "needless_rework_cost_usd": m["needless_rework_cost_usd"],
        "needless_that_edited_files": m["needless_reworks_that_edited_files"],
        "reverts": m["reverts"], "wrongful_reverts": m["wrongful_reverts"], "wrongful_revert_tasks": m["wrongful_revert_tasks"],
        "reverts_after_flaky_probes": m["reverts_after_flaky_probes"], "flaked_validations": m["flaked_validations"],
        "flake_tickets": m["flake_tickets"], "flake_tickets_exonerated": m["flake_tickets_exonerated"],
        "flake_tickets_reverted": m["flake_tickets_reverted"],
        "validations": {k: (s.get("beanstalk") or {}).get(k) for k in ("validations", "validations_green", "validations_red",
                                                                      "stale_reds", "tickets", "tickets_escalated")},
        "queue_red_ejections": m["queue_red_ejections"], "queue_needless_ejections": m["queue_needless_ejections"],
        "cards": len(cards), "cards_fed_by_flakes": sum(1 for c in cards if c.get("flake_reds")),
        "flaky_tests": m["flaky_tests"], "pool": (s.get("flake") or {}).get("pool"),
        "quarantine_whatif": {n: quarantine_whatif(ev, n) for n in (1, 2)},
        "delays": delays(ev), "reach": reach_table(ev), "machine": s.get("machine"), "consistency": rerun_consistency(ev),
        "ci_slot_utilization": round((s.get("ci_minutes_total") or 0) / max(1e-9, (s.get("config", {}).get("ci_slots") or 1)
                                                                           * (s.get("wall_seconds") or 1) / 60), 2),
        "ci_minutes": s.get("ci_minutes"), "task_start_to_green": s.get("task_start_to_green_seconds"),
        "total_check_minutes": round(sum((e.get("check_seconds") or 0) for e in ev if e["type"] == "preland.check") / 60
                                     + sum((e.get("ci_seconds") or 0) for e in ev if e["type"] == "ci.end"
                                           and e.get("purpose") != "final") / 60, 1),
    }
    return out


def show(a: dict) -> None:
    mit = [k for k, v in a["mitigations"].items() if v]
    print(f"== {a['run']}: {a['policy']} {a['variant'] or ''} rate={a['rate']} mitigations={mit or 'none'}")
    print(f"   greens {a['greens']} dropped {a['dropped']} wall {a['wall_min']} min cost ${a['cost_usd']} correct {a['correct']}"
          + (f" ABORTED: {a['aborted']}" if a["aborted"] else ""))
    print(f"   CI runs {a['ci_runs_total']} {a['ci_runs']}; flaked {a['flaked_runs']} {a['flaked_by_purpose']}; "
          f"real reds {a['real_reds']}; total check minutes {a['total_check_minutes']}")
    print(f"   re-runs {a['reruns']} ({a['rerun_minutes']} min); of which on a real red: "
          f"{sum(r.get('on_real', 0) for r in a['reruns'].values())}")
    print(f"   needless reworks {a['needless_reworks']} (${a['needless_rework_cost_usd']}; the agent edited files in "
          f"{a['needless_that_edited_files']}); queue needless ejections {a['queue_needless_ejections']}/{a['queue_red_ejections']}")
    print(f"   reverts {a['reverts']} wrongful {a['wrongful_reverts']} {a['wrongful_revert_tasks']} (agent work thrown away "
          f"${a['lost_work_usd']}); after flaky probes "
          f"{a['reverts_after_flaky_probes']}; cards {a['cards']} (fed by flakes {a['cards_fed_by_flakes']})")
    print(f"   flaked validations {a['flaked_validations']}: tickets {a['flake_tickets']}, exonerated by a later green "
          f"{a['flake_tickets_exonerated']}, reverted {a['flake_tickets_reverted']}")
    c = a["consistency"]
    print(f"   confirmed re-runs {c['confirmed']}: same failing tests again {c['same_tests']}, different tests {c['disjoint']} "
          f"(both flakes: {c['disjoint_both_flaked']}) {c['disjoint_events'] or ''}")
    print(f"   sprout validations {a['validations']}")
    print(f"   flaky tests found {a['flaky_tests']}; pool {a['pool']}")
    print(f"   quarantine what-if (absorbed/flake reds) after 1 flip {a['quarantine_whatif'][1]}, after 2 {a['quarantine_whatif'][2]}")
    print(f"   delays {a['delays']}; red pre-land checks by reach {a['reach']}")
    print(f"   CI slot utilization {a['ci_slot_utilization']} (CI minutes {a['ci_minutes']}); task start to green {a['task_start_to_green']}")
    if a["machine"]:
        print(f"   load(1m) {a['machine']}")


def md(rows: list[dict]) -> str:
    head = ["run", "rate", "mitigations", "greens", "dropped", "cost $", "wall min", "CI runs", "flaked", "re-runs absorbed/total",
            "needless reworks ($)", "wrongful reverts/reverts", "queue needless ejections", "flaky tests found", "load1 mean/max"]
    lines = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    for a in rows:
        rr = a["reruns"].values()
        mit = ",".join(k.replace("rerun_", "re-run ").replace("retry_batch", "retry batch") for k, v in a["mitigations"].items() if v) or "none"
        mach = a["machine"] or {}
        lines.append("| " + " | ".join([
            a["run"], str(a["rate"]), mit, str(a["greens"]), str(a["dropped"]), f"{a['cost_usd']:.2f}", str(a["wall_min"]),
            str(a["ci_runs_total"]), str(a["flaked_runs"]), f"{sum(r['absorbed'] for r in rr)}/{sum(r['count'] for r in rr)}",
            f"{a['needless_reworks']} ({a['needless_rework_cost_usd']:.2f})", f"{a['wrongful_reverts']}/{a['reverts']}",
            f"{a['queue_needless_ejections']}/{a['queue_red_ejections']}", str(len(a["flaky_tests"])),
            f"{mach.get('load1_mean', '-')}/{mach.get('load1_max', '-')}"]) + " |")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("runs", nargs="+")
    ap.add_argument("--md")
    ap.add_argument("--json")
    ap.add_argument("--timeline", action="store_true", help="list every flaked run and what followed it")
    a = ap.parse_args()
    rows = [analyse(r) for r in a.runs]
    for r, run in zip(rows, a.runs):
        show(r)
        if a.timeline:
            for line in timeline(run):
                print("     " + line)
    table = md(rows)
    print("\n" + table)
    if a.md:
        with open(a.md, "w", encoding="utf-8") as fh:
            fh.write(table + "\n")
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(rows, fh, indent=2, default=str)


if __name__ == "__main__":
    main()
