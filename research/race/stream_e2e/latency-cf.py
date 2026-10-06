"""Streaming latency on Cloudflare: driver.stream posts joined with SSE arrivals and DOM changes.

python3 stream_e2e/latency-cf.py <run out dir> <shots dir> [wrangler-tail.jsonl]   (shots from observe-cf.mjs)
"""
import json
import os
import statistics as st
import sys


def pct(xs, p):
    xs = sorted(xs)
    if not xs:
        return None
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))]


def fmt(xs):
    if not xs:
        return "n=0"
    return f"n={len(xs)} median={st.median(xs):.0f} p90={pct(xs, 90):.0f} max={max(xs):.0f} ms"


out, shots = sys.argv[1], sys.argv[2]
posts = {}
reasons = {}
all_posts = []
for line in open(os.path.join(out, "work", "driver.jsonl")):
    e = json.loads(line)
    if e.get("type") != "driver.stream":
        continue
    all_posts.append(e)
    reasons[str(e.get("reason"))] = reasons.get(str(e.get("reason")), 0) + 1
    if e.get("accepted"):
        posts[(e["inv"], e["seq"])] = e
sse = {}
for line in open(os.path.join(shots, "sse.jsonl")):
    s = json.loads(line)
    if s.get("type") == "bean.streaming":
        sse.setdefault((s["inv"], s["seq"]), s["at"] / 1000)
ui_journey, ui_stalk = {}, {}
inv_of = {}  # (task, seq) -> list of invs, to map DOM seqs back
for (inv, seq), p in posts.items():
    inv_of.setdefault((p["task"], seq), []).append(p)
for line in open(os.path.join(shots, "ui.jsonl")):
    u = json.loads(line)
    if u["seq"] is None:
        continue
    at = u["at"] / 1000
    if u["kind"] == "journey":
        task = u["page"].split(":", 1)[1]
        target = ui_journey
    elif u["kind"].startswith("stalk:") and u["page"] == "home":
        task = u["kind"].split(":", 1)[1]
        target = ui_stalk
    else:
        continue
    cands = [p for p in inv_of.get((task, u["seq"]), []) if p["posted_at"] - p["post_ms"] / 1000 <= at]
    if not cands:
        continue
    p = max(cands, key=lambda p: p["posted_at"])
    target.setdefault((p["inv"], p["seq"]), at)

post_start = {k: p["posted_at"] - p["post_ms"] / 1000 for k, p in posts.items()}
rows = {
    "post round trip (driver -> gateway -> 200)": [p["post_ms"] for p in posts.values()],
    "diff build on the driver": [p["diff_ms"] for p in posts.values()],
    "edit -> post start (debounce + diff)": [(post_start[k] - p["edit_at"]) * 1000 for k, p in posts.items() if p.get("edit_at")],
    "post start -> SSE event at this machine": [(sse[k] - post_start[k]) * 1000 for k in posts if k in sse],
    "edit -> SSE event": [(sse[k] - p["edit_at"]) * 1000 for k, p in posts.items() if k in sse and p.get("edit_at")],
    "post start -> journey DOM (diff fetched, drawn)": [(ui_journey[k] - post_start[k]) * 1000 for k in posts if k in ui_journey],
    "edit -> journey DOM": [(ui_journey[k] - p["edit_at"]) * 1000 for k, p in posts.items() if k in ui_journey and p.get("edit_at")],
    "post start -> stalk list DOM (home)": [(ui_stalk[k] - post_start[k]) * 1000 for k in posts if k in ui_stalk],
    "edit -> stalk list DOM (home)": [(ui_stalk[k] - p["edit_at"]) * 1000 for k, p in posts.items() if k in ui_stalk and p.get("edit_at")],
}
print(f"posts: {len(all_posts)} total, {len(posts)} accepted, reasons {reasons}")
print(f"posts seen on SSE: {sum(1 for k in posts if k in sse)}/{len(posts)}")
print(f"bytes per accepted post: median {st.median([p['bytes'] for p in posts.values()]):.0f}, max {max(p['bytes'] for p in posts.values())}")
print(f"triggers: { {t: sum(1 for p in posts.values() if p.get('trigger') == t) for t in {p.get('trigger') for p in posts.values()}} }")
for name, xs in rows.items():
    print(f"{name}: {fmt(xs)}")
# SSE batching: were stream events delivered in their own chunks (no buffering)?
gaps = []
lines = [json.loads(l) for l in open(os.path.join(shots, "sse.jsonl"))]
conn = [l for l in lines if "connect" in l]
print(f"SSE connections: {len(conn)}; errors: {sum(1 for l in lines if 'error' in l)}; closes: {sum(1 for l in lines if l.get('closed'))}")
if conn:
    h = conn[0]["headers"]
    print("SSE headers:", {k: h.get(k) for k in ("content-type", "cache-control", "content-encoding", "transfer-encoding", "server-timing")})
same_chunk = 0
ev = [l for l in lines if l.get("type") or l.get("event")]
for a, b in zip(ev, ev[1:]):
    if a["at"] == b["at"]:
        same_chunk += 1
print(f"SSE events: {len(ev)}; arriving in the same millisecond as the previous one: {same_chunk}")

if len(sys.argv) > 3:
    walls, cpus, outcomes, exc = [], [], {}, 0
    stream_walls, stream_cpu = [], []
    for raw in open(sys.argv[3]).read().replace("}\n{", "}\x00{").split("\x00"):
        raw = raw.strip()
        if not raw.startswith("{"):
            continue
        try:
            t = json.loads(raw)
        except json.JSONDecodeError:
            continue
        outcomes[(t.get("entrypoint"), t.get("outcome"))] = outcomes.get((t.get("entrypoint"), t.get("outcome")), 0) + 1
        exc += len(t.get("exceptions") or [])
        url = ((t.get("event") or {}).get("request") or {}).get("url", "")
        if t.get("entrypoint") == "RunDO":
            walls.append(t.get("wallTime", 0)); cpus.append(t.get("cpuTime", 0))
        if url.endswith("/stream"):
            stream_walls.append(t.get("wallTime", 0)); stream_cpu.append(t.get("cpuTime", 0))
    print("tail outcomes:", outcomes, "exceptions:", exc)
    print("RunDO invocations cpu:", fmt(cpus), "| wall:", fmt(walls))
    print("/stream requests (worker) cpu:", fmt(stream_cpu), "| wall:", fmt(stream_walls))
