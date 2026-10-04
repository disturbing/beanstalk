#!/usr/bin/env python3
"""In-flight overlap: how many beans worked on the same files at the same time, from the agents' tool-call
transcripts (stream-json: Read / Edit / Write paths with timestamps), related to the race's conflicts and repairs.

  python3 overlap.py runs/dir [runs/dir ...] [--arena ARENA_DIR] [--stretch auto|on|off] [--json out.json]

Definitions (a bean = one task's change in its own worktree; time axis = wall-clock UTC):
  * *active*: an agent invocation (initial or rework) of the bean is running. With ``--drift-factor`` an invocation
    lasts its real wall time plus the emulated hold. Beans waiting in a queue or a pre-land check are not active.
  * *holds* a file: from the bean's first Read/Edit/Write of it inside an invocation to the end of that invocation (the
    session's context for the file is live until the session ends); *writes* it from its first Edit/Write.
    With ``--stretch on`` (default for drifted runs) every tool call's offset inside its invocation is scaled by
    (wall + hold) / wall: the long-task model "the same session, written F times slower". ``off`` keeps the touches
    where they happened (early in the stretched window).
  * overlap: two beans hold (write) the same source file at the same moment. Window-level: their active intervals
    overlap and their touched-file sets intersect.
  * attribution: every textual conflict, queue ejection and informed rework is paired with the landed change(s) it
    collided with, and the phase in which that change landed relative to the affected bean: before it started
    (already in its base), while its first authoring was running (a live session a mid-flight notice could reach),
    or after (it was waiting in a queue, a pre-land check or a rework: only the gate acts). Also: had both beans touched
    a common file before the affected bean's first authoring ended (observable by a scheduler) and with how many
    seconds of authoring left.
Only explicit Read / Edit / Write paths count (Grep and Glob hits are not attributed to files): a lower bound.
Source files = everything except tests and CHANGELOG.md (union-merged by the beanstalk merge driver).
"""
from __future__ import annotations

import argparse
import itertools
import json
import os
import statistics
import sys
from dataclasses import dataclass, field

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from e5lib import Run, load_run  # noqa: E402

IGNORE_FILES = ("CHANGELOG.md",)
Iv = tuple[float, float]


@dataclass
class Bean:
    task: str
    start: float
    first_end: float = 0.0                        # end of the initial invocation: "the bean was submitted"
    author_end: float = 0.0                       # end of its last authoring invocation
    land: float | None = None
    active: list[Iv] = field(default_factory=list)
    hold: dict[str, list[Iv]] = field(default_factory=dict)    # file -> intervals during which the session holds it
    write: dict[str, list[Iv]] = field(default_factory=dict)   # file -> intervals during which it is being edited
    land_files: list[str] = field(default_factory=list)

    def touched(self) -> set[str]:
        return set(self.hold)

    def first_touch(self, f: str) -> float | None:
        return min((s for s, _ in self.hold.get(f, [])), default=None)


def src(files) -> list[str]:
    return [f for f in files if f not in IGNORE_FILES and not f.endswith(".test.ts")]


def build_beans(run: Run, stretch: bool) -> dict[str, Bean]:
    beans: dict[str, Bean] = {task: Bean(task=task, start=st) for task, st in run.starts.items()}
    for i in sorted(run.invocations, key=lambda i: i.start):
        if i.task not in beans or i.kind not in ("initial", "rework"):
            continue
        b = beans[i.task]
        if i.kind == "initial" and not b.first_end:
            b.first_end = i.end
        b.author_end = max(b.author_end, i.end)
        b.active.append((i.start, i.end))
        f = i.stretch if stretch else 1.0
        seen_h: set[str] = set()
        seen_w: set[str] = set()
        for c in i.calls:
            if not c.path or c.kind not in ("read", "write"):
                continue
            t = min(i.start + (c.epoch - i.start) * f, i.end)
            if c.path not in seen_h:
                seen_h.add(c.path)
                b.hold.setdefault(c.path, []).append((t, i.end))
            if c.kind == "write" and c.path not in seen_w:
                seen_w.add(c.path)
                b.write.setdefault(c.path, []).append((t, i.end))
    for x in run.landings:
        if x.get("kind", "task") == "task" and x["task"] in beans and beans[x["task"]].land is None:
            beans[x["task"]].land = x["epoch"]
            beans[x["task"]].land_files = [p for p in x["files"] if not p.endswith(".test.ts")]
    return {k: b for k, b in beans.items() if b.author_end}


def overlap_len(a: list[Iv], b: list[Iv]) -> float:
    return sum(max(0.0, min(e1, e2) - max(s1, s2)) for s1, e1 in a for s2, e2 in b)


def sweep(intervals: list[Iv]) -> tuple[float, int, float]:
    """(seconds with >= 2 intervals open, max open, seconds with >= 1 open) for a list of (start, end)."""
    pts = []
    for s, e in intervals:
        if e > s:
            pts += [(s, 1), (e, -1)]
    pts.sort()
    open_, last, multi, peak, any_ = 0, None, 0.0, 0, 0.0
    for t, d in pts:
        if last is not None:
            if open_ >= 2:
                multi += t - last
            if open_ >= 1:
                any_ += t - last
        open_ += d
        peak = max(peak, open_)
        last = t
    return multi, peak, any_


def pair_overlap(a: Bean, b: Bean, writes: bool = False) -> tuple[float, list[str]]:
    """Seconds, and the files, during which both beans hold (or write) the same file."""
    ma, mb = (a.write, b.write) if writes else (a.hold, b.hold)
    secs, files = 0.0, []
    for f in set(ma) & set(mb):
        o = overlap_len(ma[f], mb[f])
        if o > 0:
            secs += o
            files.append(f)
    return secs, sorted(files)


def active_overlap(a: Bean, b: Bean) -> float:
    return overlap_len(a.active, b.active)


def landed_before(run: Run, beans: dict[str, Bean], x: str, when: float, files: set[str]) -> list[str]:
    """Beans that landed (after x started, up to ``when``) a change touching ``files`` (source files if any, else all)."""
    focus = set(src(files)) or set(files)
    return [y for y, b in beans.items() if y != x and b.land is not None and beans[x].start < b.land <= when
            and focus & set(b.land_files)]


def commit_files(run: Run) -> dict[str, set[str]]:
    """task -> source files its latest harness commit changed (task.commit events), for beans that never landed."""
    out: dict[str, set[str]] = {}
    for e in run.events:
        if e["type"] == "task.commit" and e.get("task"):
            out[e["task"]] = set(src(e.get("files") or []))
    return out


def attribute(run: Run, beans: dict[str, Bean]) -> list[dict]:
    """One record per (affected bean, collided-with bean) for conflicts, ejections and informed reworks."""
    recs: list[dict] = []
    cfiles = commit_files(run)
    inflight: dict[str, list[str]] = {}      # queue: speculative batches not yet resolved
    landed: set[str] = set()
    for e in run.events:
        t = e["type"]
        if t == "batch.start":
            inflight[e["batch"]] = list(e.get("tasks") or [])
        elif t in ("batch.red", "batch.cancel", "bisect.end"):
            inflight.pop(e.get("batch"), None)
        elif t == "land" and e.get("task"):
            landed.add(e["task"])
            for b, ts in list(inflight.items()):
                if all(x in landed for x in ts):
                    inflight.pop(b)
        x = e.get("task")
        if x not in beans:
            continue
        kind, others, files = None, [], set(e.get("files") or e.get("conflicts") or [])
        if t == "merge.conflict":
            kind = "conflict"
            others = landed_before(run, beans, x, e["_epoch"], files)
            if not others:  # queue: the partner is a PR ahead of it (batch-mate or an in-flight batch), not landed yet
                ahead = set(e.get("batch_mates") or []) | {y for ts in inflight.values() for y in ts}
                ahead = {y for y in ahead if y in beans and y != x}
                others = [y for y in sorted(ahead) if set(src(files)) & (cfiles.get(y, set()) | set(beans[y].land_files))]
        elif t == "rework.start" and e.get("reason") == "preland-red":
            kind = "informed-red"
            others = [c for c in e.get("culprits") or [] if c in beans]
            files = set()
        elif t == "queue.eject" and e.get("reason") == "red":
            kind = "queue-red"
            others = []
        else:
            continue
        for y in others or [None]:
            rec = {"kind": kind, "task": x, "other": y, "t": round(e["t"], 1), "files": sorted(files)[:6],
                   "n_partners": len(others) or 1}
            if y:
                bx, by = beans[x], beans[y]
                if by.land is None:
                    phase = "not_landed"
                elif by.land <= bx.start:
                    phase = "before_start"          # in X's base already: no drift involved
                elif by.land <= bx.first_end:
                    phase = "during_authoring"      # landed while X's agent was still writing: a live session to notify
                else:
                    phase = "after_authoring"       # landed while X waited (queue / pre-land check / rework): only a gate acts
                rec["partner_landing_phase"] = phase
                # the forge sees a bean's diff when its author submits it: earlier than its landing
                rec["other_submitted_during_authoring"] = bool(bx.start < by.first_end <= bx.first_end)
                shared_src = sorted(src(bx.touched() & by.touched()))
                rec["shared_files_touched"] = shared_src[:6]
                secs, _ = pair_overlap(bx, by)
                rec["touch_overlap_s"] = round(secs, 1)
                rec["active_overlap_s"] = round(active_overlap(bx, by), 1)
                rec["first_windows_overlap"] = bool(min(bx.first_end, by.first_end) > max(bx.start, by.start))
                # when both had touched a common source file, and how much of the affected bean's authoring was left
                flag = [max(bx.first_touch(f), by.first_touch(f)) for f in shared_src
                        if bx.first_touch(f) is not None and by.first_touch(f) is not None]
                rec["observable_before_first_end"] = bool(flag and min(flag) < bx.first_end)
                rec["lead_s"] = round(bx.first_end - min(flag), 1) if flag and min(flag) < bx.first_end else None
            recs.append(rec)
    return recs


def attach_rework_cost(run: Run, recs: list[dict]) -> None:
    """Each event is answered by one rework invocation of the affected task (the first one starting after it)."""
    by_task: dict[str, list] = {}
    for i in run.invocations:
        if i.kind == "rework" and i.task:
            by_task.setdefault(i.task, []).append(i)
    epoch_of: dict[tuple[str, float], float] = {}
    for e in run.events:
        if e["type"] in ("merge.conflict", "rework.start", "queue.eject") and e.get("task"):
            epoch_of.setdefault((e["task"], round(e["t"], 1)), e["_epoch"])
    for r in recs:
        ep = epoch_of.get((r["task"], r["t"]))
        cand = [i for i in by_task.get(r["task"], []) if ep is not None and i.start >= ep - 0.5]
        if cand:
            i = min(cand, key=lambda x: x.start)
            r["rework_cost_usd"] = round(i.cost, 4)
            r["rework_inrace_s"] = round(i.end - i.start, 1)


def flag_stats(beans: dict[str, Bean], recs: list[dict]) -> dict:
    """How well would "two beans hold the same source file at the same moment" have predicted which pairs of beans
    later collided (textual conflict, informed rework, or ejection involving both)? Contingency over all pairs."""
    collided: set[frozenset] = {frozenset((r["task"], r["other"])) for r in recs if r.get("other")}
    rules = {
        "hold_overlap": lambda a, b: bool(src(pair_overlap(a, b)[1])),
        "edit_overlap": lambda a, b: bool(src(pair_overlap(a, b, writes=True)[1])),
        "window_and_file": lambda a, b: active_overlap(a, b) > 0 and bool(src(a.touched() & b.touched())),
        "file_ever": lambda a, b: bool(src(a.touched() & b.touched())),
    }
    pairs = list(itertools.combinations(sorted(beans), 2))
    base_rate = sum(1 for x, y in pairs if frozenset((x, y)) in collided) / max(1, len(pairs))
    out: dict[str, dict] = {}
    for name, rule in rules.items():
        tp = fp = fn = tn = 0
        for x, y in pairs:
            flagged = rule(beans[x], beans[y])
            hit = frozenset((x, y)) in collided
            tp += flagged and hit
            fp += flagged and not hit
            fn += (not flagged) and hit
            tn += (not flagged) and not hit
        prec = tp / (tp + fp) if tp + fp else None
        rec = tp / (tp + fn) if tp + fn else None
        out[name] = {"flagged": tp + fp, "collided_and_flagged": tp, "collided_not_flagged": fn,
                     "precision": None if prec is None else round(prec, 3), "recall": None if rec is None else round(rec, 3),
                     "lift": None if prec is None or not base_rate else round(prec / base_rate, 2),
                     "clean_pairs_flagged": round(fp / max(1, fp + tn), 3)}
    out["_collided_pairs"] = len(collided)
    out["_pairs"] = len(pairs)
    return out


def summarise(run: Run, beans: dict[str, Bean], arena: str | None) -> dict:
    ids = sorted(beans)
    n = len(ids)
    pairs = list(itertools.combinations(ids, 2))
    win = share = both = touch = wtouch = 0
    secs_total = 0.0
    peers: dict[str, set[str]] = {x: set() for x in ids}
    for x, y in pairs:
        a, b = beans[x], beans[y]
        w = active_overlap(a, b) > 0
        s = bool(src(a.touched() & b.touched()))
        win += w
        share += s
        both += (w and s)
        secs, files = pair_overlap(a, b)
        if src(files):
            touch += 1
            secs_total += secs
            peers[x].add(y)
            peers[y].add(x)
        if src(pair_overlap(a, b, writes=True)[1]):
            wtouch += 1
    files_all = {f for b in beans.values() for f in b.touched()}
    multi_s = wmulti_s = 0.0
    peak_by_file: dict[str, int] = {}
    for f in sorted(src(files_all)):
        m, pk, _ = sweep([iv for b in beans.values() for iv in b.hold.get(f, [])])
        multi_s += m
        peak_by_file[f] = pk
        wm, _, _ = sweep([iv for b in beans.values() for iv in b.write.get(f, [])])
        wmulti_s += wm
    m_active, peak_active, any_active = sweep([iv for b in beans.values() for iv in b.active])
    area = sum(e - s for b in beans.values() for s, e in b.active)
    recs = attribute(run, beans)
    attach_rework_cost(run, recs)
    with_other = [r for r in recs if r.get("other")]

    def share_of(key: str, rows: list[dict]) -> str:
        return f"{sum(1 for r in rows if r.get(key))}/{len(rows)}" if rows else "0/0"

    leads = [r["lead_s"] for r in with_other if r.get("lead_s") is not None]
    by_kind: dict[str, dict] = {}
    for kd in sorted({r["kind"] for r in recs}):
        rows = [r for r in with_other if r["kind"] == kd]
        cost_by_phase: dict[str, float] = {}
        for r in rows:
            ph = r.get("partner_landing_phase", "?")
            cost_by_phase[ph] = round(cost_by_phase.get(ph, 0.0) + (r.get("rework_cost_usd") or 0.0) / r.get("n_partners", 1), 3)
        by_kind[kd] = {"events": len({(r["task"], r["t"]) for r in recs if r["kind"] == kd}),
                       "event_partner_pairs": len(rows),
                       "rework_cost_usd_by_partner_phase": cost_by_phase,
                       "partner_landing_phase": {ph: sum(1 for r in rows if r.get("partner_landing_phase") == ph)
                                                 for ph in ("before_start", "during_authoring", "after_authoring", "not_landed")},
                       "partner_submitted_during_authoring": share_of("other_submitted_during_authoring", rows),
                       "first_windows_overlap": share_of("first_windows_overlap", rows),
                       "touch_overlap": sum(1 for r in rows if r.get("touch_overlap_s", 0) > 0),
                       "observable_before_first_end": share_of("observable_before_first_end", rows)}
    sem = []
    if arena:
        for x in ids:
            p = os.path.join(arena, "tasks", f"{x}.json")
            if not os.path.exists(p):
                continue
            for c in json.load(open(p))["couplings"]:
                y = c["with"]
                if c["type"] != "semantic" or y not in beans or y < x:
                    continue
                a, b = beans[x], beans[y]
                secs, _ = pair_overlap(a, b)
                sem.append({"pair": f"{x}+{y}", "windows_overlap_s": round(active_overlap(a, b), 1),
                            "shared_files_touched": sorted(src(a.touched() & b.touched()))[:5], "touch_overlap_s": round(secs, 1),
                            "landed_order": sorted([x, y], key=lambda k: beans[k].land or 1e18)})
    return {
        "run": run.name, "beans": n, "drift_factor": run.drift_factor,
        "authoring_window_s_median": round(statistics.median(b.first_end - b.start for b in beans.values()), 1),
        "beans_authoring_at_once": {"peak": peak_active, "time_weighted_mean": round(area / any_active, 2) if any_active else None,
                                    "seconds_with_2plus": round(m_active, 1)},
        "pairs": len(pairs), "pairs_authoring_windows_overlap": win, "pairs_share_a_touched_file": share,
        "pairs_overlap_window_and_file": both, "pairs_touch_overlap_same_file_same_time": touch,
        "pairs_write_overlap_same_file_same_time": wtouch,
        "file_seconds_with_2plus_beans_holding": round(multi_s, 1), "file_seconds_with_2plus_beans_writing": round(wmulti_s, 1),
        "touch_overlap_seconds_total": round(secs_total, 1),
        "peers_per_bean_median_max": [statistics.median(len(v) for v in peers.values()) if peers else 0,
                                       max((len(v) for v in peers.values()), default=0)],
        "peak_beans_on_one_file": sorted(peak_by_file.items(), key=lambda kv: -kv[1])[:5],
        "attribution": {"events_by_kind": by_kind, "lead_s_median": round(statistics.median(leads), 1) if leads else None,
                        "records": recs},
        "semantic_pairs": sem,
        "flagging": flag_stats(beans, recs),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("runs", nargs="+")
    ap.add_argument("--arena", help="arena dir with tasks/*.json (for the designed semantic couplings)")
    ap.add_argument("--stretch", choices=["auto", "on", "off"], default="auto")
    ap.add_argument("--json")
    a = ap.parse_args()
    out = []
    for path in a.runs:
        run = load_run(path, transcripts=True)
        stretch = (run.drift_factor > 1.0) if a.stretch == "auto" else a.stretch == "on"
        beans = build_beans(run, stretch)
        s = summarise(run, beans, a.arena)
        s["stretch"] = stretch
        out.append(s)
        print(f"== {run.name}: {s['beans']} beans, drift x{run.drift_factor:g}, stretch={stretch}")
        print(f"   first authoring window median {s['authoring_window_s_median']} s; beans authoring at once: peak "
              f"{s['beans_authoring_at_once']['peak']}, mean {s['beans_authoring_at_once']['time_weighted_mean']}")
        print(f"   pairs {s['pairs']}: windows overlap {s['pairs_authoring_windows_overlap']}, share a touched file "
              f"{s['pairs_share_a_touched_file']}, both {s['pairs_overlap_window_and_file']}; same file at the same time "
              f"(read/edit) {s['pairs_touch_overlap_same_file_same_time']}, (edit/edit) {s['pairs_write_overlap_same_file_same_time']}")
        print(f"   file-seconds with 2+ beans holding {s['file_seconds_with_2plus_beans_holding']}, writing "
              f"{s['file_seconds_with_2plus_beans_writing']}; peers per bean median/max {s['peers_per_bean_median_max']}")
        for kd, v in s["attribution"]["events_by_kind"].items():
            print(f"   {kd}: {v}")
        print(f"   lead time of observable overlap (median s): {s['attribution']['lead_s_median']}")
        fl = s["flagging"]
        print(f"   pairs that collided: {fl['_collided_pairs']} of {fl['_pairs']}; flagging rules (precision / recall / lift / clean pairs flagged):")
        for name, v in fl.items():
            if not name.startswith("_"):
                print(f"     {name}: flagged {v['flagged']}, {v['precision']} / {v['recall']} / {v['lift']} / {v['clean_pairs_flagged']}")
        for sp in s["semantic_pairs"]:
            print(f"   semantic {sp}")
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(out, fh, indent=1, default=str)


if __name__ == "__main__":
    main()
