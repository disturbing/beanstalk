"""Edit -> UI latency of a streaming race (stream_e2e): joins the driver's ``driver.stream`` lines (edit time, post
time, sizes, diff time) with observe.mjs's ``ui.jsonl`` (when each seq appeared on the stalk and in the journey).

    python3 stream_e2e/latency.py <run out dir> <shots dir>
"""
from __future__ import annotations

import json
import os
import statistics
import sys


def main(out: str, shots: str) -> None:
    posts = {}
    with open(os.path.join(out, "work", "driver.jsonl"), encoding="utf-8") as fh:
        for line in fh:
            e = json.loads(line)
            if e.get("type") == "driver.stream" and e.get("accepted"):
                posts.setdefault((e["task"], e["seq"]), []).append(e)  # seqs restart per invocation
    shown: dict[tuple[str, str, int, float], float] = {}
    with open(os.path.join(shots, "ui.jsonl"), encoding="utf-8") as fh:
        for line in fh:
            u = json.loads(line)
            if u["seq"] is None:
                continue
            task = u["kind"].split(":", 1)[1] if u["kind"].startswith("stalk:") else os.environ.get("BEAN", "t101")
            where = "stalk" if u["kind"].startswith("stalk:") else "journey"
            at = u["at"] / 1000
            post = max((p for p in posts.get((task, u["seq"]), []) if p["posted_at"] <= at),
                       key=lambda p: p["posted_at"], default=None)
            if post is not None:  # first page that showed this post
                shown.setdefault((where, task, u["seq"], post["posted_at"]), at)
    rows = {"stalk": {"post": [], "edit": []}, "journey": {"post": [], "edit": []}}
    print(f"{'where':8} {'task':5} {'seq':>3} {'trigger':7} {'bytes':>6} {'diff ms':>7} {'post ms':>7} "
          f"{'post->ui ms':>11} {'edit->ui ms':>11}")
    for (where, task, seq, posted), at in sorted(shown.items()):
        p = next(x for x in posts[(task, seq)] if x["posted_at"] == posted)
        post_ui = (at - p["posted_at"]) * 1000
        edit_ui = None if p.get("edit_at") is None else (at - p["edit_at"]) * 1000
        rows[where]["post"].append(post_ui)
        if edit_ui is not None:
            rows[where]["edit"].append(edit_ui)
        print(f"{where:8} {task:5} {seq:>3} {p['trigger']:7} {p['bytes']:>6} {p['diff_ms']:>7} {p['post_ms']:>7} "
              f"{post_ui:>11.0f} {'' if edit_ui is None else f'{edit_ui:.0f}':>11}")
    for where, r in rows.items():
        for kind, xs in r.items():
            if xs:
                print(f"{where} {kind}->ui: n={len(xs)} median {statistics.median(xs):.0f} ms, max {max(xs):.0f} ms")
    sizes = [p["bytes"] for ps in posts.values() for p in ps]
    diffs = [p["diff_ms"] for ps in posts.values() for p in ps]
    print(f"posts: n={len(sizes)}, bytes median {statistics.median(sizes):.0f} max {max(sizes)}; "
          f"diff ms median {statistics.median(diffs):.0f} max {max(diffs)}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
