// The hero's app preview: an HTML recreation of a repository with the app's own tabs (Code,
// Changes, History, Ask, People, Settings). Code plays the full home sequence first: the stalk
// grown to today, three questions typed and answered (the stalk reacts to each), then last week
// replayed from a fixed seed. Each other tab is an animated miniature of the real page; the tour
// moves on when a view's animation ends, and a click pins a tab until the preview is left alone.
// Every frame is a pure function of the tab and the time into it: reduced motion shows each tab's
// finished frame, and `?tab=<id>&demo=<ms>` (or `?demo=<ms>` into the tour) freezes the preview.

/* ---------- A week of history from a fixed seed ---------- */

function seeded(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let x = Math.imul(state ^ (state >>> 15), 1 | state);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = seeded(20261005);

const LIFE_DAYS = 34;
const WEEK_FROM_DAY = LIFE_DAYS - 7;
/** Week hours run from last Monday 9:00 (0) to today, this Monday 9:00 (168). */
const WEEK_HOURS = 168;
const OLDER = 48;
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const WEEK_TITLES = [
  'Show thousands separators in displayed amounts',
  'Reserving zero or negative quantities should fail',
  'Split the per-line work out of buildInvoice',
  'Work out session expiry in one place',
  'Limit how many units of one product fit in a cart',
  'Limit how many times a coupon can be redeemed',
  'Paged lists should report the total number',
  'Move the coupon rules out of discounts',
  'Active customers are logged out mid-session',
  'Tracking numbers belong to shipments',
  'Invoice numbers should restart every year',
  'Customers in Quebec are charged the wrong tax',
  'Shipping emails should include the tracking link',
  'Let customers reorder a previous order',
  'Reject weak passwords at registration',
  'Retired products are still visible by id',
  'Tax on multi-line invoices is a cent off',
  'Require a signature for high-value deliveries',
  'Customers can register twice with different case',
  'Customers cannot list their invoices',
  'Replace the notification switch with a table',
  'Line discounts do not add up to the order total',
  'Invoices should show federal and regional tax',
  'Checking out an empty cart creates an order',
  'Free standard shipping on orders over $75',
  'Stock reservations should be all or nothing',
  'Customers want a plain-text copy of their receipt',
  'Carts accept more units than are in stock',
  'Cap the discount a percentage coupon can give',
  'Make product filtering a pure function',
  'Expired coupons are still accepted at checkout',
  'A failed checkout leaves stock reserved',
  'Fixed-amount coupons can push a total below zero',
  'Customers should get a receipt when paid',
  'Finance needs a list of overdue invoices',
];
/** Landings per weekday: an uneven week. */
const PER_DAY = [6, 9, 4, 9, 7];

/** Hour of the week to a label: `Tue 14:05`. */
function stamp(h) {
  const abs = h + 9;
  const day = Math.floor(abs / 24);
  const mins = Math.round((abs % 24) * 60);
  const name = day >= 7 ? 'today' : DAY_NAMES[day];
  return { day: name, time: `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}` };
}

/** Work hours of a weekday (0 = Mon) in week hours: 8:30 to 18:30. */
const workday = (d) => [d * 24 - 0.5, d * 24 + 9.5];

const LANDINGS = [];
{
  let i = 0;
  for (let d = 0; d < 5; d++) {
    const [from, to] = workday(d);
    const times = Array.from({ length: PER_DAY[d] }, () => {
      // Two bursts a day, around late morning and mid-afternoon.
      const centre = rand() < 0.55 ? from + 2.2 : from + 6.3;
      return Math.min(to, Math.max(from + 0.4, centre + (rand() + rand() + rand() - 1.5) * 2.2));
    }).toSorted((a, b) => a - b);
    for (const t of times) {
      const duration = 1.2 + rand() * 4.8;
      LANDINGS.push({
        n: OLDER + i,
        id: `t${String(i + 1).padStart(3, '0')}`,
        title: WEEK_TITLES[i],
        agent: `a${Math.floor(rand() * 12)}`,
        start: Math.max(from - rand() * 0.4, t - duration),
        land: t,
        rework: rand() < 0.22,
      });
      i++;
    }
  }
}
const TOTAL = OLDER + LANDINGS.length;

/** One red validation, its revert and the sprout green again (Wednesday). */
const CULPRIT = LANDINGS.find((l) => l.land > 48 + 2);
const RED = { at: CULPRIT.land + 0.3, revert: CULPRIT.land + 0.75, green: CULPRIT.land + 1.3 };
/** One decision between two specs (Thursday afternoon); the declined bean falls. */
const DECISION = { at: 72 + 5.4, kept: 't001', declined: 'The order total leaves out shipping' };
const FELL = [
  {
    title: 'Customers want to leave delivery notes',
    id: 't036',
    agent: 'a3',
    start: 24 + 1.1,
    at: 24 + 3.4,
    reason: 'conflict',
  },
  {
    title: DECISION.declined,
    id: 't037',
    agent: 'a9',
    start: 72 + 2.0,
    at: DECISION.at + 0.4,
    reason: 'declined by D001',
  },
];

/** Validations: batches of varied size, none while the sprout is red. */
const PROMOTES = [];
{
  let next = 1 + Math.floor(rand() * 3);
  let pending = 0;
  for (const l of LANDINGS) {
    pending++;
    let at = l.land + 0.25 + rand() * 0.35;
    if (at > RED.at && at < RED.green) at = RED.green + 0.2;
    if (pending >= next) {
      PROMOTES.push({ at, to: l.n });
      pending = 0;
      next = [1, 2, 3, 4, 6, 7][Math.floor(rand() * 6)];
    }
  }
  PROMOTES.push({ at: workday(4)[1] + 0.4, to: TOTAL - 1 });
}

/** In flight this morning (today), on billing: two of them touch the same files. */
const TODAY_BEANS = [
  {
    id: 't038',
    agent: 'a2',
    title: 'Refunds for partial shipments',
    start: 168 - 1.4,
    land: Infinity,
    files: ['service.ts', 'handlers.ts'],
  },
  {
    id: 't039',
    agent: 'a7',
    title: 'Bulk-edit invoice due dates',
    start: 168 - 0.9,
    land: Infinity,
    files: ['service.ts', 'types.ts'],
  },
  {
    id: 't040',
    agent: 'a5',
    title: 'Customers want saved carts',
    start: 168 - 0.5,
    land: Infinity,
    files: ['cart/service.ts'],
  },
];

/* ---------- Replay time: nights and the weekend pass quickly ---------- */

const STEP = 0.25;
const CUMULATIVE = [0];
for (let h = 0; h < WEEK_HOURS; h += STEP) {
  const abs = h + 9;
  const weekday = Math.floor(abs / 24) < 5;
  const hour = abs % 24;
  const weight = weekday && hour >= 8 && hour < 19 ? 1 : 0.07;
  CUMULATIVE.push(CUMULATIVE.at(-1) + weight * STEP);
}
/** Replay progress u (0..1) to week hours. */
function hourAt(u) {
  const target = Math.min(1, Math.max(0, u)) * CUMULATIVE.at(-1);
  let lo = 0;
  let hi = CUMULATIVE.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (CUMULATIVE[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo * STEP;
}

/* ---------- The repository at hour h ---------- */

function repoAt(h) {
  const landed = OLDER + LANDINGS.filter((l) => l.land <= h).length;
  const promote = PROMOTES.findLast((p) => p.at <= h);
  const stalk = promote ? promote.to + 1 : OLDER;
  const flying = [...LANDINGS, ...TODAY_BEANS, ...FELL.map((f) => ({ ...f, land: f.at }))]
    .filter((b) => b.start <= h && h < b.land)
    .map((b) => {
      const frac = Number.isFinite(b.land) ? (h - b.start) / (b.land - b.start) : 0.8;
      let status = frac > 0.68 ? 'checking' : 'writing';
      if (b.rework && frac > 0.35 && frac < 0.55) status = 'reworking';
      return { ...b, status, mins: Math.round((h - b.start) * 60) };
    })
    .toSorted((a, b) => a.start - b.start);
  const prev = PROMOTES.findLast((p) => p.at <= h && p !== promote);
  const fresh =
    promote && h - promote.at < 1.1
      ? { from: prev ? prev.to + 1 : OLDER, to: promote.to, at: promote.at }
      : null;
  return {
    h,
    landed,
    stalk,
    flying,
    red: h >= RED.at && h < RED.green,
    reverted: h >= RED.revert,
    redSeen: h >= RED.at,
    decided: h >= DECISION.at,
    fell: FELL.filter((f) => f.at <= h),
    fresh,
  };
}

/* ---------- The red bean and what it collided with ---------- */

/** The bean the culprit broke: it added the test that failed when the culprit landed. */
const COLLIDED = LANDINGS.find((l) => l.id === 't013');

/* ---------- Code: the repository home, the full original sequence ---------- */

const TYPE_MS = 50;
const ERASE_MS = 16;
const TOUR = [
  { id: 'coupons', q: 'What changed on coupons this week?' },
  { id: 'red', q: `Why is #${CULPRIT.n} red?` },
  { id: 'billing', q: "Who's working on billing right now?" },
];
const REPLAY_Q = "Replay last week's work";
const REPLAY_MS = 14000;

/** Builds a typed-question script: each question is typed, answered, then erased. */
function script(stops, first) {
  const segments = [first];
  let showing = first.show;
  for (const stop of stops) {
    const prev = segments.at(-1);
    if (prev.q)
      segments.push({
        kind: 'erase',
        q: prev.q,
        ms: prev.q.length * ERASE_MS + 150,
        show: showing,
      });
    segments.push({ kind: 'type', q: stop.q, ms: stop.q.length * TYPE_MS, show: showing });
    segments.push({ kind: 'think', q: stop.q, ms: 360, show: showing });
    showing = stop.id;
    segments.push(
      stop.id === 'replay'
        ? { kind: 'replay', q: stop.q, ms: REPLAY_MS, show: 'replay' }
        : { kind: 'answer', q: stop.q, ms: stop.ms ?? 4200, show: stop.id },
    );
  }
  return segments;
}

function timed(segments) {
  let cursor = 0;
  for (const seg of segments) {
    seg.from = cursor;
    cursor += seg.ms;
  }
  return cursor;
}

const CODE_SEGMENTS = script([...TOUR, { id: 'replay', q: REPLAY_Q }], {
  kind: 'idle',
  ms: 2000,
  show: 'default',
});
CODE_SEGMENTS.push(
  { kind: 'end', q: REPLAY_Q, ms: 4200, show: 'replay' },
  { kind: 'erase', q: REPLAY_Q, ms: REPLAY_Q.length * ERASE_MS + 150, show: 'replay' },
  { kind: 'settle', ms: 1200, show: 'default' },
);
const CODE_MS = timed(CODE_SEGMENTS);
const REPLAY_END = CODE_SEGMENTS.find((s) => s.kind === 'end').from + 1;

/* ---------- Ask: the explorer, one of its own suggested questions ---------- */

const TRY = [
  'who changed billing/coupons.ts and why?',
  "what's being worked on right now?",
  'what did we decide?',
];
const ASK_SEGMENTS = script([{ id: 'journey', q: TRY[0], ms: 6200 }], {
  kind: 'idle',
  ms: 1800,
  show: 'askstart',
});
const ASK_MS = timed(ASK_SEGMENTS);

/* ---------- The tabs, exactly as the repository header shows them ---------- */

const TABS = [
  { id: 'code', label: 'Code', ms: CODE_MS, view: 'explorer' },
  { id: 'changes', label: 'Changes', ms: 8200, view: 'page' },
  { id: 'history', label: 'History', ms: 7200, view: 'page' },
  { id: 'ask', label: 'Ask', ms: ASK_MS, view: 'explorer' },
  { id: 'people', label: 'People', ms: 6400, view: 'page' },
  { id: 'settings', label: 'Settings', ms: 8000, view: 'page' },
];
const TOUR_MS = TABS.reduce((sum, tab) => sum + tab.ms, 0);
/** A click pins its tab; the tour resumes after this long without another interaction. */
const IDLE_MS = 14000;

/** Where the tour is at a time since it started: the tab and the time into it. */
function tourAt(t) {
  let local = ((t % TOUR_MS) + TOUR_MS) % TOUR_MS;
  for (const tab of TABS) {
    if (local < tab.ms) return { tab: tab.id, local };
    local -= tab.ms;
  }
  return { tab: TABS[0].id, local: 0 };
}

/** One frame of the preview: a pure function of the tab and the time into it. */
function frameAt(tab, local) {
  const segments = { code: CODE_SEGMENTS, ask: ASK_SEGMENTS }[tab];
  if (!segments)
    return {
      tab,
      local,
      typed: '',
      focus: false,
      show: tab,
      shownFor: local,
      replaying: false,
      replayed: false,
      ...repoAt(WEEK_HOURS),
    };
  const seg = segments.findLast((s) => s.from <= local) ?? segments[0];
  const into = local - seg.from;
  let typed = seg.q ?? '';
  if (seg.kind === 'type') typed = seg.q.slice(0, Math.floor(into / TYPE_MS));
  if (seg.kind === 'erase')
    typed = seg.q.slice(0, Math.max(0, seg.q.length - Math.floor(into / ERASE_MS)));
  if (seg.kind === 'idle' || seg.kind === 'settle') typed = '';
  const replaying = seg.kind === 'replay';
  const h = replaying ? hourAt(into / REPLAY_MS) : WEEK_HOURS;
  return {
    tab,
    local,
    typed,
    focus: seg.kind === 'type' || seg.kind === 'think' || seg.kind === 'erase',
    show: seg.show,
    /** How long the current answer has been on screen (for the stalk's own motion). */
    shownFor: seg.kind === 'answer' ? into : 1e9,
    replaying,
    replayed: seg.kind === 'end',
    ...repoAt(h),
  };
}

/* ---------- Rendering helpers ---------- */

const esc = (s) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clockOf = (h) => {
  if (h >= WEEK_HOURS) return 'today 9:00';
  const s = stamp(h);
  return `${s.day} ${s.time}`;
};
const COUPON_BEANS = LANDINGS.filter((l) => /coupon/i.test(l.title));
/** Answers that point at a few rows of the stalk and dim the rest. */
const FOCUSED = new Set(['coupons', 'red', 'billing', 'journey']);
const JOURNEY = COUPON_BEANS.at(-1);

/** Who an agent works for: every session belongs to a person. */
const PEOPLE = ['coop', 'dana', 'ike', 'mira'];
const ownerOf = (agent) => PEOPLE[Number(agent.slice(1)) % PEOPLE.length];
/** A bean's branch name, from its title. */
const slug = (title) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .split(' ')
    .filter((w) => w.length > 2)
    .slice(0, 3)
    .join('-');
const sha = (n) => ((n * 2654435761) >>> 0).toString(16).padStart(8, '0').slice(0, 7);
/** How long ago a week hour was, as the app says it. */
function ago(h) {
  const hours = WEEK_HOURS - h;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} minutes ago`;
  if (hours < 24) return `${Math.round(hours)} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/* ---------- The stalk ---------- */

/** The stalk's rows, keyed so they can be reconciled (classes change in place, so they animate). */
function stalkRows(f) {
  const rows = [];
  const answer = f.show;
  const focused = FOCUSED.has(answer);
  const linkFile = new Map();
  for (const b of f.flying.slice(0, 9)) {
    const st = { checking: 'check', writing: 'write', reworking: 'sent back' }[b.status];
    let cls = `srow bean ${b.status}`;
    if (answer === 'billing') cls += b.files ? ' hit ringpulse' : ' dim';
    else if (focused) cls += ' dim';
    if (b.files) linkFile.set(b.id, b.files);
    const partner =
      answer === 'billing' && b.files
        ? TODAY_BEANS.find((o) => o.id !== b.id && o.files.some((x) => b.files.includes(x)))
        : null;
    rows.push({
      key: `b-${b.id}`,
      cls,
      html: `<span class="ag">${b.agent}</span><span class="stem"><i class="beanmark"></i></span><span class="tt">${esc(b.title)}</span><span class="st">${partner ? `↔ ${partner.agent}` : st}</span>`,
    });
  }
  const found = answer === 'coupons' ? Math.floor(f.shownFor / 380) : 0;
  const foundIds = new Set(
    COUPON_BEANS.toReversed()
      .slice(0, found)
      .map((l) => l.n),
  );
  const cls = (n, base) => {
    if (answer === 'coupons') return `${base} ${foundIds.has(n) ? 'hit found' : 'dim slow'}`;
    if (answer === 'red') return `${base} ${n === CULPRIT.n || n === COLLIDED.n ? 'hit' : 'dim'}`;
    if (answer === 'journey') return `${base} ${n === JOURNEY.n ? 'hit found' : 'dim slow'}`;
    if (answer === 'billing') return `${base} dim`;
    return base;
  };
  const items = [
    ...LANDINGS.filter((l) => l.land <= f.h).map((l) => ({ kind: 'leaf', at: l.land, l })),
    ...f.fell.map((x) => ({ kind: 'fell', at: x.at, x })),
  ];
  if (f.reverted) items.push({ kind: 'revert', at: RED.revert });
  items.sort((a, b) => b.at - a.at);
  let bracket = false;
  for (const item of items) {
    if (f.fresh && !bracket && item.kind === 'leaf' && item.l.n <= f.fresh.to) {
      rows.push({
        key: `m-${f.fresh.at}`,
        cls: 'matured-row',
        html: `<span></span><span class="stem"></span><span>validated at ${clockOf(f.fresh.at)} · ${f.fresh.to - f.fresh.from + 1} matured</span>`,
      });
      bracket = true;
    }
    if (item.kind === 'fell') {
      rows.push({
        key: `f-${item.x.id}`,
        cls: cls(-1, 'srow fell'),
        html: `<span class="tm">${stamp(item.at).time}</span><span class="stem"><i class="fl"></i></span><span class="tt">${esc(item.x.title)}</span><span class="ix">fell</span>`,
      });
      continue;
    }
    if (item.kind === 'revert') {
      if (answer !== 'red' || f.shownFor > 1700)
        rows.push({
          key: 'revert',
          cls: `srow revert${answer === 'red' ? ' hit' : ''}`,
          html: `<span class="tm">${stamp(RED.revert).time}</span><span class="stem"><i class="rv"></i></span><span class="tt">${f.red ? `Reverted ${CULPRIT.id}; validating again` : `Reverted ${CULPRIT.id}, then green again`}</span><span class="ix">↩</span>`,
        });
      continue;
    }
    const { l } = item;
    const onStalk = l.n < f.stalk;
    let base = onStalk ? 'srow stalk' : 'srow sprout';
    if (l === CULPRIT && f.redSeen) base += ' red';
    if (l === CULPRIT && answer === 'red' && f.shownFor > 900) base += ' redpulse';
    if (f.fresh && onStalk && l.n >= f.fresh.from && l.n <= f.fresh.to && f.h - f.fresh.at < 0.5)
      base += ' matured';
    if (l.n % 2) base += ' l';
    rows.push({
      key: `l-${l.n}`,
      cls: cls(l.n, base),
      html: `<span class="tm">${stamp(l.land).time}</span><span class="stem"><i class="lf"></i></span><span class="tt">${esc(l.title)}</span><span class="ix">#${l.n}</span>`,
    });
  }
  rows.push({
    key: 'older',
    cls: `srow stalk older${focused ? ' dim' : ''}`,
    html: `<span class="tm">−8d</span><span class="stem"><i class="lf"></i></span><span class="tt">${OLDER} beans before this week</span><span class="ix">#${OLDER - 1}</span>`,
  });
  rows.push({
    key: 'root',
    cls: 'seedrow',
    html: '<span></span><span class="stem"></span><span>Fertilized by coop</span>',
  });
  return { rows, links: answer === 'billing' ? linkFile : null };
}

/** Updates the rows in place by key: changed classes transition, new rows grow in. */
function reconcile(host, rows) {
  const existing = new Map(
    [...host.children].filter((el) => el.dataset.key).map((el) => [el.dataset.key, el]),
  );
  const keep = new Set();
  let before = host.firstChild;
  for (const row of rows) {
    let el = existing.get(row.key);
    if (!el) {
      el = document.createElement('div');
      el.dataset.key = row.key;
    }
    if (el.dataset.html !== row.html) {
      el.innerHTML = row.html;
      el.dataset.html = row.html;
    }
    if (el.className !== row.cls) el.className = row.cls;
    if (el !== before) host.insertBefore(el, before);
    before = el.nextSibling;
    keep.add(row.key);
  }
  for (const [key, el] of existing) if (!keep.has(key)) el.remove();
}

/** Overlap links between in-flight beans that change the same file. */
function drawLinks(host, overlay, links) {
  let html = '';
  if (links) {
    const entries = [...links];
    const paths = [];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const shared = entries[i][1].filter((file) => entries[j][1].includes(file));
        if (!shared.length) continue;
        const a = host.querySelector(`[data-key="b-${entries[i][0]}"]`);
        const b = host.querySelector(`[data-key="b-${entries[j][0]}"]`);
        if (!a || !b) continue;
        const y1 = a.offsetTop + a.offsetHeight / 2;
        const y2 = b.offsetTop + b.offsetHeight / 2;
        paths.push(`<path d="M10 ${y1} C 1 ${y1}, 1 ${y2}, 10 ${y2}" />`);
      }
    }
    if (paths.length) html = `<svg width="100%" height="100%">${paths.join('')}</svg>`;
  }
  if (overlay.innerHTML !== html) overlay.innerHTML = html;
}

/* ---------- The explorer's panels (Code and Ask) ---------- */

function box(title, note, body) {
  return `<section class="d-box"><header><b>${title}</b>${note}</header>${body}</section>`;
}

function chips(searched, picked) {
  return `<div class="d-picked"><span class="lbl">searched</span>${searched.map((s) => `<span class="chip">${esc(s)}</span>`).join('')}<span class="sep"></span><span class="lbl">picked</span>${picked.map((p, i) => `<span class="chip"><b>${i + 1}</b>${esc(p)}</span>`).join('')}<span class="chip jev">Jev, 0.4 s</span></div>`;
}

function head(title, sub) {
  return `<h3 class="d-answer">${esc(title)}</h3><p class="d-sub">${esc(sub)}</p>`;
}

const minutes = (mins) => (mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`);

function growing(f) {
  const rows = f.flying
    .slice(0, 6)
    .map((b) => {
      const label =
        b.status === 'reworking' ? 'sent back to its author' : `${b.status} ${minutes(b.mins)}`;
      return `<div class="g-row ${b.status}"><span class="a">${b.agent}</span><span class="t">${esc(b.title)}</span><span class="s"><i class="spin"></i>${label}</span></div>`;
    })
    .join('');
  return box(
    'Growing now',
    `${f.flying.length} beans in flight`,
    rows || '<div class="g-empty">Nothing growing right now.</div>',
  );
}

function happened(f) {
  const events = [];
  if (f.decided)
    events.push(
      `<div class="ev"><span class="ic decide">◆</span><div><b>D001: two specs clashed</b><span>coop kept "Show thousands separators"; "${esc(DECISION.declined)}" was declined.</span></div></div>`,
    );
  if (f.redSeen)
    events.push(
      `<div class="ev"><span class="ic red">×</span><div><b>#${CULPRIT.n} went red</b><span>${f.reverted ? `${CULPRIT.id} broke a test from #${COLLIDED.n}; it was reverted and the sprout went green again at ${clockOf(RED.green).split(' ')[1]}.` : 'Bisecting the read-set suspects…'}</span></div></div>`,
    );
  if (f.fell.length)
    events.push(
      `<div class="ev"><span class="ic fell">·</span><div><b>${f.fell.length} bean${f.fell.length > 1 ? 's' : ''} fell off</b><span>${f.fell.map((x) => `${x.id} (${x.reason})`).join(', ')}</span></div></div>`,
    );
  return box(
    'What happened',
    '',
    events.join('') || '<div class="g-empty">A quiet week so far.</div>',
  );
}

function files() {
  const rows = [
    ['billing/', 'Finance needs a list of overdue invoices', 2],
    ['cart/', 'Carts accept more units than are in stock', 1],
    ['catalog/', 'Make product filtering a pure function', 0],
    ['notifications/', 'Customers should get a receipt when paid', 0],
  ]
    .map(
      ([dir, title, fly]) =>
        `<div class="f-row"><span class="fn">${dir}</span><span class="fb"><i class="lfm"></i>${esc(title)}</span>${fly ? `<span class="chip fly">${fly} in flight</span>` : '<span></span>'}</div>`,
    )
    .join('');
  return box('Files', 'src', rows);
}

const PANELS = {
  default: (f) => growing(f) + happened(f) + files(),
  askstart: (f) =>
    `<div class="d-try"><span>Try</span>${TRY.map((q) => `<span class="chip">› ${esc(q)}</span>`).join('')}</div>` +
    growing(f) +
    happened(f) +
    files(),
  coupons: (f) => {
    const found = Math.min(COUPON_BEANS.length, Math.floor(f.shownFor / 380));
    const paths = [
      'billing/coupons.ts',
      'billing/checkout.ts',
      'billing/coupon-cap.test.ts',
      'db/coupon_max.ts',
      'billing/discounts.ts',
    ];
    // Only the newest row grows in; the panel is rewritten only when a file is found.
    const list = COUPON_BEANS.toReversed()
      .slice(0, f.shownFor > 1e8 ? COUPON_BEANS.length : found)
      .map(
        (l, i) =>
          `<div class="f-row${i === found - 1 && f.shownFor < 1e8 ? ' arrive' : ''}"><span class="fn">${paths[i % 5]}</span><span class="chip leafchip"><i class="lfm"></i>${l.id} #${l.n}</span><span class="fstat">+${3 + ((l.n * 7) % 21)} −${(l.n * 3) % 5}</span></div>`,
      )
      .join('');
    const diff =
      '<div class="hunk"><div class="h">@@ -13,5 +13,5 @@</div><div> export function couponDiscount(coupon: Coupon, subtotal: Cents): Cents {</div><div class="d">-  if (coupon.kind !== \'percent\') return coupon.value;</div><div class="a">+  if (coupon.kind !== \'percent\') return Math.min(coupon.value, subtotal);</div></div>';
    return (
      chips(['this week', 'coupons: paths, content, beans'], ['Files + diffs', 'Bean journey']) +
      head(
        `${COUPON_BEANS.length} beans changed coupon code this week.`,
        'Found one by one on the stalk; the rest dims.',
      ) +
      box(
        'Files',
        `${found} of ${COUPON_BEANS.length} found`,
        list + (found || f.shownFor > 1e8 ? diff : ''),
      )
    );
  },
  red: (f) => {
    const step = Number(f.shownFor >= 900) + Number(f.shownFor >= 1700);
    const at = stamp(RED.at);
    return (
      chips([`#${CULPRIT.n}`, 'its validation and read set'], ['Red-validation card', 'Files']) +
      head(
        `#${CULPRIT.n} is red: ${CULPRIT.id} broke a test that #${COLLIDED.n} added.`,
        `${CULPRIT.agent}'s "${CULPRIT.title}" changed the shipment shape the tracking email reads.`,
      ) +
      box(
        '✕ Red validation R001',
        ` at #${CULPRIT.n}`,
        `<div class="card">
          <div class="rv-grid">
            <div><span class="rv-l">Failing test</span><code class="jc-fail">tracking-email.test.ts › the shipped email links to the carrier</code></div>
            <div><span class="rv-l">Collided with</span><span class="rv-with"><span class="chip leafchip"><i class="lfm"></i>${COLLIDED.id} #${COLLIDED.n}</span>${esc(COLLIDED.title)}</span></div>
          </div>
          <div class="hunk"><div class="h">shipping/shipments.ts, ${CULPRIT.id}</div><div class="d">-  tracking: TrackingNumber;</div><div class="a">+  delivery: { tracking: TrackingNumber; signature: boolean };</div></div>
          <div class="steps"><div class="on"><b>${at.day} ${at.time}</b>went red</div><div class="${step >= 1 ? 'on' : ''}"><b>${CULPRIT.id}</b>the culprit</div><div class="${step >= 2 ? 'on' : ''}"><b>${stamp(RED.revert).time}</b>reverted</div><div class="${step >= 2 ? 'on' : ''}"><b>${stamp(RED.green).time}</b>green again</div></div></div>`,
      )
    );
  },
  billing: (f) => {
    const beans = f.flying.filter((b) => b.files);
    const rows = beans
      .map(
        (b) =>
          `<div class="g-row ${b.status}"><span class="a">${b.agent}</span><span class="t">${esc(b.title)}<small>${b.files.join(', ')}</small></span><span class="s"><i class="spin"></i>${b.status}</span></div>`,
      )
      .join('');
    const hot = `<div class="f-row"><span class="fn">billing/service.ts</span><span><span class="chip fly">a2</span> <span class="chip fly">a7</span></span><span class="fstat">2 beans</span></div>
      <div class="g-empty">Each bean is checked on the merged tree before it lands, so they never collide on the sprout.</div>`;
    return (
      chips(['in flight now', 'src/billing/*'], ['Overlaps + sessions', 'Files']) +
      head(
        `${beans.length} sessions are working on billing right now.`,
        'Their beans pulse at the tip; a link joins the two that share a file.',
      ) +
      box('Who is working on billing now', '', rows) +
      box('Collision hot spots', '', hot)
    );
  },
  journey: (f) => {
    const steps = [
      [
        stamp(JOURNEY.start).time,
        `Picked up by ${JOURNEY.agent}, a session of @${ownerOf(JOURNEY.agent)}`,
      ],
      [stamp(JOURNEY.start + 0.6).time, 'Committed its change, 2 files'],
      [stamp(JOURNEY.land - 0.05).time, 'Pre-land check passed on the merged tree'],
      [stamp(JOURNEY.land).time, `Landed on the sprout as #${JOURNEY.n}`],
      [stamp(JOURNEY.land + 0.5).time, 'Validated with its batch: on the stalk'],
    ];
    const shown = Math.min(steps.length, 1 + Math.floor(f.shownFor / 450));
    const list = steps
      .slice(0, f.shownFor > 1e8 ? steps.length : shown)
      .map(
        ([time, text], i) =>
          `<li class="${i === shown - 1 && f.shownFor < 1e8 ? 'arrive' : ''}${i >= 3 ? ' ok' : ''}"><span>${time}</span>${esc(text)}</li>`,
      )
      .join('');
    return (
      chips(['billing/coupons.ts', 'beans that changed it'], ['Bean journey', 'Diff']) +
      head(
        `${JOURNEY.id} changed billing/coupons.ts: ${JOURNEY.title.toLowerCase()}.`,
        `Pushed by ${JOURNEY.agent} for @${ownerOf(JOURNEY.agent)}; validated on the stalk ${ago(JOURNEY.land)}.`,
      ) +
      box(
        `<span class="chip leafchip"><i class="lfm"></i>bean/${slug(JOURNEY.title)} #${JOURNEY.n}</span>`,
        '',
        `<ol class="j-steps">${list}</ol>${shown >= 4 || f.shownFor > 1e8 ? '<div class="hunk"><div class="h">billing/coupons.ts</div><div class="d">-  if (coupon.kind !== \'percent\') return coupon.value;</div><div class="a">+  if (coupon.kind !== \'percent\') return Math.min(coupon.value, subtotal);</div></div>' : ''}`,
      )
    );
  },
  replay: (f) => {
    const sub =
      f.replayed || !f.replaying
        ? `Back at today: ${LANDINGS.length} beans landed in the last 7 days, ${FELL.length} fell off.`
        : `${clockOf(f.h)}: ${f.landed - OLDER} of ${LANDINGS.length} landed since seven days ago.`;
    return (
      chips(
        ['last 7 days', 'beans, landings, decisions'],
        ['Stalk replay', 'Growing now', 'What happened'],
      ) +
      head('Replaying last week on beanstalk-shop.', sub) +
      growing(f) +
      happened(f)
    );
  },
};

function statusLine(f) {
  const people = f.flying.length
    ? `1 person, ${f.flying.length} sessions active`
    : 'no sessions active';
  return [
    `<span><i class="dot ${f.red ? 'red' : 'leaf'}"></i>sprout #${f.landed - 1}</span>`,
    `<span><i class="dot leaf"></i>stalk #${f.stalk - 1}</span>`,
    `<span class="${f.red ? 'red' : ''}">sprout ${f.red ? 'red' : 'green'}</span>`,
    `<span><i class="dot bean"></i>${f.flying.length} beans growing</span>`,
    `<span class="opt">${people}</span>`,
    '<span class="sp"></span>',
    `<span class="opt">${f.replaying ? 'replaying' : 'live'}</span>`,
    `<span>${clockOf(f.h)}</span>`,
  ].join('');
}

/* ---------- The repository's pages (Changes, History, People, Settings) ---------- */

/** The page glyphs, as the app draws them. */
const GLYPH = {
  stalk: '<i class="pg pg-stalk"></i>',
  sprout: '<i class="pg pg-sprout"></i>',
  bean: '<i class="pg pg-bean"></i>',
  checking: '<i class="pg pg-bean pg-live"></i>',
  red: '<i class="pg pg-red"></i>',
  seed: '<i class="pg pg-seed"></i>',
};

/** A red bean of this morning, sent back with what it collided with. */
const RED_TODAY = {
  id: 't041',
  agent: 'a8',
  title: 'Email customers about overdue invoices',
  failing: 'billing/overdue.test.ts › lists invoices 30 days past due',
  collided: LANDINGS.at(-1),
};

/** Steps of a page's animation: how many of `count` items show at `local`, one every `every` ms. */
const upTo = (local, count, every, from = 0) =>
  Math.max(0, Math.min(count, Math.floor((local - from) / every) + 1));

function changeRow(c, i, shown) {
  const cls = `pc-row${i === shown - 1 ? ' arrive' : ''}${c.leaving ? ' leaving' : ''}`;
  const why = c.failing
    ? `<ul class="pc-why"><li>✗ ${esc(c.failing)}</li><li>collided with ${esc(c.collided)}</li></ul>`
    : '';
  return `<div class="${cls}">${GLYPH[c.glyph]}<b class="pc-title">${esc(c.title)}</b><span class="pc-state" data-state="${c.state}">${c.stateText}</span><div class="pc-meta"><span class="pc-bean">bean/${slug(c.title)}</span><span>by <b>@${c.person}</b></span><span>${c.when}</span></div>${why}</div>`;
}

/** Open beans this morning, and the one that lands while the page is open. */
function openChanges(landedNow) {
  const flying = TODAY_BEANS.map((b) => ({
    title: b.title,
    person: ownerOf(b.agent),
    glyph: b.id === 't040' && landedNow ? 'sprout' : 'checking',
    state: b.id === 't040' && landedNow ? 'landed' : 'checking',
    stateText: b.id === 't040' && landedNow ? 'on the sprout' : 'in check',
    when: `${Math.round((WEEK_HOURS - b.start) * 60)} minutes ago`,
    leaving: b.id === 't040' && landedNow,
  }));
  return [
    ...flying,
    {
      title: RED_TODAY.title,
      person: ownerOf(RED_TODAY.agent),
      glyph: 'red',
      state: 'red',
      stateText: 'red',
      when: '12 minutes ago',
      failing: RED_TODAY.failing,
      collided: `bean/${slug(RED_TODAY.collided.title)} (#${RED_TODAY.collided.n})`,
    },
  ];
}

function landedChanges(withNew) {
  const rows = LANDINGS.toReversed()
    .slice(0, withNew ? 4 : 5)
    .map((l) => ({
      title: l.title,
      person: ownerOf(l.agent),
      glyph: 'stalk',
      state: 'validated',
      stateText: 'on the stalk',
      when: ago(l.land),
    }));
  if (withNew)
    rows.unshift({
      title: TODAY_BEANS[2].title,
      person: ownerOf(TODAY_BEANS[2].agent),
      glyph: 'sprout',
      state: 'landed',
      stateText: 'on the sprout',
      when: 'just now',
    });
  return rows;
}

/** The open count on the Changes tab: beans in check, red or waiting. */
function openCount(tab, local) {
  return tab === 'changes' && local >= CHANGES_LAND ? 3 : 4;
}
const CHANGES_LAND = 3400;
const CHANGES_SWITCH = 5000;

const PAGES = {
  changes: (f) => {
    const landedNow = f.local >= CHANGES_LAND;
    const onLanded = f.local >= CHANGES_SWITCH;
    const counts = {
      open: landedNow ? 3 : 4,
      landed: LANDINGS.length + Number(landedNow),
      parked: FELL.length,
    };
    let rows = onLanded ? landedChanges(true) : openChanges(landedNow);
    const shown = onLanded
      ? upTo(f.local, rows.length, 220, CHANGES_SWITCH)
      : upTo(f.local, rows.length, 320);
    rows = rows.slice(0, shown);
    const pill = (id, name) =>
      `<span class="pc-pill${(id === 'landed') === onLanded && id !== 'parked' ? ' on' : ''}">${name}<span>${counts[id]}</span></span>`;
    return `<div class="pg-page"><div class="pc-bar">${pill('open', 'Open')}${pill('landed', 'Landed')}${pill('parked', 'Parked')}<span class="pc-live"><i></i>Live</span></div><section class="pg-box pc-list">${rows.map((c, i) => changeRow(c, i, shown)).join('')}</section></div>`;
  },
  history: (f) => {
    const validated = f.local >= 3600;
    const pending = LANDINGS.slice(-2).toReversed();
    const stalk = LANDINGS.toReversed().slice(validated ? 0 : 2, validated ? 5 : 5);
    const commit = (l, glyph, cls, chip) =>
      `<li class="ph-row${cls}">${GLYPH[glyph]}<div><b class="ph-title">${esc(l.title)}</b><div class="pc-meta"><b>@${ownerOf(l.agent)}</b><span class="pc-bean">bean/${slug(l.title)}</span><span>${ago(l.land)}</span></div></div><span class="ph-side"><span class="pc-state" data-state="${chip[0]}">${chip[1]}</span><code>${sha(l.n)}</code></span></li>`;
    const shownPending = validated ? 0 : upTo(f.local, pending.length, 300);
    const shownStalk = validated ? stalk.length : upTo(f.local, stalk.length, 260, 700);
    const pendingBox = validated
      ? ''
      : `<section class="pg-box ph-pending"><header>${GLYPH.sprout}<h4>On the sprout, not validated yet</h4><span>2 commits</span></header><ol>${pending
          .slice(0, shownPending)
          .map((l, i) =>
            commit(l, 'sprout', i === shownPending - 1 ? ' arrive' : '', [
              'landed',
              'landed, not validated yet',
            ]),
          )
          .join('')}</ol></section>`;
    const fresh = validated && f.local < 5400;
    const stalkRowsHtml = stalk
      .slice(0, shownStalk)
      .map((l, i) => {
        let cls = !validated && i === shownStalk - 1 ? ' arrive' : '';
        if (fresh && i < 2) cls = ' arrive fresh';
        return commit(l, 'stalk', cls, ['validated', 'validated']);
      })
      .join('');
    const commits = OLDER + LANDINGS.length - (validated ? 0 : 2) + 1;
    return `<div class="pg-page">${pendingBox}<section class="pg-box"><header>${GLYPH.stalk}<h4>The stalk</h4><span>${commits} commits</span></header><ol>${stalkRowsHtml}<li class="ph-row ph-more"><span></span><div>${commits - stalk.length - 1} more commits</div></li><li class="ph-row">${GLYPH.seed}<div><b class="ph-plain">Start from the TypeScript starter</b><div class="pc-meta"><span>Fertilized by coop</span><span>34 days ago</span></div></div><span class="ph-side"><code>${sha(0)}</code></span></li></ol></section></div>`;
  },
  people: (f) => {
    const roles = [
      ['coop', 'owner', 'Everything, including settings and deletion.', 'since 34 days ago'],
      [
        'dana',
        'maintain',
        'Also answer decision cards and manage deploy tokens.',
        'since 30 days ago',
      ],
      ['ike', 'write', 'Also push beans.', 'since 21 days ago'],
      ['mira', 'write', 'Also push beans.', 'since 9 days ago'],
    ];
    const pushed = f.local >= 4200;
    const sessions = [
      ['coop', 'a2 Claude Code', 'session', 'just now', '1 hour ago', 41],
      [
        'coop',
        'a5 Claude Code',
        'cloud session',
        'just now',
        pushed ? 'just now' : '2 days ago',
        pushed ? 18 : 17,
      ],
      ['dana', 'a7 Codex', 'session', 'just now', 'yesterday', 23],
      ['ike', 'a10 Codex', 'cloud session', '2 hours ago', '2 days ago', 15],
      ['mira', 'ci', 'deploy token', 'yesterday', 'never', 0],
    ];
    const r = upTo(f.local, roles.length, 260);
    const s = upTo(f.local, sessions.length, 260, 1300);
    return `<div class="pg-page pg-narrow"><section class="pg-box pp-box"><h4>Who has access</h4><p>You are <b>owner</b>: everything, including settings and deletion. <u>Manage people in Settings</u>.</p><div class="pp-list">${roles
      .slice(0, r)
      .map(
        ([who, role, what, since], i) =>
          `<div class="pp-person${i === r - 1 ? ' arrive' : ''}"><div><b>@${who}</b><span class="pp-role">${role}</span><small>${what}</small></div><span>${since}</span></div>`,
      )
      .join(
        '',
      )}</div></section><section class="pg-box pp-box"><h4>Sessions and tokens</h4><p>Every agent session, token and key acts for a person. These reached coop/beanstalk-shop lately.</p><table><thead><tr><th>For</th><th>Through</th><th>Last read</th><th>Last push</th><th>Pushes</th></tr></thead><tbody>${sessions
      .slice(0, s)
      .map(
        ([who, through, kind, read, push, n], i) =>
          `<tr class="${i === s - 1 ? 'arrive' : ''}${i === 1 && pushed && f.local < 5600 ? ' flash' : ''}"><td>@${who}</td><td>${through} <span>${kind}</span></td><td>${read}</td><td>${push}</td><td>${n}</td></tr>`,
      )
      .join('')}</tbody></table></section></div>`;
  },
  settings: (f) => {
    const sections = `<section class="pg-box ps-box"><h4>General</h4><label>Name</label><div class="ps-name"><span>coop /</span><span class="ps-input">beanstalk-shop</span></div><small>Renaming changes the URL and the clone URL; the history stays.</small><label>Description</label><span class="ps-input ps-wide">A small shop: catalog, cart, checkout and billing.</span><span class="ps-btn primary">Save changes</span></section>
      <section class="pg-box ps-box"><h4>Visibility</h4><div class="ps-radio on"><i></i><div><b>Private</b><small>Only you and the people you invite can see it.</small></div></div><div class="ps-radio"><i></i><div><b>Public</b><small>Anyone, signed in or not, can read and clone it. Pushing still needs a role.</small></div></div><span class="ps-btn">Change visibility</span></section>
      <section class="pg-box ps-box"><div class="ps-head"><h4>Checks</h4><code>.beanstalk/checks.toml on stalk</code></div><dl class="ps-facts"><dt>Runs</dt><dd><code>node --test</code></dd><dt>Image</dt><dd>node (Node 25.8.1; nothing is installed at check time)</dd><dt>Time limit</dt><dd>120 s</dd><dt>Environment</dt><dd><code>none</code></dd><dt>Protected</dt><dd><code>.beanstalk/**</code></dd></dl><small>▸ The file</small></section>
      <section class="pg-box ps-box"><h4>Collaborators</h4><p>Invite people by their Beanstalk handle. <b>read</b>: clone, fetch and view. <b>write</b>: also push beans. <b>maintain</b>: also answer decision cards and manage deploy tokens.</p>${[
        ['dana', 'maintain'],
        ['ike', 'write'],
        ['mira', 'write'],
      ]
        .map(
          ([who, role]) =>
            `<div class="ps-collab"><b>@${who}</b><span class="ps-input ps-sel">${role}</span><span class="ps-btn">Change role</span><span class="ps-btn danger">Remove</span></div>`,
        )
        .join('')}</section>
      <section class="pg-box ps-box"><h4>Deploy tokens</h4><p>For CI and other machines: one token opens this repository only, read or read and write, until it expires.</p><div class="ps-collab"><b>ci</b><span>read, expires in 61 days</span><span class="ps-btn danger">Revoke</span></div></section>
      <section class="pg-box ps-box ps-danger"><h4>Delete this repository</h4><p>Deleting removes its history, beans and decisions for good. Agents connected to it lose access at once.</p><span class="ps-btn danger">Delete coop/beanstalk-shop</span></section>`;
    // The page scrolls down through its sections, as a person reading it would.
    const t = Math.min(1, Math.max(0, (f.local - 1200) / 5600));
    const eased = t * t * (3 - 2 * t);
    return `<div class="pg-page pg-narrow ps-scroll" style="--scroll:${eased.toFixed(3)}">${sections}</div>`;
  },
};

/* ---------- Drawing ---------- */

function setupAppDemo() {
  const app = document.querySelector('[data-appdemo]');
  if (!app) return;
  const $ = (name) => app.querySelector(`[data-d-${name}]`);
  const el = {
    tabs: $('tabs'),
    page: $('page'),
    rows: $('rows'),
    count: $('count'),
    progress: $('progress'),
    week: $('week'),
    scale: $('scale'),
    clock: $('clock'),
    ask: $('ask'),
    typed: $('typed'),
    ph: $('ph'),
    view: $('view'),
    status: $('status'),
  };
  if (Object.values(el).some((node) => !node)) return;
  const caret = el.ask.querySelector('.caret');
  const pct = (day) => `${((day / LIFE_DAYS) * 100).toFixed(2)}%`;
  el.week.style.left = pct(WEEK_FROM_DAY);
  el.scale.innerHTML = `<span style="left:0">Day 0</span><span class="minus7" style="left:${pct(WEEK_FROM_DAY)}">−7 days</span>${DAY_NAMES.slice(
    1,
    5,
  )
    .map(
      (name, i) => `<span class="tick" style="left:${pct(WEEK_FROM_DAY + i + 1)}">${name}</span>`,
    )
    .join('')}<span style="right:0">today</span>`;
  el.tabs.innerHTML = TABS.map(
    (tab) =>
      `<button type="button" data-tab="${tab.id}" aria-pressed="false">${tab.label}${tab.id === 'changes' ? '<span class="tabcount" data-d-open>4</span>' : ''}</button>`,
  ).join('');
  const openEl = el.tabs.querySelector('[data-d-open]');
  const overlay = document.createElement('div');
  overlay.className = 'links';
  el.rows.append(overlay);
  const list = document.createElement('div');
  el.rows.prepend(list);
  const panels = Object.fromEntries(
    Object.keys(PANELS).map((id) => {
      const panel = document.createElement('div');
      panel.className = 'd-panel';
      el.view.append(panel);
      return [id, panel];
    }),
  );
  const setHtml = (node, html) => {
    if (node.dataset.html !== html) {
      node.innerHTML = html;
      node.dataset.html = html;
    }
  };
  let instant = false;
  let prevKey = '';
  let prevTab = '';

  const draw = (tab, local) => {
    const f = frameAt(tab, local);
    const key = `${tab}|${f.show}|${f.typed.length}|${Math.floor(f.h * 4)}|${Math.floor(Math.min(f.shownFor, 1e7) / 100)}|${Math.floor(local / 50)}`;
    if (key === prevKey) return;
    prevKey = key;
    const view = TABS.find((t) => t.id === tab)?.view ?? 'explorer';
    if (tab !== prevTab) {
      prevTab = tab;
      app.dataset.tab = tab;
      app.dataset.view = view;
      for (const button of el.tabs.querySelectorAll('[data-tab]')) {
        if (!(button instanceof HTMLElement)) continue;
        const on = button.dataset.tab === tab;
        button.setAttribute('aria-pressed', String(on));
        // On a narrow screen the tabs scroll sideways: keep the current one in view.
        const { offsetLeft, offsetWidth } = button;
        if (
          on &&
          (offsetLeft < el.tabs.scrollLeft ||
            offsetLeft + offsetWidth > el.tabs.scrollLeft + el.tabs.clientWidth)
        )
          el.tabs.scrollLeft = offsetLeft - 12;
      }
      el.rows.scrollTop = 0;
    }
    if (openEl) openEl.textContent = String(openCount(tab, local));
    if (view === 'page') {
      setHtml(el.page, PAGES[tab](f));
      return;
    }
    el.typed.textContent = f.typed;
    el.ph.hidden = f.typed.length > 0;
    if (caret instanceof HTMLElement) caret.hidden = !f.focus;
    el.ask.classList.toggle('focus', f.focus);
    app.classList.toggle('playing', f.replaying);
    el.progress.style.width = pct(WEEK_FROM_DAY + f.h / 24);
    el.clock.textContent = clockOf(f.h);
    el.count.textContent = `${f.landed} landed, ${f.flying.length} growing`;
    const { rows, links } = stalkRows(f);
    reconcile(list, rows);
    drawLinks(list, overlay, links);
    el.rows.classList.toggle('validating', Boolean(f.fresh) && f.h - f.fresh.at < 0.3);
    // Asked about a bean further down the stalk: bring it into view.
    const focusN = { red: CULPRIT.n, journey: JOURNEY.n }[f.show] ?? null;
    const target = focusN === null ? null : list.querySelector(`[data-key="l-${focusN}"]`);
    const top = target ? Math.max(0, target.offsetTop - 120) : 0;
    if (Math.abs(el.rows.scrollTop - top) > 2)
      el.rows.scrollTo({ top, behavior: instant ? 'instant' : 'smooth' });
    for (const [id, panel] of Object.entries(panels)) {
      const on = id === f.show;
      panel.classList.toggle('on', on);
      // Only rewrite a panel when its content changed, so rows that grew in stay put.
      if (on) setHtml(panel, PANELS[id](f));
    }
    setHtml(el.status, statusLine(f));
  };

  const query = new URLSearchParams(location.search);
  const frozen = Number(query.get('demo'));
  const frozenTab = TABS.find((tab) => tab.id === query.get('tab'));
  const isFrozen = Boolean(frozenTab) || (Number.isFinite(frozen) && frozen > 0);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  /** A tab's finished frame: the Code view's is today after the replay. */
  const endOf = (id) =>
    id === 'code' ? REPLAY_END : (TABS.find((tab) => tab.id === id)?.ms ?? 1) - 1;

  /** The tour: the current tab, the time into it, and until when a click pins it. */
  const state = { index: 0, local: 0, pinnedUntil: 0 };

  if (isFrozen) {
    instant = true;
    if (frozenTab)
      draw(frozenTab.id, Number.isFinite(frozen) && frozen > 0 ? frozen : endOf(frozenTab.id));
    else {
      const at = tourAt(frozen);
      draw(at.tab, at.local);
    }
  } else if (reduced.matches) {
    instant = true;
    draw('code', endOf('code'));
  } else draw('code', 0);

  const select = (id) => {
    const index = TABS.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    state.index = index;
    state.local = 0;
    state.pinnedUntil = performance.now() + IDLE_MS;
    prevKey = '';
    if (reduced.matches || isFrozen) {
      instant = true;
      draw(id, endOf(id));
    } else draw(id, 0);
  };
  el.tabs.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-tab]') : null;
    if (button instanceof HTMLElement && button.dataset.tab) select(button.dataset.tab);
  });
  // Any interaction with the preview keeps a pinned tab pinned a while longer.
  for (const type of ['pointerdown', 'keydown', 'wheel', 'focusin']) {
    app.addEventListener(
      type,
      () => {
        if (state.pinnedUntil) state.pinnedUntil = performance.now() + IDLE_MS;
      },
      { passive: true },
    );
  }
  if (isFrozen) return;

  let last = 0;
  let raf = 0;
  let visible = false;
  const loop = (now) => {
    if (last) state.local += Math.min(now - last, 100);
    last = now;
    const tab = TABS[state.index];
    if (state.local >= tab.ms) {
      if (now < state.pinnedUntil) state.local = tab.ms - 1;
      else {
        // The view finished: on to the next tab.
        state.pinnedUntil = 0;
        state.index = (state.index + 1) % TABS.length;
        state.local = 0;
      }
    }
    draw(TABS[state.index].id, state.local);
    raf = requestAnimationFrame(loop);
  };
  const sync = () => {
    const run = visible && !document.hidden && !reduced.matches;
    if (run && !raf) {
      last = 0;
      raf = requestAnimationFrame(loop);
    }
    if (!run && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    if (reduced.matches) {
      instant = true;
      draw(TABS[state.index].id, endOf(TABS[state.index].id));
    }
  };
  new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    sync();
  }).observe(app);
  document.addEventListener('visibilitychange', sync);
  reduced.addEventListener('change', sync);
}

setupAppDemo();
