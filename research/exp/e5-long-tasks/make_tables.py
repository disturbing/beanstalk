#!/usr/bin/env python3
"""Regenerate every table of the E5 write-up from the run directories (skips runs that do not exist yet).

  python3 make_tables.py [--out data/results.md]

Conditions (queue run, v2 run):
  short (40 single tasks), seed 7 and 11   research/race/runs/opus-queue-sonnet-12-landed, opus-v2fair-sonnet-12-s7, ...
  long (16 compound tasks), seed 7         race/runs/e5-long-queue, e5-long-v2
  short + drift x7 (40 single tasks)       race/runs/e5-short-d7-queue, e5-short-d7-v2
  long + drift x4 (16 compound tasks)      race/runs/e5-long-d4-queue, e5-long-d4-v2   (if run)
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from e5lib import green_times, load_run  # noqa: E402
from overlap import build_beans, summarise  # noqa: E402
from runstats import analyse, markdown  # noqa: E402

BASE = os.path.normpath(os.path.join(HERE, "..", "..", "race", "runs"))
MINE = os.path.join(HERE, "race", "runs")

CONDS = [
    ("S: 40 singles, seed 7", "arena", os.path.join(BASE, "opus-queue-sonnet-12-landed"), os.path.join(BASE, "opus-v2fair-sonnet-12-s7")),
    ("S: 40 singles, seed 11", "arena", os.path.join(BASE, "opus-queue-sonnet-12-s11"), os.path.join(BASE, "opus-v2fair-sonnet-12-s11")),
    ("A: 16 compounds", "arena-long", os.path.join(MINE, "e5-long-queue"), os.path.join(MINE, "e5-long-v2")),
    ("A2: 16 compounds, repeat", "arena-long", os.path.join(MINE, "e5-long-r2-queue"), os.path.join(MINE, "e5-long-r2-v2")),
    ("B: 40 singles, drift x7", "arena", os.path.join(MINE, "e5-short-d7-queue"), os.path.join(MINE, "e5-short-d7-v2")),
    ("C: 16 compounds, drift x4", "arena-long", os.path.join(MINE, "e5-long-d4-queue"), os.path.join(MINE, "e5-long-d4-v2")),
]
# the 2 x 2: bean size (native singles | compound) x bean length (as measured | emulated ~2 min)
CELLS = [("native singles, ~0.3 min beans (S)", ["S: 40 singles, seed 7", "S: 40 singles, seed 11"]),
         ("compounds, ~0.5 min beans (A)", ["A: 16 compounds", "A2: 16 compounds, repeat"]),
         ("native singles, ~2 min beans (B)", ["B: 40 singles, drift x7"]),
         ("compounds, ~2 min beans (C)", ["C: 16 compounds, drift x4"])]
# runs without a matched partner: shown in the results table, the mechanism tables and the overlap tables, but not in the leads
EXTRA = [("B-R: 40 singles, drift x7 / v2r (agent released while checked)", "arena", os.path.join(MINE, "e5-short-d7-v2r"))]
FRACS = [0.5, 0.75, 0.875]


def _load(s: str) -> str:
    s = s.split(" (")[0]
    return "not logged" if s in ("[]", "not logged", "") else s


def ok(path: str) -> bool:
    return os.path.exists(os.path.join(path, "summary.json"))


def ratio(a, b):
    return "n/r" if a is None or b is None or not b else f"{a / b:.2f}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(HERE, "data", "results.md"))
    ap.add_argument("--inject", help="markdown doc with <!-- BEGIN:results --> ... <!-- END:results --> markers to fill")
    a = ap.parse_args()
    out: list[str] = []
    rows: list[dict] = []
    present = []
    for label, arena, q, v in CONDS:
        for pol, path in (("queue", q), ("v2", v)):
            if ok(path):
                rows.append(analyse(f"{label} / {pol}", path, FRACS))
        if ok(q) and ok(v):
            present.append((label, arena, q, v))
    extras = [(lb, ar, p) for lb, ar, p in EXTRA if ok(p)]
    for lb, ar, p in extras:
        rows.append(analyse(lb, p, FRACS))
    out += ["### Results table", "", markdown(rows, FRACS) if rows else "(no runs)", ""]
    out += ["### Outcome and test compute", "",
            "| run | green / dropped | dropped because | reworks by cause | cost per green $ | test minutes (agent-side checks + CI) | agent minutes busy / blocked / idle |",
            "|---|---|---|---|---|---|---|"]
    for r in rows:
        dr = "; ".join(f"{k}: {v}" for k, v in (r.get("drops_by_reason") or {}).items()) or "-"
        rb = ", ".join(f"{k} {v}" for k, v in sorted((r.get("reworks_by_reason") or {}).items())) or "-"
        out.append(f"| {r['label']} | {r['greens']} / {r.get('dropped')} | {dr} | {rb} | {r['cost_usd'] / max(1, r['greens']):.2f} | "
                   f"{r.get('test_minutes_total')} | {' / '.join(str(x) for x in r['agent_minutes_busy_blocked_idle'])} |")
    out.append("")

    # kth_green.py, unchanged, at k that suit each task count (the comparable race metric: time and money to the k-th green)
    import subprocess
    kg = ["### `race/kth_green.py` output (time in minutes since the race started / cumulative agent cost)", ""]
    for label, arena, q, v in present:
        n = 16 if arena == "arena-long" else 40
        ks = ["8", "12", "14", "16"] if n == 16 else ["20", "30", "35"]
        res = subprocess.run([sys.executable, os.path.join(HERE, "race", "kth_green.py"), q, v, "--k", *ks], capture_output=True, text=True)
        kg += [f"**{label}** (k = {', '.join(ks)} of {n}):", "", res.stdout.strip() or res.stderr.strip(), ""]
    out += kg

    # the 2 x 2
    def lead(cond: str) -> dict | None:
        for label, arena, q, v in present:
            if label == cond:
                rq, rv = analyse("q", q, FRACS), analyse("v", v, FRACS)
                g = lambda a, b: None if a is None or b is None or not b else a / b
                return {"done": g(rq["done_min"], rv["done_min"]), "k75": g(rq[f"k{FRACS[1]}"]["min"], rv[f"k{FRACS[1]}"]["min"]),
                        "k50": g(rq[f"k{FRACS[0]}"]["min"], rv[f"k{FRACS[0]}"]["min"]),
                        "cost": g(rv["cost_usd"], rq["cost_usd"]), "greens": (rq["greens"], rv["greens"], rq["n_tasks"]),
                        "q_done": rq["done_min"], "v_done": rv["done_min"]}
        return None

    f = lambda x: "n/r" if x is None else f"{x:.2f}"
    out += ["### The 2 x 2: v2's lead over the queue by bean size and bean length", "",
            "Queue / v2 time ratios (above 1: v2 faster); cost is v2 / queue (above 1: v2 dearer). Several samples are listed in the order of the conditions.", "",
            "| cell | samples | done: queue / v2 | 50% green | 75% green | cost: v2 / queue | greens: queue vs v2 |", "|---|---|---|---|---|---|---|"]
    for name, conds in CELLS:
        ls = [(c, lead(c)) for c in conds]
        ls = [(c, x) for c, x in ls if x]
        if not ls:
            continue
        out.append(f"| {name} | {len(ls)} | " + " | ".join(" / ".join(f(x[k]) for _, x in ls) for k in ("done", "k50", "k75", "cost")) +
                   " | " + "; ".join(f"{x['greens'][0]} vs {x['greens'][1]}" for _, x in ls) + f" (of {ls[0][1]['greens'][2]}) |")
    out.append("")

    # v2 lead per condition
    out += ["### v2's lead (queue / v2; above 1 = v2 is faster or cheaper)", "",
            "| condition | " + " | ".join(f"{int(f * 100)}% green" for f in FRACS) + " | done | total $ |", "|---|" + "---|" * (len(FRACS) + 2)]
    for label, arena, q, v in present:
        rq, rv = analyse("q", q, FRACS), analyse("v", v, FRACS)
        cells = [label]
        for f in FRACS:
            mq, mv = rq[f'k{f}']['min'], rv[f'k{f}']['min']
            cells.append(f"{ratio(mq, mv)} ({'n/r' if mq is None else mq} / {'n/r' if mv is None else mv} min)")
        cells.append(f"{ratio(rq['done_min'], rv['done_min'])} ({rq['done_min']} / {rv['done_min']} min)")
        cells.append(f"{ratio(rq['cost_usd'], rv['cost_usd'])} (${rq['cost_usd']} / ${rv['cost_usd']})")
        out.append("| " + " | ".join(cells) + " |")
    out.append("")

    # mechanism rows
    out += ["### What a bean lives through", "",
            "| run | initial bean s (real med / in race med / in race p90) | rework in race s (med) | landings absorbed during first authoring (med / p90) | landings from start to own landing (med / p90) | submit to land s (med / p90) | submit to green s (med / p90) | queue max depth | agent min busy / blocked / idle | suite s (med / p90) | load avg 1 min at start / end |",
            "|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        la = lambda k: " / ".join("-" if x is None else f"{x:g}" for x in (r.get(k) or [None, None]))
        out.append(f"| {r['label']} | {r['initial_wall_s_med']} / {r['initial_inrace_s_med']} / {r['initial_inrace_s_p90']} | {r['rework_inrace_s_med']} | "
                   f"{la('landings_during_first_authoring_med_p90')} | {la('landings_start_to_land_med_p90')} | {la('submit_to_land_s_med_p90')} | "
                   f"{la('submit_to_green_s_med_p90')} | {r.get('queue_max_depth') or '-'} | "
                   f"{' / '.join(str(x) for x in r['agent_minutes_busy_blocked_idle'])} | {la('suite_seconds_med_p90')} | "
                   f"{_load(r['load_start'])} / {_load(r['load_end'])} |")
    out.append("")

    # v2 mechanism: rechecks
    v2rows = [r for r in rows if r.get("variant") in ("v2", "v2r")]
    if v2rows:
        out += ["### v2 internals", "", "| run | pre-land checks (red) | rechecks (green / red outcome) | optimistic landings of landings | locked fallbacks | checks per landing | pre-land check minutes | revert-first |",
                "|---|---|---|---|---|---|---|---|"]
        for r in v2rows:
            gr = r.get("recheck_outcome_green_red") or [0, 0]
            out.append(f"| {r['label']} | {r.get('preland_checks')} ({r.get('preland_red')}) | {r.get('rechecks')} ({gr[0]} / {gr[1]}) | "
                       f"{r.get('optimistic_landings')} of {r.get('landings')} | {r.get('locked_fallbacks')} | {r.get('checks_per_landing')} | "
                       f"{r.get('preland_minutes')} | {r.get('revert_first')} |")
        out.append("")
    qrows = [r for r in rows if r.get("variant") == "queue"]
    if qrows:
        out += ["### Queue internals", "", "| run | batches green / red / cancelled | ejections conflict / red | bisect CI runs | PRs held behind in-flight conflicts | reworks | CI minutes |", "|---|---|---|---|---|---|---|"]
        for r in qrows:
            out.append(f"| {r['label']} | {r.get('batches')} | {r.get('ejections_conflict')} / {r.get('ejections_red')} | {r.get('bisect_runs')} | {r.get('held_behind')} | {r.get('rework')} | {r.get('ci_minutes')} |")
        out.append("")

    # machine load (the machine is shared; the coordinator asked for uptime next to the timings)
    out += ["### Machine load", "",
            "`uptime` printed at the start and end of each race (also logged in `events.jsonl`), and the 1-minute load average sampled every 30 s during it (18 cores). The short baselines (S) were run before load logging existed.", "",
            "| run | uptime at start | uptime at end | 1-min load during the race: mean / max (samples) |", "|---|---|---|---|"]
    for r in rows:
        path = next((p for lb, ar, p in extras if lb == r["label"]), None)
        if path is None:
            for label, arena, q, v in CONDS:
                for pol, pth in (("queue", q), ("v2", v)):
                    if f"{label} / {pol}" == r["label"]:
                        path = pth
        if not path:
            continue
        evs = [json.loads(l) for l in open(os.path.join(path, "events.jsonl")) if l.strip()]
        st = next((e for e in evs if e["type"] == "race.start"), {})
        en = next((e for e in evs if e["type"] == "race.end"), {})
        smp = [e["loadavg"][0] for e in evs if e["type"] == "load.sample" and e.get("loadavg")]
        up = lambda e: (e.get("uptime") or "not logged").replace("  ", " ").split(", 12 users, ")[-1].replace("load averages: ", "load ")
        out.append(f"| {r['label']} | {up(st)} | {up(en)} | " + (f"{statistics.fmean(smp):.1f} / {max(smp):.1f} ({len(smp)})" if smp else "not logged") + " |")
    out.append("")

    # how the work flows in: bases, staleness, start times
    def flow_row(label: str, path: str) -> str | None:
        r = load_run(path, transcripts=False)
        lands = sorted(x["epoch"] for x in r.landings if x.get("kind", "task") == "task")
        pre = sorted(sum(1 for l in lands if l <= st) for st in r.starts.values())
        n = len(pre)
        if not n:
            return None
        ownland = {x["task"]: x["epoch"] for x in r.landings if x.get("kind", "task") == "task"}
        gap = sorted(sum(1 for x in r.landings if x["task"] != t and st < x["epoch"] < ownland[t])
                     for t, st in r.starts.items() if t in ownland)
        starts = sorted((st - r.t0) / 60 for st in r.starts.values())
        g = [t / 60 for t, _ in green_times(r.events)]
        k20 = min(20, n)
        am = r.summary.get("agent_minutes") or {}
        pc = lambda xs, q: xs[int(q * (len(xs) - 1))] if xs else "-"
        return (f"| {label} | {n} | {sum(1 for x in pre if x == 0)} ({100 * sum(1 for x in pre if x == 0) // n}%) | "
                f"{statistics.median(pre):g} / {pc(pre, 0.9)} | {statistics.median(gap) if gap else '-'} / {pc(gap, 0.9)} | "
                f"{starts[k20 - 1]:.1f} / {starts[-1]:.1f} | {(f'{g[k20 - 1]:.1f}' if len(g) >= k20 else 'n/r')} | "
                f"{am.get('busy')} / {am.get('blocked')} / {am.get('idle')} |")

    out += ["### How the work flows in", "",
            "Bases: how many landed changes were already on a bean's base when it started (0 = the pristine base; a flood of beans written before anything lands). Staleness: landings between a bean's base and its own landing. Starts: minutes at which the 20th (or last, for 16 beans) and the final task started; greens: minute of the 20th (or all) green; agents: agent minutes busy / blocked (bound to a task that is waiting) / idle.", "",
            "| run | beans | started on the pristine base | landings on the base at start (median / p90) | landings from base to own landing (median / p90) | task starts: 20th / last (min) | green: 20th (min) | agent min busy / blocked / idle |",
            "|---|---|---|---|---|---|---|---|"]
    for label, arena, q, v in CONDS:
        for pol, path in (("queue", q), ("v2", v)):
            row = flow_row(f"{label} / {pol}", path) if ok(path) else None
            if row:
                out.append(row)
    for lb, ar, p in extras:
        row = flow_row(lb, p)
        if row:
            out.append(row)
    out.append("")

    # overlap
    ov_rows = []
    runs_for_overlap = [(label, arena, pol, path) for label, arena, q, v in CONDS for pol, path in (("queue", q), ("v2", v)) if ok(path)]
    runs_for_overlap += [(lb, ar, "", p) for lb, ar, p in extras]
    for label, arena, pol, path in runs_for_overlap:
        if True:
            run = load_run(path, transcripts=True)
            stretch = run.drift_factor > 1.0
            beans = build_beans(run, stretch)
            if not beans:
                continue
            s = summarise(run, beans, os.path.join(HERE, arena))
            name = f"{label} / {pol}" if pol else label
            ov_rows.append((name + (" [modelled: touches stretched with the session]" if stretch else ""), s))
            if stretch:  # the same run with every touch left where it happened (early in the held window)
                s2 = summarise(run, build_beans(run, False), os.path.join(HERE, arena))
                ov_rows.append((f"{name} [touches as they happened]", s2))
    if ov_rows:
        out += ["### In-flight overlap (from the stream-json transcripts: Read / Edit / Write paths with timestamps)", "",
                "| run | beans | authoring window s (median) | beans authoring at once (peak / mean) | pairs whose authoring windows overlap | pairs that touched a common source file | both | same file held at the same moment | same file edited at the same moment | peers per bean (median / max) | designed semantic pairs overlapping in flight |",
                "|---|---|---|---|---|---|---|---|---|---|---|"]
        for label, s in ov_rows:
            sem = s["semantic_pairs"]
            sem_ov = sum(1 for x in sem if x["windows_overlap_s"] > 0)
            out.append(f"| {label} | {s['beans']} | {s['authoring_window_s_median']} | {s['beans_authoring_at_once']['peak']} / {s['beans_authoring_at_once']['time_weighted_mean']} | "
                       f"{s['pairs_authoring_windows_overlap']} of {s['pairs']} | {s['pairs_share_a_touched_file']} | {s['pairs_overlap_window_and_file']} | "
                       f"{s['pairs_touch_overlap_same_file_same_time']} | {s['pairs_write_overlap_same_file_same_time']} | "
                       f"{s['peers_per_bean_median_max'][0]} / {s['peers_per_bean_median_max'][1]} | {sem_ov} of {len(sem)} |")
        out += ["", "### Who collided with whom, and when the other bean landed", "",
                "Each textual conflict, queue ejection and informed rework is paired with the landed change(s) it collided with. Phase = when that change landed relative to the affected bean: **before start** (already in its base: no drift), **during authoring** (a live session existed: a mid-flight notice could have reached it), **after authoring** (the bean was waiting in a queue, a pre-land check or a rework: only the gate acts). Counts are event-partner pairs; cost is the rework invocation each event triggered, split across its partners.", "",
                "| run | kind | events | pairs | before start | during authoring | after authoring | partner submitted during authoring | rework $ (during / after) | pairs observable before the bean's first end | median lead s |",
                "|---|---|---|---|---|---|---|---|---|---|---|"]
        for label, s in ov_rows:
            for kd, v in s["attribution"]["events_by_kind"].items():
                if not v["event_partner_pairs"]:
                    continue
                ph = v["partner_landing_phase"]
                cp = v["rework_cost_usd_by_partner_phase"]
                out.append(f"| {label} | {kd} | {v['events']} | {v['event_partner_pairs']} | {ph['before_start']} | {ph['during_authoring']} | {ph['after_authoring']} | "
                           f"{v['partner_submitted_during_authoring']} | {cp.get('during_authoring', 0)} / {cp.get('after_authoring', 0)} | {v['observable_before_first_end']} | {s['attribution']['lead_s_median']} |")
        out += ["", "### Notice opportunity: how many collisions involved a partner that landed while the affected bean was still being written", "",
                "Pooled over textual conflicts, queue ejections and informed reworks (event-partner pairs). Rework $ is what the rework invocations that answered those collisions cost; the share is of the run's total spend. The drifted runs use the modelled lead (touches stretched with the session); landing and submit times are measured.", "",
                "| run | collision pairs | partner landed before the bean started | partner landed during its first authoring | partner submitted (diff visible) during its first authoring | rework $ answering those collisions: during / after / before start | share of spend answering a collision whose partner landed during authoring |",
                "|---|---|---|---|---|---|---|"]
        for label, s in ov_rows:
            if "touches as they happened" in label:
                continue
            tot = bf = du = sub = 0
            subtot = 0
            cd = ca = cb = 0.0
            for kd, v in s["attribution"]["events_by_kind"].items():
                ph = v["partner_landing_phase"]
                tot += v["event_partner_pairs"]
                bf += ph["before_start"]
                du += ph["during_authoring"]
                a_, b_ = v["partner_submitted_during_authoring"].split("/")
                sub += int(a_)
                subtot += int(b_)
                cp = v["rework_cost_usd_by_partner_phase"]
                cd += cp.get("during_authoring", 0.0)
                ca += cp.get("after_authoring", 0.0) + cp.get("not_landed", 0.0)
                cb += cp.get("before_start", 0.0)
            if not tot:
                continue
            spend = next((r["cost_usd"] for r in rows if r["label"] == label.split(" [")[0]), None)
            share = f"{100 * cd / spend:.0f}%" if spend else "-"
            out.append(f"| {label.split(' [')[0]} | {tot} | {bf} | {du} ({100 * du / tot:.0f}%) | {sub} ({100 * sub / tot:.0f}%) | {cd:.2f} / {ca:.2f} / {cb:.2f} | {share} |")
        out += ["", "### Would watching reads and edits have predicted the collisions? (observe-then-place)", "",
                "Pair rule over all pairs of beans; a pair \"collided\" if a textual conflict, an ejection or an informed rework involved both.", "",
                "| run | collided pairs of all | rule | pairs flagged | precision | recall | lift | clean pairs flagged |", "|---|---|---|---|---|---|---|---|"]
        for label, s in ov_rows:
            fl = s["flagging"]
            for name in ("hold_overlap", "edit_overlap", "window_and_file"):
                v = fl[name]
                out.append(f"| {label} | {fl['_collided_pairs']} of {fl['_pairs']} | {name} | {v['flagged']} | {v['precision']} | {v['recall']} | {v['lift']} | {v['clean_pairs_flagged']} |")
        out += ["", "### Designed semantic couplings: were the two beans in flight together?", "",
                "| run | pair | both being written at once (s) | holding the same file at once (s) | common source files touched at any time | landed order |", "|---|---|---|---|---|---|"]
        for label, s in ov_rows:
            for x in s["semantic_pairs"]:
                out.append(f"| {label} | {x['pair']} | {x['windows_overlap_s']} | {x['touch_overlap_s']} | {', '.join(x['shared_files_touched']) or '-'} | {' then '.join(x['landed_order'])} |")
        out.append("")
        with open(os.path.join(HERE, "data", "overlap-all.json"), "w", encoding="utf-8") as fh:
            json.dump([{"label": lb, **{k: v for k, v in s.items() if k != "attribution"}, "attribution": {k: v for k, v in s["attribution"].items() if k != "records"}} for lb, s in ov_rows], fh, indent=1, default=str)
        with open(os.path.join(HERE, "data", "attribution-records.json"), "w", encoding="utf-8") as fh:
            json.dump({lb: s["attribution"]["records"] for lb, s in ov_rows}, fh, indent=0, default=str)
    text = "\n".join(out) + "\n"
    with open(a.out, "w", encoding="utf-8") as fh:
        fh.write(text)
    # split into named blocks (the text under each "### " heading, heading excluded) for the write-up
    names = {"### Results table": "results", "### Outcome and test compute": "outcome", "### `race/kth_green.py` output": "kth",
             "### The 2 x 2": "twobytwo", "### v2's lead": "lead", "### What a bean lives through": "bean",
             "### v2 internals": "v2int", "### Queue internals": "qint", "### In-flight overlap": "overlap",
             "### How the work flows in": "flow", "### Machine load": "load", "### Who collided": "collide", "### Notice opportunity": "notice", "### Would watching": "flag",
             "### Designed semantic couplings": "semantic"}
    blocks: dict[str, str] = {}
    cur = None
    for line in text.splitlines():
        if line.startswith("### "):
            cur = next((v for k, v in names.items() if line.startswith(k)), None)
            if cur:
                blocks[cur] = []
            continue
        if cur:
            blocks[cur].append(line)
    os.makedirs(os.path.join(HERE, "data", "tables"), exist_ok=True)
    for k, lines in blocks.items():
        with open(os.path.join(HERE, "data", "tables", f"{k}.md"), "w", encoding="utf-8") as fh:
            fh.write("\n".join(lines).strip() + "\n")
    if a.inject:
        doc = open(a.inject, encoding="utf-8").read()
        n = 0
        for k, lines in blocks.items():
            b, e = f"<!-- BEGIN:{k} -->", f"<!-- END:{k} -->"
            while b in doc and e in doc:
                i = doc.index(b)
                j = doc.index(e, i)
                doc = doc[: i + len(b)] + "\n" + "\n".join(lines).strip() + "\n" + doc[j:]
                n += 1
                break
        open(a.inject, "w", encoding="utf-8").write(doc)
        print(f"injected {n} table blocks into {a.inject}")
    print(text)


if __name__ == "__main__":
    main()
