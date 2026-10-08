// The hero's app preview: an HTML recreation of a repository, with the product's tabs (Code,
// Changes, History, Ask, People, Settings). A tour plays each tab's view and moves on when it
// finishes; clicking a tab pins it until the preview is left alone for a while. History rewinds
// the stalk seven days and grows it back through an irregular week generated from a fixed seed;
// Ask types three questions in turn and the stalk reacts to each answer. Every frame is a pure
// function of the tab and the time into it: reduced motion shows each tab's finished frame, and
// `?tab=<id>&demo=<ms>` (or `?demo=<ms>` into the tour) freezes the preview (for screenshots).

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

/* ---------- The tabs and their scripts ---------- */

const TYPE_MS = 46;
const ERASE_MS = 14;
const ASKS = [
  { id: 'coupons', q: 'What changed on coupons this week?' },
  { id: 'red', q: `Why is #${CULPRIT.n} red?` },
  { id: 'billing', q: "Who's working on billing right now?" },
];
const REPLAY_MS = 9500;

/** The Ask tab: each question is typed, answered, then erased for the next. */
const ASK_SEGMENTS = [{ kind: 'idle', ms: 1400, show: 'askstart' }];
{
  let showing = 'askstart';
  for (const stop of ASKS) {
    const prev = ASK_SEGMENTS.at(-1);
    if (prev.q)
      ASK_SEGMENTS.push({
        kind: 'erase',
        q: prev.q,
        ms: prev.q.length * ERASE_MS + 150,
        show: showing,
      });
    ASK_SEGMENTS.push({ kind: 'type', q: stop.q, ms: stop.q.length * TYPE_MS, show: showing });
    ASK_SEGMENTS.push({ kind: 'think', q: stop.q, ms: 360, show: showing });
    showing = stop.id;
    ASK_SEGMENTS.push({ kind: 'answer', q: stop.q, ms: 4400, show: stop.id });
  }
  let cursor = 0;
  for (const seg of ASK_SEGMENTS) {
    seg.from = cursor;
    cursor += seg.ms;
  }
}
const ASK_MS = ASK_SEGMENTS.at(-1).from + ASK_SEGMENTS.at(-1).ms;

/** The preview's tabs, in the product's order; the tour plays each one, then moves on. */
const TABS = [
  { id: 'code', label: 'Code', ms: 5200 },
  { id: 'changes', label: 'Changes', ms: 6200 },
  { id: 'history', label: 'History', ms: REPLAY_MS + 2600 },
  { id: 'ask', label: 'Ask', ms: ASK_MS },
  { id: 'people', label: 'People', ms: 5600 },
  { id: 'settings', label: 'Settings', ms: 5200 },
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
  let typed = '';
  let focus = false;
  let show = tab;
  let shownFor = local;
  let h = WEEK_HOURS;
  let replaying = false;
  if (tab === 'ask') {
    const seg = ASK_SEGMENTS.findLast((s) => s.from <= local) ?? ASK_SEGMENTS[0];
    const into = local - seg.from;
    typed = seg.q ?? '';
    if (seg.kind === 'type') typed = seg.q.slice(0, Math.floor(into / TYPE_MS));
    if (seg.kind === 'erase')
      typed = seg.q.slice(0, Math.max(0, seg.q.length - Math.floor(into / ERASE_MS)));
    if (seg.kind === 'idle') typed = '';
    focus = seg.kind === 'type' || seg.kind === 'think' || seg.kind === 'erase';
    show = seg.show;
    shownFor = seg.kind === 'answer' ? into : 1e9;
  }
  if (tab === 'history') {
    replaying = local < REPLAY_MS;
    h = replaying ? hourAt(local / REPLAY_MS) : WEEK_HOURS;
    show = 'replay';
  }
  return {
    tab,
    local,
    typed,
    focus,
    show,
    shownFor,
    replaying,
    replayed: tab === 'history' && !replaying,
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
const FOCUSED = new Set(['coupons', 'red', 'billing']);

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
  if (!links) {
    overlay.innerHTML = '';
    return;
  }
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
  const html = paths.length ? `<svg width="100%" height="100%">${paths.join('')}</svg>` : '';
  if (overlay.innerHTML !== html) overlay.innerHTML = html;
}

/* ---------- The panels ---------- */

function box(title, note, body) {
  return `<section class="d-box"><header><b>${title}</b>${note}</header>${body}</section>`;
}

function chips(searched, picked) {
  return `<div class="d-picked"><span class="lbl">searched</span>${searched.map((s) => `<span class="chip">${esc(s)}</span>`).join('')}<span class="sep"></span><span class="lbl">picked</span>${picked.map((p, i) => `<span class="chip"><b>${i + 1}</b>${esc(p)}</span>`).join('')}<span class="chip jev">Jev, 0.4 s</span></div>`;
}

function head(title, sub) {
  return `<h3 class="d-answer">${esc(title)}</h3><p class="d-sub">${esc(sub)}</p>`;
}

/** Rows that appear one by one: `shown` of them, the newest one growing in. */
function reveal(rows, f, every) {
  const shown = Math.min(rows.length, 1 + Math.floor(f.shownFor / every));
  return rows
    .slice(0, shown)
    .map((row, i) =>
      i === shown - 1 && f.shownFor < rows.length * every + every
        ? row.replace('class="', 'class="arrive ')
        : row,
    )
    .join('');
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
    ['shipping/', 'Require a signature for high-value deliveries', 0],
  ]
    .map(
      ([dir, title, fly]) =>
        `<div class="f-row"><span class="fn">${dir}</span><span class="fb"><i class="lfm"></i>${esc(title)}</span>${fly ? `<span class="chip fly">${fly} in flight</span>` : '<span></span>'}</div>`,
    )
    .join('');
  return box('Files', 'src, on the stalk', rows);
}

const PEOPLE = [
  { who: 'coop', role: 'owner', sessions: ['a2 Claude Code, local', 'a5 Claude Code, cloud'] },
  { who: 'dana', role: 'maintain', sessions: ['a7 Codex, local'] },
  { who: 'ike', role: 'write', sessions: ['a10 Codex, cloud'] },
  { who: 'mira', role: 'write', sessions: ['a3 Cursor, local'] },
];

const PANELS = {
  code: (f) => growing(f) + happened(f) + files(),
  changes: (f) => {
    const flying = f.flying.map(
      (b) =>
        `<div class="g-row ${b.status}"><span class="a">${b.agent}</span><span class="t">${esc(b.title)}</span><span class="s"><i class="spin"></i>${b.status}</span></div>`,
    );
    const landed = LANDINGS.toReversed()
      .slice(0, 4)
      .map(
        (l) =>
          `<div class="f-row ch-row"><span class="fb"><i class="lfm"></i>${esc(l.title)}</span><span class="chip leafchip">${l.id} #${l.n}</span><span class="fstat">${stamp(l.land).day}</span></div>`,
      );
    const fell = FELL.map(
      (x) =>
        `<div class="f-row ch-row fell"><span class="fb">${esc(x.title)}</span><span class="chip">${x.id}</span><span class="fstat">${esc(x.reason)}</span></div>`,
    );
    const rows = [...flying, ...landed, ...fell];
    const shown = reveal(rows, f, 260);
    return (
      `<div class="d-tabhead"><b>Changes</b><span class="chip fly">${f.flying.length} growing</span><span class="chip leafchip">${LANDINGS.length} landed</span><span class="chip">${FELL.length} fell</span></div>` +
      box('Beans', 'newest first', shown)
    );
  },
  replay: (f) => {
    const sub = f.replayed
      ? `Back at today: ${LANDINGS.length} beans landed in the last 7 days, ${FELL.length} fell off.`
      : `${clockOf(f.h)}: ${f.landed - OLDER} of ${LANDINGS.length} landed since seven days ago.`;
    return (
      `<div class="d-tabhead"><b>History</b><span class="chip">last 7 days</span><span class="chip leafchip">${f.stalk - 1 - (OLDER - 1)} validated</span></div>` +
      head('Last week on beanstalk-shop, replayed.', sub) +
      growing(f) +
      happened(f)
    );
  },
  askstart: () =>
    `<div class="d-tabhead"><b>Ask</b><span class="chip jev">Jev picks the view</span></div>` +
    box(
      'Try asking',
      '',
      ASKS.map(
        (a) =>
          `<div class="f-row ask-sugg"><span class="q">?</span><span class="fb">${esc(a.q)}</span><span></span></div>`,
      ).join(''),
    ),
  coupons: (f) => {
    const found = Math.min(COUPON_BEANS.length, Math.floor(f.shownFor / 380));
    const paths = [
      'billing/coupons.ts',
      'billing/checkout.ts',
      'billing/coupon-cap.test.ts',
      'db/coupon_max.ts',
      'billing/discounts.ts',
    ];
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
        `${Math.min(found, COUPON_BEANS.length)} of ${COUPON_BEANS.length} found`,
        list + (found ? diff : ''),
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
  people: (f) => {
    const rows = PEOPLE.map((p) => {
      const sessions = p.sessions
        .map((s) => {
          const [agent, ...rest] = s.split(' ');
          const bean = f.flying.find((b) => b.agent === agent);
          return `<span class="ps"><b>${agent}</b>${esc(rest.join(' '))}<i class="dot ${bean ? 'bean' : 'idle'}"></i>${bean ? bean.status : 'idle'}</span>`;
        })
        .join('');
      return `<div class="p-row"><span class="pw"><i class="av">${p.who[0]}</i>${p.who}<small>${p.role}</small></span><span class="pss">${sessions}</span></div>`;
    });
    return (
      `<div class="d-tabhead"><b>People</b><span class="chip">${PEOPLE.length} people</span><span class="chip fly">${PEOPLE.reduce((n, p) => n + p.sessions.length, 0)} sessions</span></div>` +
      box('People and their agent sessions', 'every agent is someone’s', reveal(rows, f, 420))
    );
  },
  settings: (f) => {
    const checks = [
      ['test', 'pnpm test', 'every bean, on the merged tree'],
      ['typecheck', 'pnpm typecheck', 'every bean'],
      ['stalk', 'pnpm test:e2e', 'each stalk check, in batches'],
    ]
      .map(
        ([name, cmd, when]) =>
          `<div class="f-row"><span class="fn">${name}</span><code class="cmd-c">${cmd}</code><span class="fstat">${when}</span></div>`,
      )
      .join('');
    const general = [
      ['Name', 'beanstalk-shop'],
      ['Visibility', 'private'],
      ['Collaborators', 'coop, dana, ike, mira'],
      ['Deploy tokens', '1 active'],
    ]
      .map(
        ([k, v]) =>
          `<div class="f-row"><span class="fn">${k}</span><span class="fb">${esc(v)}</span><span></span></div>`,
      )
      .join('');
    const soon = `<div class="f-row"><span class="fn">Automations</span><span class="fb">Becoming Actions</span><span class="chip soon">soon</span></div>`;
    const parts = [
      box('General', '', general),
      box('Checks', '.beanstalk/checks.toml, changed by a bean', checks),
      box('Actions', '', soon),
    ];
    const shown = Math.min(parts.length, 1 + Math.floor(f.shownFor / 700));
    return (
      `<div class="d-tabhead"><b>Settings</b><span class="chip">owner</span></div>` +
      parts.slice(0, shown).join('')
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

/* ---------- Drawing ---------- */

function setupAppDemo() {
  const app = document.querySelector('[data-appdemo]');
  if (!app) return;
  const $ = (name) => app.querySelector(`[data-d-${name}]`);
  const el = {
    tabs: $('tabs'),
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
  el.tabs.innerHTML =
    TABS.map(
      (tab) =>
        `<button type="button" data-tab="${tab.id}" aria-pressed="false">${tab.label}</button>`,
    ).join('') +
    '<span class="soon-tab" title="Automations are becoming Actions">Actions<span class="chip soon">soon</span></span>';
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
  let instant = false;
  let prevKey = '';
  let prevTab = '';

  const draw = (tab, local) => {
    const f = frameAt(tab, local);
    const key = `${tab}|${f.show}|${f.typed.length}|${Math.floor(f.h * 4)}|${Math.floor(Math.min(f.shownFor, 1e7) / 100)}`;
    if (key === prevKey) return;
    prevKey = key;
    if (tab !== prevTab) {
      prevTab = tab;
      for (const button of el.tabs.querySelectorAll('[data-tab]')) {
        if (button instanceof HTMLElement)
          button.setAttribute('aria-pressed', String(button.dataset.tab === tab));
      }
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
    // Asked why the bean is red: bring it into view.
    const culprit = list.querySelector(`[data-key="l-${CULPRIT.n}"]`);
    const target = f.show === 'red' && culprit ? Math.max(0, culprit.offsetTop - 120) : 0;
    if (Math.abs(el.rows.scrollTop - target) > 2)
      el.rows.scrollTo({ top: target, behavior: instant ? 'instant' : 'smooth' });
    for (const [id, panel] of Object.entries(panels)) {
      const on = id === f.show;
      panel.classList.toggle('on', on);
      // Only rewrite a panel when its content changed, so rows that grew in stay put.
      if (on) {
        const html = PANELS[id](f);
        if (panel.dataset.html !== html) {
          panel.innerHTML = html;
          panel.dataset.html = html;
        }
      }
    }
    const status = statusLine(f);
    if (el.status.dataset.html !== status) {
      el.status.innerHTML = status;
      el.status.dataset.html = status;
    }
  };

  const query = new URLSearchParams(location.search);
  const frozen = Number(query.get('demo'));
  const frozenTab = TABS.find((tab) => tab.id === query.get('tab'));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const endOf = (id) => (TABS.find((tab) => tab.id === id)?.ms ?? 1) - 1;

  /** The tour: the current tab, the time into it, and until when a click pins it. */
  const state = { index: 0, local: 0, pinnedUntil: 0 };
  const current = () => TABS[state.index].id;

  if (frozenTab || (Number.isFinite(frozen) && frozen > 0)) {
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
  } else {
    draw('code', 0);
  }

  const select = (id) => {
    const index = TABS.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    state.index = index;
    state.local = 0;
    state.pinnedUntil = performance.now() + IDLE_MS;
    if (reduced.matches || frozenTab) {
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
  if (frozenTab || (Number.isFinite(frozen) && frozen > 0)) return;

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
    draw(current(), state.local);
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
      draw(current(), endOf(current()));
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
