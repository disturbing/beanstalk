"""Aggregates results/<lang>/results.json into the Markdown tables used in README.md.

  python3 harness/report.py [results_dir]
"""

import json
import os
import statistics
import sys

LANGS = ["python", "ts", "java", "go", "rust"]
GRAN = {
    "python": "file (module)",
    "ts": "file (module)",
    "java": "file (class, compile closure + class loads)",
    "go": "package (compile), file (runtime reads)",
    "rust": "crate (compile), file (runtime reads)",
}


def pct(a, b):
    return f"{100 * a / b:.0f}%" if b else "-"


def main():
    d = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "results")
    rows, kinds, misses, abl, fresh, over = [], {}, [], [], [], []
    for lang in LANGS:
        p = os.path.join(d, lang, "results.json")
        if not os.path.exists(p):
            continue
        r = json.load(open(p))
        ms = r["mutations"]
        brk = [m for m in ms if m["failing"]]
        safe_b = sum(m["safe"] for m in brk)
        sel_all = [len(m["selected"]) / m["units"] for m in ms]
        sel_b = [len(m["selected"]) / m["units"] for m in brk]
        t_sel = sum(m["sel_s"] for m in ms)
        t_full = sum(m["full_s"] for m in ms)
        fail_b = [len(m["failing"]) / m["units"] for m in brk]
        unit_s = {u: v["plain_s"] for u, v in r["baseline"].items()}
        work_sel = sum(sum(unit_s.get(u, 0) for u in m["selected"]) for m in ms)
        work_all = sum(unit_s.values()) * len(ms)
        rows.append(f"| {lang} | {len(r['units'])} | {len(ms)} | {len(brk)} | **{safe_b}/{len(brk)} "
                    f"({pct(safe_b, len(brk))})** | {100 * statistics.mean(sel_all):.0f}% "
                    f"(median {100 * statistics.median(sel_all):.0f}%) | {100 * statistics.mean(sel_b):.0f}% | "
                    f"{100 * statistics.mean(fail_b):.0f}% | {t_sel:.0f}s vs {t_full:.0f}s "
                    f"(**{100 * (1 - t_sel / t_full):.0f}% saved**) | {100 * (1 - work_sel / work_all):.0f}% | {GRAN[lang]} |")
        # Overhead comes from the quiet sequential pass (results/<lang>-overhead) when present.
        po = os.path.join(d, lang + "-overhead", "results.json")
        ro = json.load(open(po)) if os.path.exists(po) else r
        b = ro["baseline"]
        plain = sum(v["plain_s"] for v in b.values())
        traced = sum(v["traced_s"] for v in b.values())
        files = statistics.mean(v["files"] for v in b.values())
        over.append(f"| {lang} | {plain:.1f}s | {traced:.1f}s | **{traced / plain:.2f}x** | {ro['full_s']:.2f}s | "
                    f"{ro['full_traced_s']:.2f}s | {ro['full_traced_s'] / ro['full_s']:.2f}x | {files:.0f} |")
        for m in ms:
            k = kinds.setdefault((lang, m["kind"]), [0, 0, 0])
            k[0] += 1
            k[1] += bool(m["failing"])
            k[2] += bool(m["failing"]) and m["safe"]
            if m["missed"]:
                misses.append(f"| {lang} | {m['kind']} | `{m['desc'][:110]}` | {', '.join(m['missed'])} |")
        if any("build" in m["ablation_selected"] for m in ms) and lang in ("java", "go", "rust"):
            for ph in ("run", "build"):
                bad = [m for m in brk if m["ablation_missed"].get(ph)]
                abl.append(f"| {lang} | {ph}-phase reads only | {len(brk) - len(bad)}/{len(brk)} | "
                           f"{100 * statistics.mean(m['ablation_selected'][ph] / m['units'] for m in ms):.0f}% | "
                           f"{'; '.join(m['desc'][:60] for m in bad[:3])}{' ...' if len(bad) > 3 else ''} |")
        if r.get("freshness"):
            st = r["freshness"]["steps"]
            e = st[3] if len(st) > 3 else {}
            fresh.append(f"| {lang} | {st[0]['new_test_selected']} | {st[1]['exit'] == 0} "
                         f"({st[1]['mapped_reads']} files) | {st[2]['new_test_selected']} / "
                         f"{st[2]['new_test_fails']} | {e.get('dep_in_map_before')} -> {e.get('dep_in_map_after')} | "
                         f"{e.get('then_break_dep_selected')} / {e.get('then_test_fails')} |")
    print("### Summary\n")
    print("| Language | Test files | Mutations | Breaking | Safety (breaking) | Selected (all) | "
          "Selected (breaking) | Actually failing | Wall time: selected vs full suite | Test work saved | Granularity |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    print("\n".join(rows))
    print("\n### Safety by mutation kind (total / breaking / safe)\n")
    print("| Language | " + " | ".join(["code", "helper", "data", "config", "test-edit", "delete", "add", "multi"])
          + " |\n" + "|---" * 9 + "|")
    for lang in LANGS:
        cells = []
        for k in ["code", "helper", "data", "config", "test-edit", "delete", "add", "multi"]:
            v = kinds.get((lang, k))
            cells.append(f"{v[0]}/{v[1]}/{v[2]}" if v else "-")
        if any(c != "-" for c in cells):
            print(f"| {lang} | " + " | ".join(cells) + " |")
    print("\n### Misses\n")
    print("| Language | Kind | Mutation | Failing but not selected |\n|---|---|---|---|")
    print("\n".join(misses) if misses else "| - | - | none | - |")
    print("\n### Ablation: map from one phase only (compiled languages)\n")
    print("| Language | Map | Safe (breaking) | Mean selected | Example misses |\n|---|---|---|---|---|")
    print("\n".join(abl))
    print("\n### Overhead\n")
    print("| Language | Units untraced (sum) | Units traced (sum) | Ratio | Full suite | Full traced | Ratio | "
          "Mean repo files read per test file |\n|---|---|---|---|---|---|---|---|")
    print("\n".join(over))
    print("\n### Freshness\n")
    print("| Language | New test selected (no map) | Ran traced, mapped | Dep change selects it / it fails | "
          "Edited test: new dep in map before -> after | Dep change selects it / it fails |\n|---|---|---|---|---|---|")
    print("\n".join(fresh))


if __name__ == "__main__":
    main()
