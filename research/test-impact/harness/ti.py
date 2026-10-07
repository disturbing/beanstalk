"""Test-impact experiment driver. Runs inside the language's container.

  python3 /ti/ti.py --lang python [--limit N]

Copies /src to /work/p, traces every test unit once to build the map, measures tracing overhead,
then for every generated mutation: selects tests from the map, runs the selection and the full suite
(timed), runs every unit on its own as ground truth (evaluation only), and checks the selection
contained every failing unit. Finishes with the freshness scenario. Writes /out/<lang>/.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(__file__))
import mutate  # noqa: E402
import trace  # noqa: E402
from langs import LANGS, ROOT, Lang, clean_out  # noqa: E402

PHASES = ("build", "run")


def run(cmd, lang: Lang, timeout=None) -> tuple[int, float]:
    t0 = time.perf_counter()
    try:
        p = subprocess.run(cmd, cwd=ROOT, env=lang.environ(), stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=timeout or lang.unit_timeout)
        code = p.returncode
    except subprocess.TimeoutExpired:
        code = 124
    return code, time.perf_counter() - t0


def trace_unit(lang: Lang, unit: str) -> tuple[dict, int, float]:
    t = trace.run_traced(lang.unit_cmd(unit), ROOT, lang.environ(), lang.classify,
                         f"/work/trace/{unit.replace('/', '_')}", lang.unit_timeout)
    rec = {}
    for ph, data in t.phases.items():
        rec[ph] = {k: sorted({r for p in getattr(data, k) for r in lang.normalize(p)})
                   for k in ("reads", "probes", "dirs")}
    return rec, t.exit_code, t.seconds


def ancestors(path: str):
    d = os.path.dirname(path)
    while d:
        yield d
        d = os.path.dirname(d)


def select(tmap: dict, units: list[str], changed: dict[str, str], phases=PHASES) -> set[str]:
    """changed: path -> 'M' | 'A' | 'D'."""
    sel = set()
    for u in units:
        if u in changed:  # the bean's own new or changed test file
            sel.add(u)
            continue
        rec = tmap.get(u)
        if rec is None:  # never traced: run it (and it gets mapped)
            sel.add(u)
            continue
        reads, probes, dirs = set(), set(), set()
        for ph in phases:
            r = rec.get(ph, {})
            reads.update(r.get("reads", ()))
            probes.update(r.get("probes", ()))
            dirs.update(r.get("dirs", ()))
        for f, kind in changed.items():
            parent = os.path.dirname(f)
            if kind == "M" and (f in reads or f in probes):
                hit = True
            elif kind == "D" and (f in reads or parent in dirs):
                hit = True
            elif kind == "A" and (f in probes or parent in dirs
                                  or any(a in probes or os.path.dirname(a) in dirs for a in ancestors(f))):
                # Adding f creates its missing ancestors too: select if any created entry was probed,
                # or lands in a directory the test listed (Python's import system caches listings and
                # never stats the missing package dir; v1 of this rule checked only f's parent and missed).
                hit = True
            else:
                hit = False
            if hit:
                sel.add(u)
                break
    return sel


def ground_truth(lang: Lang, units: list[str]) -> dict[str, int]:
    with ThreadPoolExecutor(lang.parallel) as ex:
        codes = list(ex.map(lambda u: run(lang.unit_cmd(u), lang)[0], units))
    return dict(zip(units, codes))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", required=True)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--skip-mutations", action="store_true")
    ap.add_argument("--tag", default="", help="suffix for the output dir, e.g. -overhead")
    args = ap.parse_args()
    lang: Lang = LANGS[args.lang]()
    out = f"/out/{lang.name}{args.tag}"
    os.makedirs(out, exist_ok=True)
    shutil.rmtree(ROOT, ignore_errors=True)
    shutil.copytree("/src", ROOT, symlinks=True)
    clean_out()
    log = open(f"{out}/log.txt", "w")

    def say(*a):
        print(*a, file=log, flush=True)
        print(f"[{lang.name}]", *a, flush=True)

    lang.prepare()
    units = lang.units()
    say(f"{len(units)} test units")

    # 1. Baseline and overhead: every unit untraced (twice, min) and traced (twice, min; map from 2nd).
    full_code, _ = run(lang.full_cmd(), lang)  # warm
    full_times = [run(lang.full_cmd(), lang)[1] for _ in range(2)]
    say(f"full suite exit={full_code} t={min(full_times):.2f}s")
    tmap, base = {}, {}
    for u in units:
        plain = []
        for _ in range(2):
            c, s = run(lang.unit_cmd(u), lang)
            plain.append(s)
        traced = []
        for _ in range(2):
            rec, tc, ts = trace_unit(lang, u)
            traced.append(ts)
        tmap[u] = rec
        base[u] = {"exit": c, "traced_exit": tc, "plain_s": min(plain), "traced_s": min(traced),
                   "files": len({f for ph in rec.values() for f in ph["reads"]})}
        say(f"  {u}: exit={c}/{tc} plain={min(plain):.2f}s traced={min(traced):.2f}s "
            f"reads={base[u]['files']}")
    t = trace.run_traced(lang.full_cmd(), ROOT, lang.environ(), lang.classify, "/work/trace/full")
    full_traced = t.seconds
    bad = [u for u in units if base[u]["exit"] != 0]
    if bad or full_code != 0:
        say(f"BASELINE NOT GREEN: {bad} full={full_code}")
    json.dump(tmap, open(f"{out}/map.json", "w"), indent=1, sort_keys=True)

    # 2. Mutations.
    muts = [] if args.skip_mutations else mutate.generate(lang)
    if args.limit:
        muts = muts[:args.limit]
    say(f"{len(muts)} mutations")
    results = []
    for i, m in enumerate(muts):
        mutate.apply(m)
        try:
            lang.after_mutation()
            changed = {e["path"]: e["op"] for e in m["edits"]}
            now_units = lang.units()
            sel = select(tmap, now_units, changed)
            ablations = {ph: sorted(select(tmap, now_units, changed, (ph,))) for ph in PHASES}
            sel_list = [u for u in now_units if u in sel]
            sel_code, sel_t = run(lang.batch_cmd(sel_list), lang) if sel_list else (0, 0.0)
            lang.retouch(m)  # the full run must also start cold for the changed files (build caches)
            full_c, full_t = run(lang.full_cmd(), lang)
            gt = ground_truth(lang, now_units)
        finally:
            mutate.revert(m)
        failing = sorted(u for u, c in gt.items() if c != 0)
        missed = sorted(set(failing) - sel)
        r = {"i": i, "kind": m["kind"], "desc": m["desc"], "files": sorted(changed),
             "selected": sel_list, "failing": failing, "missed": missed, "safe": not missed,
             "units": len(now_units), "sel_exit": sel_code, "full_exit": full_c,
             "sel_s": sel_t, "full_s": full_t,
             "ablation_missed": {ph: sorted(set(failing) - set(v)) for ph, v in ablations.items()},
             "ablation_selected": {ph: len(v) for ph, v in ablations.items()}}
        results.append(r)
        say(f"#{i} {m['kind']:9} sel={len(sel_list):2}/{len(now_units)} fail={len(failing):2} "
            f"missed={missed or '-'} t={sel_t:.1f}/{full_t:.1f}s  {m['desc'][:90]}")

    # 3. Freshness: a new test is selected, traced and mapped; then a change to its dependency selects it.
    fresh = freshness(lang, tmap, say)

    json.dump({"lang": lang.name, "units": units, "baseline": base, "full_s": min(full_times),
               "full_traced_s": full_traced, "mutations": results, "freshness": fresh},
              open(f"{out}/results.json", "w"), indent=1)
    say("done")


def freshness(lang: Lang, tmap: dict, say) -> dict | None:
    spec = lang.freshness()
    if not spec:
        return None
    tmap = json.loads(json.dumps(tmap))
    log = []
    path, content = spec["new_test"]
    full = os.path.join(ROOT, path)
    with open(full, "w") as f:
        f.write(content)
    units = lang.units()
    sel = select(tmap, units, {path: "A"})
    log.append({"step": "add new test", "changed": [path], "selected": sorted(sel),
                "new_test_selected": path in sel, "had_map": path in tmap})
    rec, code, _ = trace_unit(lang, path)  # the selected run is traced, so the map updates
    tmap[path] = rec
    reads = {r for ph in rec.values() for r in ph["reads"]}
    log.append({"step": "ran traced", "exit": code, "mapped_reads": len(reads),
                "dep_in_map": spec["new_dep"] in reads})
    dep, a, b = spec["break_dep"]
    dfull = os.path.join(ROOT, dep)
    orig = open(dfull).read()
    assert a in orig, (dep, a)
    open(dfull, "w").write(orig.replace(a, b, 1))
    sel = select(tmap, units, {dep: "M"})
    gt = ground_truth(lang, [path])
    open(dfull, "w").write(orig)
    log.append({"step": "break its dependency", "changed": [dep], "new_test_selected": path in sel,
                "new_test_fails": gt[path] != 0, "selected": sorted(sel)})
    os.remove(full)

    if "edit_test" in spec:
        tpath, edit = spec["edit_test"]
        tfull = os.path.join(ROOT, tpath)
        torig = open(tfull).read()
        edep = spec["edit_dep"]
        before = {r for ph in tmap[tpath].values() for r in ph["reads"]}
        open(tfull, "w").write(edit(torig) if callable(edit) else lang_append(torig, edit))
        sel = select(tmap, units, {tpath: "M"})
        rec, code, _ = trace_unit(lang, tpath)
        tmap[tpath] = rec
        after = {r for ph in rec.values() for r in ph["reads"]}
        dep, a, b = spec["break_edit_dep"]
        dfull = os.path.join(ROOT, dep)
        orig = open(dfull).read()
        open(dfull, "w").write(orig.replace(a, b, 1))
        sel2 = select(tmap, units, {dep: "M"})
        gt = ground_truth(lang, [tpath])
        open(dfull, "w").write(orig)
        open(tfull, "w").write(torig)
        log.append({"step": "edit existing test to use a new module", "test": tpath,
                    "test_selected_for_own_edit": tpath in sel, "exit": code,
                    "dep_in_map_before": edep in before, "dep_in_map_after": edep in after,
                    "then_break_dep_selected": tpath in sel2, "then_test_fails": gt[tpath] != 0})
    for s in log:
        say("freshness:", json.dumps(s))
    return {"steps": log}


def lang_append(text: str, snippet: str) -> str:
    if snippet.startswith("@@BEFORE_LAST_BRACE@@"):
        k = text.rstrip().rfind("}")
        return text[:k] + snippet[len("@@BEFORE_LAST_BRACE@@"):] + text[k:]
    return text + snippet


if __name__ == "__main__":
    main()
