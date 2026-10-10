// bed.mjs — the film's music, synthesised in code (adapted from the claude-animation skill's music.mjs:
// Karplus-Strong plucks + bell partials). Warm pizzicato + marimba at 100 BPM.
//   0.0-5.28  tension: A minor pizzicato ostinato, rising drone; hard cut at the snap
//   5.3-8.6   silence (the snap and the words carry it); 8.4-9.0 a soft swell back in
//   9.0-18.6  warm: C  G  Am  F, pizz bass, marimba arpeggios, shaker from 11.4
//   18.6-25.8 build: C Am F G, 16th marimba, kick, rising pad; 25.8-26.4 held G (the riser sits here)
//   26.4-30   resolve: C major, marimba roll, bell, ring out
//   node bed.mjs bed.wav
import fs from "node:fs";
const SR = 44100, DUR = 30, N = SR * DUR, L = new Float32Array(N), R = new Float32Array(N);
const BEAT = .6, hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const add = (i, l, r) => { if (i >= 0 && i < N) { L[i] += l; R[i] += r; } };
let seedG = 7; const rnd = () => (seedG = (seedG * 16807) % 2147483647) / 2147483647 * 2 - 1;

function pizz(t, m, amp, pan = 0, decay = .993, len = .55) {          // plucked string, short and woody
  const P = Math.max(2, Math.round(SR / hz(m))), ring = new Float32Array(P); for (let k = 0; k < P; k++) ring[k] = rnd();
  let lp = 0; const s0 = Math.round(t * SR), n = Math.round(SR * len);
  for (let i = 0, idx = 0; i < n; i++) { const a = ring[idx], b = ring[(idx + 1) % P]; ring[idx] = decay * .5 * (a + b);
    lp += .45 * (a - lp); const e = Math.min(1, i / 30) * (i > n - 800 ? (n - i) / 800 : 1);
    add(s0 + i, lp * amp * e * (1 - pan) * .5, lp * amp * e * (1 + pan) * .5); idx = (idx + 1) % P; }
}
function marimba(t, m, amp, pan = 0, len = 1.1) {
  const f = hz(m), s0 = Math.round(t * SR), n = Math.round(SR * len);
  for (let i = 0; i < n; i++) { const s = i / SR, e = Math.exp(-s * 4.2) * Math.min(1, i / 90);
    const v = (Math.sin(2 * Math.PI * f * s) + .28 * Math.sin(2 * Math.PI * f * 4 * s) * Math.exp(-s * 22) + .08 * Math.sin(2 * Math.PI * f * 9.9 * s) * Math.exp(-s * 40)) * e * amp;
    add(s0 + i, v * (1 - pan) * .5, v * (1 + pan) * .5); }
}
function pad(t0, t1, chord, amp, att = .4, rel = .5) {
  const a = Math.round(t0 * SR), b = Math.min(N, Math.round(t1 * SR));
  for (let i = a; i < b; i++) { const s = i / SR, e = Math.min(1, (s - t0) / att, (t1 - s) / rel) * (typeof amp === "function" ? amp(s) : amp);
    let v = 0; chord.forEach((m, k) => { v += Math.sin(2 * Math.PI * hz(m) * s * (1 + (k % 2 ? .0015 : -.0015))) + .3 * Math.sin(4 * Math.PI * hz(m) * s); });
    add(i, v * e * .12 * (1 + .1 * Math.sin(s * 5)), v * e * .12 * (1 - .1 * Math.sin(s * 5))); }
}
function shaker(t, amp) { const s0 = Math.round(t * SR), n = Math.round(SR * .06); let prev = 0;
  for (let i = 0; i < n; i++) { const w = rnd(), hp = w - prev; prev = w; const e = Math.sin(Math.PI * i / n) ** 2; add(s0 + i, hp * e * amp * .4, hp * e * amp * .5); } }
function kick(t, amp) { const s0 = Math.round(t * SR), n = Math.round(SR * .25); let ph = 0;
  for (let i = 0; i < n; i++) { const s = i / SR; ph += 2 * Math.PI * (48 + 60 * Math.exp(-s * 30)) / SR; const v = Math.sin(ph) * Math.exp(-s * 12) * amp; add(s0 + i, v, v); } }

// ---- A: tension (0 - 5.28), A minor, crescendo; hard cut at the snap
const CUT = 5.28;
const A_CH = [[45, 57, 60, 64], [41, 57, 60, 65], [38, 57, 62, 65]];       // Am, F/A-ish, Dm
for (let e = 0; e * BEAT / 2 < CUT; e++) {
  const t = e * BEAT / 2, bar = Math.floor(t / 2.4), ch = A_CH[bar % 3], g = .45 + .55 * (t / CUT);
  if (e % 2 === 0) pizz(t, ch[0], .55 * g, -.1, .995, .5);
  pizz(t, ch[1 + (e % 3)] + (e % 4 === 3 ? 12 : 0), .3 * g, .25 * ((e % 3) - 1), .992, .35);
  if (e % 4 === 2) marimba(t, ch[3] + 12, .07 * g, .3, .5);
}
pad(0, CUT + .02, [33, 45, 52], (s) => .25 + .55 * (s / CUT), 1.2, .02);
pad(2.4, CUT + .02, [57, 60, 63.0], (s) => .25 * ((s - 2.4) / 3), 1.5, .02);   // a rising minor-6 rub for unease
for (let i = Math.round(CUT * SR); i < Math.round(8.4 * SR); i++) { L[i] = 0; R[i] = 0; }                   // the cut

// ---- swell back in (8.4 - 9.0)
pad(8.4, 9.3, [48, 55, 60, 64], (s) => .5 * ((s - 8.4) / .9) ** 2, .5, .3);

// ---- B: warm (9.0 - 18.6) and C: build (18.6 - 25.8), grid from 9.0
const PROG = [[9.0, [48, 52, 55, 60]], [11.4, [47, 50, 55, 59]], [13.8, [45, 48, 52, 57]], [16.2, [41, 48, 53, 57]],
  [18.6, [48, 52, 55, 60]], [21.0, [45, 48, 52, 57]], [23.4, [41, 48, 53, 57]], [24.6, [43, 50, 55, 59]]];
const chordAt = (t) => { let c = PROG[0][1]; for (const [t0, ch] of PROG) if (t >= t0) c = ch; return c; };
const build = (t) => t < 18.6 ? 0 : Math.min(1, (t - 18.6) / 7.2);
for (let e = 0; 9.0 + e * BEAT / 2 < 25.8 - .01; e++) {
  const t = 9.0 + e * BEAT / 2, ch = chordAt(t), b = build(t), beat = e % 8;
  if (beat === 0 || beat === 4) pizz(t, ch[0] - 12 + 12 * (t < 11.4 ? 0 : 0), .6, -.05, .996, .6);
  if (beat === 3 || beat === 7) pizz(t, ch[0] - 5, .35 + .2 * b, -.05, .995, .4);
  if (b > 0 && beat % 2 === 1) pizz(t, ch[0] - 12, .3 * b, 0, .995, .35);
  const arp = [ch[1] + 12, ch[2] + 12, ch[3] + 12, ch[2] + 12, ch[1] + 24, ch[3] + 12, ch[2] + 12, ch[3] + 12];
  marimba(t, arp[beat], .11 + .05 * b, (beat % 2 ? .3 : -.3));
  if (b > .15) marimba(t + BEAT / 4, arp[(beat + 3) % 8] + 12, .05 * b, .45);
  if (t >= 11.4) shaker(t, beat % 2 ? .14 + .1 * b : .07);
  if (t >= 11.4 && beat % 2 === 0) shaker(t + BEAT / 4, .05 + .08 * b);
  if (b > 0 && beat % 2 === 0) kick(t, .35 + .35 * b);
  if (beat === 0 && t < 18.6) pizz(t + .01, ch[3] + 12, .25, .35, .992, .4);
}
for (const [t0, ch] of PROG) { const t1 = PROG.find(([u]) => u > t0)?.[0] ?? 25.8; pad(t0, t1 + .05, ch.slice(1), (s) => .18 + .5 * build(s), .3, .2); }
// held dominant under the riser, marimba tremolo crescendo
pad(25.8, 26.45, [43, 50, 55, 59, 62], (s) => .7, .05, .05);
for (let k = 0; 25.8 + k * .06 < 26.38; k++) marimba(25.8 + k * .06, k % 2 ? 74 : 79, .03 + .07 * (k / 10), k % 2 ? .3 : -.3, .3);

// ---- D: resolve on the logo (26.4)
const RES = 26.4;
[36, 48, 55, 60, 64, 67].forEach((m, k) => pizz(RES + k * .012, m, .5, (k - 2.5) * .12, .997, 1.4));
kick(RES, .7);
[72, 76, 79, 84].forEach((m, k) => marimba(RES + k * .09, m, .16, (k - 1.5) * .25, 1.8));
for (let k = 0; k < 14; k++) marimba(RES + .4 + k * .07, k % 2 ? 79 : 84, .05 * (1 - k / 14), k % 2 ? .35 : -.35, .5);
pad(RES, 29.8, [48, 55, 60, 64, 67], (s) => .65 * Math.exp(-(s - RES) * .45), .05, 1.2);
marimba(27.6, 79, .1, .2, 1.6); marimba(28.2, 84, .09, -.2, 1.8);

// normalise to -1 dBFS, soft clip, 16-bit WAV
let pk = 0; for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
const g = .89 / pk, buf = Buffer.alloc(44 + N * 4);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { const f = i > N - SR * .6 ? (N - i) / (SR * .6) : 1;
  buf.writeInt16LE(Math.round(Math.tanh(L[i] * g) * f * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(Math.tanh(R[i] * g) * f * 32767), 46 + i * 4); }
fs.writeFileSync(process.argv[2] || "bed.wav", buf);
console.log("bed", DUR, "s, gain", g.toFixed(2));
