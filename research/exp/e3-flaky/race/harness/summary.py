"""summary.json / summary.md for one run (README metrics plus footprint, cost-by-kind, final check)."""
from __future__ import annotations

import json
import os
import statistics
from collections import Counter


def _pct(xs: list[float], q: float) -> float | None:
    if not xs:
        return None
    xs = sorted(xs)
    k = (len(xs) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(xs) - 1)
    return round(xs[lo] + (xs[hi] - xs[lo]) * (k - lo), 2)


def build(race) -> dict:
    cfg = race.cfg
    wall = (race.ended_at if race.ended_at is not None else race.now()) - race.race_t0
    tasks = race.tasks
    green = [t for t in tasks if t.status == "green"]
    landed = [t for t in tasks if t.landed_sha]
    green_times = [t.green_at for t in green if t.green_at is not None]
    to_green = [t.green_at - t.started_at for t in green if t.green_at is not None and t.started_at is not None]
    agent_totals = {"busy": 0.0, "blocked": 0.0, "idle": 0.0}
    for a in race.agents:
        for k in agent_totals:
            agent_totals[k] += a.totals[k]
    inv = {k: {kk: (round(vv, 4) if isinstance(vv, float) else vv) for kk, vv in v.items()}
           for k, v in sorted(race.inv_stats.items())}
    ci = race.ci
    ci_runs = {}
    ci_minutes = {}
    for ev in race.events.events:
        if ev["type"] == "ci.end":
            p = ev.get("purpose", "?") + ("-cancelled" if ev.get("cancelled") else "")
            ci_runs[p] = ci_runs.get(p, 0) + 1
            ci_minutes[p] = ci_minutes.get(p, 0.0) + ev.get("ci_seconds", 0.0) / 60
    race_ci = {p: n for p, n in ci_runs.items() if p != "final"}
    race_ci_min = {p: round(m, 2) for p, m in ci_minutes.items() if p != "final"}
    startup = [i["startup_ms"] for i in race.invocations if i.get("startup_ms")]
    agent_inv = [i for i in race.invocations if i["kind"] in ("initial", "rework", "fixer")]
    all_green_at = max(green_times) - race.race_t0 if green_times and len(green) == len(tasks) else None
    summary = {
        "label": f"measured: arena={os.path.basename(os.path.normpath(cfg.arena))}@{race.base_sha[:8]}"
                 f"/{race.arena_digest[:8]}, "
                 f"{len(tasks)} tasks, policy={race.policy}, "
                 f"agent={cfg.agent}" + (f" ({getattr(race.adapter, 'model', '')})" if cfg.agent != "replay" else
                                         " (replay control: reference patches, synthetic timings)"),
        "policy": race.policy, "agent": cfg.agent, "model": getattr(race.adapter, "model", None),
        "arena_base": race.base_sha,
        "arena_digest": race.arena_digest,
        "config": {"agents": cfg.agents, "ci_seconds": cfg.ci_seconds, "ci_slots": cfg.ci_slots,
                   "batch": cfg.batch if race.policy == "queue" else None, "seed": cfg.seed,
                   "budget_usd": cfg.budget_usd, "max_turns": cfg.max_turns, "agent_timeout": cfg.agent_timeout,
                   "union_merge": cfg.union(), "snapshot": cfg.snapshot if race.policy == "beanstalk" else None,
                   "queue_hold": cfg.queue_hold if race.policy == "queue" else None,
                   "error_budget": cfg.error_budget if race.policy == "beanstalk" else None,
                   "footprint": race.footprint_method, "tasks": len(tasks),
                   "protect_tests": cfg.protect_tests},
        "aborted": race.aborted,
        "wall_seconds": round(wall, 2),
        "tasks": len(tasks),
        "tasks_green": len(green),
        "tasks_landed": len(landed),
        "tasks_dropped": sum(1 for t in tasks if t.status == "dropped"),
        "acceptance_restored": {
            "own": sum(1 for t in tasks for p in t.tamper if p in t.task.acceptance_tests),
            "other_tasks": sum(1 for t in tasks for p in t.tamper if p not in t.task.acceptance_tests)},
        "drops_by_reason": dict(sorted(Counter((t.drop_reason or "?").split(":")[0].split(" after ")[0]
                                               for t in tasks if t.status == "dropped").items())),
        "changes_green_per_hour": round(len(green) / (wall / 3600), 3) if wall > 0 else None,
        "wall_to_all_green_seconds": round(all_green_at, 2) if all_green_at is not None else None,
        "task_start_to_green_seconds": {"median": _pct(to_green, 0.5), "p90": _pct(to_green, 0.9),
                                        "mean": round(statistics.fmean(to_green), 2) if to_green else None},
        "agent_minutes": {k: round(v / 60, 2) for k, v in agent_totals.items()},
        "agent_minutes_per_agent": {a.id: {k: round(v / 60, 2) for k, v in a.totals.items()} for a in race.agents},
        "invocations": {k: v.get("count", 0) for k, v in inv.items()},
        "invocation_stats": inv,
        "cost_usd": round(race.spent, 4),
        "cost_by_kind": {k: v.get("cost_usd", 0.0) for k, v in inv.items()},
        "tokens_by_kind": {k: {t: v.get(t, 0) for t in ("input_tokens", "output_tokens", "cache_read_input_tokens",
                                                       "cache_creation_input_tokens")} for k, v in inv.items()},
        "invocation_overhead": {
            "startup_ms_median": _pct([float(s) for s in startup], 0.5),
            "wall_minus_api_ms_median": _pct([float(i["wall_ms"] - i["duration_api_ms"]) for i in agent_inv
                                              if i.get("duration_api_ms")], 0.5),
            "cost_per_agent_invocation_mean": round(statistics.fmean(i["cost_usd"] for i in agent_inv), 4)
            if agent_inv else None},
        "subscription": {
            "invocations_on_overage": sum(1 for i in race.invocations if i.get("overage")),
            "last_rate_limit": next((i["rate_limit"] for i in reversed(race.invocations) if i.get("rate_limit")),
                                    None),
            "note": "claude -p on a claude.ai plan: total_cost_usd is computed at list prices (costBasis=list); "
                    "invocations on overage are billed as extra usage"},
        "ci_runs": race_ci,
        "ci_runs_total": sum(race_ci.values()),
        "ci_minutes": race_ci_min,
        "ci_minutes_total": round(sum(race_ci_min.values()), 2),
        "textual_conflicts": race.conflicts_met,
        "red_validations": race.red_validations,
        "final": {k: v for k, v in race.final.items() if k != "per_task"},
        "footprint_quality": race.footprint_quality(),
        "per_task": {},
    }
    summary.update(race.policy_summary())
    try:
        summary["flake"] = race.flake_summary()
    except Exception as e:  # noqa: BLE001 - a bug in the flake books must never cost a finished race its summary
        summary["flake"] = {"error": repr(e)}
    loads = [e for e in race.events.events if e["type"] == "machine.load"]
    if loads:
        l1 = [e["load1"] for e in loads]
        summary["machine"] = {"cpus": loads[0].get("cpus"), "load1_start": l1[0], "load1_end": l1[-1],
                              "load1_mean": round(statistics.fmean(l1), 1), "load1_max": max(l1),
                              "load5_start": loads[0]["load5"], "load5_end": loads[-1]["load5"], "samples": len(l1)}
    for t in tasks:
        rel = (lambda v: None if v is None else round(v - race.race_t0, 3))  # seconds since race.start
        summary["per_task"][t.id] = {
            "status": t.status, "agent": t.agent, "started_at": rel(t.started_at), "landed_at": rel(t.landed_at),
            "green_at": rel(t.green_at), "reworks": t.reworks, "conflicts": t.conflicts, "reds": t.reds,
            "predicted": t.selected, "actual_modules": t.actual_modules, "oracle_modules": t.task.oracle_modules,
            "invocations": len(t.invocations), "drop_reason": t.drop_reason, "tamper": t.tamper,
            "final_acceptance": (race.final.get("per_task") or {}).get(t.id, {}).get("acceptance_pass"),
        }
    return summary


def to_markdown(s: dict) -> str:
    f = s.get("final", {})
    fq = s.get("footprint_quality", {})
    va = fq.get("vs_actual") or {}
    vo = fq.get("vs_oracle") or {}
    am = s["agent_minutes"]
    rows = [
        ("Changes reaching green per hour", s["changes_green_per_hour"]),
        ("Tasks green / landed / dropped / total", f"{s['tasks_green']} / {s['tasks_landed']} / "
                                                     f"{s['tasks_dropped']} / {s['tasks']}"),
        ("Drops by reason", "; ".join(f"{k}: {v}" for k, v in s["drops_by_reason"].items()) or "none"),
        ("Wall-clock (min)", round(s["wall_seconds"] / 60, 2)),
        ("Wall-clock to all-green (min)", round(s["wall_to_all_green_seconds"] / 60, 2)
         if s["wall_to_all_green_seconds"] is not None else "not reached"),
        ("Task start to green, median / p90 (min)",
         " / ".join("-" if v is None else str(round(v / 60, 2))
                    for v in (s["task_start_to_green_seconds"]["median"], s["task_start_to_green_seconds"]["p90"]))),
        ("Agent minutes busy / blocked / idle", f"{am['busy']} / {am['blocked']} / {am['idle']}"),
        ("Invocations (initial / rework / fixer / classifier)",
         " / ".join(str(s["invocations"].get(k, 0)) for k in ("initial", "rework", "fixer", "classifier"))),
        ("Cost USD (total)", s["cost_usd"]),
        ("Cost USD by kind", ", ".join(f"{k} {v:.4f}" for k, v in s["cost_by_kind"].items()) or "-"),
        ("CI runs / minutes", f"{s['ci_runs_total']} / {s['ci_minutes_total']}"),
        ("CI runs by purpose", ", ".join(f"{k} {v}" for k, v in s["ci_runs"].items()) or "-"),
        ("Textual conflicts met", s["textual_conflicts"]),
        ("Red validations", s["red_validations"]),
        ("Final green: suite green", f.get("suite_green")),
        ("Final green: tasks accepted / total", f"{f.get('tasks_accepted')} / {f.get('tasks_total')}"),
        ("Final green correct (suite + every green task's acceptance)", f.get("correct")),
        ("Base tests edited by landed changes", ", ".join(f.get("base_tests_changed") or []) or "none"),
        ("Acceptance tests restored before commit (own / other tasks')",
         f"{s['acceptance_restored']['own']} / {s['acceptance_restored']['other_tasks']}"),
        (f"Footprint ({fq.get('method')}) vs actual: P / R / F1",
         " / ".join(str(va.get(k, "-")) for k in ("precision", "recall", "f1"))),
        ("Footprint vs oracle: P / R / F1", " / ".join(str(vo.get(k, "-")) for k in ("precision", "recall", "f1"))),
    ]
    for k, v in s.get("policy_rows", []):
        rows.append((k, v))
    m = s.get("machine")
    if m:
        rows.append(("Machine load average, 1 min (start / mean / max / end) on " f"{m['cpus']} cores",
                     f"{m['load1_start']} / {m['load1_mean']} / {m['load1_max']} / {m['load1_end']}"))
    fl = s.get("flake") or {}
    cfg = fl.get("config") or {}
    if cfg.get("rate") or cfg.get("rerun_preland") or cfg.get("rerun_validate") or cfg.get("retry_batch"):
        rr = fl.get("reruns") or {}
        by_purpose = ", ".join(f"{k} {v['absorbed']}/{v['count']}" for k, v in rr.items()) or "-"
        rows += [
            ("Flake model (rate per run / seed / pool)", f"{cfg.get('rate')} / {cfg.get('seed')} / {cfg.get('pool')}"),
            ("Mitigations (re-run pre-land / re-run validation / retry batch / quarantine flips)",
             f"{cfg.get('rerun_preland')} / {cfg.get('rerun_validate')} / {cfg.get('retry_batch')} / "
             f"{cfg.get('quarantine_flips')}"),
            ("CI runs flaked (of all runs) / by purpose",
             f"{fl.get('flaked_runs')} of {fl.get('ci_runs_total')} / {fl.get('flaked_runs_by_purpose')}"),
            ("Re-runs: absorbed / total (by purpose)",
             f"{sum(r['absorbed'] for r in rr.values())} / {sum(r['count'] for r in rr.values())} ({by_purpose})"),
            ("Needless reworks (flake-only reds) / their cost USD",
             f"{fl.get('needless_reworks')} / {fl.get('needless_rework_cost_usd')}"),
            ("Wrongful reverts / reverts", f"{fl.get('wrongful_reverts')} / {fl.get('reverts')}"),
            ("Flaked validations: tickets opened / exonerated by a later green / reverted",
             f"{fl.get('flaked_validations')}: {fl.get('flake_tickets')} / {fl.get('flake_tickets_exonerated')} / "
             f"{fl.get('flake_tickets_reverted')}"),
            ("Flaky tests found (flips)",
             ", ".join(f"{t} x{n}" for t, n in (fl.get("flaky_tests") or {}).items()) or "none")]
    lines = [f"# Race: {s['policy']} / {s['agent']}", "", f"_{s['label']}_", ""]
    if s.get("aborted"):
        lines += [f"**Aborted:** {s['aborted']}", ""]
    lines += ["| Metric | Value |", "|---|---|"] + [f"| {k} | {v} |" for k, v in rows]
    lines += ["", "## Config", "", "```json", json.dumps(s["config"], indent=2), "```", "",
              "## Tasks", "", "| Task | Status | Agent | Reworks | Conflicts | Reds | Predicted | Actual | Accepted |",
              "|---|---|---|---|---|---|---|---|---|"]
    for tid, t in s["per_task"].items():
        lines.append(f"| {tid} | {t['status']} | {t['agent'] or '-'} | {t['reworks']} | {t['conflicts']} | "
                     f"{t['reds']} | {', '.join(t['predicted']) or '-'} | {', '.join(t['actual_modules']) or '-'} | "
                     f"{t['final_acceptance']} |")
    return "\n".join(lines) + "\n"


def write_summary(race) -> dict:
    s = build(race)
    with open(os.path.join(race.out, "summary.json"), "w") as fh:
        json.dump(s, fh, indent=2, default=str)
    with open(os.path.join(race.out, "summary.md"), "w") as fh:
        fh.write(to_markdown(s))
    return s
