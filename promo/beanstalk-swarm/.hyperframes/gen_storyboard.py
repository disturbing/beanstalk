#!/usr/bin/env python3
"""Generate storyboard.html (static wireframe sheet) for beanstalk-swarm."""
import math

OUT = "/Users/coop/Workspace/beanstalk/promo/beanstalk-swarm/storyboard.html"

PAPER, DEEP, SUN, SUNS, HAZE, INK, EMBER, LEAF, LEAFS = (
    "#E9E5DB", "#DCD6C4", "#F1EE2E", "#F8F39B", "#F0DA7C", "#1B2566", "#E26B4A", "#2E8B57", "#BFE3B4")

GROUND = 940
AGENT_X = [300 + i * 120 for i in range(12)]


def blooms(sun=(1400, 260, 620), ember=(160, 980, 520), sun_op=0.85):
    sx, sy, sr = sun
    ex, ey, er = ember
    return f"""
  <circle cx="{sx}" cy="{sy}" r="{sr}" fill="url(#sun)" opacity="{sun_op}"/>
  <circle cx="{ex}" cy="{ey}" r="{er}" fill="url(#ember)"/>"""


DEFS = f"""<defs>
  <radialGradient id="sun"><stop offset="0" stop-color="{SUN}" stop-opacity=".9"/><stop offset=".35" stop-color="{SUNS}" stop-opacity=".7"/><stop offset=".7" stop-color="{HAZE}" stop-opacity=".2"/><stop offset="1" stop-color="{PAPER}" stop-opacity="0"/></radialGradient>
  <radialGradient id="ember"><stop offset="0" stop-color="{EMBER}" stop-opacity=".2"/><stop offset="1" stop-color="{EMBER}" stop-opacity="0"/></radialGradient>
</defs>"""


def agents(op=1.0, highlight=None):
    out = [f'<g opacity="{op}">',
           f'<line x1="120" y1="{GROUND}" x2="1800" y2="{GROUND}" stroke="{INK}" stroke-width="1.5"/>']
    for i, x in enumerate(AGENT_X):
        col = EMBER if highlight == i else INK
        out.append(f'<circle cx="{x}" cy="{GROUND - 26}" r="18" fill="{PAPER}" stroke="{col}" stroke-width="3"/>'
                   f'<circle cx="{x}" cy="{GROUND - 26}" r="5" fill="{col}"/>'
                   f'<text x="{x}" y="{GROUND + 40}" class="mono" text-anchor="middle" font-size="22" fill="{INK}">a{i + 1:02d}</text>')
    out.append("</g>")
    return "".join(out)


def branches(broken=None):
    """12 sagging branches off one trunk; returns svg and tip list."""
    out = [f'<path d="M960 {GROUND} C 955 800, 968 600, 960 400" stroke="{INK}" stroke-width="9" fill="none" stroke-linecap="round"/>']
    tips = []
    for i in range(12):
        side = -1 if i % 2 == 0 else 1
        y0 = 430 + (i // 2) * 62
        L = 360 + ((i * 7) % 5) * 70
        sag = min(30 + L * 0.2, 880 - y0)
        x1 = 960 + side * L
        y1 = y0 + sag
        c1 = (960 + side * L * 0.4, y0 - 30)
        c2 = (960 + side * L * 0.8, y0 + sag * 0.3)
        w = 4.5 - (i // 2) * 0.3
        if broken == i:
            # stub + fallen piece
            out.append(f'<path d="M960 {y0} Q {960 + side * 110} {y0 - 30} {960 + side * 190} {y0 - 10}" stroke="{INK}" stroke-width="{w}" fill="none" stroke-linecap="round"/>')
            fx = 960 + side * 205
            out.append(f'<path d="M{fx} {y0 + 40} Q {fx + side * L * 0.4} {y0 + 50} {x1 + side * 10} {y1 + 120}" stroke="{INK}" stroke-width="{w}" fill="none" stroke-linecap="round" opacity=".85"/>')
            out.append(f'<circle cx="{x1 + side * 10}" cy="{y1 + 120}" r="11" fill="{PAPER}" stroke="{INK}" stroke-width="3"/>')
            tips.append((960 + side * 195, y0 - 5))
            continue
        out.append(f'<path d="M960 {y0} C {c1[0]:.0f} {c1[1]:.0f}, {c2[0]:.0f} {c2[1]:.0f}, {x1:.0f} {y1:.0f}" stroke="{INK}" stroke-width="{w:.1f}" fill="none" stroke-linecap="round"/>')
        out.append(f'<circle cx="{x1:.0f}" cy="{y1:.0f}" r="11" fill="{PAPER}" stroke="{INK}" stroke-width="3"/>')
        tips.append((x1, y1))
    return "".join(out), tips


def bean(cx, cy, rot=0, state="locked", label=None, scale=1.0):
    fill, stroke = {"locked": (LEAFS, LEAF), "climb": (PAPER, INK), "broken": (PAPER, EMBER)}[state]
    rx, ry = 34 * scale, 20 * scale
    lab = ""
    if label:
        lab = f'<text x="{cx}" y="{cy - 32 * scale}" class="mono" text-anchor="middle" font-size="{18 * scale:.0f}" fill="{INK}">{label}</text>'
    return (f'<g transform="rotate({rot} {cx} {cy})"><ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{fill}" stroke="{stroke}" stroke-width="3.5"/>'
            f'<path d="M{cx - rx * 0.45} {cy - 2} q {rx * 0.45} {ry * 0.6} {rx * 0.9} 0" stroke="{stroke}" stroke-width="2.5" fill="none"/></g>{lab}')


def stalk(x=960, y_top=80, y_bot=GROUND, amp=26, width=8, leaves=True):
    pts = []
    n = 30
    for k in range(n + 1):
        t = k / n
        y = y_bot - (y_bot - y_top) * t
        pts.append((x + amp * math.sin(t * math.pi * 3), y))
    d = "M" + " L".join(f"{px:.1f} {py:.1f}" for px, py in pts)
    out = [f'<path d="{d}" stroke="{LEAF}" stroke-width="{width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>']
    if leaves:
        for k in range(3, n, 5):
            px, py = pts[k]
            s = -1 if (k // 5) % 2 else 1
            out.append(f'<path d="M{px:.0f} {py:.0f} q {s * 40} -36 {s * 80} -10 q {s * -40} 22 {s * -80} 10" fill="{LEAFS}" stroke="{LEAF}" stroke-width="2.5"/>')
    return "".join(out), pts


def svg(body):
    return f'<svg class="art" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" aria-hidden="true">{DEFS}{body}</svg>'


# ---------- frames ----------
frames = []

# 01 tree
tree, tips = branches()
f1 = svg(blooms(sun=(1500, 220, 560), sun_op=.55) + tree + agents())
f1 += """<div class="t cap"><span class="ml">Fig. 1</span><span class="it">The git tree.</span></div>
<div class="t sub">Every agent grows its own branch.</div>
<div class="t tag" style="right:4cqw;top:6cqw">12 agents · 12 branches</div>
<div class="pn">01 / 06</div>"""
frames.append(dict(id="01", name="THE GIT TREE", time="0–5 s", act="Act I · the tree", body=f1,
                   note="<b>First move:</b> the trunk draws up at 0.1 s, then twelve branches push out in a stagger and keep lengthening; from 2 s each one bows on its joint and sags. Soft wood creaks under the sag. Copy is proposed.",
                   seam="cut → 02 (same tree)"))

# 02 snap
tree2, _ = branches(broken=10)
crack = (f'<path d="M1155 812 l -18 22 l 14 10 l -22 30 l 16 8 l -30 40" stroke="{EMBER}" stroke-width="6" fill="none"/>'
         f'<path d="M960 820 l 12 -30 l -10 -18 l 14 -34 l -12 -22 l 10 -40 l -8 -30" stroke="{EMBER}" stroke-width="6" fill="none"/>'
         f'<path d="M960 668 l -60 -8 l -40 18 l -70 -6" stroke="{EMBER}" stroke-width="3" fill="none"/>'
         f'<path d="M960 720 l 70 -14 l 40 12 l 80 -10" stroke="{EMBER}" stroke-width="3" fill="none"/>')
f2 = svg(blooms(sun=(1560, 200, 480), sun_op=.35, ember=(1250, 850, 480)) + f'<g transform="translate(220 0)">{tree2}{crack}</g>' + agents())
f2 += """<div class="t head" style="left:4cqw;top:7cqw">More agents,<br>more branches,<br><i>more breakage.</i></div>
<div class="t tag" style="left:4cqw;bottom:13cqw;color:var(--ember)">✕ conflict</div>
<div class="pn">02 / 06</div>"""
frames.append(dict(id="02", name="THE SNAP", time="5–9 s", act="Act I · the tree", body=f2,
                   note="<b>First move:</b> at 0.3 s the longest branch snaps and drops (dry crack SFX, music drops out); an ember splinter races through the trunk into two neighbours. The three phrases land on beats at 1.2 / 1.9 / 2.6 s. Tree slides right to give the line room.",
                   seam="crossfade → 03 (agents hold)"))

# 03 stalk
st, pts = stalk(x=960, y_top=110, amp=22, leaves=False)
beans3 = ""
spots = [(26, 1, "a03"), (22, -1, "a08"), (18, 1, "a11"), (14, -1, "a01"), (10, 1, "a06")]
for k, s, lab in spots:
    px, py = pts[k]
    beans3 += bean(px + s * 52, py, rot=s * 20, state="locked")
# checking bean
px, py = pts[7]
beans3 += (f'<circle cx="{px - 52:.0f}" cy="{py:.0f}" r="58" fill="none" stroke="{LEAF}" stroke-width="2.5" stroke-dasharray="8 8"/>'
           + bean(px - 52, py, rot=-20, state="climb", label=None)
           + f'<path d="M{px - 30:.0f} {py - 70:.0f} l 10 12 l 22 -26" stroke="{LEAF}" stroke-width="4" fill="none"/>')
# climbing bean with dotted path from agent a07
ax = AGENT_X[6]
beans3 += (f'<path d="M{ax} {GROUND - 50} C {ax + 40} 800, 1000 760, 1000 700" stroke="{INK}" stroke-width="2" stroke-dasharray="4 10" fill="none"/>'
           + bean(ax + 30, 820, rot=-30, state="climb", label="bean a07", scale=.9))
leader = f'<path d="M{px - 112:.0f} {py:.0f} L 560 {py:.0f}" stroke="{INK}" stroke-width="1.5"/>'
f3 = svg(blooms(sun=(960, 120, 700), sun_op=.75, ember=(1780, 1000, 420)) + st + beans3 + leader + agents())
f3 += f"""<div class="t cap"><span class="ml">Fig. 2</span><span class="it">The beanstalk.</span></div>
<div class="t note" style="left:4cqw;top:{py / 1080 * 100 * 0.5625 - 4.2:.1f}cqw;width:24cqw">Each bean is checked<br>where it will join.</div>
<div class="t legend" style="right:4cqw;top:12cqw"><span><i class="sw" style="background:var(--leafs);border-color:var(--leaf)"></i>locked in green</span><span><i class="sw" style="background:var(--paper);border-color:var(--ink)"></i>climbing</span></div>
<div class="t wm" style="right:4cqw;top:5cqw">Beanstalk</div>
<div class="pn">03 / 06</div>"""
frames.append(dict(id="03", name="THE BEANSTALK", time="9–14 s", act="Act II · the stalk", body=f3,
                   note="<b>First move:</b> the broken tree dissolves while the twelve agents hold; the stalk draws up from the centre in leaf green (music returns). Beans climb in a stagger, each gets a dashed check ring at its joint, then fills green and locks with a soft click. Camera starts tilting up at 3.5 s.",
                   seam="cut → 04 (same stalk)"))

# 04 together
st4, p4 = stalk(x=820, y_top=40, amp=22, leaves=False)
b4 = ""
for k, s in [(25, 1), (21, -1), (17, 1), (12, -1)]:
    x, y = p4[k]
    b4 += bean(x + s * 52, y, rot=s * 20)
# (1) sent back
a4x = AGENT_X[3]
x, y = p4[19]
b4 += (f'<path d="M{x - 60:.0f} {y + 30:.0f} C {x - 160:.0f} {y + 120:.0f}, {a4x + 40} 800, {a4x + 10} {GROUND - 60}" stroke="{EMBER}" stroke-width="2.5" stroke-dasharray="10 8" fill="none"/>'
       f'<path d="M{a4x - 4} {GROUND - 78} l 14 20 l 14 -20" stroke="{EMBER}" stroke-width="3" fill="none"/>'
       + bean(a4x + 70, 800, rot=-25, state="broken"))
b4 += (f'<rect x="{a4x + 112}" y="770" width="250" height="60" fill="{PAPER}" stroke="{EMBER}" stroke-width="1.5"/>'
       f'<text x="{a4x + 126}" y="800" class="mono" font-size="20" fill="{INK}">sent back ·</text>'
       f'<text x="{a4x + 126}" y="822" class="mono" font-size="20" fill="{INK}">reason attached</text>'
       f'<path d="M{a4x + 30} {GROUND - 70} C {a4x - 40} 760, {x - 120:.0f} {y + 40:.0f}, {x - 40:.0f} {y + 10:.0f}" stroke="{INK}" stroke-width="2" stroke-dasharray="3 9" fill="none"/>')
# (2) reconciled pair
x2, y2 = p4[14]
b4 += bean(x2 + 50, y2 + 6, rot=28) + bean(x2 + 104, y2 - 10, rot=-28)
b4 += f'<path d="M{x2 + 150:.0f} {y2:.0f} L 1280 {y2:.0f}" stroke="{INK}" stroke-width="1.5"/>'
# (3) decision bud
x3, y3 = p4[24]
b4 += (f'<path d="M{x3:.0f} {y3:.0f} q 120 -40 250 -10" stroke="{LEAF}" stroke-width="4" fill="none"/>'
       f'<circle cx="{x3 + 252:.0f}" cy="{y3 - 10:.0f}" r="9" fill="{SUN}" stroke="{INK}" stroke-width="2.5"/>')
f4 = svg(blooms(sun=(1480, 260, 560), sun_op=.7, ember=(160, 1000, 440)) + st4 + b4 + agents(highlight=3))
f4 += f"""<div class="t num" style="left:35cqw;top:39cqw">1</div>
<div class="t num" style="left:67cqw;top:{(y2 / 1080 * 56.25) - 3.6:.1f}cqw">2</div>
<div class="t callout" style="left:70cqw;top:{(y2 / 1080 * 56.25) - 3.2:.1f}cqw"><i>reconciled</i><small>only an out-of-date value</small></div>
<div class="t num" style="left:56cqw;top:4cqw">3</div>
<div class="t card" style="left:{(x3 + 280) / 19.2:.1f}cqw;top:{(y3 - 120) / 1920 * 100:.1f}cqw"><span class="ml">Decision · 1</span><span class="it">Needs a person.</span></div>
<div class="pn">04 / 06</div>"""
frames.append(dict(id="04", name="TOGETHER", time="14–19 s", act="Act II · the stalk", body=f4,
                   note="<b>First move:</b> (1) at 0.1 s a bean outlined in ember drops back down to a04 with a tag clipped on, then climbs again and locks green; (2) at 1.6 s two beans nudge and interlock like paired leaves; (3) at 3.0 s a bud swells off the stalk into one decision card. Camera eases up 120 px. Copy is proposed.",
                   seam="push-slide UP → 05"))

# 05 proof
st5, p5 = stalk(x=380, y_top=-40, y_bot=1120, amp=20, leaves=False)
rows = [(860, "1"), (600, "2"), (340, "3")]
b5 = ""
for y, _ in rows:
    b5 += (f'<path d="M392 {y} q 120 -50 260 -20" stroke="{LEAF}" stroke-width="5" fill="none"/>'
           f'<path d="M392 {y} q 60 -60 130 -40 q -50 30 -130 40" fill="{LEAFS}" stroke="{LEAF}" stroke-width="2.5"/>'
           f'<path d="M640 {y - 40} l 14 16 l 26 -30" stroke="{LEAF}" stroke-width="5" fill="none"/>'
           f'<line x1="700" y1="{y + 70}" x2="1780" y2="{y + 70}" stroke="{INK}" stroke-opacity=".2" stroke-width="1"/>')
f5 = svg(blooms(sun=(1300, 300, 620), sun_op=.8, ember=(1850, 1050, 380)) + st5 + b5)
f5 += """<div class="t rule">12 AI agents · 40 colliding tasks · measured on Cloudflare</div>
<div class="t stat" style="top:39cqw"><b class="mono">37</b><span class="of">of 40</span><span class="lbl">shipped</span></div>
<div class="t stat2" style="top:25.5cqw">Most of the work green in under <b class="mono">9</b> min <span class="aside">(merge queue: ~20)</span></div>
<div class="t stat2" style="top:12cqw">Stable line correct, <i>every run.</i></div>
<div class="pn">05 / 06</div>"""
frames.append(dict(id="05", name="PROOF", time="19–25 s", act="Act III · proof + close", body=f5,
                   note="<b>First move:</b> the measurement rule draws across the top at 0.1 s while the camera keeps climbing; then each claim climbs onto a leaf and locks with a tick, bottom to top, at 1.0 / 2.6 / 4.0 s. “37” and “9” count up. Rising pings, music builds.",
                   seam="push-slide UP → 06"))

# 06 clouds
st6, p6 = stalk(x=1300, y_top=360, y_bot=1120, amp=18, leaves=False)
tx, ty = p6[-1]
tendril = f'<path d="M{tx:.0f} {ty:.0f} c 0 -70 70 -100 110 -70 c 40 30 10 90 -36 74 c -30 -10 -24 -50 4 -46" stroke="{LEAF}" stroke-width="7" fill="none" stroke-linecap="round"/>'
clouds = ""
for cx, cy, w in [(340, 860, 520), (880, 920, 460), (1660, 880, 520), (1200, 760, 300)]:
    r = w / 6
    d = f"M{cx - w / 2:.0f} {cy:.0f} " + " ".join(
        f"a {r:.0f} {r * (0.9 if i % 2 else 1.2):.0f} 0 0 1 {w / 4:.0f} 0" for i in range(4))
    clouds += f'<path d="{d}" fill="{PAPER}" stroke="{INK}" stroke-width="2.5"/><line x1="{cx - w / 2 - 30:.0f}" y1="{cy:.0f}" x2="{cx + w / 2 + 30:.0f}" y2="{cy:.0f}" stroke="{INK}" stroke-width="2.5"/>'
f6 = svg(blooms(sun=(1300, 380, 820), sun_op=.95, ember=(120, 120, 380)) + st6 + tendril + clouds)
f6 += """<div class="t display" style="left:4cqw;top:12cqw">Beanstalk.</div>
<div class="t lead" style="left:4.4cqw;top:27cqw">Your agent swarm, growing together.</div>
<div class="t ml foot">Built on Cloudflare Workers + Artifacts</div>
<div class="pn">06 / 06</div>"""
frames.append(dict(id="06", name="INTO THE CLOUDS", time="25–30 s", act="Act III · proof + close", body=f6,
                   note="<b>First move:</b> the stalk pushes up through the ink clouds, which part left and right (riser); the tip curls into a tendril; the wordmark rises at 1.4 s, the line at 2.2 s, the foot label at 2.8 s. Then nothing moves for the last 2 s: the held frame, chime.",
                   seam="end · held frame"))

# ---------- page ----------
cells = []
for f in frames:
    cells.append(f"""<figure class="cellwrap">
  <div class="act">{f['act']}</div>
  <div class="cell" id="frame-{f['id']}">{f['body']}</div>
  <figcaption>
    <div class="lbl"><span>{f['id']} · {f['name']}</span><span>{f['time']}</span></div>
    <p>{f['note']}</p>
    <span class="chip">{f['seam']}</span>
  </figcaption>
</figure>""")

seam_cell = """<figure class="cellwrap">
  <div class="act">Seam map</div>
  <div class="cell flat seams">
    <div class="seamrow">
      <span class="s">01</span><span class="arrow">cut</span><span class="s">02</span><span class="arrow">crossfade</span><span class="s">03</span>
    </div>
    <div class="seamrow">
      <span class="s">03</span><span class="arrow">cut</span><span class="s">04</span><span class="arrow">push ↑</span><span class="s">05</span><span class="arrow">push ↑</span><span class="s">06</span>
    </div>
    <p class="rule2"><b>Direction rule: up = good.</b> Only bad things move down (sag, snap, a broken bean falling back). From 03 the camera only climbs; the stalk leads every seam upward.</p>
    <p class="rule2"><b>Hero prop:</b> the twelve agents on the ground line, 01 → 04, never move.</p>
  </div>
  <figcaption><div class="lbl"><span>SEAMS</span><span>30 s · 6 frames</span></div></figcaption>
</figure>"""

tokens_cell = f"""<figure class="cellwrap wide">
  <div class="act">Tokens · bans</div>
  <div class="cell flat tokens">
    <div class="sws">
      <div><i style="background:{PAPER}"></i>paper<br><code>#E9E5DB</code><br>ground</div>
      <div><i style="background:{INK}"></i>ink<br><code>#1B2566</code><br>every line + word</div>
      <div><i style="background:{SUN}"></i>sun<br><code>#F1EE2E</code><br>bloom only</div>
      <div><i style="background:{LEAF}"></i>leaf<br><code>#2E8B57</code><br>stalk + locked bean</div>
      <div><i style="background:{LEAFS}"></i>leaf-soft<br><code>#BFE3B4</code><br>bean fill</div>
      <div><i style="background:{EMBER}"></i>ember<br><code>#E26B4A</code><br>crack + sent back</div>
    </div>
    <div class="types">
      <div><span class="serif" style="font-size:3.2cqw">Instrument Serif</span><small>display · plate captions in italic · 400 only</small></div>
      <div><span class="arch">ARCHIVO 600 CAPS</span><small>micro-labels, 0.18em</small></div>
      <div><span class="mono" style="font-size:1.4cqw">JetBrains Mono 37 · 9 · a07</span><small>every number + agent id</small></div>
    </div>
    <p class="bans"><b>Bans:</b> no dark ground, no Bricolage (differs from beanstalk-30s); no glow, shadows or rounded cards; no fake UI; no other company's logo, no digs; no “idle agents”; no invented numbers; no slideshow cards, no screensaver wiggle.</p>
  </div>
  <figcaption><div class="lbl"><span>preset biennale-yellow + leaf</span><span>botanical plate</span></div></figcaption>
</figure>"""

html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Beanstalk Swarm Storyboard</title>
<style>
@font-face {{ font-family: "Instrument Serif"; src: url(assets/fonts/InstrumentSerif-Regular.woff2) format("woff2"); font-style: normal; font-weight: 400; }}
@font-face {{ font-family: "Instrument Serif"; src: url(assets/fonts/InstrumentSerif-Italic.woff2) format("woff2"); font-style: italic; font-weight: 400; }}
@font-face {{ font-family: "Archivo"; src: url(assets/fonts/Archivo-var.woff2) format("woff2"); font-weight: 100 900; }}
@font-face {{ font-family: "JetBrains Mono"; src: url(assets/fonts/JetBrainsMono-var.woff2) format("woff2"); font-weight: 100 800; }}
:root {{ --paper:{PAPER}; --deep:{DEEP}; --sun:{SUN}; --ink:{INK}; --ember:{EMBER}; --leaf:{LEAF}; --leafs:{LEAFS};
  --serif:"Instrument Serif", Georgia, serif; --sans:"Archivo", system-ui, sans-serif; --mono:"JetBrains Mono", ui-monospace, monospace; }}
* {{ box-sizing: border-box; margin: 0; }}
body {{ background: var(--deep); color: var(--ink); font-family: var(--sans); padding: 48px 40px 80px; }}
header {{ max-width: 1800px; margin: 0 auto 36px; display: flex; align-items: end; justify-content: space-between; gap: 24px; flex-wrap: wrap; border-bottom: 1px solid var(--ink); padding-bottom: 20px; }}
header h1 {{ font-family: var(--serif); font-weight: 400; font-size: 56px; line-height: 1; letter-spacing: -0.01em; }}
header h1 i {{ font-size: 28px; vertical-align: super; margin-left: 8px; }}
header p {{ font-size: 16px; max-width: 760px; margin-top: 10px; line-height: 1.5; }}
.tag0 {{ font-family: var(--mono); font-size: 13px; letter-spacing: .08em; border: 1px solid var(--ink); padding: 8px 12px; }}
main {{ max-width: 1800px; margin: 0 auto; display: grid; grid-template-columns: repeat(3, 1fr); gap: 40px 28px; }}
@media (max-width: 1100px) {{ main {{ grid-template-columns: 1fr; }} }}
.cellwrap.wide {{ grid-column: span 2; }}
@media (max-width: 1100px) {{ .cellwrap.wide {{ grid-column: auto; }} }}
.act {{ font-size: 11px; font-weight: 600; letter-spacing: .24em; text-transform: uppercase; margin-bottom: 8px; }}
.cell {{ position: relative; aspect-ratio: 16 / 9; container-type: inline-size; background: var(--paper); overflow: hidden; border: 1px solid rgba(27,37,102,.25); }}
.wide .cell {{ aspect-ratio: 32 / 9; }}
.art {{ position: absolute; inset: 0; width: 100%; height: 100%; }}
.mono {{ font-family: var(--mono); }}
.t {{ position: absolute; color: var(--ink); }}
.cap {{ left: 4cqw; top: 4cqw; display: flex; flex-direction: column; gap: .5cqw; }}
.ml {{ font-family: var(--sans); font-weight: 600; font-size: .9cqw; letter-spacing: .2em; text-transform: uppercase; }}
.it {{ font-family: var(--serif); font-style: italic; font-size: 4.6cqw; line-height: 1; letter-spacing: -0.005em; }}
.sub {{ left: 4cqw; top: 15cqw; font-family: var(--serif); font-size: 2.2cqw; }}
.tag {{ font-family: var(--mono); font-size: 1.1cqw; letter-spacing: .06em; text-transform: uppercase; }}
.head {{ font-family: var(--serif); font-size: 5.4cqw; line-height: 1.04; letter-spacing: -0.005em; }}
.note {{ font-family: var(--serif); font-style: italic; font-size: 2.1cqw; line-height: 1.1; }}
.legend {{ display: flex; flex-direction: column; gap: .6cqw; font-size: 1cqw; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; }}
.sw {{ display: inline-block; width: 1.6cqw; height: 1cqw; border-radius: 50%; border: 2px solid; margin-right: .6cqw; vertical-align: middle; }}
.wm {{ font-family: var(--serif); font-size: 2.2cqw; }}
.num {{ font-family: var(--serif); font-size: 3.4cqw; line-height: 1; }}
.num::after {{ content: ""; display: block; width: 2.6cqw; border-top: 1px solid var(--ink); margin-top: .3cqw; }}
.callout {{ display: flex; flex-direction: column; font-family: var(--serif); font-size: 2.6cqw; line-height: 1; }}
.callout small {{ font-family: var(--sans); font-size: 1cqw; margin-top: .5cqw; }}
.card {{ background: var(--paper); border: 1px solid var(--ink); padding: 1cqw 1.4cqw; display: flex; flex-direction: column; gap: .4cqw; }}
.card .it {{ font-size: 2.4cqw; }}
.rule {{ left: 4cqw; right: 4cqw; top: 3.4cqw; padding-bottom: .8cqw; border-bottom: 1px solid var(--ink); font-family: var(--mono); font-size: 1.3cqw; letter-spacing: .08em; text-transform: uppercase; }}
.stat {{ left: 38cqw; display: flex; align-items: baseline; gap: 1.2cqw; }}
.stat b {{ font-family: var(--serif); font-weight: 400; font-size: 9.5cqw; line-height: .85; letter-spacing: -0.02em; }}
.stat .of {{ font-family: var(--serif); font-size: 3.4cqw; }}
.stat .lbl {{ font-family: var(--serif); font-style: italic; font-size: 3.4cqw; }}
.stat2 {{ left: 38cqw; right: 4cqw; font-family: var(--serif); font-size: 3cqw; line-height: 1.05; }}
.stat2 b {{ font-family: var(--serif); font-weight: 400; font-size: 4.4cqw; }}
.aside {{ font-family: var(--mono); font-size: 1.15cqw; letter-spacing: .02em; vertical-align: middle; }}
.display {{ font-family: var(--serif); font-size: 12cqw; line-height: .86; letter-spacing: -0.018em; }}
.lead {{ font-family: var(--serif); font-style: italic; font-size: 3.6cqw; }}
.foot {{ left: 4.4cqw; bottom: 4cqw; }}
.pn {{ position: absolute; right: 2.4cqw; bottom: 2cqw; font-family: var(--mono); font-size: .9cqw; letter-spacing: .08em; opacity: .75; }}
figcaption {{ margin-top: 12px; }}
.lbl {{ display: flex; justify-content: space-between; font-family: var(--mono); font-size: 12px; letter-spacing: .08em; padding-bottom: 6px; border-bottom: 1px solid rgba(27,37,102,.3); }}
figcaption p {{ font-size: 14px; line-height: 1.5; margin-top: 8px; }}
.chip {{ display: inline-block; margin-top: 10px; font-family: var(--mono); font-size: 11px; letter-spacing: .06em; border: 1px solid var(--ink); padding: 4px 8px; }}
.flat {{ padding: 3cqw 4cqw; display: flex; flex-direction: column; gap: 2cqw; }}
.seamrow {{ display: flex; align-items: center; gap: 1.2cqw; flex-wrap: wrap; }}
.seamrow .s {{ font-family: var(--serif); font-size: 7cqw; line-height: 1; }}
.seamrow .arrow {{ font-family: var(--mono); font-size: 2.4cqw; border-bottom: 1px solid var(--ink); padding: 0 .6cqw .3cqw; }}
.rule2 {{ font-size: 3cqw; line-height: 1.4; }}
.tokens {{ gap: 1.4cqw; padding: 2cqw 3cqw; }}
.sws {{ display: grid; grid-template-columns: repeat(6, 1fr); gap: 1cqw; font-size: .85cqw; line-height: 1.35; }}
.sws i {{ display: block; height: 3.4cqw; border: 1px solid rgba(27,37,102,.3); margin-bottom: .5cqw; }}
.sws code {{ font-family: var(--mono); }}
.types {{ display: flex; gap: 3cqw; align-items: baseline; flex-wrap: wrap; }}
.types div {{ display: flex; flex-direction: column; }}
.types small {{ font-size: .8cqw; margin-top: .3cqw; }}
.serif {{ font-family: var(--serif); }}
.arch {{ font-weight: 600; letter-spacing: .18em; font-size: 1.2cqw; }}
.bans {{ font-size: .95cqw; line-height: 1.45; }}
</style>
</head>
<body>
<header>
  <div>
    <h1>Beanstalk · growing together <i>v1</i></h1>
    <p>A botanical-plate promo: the git tree sags and snaps under a swarm; one beanstalk carries every agent's bean upward, through measured proof, into the clouds. Static wireframes at each frame's key moment; no motion yet.</p>
  </div>
  <span class="tag0">1920×1080 · 30 s · 6 frames · no VO · music + SFX</span>
</header>
<main>
{''.join(cells)}
{seam_cell}
{tokens_cell}
</main>
</body>
</html>
"""
open(OUT, "w").write(html)
print("wrote", OUT, len(html))
