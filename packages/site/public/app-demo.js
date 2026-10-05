// The hero's app demo: an HTML recreation of the repository home, live today. The player runs
// from Day 0 (the repo's inception) to today, and the demo opens at today with the whole stalk
// grown. A short tour asks three questions; each reshapes the view (what was searched and
// picked, the components, the stalk dimmed to the beans it is about), then clears. Then
// "Replay last week's work" rewinds the stalk to seven days ago and grows it back to today.
// Every frame is a pure function of the elapsed time: reduced motion shows one meaningful
// frame, and `?demo=<ms>` freezes the demo at that time (for screenshots).

/* ---------- The repository's history ---------- */

const LIFE_DAYS = 34;
const WEEK_FROM_DAY = LIFE_DAYS - 7;
const OLDER = 48;

const OLDER_TITLES = [
  'Set up the shop: catalog, cart and checkout',
  'Store prices in cents, never floats',
  'Orders keep a copy of the prices they were placed at',
  'Users can sign up and log in',
  'Invoices get sequential numbers',
  'Coupons: percentage and fixed-amount discounts',
  'Shipping rates by weight and destination',
  'Email the customer when an order ships',
  'Admins can retire products',
  'Paginate product listings',
];

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
const TOTAL = OLDER + WEEK_TITLES.length;
const FELL = {
  [OLDER + 9]: 'Make the invoice payment terms configurable',
  [OLDER + 19]: 'Wholesale customers should not be charged tax',
  [OLDER + 20]: 'Customers want to leave delivery notes',
};
const FELL_IDS = ['t006', 't007', 't010'];
const RED_AT = OLDER + 12;
const DECIDE_AT = OLDER + 24;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

/** Every landing and fall-off of the repo's life, oldest first, each with its day and time. */
const HISTORY = [];
for (let n = 0; n < OLDER; n++) {
  const day = (n / OLDER) * WEEK_FROM_DAY;
  HISTORY.push({
    kind: 'land',
    n,
    title: OLDER_TITLES[n % OLDER_TITLES.length],
    day,
    time: `−${Math.ceil(LIFE_DAYS - day)}d`,
  });
}
const WEEK = [];
for (let i = 0; i < WEEK_TITLES.length; i++) {
  const n = OLDER + i;
  WEEK.push({ kind: 'land', n, title: WEEK_TITLES[i] });
  if (FELL[n]) WEEK.push({ kind: 'fell', title: FELL[n] });
}
for (const [i, item] of WEEK.entries()) {
  const week = (i + 0.5) / WEEK.length;
  const minutes = Math.round(9 * 60 + ((week * 5) % 1) * 8.7 * 60);
  item.day = WEEK_FROM_DAY + week * 7;
  item.label = DAYS[Math.min(4, Math.floor(week * 5))];
  item.time = `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
  HISTORY.push(item);
}

/* ---------- The script: open at today, the tour, then the replay ---------- */

const CHAR_MS = 52;
const TOUR = [
  { id: 'coupons', q: 'What changed on coupons yesterday?' },
  { id: 'red', q: 'Why did the sprout go red?' },
  { id: 'billing', q: "Who's working on billing right now?" },
];
const REPLAY_Q = "Replay last week's work";
const REPLAY_MS = 11000;

/** The demo as consecutive segments; a frame finds its segment and its time within it. */
const SEGMENTS = [{ kind: 'idle', ms: 2200 }];
for (const stop of TOUR) {
  SEGMENTS.push(
    { kind: 'type', q: stop.q, ms: stop.q.length * CHAR_MS },
    { kind: 'think', q: stop.q, id: stop.id, ms: 380 },
    { kind: 'answer', q: stop.q, id: stop.id, ms: 3600 },
    { kind: 'clear', ms: 700 },
  );
}
SEGMENTS.push(
  { kind: 'type', q: REPLAY_Q, ms: REPLAY_Q.length * CHAR_MS },
  { kind: 'think', q: REPLAY_Q, id: 'replay', ms: 380 },
  { kind: 'replay', q: REPLAY_Q, id: 'replay', ms: REPLAY_MS },
  { kind: 'end', q: REPLAY_Q, id: 'replay', ms: 5200 },
);
let at = 0;
for (const seg of SEGMENTS) {
  seg.from = at;
  at += seg.ms;
}
const LOOP_MS = at;
/** When the replay ends: the frame reduced motion holds. */
const REPLAY_END = SEGMENTS.find((s) => s.kind === 'end').from + 1;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const esc = (s) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** The repo as of a week fraction w (0 = seven days ago, 1 = today). */
function repoAt(w) {
  const weekItems = Math.floor(clamp01(w) * WEEK.length);
  const applied = HISTORY.slice(0, OLDER + weekItems);
  const landed = applied.filter((s) => s.kind === 'land').length;
  const weekLanded = landed - OLDER;
  const stalk = w >= 1 ? landed : OLDER + Math.floor(weekLanded / 5) * 5;
  const red = landed > RED_AT && landed < RED_AT + 3;
  const last = applied.at(-1);
  const day = w >= 1 ? LIFE_DAYS : (last?.day ?? WEEK_FROM_DAY);
  return { applied, landed, stalk, red, day, last };
}

/** Everything the frame shows at time t (ms). */
function frameAt(t) {
  const local = ((t % LOOP_MS) + LOOP_MS) % LOOP_MS;
  const seg = SEGMENTS.findLast((s) => s.from <= local) ?? SEGMENTS[0];
  const into = local - seg.from;
  const typing = seg.kind === 'type';
  const typed = typing ? seg.q.slice(0, Math.floor(into / CHAR_MS)) : (seg.q ?? '');
  const shown = seg.kind === 'answer' || seg.kind === 'replay' || seg.kind === 'end';
  const replaying = seg.kind === 'replay';
  const w = replaying ? into / REPLAY_MS : 1;
  const repo = repoAt(w);
  const growing = replaying && w < 0.86 ? 6 : 3;
  return {
    t,
    seg,
    into,
    typed: seg.kind === 'clear' || seg.kind === 'idle' ? '' : typed,
    typing,
    focus: typing || seg.kind === 'think',
    answer: shown ? seg.id : null,
    replaying,
    replayed: seg.kind === 'end',
    w,
    ...repo,
    growing,
    p: repo.day / LIFE_DAYS,
    clock: replaying && repo.last?.label ? `${repo.last.label} ${repo.last.time}` : 'today',
  };
}

/* ---------- The stalk ---------- */

function tipBeans(f) {
  return Array.from({ length: f.growing }, (_, i) => {
    const n = f.landed + i;
    const title =
      WEEK_TITLES[n - OLDER] ??
      ['Customers want saved carts', 'Refunds for partial shipments', 'Bulk-edit product prices'][
        i
      ];
    const phase = (f.t / 900 + i * 0.45) % 3;
    let status = phase < 2.1 ? 'checking' : 'writing';
    if (f.red && i === 0) status = 'reworking';
    return {
      agent: `a${(n * 5) % 12}`,
      title,
      status,
      secs: Math.floor((f.t / 1000 + i * 17) % 110),
    };
  });
}

/** Which rows the current answer is about: they stay bright, the rest dim. */
function relevant(f, item) {
  switch (f.answer) {
    case 'coupons':
      return /coupon/i.test(item.title);
    case 'red':
      return item.n === RED_AT;
    case 'billing':
      return item.bean === true;
    default:
      return true;
  }
}

function leaf(f, item, cls, enter) {
  const side = item.n % 2 ? ' l' : '';
  const hit = relevant(f, item) ? ' hit' : '';
  const red = item.n === RED_AT && f.landed > RED_AT ? ' red' : '';
  return `<div class="srow ${cls}${red}${side}${hit}${enter ? ' enter' : ''}"><span class="tm">${item.time}</span><span class="stem"><i class="lf"></i></span><span class="tt">${esc(item.title)}</span><span class="ix">#${item.n}</span></div>`;
}

/**
 * The stalk's rows. `moment` is the validation that just passed (the batch of sprouts that
 * matured together); `fresh` is true on the frame it passed, when the leaves animate.
 */
function stalkRows(f, prevLanded, moment) {
  const rows = [];
  for (const b of tipBeans(f)) {
    const st = { checking: 'check', writing: 'write', reworking: 'sent back' }[b.status];
    const hit = relevant(f, { title: b.title, bean: true }) ? ' hit' : '';
    rows.push(
      `<div class="srow bean ${b.status}${hit}"><span class="ag">${b.agent}</span><span class="stem"><i class="beanmark"></i></span><span class="tt">${esc(b.title)}</span><span class="st">${st}</span></div>`,
    );
  }
  const newestFirst = f.applied.toReversed();
  for (const s of newestFirst.filter((x) => x.kind === 'land' && x.n >= f.stalk)) {
    rows.push(leaf(f, s, 'sprout', s.n >= prevLanded));
  }
  const above = f.landed - f.stalk;
  rows.push(
    `<div class="pointer"><span></span><span class="stem"></span><span>${above ? `stalk at #${f.stalk - 1}, ${above} on the sprout above` : `stalk at #${f.stalk - 1}`}</span></div>`,
  );
  if (moment) {
    rows.push(
      `<div class="matured-row"><span></span><span class="stem"></span><span>validated at ${moment.clock} · ${moment.to - moment.from} matured</span></div>`,
    );
  }
  let shown = 0;
  let folded = 0;
  for (const s of newestFirst) {
    if (shown > 28) break;
    // Asked why the sprout went red: fold the newer leaves so the culprit is in view.
    const nearRed = s.kind === 'land' ? s.n <= RED_AT + 2 : s.day <= HISTORY[RED_AT + 2].day;
    if (f.answer === 'red' && !nearRed && (s.kind === 'fell' || s.n < f.stalk - 2)) {
      folded++;
      continue;
    }
    if (folded > 0) {
      rows.push(
        `<div class="pointer foldrow"><span></span><span class="stem"></span><span>${folded} newer rows folded</span></div>`,
      );
      folded = 0;
    }
    if (s.kind === 'fell') {
      const hit = f.answer ? '' : ' hit';
      rows.push(
        `<div class="srow fell${hit}"><span class="tm">${s.time}</span><span class="stem"><i class="fl"></i></span><span class="tt">${esc(s.title)}</span><span class="ix">fell</span></div>`,
      );
    } else if (s.n < f.stalk) {
      const matured = moment?.fresh && s.n >= moment.from && s.n < moment.to;
      rows.push(leaf(f, s, matured ? 'stalk matured' : 'stalk', s.n >= prevLanded));
      shown++;
    }
  }
  return rows.join('');
}

/* ---------- The explorer: what was asked, what was picked, the components ---------- */

const ANSWERS = {
  coupons: {
    searched: ['yesterday', 'coupons: paths, content, beans'],
    picked: ['Files + diffs', 'Bean journey'],
    head: '4 beans changed 6 files about coupons yesterday.',
    sub: 'The stalk keeps the coupon beans lit; everything else dims.',
  },
  red: {
    searched: ['validations', 'read sets of the failing test'],
    picked: ['Red-validation card', 'Files'],
    head: `t018 turned the sprout red at #${RED_AT}.`,
    sub: 'Its leaf is marked on the stalk: the culprit, found by read set and bisection.',
  },
  billing: {
    searched: ['in flight now', 'src/billing/*'],
    picked: ['Overlaps + sessions', 'Files'],
    head: '3 sessions are working on billing right now.',
    sub: 'The beans at the tip stay lit: who holds what, and where two of them meet.',
  },
  replay: {
    searched: ['last 7 days', 'beans, landings, decisions'],
    picked: ['Stalk replay', 'Growing now', 'What happened'],
    head: 'Replaying last week on beanstalk-shop.',
    sub: '',
  },
};

function pickedChips(id) {
  const a = ANSWERS[id];
  return `<span class="lbl">searched</span>${a.searched.map((s) => `<span class="chip">${esc(s)}</span>`).join('')}<span class="sep"></span><span class="lbl">picked</span>${a.picked.map((p, i) => `<span class="chip"><b>${i + 1}</b>${esc(p)}</span>`).join('')}<span class="chip jev">Jev, 0.4 s</span>`;
}

function box(title, note, body) {
  return `<section class="d-box"><header><b>${title}</b>${note}</header>${body}</section>`;
}

function growingBox(f) {
  const rows = tipBeans(f)
    .map((b) => {
      const time = `${Math.floor(b.secs / 60)}:${String(b.secs % 60).padStart(2, '0')}`;
      const label = b.status === 'reworking' ? 'back to its author' : `${b.status} ${time}`;
      return `<div class="g-row ${b.status}"><span class="a">${b.agent}</span><span class="t">${esc(b.title)}</span><span class="s"><i class="spin"></i>${label}</span></div>`;
    })
    .join('');
  return box('Growing now', `${f.growing} beans in flight`, rows);
}

function happenedBox(f) {
  const events = [];
  if (f.landed > DECIDE_AT) {
    events.push(
      `<div class="ev"><span class="ic decide">◆</span><div><b>D001: two specs clashed</b><span>coop kept "Show thousands separators in displayed amounts". Humans resolve real disagreements.</span></div></div>`,
    );
  }
  if (f.landed > RED_AT) {
    events.push(
      `<div class="ev"><span class="ic red">×</span><div><b>The sprout went red at #${RED_AT}</b><span>tracking-email.test.ts failed. Bisecting named t018 and sent it back to its author; green again 3.4 min later.</span></div></div>`,
    );
  }
  const fellCount = f.applied.filter((s) => s.kind === 'fell').length;
  if (fellCount > 0) {
    events.push(
      `<div class="ev"><span class="ic fell">·</span><div><b>${fellCount} bean${fellCount > 1 ? 's' : ''} fell off</b><span>${FELL_IDS.slice(0, fellCount).join(', ')} (conflict)</span></div></div>`,
    );
  }
  return box(
    'What happened',
    '',
    events.join('') || '<div class="g-empty">A quiet week so far.</div>',
  );
}

const FILES = [
  ['billing', 'Finance needs a list of overdue invoices', 3],
  ['cart', 'Carts accept more units than are in stock', 1],
  ['catalog', 'Make product filtering a pure function', 0],
  ['notifications', 'Customers should get a receipt when paid', 1],
  ['orders', 'A failed checkout leaves stock reserved', 0],
];

function filesBox() {
  const rows = FILES.map(
    ([dir, title, fly]) =>
      `<div class="f-row"><span class="fn">${dir}/</span><span class="fb"><i class="lfm"></i>${esc(title)}</span>${fly ? `<span class="chip fly">${fly} in flight</span>` : '<span></span>'}</div>`,
  ).join('');
  return box('Files', 'src', rows);
}

const DIFF = [
  ['h', '@@ -13,5 +13,5 @@'],
  ['', ' export function couponDiscount(coupon: Coupon, subtotal: Cents): Cents {'],
  ['d', "-  if (coupon.kind !== 'percent') return coupon.value;"],
  ['a', "+  if (coupon.kind !== 'percent') return Math.min(coupon.value, subtotal);"],
  ['', '   const discount = percentOf(subtotal, coupon.value);'],
];

function couponView() {
  const files = [
    ['billing/coupons.ts', 't038 #80', '+1 −1'],
    ['billing/checkout-coupons.ts', 't040 #78', '+9 −2'],
    ['billing/coupon-cap.test.ts', 't038 #80', '+23 −0'],
    ['db/migrations/0007_coupon_max_discount.ts', 't024 #76', '+9 −0'],
  ];
  const diff = DIFF.map(([k, line]) => `<div class="${k}">${esc(line)}</div>`).join('');
  return box(
    'Files',
    '6 files, changes yesterday',
    files
      .map(
        ([path, bean, stat], i) =>
          `<div class="f-row"><span class="fn">${path}</span><span class="chip leafchip"><i class="lfm"></i>${bean}</span><span class="fstat">${stat}</span></div>${i === 0 ? `<div class="hunk">${diff}</div>` : ''}`,
      )
      .join(''),
  );
}

function redView() {
  return box(
    '✕ Red validation R001',
    `at #${RED_AT} · green again 3.4 min later`,
    `<div class="card"><p><code>tracking-email.test.ts</code> failed when the sprout was validated. The forge recorded what every bean read, so only 5 beans were suspects; bisecting them named <b>t018</b>.</p>
      <div class="steps"><div><b>5:23</b>went red</div><div><b>5 suspects</b>by read set</div><div><b>t018</b>the culprit</div><div><b>8:48</b>green again</div></div></div>`,
  );
}

function billingView(f) {
  const beans = tipBeans(f).slice(0, 3);
  const rows = beans
    .map(
      (b, i) =>
        `<div class="g-row ${b.status}"><span class="a">${b.agent}</span><span class="t">${esc(b.title)}<small>${['service.ts, handlers.ts', 'service.ts, types.ts', 'handlers.ts, routes.ts'][i]}</small></span><span class="s"><i class="spin"></i>${b.status}</span></div>`,
    )
    .join('');
  const hot = `<div class="f-row"><span class="fn">billing/service.ts</span><span>${beans
    .slice(0, 2)
    .map((b) => `<span class="chip fly">${b.agent}</span>`)
    .join(' ')}</span><span class="fstat">2 beans</span></div>
    <div class="f-row"><span class="fn">billing/handlers.ts</span><span>${[beans[0], beans[2]]
      .map((b) => `<span class="chip fly">${b.agent}</span>`)
      .join(' ')}</span><span class="fstat">2 beans</span></div>
    <div class="g-empty">Each bean is checked on the merged tree before it lands, so they never collide on the sprout.</div>`;
  return box('Who is working on billing now', '', rows) + box('Collision hot spots', '', hot);
}

function viewFor(f) {
  switch (f.answer) {
    case 'coupons':
      return couponView();
    case 'red':
      return redView() + filesBox();
    case 'billing':
      return billingView(f);
    case 'replay':
      return growingBox(f) + happenedBox(f);
    default:
      return growingBox(f) + happenedBox(f) + filesBox();
  }
}

function answerSub(f) {
  if (f.answer !== 'replay') return ANSWERS[f.answer]?.sub ?? '';
  if (f.replayed)
    return `Back at today: ${f.landed - OLDER} beans landed in the last 7 days, 3 fell off.`;
  return `${f.clock}: ${f.landed - OLDER} of 35 landed since seven days ago.`;
}

function statusLine(f) {
  return [
    `<span><i class="dot ${f.red ? 'red' : 'leaf'}"></i>sprout #${f.landed - 1}</span>`,
    `<span><i class="dot leaf"></i>stalk #${f.stalk - 1}</span>`,
    `<span class="${f.red ? 'red' : ''}">sprout ${f.red ? 'red' : 'green'}</span>`,
    `<span><i class="dot bean"></i>${f.growing} beans growing</span>`,
    `<span class="opt">1 person, ${f.growing} sessions active</span>`,
    '<span class="sp"></span>',
    `<span class="opt">${f.replaying ? 'replaying' : 'live'}</span>`,
    `<span>${f.clock}</span>`,
  ].join('');
}

/* ---------- Drawing ---------- */

function setupAppDemo() {
  const app = document.querySelector('[data-appdemo]');
  if (!app) return;
  const $ = (name) => app.querySelector(`[data-d-${name}]`);
  const el = {
    rows: $('rows'),
    count: $('count'),
    progress: $('progress'),
    week: $('week'),
    clock: $('clock'),
    ask: $('ask'),
    typed: $('typed'),
    ph: $('ph'),
    picked: $('picked'),
    answer: $('answer'),
    head: $('head'),
    sub: $('sub'),
    view: $('view'),
    status: $('status'),
  };
  if (Object.values(el).some((node) => !node)) return;
  const caret = el.ask.querySelector('.caret');
  el.week.style.left = `${(WEEK_FROM_DAY / LIFE_DAYS) * 100}%`;

  let prevLanded = TOTAL;
  let prevStalk = TOTAL;
  /** The last validation moment: which sprouts matured, and until when it stays marked. */
  let moment = null;
  let prevKey = '';
  const draw = (t) => {
    const f = frameAt(t);
    const key = `${f.seg.from}|${f.typed.length}|${f.applied.length}|${Math.floor(t / 450)}`;
    if (key === prevKey) return;
    prevKey = key;
    if (f.landed < prevLanded && f.replaying) {
      // The replay rewound the stalk to seven days ago: start counting from there.
      prevLanded = f.landed;
      prevStalk = f.stalk;
      moment = null;
    }
    el.typed.textContent = f.typed;
    el.ph.hidden = f.typed.length > 0;
    if (caret instanceof HTMLElement) caret.hidden = !f.focus;
    el.ask.classList.toggle('focus', f.focus);
    el.picked.classList.toggle('on', f.answer !== null);
    el.answer.classList.toggle('on', f.answer !== null);
    if (f.answer) {
      el.picked.innerHTML = pickedChips(f.answer);
      el.head.textContent = ANSWERS[f.answer].head;
      el.sub.textContent = answerSub(f);
    }
    el.picked.hidden = f.answer === null;
    el.answer.hidden = f.answer === null;
    app.classList.toggle('playing', f.replaying);
    el.rows.classList.toggle('asking', f.answer !== null && f.answer !== 'replay');
    el.progress.style.width = `${(f.p * 100).toFixed(2)}%`;
    el.clock.textContent = f.clock;
    el.count.textContent = `${f.landed} landed, ${f.growing} growing`;
    if (f.stalk > prevStalk && f.replaying)
      moment = { from: prevStalk, to: f.stalk, clock: f.clock, until: t + 2600, fresh: true };
    else if (moment) moment = t > moment.until ? null : { ...moment, fresh: false };
    el.rows.innerHTML = stalkRows(f, prevLanded, moment);
    el.view.innerHTML = viewFor(f);
    el.status.innerHTML = statusLine(f);
    if (f.stalk > prevStalk && f.replaying) {
      el.rows.classList.add('validating');
      setTimeout(() => el.rows.classList.remove('validating'), 1100);
    }
    prevLanded = f.landed;
    prevStalk = f.stalk;
  };

  const frozen = Number(new URLSearchParams(location.search).get('demo'));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  if (Number.isFinite(frozen) && frozen > 0) {
    // Draw the moment just before too, so a validation that passed in between shows as one.
    draw(Math.max(1, frozen - 700));
    prevKey = '';
    draw(frozen);
    return;
  }
  if (reduced.matches) {
    draw(REPLAY_END);
    return;
  }

  let elapsed = 0;
  let last = 0;
  let raf = 0;
  let visible = false;
  const loop = (now) => {
    if (last) elapsed += Math.min(now - last, 100);
    last = now;
    if (elapsed >= LOOP_MS) elapsed = 0;
    draw(elapsed);
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
    if (reduced.matches) draw(REPLAY_END);
  };
  draw(0);
  new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    sync();
  }).observe(app);
  document.addEventListener('visibilitychange', sync);
  reduced.addEventListener('change', sync);
}

setupAppDemo();
