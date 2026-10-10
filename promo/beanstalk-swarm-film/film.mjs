// Gitstalk — "growing together" (30 s, 1920x1080, 30 fps). claude-animation workflow, node canvas + ffmpeg.
//
// STYLE BIBLE (from ../beanstalk-swarm/frame.md + STORYBOARD.md)
//   Look: a botanical field-guide plate. Parchment #E9E5DB, one indigo ink #1B2566 for every line and word.
//   Sun #F1EE2E only as a radial bloom; ember #E26B4A only for the crack/splinter and the "sent back" tag;
//   leaf #2E8B57 / #BFE3B4 only for the stalk, its leaves and locked beans. No shadows, no rounded cards,
//   hairline (1-1.5 px) borders. Type: Instrument Serif (display, italic captions), Archivo 600 caps
//   micro-labels, JetBrains Mono labels. Boil: NO (editorial plate holds still). Exposure: ones.
//   Direction rule: up = good. Only bad things move down (sag, the snap, the sent-back bean).
//   Cast: 12 agents (ink rings a01-a12) on one ground line, beats 1-4.
//
// BEAT SHEET (global seconds)
//   1  0.0-5.0  Fig. 1 the git tree: trunk draws, 12 branches push out and lengthen, then sag.   SFX creaks
//   2  5.0-9.0  the snap: at 5.3 the heaviest branch breaks off WHOLE, falls, hits the ground at
//               5.85 and splinters in two; ember crack runs into two neighbours; 3-line headline.  snap, thud
//   3  9.0-14   Fig. 2 the beanstalk: tree dissolves, stalk grows, 9 beans climb, are checked where
//               they join and lock green.                                                         clicks
//   4  14-19    together: (1) a04's bean is sent back with a reason, climbs again and locks;
//               (2) two beans clash, nudge, reconcile; (3) a bud becomes the decision card.  drop+ping, clicks, chime
//   5  19-25    push up; proof: label rule, then three claims lock on leaves bottom-to-top.        rising pings
//   6  25-30    push up through ink clouds; tendril curls; "Gitstalk." lockup; hold from ~27.9.  riser, chime
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { GlobalFonts } from "@napi-rs/canvas";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(HERE, "lib");
const { clamp, lerp, ss, eOut, eIn, eIO, popS, hash, rng, catmull, at, line, poly, ellipse, stroke, fill, taper, rad } = await import(path.join(LIB, "core.mjs"));
const { paper, filmFinish } = await import(path.join(LIB, "textures.mjs"));
const { Pen } = await import(path.join(LIB, "pen.mjs"));
const { run } = await import(path.join(LIB, "film.mjs"));

const W = 1920, H = 1080, FPS = 30, DUR = 30;
const PAPER = "#E9E5DB", PAPER_D = "#DCD6C4", PAPER_L = "#F2EFE6", INK = "#1B2566", EMBER = "#E26B4A";
const LEAF = "#2E8B57", LEAF_S = "#BFE3B4", LEAF_D = "#1F5F3A";

// ---------- fonts (fall back to generic families if a file fails) ----------
const reg = (f, fam, fb) => { try { return GlobalFonts.registerFromPath(path.join(HERE, "fonts", f), fam) ? fam : fb; } catch { return fb; } };
const SERIF = reg("InstrumentSerif-Regular.ttf", "BSSerif", "serif");
const ITAL = reg("InstrumentSerif-Italic.ttf", "BSSerifIt", "serif");
const SANS = reg("Archivo-Regular.ttf", "BSArchivo", "sans-serif");
const SANSB = reg("Archivo-SemiBold.ttf", "BSArchivoSB", "sans-serif");
const MONO = reg("JetBrainsMono-Regular.ttf", "BSMono", "monospace");

function txt(ctx, s, x, y, { f = SERIF, size = 40, color = INK, a = 1, align = "left", track = 0 } = {}) {
  if (a <= 0.003) return;
  ctx.save(); ctx.globalAlpha *= clamp(a); ctx.fillStyle = color; ctx.font = `${size}px ${f}`; ctx.textAlign = align; ctx.textBaseline = "alphabetic";
  ctx.letterSpacing = track ? `${track}px` : "0px"; ctx.fillText(s, x, y); ctx.restore();
}
function tw(ctx, s, f, size, track = 0) { ctx.save(); ctx.font = `${size}px ${f}`; ctx.letterSpacing = "0px"; const w = ctx.measureText(s).width + track * s.length; ctx.restore(); return w; }
// a line made of runs [[text, font, size], ...] on one baseline
function runs(ctx, list, x, y, a = 1) { let cx = x; for (const [s, f, size, color] of list) { txt(ctx, s, cx, y, { f, size, a, color: color || INK }); cx += tw(ctx, s, f, size); } return cx; }
const ap = (t, t0, d = .5) => eOut((t - t0) / d);                    // appear 0..1
const rise = (t, t0, d = .5, dist = 18) => (1 - ap(t, t0, d)) * dist;

// ---------- atmosphere ----------
function bloom(ctx, x, y, r, a) {
  if (a <= 0.01) return; const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(241,238,46,${.82 * a})`); g.addColorStop(.28, `rgba(248,243,155,${.6 * a})`);
  g.addColorStop(.62, `rgba(240,218,124,${.2 * a})`); g.addColorStop(1, "rgba(240,218,124,0)");
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
}
function emberBloom(ctx, x, y, r, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(226,107,74,${.18 * a})`); g.addColorStop(1, "rgba(226,107,74,0)");
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
}

// ---------- camera: only ever climbs ----------
const cam = (t) => 50 * ss(12.4, 14, t) + 70 * ss(14, 19, t) + 1260 * eIO(clamp((t - 19) / 1.0)) + 160 * ss(20, 25, t) + 1160 * eIO(clamp((t - 25) / 1.05));

// ---------- the stalk (one world-space path, grows upward through every beat) ----------
const G = 860;                                           // ground line (world y)
const AX = (k) => 300 + 120 * k;                         // agent x
const STALK = catmull([[960, G], [954, 700], [966, 520], [952, 340], [962, 160], [956, 0], [905, -170], [720, -370], [500, -560], [400, -760],
  [376, -980], [392, -1200], [420, -1420], [540, -1560], [740, -1700], [960, -1870], [1160, -2060], [1275, -2290], [1300, -2450], [1292, -2560]], false, 4);
const CUM = [0]; for (let i = 1; i < STALK.length; i++) CUM.push(CUM[i - 1] + Math.hypot(STALK[i][0] - STALK[i - 1][0], STALK[i][1] - STALK[i - 1][1]));
const LTOT = CUM[CUM.length - 1];
const idxAtY = (y) => { let i = 0; while (i < STALK.length - 1 && STALK[i + 1][1] > y) i++; return i; };
const xAt = (y) => { const i = idxAtY(y), a = STALK[i], b = STALK[Math.min(i + 1, STALK.length - 1)], k = clamp((a[1] - y) / ((a[1] - b[1]) || 1)); return lerp(a[0], b[0], k); };
const lenAt = (y) => { const i = idxAtY(y), a = STALK[i], b = STALK[Math.min(i + 1, STALK.length - 1)], k = clamp((a[1] - y) / ((a[1] - b[1]) || 1)); return lerp(CUM[i], CUM[Math.min(i + 1, CUM.length - 1)], k); };
const grow = (t) => t < 9.1 ? 0 : lerp(0, lenAt(-260), eOut((t - 9.1) / 1.7)) + (lenAt(-1720) - lenAt(-260)) * eIO(clamp((t - 18.95) / .85)) + (LTOT - lenAt(-1720)) * eOut(clamp((t - 24.95) / 1.1));
const TIP = STALK[STALK.length - 1];

function drawStalk(ctx, Lg, C) {
  if (Lg <= 1) return;
  const top = -C - 60, bot = -C + H + 60, segs = [];
  for (let i = 0; i < STALK.length - 1 && CUM[i] < Lg; i++) {
    const a = STALK[i], b0 = STALK[i + 1]; if (Math.max(a[1], b0[1]) < top || Math.min(a[1], b0[1]) > bot) continue;
    const k = clamp((Lg - CUM[i]) / ((CUM[i + 1] - CUM[i]) || 1)), b = [lerp(a[0], b0[0], k), lerp(a[1], b0[1], k)];
    const w = lerp(15, 5, CUM[i] / LTOT) * clamp(.3 + (Lg - CUM[i]) / 110);
    segs.push([a, b, w, CUM[i]]);
  }
  ctx.save(); ctx.lineCap = "round";
  for (const [a, b, w] of segs) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineWidth = w + 3.4; ctx.strokeStyle = LEAF_D; ctx.stroke(); }
  for (const [a, b, w] of segs) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineWidth = w; ctx.strokeStyle = LEAF; ctx.stroke(); }
  for (const [a, b, w] of segs) { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l * w * .22, ny = dx / l * w * .22;
    ctx.beginPath(); ctx.moveTo(a[0] + nx, a[1] + ny); ctx.lineTo(b[0] + nx, b[1] + ny); ctx.lineWidth = Math.max(1, w * .2); ctx.strokeStyle = LEAF_S; ctx.stroke(); }
  // node rings: texture along the stem
  for (const [a, b, w, s] of segs) { if (Math.floor(s / 64) === Math.floor((s + Math.hypot(b[0] - a[0], b[1] - a[1])) / 64)) continue;
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l, h = w * .5 + 2.5;
    ctx.beginPath(); ctx.moveTo(a[0] - nx * h, a[1] - ny * h); ctx.quadraticCurveTo(a[0] + dx / l * 3, a[1] + dy / l * 3, a[0] + nx * h, a[1] + ny * h); ctx.lineWidth = 1.3; ctx.strokeStyle = LEAF_D; ctx.stroke(); }
  ctx.restore();
}

// ---------- drawings ----------
function leaf(ctx, x, y, len, ang, s = 1) {
  if (s <= .01) return;
  at(ctx, x, y, s, ang, () => {
    const w = len * .36, n = 14, top = [], bot = [];
    for (let i = 0; i <= n; i++) { const u = i / n; top.push([u * len, -w * Math.pow(Math.sin(Math.PI * u), .85) * (1 - .25 * u)]); bot.push([u * len, w * .75 * Math.pow(Math.sin(Math.PI * u), .9) * (1 - .2 * u)]); }
    const P = [...top, ...bot.reverse()]; poly(ctx, P); fill(ctx, LEAF_S);
    line(ctx, [[0, 0], [len * .95, -len * .02]], 1.3, LEAF);
    for (let i = 1; i <= 4; i++) { const u = i / 5.2; line(ctx, [[u * len, 0], [u * len + len * .14, -w * .7 * Math.sin(Math.PI * u)]], .9, LEAF); line(ctx, [[u * len, 0], [u * len + len * .12, w * .5 * Math.sin(Math.PI * u)]], .9, LEAF); }
    poly(ctx, P); stroke(ctx, 1.8, LEAF_D);
  });
}
const BEAN = Array.from({ length: 30 }, (_, i) => { const a = i / 30 * 2 * Math.PI, sy = Math.sin(a); return [19 * Math.cos(a), 9.5 * sy * (sy < 0 ? .55 + .45 * Math.abs(Math.cos(a)) : 1)]; });
function bean(ctx, x, y, ang, s, { green = 0, edge = INK, a = 1 } = {}) {
  if (s <= .01 || a <= .01) return;
  ctx.save(); ctx.globalAlpha *= a;
  at(ctx, x, y, s * 1.3, ang, () => {
    poly(ctx, BEAN); fill(ctx, PAPER_L);
    if (green > 0) { ctx.save(); ctx.globalAlpha *= green; poly(ctx, BEAN); fill(ctx, LEAF); ctx.beginPath(); ctx.ellipse(-3, -2.5, 10, 2.6, -.08, Math.PI * 1.05, Math.PI * 1.9); ctx.lineWidth = 2; ctx.strokeStyle = LEAF_S; ctx.stroke(); ctx.restore(); }
    if (green < 1) { ctx.save(); ctx.globalAlpha *= 1 - green; poly(ctx, BEAN); ctx.clip(); for (let i = 0; i < 6; i++) line(ctx, [[-8 + i * 5, 10], [-2 + i * 5, 2]], 1, INK); ctx.restore(); }
    line(ctx, [[-13, 1.5], [0, 3.2], [13, 1.5]], 1, green > .5 ? LEAF_D : INK);
    poly(ctx, BEAN); stroke(ctx, 2.2, green > .5 && edge === INK ? LEAF_D : edge);
  });
  ctx.restore();
}
function agent(ctx, k, s = 1, pulse = 0, jolt = 0, a = 1) {
  if (s <= .01) return; const x = AX(k), y = G - 17 + jolt, r = 14 * (1 + .2 * pulse);
  ctx.save(); ctx.globalAlpha *= a;
  at(ctx, x, y, s, 0, () => {
    ellipse(ctx, 0, 0, r, r); fill(ctx, PAPER_D);
    ctx.save(); ellipse(ctx, 0, 0, r, r); ctx.clip(); for (let i = 0; i < 4; i++) line(ctx, [[2 + i * 4, 14], [10 + i * 4, 2]], .9, INK); ctx.restore();
    ellipse(ctx, 0, 0, r, r); stroke(ctx, 2.2, INK); ellipse(ctx, 0, 0, 3.6, 3.6); fill(ctx, INK);
  });
  txt(ctx, "a" + String(k + 1).padStart(2, "0"), x, G + 34, { f: MONO, size: 15, a: .85 * clamp(s), align: "center" });
  ctx.restore();
}
function splinters(ctx, x, y, ang, sz, seed, a = 1) {
  ctx.save(); ctx.globalAlpha *= a;
  for (let i = 0; i < 6; i++) { const g = ang + (hash(seed + i) - .5) * 1.1, l = sz * (.45 + hash(seed + i * 3.1 + 9) * .8);
    taper(ctx, [[x, y], [x + Math.cos(g) * l * .5, y + Math.sin(g) * l * .5], [x + Math.cos(g) * l, y + Math.sin(g) * l]], 3.2, .6, i % 3 === 1 ? EMBER : INK); }
  ctx.restore();
}
// flying chips: deterministic in t
function chips(ctx, t, t0, x, y, n, seed, spread = 1) {
  const tau = t - t0; if (tau < 0 || tau > 1.1) return;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (hash(seed + i) - .5) * 2.6 * spread, v = 260 + hash(seed + i * 7) * 420, life = .55 + hash(seed + i * 3) * .5; if (tau > life) continue;
    const px = x + Math.cos(a) * v * tau, py = Math.min(G - 2, y + Math.sin(a) * v * tau + 1400 * tau * tau), r = hash(seed + i * 5) * 6 + tau * 14 * (hash(seed + i) - .5), l = 5 + hash(seed + i * 11) * 9;
    ctx.save(); ctx.globalAlpha *= 1 - tau / life; line(ctx, [[px - Math.cos(r) * l / 2, py - Math.sin(r) * l / 2], [px + Math.cos(r) * l / 2, py + Math.sin(r) * l / 2]], 2, i % 4 === 0 ? EMBER : INK); ctx.restore();
  }
}

// ---------- beat 1-2: the git tree ----------
const BR = Array.from({ length: 12 }, (_, k) => { const dir = k < 6 ? -1 : 1, j = k < 6 ? k : 11 - k, order = k < 6 ? (5 - k) * 2 : (k - 6) * 2 + 1;
  return { k, dir, j, Lf: Math.abs(AX(k) - 960) * .95 + 70, ay: 440 + j * 58, t0: .55 + .11 * order }; });
const branchLen = (b, t) => t < b.t0 ? 0 : t < b.t0 + .5 ? .55 * b.Lf * eOut((t - b.t0) / .5) : lerp(.55 * b.Lf, b.Lf, ss(b.t0 + .5, 5.0, t));
function branchPts(b, L, t) { const n = Math.max(2, Math.ceil(L / 14)), lift = (.07 + .025 * Math.sin(b.k * 2.3)) * L, sag = (.05 + .3 * ss(1.2, 5.2, t)) * L;
  return Array.from({ length: n + 1 }, (_, i) => { const s = i / n; return [b.dir * s * L * (1 - .12 * s * ss(1.2, 5.2, t)), -lift * Math.sin(Math.PI * s * .7) + sag * s * s * s * 1.3]; }); }
function branchRot(b, t, jolt = true) { let r = b.dir * rad(3 + 7 * (b.Lf / 700)) * ss(1.5, 5.6, t); if (jolt && t > 5.3) r += b.dir * .035 * Math.exp(-(t - 5.3) * 4) * Math.sin((t - 5.3) * 28); return r; }
const toWorld = (b, rot, p) => [960 + p[0] * Math.cos(rot) - p[1] * Math.sin(rot), b.ay + p[0] * Math.sin(rot) + p[1] * Math.cos(rot)];
const bw0 = (b) => 2.6 + 5 * (b.Lf / 700) + (b.k === 11 ? 2.5 : 0);
function drawBranchLocal(ctx, b, pts, upto = Infinity) {
  const n = pts.length - 1, w0 = bw0(b);
  for (let i = 0; i < n && i < upto; i++) line(ctx, [pts[i], pts[i + 1]], lerp(w0, 1.6, i / n), INK);
  // twigs + commit nodes (texture) + head ring
  let acc = 0;
  for (let i = 1; i <= n && i <= upto; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); acc += d;
    if (Math.floor((acc - d - 60) / 95) !== Math.floor((acc - 60) / 95) && acc > 60 && i < n - 2) { ellipse(ctx, pts[i][0], pts[i][1], 4.3, 4.3); fill(ctx, PAPER_L); stroke(ctx, 1.6, INK); }
    if (b.Lf > 300 && (i === Math.round(n * .42) || i === Math.round(n * .74))) { const [x, y] = pts[i], tx = x + b.dir * 10, ty = y - 16; line(ctx, [[x, y], [tx, ty], [tx + b.dir * 6, ty - 5]], 1.3, INK); ellipse(ctx, tx + b.dir * 6, ty - 5, 2, 2); fill(ctx, INK); }
  }
}
const SNAP = 5.3, LAND = 5.85, SB = BR[11];
const SNAP_PTS = (() => { const r = branchRot(SB, SNAP, false); return branchPts(SB, SB.Lf, SNAP).map((p) => toWorld(SB, r, p)); })();
const FALL = (() => { const P = SNAP_PTS, c0 = P.reduce((s, p) => [s[0] + p[0] / P.length, s[1] + p[1] / P.length], [0, 0]),
  phi = Math.atan2(P[P.length - 1][1] - P[0][1], P[P.length - 1][0] - P[0][0]), th = .03 - phi;
  const rotd = (p, a, c) => [c[0] + (p[0] - c[0]) * Math.cos(a) - (p[1] - c[1]) * Math.sin(a), c[1] + (p[0] - c[0]) * Math.sin(a) + (p[1] - c[1]) * Math.cos(a)];
  const maxY = Math.max(...P.map((p) => rotd(p, th, c0)[1])); return { c0, th, dy: G - 7 - maxY, dx: 10, rotd }; })();
const SPLIT = Math.floor(SNAP_PTS.length * .52);
function fallenPts(t) {
  const { c0, th, dy, dx, rotd } = FALL, u = clamp((t - SNAP) / (LAND - SNAP));
  let P = SNAP_PTS.map((p) => { const q = rotd(p, th * Math.pow(u, 1.5), c0); return [q[0] + dx * u, q[1] + dy * u * u]; });
  if (t <= LAND) return [[P, 0]];
  const tau = t - LAND, cuts = [3, Math.floor(P.length * .36), Math.floor(P.length * .7), P.length - 1], out = [];
  const tgt = [-.06, .04, .1], ox = [-24, 14, 40], bh = [12, 22, 16], bd = [.24, .3, .27];
  for (let q = 0; q < 3; q++) {
    const Q = P.slice(cuts[q], cuts[q + 1] + 1), c = Q[Math.floor(Q.length / 2)], phi = Math.atan2(Q[Q.length - 1][1] - Q[0][1], Q[Q.length - 1][0] - Q[0][0]);
    const u = eOut(tau / .3), ang = (tgt[q] - phi) * u, R = Q.map((p) => rotd(p, ang, c)), dy0 = (G - 5) - Math.max(...R.map((p) => p[1]));
    const b = tau < bd[q] ? -bh[q] * Math.sin(Math.PI * tau / bd[q]) : tau < bd[q] * 1.6 ? -bh[q] * .25 * Math.sin(Math.PI * (tau - bd[q]) / (bd[q] * .6)) : 0;
    out.push([R.map((p) => [p[0] + ox[q] * u, p[1] + dy0 * Math.min(1, u * 1.4) + b]), cuts[q]]);
  }
  return out;
}
function drawWorldBranch(ctx, P, w0, w1) { const n = P.length - 1; for (let i = 0; i < n; i++) line(ctx, [P[i], P[i + 1]], lerp(w0, w1, i / n), INK); }
function crackPath(b, t, frac) { const r = branchRot(b, t), P = branchPts(b, b.Lf, t).slice(0, Math.ceil(b.Lf * frac / 14)).map((p) => toWorld(b, r, p)); return P; }

function drawTree(ctx, t) {
  const a = 1 - ss(8.8, 9.4, t); if (a <= 0) return;
  ctx.save(); ctx.globalAlpha *= a;
  // trunk: base -> bark texture -> roots
  const tr = clamp((t + .08) / .7), top = lerp(G, 395, eOut(tr));
  if (tr > 0) {
    taper(ctx, [[960, G], [958, lerp(G, top, .5)], [960, top]], 13, 6, INK);
    for (let y = G - 30; y > top + 20; y -= 26) { const s = (Math.round(y / 26) % 2) ? 1 : -1; line(ctx, [[960 + s * 2, y], [960 + s * 4.5, y - 9]], 1.4, PAPER_L); }
    line(ctx, [[952, G], [930, G + 2]], 2.4, INK); line(ctx, [[968, G], [992, G + 2]], 2.4, INK);
  }
  for (const b of BR) {
    if (b === SB && t >= SNAP) continue;
    const L = branchLen(b, t); if (L <= 2) continue;
    const pts = branchPts(b, L, t), rot = branchRot(b, t);
    at(ctx, 960, b.ay, 1, rot, () => {
      drawBranchLocal(ctx, b, pts);
      const tip = pts[pts.length - 1]; ellipse(ctx, tip[0], tip[1], 6.5, 6.5); fill(ctx, PAPER_L); stroke(ctx, 2, INK);
    });
    // ownership tether: agent -> its branch head
    const tipW = toWorld(b, rot, pts[pts.length - 1]); const ta = clamp((t - b.t0 - .35) / .4) * (1 - ss(5.25, 5.6, t));
    if (ta > 0) { ctx.save(); ctx.globalAlpha *= .3 * ta; line(ctx, [[AX(b.k), G - 33], [tipW[0], tipW[1] + 8]], 1, INK, [2, 6]); ctx.restore(); }
  }
  // the snap: stump on the trunk, the whole branch falls, hits, splits
  if (t >= SNAP) {
    const r = branchRot(SB, t), stumpP = branchPts(SB, SB.Lf, SNAP).slice(0, 4);
    at(ctx, 960, SB.ay, 1, r, () => { for (let i = 0; i < 3; i++) line(ctx, [stumpP[i], stumpP[i + 1]], bw0(SB), INK); });
    const se = toWorld(SB, r, stumpP[3]); splinters(ctx, se[0], se[1], r, 22, 11);
    const pieces = fallenPts(t), n = SNAP_PTS.length - 1, w0 = bw0(SB);
    pieces.forEach(([Q, i0], q) => {
      const Qd = q === 0 && pieces.length === 1 ? Q.slice(3) : Q, j0 = q === 0 && pieces.length === 1 ? 3 : i0;
      drawWorldBranch(ctx, Qd, lerp(w0, 1.6, j0 / n), lerp(w0, 1.6, (j0 + Qd.length - 1) / n));
      const s0 = Qd[0], s1 = Qd[Math.min(2, Qd.length - 1)], e0 = Qd[Qd.length - 1], e1 = Qd[Math.max(0, Qd.length - 3)];
      splinters(ctx, s0[0], s0[1], Math.atan2(s0[1] - s1[1], s0[0] - s1[0]), 20, 21 + q * 10);
      if (q < pieces.length - 1) splinters(ctx, e0[0], e0[1], Math.atan2(e0[1] - e1[1], e0[0] - e1[0]), 18, 61 + q * 10);
      else { ellipse(ctx, e0[0], e0[1], 6.5, 6.5); fill(ctx, PAPER_L); stroke(ctx, 2, INK); }
    });
    chips(ctx, t, SNAP, se[0] + 10, se[1], 16, 3, .9);
    if (t > LAND) { const pc = fallenPts(LAND + .001); chips(ctx, t, LAND, pc[1][0][0][0], G - 6, 18, 7, 1.2); chips(ctx, t, LAND, pc[2][0][0][0], G - 6, 14, 17, 1); chips(ctx, t, LAND, pc[0][0][0][0], G - 6, 10, 27, 1); }
    // dust ticks where it lands
    if (t > LAND && t < LAND + .7) { const u = (t - LAND) / .7; ctx.save(); ctx.globalAlpha *= 1 - u;
      for (let i = 0; i < 9; i++) { const x = 1080 + i * 75 + (hash(i) - .5) * 30, d = 18 + u * 40 * (1 + hash(i + 3)); line(ctx, [[x - d * .3, G - 4 - d * .25], [x - d * .6, G - 4 - d * .45]], 1.4, INK); line(ctx, [[x + d * .3, G - 4 - d * .25], [x + d * .6, G - 4 - d * .45]], 1.4, INK); }
      ctx.restore(); }
    // ember crack through the trunk into two neighbours
    const cp = clamp((t - SNAP - .03) / .38);
    if (cp > 0) {
      const z = (P, s) => P.map((p, i) => [p[0] + (hash(i * 3.3 + s) - .5) * 7, p[1] + (hash(i * 7.7 + s) - .5) * 7]);
      const trunk = z(Array.from({ length: 10 }, (_, i) => [961, SB.ay + 4 + i * (BR[9].ay - SB.ay) / 9]), 1);
      const b10 = z(crackPath(BR[10], t, .34), 2), b9 = z(crackPath(BR[9], t, .24), 3);
      const part = (P, u) => P.slice(0, Math.max(1, Math.ceil(P.length * clamp(u))));
      line(ctx, part(trunk, cp * 1.6), 2.4, EMBER); line(ctx, part(b10, cp * 2 - .6), 2.2, EMBER); line(ctx, part(b9, cp * 2.2 - 1.1), 2.2, EMBER);
    }
  }
  ctx.restore();
}

// ---------- beat 3-4: beans ----------
const SLOT = { 0: [790, -1], 1: [740, 1], 2: [690, -1], 4: [640, 1], 5: [540, 1], 6: [490, -1], 8: [440, 1], 9: [320, -1], 11: [270, 1] };
const B3 = [0, 4, 1, 6, 2, 9, 5, 11, 8].map((k, i) => ({ k, slotY: SLOT[k][0], side: SLOT[k][1], tr: 9.8 + i * .28 }));
function track(sp, t, x0 = AX(sp.k), y0 = G - 22) {
  if (t < sp.tr) return null;
  const ys = G - 26, hop = .28 + Math.abs(x0 - 960) / 2200, cl = (ys - sp.slotY) / 620, ta = sp.tr + hop + cl, tl = ta + .34;
  if (t < sp.tr + hop) { const u = eIO((t - sp.tr) / hop); return { x: lerp(x0, xAt(ys), u), y: lerp(y0, ys, u) - 46 * Math.sin(Math.PI * u), ang: -u * 1.2, s: 1, ph: "hop", ta, tl }; }
  if (t < ta) { const u = (t - sp.tr - hop) / cl, y = lerp(ys, sp.slotY, u * u * (3 - 2 * u) * .5 + u * .5), ph = (ys - y) / 38;
    return { x: xAt(y) + 20 * Math.sin(ph), y, ang: -1.25 + .3 * Math.cos(ph), s: .9 + .1 * Math.cos(ph), ph: "climb", ta, tl }; }
  const ax = xAt(sp.slotY) + sp.side * 38, ay = sp.slotY + 8, angL = sp.side > 0 ? .55 : Math.PI - .55;
  if (t < tl) { const u = eOut((t - ta) / .34); return { x: lerp(xAt(sp.slotY), ax, u), y: lerp(sp.slotY, ay, u), ang: lerp(-1.25, angL, u), s: 1, ph: "check", ta, tl }; }
  return { x: ax, y: ay, ang: angL, s: 1 + .1 * Math.sin(Math.PI * clamp((t - tl) / .22)), ph: "lock", ta, tl };
}
function checkRing(ctx, x, y, t, a, color = INK) {
  if (a <= .01) return; ctx.save(); ctx.globalAlpha *= a; ctx.setLineDash([5, 5]); ctx.lineDashOffset = -t * 60; ellipse(ctx, x, y, 34, 34); stroke(ctx, 1.6, color); ctx.restore();
}
function drawBeanTrack(ctx, sp, t, label = true) {
  const p = track(sp, t); if (!p) return p;
  if (p.ph === "lock" || p.ph === "check") { const sx = xAt(sp.slotY); ctx.save(); ctx.globalAlpha *= p.ph === "lock" ? 1 : ap(t, p.ta, .3); line(ctx, [[sx, sp.slotY], [lerp(sx, p.x, .55), sp.slotY + 2], [p.x - sp.side * 14, p.y - 2]], 2, LEAF_D); ctx.restore(); }
  const green = p.ph === "lock" ? clamp((t - p.tl) / .12) : 0;
  bean(ctx, p.x, p.y, p.ang, p.s, { green });
  if (p.ph === "check") checkRing(ctx, p.x, p.y, t, ap(t, p.ta, .1));
  if (p.ph === "lock" && t - p.tl < .3) { const u = (t - p.tl) / .3; ctx.save(); ctx.globalAlpha *= 1 - u; ellipse(ctx, p.x, p.y, 29 + 14 * u, 29 + 14 * u); stroke(ctx, 2, LEAF); ctx.restore(); }
  if (label && (p.ph === "climb" || p.ph === "hop")) txt(ctx, "a" + String(sp.k + 1).padStart(2, "0"), p.x + 24, p.y + 5, { f: MONO, size: 14, a: .8 });
  return p;
}
// beat 4 specials
const S04 = { k: 3, slotY: 590, side: -1, tr: 14.05 }, S04b = { ...S04, tr: 16.35 };
const T04 = (() => { const p = track(S04, 30); return { ta: p.ta, fail: p.ta + .2, td: p.ta + .34, land: p.ta + .84 }; })();
const RA = { k: 7, slotY: 380, side: -1, tr: 15.3 }, RB = { k: 10, slotY: 380, side: 1, tr: 15.25 };
const R_BUMP = Math.max(track(RA, 30).ta, track(RB, 30).ta), R_LOCK = R_BUMP + .7;
const CARD = { t: 17.25, x: 1190, y: 92, w: 360, h: 118 };
function drawRecon(ctx, t) {
  for (const sp of [RA, RB]) {
    const p = track(sp, t); if (!p) continue;
    if (p.ph === "hop" || p.ph === "climb") { bean(ctx, p.x, p.y, p.ang, p.s); txt(ctx, "a" + String(sp.k + 1).padStart(2, "0"), p.x + 24, p.y + 5, { f: MONO, size: 14, a: .8 }); continue; }
    const sx = xAt(380), ta = p.ta; let off, ang;
    if (t < R_BUMP) { const u = eOut((t - ta) / .2); off = sp.side * lerp(0, 10, u); ang = -1.25; }
    else if (t < R_LOCK - .25) { const u = (t - R_BUMP) / (R_LOCK - .25 - R_BUMP); off = sp.side * (10 + 9 * Math.abs(Math.sin(u * Math.PI * 2))); ang = -1.25 + sp.side * .25 * Math.sin(u * Math.PI * 2); }
    else { const u = eOut((t - (R_LOCK - .25)) / .25); off = sp.side * lerp(10, 38, u); ang = lerp(-1.25, sp.side > 0 ? .5 : Math.PI - .5, u); }
    const x = sx + off, y = 380 + (t > R_LOCK - .25 ? 8 * eOut((t - (R_LOCK - .25)) / .25) : 0);
    if (t > R_LOCK - .25) line(ctx, [[sx, 380], [lerp(sx, x, .55), 382], [x - sp.side * 14, y - 2]], 2, LEAF_D);
    const green = clamp((t - R_LOCK) / .12);
    bean(ctx, x, y, ang, 1 + .1 * Math.sin(Math.PI * clamp((t - R_LOCK) / .22)), { green });
    if (t < R_LOCK) checkRing(ctx, sx, 380, t, ap(t, R_BUMP - .1, .2) * .9);
  }
}
function drawSentBack(ctx, t) {
  if (t < S04.tr) return;
  if (t < T04.td) { // first climb + failed check
    const p = track(S04, t); const failed = t > T04.fail;
    bean(ctx, p.x, p.y, p.ang, p.s, { edge: failed ? EMBER : INK });
    if (p.ph === "hop" || p.ph === "climb") txt(ctx, "a04", p.x + 24, p.y + 5, { f: MONO, size: 14, a: .8 });
    if (p.ph === "check") checkRing(ctx, p.x, p.y, t, 1, failed ? EMBER : INK);
    return;
  }
  if (t < S04b.tr) { // dropped back down to a04 (downward = bad), with the reason tag
    const u = clamp((t - T04.td) / (T04.land - T04.td)), sx = xAt(590), x = lerp(sx - 10, AX(3), eOut(u)), y = lerp(590, G - 46, u * u) - (u < 1 ? 0 : 0);
    const settle = t > T04.land ? Math.sin(Math.PI * clamp((t - T04.land) / .18)) * -6 : 0;
    bean(ctx, x, y + settle, -1.25 + 2.4 * eOut(u), 1, { edge: EMBER });
    if (u < 1) { ctx.save(); ctx.globalAlpha *= .5 * (1 - u); line(ctx, [[x + 3, y - 30], [x + 1, y - 60]], 1.2, EMBER); line(ctx, [[x - 8, y - 26], [x - 10, y - 50]], 1.2, EMBER); ctx.restore(); }
    return;
  }
  drawBeanTrack(ctx, S04b, t, true);
}
function drawTag(ctx, t) { // "sent back · reason attached", clipped to a04's bean
  const a = ap(t, T04.land - .05, .3) * (1 - ss(S04b.tr - .1, S04b.tr + .3, t)); if (a <= 0) return;
  const s = "sent back · reason attached", w = tw(ctx, s, ITAL, 32) + 28, x1 = AX(3) - 40, x0 = x1 - w, y0 = G - 98, h = 46;
  ctx.save(); ctx.globalAlpha *= a;
  line(ctx, [[AX(3) - 14, G - 52], [x1, y0 + h / 2]], 1.2, EMBER);
  ctx.fillStyle = PAPER_L; ctx.fillRect(x0, y0, w, h); ctx.strokeStyle = EMBER; ctx.lineWidth = 1.5; ctx.strokeRect(x0 + .5, y0 + .5, w, h);
  ellipse(ctx, x1 - 9, y0 + h / 2, 3, 3); stroke(ctx, 1.2, EMBER);
  txt(ctx, s, x0 + 14, y0 + 32, { f: ITAL, size: 32 });
  txt(ctx, "1", x0 - 36, y0 + 34, { f: SERIF, size: 46 }); line(ctx, [[x0 - 40, y0 + 42], [x0 - 8, y0 + 42]], 1, INK);
  ctx.restore();
}
function drawDecision(ctx, t) {
  const sx = xAt(150), bud = popS(t, CARD.t, .35), bx = sx + 22, by = 146;
  if (bud > 0) { line(ctx, [[sx, 152], [bx - 6, by + 2]], 2, LEAF_D);
    at(ctx, bx, by, bud, -.3, () => { ctx.beginPath(); ctx.moveTo(-6, 0); ctx.quadraticCurveTo(2, -16, 12, 0); ctx.quadraticCurveTo(2, 12, -6, 0); fill(ctx, LEAF_S); stroke(ctx, 1.8, LEAF_D); line(ctx, [[-6, 0], [-1, -6]], 1.4, LEAF_D); line(ctx, [[-6, 0], [-1, 6]], 1.4, LEAF_D); }); }
  const st = clamp((t - CARD.t - .25) / .3);
  if (st > 0) { const x0 = bx + 14, x1 = CARD.x, pts = [[x0, by], [lerp(x0, x1, .5), by - 20], [x1, CARD.y + CARD.h / 2]]; ctx.save(); ctx.setLineDash([]); line(ctx, catmull(pts, false, 6).slice(0, Math.ceil(catmull(pts, false, 6).length * st)), 1.2, INK); ctx.restore(); }
  const ca = clamp((t - CARD.t - .45) / .3);
  if (ca > 0) {
    const { x, y, w, h } = CARD, e = eOut(ca);
    ctx.save(); ctx.globalAlpha *= e; ctx.fillStyle = PAPER_L; ctx.fillRect(x, y + (1 - e) * 10, w, h); ctx.restore();
    ctx.save(); ctx.strokeStyle = INK; ctx.lineWidth = 1.4; ctx.beginPath(); const per = 2 * (w + h), L = per * e, C4 = [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
    let left = L; ctx.moveTo(x, y); for (let i = 1; i < 5 && left > 0; i++) { const a = C4[i - 1], b = C4[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.min(1, left / d); ctx.lineTo(lerp(a[0], b[0], k), lerp(a[1], b[1], k)); left -= d; } ctx.stroke(); ctx.restore();
    txt(ctx, "DECISION · 1", x + 24, y + 38, { f: SANSB, size: 17, track: 3.2, a: ap(t, CARD.t + .6, .3) });
    txt(ctx, "Needs a person.", x + 22, y + 92, { f: ITAL, size: 46, a: ap(t, CARD.t + .68, .35) });
    txt(ctx, "3", x - 46, y + 30, { f: SERIF, size: 46, a: ap(t, CARD.t + .6, .3) }); ctx.save(); ctx.globalAlpha *= ap(t, CARD.t + .6, .3); line(ctx, [[x - 50, y + 38], [x - 18, y + 38]], 1, INK); ctx.restore();
  }
}
// decorative leaves on the lower stalk and locked beans higher up (the whole swarm, together)
const LEAVES = [[812, 1, .2], [600, -1, .5], [462, -1, -.1], [350, 1, .4], [212, -1, 0], [60, 1, .3], [-60, -1, .2]];
const UPPER = []; for (let y = -140, i = 0; y > -2440; y -= 135, i++) { if ([-680, -940, -1200].some((c) => Math.abs(y - c) < 75)) continue; if (y < -1780 && y > -1990) continue; UPPER.push([y, i % 2 ? 1 : -1, i]); }
function drawStalkDress(ctx, t, Lg) {
  for (const [y, side, tw0] of LEAVES) { const s = clamp((Lg - lenAt(y)) / 80); if (s <= 0) continue; const x = xAt(y);
    leaf(ctx, x + side * 4, y, 50, side > 0 ? -.35 + tw0 * .2 : Math.PI + .35 - tw0 * .2, eOut(s)); }
  for (const [y, side, i] of UPPER) { const g = Lg - lenAt(y); if (g <= 0) continue; const s = eOut(clamp(g / 90)), x = xAt(y);
    if (i % 3 === 2) { leaf(ctx, x + side * 4, y, 54, side > 0 ? -.4 : Math.PI + .4, s); continue; }
    line(ctx, [[x, y], [x + side * 18 * s, y + 3]], 2, LEAF_D); bean(ctx, x + side * 38, y + 8, side > 0 ? .55 : Math.PI - .55, s, { green: 1 }); }
}

// ---------- beat 5: proof ----------
const CLAIMS = [{ y: -680, t: 20.0 }, { y: -940, t: 21.6 }, { y: -1200, t: 23.0 }];
function drawClaims(ctx, t) {
  CLAIMS.forEach((c, i) => {
    if (t < c.t - .6) return;
    const sx = xAt(c.y), yc = c.y;
    // a bean rides up the stalk to the join, then a leaf unfurls and the claim lands on it
    if (t < c.t) { const u = eOut((t - (c.t - .6)) / .6), y = lerp(c.y + 360, c.y, u); bean(ctx, xAt(y) + 14 * Math.sin(y / 30), y, -1.25, 1); return; }
    const lf = popS(t, c.t, .4, 1.6), tipx = sx + 150, tipy = yc - 22;
    const pet = catmull([[sx, yc], [sx + 70, yc - 4], [tipx - 34, tipy + 2]], false, 5); line(ctx, pet.slice(0, Math.max(2, Math.ceil(pet.length * clamp((t - c.t) / .25)))), 2.4, LEAF_D);
    bean(ctx, sx + 26, yc + 12, .55, 1, { green: clamp((t - c.t) / .15) });
    leaf(ctx, tipx - 36, tipy + 2, 78, -.16, lf);
    // tick
    const tk = clamp((t - c.t - .55) / .22); if (tk > 0) { const P = [[tipx + 58, tipy - 2], [tipx + 70, tipy + 12], [tipx + 96, tipy - 24]], seg = tk < .4 ? [P[0], [lerp(P[0][0], P[1][0], tk / .4), lerp(P[0][1], P[1][1], tk / .4)]] : [P[0], P[1], [lerp(P[1][0], P[2][0], (tk - .4) / .6), lerp(P[1][1], P[2][1], (tk - .4) / .6)]]; line(ctx, seg, 3.2, LEAF); }
    const x = tipx + 126, a = ap(t, c.t + .2, .5), dy = rise(t, c.t + .2, .5, 22), by = yc + 20 + dy;
    if (i === 0) { const n = Math.max(6, Math.round(9 * eOut(clamp((t - c.t - .2) / .9)))); const big = n < 9 ? `${n}×` : "6–9×";
      txt(ctx, big, x, by + 4, { f: SERIF, size: 150, a });
      runs(ctx, [[" faster ", SERIF, 66], ["per change", ITAL, 66]], x + tw(ctx, big, SERIF, 150), by, a); }
    if (i === 1) { runs(ctx, [["The whole batch lands ", SERIF, 60], ["2–3× sooner", ITAL, 60]], x, by, a);
      txt(ctx, "(than GitHub's merge queue)", x, by + 44, { f: MONO, size: 22, a: a * .8 }); }
    if (i === 2) runs(ctx, [["Every change checked on ", SERIF, 60], ["the exact merged code", ITAL, 60]], x, by, a);
    ctx.save(); ctx.globalAlpha *= .2 * a; line(ctx, [[x, yc + 78], [x + 1040 * eOut(clamp((t - c.t - .3) / .6)), yc + 78]], 1, INK); ctx.restore();
  });
}

// ---------- beat 6: hand-drawn ink clouds ----------
const CLOUDS = [
  { x: 600, y: -1945, w: 400, h: 92, side: -1, seed: 5, back: true }, { x: 1270, y: -1975, w: 440, h: 100, side: 1, seed: 6, back: true }, { x: 1790, y: -2005, w: 300, h: 72, side: 1, seed: 7, back: true },
  { x: 310, y: -1860, w: 580, h: 132, side: -1, seed: 1 }, { x: 1540, y: -1872, w: 660, h: 142, side: 1, seed: 2 }, { x: 1650, y: -2420, w: 260, h: 58, side: 1, seed: 9, back: true, drift: .4 },
].map((c) => ({ ...c, geo: cloudGeo(c) }));
function cloudGeo(c) {
  const r = rng(c.seed * 977 + 13), h = c.h, w = c.w, lobes = [];
  const crownX = (r() - .5) * w * .18;
  lobes.push({ cx: crownX, cy: -h * .5, rr: h * (.6 + .08 * r()) });                                   // the crown
  if (w > 350) lobes.push({ cx: crownX + (r() > .5 ? 1 : -1) * w * .17, cy: -h * .38, rr: h * (.46 + .08 * r()) });
  for (const side of [-1, 1]) {                                                                        // shoulders falling to tails
    let x = crownX + side * h * .5, rr = h * .44;
    while (Math.abs(x) < w * .5 - h * .12) { rr = Math.max(h * .24, rr * (.74 + .2 * r())); x += side * rr * (1.0 + .35 * r()); lobes.push({ cx: x, cy: -rr * (.45 + .2 * r()), rr }); }
  }
  const x0 = Math.min(...lobes.map((l) => l.cx - l.rr)), x1 = Math.max(...lobes.map((l) => l.cx + l.rr)), env = [];
  for (let x = x0; x <= x1; x += 3) { let best = 0, who = -1; lobes.forEach((l, i) => { const dx = x - l.cx; if (Math.abs(dx) >= l.rr) return; const y = l.cy - Math.sqrt(l.rr * l.rr - dx * dx); if (y < best) { best = y; who = i; } }); env.push([x, best, who]); }
  const arcs = [], hooks = []; let cur = [];
  for (let k = 0; k < env.length; k++) { const p = env[k];
    if (cur.length && p[2] !== cur[cur.length - 1][2]) { arcs.push(cur);
      const A = lobes[cur[cur.length - 1][2]], B = lobes[p[2]];
      // the smaller billow carries on inside the bigger one: an inner fold hook from the cusp
      if (A && B) { const small = A.rr < B.rr ? A : B, dir = small === A ? 1 : -1, a0 = Math.atan2(p[1] - small.cy, p[0] - small.cx), pts = [];
        for (let j = 0; j <= 8; j++) { const a = a0 + dir * j / 8 * .75; pts.push([small.cx + Math.cos(a) * small.rr, small.cy + Math.sin(a) * small.rr]); } hooks.push(pts.filter((q) => q[1] < -2)); }
      cur = [cur[cur.length - 1]]; }
    if (p[1] < 0) cur.push(p); }
  if (cur.length) arcs.push(cur);
  return { lobes, env, x0, x1, arcs: arcs.filter((a) => a.length > 3).map((a) => a.map(([x, y]) => [x, y])), hooks: hooks.filter((hk) => hk.length > 2) };
}
function drawCloud(ctx, pen, c, t) {
  const part = c.side * 330 * (1 - ss(25.35, 26.5, t)), x = c.x - part;
  const { env, x0, x1, arcs, hooks } = c.geo;
  at(ctx, x, c.y, 1, 0, () => {
    const P = [...env.map(([px, py]) => [px, Math.min(py, 0)]), [x1, 0], [x0, 0]];
    poly(ctx, P); fill(ctx, PAPER_L);
    ctx.save(); poly(ctx, P); ctx.clip();
    for (let hx = x0 - 40; hx < x1; hx += 6) line(ctx, [[hx, 0], [hx + 14, -c.h * .24]], .8, "rgba(27,37,102,.4)");
    for (let hx = x0 - 40; hx < x1; hx += 11) line(ctx, [[hx, 0], [hx + 7, -c.h * .1]], .8, "rgba(27,37,102,.35)");
    ctx.restore();
    arcs.forEach((a, i) => pen.begin(`cloud${c.seed}/arc${i}`, .62).stroke(a, { w: 2.9, taper: .75, jit: .25, color: INK }));
    hooks.forEach((hk, i) => pen.begin(`cloud${c.seed}/hook${i}`, .62).stroke(hk, { w: 2.2, taper: .9, jit: .2, color: INK }));
    pen.begin(`cloud${c.seed}/base`, .62).stroke([[x0 + 16, -1], [lerp(x0, x1, .3), .6], [lerp(x0, x1, .65), -.6], [x1 - 16, -1]], { w: 1.5, taper: .9, jit: .4, color: INK, alpha: .7 });
  });
}
function tendril(ctx, t) {
  const p = clamp((t - 25.95) / .8); if (p <= 0) return;
  const r0 = 40, pts = []; for (let a = 0; a <= Math.PI * 2.6; a += .08) { const r = r0 * (1 - a / (Math.PI * 3.1)); pts.push([TIP[0] + r0 + r * Math.cos(Math.PI + a), TIP[1] + r * Math.sin(Math.PI + a)]); }
  const n = Math.max(2, Math.ceil(pts.length * eOut(p))), P = pts.slice(0, n);
  taper(ctx, P, 6.5, 1.6, LEAF_D); taper(ctx, P, 4.2, .8, LEAF);
}

// ---------- the frame ----------
let PEN = null;
const PAGE = (t) => t < 5 ? 1 : t < 9 ? 2 : t < 14 ? 3 : t < 19 ? 4 : t < 25 ? 5 : 6;

const CUES = [];
function buildCues() {
  const c = (sfx, t, o = {}) => CUES.push({ sfx, t: +(t - .03).toFixed(3), ...o });
  [[1.9, .3, .9], [2.8, .36, 1.05], [3.6, .42, .92], [4.35, .48, 1.12], [4.95, .55, .86]].forEach(([t, v, p]) => c("creak", t, { vol: v, pitch: p, pan: (p - 1) * 3 }));
  c("snap", SNAP, { vol: .95, pan: .25 }); c("crack", SNAP + .02, { vol: .45, pan: .25 }); c("whoosh", SNAP + .08, { vol: .22, dur: .45, pan: .3 });
  c("thump", LAND, { vol: 1, pan: .3 }); c("crack", LAND + .01, { vol: .35, pitch: .8, pan: .3 }); c("scratch", LAND + .03, { vol: .22, pan: .35 });
  c("click", 6.2, { vol: .2, pitch: .7 }); c("click", 6.9, { vol: .2, pitch: .75 }); c("thump", 7.6, { vol: .65, pitch: .85 });
  c("whoosh", 9.1, { vol: .16, dur: 1.4 });
  B3.forEach((sp, i) => c("lock", track(sp, 30).tl, { vol: .42, pitch: 1 + i * .05, pan: sp.side * .3 }));
  c("tick", T04.fail, { vol: .2, pitch: .6 }); c("fall", T04.td, { vol: .3, pan: -.25 }); c("ping", T04.land, { vol: .4, pitch: .75, pan: -.3 });
  c("lock", track(S04b, 30).tl, { vol: .42, pitch: 1.2, pan: -.3 });
  c("click", R_BUMP + .05, { vol: .28, pitch: 1.1, pan: .1 }); c("lock", R_LOCK, { vol: .42, pitch: 1.35, pan: .1 });
  c("chime", CARD.t + .45, { vol: .42, pan: .35 });
  c("whoosh", 18.98, { vol: .3, dur: .8 }); c("tick", 19.9, { vol: .18 });
  CLAIMS.forEach((cl, i) => { c("ping", cl.t + .55, { vol: .48, pitch: [1, 1.26, 1.5][i] }); c("lock", cl.t, { vol: .3, pitch: 1.3 + i * .15 }); });
  c("riser", 24.25, { vol: .4, dur: 1.2 }); c("whoosh", 25.0, { vol: .3, dur: .9 });
  c("sparkle", 26.25, { vol: .3 }); c("chime", 26.4, { vol: .55 });
}
buildCues();
if (process.argv[2] === "cues") { fs.writeFileSync(path.join(HERE, "cues.json"), JSON.stringify(CUES, null, 1)); console.log("cues", CUES.length); process.exit(0); }

run({
  name: "picture", sheetScale: +(process.env.SC || .3), W, H, fps: FPS, dur: DUR, out: path.join(HERE, "out"), background: PAPER, crf: 16,
  setup(ctx) { PEN = new Pen(ctx); return { paper: paper(W, H, PAPER, .3), finish: filmFinish(W, H, { grain: .07, flicker: 0, vignette: .07 }) }; },
  frame(ctx, t, i, S) {
    ctx.drawImage(S.paper, 0, 0);
    const C = cam(t), Lg = grow(t);
    // blooms (screen space): one sun per frame, ember counter-bloom opposite
    const w1 = 1 - ss(8.6, 9.4, t), w3 = ss(8.6, 9.4, t) * (1 - ss(19, 19.8, t)), w5 = ss(19, 19.8, t) * (1 - ss(25, 25.9, t)), w6 = ss(25, 25.9, t);
    bloom(ctx, 1520, 200, 560, .5 * w1 * (1 - .15 * ss(5, 5.4, t)));
    bloom(ctx, 1470, 250, 640, .8 * w3);
    bloom(ctx, 1000, -1200 + C, 640, .85 * w5);
    bloom(ctx, 1300, 250, 760 * (.85 + .15 * ss(25.6, 27, t)), w6);
    emberBloom(ctx, 150, 1020, 620, 1);
    // shake on the snap and the landing
    const shk = (t > SNAP && t < SNAP + .22 ? 6 * (1 - (t - SNAP) / .22) : 0) + (t > LAND && t < LAND + .2 ? 4 * (1 - (t - LAND) / .2) : 0);
    const sx = shk * Math.sin(t * 173), sy = shk * Math.cos(t * 131);

    ctx.save(); ctx.translate(sx, C + sy);
    // ground + agents (world)
    if (C < 400) {
      const gp = eOut(clamp((t + .2) / .6)); PEN.begin("ground", gp * .615).stroke([[170, G], [700, G + .6], [1240, G - .4], [1750, G]], { w: 2.2, taper: .25, jit: .5, color: INK });
      ctx.save(); ctx.globalAlpha *= .3 * gp; line(ctx, [[200, G + 6], [200 + 1520 * gp, G + 6]], 1, INK); ctx.restore();
      for (let k = 0; k < 12; k++) {
        const jolt = t > LAND && t < LAND + .3 && k >= 8 ? Math.sin(Math.PI * (t - LAND) / .3) * 5 * (k - 7) / 4 : 0;
        const rel = B3.find((b) => b.k === k)?.tr ?? (k === 3 ? S04.tr : k === 7 ? RA.tr : RB.tr), rel2 = k === 3 ? S04b.tr : 99;
        const pulse = Math.max(Math.sin(Math.PI * clamp((t - rel + .15) / .3)), Math.sin(Math.PI * clamp((t - rel2 + .15) / .3)), k >= 0 ? Math.sin(Math.PI * clamp((t - BR[k].t0 + .1) / .3)) : 0);
        agent(ctx, k, popS(t + .12, .04 * k, .35), pulse, jolt);
      }
    }
    drawTree(ctx, t);
    // the far clouds sit behind the stalk, the near ones in front of it
    if (C > 1500) for (const c of CLOUDS) if (c.back) drawCloud(ctx, PEN, c, t);
    drawStalk(ctx, Lg, C);
    drawStalkDress(ctx, t, Lg);
    tendril(ctx, t);
    if (t > 9 && C < 1000) {
      for (const sp of B3) drawBeanTrack(ctx, sp, t);
      drawSentBack(ctx, t); drawRecon(ctx, t); drawDecision(ctx, t);
      drawTag(ctx, t);
      // label 2: reconciled
      const ra = ap(t, R_LOCK + .05, .4); if (ra > 0) { const x = xAt(380) + 92; ctx.save(); ctx.globalAlpha *= ra; line(ctx, [[xAt(380) + 58, 386], [x + 40, 386]], 1, INK); ctx.restore();
        txt(ctx, "2", x + 48, 400, { f: SERIF, size: 46, a: ra }); txt(ctx, "reconciled · only an out-of-date value", x + 84, 396 + rise(t, R_LOCK + .05, .4, 10), { f: ITAL, size: 36, a: ra }); }
      // annotation: checked where it will join
      const na = ap(t, 10.75, .5) * (1 - ss(13.9, 14.3, t));
      if (na > 0) { const r0 = rise(t, 10.75, .5, 14); txt(ctx, "Each bean is checked", 170, 512 + r0, { f: ITAL, size: 46, a: na }); txt(ctx, "where it will join.", 170, 564 + r0, { f: ITAL, size: 46, a: na });
        ctx.save(); ctx.globalAlpha *= na * .8; line(ctx, [[560, 548], [895, 676]], 1, INK); ctx.restore(); }
    }
    if (t > 19.4) drawClaims(ctx, t);
    if (C > 1500) for (const c of CLOUDS) if (!c.back) drawCloud(ctx, PEN, c, t);
    ctx.restore();

    // ----- screen-space type -----
    const a1 = 1 - ss(4.95, 5.3, t);
    txt(ctx, "FIG. 1", 130, 112, { f: SANSB, size: 17, track: 3.2, a: ap(t, .2, .4) * a1 });
    txt(ctx, "The git tree.", 128, 178 + rise(t, .3), { f: ITAL, size: 78, a: ap(t, .3) * a1 });
    txt(ctx, "Every agent grows its own branch.", 130, 246 + rise(t, 1.3), { f: SERIF, size: 42, a: ap(t, 1.3) * a1 });
    txt(ctx, "12 AGENTS · 12 BRANCHES", 1790, 112, { f: MONO, size: 16, track: 2, a: ap(t, .6, .4) * a1 * .85, align: "right" });
    const a2 = 1 - ss(8.7, 9.2, t);
    txt(ctx, "More agents,", 126, 170 + rise(t, 6.2, .35, 24), { f: SERIF, size: 88, a: ap(t, 6.2, .35) * a2 });
    txt(ctx, "more branches,", 126, 262 + rise(t, 6.9, .35, 24), { f: SERIF, size: 88, a: ap(t, 6.9, .35) * a2 });
    txt(ctx, "more breakage.", 126, 354 + rise(t, 7.6, .3, 24), { f: ITAL, size: 88, a: ap(t, 7.6, .3) * a2 });
    const a3 = ap(t, 9.3, .45) * (1 - ss(18.8, 19.1, t));
    txt(ctx, "FIG. 2", 130, 112, { f: SANSB, size: 17, track: 3.2, a: a3 });
    txt(ctx, "The beanstalk.", 128, 178 + rise(t, 9.35), { f: ITAL, size: 78, a: a3 });
    if (a3 > 0) { txt(ctx, "Gitstalk", 1790, 116, { f: SERIF, size: 38, a: a3, align: "right" });
      bean(ctx, 1600, 146, 0, .45, { green: 1, a: a3 }); txt(ctx, "LOCKED IN GREEN", 1790, 152, { f: SANSB, size: 13, track: 2.4, a: a3, align: "right" });
      bean(ctx, 1600, 172, 0, .45, { a: a3 }); txt(ctx, "CLIMBING", 1790, 178, { f: SANSB, size: 13, track: 2.4, a: a3, align: "right" }); }
    const a5 = ap(t, 19.85, .4) * (1 - ss(24.9, 25.25, t));
    if (a5 > 0) { txt(ctx, "Real fastify repo · 16 agents · vs GitHub's real merge queue", 600, 96, { f: MONO, size: 21, track: .6, a: a5 });
      ctx.save(); ctx.globalAlpha *= a5; line(ctx, [[600, 116], [600 + 1190 * eOut(clamp((t - 19.9) / .5)), 116]], 1.2, INK); ctx.restore(); }
    // lockup
    const wa = ap(t, 25.95, .5);
    txt(ctx, "Gitstalk.", 120, 470 + rise(t, 25.95, .5, 24), { f: SERIF, size: 236, a: wa });
    txt(ctx, "Agents grow together.", 130, 572 + rise(t, 26.85, .5, 16), { f: ITAL, size: 66, a: ap(t, 26.85) });
    txt(ctx, "BUILT ON CLOUDFLARE WORKERS + ARTIFACTS", 130, 1010, { f: SANSB, size: 17, track: 3.4, a: ap(t, 27.35, .45) });
    // pagenum, the one persistent chrome
    txt(ctx, `0${PAGE(t)} / 06`, 1790, 1010, { f: MONO, size: 15, track: 1.2, a: .75, align: "right" });
    S.finish(ctx, i);
  },
});
