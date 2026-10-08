// The merge-queue section: trunk and stalk, side by side, forever.
// Eight agents write work in two worlds. On the left, green pull requests wait at a gated merge
// queue; when a merge moves main, pull requests that now conflict with it leave the line and go back
// to their agents to rebase. On the right, each passing bean blooms into a sprout at the
// tip and its update pulses out to every bean at once; a failed stalk check sends back only the
// culprit; clashes reconcile, and only a real disagreement reaches a person.
// Both worlds are seeded simulations stepped in fixed ticks, and every frame is drawn from their
// logs, so a frame is a pure function of time. The clock runs only while the section is on screen
// and the tab is visible. `?t=<ms>` freezes it (for screenshots); reduced motion shows one still
// frame per moment.
const section = document.querySelector('[data-mq]');
const canvas = section?.querySelector('canvas');
const ctx = canvas?.getContext('2d');
const params = new URLSearchParams(location.search);
const frozen = params.has('t') ? Number(params.get('t')) / 1000 : null;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || params.has('still');

/* ---------- Maths ---------- */
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const seg = (t, a, b) => clamp((t - a) / (b - a));
const ease = {
  out: (k) => 1 - (1 - k) ** 3,
  in: (k) => k * k * k,
  io: (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2),
  back: (k) => 1 + 2.7 * (k - 1) ** 3 + 1.7 * (k - 1) ** 2,
};
const step = (t, a, d = 0.5, e = ease.io) => e(seg(t, a, a + d));
const win = (t, a, b, r = 0.3) => Math.min(step(t, a, r, ease.out), 1 - step(t, b - r, r, ease.in));
const qb = (p0, p1, p2, k) => {
  const m = 1 - k;
  return [
    m * m * p0[0] + 2 * m * k * p1[0] + k * k * p2[0],
    m * m * p0[1] + 2 * m * k * p1[1] + k * k * p2[1],
  ];
};
const cb = (p0, p1, p2, p3, k) => {
  const m = 1 - k;
  const a = m * m * m;
  const b = 3 * m * m * k;
  const c = 3 * m * k * k;
  const d = k * k * k;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
};
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
/** Last entry of a time-sorted log at or before t. */
function at(log, t) {
  let lo = 0;
  let hi = log.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (log[mid][0] <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/* ---------- The scene's cast and timing ---------- */
const W = 600;
const H = 600;
const ACT = 12;
const CYCLE = 3 * ACT;
const TICK = 0.05;
const CHECK = 1.4;
const AGENTS = [
  [52, 200],
  [52, 290],
  [52, 380],
  [52, 470],
  [548, 200],
  [548, 290],
  [548, 380],
  [548, 470],
].map(([x, y], i) => {
  const side = x < W / 2 ? -1 : 1;
  return { i, id: `a${i}`, x, y, side, bx: x - side * 50 };
});
const PERSON = { x: 60, y: 556 };

function setMode(ag, mode, t) {
  ag.mode = mode;
  ag.log.push([t, mode]);
}
function setBase(ag, t, to, dur = 0) {
  const cur = baseAt(ag.base, t);
  ag.base.push([t, cur, to, dur]);
}
const busy = (ag) => ag.mode === 'writing' || ag.mode === 'checking';

/* =====================================================================
 * World 1: a GitHub-style merge queue
 * ===================================================================== */
const GATE_TEST = 3.0;
const BATCH = 4;
const REBASE = 2.4;
const REWORK = 3.0;
const CONFLICT = 0.1; // chance a queued pull request conflicts with what just merged
const BUILDS_ON = 0.7; // chance an agent's next task builds on its last one

function makeQueue() {
  const rnd = seeded(77);
  const work = AGENTS.map((a) => seeded(1000 + a.i));
  const s = {
    t: -30,
    main: 0,
    merges: [], // [t, n]
    shipped: [[-99, 0]],
    queue: [],
    gate: null,
    cooldown: -99,
    batches: [],
    sweeps: [],
    prs: new Map(),
    num: 30,
    agents: AGENTS.map((a) => ({
      a,
      mode: 'writing',
      until: -30 + 1 + work[a.i]() * 4,
      paused: null,
      pending: [],
      dep: null,
      nextDep: null,
      log: [[-99, 'writing']],
      base: [[-99, 0, 0, 0]], // [t, from, to, dur]
      bad: false,
    })),
    focus: [],
  };
  const writeTime = (ag) => 3.4 + work[ag.a.i]() * 2.4;
  const logIdx = (t) => {
    s.queue.forEach((pr, i) => {
      const last = pr.idx[pr.idx.length - 1];
      if (!last || last[1] !== i) pr.idx.push([t, i]);
    });
  };
  const join = (pr, t, head = false) => {
    if (head) s.queue.unshift(pr);
    else s.queue.push(pr);
    pr.joined = t;
    logIdx(t);
  };
  const leave = (pr, t) => {
    s.queue = s.queue.filter((p) => p !== pr);
    logIdx(t);
  };
  function startWriting(ag, t) {
    setMode(ag, 'writing', t);
    ag.until = t + writeTime(ag);
    setBase(ag, t, s.main);
  }
  function pass(ag, t) {
    const pr = {
      id: s.num,
      num: s.num++,
      agent: ag.a.i,
      bad: ag.bad,
      idx: [],
      track: [[t, 'fly']],
      conflict: false,
    };
    ag.bad = false;
    for (const other of s.agents) {
      if (other.depOn && other.depOn.x === ag && !other.depOn.pr) other.depOn.pr = pr;
    }
    s.prs.set(pr.id, pr);
    ag.lastPr = pr;
    join(pr, t);
    setMode(ag, 'sent', t);
    afterPass(ag, t + 0.35);
  }
  function afterPass(ag, t) {
    if (ag.pending.length) return handlePending(ag, t);
    if (ag.nextDep && ag.nextDep.merged === undefined) {
      ag.dep = ag.nextDep;
      ag.nextDep = null;
      setMode(ag, 'waiting', t);
      ag.until = Infinity;
      return;
    }
    ag.nextDep = null;
    // much of the next task builds on this one, which nobody can use until it merges
    const own = ag.lastPr;
    if (own && own.merged === undefined && rnd() < BUILDS_ON) {
      ag.dep = own;
      ag.depOn = { x: ag, pr: own };
      setMode(ag, 'waiting', t);
      ag.until = Infinity;
      return;
    }
    ag.until = t;
    ag.mode = 'start';
  }
  function handlePending(ag, t) {
    const job = ag.pending.shift();
    if (ag.mode === 'writing' || ag.mode === 'waiting') {
      ag.paused = { mode: ag.mode, left: ag.until - t };
    }
    ag.job = job;
    setMode(ag, job.kind, t);
    ag.until = t + (job.kind === 'rebase' ? REBASE : REWORK);
    if (job.kind === 'rebase') setBase(ag, t, s.main, REBASE);
  }
  function finishJob(ag, t) {
    const pr = ag.job.pr;
    ag.job = null;
    if (ag.job === null) pr.bad = false;
    pr.conflict = false;
    pr.track.push([t, 'fly']);
    join(pr, t);
    if (ag.pending.length) return handlePending(ag, t);
    const p = ag.paused;
    ag.paused = null;
    if (!p) {
      afterPass(ag, t);
      return;
    }
    if (p.mode === 'waiting') {
      setMode(ag, 'waiting', t);
      ag.until = Infinity;
    } else {
      setMode(ag, 'writing', t);
      ag.until = t + Math.max(0.4, p.left);
    }
  }

  function tickAgents(t) {
    for (const ag of s.agents) {
      if (
        ag.mode === 'waiting' &&
        ag.dep &&
        ag.dep.merged !== undefined &&
        t >= ag.dep.merged + 0.4
      ) {
        ag.dep = null;
        if (ag.pending.length) handlePending(ag, t);
        else startWriting(ag, t);
        continue;
      }
      if (
        ag.pending.length &&
        ag.pending[0].ready <= t &&
        (ag.mode === 'writing' || ag.mode === 'waiting')
      ) {
        handlePending(ag, t);
        continue;
      }
      if (t < ag.until) continue;
      switch (ag.mode) {
        case 'start':
          startWriting(ag, t);
          break;
        case 'writing':
          setMode(ag, 'checking', t);
          ag.until = t + CHECK;
          break;
        case 'checking':
          pass(ag, t);
          break;
        case 'rebase':
        case 'rework':
          setMode(ag, ag.mode === 'rebase' ? 'rebaseCheck' : 'reworkCheck', t);
          ag.until = t + CHECK;
          break;
        case 'rebaseCheck':
        case 'reworkCheck':
          finishJob(ag, t);
          break;
        default:
          break;
      }
    }
  }

  function tickGate(t) {
    const g = s.gate;
    if (g && t >= g.t1) {
      s.gate = null;
      g.ok = !g.prs.some((p) => p.bad);
      if (g.ok) {
        s.main += g.prs.length;
        s.merges.push([t, g.prs.length]);
        const total = s.shipped[s.shipped.length - 1][1] + g.prs.length;
        s.shipped.push([t + 0.6, total]);
        for (const pr of g.prs) {
          pr.merged = t;
          pr.track.push([t, 'merge', g]);
        }
        // main moved: pull requests that now conflict with it leave the line
        const sweep = { t: t + 0.5, n: s.queue.length, kicks: [] };
        s.sweeps.push(sweep);
        s.queue.forEach((pr, i) => {
          const at2 = sweep.t + i * 0.16;
          const forced = !pr.bad && s.forceConflict > 0 && t - s.forceAt < 9;
          if (forced) s.forceConflict--;
          if (!pr.bad && (forced || pr.conflict || rnd() < CONFLICT)) {
            pr.kickAt = at2 + 0.9;
            sweep.kicks.push(pr);
          }
        });
        s.cooldown = t + 0.4;
      } else {
        // one red fails the batch: every pull request in it goes back to the line
        const culprit = g.prs.find((p) => p.bad);
        g.prs.toReversed().forEach((pr) => {
          if (pr === culprit) {
            pr.track.push([t, 'home', g]);
            s.agents[pr.agent].pending.push({ kind: 'rework', pr, ready: t + 0.9 });
          } else {
            pr.track.push([t, 'rejected', g]);
            join(pr, t, true);
            pr.rejected = t;
          }
        });
        s.cooldown = t + 1.5;
      }
    }
    // conflicts found by the re-test leave the line for their agents to rebase
    for (const pr of s.queue.slice()) {
      if (pr.kickAt !== undefined && t >= pr.kickAt) {
        pr.kickAt = undefined;
        leave(pr, t);
        pr.track.push([t, 'kick']);
        s.agents[pr.agent].pending.push({ kind: 'rebase', pr, ready: t + 0.8 });
      }
    }
    if (!s.gate && t >= s.cooldown) {
      const ready = s.queue.filter((p) => t - p.joined >= 0.9 && p.kickAt === undefined);
      if (ready.length) {
        const prs = ready.slice(0, BATCH);
        const retest = prs.some((p) => p.rejected !== undefined && t - p.rejected < 4);
        const b = { t0: t, t1: t + GATE_TEST, prs, ok: !prs.some((p) => p.bad), retest };
        for (const pr of prs) {
          leave(pr, t);
          pr.track.push([t, 'gate', b]);
          pr.batch = b;
        }
        s.batches.push(b);
        s.gate = b;
      }
    }
  }

  s.run = (until) => {
    while (s.t < until) {
      s.t += TICK;
      const t = s.t;
      inject(s, 'gh', t);
      tickAgents(t);
      tickGate(t);
    }
  };
  s.startWriting = startWriting;
  return s;
}
/** Branch base (as a count of commits on main) at time t, eased during a rebase. */
function baseAt(log, t) {
  const i = at(log, t);
  if (i < 0) return 0;
  const [t0, from, to, dur] = log[i];
  return dur > 0 ? lerp(from, to, ease.io(seg(t, t0 + 0.3, t0 + dur - 0.2))) : to;
}

/* =====================================================================
 * World 2: Beanstalk
 * ===================================================================== */
const STALK_TEST = 2.4;
const FLY = 0.5;

function makeStalk() {
  const work = AGENTS.map((a) => seeded(1000 + a.i));
  const s = {
    t: -30,
    nodes: [],
    pops: [],
    checks: [],
    check: null,
    flights: [],
    clashes: [],
    decisions: [],
    shipped: [[-99, 0]],
    agents: AGENTS.map((a) => ({
      a,
      mode: 'writing',
      until: -30 + 1 + work[a.i]() * 4,
      paused: null,
      log: [[-99, 'writing']],
      nextDep: null,
      dep: null,
      bad: false,
      clash: null,
    })),
    focus: [],
    seq: 0,
  };
  // Seed the stalk with a mature history.
  for (let i = 0; i < 26; i++) {
    s.nodes.push({ id: s.seq++, agent: -1, tb: -60 + i, tm: -59.5 + i, side: i % 2 ? 1 : -1 });
  }
  const writeTime = (ag) => 3.4 + work[ag.a.i]() * 2.4;
  function bloom(agentIdx, tb, extra = {}) {
    const n = { id: s.seq++, agent: agentIdx, tb, side: s.seq % 2 ? 1 : -1, ...extra };
    let i = s.nodes.length;
    while (i > 0 && s.nodes[i - 1].tb > tb) i--;
    s.nodes.splice(i, 0, n);
    return n;
  }
  function startWriting(ag, t) {
    setMode(ag, 'writing', t);
    ag.until = t + writeTime(ag);
  }
  function pass(ag, t) {
    const c = ag.clash;
    ag.clash = null;
    if (c && c.kind === 'real' && c.role === 'second') {
      // the pair meets, and goes to a person as one card
      const d = { t0: t, a: c.mate.a.i, b: ag.a.i, t1: t + 3.0 };
      s.decisions.push(d);
      setMode(ag, 'sent', t);
      ag.until = t + 0.35;
      ag.mode = 'start';
      const n = bloom(d.a, d.t1 + FLY, { decided: d });
      ag.lastNode = n;
      // the other side goes back to its author
      s.agents[d.b].pendingRework = d.t1 + 0.8;
      return;
    }
    if (c && c.kind === 'real') {
      setMode(ag, 'sent', t);
      ag.until = t + 0.35;
      ag.mode = 'start';
      return;
    }
    const delay = c ? 0.45 : 0;
    s.flights.push({ agent: ag.a.i, t0: t, t1: t + FLY + delay, clash: c });
    const n = bloom(ag.a.i, t + FLY + delay, { bad: ag.bad });
    if (c && c.role === 'second') s.clashes.push({ t: t + FLY - 0.05, at: n });
    ag.bad = false;
    ag.lastNode = n;
    setMode(ag, 'sent', t);
    ag.until = t + 0.35;
    if (ag.nextDep) {
      ag.dep = ag.nextDep;
      ag.nextDep = null;
      ag.mode = 'waitNext';
    } else ag.mode = 'start';
  }
  function tickAgents(t) {
    for (const ag of s.agents) {
      if (ag.pendingRework !== undefined && t >= ag.pendingRework && ag.mode === 'writing') {
        ag.paused = { left: ag.until - t };
        ag.pendingRework = undefined;
        setMode(ag, 'rework', t);
        ag.until = t + REWORK;
        continue;
      }
      if (ag.mode === 'waiting') {
        const n = ag.dep.node;
        if (n && t >= n.tb + travel(ag.a)) {
          ag.dep = null;
          startWriting(ag, t);
        }
        continue;
      }
      if (t < ag.until) continue;
      switch (ag.mode) {
        case 'start':
          startWriting(ag, t);
          break;
        case 'waitNext':
          setMode(ag, 'waiting', t);
          break;
        case 'writing':
          setMode(ag, 'checking', t);
          ag.until = t + CHECK;
          break;
        case 'checking':
          pass(ag, t);
          break;
        case 'rework':
          setMode(ag, 'reworkCheck', t);
          ag.until = t + CHECK;
          break;
        case 'reworkCheck': {
          s.flights.push({ agent: ag.a.i, t0: t, t1: t + FLY });
          bloom(ag.a.i, t + FLY);
          const p = ag.paused;
          ag.paused = null;
          setMode(ag, 'writing', t);
          ag.until = t + Math.max(0.6, p ? p.left : writeTime(ag));
          break;
        }
        default:
          break;
      }
    }
  }
  function tickChecks(t) {
    const c = s.check;
    if (c && t >= c.t1) {
      s.check = null;
      const culprit = c.nodes.find((n) => n.bad);
      let total = s.shipped[s.shipped.length - 1][1];
      c.nodes.forEach((n, j) => {
        if (n === culprit) {
          n.tred = t;
          n.tpop = t + 0.4;
          s.pops.push(n);
          const ag = s.agents[n.agent];
          ag.pendingRework = t + 1.5;
          ag.home = { t0: n.tpop, t1: t + 1.5, node: n };
        } else {
          n.tm = t + (culprit ? 0.6 : 0) + j * 0.06;
          total++;
        }
      });
      s.shipped.push([t + (culprit ? 0.6 : 0), total]);
    }
    if (!s.check) {
      const ready = s.nodes.filter(
        (n) => n.tb <= t && n.tm === undefined && n.tred === undefined && !n.inCheck,
      );
      if (ready.length) {
        ready.forEach((n) => (n.inCheck = true));
        s.check = { t0: t, t1: t + STALK_TEST, nodes: ready, culprit: ready.find((n) => n.bad) };
        s.checks.push(s.check);
      }
    }
  }
  s.run = (until) => {
    while (s.t < until) {
      s.t += TICK;
      const t = s.t;
      inject(s, 'bs', t);
      tickAgents(t);
      tickChecks(t);
    }
  };
  return s;
}
/** Seconds for a sprout's update to reach an agent's bean. */
const travel = (a) => 0.28 + Math.hypot(a.bx - 300, a.y - TIPY) / 900;

/* =====================================================================
 * The three moments, injected into both worlds once per cycle
 * ===================================================================== */
function soonest(s, pred, after = 0) {
  let best = null;
  for (const ag of s.agents) {
    if (!pred(ag)) continue;
    const p = ag.mode === 'writing' ? ag.until + CHECK : ag.until;
    if (p < s.t + after) continue;
    if (!best || p < best.p) best = { ag, p };
  }
  return best;
}
function inject(s, world, t) {
  const cyc = Math.floor(t / CYCLE);
  const u = t - cyc * CYCLE;
  const once = (key, fn) => {
    const k = `${cyc}:${key}`;
    if (s.done?.has(k)) return;
    s.done = s.done ?? new Set();
    s.done.add(k);
    fn();
  };
  if (u >= 0.2 && u < 1) {
    once('dep', () => {
      // Y passes first; its next task needs X's work, which passes a little later
      const y = soonest(s, busy, 0.3);
      if (!y) return;
      const x = soonest(s, (ag) => busy(ag) && ag !== y.ag, y.p - s.t + 1.2);
      if (!x) return;
      if (x.p > y.p + 3.5 && x.ag.mode === 'writing') x.ag.until = y.p + 2.2 - CHECK;
      const dep = { agentX: x.ag.a.i, agentY: y.ag.a.i };
      if (world === 'gh') {
        const prev = x.ag.lastPr;
        y.ag.nextDep = {
          get merged() {
            const p = x.ag.lastPr;
            return p === prev ? undefined : p?.merged;
          },
        };
        y.ag.depOn = { x: x.ag, pr: null };
      } else {
        dep.node = null;
        const prev = x.ag.lastNode;
        const watch = {};
        Object.defineProperty(watch, 'node', {
          get: () => (x.ag.lastNode !== prev ? x.ag.lastNode : null),
        });
        y.ag.nextDep = watch;
      }
      s.focus.push({ act: 0, t, ...dep });
    });
  }
  if (u >= ACT + 0.2 && u < ACT + 1) {
    once('bad', () => {
      if (world === 'gh') {
        const g = s.gate && s.gate.t1 - t > 1.2 ? s.gate.prs : null;
        const pr = g ? g[g.length - 1] : s.queue[Math.min(1, s.queue.length - 1)];
        if (pr) pr.bad = true;
        else {
          const y = soonest(s, busy, 0.3);
          if (y) y.ag.bad = true;
        }
      } else {
        const y = soonest(s, (ag) => ag.mode === 'writing', 0.5);
        if (y) {
          y.ag.bad = true;
          y.ag.until = Math.min(y.ag.until, t + 0.6);
        }
      }
      s.focus.push({ act: 1, t });
    });
  }
  if (u >= 2 * ACT + 0.2 && u < 2 * ACT + 1) {
    once('clash', () => {
      if (world === 'gh') {
        // the last two in line will conflict with whatever merges next
        s.forceConflict = 2;
        s.forceAt = t;
        s.focus.push({ act: 2, t });
        return;
      }
      // two clashes that reconcile, then one real disagreement
      [
        [0.4, 'easy'],
        [3.8, 'easy'],
        [5.2, 'real'],
      ].forEach(([dt, kind]) => {
        s.pendingClashes = s.pendingClashes ?? [];
        s.pendingClashes.push({ at: t + dt, kind });
      });
      s.focus.push({ act: 2, t });
    });
  }
  if (world === 'bs' && s.pendingClashes?.length && t >= s.pendingClashes[0].at) {
    const c = s.pendingClashes.shift();
    const free = s.agents.filter((ag) => ag.mode === 'writing' && !ag.clash && !ag.nextDep);
    free.sort((p, q) => p.until - q.until);
    const [a, b] = free;
    if (a && b) {
      a.until = t + 0.6;
      b.until = t + 0.75;
      a.clash = { kind: c.kind, role: 'first' };
      b.clash = { kind: c.kind, role: 'second', mate: a };
    }
  }
}

/* =====================================================================
 * Rendering
 * ===================================================================== */
const VARS = [
  'page',
  'bg',
  'subtle',
  'inset',
  'border',
  'border-muted',
  'fg',
  'fg-muted',
  'fg-subtle',
  'leaf',
  'leaf-ink',
  'leaf-bg',
  'sprout',
  'bean',
  'bean-bg',
  'amber',
  'red',
  'red-bg',
  'glowc',
  'glow-sprout',
  'glow-bean',
  'glow-red',
  'pulse',
];
let C = {};
function readColors() {
  const cs = getComputedStyle(document.documentElement);
  const c = {};
  for (const v of VARS) {
    c[v.replace(/-(\w)/g, (_, x) => x.toUpperCase())] = cs.getPropertyValue(`--${v}`).trim();
  }
  c.dark = document.documentElement.dataset.theme !== 'light';
  C = c;
}
function fade(color, a = 0) {
  const c = color.trim();
  let r = 0;
  let g = 0;
  let b = 0;
  let al = 1;
  if (c.startsWith('#')) {
    r = parseInt(c.slice(1, 3), 16);
    g = parseInt(c.slice(3, 5), 16);
    b = parseInt(c.slice(5, 7), 16);
  } else {
    const m = (c.match(/[\d.]+/g) ?? ['0', '0', '0']).map(Number);
    [r, g, b] = m;
    al = m[3] ?? 1;
  }
  return `rgba(${r},${g},${b},${al * a})`;
}

/* ---------- Glyphs (option A, from prototypes/glyphs/gen_glyph_css.py) ---------- */
const G = {
  bean: new Path2D(
    'M8.2 9.6c2.2-1.6 6.4-.6 7.3 2.2.9 2.8-1.6 4.9-4.4 4.6-2.8-.3-4.6-2.4-4.2-4.6.2-.9.6-1.7 1.3-2.2Z',
  ),
  seedling: new Path2D(
    'M12 14c-1-3.2-3.6-4.6-6-4.3.1 2.6 2.6 4.6 6 4.3ZM12 14c1-3.2 3.6-4.6 6-4.3-.1 2.6-2.6 4.6-6 4.3Z',
  ),
  leaf: new Path2D('M12 15c1.2-5.6 5.2-8.6 10.4-8.2-.6 5.4-4.6 8.8-10.4 8.2Z'),
  rib: new Path2D('M12.6 14.7 21.2 7.7'),
  arrow: new Path2D('M17.5 8.2C16.8 4.8 13.6 3 10.4 3.8 8.6 4.3 7.3 5.5 6.6 7'),
  arrowHead: new Path2D('M4.6 5.2l2 3.6 2.9-2.4Z'),
};
let dpr = 1;
const glow = (color, blur) => {
  ctx.shadowColor = color;
  ctx.shadowBlur = blur * dpr;
};
const noGlow = () => {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
};
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
function text(str, x, y, o = {}) {
  ctx.save();
  const size = o.size ?? 11;
  const family = o.sans
    ? "'Space Grotesk', system-ui, sans-serif"
    : "'JetBrains Mono', ui-monospace, monospace";
  ctx.font = `${o.weight ?? 500} ${size}px ${family}`;
  ctx.fillStyle = o.color ?? C.fgMuted;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = 'middle';
  if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
  ctx.fillText(str, x, y);
  ctx.restore();
}
function chip(str, x, y, color, a = 1, align = 'center') {
  if (a <= 0) return;
  ctx.save();
  ctx.font = "500 11px 'JetBrains Mono', monospace";
  const w = ctx.measureText(str).width + 12;
  let bx = x - w / 2;
  if (align === 'left') bx = x;
  if (align === 'right') bx = x - w;
  bx = clamp(bx, 6, W - w - 6);
  ctx.globalAlpha *= a;
  roundRect(bx, y - 10, w, 20, 6);
  ctx.fillStyle = C.bg;
  ctx.fill();
  ctx.strokeStyle = fade(color, 0.45);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  text(str, bx + 6, y + 0.5, { color, alpha: a });
}
function spark(x, y, r, color, a = 1) {
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha *= a;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, C.pulse);
  g.addColorStop(0.25, color);
  g.addColorStop(1, fade(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
function ring(x, y, r, color, a, w = 1.4) {
  if (a <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.globalAlpha *= a;
  ctx.lineWidth = w;
  ctx.stroke();
  ctx.restore();
}

/** Bean: writing | queued | checking | rework | rebase | waiting. */
function bean(x, y, size, kind, t, phase = 0) {
  const s = size / 24;
  const motion = !reduced;
  ctx.save();
  ctx.translate(x, y);
  let sc = 1;
  if (kind === 'writing' && motion) sc = 1 - 0.12 * (0.5 + 0.5 * Math.sin(t * 3.4 + phase));
  if ((kind === 'rework' || kind === 'rebase') && motion) {
    ctx.translate(-1.5 * s * (0.5 + 0.5 * Math.sin(t * 4 + phase)), 0);
  }
  ctx.save();
  ctx.scale(s * sc, s * sc);
  ctx.translate(-11.6, -12.9);
  const col = kind === 'rework' ? C.red : C.bean;
  if (kind === 'queued' || kind === 'waiting') {
    ctx.setLineDash([2, 1.6]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = col;
    ctx.globalAlpha *= 0.8;
    ctx.stroke(G.bean);
  } else {
    glow(kind === 'rework' ? C.glowRed : C.glowBean, 9);
    ctx.fillStyle = col;
    ctx.fill(G.bean);
  }
  ctx.restore();
  if (kind === 'checking') {
    ctx.save();
    ctx.rotate(motion ? t * 2.6 : 0.3);
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.arc(0, 0, 8.6, 0, Math.PI * 2);
    ctx.setLineDash([3, 3.2]);
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.7;
    ctx.strokeStyle = C.amber;
    ctx.stroke();
    ctx.restore();
  }
  if (kind === 'rework' || kind === 'rebase') {
    ctx.save();
    ctx.scale(s, s);
    ctx.translate(-11.6, -15.4);
    const c = kind === 'rework' ? C.red : C.amber;
    ctx.strokeStyle = c;
    ctx.fillStyle = c;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.stroke(G.arrow);
    ctx.fill(G.arrowHead);
    ctx.restore();
  }
  ctx.restore();
}
function seedling(x, y, size, k = 1, flash = 0) {
  if (k <= 0) return;
  const s = (size / 24) * k;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.translate(-12, -14);
  glow(C.glowSprout, 6 + flash * 18);
  ctx.fillStyle = C.sprout;
  ctx.fill(G.seedling);
  if (flash > 0) {
    ctx.globalAlpha *= flash;
    ctx.fillStyle = C.pulse;
    ctx.fill(G.seedling);
  }
  ctx.restore();
}
function leaf(x, y, size, side, o = {}) {
  const s = size / 24;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s * side, s);
  if (o.rot) ctx.rotate(o.rot);
  ctx.translate(-12, -15);
  glow(o.red ? C.glowRed : C.glowc, o.glowPx ?? 5);
  ctx.fillStyle = o.red ? C.red : C.leaf;
  ctx.fill(G.leaf);
  noGlow();
  if (o.flash) {
    ctx.globalAlpha *= o.flash;
    ctx.fillStyle = C.pulse;
    ctx.fill(G.leaf);
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = C.dark ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.7)';
  ctx.lineWidth = 0.55;
  ctx.stroke(G.rib);
  if (o.red) {
    ctx.strokeStyle = C.bg;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(14.6, 7.6);
    ctx.lineTo(19.4, 12.4);
    ctx.moveTo(19.4, 7.6);
    ctx.lineTo(14.6, 12.4);
    ctx.stroke();
  }
  ctx.restore();
}
function person(x, y, r, color, bg) {
  ctx.save();
  ctx.translate(x, y);
  if (bg) {
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.3, 0, Math.PI * 2);
    ctx.fillStyle = bg;
    ctx.fill();
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, -r * 0.55, r * 0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, r * 1.15, r * 1.15, r * 0.9, 0, Math.PI, 0);
  ctx.fill();
  ctx.restore();
}
function cursor(x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 16, s / 16);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 13);
  ctx.lineTo(3.4, 10);
  ctx.lineTo(5.8, 15.2);
  ctx.lineTo(8, 14.2);
  ctx.lineTo(5.7, 9.2);
  ctx.lineTo(10, 9.2);
  ctx.closePath();
  ctx.fillStyle = C.fg;
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = C.page;
  ctx.stroke();
  ctx.restore();
}
function check(x, y, s, color) {
  ctx.beginPath();
  ctx.moveTo(x - s, y);
  ctx.lineTo(x - s * 0.3, y + s * 0.7);
  ctx.lineTo(x + s, y - s * 0.8);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}
function zig(x, y, s, color) {
  ctx.beginPath();
  ctx.moveTo(x + s * 0.3, y - s);
  ctx.lineTo(x - s * 0.5, y + s * 0.1);
  ctx.lineTo(x + s * 0.4, y + s * 0.1);
  ctx.lineTo(x - s * 0.3, y + s);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();
}
function hourglass(x, y, t) {
  ctx.save();
  ctx.translate(x, y);
  if (!reduced && Math.floor(t / 1.6) % 2) ctx.rotate(Math.PI);
  ctx.beginPath();
  ctx.moveTo(-4, -5);
  ctx.lineTo(4, -5);
  ctx.lineTo(-4, 5);
  ctx.lineTo(4, 5);
  ctx.closePath();
  ctx.strokeStyle = C.fgSubtle;
  ctx.lineWidth = 1.3;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}
function agentBox(a, active) {
  roundRect(a.x - 15, a.y - 15, 30, 30, 8);
  ctx.fillStyle = C.bg;
  ctx.fill();
  ctx.strokeStyle = active ? fade(C.bean, 0.45) : C.border;
  ctx.lineWidth = 1;
  ctx.stroke();
  text(a.id, a.x, a.y + 0.5, { size: 10.5, color: active ? C.fg : C.fgSubtle, align: 'center' });
}
function header(title, lines, act, x, align, color) {
  text(title, x, 34, { size: 19, weight: 600, sans: true, color, align });
  text(lines[act], x, 60, { size: 12, color: C.fgMuted, align });
}
/** Shipped counter, near the seam, with a lift when it changes. */
function counter(log, t, t0, x, align, color) {
  const i = at(log, t);
  const base = log[Math.max(0, at(log, t0))][1];
  const n = log[i][1] - base;
  const lift = 1 - seg(t, log[i][0], log[i][0] + 0.6);
  const show = i > 0 && log[i][0] > t0 ? lift : 0;
  ctx.save();
  if (show > 0) glow(color === C.fg ? 'transparent' : C.glowc, 14 * show);
  text(String(n), x, 90 - show * 3, { size: 40, weight: 600, sans: true, color, align });
  ctx.restore();
  text('shipped', x, 118, { size: 11, color: C.fgSubtle, align });
}

/* ---------- Merge queue drawing ---------- */
const TX = 300;
const GATE = 352;
const NOTCH = 13;
const TOP = GATE + 30;
const PW = 70;
const PH = 22;
const QG = 28;
const queueY = (idx) => GATE - 34 - idx * QG;
const GH_LINES = [
  'Green, but waiting for main.',
  'One red fails the whole batch.',
  'Main moved: conflicts go back to rebase.',
];
const BS_LINES = [
  'Green, and shared at once.',
  'Only the culprit goes back.',
  'Clashes reconcile. Real disagreements reach you.',
];

function mainAt(q, t) {
  let n = 0;
  for (let i = q.merges.length - 1; i >= 0; i--) {
    const [tm, k] = q.merges[i];
    if (tm > t) continue;
    if (t - tm > 0.6) {
      // older merges are whole; count them all at once
      for (let j = 0; j <= i; j++) if (t - q.merges[j][0] > 0.6) n += q.merges[j][1];
      break;
    }
    n += k * step(t, tm, 0.6);
  }
  return n;
}
function idxAt(pr, t) {
  const i = at(pr.idx, t);
  if (i < 0) return 0;
  const cur = pr.idx[i];
  const prev = i > 0 ? pr.idx[i - 1][1] : cur[1];
  return lerp(prev, cur[1], step(t, cur[0], 0.45));
}
const slotX = (b, pr) => TX + (b.prs.indexOf(pr) - (b.prs.length - 1) / 2) * (PW + 10);

/** Where a pull request is at t, and how it looks; null when it is not on screen. */
function pillAt(q, pr, t) {
  const i = at(pr.track, t);
  if (i < 0) return null;
  const [t0, kind, b] = pr.track[i];
  const ag = AGENTS[pr.agent];
  const inLine = () => [TX, queueY(idxAt(pr, t))];
  if (kind === 'fly') {
    const to = inLine();
    const from = [ag.bx, ag.y];
    const k = ease.io(seg(t, t0, t0 + 0.9));
    const [x, y] = qb(from, [lerp(from[0], to[0], 0.5), Math.min(from[1], to[1]) - 70], to, k);
    const look = retestLook(pr, t);
    return { x, y, look, s: 0.6 + 0.4 * ease.back(clamp(k * 1.6)) };
  }
  if (kind === 'gate') {
    const sx = slotX(b, pr);
    if (t < t0 + 0.6) {
      const k = ease.io(seg(t, t0, t0 + 0.6));
      const from = [TX, queueY(idxAt(pr, t0 - 0.01))];
      return { x: lerp(from[0], sx, k), y: lerp(from[1], GATE, k), look: 'green' };
    }
    // after the test ends, a passing batch is green until its merge track takes over
    if (t < b.t1) return { x: sx, y: GATE, look: 'test' };
    return { x: sx, y: GATE, look: b.ok ? 'green' : 'red', flash: b.ok ? 0 : 1 };
  }
  if (kind === 'merge') {
    const k = ease.in(seg(t, t0, t0 + 0.6));
    if (k >= 1) return null;
    return {
      x: lerp(slotX(b, pr), TX, k),
      y: lerp(GATE, TOP - 6, k),
      look: 'green',
      s: 1 - k * 0.35,
      a: 1 - ease.in(clamp(k * 1.4)),
    };
  }
  if (kind === 'rejected') {
    const j = b.prs.indexOf(pr);
    const sx = slotX(b, pr);
    const d0 = t0 + 0.5 + j * 0.14;
    if (t < d0) return { x: sx, y: GATE, look: 'red', flash: 1 - seg(t, t0, d0) };
    const to = inLine();
    const k = ease.io(seg(t, d0, d0 + 0.7));
    const [x, y] = qb([sx, GATE], [lerp(sx, to[0], 0.2) + (j - 1.5) * 30, GATE - 70], to, k);
    return { x, y, look: t < t0 + 2.6 ? 'rejected' : retestLook(pr, t) };
  }
  if (kind === 'kick' || kind === 'home') {
    const dur = kind === 'kick' ? 0.8 : 0.9;
    if (t > t0 + dur) return null;
    const from = kind === 'kick' ? [TX, queueY(idxAt(pr, t0 - 0.01))] : [slotX(b, pr), GATE];
    const k = ease.io(seg(t, t0, t0 + dur));
    const [x, y] = qb(from, [lerp(from[0], ag.bx, 0.5), from[1] - 60], [ag.bx, ag.y], k);
    return { x, y, look: kind === 'kick' ? 'clash' : 'red', s: 1 - k * 0.5 };
  }
  return null;
}
function retestLook(pr, t) {
  if (pr.track.some(([tt, k]) => k === 'kick' && tt > t && tt - t < 0.9)) return 'clash';
  return 'green';
}

function pill(pr, st, t) {
  const s = st.s ?? 1;
  ctx.save();
  ctx.translate(st.x, st.y);
  ctx.scale(s, s);
  ctx.globalAlpha *= st.a ?? 1;
  if (st.y < 130) ctx.globalAlpha *= clamp((st.y - 96) / 34);
  const red = st.look === 'red' || st.look === 'rejected';
  roundRect(-PW / 2, -PH / 2, PW, PH, PH / 2);
  ctx.fillStyle = red ? C.redBg : C.inset;
  if (st.look === 'red' && st.flash) glow(C.glowRed, 14 * st.flash);
  ctx.fill();
  noGlow();
  ctx.lineWidth = 1;
  ctx.strokeStyle = C.border;
  if (st.look === 'clash') ctx.strokeStyle = C.amber;
  if (red) ctx.strokeStyle = C.red;
  ctx.stroke();
  const ic = red ? C.red : C.fgSubtle;
  ctx.fillStyle = ic;
  ctx.beginPath();
  ctx.arc(-PW / 2 + 12, -3.5, 1.8, 0, 7);
  ctx.arc(-PW / 2 + 12, 4, 1.8, 0, 7);
  ctx.fill();
  text(`#${pr.num}`, -PW / 2 + 19, 0.5, { size: 10, color: red ? C.red : C.fgMuted });
  if (st.look === 'test') {
    ctx.save();
    ctx.translate(PW / 2 - 12, 0);
    ctx.rotate(reduced ? 0.4 : t * 3);
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.setLineDash([2.2, 2.2]);
    ctx.strokeStyle = C.amber;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  } else if (red) {
    ctx.strokeStyle = C.red;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(PW / 2 - 15.5, -3.5);
    ctx.lineTo(PW / 2 - 8.5, 3.5);
    ctx.moveTo(PW / 2 - 8.5, -3.5);
    ctx.lineTo(PW / 2 - 15.5, 3.5);
    ctx.stroke();
  } else if (st.look === 'clash') zig(PW / 2 - 12, 0, 5, C.amber);
  else check(PW / 2 - 12, 0, 4, C.leaf);
  ctx.restore();
}

function modeAt(log, t) {
  const i = at(log, t);
  return i < 0 ? ['writing', -99] : [log[i][1], log[i][0]];
}
const beanKind = (mode) => {
  if (mode === 'checking' || mode === 'rebaseCheck' || mode === 'reworkCheck') return 'checking';
  if (mode === 'sent') return 'queued';
  if (mode === 'rebase' || mode === 'rework' || mode === 'waiting') return mode;
  return 'writing';
};

function drawQueue(q, t, t0) {
  const act = Math.floor((((t % CYCLE) + CYCLE) % CYCLE) / ACT);
  // a cool, ruled ground
  ctx.save();
  ctx.globalAlpha = C.dark ? 0.35 : 0.45;
  ctx.fillStyle = C.borderMuted;
  for (let y = 92; y < H; y += 24) ctx.fillRect(0, y, W, 1);
  ctx.restore();
  header('Merge queue', GH_LINES, act, 26, 'left', C.fg);
  counter(q.shipped, t, t0, W - 26, 'right', C.fg);

  // main: a rigid trunk of commits
  const count = mainAt(q, t);
  const off = (count % 1) * NOTCH;
  const tg = ctx.createLinearGradient(0, TOP, 0, H);
  tg.addColorStop(0, C.fgSubtle);
  tg.addColorStop(1, fade(C.fgSubtle, 0));
  roundRect(TX - 6, TOP - 10, 12, H - TOP + 10, 3);
  ctx.fillStyle = tg;
  ctx.globalAlpha = 0.55;
  ctx.fill();
  ctx.globalAlpha = 1;
  for (let y = TOP + off; y < H; y += NOTCH) {
    ctx.globalAlpha = clamp((H - y) / 160);
    ctx.fillStyle = C.page;
    ctx.fillRect(TX - 3.5, y - 3.5, 7, 7);
    ctx.strokeStyle = C.fgSubtle;
    ctx.lineWidth = 1;
    ctx.strokeRect(TX - 3.5, y - 3.5, 7, 7);
  }
  ctx.globalAlpha = 1;
  text('main', TX + 14, H - 40, { color: C.fgSubtle });

  // the gate
  const gb = q.batches.findLast((b) => t >= b.t0 + 0.4 && t < b.t1 + (b.ok ? 0.2 : 1.2));
  const gw = 4 * (PW + 10) + 14;
  const failing = gb && !gb.ok && t >= gb.t1;
  ctx.save();
  roundRect(TX - gw / 2, GATE - 20, gw, 40, 12);
  ctx.fillStyle = failing ? C.redBg : C.subtle;
  ctx.fill();
  ctx.lineWidth = 1.2;
  if (gb && !failing) {
    ctx.setLineDash([5, 4]);
    ctx.lineDashOffset = reduced ? 0 : -t * 14;
    ctx.strokeStyle = C.amber;
  } else ctx.strokeStyle = failing ? C.red : C.border;
  if (failing) glow(C.glowRed, 16 * (1 - seg(t, gb.t1 + 0.3, gb.t1 + 1.2)));
  ctx.stroke();
  ctx.restore();
  {
    // a turnstile: a third of a turn per batch admitted
    let turns = 0;
    for (let i = q.batches.length - 1; i >= 0 && i >= q.batches.length - 4; i--) {
      turns += step(t, q.batches[i].t0, 0.6);
    }
    const th = (turns + q.batches.length) * ((Math.PI * 2) / 3);
    for (let k = 0; k < 3; k++) {
      const a = th + (k * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.moveTo(TX, GATE - 22);
      ctx.lineTo(TX + Math.cos(a) * 24, GATE - 22 + Math.sin(a) * 6);
      ctx.strokeStyle = Math.sin(a) > 0 ? C.fgMuted : C.fgSubtle;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(TX, GATE - 22, 4.5, 0, 7);
    ctx.fillStyle = failing ? C.red : C.fgMuted;
    ctx.fill();
  }
  ctx.fillStyle = C.fgSubtle;
  ctx.fillRect(TX - gw / 2 - 9, GATE - 26, 5, 52);
  ctx.fillRect(TX + gw / 2 + 4, GATE - 26, 5, 52);
  if (failing) {
    chip('batch failed: all of it back in line', TX, GATE + 40, C.red, win(t, gb.t1, gb.t1 + 3.4));
  } else if (gb?.retest && t < gb.t1) {
    chip('the rest, tested again', TX, GATE + 40, C.amber, win(t, gb.t0 + 0.4, gb.t1));
  }

  // main moved: conflicting pull requests leave the line
  for (const sw of q.sweeps) {
    if (act !== 2 || !sw.kicks.length || t < sw.t || t > sw.t + 2.4) continue;
    chip(
      'main moved: conflicts leave the line',
      TX + 150,
      GATE - 70,
      C.amber,
      win(t, sw.t, sw.t + 2.4),
    );
  }

  // agents, and branches cut from where main was when they started
  for (const ag of q.agents) {
    const a = ag.a;
    const [mode] = modeAt(ag.log, t);
    const kind = beanKind(mode);
    agentBox(a, kind !== 'waiting');
    if (kind !== 'waiting') {
      const b = baseAt(ag.base, t);
      const by = Math.min(H - 30, TOP + (count - b) * NOTCH);
      const from = [TX + a.side * 7, by];
      ctx.beginPath();
      ctx.moveTo(from[0], from[1]);
      ctx.bezierCurveTo(
        from[0] + a.side * 60,
        from[1],
        a.bx - a.side * 70,
        a.y,
        a.bx - a.side * 12,
        a.y,
      );
      ctx.strokeStyle = mode === 'rebase' ? C.amber : C.fgSubtle;
      ctx.globalAlpha = mode === 'rebase' ? 0.85 : 0.5;
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = mode === 'rebase' ? C.amber : C.fgSubtle;
      ctx.beginPath();
      ctx.arc(from[0], from[1], mode === 'rebase' ? 3.2 : 2.4, 0, 7);
      ctx.fill();
    }
    bean(a.bx, a.y, 42, kind, t, a.y);
    if (mode === 'rebase') {
      chip('rebasing onto main', a.bx - a.side * 6, a.y + 32, C.amber, 1, 'center');
    }
    if (kind === 'waiting') {
      hourglass(a.bx - a.side * 28, a.y, t);
      const x = ag.depOn?.x;
      const pr = ag.depOn?.pr;
      const st = pr && pr.track[0][0] <= t ? pillAt(q, pr, t) : null;
      if (st) {
        ctx.save();
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(a.bx - a.side * 16, a.y);
        ctx.lineTo(st.x + (a.side * PW) / 2, st.y);
        ctx.strokeStyle = C.fgSubtle;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
        chip(`needs #${pr.num}`, a.bx, a.y + 32, C.fgMuted);
      } else if (x) chip(`needs ${x.a.id}'s work`, a.bx, a.y + 32, C.fgMuted);
    }
  }

  // pull requests
  for (const pr of q.prs.values()) {
    const st = pillAt(q, pr, t);
    if (st) pill(pr, st, t);
  }
}

/* ---------- Beanstalk drawing ---------- */
const TIPY = 150;
const NS = 25;
const sway = (y, t) =>
  300 + 8 * Math.sin(y / 58 + 0.6) + (reduced ? 0 : 1.6 * Math.sin(t * 0.7 + y / 90));

function rankOf(b, n, idx, t) {
  // nodes after n in time order that have bloomed, eased; minus culprits popped above it
  let r = 0;
  for (let j = idx + 1; j < b.nodes.length; j++) {
    const f = b.nodes[j];
    if (f.tb - 0.1 > t) break;
    r += step(t, f.tb - 0.1, 0.5, ease.out);
  }
  for (const p of b.pops) {
    if (p.tb > n.tb && t > p.tpop + 0.2) r -= step(t, p.tpop + 0.2, 0.6);
  }
  return r;
}

function drawStalk(b, t, t0) {
  const act = Math.floor((((t % CYCLE) + CYCLE) % CYCLE) / ACT);
  // light behind the growing tip, and depth
  const tipX = sway(TIPY, t);
  const rg = ctx.createRadialGradient(tipX, TIPY + 60, 10, tipX, TIPY + 60, 380);
  rg.addColorStop(0, C.leafBg);
  rg.addColorStop(1, fade(C.leafBg, 0));
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, W, H);
  const r = seeded(31);
  for (let i = 0; i < 8; i++) {
    const bx = r() * W;
    const by = 120 + r() * (H - 160);
    const rad = 40 + r() * 70;
    const x = bx + (reduced ? 0 : Math.sin(t * 0.25 + i * 1.7) * 18);
    const y = by + (reduced ? 0 : Math.cos(t * 0.2 + i) * 12);
    const col = i % 3 ? C.leaf : C.sprout;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, fade(col, C.dark ? 0.07 : 0.1));
    g.addColorStop(1, fade(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 34; i++) {
    const sx = r() * W;
    const sp = 8 + r() * 14;
    const ph = r() * 50;
    const y = H - ((((t * sp + ph * 13) % (H + 40)) + H + 40) % (H + 40));
    const x = sx + Math.sin(t * 0.6 + i) * 10;
    ctx.globalAlpha = (0.12 + r() * 0.25) * clamp((H - y) / 200) * clamp(y / 160);
    ctx.fillStyle = i % 3 ? C.leaf : C.sprout;
    ctx.beginPath();
    ctx.arc(x, y, 0.8 + r() * 1.2, 0, 7);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  header('Beanstalk', BS_LINES, act, W - 26, 'right', C.leafInk);
  counter(b.shipped, t, t0, 26, 'left', C.leafInk);

  // visible nodes: the newest few dozen
  let lastIdx = b.nodes.length - 1;
  while (lastIdx > 0 && b.nodes[lastIdx].tb - 0.1 > t) lastIdx--;
  const first = Math.max(0, lastIdx - 40);
  const live = [];
  for (let i = first; i <= lastIdx; i++) {
    const n = b.nodes[i];
    if (n.tb - 0.1 > t) continue;
    if (n.tpop !== undefined && t > n.tpop + 0.05) continue;
    const y = TIPY + rankOf(b, n, i, t) * NS;
    if (y > H + 30) continue;
    live.push([n, y]);
  }
  let matureY = H;
  for (const [n, y] of live) if (n.tm !== undefined && n.tm <= t) matureY = Math.min(matureY, y);
  const stem = (y0, y1, color, w, gc) => {
    ctx.beginPath();
    for (let y = y0; y <= y1; y += 6) {
      const x = sway(y, t);
      if (y === y0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    glow(gc, 8);
    ctx.stroke();
    noGlow();
  };
  const stg = ctx.createLinearGradient(0, matureY, 0, H);
  stg.addColorStop(0, C.leaf);
  stg.addColorStop(1, fade(C.leaf, 0));
  stem(matureY, H + 10, stg, 4, C.glowc);
  stem(TIPY - 6, matureY, C.sprout, 2.4, C.glowSprout);
  const yOf = new Map(live);

  // stalk checks
  for (let ci = b.checks.length - 1; ci >= 0; ci--) {
    const c = b.checks[ci];
    if (c.t1 + 1.1 < t - 8) break;
    if (t < c.t0 || t > c.t1 + 1.1) continue;
    const ys = c.nodes.map((n) => yOf.get(n)).filter((y) => y !== undefined);
    if (c.culprit && t > c.t1) ys.push(TIPY + 0);
    if (!ys.length) continue;
    const y0 = Math.min(...ys) - 18;
    const y1 = Math.max(...ys) + 10;
    const done = t > c.t1;
    const failed = c.culprit && done;
    ctx.save();
    ctx.globalAlpha =
      win(t, c.t0, c.t1 + 1.1, 0.3) * (done ? 1 - seg(t, c.t1 + 0.4, c.t1 + 1.1) : 1);
    roundRect(sway((y0 + y1) / 2, t) - 38, y0, 76, y1 - y0, 16);
    ctx.strokeStyle = C.amber;
    if (done) ctx.strokeStyle = failed ? C.red : C.leaf;
    ctx.lineWidth = 1.3;
    if (!done) {
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = reduced ? 0 : -t * 12;
    } else glow(failed ? C.glowRed : C.glowc, 12);
    ctx.stroke();
    ctx.restore();
    if (done && !failed) {
      const k = seg(t, c.t1, c.t1 + 0.5);
      if (k < 1) {
        const y = lerp(y1 + 30, y0, k);
        spark(sway(y, t), y, 16, C.leaf, 1 - k);
      }
    }
  }
  // nodes
  for (const [n, y] of live) {
    const x = sway(y, t);
    if (n.tred !== undefined && t >= n.tred) {
      leaf(x, y, 40, n.side, { red: true, glowPx: 10 });
      continue;
    }
    if (n.tm !== undefined && t >= n.tm) {
      const k = seg(t, n.tm, n.tm + 1);
      let sc = 1;
      if (k < 0.55) sc = lerp(0.6, 1.18, k / 0.55);
      else if (k < 1) sc = lerp(1.18, 1, (k - 0.55) / 0.45);
      leaf(x, y, 40 * sc, n.side, { flash: k < 1 ? (1 - k) * 0.9 : 0, glowPx: k < 1 ? 14 : 4 });
    } else {
      seedling(x, y, 40, step(t, n.tb - 0.1, 0.6, ease.back), 1 - seg(t, n.tb, n.tb + 0.8));
    }
    // a burst where it bloomed
    const k = seg(t, n.tb - 0.05, n.tb + 0.8);
    if (k > 0 && k < 1) {
      spark(x, y - 6, 34 * ease.out(k) + 6, C.sprout, (1 - k) * 0.9);
      for (let j = 0; j < 9; j++) {
        const ang = (j / 9) * Math.PI * 2 + n.tb;
        const rr = 8 + 34 * ease.out(k);
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = j % 2 ? C.sprout : C.pulse;
        ctx.beginPath();
        ctx.arc(x + Math.cos(ang) * rr, y - 6 + Math.sin(ang) * rr, 1.6 * (1 - k) + 0.6, 0, 7);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }
  // culprits fly home
  for (const ag of b.agents) {
    const h = ag.home;
    if (!h || t < h.t0 || t > h.t1 + 2.5) continue;
    const a = ag.a;
    chip('only the culprit goes back', a.bx, a.y + 32, C.red, win(t, h.t0, h.t1 + 2));
    if (t > h.t1) continue;
    const k = seg(t, h.t0, h.t1);
    const fy = TIPY + 2 * NS;
    const from = [sway(fy, t) + a.side * 14, fy];
    const ctrl = [from[0] + a.side * 120, from[1] - 150];
    ctx.beginPath();
    for (let j = 0; j <= 24; j++) {
      const [tx, ty] = qb(from, ctrl, [a.bx, a.y], ease.io(k) * (j / 24));
      if (j) ctx.lineTo(tx, ty);
      else ctx.moveTo(tx, ty);
    }
    ctx.strokeStyle = C.red;
    ctx.globalAlpha = 0.5;
    ctx.setLineDash([2, 4]);
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    const [x, y] = qb(from, ctrl, [a.bx, a.y], ease.io(k));
    leaf(x, y, 50, a.side, { red: true, rot: Math.sin(k * 6) * 0.6, glowPx: 16 });
  }

  // agents, their tendrils to the tip, and the pulses that bring them each update
  const focus = b.focus.findLast((f) => f.act === 0 && t >= f.t && t - f.t < ACT);
  for (const ag of b.agents) {
    const a = ag.a;
    const [mode, since] = modeAt(ag.log, t);
    const kind = beanKind(mode);
    agentBox(a, kind !== 'waiting');
    // the base slides to each new sprout as its pulse arrives
    let best = null;
    let second = null;
    for (let i = lastIdx; i >= first; i--) {
      const n = b.nodes[i];
      if (n.tpop !== undefined && t > n.tpop) continue;
      if (n.tb + travel(a) > t) continue;
      if (!best) best = n;
      else {
        second = n;
        break;
      }
    }
    const yb0 = second && yOf.has(second) ? yOf.get(second) : TIPY + NS;
    const yb1 = best && yOf.has(best) ? yOf.get(best) : TIPY;
    const yb = best ? lerp(yb0, yb1, step(t, best.tb + travel(a), 0.35)) : TIPY;
    const base = [sway(yb, t), yb];
    const end = [a.bx - a.side * 16, a.y];
    const c2 = [end[0] - a.side * 50, end[1] - 40];
    if (kind !== 'waiting') {
      ctx.beginPath();
      ctx.moveTo(base[0], base[1]);
      ctx.bezierCurveTo(base[0] + a.side * 70, base[1] + 10, c2[0], c2[1], end[0], end[1]);
      ctx.strokeStyle = C.sprout;
      ctx.globalAlpha = 0.32;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = C.sprout;
      ctx.beginPath();
      ctx.arc(base[0], base[1], 2.2, 0, 7);
      ctx.fill();
    }
    // pulses in flight from recent blooms
    for (let i = lastIdx; i >= first; i--) {
      const n = b.nodes[i];
      if (n.tb < t - 2) break;
      if (n.agent === a.i || n.tb > t) continue;
      const t1 = n.tb + travel(a);
      const k = seg(t, n.tb, t1);
      if (k < 1) {
        const ny = yOf.get(n) ?? TIPY;
        const nb = [sway(ny, t), ny];
        const [px, py] = cb(nb, [nb[0] + a.side * 70, nb[1] + 10], c2, end, ease.io(k));
        spark(px, py, 9, C.sprout, 1);
      }
      ring(
        a.bx,
        a.y,
        10 + seg(t, t1, t1 + 0.5) * 20,
        C.sprout,
        t > t1 && t < t1 + 0.5 ? (1 - seg(t, t1, t1 + 0.5)) * 0.8 : 0,
      );
    }
    if (mode !== 'sent' || t - since > 0.35) bean(a.bx, a.y, 42, kind, t, a.y);
    if (kind === 'waiting') {
      hourglass(a.bx - a.side * 28, a.y, t);
      if (focus) chip(`needs ${AGENTS[focus.agentX].id}'s work`, a.bx, a.y + 32, C.fgMuted);
    }
    if (focus && focus.agentY === a.i && kind === 'writing') {
      const started = ag.log.find(([tt, m]) => tt > focus.t && m === 'writing');
      if (started && t - started[0] < 5) {
        chip(
          `built on ${AGENTS[focus.agentX].id} at once`,
          a.bx,
          a.y + 32,
          C.leafInk,
          win(t, started[0], started[0] + 5),
        );
      }
    }
  }

  // flights to the tip
  for (let i = b.flights.length - 1; i >= 0; i--) {
    const f = b.flights[i];
    if (f.t1 < t - 8) break;
    if (t < f.t0 || t >= f.t1) continue;
    const a = AGENTS[f.agent];
    const k = ease.io(seg(t, f.t0, f.t1));
    const to = [sway(TIPY, t), TIPY - 4];
    const [x, y] = qb([a.bx, a.y], [lerp(a.bx, to[0], 0.4), Math.min(a.y, to[1]) - 70], to, k);
    bean(x, y, 38, 'writing', t);
  }
  // clashes that reconcile
  for (const c of b.clashes) {
    if (t < c.t || t > c.t + 2.2) continue;
    const k = seg(t, c.t, c.t + 0.6);
    ring(sway(TIPY, t), TIPY - 4, 6 + k * 26, C.amber, (1 - k) * 0.9, 1.5);
    chip('clash reconciled', sway(TIPY, t) + 92, TIPY - 20, C.leafInk, win(t, c.t, c.t + 2.2));
  }
  for (const d of b.decisions) {
    if (t >= d.t0 - 0.1 && t <= d.t1 + FLY + 0.1) drawDecision(d, t);
  }
  const asked = b.decisions.some((d) => t > d.t0 + 0.6 && t < d.t1);
  person(PERSON.x, PERSON.y, 9, asked ? C.fg : C.fgSubtle, asked ? C.inset : null);
  text('you', PERSON.x, PERSON.y + 30, { size: 10.5, color: C.fgSubtle, align: 'center' });
  text('stalk', sway(H - 40, t) + 22, H - 40, { color: C.leafInk });
}

function drawDecision(d, t) {
  const A = AGENTS[d.a];
  const B = AGENTS[d.b];
  const tip = [sway(TIPY, t), TIPY - 4];
  const meet = [tip[0] + 70, tip[1] + 40];
  const tMeet = d.t0 + 0.45;
  if (t < tMeet) {
    const k = ease.io(seg(t, d.t0 - 0.15, tMeet));
    for (const a of [A, B]) {
      const [x, y] = qb(
        [a.bx, a.y],
        [lerp(a.bx, meet[0], 0.4), Math.min(a.y, meet[1]) - 50],
        [meet[0] + a.side * 9, meet[1]],
        k,
      );
      bean(x, y, 38, 'writing', t);
    }
    return;
  }
  ring(
    meet[0],
    meet[1],
    6 + seg(t, tMeet, tMeet + 0.5) * 22,
    C.red,
    1 - seg(t, tMeet, tMeet + 0.5),
    1.5,
  );
  const k = ease.io(seg(t, tMeet + 0.15, tMeet + 0.95));
  const dest = [PERSON.x + 70, PERSON.y - 34];
  const [cx, cy] = qb(meet, [meet[0] - 150, meet[1] + 60], dest, k);
  const pick = d.t1 - 0.6;
  if (t < d.t1) {
    const cw = 74;
    const ch = 34;
    ctx.save();
    ctx.translate(cx, cy);
    roundRect(-cw / 2, -ch / 2, cw, ch, 9);
    ctx.fillStyle = C.bg;
    glow(C.glowBean, 12);
    ctx.fill();
    noGlow();
    ctx.strokeStyle = C.bean;
    ctx.lineWidth = 1.1;
    ctx.stroke();
    const picked = t >= pick;
    const pk = seg(t, pick, pick + 0.4);
    roundRect(-cw / 2 + 5, -ch / 2 + 5, cw / 2 - 7, ch - 10, 6);
    ctx.fillStyle = picked ? C.leafBg : C.beanBg;
    ctx.fill();
    if (picked) {
      ctx.strokeStyle = C.leaf;
      ctx.globalAlpha = pk;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    bean(-cw / 4 + 1, 0, 16, 'writing', t);
    ctx.globalAlpha = picked ? 1 - 0.6 * pk : 1;
    roundRect(2, -ch / 2 + 5, cw / 2 - 7, ch - 10, 6);
    ctx.fillStyle = C.beanBg;
    ctx.fill();
    bean(cw / 4 - 1, 0, 16, 'writing', t);
    ctx.globalAlpha = 1;
    ctx.restore();
    chip(
      picked ? 'you kept one side' : 'a real disagreement',
      cx,
      cy - 30,
      picked ? C.leafInk : C.bean,
      win(t, tMeet + 0.3, d.t1),
    );
    if (t >= tMeet + 1.2 && t < pick) {
      const kc = ease.io(seg(t, tMeet + 1.2, pick - 0.2));
      cursor(lerp(PERSON.x + 6, cx - 18, kc), lerp(PERSON.y - 8, cy + 2, kc), 14);
    }
  } else {
    const k2 = ease.io(seg(t, d.t1, d.t1 + FLY));
    const [x, y] = qb([cx - 18, cy], [cx + 40, cy - 240], tip, k2);
    bean(x, y, 38, 'writing', t);
  }
}

/* =====================================================================
 * Frame, clock and layout
 * ===================================================================== */
if (section && ctx) setup();

function setup() {
  const gh = makeQueue();
  const bs = makeStalk();
  // Still frames for reduced motion: each half at its own clearest moment of the first cycle.
  function stillTimes(act) {
    gh.run(CYCLE + 2);
    bs.run(CYCLE + 2);
    if (act === 0) {
      const f = bs.focus.find((x) => x.act === 0);
      const ghf = gh.focus.find((x) => x.act === 0);
      const y = gh.agents[ghf?.agentY ?? 0];
      const wait = y.log.find(([tt, m]) => tt > (ghf?.t ?? 0) && m === 'waiting');
      const bsY = bs.agents[f?.agentY ?? 0];
      const go = bsY.log.find(([tt, m]) => tt > (f?.t ?? 0) && m === 'writing');
      return [wait ? wait[0] + 1.2 : 6, go ? go[0] + 0.15 : 6];
    }
    if (act === 1) {
      const fail = gh.batches.find((x) => !x.ok && x.t1 > ACT);
      const pop = bs.checks.find((x) => x.culprit && x.t1 > ACT);
      return [fail ? fail.t1 + 0.4 : 17, pop ? pop.t1 + 0.9 : 17];
    }
    const kick = gh.agents
      .flatMap((ag) => ag.log)
      .find(([tt, m]) => tt > 2 * ACT && m === 'rebase');
    const d = bs.decisions.find((x) => x.t0 > 2 * ACT);
    return [kick ? kick[0] + 1.0 : 28, d ? d.t0 + 1.6 : 32];
  }

  let clock = 0;
  let last = null;
  let visible = false;
  const stillAct = 0;
  let W0 = 0;
  let H0 = 0;
  function frameTimes() {
    if (frozen !== null) return [frozen, frozen];
    if (reduced) return stillTimes(stillAct);
    return [clock, clock];
  }
  function draw() {
    readColorsIfNeeded();
    const [tq, tb] = frameTimes();
    gh.run(tq + 0.1);
    bs.run(tb + 0.1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W0, H0);
    const side = W0 >= 760;
    const footH = 0;
    const halves = side
      ? [
          { x: 0, y: 0, w: W0 / 2, h: H0 },
          { x: W0 / 2, y: 0, w: W0 / 2, h: H0 },
        ]
      : [
          { x: 0, y: footH, w: W0, h: (H0 - footH) / 2 },
          { x: 0, y: footH + (H0 - footH) / 2, w: W0, h: (H0 - footH) / 2 },
        ];
    halves.forEach((r, i) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      if (i === 0) {
        ctx.fillStyle = C.dark ? 'rgba(120,140,160,0.035)' : 'rgba(20,50,40,0.035)';
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
      const s = Math.min(r.w / W, r.h / H);
      ctx.translate(r.x + (r.w - W * s) / 2, r.y + (r.h - H * s) / 2);
      ctx.scale(s, s);
      if (i === 0) drawQueue(gh, tq, 0);
      else drawStalk(bs, tb, 0);
      ctx.restore();
    });
    // the seam
    if (side) {
      const g = ctx.createLinearGradient(0, 0, 0, H0);
      g.addColorStop(0, fade(C.border, 0));
      g.addColorStop(0.3, C.border);
      g.addColorStop(0.8, C.border);
      g.addColorStop(1, fade(C.border, 0));
      ctx.fillStyle = g;
      ctx.fillRect(W0 / 2 - 0.5, 0, 1, H0);
    } else {
      ctx.fillStyle = C.border;
      ctx.fillRect(0, footH + (H0 - footH) / 2 - 0.5, W0, 1);
    }
  }

  if (params.has('mqdebug')) {
    gh.run(400);
    bs.run(400);
    const per = (log, a, b) => log[at(log, b)][1] - log[at(log, a)][1];
    section.dataset.debug = JSON.stringify({
      gh: [per(gh.shipped, 0, 100), per(gh.shipped, 100, 200), per(gh.shipped, 200, 400)],
      bs: [per(bs.shipped, 0, 100), per(bs.shipped, 100, 200), per(bs.shipped, 200, 400)],
      queueMax: Math.max(...[...gh.prs.values()].flatMap((p) => p.idx.map((x) => x[1]))),
      rebases: gh.agents.reduce((n, ag) => n + ag.log.filter((x) => x[1] === 'rebase').length, 0),
      fails: gh.batches.filter((x) => !x.ok).length,
      bsFails: bs.checks.filter((x) => x.culprit).length,
      decisions: bs.decisions.length,
      clashes: bs.clashes.length,
      failAt: gh.batches
        .filter((x) => !x.ok)
        .map((x) => +x.t1.toFixed(1))
        .slice(0, 6),
      popAt: bs.checks
        .filter((x) => x.culprit)
        .map((x) => +x.t1.toFixed(1))
        .slice(0, 6),
      decideAt: bs.decisions.map((x) => +x.t0.toFixed(1)).slice(0, 4),
      rebaseAt: gh.agents
        .flatMap((ag) => ag.log)
        .filter((x) => x[1] === 'rebase')
        .map((x) => +x[0].toFixed(1))
        .toSorted((a, b) => a - b)
        .slice(0, 12),
    });
  }
  let themeKey = '';
  function readColorsIfNeeded() {
    const k = document.documentElement.dataset.theme ?? '';
    if (k !== themeKey) {
      themeKey = k;
      readColors();
    }
  }
  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W0 = r.width;
    H0 = r.height;
    canvas.width = Math.round(W0 * dpr);
    canvas.height = Math.round(H0 * dpr);
    draw();
  }
  function loop(now) {
    if (!visible || document.hidden || frozen !== null || reduced) {
      last = null;
      return;
    }
    if (last !== null) clock += Math.min(0.1, (now - last) / 1000);
    last = now;
    draw();
    requestAnimationFrame(loop);
  }
  function wake() {
    if (visible && !document.hidden && frozen === null && !reduced && last === null) {
      requestAnimationFrame(loop);
    }
  }
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(
    (es) => {
      visible = es[0].isIntersecting;
      wake();
    },
    { rootMargin: '0px 0px -10% 0px' },
  ).observe(canvas);
  document.addEventListener('visibilitychange', wake);
  new MutationObserver(() => draw()).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  document.fonts.ready.then(resize, resize);
}
